import { NodePath } from "@effect/platform-node"
import { Effect, Layer, Result } from "effect"

import type { DeviceType } from "../domain/device.js"
import { ModelLoadError } from "../domain/errors.js"
import { DeviceDetection } from "../domain/ports.js"
import { resolveTransformersCacheDir } from "../lib/model-cache.js"

/** Device order used by automatic embedding inference selection. */
const DEVICE_PRIORITY: readonly DeviceType[] = ["cuda", "dml", "coreml", "webgpu", "wasm", "cpu"]

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
  dtype: string,
  device: DeviceType,
  loadPipeline: () => Promise<any>,
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
  const transformers = yield* Effect.tryPromise(() => import("@huggingface/transformers"))
  transformers.env.cacheDir = yield* resolveTransformersCacheDir()
  const { pipeline } = transformers

  const detect = (model: string, dtype: string): Effect.Effect<DeviceType, ModelLoadError> =>
    loadFirstAvailableDevice(model, (device) =>
      tryDevice(model, dtype, device, () => Promise.resolve(pipeline)),
    ).pipe(Effect.map(({ device }) => device))

  const detectAll = (model: string, dtype: string): Effect.Effect<readonly DeviceType[], never> =>
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
