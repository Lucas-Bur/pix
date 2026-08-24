import { Effect, Option } from "effect"
import { Argument, CliError, Command } from "effect/unstable/cli"

import { addAlias, getAliasQuery, listAliases, removeAlias } from "../application/query-aliases.js"
import { Display } from "../domain/ports.js"
import type { QueryAlias } from "../domain/query-alias.js"
import { NonEmptyTextSchema } from "../domain/text.js"
import { reportError } from "../lib/errors/error-format.js"
import { executeQuery } from "./execute-query.js"
import { queryAliasFlags, queryAliasRunFlags } from "./query-options.js"

const aliasRunConfig = {
  aliasName: Argument.string("name").pipe(
    Argument.withSchema(NonEmptyTextSchema),
    Argument.withMetavar("NAME"),
    Argument.withDescription("Saved alias name"),
  ),
  ...queryAliasRunFlags,
}

const aliasToRow = (alias: QueryAlias): readonly string[] => [
  alias.name,
  alias.queryText,
  JSON.stringify(alias.options),
]

/** CLI command: pix alias add <name> "<query>" [query flags...] */
export const aliasAddCommand = Command.make(
  "add",
  {
    name: Argument.string("name").pipe(
      Argument.withSchema(NonEmptyTextSchema),
      Argument.withMetavar("NAME"),
      Argument.withDescription("Unique alias name"),
    ),
    queryText: Argument.string("query").pipe(
      Argument.withSchema(NonEmptyTextSchema),
      Argument.withMetavar("QUERY"),
      Argument.withDescription("Query text saved with the alias"),
    ),
    ...queryAliasFlags,
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
).pipe(
  Command.withDescription("Save a named query and optional retrieval settings"),
  Command.withShortDescription("Save a query alias"),
)

/** CLI command: pix alias list [--json] */
export const aliasListCommand = Command.make("list", {}, () =>
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
).pipe(
  Command.withAlias("ls"),
  Command.withDescription("List every saved query alias and its persisted retrieval settings"),
  Command.withShortDescription("List saved query aliases"),
)

/** CLI command: pix alias remove <name> */
export const aliasRemoveCommand = Command.make(
  "remove",
  {
    name: Argument.string("name").pipe(
      Argument.withSchema(NonEmptyTextSchema),
      Argument.withMetavar("NAME"),
      Argument.withDescription("Alias name to delete"),
    ),
  },
  ({ name }) =>
    Effect.gen(function* () {
      const d = yield* Display
      const result = yield* removeAlias({ name })
      yield* d.json(result)
      yield* d.log(`Removed alias "${name}"`, "success")
    }).pipe(Effect.catch(reportError)),
).pipe(
  Command.withAlias("rm"),
  Command.withDescription("Delete a saved query alias"),
  Command.withShortDescription("Delete a saved query alias"),
)

const runAliasHandler = ({
  aliasName,
  ...flags
}: Command.Command.Config.Infer<typeof aliasRunConfig>) =>
  Effect.gen(function* () {
    const request = yield* getAliasQuery({
      aliasName,
      top: Option.getOrUndefined(flags.top),
      contextLines: Option.getOrUndefined(flags.contextLines),
      ignorePath: flags.ignorePath,
      onlyPath: flags.onlyPath,
      maxCharacters: Option.getOrUndefined(flags.maxCharacters),
      noContent: Option.getOrUndefined(flags.noContent),
      profile: Option.getOrUndefined(flags.profile),
    })
    yield* executeQuery(request, flags.copy)
  }).pipe(Effect.catch(reportError))

/** CLI command: pix run <name> [query overrides...] */
export const runAliasShortcutCommand = Command.make("run", aliasRunConfig, runAliasHandler).pipe(
  Command.withDescription("Execute a saved query alias with optional one-shot overrides"),
  Command.withShortDescription("Run a saved query alias"),
  Command.withExamples([
    {
      command: "pix run auth --top 10",
      description: "Run an alias through the top-level shortcut",
    },
  ]),
)

/**
 * Build the alias namespace. Subcommands are supplied by the caller so cli.ts can provide layers to
 * the leaves while the unit tests pass raw leaves (whose services come from testLayer).
 */
export const makeAliasCommand = <const Subcommands extends readonly any[]>(
  subcommands: Subcommands,
) =>
  Command.make(
    "alias",
    {},
    () => new CliError.ShowHelp({ commandPath: ["pix", "alias"], errors: [] }),
  ).pipe(
    Command.withSubcommands(subcommands),
    Command.withDescription("Create, inspect, delete, and execute saved query presets"),
    Command.withShortDescription("Manage saved query presets"),
  )

/** Alias namespace with raw leaves, used by unit tests. */
export const aliasCommand = makeAliasCommand([
  aliasAddCommand,
  aliasListCommand,
  aliasRemoveCommand,
])
