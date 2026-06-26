import { Ref } from "effect"

import type { DisplayEntry } from "../../src/display/entries.js"
import { SilentDisplayLive } from "../../src/display/silent-display.js"

/** Creates a SilentDisplay layer with a fresh Ref for test assertions */
export const silentDisplay = (selectValue?: string) => {
  const ref = Ref.makeUnsafe<ReadonlyArray<DisplayEntry>>([])
  const layer = SilentDisplayLive(ref, selectValue)
  return { ref, layer } as const
}
