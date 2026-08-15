import './panels.css'

// Stat-tile contract (dataviz): label · value · optional delta ("direction x whether up
// is good" is the caller's job — pass `tone`). Deltas always pair a glyph with the color.
export default function StatTile({
  label,
  value,
  delta,
  tone,
  hero = false,
}: {
  label: string
  value: string
  delta?: string
  tone?: 'positive' | 'negative' | 'neutral'
  hero?: boolean
}) {
  const glyph = tone === 'positive' ? '▲' : tone === 'negative' ? '▼' : ''
  return (
    <div className={hero ? 'stat-tile stat-tile-hero' : 'stat-tile'}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {delta !== undefined && (
        <div className={`stat-delta stat-delta-${tone ?? 'neutral'}`}>
          {glyph && <span aria-hidden="true">{glyph} </span>}
          {delta}
        </div>
      )}
    </div>
  )
}
