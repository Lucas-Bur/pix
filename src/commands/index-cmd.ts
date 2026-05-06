import { Command, Options } from "@effect/cli"
import { Effect, Layer } from "effect"

import { IndexProject } from "../application/index-project.js"
import { ChunkerLive } from "../services/chunker.js"
import { ConfigStoreLive } from "../services/config-store.js"
import { OnnxEmbedderLive } from "../services/embedder.js"
import { ScannerLive } from "../services/scanner.js"
import { VectorStoreLive } from "../services/vector-store.js"

/** CLI command: pix index [--force] [--verbose] [--json] */
export const indexCommand = Command.make(
  "index",
  {
    force: Options.boolean("force").pipe(Options.withDefault(false)),
    verbose: Options.boolean("verbose").pipe(Options.withDefault(false)),
    json: Options.boolean("json").pipe(Options.withDefault(false)),
  },
  ({ force: _force, verbose: _verbose, json }) =>
    Effect.gen(function* () {
      const startTime = Date.now()

      const result = yield* IndexProject.index()

      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`

      if (json) {
        return yield* Effect.sync(() => {
          console.log(
            JSON.stringify({
              chunks: result.stats.chunks,
              files: result.stats.files,
              duration,
            }),
          )
        })
      }

      yield* Effect.logInfo(
        `Indexed ${result.stats.chunks} chunks from ${result.stats.files} files in ${duration}.`,
      )
    }),
)

/** Layer for pix index command runtime */
export const indexLayer = Layer.mergeAll(
  IndexProject.Default,
  ConfigStoreLive,
  ScannerLive,
  ChunkerLive,
  OnnxEmbedderLive,
  VectorStoreLive,
)
