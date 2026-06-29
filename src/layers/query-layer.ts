import { Layer } from "effect"

import { QueryProjectLive } from "../application/query-project.js"
import { commandLayer } from "./command-layer.js"
import { EmbedderLayer } from "./embedder-layer.js"
import { IndexStoreLayer } from "./index-store-layer.js"

/** Layer for `pix query`: `QueryProject` use case + `IndexStore` + `Embedder` infra. */
export const QueryLayer = commandLayer(
  QueryProjectLive,
  Layer.mergeAll(IndexStoreLayer, EmbedderLayer),
)
