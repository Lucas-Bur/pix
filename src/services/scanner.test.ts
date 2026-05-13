import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { DEFAULT_EXTENSIONS } from "../domain/config.js"
import { Scanner, ScannerLive } from "./scanner.ts"

const cwd = process.cwd().replace(/\\/g, "/")

const fixtures = {
  [`${cwd}/src/commands/init.ts`]: "export const init = () => {}",
  [`${cwd}/src/utils/helper.ts`]: "export const helper = () => {}",
  [`${cwd}/node_modules/some-pkg/index.ts`]: "export const x = 1",
  [`${cwd}/.pix/config.json`]: "{}",
  [`${cwd}/.git/config`]: "[core]",
  [`${cwd}/.gitignore`]: "dist\n.next\n",
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
