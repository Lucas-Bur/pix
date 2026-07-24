import { NodeServices, NodeStdio } from "@effect/platform-node"
import { Layer } from "effect"

import { GetStatusLive } from "../application/get-status.js"
import { IndexProjectLive } from "../application/index-project.js"
import { QueryProjectLive } from "../application/query-project.js"
import { McpDisplayLive } from "../mcp/display.js"
import { pixMcpStdioLayer } from "../mcp/server.js"
import { QueryAliasStoreLive } from "../services/query-alias-store.js"
import { VERSION } from "../version.js"
import { commandLayer } from "./command-layer.js"
import { FullInfraLayer } from "./full-infra-layer.js"

const QueryApplicationLive = commandLayer(
  Layer.mergeAll(IndexProjectLive, QueryProjectLive, GetStatusLive),
  Layer.merge(FullInfraLayer, QueryAliasStoreLive.pipe(Layer.provide(NodeServices.layer))),
)

/** Complete long-running stdio MCP server layer. */
const McpLayer = pixMcpStdioLayer(VERSION).pipe(
  Layer.provide(QueryApplicationLive),
  Layer.provide(McpDisplayLive),
  Layer.provide(NodeStdio.layer),
)

export default McpLayer
