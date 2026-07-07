import { Argument, Command, Flag } from "effect/unstable/cli"

export const DEFAULT_TOP_K = 5
export const DEFAULT_CONTEXT_LINES = 0

/** Query flags that may be saved in an alias. */
export const queryAliasFlags = {
  top: Flag.integer("top").pipe(Flag.optional),
  contextLines: Flag.integer("context-lines").pipe(Flag.optional),
  ignorePath: Flag.string("ignore-path").pipe(Flag.atLeast(0)),
  onlyPath: Flag.string("only-path").pipe(Flag.atLeast(0)),
  maxCharacters: Flag.integer("max-characters").pipe(Flag.optional),
  noContent: Flag.boolean("no-content").pipe(Flag.withDefault(false)),
}

/** CLI flags accepted by `pix alias run` and `pix run`. */
export const queryAliasRunFlags = {
  ...queryAliasFlags,
  json: Flag.boolean("json").pipe(Flag.withDefault(false)),
  copy: Flag.boolean("copy").pipe(Flag.withDefault(false)),
}

/** CLI flags accepted by `pix query`. */
const queryCommandFlags = {
  top: Flag.integer("top").pipe(Flag.withDefault(DEFAULT_TOP_K)),
  json: Flag.boolean("json").pipe(Flag.withDefault(false)),
  contextLines: Flag.integer("context-lines").pipe(Flag.withDefault(DEFAULT_CONTEXT_LINES)),
  ignorePath: queryAliasFlags.ignorePath,
  onlyPath: queryAliasFlags.onlyPath,
  maxCharacters: queryAliasFlags.maxCharacters,
  noContent: queryAliasFlags.noContent,
  copy: Flag.boolean("copy").pipe(Flag.withDefault(false)),
}

/** CLI config accepted by `pix query`. */
export const queryCommandConfig = {
  queryText: Argument.string("query"),
  ...queryCommandFlags,
}

/** Parsed CLI input accepted by query execution. */
export type QueryCommandInput = Command.Command.Config.Infer<typeof queryCommandConfig>
