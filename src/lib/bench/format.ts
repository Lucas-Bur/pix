import type { BenchMeasurement, BenchProfile, BenchRecommendation } from "../../domain/bench.js"

const formatNumber = (n: number): string => n.toLocaleString("en-US")

const CORNER_TOP_LEFT = "╭"
const CORNER_TOP_RIGHT = "╮"
const CORNER_BOTTOM_LEFT = "╰"
const CORNER_BOTTOM_RIGHT = "╯"
const CONNECT_LEFT = "├"
const CONNECT_RIGHT = "┤"
const BAR = "│"
const BAR_H = "─"

/** Format measurements as an ASCII table for CLI display, using clack-style rounded corners. */
export const formatTable = (measurements: readonly BenchMeasurement[]): string => {
  const header = ["device", "batchSize", "cold (ms)", "warm (ch/s)", "time (ms)", "status"]
  const colWidths = [
    Math.max(header[0]!.length, ...measurements.map((m) => m.device.length)),
    Math.max(header[1]!.length, ...measurements.map((m) => String(m.batchSize).length)),
    Math.max(
      header[2]!.length,
      ...measurements.map((m) => String(Math.round(m.coldLatencyMs)).length),
    ),
    Math.max(
      header[3]!.length,
      ...measurements.map((m) =>
        m.status === "ok" ? formatNumber(Math.round(m.warmChunksPerSec)).length : 1,
      ),
    ),
    Math.max(
      header[4]!.length,
      ...measurements.map((m) => String(Math.round(m.totalDurationMs)).length),
    ),
    Math.max(header[5]!.length, ...measurements.map((m) => m.status.length)),
  ]

  const pad = (s: string, w: number) => s.padStart(w)

  const row = (cells: string[]) =>
    `${BAR} ${cells.map((c, i) => pad(c, colWidths[i]!)).join(` ${BAR} `)} ${BAR}`

  const separator = (left: string, mid: string, right: string) =>
    left + colWidths.map((w) => mid.padStart(w + 2, mid)).join(mid) + right

  const lines: string[] = []
  lines.push(separator(CORNER_TOP_LEFT, BAR_H, CORNER_TOP_RIGHT))
  lines.push(row(header))
  lines.push(separator(CONNECT_LEFT, BAR_H, CONNECT_RIGHT))

  for (const m of measurements) {
    const warm = m.status === "ok" ? formatNumber(Math.round(m.warmChunksPerSec)) : "—"
    const bs = m.status === "failed" && m.batchSize === 0 ? "—" : String(m.batchSize)
    lines.push(
      row([
        m.device,
        bs,
        String(Math.round(m.coldLatencyMs)),
        warm,
        String(Math.round(m.totalDurationMs)),
        m.status,
      ]),
    )
  }

  lines.push(separator(CORNER_BOTTOM_LEFT, BAR_H, CORNER_BOTTOM_RIGHT))
  return lines.join("\n")
}

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

const computeRecommendation = (
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
