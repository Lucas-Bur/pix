import { Effect } from "effect"
import { expect, test } from "vite-plus/test"

import { testLayer } from "../../tests/test-utils/testLayer.js"
import { GetStatus } from "./get-status.js"

const fixtures = {
  ".pix/config.json": JSON.stringify({
    schema: "1",
    model: "test-model",
    dims: 384,
    chunkLines: 60,
    overlapLines: 10,
    files: {},
  }),
  ".pix/chunks.jsonl": [
    JSON.stringify({
      id: "a1",
      idx: 0,
      file: "/src/a.ts",
      startLine: 1,
      endLine: 2,
      text: "const x = 1\nconst y = 2",
    }),
    JSON.stringify({
      id: "b1",
      idx: 1,
      file: "/src/b.ts",
      startLine: 1,
      endLine: 1,
      text: "export const z = 3",
    }),
  ].join("\n"),
  ".pix/vectors.bin": "",
}

test("GetStatus.getStatus returns status from VectorStore with config model", () =>
  Effect.gen(function* () {
    const result = yield* GetStatus.getStatus()
    expect(result.chunks).toBe(2)
    expect(result.files).toBe(2)
    expect(result.model).toBe("test-model")
    expect(result.totalLines).toBe(3)
  }).pipe(Effect.provide(testLayer({ contents: fixtures })), Effect.scoped))
