import { expect, test } from "@effect/vitest"
import { Schema } from "effect"

import { IndexRequestSchema } from "./index.js"

test("index transport options require positive integers", () => {
  expect(Schema.is(IndexRequestSchema)({ batchSize: 1 })).toBe(true)
  expect(Schema.is(IndexRequestSchema)({ batchSize: 0 })).toBe(false)
  expect(Schema.is(IndexRequestSchema)({ chunkConcurrency: 1.5 })).toBe(false)
})
