import { expect, it } from "vitest"

import type { EvidenceRouterParameters as RouterConfig } from "../../src/domain/retrieval.js"
import {
  emptyRouterConfig,
  routerParameters,
} from "../retrieval/evaluation/router-search/config-space.js"
import { buildLocalCloudConfigs } from "../retrieval/evaluation/router-search/local-cloud.js"

const readParameter = (config: RouterConfig, name: string): number => {
  const [head, channel] = name.split(".")
  if (head === "baseWeights") return config.baseWeights[channel as "identity"]!
  return config[head as "scoreInfluence"][channel as "identity"]!
}

const elite = emptyRouterConfig({ identity: 1, camelcase: 0.5, bm25: 1, dense: 0.5, sparse: 1 })

it("generates pointsPerElite configs per elite", () => {
  const cloud = buildLocalCloudConfigs([elite], routerParameters(), 8, 2)
  expect(cloud).toHaveLength(8)
})

it("is deterministic", () => {
  const parameters = routerParameters()
  const first = buildLocalCloudConfigs([elite], parameters, 16, 3)
  const second = buildLocalCloudConfigs([elite], parameters, 16, 3)
  expect(first).toEqual(second)
})

it("stays within radiusLevels of the elite per parameter and never leaves the level grid", () => {
  const parameters = routerParameters()
  for (const config of buildLocalCloudConfigs([elite], parameters, 24, 1)) {
    for (const parameter of parameters) {
      const values = parameter.values
      expect(values).toContain(readParameter(config, parameter.name))
      const eliteIndex = values.findIndex((value) => value === readParameter(elite, parameter.name))
      const cloudIndex = values.findIndex(
        (value) => value === readParameter(config, parameter.name),
      )
      expect(Math.abs(cloudIndex - eliteIndex)).toBeLessThanOrEqual(1)
    }
  }
})

it("clouds around distinct elites stay disjoint in their first differing dimension", () => {
  const second = emptyRouterConfig({
    identity: 0.5,
    camelcase: 0.5,
    bm25: 0.5,
    dense: 1,
    sparse: 0.5,
  })
  const cloud = buildLocalCloudConfigs([elite, second], routerParameters(), 4, 2)
  expect(cloud).toHaveLength(8)
  const firstHalf = JSON.stringify(cloud.slice(0, 4))
  const secondHalf = JSON.stringify(cloud.slice(4))
  expect(firstHalf).not.toEqual(secondHalf)
})

it("returns an empty cloud without elites or disabled knobs", () => {
  expect(buildLocalCloudConfigs([], routerParameters(), 8, 2)).toHaveLength(0)
  expect(buildLocalCloudConfigs([elite], routerParameters(), 0, 2)).toHaveLength(0)
  expect(buildLocalCloudConfigs([elite], routerParameters(), 8, 0)).toHaveLength(0)
})
