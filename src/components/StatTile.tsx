import { useEffect, useRef, useState } from 'react'
import InfoHint from './InfoHint'
import './panels.css'

interface CountUp {
  value: number
  format: (n: number) => string
}

// The settle runs only when every leg holds; the useState initializer and the effect
// share this single predicate so the zero-frame can never strand (an initializer that
// showed $0 with no animation coming would freeze there).
//
// A FUNCTION, not a module const, so tests can stub `matchMedia` per-case — contrast with
// EChart's module-scope read, which predates this need.
function shouldCountUp(countUp: CountUp | undefined): countUp is CountUp {
  return (
    countUp !== undefined &&
    typeof requestAnimationFrame === 'function' &&
    !(
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
  )
}

const COUNT_UP_MS = 350

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
  countUp,
}: {
  label: string
  value: string
  delta?: string
  tone?: 'positive' | 'negative' | 'neutral'
  direction?: 'up' | 'down'
  hint?: string
  hero?: boolean
  /** Settle the value from 0 over ~350ms on a FRESH first paint (2026-08-27 spec §8).
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
      const t = Math.min(1, (now - start) / COUNT_UP_MS)
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
      <div className="stat-value">{display ?? value}</div>
      {delta !== undefined && (
        <div className={`stat-delta stat-delta-${tone ?? 'neutral'}`}>
          {glyph && <span aria-hidden="true">{glyph} </span>}
          {delta}
        </div>
      )}
    </div>
  )
}
