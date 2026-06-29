import { GetStatusLive } from "../application/get-status.js"
import { commandLayer } from "./command-layer.js"
import { IndexStoreLayer } from "./index-store-layer.js"

/** Layer for `pix status`: `GetStatus` use case + `IndexStore` infra. */
export const StatusLayer = commandLayer(GetStatusLive, IndexStoreLayer)
