import { FileSystem } from "@effect/platform"
import { Effect } from "effect"

import { UnsupportedFormat } from "../../domain/errors.js"

export const skipProcessor = (extension: string) => {
  const error = new UnsupportedFormat({
    message: `Unsupported file type: ${extension}`,
    extension,
  })
  return (_file: string): Effect.Effect<string, UnsupportedFormat, FileSystem.FileSystem> =>
    Effect.fail(error)
}
