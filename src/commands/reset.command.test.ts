import { Command } from "@effect/cli"
import { Effect, Layer, Ref } from "effect"
import { expect, test } from "vite-plus/test"

import { assertCommandError } from "../../tests/test-utils/command.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { StoreError } from "../domain/errors.js"
import { VectorStore } from "../domain/ports.js"
import { resetCommand } from "./reset.js"

const run = (args: string[]) => Command.run(resetCommand, { name: "pix", version: "0.0.0" })(args)

const fixtures = {
  ".pix/config.json": JSON.stringify({
    schema: "1",
    embedder: { model: "test-model", device: "auto", dtype: "fp32", batchSize: 16 },
    chunkLines: 60,
    overlapLines: 10,
    skipExtensions: [],
    ignoredPaths: [],
  }),
  ".pix/chunks.jsonl": JSON.stringify({
    id: "a1",
    idx: 0,
    file: "/src/a.ts",
    startLine: 1,
    endLine: 1,
    text: "x",
  }),
  ".pix/vectors.bin": "binary-data",
}

test("pix reset --json deletes index files and reports status", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["reset", "--json"])
    const entries = yield* Ref.get(ref)
    expect(entries[0]._tag).toBe("spinner")
    const jsonEntry = entries.find((e) => e._tag === "json")
    expect(jsonEntry).toBeDefined()
    if (jsonEntry?._tag === "json") {
      const data = jsonEntry.data as Record<string, unknown>
      expect(data.status).toBe("ok")
      expect(data.deletedChunks).toBe(true)
      expect(data.deletedVectors).toBe(true)
      expect(data.freedBytes).toBeGreaterThan(0)
    }
  }).pipe(Effect.provide(testLayer({ contents: fixtures, displayLayer: layer })))
})

test("pix reset --json on clean project reports nothing deleted", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["reset", "--json"])
    const entries = yield* Ref.get(ref)
    expect(entries[0]._tag).toBe("spinner")
    const jsonEntry = entries.find((e) => e._tag === "json")
    expect(jsonEntry).toBeDefined()
    if (jsonEntry?._tag === "json") {
      const data = jsonEntry.data as Record<string, unknown>
      expect(data.status).toBe("ok")
      expect(data.deletedChunks).toBe(false)
      expect(data.deletedVectors).toBe(false)
      expect(data.freedBytes).toBe(0)
    }
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix reset without --json logs status entries via Display", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["reset"])
    const entries = yield* Ref.get(ref)
    expect(entries.some((e) => e._tag === "spinner")).toBe(true)
    expect(entries.some((e) => e._tag === "json")).toBe(true)
    expect(entries.some((e) => e._tag === "log")).toBe(true)
  }).pipe(Effect.provide(testLayer({ contents: fixtures, displayLayer: layer })))
})

test("pix reset without --json on clean project shows info", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["reset"])
    const entries = yield* Ref.get(ref)
    expect(entries.some((e) => e._tag === "spinner")).toBe(true)
    expect(entries.some((e) => e._tag === "json")).toBe(true)
    expect(entries.some((e) => e._tag === "log")).toBe(true)
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

const failingVectorStore = Layer.succeed(VectorStore, {
  store: () => Effect.succeed(undefined),
  storeBegin: () => Effect.succeed(undefined),
  storeBatch: () => Effect.succeed(undefined),
  storeCommit: () => Effect.succeed({ chunks: 0, files: 0, totalLines: 0, byteSize: 0 }),
  storeAbort: () => Effect.succeed(undefined),
  search: () => Effect.succeed([]),
  getStatus: () =>
    Effect.succeed({ chunks: 0, files: 0, model: "", lastIndex: 0, totalLines: 0, byteSize: 0 }),
  reset: () => Effect.fail(new StoreError({ message: "reset failed" })),
})

test("pix reset --json with failing VectorStore produces error JSON", () => {
  const { ref, layer } = silentDisplay()
  return assertCommandError(run(["reset", "--json"]), ref).pipe(
    Effect.provide(testLayer({ vectorStoreLayer: failingVectorStore, displayLayer: layer })),
  )
})
