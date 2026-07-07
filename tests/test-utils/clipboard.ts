import { Layer, Ref } from "effect"

import { Clipboard } from "../../src/domain/ports.js"

/** Creates a test Clipboard layer with a fresh Ref for copied text assertions. */
export const testClipboard = () => {
  const ref = Ref.makeUnsafe("")
  const layer = Layer.succeed(Clipboard, {
    copy: (text: string) => Ref.set(ref, text),
  })
  return { ref, layer }
}
