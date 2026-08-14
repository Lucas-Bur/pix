import { Effect, Option, Result } from "effect"
import { Command, Flag } from "effect/unstable/cli"

import { BenchProject } from "../application/bench-project.js"
import type { BenchProfile } from "../domain/bench.js"
import { DEVICE_PRIORITY, type DeviceType } from "../domain/device.js"
import { Display } from "../domain/ports.js"
import { reportError } from "../lib/errors/error-format.js"

const DEFAULT_WARMUP = 5
const DEFAULT_MEASURE_BATCHES = 10
const DEFAULT_BATCH_SIZES = "1,4,8,16,32,64,96,128"
const DEFAULT_SPARSE_BATCH_SIZES = "1,2,4,8"
const DEFAULT_DEVICES = "all"
const DEFAULT_TIMEOUT = 60
const DEFAULT_PROFILE: BenchProfile = "balanced"

const parseBatchSizes = (raw: string, flag = "--batch-sizes"): Result.Result<number[], string> => {
  const label = flag === "--batch-sizes" ? "" : ` for ${flag}`
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  if (parts.length === 0) {
    return Result.fail(`${flag} must not be empty`)
  }

  const numbers: number[] = []
  for (const s of parts) {
    if (!/^\d+$/.test(s)) {
      return Result.fail(`Invalid batch size "${s}"${label} — must be a positive integer`)
    }
    const n = parseInt(s, 10)
    if (n <= 0) {
      return Result.fail(`Invalid batch size "${s}"${label} — must be a positive integer`)
    }
    numbers.push(n)
  }

  return Result.succeed(numbers)
}

const parseDevices = (raw: string): Result.Result<readonly DeviceType[] | undefined, string> => {
  if (raw.trim().toLowerCase() === "all") return Result.succeed(undefined)

  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
  if (parts.length === 0) return Result.fail("--devices must not be empty")

  const devices: DeviceType[] = []
  for (const part of parts) {
    const device = DEVICE_PRIORITY.find((candidate) => candidate === part)
    if (device === undefined) {
      return Result.fail(`Invalid device "${part}" — choose from ${DEVICE_PRIORITY.join(", ")}`)
    }
    if (!devices.includes(device)) devices.push(device)
  }
  return Result.succeed(devices)
}

const benchCommand = Command.make(
  "bench",
  {
    warmup: Flag.integer("warmup").pipe(Flag.withDefault(DEFAULT_WARMUP)),
    measureBatches: Flag.integer("measure-batches").pipe(Flag.withDefault(DEFAULT_MEASURE_BATCHES)),
    batchSizes: Flag.string("batch-sizes").pipe(Flag.withDefault(DEFAULT_BATCH_SIZES)),
    sparseBatchSizes: Flag.string("sparse-batch-sizes").pipe(
      Flag.withDefault(DEFAULT_SPARSE_BATCH_SIZES),
    ),
    devices: Flag.string("devices").pipe(Flag.withDefault(DEFAULT_DEVICES)),
    timeout: Flag.integer("timeout").pipe(Flag.withDefault(DEFAULT_TIMEOUT)),
    profile: Flag.choice("profile", ["throughput", "cold", "balanced"]).pipe(
      Flag.withDefault(DEFAULT_PROFILE),
    ),
    apply: Flag.choice("apply", ["throughput", "cold", "balanced"]).pipe(Flag.optional),
  },
  ({ warmup, measureBatches, batchSizes, sparseBatchSizes, devices, timeout, profile, apply }) =>
    Effect.gen(function* () {
      const d = yield* Display

      const parsedBatchSizes = Result.match(parseBatchSizes(batchSizes), {
        onFailure: Effect.fail,
        onSuccess: Effect.succeed,
      })
      const sizes = yield* parsedBatchSizes
      const parsedSparseBatchSizes = Result.match(
        parseBatchSizes(sparseBatchSizes, "--sparse-batch-sizes"),
        {
          onFailure: Effect.fail,
          onSuccess: Effect.succeed,
        },
      )
      const sparseSizes = yield* parsedSparseBatchSizes
      const selectedDevices = yield* Result.match(parseDevices(devices), {
        onFailure: Effect.fail,
        onSuccess: Effect.succeed,
      })

      const benchService = yield* BenchProject

      const result = yield* benchService.bench({
        warmup,
        measureBatches,
        batchSizes: sizes,
        sparseBatchSizes: sparseSizes,
        devices: selectedDevices,
        timeout,
        profile,
      })

      yield* d.json({
        profile: result.profile,
        warmup: result.warmup,
        measureBatches: result.measureBatches,
        batchSizes: sizes,
        sparseBatchSizes: sparseSizes,
        devices: selectedDevices ?? DEVICE_PRIORITY,
        timeout,
        measurements: result.measurements,
        sparseMeasurements: result.sparseMeasurements,
        recommendation: result.recommendation,
        sparseRecommendation: result.sparseRecommendation,
      })

      if (Option.isSome(apply)) {
        yield* benchService
          .applyConfig(
            { ...result.recommendation, profile: apply.value },
            { ...result.sparseRecommendation, profile: apply.value },
          )
          .pipe(Effect.catch((e) => d.log(`Apply failed: ${(e as Error).message}`, "warn")))
      }
    }).pipe(Effect.catch(reportError)),
)

export { benchCommand }
