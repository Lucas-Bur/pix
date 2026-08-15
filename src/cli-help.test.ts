import { expect, it } from "@effect/vitest"
import { Console, Effect } from "effect"
import { GlobalFlag } from "effect/unstable/cli"

import { runCommand } from "../tests/test-utils/command.js"
import { memoryFsLayer } from "../tests/test-utils/memfs.js"
import { PixCliConfig } from "./cli-config.js"
import { pixCommand } from "./cli.js"

const captureHelp = (args: readonly string[]) => {
  const output: string[] = []
  const testConsole: Console.Console = Object.assign(Object.create(console), {
    log: (...values: ReadonlyArray<unknown>) => {
      output.push(values.join(" "))
    },
  })

  return runCommand(pixCommand)([...args]).pipe(
    Effect.provideService(Console.Console, testConsole),
    Effect.provide(memoryFsLayer({})),
    Effect.exit,
    Effect.map(() => output.join("")),
  )
}

it.effect("root help describes the CLI and its subcommands", () =>
  Effect.gen(function* () {
    const help = yield* captureHelp(["--help"])

    expect(help).toContain("Local semantic code search for humans and AI agents")
    expect(help).toContain("Refresh the local semantic index")
    expect(help).toContain("Search the indexed project")
    expect(help).toContain("Run the MCP server over stdio")
    expect(help).toContain("query, q")
    expect(help).toContain("--json, -j")
    expect(help).not.toContain("--log-level")
  }),
)

it.effect("namespace commands render their generated help when no subcommand is selected", () =>
  Effect.gen(function* () {
    const root = yield* captureHelp([])
    const alias = yield* captureHelp(["alias"])
    const config = yield* captureHelp(["config"])
    const cache = yield* captureHelp(["cache"])

    expect(root).toContain("pix <subcommand>")
    expect(root).toContain("run         Run a saved query alias")
    expect(alias).toContain("pix alias <subcommand>")
    expect(alias).toContain("Save a query alias")
    expect(alias).not.toContain("\n  run")
    expect(config).toContain("pix config <subcommand>")
    expect(config).toContain("Validate and repair .pix/config.json")
    expect(cache).toContain("pix cache <subcommand>")
    expect(cache).toContain("Delete cached embeddings")
  }),
)

it.effect("query help documents flag meaning, units, defaults, and examples", () =>
  Effect.gen(function* () {
    const help = yield* captureHelp(["query", "--help"])

    expect(help).toContain("--top, -n COUNT")
    expect(help).toContain("--profile, -p PROFILE")
    expect(help).toContain("--copy, -c")
    expect(help).toContain("clamped to 1-100 (default: 5)")
    expect(help).toContain("--ignore-path PATTERN")
    expect(help).toContain("may be repeated")
    expect(help).toContain("--content")
    expect(help).toContain("disable with --no-content")
    expect(help).toContain('pix query "authentication middleware" --top 5')
  }),
)

it.effect("query command alias renders the canonical command help", () =>
  Effect.gen(function* () {
    const help = yield* captureHelp(["q", "--help"])

    expect(help).toContain("pix query")
    expect(help).toContain("search source code with hybrid lexical and semantic retrieval")
  }),
)

it.effect("index help documents resource controls and canonical repeated flags", () =>
  Effect.gen(function* () {
    const help = yield* captureHelp(["index", "--help"])

    expect(help).toContain("--batch-size, -b COUNT")
    expect(help).toContain("chunks embedded in one batch")
    expect(help).toContain("--chunk-tokens, -t TOKENS")
    expect(help).toContain("--skip-extension, -s EXTENSION")
    expect(help).toContain("--ignore-path PATTERN")
  }),
)

it.effect("bench help documents list formats, units, defaults, and examples", () =>
  Effect.gen(function* () {
    const help = yield* captureHelp(["bench", "--help"])

    expect(help).toContain("--batch-size COUNT")
    expect(help).toContain("--sparse-batch-size COUNT")
    expect(help).toContain("--device DEVICE")
    expect(help).toContain("--timeout SECONDS")
    expect(help).toContain("default: 60")
    expect(help).toContain("pix bench --device dml --device cpu --profile throughput")
    expect(help).toContain("--apply")
    expect(help).toContain("recommendation for --profile")
  }),
)

it("runner retains useful built-ins without the unused log-level flag", () => {
  expect(PixCliConfig.builtIns).toEqual([
    GlobalFlag.Help,
    GlobalFlag.Version,
    GlobalFlag.Wizard,
    GlobalFlag.Completions,
  ])
})

it.effect("generated completions expose --no-content without a double negation", () =>
  Effect.gen(function* () {
    const completions = yield* captureHelp(["--completions", "bash"])

    expect(completions).toContain("--no-content")
    expect(completions).not.toContain("--no-no-content")
  }),
)
