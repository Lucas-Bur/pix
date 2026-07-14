import { NodeServices } from "@effect/platform-node"
import { Layer } from "effect"

import { IndexProjectLive } from "../application/index-project.js"
import { QueryProjectLive } from "../application/query-project.js"
import { ClipboardLive } from "../services/clipboard.js"
import { commandLayer } from "./command-layer.js"
import { FullInfraLayer } from "./full-infra-layer.js"

/** Layer for `pix query`: `QueryProject` use case + `IndexStore` + `Embedder` infra. */
export const QueryLayer = commandLayer(
  Layer.merge(QueryProjectLive, IndexProjectLive),
  Layer.mergeAll(FullInfraLayer, ClipboardLive.pipe(Layer.provide(NodeServices.layer))),
)
