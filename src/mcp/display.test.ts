import { expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Display } from "../domain/ports.js"
import { McpDisplayLive } from "./display.js"

it.effect("McpDisplay keeps presentation methods silent and passes effects through", () =>
  Effect.gen(function* () {
    const display = yield* Display

    yield* display.intro("pix")
    yield* display.outro("Done")
    yield* display.log("Indexed", "success")
    yield* display.note("Details", "Index")
    yield* display.text("result")
    yield* display.table(["File"], [["src/index.ts"]])
    yield* display.updateInteractive("Indexing")
    yield* display.json({ success: true })

    expect(yield* display.spinner("Searching", Effect.succeed(42))).toBe(42)
    expect(
      yield* display.progress({ message: "Indexing", max: 1 }, Effect.succeed("complete")),
    ).toBe("complete")
  }).pipe(Effect.provide(McpDisplayLive)),
)

it.effect("McpDisplay select returns a supplied default", () =>
  Effect.gen(function* () {
    const display = yield* Display

    expect(
      yield* display.select("Model", [{ value: "default", label: "Default" }], "default"),
    ).toBe("default")
  }).pipe(Effect.provide(McpDisplayLive)),
)

it.effect("McpDisplay select rejects prompts without a default", () =>
  Effect.gen(function* () {
    const display = yield* Display
    const error = yield* Effect.flip(
      display.select("Model", [{ value: "default", label: "Default" }]),
    )

    expect(error._tag).toBe("InteractiveError")
    expect(error.message).toBe("MCP cannot answer interactive prompts")
  }).pipe(Effect.provide(McpDisplayLive)),
)
