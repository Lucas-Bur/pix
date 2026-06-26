import { Effect, Layer, Ref } from "effect"
import { MemoryFileSystem } from "effect-memfs"
import { FileSystem } from "effect/FileSystem"
import { describe, expect, it } from "vite-plus/test"

import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { Display } from "../domain/ports.js"
import { JsonDisplayLive } from "./json-display.js"

describe("SilentDisplay", () => {
  it("records log messages with severity", () => {
    const { ref, layer } = silentDisplay()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.log("Syncing files...", "info")
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([{ _tag: "log", message: "Syncing files...", severity: "info" }])
    }).pipe(Effect.provide(layer))
  })

  it("records json data entries", () => {
    const { ref, layer } = silentDisplay()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.json({ chunks: 42, files: 3 })
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([{ _tag: "json", data: { chunks: 42, files: 3 } }])
    }).pipe(Effect.provide(layer))
  })

  it("spinner passes through effect result", () => {
    const { layer } = silentDisplay()
    return Effect.gen(function* () {
      const d = yield* Display
      const result = yield* d.spinner("Loading...", Effect.succeed("hello"))
      expect(result).toBe("hello")
    }).pipe(Effect.provide(layer))
  })

  it("spinner passes through effect failure", () => {
    const { layer } = silentDisplay()
    return Effect.gen(function* () {
      const d = yield* Display
      const exit = yield* d.spinner("Failing...", Effect.fail("boom")).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }).pipe(Effect.provide(layer))
  })

  it("captures multiple log calls in order", () => {
    const { ref, layer } = silentDisplay()
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
    const { ref, layer } = silentDisplay()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.intro("pix")
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([{ _tag: "intro", title: "pix" }])
    }).pipe(Effect.provide(layer))
  })

  it("records outro entries", () => {
    const { ref, layer } = silentDisplay()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.outro("Done!")
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([{ _tag: "outro", message: "Done!" }])
    }).pipe(Effect.provide(layer))
  })

  it("records note entries with optional title", () => {
    const { ref, layer } = silentDisplay()
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
    const { ref, layer } = silentDisplay()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.updateInteractive("Scanned 12 files")
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([{ _tag: "updateInteractive", message: "Scanned 12 files" }])
    }).pipe(Effect.provide(layer))
  })

  it("records updateInteractive with advanceBy", () => {
    const { ref, layer } = silentDisplay()
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
    const { ref, layer } = silentDisplay()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.updateInteractive({ message: "Done", setTo: 47 })
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([{ _tag: "updateInteractive", message: "Done", setTo: 47 }])
    }).pipe(Effect.provide(layer))
  })

  it("records updateInteractive with setToPercent", () => {
    const { ref, layer } = silentDisplay()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.updateInteractive({ message: "Halfway", setToPercent: 50 })
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([{ _tag: "updateInteractive", message: "Halfway", setToPercent: 50 }])
    }).pipe(Effect.provide(layer))
  })

  it("progress bar passes through effect result", () => {
    const { layer } = silentDisplay()
    return Effect.gen(function* () {
      const d = yield* Display
      const result = yield* d.progress({ message: "Embedding...", max: 47 }, Effect.succeed(42))
      expect(result).toBe(42)
    }).pipe(Effect.provide(layer))
  })

  it("progress bar records options", () => {
    const { ref, layer } = silentDisplay()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.progress({ message: "Embedding...", max: 47 }, Effect.void)
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([{ _tag: "progress", message: "Embedding...", max: 47 }])
    }).pipe(Effect.provide(layer))
  })

  it("records text entries", () => {
    const { ref, layer } = silentDisplay()
    return Effect.gen(function* () {
      const d = yield* Display
      yield* d.text("src/foo.ts:1-10 (score: 0.950)")
      const entries = yield* Ref.get(ref)
      expect(entries).toEqual([{ _tag: "text", message: "src/foo.ts:1-10 (score: 0.950)" }])
    }).pipe(Effect.provide(layer))
  })

  it("captures all entry types in order", () => {
    const { ref, layer } = silentDisplay()
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

describe("JsonDisplay file logging", () => {
  const makeJsonDisplayLayer = () =>
    JsonDisplayLive.pipe(Layer.provide(MemoryFileSystem.layerWith({})))

  const readLogEntries = () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem
      const content = yield* fs.readFileString(".pix/logs/events.jsonl")
      return content
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l))
    })

  it("writes log entry to .pix/logs/events.jsonl", () =>
    Effect.gen(function* () {
      const d = yield* Display
      yield* d.log("test message", "info")

      const entries = yield* readLogEntries()
      expect(entries[0]).toMatchObject({
        severity: "info",
        message: "test message",
      })
      expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }).pipe(Effect.provide(makeJsonDisplayLayer())))

  it("creates log directory if missing", () =>
    Effect.gen(function* () {
      const d = yield* Display
      yield* d.intro("pix")

      const fs = yield* FileSystem
      const dirExists = yield* fs.exists(".pix/logs")
      expect(dirExists).toBe(true)
    }).pipe(Effect.provide(makeJsonDisplayLayer())))

  it("appends multiple entries as newline-delimited JSON", () =>
    Effect.gen(function* () {
      const d = yield* Display
      yield* d.log("first", "info")
      yield* d.log("second", "warn")
      yield* d.outro("done")

      const entries = yield* readLogEntries()
      expect(entries).toHaveLength(3)
      expect(entries[0]).toMatchObject({ severity: "info", message: "first" })
      expect(entries[1]).toMatchObject({ severity: "warn", message: "second" })
      expect(entries[2]).toMatchObject({ type: "outro", message: "done" })
    }).pipe(Effect.provide(makeJsonDisplayLayer())))

  it("records spinner start/stop entries", () =>
    Effect.gen(function* () {
      const d = yield* Display
      yield* d.spinner("Indexing...", Effect.void)

      const entries = yield* readLogEntries()
      expect(entries).toHaveLength(2)
      expect(entries[0]).toMatchObject({ type: "spinner-start", message: "Indexing..." })
      expect(entries[1]).toMatchObject({ type: "spinner-stop" })
    }).pipe(Effect.provide(makeJsonDisplayLayer())))

  it("records progress start/stop entries", () =>
    Effect.gen(function* () {
      const d = yield* Display
      yield* d.progress({ message: "Embedding...", max: 10 }, Effect.void)

      const entries = yield* readLogEntries()
      expect(entries).toHaveLength(2)
      expect(entries[0]).toMatchObject({
        type: "progress-start",
        message: "Embedding...",
        max: 10,
      })
      expect(entries[1]).toMatchObject({ type: "progress-stop" })
    }).pipe(Effect.provide(makeJsonDisplayLayer())))

  it("records updateInteractive for string payload", () =>
    Effect.gen(function* () {
      const d = yield* Display
      yield* d.updateInteractive("Just a message")

      const entries = yield* readLogEntries()
      expect(entries[0]).toMatchObject({ type: "update", message: "Just a message" })
    }).pipe(Effect.provide(makeJsonDisplayLayer())))

  it("records updateInteractive for advanceBy payload", () =>
    Effect.gen(function* () {
      const d = yield* Display
      yield* d.updateInteractive({ message: "Advancing", advanceBy: 5 })

      const entries = yield* readLogEntries()
      expect(entries[0]).toMatchObject({ type: "update", message: "Advancing", advanceBy: 5 })
    }).pipe(Effect.provide(makeJsonDisplayLayer())))

  it("records updateInteractive for setTo payload", () =>
    Effect.gen(function* () {
      const d = yield* Display
      yield* d.updateInteractive({ message: "Setting", setTo: 42 })

      const entries = yield* readLogEntries()
      expect(entries[0]).toMatchObject({ type: "update", message: "Setting", setTo: 42 })
    }).pipe(Effect.provide(makeJsonDisplayLayer())))

  it("records updateInteractive for setToPercent payload", () =>
    Effect.gen(function* () {
      const d = yield* Display
      yield* d.updateInteractive({ message: "Percent", setToPercent: 0.75 })

      const entries = yield* readLogEntries()
      expect(entries[0]).toMatchObject({
        type: "update",
        message: "Percent",
        setToPercent: 0.75,
      })
    }).pipe(Effect.provide(makeJsonDisplayLayer())))
})
