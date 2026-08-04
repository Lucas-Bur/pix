import { execFile } from "node:child_process"
import { mkdir, readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import { Effect, Schema } from "effect"

import { CorpusManifestSchema, type CorpusManifest } from "../evaluation/types.js"

const execFilePromise = promisify(execFile)
const CACHE_ROOT = path.resolve("benchmarks/.cache/repos")

const runGit = (args: readonly string[]): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    try: () => execFilePromise("git", [...args], { maxBuffer: 64 * 1024 * 1024 }),
    catch: (cause) => new Error(`git ${args.join(" ")} failed`, { cause }),
  }).pipe(Effect.map((result) => result.stdout))

const fetchRevision = (destination: string, revision: string): Effect.Effect<string, Error> =>
  runGit(["-C", destination, "fetch", "--depth=1", "origin", revision]).pipe(
    Effect.catch(() =>
      runGit(["-C", destination, "fetch", "--all", "--tags", "--unshallow"]).pipe(
        Effect.catch(() => runGit(["-C", destination, "fetch", "--all", "--tags"])),
      ),
    ),
  )

/** Load and validate every authored corpus manifest in deterministic filename order. */
export const loadCorpusManifests = (): Effect.Effect<readonly CorpusManifest[], Error> =>
  Effect.gen(function* () {
    const names = yield* Effect.tryPromise({
      try: () =>
        readdir(path.resolve("benchmarks/corpus"), { withFileTypes: true }).then((entries) =>
          entries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
            .map((entry) => entry.name)
            .sort(),
        ),
      catch: (cause) => new Error("Could not list corpus manifests", { cause }),
    })
    return yield* Effect.forEach(names, (name) =>
      Effect.tryPromise({
        try: () => readFile(path.resolve("benchmarks/corpus", name), "utf8"),
        catch: (cause) => new Error(`Could not read corpus manifest ${name}`, { cause }),
      }).pipe(
        Effect.flatMap((text) =>
          Effect.try({
            try: () => Schema.decodeUnknownSync(CorpusManifestSchema)(JSON.parse(text)),
            catch: (cause) => new Error(`Invalid corpus manifest ${name}`, { cause }),
          }),
        ),
      ),
    )
  })

/** Clone or refresh one benchmark repository and check out its pinned revision. */
export const prepareRepository = (manifest: CorpusManifest): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdir(CACHE_ROOT, { recursive: true }),
      catch: (cause) => new Error("Could not create benchmark repository cache", { cause }),
    })
    const destination = path.join(CACHE_ROOT, manifest.id)
    const exists = yield* Effect.tryPromise({
      try: () => readFile(path.join(destination, ".git", "HEAD"), "utf8").then(() => true),
      catch: () => new Error("missing"),
    }).pipe(Effect.catch(() => Effect.succeed(false)))
    if (!exists) {
      yield* runGit([
        "clone",
        "--filter=blob:none",
        "--no-checkout",
        manifest.repository,
        destination,
      ])
    }
    yield* fetchRevision(destination, manifest.revision)
    yield* runGit(["-C", destination, "checkout", "--detach", manifest.revision])
    return destination
  })

/** List source files selected by a corpus manifest from the pinned Git checkout. */
export const listCorpusFiles = (
  repositoryPath: string,
  manifest: CorpusManifest,
): Effect.Effect<readonly string[], Error> =>
  runGit(["-C", repositoryPath, "ls-files", "-z"]).pipe(
    Effect.map((output) =>
      output
        .split("\0")
        .filter((file) => file !== "")
        .filter((file) => manifest.includeRoots.some((root) => file.startsWith(root)))
        .filter((file) => !manifest.excludePaths.some((excluded) => file.startsWith(excluded)))
        .filter((file) => manifest.extensions.some((extension) => file.endsWith(extension)))
        .sort(),
    ),
  )
