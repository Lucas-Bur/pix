import { NodePath } from "@effect/platform-node"
import { Effect, Layer, Path, Result } from "effect"

import { DEVICE_PRIORITY, type DeviceType } from "../domain/device.js"
import type { EmbeddingDtype } from "../domain/dtype.js"
import { ModelLoadError } from "../domain/errors.js"
import { DeviceDetection } from "../domain/ports.js"
import { resolveTransformersCacheDir } from "../lib/model-cache.js"

type FeatureExtractionPipelineLoader = (
  task: "feature-extraction",
  model: string,
  options: { readonly device: DeviceType; readonly dtype: EmbeddingDtype },
) => Promise<unknown>

/** Load a model once on the first working device in the shared automatic priority order. */
export const loadFirstAvailableDevice = <A>(
  model: string,
  load: (device: DeviceType) => Effect.Effect<A, ModelLoadError>,
): Effect.Effect<{ readonly device: DeviceType; readonly value: A }, ModelLoadError> =>
  Effect.gen(function* () {
    let lastError: ModelLoadError | undefined
    for (const device of DEVICE_PRIORITY) {
      const result = yield* load(device).pipe(Effect.result)
      if (Result.isSuccess(result)) return { device, value: result.success }
      lastError = result.failure
    }
    return yield* (
      lastError ??
        new ModelLoadError({
          message: `No device available for model "${model}"`,
          model,
        })
    )
  })

const tryDevice = (
  model: string,
  dtype: EmbeddingDtype,
  device: DeviceType,
  loadPipeline: () => Promise<FeatureExtractionPipelineLoader>,
): Effect.Effect<DeviceType, ModelLoadError> =>
  Effect.tryPromise(() =>
    loadPipeline().then((p) => p("feature-extraction", model, { device, dtype })),
  ).pipe(
    Effect.as(device),
    Effect.mapError(
      (cause) =>
        new ModelLoadError({
          message: `Failed to load model "${model}" on device "${device}"`,
          model,
          cause,
        }),
    ),
  )

const make = Effect.gen(function* () {
  const path = yield* Path.Path
  const transformers = yield* Effect.tryPromise(() => import("@huggingface/transformers"))
  transformers.env.cacheDir = yield* resolveTransformersCacheDir({ projectRoot: path.resolve() })
  const { pipeline } = transformers

  const detect = (
    model: string,
    dtype: EmbeddingDtype,
  ): Effect.Effect<DeviceType, ModelLoadError> =>
    loadFirstAvailableDevice(model, (device) =>
      tryDevice(model, dtype, device, () => Promise.resolve(pipeline)),
    ).pipe(Effect.map(({ device }) => device))

  const detectAll = (
    model: string,
    dtype: EmbeddingDtype,
  ): Effect.Effect<readonly DeviceType[], never> =>
    Effect.gen(function* () {
      const working: DeviceType[] = []
      for (const device of DEVICE_PRIORITY) {
        const result = yield* tryDevice(model, dtype, device, () => Promise.resolve(pipeline)).pipe(
          Effect.result,
        )
        if (Result.isSuccess(result)) {
          working.push(device)
        }
      }
      return working
    })

  return { detect, detectAll } as const
})

/** Live implementation of DeviceDetection that attempts real model loading. */
export const DeviceDetectionLive = Layer.provideMerge(
  Layer.effect(DeviceDetection, make),
  NodePath.layer,
)
