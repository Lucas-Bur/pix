import { MemoryFileSystem } from "effect-memfs"

export const memoryFsLayer = (contents?: MemoryFileSystem.Contents) =>
  MemoryFileSystem.layerWith(contents ?? {})
