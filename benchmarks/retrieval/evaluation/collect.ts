import { Effect, Stream } from "effect"
import { SqlClient } from "effect/unstable/sql"

import type { Embedding } from "../../../src/domain/chunk.js"
import { DEFAULT_CONFIG } from "../../../src/domain/config.js"
import type { EmbeddingDtype } from "../../../src/domain/dtype.js"
import type { StoredChunk } from "../../../src/domain/index-data.js"
import {
  MODEL_REGISTRY,
  resolveChunkTokenLimit,
  SPARSE_MODEL_REGISTRY,
} from "../../../src/domain/models.js"
import type { BoundEmbedder, SearchData } from "../../../src/domain/ports.js"
import { IndexStore, SparseEmbedder } from "../../../src/domain/ports.js"
import type { ChannelRankings } from "../../../src/domain/retrieval.js"
import type {
  SparseContract,
  SparseQuery,
  SparseTerm,
  SparseVector,
} from "../../../src/domain/sparse.js"
import { contentHash } from "../../../src/lib/content-hash.js"
import { buildQueryTermCoverage } from "../../../src/lib/retrieval/evidence-router.js"
import { createAutoBoundEmbedder } from "../../../src/services/embedder.js"
import type { CorpusManifest, QueryKind } from "../corpus/manifest.js"
import { prepareCorpus, type PreparedCorpus } from "../corpus/prepare.js"
import { prepareRepository } from "../corpus/repository.js"
import {
  benchmarkCachePaths,
  loadCachedRankings,
  saveCachedRankings,
  type BenchmarkCachePaths,
  type CachedRankingQuery,
} from "../execution/benchmark-cache.js"
import { withSqliteBenchmarkStore } from "../execution/sqlite-index.js"
import { foldKey } from "./folds.js"
import {
  contextRecallAtBudget,
  goldTargetRanks,
  normalizedDiscountedCumulativeGain,
  recallAt,
  reciprocalRank,
  resolveGoldTargets,
  successAt,
} from "./metrics.js"
import { reportBenchmarkProgress } from "./progress.js"
import { fuseVariant, rankLexicalChannels, RETRIEVAL_VARIANTS } from "./ranking.js"
import type { BenchmarkArtifact, QueryMeasurement } from "./types.js"
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
  readonly rankings: readonly ChannelRankings[]
  readonly retrievalDurationMs: number
}

interface RepositoryMeasurements {
  readonly repository: BenchmarkArtifact["repositories"][number]
  readonly chunkTokens: number
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
  readonly chunkTokens: number
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

export const embedTexts = (
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

export const embedSparseTexts = (
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

export const persistBenchmarkCorpus = (
  store: typeof IndexStore.Service,
  corpus: Pick<PreparedCorpus, "chunks" | "identifierIndex" | "bm25Index">,
  vectors: readonly Float32Array[],
  sparseVectors: readonly SparseVector[],
  dims: number,
  dtype: EmbeddingDtype,
  chunkTokens: number,
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
      chunkTokens,
      embeddingCache: [],
      sparseEmbeddingCache: [],
      sparseContract,
      sparseIdf,
    })
  })

interface BuiltModelSamples {
  readonly measurements: readonly QueryMeasurement[]
  readonly samples: readonly WeightSearchSample[]
  readonly samplesByQueryKind: ReadonlyMap<QueryKind, readonly WeightSearchSample[]>
}

