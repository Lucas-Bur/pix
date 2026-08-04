import { Effect, Stream } from "effect"

import type { Embedding } from "../../../src/domain/chunk.js"
import { DEFAULT_CONFIG } from "../../../src/domain/config.js"
import type { EmbeddingDtype } from "../../../src/domain/dtype.js"
import type { StoredChunk } from "../../../src/domain/index-data.js"
import { MODEL_REGISTRY } from "../../../src/domain/models.js"
import type { BoundEmbedder, SearchData } from "../../../src/domain/ports.js"
import { IndexStore, SparseEmbedder } from "../../../src/domain/ports.js"
import type {
  SparseContract,
  SparseQuery,
  SparseTerm,
  SparseVector,
} from "../../../src/domain/sparse.js"
import { contentHash } from "../../../src/lib/content-hash.js"
import { buildQueryTermCoverage } from "../../../src/lib/retrieval/evidence-router.js"
import { createAutoBoundEmbedder } from "../../../src/services/embedder.js"
import { prepareCorpus, type PreparedCorpus } from "../corpus/prepare.js"
import { prepareRepository } from "../corpus/repository.js"
import { withSqliteBenchmarkStore } from "../execution/sqlite-index.js"
import { foldKey } from "./folds.js"
import {
  contextRecallAtBudget,
  goldTargetRanks,
  recallAt,
  reciprocalRank,
  resolveGoldTargets,
  successAt,
} from "./metrics.js"
import { fuseVariant, rankLexicalChannels, RETRIEVAL_VARIANTS } from "./ranking.js"
import type { BenchmarkArtifact, CorpusManifest, QueryKind, QueryMeasurement } from "./types.js"
import type { WeightSearchSample } from "./weight-search.js"

const CONTEXT_BUDGETS = [2_048, 4_096, 8_192, 16_384] as const
const EMBEDDING_BATCH_SIZE = 2
const SINGLE_ITEM_ESTIMATED_TOKENS = 2_048
const QUERY_KINDS: readonly QueryKind[] = [
  "identifier",
  "searchPhrase",
  "naturalQuestion",
  "agentTask",
]

interface BenchmarkQuery {
  readonly questionIndex: number
  readonly queryKind: QueryKind
  readonly query: string
}

interface ModelMeasurements {
  readonly sparseEmbeddingRun: BenchmarkArtifact["sparseEmbeddingRuns"][number]
  readonly measurements: readonly QueryMeasurement[]
  readonly samples: readonly WeightSearchSample[]
  readonly samplesByQueryKind: ReadonlyMap<QueryKind, readonly WeightSearchSample[]>
  readonly retrievalDurationMs: number
}

interface RepositoryMeasurements {
  readonly repository: BenchmarkArtifact["repositories"][number]
  readonly embeddingRuns: readonly BenchmarkArtifact["embeddingRuns"][number][]
  readonly sparseEmbeddingRuns: readonly BenchmarkArtifact["sparseEmbeddingRuns"][number][]
  readonly measurements: readonly QueryMeasurement[]
  readonly samplesByModel: ReadonlyMap<string, readonly WeightSearchSample[]>
  readonly sampleGroups: ReadonlyMap<
    string,
    {
      readonly model: string
      readonly queryKind: QueryKind
      readonly samples: readonly WeightSearchSample[]
    }
  >
  readonly retrievalDurationMs: number
}

/** Collected corpus, channel, and quality samples reused by all search stages. */
export interface CollectedBenchmarkData {
  readonly repositories: readonly BenchmarkArtifact["repositories"][number][]
  readonly embeddingRuns: readonly BenchmarkArtifact["embeddingRuns"][number][]
  readonly sparseEmbeddingRuns: readonly BenchmarkArtifact["sparseEmbeddingRuns"][number][]
  readonly measurements: readonly QueryMeasurement[]
  readonly sampleGroups: ReadonlyMap<
    string,
    {
      readonly model: string
      readonly queryKind: QueryKind
      readonly samples: readonly WeightSearchSample[]
    }
  >
  readonly samplesByModel: ReadonlyMap<string, readonly WeightSearchSample[]>
  readonly retrievalDurationMs: number
}

