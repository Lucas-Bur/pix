import { describe, expect, it } from "vite-plus/test"

import { splitCamelCase } from "./split-camelcase.js"

describe("splitCamelCase", () => {
  it("splits a camelCase identifier at word boundaries", () => {
    expect(splitCamelCase("resolveEmbedderConfig")).toEqual(["resolve", "embedder", "config"])
  })

  it("splits acronym boundaries like XMLHttpRequest", () => {
    expect(splitCamelCase("XMLHttpRequest")).toEqual(["xml", "http", "request"])
  })

  it("splits a trailing acronym like getURL", () => {
    expect(splitCamelCase("getURL")).toEqual(["get", "url"])
  })

  it("returns empty array for empty string", () => {
    expect(splitCamelCase("")).toEqual([])
  })

  it("splits PascalCase identifiers", () => {
    expect(splitCamelCase("EmbedderConfig")).toEqual(["embedder", "config"])
  })

  it("splits snake_case identifiers", () => {
    expect(splitCamelCase("parse_args")).toEqual(["parse", "args"])
  })

  it("splits SCREAMING_SNAKE_CASE identifiers", () => {
    expect(splitCamelCase("MAX_VALUE")).toEqual(["max", "value"])
  })

  it("splits kebab-case identifiers", () => {
    expect(splitCamelCase("foo-bar")).toEqual(["foo", "bar"])
  })

  it("returns a single word unchanged for a single-token identifier", () => {
    expect(splitCamelCase("foo")).toEqual(["foo"])
  })

  it("splits at digit-to-uppercase boundaries like foo2Bar", () => {
    expect(splitCamelCase("foo2Bar")).toEqual(["foo2", "bar"])
  })
})
