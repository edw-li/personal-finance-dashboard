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
            /* The real tile carries a delta line: a two-block ghost measured 76 against its 115, so
               every KPI row dropped 39px when the data landed (2026-09-05 audit). */
            <div className="stat-tile skeleton-tile" key={i}>
              <div className="skeleton skeleton-label" />
              <div className="skeleton skeleton-value" />
              <div className="skeleton skeleton-delta" />
            </div>
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
