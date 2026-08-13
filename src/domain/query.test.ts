import { expect, test } from "@effect/vitest"
import { Schema } from "effect"

import { normalizeQueryRequest, QueryRequestSchema, QueryResponseSchema } from "./query.js"

test("a query request applies transport-independent defaults", () => {
  const request = Schema.decodeSync(QueryRequestSchema)({ queryText: "display service" })

  expect(normalizeQueryRequest(request)).toEqual({
    queryText: "display service",
    top: 5,
    contextLines: 0,
    ignorePath: [],
    onlyPath: [],
    maxCharacters: undefined,
    noContent: false,
    profile: "compatibility",
  })
})

test("query transport options reject fractional and invalid bounded values", () => {
  expect(Schema.is(QueryRequestSchema)({ queryText: "test", top: 1.5 })).toBe(false)
  expect(Schema.is(QueryRequestSchema)({ queryText: "test", contextLines: -1 })).toBe(false)
  expect(Schema.is(QueryRequestSchema)({ queryText: "test", maxCharacters: 0 })).toBe(false)
  expect(Schema.is(QueryRequestSchema)({ queryText: "test", profile: "compatibility" })).toBe(true)
  expect(Schema.is(QueryRequestSchema)({ queryText: "test", profile: "code-navigation" })).toBe(
    true,
  )
  expect(Schema.is(QueryRequestSchema)({ queryText: "test", profile: "unknown" })).toBe(false)
})

test("top remains clampable at the application boundary", () => {
  expect(Schema.is(QueryRequestSchema)({ queryText: "test", top: 0 })).toBe(true)
})

test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
  "query responses reject non-finite scores: %s",
  (score) => {
    expect(
      Schema.is(QueryResponseSchema)({
        indexRefresh: {
          kind: "none",
          processedFiles: 0,
          reusedFiles: 0,
          cacheHits: 0,
          cacheMisses: 0,
        },
        results: [
          {
            score,
            rel: 1,
            file: "src/index.ts",
            startLine: 1,
            endLine: 1,
            text: null,
            contextBefore: null,
            contextAfter: null,
          },
        ],
        validationErrors: [],
        warnings: [],
      }),
    ).toBe(false)
  },
)
