import { Effect, Layer } from "effect"
import { FileSystem } from "effect/FileSystem"
import { expect, test } from "vite-plus/test"

import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { AliasNotFoundError, AliasStoreError, AliasValidationError } from "../domain/errors.js"
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

test("QueryAliasStore.get returns a saved alias", () =>
  Effect.gen(function* () {
    const store = yield* QueryAliasStore
    yield* store.save("auth", "find auth handlers", { top: 3 })
    const alias = yield* store.get("auth")
    expect(alias.name).toBe("auth")
    expect(alias.queryText).toBe("find auth handlers")
    expect(alias.options).toEqual({ top: 3 })
  }).pipe(Effect.provide(aliasLayer())))

test("QueryAliasStore.get fails with AliasNotFoundError for a missing alias", () =>
  Effect.gen(function* () {
    const store = yield* QueryAliasStore
    const error = yield* store.get("nonexistent").pipe(Effect.catch((err) => Effect.succeed(err)))
    expect(error).toBeInstanceOf(AliasNotFoundError)
    expect((error as AliasNotFoundError).name).toBe("nonexistent")
  }).pipe(Effect.provide(aliasLayer())))

test("QueryAliasStore.save rejects invalid alias names", () =>
  Effect.gen(function* () {
    const store = yield* QueryAliasStore
    const error = yield* store
      .save("bad/name", "query", {})
      .pipe(Effect.catch((err) => Effect.succeed(err)))
    expect(error).toBeInstanceOf(AliasValidationError)
  }).pipe(Effect.provide(aliasLayer())))

test("QueryAliasStore fails with AliasStoreError for corrupted aliases.json", () =>
  Effect.gen(function* () {
    const store = yield* QueryAliasStore
    const error = yield* store.list().pipe(Effect.catch((err) => Effect.succeed(err)))
    expect(error).toBeInstanceOf(AliasStoreError)
    expect((error as AliasStoreError).message).toContain("decode")
  }).pipe(Effect.provide(aliasLayer({ ".pix/aliases.json": "not valid json" }))))
