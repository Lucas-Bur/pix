# Handoff: Split `vector-math.ts` into Two Files

## Context

`src/lib/vectors/vector-math.ts` (54 lines) contains two unrelated concerns:

1. `computeCosineSimilarity` — pure math function, no Effect, no I/O
2. `serializeVectors` — Effect-wrapped validation + binary serialization

They share a file only because both deal with "vectors." The deletion test confirms: delete one and the other is unaffected.

## What to Do

1. **Create** `src/lib/vectors/vector-serialization.ts` with:

   ```typescript
   import { Effect } from "effect"

   import type { Embedding } from "../../domain/chunk.js"
   import { StoreError } from "../../domain/errors.js"

   export const serializeVectors = (
     embeddings: readonly Embedding[],
   ): Effect.Effect<Buffer, StoreError> =>
     Effect.gen(function* () {
       if (embeddings.length === 0) {
         return yield* new StoreError({ message: "Cannot serialize empty embeddings batch" })
       }
       const dims = embeddings[0].dims
       for (let i = 0; i < embeddings.length; i++) {
         const e = embeddings[i]
         if (e.dims !== dims || e.vector.length !== dims) {
           return yield* new StoreError({
             message: `Inconsistent embedding shape at [${i}]: expected dims=${dims}, got dims=${e.dims} length=${e.vector.length}`,
           })
         }
       }
       const totalFloats = embeddings.length * dims
       const vectorsArray = new Float32Array(totalFloats)
       for (let i = 0; i < embeddings.length; i++) {
         vectorsArray.set(embeddings[i].vector, i * dims)
       }
       return Buffer.from(vectorsArray.buffer)
     })
   ```

2. **Move** the `serializeVectors` tests from `src/lib/vectors/vector-math.test.ts` to a new `src/lib/vectors/vector-serialization.test.ts`

3. **Update** `src/lib/vectors/vector-math.ts` to remove the `serializeVectors` function and its related imports (`Effect`, `Embedding`, `StoreError`)

4. **Update** `src/services/index-store.ts` — it imports `serializeVectors` from `vector-math.js`. Change to:

   ```typescript
   import { serializeVectors } from "../lib/vectors/vector-serialization.js"
   ```

5. **Run** quality gates: `vp check --fix && vp test && vp run lint:fallow`

## Constraints

- `computeCosineSimilarity` stays in `vector-math.ts` unchanged
- `serializeVectors` moves to `vector-serialization.ts` unchanged
- All tests must be moved appropriately — no test coverage loss
- The `vector-math.test.ts` file should only contain `computeCosineSimilarity` tests after the split

## Files to Modify

- CREATE: `src/lib/vectors/vector-serialization.ts`
- CREATE: `src/lib/vectors/vector-serialization.test.ts`
- MODIFY: `src/lib/vectors/vector-math.ts` (remove serializeVectors and related tests)
- MODIFY: `src/services/index-store.ts` (update import path)
- MODIFY: `src/lib/vectors/vector-math.test.ts` (remove serializeVectors tests)

## Success Criteria

- `computeCosineSimilarity` is in `vector-math.ts`
- `serializeVectors` is in `vector-serialization.ts`
- Both have their own test files
- `index-store.ts` imports from the correct file
- `vp check` passes
- `vp test` passes
