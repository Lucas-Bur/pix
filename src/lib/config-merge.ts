import type { IndexOptions } from "../application/index-project.js"
import type { Config } from "../domain/config.js"
import { DEFAULT_CONFIG } from "../domain/config.js"
import { clampPositive } from "./validation.js"

export interface EffectiveConfig {
  readonly batchSize: number
  readonly concurrency: number
  readonly skipExtensions: readonly string[]
  readonly ignoredPaths: readonly string[]
  readonly ignoreGitignore: boolean
}

export const mergeConfig = (opts: IndexOptions, config: Config): EffectiveConfig => {
  const concurrency = (opts.chunkConcurrency ??
    config.chunkConcurrency ??
    DEFAULT_CONFIG.chunkConcurrency) as number
  return {
    batchSize: opts.batchSize ?? config.embedder.batchSize ?? DEFAULT_CONFIG.embedder.batchSize,
    concurrency: clampPositive(concurrency),
    skipExtensions: opts.skipExtensions
      ? [...config.skipExtensions, ...opts.skipExtensions]
      : config.skipExtensions,
    ignoredPaths: opts.ignorePaths
      ? [...(config.ignoredPaths ?? DEFAULT_CONFIG.ignoredPaths), ...opts.ignorePaths]
      : (config.ignoredPaths ?? DEFAULT_CONFIG.ignoredPaths),
    ignoreGitignore: opts.ignoreGitignore ?? config.ignoreGitignore ?? false,
  }
}
