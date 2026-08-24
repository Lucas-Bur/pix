import { expect, it } from "vitest"

import {
  emptyRouterConfig,
  routerParameters,
} from "../retrieval/evaluation/router-search/config-space.js"
import {
  beamWidthForRound,
  buildHypothesisRouterSeeds,
} from "../retrieval/evaluation/router-search/rank.js"

const baseSeeds = [
  emptyRouterConfig({ identity: 1, camelcase: 0.5, bm25: 1, dense: 0.5, sparse: 1 }),
]

type RouterConfig = ReturnType<typeof emptyRouterConfig>

const readParameter = (config: RouterConfig, name: string): number => {
  const [head, channel] = name.split(".")
  if (head === "baseWeights") return config.baseWeights[channel as "identity"]!
  return config[head as "scoreInfluence"][channel as "identity"]!
}

const CHANNEL_NAMES = ["identity", "camelcase", "bm25", "dense", "sparse"] as const

/**
 * Base weights get normalized by their maximum after every update, so an expected raw level only
 * survives when another channel sits strictly higher.
 */
const expectedBaseWeight = (
  channel: (typeof CHANNEL_NAMES)[number],
  hotChannel: string | undefined,
): number => {
  const levels = Object.fromEntries(
    CHANNEL_NAMES.map((name) => [name, name === hotChannel ? 1 : 0.1]),
  )
  const max = Math.max(...CHANNEL_NAMES.map((name) => levels[name]!))
  return levels[channel]! / max
}

it("builds one one-hot corner per parameter plus both extremes", () => {
  const parameters = routerParameters()
  const seeds = buildHypothesisRouterSeeds(baseSeeds, parameters)
  expect(seeds.length).toBe(parameters.length + 1 + baseSeeds.length)
  for (let index = 0; index < parameters.length; index++) {
    const corner = seeds[index]!
    const parameter = parameters[index]!
    const values = parameter.values
    expect(readParameter(corner, parameter.name)).toBe(values[values.length - 1])
    const hotChannel = parameter.name.startsWith("baseWeights.")
      ? (parameter.name.split(".")[1] as (typeof CHANNEL_NAMES)[number])
      : undefined
    for (let other = 0; other < parameters.length; other++) {
      if (other === index) continue
      const neighbour = parameters[other]!
      const expected =
        neighbour.name.startsWith("baseWeights.")
          ? expectedBaseWeight(
              neighbour.name.split(".")[1] as (typeof CHANNEL_NAMES)[number],
              hotChannel,
            )
          : neighbour.values[0]
      expect(readParameter(corner, neighbour.name)).toBe(expected)
    }
  }

  for (let index = 0; index < parameters.length; index++) {
    const parameter = parameters[index]!
    if (!parameter.name.startsWith("baseWeights.")) continue
    const channel = parameter.name.split(".")[1] as (typeof CHANNEL_NAMES)[number]
    expect(readParameter(seeds[parameters.length]!, parameter.name)).toBe(1)
    const allMax = seeds[parameters.length + 1]!
    expect(readParameter(allMax, parameter.name)).toBe(1)
  }
})

it("decays the beam width geometrically without dropping below the target", () => {
  expect(beamWidthForRound(0, 3, 6)).toBe(24)
  expect(beamWidthForRound(1, 3, 6)).toBe(12)
  expect(beamWidthForRound(2, 3, 6)).toBe(6)
  expect(beamWidthForRound(0, 1, 6)).toBe(6)
})
