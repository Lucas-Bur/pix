import { Effect, Layer, Option } from "effect"
import { FileSystem } from "effect/FileSystem"
import ignore from "ignore"

import type { ScanResult, ScannedFile, SkippedEntry } from "../domain/ports.js"
import { Scanner } from "../domain/ports.js"

const make = Effect.gen(function* () {
  const fs = yield* FileSystem

  const readFileWithSkip = (
    path: string,
    mkReason: (error: unknown) => string,
  ): Effect.Effect<{ content: string; skipped: SkippedEntry | null }, never> =>
    fs.readFileString(path).pipe(
      Effect.map((content) => ({ content, skipped: null })),
      Effect.catch((error) =>
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
      Effect.map((entries) => ({ entries, skipped: null })),
      Effect.catch((error) =>
        Effect.succeed<{ entries: string[]; skipped: SkippedEntry }>({
          entries: [],
          skipped: {
            path: dir,
            reason: `Could not read directory: ${String(error)}`,
          },
        }),
      ),
    )

  const statWithSkip = (fullPath: string) =>
    fs.stat(fullPath).pipe(
      Effect.map((info) => ({ info, skipped: null })),
      Effect.catch((error) =>
        Effect.succeed({
          info: null,
          skipped: {
            path: fullPath,
            reason: `Could not stat: ${String(error)}`,
          } satisfies SkippedEntry,
        }),
      ),
    )

  const computeRelative = (fullPath: string, cwd: string): string =>
    fullPath.startsWith(cwd) ? fullPath.slice(cwd.length + 1) : fullPath

  const loadIgnoreFile = (
    filePath: string,
    ig: ReturnType<typeof ignore>,
    skipped: SkippedEntry[],
  ): Effect.Effect<void, never> =>
    Effect.gen(function* () {
      const result = yield* readFileWithSkip(
        filePath,
        (error) => `Could not read ignore file: ${String(error)}`,
      )
      if (result.skipped) skipped.push(result.skipped)
      if (result.content.trim()) {
        ig.add(result.content.split("\n"))
      }
    })

  const loadGitignoreRules = (
    ignoredPaths: readonly string[],
  ): Effect.Effect<{ ig: ReturnType<typeof ignore>; skipped: SkippedEntry[] }, never> => {
    const ig = ignore()
    const skipped: SkippedEntry[] = []

    if (ignoredPaths.length > 0) {
      ig.add(ignoredPaths)
    }

    return Effect.succeed({ ig, skipped })
  }

  const loadGitignoreRulesWithFiles = (
    ignoredPaths: readonly string[],
    cwd: string,
  ): Effect.Effect<{ ig: ReturnType<typeof ignore>; skipped: SkippedEntry[] }, never> =>
    Effect.gen(function* () {
      const ig = ignore()
      const skipped: SkippedEntry[] = []

      if (ignoredPaths.length > 0) {
        ig.add(ignoredPaths)
      }

      const gitignorePath = `${cwd}/.gitignore`
      const gitignoreExists = yield* fs
        .exists(gitignorePath)
        .pipe(Effect.orElseSucceed(() => false))
      if (gitignoreExists) {
        yield* loadIgnoreFile(gitignorePath, ig, skipped)
      }

      const excludePath = `${cwd}/.git/info/exclude`
      const excludeExists = yield* fs.exists(excludePath).pipe(Effect.orElseSucceed(() => false))
      if (excludeExists) {
        yield* loadIgnoreFile(excludePath, ig, skipped)
      }

      return { ig, skipped }
    })

  const processEntry = (
    entry: string,
    dir: string,
    ig: ReturnType<typeof ignore>,
    cwd: string,
  ): Effect.Effect<
    | { files: ScannedFile[]; skipped: SkippedEntry[]; recurse?: false }
    | { files: ScannedFile[]; skipped: SkippedEntry[]; recurse: true },
    never
  > =>
    Effect.gen(function* () {
      const fullPath = `${dir}/${entry}`
      const statResult = yield* statWithSkip(fullPath)

      if (statResult.skipped) {
        return { files: [], skipped: [statResult.skipped] }
      }
      if (!statResult.info) {
        return { files: [], skipped: [] }
      }

      const info = statResult.info

      if (info.type === "Directory") {
        const relativeDir = computeRelative(fullPath, cwd)
        if (ig.ignores(relativeDir)) {
          return {
            files: [],
            skipped: [{ path: fullPath, reason: `Ignored by config pattern: ${relativeDir}` }],
          }
        }
        return { files: [], skipped: [], recurse: true as const }
      }

      if (info.type === "File") {
        const relativePath = computeRelative(fullPath, cwd)
        if (ig.ignores(relativePath)) {
          return {
            files: [],
            skipped: [{ path: fullPath, reason: `Ignored by config pattern: ${relativePath}` }],
          }
        }
        return {
          files: [
            {
              path: fullPath,
              mtimeMs: Option.match(info.mtime, {
                onNone: () => 0,
                onSome: (mtime) => mtime.getTime(),
              }),
              size: Number(info.size),
            },
          ],
          skipped: [],
        }
      }

      return { files: [], skipped: [] }
    })

  const walk = (
    dir: string,
    ig: ReturnType<typeof ignore>,
    cwd: string,
  ): Effect.Effect<{ files: ScannedFile[]; skipped: SkippedEntry[] }, never> =>
    Effect.gen(function* () {
      const result = yield* readDirectoryWithSkip(dir)

      let files: ScannedFile[] = []
      const skipped: SkippedEntry[] = []
      if (result.skipped) skipped.push(result.skipped)

      for (const entry of result.entries) {
        const entryResult = yield* processEntry(entry, dir, ig, cwd)
        files.push(...entryResult.files)
        skipped.push(...entryResult.skipped)

        if ("recurse" in entryResult) {
          const sub = yield* walk(`${dir}/${entry}`, ig, cwd)
          files.push(...sub.files)
          skipped.push(...sub.skipped)
        }
      }

      return { files, skipped }
    })

  const scanFiles = (
    ignoredPaths: readonly string[],
    ignoreGitignore?: boolean,
  ): Effect.Effect<ScanResult, never> =>
    Effect.gen(function* () {
      const cwd = process.cwd()

      const { ig, skipped: ignoreSkipped } = yield* ignoreGitignore
        ? loadGitignoreRules(ignoredPaths)
        : loadGitignoreRulesWithFiles(ignoredPaths, cwd)

      const { files, skipped: walkSkipped } = yield* walk(cwd, ig, cwd)

      return {
        files,
        skipped: [...ignoreSkipped, ...walkSkipped],
      }
    })

  return { scanFiles } as const
})

export const ScannerLive = Layer.effect(Scanner, make)
