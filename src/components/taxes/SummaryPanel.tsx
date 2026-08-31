import { useMemo } from 'react'
import { FILING_STATUS_LABELS, jurisdictionLabel } from '../../api/taxes'
import EChart from '../EChart'
import InfoHint from '../InfoHint'
import StatTile from '../StatTile'
import type { FilingStatus, TaxSummaryOut } from '../../types/api'
import { formatCurrency, formatPct } from '../../utils/format'
import { waterfallOption } from './taxChartOptions'
// Only this component's own sheet, like its two siblings: the app-wide vocabulary
// (.card/.eyebrow/.kpi-row/.empty-note/.error-banner) is panels.css, which the PAGE
// imports — and StatTile brings it along regardless.
import './taxes.css'

// D2 (2026-08-31): the summary sections rendered as FIGURES, not only as chart geometry.
// One rule per column: Base is the jurisdiction's income context (agi / w2_income /
// gains_amount), Taxable the field its rates are actually walked over (taxable_income /
// taxable_wages) — so for capital gains "Taxable" is the ordinary income the gains stack
// on top of, and for NIIT the surcharged base. `niit` is optional on the wire (stored
// pre-C payloads): absence renders the em-dash convention, never a zero.
interface DetailRow {
  label: string
  base: string | null
  taxable: string | null
  tax: string | null
  rate: string | null
}

function jurisdictionRows(summary: TaxSummaryOut): DetailRow[] {
  const { federal, state, niit, medicare, social_security, disability, capital_gains } =
    summary
  return [
    { label: 'Federal', base: federal.agi, taxable: federal.taxable_income, tax: federal.tax, rate: federal.effective_rate },
    { label: 'State', base: state.agi, taxable: state.taxable_income, tax: state.tax, rate: state.effective_rate },
    { label: 'NIIT', base: niit?.gains_amount ?? null, taxable: niit?.taxable_income ?? null, tax: niit?.tax ?? null, rate: niit?.effective_rate ?? null },
    { label: 'Medicare', base: medicare.w2_income, taxable: medicare.taxable_wages, tax: medicare.tax, rate: medicare.effective_rate },
    { label: 'Social Security', base: social_security.w2_income, taxable: social_security.taxable_wages, tax: social_security.tax, rate: social_security.effective_rate },
    { label: 'Disability', base: disability.w2_income, taxable: disability.taxable_wages, tax: disability.tax, rate: disability.effective_rate },
    { label: 'Capital gains', base: capital_gains.gains_amount, taxable: capital_gains.taxable_income, tax: capital_gains.tax, rate: capital_gains.effective_rate },
  ]
}

/**
 * The engine's answer for the selected year: tiles for the headline figures, the
 * per-jurisdiction table, and a waterfall walking gross income down to take-home.
 *
 * The SELECTED year's summary is the page's (it already owns the three-payload load and
 * its year guard). The all-years trend this card used to carry lives in CompositionPanel
 * (2026-08-31 audit split), so the page keeps its year-scoped answer cards contiguous.
 */
