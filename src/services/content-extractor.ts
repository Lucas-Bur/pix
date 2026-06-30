import { Effect, Layer } from "effect"
import { FileSystem } from "effect/FileSystem"

import { UnsupportedFormat } from "../domain/errors.js"
import type { AllProcessorErrors } from "../domain/errors.js"
import { ContentExtractor } from "../domain/ports.js"
import { getExtension } from "../lib/config/extension.js"
import { buildExtensionRegistry } from "../lib/registry.js"

const make = Effect.gen(function* () {
  const fs = yield* FileSystem
  const registry = buildExtensionRegistry([])

  const extract = (file: string): Effect.Effect<string, AllProcessorErrors> => {
    const ext = getExtension(file)

    const entry = registry[ext]
    if (!entry) {
      return Effect.fail(
        new UnsupportedFormat({
          message: `No processor for extension: ${ext}`,
          extension: ext,
        }),
      )
    }
    return entry.processor(file).pipe(Effect.provideService(FileSystem, fs))
  }

  return { extract } as const
})

export const ContentExtractorLive = Layer.effect(ContentExtractor, make)
