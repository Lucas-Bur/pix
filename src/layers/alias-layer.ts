import { NodeServices } from "@effect/platform-node"
import { Layer } from "effect"

import { QueryProjectLive } from "../application/query-project.js"
import { ClipboardLive } from "../services/clipboard.js"
import { QueryAliasStoreLive } from "../services/query-alias-store.js"
import { commandLayer } from "./command-layer.js"
import { EmbedderLayer } from "./embedder-layer.js"
import { IndexStoreLayer } from "./index-store-layer.js"

/** Layer for query alias management and execution commands. */
export const AliasLayer = commandLayer(
  QueryProjectLive,
  Layer.mergeAll(
    IndexStoreLayer,
    EmbedderLayer,
    ClipboardLive.pipe(Layer.provide(NodeServices.layer)),
    QueryAliasStoreLive.pipe(Layer.provide(NodeServices.layer)),
  ),
)
