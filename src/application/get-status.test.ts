import { Effect } from "effect"
import { expect, test } from "vite-plus/test"

import { indexFixtures } from "../../tests/test-utils/command.js"
import { makeChunkJson } from "../../tests/test-utils/fixtures.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { GetStatus } from "./get-status.js"

test("GetStatus.getStatus returns index model from index-meta.json", () =>
  Effect.gen(function* () {
    const result = yield* GetStatus.getStatus()
    expect(result.chunks).toBe(2)
    expect(result.files).toBe(2)
    expect(result.model).toBe("test-model")
    expect(result.totalLines).toBe(3)
  }).pipe(
    Effect.provide(
      testLayer({
        contents: {
          ...indexFixtures,
          ".pix/index-meta.json": JSON.stringify({
            dtype: "fp32",
            dims: 384,
            model: "test-model",
            lastIndex: Date.now(),
          }),
        },
      }),
    ),
    Effect.scoped,
  ))

test("GetStatus.getStatus returns empty model when index-meta.json missing", () =>
  Effect.gen(function* () {
    const result = yield* GetStatus.getStatus()
    expect(result.model).toBe("")
    expect(result.chunks).toBe(2)
    expect(result.files).toBe(2)
  }).pipe(
    Effect.provide(
      testLayer({
        contents: {
          ".pix/chunks.jsonl": [
            makeChunkJson({
              id: "a1",
              idx: 0,
              file: "/src/a.ts",
              startLine: 1,
              endLine: 2,
              text: "const x = 1\nconst y = 2",
            }),
          ].join("\n"),
          ".pix/vectors.bin": "",
        },
      }),
    ),
    Effect.scoped,
  ))
