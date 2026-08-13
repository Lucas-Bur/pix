import { expect, test } from "@effect/vitest"
import { Schema } from "effect"

import { DenseMatchRow, SparseMatchRow } from "./schema.js"

test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
  "SQLite ranking rows reject non-finite values: %s",
  (value) => {
    expect(Schema.is(DenseMatchRow)({ ordinal: 0, distance: value })).toBe(false)
    expect(Schema.is(SparseMatchRow)({ ordinal: 0, score: value })).toBe(false)
  },
)
