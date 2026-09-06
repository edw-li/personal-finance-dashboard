import { Link } from 'react-router-dom'
import type { PaceItem } from '../../types/api'
import { formatCurrency, formatDate } from '../../utils/format'
import { shiftPoint } from '../../utils/percent'
import InfoHint from '../InfoHint'
import '../panels.css'
import './pace.css'

// The meter's fill is CLAMPED at the track's end; the percentage beside it is not. A
// 108 % bar that overflowed its container would be a layout bug reading as data.
function fillPct(ratio: string): number {
  return Math.min(Number(ratio) * 100, 100)
}

// The practical cap's POSITION on the §423 track (spec §1.7) — fillPct's licence: a position
// is the client's to compute, the dollars beside it are always the server's.
function tickPct(soft: string, limit: string): number {
  return Math.min(Math.max((Number(soft) / Number(limit)) * 100, 0), 100)
}

const TONE_WORD: Record<PaceItem['tone'], string> = {
  ok: 'on pace',
  warn: 'near the cap',
  over: 'over',
}

/**
 * The ESPP row's provenance and forward sentences (spec §1.7). Every figure is the server's
 * — the client only picks clauses, and a zero is a state read, not a computation. The
 * percentage is the server's `current_rate` (a 9dp fraction) shifted to percent for display;
 * a pre-batch snapshot without it falls back to "your current rate" rather than deriving one.
 */
function paceNote(item: PaceItem): string | null {
  const halves = item.halves ?? null
  if (halves === null || halves.length === 0) return null
  const parts = halves.map((half) => `${half.label} ${half.source}`)
  if (item.backfilled_from != null) {
    parts.push(`before ${formatDate(item.backfilled_from)} assumes your earliest profile`)
  }
  // One clause for the whole window: the basis is the profile's cadence, and saying it twice
  // would read as two different approximations.
  if (halves.some((half) => half.basis === 'months')) parts.push('estimated by month')
  const projected = item.projected_full_year
  if (projected == null) return `${parts.join(' · ')}.`
  if (Number(projected) === 0) return `${parts.join(' · ')}. You are not contributing now.`
  // Number() drops the 9dp tail ("12.0000000" → 12) without touching the digits that matter.
  const rate = item.current_rate != null ? `${Number(shiftPoint(item.current_rate, 2))}%` : 'rate'
  const excess =
    item.projected_excess != null && Number(item.projected_excess) > 0
      ? `, which is ${formatCurrency(item.projected_excess)} over the practical cap; the plan refunds the excess after the purchase`
      : ''
  return `${parts.join(' · ')}. At your current ${rate}, a full purchase year is ${formatCurrency(projected)}${excess}.`
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
        <InfoHint text="Each contribution line annualized from the paycheck profile in force, against the caps you entered in Settings. A projection at today's percentages — not a year-to-date total, which this app has no per-paycheck ledger to compute. Employer HSA contributions are not modeled; set your 401(k) match on your paycheck profile. The ESPP row grades the purchases that fall in this calendar year, so autumn checks count toward next year. Its cap is the most contribution dollars the §423 limit can buy at your plan discount; the exact chained figures live on the ESPP page." />
      </h2>
      <p className="drill-hint">
        At this rate, over a full year — not what you have contributed so far. Change a percentage
        mid-year and this moves with it.
      </p>
      <div className="pace-rows">
        {items.map((item) => {
          // Present together or not at all: the ESPP row is the only one the server sends a
          // practical cap for, so every other row falls through unchanged.
          const softLimit = item.soft_limit ?? null
          const softRatio = item.soft_ratio ?? null
          const figures =
            softLimit !== null
              ? `${formatCurrency(item.annualized)} / ${formatCurrency(softLimit)} practical`
              : `${formatCurrency(item.annualized)} / ${formatCurrency(item.limit)}`
          const valueText =
            softLimit !== null
              ? `${formatCurrency(item.annualized)} of ${formatCurrency(softLimit)} practical cap; §423 cap ${formatCurrency(item.limit)}`
              : `${formatCurrency(item.annualized)} of ${formatCurrency(item.limit)}`
          const note = paceNote(item)
          // Muted inside the figures cell: a component of the figure, not a second verdict.
          const matchSuffix =
            item.employer_match == null ? null : (
              <span className="pace-match">{` incl. ${formatCurrency(item.employer_match)} match`}</span>
            )
          return (
            <div className="pace-row" key={item.key}>
              <span className="pace-name">
                {item.label}
                {item.window_label != null && <span className="pace-window">{item.window_label}</span>}
              </span>
              {item.limit === null || item.ratio === null ? (
                <>
                  <span className="pace-figures">
                    {formatCurrency(item.annualized)}
                    {matchSuffix}
                  </span>
                  <span className="pace-cta">
                    <Link to="/settings">enter this year&apos;s limit</Link>
                  </span>
                </>
              ) : (
                <>
                  <div
                    className="pace-meter"
                    role="meter"
                    aria-label={`${item.label} ${item.measure === 'window' ? 'window total' : 'annualized'} vs limit`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    // Clamped like the fill: a valuenow of 108 against a valuemax of 100 is an
                    // out-of-range meter, and a screen reader is entitled to say anything at all
                    // about that. The TRUE over-ness rides aria-valuetext (the dollars) and the
                    // verdict text beside it — neither of which the clamp touches.
                    aria-valuenow={Math.min(Math.round(Number(item.ratio) * 100), 100)}
                    aria-valuetext={valueText}
                  >
                    <div
                      className={`pace-fill is-${item.tone}`}
                      style={{ width: `${fillPct(item.ratio).toFixed(2)}%` }}
                    />
                    {softLimit !== null && (
                      <span
                        className="pace-soft-tick"
                        aria-hidden="true"
                        style={{ left: `${tickPct(softLimit, item.limit).toFixed(2)}%` }}
                      />
                    )}
                    {/* The FILL's clamp, not the tone: the ESPP row's tone is judged on the
                        practical cap, so an "over" row can sit mid-track — and a tick past
                        the end would then describe an overflow that never happened. */}
                    {Number(item.ratio) > 1 && <span className="pace-overflow-tick" aria-hidden="true" />}
                  </div>
                  <span className={`pace-figures tone-${item.tone}`}>
                    {figures}
                    {matchSuffix}
                  </span>
                  {/* The tone in WORDS as well as colour — the meter's own aria-valuetext
                      carries the dollars, and this carries the verdict. The percentage prints to
                      2dp because the tone is judged on the server's 4dp HALF_UP ratio: at one
                      decimal a 0.9499 ratio prints "95.0%" beside "on pace" and a 1.0004 one
                      prints "100.0%" beside "over" — the number contradicting the verdict at
                      exactly the boundaries the verdict is about. */}
                  <span className={`pace-verdict tone-${item.tone}`}>
                    {/* soft_ratio where there is one: the ratio the TONE was judged on. */}
                    {`${(Number(softRatio ?? item.ratio) * 100).toFixed(2)}%`}
                    <span className="pace-verdict-word">{TONE_WORD[item.tone]}</span>
                  </span>
                </>
              )}
              {note !== null && <p className="pace-note">{note}</p>}
            </div>
          )
        })}
      </div>
    </section>
  )
}
