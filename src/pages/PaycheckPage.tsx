import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, describeLoadFailures, errorDetail } from '../api/client'
import {
  createProfile,
  deleteProfile,
  fetchBreakdown,
  fetchProfiles,
  updateProfile,
} from '../api/paycheck'
import { fetchHousehold } from '../api/household'
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
import AmountInput from '../components/AmountInput'
import ChartCard from '../components/ChartCard'
import InfoHint from '../components/InfoHint'
import PacePanel from '../components/paycheck/PacePanel'
import type { ApplySeed } from '../components/paycheck/paycheckScenario'
import {
  paycheckSankeyCsv,
  paycheckSankeyOption,
} from '../components/paycheck/paycheckSankeyOptions'
import TryItPanel from '../components/paycheck/TryItPanel'
import Feed, { FeedBanner } from '../components/shell/Feed'
import PageFrame from '../components/shell/PageFrame'
import ScopeBar, { HOUSEHOLD_SNAPSHOT } from '../components/shell/ScopeBar'
import { FEED_SKELETON } from '../components/skeletonMetrics'
import { useScope } from '../components/shell/useScope'
import StatTile from '../components/StatTile'
import type {
  HouseholdOut,
  HsaCoverage,
  PaycheckBreakdownOut,
  PaycheckProfileCreate,
  PaycheckProfileOut,
} from '../types/api'
import { canonicalAmount, isAmount } from '../utils/amount'
import { formatCurrency, formatDate, formatPct } from '../utils/format'
import { shiftPoint } from '../utils/percent'
import '../components/panels.css'
import './PaycheckPage.css'

// The router's own bounds (app/api/paycheck.py MIN_PAY_PERIODS/MAX_PAY_PERIODS) — refuse a
// typo here rather than spending a request on the 422 that says the same thing. This is
// THE divide-by-zero guard: gross = annual_salary / pay_periods_per_year.
const MIN_PAY_PERIODS = 1
const MAX_PAY_PERIODS = 366
// The sheet's semi-monthly cadence, and the router's own default for a create.
const DEFAULT_PAY_PERIODS = '24'

function message(err: unknown, fallback: string): string {
  // 404/409/422 details are the server's own sentences — rendered verbatim (house note).
  return err instanceof ApiError ? err.message : fallback
}

// ── Breakdown ───────────────────────────────────────────────────────────────────────────

/**
 * The eleven lines of one check, in the sheet's own order, as a definition list: each
 * label is the term and the server's figure is its definition.
 *
 * Every line is a 2dp display value of a full-precision chain, so they do NOT reconcile to
 * `net_pay` by a cent (4486.26 - 236.16 - 865.93 = 3384.17 against a net of 3384.16).
 * `net_pay` is the authoritative one, which is why nothing here is ever added up on this
 * side of the wire (global rule 9).
 */
const WATERFALL: {
  key: Exclude<keyof PaycheckBreakdownOut, 'profile' | 'warnings' | 'monthly_net' | 'pace'>
  label: string
}[] = [
  { key: 'gross', label: 'Gross' },
  { key: 'trad_401k', label: 'Traditional 401(k)' },
  { key: 'dental_vision', label: 'Dental & vision' },
  { key: 'hsa', label: 'HSA' },
  { key: 'taxable', label: 'Taxable' },
  { key: 'withholding', label: 'Withholding' },
  { key: 'post_tax', label: 'Post-tax' },
  { key: 'roth_401k', label: 'Roth 401(k)' },
  { key: 'after_tax_401k', label: 'After-tax 401(k)' },
  { key: 'espp', label: 'ESPP' },
  { key: 'net_pay', label: 'Net pay' },
]

