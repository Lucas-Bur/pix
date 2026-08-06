/** Binary NDCG at K for ranked chunk IDs and resolved exact-target chunk IDs. */
export const binaryNdcgAt = (ranked, targets, k) => {
  const relevant = new Set(targets.flatMap((target) => target))
  if (relevant.size === 0 || k <= 0) return 0

  const seen = new Set()
  let discountedGain = 0
  for (let rank = 0; rank < Math.min(k, ranked.length); rank++) {
    const chunkIndex = ranked[rank]
    if (seen.has(chunkIndex)) continue
    seen.add(chunkIndex)
    if (relevant.has(chunkIndex)) discountedGain += 1 / Math.log2(rank + 2)
  }

  let idealDiscountedGain = 0
  for (let rank = 0; rank < Math.min(k, relevant.size); rank++)
    idealDiscountedGain += 1 / Math.log2(rank + 2)
  return discountedGain / idealDiscountedGain
}
