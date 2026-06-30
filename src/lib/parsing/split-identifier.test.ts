import { describe, expect, it } from "vite-plus/test"

import { splitIdentifier } from "./split-identifier.js"

describe("splitIdentifier", () => {
  it("splits a camelCase identifier at word boundaries", () => {
    expect(splitIdentifier("resolveEmbedderConfig")).toEqual(["resolve", "embedder", "config"])
  })

  it("splits acronym boundaries like XMLHttpRequest", () => {
    expect(splitIdentifier("XMLHttpRequest")).toEqual(["xml", "http", "request"])
  })

  it("splits a trailing acronym like getURL", () => {
    expect(splitIdentifier("getURL")).toEqual(["get", "url"])
  })

  it("returns empty array for empty string", () => {
    expect(splitIdentifier("")).toEqual([])
  })

  it("splits PascalCase identifiers", () => {
    expect(splitIdentifier("EmbedderConfig")).toEqual(["embedder", "config"])
  })

  it("splits snake_case identifiers", () => {
    expect(splitIdentifier("parse_args")).toEqual(["parse", "args"])
  })

  it("splits SCREAMING_SNAKE_CASE identifiers", () => {
    expect(splitIdentifier("MAX_VALUE")).toEqual(["max", "value"])
  })

  it("splits kebab-case identifiers", () => {
    expect(splitIdentifier("foo-bar")).toEqual(["foo", "bar"])
  })

  it("returns a single word unchanged for a single-token identifier", () => {
    expect(splitIdentifier("foo")).toEqual(["foo"])
  })

  it("splits at digit-to-uppercase boundaries like foo2Bar", () => {
    expect(splitIdentifier("foo2Bar")).toEqual(["foo2", "bar"])
  })
})
