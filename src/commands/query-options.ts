import { Argument, Flag } from "effect/unstable/cli"

import { QUERY_DEFAULTS, QueryOptionsSchema } from "../domain/query.js"

const DEFAULT_TOP_K = QUERY_DEFAULTS.top
const DEFAULT_CONTEXT_LINES = QUERY_DEFAULTS.contextLines

type QueryOptionName = keyof typeof QueryOptionsSchema.Type

/** Query flags that may be saved in an alias. */
export const queryAliasFlags = {
  top: Flag.integer("top").pipe(Flag.optional),
  contextLines: Flag.integer("context-lines").pipe(Flag.optional),
  ignorePath: Flag.string("ignore-path").pipe(Flag.atLeast(0)),
  onlyPath: Flag.string("only-path").pipe(Flag.atLeast(0)),
  maxCharacters: Flag.integer("max-characters").pipe(Flag.optional),
  noContent: Flag.boolean("no-content").pipe(Flag.withDefault(false)),
} satisfies Record<QueryOptionName, unknown>

/** CLI flags accepted by `pix alias run` and `pix run`. */
export const queryAliasRunFlags = {
  ...queryAliasFlags,
  json: Flag.boolean("json").pipe(Flag.withDefault(false)),
  copy: Flag.boolean("copy").pipe(Flag.withDefault(false)),
}

/** CLI flags accepted by `pix query`. */
const queryCommandRetrievalFlags = {
  top: Flag.integer("top").pipe(Flag.withDefault(DEFAULT_TOP_K)),
  contextLines: Flag.integer("context-lines").pipe(Flag.withDefault(DEFAULT_CONTEXT_LINES)),
  ignorePath: queryAliasFlags.ignorePath,
  onlyPath: queryAliasFlags.onlyPath,
  maxCharacters: queryAliasFlags.maxCharacters,
  noContent: queryAliasFlags.noContent,
} satisfies Record<QueryOptionName, unknown>

/** CLI config accepted by `pix query`. */
export const queryCommandConfig = {
  queryText: Argument.string("query"),
  ...queryCommandRetrievalFlags,
  json: Flag.boolean("json").pipe(Flag.withDefault(false)),
  copy: Flag.boolean("copy").pipe(Flag.withDefault(false)),
}
