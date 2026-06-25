import { NodeContext } from "@effect/platform-node"
import { Layer } from "effect"

import { ConfigStoreLive } from "../services/config-store.js"

/**
 * Layer for commands that only need ConfigStore (init, config, config heal). Provides: ConfigStore,
 * ModelRegistry, FileSystem (via NodeContext)
 */
export const ConfigLayer = ConfigStoreLive.pipe(Layer.provide(NodeContext.layer))
