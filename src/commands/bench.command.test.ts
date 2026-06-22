import { Effect, Ref } from "effect"
import { expect, test } from "vite-plus/test"

import { runCommand } from "../../tests/test-utils/command.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { benchCommand } from "./bench.js"

const run = runCommand(benchCommand)

const assertJsonData = (entries: Ref.Ref<readonly any[]>): Effect.Effect<Record<string, unknown>> =>
  Effect.gen(function* () {
    const list = yield* Ref.get(entries)
    expect(list[0]._tag).toBe("json")
    if (list[0]._tag === "json") {
      return list[0].data as Record<string, unknown>
    }
    return {} as Record<string, unknown>
  })

test("pix bench --json outputs parsed options as JSON", () => {
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

test("pix bench without --json logs human-readable output", () => {
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

test("pix bench --warmup 3 --measure-batches 5 parses custom values", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["bench", "--json", "--warmup", "3", "--measure-batches", "5"])
    const data = yield* assertJsonData(ref)
    expect(data.warmup).toBe(3)
    expect(data.measureBatches).toBe(5)
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix bench --batch-sizes parses comma-separated values", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["bench", "--json", "--batch-sizes", "2,4,8"])
    const data = yield* assertJsonData(ref)
    expect(data.batchSizes).toEqual([2, 4, 8])
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix bench --apply throughput sets profile", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["bench", "--json", "--apply", "throughput"])
    const data = yield* assertJsonData(ref)
    expect(data.profile).toBe("throughput")
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix bench --apply cold sets profile", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["bench", "--json", "--apply", "cold"])
    const data = yield* assertJsonData(ref)
    expect(data.profile).toBe("cold")
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix bench --timeout 30 parses timeout", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["bench", "--json", "--timeout", "30"])
    const data = yield* assertJsonData(ref)
    expect(data.timeout).toBe(30)
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix bench --batch-sizes with invalid input fails", () => {
  const { ref: _, layer } = silentDisplay()
  return Effect.gen(function* () {
    const exit = yield* Effect.exit(run(["bench", "--json", "--batch-sizes", "abc,def"]))
    expect(exit._tag).toBe("Failure")
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix bench --batch-sizes with negative numbers fails", () => {
  const { ref: _, layer } = silentDisplay()
  return Effect.gen(function* () {
    const exit = yield* Effect.exit(run(["bench", "--json", "--batch-sizes", "1,-2,3"]))
    expect(exit._tag).toBe("Failure")
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix bench --apply throughput applies config and logs success", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["bench", "--apply", "throughput"])
    const entries = yield* Ref.get(ref)
    const logEntries = entries.filter((e) => e._tag === "log")
    const appliedEntry = logEntries.find((e) => e.message.includes("Applied"))
    expect(appliedEntry).toBeDefined()
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix bench --apply cold applies config", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["bench", "--apply", "cold"])
    const entries = yield* Ref.get(ref)
    const logEntries = entries.filter((e) => e._tag === "log")
    const appliedEntry = logEntries.find((e) => e.message.includes("Applied"))
    expect(appliedEntry).toBeDefined()
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix bench without --apply (balanced default) does not apply config", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["bench"])
    const entries = yield* Ref.get(ref)
    const logEntries = entries.filter((e) => e._tag === "log")
    const appliedEntry = logEntries.find((e) => e.message.includes("Applied"))
    expect(appliedEntry).toBeUndefined()
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})
