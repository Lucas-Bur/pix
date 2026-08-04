import { Worker } from "node:worker_threads"

import type { FusionMethod } from "../../src/domain/retrieval.js"
import type { OptimizationProfile } from "./optimization-profiles.js"
import type { EvidenceRouterSearchResult, ValidationStrategy } from "./types.js"
import type { WeightSearchSample } from "./weight-search.js"
import { hasWorkerMessageType } from "./worker-message.js"

/** One independent evidence-router fold or repository holdout. */
export interface EvidenceRouterHoldoutJob {
  readonly kind: "holdout"
  readonly model: string
  readonly fusion: FusionMethod
  readonly strategy: ValidationStrategy
  readonly fold: string
  readonly development: readonly WeightSearchSample[]
  readonly validation: readonly WeightSearchSample[]
}

/** Result returned by one complete native router job. */
export type EvidenceRouterJobResult = readonly EvidenceRouterSearchResult[]

/** Options for the native pool that runs complete router jobs. */
export interface EvidenceRouterJobPoolOptions {
  /** Maximum number of native workers, with one complete search per worker. */
  readonly workerCount: number
  /** Abort signal that terminates all active router jobs. */
  readonly signal?: AbortSignal
  /** Test-only override for the router job worker entry point. */
  readonly workerUrl?: URL
  /** Test-only override for the TypeScript ESM loader. */
  readonly loaderUrl?: URL
}

interface WorkerReadyMessage {
  readonly type: "ready"
}

interface WorkerResultMessage {
  readonly type: "result"
  readonly jobId: number
  readonly results: EvidenceRouterJobResult
}

interface WorkerErrorMessage {
  readonly type: "error"
  readonly jobId?: number
  readonly message: string
}

type WorkerMessage = WorkerReadyMessage | WorkerResultMessage | WorkerErrorMessage

interface WorkerSlot {
  readonly worker: Worker
  busy: boolean
}

const DEFAULT_WORKER_URL = new URL("./router-job-worker.mjs", import.meta.url)
const DEFAULT_LOADER_URL = new URL("./ts-loader.mjs", import.meta.url)

const errorFromUnknown = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause))

const isWorkerMessage = (message: unknown): message is WorkerMessage => {
  return hasWorkerMessageType(message, ["ready", "result", "error"])
}

const workerExecArgv = (loaderUrl: URL): readonly string[] => [
  "--no-warnings",
  "--experimental-strip-types",
  "--experimental-loader",
  loaderUrl.href,
]

/** Run independent router holdout jobs in native workers and return results in input order. */
export const runEvidenceRouterJobs = (
  jobs: readonly EvidenceRouterHoldoutJob[],
  profile: OptimizationProfile,
  options: EvidenceRouterJobPoolOptions,
): Promise<readonly EvidenceRouterJobResult[]> => {
  if (jobs.length === 0) return Promise.resolve([])
  if (options.signal?.aborted)
    return Promise.reject(new Error("Evidence-router job pool was aborted before startup"))

  const workerCount = Math.min(jobs.length, Math.max(1, Math.floor(options.workerCount)))
  const workerUrl = options.workerUrl ?? DEFAULT_WORKER_URL
  const loaderUrl = options.loaderUrl ?? DEFAULT_LOADER_URL

  return new Promise((resolve, reject) => {
    const slots: WorkerSlot[] = []
    const results = new Map<number, EvidenceRouterJobResult>()
    let nextJob = 0
    let completedJobs = 0
    let settled = false

    const removeAbortListener = () => options.signal?.removeEventListener("abort", abort)

    const terminate = async (): Promise<void> => {
      await Promise.all(slots.map((slot) => slot.worker.terminate().catch(() => -1)))
    }

    const finish = (cause?: Error): void => {
      if (settled) return
      settled = true
      removeAbortListener()
      void terminate().then(() => {
        if (cause !== undefined) {
          reject(cause)
          return
        }
        const ordered: EvidenceRouterJobResult[] = []
        for (let index = 0; index < jobs.length; index++) {
          const result = results.get(index)
          if (result === undefined) {
            reject(new Error("Evidence-router job pool returned incomplete results"))
            return
          }
          ordered.push(result)
        }
        resolve(ordered)
      })
    }

    const abort = () => finish(new Error("Evidence-router job pool was interrupted"))

    const dispatch = (slot: WorkerSlot): void => {
      if (settled || slot.busy || nextJob >= jobs.length) return
      const jobId = nextJob++
      slot.busy = true
      try {
        slot.worker.postMessage({ type: "run", jobId, job: jobs[jobId], profile })
      } catch (cause) {
        finish(errorFromUnknown(cause))
      }
    }

    const handleMessage = (slot: WorkerSlot, message: unknown): void => {
      if (!isWorkerMessage(message)) {
        finish(new Error("Router job worker sent an invalid message"))
        return
      }
      if (message.type === "ready") {
        dispatch(slot)
        return
      }
      if (message.type === "error") {
        finish(new Error(message.message))
        return
      }
      if (message.results.length === 0) {
        finish(new Error(`Router job worker returned no results for job ${message.jobId}`))
        return
      }
      slot.busy = false
      results.set(message.jobId, message.results)
      completedJobs++
      if (completedJobs === jobs.length) {
        finish()
        return
      }
      dispatch(slot)
    }

    options.signal?.addEventListener("abort", abort, { once: true })
    try {
      for (let index = 0; index < workerCount; index++) {
        const worker = new Worker(workerUrl, {
          execArgv: [...workerExecArgv(loaderUrl)],
        })
        const slot: WorkerSlot = { worker, busy: false }
        worker.on("message", (message: unknown) => handleMessage(slot, message))
        worker.on("error", (cause: Error) => finish(cause))
        worker.on("exit", (code: number) => {
          if (!settled) finish(new Error(`Router job worker exited with code ${code}`))
        })
        slots.push(slot)
      }
    } catch (cause) {
      finish(errorFromUnknown(cause))
    }
  })
}
