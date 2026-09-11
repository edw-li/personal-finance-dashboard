import { Fragment, useMemo } from 'react'
import { FILING_STATUS_LABELS, jurisdictionLabel } from '../../api/taxes'
import ChartCard from '../ChartCard'
import InfoHint from '../InfoHint'
import StatTile from '../StatTile'
import type {
  FilingStatus,
  PersonWageTaxOut,
  TaxSummaryOut,
  WageTaxOut,
} from '../../types/api'
import { formatCurrency, formatPct } from '../../utils/format'
import { waterfallCsv, waterfallOption } from './taxChartOptions'
// Only this component's own sheet, like its two siblings: the app-wide vocabulary
// (.card/.eyebrow/.kpi-row/.empty-note/.error-banner) is panels.css, which the PAGE
// imports — and StatTile brings it along regardless.
import './taxes.css'

// The engine's own deduction sentence (backend/app/services/tax_service.py
// DEDUCTION_MISSING_WARNING). Matched on its opening rather than reconstructed, because the
// year is inside it: with neither deduction stored the engine taxes AGI in full, which is
// the largest single way a freshly created year can be wrong, and it must not read like the
// muted housekeeping list beside it (2026-09-09 spec 4e).
const DEDUCTION_WARNING_OPENING = 'No standard or itemized deduction entered for'

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
  // The earners behind a PER-WORKER row, indented under it. Only Social Security and
  // Disability ever carry any (Medicare is household-wide by statute), and only when they
  // say something the row above cannot — see `earnerRows`.
  people?: PersonWageTaxOut[]
  // Whether a taxable base BELOW the earner's wages is explained as a cap. True for Social
  // Security alone: its shortfall is the statutory wage base the walk stopped at, while an
  // SDI base can differ from W-2 wages for reasons that are not a cap at all.
  capNote?: boolean
}

/**
 * The earners to draw under a per-worker row — and, just as often, none.
 *
 * A sub-row is an EXPLANATION: it exists because the row above is a sum of bases, caps and
 * tables that differ. One earner walking the year's own table explains nothing, so that year
 * renders exactly as it did before per-person tables existed (spec §2.7). `per_person` is
 * optional on the wire — stored summaries predate it — and absence reads the same as a
 * single default earner.
 */
function earnerRows(section: WageTaxOut): PersonWageTaxOut[] {
  const people = section.per_person ?? []
  return people.length >= 2 || people.some((person) => person.table === 'own') ? people : []
}

