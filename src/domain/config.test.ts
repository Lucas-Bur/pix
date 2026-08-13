import { expect, test } from "@effect/vitest"
import { Schema } from "effect"

import { ConfigSchema, DEFAULT_CONFIG } from "./config.js"

test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
  "config rejects non-finite numeric values: %s",
  (batchSize) => {
    expect(
      Schema.is(ConfigSchema)({
        ...DEFAULT_CONFIG,
        embedder: { ...DEFAULT_CONFIG.embedder, batchSize },
      }),
    ).toBe(false)
  },
)
