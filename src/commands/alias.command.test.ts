import { Effect } from "effect"
import { expect, test } from "vite-plus/test"

import {
  assertCommandError,
  expectJsonEntry,
  indexFixtures,
  runCommand as makeRunCommand,
} from "../../tests/test-utils/command.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { aliasCommand, runAliasShortcutCommand } from "./alias.js"

const runAlias = makeRunCommand(aliasCommand)
const runTopLevelAlias = makeRunCommand(runAliasShortcutCommand)

test("pix alias add writes a query alias and alias list displays it", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* runAlias([
      "alias",
      "add",
      "auth",
      "find auth handlers",
      "--top",
      "3",
      "--ignore-path",
      "dist/**",
    ])
    yield* runAlias(["alias", "list", "--json"])

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

test("pix alias remove deletes a saved query alias", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* runAlias(["alias", "add", "auth", "find auth handlers"])
    yield* runAlias(["alias", "remove", "auth"])
    yield* runAlias(["alias", "list", "--json"])

    yield* expectJsonEntry(ref, (data) => {
      expect(data).toEqual([])
    })
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix alias add rejects invalid alias names", () => {
  const { ref, layer } = silentDisplay()
  return assertCommandError(
    runAlias(["alias", "add", "bad/name", "find auth handlers"]),
    ref,
    "ALIAS_VALIDATION_ERROR",
  ).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix alias add accepts command names as query alias names", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* runAlias(["alias", "add", "query", "find auth handlers"])
    yield* runAlias(["alias", "list", "--json"])

    yield* expectJsonEntry(ref, (data) => {
      expect(Array.isArray(data)).toBe(true)
      if (Array.isArray(data)) {
        expect(data[0]).toMatchObject({ name: "query" })
      }
    })
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix alias run executes the saved query with runtime overrides", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* runAlias(["alias", "add", "auth", "const", "--top", "1"])
    yield* runAlias(["alias", "run", "auth", "--json", "--top", "2"])

    yield* expectJsonEntry(ref, (data) => {
      expect(Array.isArray(data)).toBe(true)
      if (Array.isArray(data)) {
        expect(data).toHaveLength(2)
      }
    })
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})

test("pix run is a short form for pix alias run", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* runAlias(["alias", "add", "auth", "const", "--top", "1"])
    yield* runTopLevelAlias(["run", "auth", "--json", "--top", "2"])

    yield* expectJsonEntry(ref, (data) => {
      expect(Array.isArray(data)).toBe(true)
      if (Array.isArray(data)) {
        expect(data).toHaveLength(2)
      }
    })
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})
