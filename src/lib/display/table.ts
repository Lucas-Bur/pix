const CORNER_TOP_LEFT = "╭"
const CORNER_TOP_RIGHT = "╮"
const CORNER_BOTTOM_LEFT = "╰"
const CORNER_BOTTOM_RIGHT = "╯"
const CONNECT_LEFT = "├"
const CONNECT_RIGHT = "┤"
const BAR = "│"
const BAR_H = "─"

/** Format a table as an ASCII string with clack-style rounded corners. */
export const formatTable = (
  header: readonly string[],
  rows: readonly (readonly string[])[],
): string => {
  const colCount = header.length

  const colWidths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => (row[i] ?? "").length)),
  )

  const pad = (s: string, w: number) => s.padStart(w)

  const rowStr = (cells: readonly string[]) =>
    `${BAR} ${cells.map((c, i) => pad(c, colWidths[i]!)).join(` ${BAR} `)} ${BAR}`

  const separator = (left: string, mid: string, right: string) =>
    left + colWidths.map((w) => mid.padStart(w + 2, mid)).join(mid) + right

  const lines: string[] = []
  lines.push(separator(CORNER_TOP_LEFT, BAR_H, CORNER_TOP_RIGHT))
  lines.push(rowStr(header))
  lines.push(separator(CONNECT_LEFT, BAR_H, CONNECT_RIGHT))

  for (const row of rows) {
    const cells: string[] = []
    for (let i = 0; i < colCount; i++) {
      const val = row[i] ?? ""
      cells.push(val)
    }
    lines.push(rowStr(cells))
  }

  lines.push(separator(CORNER_BOTTOM_LEFT, BAR_H, CORNER_BOTTOM_RIGHT))
  return lines.join("\n")
}
