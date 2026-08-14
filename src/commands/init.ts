import { Effect } from "effect"
import { Command } from "effect/unstable/cli"

import { InitProject } from "../application/init-project.js"
import { Display, ModelRegistry } from "../domain/ports.js"
import { reportError } from "../lib/errors/error-format.js"

/** CLI command: pix init [--json] */
export const initCommand = Command.make("init", {}, () =>
  Effect.gen(function* () {
    const d = yield* Display
    const registry = yield* ModelRegistry
    const modelIds = yield* registry.list

    const defaultModel = "Xenova/all-MiniLM-L6-v2"
    const selectedModel = yield* d.select(
      "Select embedding model:",
      modelIds.map((id) => ({ value: id, label: id })),
      defaultModel,
    )

    const result = yield* d.spinner(
      "Initializing...",
      Effect.flatMap(InitProject, (svc) => svc.init(selectedModel)),
    )

    yield* d.json(result)
    yield* d.log(`Created .pix/config.json with model "${selectedModel}".`, "success")
  }).pipe(Effect.catch(reportError)),
)
