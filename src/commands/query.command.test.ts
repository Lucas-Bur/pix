import { expect, it } from "@effect/vitest"
import type { FileTree } from "@lucas-bur/effect-memfs"
import { Effect, Ref } from "effect"

import { testClipboard } from "../../tests/test-utils/clipboard.js"
import {
  assertCommandError,
  expectJsonEntry,
  expectLogEntry,
  indexFixtures,
  indexSeed,
  makeFailingEmbedder,
  runCommand,
} from "../../tests/test-utils/command.js"
import { makeLargeIndexSeed, TEST_CONFIG_JSON } from "../../tests/test-utils/fixtures.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer, type TestIndexSeed } from "../../tests/test-utils/testLayer.js"
import { queryCommand } from "./query.js"

const run = runCommand(queryCommand)
const resultsOf = (data: unknown): readonly Record<string, unknown>[] => {
  const results = (data as { results?: unknown }).results
  expect(Array.isArray(results)).toBe(true)
  return results as readonly Record<string, unknown>[]
}

const runQuery = (
  args: string[],
  contents: FileTree = indexFixtures,
  seed: TestIndexSeed | undefined = contents === indexFixtures ? indexSeed : undefined,
) => {
  const { ref, layer } = silentDisplay()
  return {
    ref,
    effect: run(["query", ...args]).pipe(
      Effect.provide(testLayer({ contents, displayLayer: layer, indexSeed: seed })),
    ),
  }
}

it.effect("pix query --json outputs search results", () => {
  const { ref, effect } = runQuery(["--json", "test query"])
  return Effect.gen(function* () {
    yield* effect
    const entries = yield* Ref.get(ref)
    expect(entries[0]._tag).toBe("spinner")
    yield* expectJsonEntry(ref, (data) => {
      expect(resultsOf(data).length).toBeGreaterThan(0)
    })
  })
})

it.effect("pix query with --top flag clamps to valid range", () => {
  const { ref, effect } = runQuery(["--json", "--top", "3", "search term"])
  return Effect.gen(function* () {
    yield* effect
    yield* expectJsonEntry(ref, (data) => {
      expect(resultsOf(data).length).toBeLessThanOrEqual(3)
    })
  })
})

it.effect("pix query --json with failing embedder produces error JSON", () => {
  const { ref, layer } = silentDisplay()
  return assertCommandError(run(["query", "--json", "test"]), ref).pipe(
    Effect.provide(
      testLayer({
        contents: indexFixtures,
        indexSeed,
        embedderLayer: makeFailingEmbedder("embed"),
        displayLayer: layer,
      }),
    ),
  )
})

it.effect("pix query --json clamps --top below minimum to 1", () => {
  const { ref, effect } = runQuery(["--json", "--top", "0", "test"])
  return Effect.gen(function* () {
    yield* effect
    yield* expectLogEntry(ref, { severity: "warn", messageIncludes: "clamped" })
    yield* expectJsonEntry(ref, (data) => {
      expect(resultsOf(data).length).toBeLessThanOrEqual(1)
    })
  })
})

it.effect("pix query --json clamps --top above maximum to 100", () => {
  const largeFixtures: FileTree = {
    ".pix/config.json": TEST_CONFIG_JSON,
  }
  const largeSeed = makeLargeIndexSeed()
  const { ref, effect } = runQuery(
    ["--json", "--no-content", "--top", "200", "test"],
    largeFixtures,
    largeSeed,
  )
  return Effect.gen(function* () {
    yield* effect
    yield* expectLogEntry(ref, { severity: "warn", messageIncludes: "clamped" })
    yield* expectJsonEntry(ref, (data) => {
      expect(resultsOf(data).length).toBeLessThanOrEqual(100)
    })
  })
})

it.effect("pix query --json with --context-lines includes context fields", () => {
  const { ref, effect } = runQuery(["--json", "--context-lines", "2", "test"])
  return Effect.gen(function* () {
    yield* effect
    yield* expectJsonEntry(ref, (data) => {
      const results = resultsOf(data)
      if (results.length > 0) {
        const [first] = results
        expect(first).toHaveProperty("score")
        expect(first).toHaveProperty("file")
        expect(first).toHaveProperty("startLine")
        expect(first).toHaveProperty("endLine")
        expect(first).toHaveProperty("text")
      }
    })
  })
})

