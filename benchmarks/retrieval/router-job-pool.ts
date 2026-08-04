import { Worker } from "node:worker_threads"

import type { FusionMethod } from "../../src/domain/retrieval.js"
import type { OptimizationProfile } from "./optimization-profiles.js"
import type {
  EvidenceRouterSearchResult,
  RecommendedEvidenceRouter,
  ValidationStrategy,
} from "./types.js"
import type { WeightSearchSample } from "./weight-search.js"
import type {
  CandidateEvaluationQueue,
  EvaluationCandidate,
  EvaluationSnapshot,
} from "./worker-pool.js"

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

/** One fit-all router search over every sample after holdout evaluation. */
export interface EvidenceRouterFitAllJob {
  readonly kind: "fit-all"
  readonly model: string
  readonly fusion: FusionMethod
  readonly samples: readonly WeightSearchSample[]
}

/** One complete router search handled by a native worker. */
export type EvidenceRouterJob = EvidenceRouterHoldoutJob | EvidenceRouterFitAllJob

/** Tagged result returned by one holdout router job. */
export interface EvidenceRouterHoldoutJobResult {
  readonly jobId: number
  readonly kind: "holdout"
  readonly results: readonly EvidenceRouterSearchResult[]
}

/** Tagged result returned by one fit-all router job. */
export interface EvidenceRouterFitAllJobResult {
  readonly jobId: number
  readonly kind: "fit-all"
  readonly results: readonly RecommendedEvidenceRouter[]
}

/** Tagged result returned by one complete native router job. */
export type EvidenceRouterJobResult = EvidenceRouterHoldoutJobResult | EvidenceRouterFitAllJobResult

/** Options for the native pool that runs complete router jobs. */
export interface EvidenceRouterJobPoolOptions {
  /** Maximum number of native router-controller workers. */
  readonly workerCount: number
  /** Shared candidate queue used by the active router controllers. */
  readonly candidateQueue?: CandidateEvaluationQueue
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

interface WorkerHoldoutResultMessage {
  readonly type: "result"
  readonly jobId: number
  readonly kind: "holdout"
  readonly results: readonly EvidenceRouterSearchResult[]
}

interface WorkerFitAllResultMessage {
  readonly type: "result"
  readonly jobId: number
  readonly kind: "fit-all"
  readonly results: readonly RecommendedEvidenceRouter[]
}

interface WorkerCandidateEvaluateMessage {
  readonly type: "candidate-evaluate"
  readonly requestId: number
  readonly snapshotId: string
  readonly snapshot?: EvaluationSnapshot
  readonly candidates: readonly EvaluationCandidate[]
}

interface WorkerErrorMessage {
  readonly type: "error"
  readonly jobId?: number
  readonly message: string
}

type WorkerMessage =
  | WorkerReadyMessage
  | WorkerHoldoutResultMessage
  | WorkerFitAllResultMessage
  | WorkerCandidateEvaluateMessage
  | WorkerErrorMessage

interface WorkerSlot {
  readonly slotId: number
  readonly worker: Worker
  readonly candidateSnapshots: Map<string, EvaluationSnapshot>
  busy: boolean
}

const DEFAULT_WORKER_URL = new URL("./router-job-worker.mjs", import.meta.url)
const DEFAULT_LOADER_URL = new URL("./ts-loader.mjs", import.meta.url)

const errorFromUnknown = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause))

const isRecord = (message: unknown): message is Record<string, unknown> =>
  typeof message === "object" && message !== null

const isWorkerMessage = (message: unknown): message is WorkerMessage => {
  if (!isRecord(message) || typeof message.type !== "string") return false
  if (message.type === "ready") return true
  if (message.type === "error") return typeof message.message === "string"
  if (message.type === "candidate-evaluate")
    return (
      Number.isInteger(message.requestId) &&
      typeof message.snapshotId === "string" &&
      (message.snapshot === undefined ||
        (typeof message.snapshot === "object" && message.snapshot !== null)) &&
      Array.isArray(message.candidates)
    )
  return (
    message.type === "result" &&
    Number.isInteger(message.jobId) &&
    (message.kind === "holdout" || message.kind === "fit-all") &&
    Array.isArray(message.results)
  )
}

const workerExecArgv = (loaderUrl: URL): readonly string[] => [
  "--no-warnings",
  "--experimental-strip-types",
  "--experimental-loader",
  loaderUrl.href,
]

/** Run independent router jobs in native workers and return tagged results in input order. */
export const runEvidenceRouterJobs = (
  jobs: readonly EvidenceRouterJob[],
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
        slot.worker.postMessage({
          type: "run",
          jobId,
          job: jobs[jobId],
          profile,
          candidateWorkerCount: options.candidateQueue?.workerCount ?? 0,
          candidateBatchSize: options.candidateQueue?.batchSize ?? 0,
          useCandidateQueue: options.candidateQueue !== undefined,
        })
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
      if (message.type === "candidate-evaluate") {
        if (options.candidateQueue === undefined) {
          finish(new Error("Router job worker requested a candidate queue that was not configured"))
          return
        }
        const snapshot = message.snapshot ?? slot.candidateSnapshots.get(message.snapshotId)
        if (snapshot === undefined) {
          finish(new Error(`Router job worker omitted snapshot ${message.snapshotId}`))
          return
        }
        if (message.snapshot !== undefined)
          slot.candidateSnapshots.set(message.snapshotId, message.snapshot)
        void options.candidateQueue
          .evaluate(snapshot, message.candidates, undefined, `${slot.slotId}:${message.snapshotId}`)
          .then((results) => {
            if (settled) return
            try {
              slot.worker.postMessage({
                type: "candidate-result",
                requestId: message.requestId,
                results,
              })
            } catch (cause) {
              finish(errorFromUnknown(cause))
            }
          })
          .catch((cause) => finish(errorFromUnknown(cause)))
        return
      }
      const job = jobs[message.jobId]
      if (job === undefined || job.kind !== message.kind) {
        finish(new Error(`Router job worker returned an unexpected job ${message.jobId}`))
        return
      }
      if (message.results.length === 0) {
        finish(new Error(`Router job worker returned no results for job ${message.jobId}`))
        return
      }
      slot.busy = false
      if (message.kind === "holdout") {
        results.set(message.jobId, {
          jobId: message.jobId,
          kind: "holdout",
          results: message.results,
        })
      } else {
        results.set(message.jobId, {
          jobId: message.jobId,
          kind: "fit-all",
          results: message.results,
        })
      }
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
        const slot: WorkerSlot = {
          slotId: index,
          worker,
          candidateSnapshots: new Map(),
          busy: false,
        }
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
