import { Effect, Option, Result } from "effect"
import { Command, Flag } from "effect/unstable/cli"

import { BenchProject } from "../application/bench-project.js"
import type { BenchProfile } from "../domain/bench.js"
import { Display } from "../domain/ports.js"
import { reportError } from "../lib/errors/error-format.js"

const DEFAULT_WARMUP = 5
const DEFAULT_MEASURE_BATCHES = 10
const DEFAULT_BATCH_SIZES = "1,4,8,16,32,64,96,128"
const DEFAULT_TIMEOUT = 60
const DEFAULT_PROFILE: BenchProfile = "balanced"

const parseBatchSizes = (raw: string): Result.Result<number[], string> => {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  if (parts.length === 0) {
    return Result.fail("--batch-sizes must not be empty")
  }

  const numbers: number[] = []
  for (const s of parts) {
    if (!/^\d+$/.test(s)) {
      return Result.fail(`Invalid batch size "${s}" — must be a positive integer`)
    }
    const n = parseInt(s, 10)
    if (n <= 0) {
      return Result.fail(`Invalid batch size "${s}" — must be a positive integer`)
    }
    numbers.push(n)
  }

  return Result.succeed(numbers)
}

const benchCommand = Command.make(
  "bench",
  {
    warmup: Flag.integer("warmup").pipe(Flag.withDefault(DEFAULT_WARMUP)),
    measureBatches: Flag.integer("measure-batches").pipe(Flag.withDefault(DEFAULT_MEASURE_BATCHES)),
    batchSizes: Flag.string("batch-sizes").pipe(Flag.withDefault(DEFAULT_BATCH_SIZES)),
    timeout: Flag.integer("timeout").pipe(Flag.withDefault(DEFAULT_TIMEOUT)),
    profile: Flag.choice("profile", ["throughput", "cold", "balanced"]).pipe(
      Flag.withDefault(DEFAULT_PROFILE),
    ),
    apply: Flag.choice("apply", ["throughput", "cold", "balanced"]).pipe(Flag.optional),
    json: Flag.boolean("json").pipe(Flag.withDefault(false)),
  },
  ({ warmup, measureBatches, batchSizes, timeout, profile, apply }) =>
    Effect.gen(function* () {
      const d = yield* Display

      const parsedBatchSizes = Result.match(parseBatchSizes(batchSizes), {
        onFailure: (e) => Effect.fail(new Error(e)),
        onSuccess: Effect.succeed,
      })
      const sizes = yield* parsedBatchSizes

      const benchService = yield* BenchProject

      const result = yield* benchService.bench({
        warmup,
        measureBatches,
        batchSizes: sizes,
        timeout,
        profile,
      })

      yield* d.json({
        profile: result.profile,
        warmup: result.warmup,
        measureBatches: result.measureBatches,
        batchSizes: sizes,
        timeout,
        measurements: result.measurements,
        recommendation: result.recommendation,
      })

      if (Option.isSome(apply)) {
        yield* benchService
          .applyConfig({ ...result.recommendation, profile: apply.value })
          .pipe(Effect.catch((e) => d.log(`Apply failed: ${(e as Error).message}`, "warn")))
      }
    }).pipe(Effect.catch(reportError)),
)

export { benchCommand }
