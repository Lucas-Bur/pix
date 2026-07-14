import { Effect, Layer } from "effect"
import { describe, expect, it } from "vite-plus/test"

import { TEST_CONFIG_JSON } from "../../tests/test-utils/fixtures.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { Scanner } from "../domain/ports.js"
import { IndexProject } from "./index-project.js"
import { QueryProject } from "./query-project.js"

/**
 * Scanner that returns a fixed list of files regardless of what's in the memory FS. Used by
 * integration tests to drive the indexer against a specific set of files without depending on the
 * real Scanner logic.
 */
const fixedScannerLayer = (files: readonly string[]) =>
  Layer.succeed(Scanner, {
    scanFiles: () =>
      Effect.succeed({
        files: files.map((path) => ({ path, mtimeMs: 1, size: 0 })),
        skipped: [],
      }),
  })

const fixtures = {
  ".pix/config.json": TEST_CONFIG_JSON,
  "src/example.ts": `export class DtypeMismatchError extends Error {
  constructor(public expected: string, public actual: string) {
    super(\`Expected \${expected}, got \${actual}\`)
  }
}

export function handleRequest() {
  return new Response("ok")
}
`,
  "src/other.ts": `export const unrelatedValue = 42

export function unrelatedFunction() {
  return "noise"
}
`,
}

const integrationLayer = testLayer({
  contents: fixtures,
  scannerLayer: fixedScannerLayer(["src/example.ts", "src/other.ts"]),
})

describe("identity channel end-to-end", () => {
  it("boosts the chunk that defines DtypeMismatchError to rank #1", () =>
    Effect.gen(function* () {
      yield* (yield* IndexProject).index({})

      const { results } = yield* (yield* QueryProject).queryProject("DtypeMismatchError", {
        topK: 5,
      })

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].file).toBe("src/example.ts")
      expect(results[0].text).toContain("class DtypeMismatchError")
    }).pipe(Effect.provide(integrationLayer), Effect.scoped))

  it("ranks the unrelated chunk below the definition chunk for the same query", () =>
    Effect.gen(function* () {
      yield* (yield* IndexProject).index({})

      const { results } = yield* (yield* QueryProject).queryProject("DtypeMismatchError", {
        topK: 5,
      })

      // Assert on the actual ranked chunk content, not just the file -- a file
      // can produce multiple chunks (or change shape) and we want to verify the
      // *definition* chunk is at the top, not just any chunk from the same file.
      const definitionRank = results.findIndex((r) => r.text?.includes("class DtypeMismatchError"))
      const otherRank = results.findIndex((r) => r.file === "src/other.ts")
      expect(definitionRank).toBe(0)
      if (otherRank !== -1) {
        expect(definitionRank).toBeLessThan(otherRank)
      }
    }).pipe(Effect.provide(integrationLayer), Effect.scoped))

  it("boosts a function definition by its exact name", () =>
    Effect.gen(function* () {
      yield* (yield* IndexProject).index({})

      const { results } = yield* (yield* QueryProject).queryProject("handleRequest", { topK: 5 })

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].file).toBe("src/example.ts")
      expect(results[0].text).toContain("function handleRequest")
    }).pipe(Effect.provide(integrationLayer), Effect.scoped))

  it("matches via camelCase split for partial queries", () =>
    Effect.gen(function* () {
      yield* (yield* IndexProject).index({})

      // "DtypeMismatch" splits to ["dtype", "mismatch"]; "Error" splits to ["error"].
      // All three words are in the exact name, so the definition chunk scores
      // higher than a chunk that only contains one of the constituent words.
      const { results } = yield* (yield* QueryProject).queryProject("DtypeMismatch Error", {
        topK: 5,
      })

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].file).toBe("src/example.ts")
    }).pipe(Effect.provide(integrationLayer), Effect.scoped))
})
