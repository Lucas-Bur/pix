import { Effect, Layer, Logger, Schema, Semaphore } from "effect"
import { McpServer, Tool, Toolkit } from "effect/unstable/ai"

import { GetStatus } from "../application/get-status.js"
import { IndexProject } from "../application/index-project.js"
import { addAlias, listAliases, removeAlias, runAlias } from "../application/query-aliases.js"
import { QueryProject } from "../application/query-project.js"
import { runIndex } from "../application/run-index.js"
import { runQuery } from "../application/run-query.js"
import { IndexRequestSchema, IndexResponseSchema } from "../domain/index.js"
import { QueryAliasStore } from "../domain/ports.js"
import {
  AliasAddRequestSchema,
  AliasNameRequestSchema,
  AliasRemoveResponseSchema,
  AliasRunRequestSchema,
  QueryAliasSchema,
} from "../domain/query-alias.js"
import { QueryRequestSchema, QueryResponseSchema } from "../domain/query.js"
import { StatusResultSchema } from "../domain/status.js"

const QueryTool = Tool.make("query", {
  description: "Search the current project with pix",
  parameters: QueryRequestSchema,
  success: QueryResponseSchema,
  failure: Schema.String,
  dependencies: [IndexProject, QueryProject],
}).annotate(Tool.Readonly, true)

const StatusTool = Tool.make("status", {
  description: "Return the current pix index status",
  success: StatusResultSchema,
  failure: Schema.String,
  dependencies: [GetStatus],
}).annotate(Tool.Readonly, true)

const IndexTool = Tool.make("index", {
  description: "Refresh the pix index for the current project",
  parameters: IndexRequestSchema,
  success: IndexResponseSchema,
  failure: Schema.String,
  dependencies: [IndexProject],
}).annotate(Tool.Idempotent, true)

const AliasListTool = Tool.make("alias_list", {
  description: "List saved pix query aliases",
  success: Schema.Array(QueryAliasSchema),
  failure: Schema.String,
  dependencies: [QueryAliasStore],
}).annotate(Tool.Readonly, true)

const AliasAddTool = Tool.make("alias_add", {
  description: "Create or replace a pix query alias",
  parameters: AliasAddRequestSchema,
  success: QueryAliasSchema,
  failure: Schema.String,
  dependencies: [QueryAliasStore],
}).annotate(Tool.Idempotent, true)

const AliasRemoveTool = Tool.make("alias_remove", {
  description: "Remove a saved pix query alias",
  parameters: AliasNameRequestSchema,
  success: AliasRemoveResponseSchema,
  failure: Schema.String,
  dependencies: [QueryAliasStore],
}).annotate(Tool.Destructive, true)

const AliasRunTool = Tool.make("alias_run", {
  description: "Run a saved pix query alias with optional overrides",
  parameters: AliasRunRequestSchema,
  success: QueryResponseSchema,
  failure: Schema.String,
  dependencies: [QueryAliasStore, IndexProject, QueryProject],
}).annotate(Tool.Readonly, true)

const PixToolkit = Toolkit.make(
  QueryTool,
  StatusTool,
  IndexTool,
  AliasListTool,
  AliasAddTool,
  AliasRemoveTool,
  AliasRunTool,
)

const toToolFailure = <A, E extends { readonly message: string }, R>(
  effect: Effect.Effect<A, E, R>,
) => effect.pipe(Effect.mapError((error) => error.message))

const QueryToolHandlersLive = PixToolkit.toLayer(
  Effect.gen(function* () {
    const querySemaphore = yield* Semaphore.make(1)
    return {
      query: (request: typeof QueryRequestSchema.Type) =>
        querySemaphore.withPermits(1)(toToolFailure(runQuery(request))),
      status: () =>
        Effect.gen(function* () {
          const getStatus = yield* GetStatus
          return yield* toToolFailure(getStatus.getStatus())
        }),
      index: (request: typeof IndexRequestSchema.Type) =>
        querySemaphore.withPermits(1)(toToolFailure(runIndex(request))),
      alias_list: () => toToolFailure(listAliases),
      alias_add: (request: typeof AliasAddRequestSchema.Type) =>
        querySemaphore.withPermits(1)(toToolFailure(addAlias(request))),
      alias_remove: (request: typeof AliasNameRequestSchema.Type) =>
        querySemaphore.withPermits(1)(toToolFailure(removeAlias(request))),
      alias_run: (request: typeof AliasRunRequestSchema.Type) =>
        querySemaphore.withPermits(1)(toToolFailure(runAlias(request))),
    }
  }),
)

/** MCP tool registration backed by pix application use cases. */
export const PixMcpToolsLive = McpServer.toolkit(PixToolkit).pipe(
  Layer.provideMerge(QueryToolHandlersLive),
)

/** Build the stdio MCP layer while leaving application services and `Stdio` injectable. */
export const pixMcpStdioLayer = (version: string) =>
  PixMcpToolsLive.pipe(
    Layer.provide(McpServer.layerStdio({ name: "pix", version })),
    Layer.provide(Layer.succeed(Logger.LogToStderr)(true)),
  )
