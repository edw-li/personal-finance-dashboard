// Whole-cent splits for the flow charts (charts/sankey.ts's builders): a pro-rata fan that is
// exact on both sides, so every node equals the sum of its links (2026-09-23 spec §C1). Moved
// out of grammar.ts, which re-exports both. No dependencies.

/** `total` whole cents split in proportion to `weights`, exactly: every share is floored, then
 *  the cents left over go one each to the largest remainders (ties to the earlier weight), so
 *  the shares always sum to `total`. Nothing to weigh by (all zero) allots nothing. A flow chart
 *  that rounds each slice on its own can leave a node a cent or two away from the sum of its
 *  links. This is what the 2026-09-23 review found in the money flow's pro-rata split. */
export function apportionCents(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0)
  if (!(sum > 0) || total === 0) return weights.map(() => 0)
  const raw = weights.map((weight) => (total * weight) / sum)
  const shares = raw.map(Math.floor)
  let left = total - shares.reduce((acc, share) => acc + share, 0)
  const byRemainder = raw
    .map((value, index) => ({ index, remainder: value - shares[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (const { index } of byRemainder) {
    if (left <= 0) break
    shares[index] += 1
    left -= 1
  }
  return shares
}

/** Sources fanned into targets pro-rata, in whole cents and exact on BOTH margins: row k sums to
 *  `sources[k]` and column j to `targets[j]` whenever the two sides balance. Money is fungible,
 *  so each target is funded by every source in proportion. Each source but the last takes its
 *  apportioned share of what every target still needs; the last source takes the rest. Put the
 *  biggest source last: it absorbs the rounding. `grid[k][j]` is source k's link into target j. */
export function fanCents(sources: readonly number[], targets: readonly number[]): number[][] {
  let needed = [...targets]
  return sources.map((source, k) => {
    if (k === sources.length - 1) return needed
    const share = apportionCents(source, needed)
    needed = needed.map((need, j) => need - share[j])
    return share
  })
}
