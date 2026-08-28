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
}: {
  tiles?: number
  cards?: { span: 4 | 6 | 8 | 12; height?: number }[]
}) {
  return (
    <div className="page-skeleton loading-fallback">
      <p className="visually-hidden" role="status">
        Loading…
      </p>
      {tiles > 0 && (
        <div className="kpi-row" aria-hidden="true">
          {Array.from({ length: tiles }, (_, i) => (
            <div className="stat-tile" key={i}>
              <div className="skeleton skeleton-label" />
              <div className="skeleton skeleton-value" />
            </div>
          ))}
        </div>
      )}
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
