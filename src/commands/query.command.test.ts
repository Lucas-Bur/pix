import { Command } from "@effect/cli"
import { Effect, Layer, Ref } from "effect"
import type { MemoryFileSystem } from "effect-memfs"
import { expect, test } from "vite-plus/test"

import { assertCommandError, indexFixtures } from "../../tests/test-utils/command.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { ModelLoadError } from "../domain/errors.js"
import { Embedder } from "../domain/ports.js"
import { queryCommand } from "./query.js"

const run = (args: string[]) => Command.run(queryCommand, { name: "pix", version: "0.0.0" })(args)

test("pix query --json outputs search results", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "test query"])
    const entries = yield* Ref.get(ref)
    expect(entries[0]._tag).toBe("spinner")
    const jsonEntry = entries.find((e) => e._tag === "json")
    expect(jsonEntry).toBeDefined()
    if (jsonEntry?._tag === "json") {
      expect(Array.isArray(jsonEntry.data)).toBe(true)
    }
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})

test("pix query with --top flag clamps to valid range", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--top", "3", "search term"])
    const entries = yield* Ref.get(ref)
    const jsonEntry = entries.find((e) => e._tag === "json")
    expect(jsonEntry).toBeDefined()
    if (jsonEntry?._tag === "json" && Array.isArray(jsonEntry.data)) {
      expect(jsonEntry.data.length).toBeLessThanOrEqual(3)
    }
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})

const failingEmbedderLayer = Layer.succeed(Embedder, {
  embed: () => Effect.fail(new ModelLoadError({ model: "test", message: "embed failed" })),
  batch: () => Effect.fail(new ModelLoadError({ model: "test", message: "batch failed" })),
  getFallbackInfo: () => Effect.succeed(undefined),
})

test("pix query --json with failing embedder produces error JSON", () => {
  const { ref, layer } = silentDisplay()
  return assertCommandError(run(["query", "--json", "test"]), ref).pipe(
    Effect.provide(
      testLayer({
        contents: indexFixtures,
        embedderLayer: failingEmbedderLayer,
        displayLayer: layer,
      }),
    ),
  )
})

test("pix query --json clamps --top below minimum to 1", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--top", "0", "test"])
    const entries = yield* Ref.get(ref)
    expect(
      entries.some(
        (e) => e._tag === "log" && e.severity === "warn" && e.message.includes("clamped"),
      ),
    ).toBe(true)
    const jsonEntry = entries.find((e) => e._tag === "json")
    expect(jsonEntry).toBeDefined()
    if (jsonEntry?._tag === "json" && Array.isArray(jsonEntry.data)) {
      expect(jsonEntry.data.length).toBeLessThanOrEqual(1)
    }
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})

test("pix query --json clamps --top above maximum to 100", () => {
  const largeFixtures: MemoryFileSystem.Contents = {
    ".pix/config.json": JSON.stringify({
      schema: "1",
      embedder: { model: "test-model", device: "auto", dtype: "fp32", batchSize: 16 },
    }),
    ".pix/chunks.jsonl": Array.from({ length: 150 }, (_, i) =>
      JSON.stringify({
        id: `chunk${i}`,
        idx: i,
        file: `/src/file${i}.ts`,
        startLine: 1,
        endLine: 1,
        text: `content ${i}`,
        model: "test-model",
      }),
    ).join("\n"),
    ".pix/vectors.bin": "fake binary content",
  }
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--top", "200", "test"])
    const entries = yield* Ref.get(ref)
    expect(
      entries.some(
        (e) => e._tag === "log" && e.severity === "warn" && e.message.includes("clamped"),
      ),
    ).toBe(true)
    const jsonEntry = entries.find((e) => e._tag === "json")
    expect(jsonEntry).toBeDefined()
    if (jsonEntry?._tag === "json" && Array.isArray(jsonEntry.data)) {
      expect(jsonEntry.data.length).toBeLessThanOrEqual(100)
    }
  }).pipe(Effect.provide(testLayer({ contents: largeFixtures, displayLayer: layer })))
})

test("pix query --json with --context-lines includes context fields", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--context-lines", "2", "test"])
    const entries = yield* Ref.get(ref)
    const jsonEntry = entries.find((e) => e._tag === "json")
    expect(jsonEntry).toBeDefined()
    if (jsonEntry?._tag === "json" && Array.isArray(jsonEntry.data) && jsonEntry.data.length > 0) {
      const first = jsonEntry.data[0] as Record<string, unknown>
      expect(first).toHaveProperty("score")
      expect(first).toHaveProperty("file")
      expect(first).toHaveProperty("startLine")
      expect(first).toHaveProperty("endLine")
      expect(first).toHaveProperty("text")
    }
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})

test("pix query --json on empty index returns empty array", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "no results"])
    const entries = yield* Ref.get(ref)
    expect(entries.some((e) => e._tag === "spinner")).toBe(true)
    const jsonEntry = entries.find((e) => e._tag === "json")
    expect(jsonEntry).toBeDefined()
    if (jsonEntry?._tag === "json") {
      expect(jsonEntry.data).toEqual([])
    }
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix query without --json on empty index shows warning", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "nothing"])
    const entries = yield* Ref.get(ref)
    expect(entries.some((e) => e._tag === "spinner")).toBe(true)
    expect(entries.some((e) => e._tag === "json")).toBe(true)
    expect(entries.some((e) => e._tag === "log" && e.severity === "warn")).toBe(true)
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix query without --json outputs formatted results", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "test"])
    const entries = yield* Ref.get(ref)
    expect(entries.some((e) => e._tag === "spinner")).toBe(true)
    expect(entries.some((e) => e._tag === "json")).toBe(true)
    expect(entries.some((e) => e._tag === "text")).toBe(true)
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})
