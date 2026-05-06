import { Effect } from "effect"
import { expect, test } from "vite-plus/test"

import { DEFAULT_EXTENSIONS } from "../domain/config.js"
import { Scanner, ScannerLive } from "./scanner.ts"

const testLayer = ScannerLive

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