const buildModelSamples = (
  manifest: CorpusManifest,
  corpus: PreparedCorpus,
  queries: readonly BenchmarkQuery[],
  targetsByQuestion: readonly (readonly ReadonlySet<number>[])[],
  groupedFoldAssignments: ReadonlyMap<string, number>,
  model: string,
  rankingsByQuery: readonly ChannelRankings[],
  channelDurations: readonly number[],
): Effect.Effect<BuiltModelSamples, Error> =>
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
      const rankings = rankingsByQuery[queryIndex]
      if (rankings === undefined)
        return yield* Effect.fail(new Error(`No cached rankings for query ${queryIndex}`))
      const sample: WeightSearchSample = {
        repository: manifest.id,
        intentId: question.id,
        queryKind: entry.queryKind,
        groupedFold,
        query: entry.query,
        rankings,
        targets,
        chunks: corpus.chunks,
        termCoverage: buildQueryTermCoverage(entry.query, corpus.bm25Index, corpus.identifierIndex),
      }
      modelSamples.push(sample)
      samplesByQueryKind.set(entry.queryKind, [
        ...(samplesByQueryKind.get(entry.queryKind) ?? []),
        sample,
      ])
      for (const variant of RETRIEVAL_VARIANTS) {
        const variantStartedAt = performance.now()
        const ranked = fuseVariant(variant, entry.query, rankings)
        const queryDurationMs =
          (channelDurations[queryIndex] ?? 0) + performance.now() - variantStartedAt
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
          ndcgAt5: normalizedDiscountedCumulativeGain(ranked, targets, 5),
          ndcgAt10: normalizedDiscountedCumulativeGain(ranked, targets, 10),
          ndcgAt20: normalizedDiscountedCumulativeGain(ranked, targets, 20),
          ndcgAt50: normalizedDiscountedCumulativeGain(ranked, targets, 50),
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
): Effect.Effect<BuiltModelSamples & { readonly rankings: readonly ChannelRankings[] }, Error> =>
  Effect.gen(function* () {
    const rankings: ChannelRankings[] = []
    const channelDurations: number[] = []
    for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
      const entry = queries[queryIndex]
      if (entry === undefined)
        return yield* Effect.fail(new Error(`Missing benchmark query ${queryIndex}`))
      const channelStartedAt = performance.now()
      const lexicalRankings = rankLexicalChannels(entry.query, searchData)
      const dense = yield* store.searchDense({
        vector: queryVectors[queryIndex]!,
        dims,
        dtype,
      })
      const sparse = yield* store.searchSparse(sparseQueries[queryIndex]!)
      rankings.push({ ...lexicalRankings, dense, sparse })
      channelDurations.push(performance.now() - channelStartedAt)
    }
    return {
      ...(yield* buildModelSamples(
        manifest,
        corpus,
        queries,
        targetsByQuestion,
        groupedFoldAssignments,
        model,
        rankings,
        channelDurations,
      )),
      rankings,
    }
  })

const collectModelMeasurements = (
  manifest: CorpusManifest,
  corpus: PreparedCorpus,
  queries: readonly BenchmarkQuery[],
  targetsByQuestion: readonly (readonly ReadonlySet<number>[])[],
  groupedFoldAssignments: ReadonlyMap<string, number>,
  model: string,
  info: (typeof MODEL_REGISTRY)[string] & object,
  chunkTokens: number,
  chunkVectors: readonly Float32Array[],
  queryVectors: readonly Float32Array[],
  cachePaths: BenchmarkCachePaths,
  hasPersistedIndex: boolean,
  cachedRankings?: readonly ChannelRankings[],
): Effect.Effect<ModelMeasurements, Error> =>
  Effect.gen(function* () {
    const retrievalStartedAt = performance.now()
    if (cachedRankings !== undefined) {
      const built = yield* buildModelSamples(
        manifest,
        corpus,
        queries,
        targetsByQuestion,
        groupedFoldAssignments,
        model,
        cachedRankings,
        queries.map(() => 0),
      )
      return {
        ...built,
        rankings: cachedRankings,
        sparseEmbeddingRun: {
          repository: manifest.id,
          model: DEFAULT_CONFIG.sparseEmbedder.model,
          tokenizerModel: DEFAULT_CONFIG.sparseEmbedder.queryModel,
          batchSize: DEFAULT_CONFIG.sparseEmbedder.batchSize,
          chunkEmbeddingDurationMs: 0,
          queryTokenizationDurationMs: 0,
        },
        retrievalDurationMs: performance.now() - retrievalStartedAt,
      }
    }
    const modelRun = yield* withSqliteBenchmarkStore(
      model,
      info.defaultDtype,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const store = yield* IndexStore
        const sparseEmbedder = yield* SparseEmbedder
        let sparseChunkEmbeddingDurationMs = 0
        if (!hasPersistedIndex) {
          const sparseStartedAt = performance.now()
          const sparseVectors = yield* embedSparseTexts(
            corpus.chunks.map((chunk) => chunk.text),
            sparseEmbedder,
          )
          sparseChunkEmbeddingDurationMs = performance.now() - sparseStartedAt
          yield* persistBenchmarkCorpus(
            store,
            corpus,
            chunkVectors,
            sparseVectors,
            info.dims,
            info.defaultDtype,
            chunkTokens,
            sparseEmbedder.contract,
            yield* sparseEmbedder.loadIdf,
          )
        }
        const sparseQueryStartedAt = performance.now()
        const sparseQueries = yield* Effect.forEach(queries, ({ query }) =>
          sparseEmbedder.tokenizeQuery(query),
        )
        const sparseQueryTokenizationDurationMs = performance.now() - sparseQueryStartedAt
        const searchData = yield* store.loadSearchData
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
        yield* saveCachedRankings(sql, cachePaths.cacheKey, queries, collected.rankings)
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
      cachePaths.databasePath,
    )
    return {
      sparseEmbeddingRun: modelRun.sparseEmbeddingRun,
      measurements: modelRun.measurements,
      samples: modelRun.samples,
      samplesByQueryKind: modelRun.samplesByQueryKind,
      rankings: modelRun.rankings,
      retrievalDurationMs: performance.now() - retrievalStartedAt,
    }
  })

