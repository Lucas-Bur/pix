import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import type { Config } from "../domain/config.js"
import { ConfigError } from "../domain/config.js"
import { ConfigStore } from "../domain/ports.js"
import { InitProject } from "./init-project.js"

test("InitProject.init writes DEFAULT_CONFIG via ConfigStore", () =>
  Effect.gen(function* () {
    let writtenConfig: Config | null = null

    const mockStore = {
      writeConfig: (config: Config) =>
        Effect.sync(() => {
          writtenConfig = config
        }),
      readConfig: () =>
        Effect.fail({ _tag: "ConfigError" as const, message: "not implemented" } as never),
      configExists: () => Effect.succeed(false),
    }

    const mockLayer = Layer.succeed(ConfigStore, mockStore)
    const testLayer = Layer.provideMerge(InitProject.Default, mockLayer)

    const result = yield* InitProject.init().pipe(Effect.provide(testLayer))

    expect(result.success).toBe(true)
    expect(result.config.schema).toBe("1")
    expect(writtenConfig).not.toBeNull()
    expect(writtenConfig!.schema).toBe("1")
    expect(writtenConfig!.model).toBe("Xenova/all-MiniLM-L6-v2")
    expect(writtenConfig!.dims).toBe(384)
  }))

test("InitProject.init propagates ConfigError when writeConfig fails", () =>
  Effect.gen(function* () {
    const mockStore = {
      writeConfig: () => Effect.fail(new ConfigError({ message: "disk full" })),
      readConfig: () =>
        Effect.fail({ _tag: "ConfigError" as const, message: "not implemented" } as never),
      configExists: () => Effect.succeed(false),
    }

    const mockLayer = Layer.succeed(ConfigStore, mockStore)
    const testLayer = Layer.provideMerge(InitProject.Default, mockLayer)

    const result = yield* Effect.either(InitProject.init().pipe(Effect.provide(testLayer)))

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("ConfigError")
      expect(result.left.message).toBe("disk full")
    }
  }))
