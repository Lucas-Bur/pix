import { NodeContext } from "@effect/platform-node"
import { Layer } from "effect"
import { MemoryFileSystem } from "effect-memfs"

export const memoryFsLayer = (contents?: MemoryFileSystem.Contents) =>
  Layer.mergeAll(MemoryFileSystem.layerWith(contents ?? {}), NodeContext.layer)
