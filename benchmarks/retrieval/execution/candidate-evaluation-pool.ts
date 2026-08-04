import { availableParallelism } from "node:os"
import { Worker } from "node:worker_threads"

import type { Chunk } from "../../../src/domain/chunk.js"
import type { ChannelWeights } from "../../../src/domain/retrieval.js"
import { evaluateCandidate } from "../evaluation/prepared-fusion-core.mjs"
import {
  type PreparedFusionEvaluator,
  type PreparedFusionSnapshot,
} from "../evaluation/prepared-fusion.js"
import type { QualitySummary } from "../evaluation/types.js"

const DEFAULT_BATCH_SIZE = 32
const DEFAULT_QUEUE_BATCH_SIZE = 1
const DEFAULT_WORKER_URL = new URL("./candidate-evaluation-worker.mjs", import.meta.url)

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

/** Configuration for one shared candidate-evaluation queue. */
export interface CandidateEvaluationQueueOptions {
  /** Maximum number of native evaluation workers. */
  readonly workerCount?: number
  /** Maximum number of candidate vectors sent in one worker message. */
  readonly batchSize?: number
  /** Test-only or diagnostic override for the queue worker entry point. */
  readonly workerUrl?: URL
}

/** Shared native executor used by multiple independent router searches. */
export interface CandidateEvaluationQueue {
  /** Number of native workers owned by the queue. */
  readonly workerCount: number
  /** Maximum number of candidate vectors sent in one worker message. */
  readonly batchSize: number
  /** Number of workers currently evaluating a candidate batch. */
  readonly activeWorkerCount: () => number
  /** Enqueue candidates for one prepared snapshot and preserve candidate order in the result. */
  readonly evaluate: (
    snapshot: EvaluationSnapshot,
    candidates: readonly EvaluationCandidate[],
    signal?: AbortSignal,
    snapshotId?: string,
  ) => Promise<readonly QualitySummary[]>
  /** Stop all workers and reject queued evaluations. */
  readonly close: () => Promise<void>
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

interface ReadyWorker {
  readonly worker: Worker
  readonly ready: Promise<void>
  readonly resolveReady: () => void
  readonly rejectReady: (error: Error) => void
}

const errorFromUnknown = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause))

const createReadyWorker = (workerUrl: URL): ReadyWorker => {
  let resolveReady: () => void = () => undefined
  let rejectReady: (error: Error) => void = () => undefined
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  return { worker: new Worker(workerUrl), ready, resolveReady, rejectReady }
}

const attachWorkerLifecycle = (
  worker: Worker,
  onMessage: (message: unknown) => void,
  onError: (cause: Error) => void,
  onExit: (code: number) => void,
): void => {
  worker.on("message", onMessage)
  worker.on("error", onError)
  worker.on("exit", onExit)
}

const attachFusionWorkerLifecycle = (
  slot: ReadyWorker,
  onMessage: (message: unknown) => void,
  onError: (cause: Error) => void,
  isClosed: () => boolean,
): void =>
  attachWorkerLifecycle(slot.worker, onMessage, onError, (code) => {
    if (!isClosed()) onError(new Error(`Candidate evaluation worker exited with code ${code}`))
  })

const createWorkerSlots = <T extends ReadyWorker>(
  workerCount: number,
  workerUrl: URL,
  createSlot: (readyWorker: ReadyWorker) => T,
  attach: (slot: T) => void,
): T[] => {
  const slots: T[] = []
  for (let index = 0; index < workerCount; index++) {
    const slot = createSlot(createReadyWorker(workerUrl))
    attach(slot)
    slots.push(slot)
  }
  return slots
}

const handleWorkerControlMessage = (
  slot: ReadyWorker,
  message: { readonly type: string; readonly message?: string },
  onError: (cause: Error) => void,
): boolean => {
  if (message.type === "ready") {
    slot.resolveReady()
    return true
  }
  if (message.type === "error") {
    onError(new Error(message.message ?? "Worker reported an error"))
    return true
  }
  return false
}

const failWorker = (
  slot: ReadyWorker,
  cause: Error,
  rejectActive: () => void,
  close: () => Promise<void>,
): void => {
  slot.rejectReady(cause)
  rejectActive()
  void close()
}

const candidatePoolStats = (
  mode: EvaluationPoolMode,
  workerCount: number,
  activeWorkerCount: number,
  batchSize: number,
  batches: number,
  candidates: number,
): CandidateEvaluationPoolStats => ({
  mode,
  workerCount,
  activeWorkerCount,
  batchSize,
  batches,
  candidates,
})

const candidateBatchStats = (
  candidates: readonly EvaluationCandidate[],
  batchSize: number,
): { readonly batches: number; readonly candidates: number } => ({
  batches: Math.ceil(candidates.length / batchSize),
  candidates: candidates.length,
})

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

