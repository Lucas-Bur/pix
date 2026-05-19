import { Effect } from "effect"

import type { BenchOptions, BenchResult } from "../domain/bench.js"

export class BenchProject extends Effect.Service<BenchProject>()("BenchProject", {
  accessors: true,
  dependencies: [],
  succeed: {
    bench: (opts: BenchOptions): Effect.Effect<BenchResult> =>
      Effect.succeed({
        profile: opts.profile,
        warmup: opts.warmup,
        measureBatches: opts.measureBatches,
        measurements: [],
        recommendation: "benchmark not yet implemented",
      }),
  },
}) {}
