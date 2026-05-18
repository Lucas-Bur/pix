import { FileSystem } from "@effect/platform"
import { Effect, Schema } from "effect"

import { ChunkSchema } from "../domain/chunk.js"
import { DiskFullError, StoreError } from "../domain/errors.js"
import type { Bm25Index } from "../domain/ports.js"
import { buildBm25Index } from "../lib/bm25.js"
import { withFsError, withReadError } from "../lib/fs-error.js"

const parseJsonChunk = Schema.parseJson(ChunkSchema)

export const buildAndStoreBm25 = (
  chunksContent: string,
  bm25Path: string,
): Effect.Effect<void, StoreError | DiskFullError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const chunkLines = chunksContent.split("\n").filter((l) => l.trim().length > 0)
    const texts: { index: number; text: string }[] = []
    for (let i = 0; i < chunkLines.length; i++) {
      try {
        const chunk = Schema.decodeUnknownSync(parseJsonChunk)(chunkLines[i])
        texts.push({ index: i, text: chunk.text })
      } catch {
        // skip malformed lines — bm25 ignores them
      }
    }
    const bm25Index = buildBm25Index(texts)
    yield* withFsError(
      fs.writeFile(bm25Path, Buffer.from(JSON.stringify(bm25Index))),
      "write bm25 index",
      bm25Path,
    )
  })

export const loadBm25 = (
  bm25Path: string,
): Effect.Effect<Bm25Index, StoreError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const exists = yield* withReadError(fs.exists(bm25Path), "check bm25 index")
    if (!exists) {
      return yield* new StoreError({
        message: `Missing ${bm25Path} — index may be corrupted. Run pix reset and re-index.`,
      })
    }
    const content = yield* withReadError(fs.readFileString(bm25Path), "read bm25 index", bm25Path)
    try {
      return JSON.parse(content) as Bm25Index
    } catch {
      return yield* new StoreError({
        message: `Corrupted ${bm25Path} — index may be damaged. Run pix reset and re-index.`,
      })
    }
  })
