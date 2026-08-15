import { Effect, Option } from "effect"
import { Command, Flag } from "effect/unstable/cli"

import { InitProject } from "../application/init-project.js"
import { MODEL_REGISTRY } from "../domain/models.js"
import { Display, ModelRegistry } from "../domain/ports.js"
import { reportError } from "../lib/errors/error-format.js"

/** CLI command: pix init [--json] */
export const initCommand = Command.make(
  "init",
  {
    model: Flag.choice("model", Object.keys(MODEL_REGISTRY)).pipe(
      Flag.withMetavar("MODEL"),
      Flag.withDescription("Dense embedding model to configure without an interactive prompt"),
      Flag.optional,
    ),
  },
  ({ model }) =>
    Effect.gen(function* () {
      const d = yield* Display
      const registry = yield* ModelRegistry
      const modelIds = yield* registry.list

      const defaultModel = "Xenova/all-MiniLM-L6-v2"
      const selectedModel = yield* Option.match(model, {
        onNone: () =>
          d.select(
            "Select embedding model:",
            modelIds.map((id) => ({ value: id, label: id })),
            defaultModel,
          ),
        onSome: Effect.succeed,
      })

      const result = yield* d.spinner(
        "Initializing...",
        Effect.flatMap(InitProject, (svc) => svc.init(selectedModel)),
      )

      yield* d.json(result)
      yield* d.log(`Created .pix/config.json with model "${selectedModel}".`, "success")
    }).pipe(Effect.catch(reportError)),
).pipe(
  Command.withDescription(
    "Create pix configuration and local Git exclusions in the current project",
  ),
  Command.withShortDescription("Initialize pix in the current project"),
)
