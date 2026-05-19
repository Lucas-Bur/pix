# PRD: `pix bench` — Benchmark Command

## Overview

`pix bench` measures indexing performance across device and batch size configurations, then recommends the optimal config for the current hardware. Uses the dtype from the current config.

## Problem

Indexing performance depends on `device` and `batchSize`. Default values may be suboptimal for the user's hardware. Finding good values requires manual trial and error.

## Scope

**In scope:**

- Device detection (cuda, dml, coreml, cpu) — test all that work on current machine
- Cold-start vs warm-path throughput measurement
- `device × batchSize` matrix benchmark
- Recommended config output with `--apply` flag
- Human-readable table + JSON output

**Out of scope:**

- Model-vs-model comparison
- Retrieval quality benchmarking
- Agent-vs-agent evaluation
- `chunkLines` or `chunkConcurrency` benchmarking
- dtype benchmarking

## Command

```
pix bench [options]
```

### Flags

| Flag                                   | Default                 | Purpose                                        |
| -------------------------------------- | ----------------------- | ---------------------------------------------- |
| `--warmup N`                           | 5                       | Warmup batches before measuring throughput     |
| `--measure-batches N`                  | 10                      | Number of batches to measure per config        |
| `--batch-sizes "..."`                  | "1,4,8,16,32,64,96,128" | Batch sizes to test                            |
| `--timeout N`                          | 60                      | Seconds before a config is considered failed   |
| `--apply [throughput\|cold\|balanced]` | balanced                | Write recommended config to `.pix/config.json` |
| `--json`                               | false                   | Machine-readable output                        |

## Benchmark Pipeline

### Phase 0: Corpus Preparation

1. Scan project files (reuses existing `Scanner` port)
2. Chunk all files (reuses existing `Chunker` port)
3. Shuffle chunks (Fisher-Yates)
4. If project has fewer chunks than needed, cycle through shuffled list

Corpus is held in memory. No `.pix/` files are written during benchmark. A temp directory (`.pix/.bench-tmp/`) is used for any intermediate storage and cleaned up after.

### Phase 1: Device Detection

Attempt model load on each device in priority order: cuda → dml → coreml → cpu. Record which devices succeed. Skip failed devices for remaining phases.

### Phase 2: Cold-Start Measurement

For each working device:

- Load model from scratch (no warmup)
- Embed 1 batch (size 16)
- Record `cold_latency_ms`

Simulates incremental indexing's first changed file.

### Phase 3: Warm-Path Throughput

For each working device × batchSize:

- Run N warmup batches (discard results)
- Run M measurement batches
- Record `warm_chunks_per_sec` and `warm_latency_per_batch_ms`

Timeout per config: 60s (configurable via `--timeout`). On timeout or failure, mark config as "failed" and continue.

### Phase 4: Recommendation

Score each successful config per profile:

| Profile      | Scoring                                                      |
| ------------ | ------------------------------------------------------------ |
| `throughput` | Maximize `warm_chunks_per_sec`                               |
| `cold`       | Minimize `cold_latency_ms`                                   |
| `balanced`   | `0.7 × cold_score + 0.3 × throughput_score` (normalized 0–1) |

Output the winning preset.

## Output

### Human-readable table

```
┌────────┬───────────┬──────────────┬──────────────┬─────────┐
│ device │ batchSize │ cold (ms)    │ warm (ch/s)  │ status  │
├────────┼───────────┼──────────────┼──────────────┼─────────┤
│ cuda   │    64     │    342       │   12,400     │    ok   │
│ cuda   │   128     │    342       │   12,800     │    ok   │
│ cpu    │     8     │    891       │    2,100     │    ok   │
│ cpu    │   128     │    891       │    —         │ timeout │
└────────┴───────────┴──────────────┴──────────────┴─────────┘

Recommended: cuda/batchSize=64 (balanced)
```

### JSON output

Array of measurement objects + recommendation:

```json
{
  "measurements": [
    {
      "device": "cuda",
      "batchSize": 64,
      "coldLatencyMs": 342,
      "warmChunksPerSec": 12400,
      "warmLatencyPerBatchMs": 81,
      "status": "ok"
    }
  ],
  "recommendation": {
    "profile": "balanced",
    "device": "cuda",
    "batchSize": 64
  }
}
```

## `--apply` Behavior

1. Reads current `.pix/config.json` (or creates with defaults if missing)
2. Patches only `embedder.device` and `embedder.batchSize` with winning values for the selected profile
3. Writes back, preserving all other user settings

## Architecture

Follows existing hexagonal patterns:

- **Domain:** `BenchOptions`, `BenchResult`, `BenchProfile` types in `src/domain/`
- **Application:** `BenchProject` use case in `src/application/bench-project.ts`
- **Command:** `bench-cmd.ts` in `src/commands/`
- **Ports:** Reuses existing `Embedder`, `ConfigStore`, `Display`, `Scanner`, `Chunker` — no new ports needed
- **Services:** Device detection logic in `src/services/device-detect.ts`

## Acceptance Criteria

- [ ] `pix bench` runs and outputs a table with all tested device × batchSize configs
- [ ] Failed/timed-out configs are marked and don't crash the benchmark
- [ ] `--apply balanced`, `--apply throughput`, `--apply cold` each write their respective recommendation
- [ ] `--json` outputs structured measurement data
- [ ] Benchmark uses real project chunks, shuffled
- [ ] Temp directory is cleaned up after benchmark
- [ ] All existing quality gates pass (`vp check`, `vp test`, `vp run lint:fallow`)

## Negative Decisions

| Decision                                | Reason                                                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Don't benchmark dtype                   | dtype is a quality/storage tradeoff, not a performance knob. Users pick dtype for embedding quality; benchmark answers "given your quality level, what device and batchSize are fastest?" |
| Don't benchmark chunkLines              | chunkLines affects retrieval quality, not just speed. Requires ground-truth query evaluation — out of scope.                                                                              |
| Don't benchmark chunkConcurrency        | Phase 1 (scan + chunk) is I/O bound and fast relative to embedding. Not the bottleneck.                                                                                                   |
| Don't benchmark model-vs-model          | Explosive matrix, downloads multiple models, better as separate research tool.                                                                                                            |
| Don't benchmark retrieval quality       | Covered by external benchmarks. Would need ground-truth query set.                                                                                                                        |
| Don't include agent-vs-agent evaluation | Different benchmark class (end-to-end task completion). Should live in a separate tool/repo.                                                                                              |
| Don't use memfs for benchmark storage   | Real temp directory exercises the actual filesystem path and is simpler.                                                                                                                  |
| Don't separate --profile and --apply    | Single `--apply [profile]` flag is cleaner than two flags.                                                                                                                                |
| Don't use a fixed --sample corpus size  | Total work is `measure-batches × batch-size`. If corpus is smaller, cycle through shuffled chunks.                                                                                        |
