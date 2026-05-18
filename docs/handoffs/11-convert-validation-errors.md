# Handoff: Convert Validation Errors to TaggedError

## Context

`src/lib/config/validation.ts` defines `JsonSyntaxError` and `SchemaValidationError` as plain interfaces with `_tag`:

```typescript
export interface JsonSyntaxError {
  readonly _tag: "JsonSyntaxError"
  readonly message: string
  readonly errors: ReadonlyArray<ValidationEntry>
}

export interface SchemaValidationError {
  readonly _tag: "SchemaValidationError"
  readonly message: string
  readonly errors: ReadonlyArray<ValidationEntry>
}
```

These are NOT `Data.TaggedError` types. This means:
- Cannot use `Effect.catchTag("JsonSyntaxError", ...)`
- Inconsistent with the project's domain error pattern (all domain errors in `domain/errors.ts` are `Data.TaggedError`)
- The `decodeJsonWithErrors` function returns `Effect.Effect<A, JsonDecodeError>` where `JsonDecodeError` is a union of plain interfaces

## What to Do

1. **Convert** `JsonSyntaxError` and `SchemaValidationError` to `Data.TaggedError`:
   ```typescript
   import { Data } from "effect"

   export class JsonSyntaxError extends Data.TaggedError("JsonSyntaxError")<{
     readonly message: string
     readonly errors: ReadonlyArray<ValidationEntry>
   }> {}

   export class SchemaValidationError extends Data.TaggedError("SchemaValidationError")<{
     readonly message: string
     readonly errors: ReadonlyArray<ValidationEntry>
   }> {}
   ```

2. **Update** `decodeJsonWithErrors` to return the new tagged error instances:
   ```typescript
   export const decodeJsonWithErrors = <A>(
     schema: Schema.Schema<A, any, never>,
     json: string,
   ): Effect.Effect<A, JsonDecodeError> =>
     Schema.decodeUnknown(Schema.parseJson(schema))(json).pipe(
       Effect.mapError((error: ParseResult.ParseError) => {
         const base = {
           message: formatSchemaMessage(error),
           errors: formatSchemaErrors(error),
         }
         return isJsonSyntaxError(error)
           ? new JsonSyntaxError(base)
           : new SchemaValidationError(base)
       }),
     )
   ```

3. **Update** all callers that pattern-match on these errors:
   - `src/services/config-store.ts` — uses `decodeJsonWithErrors` and catches the error
   - Any test files that assert on `JsonSyntaxError` or `SchemaValidationError` shape

4. **Update** tests in `src/lib/config/validation.test.ts` (if it exists) or create tests that verify:
   - `JsonSyntaxError` is a `Data.TaggedError` with `_tag: "JsonSyntaxError"`
   - `SchemaValidationError` is a `Data.TaggedError` with `_tag: "SchemaValidationError"`
   - `Effect.catchTag` works with both

5. **Run** quality gates: `vp check --fix && vp test && vp run lint:fallow`

## Constraints

- The `_tag` values must remain `"JsonSyntaxError"` and `"SchemaValidationError"` for backward compatibility
- The `message` and `errors` fields must remain the same shape
- `ValidationEntry` interface can stay as-is (it's a value object, not an error)
- `clampPositive`, `clampTopK`, and `buildChunkValidationErrors` are unaffected

## Files to Modify

- MODIFY: `src/lib/config/validation.ts`
- MODIFY: `src/services/config-store.ts` (if it pattern-matches on error shape)
- MODIFY: Any test files that assert on these error types

## Success Criteria

- `JsonSyntaxError` and `SchemaValidationError` extend `Data.TaggedError`
- `Effect.catchTag("JsonSyntaxError", ...)` works
- `Effect.catchTag("SchemaValidationError", ...)` works
- All existing tests pass
- `vp check` passes