const resolveQueueBatchSize = (requested?: number): number => {
  const configured = requested ?? parseInteger(process.env.PIX_BENCH_WORKER_BATCH_SIZE)
  return Math.max(1, configured ?? DEFAULT_QUEUE_BATCH_SIZE)
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

interface QueueWorkerSlot extends ReadyWorker {
  readonly knownSnapshots: Set<string>
  busy: boolean
}

interface CandidateQueueRequest {
  readonly snapshotId: string
  readonly snapshot: EvaluationSnapshot
  readonly candidates: readonly EvaluationCandidate[]
  readonly results: Map<number, QualitySummary>
  readonly resolve: (results: readonly QualitySummary[]) => void
  readonly reject: (error: Error) => void
  readonly removeAbortListener: () => void
  nextCandidate: number
  completedCandidates: number
  enqueued: boolean
  settled: boolean
}

interface CandidateQueueTask {
  readonly taskId: number
  readonly request: CandidateQueueRequest
  readonly slot: QueueWorkerSlot
  readonly start: number
  readonly end: number
}

const isQueueRecord = (message: unknown): message is Record<string, unknown> =>
  typeof message === "object" && message !== null

const isQueueWorkerMessage = (message: unknown): message is WorkerMessage => {
  if (!isQueueRecord(message) || typeof message.type !== "string") return false
  if (message.type === "ready") return true
  if (message.type === "error") return typeof message.message === "string"
  return (
    message.type === "result" &&
    Number.isInteger(message.taskId) &&
    Array.isArray(message.results) &&
    message.results.length > 0
  )
}

class NativeCandidateEvaluationQueue implements CandidateEvaluationQueue {
  readonly workerCount: number
  readonly batchSize: number

  private readonly slots: QueueWorkerSlot[]
  private readonly ready: Promise<void>
  private readonly requests = new Set<CandidateQueueRequest>()
  private readonly readyRequests: CandidateQueueRequest[] = []
  private readonly activeTasks = new Map<number, CandidateQueueTask>()
  private readonly snapshotIds = new WeakMap<EvaluationSnapshot, string>()
  private closePromise: Promise<void> | undefined
  private closed = false
  private nextSnapshotId = 0
  private nextTaskId = 0

  private constructor(workerCount: number, batchSize: number, workerUrl: URL) {
    this.workerCount = workerCount
    this.batchSize = batchSize
    this.slots = createWorkerSlots(
      workerCount,
      workerUrl,
      (readyWorker): QueueWorkerSlot => ({
        ...readyWorker,
        knownSnapshots: new Set(),
        busy: false,
      }),
      (slot) =>
        attachFusionWorkerLifecycle(
          slot,
          (message) => this.handleMessage(slot, message),
          (cause) => this.handleWorkerError(slot, cause),
          () => this.closed,
        ),
    )
    this.ready = Promise.all(this.slots.map((slot) => slot.ready)).then(() => undefined)
  }

  /** Start a queue after every native worker has completed protocol startup. */
  static async create(
    workerCount: number,
    batchSize: number,
    workerUrl: URL,
  ): Promise<NativeCandidateEvaluationQueue> {
    let queue: NativeCandidateEvaluationQueue | undefined
    try {
      queue = new NativeCandidateEvaluationQueue(workerCount, batchSize, workerUrl)
      await queue.ready
      return queue
    } catch (cause) {
      if (queue !== undefined) await queue.close()
      throw errorFromUnknown(cause)
    }
  }

  private handleWorkerError(slot: QueueWorkerSlot, cause: Error): void {
    if (this.closed) return
    failWorker(
      slot,
      cause,
      () => {
        for (const request of this.requests) this.settleRequest(request, cause)
      },
      () => this.close(),
    )
  }

  private snapshotIdFor(snapshot: EvaluationSnapshot, requestedId?: string): string {
    if (requestedId !== undefined) return requestedId
    const existing = this.snapshotIds.get(snapshot)
    if (existing !== undefined) return existing
    const snapshotId = String(this.nextSnapshotId++)
    this.snapshotIds.set(snapshot, snapshotId)
    return snapshotId
  }

  private enqueueRequest(request: CandidateQueueRequest): void {
    if (request.settled || request.enqueued || request.nextCandidate >= request.candidates.length)
      return
    request.enqueued = true
    this.readyRequests.push(request)
  }

  private nextRequest(): CandidateQueueRequest | undefined {
    while (this.readyRequests.length > 0) {
      const request = this.readyRequests.shift()
      if (request === undefined) return undefined
      request.enqueued = false
      if (request.settled || request.nextCandidate >= request.candidates.length) continue
      return request
    }
    return undefined
  }

  private settleRequest(request: CandidateQueueRequest, cause?: Error): void {
    if (request.settled) return
    request.settled = true
    this.requests.delete(request)
    request.removeAbortListener()
    if (cause !== undefined) {
      request.reject(cause)
      return
    }
    const ordered: QualitySummary[] = []
    for (let index = 0; index < request.candidates.length; index++) {
      const result = request.results.get(index)
      if (result === undefined) {
        request.reject(new Error(`Candidate evaluation queue omitted candidate ${index}`))
        return
      }
      ordered.push(result)
    }
    request.resolve(ordered)
  }

  private dispatch(): void {
    if (this.closed) return
    for (const slot of this.slots) {
      if (slot.busy) continue
      const request = this.nextRequest()
      if (request === undefined) return
      const start = request.nextCandidate
      const end = Math.min(start + this.batchSize, request.candidates.length)
      const task: CandidateQueueTask = {
        taskId: this.nextTaskId++,
        request,
        slot,
        start,
        end,
      }
      request.nextCandidate = end
      this.activeTasks.set(task.taskId, task)
      slot.busy = true
      const includeSnapshot = !slot.knownSnapshots.has(request.snapshotId)
      try {
        slot.worker.postMessage({
          type: "evaluate",
          taskId: task.taskId,
          snapshotId: request.snapshotId,
          snapshot: includeSnapshot ? request.snapshot : undefined,
          candidates: request.candidates.slice(start, end),
        })
        if (includeSnapshot) slot.knownSnapshots.add(request.snapshotId)
      } catch (cause) {
        this.activeTasks.delete(task.taskId)
        slot.busy = false
        this.handleWorkerError(slot, errorFromUnknown(cause))
        return
      }
      this.enqueueRequest(request)
    }
  }

  private handleMessage(slot: QueueWorkerSlot, message: unknown): void {
    if (this.closed) return
    if (!isQueueWorkerMessage(message)) {
      this.handleWorkerError(slot, new Error("Candidate evaluation worker sent an invalid message"))
      return
    }
    if (handleWorkerControlMessage(slot, message, (cause) => this.handleWorkerError(slot, cause)))
      return
    if (message.type !== "result") return
    const task = this.activeTasks.get(message.taskId)
    if (task === undefined || task.slot !== slot) {
      this.handleWorkerError(
        slot,
        new Error(`Candidate evaluation queue returned unknown task ${message.taskId}`),
      )
      return
    }
    this.activeTasks.delete(message.taskId)
    slot.busy = false
    if (message.results.length !== task.end - task.start) {
      this.handleWorkerError(
        slot,
        new Error("Candidate evaluation queue returned an invalid result length"),
      )
      return
    }
    if (!task.request.settled) {
      for (let index = 0; index < message.results.length; index++)
        task.request.results.set(task.start + index, message.results[index])
      task.request.completedCandidates += message.results.length
      if (task.request.completedCandidates === task.request.candidates.length)
        this.settleRequest(task.request)
      else this.enqueueRequest(task.request)
    }
    this.dispatch()
  }

  activeWorkerCount = (): number =>
    this.closed ? 0 : this.slots.filter((slot) => slot.busy).length

  async evaluate(
    snapshot: EvaluationSnapshot,
    candidates: readonly EvaluationCandidate[],
    signal?: AbortSignal,
    snapshotId?: string,
  ): Promise<readonly QualitySummary[]> {
    if (this.closed) throw new Error("Candidate evaluation queue is closed")
    if (signal?.aborted) throw new Error("Candidate evaluation queue was interrupted")
    if (candidates.length === 0) return []
    await this.ready
    if (this.closed) throw new Error("Candidate evaluation queue is closed")
    const resolvedSnapshotId = this.snapshotIdFor(snapshot, snapshotId)
    return new Promise<readonly QualitySummary[]>((resolve, reject) => {
      let request: CandidateQueueRequest | undefined
      const abort = () => {
        if (request === undefined) return
        this.settleRequest(request, new Error("Candidate evaluation queue was interrupted"))
        this.dispatch()
      }
      const removeAbortListener = () => signal?.removeEventListener("abort", abort)
      request = {
        snapshotId: resolvedSnapshotId,
        snapshot,
        candidates,
        results: new Map(),
        resolve,
        reject,
        removeAbortListener,
        nextCandidate: 0,
        completedCandidates: 0,
        enqueued: false,
        settled: false,
      }
      if (signal !== undefined) {
        signal.addEventListener("abort", abort, { once: true })
        if (signal.aborted) {
          abort()
          return
        }
      }
      this.requests.add(request)
      this.enqueueRequest(request)
      this.dispatch()
    })
  }

  async close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise
    this.closed = true
    for (const request of this.requests)
      this.settleRequest(request, new Error("Candidate evaluation queue closed"))
    this.readyRequests.length = 0
    for (const slot of this.slots) slot.busy = false
    this.closePromise = Promise.all(
      this.slots.map((slot) => slot.worker.terminate().catch(() => -1)),
    ).then(() => undefined)
    return this.closePromise
  }
}

