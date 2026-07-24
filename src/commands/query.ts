import { Effect, Option } from "effect"
import { Command } from "effect/unstable/cli"

import { reportError } from "../lib/errors/error-format.js"
import { executeQuery } from "./execute-query.js"
import { queryCommandConfig } from "./query-options.js"

/**
 * CLI command: pix query "<text>" [--top N] [--json] [--context-lines N] [--ignore-path P]
 * [--only-path P] [--max-characters N] [--no-content] [--copy]
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
    },
    input.copy,
  ).pipe(Effect.catch(reportError)),
)
