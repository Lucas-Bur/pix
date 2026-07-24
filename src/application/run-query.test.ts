import { expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { indexFixtures, indexSeed } from "../../tests/test-utils/command.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { runQuery } from "./run-query.js"

it.effect("runQuery refreshes the index and returns ranked results", () =>
  Effect.gen(function* () {
    const response = yield* runQuery({ queryText: "test", top: 1, noContent: true })

    expect(response.indexRefresh.kind).toBe("none")
    expect(response.results).toHaveLength(1)
    expect(response.results[0].text).toBeNull()
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, indexSeed }))),
)

it.effect("runQuery applies the shared response character budget", () =>
  Effect.gen(function* () {
    const response = yield* runQuery({ queryText: "test", top: 1, maxCharacters: 20 })

    expect(response.results).toHaveLength(1)
    expect(response.results[0].text).toContain(" [...]")
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, indexSeed }))),
)
