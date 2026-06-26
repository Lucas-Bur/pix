import { NodeServices } from "@effect/platform-node"
import { Layer } from "effect"

import { ConfigStoreLive } from "../services/config-store.js"

/**
 * Layer for commands that only need ConfigStore (init, config, config heal). Provides: ConfigStore,
 * ModelRegistry, FileSystem (via NodeServices)
 */
export const ConfigLayer = ConfigStoreLive.pipe(Layer.provide(NodeServices.layer))
