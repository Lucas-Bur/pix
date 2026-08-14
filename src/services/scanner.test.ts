import { expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { Scanner } from "../domain/ports.js"
import { ScannerLive } from "./scanner.js"

const fixtures = {
  "src/commands/init.ts": "export const init = () => {}",
  "src/utils/helper.ts": "export const helper = () => {}",
  "node_modules/some-pkg/index.ts": "export const x = 1",
  "dist/output.js": "export const bundled = true",
  ".pix/config.json": "{}",
  ".git/config": "[core]",
  ".gitignore": "dist\n.next\n",
}

const testLayer = Layer.provideMerge(ScannerLive, memoryFsLayer(fixtures))

it.effect("Scanner finds all files in project", () =>
  Effect.gen(function* () {
    const scanner = yield* Scanner
    const scanResult = yield* scanner.scanFiles([])
    expect(scanResult.files.length).toBeGreaterThan(0)
    expect(scanResult.files.some((f) => f.path.includes("init.ts"))).toBe(true)
  }).pipe(Effect.provide(testLayer)),
)

it.effect("Scanner respects gitignore", () =>
  Effect.gen(function* () {
    const scanner = yield* Scanner
    const scanResult = yield* scanner.scanFiles([])
    expect(scanResult.files.some((f) => f.path.includes("dist/"))).toBe(false)
  }).pipe(Effect.provide(testLayer)),
)

it.effect("Scanner always ignores .pix, node_modules, .git", () =>
  Effect.gen(function* () {
    const scanner = yield* Scanner
    const scanResult = yield* scanner.scanFiles([
      ".pix",
      "node_modules",
      ".git",
      "dist",
      "build",
      ".next",
    ])
    expect(scanResult.files.some((f) => f.path.includes(".pix/"))).toBe(false)
    expect(scanResult.files.some((f) => f.path.includes("node_modules/"))).toBe(false)
    expect(scanResult.files.some((f) => f.path.includes(".git/"))).toBe(false)
  }).pipe(Effect.provide(testLayer)),
)

const edgeFixtures = {
  "src/commands/init.ts": "export const init = () => {}",
  "src/styles/main.css": "body { margin: 0 }",
  README: "# No extension file",
  ".gitignore": "",
  ".git/info/exclude": "secrets/\n",
  "secrets/api-key.ts": "export const KEY = 'secret'",
}

const edgeTestLayer = Layer.provideMerge(ScannerLive, memoryFsLayer(edgeFixtures))

it.effect("Scanner discovers files regardless of extension", () =>
  Effect.gen(function* () {
    const scanner = yield* Scanner
    const scanResult = yield* scanner.scanFiles([])
    expect(scanResult.files.some((f) => f.path.includes("main.css"))).toBe(true)
    expect(scanResult.files.some((f) => f.path.includes("init.ts"))).toBe(true)
  }).pipe(Effect.provide(edgeTestLayer)),
)

it.effect("Scanner discovers files without extension", () =>
  Effect.gen(function* () {
    const scanner = yield* Scanner
    const scanResult = yield* scanner.scanFiles([])
    expect(scanResult.files.some((f) => f.path.includes("README"))).toBe(true)
  }).pipe(Effect.provide(edgeTestLayer)),
)

it.effect("Scanner respects .git/info/exclude patterns", () =>
  Effect.gen(function* () {
    const scanner = yield* Scanner
    const scanResult = yield* scanner.scanFiles([])
    expect(scanResult.files.some((f) => f.path.includes("secrets"))).toBe(false)
  }).pipe(Effect.provide(edgeTestLayer)),
)

it.effect("Scanner respects config ignoredPaths patterns", () =>
  Effect.gen(function* () {
    const scanner = yield* Scanner
    const scanResult = yield* scanner.scanFiles(["src/styles/**"])
    expect(scanResult.files.some((f) => f.path.includes("main.css"))).toBe(false)
    expect(scanResult.files.some((f) => f.path.includes("init.ts"))).toBe(true)
  }).pipe(Effect.provide(edgeTestLayer)),
)

const nestedIgnoreFixtures = {
  ".gitignore": "*.log\n",
  "packages/app/.gitignore": "generated/\n*.tmp\n!keep.log\n",
  "packages/app/generated/output.ts": "export const generated = true",
  "packages/app/cache.tmp": "temporary",
  "packages/app/keep.log": "keep",
  "packages/app/drop.log": "drop",
  "packages/app/src/main.ts": "export const main = true",
  "packages/other/generated/output.ts": "export const generated = true",
  "packages/other/cache.tmp": "temporary",
}

const nestedIgnoreTestLayer = Layer.provideMerge(ScannerLive, memoryFsLayer(nestedIgnoreFixtures))

it.effect("Scanner applies nested .gitignore rules only below their directory", () =>
  Effect.gen(function* () {
    const scanResult = yield* (yield* Scanner).scanFiles([])
    const paths = scanResult.files.map((file) => file.path)

    expect(paths.some((path) => path.includes("packages/app/generated/"))).toBe(false)
    expect(paths.some((path) => path.endsWith("packages/app/cache.tmp"))).toBe(false)
    expect(paths.some((path) => path.endsWith("packages/app/src/main.ts"))).toBe(true)
    expect(paths.some((path) => path.includes("packages/other/generated/"))).toBe(true)
    expect(paths.some((path) => path.endsWith("packages/other/cache.tmp"))).toBe(true)
  }).pipe(Effect.provide(nestedIgnoreTestLayer)),
)

it.effect("Scanner lets nested negations override matching parent rules", () =>
  Effect.gen(function* () {
    const scanResult = yield* (yield* Scanner).scanFiles([])
    const paths = scanResult.files.map((file) => file.path)

    expect(paths.some((path) => path.endsWith("packages/app/keep.log"))).toBe(true)
    expect(paths.some((path) => path.endsWith("packages/app/drop.log"))).toBe(false)
  }).pipe(Effect.provide(nestedIgnoreTestLayer)),
)

it.effect("Scanner skips root and nested ignore files when gitignore handling is disabled", () =>
  Effect.gen(function* () {
    const scanResult = yield* (yield* Scanner).scanFiles([], true)
    const paths = scanResult.files.map((file) => file.path)

    expect(paths.some((path) => path.includes("packages/app/generated/"))).toBe(true)
    expect(paths.some((path) => path.endsWith("packages/app/cache.tmp"))).toBe(true)
    expect(paths.some((path) => path.endsWith("packages/app/drop.log"))).toBe(true)
  }).pipe(Effect.provide(nestedIgnoreTestLayer)),
)
