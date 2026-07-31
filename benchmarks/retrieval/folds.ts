import type { CorpusManifest } from "./types.js"

const GROUPED_FOLD_SEED = "pix-retrieval-grouped-folds-v1"
const FNV_OFFSET_BASIS = 2_166_136_261
const FNV_PRIME = 16_777_619

type FoldManifest = Pick<CorpusManifest, "id" | "questions">
type FoldQuestion = FoldManifest["questions"][number]

interface FoldGroup {
  readonly key: string
  readonly category: FoldQuestion["category"]
  readonly difficulty: FoldQuestion["difficulty"]
  readonly order: number
}

interface FoldCounts {
  readonly category: Map<string, number>[]
  readonly difficulty: Map<FoldQuestion["difficulty"], number>[]
  readonly total: number[]
}

const foldKey = (repositoryId: string, questionId: string): string =>
  `${repositoryId}\0${questionId}`

const stableHash = (value: string): number => {
  let hash = FNV_OFFSET_BASIS
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

const compareScores = (left: readonly number[], right: readonly number[]): number => {
  for (let index = 0; index < left.length; index++) {
    if (left[index] < right[index]) return -1
    if (left[index] > right[index]) return 1
  }
  return 0
}

const createGroups = (manifest: FoldManifest): readonly FoldGroup[] =>
  manifest.questions
    .map((question) => {
      const key = foldKey(manifest.id, question.id)
      return {
        key,
        category: question.category,
        difficulty: question.difficulty,
        order: stableHash(`${GROUPED_FOLD_SEED}\0${key}`),
      }
    })
    .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key))

const createFoldCounts = (foldCount: number): FoldCounts => ({
  category: Array.from({ length: foldCount }, () => new Map()),
  difficulty: Array.from({ length: foldCount }, () => new Map()),
  total: Array.from({ length: foldCount }, () => 0),
})

const foldScore = (group: FoldGroup, fold: number, counts: FoldCounts): readonly number[] => [
  counts.category[fold].get(group.category) ?? 0,
  counts.difficulty[fold].get(group.difficulty) ?? 0,
  counts.total[fold],
  fold,
]

const selectFold = (group: FoldGroup, counts: FoldCounts): number => {
  let selectedFold = 0
  for (let fold = 1; fold < counts.total.length; fold++) {
    if (compareScores(foldScore(group, fold, counts), foldScore(group, selectedFold, counts)) < 0)
      selectedFold = fold
  }
  return selectedFold
}

const increment = (counts: Map<string, number>, key: string): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

const recordAssignment = (group: FoldGroup, fold: number, counts: FoldCounts): void => {
  increment(counts.category[fold], group.category)
  increment(counts.difficulty[fold], group.difficulty)
  counts.total[fold]++
}

/** Assign related query forms to deterministic, shuffled, stratified intent folds. */
export const assignGroupedFolds = (
  manifests: readonly FoldManifest[],
  foldCount: number,
): ReadonlyMap<string, number> => {
  if (!Number.isInteger(foldCount) || foldCount < 1)
    throw new Error(`Grouped fold count must be a positive integer, got ${foldCount}`)

  const assignments = new Map<string, number>()
  for (const manifest of manifests) {
    const counts = createFoldCounts(foldCount)
    for (const group of createGroups(manifest)) {
      const selectedFold = selectFold(group, counts)
      assignments.set(group.key, selectedFold)
      recordAssignment(group, selectedFold, counts)
    }
  }
  return assignments
}
