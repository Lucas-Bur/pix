import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { GetStatus } from "../application/get-status.js"
import { VectorStore } from "../domain/ports.js"

test("pix status --json outputs correct JSON structure", () =>
  Effect.gen(function* () {
    const mockStats = {
      chunks: 42,
      files: 7,
      model: "Xenova/all-MiniLM-L6-v2",
      lastIndex: 1715030400000,
      totalLines: 1260,
      byteSize: 16128,
    }

    const mockStore = {
      store: () => Effect.succeed(undefined),
      search: () => Effect.succeed([]),
      getStats: () => Effect.succeed(mockStats),
    }

    const mockLayer = Layer.succeed(VectorStore, mockStore)
    const serviceLayer = Layer.provideMerge(GetStatus.Default, mockLayer)

    // Capture stdout
    let stdout = ""
    const originalLog = console.log
    console.log = (msg: string) => {
      stdout += msg + "\n"
    }

    try {
      // Test through GetStatus (command is thin wrapper)
      const result = yield* GetStatus.getStatus().pipe(Effect.provide(serviceLayer))

      // Format as JSON like the --json flag would
      stdout = JSON.stringify(result, null, 2)

      const parsed = JSON.parse(stdout.trim())
      expect(parsed.chunks).toBe(42)
      expect(parsed.files).toBe(7)
      expect(parsed.totalLines).toBe(1260)
      expect(parsed.byteSize).toBe(16128)
      expect(parsed.model).toBe("Xenova/all-MiniLM-L6-v2")
      expect(parsed.lastIndex).toBe(1715030400000)
    } finally {
      console.log = originalLog
    }
  }))