function jurisdictionRows(summary: TaxSummaryOut): DetailRow[] {
  const { federal, state, niit, medicare, social_security, disability, capital_gains } =
    summary
  return [
    { label: 'Federal', base: federal.agi, taxable: federal.taxable_income, tax: federal.tax, rate: federal.effective_rate },
    { label: 'State', base: state.agi, taxable: state.taxable_income, tax: state.tax, rate: state.effective_rate },
    { label: 'NIIT', base: niit?.gains_amount ?? null, taxable: niit?.taxable_income ?? null, tax: niit?.tax ?? null, rate: niit?.effective_rate ?? null },
    { label: 'Medicare', base: medicare.w2_income, taxable: medicare.taxable_wages, tax: medicare.tax, rate: medicare.effective_rate },
    { label: 'Social Security', base: social_security.w2_income, taxable: social_security.taxable_wages, tax: social_security.tax, rate: social_security.effective_rate, people: earnerRows(social_security), capNote: true },
    { label: 'Disability', base: disability.w2_income, taxable: disability.taxable_wages, tax: disability.tax, rate: disability.effective_rate, people: earnerRows(disability) },
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

  // One list on the wire, two registers on screen. Everything the engine says is still
  // shown, in the order it said it; the deduction sentence is simply not muted.
  const alerts = summary.warnings.filter((w) => w.startsWith(DEDUCTION_WARNING_OPENING))
  const notes = summary.warnings.filter((w) => !w.startsWith(DEDUCTION_WARNING_OPENING))

  return (
    <>
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
              <InfoHint text="Base is each jurisdiction&apos;s income context — AGI for the income taxes, W-2 wages for the payroll taxes, gains or net investment income for capital gains and NIIT. The federal AGI includes long-term gains and qualified dividends, which the brackets do not walk: those are taxed by the capital-gains row instead. Taxable is what each row&apos;s rates are actually walked over: for federal, ordinary income after the deduction; for capital gains, the ordinary income the gains stack on top of; for NIIT, the surcharged base. Social Security and Disability are per worker: each earner&apos;s row shows their own wage base, cap and table." />
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
                  <Fragment key={row.label}>
                    <tr>
                      <td>{row.label}</td>
                      <td className="num">{formatCurrency(row.base)}</td>
                      <td className="num">{formatCurrency(row.taxable)}</td>
                      <td className="num">{formatCurrency(row.tax)}</td>
                      <td className="num">{formatPct(row.rate, { signed: false })}</td>
                    </tr>
                    {/* One line per earner, in the engine's column order. Index key: a fixed,
                        non-reordered list rendered straight from the payload (the warnings
                        note above), and `person_id` is null on a roster-less database. */}
                    {(row.people ?? []).map((person, index) => (
                      <tr key={index} className="tax-person-row">
                        {/* The cell stays a plain <td> — a display:flex table cell drops out
                            of the accessibility tree — so the name, its note and its tag are
                            laid out by a span inside it, and the indent is the cell's own
                            padding (taxes.css). */}
                        <td>
                          <span className="tax-person-name">
                            {/* A null name is unreachable today: a person line only exists
                                when the engine had a roster to build it from, and a
                                roster-less database cannot hold a person's table. Rendered
                                as nothing rather than invented if that ever changes. */}
                            <span>{person.name ?? ''}</span>
                            {/* A comparison, not money math: both figures are still the
                                engine's own strings, rendered as they arrived (global rule
                                9). The note names the base the walk stopped at, which IS the
                                cap — and a taxable base of 0 is not a cap at all but the
                                all-zero table of an exempt job (spec §2.2), which would
                                otherwise read "capped at $0.00". */}
                            {row.capNote === true &&
                              Number(person.taxable_wages) > 0 &&
                              Number(person.taxable_wages) < Number(person.w2_income) && (
                                <span className="drill-hint">
                                  capped at {formatCurrency(person.taxable_wages)}
                                </span>
                              )}
                            <span className="badge">
                              {person.table === 'own' ? 'own table' : 'default'}
                            </span>
                          </span>
                        </td>
                        <td className="num">{formatCurrency(person.w2_income)}</td>
                        <td className="num">{formatCurrency(person.taxable_wages)}</td>
                        <td className="num">{formatCurrency(person.tax)}</td>
                        <td className="num">{formatPct(person.effective_rate, { signed: false })}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {alerts.length > 0 && (
          // The advisory register (--warn), and role="alert" rather than a silent note: it
          // is saying the figures above are overstated, which is the one warning a reader
          // must not skim past.
          <div className="tax-warnings is-alert" role="alert">
            {alerts.map((warning, i) => (
              <p key={i}>{warning}</p>
            ))}
          </div>
        )}
        {notes.length > 0 && (
          // React text nodes, so the engine's sentences are escaped by construction. A
          // sparse year's "missing inputs defaulted to 0: …" names every absent key in one
          // line — it wraps (see taxes.css) rather than being clipped or summarised: the
          // list IS the message.
          <div className="tax-warnings">
            {notes.map((warning, i) => (
              // Index key: a fixed, non-reordered list rendered straight from the payload.
              <p key={i}>{warning}</p>
            ))}
          </div>
        )}

        {/* The refusal's call to action belongs to the figures card — it is what stands in
            for them. The waterfall does not: it is a chart card of its own (below). */}
        {missing.length > 0 && (
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
              {/* The way out differs by status. A married year has the single-filer
                  tables sitting right there, so the editor's clone is the answer; a SINGLE
                  year has nothing to clone from and is refusing because it is the year
                  being lived in (2026-09-09 spec 4g) — telling it to clone its own tables
                  would be nonsense. */}
              {filingStatus === 'single' ? (
                <p>
                  Open <strong>Bracket tables</strong> below and enter {summary.year}&apos;s
                  rates — the IRS and the Franchise Tax Board publish them each autumn. A
                  settled year that was imported without them still computes; this one is
                  the year you are living in, so a zero here would be a wrong answer rather
                  than a gap.
                </p>
              ) : (
                <p>
                  Open <strong>Bracket tables</strong> below, pick the{' '}
                  {FILING_STATUS_LABELS[filingStatus]} tab, and clone {summary.year}&apos;s
                  single-filer tables — then edit the thresholds that move with filing status.
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      {/* A SIBLING in the page grid, not a card nested in one: a ChartCard brings its own
          border, padding and h2, and inside the figures card that read as a box in a box. */}
      {missing.length === 0 && (
        <ChartCard
          title={`Where ${summary.year}'s gross income went`}
          hint="Gross income walked down to take-home — each floating bar is one jurisdiction's bite."
          ariaLabel="Waterfall chart walking gross income down through each tax to take-home pay"
          option={waterfall}
          empty="Nothing to chart yet — this year computes to zero until its inputs are filled in below."
          exportName={`tax-waterfall-${summary.year}`}
          csv={() => waterfallCsv(summary)}
          height={320}
        />
      )}
    </>
  )
}