interface BenchmarkCacheState {
  readonly rankings: readonly ChannelRankings[] | undefined
  readonly hasPersistedIndex: boolean
}

const inspectBenchmarkCache = (
  model: string,
  dtype: EmbeddingDtype,
  cachePaths: BenchmarkCachePaths,
  queries: readonly CachedRankingQuery[],
  chunkCount: number,
): Effect.Effect<BenchmarkCacheState, Error> =>
  withSqliteBenchmarkStore(
    model,
    dtype,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const store = yield* IndexStore
      const [rankings, status] = yield* Effect.all([
        loadCachedRankings(sql, cachePaths.cacheKey, queries),
        store.getStatus,
      ])
      return {
        rankings,
        hasPersistedIndex: status.chunks === chunkCount && status.files > 0,
      }
    }),
    cachePaths.databasePath,
  )

/** Resolved model registry entry, loaded device embedder, and the effective chunk token budget. */
export interface ResolvedModelContext {
  readonly model: string
  readonly info: (typeof MODEL_REGISTRY)[string] & object
  readonly embedder: BoundEmbedder
  readonly device: string
  readonly maxTokens: number
}

/** Resolve one embedding model against the registry and load it on the first working device. */
export const resolveModelContext = (model: string): Effect.Effect<ResolvedModelContext, Error> =>
  Effect.gen(function* () {
    const info = MODEL_REGISTRY[model]
    if (info === undefined) return yield* Effect.fail(new Error(`Unknown embedding model ${model}`))
    const sparseInfo = SPARSE_MODEL_REGISTRY[DEFAULT_CONFIG.sparseEmbedder.model]
    if (sparseInfo === undefined) {
      return yield* Effect.fail(
        new Error(`Unknown sparse embedding model ${DEFAULT_CONFIG.sparseEmbedder.model}`),
      )
    }
    const bound = yield* createAutoBoundEmbedder({
      model,
      dtype: info.defaultDtype,
      dims: info.dims,
    }).pipe(
      Effect.mapError(
        (cause) => new Error(`Could not auto-select a device for ${model}`, { cause }),
      ),
    )
    const maxTokens = resolveChunkTokenLimit(DEFAULT_CONFIG.chunkTokens, [
      bound.embedder.limits,
      { model: sparseInfo.id, ...sparseInfo },
    ])
    return {
      model,
      info,
      embedder: bound.embedder,
      device: bound.device,
      maxTokens,
    }
  })

