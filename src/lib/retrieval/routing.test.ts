import { expect, it } from "vitest"

import { routeQuery } from "./routing.js"

it("boosts semantic weight for long queries", () => {
  expect(
    routeQuery("find the implementation that handles project configuration in this repository"),
  ).toMatchObject({
    bm25: 0.5,
    dense: 1.5,
  })
})
