import { Effect } from "effect"
import { CliError, Command } from "effect/unstable/cli"

import type { Config } from "../domain/config.js"
import type { EmbeddingDtype } from "../domain/dtype.js"
import { ConfigHealError } from "../domain/errors.js"
import { ConfigStore } from "../domain/ports.js"
import { Display } from "../domain/ports.js"
import { reportError } from "../lib/errors/error-format.js"

/** Apply a single conflict resolution to the config. */
const applyChoice = (config: Config, field: string, value: string): Config => {
  if (field === "embedder.model")
    return { ...config, embedder: { ...config.embedder, model: value } }
  if (field === "embedder.dtype")
    return { ...config, embedder: { ...config.embedder, dtype: value as EmbeddingDtype } }
  return config
}

/** CLI command: pix config heal [--json] */
export const healCommand = Command.make("heal", {}, () =>
  Effect.gen(function* () {
    const d = yield* Display
    const store = yield* ConfigStore
    const plan = yield* store.healConfig

    const choices = yield* Effect.forEach(plan.conflicts, (conflict) =>
      d.select(
        conflict.reason,
        conflict.validOptions.map((v) => ({ value: v, label: v })),
        conflict.healed ? conflict.healedValue : undefined,
      ),
    ).pipe(
      Effect.catchTag("InteractiveError", () => {
        const unhealed = plan.conflicts.filter((c) => !c.healed)
        return Effect.fail(
          new ConfigHealError({
            conflicts: unhealed.map((c) => ({
              field: c.field,
              currentValue: c.currentValue,
              validOptions: c.validOptions,
              reason: c.reason,
            })),
          }),
        )
      }),
    )

    let resolved = plan.config
    for (let i = 0; i < plan.conflicts.length; i++) {
      resolved = applyChoice(resolved, plan.conflicts[i].field, choices[i])
    }

    yield* store.writeConfig(resolved)

    yield* d.json({ conflicts: plan.conflicts, config: resolved })

    if (plan.conflicts.length === 0) {
      yield* d.log("Config is already healthy.", "success")
    } else {
      for (let i = 0; i < plan.conflicts.length; i++) {
        yield* d.log(
          `Healed ${plan.conflicts[i].field}: ${plan.conflicts[i].currentValue} → ${choices[i]}`,
          "info",
        )
      }
      yield* d.log("Config healed successfully.", "success")
    }
  }).pipe(
    Effect.catchTags({
      ConfigError: reportError,
      ConfigNotFoundError: reportError,
      ConfigMalformedError: reportError,
      ConfigValidationError: reportError,
      ConfigHealError: reportError,
      DiskFullError: reportError,
    }),
  ),
).pipe(
  Command.withDescription("Validate .pix/config.json and repair missing or incompatible values"),
  Command.withShortDescription("Validate and repair .pix/config.json"),
)

/**
 * Build the config namespace. Subcommands are supplied by the caller so cli.ts can provide layers
 * to the leaves while the unit tests pass raw leaves (whose services come from testLayer).
 */
export const makeConfigCommand = <const Subcommands extends readonly any[]>(
  subcommands: Subcommands,
) =>
  Command.make(
    "config",
    {},
    () => new CliError.ShowHelp({ commandPath: ["pix", "config"], errors: [] }),
  ).pipe(
    Command.withSubcommands(subcommands),
    Command.withDescription("Inspect and repair project-local pix configuration"),
    Command.withShortDescription("Manage and repair pix configuration"),
  )

/** Config namespace with raw leaves, used by unit tests. */
export const configCommand = makeConfigCommand([healCommand])
