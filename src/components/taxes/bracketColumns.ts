// A bracket group's parts, in pixels at the comfortable density, calibrated on the production copy in
// Edge (2026-09-25): a bracket row is 61.5px (its two boxes and the echo line under the threshold), a
// table's heading, column heads and button row 88.5px. In a per-worker strip the helper sentence is
// ~31px, an earner's "Add a table" offer ~32px and their own table ~89px plus its rows, with 0.7rem
// between the strip's items and the group's ~9px margin above the strip. Compact density scales them
// all alike, so the split they choose holds there too.
const ROW = 62
const TABLE = 88
const STRIP_MARGIN = 9
const STRIP_GAP = 11
const HELPER = 31
const OFFER = 32
const PERSON_TABLE = 89

/**
 * A bracket group's height, estimated from what it holds (2026-09-25 polish spec §3.5): the table's
 * fixed parts, then each bracket row — an empty table is charged like a one-row one. Under a
 * per-worker table the strip adds its margin, its helper sentence where it has it, then per earner
 * either their own table (`own` rows) or the offer to add one. An estimate, not a measurement: it only
 * has to choose the split the measured heights would.
 */
export function groupWeight(rows: number, strip?: { helper: boolean; people: readonly number[] }): number {
  const table = TABLE + ROW * Math.max(rows, 1)
  if (strip === undefined) return table
  const items = [
    ...(strip.helper ? [HELPER] : []),
    ...strip.people.map((own) => (own > 0 ? PERSON_TABLE + ROW * own : OFFER)),
  ]
  return table + STRIP_MARGIN + items.reduce((sum, item) => sum + item, 0) + STRIP_GAP * Math.max(items.length - 1, 0)
}

/**
 * Where the second column starts (spec §3.5, TPC-12d): the contiguous split of `weights` whose two
 * columns come closest in height — each column charged `gap` between its groups — a tie keeping the
 * longer column first. Contiguous on purpose — the first column reads down, then the second — so the
 * tables stay in JURISDICTIONS order for the eye, the keyboard and a screen reader, in two columns or
 * one. Fewer than two groups stay together.
 */
export function balancedSplit(weights: readonly number[], gap = 0): number {
  if (weights.length < 2) return weights.length
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let best = 1
  let bestDiff = Number.POSITIVE_INFINITY
  let first = 0
  for (let at = 1; at < weights.length; at += 1) {
    first += weights[at - 1]
    const firstColumn = first + gap * (at - 1)
    const secondColumn = total - first + gap * (weights.length - at - 1)
    const diff = Math.abs(firstColumn - secondColumn)
    if (diff <= bestDiff) {
      best = at
      bestDiff = diff
    }
  }
  return best
}
