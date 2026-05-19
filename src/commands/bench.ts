import { Command, Options } from "@effect/cli"
import { Effect, Either, Option } from "effect"

import { BenchProject } from "../application/bench-project.js"
import type { BenchProfile } from "../domain/bench.js"
import { Display } from "../domain/ports.js"
import { reportError } from "../lib/errors/error-format.js"

const DEFAULT_WARMUP = 5
const DEFAULT_MEASURE_BATCHES = 10
const DEFAULT_BATCH_SIZES = "1,4,8,16,32,64,96,128"
const DEFAULT_TIMEOUT = 60
const DEFAULT_PROFILE: BenchProfile = "balanced"

const parseBatchSizes = (raw: string): Either.Either<number[], string> => {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  if (parts.length === 0) {
    return Either.left("--batch-sizes must not be empty")
  }

  const numbers: number[] = []
  for (const s of parts) {
    const n = parseInt(s, 10)
    if (Number.isNaN(n) || n <= 0) {
      return Either.left(`Invalid batch size "${s}" — must be a positive integer`)
    }
    numbers.push(n)
  }

  return Either.right(numbers)
}

const benchCommand = Command.make(
  "bench",
  {
    warmup: Options.integer("warmup").pipe(Options.withDefault(DEFAULT_WARMUP)),
    measureBatches: Options.integer("measure-batches").pipe(
      Options.withDefault(DEFAULT_MEASURE_BATCHES),
    ),
    batchSizes: Options.text("batch-sizes").pipe(Options.withDefault(DEFAULT_BATCH_SIZES)),
    timeout: Options.integer("timeout").pipe(Options.withDefault(DEFAULT_TIMEOUT)),
    apply: Options.choice("apply", ["throughput", "cold", "balanced"]).pipe(Options.optional),
    json: Options.boolean("json").pipe(Options.withDefault(false)),
  },
  ({ warmup, measureBatches, batchSizes, timeout, apply, json }) =>
    Effect.gen(function* () {
      const d = yield* Display

      const parsedBatchSizes = Either.match(parseBatchSizes(batchSizes), {
        onLeft: (e) => Effect.fail(new Error(e)),
        onRight: Effect.succeed,
      })
      const sizes = yield* parsedBatchSizes

      const profile: BenchProfile = Option.getOrElse(apply, () => DEFAULT_PROFILE)

      const result = yield* BenchProject.bench({
        warmup,
        measureBatches,
        batchSizes: sizes,
        timeout,
        profile,
        json,
      })

      yield* d.json({
        profile: result.profile,
        warmup: result.warmup,
        measureBatches: result.measureBatches,
        measurements: result.measurements,
        recommendation: result.recommendation,
      })

      if (Option.isSome(apply)) {
        yield* BenchProject.applyConfig(result.recommendation).pipe(
          Effect.catchAll((e) => d.log(`Apply failed: ${e.message}`, "warn")),
        )
      }
    }).pipe(Effect.catchAll(reportError)),
)

export { benchCommand }
