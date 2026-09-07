import { useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { EsppModelerOut, EsppModelerPeriod } from '../../types/api'
import { formatCurrency, formatShares } from '../../utils/format'
import '../panels.css'
import './espp.css'

// The IRS §423 ceiling the chain is modeled against (backend espp_calc: unused_25k starts
// here). Exactly as on the gauge it replaces, nothing here is DERIVED from it: it sizes the
// limit row's track and the meter's aria range, and "remaining" is the server's own number.
export const LIMIT_25K = 25000

/** A width on the shared scale — clamped so a rounding hair can never overflow the row. */
function pct(value: number, scale: number): string {
  return `${Math.max(0, Math.min(100, (value / scale) * 100)).toFixed(2)}%`
}

/** Periods alternate two steps of one hue: ordered, not identified. */
const tone = (index: number) => (index % 2 === 0 ? 'is-period-a' : 'is-period-b')

/** One drawn thing on a bar — its geometry and the lines a hover over it says. The first
 *  line is the headline the focus tip repeats for every part at once. */
interface Part {
  key: string
  className: string
  width?: string
  left?: string
  lines: string[]
}

/** What the tip is saying, where along the bar it points, and which part it belongs to. */
type Tip = { lines: string[]; left: number; hot: string | null }

// Kept off the bar's ends (the pace meter's rule): a tip centred on x=0 hangs into the label
// beside it.
const tipLeft = (value: number) => Math.min(Math.max(value, 2), 98)

/**
 * One meter row's bar: its parts, the hover tip and the swell — the pace meter's grammar
 * (PacePanel, 2026-09-07). ONE bubbling handler on the bar reads which part the pointer is over
 * through `data-part` (`closest`, because the tick's hit band is a ::before and a browser may
 * report either); focus has no part to be over, so it says every part's headline at once from
 * the middle and lights nothing; Escape and blur put it away. The bar keeps `aria-valuetext`,
 * so nothing readable is hover-only.
 */
function MeterBar({
  ariaLabel,
  valueMax,
  valueNow,
  valueText,
  parts,
  track,
  tick,
}: {
  ariaLabel: string
  valueMax: number
  valueNow: number
  valueText: string
  parts: Part[]
  /** The row's track, when it has one — hovering its EMPTY stretch says what remains. */
  track?: Part
  tick?: Part
}) {
  const [tip, setTip] = useState<Tip | null>(null)
  const everything = [...parts, ...(track ? [track] : []), ...(tick ? [tick] : [])]

  const partAt = (target: Element): Part | null => {
    const key = target.closest('[data-part]')?.getAttribute('data-part') ?? null
    return key === null ? null : (everything.find((part) => part.key === key) ?? null)
  }

  // At the POINTER, not at the part's midpoint: a tip that opens half a bar away from the
  // cursor reads as a label for something else. A bar jsdom never measured has no pointer
  // position to speak of, so the tip centres rather than dividing by zero.
  const pointerLeft = (event: ReactMouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return 50
    return tipLeft(((event.clientX - rect.left) / rect.width) * 100)
  }

  const show = (event: ReactMouseEvent<HTMLDivElement>) => {
    const part = partAt(event.target as Element)
    setTip(part === null ? null : { lines: part.lines, left: pointerLeft(event), hot: part.key })
  }

  const hide = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Moving BETWEEN the bar's own parts fires mouseout as well; only a real exit hides.
    const to = event.relatedTarget as Node | null
    if (to === null || !event.currentTarget.contains(to)) setTip(null)
  }

  const focusLines = [...parts.map((part) => part.lines[0]), ...(track ? [track.lines[0]] : [])]
  const hot = (part: Part) => (tip?.hot === part.key ? ' is-hot' : '')

  return (
    <div
      className="chain-bar"
      role="meter"
      // Focusable, because the tips carry each period's figures and a pointer is not the only
      // way to ask for them.
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={valueMax}
      aria-valuenow={valueNow}
      aria-valuetext={valueText}
      // mouseOver/mouseOut, not the enter/leave pair: these bubble, so ONE handler on the bar
      // can read which part the pointer is over (ToastProvider's note).
      onMouseOver={show}
      onMouseMove={show}
      onMouseOut={hide}
      onFocus={() => setTip({ lines: focusLines, left: 50, hot: null })}
      onBlur={() => setTip(null)}
      onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') setTip(null)
      }}
    >
      {track && (
        <div
          className={`${track.className}${hot(track)}`}
          data-part={track.key}
          style={{ width: track.width }}
        />
      )}
      <div className="chain-segments">
        {parts.map((part) => (
          <div
            key={part.key}
            className={`${part.className}${hot(part)}`}
            data-part={part.key}
            style={{ width: part.width }}
          />
        ))}
      </div>
      {tick && (
        <span
          className={`${tick.className}${hot(tick)}`}
          data-part={tick.key}
          style={{ left: tick.left }}
          aria-hidden="true"
        />
      )}
      {tip !== null && (
        <div className="chain-tip" role="tooltip" style={{ left: `${tip.left.toFixed(2)}%` }}>
          {tip.lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/** The limit row's lines for one period: what it used, how, and where the cap stood. */
function limitLines(p: EsppModelerPeriod): string[] {
  return [
    `${p.label} — ${formatCurrency(p.value_25k)} of the limit`,
    `${formatShares(p.shares)} sh × ${formatCurrency(p.subscription_price)} subscription price`,
    p.over_limit
      ? `Cap reached — capped at ${formatShares(p.max_shares_25k)} sh; ${formatCurrency(p.unused_25k)} of limit was left at the start`
      : `${formatCurrency(p.unused_25k)} of limit was left at the start`,
  ]
}

/** The cash row's lines for one period: what the money bought and where the rest went. */
function cashLines(p: EsppModelerPeriod): string[] {
  const lines = [
    `${p.label} — ${formatCurrency(p.cost)} bought ${formatShares(p.shares)} sh at ${formatCurrency(p.purchase_price)}`,
    `Contribution ${formatCurrency(p.contribution)}${
      p.available === p.contribution ? '' : ` · ${formatCurrency(p.available)} available with the carry-in`
    }`,
  ]
  if (Number(p.carry_forward_out) > 0)
    lines.push(`${formatCurrency(p.carry_forward_out)} carries into the next period`)
  if (Number(p.refund) > 0) lines.push(`${formatCurrency(p.refund)} refunded — cap reached`)
  return lines
}

/**
 * The $25k chain as two meter rows on ONE dollar scale (2026-09-07 spec §7): the limit counts
 * shares at the subscription price while the cash buys them at the discounted price, and only a
 * shared scale lets the reader see that gap — the two-limit confusion the 2026-09-02 audit
 * flagged. HTML in the pace meter's grammar, not a chart: this is a filled quantity against a
 * range. Every figure is the server's (the period rows, the modeler totals); the only arithmetic
 * is pixel width. The contributions row draws only when the payload carries the totals it
 * needs — a warm snapshot from before this batch does not.
 */
export default function LimitChainMeter({ data }: { data: EsppModelerOut }) {
  const { totals, periods } = data
  const contribution =
    totals.total_contribution === undefined ? null : Number(totals.total_contribution)
  const refund = totals.total_refund === undefined ? 0 : Number(totals.total_refund)
  const carryIn = Number(data.carry_forward)
  const last = periods.length === 0 ? null : periods[periods.length - 1]
  const carryOut = last === null ? 0 : Number(last.carry_forward_out)
  // The chain can never exceed the limit by construction (each period is capped at
  // max_shares_25k), so the scale only ever grows past $25k on the cash side.
  const scale = Math.max(LIMIT_25K, contribution === null ? 0 : contribution + carryIn)
  const capped = periods.filter((p) => p.over_limit)
  const refunded = periods.filter((p) => Number(p.refund) > 0)

  const cashClauses = [`${formatCurrency(totals.total_contribution)} contributed`]
  if (refund > 0) cashClauses.push(`${formatCurrency(totals.total_refund)} refunded`)
  if (carryOut > 0 && last !== null)
    cashClauses.push(`${formatCurrency(last.carry_forward_out)} carries forward`)

  const limitParts: Part[] = periods.map((p, i) => ({
    key: `limit-${i}`,
    className: `chain-seg ${tone(i)}`,
    width: pct(Number(p.value_25k), scale),
    lines: limitLines(p),
  }))
  const cashParts: Part[] = [
    ...(carryIn > 0
      ? [
          {
            key: 'carry',
            className: 'chain-seg is-carry',
            width: pct(carryIn, scale),
            lines: [`Carried in ${formatCurrency(data.carry_forward)} — last year's unspent cash`],
          },
        ]
      : []),
    ...periods.map((p, i) => ({
      key: `cash-${i}`,
      className: `chain-seg ${tone(i)}`,
      width: pct(Number(p.cost), scale),
      lines: cashLines(p),
    })),
    ...(refund > 0
      ? [
          {
            key: 'refund',
            className: 'chain-seg is-refund',
            width: pct(refund, scale),
            lines: [
              `Refunded ${formatCurrency(totals.total_refund)} — cash the cap sent back`,
              // Per period only when more than one refunded: one line would repeat the headline.
              ...(refunded.length > 1
                ? refunded.map((p) => `${p.label}: ${formatCurrency(p.refund)}`)
                : []),
            ],
          },
        ]
      : []),
  ]

  return (
    <div className="chain-meter">
      <div className="chain-row">
        <span className="chain-name">Limit used, at the subscription price</span>
        <MeterBar
          ariaLabel={`${formatCurrency(LIMIT_25K)} limit used in ${data.year}`}
          valueMax={LIMIT_25K}
          valueNow={Number(totals.total_25k_value)}
          valueText={`${formatCurrency(totals.total_25k_value)} of ${formatCurrency(LIMIT_25K)} used`}
          parts={limitParts}
          track={{
            key: 'remaining',
            className: 'chain-track',
            width: pct(LIMIT_25K, scale),
            lines: [`Remaining ${formatCurrency(totals.remaining_25k)} of the ${formatCurrency(LIMIT_25K)} limit`],
          }}
          tick={{
            key: 'tick',
            className: 'chain-tick',
            left: pct(LIMIT_25K, scale),
            lines: [`The ${formatCurrency(LIMIT_25K)} §423 limit — shares counted at the subscription price`],
          }}
        />
        <span className="chain-figures">
          {`${formatCurrency(totals.total_25k_value)} used · ${formatCurrency(totals.remaining_25k)} left`}
        </span>
      </div>
      {contribution !== null && (
        <div className="chain-row">
          <span className="chain-name">Your contributions</span>
          <MeterBar
            ariaLabel={`contributions in ${data.year}`}
            valueMax={scale}
            valueNow={contribution}
            valueText={`${formatCurrency(totals.total_contribution)} contributed; ${formatCurrency(
              totals.out_of_pocket_cost,
            )} bought shares; ${formatCurrency(totals.total_refund)} refunded`}
            parts={cashParts}
          />
          <span className="chain-figures">{cashClauses.join(' · ')}</span>
        </div>
      )}
      {/* Identity in words as well as tone (never colour alone). */}
      <div className="chain-legend" aria-hidden="true">
        {carryIn > 0 && (
          <span className="chain-chip">
            <i className="chain-swatch is-carry" />
            Carried in
          </span>
        )}
        {periods.map((p, i) => (
          <span key={p.label} className="chain-chip">
            <i className={`chain-swatch ${tone(i)}`} />
            {p.label}
          </span>
        ))}
        {contribution !== null && (
          <span className="chain-chip">
            <i className="chain-swatch is-refund" />
            Refunded
          </span>
        )}
        <span className="chain-chip">
          <i className="chain-swatch is-remaining" />
          Remaining
        </span>
      </div>
      {/* Advisory, never the error banner: the chain still ran (espp.css's espp-warning register). */}
      {capped.map((p) => (
        <p key={p.label} className="drill-hint espp-warning">
          {`Cap reached in ${p.label} — ${formatCurrency(p.refund)} refunded.`}
        </p>
      ))}
    </div>
  )
}