const isLongInput = (text: string): boolean =>
  Buffer.byteLength(text, "utf8") / 4 > SINGLE_ITEM_ESTIMATED_TOKENS

const embedTexts = (
  texts: readonly string[],
  model: string,
  embedder: BoundEmbedder,
): Effect.Effect<readonly Float32Array[], Error> =>
  Effect.gen(function* () {
    const vectors: Float32Array[] = []
    let start = 0
    while (start < texts.length) {
      const currentIsLong = isLongInput(texts[start])
      const next = texts[start + 1]
      const nextIsLong = next !== undefined && isLongInput(next)
      const batchSize = currentIsLong || nextIsLong ? 1 : EMBEDDING_BATCH_SIZE
      const batch = texts.slice(start, start + batchSize)
      const embeddings = yield* embedder.batch(batch)
      vectors.push(...embeddings.map((embedding) => embedding.vector))
      start += batchSize
    }
    return vectors
  }).pipe(Effect.mapError((cause) => new Error(`Embedding failed for ${model}`, { cause })))

const embedSparseTexts = (
  texts: readonly string[],
  embedder: typeof SparseEmbedder.Service,
): Effect.Effect<readonly SparseVector[], Error> =>
  Effect.gen(function* () {
    const vectors: SparseVector[] = []
    let start = 0
    while (start < texts.length) {
      const batch = texts.slice(start, start + DEFAULT_CONFIG.sparseEmbedder.batchSize)
      vectors.push(...(yield* embedder.batch(batch)))
      start += DEFAULT_CONFIG.sparseEmbedder.batchSize
    }
    return vectors
  }).pipe(Effect.mapError((cause) => new Error("Sparse document embedding failed", { cause })))

const toStoredChunk = (chunk: PreparedCorpus["chunks"][number]): StoredChunk => {
  const { text, ...location } = chunk
  return { ...location, contentHash: contentHash(text) }
}

const persistBenchmarkCorpus = (
  store: typeof IndexStore.Service,
  corpus: PreparedCorpus,
  vectors: readonly Float32Array[],
  sparseVectors: readonly SparseVector[],
  dims: number,
  dtype: EmbeddingDtype,
  sparseContract: SparseContract,
  sparseIdf: readonly SparseTerm[],
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const pairs = corpus.chunks.map((chunk, index): readonly [StoredChunk, Embedding] => [
      toStoredChunk(chunk),
      { vector: vectors[index]!, dims, dtype },
    ])
    yield* store.persistIndex({
      chunks: Stream.succeed(
        pairs.map(
          ([chunk, embedding], index) => [chunk, embedding, sparseVectors[index]!] as const,
        ),
      ),
      identifierIndex: corpus.identifierIndex,
      bm25Index: corpus.bm25Index,
      files: [],
      dims,
      dtype,
      embeddingCache: [],
      sparseEmbeddingCache: [],
      sparseContract,
      sparseIdf,
    })
  })

const collectModelSamples = (
  manifest: CorpusManifest,
  corpus: PreparedCorpus,
  queries: readonly BenchmarkQuery[],
  targetsByQuestion: readonly (readonly ReadonlySet<number>[])[],
  groupedFoldAssignments: ReadonlyMap<string, number>,
  model: string,
  queryVectors: readonly Float32Array[],
  sparseQueries: readonly SparseQuery[],
  searchData: SearchData,
  store: typeof IndexStore.Service,
  dims: number,
  dtype: EmbeddingDtype,
): Effect.Effect<
  {
    readonly measurements: readonly QueryMeasurement[]
    readonly samples: readonly WeightSearchSample[]
    readonly samplesByQueryKind: ReadonlyMap<QueryKind, readonly WeightSearchSample[]>
  },
  Error
