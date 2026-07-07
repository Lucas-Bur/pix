import type { FileTree } from "@lucas-bur/effect-memfs"
import { Effect, Ref } from "effect"
import { expect, test } from "vite-plus/test"

import { testClipboard } from "../../tests/test-utils/clipboard.js"
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

const runQuery = (args: string[], contents: FileTree = indexFixtures) => {
  const { ref, layer } = silentDisplay()
  return {
    ref,
    effect: run(["query", ...args]).pipe(
      Effect.provide(testLayer({ contents, displayLayer: layer })),
    ),
  }
}

test("pix query --json outputs search results", () => {
  const { ref, effect } = runQuery(["--json", "test query"])
  return Effect.gen(function* () {
    yield* effect
    const entries = yield* Ref.get(ref)
    expect(entries[0]._tag).toBe("spinner")
    yield* expectJsonEntry(ref, (data) => {
      expect(Array.isArray(data)).toBe(true)
    })
  })
})

test("pix query with --top flag clamps to valid range", () => {
  const { ref, effect } = runQuery(["--json", "--top", "3", "search term"])
  return Effect.gen(function* () {
    yield* effect
    yield* expectJsonEntry(ref, (data) => {
      expect(Array.isArray(data)).toBe(true)
      if (Array.isArray(data)) {
        expect(data.length).toBeLessThanOrEqual(3)
      }
    })
  })
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
  const { ref, effect } = runQuery(["--json", "--top", "0", "test"])
  return Effect.gen(function* () {
    yield* effect
    yield* expectLogEntry(ref, { severity: "warn", messageIncludes: "clamped" })
    yield* expectJsonEntry(ref, (data) => {
      expect(Array.isArray(data)).toBe(true)
      if (Array.isArray(data)) {
        expect(data.length).toBeLessThanOrEqual(1)
      }
    })
  })
})

test("pix query --json clamps --top above maximum to 100", () => {
  const largeFixtures: FileTree = {
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
  const { ref, effect } = runQuery(["--json", "--top", "200", "test"], largeFixtures)
  return Effect.gen(function* () {
    yield* effect
    yield* expectLogEntry(ref, { severity: "warn", messageIncludes: "clamped" })
    yield* expectJsonEntry(ref, (data) => {
      expect(Array.isArray(data)).toBe(true)
      if (Array.isArray(data)) {
        expect(data.length).toBeLessThanOrEqual(100)
      }
    })
  })
})

test("pix query --json with --context-lines includes context fields", () => {
  const { ref, effect } = runQuery(["--json", "--context-lines", "2", "test"])
  return Effect.gen(function* () {
    yield* effect
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
  })
})

test("pix query --json on empty index returns empty array", () => {
  const { ref, effect } = runQuery(["--json", "no results"], {})
  return Effect.gen(function* () {
    yield* effect
    const entries = yield* Ref.get(ref)
    expect(entries.some((e) => e._tag === "spinner")).toBe(true)
    yield* expectJsonEntry(ref, (data) => {
      expect(data).toEqual([])
    })
  })
})

test("pix query without --json on empty index shows warning", () => {
  const { ref, effect } = runQuery(["nothing"], {})
  return Effect.gen(function* () {
    yield* effect
    const entries = yield* Ref.get(ref)
    expect(entries.some((e) => e._tag === "spinner")).toBe(true)
    expect(entries.some((e) => e._tag === "json")).toBe(true)
    expect(entries.some((e) => e._tag === "log" && e.severity === "warn")).toBe(true)
  })
})

test("pix query without --json outputs formatted results", () => {
  const { ref, effect } = runQuery(["test"])
  return Effect.gen(function* () {
    yield* effect
    const entries = yield* Ref.get(ref)
    expect(entries.some((e) => e._tag === "spinner")).toBe(true)
    expect(entries.some((e) => e._tag === "json")).toBe(true)
    expect(entries.some((e) => e._tag === "text")).toBe(true)
  })
})

test("pix query --copy copies all returned formatted results", () => {
  const { ref: displayRef, layer: displayLayer } = silentDisplay()
  const { ref: clipboardRef, layer: clipboardLayer } = testClipboard()
  return Effect.gen(function* () {
    yield* run(["query", "--copy", "--top", "2", "test"]).pipe(
      Effect.provide(testLayer({ contents: indexFixtures, displayLayer, clipboardLayer })),
    )

    const copied = yield* Ref.get(clipboardRef)
    expect(copied).toContain("#1")
    expect(copied).toContain("/src/")
    expect(copied).toContain(":1-")
    expect(copied).toContain("const")
    expect(copied).toContain("#2")
    yield* expectLogEntry(displayRef, { severity: "success", messageIncludes: "Copied 2" })
  })
})

test("pix query --copy with no results does not copy", () => {
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
      expect(Array.isArray(jsonEntry.data)).toBe(true)
      if (Array.isArray(jsonEntry.data)) {
        const files = jsonEntry.data.map((r: { file: string }) => r.file)
        expect(files.every(predicate)).toBe(true)
      }
    }
  })
}

test("pix query --json with --ignore-path excludes matching files", () =>
  assertQueryFilesFiltered(["--ignore-path", "**/*.ts", "test"], (f) => !f.endsWith(".ts")))

test("pix query --json with --only-path restricts to matching files", () =>
  assertQueryFilesFiltered(["--only-path", "src/services/**", "test"], (f) =>
    f.startsWith("src/services/"),
  ))

test("pix query --json with multiple --ignore-path flags", () =>
  assertQueryFilesFiltered(
    ["--ignore-path", "**/*.ts", "--ignore-path", "**/*.js", "test"],
    (f) => !f.endsWith(".ts") && !f.endsWith(".js"),
  ))
