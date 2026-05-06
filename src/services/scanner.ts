import { Effect, Layer } from "effect"
import fg from "fast-glob"

import { Scanner } from "../domain/ports.js"

const IGNORE_DIRS = [".pix", "node_modules", ".git", "dist", "build", ".next"]

const make = Effect.succeed({
  scanFiles: (extensions: readonly string[]): Effect.Effect<string[], never> =>
    Effect.tryPromise(() => {
      const pattern = extensions.map((ext: string) => `**/*${ext}`)
      return fg(pattern, {
        ignore: IGNORE_DIRS.map((d: string) => `**/${d}/**`),
        dot: false,
      })
    }).pipe(Effect.catchAll(() => Effect.succeed([] as string[]))),
} as const)

export const ScannerLive = Layer.effect(Scanner, make)
export { Scanner }