> =>
  Effect.gen(function* () {
    const modelMeasurements: QueryMeasurement[] = []
    const modelSamples: WeightSearchSample[] = []
    const samplesByQueryKind = new Map<QueryKind, WeightSearchSample[]>()

    for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
      const entry = queries[queryIndex]
      const question = manifest.questions[entry.questionIndex]
      const targets = targetsByQuestion[entry.questionIndex]
      const groupedFold = groupedFoldAssignments.get(foldKey(manifest.id, question.id))
      if (groupedFold === undefined)
        return yield* Effect.fail(
          new Error(`No grouped fold assignment for ${manifest.id}/${question.id}`),
        )
      const channelStartedAt = performance.now()
      const lexicalRankings = rankLexicalChannels(entry.query, searchData)
      const dense = yield* store.searchDense({
        vector: queryVectors[queryIndex]!,
        dims,
        dtype,
      })
      const sparse = yield* store.searchSparse(sparseQueries[queryIndex]!)
      const rankings = { ...lexicalRankings, dense, sparse }
      const channelDurationMs = performance.now() - channelStartedAt
      const sample: WeightSearchSample = {
        repository: manifest.id,
        intentId: question.id,
        queryKind: entry.queryKind,
        groupedFold,
        query: entry.query,
        rankings,
        targets,
        chunks: corpus.chunks,
        termCoverage: buildQueryTermCoverage(
          entry.query,
          searchData.bm25Index,
          searchData.identifierIndex,
        ),
      }
      modelSamples.push(sample)
      samplesByQueryKind.set(entry.queryKind, [
        ...(samplesByQueryKind.get(entry.queryKind) ?? []),
        sample,
      ])
      for (const variant of RETRIEVAL_VARIANTS) {
        const variantStartedAt = performance.now()
        const ranked = fuseVariant(variant, entry.query, rankings)
        const queryDurationMs = channelDurationMs + performance.now() - variantStartedAt
        modelMeasurements.push({
          repository: manifest.id,
          language: manifest.language,
          size: manifest.size,
          revision: manifest.revision,
          model,
          variant,
          questionId: question.id,
          queryKind: entry.queryKind,
          query: entry.query,
          category: question.category,
          difficulty: question.difficulty,
          groupedFold,
          recallAt5: recallAt(ranked, targets, 5),
          recallAt10: recallAt(ranked, targets, 10),
          recallAt20: recallAt(ranked, targets, 20),
          recallAt50: recallAt(ranked, targets, 50),
          successAt10: successAt(ranked, targets, 10),
          successAt20: successAt(ranked, targets, 20),
          reciprocalRank: reciprocalRank(ranked, targets),
          goldRanks: goldTargetRanks(ranked, targets),
          contextRecall: Object.fromEntries(
            CONTEXT_BUDGETS.map((budget) => [
              String(budget),
              contextRecallAtBudget(ranked, targets, corpus.chunks, budget),
            ]),
          ),
          queryDurationMs,
        })
      }
    }

    return { measurements: modelMeasurements, samples: modelSamples, samplesByQueryKind }
  })

