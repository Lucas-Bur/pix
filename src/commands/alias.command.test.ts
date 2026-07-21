import { expect, it } from "@effect/vitest"
import { Effect, Ref } from "effect"

import { testClipboard } from "../../tests/test-utils/clipboard.js"
import {
  assertCommandError,
  expectJsonEntry,
  expectLogEntry,
  indexFixtures,
  indexSeed,
  runCommand as makeRunCommand,
} from "../../tests/test-utils/command.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { aliasCommand, runAliasShortcutCommand } from "./alias.js"

const runAlias = makeRunCommand(aliasCommand)
const runTopLevelAlias = makeRunCommand(runAliasShortcutCommand)

it.effect("pix alias add writes a query alias and alias list displays it", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* runAlias(["add", "auth", "find auth handlers", "--top", "3", "--ignore-path", "dist/**"])
    yield* runAlias(["list", "--json"])

    yield* expectJsonEntry(ref, (data) => {
      expect(Array.isArray(data)).toBe(true)
      if (Array.isArray(data)) {
        expect(data).toHaveLength(1)
        expect(data[0]).toMatchObject({
          name: "auth",
          queryText: "find auth handlers",
          options: { top: 3, ignorePath: ["dist/**"] },
        })
      }
    })
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

it.effect("pix alias remove deletes a saved query alias", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* runAlias(["add", "auth", "find auth handlers"])
    yield* runAlias(["remove", "auth"])
    yield* runAlias(["list", "--json"])

    yield* expectJsonEntry(ref, (data) => {
      expect(data).toEqual([])
    })
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

it.effect("pix alias add rejects invalid alias names", () => {
  const { ref, layer } = silentDisplay()
  return assertCommandError(
    runAlias(["add", "bad/name", "find auth handlers"]),
    ref,
    "ALIAS_VALIDATION_ERROR",
  ).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

it.effect("pix alias add accepts command names as query alias names", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* runAlias(["add", "query", "find auth handlers"])
    yield* runAlias(["list", "--json"])

    yield* expectJsonEntry(ref, (data) => {
      expect(Array.isArray(data)).toBe(true)
      if (Array.isArray(data)) {
        expect(data[0]).toMatchObject({ name: "query" })
      }
    })
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

it.effect("pix alias run executes the saved query with runtime overrides", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* runAlias(["add", "auth", "test", "--top", "1"])
    yield* runAlias(["run", "auth", "--json", "--top", "2"])

    yield* expectJsonEntry(ref, (data) => {
      expect(data).toMatchObject({ results: expect.any(Array) })
      const results = (data as { results: readonly unknown[] }).results
      expect(results).toHaveLength(2)
    })
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, indexSeed, displayLayer: layer })))
})

it.effect("pix run is a short form for pix alias run", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* runAlias(["add", "auth", "test", "--top", "1"])
    yield* runTopLevelAlias(["auth", "--json", "--top", "2"])

    yield* expectJsonEntry(ref, (data) => {
      expect(data).toMatchObject({ results: expect.any(Array) })
      const results = (data as { results: readonly unknown[] }).results
      expect(results).toHaveLength(2)
    })
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, indexSeed, displayLayer: layer })))
})

it.effect("pix alias run with nonexistent alias reports error", () => {
  const { ref, layer } = silentDisplay()
  return assertCommandError(runAlias(["run", "nonexistent"]), ref, "ALIAS_NOT_FOUND").pipe(
    Effect.provide(testLayer({ displayLayer: layer })),
  )
})

it.effect("pix alias run with --copy copies results to clipboard", () => {
  const { ref: displayRef, layer: displayLayer } = silentDisplay()
  const { ref: clipboardRef, layer: clipboardLayer } = testClipboard()
  return Effect.gen(function* () {
    yield* runAlias(["add", "auth", "test", "--top", "1"])
    yield* runAlias(["run", "auth", "--copy", "--json"])

    const copied = yield* Ref.get(clipboardRef)
    expect(copied).toContain("src/")
    yield* expectLogEntry(displayRef, { severity: "success", messageIncludes: "Copied" })
  }).pipe(
    Effect.provide(testLayer({ contents: indexFixtures, indexSeed, displayLayer, clipboardLayer })),
  )
})

it.effect("pix run --copy copies results to clipboard as short form", () => {
  const { ref: displayRef, layer: displayLayer } = silentDisplay()
  const { ref: clipboardRef, layer: clipboardLayer } = testClipboard()
  return Effect.gen(function* () {
    yield* runAlias(["add", "auth", "test", "--top", "1"])
    yield* runTopLevelAlias(["auth", "--copy", "--json"])

    const copied = yield* Ref.get(clipboardRef)
    expect(copied).toContain("src/")
    yield* expectLogEntry(displayRef, { severity: "success", messageIncludes: "Copied" })
  }).pipe(
    Effect.provide(testLayer({ contents: indexFixtures, indexSeed, displayLayer, clipboardLayer })),
  )
})
