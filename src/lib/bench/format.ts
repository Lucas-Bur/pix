import type { BenchMeasurement, BenchProfile, BenchRecommendation } from "../../domain/bench.js"

/** Structured recommendation line for display rendering. */
export interface BenchRecLine {
  readonly label: string
  readonly isRecommended: boolean
}

/** Compute all three profile recommendations as structured data. */
export const computeRecommendations = (
  measurements: readonly BenchMeasurement[],
  activeProfile: BenchProfile,
): readonly BenchRecLine[] => {
  const profiles: BenchProfile[] = ["throughput", "balanced", "cold"]
  const lines: BenchRecLine[] = []

  for (const profile of profiles) {
    const rec = computeRecommendation(measurements, profile)
    if (!rec) continue

    lines.push({
      label: `${rec.device}/batchSize=${rec.batchSize} (${rec.profile})`,
      isRecommended: profile === activeProfile,
    })
  }

  return lines
}

export const computeRecommendation = (
  measurements: readonly BenchMeasurement[],
  profile: BenchProfile,
): BenchRecommendation | null => {
  const ok = measurements.filter((m) => m.status === "ok")
  if (ok.length === 0) return null

  let best: BenchMeasurement
  if (profile === "throughput") {
    best = ok.reduce((a, b) => (a.warmChunksPerSec > b.warmChunksPerSec ? a : b))
  } else if (profile === "cold") {
    best = ok.reduce((a, b) => (a.coldLatencyMs < b.coldLatencyMs ? a : b))
  } else {
    const maxCold = Math.max(...ok.map((m) => m.coldLatencyMs))
    const minCold = Math.min(...ok.map((m) => m.coldLatencyMs))
    const maxWarm = Math.max(...ok.map((m) => m.warmChunksPerSec))
    const minWarm = Math.min(...ok.map((m) => m.warmChunksPerSec))

    const coldRange = maxCold - minCold || 1
    const warmRange = maxWarm - minWarm || 1

    best = ok.reduce((best, m) => {
      const coldScore = 1 - (m.coldLatencyMs - minCold) / coldRange
      const warmScore = (m.warmChunksPerSec - minWarm) / warmRange
      const score = 0.7 * coldScore + 0.3 * warmScore
      const bestColdScore = 1 - (best.coldLatencyMs - minCold) / coldRange
      const bestWarmScore = (best.warmChunksPerSec - minWarm) / warmRange
      const bestScore = 0.7 * bestColdScore + 0.3 * bestWarmScore
      return score > bestScore ? m : best
    })
  }

  return { device: best.device, batchSize: best.batchSize, profile }
}
