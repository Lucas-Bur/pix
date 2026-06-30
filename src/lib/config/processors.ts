import { Effect } from "effect"
import { FileSystem } from "effect/FileSystem"

import { ExtractionFailed, UnsupportedFormat } from "../../domain/errors.js"

/** A function that turns a file path into its text content (or fails for unsupported formats). */
export type FileProcessor = (
  file: string,
) => Effect.Effect<string, ExtractionFailed | UnsupportedFormat, FileSystem>

/** Reads a file as text. Default processor for code / config / doc extensions. */
export const identityProcessor: FileProcessor = (file) =>
  FileSystem.pipe(
    Effect.flatMap((fs) => fs.readFileString(file)),
    Effect.mapError(
      (cause) =>
        new ExtractionFailed({
          message: `Failed to read file for extraction: ${file}`,
          file,
          cause,
        }),
    ),
  )

/** Returns an effect that always fails with UnsupportedFormat. Used for binary / opt-out extensions. */
export const skipProcessor = (extension: string) => {
  const error = new UnsupportedFormat({
    message: `Unsupported file type: ${extension}`,
    extension,
  })
  return (_file: string): Effect.Effect<string, UnsupportedFormat, never> => Effect.fail(error)
}
