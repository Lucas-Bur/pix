import type { Config } from "../../domain/config.js"
import { DEFAULT_CONFIG } from "../../domain/config.js"
import type { IndexOptions } from "../../domain/ports.js"
import { clampPositive } from "./validation.js"

export interface EffectiveConfig {
  readonly batchSize: number
  readonly concurrency: number
  readonly skipExtensions: readonly string[]
  readonly ignoredPaths: readonly string[]
  readonly ignoreGitignore: boolean
}

export const mergeConfig = (opts: IndexOptions, config: Config): EffectiveConfig => {
  const batchSize = clampPositive(
    opts.batchSize ?? config.embedder.batchSize ?? DEFAULT_CONFIG.embedder.batchSize,
  )
  const concurrency = clampPositive(opts.chunkConcurrency ?? config.chunkConcurrency)
  const skipExtensions = opts.skipExtensions
    ? [...config.skipExtensions, ...opts.skipExtensions]
    : config.skipExtensions
  const ignoredPaths = opts.ignorePaths
    ? [...config.ignoredPaths, ...opts.ignorePaths]
    : config.ignoredPaths
  const ignoreGitignore = opts.ignoreGitignore ?? config.ignoreGitignore

  return { batchSize, concurrency, skipExtensions, ignoredPaths, ignoreGitignore }
}
