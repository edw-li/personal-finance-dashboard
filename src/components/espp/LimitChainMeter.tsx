import type { EsppModelerOut } from '../../types/api'
import { formatCurrency } from '../../utils/format'
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
  const carryOut = periods.length === 0 ? 0 : Number(periods[periods.length - 1].carry_forward_out)
  // The chain can never exceed the limit by construction (each period is capped at
  // max_shares_25k), so the scale only ever grows past $25k on the cash side.
  const scale = Math.max(LIMIT_25K, contribution === null ? 0 : contribution + carryIn)
  const capped = periods.filter((p) => p.over_limit)

  const cashClauses = [`${formatCurrency(totals.total_contribution)} contributed`]
  if (refund > 0) cashClauses.push(`${formatCurrency(totals.total_refund)} refunded`)
  if (carryOut > 0)
    cashClauses.push(`${formatCurrency(periods[periods.length - 1].carry_forward_out)} carries forward`)

  return (
    <div className="chain-meter">
      <div className="chain-row">
        <span className="chain-name">Limit used, at the subscription price</span>
        <div
          className="chain-bar"
          role="meter"
          aria-label={`${formatCurrency(LIMIT_25K)} limit used in ${data.year}`}
          aria-valuemin={0}
          aria-valuemax={LIMIT_25K}
          aria-valuenow={Number(totals.total_25k_value)}
          aria-valuetext={`${formatCurrency(totals.total_25k_value)} of ${formatCurrency(LIMIT_25K)} used`}
        >
          <div className="chain-track" style={{ width: pct(LIMIT_25K, scale) }} />
          <div className="chain-segments">
            {periods.map((p, i) => (
              <div
                key={p.label}
                className={`chain-seg ${tone(i)}`}
                style={{ width: pct(Number(p.value_25k), scale) }}
                title={`${p.label}: ${formatCurrency(p.value_25k)} at the subscription price`}
              />
            ))}
          </div>
          <span className="chain-tick" style={{ left: pct(LIMIT_25K, scale) }} aria-hidden="true" />
        </div>
        <span className="chain-figures">
          {`${formatCurrency(totals.total_25k_value)} used · ${formatCurrency(totals.remaining_25k)} left`}
        </span>
      </div>
      {contribution !== null && (
        <div className="chain-row">
          <span className="chain-name">Your contributions</span>
          <div
            className="chain-bar"
            role="meter"
            aria-label={`contributions in ${data.year}`}
            aria-valuemin={0}
            aria-valuemax={scale}
            aria-valuenow={contribution}
            aria-valuetext={`${formatCurrency(totals.total_contribution)} contributed; ${formatCurrency(
              totals.out_of_pocket_cost,
            )} bought shares; ${formatCurrency(totals.total_refund)} refunded`}
          >
            <div className="chain-segments">
              {carryIn > 0 && (
                <div
                  className="chain-seg is-carry"
                  style={{ width: pct(carryIn, scale) }}
                  title={`carried in: ${formatCurrency(data.carry_forward)}`}
                />
              )}
              {periods.map((p, i) => (
                <div
                  key={p.label}
                  className={`chain-seg ${tone(i)}`}
                  style={{ width: pct(Number(p.cost), scale) }}
                  title={`${p.label}: ${formatCurrency(p.cost)} bought shares`}
                />
              ))}
              {refund > 0 && (
                <div
                  className="chain-seg is-refund"
                  style={{ width: pct(refund, scale) }}
                  title={`refunded: ${formatCurrency(totals.total_refund)}`}
                />
              )}
            </div>
          </div>
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
