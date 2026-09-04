import './panels.css'

// Ghost first paint (2026-08-27 spec §3): the page's REAL chrome — kpi-row, card,
// card-grid — with silent blocks where data will land, so the structure appears
// immediately and nothing jumps when the payload fills it. Ghosts are aria-hidden;
// what a screen reader gets is the visually-hidden status line, exactly the sentence
// the old text fallback carried. Both components ride .loading-fallback, so anything
// resolving inside the delay window shows nothing at all.

export default function PageSkeleton({
  tiles = 0,
  cards = [],
  strip = false,
}: {
  tiles?: number
  cards?: { span: 4 | 6 | 8 | 12; height?: number }[]
  /** Net worth's per-owner strip under the tiles — ghosted, or the tiles jump when it lands. */
  strip?: boolean
}) {
  return (
    <div className="page-skeleton loading-fallback">
      <p className="visually-hidden" role="status">
        Loading…
      </p>
      {tiles > 0 && (
        <div className="kpi-row" aria-hidden="true">
          {Array.from({ length: tiles }, (_, i) => (
            <GhostTile key={i} />
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

/* The real tile carries a delta line: a two-block ghost measured 76 against its 115, so every
   KPI row dropped 39px when the data landed (2026-09-05 audit). One definition, so the row
   PageSkeleton draws and the row a page reserves on its own can never drift apart. */
function GhostTile() {
  return (
    <div className="stat-tile skeleton-tile">
      <div className="skeleton skeleton-label" />
      <div className="skeleton skeleton-value" />
      <div className="skeleton skeleton-delta" />
    </div>
  )
}

/** The KPI row ALONE, for a page that ghosts per feed instead of behind a page-level skeleton
 *  and still has headline tiles above its feeds. ESPP's $25k strip appeared out of nothing when
 *  the modeler answered and moved the whole page down 118px on every cold load (2026-09-05 lane
 *  V smoke, `cls/espp`); reserving its box is the fix. `lone` mirrors .kpi-row-lone, the single
 *  tile that must not stretch the grid. */
export function SkeletonTileRow({
  tiles = 1,
  lone = false,
  label = 'Loading…',
}: {
  tiles?: number
  lone?: boolean
  label?: string
}) {
  return (
    <div className="loading-fallback">
      <p className="visually-hidden" role="status">
        {label}
      </p>
      <div className={`kpi-row${lone ? ' kpi-row-lone' : ''}`} aria-hidden="true">
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
