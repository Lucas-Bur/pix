import type { EvidenceRouterParameters as EvidenceRouterConfig } from "../../../../src/domain/retrieval.js"
import { sobolUnitPoint } from "../scouts/index.js"
import type { RouterParameter } from "./config-space.js"

/** Value of one router parameter inside a config, addressed by its dotted name. */
const readParameter = (config: EvidenceRouterConfig, name: string): number => {
  const [head, channel] = name.split(".")
  if (head === "baseWeights") return config.baseWeights[channel as "identity"]!
  return config[head as "scoreInfluence"][channel as "identity"]!
}

/** Index of the level in `values` closest to `value` (values are ascending). */
const nearestLevelIndex = (values: readonly number[], value: number): number => {
  let best = 0
  for (let index = 1; index < values.length; index++) {
    if (Math.abs(values[index]! - value) < Math.abs(values[best]! - value)) best = index
  }
  return best
}

/**
 * Deterministic local Sobol cloud around elite configurations: for each elite, spread
 * `pointsPerElite` Sobol points inside a hypercube of +/- `radiusLevels` discrete levels around the
 * elite's current level per parameter. Catches parameter interactions that axis-parallel coordinate
 * walks structurally miss.
 */
export const buildLocalCloudConfigs = (
  elites: readonly EvidenceRouterConfig[],
  parameters: readonly RouterParameter[],
  pointsPerElite: number,
  radiusLevels: number,
): readonly EvidenceRouterConfig[] => {
  if (elites.length === 0 || pointsPerElite <= 0 || radiusLevels <= 0) return []
  return elites.flatMap((elite, eliteIndex) =>
    Array.from({ length: pointsPerElite }, (_, pointIndex) => {
      const cloudIndex = eliteIndex * pointsPerElite + pointIndex
      return parameters.reduce((config, parameter, parameterIndex) => {
        const unit = sobolUnitPoint(cloudIndex + 1, parameterIndex)
        const values = parameter.values
        const currentIndex = nearestLevelIndex(values, readParameter(config, parameter.name))
        const offset = Math.round((unit * 2 - 1) * radiusLevels)
        const nextIndex = Math.min(values.length - 1, Math.max(0, currentIndex + offset))
        return parameter.update(config, values[nextIndex]!)
      }, elite)
    }),
  )
}
