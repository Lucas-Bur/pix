import { NodePath } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { ConfigProvider, Effect } from "effect"

import { resolveTransformersCacheDir } from "./model-cache.js"

it.effect("keeps the Transformers cache in the project for ordinary Windows paths", () =>
  Effect.gen(function* () {
    expect(
      yield* resolveTransformersCacheDir({
        platform: "win32",
        projectRoot: "C:\\work\\repo",
        oneDriveRoots: ["C:\\Users\\Example\\OneDrive"],
        localAppData: "C:\\Users\\Example\\AppData\\Local",
      }),
    ).toBe("C:\\work\\repo\\.pix\\cache")
  }).pipe(Effect.provide(NodePath.layerWin32)),
)

it.effect("moves the Transformers cache out of OneDrive on Windows", () =>
  Effect.gen(function* () {
    expect(
      yield* resolveTransformersCacheDir({
        platform: "win32",
        projectRoot: "C:\\Users\\Example\\OneDrive\\Projects\\repo",
        oneDriveRoots: ["C:\\Users\\Example\\OneDrive"],
        localAppData: "C:\\Users\\Example\\AppData\\Local",
      }),
    ).toBe("C:\\Users\\Example\\AppData\\Local\\pix\\transformers-cache")
  }).pipe(Effect.provide(NodePath.layerWin32)),
)

it.effect("matches OneDrive roots case-insensitively", () =>
  Effect.gen(function* () {
    expect(
      yield* resolveTransformersCacheDir({
        platform: "win32",
        projectRoot: "c:\\users\\example\\onedrive\\Projects\\repo",
        oneDriveRoots: ["C:\\Users\\Example\\OneDrive"],
        localAppData: "C:\\Users\\Example\\AppData\\Local",
      }),
    ).toBe("C:\\Users\\Example\\AppData\\Local\\pix\\transformers-cache")
  }).pipe(Effect.provide(NodePath.layerWin32)),
)

it.effect("uses the project cache on non-Windows platforms", () =>
  Effect.gen(function* () {
    expect(
      yield* resolveTransformersCacheDir({
        platform: "posix",
        projectRoot: "/work/repo",
        oneDriveRoots: ["/home/example/OneDrive"],
        localAppData: "/home/example/.local/share",
      }),
    ).toBe("/work/repo/.pix/cache")
  }).pipe(Effect.provide(NodePath.layerPosix)),
)

it.effect("reads the OneDrive and local cache roots from Effect Config", () =>
  Effect.gen(function* () {
    expect(
      yield* resolveTransformersCacheDir({
        platform: "win32",
        projectRoot: "C:\\Users\\Example\\OneDrive\\Projects\\repo",
      }),
    ).toBe("C:\\Users\\Example\\AppData\\Local\\pix\\transformers-cache")
  }).pipe(
    Effect.provide(NodePath.layerWin32),
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromUnknown({
        OneDrive: "C:\\Users\\Example\\OneDrive",
        LOCALAPPDATA: "C:\\Users\\Example\\AppData\\Local",
      }),
    ),
  ),
)

it.effect("falls back to USERPROFILE when LOCALAPPDATA is unavailable", () =>
  Effect.gen(function* () {
    expect(
      yield* resolveTransformersCacheDir({
        platform: "win32",
        projectRoot: "C:\\Users\\Example\\OneDrive\\Projects\\repo",
      }),
    ).toBe("C:\\Users\\Example\\AppData\\Local\\pix\\transformers-cache")
  }).pipe(
    Effect.provide(NodePath.layerWin32),
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromUnknown({
        OneDrive: "C:\\Users\\Example\\OneDrive",
        USERPROFILE: "C:\\Users\\Example",
      }),
    ),
  ),
)

it.effect("keeps the project cache when local Windows roots are unavailable", () =>
  Effect.gen(function* () {
    expect(
      yield* resolveTransformersCacheDir({
        platform: "win32",
        projectRoot: "C:\\Users\\Example\\OneDrive\\Projects\\repo",
      }),
    ).toBe("C:\\Users\\Example\\OneDrive\\Projects\\repo\\.pix\\cache")
  }).pipe(
    Effect.provide(NodePath.layerWin32),
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromUnknown({
        OneDrive: "C:\\Users\\Example\\OneDrive",
      }),
    ),
  ),
)
