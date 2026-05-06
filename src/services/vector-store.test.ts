import { NodeContext } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { GetStatus } from "../application/get-status.js"
import { VectorStoreLive } from "./vector-store.js"

test("FileSystemVectorStore.getStats returns 0 when no index exists", () =>
  Effect.gen(function* () {
    // Combine layers: GetStatus depends on VectorStore, both need NodeContext for FileSystem
    const baseLayer = Layer.provideMerge(GetStatus.Default, VectorStoreLive)
    const testLayer = Layer.provideMerge(baseLayer, NodeContext.layer)

    const result = yield* GetStatus.getStatus().pipe(Effect.provide(testLayer), Effect.scoped)

    expect(result.chunks).toBe(0)
    expect(result.files).toBe(0)
    expect(result.model).toBe("")
    expect(result.lastIndex).toBe(0)
    expect(result.totalLines).toBe(0)
    expect(result.byteSize).toBe(0)
  }))
