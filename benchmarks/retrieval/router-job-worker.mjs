import { parentPort } from "node:worker_threads"

import {
  fitRecommendedEvidenceRouter,
  fitRecommendedEvidenceRouterParallel,
  optimizeEvidenceRouter,
  optimizeEvidenceRouterParallel,
} from "./weight-search.ts"

if (parentPort === null) throw new Error("Router job worker requires a parent port")

let busy = false
let activeCandidateQueue

const createRemoteCandidateQueue = (workerCount, batchSize) => {
  const pending = new Map()
  const snapshotIds = new WeakMap()
  const sentSnapshots = new WeakSet()
  let nextRequestId = 0
  let nextSnapshotId = 0
  let closed = false

  const queue = {
    workerCount,
    batchSize,
    activeWorkerCount: () => 0,
    evaluate(snapshot, candidates, signal, requestedSnapshotId) {
      if (closed) return Promise.reject(new Error("Remote candidate queue is closed"))
      if (signal?.aborted)
        return Promise.reject(new Error("Remote candidate queue was interrupted"))
      if (candidates.length === 0) return Promise.resolve([])
      let snapshotId = requestedSnapshotId ?? snapshotIds.get(snapshot)
      if (snapshotId === undefined) {
        snapshotId = String(nextSnapshotId++)
        snapshotIds.set(snapshot, snapshotId)
      }
      const requestId = nextRequestId++
      return new Promise((resolve, reject) => {
        const abort = () => {
          pending.delete(requestId)
          reject(new Error("Remote candidate queue was interrupted"))
        }
        if (signal !== undefined) {
          signal.addEventListener("abort", abort, { once: true })
          if (signal.aborted) {
            abort()
            return
          }
        }
        pending.set(requestId, {
          resolve: (results) => {
            signal?.removeEventListener("abort", abort)
            resolve(results)
          },
          reject: (error) => {
            signal?.removeEventListener("abort", abort)
            reject(error)
          },
        })
        parentPort.postMessage({
          type: "candidate-evaluate",
          requestId,
          snapshotId,
          snapshot: sentSnapshots.has(snapshot) ? undefined : snapshot,
          candidates,
        })
        sentSnapshots.add(snapshot)
      })
    },
    handleResult(message) {
      const request = pending.get(message.requestId)
      if (request === undefined) return
      pending.delete(message.requestId)
      if (message.type === "candidate-error") request.reject(new Error(message.message))
      else request.resolve(message.results)
    },
    close() {
      closed = true
      for (const request of pending.values())
        request.reject(new Error("Remote candidate queue closed"))
      pending.clear()
    },
  }
  return queue
}

const runJob = async (message) => {
  const candidateQueue = message.useCandidateQueue
    ? createRemoteCandidateQueue(message.candidateWorkerCount, message.candidateBatchSize)
    : undefined
  activeCandidateQueue = candidateQueue
  const options =
    candidateQueue === undefined
      ? { workerCount: 0 }
      : {
          workerCount: candidateQueue.workerCount,
          fallbackToSerial: false,
          evaluationQueue: candidateQueue,
        }
  try {
    if (message.job.kind === "holdout") {
      const results =
        candidateQueue === undefined
          ? await optimizeEvidenceRouter(
              message.job.model,
              message.job.fusion,
              message.job.strategy,
              message.job.fold,
              message.job.development,
              message.job.validation,
              message.profile,
            )
          : await optimizeEvidenceRouterParallel(
              message.job.model,
              message.job.fusion,
              message.job.strategy,
              message.job.fold,
              message.job.development,
              message.job.validation,
              message.profile,
              options,
            )
      parentPort.postMessage({ type: "result", jobId: message.jobId, kind: "holdout", results })
    } else if (message.job.kind === "fit-all") {
      const results =
        candidateQueue === undefined
          ? await fitRecommendedEvidenceRouter(
              message.job.model,
              message.job.fusion,
              message.job.samples,
              message.profile,
            )
          : await fitRecommendedEvidenceRouterParallel(
              message.job.model,
              message.job.fusion,
              message.job.samples,
              message.profile,
              options,
            )
      parentPort.postMessage({ type: "result", jobId: message.jobId, kind: "fit-all", results })
    } else {
      throw new Error("Router job worker received an unknown job kind")
    }
  } finally {
    candidateQueue?.close()
    activeCandidateQueue = undefined
  }
}

parentPort.postMessage({ type: "ready" })

parentPort.on("message", async (message) => {
  if (message?.type === "candidate-result" || message?.type === "candidate-error") {
    activeCandidateQueue?.handleResult(message)
    return
  }
  if (message?.type !== "run") {
    parentPort.postMessage({ type: "error", message: "Router job worker received an invalid task" })
    return
  }
  if (busy) {
    parentPort.postMessage({
      type: "error",
      jobId: message.jobId,
      message: "Router job worker is busy",
    })
    return
  }
  busy = true
  try {
    await runJob(message)
  } catch (error) {
    parentPort.postMessage({
      type: "error",
      jobId: message.jobId,
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    busy = false
  }
})
