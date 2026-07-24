import { expect, test } from "@effect/vitest"
import { Schema } from "effect"

import { normalizeQueryRequest, QueryRequestSchema } from "./query.js"

test("a query request applies transport-independent defaults", () => {
  const request = Schema.decodeUnknownSync(QueryRequestSchema)({ queryText: "display service" })

  expect(normalizeQueryRequest(request)).toEqual({
    queryText: "display service",
    top: 5,
    contextLines: 0,
    ignorePath: [],
    onlyPath: [],
    maxCharacters: undefined,
    noContent: false,
  })
})
