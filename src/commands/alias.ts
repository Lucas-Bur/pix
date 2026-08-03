import { Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"

import { addAlias, getAliasQuery, listAliases, removeAlias } from "../application/query-aliases.js"
import { Display } from "../domain/ports.js"
import type { QueryAlias } from "../domain/query-alias.js"
import { reportError } from "../lib/errors/error-format.js"
import { executeQuery } from "./execute-query.js"
import { queryAliasFlags, queryAliasRunFlags } from "./query-options.js"

const aliasRunConfig = {
  aliasName: Argument.string("name"),
  ...queryAliasRunFlags,
}

const aliasToRow = (alias: QueryAlias): readonly string[] => [
  alias.name,
  alias.queryText,
  JSON.stringify(alias.options),
]

/** CLI command: pix alias add <name> "<query>" [query flags...] */
const aliasAddCommand = Command.make(
  "add",
  {
    name: Argument.string("name"),
    queryText: Argument.string("query"),
    ...queryAliasFlags,
    json: Flag.boolean("json").pipe(Flag.withDefault(false)),
  },
  ({
    name,
    queryText,
    top,
    contextLines,
    ignorePath,
    onlyPath,
    maxCharacters,
    noContent,
    profile,
  }) =>
    Effect.gen(function* () {
      const d = yield* Display
      const alias = yield* addAlias({
        name,
        queryText,
        top: Option.getOrUndefined(top),
        contextLines: Option.getOrUndefined(contextLines),
        ignorePath,
        onlyPath,
        maxCharacters: Option.getOrUndefined(maxCharacters),
        noContent,
        profile: Option.getOrUndefined(profile),
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
      const aliases = yield* listAliases
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
    json: Flag.boolean("json").pipe(Flag.withDefault(false)),
  },
  ({ name }) =>
    Effect.gen(function* () {
      const d = yield* Display
      const result = yield* removeAlias({ name })
      yield* d.json(result)
      yield* d.log(`Removed alias "${name}"`, "success")
    }).pipe(Effect.catch(reportError)),
)

/** Build an alias runner command. Shared by `pix alias run` and top-level `pix run`. */
const aliasRunCommand = Command.make("run", aliasRunConfig, ({ aliasName, ...flags }) =>
  Effect.gen(function* () {
    const request = yield* getAliasQuery({
      aliasName,
      top: Option.getOrUndefined(flags.top),
      contextLines: Option.getOrUndefined(flags.contextLines),
      ignorePath: flags.ignorePath,
      onlyPath: flags.onlyPath,
      maxCharacters: Option.getOrUndefined(flags.maxCharacters),
      noContent: flags.noContent,
      profile: Option.getOrUndefined(flags.profile),
    })
    yield* executeQuery(request, flags.copy)
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
