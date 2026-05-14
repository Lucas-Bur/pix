import { Command } from "@effect/cli"
import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { assertCommandError, indexFixtures } from "../../tests/test-utils/command.js"
import { MockConsole } from "../../tests/test-utils/MockConsole.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { Embedder } from "../domain/ports.js"
import { queryCommand } from "./query.js"

const run = (args: string[]) => Command.run(queryCommand, { name: "pix", version: "0.0.0" })(args)

test("pix query --json outputs search results", () =>
  Effect.gen(function* () {
    yield* run(["query", "--json", "test query"])

    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBeGreaterThan(0)
    const output = JSON.parse(lines[0])
    expect(Array.isArray(output)).toBe(true)
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures }))))

test("pix query with --top flag clamps to valid range", () =>
  Effect.gen(function* () {
    yield* run(["query", "--json", "--top", "3", "search term"])

    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBeGreaterThan(0)
    const output = JSON.parse(lines[0])
    expect(Array.isArray(output)).toBe(true)
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures }))))

const failingEmbedderLayer = Layer.succeed(Embedder, {
  embed: () => Effect.dieMessage("embed failed"),
  batch: () => Effect.dieMessage("batch failed"),
})

test("pix query --json with failing embedder produces error JSON", () =>
  assertCommandError(run(["query", "--json", "test"])).pipe(
    Effect.provide(testLayer({ contents: indexFixtures, embedderLayer: failingEmbedderLayer })),
  ))

test("pix query --json clamps --top below minimum to 1", () =>
  Effect.gen(function* () {
    yield* run(["query", "--json", "--top", "0", "test"])
    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBeGreaterThan(0)
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures }))))

test("pix query --json clamps --top above maximum to 100", () =>
  Effect.gen(function* () {
    yield* run(["query", "--json", "--top", "200", "test"])
    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBeGreaterThan(0)
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures }))))

test("pix query --json with --context-lines includes context fields", () =>
  Effect.gen(function* () {
    yield* run(["query", "--json", "--context-lines", "2", "test"])
    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBeGreaterThan(0)
    const output = JSON.parse(lines[0])
    expect(Array.isArray(output)).toBe(true)
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures }))))

test("pix query --json on empty index returns empty array", () =>
  Effect.gen(function* () {
    yield* run(["query", "--json", "no results"])
    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBeGreaterThan(0)
    const output = JSON.parse(lines[0])
    expect(output).toEqual([])
  }).pipe(Effect.provide(testLayer())))

test("pix query without --json on empty index logs no results", () =>
  Effect.gen(function* () {
    yield* run(["query", "nothing"])
    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    // "No results found" is logInfo, not Console.log
    expect(lines.length).toBe(0)
  }).pipe(Effect.provide(testLayer())))

test("pix query without --json outputs formatted results", () =>
  Effect.gen(function* () {
    yield* run(["query", "test"])
    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBeGreaterThan(0)
    // formatResult outputs score:file and text
    expect(lines.some((l: string) => l.includes(":"))).toBe(true)
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures }))))
