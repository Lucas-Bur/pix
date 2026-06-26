import { Effect, Layer } from "effect"
import { FileSystem } from "effect/FileSystem"

import { UnsupportedFormat } from "../domain/errors.js"
import type { AllProcessorErrors } from "../domain/errors.js"
import { ContentExtractor } from "../domain/ports.js"
import { getExtension } from "../lib/config/extension.js"
import { buildProcessorMap } from "../lib/config/processors.js"

const make = Effect.gen(function* () {
  const fs = yield* FileSystem
  const processorMap = buildProcessorMap([])

  const extract = (file: string): Effect.Effect<string, AllProcessorErrors> => {
    const ext = getExtension(file)

    const processor = processorMap[ext]
    if (!processor) {
      return Effect.fail(
        new UnsupportedFormat({
          message: `No processor for extension: ${ext}`,
          extension: ext,
        }),
      )
    }
    return processor(file).pipe(Effect.provideService(FileSystem, fs))
  }

  return { extract } as const
})

export const ContentExtractorLive = Layer.effect(ContentExtractor, make)
