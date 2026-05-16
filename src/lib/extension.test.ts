import { expect, test } from "vite-plus/test"

import { getExtension, getFileExtension, getFilename } from "./extension.js"

test("getExtension strips directory and returns lowercase extension with dot", () => {
  expect(getExtension("src/services/chunker.ts")).toBe(".ts")
  expect(getExtension("/absolute/path/file.js")).toBe(".js")
  expect(getExtension("C:\\windows\\path\\file.ts")).toBe(".ts")
})

test("getExtension returns filename lowercased when no dot", () => {
  expect(getExtension("src/Makefile")).toBe("makefile")
  expect(getExtension("LICENSE")).toBe("license")
})

test("getExtension handles dotfiles", () => {
  expect(getExtension("src/.env")).toBe(".env")
  expect(getExtension("/home/user/.config")).toBe(".config")
  expect(getExtension(".gitignore")).toBe(".gitignore")
})

test("getExtension handles multiple dots", () => {
  expect(getExtension("file.test.ts")).toBe(".ts")
  expect(getExtension("archive.tar.gz")).toBe(".gz")
})

test("getFilename extracts filename from path", () => {
  expect(getFilename("src/services/chunker.ts")).toBe("chunker.ts")
  expect(getFilename("/absolute/path/file.js")).toBe("file.js")
  expect(getFilename("C:\\windows\\path\\file.ts")).toBe("file.ts")
  expect(getFilename("file.ts")).toBe("file.ts")
})

test("getFileExtension returns extension from filename", () => {
  expect(getFileExtension("chunker.ts")).toBe(".ts")
  expect(getFileExtension("file.js")).toBe(".js")
})

test("getFileExtension returns '(no extension)' when no dot", () => {
  expect(getFileExtension("Makefile")).toBe("(no extension)")
  expect(getFileExtension("LICENSE")).toBe("(no extension)")
})

test("getFileExtension handles dotfiles", () => {
  expect(getFileExtension(".gitignore")).toBe(".gitignore")
  expect(getFileExtension(".env")).toBe(".env")
})
