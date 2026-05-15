import { FileSystem } from "@effect/platform"
import { Effect } from "effect"

import { ExtractionFailed } from "../../domain/errors.js"
import { UnsupportedFormat } from "../../domain/errors.js"

export type FileProcessor = (
  file: string,
) => Effect.Effect<string, ExtractionFailed | UnsupportedFormat, FileSystem.FileSystem>

export const identityProcessor: FileProcessor = (file) =>
  FileSystem.FileSystem.pipe(
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
