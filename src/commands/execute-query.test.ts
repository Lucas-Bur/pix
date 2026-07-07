import type { FileTree } from "@lucas-bur/effect-memfs"
import { Effect, Ref } from "effect"
import { expect, test } from "vite-plus/test"

import { testClipboard } from "../../tests/test-utils/clipboard.js"
import {
  expectJsonEntry,
  expectLogEntry,
  indexFixtures,
  runCommand,
} from "../../tests/test-utils/command.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { queryCommand } from "./query.js"

const run = runCommand(queryCommand)

test("executeQuery clamps topK above maximum to 100", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--top", "200", "test"]).pipe(
      Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })),
    )
    yield* expectLogEntry(ref, { severity: "warn", messageIncludes: "clamped" })
    yield* expectJsonEntry(ref, (data) => {
      expect(Array.isArray(data)).toBe(true)
    })
  })
})

test("executeQuery clamps topK below minimum to 1", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--top", "0", "test"]).pipe(
      Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })),
    )
    yield* expectLogEntry(ref, { severity: "warn", messageIncludes: "clamped" })
    yield* expectJsonEntry(ref, (data) => {
      expect(Array.isArray(data)).toBe(true)
      if (Array.isArray(data)) {
        expect(data.length).toBeLessThanOrEqual(1)
      }
    })
  })
})

test("executeQuery --copy writes to clipboard when results exist", () => {
  const { ref: displayRef, layer: displayLayer } = silentDisplay()
  const { ref: clipboardRef, layer: clipboardLayer } = testClipboard()
  return Effect.gen(function* () {
    yield* run(["query", "--copy", "--top", "1", "test"]).pipe(
      Effect.provide(testLayer({ contents: indexFixtures, displayLayer, clipboardLayer })),
    )
    const copied = yield* Ref.get(clipboardRef)
    expect(copied).toContain("#1")
    yield* expectLogEntry(displayRef, { severity: "success", messageIncludes: "Copied" })
  })
})

test("executeQuery --copy does not copy when no results exist", () => {
  const { ref: displayRef, layer: displayLayer } = silentDisplay()
  const { ref: clipboardRef, layer: clipboardLayer } = testClipboard()
  return Effect.gen(function* () {
    yield* run(["query", "--copy", "--top", "1", "no matches at all"]).pipe(
      Effect.provide(testLayer({ contents: {}, displayLayer, clipboardLayer })),
    )
    const copied = yield* Ref.get(clipboardRef)
    expect(copied).toEqual("")
    const entries = yield* Ref.get(displayRef)
    const hasCopyLog = entries.some(
      (e) => e._tag === "log" && e.severity === "success" && e.message.includes("Copied"),
    )
    expect(hasCopyLog).toBe(false)
  })
})

test("executeQuery --no-content strips text from results", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--no-content", "--top", "1", "test"]).pipe(
      Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })),
    )
    yield* expectJsonEntry(ref, (data) => {
      expect(Array.isArray(data)).toBe(true)
      if (Array.isArray(data) && data.length > 0) {
        expect(data[0]).not.toHaveProperty("text")
      }
    })
  })
})

test("executeQuery --max-characters truncates result text", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--max-characters", "5", "--top", "1", "test"]).pipe(
      Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })),
    )
    yield* expectJsonEntry(ref, (data) => {
      expect(Array.isArray(data)).toBe(true)
      if (Array.isArray(data) && data.length > 0) {
        const text = data[0].text as string
        expect(text.length).toBeLessThanOrEqual(5 + 3)
      }
    })
  })
})

const largeFixtures: FileTree = {
  ".pix/config.json": JSON.stringify({
    embedder: { provider: "cpu", model: "test-model", dims: 384, dtype: "fp32" },
    chunk: { maxTokens: 512, overlapTokens: 0 },
    ignore: { paths: [], gitignore: false },
    indexing: { batchSize: 10, chunkConcurrency: 2 },
    model: "claude-sonnet-4-20250514",
  }),
  ".pix/chunks.jsonl": Array.from({ length: 150 }, (_, i) =>
    JSON.stringify({
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

test("executeQuery with topK=200 clamps results", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--top", "200", "test"]).pipe(
      Effect.provide(testLayer({ contents: largeFixtures, displayLayer: layer })),
    )
    yield* expectLogEntry(ref, { severity: "warn", messageIncludes: "clamped" })
    yield* expectJsonEntry(ref, (data) => {
      expect(Array.isArray(data)).toBe(true)
      if (Array.isArray(data)) {
        expect(data.length).toBeLessThanOrEqual(100)
      }
    })
  })
})
