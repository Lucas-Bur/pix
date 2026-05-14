import { FileSystem } from "@effect/platform"
import { Effect, Layer } from "effect"
import ignore from "ignore"

import { ScanFailed } from "../domain/errors.js"
import type { ScanResult, SkippedEntry } from "../domain/ports.js"
import { Scanner } from "../domain/ports.js"

const ALWAYS_IGNORE = new Set([".pix", "node_modules", ".git", "dist", "build", ".next"])

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  const loadGitignoreRules = Effect.gen(function* () {
    const ig = ignore()
    const cwd = process.cwd()
    const skipped: SkippedEntry[] = []

    const rootContent = yield* fs.readFileString(`${cwd}/.gitignore`).pipe(
      Effect.map((content) => ({ content, skipped: null })),
      Effect.catchAll((error) =>
        Effect.succeed({
          content: "",
          skipped: {
            path: `${cwd}/.gitignore`,
            reason: `Could not read gitignore: ${String(error)}`,
          } satisfies SkippedEntry,
        }),
      ),
    )
    if (rootContent.skipped) skipped.push(rootContent.skipped)
    if (rootContent.content.trim()) {
      ig.add(rootContent.content.split("\n"))
    }

    const excludePath = `${cwd}/.git/info/exclude`
    const excludeExists = yield* fs.exists(excludePath)
    if (excludeExists) {
      const excludeContent = yield* fs.readFileString(excludePath).pipe(
        Effect.map((content) => ({ content, skipped: null })),
        Effect.catchAll((error) =>
          Effect.succeed({
            content: "",
            skipped: {
              path: excludePath,
              reason: `Could not read exclude file: ${String(error)}`,
            } satisfies SkippedEntry,
          }),
        ),
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
    extensions: ReadonlySet<string>,
  ): Effect.Effect<{ files: string[]; skipped: SkippedEntry[] }, never> =>
    Effect.gen(function* () {
      const result = yield* fs.readDirectory(dir).pipe(
        Effect.map((entries) => ({ entries, skipped: null })),
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

      let files: string[] = []
      const skipped: SkippedEntry[] = []
      if (result.skipped) skipped.push(result.skipped)

      for (const entry of result.entries) {
        if (ALWAYS_IGNORE.has(entry)) continue

        const fullPath = `${dir}/${entry}`
        const info = yield* fs.stat(fullPath).pipe(
          Effect.map((info) => ({ info, skipped: null })),
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

        if (info.skipped) {
          skipped.push(info.skipped)
          continue
        }
        if (!info.info) continue

        if (info.info.type === "Directory") {
          const sub = yield* walk(fullPath, extensions)
          files.push(...sub.files)
          skipped.push(...sub.skipped)
        } else if (info.info.type === "File") {
          const dotIndex = entry.lastIndexOf(".")
          if (dotIndex === -1) continue
          const ext = entry.slice(dotIndex)
          if (extensions.has(ext)) {
            files.push(fullPath)
          }
        }
      }
      return { files, skipped }
    })

  const scanFiles = (extensions: readonly string[]): Effect.Effect<ScanResult, ScanFailed> =>
    Effect.gen(function* () {
      const { ig, skipped: ignoreSkipped } = yield* loadGitignoreRules.pipe(
        Effect.mapError(
          (cause) =>
            new ScanFailed({
              message: `Failed to load gitignore rules: ${String(cause)}`,
              cause,
            }),
        ),
      )
      const cwd = process.cwd()

      const extSet = new Set(extensions)
      const { files: paths, skipped: walkSkipped } = yield* walk(cwd, extSet)

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
