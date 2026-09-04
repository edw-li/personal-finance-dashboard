// Every height a skeleton RESERVES, in one place (motion spec §7): a ghost standing in a different
// box than the block that replaces it IS the layout shift. Each number is the loaded layout's own
// arithmetic at a 16px root, from index.css (--density-card-pad) and panels.css — never a guess.
/** Ghost .card chrome: 17.6 + 20 padding + 2 border + 11 label + 9.6 label margin. */
export const CARD_CHROME = 60
/** One .drill-hint line (0.75rem × 1.5); one table row (0.85rem + 0.45rem padding, top and bottom). */
export const HINT_LINE = 18
export const TABLE_ROW = 33
/** The real .stat-tile (the audit measured 115 against the ghost's 76): 0.9 + 1rem padding + 2
 *  border + label 11 + 7.2 + value 26 + delta 13 + 5.6; a .kpi-row and .networth-owner-strip
 *  (dt 15 + dd 26) each add the 1rem bottom margin. */
export const STAT_TILE = 115
export const TILE_ROW = STAT_TILE + 16
export const OWNER_STRIP = 57
/** Rows a ChartCard reserves whether or not the option landed — mirrored as --m-export-row /
 *  --m-zoom-row / --m-caption-row in panels.css, which the test pins. */
export const CHART_CARD_ROWS = {
  exportRow: 40, // .chart-export: the .segmented row (30) + its 0.4rem/0.25rem margins
  zoom: 21, // .chart-zoom-hint: 0.7rem × 1.5 + its 0.25rem top margin
  caption: 26, // one .drill-hint footer line + its 0.5rem margin
} as const
/** ms — mirrors `--t-xfade` (M2's token); only a timer can say when the fade ends and the veil goes. */
export const XFADE_MS = 180

/** SkeletonCard and PageSkeleton take the ghost BODY height; call sites think in the box the
 *  reader sees, and one place converts. */
export function ghostCardBody(outerHeight: number): number {
  return Math.max(0, outerHeight - CARD_CHROME)
}
/** A loaded ChartCard's outer box, so a ghost standing in for one can say so out loud. */
export function chartCardBox(canvas: number, opts: { zoomable?: boolean } = {}): number {
  return CARD_CHROME + CHART_CARD_ROWS.exportRow + canvas + (opts.zoomable === true ? CHART_CARD_ROWS.zoom : 0)
}
/** Feed ghosts per call site (spec §7), each a BODY height — a block that is NOT a card (comp's bare
 *  tile row) takes the chrome SkeletonCard adds back off. */
export const FEED_SKELETON = {
  paycheckBreakdown: 3 * HINT_LINE + TILE_ROW + 12 * TABLE_ROW, // 3-line hint, net-pay tile, 11 waterfall lines + total
  compVesting: ghostCardBody(TILE_ROW), // VestingTiles is a bare .kpi-row, not a card
  esppLots: HINT_LINE + 8 * TABLE_ROW, // hint, the add-row form, table header + 5 rows
  esppOfferings: HINT_LINE + 6 * TABLE_ROW, // hint, add form, header + 3 rows
} as const
