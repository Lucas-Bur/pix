import { Ref } from "effect"

import { SilentDisplay } from "../../src/display/Display.js"
import type { DisplayEntry } from "../../src/display/Display.js"

/** Creates a SilentDisplay layer with a fresh Ref for test assertions */
export const silentDisplay = () => {
  const ref = Ref.unsafeMake<ReadonlyArray<DisplayEntry>>([])
  const layer = SilentDisplay.layer(ref)
  return { ref, layer } as const
}
