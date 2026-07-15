import { layer as makeMemoryFs, type FileTree } from "@lucas-bur/effect-memfs"

const nestFlatPaths = (contents: FileTree): FileTree => {
  const result: FileTree = {}

  for (const [path, value] of Object.entries(contents)) {
    const segments = path.replaceAll("\\", "/").split("/").filter(Boolean)
    let current = result

    for (const segment of segments.slice(0, -1)) {
      const existing = current[segment]
      if (existing === null || typeof existing === "string") {
        throw new Error(`Cannot nest fixture path beneath file: ${path}`)
      }
      current = existing ?? (current[segment] = {})
    }

    const name = segments.at(-1)
    if (name !== undefined) {
      current[name] = typeof value === "object" && value !== null ? nestFlatPaths(value) : value
    }
  }

  return result
}

export const memoryFsLayer = (contents: FileTree = {}) =>
  makeMemoryFs(nestFlatPaths(contents), { cwd: process.cwd() })
