import { Effect, Option } from "effect"
import { Command } from "effect/unstable/cli"

import { reportError } from "../lib/errors/error-format.js"
import { executeQuery } from "./execute-query.js"
import { queryCommandConfig } from "./query-options.js"

/**
 * CLI command: pix query "<text>" [--top N] [--json] [--context-lines N] [--ignore-path P]
 * [--only-path P] [--max-characters N] [--no-content] [--profile NAME] [--copy]
 */
export const queryCommand = Command.make("query", queryCommandConfig, (input) =>
  executeQuery(
    {
      queryText: input.queryText,
      top: input.top,
      contextLines: input.contextLines,
      ignorePath: input.ignorePath,
      onlyPath: input.onlyPath,
      maxCharacters: Option.getOrUndefined(input.maxCharacters),
      noContent: input.noContent,
      profile: Option.getOrUndefined(input.profile),
    },
    input.copy,
  ).pipe(Effect.catch(reportError)),
).pipe(
  Command.withAlias("q"),
  Command.withDescription(
    "Refresh the index when needed and search source code with hybrid lexical and semantic retrieval",
  ),
  Command.withShortDescription("Search the indexed project"),
  Command.withExamples([
    {
      command: 'pix query "authentication middleware" --top 5',
      description: "Find implementation chunks for a concept",
    },
    {
      command: 'pix query --json --no-content "config validation"',
      description: "Return compact machine-readable locations",
    },
  ]),
)
