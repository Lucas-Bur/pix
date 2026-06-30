// Prototype-polluting keys that must never be merged into the result.
const SKIP_KEYS = new Set(["__proto__", "constructor", "prototype"])

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x)

/**
 * Recursively merge overrides onto a base object. Nested objects are merged key-by-key; arrays and
 * primitives are replaced. Skips `__proto__`, `constructor`, and `prototype` keys.
 */
export const deepMerge = <T extends Record<string, unknown>>(
  base: T,
  overrides: Record<string, unknown>,
): T => {
  const result: Record<string, unknown> = { ...base }
  for (const key of Object.keys(overrides)) {
    if (SKIP_KEYS.has(key)) continue
    const val = overrides[key]
    if (val === undefined) continue
    const baseVal = result[key]
    if (isPlainObject(val) && isPlainObject(baseVal)) {
      result[key] = deepMerge(baseVal, val)
    } else {
      result[key] = val
    }
  }
  return result as T
}
