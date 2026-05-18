/** Extract the last path segment (filename) from a file path. Handles both `/` and `\\` separators. */
export const getFilename = (path: string): string => {
  const sepIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return sepIndex >= 0 ? path.slice(sepIndex + 1) : path
}

/**
 * Extract the lowercase extension (including dot) from a file path. Used for processor dispatch.
 * Strips the directory, then returns the part after the last dot. If no dot, returns the full
 * filename lowercased.
 */
export const getExtension = (file: string): string => {
  const name = getFilename(file)
  const dotIndex = name.lastIndexOf(".")
  if (dotIndex === -1) return name.toLowerCase()
  return name.slice(dotIndex).toLowerCase()
}

/**
 * Extract the extension from a filename (not full path). Returns `"(no extension)"` if no dot
 * exists. Used for display grouping of skipped files.
 */
export const getFileExtension = (filename: string): string => {
  const dotIndex = filename.lastIndexOf(".")
  return dotIndex >= 0 ? filename.slice(dotIndex) : "(no extension)"
}
