/**
 * A bracket group's height in table rows (2026-09-25 polish spec §3.5), estimated from what it holds:
 * the heading, the column heads and the button row (≈ 3 rows), then a row per bracket — an empty
 * table's note is one. Under a per-worker table the strip adds its helper sentence where it has it,
 * then per earner either their own table (its head, column heads and buttons, ≈ 3, plus its rows) or
 * the one-line offer to add one. An estimate, not a measurement: it only has to tell a 10-row state
 * table from a 2-row Medicare one.
 */
export function groupWeight(rows: number, strip?: { helper: boolean; people: readonly number[] }): number {
  const table = 3 + Math.max(rows, 1)
  if (strip === undefined) return table
  return table + (strip.helper ? 1 : 0) + strip.people.reduce((sum, own) => sum + (own > 0 ? 3 + own : 1), 0)
}

/**
 * Where the second column starts (spec §3.5, TPC-12d): the contiguous split of `weights` whose two
 * columns come closest in height, a tie keeping the longer column first. Contiguous on purpose — the
 * first column reads down, then the second — so the tables stay in JURISDICTIONS order for the eye,
 * the keyboard and a screen reader, in two columns or one. Fewer than two groups stay together.
 */
export function balancedSplit(weights: readonly number[]): number {
  if (weights.length < 2) return weights.length
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let best = 1
  let bestGap = Number.POSITIVE_INFINITY
  let first = 0
  for (let at = 1; at < weights.length; at += 1) {
    first += weights[at - 1]
    const gap = Math.abs(total - 2 * first)
    if (gap <= bestGap) {
      best = at
      bestGap = gap
    }
  }
  return best
}
