import crypto from "node:crypto"

import { Effect, Layer } from "effect"

import type { Chunk } from "../domain/chunk.js"
import type { Config } from "../domain/config.js"
import { DEFAULT_CONFIG } from "../domain/config.js"
import { ChunkerError } from "../domain/errors.js"
import { ConfigStore, Chunker } from "../domain/ports.js"
export { Chunker }

const MIN_CHUNK_CHARS = 20

const buildChunks = (file: string, content: string, config: Config): Chunk[] => {
  const lines = content.split("\n")
  const chunks: Chunk[] = []

  let idx = 0
  let startLine = 1

  while (startLine <= lines.length) {
    const endLine = Math.min(startLine + config.chunkLines - 1, lines.length)
    const chunkLines = lines.slice(startLine - 1, endLine)
    const text = chunkLines.join("\n")

    if (text.length >= MIN_CHUNK_CHARS) {
      const id = crypto.createHash("sha1").update(`${file}:${startLine}`).digest("hex").slice(0, 12)

      const contextBeforeStart = Math.max(0, startLine - 1 - config.overlapLines)
      const contextBefore = lines.slice(contextBeforeStart, startLine - 1).join("\n")
      const contextAfterEnd = Math.min(lines.length, endLine + config.overlapLines)
      const contextAfter = lines.slice(endLine, contextAfterEnd).join("\n")

      chunks.push({
        id,
        idx,
        file,
        startLine,
        endLine,
        text,
        contextBefore: contextBefore || null,
        contextAfter: contextAfter || null,
      })
      idx++
    }

    startLine += config.chunkLines - config.overlapLines
  }

  return chunks
}

const make = Effect.gen(function* () {
  const configStore = yield* ConfigStore

  const config = yield* configStore
    .readConfig()
    .pipe(Effect.catchAll(() => Effect.succeed(DEFAULT_CONFIG)))

  const chunkText = (text: string, file: string): Effect.Effect<readonly Chunk[], ChunkerError> =>
    Effect.sync(() => {
      if (text === "") return []
      return buildChunks(file, text, config)
    })

  return { chunkText } as const
})

export const ChunkerLive = Layer.effect(Chunker, make)
