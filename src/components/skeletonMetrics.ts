// Every height a skeleton RESERVES, in one place (motion spec §7): a ghost standing in a different
// box than the block that replaces it IS the layout shift. Each number is the loaded layout's own
// arithmetic at a 16px root, from index.css (--density-card-pad) and panels.css — never a guess.
/** A .card's own frame, ghost or real: 17.6 top + 20 bottom padding + 2 border = 39.6. */
export const CARD_FRAME = 40
/** Ghost .card chrome: CARD_FRAME plus the stand-in label a ghost draws where a real card puts its
 *  header — 11 (.skeleton-label) + 9.6 margin. A REAL header is taller; chartCardBox charges that. */
export const CARD_CHROME = 60
/** One .drill-hint line (0.75rem × 1.5); one table row (0.85rem + 0.45rem padding, top and bottom);
 *  one .comp-form cell (11.5 label + 0.25rem gap + .field-input 6.4 + 6.4 + 2 + 17). */
export const HINT_LINE = 18
export const TABLE_ROW = 33
export const FORM_ROW = 51
/** The real .stat-tile (the audit measured 115 against the ghost's 76): 0.9 + 1rem padding + 2
 *  border + label 11 + 7.2 + value 26 + delta 13 + 5.6. */
export const STAT_TILE = 115
/** A .kpi-row's tile plus the row's own 1rem bottom margin. */
export const TILE_ROW = STAT_TILE + 16
/** The .networth-owner-strip BOX only — dt 15 + dd (2 margin + 24 line) = 41. Its 1rem margin is
 *  .skeleton-strip's `margin`, not part of this number: counting it twice stood the ghost 16px
 *  taller than the strip and pushed both charts down when the summary landed. */
export const OWNER_STRIP = 41
/** Rows a ChartCard reserves whether or not the option landed — mirrored as --m-header-row /
 *  --m-header-controls / --m-export-row / --m-zoom-row / --m-caption-row in panels.css, which the
 *  test pins. The two header rows are min-heights on the REAL header, so a card with small controls
 *  and a card with none still agree with the box this module reports. */
export const CHART_CARD_ROWS = {
  header: 15, // .chart-card-header with only the eyebrow: its line box
  headerControls: 30, // …with a .segmented control row beside it
  exportRow: 34, // .chart-export's segmented row (30) + the 0.25rem that used to be its margin
  zoom: 21, // .chart-zoom-hint: 0.7rem × 1.5 + its 0.25rem top margin
  caption: 26, // one .drill-hint footer line + its 0.5rem margin
} as const
/** .chart-card-header's own 0.75rem bottom margin — outside the row it sits above. */
export const HEADER_MARGIN = 12
/** ms — mirrors `--t-xfade` (M2's token, written here as the fallback panels.css carries); only a
 *  timer can say when the fade ends and the veil goes. The test pins the two together. */
export const XFADE_MS = 180

/** SkeletonCard and PageSkeleton take the ghost BODY height; call sites think in the box the
 *  reader sees, and one place converts. */
export function ghostCardBody(outerHeight: number): number {
  return Math.max(0, outerHeight - CARD_CHROME)
}
/** A loaded ChartCard's outer box, so a ghost standing in for one can say so out loud. Every term
 *  is a row the card reserves in BOTH states, so the answer holds before the data lands:
 *  frame + header + export row + canvas + the optional zoom caption and footer line. */
export function chartCardBox(
  canvas: number,
  opts: { controls?: boolean; zoomable?: boolean; footer?: boolean } = {},
): number {
  return (
    CARD_FRAME +
    HEADER_MARGIN +
    (opts.controls === true ? CHART_CARD_ROWS.headerControls : CHART_CARD_ROWS.header) +
    CHART_CARD_ROWS.exportRow +
    canvas +
    (opts.zoomable === true ? CHART_CARD_ROWS.zoom : 0) +
    (opts.footer === true ? CHART_CARD_ROWS.caption : 0)
  )
}
/** Feed ghosts per call site (spec §7), each a BODY height — a block that is NOT a card (comp's bare
 *  tile row) takes the chrome SkeletonCard adds back off. */
export const FEED_SKELETON = {
  paycheckBreakdown: 3 * HINT_LINE + TILE_ROW + 12 * TABLE_ROW, // 3-line hint, net-pay tile, 11 waterfall lines + total
  compVesting: ghostCardBody(TILE_ROW), // VestingTiles is a bare .kpi-row, not a card
  compEvents: 5 * HINT_LINE + 2 * FORM_ROW + 5 * TABLE_ROW, // 5-line hint, the auto-fit form's two rows, header + 4 focal years
  esppLots: HINT_LINE + 8 * TABLE_ROW, // hint, the add-row form, table header + 5 rows
  esppOfferings: HINT_LINE + 6 * TABLE_ROW, // hint, add form, header + 3 rows
} as const
