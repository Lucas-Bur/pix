import { Schema } from "effect"

import { IndexDiagnosticSchema } from "./diagnostics.js"
import { ChunkValidationErrorSchema } from "./errors.js"

/** Structured index status shared by CLI and MCP. */
export const StatusResultSchema = Schema.Struct({
  chunks: Schema.Number,
  files: Schema.Number,
  model: Schema.String,
  lastIndex: Schema.Number,
  totalLines: Schema.Number,
  byteSize: Schema.Number,
  validationErrors: Schema.Array(ChunkValidationErrorSchema),
  diagnostics: Schema.Array(IndexDiagnosticSchema),
})
