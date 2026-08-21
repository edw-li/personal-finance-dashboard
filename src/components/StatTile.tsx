import InfoHint from './InfoHint'
import './panels.css'

// Stat-tile contract (dataviz): label · value · optional delta. A delta speaks on three
// redundant channels, never on colour alone (CVD-safe): the GLYPH carries which way the
// number moved, the COLOUR (`tone`) carries whether that move is good, and the caller's
// own wording carries the judgment in words. "Direction × whether up is good" is still the
// caller's job — pass `tone`.
//
// Direction defaults to the tone, which is right whenever up is good. But a delta measured
// against a REFERENCE can have the two disagree — spending above its 12-month average went
// UP and that is BAD — and a tone-derived glyph would then point the wrong way and lie
// about the number. Pass `direction` explicitly in that case; it overrides the default and
// leaves colour and wording to carry the judgment.
export default function StatTile({
  label,
  value,
  delta,
  tone,
  direction,
  hint,
  hero = false,
}: {
  label: string
  value: string
  delta?: string
  tone?: 'positive' | 'negative' | 'neutral'
  direction?: 'up' | 'down'
  hint?: string
  hero?: boolean
}) {
  const glyph =
    direction === 'up'
      ? '▲'
      : direction === 'down'
        ? '▼'
        : tone === 'positive'
          ? '▲'
          : tone === 'negative'
            ? '▼'
            : ''
  return (
    <div className={hero ? 'stat-tile stat-tile-hero' : 'stat-tile'}>
      <div className="stat-label">
        {label}
        {hint !== undefined && <InfoHint text={hint} />}
      </div>
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
