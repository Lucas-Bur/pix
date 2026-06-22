import { expect, test, describe } from "vite-plus/test"

import type { BenchMeasurement } from "../../domain/bench.js"
import { computeRecommendations } from "./format.js"

const makeMeasurement = (overrides: Partial<BenchMeasurement> = {}): BenchMeasurement => ({
  device: "cpu",
  batchSize: 16,
  coldLatencyMs: 500,
  warmChunksPerSec: 1000,
  warmLatencyPerBatchMs: 16,
  totalDurationMs: 100,
  status: "ok",
  error: null,
  ...overrides,
})

describe("computeRecommendations", () => {
  const okMeasurements: BenchMeasurement[] = [
    makeMeasurement({ device: "cuda", batchSize: 64, warmChunksPerSec: 12000, coldLatencyMs: 300 }),
    makeMeasurement({
      device: "cuda",
      batchSize: 128,
      warmChunksPerSec: 12800,
      coldLatencyMs: 300,
    }),
    makeMeasurement({ device: "cpu", batchSize: 8, warmChunksPerSec: 2000, coldLatencyMs: 900 }),
  ]

  test("returns all three profiles", () => {
    const recs = computeRecommendations(okMeasurements, "balanced")
    expect(recs).toHaveLength(3)
    const profiles = recs.map((r) => r.label)
    expect(profiles.some((l) => l.includes("throughput"))).toBe(true)
    expect(profiles.some((l) => l.includes("balanced"))).toBe(true)
    expect(profiles.some((l) => l.includes("cold"))).toBe(true)
  })

  test("marks active profile as recommended", () => {
    const recs = computeRecommendations(okMeasurements, "balanced")
    const active = recs.find((r) => r.isRecommended)
    expect(active).toBeDefined()
    expect(active!.label).toContain("balanced")
  })

  test("only one profile is recommended", () => {
    const recs = computeRecommendations(okMeasurements, "balanced")
    const recommended = recs.filter((r) => r.isRecommended)
    expect(recommended).toHaveLength(1)
  })

  test("returns empty for all-failed measurements", () => {
    const failed: BenchMeasurement[] = [makeMeasurement({ status: "failed", batchSize: 0 })]
    const recs = computeRecommendations(failed, "balanced")
    expect(recs).toHaveLength(0)
  })

  test("throughput profile picks highest warmChunksPerSec as recommended", () => {
    const recs = computeRecommendations(okMeasurements, "throughput")
    const active = recs.find((r) => r.isRecommended)
    expect(active).toBeDefined()
    expect(active!.label).toContain("batchSize=128")
    expect(active!.label).toContain("throughput")
  })

  test("cold profile picks lowest coldLatencyMs as recommended", () => {
    const recs = computeRecommendations(okMeasurements, "cold")
    const active = recs.find((r) => r.isRecommended)
    expect(active).toBeDefined()
    expect(active!.label).toContain("cold")
  })
})
