import { Effect, Layer, Logger, Schema, Semaphore } from "effect"
import { McpServer, Tool, Toolkit } from "effect/unstable/ai"
import * as McpProtocol from "effect/unstable/ai/McpProtocol"

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
  description:
    "Semantic discovery search for the current repository. Use this first when exploring an unfamiliar codebase or locating files related to a concept in natural language. Start with noContent=true and a small top value, then inspect the returned files for exact source. Do not use this for exact identifier or literal-string lookup when the name is already known.",
  parameters: QueryRequestSchema,
  success: QueryResponseSchema,
  failure: Schema.String,
  dependencies: [IndexProject, QueryProject],
})
  .annotate(Tool.Title, "Semantic Repository Discovery")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)

const StatusTool = Tool.make("status", {
  description:
    "Return metadata about the current pix index, including indexed files, chunks, size, and the embedding model. Use this to check whether the repository has an index before searching or refreshing it.",
  success: StatusResultSchema,
  failure: Schema.String,
  dependencies: [GetStatus],
})
  .annotate(Tool.Title, "Pix Index Status")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)

const IndexTool = Tool.make("index", {
  description:
    "Refresh the current repository's pix index after source changes or before deliberate pre-warming. This is usually not required before query because query refreshes stale indexes automatically.",
  parameters: IndexRequestSchema,
  success: IndexResponseSchema,
  failure: Schema.String,
  dependencies: [IndexProject],
})
  .annotate(Tool.Title, "Refresh Pix Index")
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)

const AliasListTool = Tool.make("alias_list", {
  description:
    "List all saved pix query aliases. Use this to discover reusable named searches before constructing a new query.",
  success: Schema.Array(QueryAliasSchema),
  failure: Schema.String,
  dependencies: [QueryAliasStore],
})
  .annotate(Tool.Title, "List Saved Query Aliases")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)

const AliasAddTool = Tool.make("alias_add", {
  description:
    "Create or replace a saved pix query alias. Use aliases for recurring searches with stable query options; this changes the project's .pix/aliases.json file.",
  parameters: AliasAddRequestSchema,
  success: QueryAliasSchema,
  failure: Schema.String,
  dependencies: [QueryAliasStore],
})
  .annotate(Tool.Title, "Save Query Alias")
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, false)

const AliasRemoveTool = Tool.make("alias_remove", {
  description:
    "Remove a saved pix query alias by name. Use only when the alias is no longer needed; this permanently changes the project's saved alias registry.",
  parameters: AliasNameRequestSchema,
  success: AliasRemoveResponseSchema,
  failure: Schema.String,
  dependencies: [QueryAliasStore],
})
  .annotate(Tool.Title, "Remove Query Alias")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, false)

const AliasRunTool = Tool.make("alias_run", {
  description:
    "Run a saved pix query alias and optionally override its retrieval options for this call. Use this for a known reusable search; use query for new semantic discovery.",
  parameters: AliasRunRequestSchema,
  success: QueryResponseSchema,
  failure: Schema.String,
  dependencies: [QueryAliasStore, IndexProject, QueryProject],
})
  .annotate(Tool.Title, "Run Saved Query Alias")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)

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
          return yield* toToolFailure(getStatus.getStatus)
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
    Layer.provide(
      McpServer.layerStdio({ name: "pix", version, protocols: [McpProtocol.v2025_06_18] }),
    ),
    Layer.provide(Layer.succeed(Logger.LogToStderr)(true)),
  )
