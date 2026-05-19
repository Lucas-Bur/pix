import type { BenchMeasurement, BenchRecommendation } from "../../domain/bench.js"

const formatNumber = (n: number): string => n.toLocaleString("en-US")

/** Format measurements as an ASCII table for CLI display. */
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

  const row = (cells: string[]) => `│ ${cells.map((c, i) => pad(c, colWidths[i]!)).join(" │ ")} │`

  const separator = (left: string, mid: string, right: string) =>
    left + colWidths.map((w) => mid.padStart(w + 2, mid)).join(mid) + right

  const lines: string[] = []
  lines.push(separator("┌", "─", "┐"))
  lines.push(row(header))
  lines.push(separator("├", "─", "┤"))

  for (const m of measurements) {
    const warm = m.status === "ok" ? formatNumber(Math.round(m.warmChunksPerSec)) : "—"
    lines.push(
      row([
        m.device,
        String(m.batchSize),
        String(Math.round(m.coldLatencyMs)),
        warm,
        String(Math.round(m.totalDurationMs)),
        m.status,
      ]),
    )
  }

  lines.push(separator("└", "─", "┘"))
  return lines.join("\n")
}

/** Format a recommendation as a human-readable message. */
export const formatRecommendationMessage = (rec: BenchRecommendation): string =>
  `Recommended: ${rec.device}/batchSize=${rec.batchSize} (${rec.profile})`
