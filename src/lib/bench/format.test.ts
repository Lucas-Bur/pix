import { expect, test, describe } from "vite-plus/test"

import type { BenchMeasurement, BenchRecommendation } from "../../domain/bench.js"
import { formatTable, formatRecommendationMessage } from "./format.js"

const makeMeasurement = (overrides: Partial<BenchMeasurement> = {}): BenchMeasurement => ({
  device: "cpu",
  batchSize: 16,
  coldLatencyMs: 500,
  warmChunksPerSec: 1000,
  warmLatencyPerBatchMs: 16,
  status: "ok",
  ...overrides,
})

describe("formatTable", () => {
  test("formats single measurement", () => {
    const table = formatTable([makeMeasurement()])
    expect(table).toContain("cpu")
    expect(table).toContain("16")
    expect(table).toContain("ok")
    expect(table).toContain("500")
    expect(table).toContain("1,000")
  })

  test("formats failed measurement with dash", () => {
    const table = formatTable([makeMeasurement({ status: "failed" })])
    expect(table).toContain("failed")
    expect(table).toContain("—")
  })

  test("formats multiple measurements", () => {
    const measurements = [
      makeMeasurement({ device: "cuda", batchSize: 64, warmChunksPerSec: 12000 }),
      makeMeasurement({ device: "cpu", batchSize: 8, warmChunksPerSec: 2000 }),
    ]
    const table = formatTable(measurements)
    expect(table).toContain("cuda")
    expect(table).toContain("cpu")
    expect(table).toContain("12,000")
    expect(table).toContain("2,000")
  })

  test("empty measurements returns table with header only", () => {
    const table = formatTable([])
    expect(table).toContain("device")
    expect(table).toContain("batchSize")
    expect(table).toContain("cold (ms)")
    expect(table).toContain("warm (ch/s)")
    expect(table).toContain("status")
  })
})

describe("formatRecommendationMessage", () => {
  test("formats recommendation", () => {
    const rec: BenchRecommendation = { device: "cuda", batchSize: 64, profile: "balanced" }
    expect(formatRecommendationMessage(rec)).toBe("Recommended: cuda/batchSize=64 (balanced)")
  })

  test("formats throughput profile", () => {
    const rec: BenchRecommendation = { device: "cpu", batchSize: 16, profile: "throughput" }
    expect(formatRecommendationMessage(rec)).toBe("Recommended: cpu/batchSize=16 (throughput)")
  })
})
