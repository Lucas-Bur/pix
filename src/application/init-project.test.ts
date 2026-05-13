import { Effect, Exit, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { testLayer } from "../../tests/test-utils/testLayer.js"
import { ConfigError } from "../domain/config.js"
import { ConfigStore } from "../domain/ports.js"
import { InitProject } from "./init-project.js"

test("InitProject.init writes DEFAULT_CONFIG via ConfigStore", () =>
  Effect.gen(function* () {
    const result = yield* InitProject.init()
    expect(result.success).toBe(true)
    expect(result.config.schema).toBe("1")
    expect(result.config.model).toBe("Xenova/all-MiniLM-L6-v2")
    expect(result.config.dims).toBe(384)
  }).pipe(Effect.provide(testLayer({})), Effect.scoped))

test("InitProject.init returns ConfigError when writeConfig fails", () =>
  Effect.gen(function* () {
    const failingConfigStore = Layer.succeed(ConfigStore, {
      writeConfig: () => Effect.fail(new ConfigError({ message: "disk full" })),
      readConfig: () => Effect.fail(new ConfigError({ message: "no config" })),
      configExists: () => Effect.succeed(false),
    })

    const exit = yield* Effect.exit(InitProject.init()).pipe(
      Effect.provide(testLayer({ configStoreLayer: failingConfigStore })),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(exit.cause._tag).toBe("Fail")
    }
  }))
