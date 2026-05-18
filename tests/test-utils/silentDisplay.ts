import { Ref } from "effect"

import type { DisplayEntry } from "../../src/display/entries.js"
import { SilentDisplayLive } from "../../src/display/silent-display.js"

/** Creates a SilentDisplay layer with a fresh Ref for test assertions */
export const silentDisplay = () => {
  const ref = Ref.unsafeMake<ReadonlyArray<DisplayEntry>>([])
  const layer = SilentDisplayLive(ref)
  return { ref, layer } as const
}
