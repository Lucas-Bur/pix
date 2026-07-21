import { expect, test } from "@effect/vitest"
import { Effect } from "effect"

import { expectJsonEntry, runCommand } from "../../tests/test-utils/command.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { cacheCommand } from "./cache.js"

const run = runCommand(cacheCommand)

test("pix cache clear reports an empty embedding cache", () => {
  const { ref, layer } = silentDisplay()
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* run(["clear", "--json"])
      yield* expectJsonEntry(ref, (data) => {
        expect((data as Record<string, unknown>).removed).toBe(false)
      })
    }).pipe(Effect.provide(testLayer({ displayLayer: layer }))),
  )
})
