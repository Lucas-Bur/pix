import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { DEFAULT_EXTENSIONS } from "../domain/config.js"
import { Scanner, ScannerLive } from "./scanner.ts"

const fixtures = {
  "src/commands/init.ts": "export const init = () => {}",
  "src/utils/helper.ts": "export const helper = () => {}",
  "node_modules/some-pkg/index.ts": "export const x = 1",
  ".pix/config.json": "{}",
  ".git/config": "[core]",
  ".gitignore": "dist\n.next\n",
}

const testLayer = Layer.provideMerge(ScannerLive, memoryFsLayer(fixtures))

test("Scanner finds files matching extensions", () =>
  Effect.gen(function* () {
    const scanner = yield* Scanner
    const files = yield* scanner.scanFiles(DEFAULT_EXTENSIONS)
    expect(files.length).toBeGreaterThan(0)
    expect(files.some((f) => f.includes("init.ts"))).toBe(true)
  }).pipe(Effect.provide(testLayer)))

test("Scanner respects gitignore", () =>
  Effect.gen(function* () {
    const scanner = yield* Scanner
    const files = yield* scanner.scanFiles(DEFAULT_EXTENSIONS)
    expect(files.some((f) => f.includes("node_modules"))).toBe(false)
  }).pipe(Effect.provide(testLayer)))

test("Scanner always ignores .pix, node_modules, .git", () =>
  Effect.gen(function* () {
    const scanner = yield* Scanner
    const files = yield* scanner.scanFiles(DEFAULT_EXTENSIONS)
    expect(files.some((f) => f.includes(".pix/"))).toBe(false)
    expect(files.some((f) => f.includes("node_modules/"))).toBe(false)
    expect(files.some((f) => f.includes(".git/"))).toBe(false)
  }).pipe(Effect.provide(testLayer)))

const edgeFixtures = {
  "src/commands/init.ts": "export const init = () => {}",
  "src/styles/main.css": "body { margin: 0 }",
  README: "# No extension file",
  ".gitignore": "",
  ".git/info/exclude": "secrets/\n",
  "secrets/api-key.ts": "export const KEY = 'secret'",
}

const edgeTestLayer = Layer.provideMerge(ScannerLive, memoryFsLayer(edgeFixtures))

test("Scanner skips files with non-matching extensions", () =>
  Effect.gen(function* () {
    const scanner = yield* Scanner
    const files = yield* scanner.scanFiles([".ts"])
    expect(files.some((f) => f.includes("main.css"))).toBe(false)
    expect(files.some((f) => f.includes("init.ts"))).toBe(true)
  }).pipe(Effect.provide(edgeTestLayer)))

test("Scanner skips files without extension", () =>
  Effect.gen(function* () {
    const scanner = yield* Scanner
    const files = yield* scanner.scanFiles([".ts"])
    expect(files.some((f) => f.includes("README"))).toBe(false)
  }).pipe(Effect.provide(edgeTestLayer)))

test("Scanner respects .git/info/exclude patterns", () =>
  Effect.gen(function* () {
    const scanner = yield* Scanner
    const files = yield* scanner.scanFiles([".ts"])
    expect(files.some((f) => f.includes("secrets"))).toBe(false)
  }).pipe(Effect.provide(edgeTestLayer)))
