import { Effect, Layer } from "effect"

/** Preserve a JavaScript split point while deferring layer-module evaluation to command execution. */
export const loadLayer = <ROut, E, RIn>(load: () => Promise<Layer.Layer<ROut, E, RIn>>) =>
  Layer.unwrap(Effect.promise(load))
