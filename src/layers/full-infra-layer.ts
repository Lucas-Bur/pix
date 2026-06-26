import { NodeServices } from "@effect/platform-node"
import { Layer } from "effect"

import { ChunkerLive } from "../services/chunker.js"
import { ContentExtractorLive } from "../services/content-extractor.js"
import { ScannerLive } from "../services/scanner.js"
import { ConfigLayer } from "./config-layer.js"
import { EmbedderLayer } from "./embedder-layer.js"
import { IndexStoreLayer } from "./index-store-layer.js"

/**
 * Full infrastructure layer for the index command. Provides: Scanner, ContentExtractor, Chunker,
 * Embedder, IndexStore, ConfigStore, ModelRegistry, DeviceDetection, FileSystem (via NodeServices)
 */
export const FullInfraLayer = Layer.mergeAll(
  IndexStoreLayer,
  EmbedderLayer,
  ScannerLive.pipe(Layer.provide(NodeServices.layer)),
  ContentExtractorLive.pipe(Layer.provide(NodeServices.layer)),
  ChunkerLive.pipe(Layer.provide(Layer.merge(ConfigLayer, NodeServices.layer))),
)
