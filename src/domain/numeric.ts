import { Schema } from "effect"

/** Runtime schema for positive integer domain values. */
export const PositiveIntSchema = Schema.Int.check(Schema.isGreaterThan(0))

/** Runtime schema for non-negative integer domain values. */
export const NonNegativeIntSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