export default function SummaryPanel({
  summary,
  filingStatus,
}: {
  summary: TaxSummaryOut
  /** The YEAR's status — what the missing-tables call-to-action names. */
  filingStatus: FilingStatus
}) {
  // Non-empty means the engine REFUSED to compute this year against another status' tables
  // (design §5.3), and the payload then carries NO sections at all — the figures are absent,
  // not zero. Everything that reads one is gated on this.
  const missing = summary.brackets_missing_for_status ?? []

  // Memoized: EChart keys its setOption effect on [option] with notMerge, so a fresh object
  // every render replays the chart on unrelated state flips (AllocationPanel's note).
  const waterfall = useMemo(
    () => (missing.length > 0 ? null : waterfallOption(summary)),
    [summary, missing.length],
  )

  // Null exactly when the engine refused: the tiles read em-dashes (formatCurrency/formatPct
  // answer '—' for an absent value) rather than the zeros it declined to compute.
  const totals = missing.length > 0 ? null : summary.totals

  return (
    <section className="card">
      <h2 className="eyebrow">
        Totals — {summary.year}
        <InfoHint text="The engine&apos;s answer for this year, computed from the stored inputs and bracket tables below." />
      </h2>
      <div className="kpi-row">
        {/* Every figure is the engine's, rendered as it arrived (global rule 9). */}
        <StatTile
          label="Gross income"
          value={formatCurrency(totals?.gross_income)}
          hint="Every income component summed before any tax — the waterfall&apos;s opening bar."
        />
        <StatTile
          label="Total tax"
          value={formatCurrency(totals?.total_tax)}
          hint="Every tax line summed: federal, state, Medicare, Social Security, SDI, capital gains — and NIIT when it applies."
        />
        {/* Same size as its three siblings: the hero treatment belongs to pages with ONE
            headline figure, and here it just made take-home shout over the row. */}
        <StatTile
          label="Take-home"
          value={formatCurrency(totals?.take_home)}
          hint="Gross income minus total tax."
        />
        <StatTile
          label="Effective rate"
          value={formatPct(totals?.effective_rate, { signed: false })}
          hint="Total tax ÷ gross income."
        />
      </div>

      {/* Gated with the waterfall: a refusal year carries NULL sections on the wire, and
          the missing-tables call to action below is that state's whole answer. */}
      {missing.length === 0 && (
        <div className="tax-section tax-jurisdiction-detail">
          <h3 className="eyebrow">
            By jurisdiction
            <InfoHint text="Base is each jurisdiction&apos;s income context — AGI for the income taxes, W-2 wages for the payroll taxes, gains or net investment income for capital gains and NIIT. Taxable is what its rates are actually walked over: for capital gains, the ordinary income the gains stack on top of; for NIIT, the surcharged base." />
          </h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Jurisdiction</th>
                <th className="num">Base</th>
                <th className="num">Taxable</th>
                <th className="num">Tax</th>
                {/* "Eff. rate", NOT "Effective rate": the totals tile above already owns
                    that exact label, and two nodes spelling it would be ambiguous to a
                    reader and to getByText alike. */}
                <th className="num">Eff. rate</th>
              </tr>
            </thead>
            <tbody>
              {jurisdictionRows(summary).map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="num">{formatCurrency(row.base)}</td>
                  <td className="num">{formatCurrency(row.taxable)}</td>
                  <td className="num">{formatCurrency(row.tax)}</td>
                  <td className="num">{formatPct(row.rate, { signed: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary.warnings.length > 0 && (
        // React text nodes, so the engine's sentences are escaped by construction. A
        // sparse year's "missing inputs defaulted to 0: …" names all 22 keys in one
        // line — it wraps (see taxes.css) rather than being clipped or summarised: the
        // list IS the message.
        <div className="tax-warnings">
          {summary.warnings.map((warning, i) => (
            // Index key: a fixed, non-reordered list rendered straight from the payload.
            <p key={i}>{warning}</p>
          ))}
        </div>
      )}

      {missing.length > 0 ? (
        <div className="tax-chart-block">
          <h3 className="eyebrow">
            No {FILING_STATUS_LABELS[filingStatus]} bracket tables for {summary.year}
            <InfoHint text="Bracket tables are stored per filing status. Until this year&apos;s status has its own, the engine has nothing to walk — so it reports the gap instead of computing against another status&apos; rates." />
          </h3>
          <div className="tax-brackets-missing" role="status">
            <p>
              {summary.year} is filed as {FILING_STATUS_LABELS[filingStatus]}, and these
              jurisdictions have no table for that status:
            </p>
            <p className="tax-brackets-missing-list">
              {missing.map(jurisdictionLabel).join(', ')}
            </p>
            <p>
              Open <strong>Bracket tables</strong> below, pick the{' '}
              {FILING_STATUS_LABELS[filingStatus]} tab, and clone {summary.year}&apos;s
              single-filer tables — then edit the thresholds that move with filing status.
            </p>
          </div>
        </div>
      ) : (
        <div className="tax-chart-block">
          <h3 className="eyebrow">
            Where {summary.year}&apos;s gross income went
            <InfoHint text="Gross income walked down to take-home — each floating bar is one jurisdiction&apos;s bite." />
          </h3>
          {waterfall ? (
            <EChart option={waterfall} height={320} />
          ) : (
            <p className="empty-note">
              Nothing to chart yet — this year computes to zero until its inputs are filled
              in below.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
