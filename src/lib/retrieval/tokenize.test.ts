import { describe, expect, it } from "@effect/vitest"

import { tokenize } from "./tokenize.js"

describe("tokenize", () => {
  it("splits on whitespace", () => {
    expect(tokenize("hello world")).toEqual(["hello", "world"])
  })

  it("splits on punctuation", () => {
    expect(tokenize("hello, world!")).toEqual(["hello", "world"])
  })

  it("splits underscores", () => {
    expect(tokenize("hello_world")).toEqual(["hello", "world"])
  })

  it("lowercases all tokens", () => {
    expect(tokenize("Hello WORLD")).toEqual(["hello", "world"])
  })

  it("filters empty tokens", () => {
    expect(tokenize("  hello   world  ")).toEqual(["hello", "world"])
  })

  it("returns empty array for empty string", () => {
    expect(tokenize("")).toEqual([])
  })

  it("splits camelCase", () => {
    expect(tokenize("camelCase")).toEqual(["camel", "case"])
  })

  it("splits PascalCase", () => {
    expect(tokenize("PascalCase")).toEqual(["pascal", "case"])
  })

  it("splits snake_case", () => {
    expect(tokenize("snake_case")).toEqual(["snake", "case"])
  })
})
