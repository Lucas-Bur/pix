import { ResetIndexLive } from "../application/reset-index.js"
import { commandLayer } from "./command-layer.js"
import { IndexStoreLayer } from "./index-store-layer.js"

/** Layer for `pix reset`: `ResetIndex` use case + `IndexStore` infra. */
export const ResetLayer = commandLayer(ResetIndexLive, IndexStoreLayer)
