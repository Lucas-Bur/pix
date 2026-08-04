import { parentPort } from "node:worker_threads"

import { optimizeEvidenceRouter } from "./weight-search.ts"

if (parentPort === null) throw new Error("Router job worker requires a parent port")

parentPort.postMessage({ type: "ready" })

parentPort.on("message", async (message) => {
  if (message?.type !== "run") {
    parentPort.postMessage({ type: "error", message: "Router job worker received an invalid task" })
    return
  }
  try {
    const results = await optimizeEvidenceRouter(
      message.job.model,
      message.job.fusion,
      message.job.strategy,
      message.job.fold,
      message.job.development,
      message.job.validation,
      message.profile,
    )
    parentPort.postMessage({ type: "result", jobId: message.jobId, results })
  } catch (error) {
    parentPort.postMessage({
      type: "error",
      jobId: message.jobId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
})
