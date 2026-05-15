/**
 * Visual test of d.spinner() and d.progress() using our Display service. Run: npx tsx
 * research/display-test.ts
 */

import { Effect } from "effect"

import { ClackDisplay, Display } from "../src/display/Display.js"

const test = Effect.gen(function* () {
  const d = yield* Display

  // ── Spinner ──
  yield* d.spinner(
    "Spinner: loading model...",
    Effect.gen(function* () {
      yield* Effect.sleep(800)
      yield* d.message("Spinner: embedding query...")
      yield* Effect.sleep(800)
      yield* d.message("Spinner: searching index...")
      yield* Effect.sleep(800)
    }),
  )

  // ── Progress: advanceBy ──
  yield* d.progress(
    { message: "Progress: chunking...", max: 20 },
    Effect.gen(function* () {
      for (let i = 0; i < 5; i++) {
        yield* Effect.sleep(300)
        yield* d.message({ message: `Batch ${i + 1}/5`, advanceBy: 4 })
      }
    }),
  )

  // ── Progress: setTo ──
  yield* d.progress(
    { message: "Progress: embedding...", max: 47 },
    Effect.gen(function* () {
      yield* Effect.sleep(400)
      yield* d.message({ message: "16 chunks", setTo: 16 })
      yield* Effect.sleep(400)
      yield* d.message({ message: "32 chunks", setTo: 32 })
      yield* Effect.sleep(400)
      yield* d.message({ message: "47 chunks", setTo: 47 })
    }),
  )

  // ── Progress: setToPercent ──
  yield* d.progress(
    { message: "Progress: finalizing...", max: 100 },
    Effect.gen(function* () {
      yield* Effect.sleep(300)
      yield* d.message({ message: "Writing...", setToPercent: 30 })
      yield* Effect.sleep(300)
      yield* d.message({ message: "Flushing...", setToPercent: 65 })
      yield* Effect.sleep(300)
      yield* d.message({ message: "Done!", setToPercent: 100 })
    }),
  )
})

test.pipe(Effect.provide(ClackDisplay.layer)).pipe(Effect.runPromise)
