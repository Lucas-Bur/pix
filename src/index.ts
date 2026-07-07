import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"

import { cli } from "./cli.js"
import { setupTerminalCleanup } from "./display/terminalCleanup.js"

const { effect, displayLayer } = cli(process.argv)
const cliLayer = displayLayer.pipe(Layer.provide(NodeServices.layer))
setupTerminalCleanup()

/** Default layer for help / no-subcommand / unknown commands: Display + NodeServices. */
const runDefault = effect.pipe(Effect.provide(Layer.mergeAll(cliLayer, NodeServices.layer)))

/**
 * Load a command layer lazily, fold `cliLayer` in, and run the effect against it. Generic per call
 * so each command's concrete layer type is inferred -- the return type is inferred too, so the
 * requirement-satisfaction algebra (effect reqs minus layer outputs) resolves concretely per arm
 * instead of being forced through a generic `never`.
 */
const runWith = <RIn, E, ROut>(load: () => Promise<Layer.Layer<ROut, E, RIn>>) =>
  Effect.gen(function* () {
    const layer = yield* Effect.promise(load)
    return yield* effect.pipe(Effect.provide(layer.pipe(Layer.provideMerge(cliLayer))))
  })

const subcommand = process.argv[2]
const wantsHelp = process.argv.some((a) => a === "--help" || a === "-h")

const main = Effect.gen(function* () {
  if (wantsHelp || subcommand === undefined) {
    return yield* runDefault
  }
  switch (subcommand) {
    case "status":
      return yield* runWith(() => import("./layers/status-layer.js").then((m) => m.StatusLayer))
    case "reset":
      return yield* runWith(() => import("./layers/reset-layer.js").then((m) => m.ResetLayer))
    case "init":
      return yield* runWith(() => import("./layers/init-layer.js").then((m) => m.InitLayer))
    case "query":
      return yield* runWith(() => import("./layers/query-layer.js").then((m) => m.QueryLayer))
    case "index":
      return yield* runWith(() => import("./layers/index-layer.js").then((m) => m.IndexLayer))
    case "bench":
      return yield* runWith(() => import("./layers/bench-layer.js").then((m) => m.BenchLayer))
    case "config":
      return yield* runWith(() =>
        import("./layers/config-heal-layer.js").then((m) => m.ConfigHealLayer),
      )
    case "alias":
    case "run":
      return yield* runWith(() => import("./layers/alias-layer.js").then((m) => m.AliasLayer))
    default:
      return yield* runDefault
  }
})

NodeRuntime.runMain(main)
