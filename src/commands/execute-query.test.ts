import { expect, it } from "@effect/vitest"
import type { FileTree } from "@lucas-bur/effect-memfs"
import { Effect, Ref } from "effect"

import { testClipboard } from "../../tests/test-utils/clipboard.js"
import {
  expectJsonEntry,
  expectLogEntry,
  indexFixtures,
  runCommand,
} from "../../tests/test-utils/command.js"
import { makeChunkJson, makeConfigJson } from "../../tests/test-utils/fixtures.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { DEFAULT_CONFIG } from "../domain/config.js"
import { queryCommand } from "./query.js"

const run = runCommand(queryCommand)
const resultsOf = (data: unknown): readonly Record<string, unknown>[] => {
  const results = (data as { results?: unknown }).results
  expect(Array.isArray(results)).toBe(true)
  return results as readonly Record<string, unknown>[]
}

it.effect("executeQuery clamps topK above maximum to 100", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--top", "200", "test"]).pipe(
      Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })),
    )
    yield* expectLogEntry(ref, { severity: "warn", messageIncludes: "clamped" })
    yield* expectJsonEntry(ref, (data) => {
      expect(resultsOf(data).length).toBeLessThanOrEqual(100)
    })
  })
})

it.effect("executeQuery clamps topK below minimum to 1", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--top", "0", "test"]).pipe(
      Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })),
    )
    yield* expectLogEntry(ref, { severity: "warn", messageIncludes: "clamped" })
    yield* expectJsonEntry(ref, (data) => {
      expect(resultsOf(data).length).toBeLessThanOrEqual(1)
    })
  })
})

it.effect("executeQuery --copy writes to clipboard when results exist", () => {
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

it.effect("executeQuery --copy does not copy when no results exist", () => {
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

it.effect("executeQuery --no-content strips text from results", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--no-content", "--top", "1", "test"]).pipe(
      Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })),
    )
    yield* expectJsonEntry(ref, (data) => {
      const results = resultsOf(data)
      if (results.length > 0) {
        expect(results[0]).not.toHaveProperty("text")
      }
    })
  })
})

it.effect("executeQuery --max-characters truncates result text", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--max-characters", "5", "--top", "1", "test"]).pipe(
      Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })),
    )
    yield* expectJsonEntry(ref, (data) => {
      const results = resultsOf(data)
      if (results.length > 0) {
        const text = results[0].text as string
        expect(text.length).toBeLessThanOrEqual(5 + 3)
      }
    })
  })
})

const largeFixtures: FileTree = {
  ".pix/config.json": makeConfigJson(),
  ".pix/index-meta.json": JSON.stringify({
    dtype: "fp32",
    dims: 384,
    model: DEFAULT_CONFIG.embedder.model,
    lastIndex: Date.now(),
  }),
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
  ".pix/vectors.bin": "\0".repeat(150 * 384 * 4),
  ".pix/bm25.json": JSON.stringify({
    avgChunkLength: 2,
    chunkLengths: Array.from({ length: 150 }, () => 2),
    docFreqs: { test: 150 },
    chunkTfs: { test: Array.from({ length: 150 }, (_, index) => [index, 1]) },
  }),
  ".pix/files.jsonl": "",
}

it.effect("executeQuery with topK=200 clamps results", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["query", "--json", "--top", "200", "test"]).pipe(
      Effect.provide(testLayer({ contents: largeFixtures, displayLayer: layer })),
    )
    yield* expectLogEntry(ref, { severity: "warn", messageIncludes: "clamped" })
    yield* expectJsonEntry(ref, (data) => {
      expect(resultsOf(data).length).toBeLessThanOrEqual(100)
    })
  })
})
