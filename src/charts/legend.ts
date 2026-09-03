// The one legend rule (chart spec §9). Every multi-series card: top: 0, scroll past eight
// entries (so the grid.top: 40 collision is structurally gone — a scroll legend never
// wraps), the page's mirrored picks fed back through `selected`, a muted pager. Builders
// that list `data` explicitly (the projection) spread this and add `data`.
// Depends on: charts/theme.ts (MUTED).
import { MUTED } from './theme'

/** Spread onto every multi-series line/bar series: hovering one dims the rest. */
export const FOCUS = { emphasis: { focus: 'series' as const } }

export function legendFor(count: number, selected?: Record<string, boolean>) {
  return {
    top: 0,
    type: count > 8 ? ('scroll' as const) : ('plain' as const),
    ...(selected === undefined ? {} : { selected }),
    pageIconColor: MUTED,
    pageTextStyle: { color: MUTED },
  }
}
