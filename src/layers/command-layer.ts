import { NodeServices } from "@effect/platform-node"
import { Layer } from "effect"

/**
 * Build a per-command layer: feed the infra layer into the use case, then merge `NodeServices` on
 * top so the use case can access `FileSystem` etc. directly.
 *
 * Centralises the composition previously duplicated across every `*-layer.ts`. Each per-command
 * file stays the dynamic-import boundary (so tsdown keeps splitting heavy Service/Infra code into
 * separate chunks); this helper only holds the shared wiring. Return type is inferred so the
 * residual-requirement algebra (`RInfraIn | Exclude<RIn, RInfraOut>`) stays sound per-call.
 */
export function commandLayer<RIn, E, ROut, RInfraOut, EInfra, RInfraIn>(
  useCase: Layer.Layer<ROut, E, RIn>,
  infra: Layer.Layer<RInfraOut, EInfra, RInfraIn>,
) {
  return Layer.merge(useCase.pipe(Layer.provideMerge(infra)), NodeServices.layer)
}