class SerialCandidateEvaluationQueue implements CandidateEvaluationQueue {
  readonly workerCount = 1
  readonly batchSize: number
  private closed = false

  constructor(batchSize: number) {
    this.batchSize = batchSize
  }

  activeWorkerCount = (): number => 0

  async evaluate(
    snapshot: EvaluationSnapshot,
    candidates: readonly EvaluationCandidate[],
    signal?: AbortSignal,
    _snapshotId?: string,
  ): Promise<readonly QualitySummary[]> {
    if (this.closed) throw new Error("Candidate evaluation queue is closed")
    if (signal?.aborted) throw new Error("Candidate evaluation queue was interrupted")
    return evaluateCandidatesSerial(snapshot, candidates)
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

class QueuedCandidateEvaluationPool implements CandidateEvaluationPool {
  readonly mode: EvaluationPoolMode
  readonly workerCount: number
  readonly batchSize: number
  private readonly snapshot: EvaluationSnapshot
  private readonly queue: CandidateEvaluationQueue
  private readonly signal: AbortSignal | undefined
  private readonly ownsQueue: boolean
  private closed = false
  private batchCount = 0
  private candidateCount = 0

  constructor(
    snapshot: EvaluationSnapshot,
    queue: CandidateEvaluationQueue,
    signal?: AbortSignal,
    ownsQueue = false,
  ) {
    this.snapshot = snapshot
    this.queue = queue
    this.signal = signal
    this.ownsQueue = ownsQueue
    this.mode = queue.workerCount > 1 ? "parallel" : "serial"
    this.workerCount = queue.workerCount
    this.batchSize = queue.batchSize
  }

  async evaluate(candidates: readonly EvaluationCandidate[]): Promise<readonly QualitySummary[]> {
    if (this.closed) throw new Error("Candidate evaluation pool is closed")
    const counts = candidateBatchStats(candidates, this.batchSize)
    this.candidateCount += counts.candidates
    this.batchCount += counts.batches
    return this.queue.evaluate(this.snapshot, candidates, this.signal)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.ownsQueue) await this.queue.close()
  }

  stats = (): CandidateEvaluationPoolStats =>
    candidatePoolStats(
      this.mode,
      this.workerCount,
      this.closed ? 0 : this.queue.activeWorkerCount(),
      this.batchSize,
      this.batchCount,
      this.candidateCount,
    )
}

/** Create one shared candidate queue for multiple independent router searches. */
export const createCandidateEvaluationQueue = async (
  options: CandidateEvaluationQueueOptions = {},
): Promise<CandidateEvaluationQueue> => {
  const workerCount = resolveWorkerCount(options.workerCount)
  const batchSize = resolveQueueBatchSize(options.batchSize)
  if (workerCount <= 1) return new SerialCandidateEvaluationQueue(batchSize)
  return NativeCandidateEvaluationQueue.create(
    workerCount,
    batchSize,
    options.workerUrl ?? DEFAULT_WORKER_URL,
  )
}

/** Create a per-search pool facade that submits work to a shared candidate queue. */
export const createCandidateEvaluationPoolOnQueue = (
  snapshot: EvaluationSnapshot,
  queue: CandidateEvaluationQueue,
  signal?: AbortSignal,
): CandidateEvaluationPool => new QueuedCandidateEvaluationPool(snapshot, queue, signal)

const createOwnedSerialPool = (
  snapshot: EvaluationSnapshot,
  batchSize: number,
): CandidateEvaluationPool =>
  new QueuedCandidateEvaluationPool(
    snapshot,
    new SerialCandidateEvaluationQueue(batchSize),
    undefined,
    true,
  )

/** Create a fixed benchmark evaluator pool; one worker or an explicit zero uses serial fallback. */
export const createCandidateEvaluationPool = async (
  snapshot: EvaluationSnapshot,
  options: CandidateEvaluationPoolOptions = {},
): Promise<CandidateEvaluationPool> => {
  const requestedWorkerCount = resolveWorkerCount(options.workerCount)
  const batchSize = resolveBatchSize(options.batchSize)
  if (requestedWorkerCount <= 1 || snapshot.samples.length === 0)
    return createOwnedSerialPool(snapshot, batchSize)

  try {
    const queue = await createCandidateEvaluationQueue({
      workerCount: requestedWorkerCount,
      batchSize,
      workerUrl: options.workerUrl ?? DEFAULT_WORKER_URL,
    })
    return new QueuedCandidateEvaluationPool(snapshot, queue, undefined, true)
  } catch (cause) {
    if (options.fallbackToSerial !== false) return createOwnedSerialPool(snapshot, batchSize)
    throw errorFromUnknown(cause)
  }
}
