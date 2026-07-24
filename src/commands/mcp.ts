import { Effect, Layer } from "effect"
import { Command } from "effect/unstable/cli"

/** CLI command that runs the host-managed MCP stdio server until stdin closes. */
export const mcpCommand = Command.make("mcp", {}, () =>
  Effect.promise(() => import("../layers/mcp-layer.js")).pipe(
    Effect.flatMap((module) => Layer.launch(module.default)),
  ),
)