const collectModelMeasurements = (
  manifest: CorpusManifest,
  corpus: PreparedCorpus,
  queries: readonly BenchmarkQuery[],
  targetsByQuestion: readonly (readonly ReadonlySet<number>[])[],
  groupedFoldAssignments: ReadonlyMap<string, number>,
  model: string,
  info: (typeof MODEL_REGISTRY)[string] & object,
  chunkVectors: readonly Float32Array[],
  queryVectors: readonly Float32Array[],
): Effect.Effect<ModelMeasurements, Error> =>
  Effect.gen(function* () {
    const retrievalStartedAt = performance.now()
    const modelRun = yield* withSqliteBenchmarkStore(
      model,
      info.defaultDtype,
      Effect.gen(function* () {
        const store = yield* IndexStore
        const sparseEmbedder = yield* SparseEmbedder
        const sparseStartedAt = performance.now()
        const sparseVectors = yield* embedSparseTexts(
          corpus.chunks.map((chunk) => chunk.text),
          sparseEmbedder,
        )
        const sparseChunkEmbeddingDurationMs = performance.now() - sparseStartedAt
        const sparseIdf = yield* sparseEmbedder.loadIdf()
        const sparseQueryStartedAt = performance.now()
        const sparseQueries = yield* Effect.forEach(queries, ({ query }) =>
          sparseEmbedder.tokenizeQuery(query),
        )
        const sparseQueryTokenizationDurationMs = performance.now() - sparseQueryStartedAt
        yield* persistBenchmarkCorpus(
          store,
          corpus,
          chunkVectors,
          sparseVectors,
          info.dims,
          info.defaultDtype,
          sparseEmbedder.contract,
          sparseIdf,
        )
        const searchData = yield* store.loadSearchData()
        const collected = yield* collectModelSamples(
          manifest,
          corpus,
          queries,
          targetsByQuestion,
          groupedFoldAssignments,
          model,
          queryVectors,
          sparseQueries,
          searchData,
          store,
          info.dims,
          info.defaultDtype,
        )
        return {
          sparseEmbeddingRun: {
            repository: manifest.id,
            model: sparseEmbedder.contract.model,
            tokenizerModel: sparseEmbedder.contract.tokenizer,
            batchSize: DEFAULT_CONFIG.sparseEmbedder.batchSize,
            chunkEmbeddingDurationMs: sparseChunkEmbeddingDurationMs,
            queryTokenizationDurationMs: sparseQueryTokenizationDurationMs,
          },
          ...collected,
        }
      }),
    )
    return {
      sparseEmbeddingRun: modelRun.sparseEmbeddingRun,
      measurements: modelRun.measurements,
      samples: modelRun.samples,
      samplesByQueryKind: modelRun.samplesByQueryKind,
      retrievalDurationMs: performance.now() - retrievalStartedAt,
    }
  })

const collectRepositoryMeasurements = (
  manifest: CorpusManifest,
  models: readonly string[],
  groupedFoldAssignments: ReadonlyMap<string, number>,
): Effect.Effect<RepositoryMeasurements, Error> =>
  Effect.gen(function* () {
    const repositoryPath = yield* prepareRepository(manifest)
    const corpus = yield* prepareCorpus(repositoryPath, manifest)
    const targetsByQuestion: (readonly ReadonlySet<number>[])[] = []
    for (const question of manifest.questions) {
      const targets = resolveGoldTargets(
        question.groundTruth,
        corpus.chunks,
        corpus.identifiersByChunk,
      )
      const unresolved = question.groundTruth.filter((_, index) => targets[index].size === 0)
      if (unresolved.length > 0)
        return yield* Effect.fail(
          new Error(
            `${question.id} has unresolved gold targets: ${unresolved.map((target) => `${target.file}::${target.symbol}`).join(", ")}`,
          ),
        )
      targetsByQuestion.push(targets)
    }

    const queries = manifest.questions.flatMap((question, questionIndex) =>
      QUERY_KINDS.map((queryKind) => ({
        questionIndex,
        queryKind,
        query: question.queries[queryKind],
      })),
    )
    const embeddingRuns: BenchmarkArtifact["embeddingRuns"][number][] = []
    const sparseEmbeddingRuns: BenchmarkArtifact["sparseEmbeddingRuns"][number][] = []
    const measurements: QueryMeasurement[] = []
    const samplesByModel = new Map<string, readonly WeightSearchSample[]>()
    const sampleGroups = new Map<
      string,
      {
        readonly model: string
        readonly queryKind: QueryKind
        readonly samples: readonly WeightSearchSample[]
      }
    >()
    let retrievalDurationMs = 0

    for (const model of models) {
      const info = MODEL_REGISTRY[model]
      if (info === undefined)
        return yield* Effect.fail(new Error(`Unknown embedding model ${model}`))
      const bound = yield* createAutoBoundEmbedder({
        model,
        dtype: info.defaultDtype,
        dims: info.dims,
      }).pipe(
        Effect.mapError(
          (cause) => new Error(`Could not auto-select a device for ${model}`, { cause }),
        ),
      )
      const embeddingStartedAt = performance.now()
      const chunkVectors = yield* embedTexts(
        corpus.chunks.map((chunk) => chunk.text),
        model,
        bound.embedder,
      )
      const chunkEmbeddingDurationMs = performance.now() - embeddingStartedAt
      const queryEmbeddingStartedAt = performance.now()
      const queryVectors = yield* embedTexts(
        queries.map((entry) => entry.query),
        model,
        bound.embedder,
      )
      const modelData = yield* collectModelMeasurements(
        manifest,
        corpus,
        queries,
        targetsByQuestion,
        groupedFoldAssignments,
        model,
        info,
        chunkVectors,
        queryVectors,
      )
      embeddingRuns.push({
        repository: manifest.id,
        model,
        device: bound.device,
        batchSize: EMBEDDING_BATCH_SIZE,
        chunkEmbeddingDurationMs,
        queryEmbeddingDurationMs: performance.now() - queryEmbeddingStartedAt,
      })
      sparseEmbeddingRuns.push(modelData.sparseEmbeddingRun)
      measurements.push(...modelData.measurements)
      retrievalDurationMs += modelData.retrievalDurationMs
      samplesByModel.set(model, modelData.samples)
      for (const [queryKind, samples] of modelData.samplesByQueryKind) {
        sampleGroups.set(`${model}\0${queryKind}`, { model, queryKind, samples })
      }
    }

    return {
      repository: {
        id: manifest.id,
        repository: manifest.repository,
        revision: manifest.revision,
        chunks: corpus.chunks.length,
        preparationDurationMs: corpus.preparationDurationMs,
      },
      embeddingRuns,
      sparseEmbeddingRuns,
      measurements,
      samplesByModel,
      sampleGroups,
      retrievalDurationMs,
    }
  })

