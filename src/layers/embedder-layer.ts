import { NodeContext } from "@effect/platform-node"
import { Layer } from "effect"

import { OnnxEmbedderLive } from "../services/embedder.js"

/**
 * Layer for commands that need the Embedder (query, bench). Provides: Embedder, DeviceDetection,
 * ConfigStore, ModelRegistry, FileSystem (via NodeContext)
 */
export const EmbedderLayer = OnnxEmbedderLive.pipe(Layer.provide(NodeContext.layer))
