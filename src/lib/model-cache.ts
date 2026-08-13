import { Config, Effect, Option, Path } from "effect"

/** Optional environment values used to resolve the Transformers model cache. */
export interface ModelCacheOptions {
  /** Project directory whose `.pix/cache` location should be resolved. */
  readonly projectRoot?: string
  /** Path style used for path semantics and cloud-storage handling. */
  readonly platform?: "posix" | "win32"
  /** Windows local application-data directory for cloud-backed projects. */
  readonly localAppData?: string
  /** OneDrive roots detected in the current environment. */
  readonly oneDriveRoots?: readonly string[]
}

const readOptionalEnv = (name: string): Effect.Effect<Option.Option<string>> =>
  Config.option(Config.string(name)).pipe(Effect.orElseSucceed(() => Option.none()))

const readOneDriveRoots = (): Effect.Effect<readonly string[]> =>
  Effect.all([
    readOptionalEnv("OneDrive"),
    readOptionalEnv("OneDriveCommercial"),
    readOptionalEnv("OneDriveConsumer"),
  ]).pipe(Effect.map((roots) => roots.flatMap((root) => (Option.isSome(root) ? [root.value] : []))))

const isPathWithin = (
  path: Path.Path,
  projectRoot: string,
  root: string,
  isWindows: boolean,
): boolean => {
  const project = path.resolve(projectRoot)
  const parent = path.resolve(root)
  const normalizedProject = isWindows ? project.toLowerCase() : project
  const normalizedParent = isWindows ? parent.toLowerCase() : parent
  const relative = path.relative(normalizedParent, normalizedProject)

  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
}

/**
 * Resolve the filesystem cache used by Transformers.js and ONNX Runtime.
 *
 * ONNX Runtime on Windows cannot load model files kept as OneDrive reparse points, even though
 * Node.js can read the same files. Keep ordinary projects self-contained, but place model files in
 * local application data when the project is below a configured OneDrive root.
 */
export const resolveTransformersCacheDir = (
  options: ModelCacheOptions = {},
): Effect.Effect<string, never, Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const isWindows = (options.platform ?? (path.sep === "\\" ? "win32" : "posix")) === "win32"
    const projectRoot = options.projectRoot ?? path.resolve()
    const projectCache = path.resolve(projectRoot, ".pix", "cache")

    if (
      !isWindows ||
      !(options.oneDriveRoots ?? (yield* readOneDriveRoots())).some((root) =>
        isPathWithin(path, projectRoot, root, isWindows),
      )
    ) {
      return projectCache
    }

    const localAppData =
      options.localAppData !== undefined
        ? Option.some(options.localAppData)
        : yield* readOptionalEnv("LOCALAPPDATA")
    const userProfile = yield* readOptionalEnv("USERPROFILE")
    const localRoot = Option.orElse(localAppData, () =>
      Option.map(userProfile, (profile) => path.join(profile, "AppData", "Local")),
    )

    return Option.match(localRoot, {
      onNone: () => projectCache,
      onSome: (root) => path.resolve(root, "pix", "transformers-cache"),
    })
  })
