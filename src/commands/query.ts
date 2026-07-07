import { Effect } from "effect"
import { Command } from "effect/unstable/cli"

import { reportError } from "../lib/errors/error-format.js"
import { executeQuery } from "./execute-query.js"
import { queryCommandConfig } from "./query-options.js"

/**
 * CLI command: pix query "<text>" [--top N] [--json] [--context-lines N] [--ignore-path P]
 * [--only-path P] [--max-characters N] [--no-content] [--copy]
 */
export const queryCommand = Command.make("query", queryCommandConfig, (input) =>
  executeQuery(input).pipe(Effect.catch(reportError)),
)