const collectRepositoryMeasurements = (
  manifest: CorpusManifest,
  models: readonly string[],
  groupedFoldAssignments: ReadonlyMap<string, number>,
): Effect.Effect<RepositoryMeasurements, Error> =>
  Effect.gen(function* () {
    const repositoryPath = yield* prepareRepository(manifest)
    if (models.length !== 1) {
      return yield* Effect.fail(
        new Error(`Retrieval benchmark requires exactly one model, received ${models.length}`),
      )
    }
    const context = yield* resolveModelContext(models[0]!)
    const { model, info, embedder: boundEmbedder, maxTokens } = context
    const bound = { device: context.device, embedder: boundEmbedder }
    const corpus = yield* prepareCorpus(repositoryPath, manifest, {
      maxTokens,
      overlapLines: DEFAULT_CONFIG.overlapLines,
      countTokens: bound.embedder.countTokens,
      onDiagnostic: () => Effect.void,
    })
    reportBenchmarkProgress(
      `${manifest.id}: prepared ${corpus.chunks.length} chunks on device ${bound.device}; embedding now`,
    )
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

    const cachePaths = benchmarkCachePaths(manifest, model, info.dims, info.defaultDtype, maxTokens)
    const cacheState = yield* inspectBenchmarkCache(
      model,
      info.defaultDtype,
      cachePaths,
      queries.map(({ queryKind, query }) => ({ queryKind, query })),
      corpus.chunks.length,
    )
    let device = "cache"
    let chunkEmbeddingDurationMs = 0
    let queryEmbeddingDurationMs = 0
    let chunkVectors: readonly Float32Array[] = []
    let queryVectors: readonly Float32Array[] = []
    if (cacheState.rankings === undefined) {
      device = bound.device
      if (!cacheState.hasPersistedIndex) {
        const embeddingStartedAt = performance.now()
        chunkVectors = yield* embedTexts(
          corpus.chunks.map((chunk) => chunk.text),
          model,
          bound.embedder,
        )
        chunkEmbeddingDurationMs = performance.now() - embeddingStartedAt
      }
      const queryEmbeddingStartedAt = performance.now()
      queryVectors = yield* embedTexts(
        queries.map((entry) => entry.query),
        model,
        bound.embedder,
      )
      queryEmbeddingDurationMs = performance.now() - queryEmbeddingStartedAt
    }
    const modelData = yield* collectModelMeasurements(
      manifest,
      corpus,
      queries,
      targetsByQuestion,
      groupedFoldAssignments,
      model,
      info,
      maxTokens,
      chunkVectors,
      queryVectors,
      cachePaths,
      cacheState.hasPersistedIndex,
      cacheState.rankings,
    )
    embeddingRuns.push({
      repository: manifest.id,
      model,
      device,
      batchSize: EMBEDDING_BATCH_SIZE,
      chunkEmbeddingDurationMs,
      queryEmbeddingDurationMs,
    })
    sparseEmbeddingRuns.push(modelData.sparseEmbeddingRun)
    measurements.push(...modelData.measurements)
    retrievalDurationMs += modelData.retrievalDurationMs
    samplesByModel.set(model, modelData.samples)
    for (const [queryKind, samples] of modelData.samplesByQueryKind) {
      sampleGroups.set(`${model}\0${queryKind}`, { model, queryKind, samples })
    }
    return {
      repository: {
        id: manifest.id,
        repository: manifest.repository,
        revision: manifest.revision,
        chunks: corpus.chunks.length,
        preparationDurationMs: corpus.preparationDurationMs,
      },
      chunkTokens: maxTokens,
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
    let chunkTokens: number | undefined

    for (const manifest of manifests) {
      reportBenchmarkProgress(
        `preparing repository ${manifest.id} (${manifest.repository}@${manifest.revision}) ` +
          `for ${models.length} model(s)`,
      )
      const repositoryData = yield* collectRepositoryMeasurements(
        manifest,
        models,
        groupedFoldAssignments,
      )
      if (chunkTokens !== undefined && chunkTokens !== repositoryData.chunkTokens) {
        return yield* Effect.fail(
          new Error(
            `Repositories resolved different chunk token budgets: ${chunkTokens} and ${repositoryData.chunkTokens}`,
          ),
        )
      }
      chunkTokens = repositoryData.chunkTokens
      reportBenchmarkProgress(
        `${manifest.id}: done (${repositoryData.measurements.length} measurements)`,
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

    if (chunkTokens === undefined) {
      return yield* Effect.fail(new Error("Retrieval benchmark requires at least one repository"))
    }

    return {
      chunkTokens,
      repositories,
      embeddingRuns,
      sparseEmbeddingRuns,
      measurements,
      sampleGroups,
      samplesByModel,
      retrievalDurationMs,
    }
  })
