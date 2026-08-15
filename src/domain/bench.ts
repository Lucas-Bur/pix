import { Schema } from "effect"

import type { Chunk } from "./chunk.js"
import type { DeviceType } from "./device.js"

/** Supported benchmark optimization profiles. */
export const BENCH_PROFILES = ["throughput", "cold", "balanced"] as const

const BenchProfileSchema = Schema.Literals(BENCH_PROFILES)

/** Benchmark profile — determines what aspect of performance to optimize for. */
export type BenchProfile = typeof BenchProfileSchema.Type

/** Status of a single benchmark measurement. */
export type BenchStatus = "ok" | "failed" | "timeout"

/** Single measurement from one benchmark configuration run. */
export interface BenchMeasurement {
  readonly device: DeviceType
  readonly batchSize: number
  readonly coldLatencyMs: number
  readonly warmChunksPerSec: number
  readonly warmLatencyPerBatchMs: number
  readonly totalDurationMs: number
  readonly status: BenchStatus
  readonly error: string | null
}

/** Input options for the benchmark command, typically from CLI flags. */
export interface BenchOptions {
  readonly warmup: number
  readonly measureBatches: number
  readonly batchSizes: readonly number[]
  /** Sparse batch sizes; omitted values reuse the Dense candidates for API compatibility. */
  readonly sparseBatchSizes?: readonly number[]
  /** Explicit devices to benchmark; omitted means probe the normal device priority. */
  readonly devices?: readonly DeviceType[]
  readonly timeout: number
  readonly profile: BenchProfile
}

/** Prepared corpus held in memory for the measurement pipeline. */
export interface Corpus {
  readonly chunks: readonly Chunk[]
  readonly fileCount: number
  readonly chunkCount: number
}

/** Structured recommendation from a benchmark run. */
export interface BenchRecommendation {
  readonly device: DeviceType
  readonly batchSize: number
  readonly profile: BenchProfile
}

/** Output of a benchmark run — measurements and a recommendation. */
export interface BenchResult {
  readonly profile: BenchProfile
  readonly warmup: number
  readonly measureBatches: number
  readonly measurements: readonly BenchMeasurement[]
  readonly sparseMeasurements: readonly BenchMeasurement[]
  readonly recommendation: BenchRecommendation
  readonly sparseRecommendation: BenchRecommendation
}
