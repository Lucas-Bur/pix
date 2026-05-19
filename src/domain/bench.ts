/** Benchmark profile — determines what aspect of performance to optimize for. */
export type BenchProfile = "throughput" | "cold" | "balanced"

/** Single measurement from one benchmark configuration run. */
export interface BenchMeasurement {
  readonly batchSize: number
  readonly durationMs: number
  readonly chunksPerSecond: number
  readonly error?: string
}

/** Input options for the benchmark command, typically from CLI flags. */
export interface BenchOptions {
  readonly warmup: number
  readonly measureBatches: number
  readonly batchSizes: readonly number[]
  readonly timeout: number
  readonly profile: BenchProfile
  readonly json: boolean
}

/** Output of a benchmark run — measurements and a recommendation. */
export interface BenchResult {
  readonly profile: BenchProfile
  readonly warmup: number
  readonly measureBatches: number
  readonly measurements: readonly BenchMeasurement[]
  readonly recommendation: string
}
