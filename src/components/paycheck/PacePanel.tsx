import { useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Link } from 'react-router-dom'
import type { PaceItem } from '../../types/api'
import { formatCurrency, formatCurrencyCompact, formatDate } from '../../utils/format'
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

/** The four things the track draws, and which one the pointer is over. */
type Hot = 'sofar' | 'fill' | 'soft' | 'overflow'

/** What the tip is saying, where along the track it points, and which part it belongs to. */
type Tip = { lines: string[]; left: number; hot: Hot | null }

// Kept off the track's ends: the tip is centred on the pointer, and one centred on x=0 would
// hang into the label beside it.
function tipLeft(pct: number): number {
  return Math.min(Math.max(pct, 2), 98)
}

// Which drawn part a pointer is over — `closest`, not the target itself, because the hit
// bands are ::before pseudo-elements of the segments and a browser may report either.
function partAt(target: Element): Hot | null {
  const part = target.closest('.pace-fill-sofar, .pace-fill, .pace-soft-tick, .pace-overflow-tick')
  if (part === null) return null
  if (part.classList.contains('pace-fill-sofar')) return 'sofar'
  if (part.classList.contains('pace-fill')) return 'fill'
  if (part.classList.contains('pace-soft-tick')) return 'soft'
  return 'overflow'
}

/**
 * One row: the label, the two-segment meter, the compact figures and the verdict.
 *
 * A component rather than a loop body because it owns HOVER STATE (2026-09-07): the figures
 * cell had grown to "$31,339.50 so far · $41,667.90 projected / $72,000.00 incl. $11,500.00
 * match" and squeezed the bar it was describing. The standing text is now compact and every
 * exact figure is a hover or a focus away — and in `aria-valuetext`, so nothing readable
 * became hover-only.
 */
