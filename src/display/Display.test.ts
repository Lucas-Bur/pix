import { Effect, Ref } from "effect"
import { describe, expect, it } from "vite-plus/test"

import { Display, type DisplayEntry, SilentDisplay } from "./Display.js"

const setup = () => {
  const ref = Ref.unsafeMake<ReadonlyArray<DisplayEntry>>([])
  const layer = SilentDisplay.layer(ref)
  return { ref, layer } as const
}

describe("SilentDisplay", () => {
  it("records log messages with severity", () => {
    const { ref, layer } = setup()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.log("Syncing files...", "info")
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([{ _tag: "log", message: "Syncing files...", severity: "info" }])
    }).pipe(Effect.provide(layer))
  })

  it("records json data entries", () => {
    const { ref, layer } = setup()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.json({ chunks: 42, files: 3 })
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([{ _tag: "json", data: { chunks: 42, files: 3 } }])
    }).pipe(Effect.provide(layer))
  })

  it("spinner passes through effect result", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const d = yield* Display
      const result = yield* d.spinner("Loading...", Effect.succeed("hello"))
      expect(result).toBe("hello")
    }).pipe(Effect.provide(layer))
  })

  it("spinner passes through effect failure", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const d = yield* Display
      const exit = yield* d.spinner("Failing...", Effect.fail("boom")).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }).pipe(Effect.provide(layer))
  })

  it("captures multiple log calls in order", () => {
    const { ref, layer } = setup()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.log("Starting...", "info")
      yield* d.log("Done!", "success")
      yield* d.log("Something failed", "error")
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([
        { _tag: "log", message: "Starting...", severity: "info" },
        { _tag: "log", message: "Done!", severity: "success" },
        { _tag: "log", message: "Something failed", severity: "error" },
      ])
    }).pipe(Effect.provide(layer))
  })

  it("records intro entries", () => {
    const { ref, layer } = setup()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.intro("pix")
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([{ _tag: "intro", title: "pix" }])
    }).pipe(Effect.provide(layer))
  })

  it("records outro entries", () => {
    const { ref, layer } = setup()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.outro("Done!")
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([{ _tag: "outro", message: "Done!" }])
    }).pipe(Effect.provide(layer))
  })

  it("records note entries with optional title", () => {
    const { ref, layer } = setup()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.note("Add .pix to .gitignore", "Reminder")
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([
        { _tag: "note", content: "Add .pix to .gitignore", title: "Reminder" },
      ])
    }).pipe(Effect.provide(layer))
  })

  it("records updateInteractive entries", () => {
    const { ref, layer } = setup()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.updateInteractive("Scanned 12 files")
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([{ _tag: "updateInteractive", message: "Scanned 12 files" }])
    }).pipe(Effect.provide(layer))
  })

  it("records updateInteractive with advanceBy", () => {
    const { ref, layer } = setup()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.updateInteractive({ message: "Embedding...", advanceBy: 5 })
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([
        { _tag: "updateInteractive", message: "Embedding...", advanceBy: 5 },
      ])
    }).pipe(Effect.provide(layer))
  })

  it("records updateInteractive with setTo", () => {
    const { ref, layer } = setup()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.updateInteractive({ message: "Done", setTo: 47 })
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([{ _tag: "updateInteractive", message: "Done", setTo: 47 }])
    }).pipe(Effect.provide(layer))
  })

  it("records updateInteractive with setToPercent", () => {
    const { ref, layer } = setup()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.updateInteractive({ message: "Halfway", setToPercent: 50 })
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([{ _tag: "updateInteractive", message: "Halfway", setToPercent: 50 }])
    }).pipe(Effect.provide(layer))
  })

  it("progress bar passes through effect result", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const d = yield* Display
      const result = yield* d.progress({ message: "Embedding...", max: 47 }, Effect.succeed(42))
      expect(result).toBe(42)
    }).pipe(Effect.provide(layer))
  })

  it("progress bar records options", () => {
    const { ref, layer } = setup()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.progress({ message: "Embedding...", max: 47 }, Effect.void)
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([{ _tag: "progress", message: "Embedding...", max: 47 }])
    }).pipe(Effect.provide(layer))
  })

  it("records text entries", () => {
    const { ref, layer } = setup()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.text("src/foo.ts:1-10 (score: 0.950)")
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([{ _tag: "text", message: "src/foo.ts:1-10 (score: 0.950)" }])
    }).pipe(Effect.provide(layer))
  })

  it("captures all entry types in order", () => {
    const { ref, layer } = setup()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.intro("pix")
      yield* d.log("Running...", "info")
      yield* d.spinner("Indexing...", Effect.succeed(42))
      yield* d.updateInteractive("Scanned 12 files")
      yield* d.progress({ message: "Embedding...", max: 47 }, Effect.void)
      yield* d.note("Tips")
      yield* d.text("result line")
      yield* d.json({ ok: true })
      yield* d.outro("Done")
      const entries = yield* Ref.get(ref)
      expect(entries.map((e) => e._tag)).toEqual([
        "intro",
        "log",
        "spinner",
        "updateInteractive",
        "progress",
        "note",
        "text",
        "json",
        "outro",
      ])
    }).pipe(Effect.provide(layer))
  })
})
