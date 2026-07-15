import { Schema } from "effect"

import { ChunkSchema, type Chunk, type Embedding } from "../../src/domain/chunk.js"
import { ConfigSchema } from "../../src/domain/config.js"
import type { Config } from "../../src/domain/config.js"
import { DEFAULT_CONFIG } from "../../src/domain/config.js"
import type { StoredChunk } from "../../src/domain/index-data.js"
import { contentHash } from "../../src/lib/content-hash.js"
import { deepMerge } from "./merge.js"

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown> ? DeepPartial<T[K]> : T[K]
}

const DEFAULT_CHUNK: Chunk = {
  id: "test-id",
  idx: 0,
  file: "/test/file.md",
  startLine: 1,
  endLine: 1,
  startOffset: 0,
  endOffset: 12,
  text: "test content",
}

export const makeConfigJson = (overrides?: DeepPartial<Config>): string =>
  JSON.stringify(Schema.decodeUnknownSync(ConfigSchema)(deepMerge(DEFAULT_CONFIG, overrides ?? {})))

export const makeChunkJson = (overrides?: DeepPartial<Chunk>): string =>
  JSON.stringify(Schema.decodeUnknownSync(ChunkSchema)(deepMerge(DEFAULT_CHUNK, overrides ?? {})))

export const TEST_CONFIG_JSON = makeConfigJson({
  embedder: { device: "auto", dtype: "fp32", batchSize: 16 },
})

export const makeChunk = (overrides?: Partial<Chunk>): Chunk => {
  const base: Chunk = {
    id: "a1",
    idx: 0,
    file: "/test.ts",
    startLine: 1,
    endLine: 2,
    startOffset: 0,
    endOffset: 5,
    text: "hello",
  }
  return { ...base, ...overrides }
}

export const makeEmbedding = (fill: number = 0.1): Embedding => ({
  vector: new Float32Array(384).fill(fill),
  dims: 384,
  dtype: "fp32" as const,
})

/** Build persisted chunk metadata from a working chunk fixture. */
export const makeStoredChunk = (overrides?: Partial<Chunk>): StoredChunk => {
  const chunk = makeChunk(overrides)
  const { text, ...location } = chunk
  return {
    ...location,
    contentHash: contentHash(text),
  }
}
