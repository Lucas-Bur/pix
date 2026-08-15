import { Effect } from "effect"
import { Command, Flag } from "effect/unstable/cli"

import { BenchProject } from "../application/bench-project.js"
import { BENCH_PROFILES, type BenchProfile } from "../domain/bench.js"
import { DEVICE_PRIORITY } from "../domain/device.js"
import { NonNegativeIntSchema, PositiveIntSchema } from "../domain/numeric.js"
import { Display } from "../domain/ports.js"
import { reportError } from "../lib/errors/error-format.js"

const DEFAULT_WARMUP = 5
const DEFAULT_MEASURE_BATCHES = 10
const DEFAULT_BATCH_SIZES = [1, 4, 8, 16, 32, 64, 96, 128] as const
const DEFAULT_SPARSE_BATCH_SIZES = [1, 2, 4, 8] as const
const DEFAULT_TIMEOUT = 60
const DEFAULT_PROFILE: BenchProfile = "balanced"

const benchCommandConfig = {
  warmup: Flag.integer("warmup").pipe(
    Flag.withSchema(NonNegativeIntSchema),
    Flag.withMetavar("COUNT"),
    Flag.withDescription("Warmup batches per benchmark candidate (default: 5)"),
    Flag.withDefault(DEFAULT_WARMUP),
  ),
  measureBatches: Flag.integer("measure-batches").pipe(
    Flag.withSchema(PositiveIntSchema),
    Flag.withMetavar("COUNT"),
    Flag.withDescription("Measured batches per benchmark candidate (default: 10)"),
    Flag.withDefault(DEFAULT_MEASURE_BATCHES),
  ),
  batchSize: Flag.integer("batch-size").pipe(
    Flag.withSchema(PositiveIntSchema),
    Flag.withMetavar("COUNT"),
    Flag.withDescription("Dense batch candidate; may be repeated (default: 1,4,8,16,32,64,96,128)"),
    Flag.atLeast(0),
  ),
  sparseBatchSize: Flag.integer("sparse-batch-size").pipe(
    Flag.withSchema(PositiveIntSchema),
    Flag.withMetavar("COUNT"),
    Flag.withDescription("Sparse batch candidate; may be repeated (default: 1,2,4,8)"),
    Flag.atLeast(0),
  ),
  device: Flag.choice("device", DEVICE_PRIORITY).pipe(
    Flag.withMetavar("DEVICE"),
    Flag.withDescription("Compute device to benchmark; may be repeated (default: all available)"),
    Flag.atLeast(0),
  ),
  timeout: Flag.integer("timeout").pipe(
    Flag.withSchema(PositiveIntSchema),
    Flag.withMetavar("SECONDS"),
    Flag.withDescription("Timeout per benchmark measurement in seconds (default: 60)"),
    Flag.withDefault(DEFAULT_TIMEOUT),
  ),
  profile: Flag.choice("profile", BENCH_PROFILES).pipe(
    Flag.withAlias("p"),
    Flag.withMetavar("PROFILE"),
    Flag.withDescription("Optimization objective (default: balanced)"),
    Flag.withDefault(DEFAULT_PROFILE),
  ),
  apply: Flag.boolean("apply").pipe(
    Flag.withDescription("Write the recommendation for --profile to .pix/config.json"),
  ),
}

const benchCommand = Command.make(
  "bench",
  benchCommandConfig,
  ({ warmup, measureBatches, batchSize, sparseBatchSize, device, timeout, profile, apply }) =>
    Effect.gen(function* () {
      const d = yield* Display
      const denseCandidates = batchSize.length > 0 ? batchSize : DEFAULT_BATCH_SIZES
      const sparseCandidates =
        sparseBatchSize.length > 0 ? sparseBatchSize : DEFAULT_SPARSE_BATCH_SIZES
      const selectedDevices = device.length > 0 ? device : undefined

      const benchService = yield* BenchProject

      const result = yield* benchService.bench({
        warmup,
        measureBatches,
        batchSizes: denseCandidates,
        sparseBatchSizes: sparseCandidates,
        devices: selectedDevices,
        timeout,
        profile,
      })

      yield* d.json({
        profile: result.profile,
        warmup: result.warmup,
        measureBatches: result.measureBatches,
        batchSizes: denseCandidates,
        sparseBatchSizes: sparseCandidates,
        devices: selectedDevices ?? DEVICE_PRIORITY,
        timeout,
        measurements: result.measurements,
        sparseMeasurements: result.sparseMeasurements,
        recommendation: result.recommendation,
        sparseRecommendation: result.sparseRecommendation,
      })

      if (apply) {
        yield* benchService
          .applyConfig(result.recommendation, result.sparseRecommendation)
          .pipe(Effect.catch((e) => d.log(`Apply failed: ${(e as Error).message}`, "warn")))
      }
    }).pipe(Effect.catch(reportError)),
).pipe(
  Command.withDescription(
    "Measure Dense and Sparse embedding performance and recommend device-specific batch sizes",
  ),
  Command.withShortDescription("Benchmark embedding devices and batch sizes"),
  Command.withExamples([
    {
      command: "pix bench --device dml --device cpu --profile throughput",
      description: "Compare selected devices for throughput",
    },
    {
      command: "pix bench --profile balanced --apply",
      description: "Benchmark and write the balanced recommendation",
    },
  ]),
)

export { benchCommand }
