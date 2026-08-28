import { Link } from 'react-router-dom'
import type { PaceItem } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import InfoHint from '../InfoHint'
import '../panels.css'
import './pace.css'

// The meter's fill is CLAMPED at the track's end; the percentage beside it is not. A
// 108 % bar that overflowed its container would be a layout bug reading as data.
function fillPct(ratio: string): number {
  return Math.min(Number(ratio) * 100, 100)
}

const TONE_WORD: Record<PaceItem['tone'], string> = {
  ok: 'on pace',
  warn: 'near the cap',
  over: 'over',
}

/**
 * The contribution-pace strip (2026-08-27 spec §5): one meter per contribution line,
 * annualized from the profile in force against the year's entered caps.
 *
 * Plain HTML/CSS in the BudgetPanel meter family — same 4px track, same
 * position-channel tick for over-ness — deliberately in its own sheet rather than
 * importing a spending stylesheet into a paycheck component.
 *
 * A row with no limit renders NO meter: the app ships no IRS values, and drawing a bar
 * against a cap nobody entered would be a fabricated number. It gets the call to action
 * instead (spec §6).
 */
export default function PacePanel({ items }: { items: PaceItem[] }) {
  // Nothing to say rather than an empty card: the two 401(k) rows are unconditional
  // server-side, so an empty list only happens when there is no profile at all — and the
  // page is already saying that above.
  if (items.length === 0) return null
  return (
    <section className="card" role="region" aria-label="Contribution pace">
      <h2 className="eyebrow">
        Contribution pace
        <InfoHint text="Each contribution line annualized from the paycheck profile in force, against the caps you entered in Settings. A projection at today's percentages — not a year-to-date total, which this app has no per-paycheck ledger to compute. Employer 401(k) match and employer HSA contributions count against the same caps and are not modeled." />
      </h2>
      <p className="drill-hint">
        At this rate, over a full year — not what you have contributed so far. Change a percentage
        mid-year and this moves with it.
      </p>
      <div className="pace-rows">
        {items.map((item) => (
          <div className="pace-row" key={item.key}>
            <span className="pace-name">{item.label}</span>
            {item.limit === null || item.ratio === null ? (
              <>
                <span className="pace-figures">{formatCurrency(item.annualized)}</span>
                <span className="pace-cta">
                  <Link to="/settings">enter this year&apos;s limit</Link>
                </span>
              </>
            ) : (
              <>
                <div
                  className="pace-meter"
                  role="meter"
                  aria-label={`${item.label} annualized vs limit`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  // Clamped like the fill: a valuenow of 108 against a valuemax of 100 is an
                  // out-of-range meter, and a screen reader is entitled to say anything at all
                  // about that. The TRUE over-ness rides aria-valuetext (the dollars) and the
                  // verdict text beside it — neither of which the clamp touches.
                  aria-valuenow={Math.min(Math.round(Number(item.ratio) * 100), 100)}
                  aria-valuetext={`${formatCurrency(item.annualized)} of ${formatCurrency(item.limit)}`}
                >
                  <div
                    className={`pace-fill is-${item.tone}`}
                    style={{ width: `${fillPct(item.ratio).toFixed(2)}%` }}
                  />
                  {item.tone === 'over' && <span className="pace-overflow-tick" aria-hidden="true" />}
                </div>
                <span className={`pace-figures tone-${item.tone}`}>
                  {`${formatCurrency(item.annualized)} / ${formatCurrency(item.limit)}`}
                </span>
                {/* The tone in WORDS as well as colour — the meter's own aria-valuetext
                    carries the dollars, and this carries the verdict. The percentage prints to
                    2dp because the tone is judged on the server's 4dp HALF_UP ratio: at one
                    decimal a 0.9499 ratio prints "95.0%" beside "on pace" and a 1.0004 one
                    prints "100.0%" beside "over" — the number contradicting the verdict at
                    exactly the boundaries the verdict is about. */}
                <span className={`pace-verdict tone-${item.tone}`}>
                  {`${(Number(item.ratio) * 100).toFixed(2)}%`}
                  <span className="pace-verdict-word">{TONE_WORD[item.tone]}</span>
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
