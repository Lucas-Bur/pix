import { Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"

import { Display, QueryAliasStore } from "../domain/ports.js"
import type { QueryAlias } from "../domain/query-alias.js"
import { reportError } from "../lib/errors/error-format.js"
import { executeQuery } from "./execute-query.js"
import {
  DEFAULT_CONTEXT_LINES,
  DEFAULT_TOP_K,
  queryAliasFlags,
  queryAliasRunFlags,
  type QueryCommandInput,
} from "./query-options.js"

const aliasRunConfig = {
  aliasName: Argument.string("name"),
  ...queryAliasRunFlags,
}

type AliasRunFlags = Command.Command.Config.Infer<typeof queryAliasRunFlags>

const aliasToRow = (alias: QueryAlias): readonly string[] => [
  alias.name,
  alias.queryText,
  JSON.stringify(alias.options),
]

const numberWithFallback = (
  override: Option.Option<number>,
  saved: number | undefined,
  fallback: number,
): number => Option.getOrUndefined(override) ?? saved ?? fallback

const optionalNumberWithFallback = (
  override: Option.Option<number>,
  saved: number | undefined,
): Option.Option<number> => (Option.isSome(override) ? override : Option.fromUndefinedOr(saved))

const listWithFallback = <T>(
  override: readonly T[],
  saved: readonly T[] | undefined,
): readonly T[] => (override.length > 0 ? override : (saved ?? []))

const toQueryInput = (alias: QueryAlias, flags: AliasRunFlags): QueryCommandInput => ({
  queryText: alias.queryText,
  top: numberWithFallback(flags.top, alias.options.top, DEFAULT_TOP_K),
  contextLines: numberWithFallback(
    flags.contextLines,
    alias.options.contextLines,
    DEFAULT_CONTEXT_LINES,
  ),
  ignorePath: listWithFallback(flags.ignorePath, alias.options.ignorePath),
  onlyPath: listWithFallback(flags.onlyPath, alias.options.onlyPath),
  maxCharacters: optionalNumberWithFallback(flags.maxCharacters, alias.options.maxCharacters),
  noContent: flags.noContent || alias.options.noContent === true,
  json: flags.json,
  copy: flags.copy,
})

/** CLI command: pix alias add <name> "<query>" [query flags...] */
const aliasAddCommand = Command.make(
  "add",
  {
    name: Argument.string("name"),
    queryText: Argument.string("query"),
    ...queryAliasFlags,
  },
  ({ name, queryText, top, contextLines, ignorePath, onlyPath, maxCharacters, noContent }) =>
    Effect.gen(function* () {
      const d = yield* Display
      const store = yield* QueryAliasStore
      const alias = yield* store.save(name, queryText, {
        ...(Option.isSome(top) && { top: top.value }),
        ...(Option.isSome(contextLines) && { contextLines: contextLines.value }),
        ...(ignorePath.length > 0 && { ignorePath: [...ignorePath] }),
        ...(onlyPath.length > 0 && { onlyPath: [...onlyPath] }),
        ...(Option.isSome(maxCharacters) && { maxCharacters: maxCharacters.value }),
        ...(noContent && { noContent: true }),
      })
      yield* d.json(alias)
      yield* d.log(`Saved alias "${alias.name}"`, "success")
    }).pipe(Effect.catch(reportError)),
)

/** CLI command: pix alias list [--json] */
const aliasListCommand = Command.make(
  "list",
  {
    json: Flag.boolean("json").pipe(Flag.withDefault(false)),
  },
  () =>
    Effect.gen(function* () {
      const d = yield* Display
      const store = yield* QueryAliasStore
      const aliases = yield* store.list()
      yield* d.json(aliases)
      if (aliases.length === 0) {
        yield* d.log("No aliases saved", "warn")
      } else {
        yield* d.table(["Name", "Query", "Options"], aliases.map(aliasToRow))
      }
    }).pipe(Effect.catch(reportError)),
)

/** CLI command: pix alias remove <name> */
const aliasRemoveCommand = Command.make(
  "remove",
  {
    name: Argument.string("name"),
  },
  ({ name }) =>
    Effect.gen(function* () {
      const d = yield* Display
      const store = yield* QueryAliasStore
      yield* store.remove(name)
      yield* d.json({ removed: name })
      yield* d.log(`Removed alias "${name}"`, "success")
    }).pipe(Effect.catch(reportError)),
)

/** Build an alias runner command. Shared by `pix alias run` and top-level `pix run`. */
const aliasRunCommand = Command.make("run", aliasRunConfig, ({ aliasName, ...flags }) =>
  Effect.gen(function* () {
    const store = yield* QueryAliasStore
    const alias = yield* store.get(aliasName)
    yield* executeQuery(toQueryInput(alias, flags))
  }).pipe(Effect.catch(reportError)),
)

/** CLI command: pix alias <add|list|remove|run>. */
export const aliasCommand = Command.make("alias", {}, () =>
  Effect.gen(function* () {
    const d = yield* Display
    yield* d.log("Usage: pix alias <add|list|remove|run>", "info")
  }),
).pipe(
  Command.withSubcommands([aliasAddCommand, aliasListCommand, aliasRemoveCommand, aliasRunCommand]),
)

/** CLI command: pix run <name> [query overrides...] */
export const runAliasShortcutCommand = aliasRunCommand
