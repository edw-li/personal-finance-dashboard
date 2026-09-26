import './panels.css'

// Ghost first paint (2026-08-27 spec §3): the page's REAL chrome — kpi-row, card,
// card-grid — with silent blocks where data will land, so the structure appears
// immediately and nothing jumps when the payload fills it. Ghosts are aria-hidden;
// what a screen reader gets is the visually-hidden status line, exactly the sentence
// the old text fallback carried. Both components ride .loading-fallback, so anything
// resolving inside the delay window shows nothing at all.

/** The modifier of the real row a ghost row stands in for (2026-09-25 polish spec §4.6). */
export type TileRowVariant = 'five' | 'dense'

const ROW_CLASS: Record<TileRowVariant, string> = {
  five: 'kpi-row-5',
  dense: 'kpi-row-dense',
}

/** A ghost tile row described like the real one, so the two share every rule that lays them out —
 *  a bare `.kpi-row` wrapped five tiles 4 + 1 where the real row stood five across (PE-09, MOTION-01). */
export interface GhostRowSpec {
  count: number
  /** false: the delta-less tile, for rows whose real tiles carry no delta line (Credit cards). */
  delta?: boolean
  /** The real row's five-tile modifier (the calendar's, ESPP's, the Projection's; Portfolio's dense one). */
  row?: TileRowVariant
  /** The real row reserves its badge and delta lines (.kpi-row-steady). */
  steady?: boolean
  /** The first tile is the page's hero figure. */
  hero?: boolean
  /** A page's own class on the real row (the calendar's .cal-strip, the Projection's band). */
  className?: string
}

function rowClass({ row, steady, className }: Pick<GhostRowSpec, 'row' | 'steady' | 'className'>): string {
  return ['kpi-row', row === undefined ? null : ROW_CLASS[row], steady === true ? 'kpi-row-steady' : null, className ?? null]
    .filter((name): name is string => name !== null)
    .join(' ')
}

export default function PageSkeleton({
  tiles = 0,
  cards = [],
  strip = false,
}: {
  /** Tile ghosts: a count draws the full tile (label, value, delta line) in a plain row; an object
   *  describes the real row — its variant, steadiness, hero, page class, or a delta-less tile. */
  tiles?: number | GhostRowSpec
  cards?: { span: 4 | 6 | 8 | 12; height?: number }[]
  /** Net worth's per-owner strip under the tiles — ghosted, or the tiles jump when it lands. */
  strip?: boolean
}) {
  const spec: GhostRowSpec = typeof tiles === 'number' ? { count: tiles } : tiles
  return (
    <div className="page-skeleton loading-fallback">
      <p className="visually-hidden" role="status">
        Loading…
      </p>
      {spec.count > 0 && (
        <div className={rowClass(spec)} aria-hidden="true">
          {Array.from({ length: spec.count }, (_, i) => (
            <GhostTile key={i} delta={spec.delta ?? true} hero={spec.hero === true && i === 0} />
          ))}
        </div>
      )}
      {strip && <div className="skeleton-strip" aria-hidden="true"><div className="skeleton skeleton-label" /></div>}
      {cards.length > 0 && (
        <div className="card-grid" aria-hidden="true">
          {cards.map((card, i) => (
            <section className={`card span-${card.span}`} key={i}>
              <div className="skeleton skeleton-label" />
              <div
                className="skeleton skeleton-body"
                style={{ height: card.height ?? 220 }}
              />
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

/* A ghost tile IS a tile (2026-09-25 polish spec §4.6): the real four lines, a block set inside the
   label's, the figure's and the delta's line box, so it stands exactly as tall as the tile that
   replaces it — the same type sets every line, at every width — and takes the row's subgrid like any
   tile. Exported (2026-09-07): the ESPP strip, the Overview and Paycheck ghost single slots of a mixed
   row with this very tile. `delta: false` is the delta-less tile's twin (2026-09-13 polish §9); `hero`
   sets the figure line in the hero's size. */
export function GhostTile({ delta = true, hero = false }: { delta?: boolean; hero?: boolean }) {
  const classes = ['stat-tile', 'skeleton-tile', hero ? 'stat-tile-hero' : null, delta ? null : 'skeleton-tile-bare']
    .filter((name): name is string => name !== null)
    .join(' ')
  return (
    // aria-hidden on the TILE, not only on the row above it: in a mixed row its neighbours are real
    // tiles that must stay readable, so there is no hidden container.
    <div className={classes} aria-hidden="true">
      <div className="stat-label">
        <span className="skeleton skeleton-label" />
      </div>
      <div className="stat-badge-row" />
      <div className="stat-value">
        <span className="stat-value-figure">
          <span className="skeleton skeleton-value" />
        </span>
      </div>
      <div className="stat-delta">{delta && <span className="skeleton skeleton-delta" />}</div>
    </div>
  )
}

/** The KPI row ALONE, for a page that ghosts per feed instead of behind a page-level skeleton
 *  and still has headline tiles above its feeds. ESPP's strip appeared out of nothing when the
 *  modeler answered and moved the whole page down 118px on every cold load (2026-09-05 lane V
 *  smoke, `cls/espp`); reserving its box is the fix. `row` is the real row's variant. */
export function SkeletonTileRow({
  tiles = 1,
  row,
  label = 'Loading…',
}: {
  tiles?: number
  row?: TileRowVariant
  label?: string
}) {
  return (
    <div className="loading-fallback">
      <p className="visually-hidden" role="status">
        {label}
      </p>
      <div className={rowClass({ row })} aria-hidden="true">
        {Array.from({ length: tiles }, (_, i) => (
          <GhostTile key={i} />
        ))}
      </div>
    </div>
  )
}

/** Section-level ghost for pages whose sentinels are per-card ("Loading lots…"):
 *  one house card, same delay, label preserved for AT parity with the old text. */
export function SkeletonCard({
  height = 200,
  label = 'Loading…',
}: {
  height?: number
  label?: string
}) {
  return (
    <section className="card loading-fallback">
      <p className="visually-hidden">{label}</p>
      <div aria-hidden="true">
        <div className="skeleton skeleton-label" />
        <div className="skeleton skeleton-body" style={{ height }} />
      </div>
    </section>
  )
}
