import { env, type DataType } from "@huggingface/transformers"
import { Context, Effect, Layer, Ref } from "effect"

import { ModelLoadError } from "../domain/errors.js"

/** Available compute devices for ONNX model execution. */
export type DeviceType = "cuda" | "dml" | "coreml" | "cpu"

const DEVICE_PRIORITY: readonly DeviceType[] = ["cuda", "dml", "coreml", "cpu"]

const initCacheDir = Effect.sync(() => {
  env.cacheDir = ".pix/cache"
})

const tryDevice = (
  model: string,
  dtype: DataType,
  device: DeviceType,
  loadPipeline: () => Promise<any>,
): Effect.Effect<DeviceType, ModelLoadError> =>
  Effect.tryPromise(() =>
    loadPipeline().then((p) => p("feature-extraction", model, { device, dtype })),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new ModelLoadError({
          message: `Failed to load model "${model}" on device "${device}"`,
          model,
          cause,
        }),
    ),
  )

/** Service for detecting the best available compute device. */
export class DeviceDetection extends Context.Tag("DeviceDetection")<
  DeviceDetection,
  {
    /**
     * Detect the best available device by attempting model load on each device in priority order:
     * cuda → dml → coreml → cpu. Returns the first device that succeeds.
     */
    readonly detect: (model: string, dtype: DataType) => Effect.Effect<DeviceType, ModelLoadError>
  }
>() {}

const make = Effect.gen(function* () {
  yield* initCacheDir
  const { pipeline } = yield* Effect.tryPromise(() => import("@huggingface/transformers"))

  const detect = (model: string, dtype: DataType): Effect.Effect<DeviceType, ModelLoadError> =>
    Effect.gen(function* () {
      const lastError = yield* Ref.make<ModelLoadError | undefined>(undefined)

      for (const device of DEVICE_PRIORITY) {
        const result = yield* tryDevice(model, dtype, device, () => Promise.resolve(pipeline)).pipe(
          Effect.catchAll((e) =>
            Ref.set(lastError, e).pipe(
              Effect.flatMap(() => Effect.succeed<DeviceType | undefined>(undefined)),
            ),
          ),
        )
        if (result !== undefined) {
          return result
        }
      }

      const err = yield* Ref.get(lastError)
      return yield* (
        err ??
          new ModelLoadError({
            message: `No device available for model "${model}"`,
            model,
          })
      )
    })

  return { detect } as const
})

/** Live implementation of DeviceDetection that attempts real model loading. */
export const DeviceDetectionLive = Layer.effect(DeviceDetection, make)
