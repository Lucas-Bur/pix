import { availableParallelism } from "node:os"
import { Worker } from "node:worker_threads"

import type { Chunk } from "../../src/domain/chunk.js"
import type { ChannelWeights } from "../../src/domain/retrieval.js"
import { evaluateCandidate } from "./fusion-core.mjs"
import { type PreparedFusionEvaluator, type PreparedFusionSnapshot } from "./fusion.js"
import type { QualitySummary } from "./types.js"

const DEFAULT_BATCH_SIZE = 32
const DEFAULT_WORKER_URL = new URL("./fusion-worker.mjs", import.meta.url)

/** One prepared benchmark sample represented without source text for worker transfer. */
export interface EvaluationSampleSnapshot {
  readonly fusion: PreparedFusionSnapshot
  readonly targets: readonly (readonly number[])[]
  readonly contextTokens: readonly number[]
  readonly sampleWeight: number
}

/** Immutable prepared inputs shared by every candidate evaluation in one search. */
export interface EvaluationSnapshot {
  readonly samples: readonly EvaluationSampleSnapshot[]
}

/** Main-thread inputs used to build a compact worker snapshot. */
export interface EvaluationSampleInput {
  readonly evaluator: PreparedFusionEvaluator
  readonly targets: readonly ReadonlySet<number>[]
  readonly chunks: readonly Chunk[]
  readonly sampleWeight: number
}

/** One candidate's static weights or one weight vector per prepared sample. */
export interface EvaluationCandidate {
  readonly weights: ChannelWeights | readonly ChannelWeights[]
}

/** Native-worker or serial execution mode used by a candidate pool. */
export type EvaluationPoolMode = "parallel" | "serial"

/** Configuration for one reusable benchmark candidate pool. */
export interface CandidateEvaluationPoolOptions {
  /** Override the default worker count; zero explicitly selects serial evaluation. */
  readonly workerCount?: number
  /** Maximum number of candidate vectors sent in one worker message. */
  readonly batchSize?: number
  /** Test-only or diagnostic override for the native worker entry point. */
  readonly workerUrl?: URL
  /** Fall back to serial evaluation if worker startup is unavailable. */
  readonly fallbackToSerial?: boolean
}

/** Cumulative scheduling information exposed for deterministic pool tests and reports. */
export interface CandidateEvaluationPoolStats {
  readonly mode: EvaluationPoolMode
  readonly workerCount: number
  readonly activeWorkerCount: number
  readonly batchSize: number
  readonly batches: number
  readonly candidates: number
}

/** Reusable evaluator for batched benchmark candidates. */
export interface CandidateEvaluationPool {
  readonly mode: EvaluationPoolMode
  readonly workerCount: number
  readonly batchSize: number
  readonly evaluate: (
    candidates: readonly EvaluationCandidate[],
  ) => Promise<readonly QualitySummary[]>
  readonly close: () => Promise<void>
  readonly stats: () => CandidateEvaluationPoolStats
}

interface WorkerReadyMessage {
  readonly type: "ready"
}

interface WorkerResultMessage {
  readonly type: "result"
  readonly taskId: number
  readonly results: readonly QualitySummary[]
}

interface WorkerErrorMessage {
  readonly type: "error"
  readonly taskId?: number
  readonly message: string
}

type WorkerMessage = WorkerReadyMessage | WorkerResultMessage | WorkerErrorMessage

interface WorkerTask {
  readonly taskId: number
  readonly start: number
  readonly end: number
}

interface WorkerSlot {
  readonly worker: Worker
  readonly ready: Promise<void>
  readonly resolveReady: () => void
  readonly rejectReady: (error: Error) => void
  busy: boolean
  task?: WorkerTask
}

interface ActiveEvaluation {
  readonly candidates: readonly EvaluationCandidate[]
  readonly results: Map<number, QualitySummary>
  readonly tasks: Map<number, WorkerTask>
  readonly resolve: (results: readonly QualitySummary[]) => void
  readonly reject: (error: Error) => void
  nextCandidate: number
  completedCandidates: number
}

const errorFromUnknown = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause))

const parseInteger = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim() === "") return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : undefined
}

/** Return the default native pool size, reserving one core for the benchmark coordinator. */
export const getDefaultWorkerCount = (): number => Math.max(1, availableParallelism() - 1)

/** Resolve an explicit, environment, or default worker count for benchmark evaluation. */
export const resolveWorkerCount = (requested?: number): number => {
  const configured = requested ?? parseInteger(process.env.PIX_BENCH_WORKERS)
  if (configured === undefined) return getDefaultWorkerCount()
  return Math.max(0, configured)
}

const resolveBatchSize = (requested?: number): number => {
  const configured = requested ?? parseInteger(process.env.PIX_BENCH_WORKER_BATCH_SIZE)
  return Math.max(1, configured ?? DEFAULT_BATCH_SIZE)
}

