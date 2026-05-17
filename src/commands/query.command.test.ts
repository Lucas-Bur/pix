import { Effect, Ref } from "effect"
import type { MemoryFileSystem } from "effect-memfs"
import { expect, test } from "vite-plus/test"

import {
  assertCommandError,
  expectJsonEntry,
  expectLogEntry,
  indexFixtures,
  makeFailingEmbedder,
  runCommand,
} from "../../tests/test-utils/command.js"
import { makeChunkJson, TEST_CONFIG_JSON } from "../../tests/test-utils/fixtures.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { queryCommand } from "./query.js"

const run = runCommand(queryCommand)

test("pix query --json outputs search results", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "test query"])
    const entries = yield* Ref.get(ref)
    expect(entries[0]._tag).toBe("spinner")
    yield* expectJsonEntry(ref, (data) => {
      expect(Array.isArray(data)).toBe(true)
    })
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})

test("pix query with --top flag clamps to valid range", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--top", "3", "search term"])
    yield* expectJsonEntry(ref, (data) => {
      expect(Array.isArray(data)).toBe(true)
      if (Array.isArray(data)) {
        expect(data.length).toBeLessThanOrEqual(3)
      }
    })
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})

test("pix query --json with failing embedder produces error JSON", () => {
  const { ref, layer } = silentDisplay()
  return assertCommandError(run(["query", "--json", "test"]), ref).pipe(
    Effect.provide(
      testLayer({
        contents: indexFixtures,
        embedderLayer: makeFailingEmbedder("embed"),
        displayLayer: layer,
      }),
    ),
  )
})

test("pix query --json clamps --top below minimum to 1", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--top", "0", "test"])
    yield* expectLogEntry(ref, { severity: "warn", messageIncludes: "clamped" })
    yield* expectJsonEntry(ref, (data) => {
      expect(Array.isArray(data)).toBe(true)
      if (Array.isArray(data)) {
        expect(data.length).toBeLessThanOrEqual(1)
      }
    })
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})

test("pix query --json clamps --top above maximum to 100", () => {
  const largeFixtures: MemoryFileSystem.Contents = {
    ".pix/config.json": TEST_CONFIG_JSON,
    ".pix/chunks.jsonl": Array.from({ length: 150 }, (_, i) =>
      makeChunkJson({
        id: `chunk${i}`,
        idx: i,
        file: `/src/file${i}.ts`,
        startLine: 1,
        endLine: 1,
        text: `content ${i}`,
      }),
    ).join("\n"),
    ".pix/vectors.bin": "fake binary content",
  }
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--top", "200", "test"])
    yield* expectLogEntry(ref, { severity: "warn", messageIncludes: "clamped" })
    yield* expectJsonEntry(ref, (data) => {
      expect(Array.isArray(data)).toBe(true)
      if (Array.isArray(data)) {
        expect(data.length).toBeLessThanOrEqual(100)
      }
    })
  }).pipe(Effect.provide(testLayer({ contents: largeFixtures, displayLayer: layer })))
})

test("pix query --json with --context-lines includes context fields", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--context-lines", "2", "test"])
    yield* expectJsonEntry(ref, (data) => {
      expect(Array.isArray(data)).toBe(true)
      if (Array.isArray(data) && data.length > 0) {
        const [first] = data
        expect(first).toHaveProperty("score")
        expect(first).toHaveProperty("file")
        expect(first).toHaveProperty("startLine")
        expect(first).toHaveProperty("endLine")
        expect(first).toHaveProperty("text")
      }
    })
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})

test("pix query --json on empty index returns empty array", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "no results"])
    const entries = yield* Ref.get(ref)
    expect(entries.some((e) => e._tag === "spinner")).toBe(true)
    yield* expectJsonEntry(ref, (data) => {
      expect(data).toEqual([])
    })
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

test("pix query --json with --ignore-path excludes matching files", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--ignore-path", "**/*.ts", "test"])
    const entries = yield* Ref.get(ref)
    const jsonEntry = entries.find((e) => e._tag === "json")
    expect(jsonEntry).toBeDefined()
    if (jsonEntry?._tag === "json") {
      expect(Array.isArray(jsonEntry.data)).toBe(true)
      if (Array.isArray(jsonEntry.data)) {
        const files = jsonEntry.data.map((r: { file: string }) => r.file)
        expect(files.every((f: string) => !f.endsWith(".ts"))).toBe(true)
      }
    }
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})

test("pix query --json with --only-path restricts to matching files", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--only-path", "src/services/**", "test"])
    const entries = yield* Ref.get(ref)
    const jsonEntry = entries.find((e) => e._tag === "json")
    expect(jsonEntry).toBeDefined()
    if (jsonEntry?._tag === "json") {
      expect(Array.isArray(jsonEntry.data)).toBe(true)
      if (Array.isArray(jsonEntry.data)) {
        const files = jsonEntry.data.map((r: { file: string }) => r.file)
        expect(files.every((f: string) => f.startsWith("src/services/"))).toBe(true)
      }
    }
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})

test("pix query --json with multiple --ignore-path flags", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--ignore-path", "**/*.ts", "--ignore-path", "**/*.js", "test"])
    const entries = yield* Ref.get(ref)
    const jsonEntry = entries.find((e) => e._tag === "json")
    expect(jsonEntry).toBeDefined()
    if (jsonEntry?._tag === "json") {
      expect(Array.isArray(jsonEntry.data)).toBe(true)
      if (Array.isArray(jsonEntry.data)) {
        const files = jsonEntry.data.map((r: { file: string }) => r.file)
        expect(files.every((f: string) => !f.endsWith(".ts") && !f.endsWith(".js"))).toBe(true)
      }
    }
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})
