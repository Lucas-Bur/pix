import { Command, Options } from "@effect/cli"
import { Console, Effect } from "effect"

import { IndexProject } from "../application/index-project.js"
import { reportError } from "../lib/error-format.js"

const logFlagWarnings = (force: boolean, verbose: boolean, json: boolean) => {
  if (json) return Effect.void

  const warnings = [
    force ? "--force is currently not implemented and only a placeholder." : undefined,
    verbose ? "--verbose is currently not implemented and only a placeholder." : undefined,
  ].filter((msg): msg is string => msg !== undefined)

  return Effect.forEach(warnings, (msg) => Effect.logInfo(msg), { discard: true })
}

const logHumanOutput = (chunks: number, files: number, duration: string) =>
  Effect.logInfo(`Indexed ${chunks} chunks from ${files} files in ${duration}.`)

/** CLI command: pix index [--force] [--verbose] [--json] */
export const indexCommand = Command.make(
  "index",
  {
    force: Options.boolean("force").pipe(Options.withDefault(false)),
    verbose: Options.boolean("verbose").pipe(Options.withDefault(false)),
    json: Options.boolean("json").pipe(Options.withDefault(false)),
  },
  ({ force, verbose, json }) =>
    Effect.gen(function* () {
      yield* logFlagWarnings(force, verbose, json)

      const startTime = Date.now()
      const result = yield* IndexProject.index()
      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`

      if (json) {
        return yield* Console.log(
          JSON.stringify({ chunks: result.status.chunks, files: result.status.files, duration }),
        )
      }

      yield* logHumanOutput(result.status.chunks, result.status.files, duration)
    }).pipe(Effect.catchAll(reportError)),
)
