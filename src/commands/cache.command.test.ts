import { NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { expectJsonEntry, runCommand } from "../../tests/test-utils/command.js"
import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { ClearEmbeddingCacheLive } from "../application/clear-embedding-cache.js"
import { IndexStoreLive } from "../services/index-store.js"
import { cacheCommand } from "./cache.js"

const run = runCommand(cacheCommand)

test("pix cache clear reports an empty embedding cache", () => {
  const { ref, layer } = silentDisplay()
  const storeLayer = Layer.provideMerge(
    IndexStoreLive,
    memoryFsLayer({ ".pix/embedding-cache.jsonl": "cached" }),
  )
  const appLayer = Layer.merge(ClearEmbeddingCacheLive.pipe(Layer.provide(storeLayer)), layer)
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* run(["clear", "--json"])
      yield* expectJsonEntry(ref, (data) => {
        expect((data as Record<string, unknown>).removed).toBe(false)
      })
    }).pipe(Effect.provide(Layer.mergeAll(appLayer, NodeServices.layer))),
  )
})
