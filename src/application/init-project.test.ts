import { Effect, Exit } from "effect"
import { expect, test } from "vite-plus/test"

import { makeFailingConfigStore } from "../../tests/test-utils/command.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { InitProject } from "./init-project.js"

test("InitProject.init writes DEFAULT_CONFIG via ConfigStore", () =>
  Effect.gen(function* () {
    const result = yield* InitProject.init()
    expect(result.success).toBe(true)
    expect(result.config.schema).toBe("1")
    expect(result.config.embedder.model).toBe("Xenova/all-MiniLM-L6-v2")
  }).pipe(Effect.provide(testLayer({})), Effect.scoped))

test("InitProject.init returns ConfigError when writeConfig fails", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(InitProject.init()).pipe(
      Effect.provide(testLayer({ configStoreLayer: makeFailingConfigStore("writeConfig") })),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(exit.cause._tag).toBe("Fail")
    }
  }))