function PaceRow({ item }: { item: PaceItem }) {
  const [tip, setTip] = useState<Tip | null>(null)
  // Present together or not at all: the ESPP row is the only one the server sends a
  // practical cap for, so every other row falls through unchanged.
  const softLimit = item.soft_limit ?? null
  const softRatio = item.soft_ratio ?? null
  // The walked year (spec §2.6): null on a row the server did not walk.
  const soFar = item.so_far ?? null
  const note = paceNote(item)

  // A row carries at most ONE employer leg — the match rides 415(c), the deposit rides the
  // one HSA row — so the two can never compete for the same clause.
  const employerMoney = item.employer_match ?? item.employer_hsa ?? null
  const employerNoun = item.employer_match != null ? 'employer match' : 'employer'
  const employer = employerMoney === null ? null : `${formatCurrency(employerMoney)} ${employerNoun}`

  // Compact and nothing else: "$41.7K / $72.0K" leaves the bar its width.
  const cap =
    softLimit !== null
      ? `${formatCurrencyCompact(softLimit)} practical`
      : formatCurrencyCompact(item.limit)
  const figures = `${formatCurrencyCompact(item.annualized)} / ${cap}`
  // No cap entered: the projection alone, beside the call to action.
  const uncapped = `${formatCurrencyCompact(item.annualized)} projected`

  // The whole sentence, for the reader who cannot hover — the meter announces it.
  const valueText =
    (soFar === null ? '' : `${formatCurrency(soFar)} so far; `) +
    (softLimit !== null
      ? `${formatCurrency(item.annualized)} of ${formatCurrency(softLimit)} practical cap; §423 cap ${formatCurrency(item.limit)}`
      : `${formatCurrency(item.annualized)} projected of ${formatCurrency(item.limit)}`) +
    (employer === null ? '' : `, incl. ${employer}`)

  // One line per thing the track draws, so a hover answers exactly what it is over.
  const soFarLine = soFar === null ? null : `So far ${formatCurrency(soFar)}`
  const projectedLine =
    `Projected ${formatCurrency(item.annualized)}` +
    (employer === null ? '' : ` · incl. ${employer}`) +
    (item.window_label == null ? '' : ` · ${item.window_label}`)
  const capLine =
    softLimit !== null
      ? `Practical cap ${formatCurrency(softLimit)} of the ${formatCurrency(item.limit)} §423 cap`
      : `Cap ${formatCurrency(item.limit)}`
  // Display arithmetic on two figures the server already sent (the movers lede's licence):
  // the tick is drawn from the same two, so the sentence cannot disagree with it.
  const overflowLine =
    item.limit === null || item.ratio === null || Number(item.ratio) <= 1
      ? null
      : `Over the cap by ${formatCurrency(Number(item.annualized) - Number(item.limit))}`

  const linesFor = (part: Hot): string[] | null => {
    if (part === 'sofar') return soFarLine === null ? null : [soFarLine]
    if (part === 'soft') return softLimit === null ? null : [capLine]
    if (part === 'overflow') return overflowLine === null ? null : [overflowLine]
    return [projectedLine]
  }

  // At the POINTER, not at the segment's midpoint: a tip that opens half a track away from
  // the cursor reads as a label for something else.
  const pointerLeft = (event: ReactMouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    // A track jsdom never measured (or a zero-width one) has no pointer position to speak
    // of: centre the tip rather than divide by zero.
    if (rect.width <= 0) return 50
    return tipLeft(((event.clientX - rect.left) / rect.width) * 100)
  }

  const show = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (item.limit === null || item.ratio === null) return
    const part = partAt(event.target as Element)
    const lines = part === null ? null : linesFor(part)
    // The empty track past the projection describes nothing — hovering it says nothing, and
    // clears whatever the last segment said.
    setTip(lines === null || part === null ? null : { lines, left: pointerLeft(event), hot: part })
  }

  const hide = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Moving BETWEEN the meter's own parts fires mouseout as well; only a real exit hides.
    const to = event.relatedTarget as Node | null
    if (to === null || !event.currentTarget.contains(to)) setTip(null)
  }

  // Focus is not a pointer: it has no part to be over, so it says everything at once, from
  // the middle of the track, and lights nothing up.
  const focusLines = [soFarLine, projectedLine, capLine].filter(
    (line): line is string => line !== null,
  )

  // The two runs are NEIGHBOURS, not one drawn over the other: the projected segment starts
  // where the so-far one ends and carries only the remainder, which is what lets a pointer be
  // over exactly one of them (and what makes the hover swell read as one segment, not two).
  const soFarPct = soFar === null || item.limit === null ? 0 : trackPct(soFar, item.limit)
  const projectedPct = item.ratio === null ? 0 : fillPct(item.ratio)

  return (
    <div className="pace-row">
      <span className="pace-name">
        {item.label}
        {item.window_label != null && <span className="pace-window">{item.window_label}</span>}
      </span>
      {item.limit === null || item.ratio === null ? (
        <>
          <span className="pace-figures">{uncapped}</span>
          <span className="pace-cta">
            <Link to="/settings">enter this year&apos;s limit</Link>
          </span>
        </>
      ) : (
        <>
          <div
            className="pace-meter"
            role="meter"
            // Focusable, because the tips are the only place the exact figures are drawn and
            // a pointer is not the only way to ask for them.
            tabIndex={0}
            aria-label={`${item.label} ${item.measure === 'window' ? 'window total' : 'projected'} vs limit`}
            aria-valuemin={0}
            aria-valuemax={100}
            // Clamped like the fill: a valuenow of 108 against a valuemax of 100 is an
            // out-of-range meter, and a screen reader is entitled to say anything at all
            // about that. The TRUE over-ness rides aria-valuetext (the dollars) and the
            // verdict text beside it — neither of which the clamp touches.
            aria-valuenow={Math.min(Math.round(Number(item.ratio) * 100), 100)}
            aria-valuetext={valueText}
            // mouseOver/mouseOut, not the enter/leave pair: these bubble, so ONE handler on
            // the track can read which part the pointer is over (ToastProvider's note).
            onMouseOver={show}
            onMouseMove={show}
            onMouseOut={hide}
            onFocus={() => setTip({ lines: focusLines, left: 50, hot: null })}
            onBlur={() => setTip(null)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setTip(null)
            }}
          >
            {/* Two segments on one track: the projection runs the whole way in a dimmed
                tone, and the solid segment over it is the money already in. One track,
                because they are the same year — not two meters. */}
            <div
              className={`pace-fill is-${item.tone}${soFar === null ? '' : ' is-projected'}${tip?.hot === 'fill' ? ' is-hot' : ''}`}
              style={{
                left: `${soFarPct.toFixed(2)}%`,
                width: `${Math.max(projectedPct - soFarPct, 0).toFixed(2)}%`,
              }}
            />
            {soFar !== null && (
              <div
                className={`pace-fill-sofar is-${item.tone}${tip?.hot === 'sofar' ? ' is-hot' : ''}`}
                style={{ width: `${soFarPct.toFixed(2)}%` }}
              />
            )}
            {softLimit !== null && (
              <span
                className={`pace-soft-tick${tip?.hot === 'soft' ? ' is-hot' : ''}`}
                aria-hidden="true"
                style={{ left: `${trackPct(softLimit, item.limit).toFixed(2)}%` }}
              />
            )}
            {/* The FILL's clamp, not the tone: the ESPP row's tone is judged on the
                practical cap, so an "over" row can sit mid-track — and a tick past the end
                would then describe an overflow that never happened. */}
            {Number(item.ratio) > 1 && (
              <span
                className={`pace-overflow-tick${tip?.hot === 'overflow' ? ' is-hot' : ''}`}
                aria-hidden="true"
              />
            )}
            {tip !== null && (
              <div className="pace-tip" role="tooltip" style={{ left: `${tip.left.toFixed(2)}%` }}>
                {tip.lines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
            )}
          </div>
          <span className={`pace-figures tone-${item.tone}`}>{figures}</span>
          {/* The tone in WORDS as well as colour — the meter's own aria-valuetext carries
              the dollars, and this carries the verdict. The percentage prints to 2dp because
              the tone is judged on the server's 4dp HALF_UP ratio: at one decimal a 0.9499
              ratio prints "95.0%" beside "on pace" and a 1.0004 one prints "100.0%" beside
              "over" — the number contradicting the verdict at exactly the boundaries the
              verdict is about. */}
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
        and the projection moves; so far does not. Hover or focus a bar for the exact figures.
      </p>
      <div className="pace-rows">
        {items.map((item) => (
          <PaceRow item={item} key={item.key} />
        ))}
      </div>
    </section>
  )
}
