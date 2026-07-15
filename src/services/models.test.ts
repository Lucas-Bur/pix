import { expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"

import { ModelRegistry } from "../domain/ports.js"
import { ModelRegistryLive } from "./models.js"

it.effect("ModelRegistryLive returns ModelInfo for known model with defaultDtype", () =>
  Effect.gen(function* () {
    const registry = yield* ModelRegistry
    const info = yield* registry.get("Xenova/all-MiniLM-L6-v2")
    expect(Option.isSome(info)).toBe(true)
    if (Option.isSome(info)) {
      expect(info.value.dims).toBe(384)
      expect(info.value.dtypes).toEqual(["fp32", "q8"])
      expect(info.value.defaultDtype).toBe("fp32")
    }
  }).pipe(Effect.provide(ModelRegistryLive)),
)

it.effect("ModelRegistryLive returns Option.none for unknown model", () =>
  Effect.gen(function* () {
    const registry = yield* ModelRegistry
    const info = yield* registry.get("foo/bar")
    expect(Option.isNone(info)).toBe(true)
  }).pipe(Effect.provide(ModelRegistryLive)),
)

it.effect("ModelRegistryLive.list returns all registered model IDs", () =>
  Effect.gen(function* () {
    const registry = yield* ModelRegistry
    const ids = yield* registry.list()
    expect(ids).toContain("Xenova/all-MiniLM-L6-v2")
    expect(ids).toContain("Xenova/bge-small-en-v1.5")
    expect(ids).toContain("jinaai/jina-embeddings-v2-base-code")
    expect(ids).toHaveLength(3)
  }).pipe(Effect.provide(ModelRegistryLive)),
)
