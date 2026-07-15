import { expect, test, describe } from "@effect/vitest"

import { formatTable } from "./table.js"

describe("formatTable", () => {
  test("formats single row with clack-style corners", () => {
    const table = formatTable(["device", "status"], [["cpu", "ok"]])
    expect(table).toContain("cpu")
    expect(table).toContain("ok")
    expect(table).toContain("╭")
    expect(table).toContain("╮")
    expect(table).toContain("╰")
    expect(table).toContain("╯")
  })

  test("formats multiple rows", () => {
    const table = formatTable(
      ["device", "batchSize", "warm (ch/s)"],
      [
        ["cuda", "64", "12,000"],
        ["cpu", "8", "2,000"],
      ],
    )
    expect(table).toContain("cuda")
    expect(table).toContain("cpu")
    expect(table).toContain("12,000")
    expect(table).toContain("2,000")
  })

  test("empty rows returns table with header only", () => {
    const table = formatTable(["device", "status"], [])
    expect(table).toContain("device")
    expect(table).toContain("status")
  })

  test("uses vertical bar separator between columns", () => {
    const table = formatTable(["a", "b"], [["1", "2"]])
    expect(table).toContain("│")
  })

  test("handles missing cell values", () => {
    const table = formatTable(["a", "b", "c"], [["1"]])
    expect(table).toContain("1")
  })
})
