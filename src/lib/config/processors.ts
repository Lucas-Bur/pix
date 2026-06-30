import { Effect } from "effect"
import { FileSystem } from "effect/FileSystem"

import { ExtractionFailed, UnsupportedFormat } from "../../domain/errors.js"

export type FileProcessor = (
  file: string,
) => Effect.Effect<string, ExtractionFailed | UnsupportedFormat, FileSystem>

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

export const skipProcessor = (extension: string) => {
  const error = new UnsupportedFormat({
    message: `Unsupported file type: ${extension}`,
    extension,
  })
  return (_file: string): Effect.Effect<string, UnsupportedFormat, FileSystem> => Effect.fail(error)
}

const DEFAULT_PROCESSOR_MAP: Record<string, FileProcessor> = {
  // Code
  ".ts": identityProcessor,
  ".tsx": identityProcessor,
  ".js": identityProcessor,
  ".jsx": identityProcessor,
  ".py": identityProcessor,
  ".rs": identityProcessor,
  ".go": identityProcessor,
  ".java": identityProcessor,
  ".c": identityProcessor,
  ".cpp": identityProcessor,
  ".h": identityProcessor,
  ".hpp": identityProcessor,
  // Config / data
  ".json": identityProcessor,
  ".yaml": identityProcessor,
  ".yml": identityProcessor,
  ".toml": identityProcessor,
  ".xml": identityProcessor,
  ".csv": identityProcessor,
  // Docs
  ".md": identityProcessor,
  ".mdx": identityProcessor,
  ".txt": identityProcessor,
  ".rst": identityProcessor,
  // Web
  ".html": identityProcessor,
  ".css": identityProcessor,
  ".scss": identityProcessor,
  ".less": identityProcessor,
  ".sql": identityProcessor,
  ".graphql": identityProcessor,
  // Shell / scripts
  ".sh": identityProcessor,
  ".bash": identityProcessor,
  ".ps1": identityProcessor,
  ".bat": identityProcessor,
  ".cmake": identityProcessor,
  ".dockerfile": identityProcessor,
  dockerfile: identityProcessor,
  // Config files (no leading dot)
  makefile: identityProcessor,
  gemfile: identityProcessor,
  // Known binary / unsupported
  ".pdf": skipProcessor(".pdf"),
  ".png": skipProcessor(".png"),
  ".jpg": skipProcessor(".jpg"),
  ".jpeg": skipProcessor(".jpeg"),
  ".gif": skipProcessor(".gif"),
  ".svg": identityProcessor,
  ".ico": skipProcessor(".ico"),
  ".webp": skipProcessor(".webp"),
  ".mp3": skipProcessor(".mp3"),
  ".mp4": skipProcessor(".mp4"),
  ".wav": skipProcessor(".wav"),
  ".avi": skipProcessor(".avi"),
  ".mov": skipProcessor(".mov"),
  ".mkv": skipProcessor(".mkv"),
  ".exe": skipProcessor(".exe"),
  ".dll": skipProcessor(".dll"),
  ".so": skipProcessor(".so"),
  ".zip": skipProcessor(".zip"),
  ".tar": skipProcessor(".tar"),
  ".gz": skipProcessor(".gz"),
  ".7z": skipProcessor(".7z"),
  ".rar": skipProcessor(".rar"),
  ".ttf": skipProcessor(".ttf"),
  ".woff": skipProcessor(".woff"),
  ".woff2": skipProcessor(".woff2"),
  ".eot": skipProcessor(".eot"),
  ".otf": skipProcessor(".otf"),
  ".lock": identityProcessor,
  lock: identityProcessor,
}

/**
 * Builds the processor map by merging domain defaults with user-specified skip extensions. Skip
 * extensions override any existing mapping with a skip processor. Unknown extensions remain absent
 * from the map — callers decide how to handle them.
 */
export function buildProcessorMap(
  skipExtensions: readonly string[],
): Record<string, FileProcessor> {
  const mapped: Record<string, FileProcessor> = { ...DEFAULT_PROCESSOR_MAP }
  for (const ext of skipExtensions) {
    mapped[ext] = skipProcessor(ext)
  }
  return mapped
}
