import { Schema } from "effect"

import { IndexDiagnosticSchema } from "./diagnostics.js"
import { ChunkValidationErrorSchema } from "./errors.js"

/** Structured index status shared by CLI and MCP. */
export const StatusResultSchema = Schema.Struct({
  chunks: Schema.Finite,
  files: Schema.Finite,
  model: Schema.String,
  lastIndex: Schema.Finite,
  totalLines: Schema.Finite,
  byteSize: Schema.Finite,
  validationErrors: Schema.Array(ChunkValidationErrorSchema),
  diagnostics: Schema.Array(IndexDiagnosticSchema),
})
