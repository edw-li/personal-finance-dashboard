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

// Where a figure sits on the track, as a percentage of the limit: the practical cap's tick
// (spec §1.7) and the so-far segment's width (§2.6) are the same computation. fillPct's
// licence — a position is the client's to compute, the dollars beside it are the server's.
function trackPct(value: string, limit: string): number {
  return Math.min(Math.max((Number(value) / Number(limit)) * 100, 0), 100)
}

const TONE_WORD: Record<PaceItem['tone'], string> = {
  ok: 'on pace',
  warn: 'near the cap',
  over: 'over',
}
// Landing exactly ON the cap is its own sentence: "near the cap" reads as a warning about
// something that has not happened yet, and at 1.0000 it has (spec §2.6).
const AT_THE_CAP = 'at the cap'

/**
 * The ESPP row's provenance and forward sentences (spec §1.7). Every figure is the server's
 * — the client only picks clauses, and a zero is a state read, not a computation. The
 * percentage is the server's `current_rate` (a 9dp fraction) shifted to percent for display;
 * a pre-batch snapshot without it falls back to "your current rate" rather than deriving one.
 */
function paceNote(item: PaceItem): string | null {
  const halves = item.halves ?? null
  const parts = (halves ?? []).map((half) => `${half.label} ${half.source}`)
  if (item.backfilled_from != null) {
    parts.push(`before ${formatDate(item.backfilled_from)} assumes your earliest profile`)
  }
  if (parts.length === 0) return null
  // A WALKED row has no halves and only ever has this one clause to make: the paydays before
  // the person's earliest profile were priced from it, and the figure above says so out loud
  // rather than passing as observed (spec §2.6, the ESPP row's rule for every row).
  if (halves === null || halves.length === 0) return `${parts.join(' · ')}.`
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
        <InfoHint text="Each contribution line walked payday by payday through the paycheck profile in force, against the caps you entered in Settings. So far is estimated from your profile timeline payday by payday — the app has no per-paycheck ledger; the projection runs the rest of the year at today's percentages. Employer HSA deposits and the 401(k) match count once they are entered on your paycheck profile. The ESPP row grades the purchases that fall in this calendar year, so autumn checks count toward next year. Its cap is the most contribution dollars the §423 limit can buy at your plan discount; the exact chained figures live on the ESPP page." />
      </h2>
      <p className="drill-hint">
        So far this year, and where the year lands at today&apos;s percentages. Change a percentage
        and the projection moves; so far does not.
      </p>
      <div className="pace-rows">
        {items.map((item) => {
          // Present together or not at all: the ESPP row is the only one the server sends a
          // practical cap for, so every other row falls through unchanged.
          const softLimit = item.soft_limit ?? null
          const softRatio = item.soft_ratio ?? null
          // The walked year (spec §2.6): null on a row the server did not walk, and then
          // every string below is the one this panel printed before the walk existed.
          const soFar = item.so_far ?? null
          const projected = `${formatCurrency(item.annualized)}${soFar === null ? '' : ' projected'}`
          const cap = softLimit !== null ? `${formatCurrency(softLimit)} practical` : formatCurrency(item.limit)
          const behind = soFar === null ? '' : `${formatCurrency(soFar)} so far`
          const figures = `${behind === '' ? '' : `${behind} · `}${projected} / ${cap}`
          // No cap entered: the same two figures, with nothing to measure them against yet.
          const uncapped = behind === '' ? formatCurrency(item.annualized) : `${behind} · ${projected}`
          const valueText =
            (behind === '' ? '' : `${behind}; `) +
            (softLimit !== null
              ? `${formatCurrency(item.annualized)} of ${formatCurrency(softLimit)} practical cap; §423 cap ${formatCurrency(item.limit)}`
              : `${formatCurrency(item.annualized)} of ${formatCurrency(item.limit)}`)
          const note = paceNote(item)
          // Muted inside the figures cell: a component of the figure, not a second verdict.
          const matchSuffix =
            item.employer_match == null ? null : (
              <span className="pace-match">{` incl. ${formatCurrency(item.employer_match)} match`}</span>
            )
          // The HSA row's twin, in the same muted span: the deposit is a component of the
          // figure, not a second verdict. No row ever carries both — the match rides 415(c)
          // and the deposit rides the one HSA row — so they never compete for the cell.
          const employerSuffix =
            item.employer_hsa == null ? matchSuffix : (
              <span className="pace-match">{` incl. ${formatCurrency(item.employer_hsa)} employer`}</span>
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
                    {uncapped}
                    {employerSuffix}
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
                    aria-label={`${item.label} ${item.measure === 'window' ? 'window total' : 'projected'} vs limit`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    // Clamped like the fill: a valuenow of 108 against a valuemax of 100 is an
                    // out-of-range meter, and a screen reader is entitled to say anything at all
                    // about that. The TRUE over-ness rides aria-valuetext (the dollars) and the
                    // verdict text beside it — neither of which the clamp touches.
                    aria-valuenow={Math.min(Math.round(Number(item.ratio) * 100), 100)}
                    aria-valuetext={valueText}
                  >
                    {/* Two segments on one track: the projection runs the whole way in a
                        dimmed tone, and the solid segment over it is the money already in.
                        One track, because they are the same year — not two meters. */}
                    <div
                      className={`pace-fill is-${item.tone}${soFar === null ? '' : ' is-projected'}`}
                      style={{ width: `${fillPct(item.ratio).toFixed(2)}%` }}
                    />
                    {soFar !== null && (
                      <div
                        className={`pace-fill-sofar is-${item.tone}`}
                        style={{ width: `${trackPct(soFar, item.limit).toFixed(2)}%` }}
                      />
                    )}
                    {softLimit !== null && (
                      <span
                        className="pace-soft-tick"
                        aria-hidden="true"
                        style={{ left: `${trackPct(softLimit, item.limit).toFixed(2)}%` }}
                      />
                    )}
                    {/* The FILL's clamp, not the tone: the ESPP row's tone is judged on the
                        practical cap, so an "over" row can sit mid-track — and a tick past
                        the end would then describe an overflow that never happened. */}
                    {Number(item.ratio) > 1 && <span className="pace-overflow-tick" aria-hidden="true" />}
                  </div>
                  <span className={`pace-figures tone-${item.tone}`}>
                    {figures}
                    {employerSuffix}
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
                    <span className="pace-verdict-word">
                      {Number(softRatio ?? item.ratio) === 1 ? AT_THE_CAP : TONE_WORD[item.tone]}
                    </span>
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