it.effect("pix query --json on empty index returns empty array", () => {
  const { ref, effect } = runQuery(["--json", "no results"], {})
  return Effect.gen(function* () {
    yield* effect
    const entries = yield* Ref.get(ref)
    expect(entries.some((e) => e._tag === "spinner")).toBe(true)
    yield* expectJsonEntry(ref, (data) => {
      expect(data).toEqual({
        indexRefresh: {
          kind: "full",
          processedFiles: 0,
          reusedFiles: 0,
          cacheHits: 0,
          cacheMisses: 0,
        },
        results: [],
      })
    })
  })
})

it.effect("pix query without --json on empty index shows warning", () => {
  const { ref, effect } = runQuery(["nothing"], {})
  return Effect.gen(function* () {
    yield* effect
    const entries = yield* Ref.get(ref)
    expect(entries.some((e) => e._tag === "spinner")).toBe(true)
    expect(entries.some((e) => e._tag === "json")).toBe(true)
    expect(entries.some((e) => e._tag === "log" && e.severity === "warn")).toBe(true)
  })
})

it.effect("pix query without --json outputs formatted results", () => {
  const { ref, effect } = runQuery(["test"])
  return Effect.gen(function* () {
    yield* effect
    const entries = yield* Ref.get(ref)
    expect(entries.some((e) => e._tag === "spinner")).toBe(true)
    expect(entries.some((e) => e._tag === "json")).toBe(true)
    expect(entries.some((e) => e._tag === "text")).toBe(true)
  })
})

it.effect("pix query --copy copies all returned formatted results", () => {
  const { ref: displayRef, layer: displayLayer } = silentDisplay()
  const { ref: clipboardRef, layer: clipboardLayer } = testClipboard()
  return Effect.gen(function* () {
    yield* run(["query", "--copy", "--top", "2", "test"]).pipe(
      Effect.provide(
        testLayer({ contents: indexFixtures, indexSeed, displayLayer, clipboardLayer }),
      ),
    )

    const copied = yield* Ref.get(clipboardRef)
    expect(copied).toContain("#1")
    expect(copied).toContain("src/")
    expect(copied).toContain(":1-")
    expect(copied).toContain("const")
    expect(copied).toContain("#2")
    yield* expectLogEntry(displayRef, { severity: "success", messageIncludes: "Copied 2" })
  })
})

it.effect("pix query --copy with no results does not copy", () => {
  const { ref: displayRef, layer: displayLayer } = silentDisplay()
  const { ref: clipboardRef, layer: clipboardLayer } = testClipboard()
  return Effect.gen(function* () {
    yield* run(["query", "--copy", "--top", "2", "no matches at all"]).pipe(
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

const assertQueryFilesFiltered = (args: string[], predicate: (file: string) => boolean) => {
  const { ref, effect } = runQuery(["--json", ...args])
  return Effect.gen(function* () {
    yield* effect
    const entries = yield* Ref.get(ref)
    const jsonEntry = entries.find((e) => e._tag === "json")
    expect(jsonEntry).toBeDefined()
    if (jsonEntry?._tag === "json") {
      const files = resultsOf(jsonEntry.data).map((result) => result.file as string)
      expect(files.every(predicate)).toBe(true)
    }
  })
}

it.effect("pix query --json with --ignore-path excludes matching files", () =>
  assertQueryFilesFiltered(["--ignore-path", "**/*.ts", "test"], (f) => !f.endsWith(".ts")),
)

it.effect("pix query --json with --only-path restricts to matching files", () =>
  assertQueryFilesFiltered(["--only-path", "src/services/**", "test"], (f) =>
    f.startsWith("src/services/"),
  ),
)

it.effect("pix query --json with multiple --ignore-path flags", () =>
  assertQueryFilesFiltered(
    ["--ignore-path", "**/*.ts", "--ignore-path", "**/*.js", "test"],
    (f) => !f.endsWith(".ts") && !f.endsWith(".js"),
  ),
)
