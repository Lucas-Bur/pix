import { FileSystem } from "@effect/platform"
import { Effect, Layer } from "effect"
import ignore from "ignore"

import { Scanner } from "../domain/ports.js"

const ALWAYS_IGNORE = new Set([".pix", "node_modules", ".git", "dist", "build", ".next"])

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  const loadGitignoreRules = Effect.gen(function* () {
    const ig = ignore()
    const cwd = process.cwd()

    const rootContent = yield* fs
      .readFileString(`${cwd}/.gitignore`)
      .pipe(Effect.catchAll(() => Effect.succeed("")))
    if (rootContent.trim()) {
      ig.add(rootContent.split("\n"))
    }

    const excludePath = `${cwd}/.git/info/exclude`
    const excludeExists = yield* fs.exists(excludePath)
    if (excludeExists) {
      const excludeContent = yield* fs
        .readFileString(excludePath)
        .pipe(Effect.catchAll(() => Effect.succeed("")))
      if (excludeContent.trim()) {
        ig.add(excludeContent.split("\n"))
      }
    }

    return ig
  }).pipe(Effect.catchAll(() => Effect.succeed(ignore())))

  const walk = (dir: string, extensions: ReadonlySet<string>): Effect.Effect<string[], never> =>
    Effect.gen(function* () {
      const entries = yield* fs
        .readDirectory(dir)
        .pipe(Effect.catchAll(() => Effect.succeed([] as string[])))

      let results: string[] = []
      for (const entry of entries) {
        if (ALWAYS_IGNORE.has(entry)) continue

        const fullPath = `${dir}/${entry}`
        const info = yield* fs.stat(fullPath).pipe(Effect.catchAll(() => Effect.succeed(null)))

        if (!info) continue

        if (info.type === "Directory") {
          const subResults = yield* walk(fullPath, extensions)
          results.push(...subResults)
        } else if (info.type === "File") {
          const dotIndex = entry.lastIndexOf(".")
          if (dotIndex === -1) continue
          const ext = entry.slice(dotIndex)
          if (extensions.has(ext)) {
            results.push(fullPath)
          }
        }
      }
      return results
    })

  const scanFiles = (extensions: readonly string[]): Effect.Effect<string[], never> =>
    Effect.gen(function* () {
      const ig = yield* loadGitignoreRules
      const cwd = process.cwd()

      const extSet = new Set(extensions)
      const paths = yield* walk(cwd, extSet)

      const relativePaths = paths.map((p) => (p.startsWith(cwd) ? p.slice(cwd.length + 1) : p))
      const filtered = ig.filter(relativePaths)

      return filtered.map((p) => `${cwd}/${p}`)
    })

  return { scanFiles } as const
})

export const ScannerLive = Layer.effect(Scanner, make)
export { Scanner }
