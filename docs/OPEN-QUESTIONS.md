# Open Questions for pix MVP

## Testing

### Q1: How to properly test Effect code?

- Is there an `@effect/vitest` package?
- Should we use `Effect.gen` in tests (current approach) or is there a better pattern?
- What are the Effect testing best practices?

### Q2: How to test CLI commands built with @effect/cli?

- How to invoke `pix init` programmatically in tests?
- How to capture stdout/stderr for verification?
- Is there an Effect-native test adapter?

### Q3: Integration tests for built binary?

- How to test the packed binary (`vp pack` output)?
- Should we test `node dist/index.mjs` or the packed CLI?

## Build & Packaging

### Q4: Why does `vp build` fail with "Cannot resolve entry module index.html"?

- The `package.json` says `"build": "vp pack"` - correct for CLI tools?
- Is `vp pack` the right command for CLI binaries?

### Q5: How to structure the CLI entry point?

- Current: `src/index.ts` with `cli(process.argv).pipe(Effect.provide(layer), NodeRuntime.runMain)`
- Is this the correct pattern for distributable CLI tools?

## Code Quality

### Q7: How to handle duplicate code in tests?

- `cleanPixDir` is duplicated in `store.test.ts` and `init.test.ts`
- Should we extract a shared test helper?
- Where to put test utilities?

### Q8: How to handle fallow warnings?

- `unused_exports` for `DEFAULT_EXTENSIONS` (needed later for scanner)
- `unused_dependencies` for packages needed in later phases
- Should we suppress these or restructure exports?

#### Answer

We ignore them for now because we are certain that we use them later.
