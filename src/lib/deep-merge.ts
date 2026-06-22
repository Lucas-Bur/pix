/**
 * Recursively merge overrides onto a base object. Nested objects are merged key-by-key; arrays and
 * primitives are replaced.
 */
export const deepMerge = <T extends Record<string, unknown>>(
  base: T,
  overrides: Record<string, unknown>,
): T => {
  const result: Record<string, unknown> = { ...base }
  for (const key of Object.keys(overrides)) {
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
        result[key] = deepMerge(baseVal as Record<string, unknown>, val as Record<string, unknown>)
      } else {
        result[key] = val
      }
    }
  }
  return result as T
}
