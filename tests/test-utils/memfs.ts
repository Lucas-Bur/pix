import { layerWith, type FileTree } from "@lucas-bur/effect-memfs"

export const memoryFsLayer = (contents?: FileTree) => layerWith(contents ?? {})