/** Prepare every selected corpus and collect the physical rankings once. */
export const collectBenchmarkData = (
  manifests: readonly CorpusManifest[],
  models: readonly string[],
  groupedFoldAssignments: ReadonlyMap<string, number>,
): Effect.Effect<CollectedBenchmarkData, Error> =>
  Effect.gen(function* () {
    const repositories: BenchmarkArtifact["repositories"][number][] = []
    const embeddingRuns: BenchmarkArtifact["embeddingRuns"][number][] = []
    const sparseEmbeddingRuns: BenchmarkArtifact["sparseEmbeddingRuns"][number][] = []
    const measurements: QueryMeasurement[] = []
    const sampleGroups = new Map<
      string,
      {
        readonly model: string
        readonly queryKind: QueryKind
        readonly samples: readonly WeightSearchSample[]
      }
    >()
    const samplesByModel = new Map<string, readonly WeightSearchSample[]>()
    let retrievalDurationMs = 0

    for (const manifest of manifests) {
      const repositoryData = yield* collectRepositoryMeasurements(
        manifest,
        models,
        groupedFoldAssignments,
      )
      repositories.push(repositoryData.repository)
      embeddingRuns.push(...repositoryData.embeddingRuns)
      sparseEmbeddingRuns.push(...repositoryData.sparseEmbeddingRuns)
      measurements.push(...repositoryData.measurements)
      retrievalDurationMs += repositoryData.retrievalDurationMs
      for (const [model, samples] of repositoryData.samplesByModel) {
        samplesByModel.set(model, [...(samplesByModel.get(model) ?? []), ...samples])
      }
      for (const [key, group] of repositoryData.sampleGroups) {
        const current = sampleGroups.get(key)
        sampleGroups.set(key, {
          model: group.model,
          queryKind: group.queryKind,
          samples: [...(current?.samples ?? []), ...group.samples],
        })
      }
    }

    return {
      repositories,
      embeddingRuns,
      sparseEmbeddingRuns,
      measurements,
      sampleGroups,
      samplesByModel,
      retrievalDurationMs,
    }
  })
