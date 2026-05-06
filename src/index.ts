import { NodeRuntime, NodeContext } from "@effect/platform-node"
import { Effect } from "effect"

import { cli } from "./cli.ts"

const VERSION = "0.1.0"

const mainLayer = NodeContext.layer

cli(process.argv, VERSION).pipe(Effect.provide(mainLayer), NodeRuntime.runMain)
