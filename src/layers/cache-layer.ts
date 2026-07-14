import { ClearEmbeddingCacheLive } from "../application/clear-embedding-cache.js"
import { commandLayer } from "./command-layer.js"
import { IndexStoreLayer } from "./index-store-layer.js"

/** Layer for embedding-cache maintenance commands. */
export const CacheLayer = commandLayer(ClearEmbeddingCacheLive, IndexStoreLayer)
