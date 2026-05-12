import { Console, Effect, Layer, Ref } from "effect"

export class MockConsole extends Effect.Service<MockConsole>()("MockConsole", {
  effect: Effect.gen(function* () {
    const lines = yield* Ref.make<string[]>([])

    const append = (...args: ReadonlyArray<unknown>) =>
      Ref.update(lines, (prev) => [...prev, ...args.map(String)])

    const getLines = (): Effect.Effect<ReadonlyArray<string>> => Ref.get(lines)

    const console: Console.Console = {
      [Console.TypeId]: Console.TypeId,
      assert: () => Effect.void,
      clear: Effect.void,
      count: () => Effect.void,
      countReset: () => Effect.void,
      debug: (...args) => append(...args),
      dir: () => Effect.void,
      dirxml: () => Effect.void,
      error: (...args) => append(...args),
      group: () => Effect.void,
      groupEnd: Effect.void,
      info: (...args) => append(...args),
      log: (...args) => append(...args),
      table: () => Effect.void,
      time: () => Effect.void,
      timeEnd: () => Effect.void,
      timeLog: () => Effect.void,
      trace: () => Effect.void,
      warn: (...args) => append(...args),
      unsafe: globalThis.console,
    }

    return { console, getLines } as const
  }),
}) {}

/** Layer that provides MockConsole and swaps Effect's Console service to use it. */
export const layer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const { console } = yield* MockConsole
    return Console.setConsole(console)
  }),
).pipe(Layer.provide(MockConsole.Default))
