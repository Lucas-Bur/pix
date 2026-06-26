import { NodeServices } from "@effect/platform-node"
import { Layer } from "effect"

import { IndexStoreLive } from "../services/index-store.js"

/**
 * Layer for commands that only need IndexStore (status, reset). Provides: IndexStore, ConfigStore,
 * ModelRegistry, FileSystem (via NodeServices)
 */
export const IndexStoreLayer = IndexStoreLive.pipe(Layer.provide(NodeServices.layer))
