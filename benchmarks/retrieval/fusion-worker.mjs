import { parentPort } from "node:worker_threads"

import { evaluateCandidate } from "./fusion-core.mjs"

if (parentPort === null) throw new Error("Fusion worker requires a parent port")

const snapshots = new Map()

parentPort.postMessage({ type: "ready" })

parentPort.on("message", (message) => {
  try {
    if (message.type === "init") {
      snapshots.set("legacy", message.snapshot)
      return
    }
    if (message.type !== "evaluate") throw new Error("Fusion worker received an invalid task")
    const snapshotId = message.snapshotId ?? "legacy"
    if (message.snapshot !== undefined) snapshots.set(snapshotId, message.snapshot)
    const snapshot = snapshots.get(snapshotId)
    if (snapshot === undefined) throw new Error(`Fusion worker has no snapshot ${snapshotId}`)
    parentPort.postMessage({
      type: "result",
      taskId: message.taskId,
      results: message.candidates.map((candidate) => evaluateCandidate(snapshot, candidate)),
    })
  } catch (error) {
    parentPort.postMessage({
      type: "error",
      taskId: message.taskId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
})
