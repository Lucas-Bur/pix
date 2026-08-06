/** Binary NDCG at K for ranked chunk IDs and resolved exact-target chunk IDs. */
export declare const binaryNdcgAt: (
  ranked: readonly number[],
  targets: readonly (readonly number[])[],
  k: number,
) => number
