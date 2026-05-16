/**
 * Deep-merge override objects. Arrays and primitives are replaced, plain objects are merged
 * recursively.
 */
export const deepMerge = <T extends Record<string, unknown>>(base: T, overrides: Partial<T>): T => {
  const result = { ...base }
  for (const key of Object.keys(overrides) as Array<keyof T>) {
    const val = overrides[key]
    if (val !== undefined) {
      const baseVal = result[key]
      if (
        typeof val === "object" &&
        val !== null &&
        !Array.isArray(val) &&
        typeof baseVal === "object" &&
        baseVal !== null &&
        !Array.isArray(baseVal)
      ) {
        result[key] = deepMerge(
          baseVal as Record<string, unknown>,
          val as Record<string, unknown>,
        ) as T[keyof T]
      } else {
        result[key] = val as T[keyof T]
      }
    }
  }
  return result
}
