import { FileSystem } from "@effect/platform"
import { Effect, Layer } from "effect"
import ignore from "ignore"

import { ScanFailed } from "../domain/errors.js"
import type { ScanResult, SkippedEntry } from "../domain/ports.js"
import { Scanner } from "../domain/ports.js"

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  const readFileWithSkip = (
    path: string,
    mkReason: (error: unknown) => string,
  ): Effect.Effect<{ content: string; skipped: SkippedEntry | null }, never> =>
    fs.readFileString(path).pipe(
      Effect.map((content) => ({ content, skipped: null as SkippedEntry | null })),
      Effect.catchAll((error) =>
        Effect.succeed({
          content: "",
          skipped: { path, reason: mkReason(error) } satisfies SkippedEntry,
        }),
      ),
    )

  const readDirectoryWithSkip = (
    dir: string,
  ): Effect.Effect<{ entries: string[]; skipped: SkippedEntry | null }, never> =>
    fs.readDirectory(dir).pipe(
      Effect.map((entries) => ({ entries, skipped: null as SkippedEntry | null })),
      Effect.catchAll((error) =>
        Effect.succeed({
          entries: [] as string[],
          skipped: {
            path: dir,
            reason: `Could not read directory: ${String(error)}`,
          } satisfies SkippedEntry,
        }),
      ),
    )

  const statWithSkip = (fullPath: string) =>
    fs.stat(fullPath).pipe(
      Effect.map((info) => ({ info, skipped: null as SkippedEntry | null })),
      Effect.catchAll((error) =>
        Effect.succeed({
          info: null,
          skipped: {
            path: fullPath,
            reason: `Could not stat: ${String(error)}`,
          } satisfies SkippedEntry,
        }),
      ),
    )

  const loadGitignoreRules = (ignoredPaths: readonly string[]) =>
    Effect.gen(function* () {
      const ig = ignore()
      const cwd = process.cwd()
      const skipped: SkippedEntry[] = []

      // User-defined ignoredPaths (gitignore-style patterns)
      if (ignoredPaths.length > 0) {
        ig.add(ignoredPaths)
      }

      const rootContent = yield* readFileWithSkip(
        `${cwd}/.gitignore`,
        (error) => `Could not read gitignore: ${String(error)}`,
      )
      if (rootContent.skipped) skipped.push(rootContent.skipped)
      if (rootContent.content.trim()) {
        ig.add(rootContent.content.split("\n"))
      }

      const excludePath = `${cwd}/.git/info/exclude`
      const excludeExists = yield* fs.exists(excludePath)
      if (excludeExists) {
        const excludeContent = yield* readFileWithSkip(
          excludePath,
          (error) => `Could not read exclude file: ${String(error)}`,
        )
        if (excludeContent.skipped) skipped.push(excludeContent.skipped)
        if (excludeContent.content.trim()) {
          ig.add(excludeContent.content.split("\n"))
        }
      }

      return { ig, skipped }
    })

  const walk = (
    dir: string,
    ig: ReturnType<typeof ignore>,
    cwd: string,
  ): Effect.Effect<{ files: string[]; skipped: SkippedEntry[] }, never> =>
    Effect.gen(function* () {
      const result = yield* readDirectoryWithSkip(dir)

      let files: string[] = []
      const skipped: SkippedEntry[] = []
      if (result.skipped) skipped.push(result.skipped)

      for (const entry of result.entries) {
        const fullPath = `${dir}/${entry}`
        const info = yield* statWithSkip(fullPath)

        if (info.skipped) {
          skipped.push(info.skipped)
          continue
        }
        if (!info.info) continue

        if (info.info.type === "Directory") {
          const relativeDir = fullPath.startsWith(cwd) ? fullPath.slice(cwd.length + 1) : fullPath
          if (ig.ignores(relativeDir)) {
            skipped.push({ path: fullPath, reason: `Ignored by config pattern: ${relativeDir}` })
            continue
          }
          const sub = yield* walk(fullPath, ig, cwd)
          files.push(...sub.files)
          skipped.push(...sub.skipped)
        } else if (info.info.type === "File") {
          const relativePath = fullPath.startsWith(cwd) ? fullPath.slice(cwd.length + 1) : fullPath
          if (ig.ignores(relativePath)) {
            skipped.push({ path: fullPath, reason: `Ignored by config pattern: ${relativePath}` })
            continue
          }
          files.push(fullPath)
        }
      }
      return { files, skipped }
    })

  const scanFiles = (ignoredPaths: readonly string[]): Effect.Effect<ScanResult, ScanFailed> =>
    Effect.gen(function* () {
      const { ig, skipped: ignoreSkipped } = yield* loadGitignoreRules(ignoredPaths).pipe(
        Effect.mapError(
          (cause) =>
            new ScanFailed({
              message: `Failed to load gitignore rules: ${String(cause)}`,
              cause,
            }),
        ),
      )
      const cwd = process.cwd()

      const { files: paths, skipped: walkSkipped } = yield* walk(cwd, ig, cwd)

      const relativePaths = paths.map((p) => (p.startsWith(cwd) ? p.slice(cwd.length + 1) : p))
      const filtered = ig.filter(relativePaths)

      return {
        files: filtered.map((p) => `${cwd}/${p}`),
        skipped: [...ignoreSkipped, ...walkSkipped],
      }
    })

  return { scanFiles } as const
})

export const ScannerLive = Layer.effect(Scanner, make)
export { Scanner }
