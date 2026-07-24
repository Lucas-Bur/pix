import { expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { indexFixtures } from "../../tests/test-utils/command.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { addAlias, getAliasQuery, listAliases, removeAlias } from "./query-aliases.js"

it.effect("addAlias persists an alias in an initialized pix project", () =>
  Effect.gen(function* () {
    const added = yield* addAlias({
      name: "architecture",
      queryText: "hexagonal ports",
      top: 3,
    })
    const aliases = yield* listAliases

    expect(added).toEqual({
      name: "architecture",
      queryText: "hexagonal ports",
      options: { top: 3 },
    })
    expect(aliases).toEqual([added])
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures }))),
)

it.effect("removeAlias deletes an existing alias", () =>
  Effect.gen(function* () {
    yield* addAlias({ name: "docs", queryText: "find docs" })

    expect(yield* removeAlias({ name: "docs" })).toEqual({ removed: "docs" })
    expect(yield* listAliases).toEqual([])
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures }))),
)

it.effect("getAliasQuery resolves stored options and runtime overrides", () =>
  Effect.gen(function* () {
    yield* addAlias({ name: "docs", queryText: "find docs", top: 3 })

    expect(yield* getAliasQuery({ aliasName: "docs", noContent: true })).toEqual({
      queryText: "find docs",
      top: 3,
      contextLines: undefined,
      ignorePath: undefined,
      onlyPath: undefined,
      maxCharacters: undefined,
      noContent: true,
    })
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures }))),
)
