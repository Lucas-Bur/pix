import { Effect, Result } from "effect"
import { expect, test } from "vite-plus/test"

import { makeFailingConfigStore } from "../../tests/test-utils/command.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { InitProject } from "./init-project.js"

test("InitProject.init writes DEFAULT_CONFIG via ConfigStore", () =>
  Effect.gen(function* () {
    const result = yield* (yield* InitProject).init()
    expect(result.success).toBe(true)
    expect(result.config.embedder.model).toBe("Xenova/all-MiniLM-L6-v2")
  }).pipe(Effect.provide(testLayer({})), Effect.scoped))

test("InitProject.init returns ConfigError when writeConfig fails", () =>
  Effect.gen(function* () {
    const result = yield* (yield* InitProject)
      .init()
      .pipe(
        Effect.result,
        Effect.provide(testLayer({ configStoreLayer: makeFailingConfigStore("writeConfig") })),
      )

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("ConfigError")
    }
  }))