const contextTokens = (chunk: Chunk): number =>
  Math.ceil(
    Buffer.byteLength(`${chunk.file}:${chunk.startLine}-${chunk.endLine}\n${chunk.text}`, "utf8") /
      4,
  )

/** Build the compact, cloneable snapshot used by serial and worker evaluators. */
export const createEvaluationSnapshot = (
  inputs: readonly EvaluationSampleInput[],
): EvaluationSnapshot => {
  const contextTokenCache = new WeakMap<readonly Chunk[], readonly number[]>()
  return {
    samples: inputs.map((input) => {
      let cachedContextTokens = contextTokenCache.get(input.chunks)
      if (cachedContextTokens === undefined) {
        cachedContextTokens = input.chunks.map(contextTokens)
        contextTokenCache.set(input.chunks, cachedContextTokens)
      }
      return {
        fusion: input.evaluator.snapshot,
        targets: input.targets.map((target) => [...target]),
        contextTokens: cachedContextTokens,
        sampleWeight: input.sampleWeight,
      }
    }),
  }
}

/** Evaluate candidates serially using the same prepared snapshot as the worker pool. */
export const evaluateCandidatesSerial = (
  snapshot: EvaluationSnapshot,
  candidates: readonly EvaluationCandidate[],
): readonly QualitySummary[] =>
  candidates.map((candidate) => evaluateCandidate(snapshot, candidate))

const isWorkerMessage = (message: unknown): message is WorkerMessage => {
  if (typeof message !== "object" || message === null || !("type" in message)) return false
  const type = message.type
  return type === "ready" || type === "result" || type === "error"
}

class NativeCandidateEvaluationPool implements CandidateEvaluationPool {
  readonly mode = "parallel" as const
  readonly workerCount: number
  readonly batchSize: number

  private readonly slots: WorkerSlot[]
  private readonly ready: Promise<void>
  private active: ActiveEvaluation | undefined
  private closePromise: Promise<void> | undefined
  private closed = false
  private nextTaskId = 0
  private batchCount = 0
  private candidateCount = 0

  private constructor(
    snapshot: EvaluationSnapshot,
    workerCount: number,
    batchSize: number,
    workerUrl: URL,
  ) {
    this.workerCount = workerCount
    this.batchSize = batchSize
    this.slots = []
    for (let index = 0; index < workerCount; index++) {
      let resolveReady: () => void = () => undefined
      let rejectReady: (error: Error) => void = () => undefined
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve
        rejectReady = reject
      })
      const worker = new Worker(workerUrl)
      const slot: WorkerSlot = {
        worker,
        ready,
        resolveReady,
        rejectReady,
        busy: false,
      }
      worker.on("message", (message: unknown) => this.handleMessage(slot, message))
      worker.on("error", (cause: Error) => this.handleWorkerError(slot, cause))
      worker.on("exit", (code: number) => {
        if (!this.closed)
          this.handleWorkerError(slot, new Error(`Fusion worker exited with code ${code}`))
      })
      this.slots.push(slot)
    }
    this.ready = Promise.all(this.slots.map((slot) => slot.ready)).then(() => undefined)
    for (const slot of this.slots) slot.worker.postMessage({ type: "init", snapshot })
  }

  /** Start a native pool after every worker has accepted its immutable snapshot. */
  static async create(
    snapshot: EvaluationSnapshot,
    workerCount: number,
    batchSize: number,
    workerUrl: URL,
  ): Promise<NativeCandidateEvaluationPool> {
    let pool: NativeCandidateEvaluationPool | undefined
    try {
      pool = new NativeCandidateEvaluationPool(snapshot, workerCount, batchSize, workerUrl)
      await pool.ready
      return pool
    } catch (cause) {
      if (pool !== undefined) await pool.close()
      throw errorFromUnknown(cause)
    }
  }

  private handleWorkerError(slot: WorkerSlot, cause: Error): void {
    if (this.closed) return
    slot.rejectReady(cause)
    const active = this.active
    if (active !== undefined) {
      this.active = undefined
      active.reject(cause)
    }
    void this.close()
  }

  private handleMessage(slot: WorkerSlot, message: unknown): void {
    if (!isWorkerMessage(message)) {
      this.handleWorkerError(slot, new Error("Fusion worker sent an invalid message"))
      return
    }
    if (message.type === "ready") {
      slot.resolveReady()
      return
    }
    if (message.type === "error") {
      this.handleWorkerError(slot, new Error(message.message))
      return
    }
    const active = this.active
    const task = active?.tasks.get(message.taskId)
    if (active === undefined || task === undefined) {
      this.handleWorkerError(
        slot,
        new Error(`Fusion worker returned unknown task ${message.taskId}`),
      )
      return
    }
    if (message.results.length !== task.end - task.start) {
      this.handleWorkerError(slot, new Error(`Fusion worker returned an invalid result length`))
      return
    }
    for (let index = 0; index < message.results.length; index++) {
      active.results.set(task.start + index, message.results[index])
    }
    active.tasks.delete(message.taskId)
    slot.busy = false
    slot.task = undefined
    active.completedCandidates += message.results.length
    if (active.completedCandidates === active.candidates.length) {
      const ordered: QualitySummary[] = []
      for (let index = 0; index < active.candidates.length; index++) {
        const result = active.results.get(index)
        if (result === undefined) {
          this.handleWorkerError(slot, new Error(`Fusion worker omitted candidate ${index}`))
          return
        }
        ordered.push(result)
      }
      this.active = undefined
      active.resolve(ordered)
      return
    }
    this.dispatch()
  }

  private dispatch(): void {
    const active = this.active
    if (active === undefined || this.closed) return
    for (const slot of this.slots) {
      if (slot.busy || active.nextCandidate >= active.candidates.length) continue
      const start = active.nextCandidate
      const end = Math.min(start + this.batchSize, active.candidates.length)
      const task: WorkerTask = { taskId: this.nextTaskId++, start, end }
      active.nextCandidate = end
      active.tasks.set(task.taskId, task)
      slot.busy = true
      slot.task = task
      this.batchCount++
      try {
        slot.worker.postMessage({
          type: "evaluate",
          taskId: task.taskId,
          candidates: active.candidates.slice(start, end),
        })
      } catch (cause) {
        this.handleWorkerError(slot, errorFromUnknown(cause))
        return
      }
    }
  }

  async evaluate(candidates: readonly EvaluationCandidate[]): Promise<readonly QualitySummary[]> {
    if (this.closed) throw new Error("Candidate evaluation pool is closed")
    if (this.active !== undefined) throw new Error("Candidate evaluation pool is already busy")
    await this.ready
    if (candidates.length === 0) return []
    this.candidateCount += candidates.length
    return new Promise<readonly QualitySummary[]>((resolve, reject) => {
      this.active = {
        candidates,
        results: new Map(),
        tasks: new Map(),
        resolve,
        reject,
        nextCandidate: 0,
        completedCandidates: 0,
      }
      this.dispatch()
    })
  }

  async close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise
    this.closed = true
    const active = this.active
    this.active = undefined
    active?.reject(new Error("Candidate evaluation pool closed"))
    for (const slot of this.slots) {
      slot.busy = false
      slot.task = undefined
    }
    this.closePromise = Promise.all(
      this.slots.map((slot) => slot.worker.terminate().catch(() => -1)),
    ).then(() => undefined)
    return this.closePromise
  }

  stats = (): CandidateEvaluationPoolStats => ({
    mode: this.mode,
    workerCount: this.workerCount,
    activeWorkerCount: this.closed ? 0 : this.slots.filter((slot) => slot.busy).length,
    batchSize: this.batchSize,
    batches: this.batchCount,
    candidates: this.candidateCount,
  })
}

