import { FileSystem } from "@effect/platform"
import { Effect, Layer } from "effect"

import type { AllProcessorErrors } from "../domain/errors.js"
import { ContentExtractor } from "../domain/ports.js"
import { getExtension } from "../lib/extension.js"
import { buildProcessorMap } from "./processors/index.js"

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const processorMap = buildProcessorMap([])

  const extract = (file: string): Effect.Effect<string, AllProcessorErrors> => {
    const ext = getExtension(file)

    const processor = processorMap[ext]
    if (!processor) {
      return Effect.fail({
        _tag: "UnsupportedFormat" as const,
        message: `No processor for extension: ${ext}`,
        extension: ext,
      } as AllProcessorErrors)
    }
    return processor(file).pipe(Effect.provideService(FileSystem.FileSystem, fs))
  }

  return { extract } as const
})

export const ContentExtractorLive = Layer.effect(ContentExtractor, make)
