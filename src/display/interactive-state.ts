import { Effect, Ref } from "effect"

import { type DisplayUpdatePayload } from "../domain/ports.js"

export type ActiveInteractive =
  | { readonly type: "spinner" }
  | { readonly type: "progress"; readonly value: number; readonly max: number }
  | null

/** Extract the message text from an UpdateInteractivePayload */
export const payloadText = (p: DisplayUpdatePayload): string =>
  typeof p === "string" ? p : p.message

/**
 * Compute the delta for a progress bar from the payload + current state. Returns 0 if there is no
 * numeric payload or if the active element is a spinner.
 */
export const computeDelta = (
  p: DisplayUpdatePayload,
  state: { readonly value: number; readonly max: number },
): number => {
  if (typeof p === "string") return 0
  if ("advanceBy" in p && p.advanceBy !== undefined) {
    return Math.max(-state.value, p.advanceBy)
  }
  if ("setTo" in p && p.setTo !== undefined) {
    const target = Math.max(0, Math.min(state.max, p.setTo))
    return target - state.value
  }
  if ("setToPercent" in p && p.setToPercent !== undefined) {
    const target = Math.floor((state.max * p.setToPercent) / 100)
    return Math.max(-state.value, Math.min(state.max - state.value, target - state.value))
  }
  return 0
}

export const dismissSpinner = (activeRef: Ref.Ref<ActiveInteractive>): Effect.Effect<boolean> =>
  Ref.get(activeRef).pipe(
    Effect.flatMap((current) =>
      current && current.type === "spinner"
        ? Ref.set(activeRef, null).pipe(Effect.andThen(Effect.succeed(true)))
        : Effect.succeed(false),
    ),
  )

export const setActive = (
  activeRef: Ref.Ref<ActiveInteractive>,
  value: ActiveInteractive,
): Effect.Effect<void> => Ref.set(activeRef, value)

export const clearActive = (activeRef: Ref.Ref<ActiveInteractive>): Effect.Effect<void> =>
  Ref.set(activeRef, null)

export const getActive = (
  activeRef: Ref.Ref<ActiveInteractive>,
): Effect.Effect<ActiveInteractive> => Ref.get(activeRef)

export const updateProgressValue = (
  activeRef: Ref.Ref<ActiveInteractive>,
  value: number,
): Effect.Effect<void> =>
  Ref.update(activeRef, (current) =>
    current && current.type === "progress" ? { ...current, value } : current,
  )
