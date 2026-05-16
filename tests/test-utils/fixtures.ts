import { Schema } from "effect"

import { ChunkSchema } from "../../src/domain/chunk.js"
import type { Chunk } from "../../src/domain/chunk.js"
import { ConfigSchema } from "../../src/domain/config.js"
import type { Config } from "../../src/domain/config.js"
import { DEFAULT_CONFIG } from "../../src/domain/config.js"
import { deepMerge } from "../../src/lib/merge.js"

const DEFAULT_CHUNK: Chunk = {
  id: "test-id",
  idx: 0,
  file: "/test/file.md",
  startLine: 1,
  endLine: 1,
  text: "test content",
  contextBefore: null,
  contextAfter: null,
}

export const makeConfigJson = (overrides?: Partial<Config>): string =>
  JSON.stringify(Schema.decodeUnknownSync(ConfigSchema)(deepMerge(DEFAULT_CONFIG, overrides ?? {})))

export const makeChunkJson = (overrides?: Partial<Chunk>): string =>
  JSON.stringify(Schema.decodeUnknownSync(ChunkSchema)(deepMerge(DEFAULT_CHUNK, overrides ?? {})))
