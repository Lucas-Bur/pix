import { Schema } from "effect"

/** Benchmark repository size band used for report segmentation. */
const RepositorySizeSchema = Schema.Literals(["small", "medium", "large"])

/** Exact file-qualified symbol expected to be retrieved for one question. */
export const GoldLocationSchema = Schema.Struct({
  file: Schema.String,
  symbol: Schema.String,
})

/** Four representations of the same repository-navigation intent. */
export const QueryFormsSchema = Schema.Struct({
  identifier: Schema.String,
  searchPhrase: Schema.String,
  naturalQuestion: Schema.String,
  agentTask: Schema.String,
})

/** One authored retrieval question and its exact ground-truth locations. */
const BenchmarkQuestionSchema = Schema.Struct({
  id: Schema.String,
  queries: QueryFormsSchema,
  category: Schema.String,
  difficulty: Schema.Literals(["easy", "medium", "hard"]),
  groundTruth: Schema.NonEmptyArray(GoldLocationSchema),
})

/** Versioned manifest for one pinned real-world benchmark repository. */
export const CorpusManifestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  id: Schema.String,
  repository: Schema.String,
  revision: Schema.String,
  language: Schema.String,
  size: RepositorySizeSchema,
  includeRoots: Schema.Array(Schema.String),
  excludePaths: Schema.Array(Schema.String),
  extensions: Schema.Array(Schema.String),
  questions: Schema.Array(BenchmarkQuestionSchema),
})

/** Decoded benchmark corpus manifest. */
export type CorpusManifest = typeof CorpusManifestSchema.Type

/** Decoded exact ground-truth location. */
export type GoldLocation = typeof GoldLocationSchema.Type

/** Query representation categories evaluated independently. */
export type QueryKind = keyof typeof QueryFormsSchema.Type
