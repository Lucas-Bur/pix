import { expect, it } from "@effect/vitest"
import { Effect, Ref } from "effect"

import { runCommand } from "../../tests/test-utils/command.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import type { DisplayEntry } from "../display/entries.js"
import { benchCommand } from "./bench.js"

const run = runCommand(benchCommand)

const assertJsonData = (
  entries: Ref.Ref<ReadonlyArray<DisplayEntry>>,
): Effect.Effect<Record<string, unknown>> =>
  Effect.gen(function* () {
    const list = yield* Ref.get(entries)
    const jsonEntry = list.find((entry) => entry._tag === "json")
    expect(jsonEntry).toBeDefined()
    if (jsonEntry?._tag === "json") {
      return jsonEntry.data as Record<string, unknown>
    }
    return {} as Record<string, unknown>
  })

it.effect("pix bench --json outputs parsed options as JSON", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["bench", "--json"])
    const data = yield* assertJsonData(ref)
    expect(data.profile).toBe("balanced")
    expect(data.warmup).toBe(5)
    expect(data.measureBatches).toBe(10)
    expect(Array.isArray(data.measurements)).toBe(true)
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

it.effect("pix bench without --json logs human-readable output", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["bench"])
    const entries = yield* Ref.get(ref)
    const logEntries = entries.filter((e) => e._tag === "log")
    expect(logEntries.length).toBeGreaterThan(0)
    const jsonEntries = entries.filter((e) => e._tag === "json")
    expect(jsonEntries).toHaveLength(1)
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

it.effect("pix bench --warmup 3 --measure-batches 5 parses custom values", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["bench", "--json", "--warmup", "3", "--measure-batches", "5"])
    const data = yield* assertJsonData(ref)
    expect(data.warmup).toBe(3)
    expect(data.measureBatches).toBe(5)
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

it.effect("pix bench accepts repeated --batch-size values", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["bench", "--json", "--batch-size", "2", "--batch-size", "4"])
    const data = yield* assertJsonData(ref)
    expect(data.batchSizes).toEqual([2, 4])
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

it.effect("pix bench accepts repeated --sparse-batch-size values", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["bench", "--json", "--sparse-batch-size", "1", "--sparse-batch-size", "2"])
    const data = yield* assertJsonData(ref)
    expect(data.sparseBatchSizes).toEqual([1, 2])
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

it.effect("pix bench accepts repeated typed --device values", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["bench", "--json", "--device", "dml", "--device", "cpu"])
    const data = yield* assertJsonData(ref)
    expect(data.devices).toEqual(["dml", "cpu"])
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

it.effect("pix bench --profile throughput sets profile", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["bench", "--json", "--profile", "throughput"])
    const data = yield* assertJsonData(ref)
    expect(data.profile).toBe("throughput")
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

it.effect("pix bench --profile cold sets profile", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["bench", "--json", "--profile", "cold"])
    const data = yield* assertJsonData(ref)
    expect(data.profile).toBe("cold")
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

it.effect("pix bench --timeout 30 parses timeout", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["bench", "--json", "--timeout", "30"])
    const data = yield* assertJsonData(ref)
    expect(data.timeout).toBe(30)
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

it.effect("pix bench rejects invalid measurement counts and timeout", () =>
  Effect.gen(function* () {
    const invalidArgs = [
      ["bench", "--warmup", "-1"],
      ["bench", "--measure-batches", "0"],
      ["bench", "--batch-size", "0"],
      ["bench", "--sparse-batch-size", "0"],
      ["bench", "--device", "invalid"],
      ["bench", "--timeout", "0"],
    ]

    for (const args of invalidArgs) {
      const exit = yield* Effect.exit(run(args))
      expect(exit._tag).toBe("Failure")
    }
  }).pipe(Effect.provide(testLayer({}))),
)

it.effect("pix bench --profile throughput --apply applies config and logs success", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["bench", "--profile", "throughput", "--apply"])
    const entries = yield* Ref.get(ref)
    const logEntries = entries.filter((e) => e._tag === "log")
    const appliedEntry = logEntries.find((e) => e.message.includes("Applied"))
    expect(appliedEntry).toBeDefined()
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

it.effect("pix bench --profile cold --apply applies config", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["bench", "--profile", "cold", "--apply"])
    const entries = yield* Ref.get(ref)
    const logEntries = entries.filter((e) => e._tag === "log")
    const appliedEntry = logEntries.find((e) => e.message.includes("Applied"))
    expect(appliedEntry).toBeDefined()
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

it.effect("pix bench without --profile (balanced default) does not apply config", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["bench"])
    const entries = yield* Ref.get(ref)
    const logEntries = entries.filter((e) => e._tag === "log")
    const appliedEntry = logEntries.find((e) => e.message.includes("Applied"))
    expect(appliedEntry).toBeUndefined()
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})
