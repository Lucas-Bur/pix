import { Effect, Layer, Ref, Result } from "effect"

import type { DeviceType } from "../domain/device.js"
import { ModelLoadError } from "../domain/errors.js"
import { DeviceDetection } from "../domain/ports.js"

const DEVICE_PRIORITY: readonly DeviceType[] = ["cuda", "dml", "coreml", "webgpu", "wasm", "cpu"]

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
  const { pipeline } = yield* Effect.tryPromise(() =>
    import("@huggingface/transformers").then((m) => {
      m.env.cacheDir = ".pix/cache"
      return m
    }),
  )

  const detect = (model: string, dtype: string): Effect.Effect<DeviceType, ModelLoadError> =>
    Effect.gen(function* () {
      const lastError = yield* Ref.make<ModelLoadError | undefined>(undefined)

      for (const device of DEVICE_PRIORITY) {
        const result = yield* tryDevice(model, dtype, device, () => Promise.resolve(pipeline)).pipe(
          Effect.catch((e) =>
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
export const DeviceDetectionLive = Layer.effect(DeviceDetection, make)
