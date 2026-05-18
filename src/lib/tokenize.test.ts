import { describe, expect, it } from "vite-plus/test"

import { tokenize } from "./tokenize.js"

describe("tokenize", () => {
  it("splits on whitespace", () => {
    expect(tokenize("hello world")).toEqual(["hello", "world"])
  })

  it("splits on punctuation", () => {
    expect(tokenize("hello,world")).toEqual(["hello", "world"])
  })

  it("splits underscores", () => {
    expect(tokenize("handle_request")).toEqual(["handle", "request"])
  })

  it("lowercases all tokens", () => {
    expect(tokenize("HandleRequest")).toEqual(["handle", "request"])
  })

  it("filters empty tokens", () => {
    expect(tokenize("  a  ,,  b  ")).toEqual(["a", "b"])
  })

  it("returns empty array for empty string", () => {
    expect(tokenize("")).toEqual([])
  })

  it("splits camelCase", () => {
    expect(tokenize("handleRequest")).toEqual(["handle", "request"])
  })

  it("splits PascalCase", () => {
    expect(tokenize("MyClass")).toEqual(["my", "class"])
  })

  it("splits multi-word camelCase", () => {
    expect(tokenize("getUserName")).toEqual(["get", "user", "name"])
  })

  it("splits snake_case", () => {
    expect(tokenize("handle_request")).toEqual(["handle", "request"])
  })
})
