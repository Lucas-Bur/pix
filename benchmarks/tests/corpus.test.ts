import { expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"

import type { ChunkingOptions } from "../../src/domain/ports.js"
import { prepareCorpus } from "../retrieval/corpus/prepare.js"
import { loadCorpusManifests, prepareRepository } from "../retrieval/corpus/repository.js"
import { resolveGoldTargets } from "../retrieval/evaluation/metrics.js"
import { CorpusManifestSchema } from "../retrieval/evaluation/types.js"

const validationChunkingOptions: ChunkingOptions = {
  maxTokens: Number.MAX_SAFE_INTEGER,
  overlapLines: 0,
  countTokens: () => Effect.succeed(0),
  onDiagnostic: () => Effect.void,
}

it("rejects benchmark questions without exact ground truth", () => {
  expect(() =>
    Schema.decodeUnknownSync(CorpusManifestSchema)({
      schemaVersion: 2,
      id: "fixture",
      repository: "owner/repository",
      revision: "abc123",
      language: "TypeScript",
      size: "small",
      includeRoots: ["src"],
      excludePaths: [],
      extensions: [".ts"],
      questions: [
        {
          id: "missing-ground-truth",
          queries: {
            identifier: "target",
            searchPhrase: "target",
            naturalQuestion: "Where is target?",
            agentTask: "Find target",
          },
          category: "navigation",
          difficulty: "easy",
          groundTruth: [],
        },
      ],
    }),
  ).toThrow()
})

// This validation intentionally reads real pinned checkouts; memfs is used by other adapter tests.
it.effect("resolves every authored gold symbol in each pinned corpus", () =>
  Effect.gen(function* () {
    const manifests = yield* loadCorpusManifests()
    expect(manifests).toHaveLength(3)
    expect(manifests.every((manifest) => manifest.questions.length === 15)).toBe(true)

    for (const manifest of manifests) {
      const repositoryPath = yield* prepareRepository(manifest)
      const corpus = yield* prepareCorpus(repositoryPath, manifest, validationChunkingOptions)
      const unresolved = manifest.questions.flatMap((question) =>
        resolveGoldTargets(question.groundTruth, corpus.chunks, corpus.identifiersByChunk).flatMap(
          (targets, index) =>
            targets.size === 0
              ? [
                  `${question.id}: ${question.groundTruth[index].file}::${question.groundTruth[index].symbol}`,
                ]
              : [],
        ),
      )
      expect(unresolved, `${manifest.id} unresolved gold targets`).toEqual([])
    }
  }),
)