class SerialCandidateEvaluationPool implements CandidateEvaluationPool {
  readonly mode = "serial" as const
  readonly workerCount = 1
  readonly batchSize: number
  private closed = false
  private readonly snapshot: EvaluationSnapshot
  private batchCount = 0
  private candidateCount = 0

  constructor(snapshot: EvaluationSnapshot, batchSize: number) {
    this.snapshot = snapshot
    this.batchSize = batchSize
  }

  async evaluate(candidates: readonly EvaluationCandidate[]): Promise<readonly QualitySummary[]> {
    if (this.closed) throw new Error("Candidate evaluation pool is closed")
    this.candidateCount += candidates.length
    this.batchCount += Math.ceil(candidates.length / this.batchSize)
    return evaluateCandidatesSerial(this.snapshot, candidates)
  }

  async close(): Promise<void> {
    this.closed = true
  }

  stats = (): CandidateEvaluationPoolStats => ({
    mode: this.mode,
    workerCount: this.workerCount,
    activeWorkerCount: 0,
    batchSize: this.batchSize,
    batches: this.batchCount,
    candidates: this.candidateCount,
  })
}

/** Create a fixed benchmark evaluator pool; one worker or an explicit zero uses serial fallback. */
export const createCandidateEvaluationPool = async (
  snapshot: EvaluationSnapshot,
  options: CandidateEvaluationPoolOptions = {},
): Promise<CandidateEvaluationPool> => {
  const requestedWorkerCount = resolveWorkerCount(options.workerCount)
  const batchSize = resolveBatchSize(options.batchSize)
  if (requestedWorkerCount <= 1 || snapshot.samples.length === 0)
    return new SerialCandidateEvaluationPool(snapshot, batchSize)

  try {
    return await NativeCandidateEvaluationPool.create(
      snapshot,
      requestedWorkerCount,
      batchSize,
      options.workerUrl ?? DEFAULT_WORKER_URL,
    )
  } catch (cause) {
    if (options.fallbackToSerial !== false)
      return new SerialCandidateEvaluationPool(snapshot, batchSize)
    throw errorFromUnknown(cause)
  }
}
