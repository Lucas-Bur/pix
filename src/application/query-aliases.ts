import { Effect } from "effect"

import { QueryAliasStore } from "../domain/ports.js"
import type {
  AliasAddRequest,
  AliasRunRequest,
  QueryAlias,
  QueryAliasOptions,
} from "../domain/query-alias.js"
import type { AliasNameRequestSchema } from "../domain/query-alias.js"
import type { QueryRequest } from "../domain/query.js"
import { runQuery } from "./run-query.js"

const savedOptions = (request: AliasAddRequest): QueryAliasOptions => ({
  ...(request.top !== undefined && { top: request.top }),
  ...(request.contextLines !== undefined && { contextLines: request.contextLines }),
  ...(request.ignorePath !== undefined &&
    request.ignorePath.length > 0 && { ignorePath: request.ignorePath }),
  ...(request.onlyPath !== undefined &&
    request.onlyPath.length > 0 && { onlyPath: request.onlyPath }),
  ...(request.maxCharacters !== undefined && { maxCharacters: request.maxCharacters }),
  ...(request.noContent === true && { noContent: true }),
  ...(request.profile !== undefined && { profile: request.profile }),
})

/** Create or replace a query alias. */
export const addAlias = (request: AliasAddRequest) =>
  Effect.gen(function* () {
    const store = yield* QueryAliasStore
    return yield* store.save(request.name, request.queryText, savedOptions(request))
  })

/** List saved query aliases in stable name order. */
export const listAliases = Effect.gen(function* () {
  const store = yield* QueryAliasStore
  return yield* store.list
})

/** Remove a query alias. */
export const removeAlias = (request: typeof AliasNameRequestSchema.Type) =>
  Effect.gen(function* () {
    const store = yield* QueryAliasStore
    yield* store.remove(request.name)
    return { removed: request.name }
  })

/** Resolve saved alias options and explicit overrides into one shared query request. */
const resolveAliasQuery = (alias: QueryAlias, request: AliasRunRequest): QueryRequest => ({
  queryText: alias.queryText,
  top: request.top ?? alias.options.top,
  contextLines: request.contextLines ?? alias.options.contextLines,
  ignorePath:
    request.ignorePath !== undefined && request.ignorePath.length > 0
      ? request.ignorePath
      : alias.options.ignorePath,
  onlyPath:
    request.onlyPath !== undefined && request.onlyPath.length > 0
      ? request.onlyPath
      : alias.options.onlyPath,
  maxCharacters: request.maxCharacters ?? alias.options.maxCharacters,
  noContent: request.noContent ?? alias.options.noContent,
  profile: request.profile ?? alias.options.profile,
})

/** Resolve a saved alias into a shared query request. */
export const getAliasQuery = (request: AliasRunRequest) =>
  Effect.gen(function* () {
    const store = yield* QueryAliasStore
    const alias = yield* store.get(request.aliasName)
    return resolveAliasQuery(alias, request)
  })

/** Run a saved alias through the shared query application API. */
export const runAlias = (request: AliasRunRequest) =>
  getAliasQuery(request).pipe(Effect.flatMap(runQuery))
