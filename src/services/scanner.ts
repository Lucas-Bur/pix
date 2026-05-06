import { FileSystem } from "@effect/platform"
import { Effect, Layer } from "effect"
import fg from "fast-glob"
import ignore from "ignore"

import { Scanner } from "../domain/ports.js"

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  /** Loads all gitignore patterns from .gitignore files in the repo. */
  const loadGitignoreRules = Effect.gen(function* () {
    const ig = ignore()
    const cwd = process.cwd()

    // Load repo-root .gitignore
    const rootContent = yield* fs
      .readFileString(`${cwd}/.gitignore`)
      .pipe(Effect.catchAll(() => Effect.succeed("")))
    if (rootContent.trim()) {
      ig.add(rootContent.split("\n"))
    }

    // Load .git/info/exclude (local repo rules, same as .gitignore)
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

  const scanFiles = (extensions: readonly string[]): Effect.Effect<string[], never> =>
    Effect.gen(function* () {
      const ig = yield* loadGitignoreRules
      const cwd = process.cwd()

      const pattern = extensions.map((ext: string) => `**/*${ext}`)
      const absolutePaths = yield* Effect.tryPromise(() => fg(pattern, { dot: false })).pipe(
        Effect.catchAll(() => Effect.succeed([] as string[])),
      )

      // Filter through gitignore rules — paths must be relative to cwd
      const relativePaths = absolutePaths.map((p) => {
        // Strip cwd prefix to get relative path
        return p.startsWith(cwd) ? p.slice(cwd.length + 1) : p
      })
      const filtered = ig.filter(relativePaths)

      // Re-attach cwd to get absolute paths for return
      return filtered.map((p) => `${cwd}/${p}`)
    })

  return { scanFiles } as const
})

export const ScannerLive = Layer.effect(Scanner, make)
export { Scanner }