function BreakdownPanel({ data, still }: { data: PaycheckBreakdownOut; still: boolean }) {
  return (
    <section className="card">
      {/* The panel names the profile it belongs to. That is what makes keeping a stale
          payload on a failed reload honest: the heading moves with the numbers, so one
          profile's waterfall can never be read as another's. */}
      <h2 className="eyebrow">
        Per-check breakdown — effective {formatDate(data.profile.effective_date)}
        <InfoHint text="One paycheck from gross to net in the sheet&apos;s order — pre-tax deductions, then withholding, then post-tax contributions. The net is authoritative; lines are display-rounded." />
      </h2>
      <p className="drill-hint">
        One paycheck at {data.profile.pay_periods_per_year} periods a year. Each line is
        rounded for display out of a full-precision chain, so they can disagree with the net
        by a cent — the net is the authoritative figure.
      </p>
      {/* The one figure the list below does NOT carry: net pay is per check, this is what
          lands in a month. Deliberately the only tile — a second one showing `net_pay`
          would print the same number twice on one card. */}
      <div className="kpi-row kpi-row-lone">
        <StatTile
          label="Monthly net"
          value={formatCurrency(data.monthly_net)}
          // Fresh paints only (spec §8) — `still` is the panel's cached-paint flag, the same
          // one FlowPanel takes. A decimal-string amount, so Number() for the ease.
          countUp={
            !still ? { value: Number(data.monthly_net), format: formatCurrency } : undefined
          }
          hint="Net pay per check × checks per year ÷ 12."
          hero
        />
      </div>
      {data.warnings.length > 0 && (
        // React text nodes, so the server's sentences are escaped by construction. NOT an
        // error banner: the router raises these on a legal profile (each percentage is
        // individually valid), and an over-committed check is a thing the sheet models too.
        <div className="paycheck-warnings">
          {data.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}
      <dl className="paycheck-waterfall">
        {WATERFALL.map(({ key, label }) => (
          <div key={key} className={`paycheck-line${key === 'net_pay' ? ' is-net' : ''}`}>
            <dt>{label}</dt>
            <dd>{formatCurrency(data[key])}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

// ── Flow ────────────────────────────────────────────────────────────────────────────────

/**
 * The waterfall drawn as a flow, from the SAME payload the table renders: gray nodes
 * restate money in transit (gross, taxable, post-tax), colored nodes are destinations,
 * green is the kept money. A null option is the builder's negative guard (or an all-zero
 * check) — the table is the always-correct surface, so this card steps aside with a
 * sentence instead of drawing a lie.
 */
function FlowPanel({ data }: { data: PaycheckBreakdownOut }) {
  const option = useMemo(() => paycheckSankeyOption(data), [data])
  return (
    <ChartCard
      title="Where each check goes"
      hint="The table's own figures drawn as a flow — gross splits into pre-tax deductions and taxable, taxable into withholding and post-tax, post-tax into contributions and net pay. Amounts match the table exactly."
      ariaLabel="Sankey flow of one paycheck from gross to net"
      option={option}
      empty="This profile's deductions exceed pay — see the table."
      exportName="paycheck-flow"
      csv={() => paycheckSankeyCsv(data)}
      height={320}
      // The legend describes the CHART, so it goes when the chart does: under the empty
      // sentence it was explaining node colours and a hover affordance for a sankey that
      // is not on the page (the table below is the surface to read instead).
      footer={
        option === null ? undefined : (
          <p className="drill-hint">
            Gray nodes restate money in transit; colored nodes are where it lands; green is
            what you keep. Hover a node to trace its flows.
          </p>
        )
      }
    />
  )
}

// ── Profiles ────────────────────────────────────────────────────────────────────────────

interface ProfileFormState {
  effective_date: string
  annual_salary: string
  pay_periods_per_year: string
  trad_401k_pct: string // percent form — "13", never "0.130000000"
  roth_401k_pct: string
  after_tax_401k_pct: string
  espp_pct: string
  withholding_pct: string
  dental_vision_per_check: string
  hsa_per_check: string
  hsa_coverage: HsaCoverage
  notes: string
}

type PctField =
  | 'trad_401k_pct'
  | 'roth_401k_pct'
  | 'after_tax_401k_pct'
  | 'espp_pct'
  | 'withholding_pct'

// One array drives the five inputs, the range check and the conversion, so they cannot
// drift. The labels are the BOX's vocabulary (percent), not the column's (fraction).
const PCT_FIELDS: { field: PctField; label: string }[] = [
  { field: 'trad_401k_pct', label: 'Traditional 401(k) %' },
  { field: 'roth_401k_pct', label: 'Roth 401(k) %' },
  { field: 'after_tax_401k_pct', label: 'After-tax 401(k) %' },
  { field: 'espp_pct', label: 'ESPP %' },
  { field: 'withholding_pct', label: 'Withholding %' },
]

// The tier's own vocabulary, not the column's: the stored value is 'self', the box says
// "Self only" — the same distinction the percent boxes draw between 13 and 0.13.
const HSA_COVERAGES: { value: HsaCoverage; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'self', label: 'Self only' },
  { value: 'family', label: 'Family' },
]

const COVERAGE_LABELS = new Map<HsaCoverage, string>(
  HSA_COVERAGES.map((coverage) => [coverage.value, coverage.label]),
)

const EMPTY_PROFILE: ProfileFormState = {
  effective_date: '', annual_salary: '', pay_periods_per_year: DEFAULT_PAY_PERIODS,
  trad_401k_pct: '', roth_401k_pct: '', after_tax_401k_pct: '', espp_pct: '',
  withholding_pct: '', dental_vision_per_check: '', hsa_per_check: '',
  hsa_coverage: 'self', notes: '',
}

/** Every box of one stored row: the server's own quantized strings, percents shifted. */
function formFrom(profile: PaycheckProfileOut): ProfileFormState {
  return {
    effective_date: profile.effective_date,
    annual_salary: profile.annual_salary,
    pay_periods_per_year: String(profile.pay_periods_per_year),
    trad_401k_pct: shiftPoint(profile.trad_401k_pct, 2),
    roth_401k_pct: shiftPoint(profile.roth_401k_pct, 2),
    after_tax_401k_pct: shiftPoint(profile.after_tax_401k_pct, 2),
    espp_pct: shiftPoint(profile.espp_pct, 2),
    withholding_pct: shiftPoint(profile.withholding_pct, 2),
    dental_vision_per_check: profile.dental_vision_per_check,
    hsa_per_check: profile.hsa_per_check,
    hsa_coverage: profile.hsa_coverage,
    notes: profile.notes ?? '',
  }
}

/**
 * The monthly comp-change ritual: a new profile is the current one with a new date on it.
 * Everything carries over except the two things that are ALWAYS about the new row — the
 * date it takes effect on, and its note.
 */
function newProfileForm(latest: PaycheckProfileOut | undefined): ProfileFormState {
  if (latest === undefined) return EMPTY_PROFILE
  return { ...formFrom(latest), effective_date: '', notes: '' }
}

function latestOf(profiles: PaycheckProfileOut[]): PaycheckProfileOut | undefined {
  // The router already orders by effective_date DESC; reducing makes the panel independent
  // of that (TaxesPage's `latestOf`). ISO dates, so a string compare IS the date compare.
  return profiles.length === 0
    ? undefined
    : profiles.reduce((a, b) => (b.effective_date > a.effective_date ? b : a))
}

/**
 * The profile history table and the one form that doubles as new-profile and row editor
 * (EsppPage's idiom). It owns its form state, and the page hands it a replaced `profiles`
 * array rather than remounting it — so a breakdown refetch or a failed reload cannot
 * destroy a half-typed row.
 */
function ProfilesPanel({
  profiles,
  personId,
  shownId,
  pinnedId,
  onSelect,
  onShowCurrent,
  onChanged,
  initialForm,
}: {
  profiles: PaycheckProfileOut[]
  /** The person the CHIPS picked, or null for "the default" (the primary, or a household
   *  with nobody to switch between). A create carries it; a PATCH never does — this form
   *  cannot move a stored profile from one person to another. */
  personId: number | null
  /** The profile the breakdown above is actually showing — the server's answer, not ours. */
  shownId: number | null
  /**
   * The profile the PAGE asked for, which is null while the server is choosing. The two
   * differ on exactly the case the "show the current profile" affordance exists for: a row
   * can be lit up because it was pinned, or because it is the one in force today.
   */
  pinnedId: number | null
  onSelect: (id: number) => void
  onShowCurrent: () => void
  /** `deletedId` is set only by a delete, so the page can drop a selection that just died. */
  onChanged: (deletedId?: number) => void
  /** Apply from the Try it card: the form opens on these values (a keyed remount, see the page). */
  initialForm?: ApplySeed
}) {
  const latest = latestOf(profiles)
  // Seeded from the FIRST payload and never re-seeded: the panel is not remounted on a
  // reload, so a replaced `profiles` array cannot clobber typed work (TaxesPage's editors).
  const [form, setForm] = useState<ProfileFormState>(() => initialForm ?? newProfileForm(latest))
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Single-flight across the panel (SecuritiesPanel's busy flag).
  const [busy, setBusy] = useState(false)

  const set = (field: keyof ProfileFormState) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  // Its own setter rather than `set('hsa_coverage')`: this is the one box whose state is a
  // UNION rather than free text, and the generic setter's computed key would widen it to
  // string — a hand-fired change event could then park an unstored tier in state.
  const setCoverage = (value: string) => {
    const next = HSA_COVERAGES.find((coverage) => coverage.value === value)
    if (next !== undefined) setForm((f) => ({ ...f, hsa_coverage: next.value }))
  }

  // A seeded mount brings the date box into view and focuses it (spec §9) — DOM calls only,
  // no state. Guarded: jsdom has no scrollIntoView.
  useEffect(() => {
    if (initialForm === undefined) return
    const el = document.getElementById('paycheck-effective-date')
    el?.scrollIntoView?.({ block: 'center' })
    el?.focus()
  }, [initialForm])

  const startEdit = (profile: PaycheckProfileOut) => {
    setEditingId(profile.id)
    setForm(formFrom(profile))
  }

  const stopEditing = (seed: PaycheckProfileOut | undefined) => {
    setEditingId(null)
    setForm(newProfileForm(seed))
  }

  const submit = () => {
    const salary = form.annual_salary.trim()
    const periodsText = form.pay_periods_per_year.trim()
    if (!form.effective_date || !salary || !periodsText) {
      // An empty string reaches the API as `""` and 422s as an opaque decimal-parse error
      // (TransactionsPanel's Task 14 review M2 lesson).
      setError('Effective date, annual salary and pay periods are required')
      return
    }
    const periods = Number(periodsText)
    if (!Number.isInteger(periods) || periods < MIN_PAY_PERIODS || periods > MAX_PAY_PERIODS) {
      // The server's own sentence: a count is a count on both sides of the wire, so one
      // wording covers one rule.
      setError(`pay_periods_per_year must be between ${MIN_PAY_PERIODS} and ${MAX_PAY_PERIODS}`)
      return
    }
    for (const { field, label } of PCT_FIELDS) {
      const text = form[field].trim()
      // Blank is a real zero on this form (see `pct` below), so an empty box is not text
      // to refuse — but anything else that shiftPoint will not convert has to stop HERE.
      // "1e-3" is the case that matters: it would travel verbatim, parse server-side as a
      // perfectly legal Decimal 0.001, and store a tenth of a percent where the box said a
      // thousandth of one. There is no 422 behind this gate (isAmount's note).
      //
      // { expressions: false }, matching the kind="percent" box: the cell refuses a leading
      // "=" because the evaluator quantizes to 2dp and these columns are 9dp fractions
      // ("=1/8" would store 0.0013 for an eighth of a percent). The gate must refuse what
      // the cell marks invalid, or the belt below would evaluate it anyway.
      if (text !== '' && !isAmount(text, { expressions: false })) {
        // The InputsForm/BracketsEditor sentence, in this box's own vocabulary.
        setError(`${label} must be a number`)
        return
      }
      // The CANONICAL value: a tolerant entry arrives here exactly as typed, and
      // Number('1,205.50') is NaN — which is neither < 0 nor > 100, so it would pass this
      // range unremarked and the belt below would then ship 12.0550. Everything left
      // converts exactly, and an absurd 400-digit one that overflows to Infinity is caught
      // by the range, not waved through by a finiteness test.
      const value = Number(canonicalAmount(text, { expressions: false }))
      if (value < 0 || value > 100) {
        // NOT the server's "espp_pct must be between 0 and 1": that sentence is in the
        // STORED fraction's vocabulary, and this box is labelled "ESPP %" and holds 11 for
        // 11%. Quoting it would call a perfectly good 11 out of range and wave a 0.5
        // (half a percent) through.
        setError(`${label} must be between 0 and 100`)
        return
      }
    }
    setBusy(true)
    setError(null)
    // Blank is a real ZERO here, not "leave it alone": every box was prefilled from a row,
    // so clearing one is a decision. (It also cannot be omitted — the paycheck router
    // reads an explicit null as a no-op, so a blank that meant "stop contributing" would
    // silently keep contributing.)
    // Canonical BEFORE the shift, and with the box's own { expressions: false }: shiftPoint
    // hands back anything that is not already a plain decimal, so a no-blur "$13" would
    // travel as "$13" and 422 on the far side.
    const pct = (field: PctField) =>
      shiftPoint(canonicalAmount(form[field].trim() || '0', { expressions: false }), -2)
    // The FULL profile on both verbs (Task 4 review M6's BINDING): the router validates
    // the MERGED row, so a delta PATCH would 422 on a stored field this form never
    // touched. `notes` is the one column whose null really clears.
    const body: PaycheckProfileCreate = {
      effective_date: form.effective_date,
      // The wire belt: blur usually canonicalized already, but a submit reached without one
      // must not ship "$150,000" to a Decimal column. Money kind, so the default applies.
      annual_salary: canonicalAmount(salary),
      pay_periods_per_year: periods,
      trad_401k_pct: pct('trad_401k_pct'),
      roth_401k_pct: pct('roth_401k_pct'),
      after_tax_401k_pct: pct('after_tax_401k_pct'),
      espp_pct: pct('espp_pct'),
      withholding_pct: pct('withholding_pct'),
      // The '0' default stays OUTSIDE the belt, so a blank box is still a real zero rather
      // than an empty string canonicalized to one.
      dental_vision_per_check: canonicalAmount(form.dental_vision_per_check.trim() || '0'),
      hsa_per_check: canonicalAmount(form.hsa_per_check.trim() || '0'),
      // No belt: a select cannot hold anything outside the union (setCoverage refuses it),
      // and the column is NOT NULL with a server default, so it travels on both verbs like
      // every other stored column.
      hsa_coverage: form.hsa_coverage,
      notes: form.notes.trim() || null,
      // Create only, and only for an explicitly-picked person: an absent person_id resolves
      // to the primary server-side (spec §4.1), so the default create is byte-identical to
      // the pre-batch one. A PATCH omits it because the stored row already knows whose it
      // is — sending it would let a mis-click reassign someone's comp history.
      ...(editingId === null && personId !== null ? { person_id: personId } : {}),
    }
    const request = editingId !== null ? updateProfile(editingId, body) : createProfile(body)
    request
      .then((echo) => {
        // The next entry starts here — the sheet's row-to-row rhythm (spec §5.1).
        // BEFORE the reseed, and that order is load-bearing: this form carries no
        // data-entry-scope, so Enter is the browser's implicit submit and the caret is
        // still sitting in an AmountInput when this lands. Moving it BLURS that box
        // synchronously, and the blur's commit closes over the box's PRE-reset text —
        // canonicalizing a "$150,000" into an enqueued write. Focusing first aims that
        // write at the state the full-object reseed below then replaces; the other order
        // lets it land on the reseeded form, where a resurrected salary would read as
        // carry-forward and be indistinguishable from one. One shape across all five
        // panels (EsppPage/CompPage/RsuGrantsPanel), so the order cannot drift here.
        // getElementById is the house DOM protocol (like data-entry-scope), so AmountInput
        // keeps its no-ref API; the target is a plain <input type="date">, so focusing it
        // runs no React handler of its own.
        document.getElementById('paycheck-effective-date')?.focus()
        // Back to "new profile", seeded from whichever row is newest NOW — the stored list
        // with the echo standing in for its own row (a create is not in it yet, so it is
        // appended). Comparing the echo against the OLD `latest` instead would reseed from
        // a row that no longer exists as it was: moving the latest profile's date BACKWARD
        // makes some other row the newest, and the form would carry the moved row's salary
        // forward anyway (review M3). Editing a historical row still leaves the real latest
        // in place, which is the case the comparison was written for.
        stopEditing(latestOf([...profiles.filter((p) => p.id !== echo.id), echo]))
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Save failed')))
      .finally(() => setBusy(false))
  }

  const remove = (profile: PaycheckProfileOut) => {
    if (!window.confirm(`Delete the profile effective ${formatDate(profile.effective_date)}?`)) {
      return
    }
    setBusy(true)
    // Cleared on entry like submit's: a delete that succeeds must not leave the previous
    // save's 409 sitting over the panel as if it still described the table.
    setError(null)
    deleteProfile(profile.id)
      .then(() => {
        // The edited row is gone — a stale editingId would PATCH a 404 on the next save
        // (Task 14 review I3). Reset on SUCCESS only, and re-seed from what is left.
        if (profile.id === editingId) {
          stopEditing(latestOf(profiles.filter((p) => p.id !== profile.id)))
        }
        onChanged(profile.id)
      })
      .catch((err: unknown) => setError(message(err, 'Delete failed')))
      .finally(() => setBusy(false))
  }

  return (
    <section className="card">
      <h2 className="eyebrow">
        Profile history
        <InfoHint text="One profile per comp change; the breakdown uses the profile in force today unless a row is pinned." />
      </h2>
      <p className="drill-hint">
        One row per comp change, newest first. A new profile starts as a copy of the current
        one — change what moved and give it the date it takes effect on. Percentages are
        entered as percents (13 = 13%) and stored as fractions with nine decimal places;
        withholding is a tax rather than a contribution, so it is not part of the 100% check.
      </p>
      {/* A save that failed, not a feed that is behind: the bare alert, with no stale cue
          and nothing to retry — the form itself is the retry. */}
      <FeedBanner error={error} />
      <form
        className="paycheck-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label>
          Effective date
          <input
            // The form's first entry field, so the save-success path can hand the caret
            // back to it by id (spec §5.1's focus-return).
            id="paycheck-effective-date"
            className="field-input"
            type="date"
            value={form.effective_date}
            onChange={(e) => set('effective_date')(e.target.value)}
          />
        </label>
        {/* The figure boxes are AmountInputs: select-all on focus, canonical on blur, a
            formatted echo while blurred (the percents echo "13%", the money boxes
            "$188,930.00"). No data-entry-scope on this form — it is one profile, so Enter
            stays the browser's own implicit submit. */}
        <label>
          Annual salary
          <AmountInput value={form.annual_salary} onValueChange={set('annual_salary')} />
        </label>
        <label>
          Pay periods per year
          <input
            className="field-input"
            inputMode="numeric"
            value={form.pay_periods_per_year}
            onChange={(e) => set('pay_periods_per_year')(e.target.value)}
          />
        </label>
        {PCT_FIELDS.map(({ field, label }) => (
          <label key={field}>
            {label}
            {/* State stays HUMAN-scale ("13" = 13%); the shift to the stored fraction
                happens at the wire, in submit's `pct`. */}
            <AmountInput kind="percent" value={form[field]} onValueChange={set(field)} />
          </label>
        ))}
        <label>
          Dental &amp; vision
          <AmountInput
            value={form.dental_vision_per_check}
            onValueChange={set('dental_vision_per_check')}
          />
        </label>
        <label>
          HSA
          <AmountInput value={form.hsa_per_check} onValueChange={set('hsa_per_check')} />
        </label>
        <label>
          HSA coverage
          {/* A tier, not a figure: the three stored values are the whole domain, so this is
              a select and there is nothing to validate at submit. */}
          <select
            className="field-input"
            value={form.hsa_coverage}
            onChange={(e) => setCoverage(e.target.value)}
          >
            {HSA_COVERAGES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          Notes
          <input
            className="field-input"
            value={form.notes}
            onChange={(e) => set('notes')(e.target.value)}
          />
        </label>
        <div className="paycheck-form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {editingId !== null ? 'Save profile' : 'Add profile'}
          </button>
          {editingId !== null && (
            <button
              type="button"
              className="button"
              aria-label="Cancel the profile edit"
              onClick={() => stopEditing(latest)}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      {profiles.length > 0 && (
        <div className="paycheck-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Effective</th>
                <th className="num">Salary</th>
                <th className="num">Periods</th>
                <th className="num">Traditional</th>
                <th className="num">Roth</th>
                <th className="num">After-tax</th>
                <th className="num">ESPP</th>
                <th className="num">Withholding</th>
                <th className="num">Dental &amp; vision</th>
                <th className="num">HSA</th>
                <th>HSA coverage</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr
                  key={profile.id}
                  className={profile.id === editingId ? 'is-editing' : undefined}
                >
                  <td>
                    {/* The date cell IS the selector: pressing it moves the waterfall
                        above to this profile. `shownId` comes from the breakdown payload,
                        so the server's own default is what lights up on arrival. */}
                    <button
                      type="button"
                      className={profile.id === shownId ? 'chip active' : 'chip'}
                      aria-pressed={profile.id === shownId}
                      aria-label={`Show the breakdown for ${formatDate(profile.effective_date)}`}
                      onClick={() => onSelect(profile.id)}
                    >
                      {formatDate(profile.effective_date)}
                    </button>
                  </td>
                  <td className="num">{formatCurrency(profile.annual_salary)}</td>
                  <td className="num">{profile.pay_periods_per_year}</td>
                  <td className="num">{formatPct(profile.trad_401k_pct, { signed: false })}</td>
                  <td className="num">{formatPct(profile.roth_401k_pct, { signed: false })}</td>
                  <td className="num">
                    {formatPct(profile.after_tax_401k_pct, { signed: false })}
                  </td>
                  <td className="num">{formatPct(profile.espp_pct, { signed: false })}</td>
                  <td className="num">
                    {formatPct(profile.withholding_pct, { signed: false })}
                  </td>
                  <td className="num">{formatCurrency(profile.dental_vision_per_check)}</td>
                  <td className="num">{formatCurrency(profile.hsa_per_check)}</td>
                  {/* The stored tier in the plan's words. The map is total over the union,
                      so the `??` only ever answers a payload from a newer server. */}
                  <td>{COVERAGE_LABELS.get(profile.hsa_coverage) ?? profile.hsa_coverage}</td>
                  {/* The cell ellipsises a long note (PaycheckPage.css), so the full text
                      is the hover title — `undefined`, never null, or React would render a
                      literal title="null" on every unnoted row. */}
                  <td className="paycheck-notes-cell" title={profile.notes ?? undefined}>
                    {profile.notes ?? '—'}
                  </td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="button"
                      aria-label={`Edit the profile effective ${formatDate(
                        profile.effective_date,
                      )}`}
                      onClick={() => startEdit(profile)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button"
                      aria-label={`Delete the profile effective ${formatDate(
                        profile.effective_date,
                      )}`}
                      disabled={busy}
                      onClick={() => remove(profile)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* A SIBLING of the scroller, not a child of it: twelve columns overflow the strip,
          and a control parked at the end of a horizontally scrolled one is a control the
          user has to go looking for sideways. It belongs to the table as a whole. */}
      {profiles.length > 0 && pinnedId !== null && (
        <button
          type="button"
          className="button paycheck-current"
          aria-label="Show the current profile"
          onClick={onShowCurrent}
        >
          Show the current profile
        </button>
      )}
    </section>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────────────────

// Per-profile, per-person snapshot key. null profile = whichever profile the server picks
// for today; null person = the primary — and the primary's key keeps its ORIGINAL,
// unsuffixed shape. A changed key would silently cold-start every first paint on this page
// for the single-earner household this app has had until now (2026-08-27 spec §1).
function breakdownKey(profileId: number | null, personId: number | null): string {
  const base = `paycheck:breakdown:${profileId ?? 'current'}`
  return personId === null ? base : `${base}:person:${personId}`
}

export default function PaycheckPage() {
  // The scope row's person chip IS this page's person picker (spec §6), so the URL — not a
  // piece of page state — is where the pick lives.
  const { scope } = useScope({ owner: true })

  const [profiles, setProfiles] = useState<PaycheckProfileOut[] | null>(
    () => getSnapshot<PaycheckProfileOut[]>('paycheck:profiles') ?? null,
  )
  // Both *Error slots hold an `errorDetail` DETAIL, not a sentence: the page composes one
  // banner from them below, and the breakdown's 404 prose keeps the server's own words
  // (2026-09-05 motion spec §9).
  const [profilesError, setProfilesError] = useState<string | null>(null)
  const [profilesBusy, setProfilesBusy] = useState(true)

  const cachedBreakdown = getSnapshot<PaycheckBreakdownOut>(breakdownKey(null, null))
  const [breakdown, setBreakdown] = useState<PaycheckBreakdownOut | null>(
    cachedBreakdown ?? null,
  )
  // The check the page is actually SHOWING. The revalidation skip below is judged against
  // this, never against the snapshot cache: render and cache diverge across person
  // switches (a partner 404 nulls the render while the cache stays warm; a warm partner
  // key belongs to a different person than the one on screen), and skipping on the cache
  // stranded the page there (2026-08-28 bug).
  const shownBreakdown = useRef<PaycheckBreakdownOut | null>(cachedBreakdown ?? null)
  // ...kept in step with the render by an effect, never written by hand: the person adopt
  // runs DURING render (where a ref write would survive a discarded render), and a peeked
  // paint that left the ref behind made the identical live payload look like a change —
  // re-arming the count-up and the flow's entrance on a switch back to a person already
  // seen. A ref write in an effect body is not state, so react-hooks 7 does not apply.
  useEffect(() => {
    shownBreakdown.current = breakdown
  }, [breakdown])
  // false once a revalidation actually CHANGES the data — the flow may animate again.
  const [fromCache, setFromCache] = useState(cachedBreakdown !== undefined)
  const [breakdownError, setBreakdownError] = useState<string | null>(null)
  // The 404 branch is not a failure to recover from — it is "there is nothing to model
  // yet", so it gets its own flag rather than the error banner: an empty seed has no
  // profile to break down, and the answer on screen is the form below, not a Retry.
  const [breakdownMissing, setBreakdownMissing] = useState(false)
  const [breakdownBusy, setBreakdownBusy] = useState(true)
  // An OBJECT, not a bare id: a fresh identity re-runs the load effect, so a write can
  // refetch the SAME waterfall (TaxesPage's `selection`). BOTH axes use null for "the
  // default" — null profile = whichever profile is in force, null person = the primary,
  // sent as no query param at all. That one convention is what keeps the single-earner
  // request, snapshot key and create body byte-identical to the pre-batch page.
  const [selection, setSelection] = useState<{
    profileId: number | null
    personId: number | null
  }>({ profileId: null, personId: null })
  // The chips' source. Fetched on its own, never folded into either load above: the
  // switcher is an affordance, and a household hiccup must not cost the waterfall
  // (NetWorthPage's isolated-fetch posture). null covers both "not loaded" and "failed".
  // Seeded from the row's OWN snapshot key so the page and the scope row agree on the first
  // paint: without it the chips could be up (ScopeBar paints from the snapshot) while the
  // page still believed there was nobody to switch between, and a chip press would do
  // nothing until this fetch answered.
  const [household, setHousehold] = useState<HouseholdOut | null>(
    () => getSnapshot<HouseholdOut>(HOUSEHOLD_SNAPSHOT) ?? null,
  )
  // One in-force breakdown per person, fetched on its OWN so a partner failure costs the
  // tile and nothing else. Deliberately NOT derived from the waterfall above: that one
  // follows the chips and any pinned row, while this figure is always "the profile in
  // force for each person" (spec §5). Only people who answered are in here.
  const [householdNets, setHouseholdNets] = useState<
    { name: string; monthlyNet: string }[] | null
  >(null)
  // Bumped by a profile write — a new profile can change whose profile is in force.
  const [householdNonce, setHouseholdNonce] = useState(0)
  // Apply from the Try it card (2026-09-03 planning-sandboxes spec §9): the seed pre-fills the
  // profile form by REMOUNTING the panel with it (the nonce rides its key) — an explicit user
  // action, so replacing a half-typed row is the asked-for outcome, and no effect ever
  // setStates to do it. The form's own Add profile stays the only write.
  //
  // `forKey` is the profile panel's key AT THE MOMENT OF THE CLICK. The panel remounts for
  // reasons of its own — a person chip, the household landing and flipping `switchable` —
  // and a seed with no owner attached would be handed to whichever form mounted next: one
  // person's scenario pre-filling another person's new-profile row, scrolled and focused as
  // if they had asked for it (review I1).
  const [applySeed, setApplySeed] = useState<{
    seed: ApplySeed
    nonce: number
    forKey: string
  } | null>(null)

  // Two INDEPENDENT loads: a breakdown 404 must not blank the profile table, so each
  // carries its own sequence guard, its own banner and its own busy flag.
  const profilesSeq = useRef(0)
  const breakdownSeq = useRef(0)
  const householdSeq = useRef(0)

  // Primary first, then everyone else by id — the order NetWorthPage's owner chips use, so
  // a person sits in the same place on both pages. The `?? []` lives INSIDE the memo: a
  // fresh literal in the dep list would re-sort on every render.
  const orderedPeople = useMemo(
    () =>
      [...(household?.people ?? [])].sort(
        (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.id - b.id,
      ),
    [household],
  )
  // One earner means there is nothing to switch between: no chips, no household tile, no
  // person param, no filtered history — the page is the pre-batch one, pinned by test.
  const switchable = orderedPeople.length > 1
  // The person the page is ABOUT: the chip's pick, or the primary when nothing is picked.
  // Only ever compared against a row's person_id — the WIRE still gets selection.personId,
  // which stays null for the primary.
  const activePersonId = selection.personId ?? orderedPeople[0]?.id ?? null

  // Promise callbacks only — no setState in an effect's synchronous body (react-hooks 7).
  // The mount fetches are covered by the initial busy values; the handlers below flip them.
  const loadProfiles = () => {
    const seq = ++profilesSeq.current
    fetchProfiles()
      .then((data) => {
        if (seq !== profilesSeq.current) return
        const previous = getSnapshot<PaycheckProfileOut[]>('paycheck:profiles')
        setSnapshot('paycheck:profiles', data)
        setProfilesError(null)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(data)) return
        setProfiles(data)
      })
      .catch((err: unknown) => {
        if (seq !== profilesSeq.current) return
        // The previous payload is KEPT: a failed reload here describes the same profiles,
        // and dropping them would also destroy a half-typed row in the panel's form
        // (EsppPage's same-entity rule). The banner appends the stale cue only when a
        // table is actually still on screen.
        setProfilesError(errorDetail(err))
      })
      .finally(() => {
        if (seq === profilesSeq.current) setProfilesBusy(false)
      })
  }

  useEffect(() => {
    loadProfiles()
  }, [])

  // Once per visit, and deliberately not part of `loadProfiles`: setState lives in the
  // promise continuations, never in the effect's synchronous body (react-hooks 7).
  useEffect(() => {
    fetchHousehold()
      .then(setHousehold)
      .catch(() => {
        /* keep whatever the snapshot had, as ScopeBar does: the switcher is an affordance,
           and a household hiccup must not cost the waterfall */
      })
  }, [])

  // Two GETs on a two-person household, once per household load (and once per write), and
  // no requests at all for one person: the price of a figure that cannot drift with a chip
  // press. Sequence-guarded like the page's other two loads, because a save landing while
  // these are in flight would otherwise let the older pair overwrite the newer.
  useEffect(() => {
    if (orderedPeople.length < 2) return
    const seq = ++householdSeq.current
    Promise.all(
      orderedPeople.map((person, index) =>
        // Index 0 is the primary, whose param is omitted — the wire's back-compat default.
        fetchBreakdown(undefined, index === 0 ? undefined : person.id)
          .then((data) => ({ name: person.name, monthlyNet: data.monthly_net }))
          // A person with no profile in force 404s; a partner-side outage 5xxs. Both mean
          // "no figure for them", which is what keeps the tile absent rather than half a
          // household presented as a whole one (spec §6).
          .catch(() => null),
      ),
    ).then((legs) => {
      if (seq !== householdSeq.current) return
      setHouseholdNets(
        legs.filter((leg): leg is { name: string; monthlyNet: string } => leg !== null),
      )
    })
  }, [orderedPeople, householdNonce])

  // The chain lives inline rather than in a useCallback: this component owns nine setters,
  // and manual memoization React Compiler cannot preserve drops the whole component out of
  // compilation (MonthlyUpdatePage's note).
  useEffect(() => {
    const seq = ++breakdownSeq.current
    fetchBreakdown(selection.profileId ?? undefined, selection.personId ?? undefined)
      .then((data) => {
        if (seq !== breakdownSeq.current) return
        const key = breakdownKey(selection.profileId, selection.personId)
        setSnapshot(key, data)
        setBreakdownError(null)
        setBreakdownMissing(false)
        // Identical payload: nothing re-renders, the flow stays still (spec §1) — judged
        // against the RENDERED check, never the snapshot cache (see shownBreakdown).
        // A person switch that peeked a warm key IS skipped here, because the mirror
        // effect above has already moved the ref onto the peeked check: the flow and the
        // count-up stay still on a switch back to a person already seen.
        if (
          shownBreakdown.current !== null &&
          JSON.stringify(shownBreakdown.current) === JSON.stringify(data)
        )
          return
        setFromCache(false)
        setBreakdown(data)
      })
      .catch((err: unknown) => {
        if (seq !== breakdownSeq.current) return
        const missing = err instanceof ApiError && err.status === 404
        // A 404 is the one failure that DROPS the payload: the profile behind it is gone
        // (or there never was one), so there is nothing left for the waterfall to be about.
        // Anything else keeps it — the panel names its own profile, so a stale waterfall
        // under the cue below still says whose it is.
        if (missing) setBreakdown(null)
        setBreakdownMissing(missing)
        setBreakdownError(errorDetail(err))
      })
      .finally(() => {
        if (seq === breakdownSeq.current) setBreakdownBusy(false)
      })
  }, [selection])

  // "We are fetching" flips live in the handlers that cause a fetch, never in the effect.
  const reloadProfiles = () => {
    setProfilesBusy(true)
    setProfilesError(null)
    loadProfiles()
  }

  /**
   * Point the waterfall somewhere and start a load for it. `next` is handed the selection
   * as it is AT THE MOMENT React applies it, never as it was when this was called — the
   * only caller that can be stale is the one that runs from a write's promise, and a row
   * pressed while that write was in flight must not be undone by it (review M1).
   *
   * Always a fresh object, so the load effect re-runs even when the id is unchanged.
   */
  const reselectWith = (next: (current: number | null) => number | null) => {
    setBreakdownBusy(true)
    setBreakdownError(null)
    // Cleared TOGETHER with the error it is a flavour of: the empty state renders
    // `breakdownError` as prose, so leaving `missing` up with the error gone would print a
    // literal "null — add one below…" for the whole of the next load (EsppPage's note).
    setBreakdownMissing(false)
    // The person is CARRIED, never reset: this helper re-points the profile axis only
    // (a row press, a delete's fallback, a write's refetch), and dropping the chip's pick
    // here would silently walk the page back to the primary after every save.
    setSelection((current) => ({
      profileId: next(current.profileId),
      personId: current.personId,
    }))
  }

  const reselect = (profileId: number | null) => reselectWith(() => profileId)

  const selectProfile = (id: number) => {
    // Re-pressing the row that is already shown must not refetch (MonthlyUpdatePage's
    // same-month lesson: the identity would change and the panel would blink).
    if (id === selection.profileId) return
    reselect(id)
  }

  const showCurrent = () => {
    if (selection.profileId === null) return
    reselect(null)
  }

  /**
   * Move the whole page to a person. `null` is the primary — no param on the wire.
   *
   * The pinned profile is DROPPED: it belongs to the person being left, and asking for one
   * person's profile id under another's scope is either a 404 or, worse, someone else's
   * check under this person's name. The switch always lands on "whichever profile is in
   * force for them", which is the same place the page opens on.
   *
   * RENDER-SAFE: its only caller is the adopt block below, which runs during render, so
   * this is state setters and nothing else — `shownBreakdown` is mirrored from `breakdown`
   * by an effect, never written here (a ref written mid-render survives a discarded one).
   * The adopt block also owns the "already there" check, so there is no guard here to go
   * stale against a closure.
   */
  const selectPerson = (personId: number | null) => {
    setBreakdownBusy(true)
    setBreakdownError(null)
    setBreakdownMissing(false)
    // Already-seen person: paint their in-force check instantly and revalidate underneath
    // (the sibling pages' handler-side seed — Overview's showFlowYear, Calendar's
    // showMonth). A cold key keeps the old check dimmed under the busy flag, as before.
    const peeked = getSnapshot<PaycheckBreakdownOut>(breakdownKey(null, personId))
    if (peeked !== undefined) {
      setFromCache(true)
      setBreakdown(peeked)
    }
    // An applied scenario belongs to the person it was modelled for; leaving them drops it
    // (the same reason the pinned profile is dropped just above). The key check at the mount
    // below is the fence — this only keeps a parked seed from coming back on a switch home.
    setApplySeed(null)
    setSelection({ profileId: null, personId })
  }

  // The chip's pick arrives through the URL, so it is adopted DURING render — state setters
  // only, no effect (the CategoriesPanel idiom; a setState in an effect body is react-hooks 7).
  // null / joint / an unknown id all mean the primary, exactly what `selection.personId ===
  // null` has always meant on the wire, so a stale link or a remembered `joint` from another
  // page lands on the person this page has always opened with rather than on nothing.
  const primaryId = orderedPeople[0]?.id ?? null
  const wantedPersonId: number | null =
    !switchable ||
    typeof scope.owner !== 'number' ||
    scope.owner === primaryId ||
    !orderedPeople.some((p) => p.id === scope.owner)
      ? null
      : scope.owner
  if (wantedPersonId !== selection.personId) selectPerson(wantedPersonId)

  // The history table follows the chips — client-side, because the router answers with one
  // ordered list for every person (spec §4.1), so a chip press costs the table nothing.
  // UNFILTERED whenever there is nobody to switch between, which includes a FAILED
  // household fetch: with no person to filter by, an empty table would be a lie, and
  // today's whole list is the honest degradation (spec §6).
  const shownProfiles = useMemo(
    () =>
      profiles === null || !switchable
        ? (profiles ?? [])
        : profiles.filter((p) => p.person_id === activePersonId),
    [profiles, switchable, activePersonId],
  )

  // The profile panel's identity: the chip's pick, and whether the list is scoped yet (see
  // the mount below). An Apply seed is only ever handed to the panel it was applied FROM.
  const profilesKey = `${selection.personId ?? 'primary'}:${switchable ? 'scoped' : 'unscoped'}`
  const seedForPanel = applySeed?.forKey === profilesKey ? applySeed : null

  // The ONE place this page adds money up, and only because there is no server figure for
  // it in this batch. Legal here where the waterfall's lines are not (rule 9): each leg is
  // an AUTHORITATIVE per-person `monthly_net`, not a display-rounded view of a longer
  // chain. Two 2dp figures added in float and re-rounded to cents (spendingSankey's
  // `cents` idiom), so the tile can never print a float artefact.
  const householdTotal =
    householdNets === null
      ? null
      : Math.round(householdNets.reduce((acc, leg) => acc + Number(leg.monthlyNet), 0) * 100) /
        100

  // A profile write moves BOTH halves of the page: the list, and the waterfall (a deleted
  // profile takes its own breakdown with it, so the selection falls back to the server's
  // default rather than 404ing on an id that no longer exists).
  const onProfilesChanged = (deletedId?: number) => {
    reloadProfiles()
    // Decided on the CURRENT selection, not on the one this callback closed over when the
    // save was submitted: a row pressed DURING the write is the user's latest word, and
    // reading `selection.profileId` here would quietly revert it when the promise resolved.
    reselectWith((current) =>
      deletedId !== undefined && deletedId === current ? null : current,
    )
    // The tile's legs are the profiles IN FORCE, and this write may have changed which
    // those are (a new row dated today displaces the current one). A nonce rather than a
    // direct call: the effect above owns the sequence guard.
    setHouseholdNonce((n) => n + 1)
  }

  // ONE banner for the page's two parallel loads (spec §9), with ONE Retry for whichever
  // parts failed: the user asked for the page, not for a feed.
  const loadBanner = describeLoadFailures([
    // A 404 is not recoverable here: the empty state carries it, and a Retry over "add a profile"
    // answers the wrong question.
    {
      noun: 'the breakdown',
      detail: breakdownMissing ? null : breakdownError,
      stale: breakdown !== null,
    },
    { noun: 'the profiles', detail: profilesError, stale: profiles !== null },
  ])
  const retryFailedLoads = () => {
    if (!breakdownMissing && breakdownError !== null) reselect(selection.profileId)
    if (profilesError !== null) reloadProfiles()
  }

  return (
    <div className="page paycheck-page">
      <PageFrame
        title="Paycheck"
        // No All and no Joint: a paycheck belongs to ONE person (spec §6), and the chip that
        // used to live in `.paycheck-person-row` is this row now.
        scopeRow={<ScopeBar owner={{ joint: false, all: false }} />}
        // Nothing is loaded page-wide: the two feeds below own their own lifecycles, so the
        // frame is only the title row and the scope row — plus the cached-paint flag, which
        // every ChartCard under it reads to render still (spec §1).
        resource={{ status: 'ready', fromCache }}
      >
        <FeedBanner error={loadBanner} retry={retryFailedLoads} />

        {/* TWO OR MORE answers or nothing: one person's net is not a household take-home, and
            printing it as one would be a half-truth (spec §6). It sits OUTSIDE the per-check
            card on purpose — it is not part of any one person's waterfall, and it does not
            follow the chips. */}
        {householdNets !== null && householdNets.length > 1 && (
          <section className="paycheck-household">
            <div className="kpi-row kpi-row-lone">
              <StatTile
                label="Household take-home"
                value={formatCurrency(householdTotal)}
                hint="The monthly net of the profile IN FORCE for each person, added together. It ignores the chip and any pinned row — it is always the whole household — and a person with no profile in force is not counted. Each person has their own profile timeline. The waterfall, the flow and the history below all follow the chip; the household figure does not — it is always both of you."
              />
            </div>
            <p className="drill-hint">
              {householdNets.map((leg) => leg.name).join(' + ')} — the profile in force for
              each person.
            </p>
          </section>
        )}

        {/* A 404 is not a failure to recover from — it is "there is nothing to model yet", so
            it travels as the feed's EMPTY state rather than its error: the answer on screen is
            the form below, not a Retry. */}
        <Feed
          data={breakdownMissing ? null : breakdown}
          busy={breakdownBusy && !breakdownMissing}
          staleNoun="this breakdown"
          skeleton={{ height: FEED_SKELETON.paycheckBreakdown, label: 'Loading the breakdown…' }}
          empty={
            breakdownMissing ? (
              <section className="card">
                <h2 className="eyebrow">Per-check breakdown</h2>
                {/* The server's sentence, plus where to go next — and the two 404s mean
                    different things: "no paycheck profiles" is an empty database, while
                    "paycheck profile not found" is a pinned row that has since been deleted,
                    and telling THAT user to add a profile would be answering the wrong
                    question. */}
                <p className="empty-note">
                  {/* Judged on the FILTERED list: the person on screen may have no rows while
                      another person does, and "choose a profile below" beside an empty table
                      answers the wrong question (2026-08-28 bug report). */}
                  {shownProfiles.length > 0
                    ? `${breakdownError} — choose a profile below.`
                    : `${breakdownError} — add one below to see the waterfall.`}
                </p>
              </section>
            ) : undefined
          }
        >
          {(data) => (
            <>
              <BreakdownPanel data={data} still={fromCache} />
              {/* Pace strip (2026-08-27 spec §5): the SAME payload as the waterfall above, so
                  the rows can never describe a different profile than the check they sit
                  under — including whichever person the chips picked. */}
              <PacePanel items={data.pace} />
              {/* Same payload, same busy dim: the flow can never show a different check than
                  the table above it. */}
              <FlowPanel data={data} />
              {/* The sandbox (2026-09-03 planning-sandboxes spec §9), under the flow: it models
                  the check ABOVE it, so it takes the same payload and the same two selectors
                  GET /breakdown was asked with. Nothing it does writes. */}
              <TryItPanel
                profileId={selection.profileId}
                personId={selection.personId}
                breakdown={data}
                onApply={(seed) =>
                  setApplySeed((current) => ({
                    seed,
                    nonce: (current?.nonce ?? 0) + 1,
                    forKey: profilesKey,
                  }))
                }
              />
            </>
          )}
        </Feed>

        <Feed
          data={profiles}
          busy={profilesBusy}
          staleNoun="the table"
          skeleton={{ height: 240, label: 'Loading profiles…' }}
        >
          {/* The render prop's argument is only proof that `profiles` is non-null: the table
              draws `shownProfiles`, the memo that scopes the one ordered list to the chip. */}
          {() => (
            /* Keyed by the CHIP's pick, and by whether the list is scoped yet. Switching
               person must re-seed the carry-forward form from THAT person's latest row — a
               half-typed row surviving the switch would be filed under the wrong person on
               the next save. It reads `selection.personId` rather than the resolved
               `activePersonId` so the primary's key is constant across a breakdown refetch
               (the pre-batch behaviour: typed work survives). The `switchable` half is the
               2026-09-03 fix: the profiles usually land BEFORE the household, so the panel
               first mounts on the UNFILTERED list and seeds its form from whoever's row is
               newest overall — the partner's, in production. Remounting once when the
               household resolves re-seeds from the primary's own latest row; the only
               typing that can be lost is whatever landed in that first instant. */
            <ProfilesPanel
              key={`${profilesKey}:${seedForPanel?.nonce ?? 0}`}
              profiles={shownProfiles}
              personId={selection.personId}
              shownId={breakdown?.profile.id ?? null}
              pinnedId={selection.profileId}
              onSelect={selectProfile}
              onShowCurrent={showCurrent}
              onChanged={onProfilesChanged}
              initialForm={seedForPanel?.seed}
            />
          )}
        </Feed>
      </PageFrame>
    </div>
  )
}
