import { it, expect } from "@effect/vitest"
import { Effect } from "effect"
import { Command } from "effect/unstable/cli"
import { vi } from "vitest"

import { runCommand } from "../tests/test-utils/command.js"
import { memoryFsLayer } from "../tests/test-utils/memfs.js"
import { CliDisplayLive, JsonOutput } from "./cli-output.js"
import { Display } from "./domain/ports.js"

const probeCommand = Command.make("probe", {}, () =>
  Effect.gen(function* () {
    yield* (yield* Display).json({ mode: "json" })
  }),
)

const probeCli = Command.make("pix", {}).pipe(
  Command.withSubcommands([probeCommand]),
  Command.provide(CliDisplayLive),
  Command.withGlobalFlags([JsonOutput]),
)

const run = runCommand(probeCli)

const captureStdout = (args: string[]) => {
  const writes: string[] = []
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    writes.push(String(chunk))
    return true
  }) as typeof process.stdout.write)

  return run(args).pipe(
    Effect.as(writes),
    Effect.ensuring(Effect.sync(() => spy.mockRestore())),
    Effect.provide(memoryFsLayer({})),
  )
}

it.effect("global --json works before and after a subcommand", () =>
  Effect.gen(function* () {
    const before = yield* captureStdout(["--json", "probe"])
    const after = yield* captureStdout(["probe", "--json"])

    expect(before).toEqual(['{"mode":"json"}\n'])
    expect(after).toEqual(['{"mode":"json"}\n'])
  }),
)

it.effect("missing --json and explicit --no-json select human display output", () =>
  Effect.gen(function* () {
    const absent = yield* captureStdout(["probe"])
    const disabled = yield* captureStdout(["probe", "--no-json"])

    expect(absent).toEqual([])
    expect(disabled).toEqual([])
  }),
)
