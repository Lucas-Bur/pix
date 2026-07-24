import { expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { indexFixtures } from "../../tests/test-utils/command.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { addAlias, listAliases } from "./query-aliases.js"

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
