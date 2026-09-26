import type { OverviewCard } from '../../prefs/overviewLayout'

/** The deeper views drawn half-width (2026-09-25 polish spec §3.2): the two chart cards that read as
 *  a pair. Every other deeper view runs the full row. */
export const HALF_WIDTH_CARDS: ReadonlySet<OverviewCard> = new Set<OverviewCard>(['performance', 'spending'])

/**
 * Each deeper view's span, from the order the reader chose in Customize (spec §3.2, OU-16): two
 * adjacent half-width views pair, 6 + 6, and a half-width view whose neighbour is not half-width runs
 * the full row — so hiding or reordering never strands a chart beside a ~567px hole. `shown` is the
 * render order with the views that draw nothing already left out: an empty Year to date between the
 * two charts must not keep them apart. Pairs are taken left to right.
 */
export function deeperSpans(shown: readonly OverviewCard[]): Map<OverviewCard, 6 | 12> {
  const spans = new Map<OverviewCard, 6 | 12>()
  for (let index = 0; index < shown.length; index += 1) {
    const id = shown[index]
    const next = shown[index + 1]
    if (HALF_WIDTH_CARDS.has(id) && next !== undefined && HALF_WIDTH_CARDS.has(next)) {
      spans.set(id, 6)
      spans.set(next, 6)
      index += 1
    } else {
      spans.set(id, 12)
    }
  }
  return spans
}
