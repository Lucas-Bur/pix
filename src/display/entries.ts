import { Data } from "effect"

import type { DisplaySeverity } from "../domain/ports.js"

/** Union of all display entries recorded by SilentDisplay for test assertions */
export type DisplayEntry = Data.TaggedEnum<{
  readonly intro: { readonly title: string }
  readonly outro: { readonly message: string }
  readonly log: { readonly message: string; readonly severity: DisplaySeverity }
  readonly note: { readonly content: string; readonly title?: string }
  readonly text: { readonly message: string }
  readonly table: {
    readonly header: readonly string[]
    readonly rows: readonly (readonly string[])[]
  }
  readonly spinner: { readonly message: string }
  readonly progress: { readonly message: string; readonly max: number }
  readonly updateInteractive: {
    readonly message: string
    readonly advanceBy?: number
    readonly setTo?: number
    readonly setToPercent?: number
  }
  readonly json: { readonly data: unknown }
}>

export const DisplayEntry = Data.taggedEnum<DisplayEntry>()
