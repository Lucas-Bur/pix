import { NodeServices } from "@effect/platform-node"
import { Layer } from "effect"

import { ChunkerLive } from "../services/chunker.js"
import { ContentExtractorLive } from "../services/content-extractor.js"
import { IdentifierExtractorLive } from "../services/identifier-extractor.js"
import { ScannerLive } from "../services/scanner.js"
import { SparseEmbedderLive } from "../services/sparse-embedder.js"
import { EmbedderLayer } from "./embedder-layer.js"
import { IndexStoreLayer } from "./index-store-layer.js"

/**
 * Full infrastructure layer for the index command. Provides: Scanner, ContentExtractor, Chunker,
 * Embedder, IndexStore, IdentifierExtractor, ConfigStore, ModelRegistry, DeviceDetection,
 * FileSystem (via NodeServices)
 */
export const FullInfraLayer = Layer.mergeAll(
  IndexStoreLayer,
  EmbedderLayer,
  SparseEmbedderLive.pipe(Layer.provide(NodeServices.layer)),
  ScannerLive.pipe(Layer.provide(NodeServices.layer)),
  ContentExtractorLive.pipe(Layer.provide(NodeServices.layer)),
  ChunkerLive.pipe(Layer.provide(NodeServices.layer)),
  IdentifierExtractorLive,
)
