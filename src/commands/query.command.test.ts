import { Command } from "@effect/cli"
import { Effect, Layer, Ref } from "effect"
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
    expect(entries).toHaveLength(1)
    expect(entries[0]._tag).toBe("json")
    if (entries[0]._tag === "json") {
      expect(Array.isArray(entries[0].data)).toBe(true)
    }
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})

test("pix query with --top flag clamps to valid range", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--top", "3", "search term"])
    const entries = yield* Ref.get(ref)
    expect(entries).toHaveLength(1)
    if (entries[0]._tag === "json" && Array.isArray(entries[0].data)) {
      expect(entries[0].data.length).toBeLessThanOrEqual(3)
    }
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})

const failingEmbedderLayer = Layer.succeed(Embedder, {
  embed: () => Effect.fail(new ModelLoadError({ model: "test", message: "embed failed" })),
  batch: () => Effect.fail(new ModelLoadError({ model: "test", message: "batch failed" })),
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
    expect(entries).toHaveLength(1)
    if (entries[0]._tag === "json" && Array.isArray(entries[0].data)) {
      expect(entries[0].data.length).toBeLessThanOrEqual(1)
    }
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})

test("pix query --json clamps --top above maximum to 100", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--top", "200", "test"])
    const entries = yield* Ref.get(ref)
    expect(entries).toHaveLength(1)
    if (entries[0]._tag === "json" && Array.isArray(entries[0].data)) {
      expect(entries[0].data.length).toBeLessThanOrEqual(2)
    }
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})

test("pix query --json with --context-lines includes context fields", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--context-lines", "2", "test"])
    const entries = yield* Ref.get(ref)
    expect(entries).toHaveLength(1)
    if (
      entries[0]._tag === "json" &&
      Array.isArray(entries[0].data) &&
      entries[0].data.length > 0
    ) {
      const first = entries[0].data[0] as Record<string, unknown>
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
    expect(entries).toHaveLength(1)
    if (entries[0]._tag === "json") {
      expect(entries[0].data).toEqual([])
    }
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix query without --json on empty index shows warning", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "nothing"])
    const entries = yield* Ref.get(ref)
    expect(entries[0]._tag).toBe("json")
    expect(entries.some((e) => e._tag === "log" && e.severity === "warn")).toBe(true)
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix query without --json outputs formatted results", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "test"])
    const entries = yield* Ref.get(ref)
    expect(entries[0]._tag).toBe("json")
    expect(entries.some((e) => e._tag === "text")).toBe(true)
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})
