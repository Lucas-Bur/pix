import { expect, test } from "vite-plus/test"

import { formatBytes } from "./format.js"

test("formatBytes returns 0 B for zero", () => {
  expect(formatBytes(0)).toBe("0 B")
})

test("formatBytes formats bytes to human-readable string", () => {
  expect(formatBytes(512)).toBe("512.0 B")
  expect(formatBytes(1024)).toBe("1.0 KB")
  expect(formatBytes(1536)).toBe("1.5 KB")
  expect(formatBytes(1048576)).toBe("1.0 MB")
})

test("formatBytes handles GB boundary", () => {
  expect(formatBytes(1073741824)).toBe("1.0 GB")
  expect(formatBytes(1610612736)).toBe("1.5 GB")
})

test("formatBytes caps at GB for values >= 1 TB", () => {
  expect(formatBytes(1099511627776)).toBe("1024.0 GB")
  expect(formatBytes(1e15)).toBe("931322.6 GB")
})
