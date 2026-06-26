import { Effect } from "effect"
import { FileSystem } from "effect/FileSystem"

import { ConfigError, DiskFullError, StoreError } from "../../domain/errors.js"
import { isPlatformReason } from "./platform-error.js"

/** Map a platform error to DiskFullError or StoreError. */
const toFsError =
  (operation: string, path?: string) =>
  (cause: unknown): DiskFullError | StoreError => {
    if (isPlatformReason(cause, "BadResource")) {
      return new DiskFullError({ message: `Disk full during ${operation}`, path, cause })
    }
    return new StoreError({ message: `Failed to ${operation}`, path, cause })
  }

/** Map a platform error to StoreError only (read-only operations). */
const toReadError =
  (operation: string, path?: string) =>
  (cause: unknown): StoreError =>
    new StoreError({ message: `Failed to ${operation}`, path, cause })

/** Wrap any fs Effect so failures become DiskFullError | StoreError. */
export const withFsError = <A>(
  op: Effect.Effect<A, unknown>,
  operation: string,
  path?: string,
): Effect.Effect<A, DiskFullError | StoreError> =>
  op.pipe(Effect.mapError(toFsError(operation, path)))

/** Wrap any fs Effect so failures become StoreError (read-only). */
export const withReadError = <A>(
  op: Effect.Effect<A, unknown>,
  operation: string,
  path?: string,
): Effect.Effect<A, StoreError> => op.pipe(Effect.mapError(toReadError(operation, path)))

/** Ensure a directory exists, creating it recursively if absent. */
export const ensureDirExists = (
  fs: typeof FileSystem.Service,
  dir: string,
  description = dir,
): Effect.Effect<void, DiskFullError | StoreError> =>
  Effect.gen(function* () {
    const exists = yield* withReadError(fs.exists(dir), `check ${description}`)
    if (!exists) {
      yield* withFsError(fs.makeDirectory(dir, { recursive: true }), `create ${description}`)
    }
  })

/** Map a platform error to DiskFullError or ConfigError (for config write operations). */
const toConfigError =
  (action: string, path?: string) =>
  (cause: unknown): DiskFullError | ConfigError => {
    if (isPlatformReason(cause, "BadResource")) {
      return new DiskFullError({ message: `Disk full: could not ${action}`, path, cause })
    }
    return new ConfigError({ message: `Failed to ${action}`, cause })
  }

/** Wrap any fs Effect so failures become DiskFullError | ConfigError. */
export const withConfigError = <A>(
  op: Effect.Effect<A, unknown>,
  action: string,
  path?: string,
): Effect.Effect<A, DiskFullError | ConfigError> =>
  op.pipe(Effect.mapError(toConfigError(action, path)))
