import { spawnSync } from "node:child_process"
import { appendFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")
const PIX = resolve(ROOT, "dist/index.mjs")
const LOG = resolve(ROOT, "bench-results.log")
const RUNS = 5
const WARM = 2

if (!existsSync(PIX)) {
  console.error(`dist/index.mjs not found – run "vp run build" first`)
  process.exit(1)
}

const commands = [
  "--help",
  "--version",
  "init --help",
  "status --help",
  "query --help",
  "reset --help",
  "status",
  "reset",
]

const measure = (cmd) => {
  const start = performance.now()
  spawnSync("node", [PIX, ...cmd.split(" ")], { cwd: ROOT, stdio: "ignore", timeout: 30000 })
  return performance.now() - start
}

const stats = (times) => {
  const sorted = [...times].sort((a, b) => a - b)
  const avg = times.reduce((a, b) => a + b, 0) / times.length
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(avg),
    median: sorted[Math.floor(sorted.length / 2)],
    raw: times,
  }
}

// === Baseline ===
const baseRuns = []
for (let i = 0; i < RUNS + WARM; i++) {
  const start = performance.now()
  spawnSync("node", ["-e", "process.exit(0)"], { stdio: "ignore" })
  if (i >= WARM) baseRuns.push(performance.now() - start)
}
const baseAvg = Math.round(baseRuns.reduce((a, b) => a + b, 0) / baseRuns.length)

const timestamp = new Date().toISOString()
const banner = `\n=== ${timestamp} (baseline: ${baseAvg}ms, ${RUNS} runs each) ===\n`

console.log(banner)
appendFileSync(LOG, banner)

const hdr = (s, w) => s.toString().padStart(w)
const header = `${"command".padEnd(22)} ${hdr("avg", 7)} ${hdr("min", 7)} ${hdr("max", 7)} ${hdr("median", 7)}  raw`
console.log(header)
console.log("─".repeat(80))
appendFileSync(LOG, header + "\n" + "─".repeat(80) + "\n")

for (const cmd of commands) {
  const runs = []
  for (let i = 0; i < RUNS + WARM; i++) {
    const t = measure(cmd)
    if (i >= WARM) runs.push(t)
  }
  const s = stats(runs)
  const line = `${`pix ${cmd}`.padEnd(22)} ${hdr(s.avg, 7)} ${hdr(s.min, 7)} ${hdr(s.max, 7)} ${hdr(s.median, 7)}  ${s.raw.map((t) => `${Math.round(t)}`).join(", ")}`
  console.log(line)
  appendFileSync(LOG, line + "\n")
}

console.log(`\nResults appended to ${LOG}`)
