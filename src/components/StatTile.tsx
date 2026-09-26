import { Fragment, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import InfoHint from './InfoHint'
import { MetricInfoButton } from './details/MetricInspector'
import type { MetricEvidence } from '../types/metrics'
import { prefersReducedMotion } from './useReducedMotion'
import './panels.css'

interface CountUp {
  value: number
  format: (n: number) => string
}

// The settle runs only when every leg holds; the useState initializer and the effect share
// this single predicate so the zero-frame can never strand. The reduced-motion read is the
// shared one (useReducedMotion.ts) — a synchronous call, because it runs in an initializer.
function shouldCountUp(countUp: CountUp | undefined): countUp is CountUp {
  return (
    countUp !== undefined &&
    typeof requestAnimationFrame === 'function' &&
    !prefersReducedMotion()
  )
}

// The house entrance clock (chart spec §11) — the same 450ms the charts animate in on.
const COUNT_UP_MS = 450

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
  unit,
  delta,
  tone,
  direction,
  hint,
  hero = false,
  countUp,
  evidence,
  badge,
}: {
  label: string
  value: string
  /** Words that complete the value, set small on a line of their own ("of paths through 2075")
   *  so a reading longer than a figure still fits the tile (2026-09-23 correctness spec §R7). */
  unit?: string
  delta?: string
  /** `warn` is a caution (amber) with no glyph of its own — the Projection's borderline verdict. */
  tone?: 'positive' | 'negative' | 'neutral' | 'warn'
  /** `none`: the delta is a verdict, not a movement — no glyph whatever the tone (the caller's
   *  words and a badge carry the judgment; 2026-09-23 correctness spec §R7). */
  direction?: 'up' | 'down' | 'none'
  hint?: string
  hero?: boolean
  evidence?: MetricEvidence
  /** A small status pill on the badge line under the label ("Not yet reviewed") — the review state
   *  that used to float under the tile row as an orphan line (2026-09-13 polish §10); its own line
   *  since 2026-09-25 (polish spec §4.1). */
  badge?: ReactNode
  /** Settle the value from 0 over ~450ms on a FRESH first paint (2026-08-27 spec §8).
   *  Callers gate it themselves (never on cached paints); the final frame renders
   *  `value` exactly. Additive — omitted means today's static render. */
  countUp?: CountUp
}) {
  // Mount-captured on purpose: the settle is a first-paint flourish, and a later prop
  // (a revalidation's new number) must update the tile directly, not restart the count.
  // `settle` is re-evaluated every render but only ever READ on the first one — both
  // initializers below take it, so the zero-frame and the effect still share one predicate
  // while nothing reads `countUpRef.current` during render (react-hooks/refs).
  const settle = shouldCountUp(countUp) ? countUp : undefined
  const countUpRef = useRef(settle)
  const [display, setDisplay] = useState<string | null>(() =>
    settle !== undefined ? settle.format(0) : null,
  )
  useEffect(() => {
    const target = countUpRef.current
    if (target === undefined) return
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      // Clamped at BOTH ends. A browser's rAF stamp shares `performance.now()`'s origin, so
      // the low end is theory there — but jsdom's do NOT (its window's origin trails the
      // process clock by seconds), and an unclamped negative t runs the ease backwards into
      // a nine-figure negative dollar amount rather than merely starting late.
      const t = Math.min(1, Math.max(0, (now - start) / COUNT_UP_MS))
      if (t >= 1) {
        // Final frame: clear the override — the caller's exact string takes over.
        setDisplay(null)
        return
      }
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(target.format(target.value * eased))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
  const glyph =
    direction === 'none'
      ? ''
      : direction === 'up'
        ? '▲'
        : direction === 'down'
          ? '▼'
          : tone === 'positive'
            ? '▲'
            : tone === 'negative'
              ? '▼'
              : ''
  const clauses = delta === undefined ? [] : clausesOf(delta)
  const glyphSpan = glyph ? <span className="stat-delta-glyph" aria-hidden="true">{glyph} </span> : null
  return (
    <div className={hero ? 'stat-tile stat-tile-hero' : 'stat-tile'}>
      {/* Four lines, always, in this order (2026-09-25 polish spec §4.1, contract C4). Inside a row
          each is a track the row shares — label · badge · value · delta — so a line's figures sit on
          one baseline and its deltas start on one line whatever each tile carries. */}
      <div className="stat-label">
        {/* One nowrap unit for the words and their (i): an atomic inline may break before it,
            and the icon kept landing alone on a second line (audit P-11). */}
        <span className="stat-label-text">
          {label}
          {hint !== undefined && evidence === undefined && <InfoHint text={hint} />}
          {evidence !== undefined && <MetricInfoButton evidence={evidence} />}
        </span>
      </div>
      {/* The badge's own line: beside the label it wrapped under it in a narrow tile and pushed that
          one value off the row's baseline (OU-03). Empty without a badge. */}
      <div className="stat-badge-row">{badge !== undefined && <span className="stat-badge">{badge}</span>}</div>
      <div className="stat-value">
        {/* The figure is what .stat-value's container width sizes (panels.css). */}
        <span className="stat-value-figure">{display ?? value}</span>
        {unit !== undefined && <span className="stat-value-unit"> {unit}</span>}
      </div>
      {/* Always present, empty without a delta: the line is the row's, not this tile's. */}
      <div className={`stat-delta stat-delta-${tone ?? 'neutral'}`}>
        {clauses.length === 1 && (
          <>
            {glyphSpan}
            {delta}
          </>
        )}
        {clauses.length > 1 &&
          clauses.map((clause, i) => (
            <Fragment key={i}>
              {i > 0 && ' '}
              {/* One unbreakable clause (spec §4.3): the line breaks between "…since Sep 1" and
                  "· 21 days", never inside "Sep 1" or "21 days". */}
              <span className="stat-delta-clause">
                {i === 0 ? glyphSpan : '· '}
                {clause}
              </span>
            </Fragment>
          ))}
      </div>
    </div>
  )
}

/** A delta's clauses: its top-level " · " splits it ("…since Sep 1" | "21 days"); one inside
 *  parentheses never does ("(Sep 1 → Sep 22 · provisional)" stays whole). */
function clausesOf(delta: string): string[] {
  const clauses: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < delta.length; i++) {
    const char = delta[i]
    if (char === '(') depth++
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && delta.startsWith(' · ', i)) {
      clauses.push(delta.slice(start, i))
      start = i + 3
      i += 2
    }
  }
  clauses.push(delta.slice(start))
  return clauses
}
