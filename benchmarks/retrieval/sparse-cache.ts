import { readFile } from "node:fs/promises"
import path from "node:path"

import { Effect, Option, Schema } from "effect"

import type { Chunk } from "../../src/domain/chunk.js"
import { corpusHash, writeBenchmarkCacheFiles } from "./embedding-cache.js"
import type { SparseVector } from "./sparse-encoder.js"
import type { CorpusManifest } from "./types.js"

const MetadataSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  repository: Schema.String,
  revision: Schema.String,
  model: Schema.String,
  tokenizerModel: Schema.String,
  device: Schema.Literal("cpu"),
  batchSize: Schema.Number,
  chunkCount: Schema.Number,
  entryCount: Schema.Number,
  rowOffsets: Schema.Array(Schema.Number),
  corpusHash: Schema.String,
})

type Metadata = typeof MetadataSchema.Type

const cachePaths = (manifest: CorpusManifest, model: string, tokenizerModel: string) => {
  const modelKey = `${model}-${tokenizerModel}`.replaceAll(/[^a-zA-Z0-9.-]/g, "_")
  const directory = path.resolve("benchmarks/.cache/sparse", manifest.id)
  const stem = `${manifest.revision}-${modelKey}`
  return {
    directory,
    metadata: path.join(directory, `${stem}.json`),
    vectors: path.join(directory, `${stem}.bin`),
  }
}

const validMetadata = (
  metadata: Metadata,
  manifest: CorpusManifest,
  model: string,
  tokenizerModel: string,
  batchSize: number,
  chunks: readonly Chunk[],
  binaryByteLength: number,
): boolean =>
  metadata.repository === manifest.id &&
  metadata.revision === manifest.revision &&
  metadata.model === model &&
  metadata.tokenizerModel === tokenizerModel &&
  metadata.device === "cpu" &&
  metadata.batchSize === batchSize &&
  metadata.chunkCount === chunks.length &&
  metadata.rowOffsets.length === chunks.length + 1 &&
  metadata.rowOffsets[0] === 0 &&
  metadata.rowOffsets[metadata.rowOffsets.length - 1] === metadata.entryCount &&
  metadata.corpusHash === corpusHash(chunks) &&
  binaryByteLength === metadata.entryCount * 8

/** Load variable-length sparse document vectors only when their full cache contract matches. */
export const loadSparseEmbeddingCache = (
  manifest: CorpusManifest,
  model: string,
  tokenizerModel: string,
  batchSize: number,
  chunks: readonly Chunk[],
): Effect.Effect<Option.Option<readonly SparseVector[]>> =>
  Effect.tryPromise(async () => {
    const locations = cachePaths(manifest, model, tokenizerModel)
    const [metadataText, binary] = await Promise.all([
      readFile(locations.metadata, "utf8"),
      readFile(locations.vectors),
    ])
    const metadata = Schema.decodeUnknownSync(MetadataSchema)(JSON.parse(metadataText))
    if (
      !validMetadata(
        metadata,
        manifest,
        model,
        tokenizerModel,
        batchSize,
        chunks,
        binary.byteLength,
      )
    )
      return Option.none<readonly SparseVector[]>()

    const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength)
    const vectors = chunks.map((_, row) => {
      const start = metadata.rowOffsets[row]!
      const end = metadata.rowOffsets[row + 1]!
      return Array.from({ length: end - start }, (_, entryIndex) => {
        const offset = (start + entryIndex) * 8
        return {
          tokenId: view.getUint32(offset, true),
          weight: view.getFloat32(offset + 4, true),
        }
      })
    })
    return Option.some(vectors)
  }).pipe(Effect.catch(() => Effect.succeed(Option.none())))

/** Persist variable-length sparse document vectors with stale-cache rejection metadata. */
export const writeSparseEmbeddingCache = (
  manifest: CorpusManifest,
  model: string,
  tokenizerModel: string,
  batchSize: number,
  chunks: readonly Chunk[],
  vectors: readonly SparseVector[],
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    if (vectors.length !== chunks.length)
      return yield* Effect.fail(new Error("Sparse vector count does not match benchmark chunks"))

    const locations = cachePaths(manifest, model, tokenizerModel)
    const rowOffsets = [0]
    for (const vector of vectors)
      rowOffsets.push(rowOffsets[rowOffsets.length - 1]! + vector.length)
    const binary = Buffer.alloc(rowOffsets[rowOffsets.length - 1]! * 8)
    for (let row = 0; row < vectors.length; row++) {
      for (let entryIndex = 0; entryIndex < vectors[row]!.length; entryIndex++) {
        const entry = vectors[row]![entryIndex]!
        const offset = (rowOffsets[row]! + entryIndex) * 8
        binary.writeUInt32LE(entry.tokenId, offset)
        binary.writeFloatLE(entry.weight, offset + 4)
      }
    }

    const metadata: Metadata = {
      schemaVersion: 1,
      repository: manifest.id,
      revision: manifest.revision,
      model,
      tokenizerModel,
      device: "cpu",
      batchSize,
      chunkCount: chunks.length,
      entryCount: rowOffsets[rowOffsets.length - 1]!,
      rowOffsets,
      corpusHash: corpusHash(chunks),
    }
    yield* writeBenchmarkCacheFiles(
      locations.directory,
      locations.metadata,
      metadata,
      locations.vectors,
      binary,
      "benchmark sparse cache",
    )
  })
