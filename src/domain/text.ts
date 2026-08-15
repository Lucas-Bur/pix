import { Schema } from "effect"

/** User-provided text containing at least one character. */
export const NonEmptyTextSchema = Schema.String.check(
  Schema.isMinLength(1, { message: "Must not be empty" }),
)
