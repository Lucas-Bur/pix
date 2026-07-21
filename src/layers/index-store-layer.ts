import { NodeServices } from "@effect/platform-node"
import { Layer } from "effect"

import { SqliteIndexStoreLive } from "../services/sqlite-index-store.js"

/**
 * Layer for commands that only need IndexStore (status, reset). Provides: IndexStore, ConfigStore,
 * ModelRegistry, FileSystem (via NodeServices)
 */
export const IndexStoreLayer = SqliteIndexStoreLive.pipe(Layer.provide(NodeServices.layer))
