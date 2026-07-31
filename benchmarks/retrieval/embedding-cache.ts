import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { Effect, Option, Schema } from "effect"

import type { Chunk } from "../../src/domain/chunk.js"
import type { CorpusManifest } from "./types.js"

const MetadataSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  repository: Schema.String,
  revision: Schema.String,
  model: Schema.String,
  device: Schema.String,
  batchSize: Schema.Number,
  dimensions: Schema.Number,
  chunkCount: Schema.Number,
  corpusHash: Schema.String,
})

type Metadata = typeof MetadataSchema.Type

const corpusHash = (chunks: readonly Chunk[]): string => {
  const hash = createHash("sha256")
  for (const chunk of chunks) {
    hash.update(chunk.file)
    hash.update("\0")
    hash.update(String(chunk.startLine))
    hash.update("\0")
    hash.update(chunk.text)
    hash.update("\0")
  }
  return hash.digest("hex")
}

const cachePaths = (manifest: CorpusManifest, model: string, device: string, batchSize: number) => {
  const modelKey = model.replaceAll(/[^a-zA-Z0-9.-]/g, "_")
  const directory = path.resolve("benchmarks/.cache/embeddings", manifest.id)
  const stem = `${manifest.revision}-${modelKey}-${device}-b${batchSize}`
  return {
    directory,
    metadata: path.join(directory, `${stem}.json`),
    vectors: path.join(directory, `${stem}.f32`),
  }
}

/** Load cached chunk vectors only when their complete embedding contract still matches. */
export const loadEmbeddingCache = (
  manifest: CorpusManifest,
  model: string,
  device: string,
  batchSize: number,
  dimensions: number,
  chunks: readonly Chunk[],
): Effect.Effect<Option.Option<readonly Float32Array[]>> =>
  Effect.tryPromise(async () => {
    const locations = cachePaths(manifest, model, device, batchSize)
    const [metadataText, binary] = await Promise.all([
      readFile(locations.metadata, "utf8"),
      readFile(locations.vectors),
    ])
    const metadata = Schema.decodeUnknownSync(MetadataSchema)(JSON.parse(metadataText))
    const expectedBytes = chunks.length * dimensions * Float32Array.BYTES_PER_ELEMENT
    if (
      metadata.repository !== manifest.id ||
      metadata.revision !== manifest.revision ||
      metadata.model !== model ||
      metadata.device !== device ||
      metadata.batchSize !== batchSize ||
      metadata.dimensions !== dimensions ||
      metadata.chunkCount !== chunks.length ||
      metadata.corpusHash !== corpusHash(chunks) ||
      binary.byteLength !== expectedBytes
    ) {
      return Option.none<readonly Float32Array[]>()
    }
    const bytes = Uint8Array.from(binary)
    const flat = new Float32Array(bytes.buffer)
    return Option.some(
      Array.from({ length: chunks.length }, (_, index) =>
        flat.slice(index * dimensions, (index + 1) * dimensions),
      ),
    )
  }).pipe(Effect.catch(() => Effect.succeed(Option.none())))

/** Persist chunk vectors with metadata sufficient to reject stale benchmark caches. */
export const writeEmbeddingCache = (
  manifest: CorpusManifest,
  model: string,
  device: string,
  batchSize: number,
  dimensions: number,
  chunks: readonly Chunk[],
  vectors: readonly Float32Array[],
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const locations = cachePaths(manifest, model, device, batchSize)
    yield* Effect.tryPromise({
      try: () => mkdir(locations.directory, { recursive: true }),
      catch: (cause) => new Error("Could not create benchmark embedding cache", { cause }),
    })
    const metadata: Metadata = {
      schemaVersion: 1,
      repository: manifest.id,
      revision: manifest.revision,
      model,
      device,
      batchSize,
      dimensions,
      chunkCount: chunks.length,
      corpusHash: corpusHash(chunks),
    }
    const binary = Buffer.concat(
      vectors.map((vector) => Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)),
    )
    yield* Effect.tryPromise({
      try: () =>
        Promise.all([
          writeFile(locations.metadata, `${JSON.stringify(metadata, null, 2)}\n`, "utf8"),
          writeFile(locations.vectors, binary),
        ]).then(() => undefined),
      catch: (cause) => new Error("Could not write benchmark embedding cache", { cause }),
    })
  })
