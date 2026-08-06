import { describe, expect, it } from "@effect/vitest"

import { PRODUCTION_COMPATIBILITY_CONFIG } from "../../src/domain/retrieval.js"
import {
  buildGuardrailBlockers,
  derivePromotionEvidence,
} from "../retrieval/evaluation/promotion-evidence.js"
import type { PromotionHoldoutRow } from "../retrieval/evaluation/promotion-evidence.js"
import type { HoldoutQuality, QualitySummary } from "../retrieval/evaluation/types.js"

const quality = (recallAt20: number): QualitySummary => ({
  recallAt5: recallAt20,
  recallAt10: recallAt20,
  recallAt20,
  recallAt50: recallAt20,
  contextRecallAt4096: recallAt20,
  meanReciprocalRank: recallAt20,
})

const holdout = (candidate: number, baseline: number): HoldoutQuality => ({
  dimension: "repository",
  name: "fixture",
  queries: 10,
  candidate: quality(candidate),
  baseline: quality(baseline),
  guardrailsMet: candidate >= baseline - 0.01,
  blockers: buildGuardrailBlockers(
    "repository",
    "fixture",
    quality(candidate),
    quality(baseline),
    ["recallAt20"],
    0.01,
  ),
})

describe("promotion evidence", () => {
  it("reports exact blockers for every failed guardrail", () => {
    expect(
      buildGuardrailBlockers(
        "query-form",
        "identifier",
        quality(0.7),
        quality(0.8),
        ["recallAt20", "contextRecallAt4096"],
        0.01,
      ),
    ).toEqual([
      {
        partition: "query-form",
        name: "identifier",
        metric: "recallAt20",
        candidateValue: 0.7,
        baselineValue: 0.8,
        tolerance: 0.01,
        delta: -0.1,
      },
      {
        partition: "query-form",
        name: "identifier",
        metric: "contextRecallAt4096",
        candidateValue: 0.7,
        baselineValue: 0.8,
        tolerance: 0.01,
        delta: -0.1,
      },
    ])
  })

  it("requires every configured excluded strategy and preserves no-eligible-candidate", () => {
    const rows: readonly PromotionHoldoutRow[] = [
      {
        model: "fixture",
        fusion: "dbsf",
        objective: "direct",
        strategy: "grouped-5-fold",
        fold: "1",
        validation: quality(0.8),
        productionValidation: quality(0.8),
        holdoutBreakdown: [holdout(0.8, 0.8)],
        config: PRODUCTION_COMPATIBILITY_CONFIG,
      },
    ]

    const evidence = derivePromotionEvidence(rows, ["grouped-5-fold", "leave-one-repository-out"], {
      strategy: "grouped-5-fold",
      fold: "1",
    })

    expect(evidence).toHaveLength(1)
    expect(evidence[0]?.promotionStatus).toBe("no-eligible-candidate")
    expect(evidence[0]?.missingStrategies).toEqual(["leave-one-repository-out"])
  })

  it("promotes only blocker-free outer evidence and reports deterministic uncertainty", () => {
    const base: Omit<PromotionHoldoutRow, "strategy" | "fold"> = {
      model: "fixture",
      fusion: "dbsf",
      objective: "direct",
      validation: quality(0.81),
      productionValidation: quality(0.8),
      holdoutBreakdown: [holdout(0.81, 0.8)],
      config: PRODUCTION_COMPATIBILITY_CONFIG,
    }
    const rows: readonly PromotionHoldoutRow[] = [
      { ...base, strategy: "grouped-5-fold", fold: "1" },
      { ...base, strategy: "leave-one-repository-out", fold: "fixture" },
    ]

    const evidence = derivePromotionEvidence(rows, ["grouped-5-fold", "leave-one-repository-out"], {
      strategy: "grouped-5-fold",
      fold: "1",
    })[0]

    expect(evidence?.promotionStatus).toBe("eligible")
    expect(evidence?.blockers).toEqual([])
    expect(evidence?.finalTest).toEqual({
      strategy: "grouped-5-fold",
      fold: "1",
      present: true,
      guardrailsMet: true,
    })
    expect(evidence?.uncertainty.every((interval) => interval.bootstrapSamples === 1_000)).toBe(
      true,
    )
    expect(evidence?.stability).toMatchObject({
      folds: 2,
      distinctSelections: 1,
      selectionFrequency: 1,
      seeds: 1,
      restarts: 1,
    })
  })
})
