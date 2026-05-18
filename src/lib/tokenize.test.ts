import { describe, expect, it } from "vite-plus/test"

import { tokenize } from "./tokenize.js"

describe("tokenize", () => {
  it("splits on whitespace", () => {
    expect(tokenize("hello world")).toEqual(["hello", "world"])
  })

  it("splits on punctuation", () => {
    expect(tokenize("hello,world")).toEqual(["hello", "world"])
  })

  it("preserves underscores", () => {
    expect(tokenize("handle_request")).toEqual(["handle_request"])
  })

  it("lowercases all tokens", () => {
    expect(tokenize("HandleRequest")).toEqual(["handlerequest"])
  })

  it("filters empty tokens", () => {
    expect(tokenize("  a  ,,  b  ")).toEqual(["a", "b"])
  })

  it("returns empty array for empty string", () => {
    expect(tokenize("")).toEqual([])
  })
})
