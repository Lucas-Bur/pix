import crypto from "node:crypto"

import { FileSystem } from "@effect/platform"
import { Effect, Layer } from "effect"

import type { Chunk } from "../domain/chunk.js"
import { DEFAULT_CONFIG } from "../domain/config.js"
import { ConfigStore, Chunker } from "../domain/ports.js"
export { Chunker }

const MIN_CHUNK_CHARS = 20

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const configStore = yield* ConfigStore

  const config = yield* configStore
    .readConfig()
    .pipe(Effect.catchAll(() => Effect.succeed(DEFAULT_CONFIG)))

  const chunkFile = (file: string): Effect.Effect<readonly Chunk[], never> =>
    Effect.gen(function* () {
      const content = yield* fs.readFileString(file).pipe(
        Effect.tapError((err) =>
          Effect.logWarning(`[Chunker] Skipping unreadable file: ${file} — ${String(err)}`),
        ),
        Effect.catchAll(() => Effect.succeed("")),
      )

      if (content === "") {
        return []
      }

      const lines = content.split("\n")
      const chunks: Chunk[] = []

      let idx = 0
      let startLine = 1

      while (startLine <= lines.length) {
        const endLine = Math.min(startLine + config.chunkLines - 1, lines.length)
        const chunkLines = lines.slice(startLine - 1, endLine)
        const text = chunkLines.join("\n")

        if (text.length >= MIN_CHUNK_CHARS) {
          const id = crypto
            .createHash("sha1")
            .update(`${file}:${startLine}`)
            .digest("hex")
            .slice(0, 12)

          chunks.push({
            id,
            idx,
            file,
            startLine,
            endLine,
            text,
          })

          idx++
        }

        // Slide window by chunkLines - overlapLines
        startLine += config.chunkLines - config.overlapLines
      }

      return chunks
    })

  return { chunkFile } as const
})

export const ChunkerLive = Layer.effect(Chunker, make)
