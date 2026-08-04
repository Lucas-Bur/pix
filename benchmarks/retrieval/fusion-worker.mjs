import { parentPort } from "node:worker_threads"

import { evaluateCandidate } from "./fusion-core.mjs"

if (parentPort === null) throw new Error("Fusion worker requires a parent port")

let snapshot

parentPort.on("message", (message) => {
  try {
    if (message.type === "init") {
      snapshot = message.snapshot
      parentPort.postMessage({ type: "ready" })
      return
    }
    if (message.type !== "evaluate" || snapshot === undefined)
      throw new Error("Fusion worker received an invalid task")
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
