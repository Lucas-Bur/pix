import { Effect, Layer, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

import { ClipboardError } from "../domain/errors.js"
import { Clipboard } from "../domain/ports.js"

interface ClipboardCommand {
  readonly command: string
  readonly args: readonly string[]
}

const commandForPlatform = (): readonly ClipboardCommand[] => {
  switch (process.platform) {
    case "win32":
      return [{ command: "clip", args: [] }]
    case "darwin":
      return [{ command: "pbcopy", args: [] }]
    default:
      return [
        { command: "wl-copy", args: [] },
        { command: "xclip", args: ["-selection", "clipboard"] },
        { command: "xsel", args: ["--clipboard", "--input"] },
      ]
  }
}

const stdinFromText = (text: string) => Stream.fromIterable([text]).pipe(Stream.encodeText)

const runClipboardCommand = (
  spawner: typeof ChildProcessSpawner.ChildProcessSpawner.Service,
  text: string,
  spec: ClipboardCommand,
): Effect.Effect<void, ClipboardError> =>
  Effect.gen(function* () {
    const exitCode = yield* spawner
      .exitCode(
        ChildProcess.make(spec.command, spec.args, {
          stdin: stdinFromText(text),
          stdout: "ignore",
          stderr: "ignore",
        }),
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new ClipboardError({
              message: `Clipboard command "${spec.command}" failed to start`,
              cause,
            }),
        ),
      )

    if (exitCode !== 0) {
      return yield* new ClipboardError({
        message: `Clipboard command "${spec.command}" exited with code ${exitCode}`,
      })
    }
  })

const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

  const copy = (text: string): Effect.Effect<void, ClipboardError> => {
    const [first, ...rest] = commandForPlatform()
    const initial = runClipboardCommand(spawner, text, first)
    return rest.reduce(
      (effect, spec) => effect.pipe(Effect.catch(() => runClipboardCommand(spawner, text, spec))),
      initial,
    )
  }

  return { copy } as const
})

export const ClipboardLive = Layer.effect(Clipboard, make)
