import { Effect, Layer } from "effect"
import { FileSystem } from "effect/FileSystem"
import { expect, test } from "vite-plus/test"

import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { QueryAliasStore } from "../domain/ports.js"
import { QueryAliasStoreLive } from "./query-alias-store.js"

const aliasLayer = (contents: Record<string, string | null> = {}) =>
  Layer.provideMerge(QueryAliasStoreLive, memoryFsLayer(contents))

test("QueryAliasStore.save writes aliases.json and leaves no temp file", () =>
  Effect.gen(function* () {
    const store = yield* QueryAliasStore
    const fs = yield* FileSystem

    yield* store.save("auth", "find auth handlers", { top: 3 })

    const aliasesContent = yield* fs.readFileString(".pix/aliases.json")
    const aliases = JSON.parse(aliasesContent)
    expect(aliases).toEqual({ auth: { queryText: "find auth handlers", options: { top: 3 } } })
    expect(yield* fs.exists(".pix/aliases.json.tmp")).toBe(false)
  }).pipe(Effect.provide(aliasLayer())))

test("QueryAliasStore.list returns empty when aliases.json is missing", () =>
  Effect.gen(function* () {
    const store = yield* QueryAliasStore
    expect(yield* store.list()).toEqual([])
  }).pipe(Effect.provide(aliasLayer())))

test("QueryAliasStore.remove deletes an alias from aliases.json", () =>
  Effect.gen(function* () {
    const store = yield* QueryAliasStore
    yield* store.save("auth", "find auth handlers", {})
    yield* store.remove("auth")
    expect(yield* store.list()).toEqual([])
  }).pipe(Effect.provide(aliasLayer())))
