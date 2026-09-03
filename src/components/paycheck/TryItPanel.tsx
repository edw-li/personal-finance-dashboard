import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { previewPaycheck } from '../../api/paycheck'
import CompareTable, { type CompareRow } from '../../sandbox/CompareTable'
import { compareDecimals } from '../../sandbox/decimal'
import PresetRow from '../../sandbox/PresetRow'
import SandboxPanel from '../../sandbox/SandboxPanel'
import { readEntries, toWireDecimal } from '../../sandbox/scenarioUrl'
import SliderBox from '../../sandbox/SliderBox'
import { SEP, useSandbox, type PinResult, type SandboxSpec } from '../../sandbox/useSandbox'
import type {
  HsaCoverage,
  PaycheckBreakdownOut,
  PaycheckPreviewLines,
  PaycheckPreviewOut,
} from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency, formatDate } from '../../utils/format'
import { currentMonthIso } from '../../utils/months'
import AmountInput from '../AmountInput'
import Segmented from '../shell/Segmented'
import PacePanel from './PacePanel'
import {
  ESPP_MAX_PCT,
  HSA_TIERS,
  KNOB_MAX,
  MAX_PAY_PERIODS,
  MIN_PAY_PERIODS,
  acceptKnob,
  applySeedFor,
  decodePaycheck,
  encodePaycheck,
  isEmptyPaycheck,
  labelForPaycheck,
  paycheckPresets,
  toOverrides,
  type ApplySeed,
  type PaycheckKnob,
  type PaycheckScenario,
} from './paycheckScenario'
import './pace.css'

// The Paycheck "Try it" card (2026-09-03 planning-sandboxes spec §9). The scenario lives in
// the URL (`whatif=<knob>:<wire value>`); every figure on screen is the server's — the
// preview endpoint returns baseline, scenario and delta at three cadences, and the pace
// strip re-renders from `pace.scenario`. Apply never posts: it hands the PAGE a pre-filled
// profile form, and the form's own Add profile is the only write.
const UNITS = [
  { value: 'per_check', label: 'Per check' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
] as const
type Unit = (typeof UNITS)[number]['value']

// Withholding and the dental/vision deduction are COSTS: a rise reads red.
const ROWS: CompareRow[] = [
  { key: 'gross', label: 'Gross', kind: 'money' },
  { key: 'trad_401k', label: 'Traditional 401(k)', kind: 'money' },
  { key: 'dental_vision', label: 'Dental & vision', kind: 'money', invert: true },
  { key: 'hsa', label: 'HSA', kind: 'money' },
  { key: 'taxable', label: 'Taxable', kind: 'money' },
  { key: 'withholding', label: 'Withholding', kind: 'money', invert: true },
  { key: 'post_tax', label: 'Post-tax', kind: 'money' },
  { key: 'roth_401k', label: 'Roth 401(k)', kind: 'money' },
  { key: 'after_tax_401k', label: 'After-tax 401(k)', kind: 'money' },
  { key: 'espp', label: 'ESPP', kind: 'money' },
  { key: 'net_pay', label: 'Net pay', kind: 'money' },
  { key: 'savings', label: 'Payroll savings', kind: 'money' },
]

const COVERAGE_OPTIONS: { value: HsaCoverage; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'self', label: 'Self only' },
  { value: 'family', label: 'Family' },
]

/** Every knob but the coverage tier: a decimal the URL can carry, so one `knob` handler and
 *  one "equals actual" comparison covers all of them. */
type NumericKnob = Exclude<PaycheckKnob, 'hsa_coverage'>

/**
 * The wire spelling of a box's or slider's canonical text, or null when the codec would
 * refuse it.
 *
 * SliderBox and BoxKnob canonicalize with `canonicalAmount`, which is deliberately tolerant
 * and IDEMPOTENT: "200000." and "+15" come back verbatim rather than normalized. Writing
 * either into the URL would put an entry there that `decodePaycheck` drops on the very next
 * render — the knob would snap back to "actual" with nothing said. `toWireDecimal` is the
 * grammar's own normalizer for exactly those spellings (SliderBox runs it too, since the
 * unsigned form is also what `decimal.ts` can compare without throwing); this adds the
 * PER-KNOB fence on top, and anything it still refuses is not written at all.
 */
function wireOf(key: NumericKnob, raw: string): string | null {
  const text = toWireDecimal(raw)
  return text !== null && acceptKnob(key, text) ? text : null
}

export default function TryItPanel({
  profileId,
  personId,
  breakdown,
  onApply,
}: {
  /** The page's two selectors — exactly what GET /breakdown was asked with. */
  profileId: number | null
  personId: number | null
  /** The check on screen: its profile is the base, its pace rows carry the limits. */
  breakdown: PaycheckBreakdownOut
  /** Apply: the page pre-fills its profile form with this seed. */
  onApply: (seed: ApplySeed) => void
}) {
  const [params] = useSearchParams()
  // Arriving with entries opens the panel (spec §6); otherwise closed by default (§8.1).
  const entriesKey = readEntries(params).join(SEP)
  const [open, setOpen] = useState(entriesKey !== '')
  // ...and so does a navigation INTO a scenario link while the page is already mounted —
  // the assistant's deep links and the Portfolio drill-in are exactly that (spec §6, §12).
  // Adjusted DURING render, never from an effect body (the house rule): React re-renders
  // immediately, so nothing paints closed.
  //
  // The latch is the ENTRIES, not merely whether there are any: "arriving with entries opens
  // the panel and runs" is about the scenario, so a SECOND link — the assistant's next
  // answer — is a second arrival and opens the card again. A card the user closed by hand
  // still stays closed while the URL sits on the entries it was closed on; only a different
  // scenario re-opens it. Every key the sandbox does not own (owner, month) is absent from
  // this key, so switching one of those cannot re-open anything.
  const [arrivedAt, setArrivedAt] = useState(entriesKey)
  if (entriesKey !== arrivedAt) {
    setArrivedAt(entriesKey)
    if (entriesKey !== '') setOpen(true)
  }
  const [unit, setUnit] = useState<Unit>('per_check')
  const profile = breakdown.profile

  const spec = useMemo<SandboxSpec<PaycheckScenario, PaycheckPreviewOut>>(
    () => ({
      page: 'paycheck',
      decode: decodePaycheck,
      encode: encodePaycheck,
      isEmpty: isEmptyPaycheck,
      preview: (scenario) =>
        previewPaycheck({ profile_id: profileId, person_id: personId, overrides: toOverrides(scenario) }),
      baselineOf: (result) => result,
      // A pinned row, an owner switch or a write that changes the profile in force all
      // re-run the pins against the check now on screen.
      dataKey: `${profileId ?? 'current'}:${personId ?? 'primary'}:${profile.id}`,
      enabled: open,
      labelFor: labelForPaycheck,
    }),
    [profileId, personId, profile.id, open],
  )
  const sandbox = useSandbox(spec)
  const { scenario, result } = sandbox

  /** The profile's own figure for a knob — the baseline every control resets to. */
  const actualFor = (key: NumericKnob): string =>
    key === 'pay_periods_per_year' ? String(profile.pay_periods_per_year) : profile[key]

  const knob = (key: NumericKnob) => (next: string, commit: boolean) => {
    const wire = next === '' ? '' : wireOf(key, next)
    // A spelling the codec would drop is not written: the URL never learns a value it
    // refuses, and the control keeps whatever it is showing.
    if (wire === null) return
    // ONE meaning for "actual" across every control (the coverage toggle's rule, promoted):
    // a value back ON the profile's own figure DELETES the entry rather than restating it,
    // so `?whatif=` carries only what differs and the badge reads "derived" again. Numeric,
    // not textual — "0.13" and "0.130000000" are the same knob position.
    const drop = wire === '' || compareDecimals(wire, actualFor(key)) === 0
    sandbox.set(
      (current) => {
        const draft = { ...current }
        if (drop) delete draft[key]
        else draft[key] = wire
        return draft
      },
      { immediate: commit },
    )
  }

  // The scenario's own salary/periods/coverage size the presets; limits come from the pace
  // rows already in the payload — the scenario's first (its coverage may differ), then the
  // check's own. null → the chip is disabled with a sentence naming what to enter.
  const limitFor = (key: string): string | null => {
    for (const rows of [result?.pace.scenario, result?.pace.baseline, breakdown.pace]) {
      const row = rows?.find((r) => r.key === key)
      if (row !== undefined && row.limit !== null) return row.limit
    }
    return null
  }
  const coverage = (scenario.hsa_coverage as HsaCoverage | undefined) ?? profile.hsa_coverage
  const presets = paycheckPresets(
    {
      salary: scenario.annual_salary ?? profile.annual_salary,
      periods: Number(scenario.pay_periods_per_year ?? profile.pay_periods_per_year),
      coverage,
      esppPct: scenario.espp_pct ?? profile.espp_pct,
      limitFor,
    },
    (patch) => sandbox.set(patch, { immediate: true }),
  )

  const block = result === null ? null : result[unit]
  const pinSide = (r: PinResult<PaycheckPreviewOut>): PinResult<PaycheckPreviewLines> =>
    r === 'pending' || 'error' in r ? r : r[unit].scenario
  const nextMonth = applySeedFor(profile, scenario, currentMonthIso()).effective_date

  return (
    <SandboxPanel
      eyebrow={`Try it — effective ${formatDate(profile.effective_date)}`}
      hint="Move a percentage or an amount and see the check the server computes for it, against the profile shown above — nothing is saved."
      open={open}
      onToggle={() => setOpen((o) => !o)}
      sandbox={sandbox}
      closedHint={
        <p className="drill-hint">
          Try a different 401(k) percentage, HSA amount or withholding rate without writing a
          profile — nothing is saved until you choose to save it as one.
        </p>
      }
      presets={<PresetRow presets={presets} />}
      staleNoun="this scenario"
      skeletonHeight={220}
      compare={
        block !== null && result !== null ? (
          <>
            <Segmented
              variant="toggle"
              size="sm"
              ariaLabel="Compare unit"
              options={UNITS}
              value={unit}
              onChange={setUnit}
            />
            <CompareTable<PaycheckPreviewLines>
              rows={ROWS}
              baseline={block.baseline}
              scenario={block.scenario}
              valueOf={(side, key) => side[key as keyof PaycheckPreviewLines]}
              delta={(key) => block.delta[key as keyof PaycheckPreviewLines]}
              pins={sandbox.pins.map((pin) => ({ id: pin.id, label: pin.label, result: pinSide(sandbox.pinResults[pin.id]) }))}
              onUnpin={sandbox.unpin}
            />
            {/* The engine's advisory sentences, in the waterfall's own shape — the rule lives
                in PaycheckPage.css, which the one page that mounts this card always loads. */}
            {result.warnings.length > 0 && (
              <div className="paycheck-warnings">
                {result.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}
            {!sandbox.empty && <PacePanel items={result.pace.scenario} />}
          </>
        ) : null
      }
      apply={
        <button
          type="button"
          className="button button-primary"
          onClick={() => onApply(applySeedFor(profile, scenario, currentMonthIso()))}
        >
          Save as profile effective {formatDate(nextMonth)}…
        </button>
      }
    >
      {/* Every ceiling is KNOB_MAX's — the same number the presets clamp to, so a chip can
          never park a thumb off its own track. */}
      <SliderBox id="tryit-trad" label="Traditional 401(k)" kind="percent" value={scenario.trad_401k_pct ?? ''} actual={profile.trad_401k_pct} min="0" max={KNOB_MAX.trad_401k_pct} step="0.005" onChange={knob('trad_401k_pct')} />
      <SliderBox id="tryit-roth" label="Roth 401(k)" kind="percent" value={scenario.roth_401k_pct ?? ''} actual={profile.roth_401k_pct} min="0" max={KNOB_MAX.roth_401k_pct} step="0.005" onChange={knob('roth_401k_pct')} />
      <SliderBox id="tryit-after" label="After-tax 401(k)" kind="percent" value={scenario.after_tax_401k_pct ?? ''} actual={profile.after_tax_401k_pct} min="0" max={KNOB_MAX.after_tax_401k_pct} step="0.005" onChange={knob('after_tax_401k_pct')} />
      <SliderBox id="tryit-espp" label="ESPP" kind="percent" hint="Capped at 15% — the §423 ceiling." value={scenario.espp_pct ?? ''} actual={profile.espp_pct} min="0" max={ESPP_MAX_PCT} step="0.005" onChange={knob('espp_pct')} />
      <SliderBox id="tryit-hsa" label="HSA per check" kind="money" value={scenario.hsa_per_check ?? ''} actual={profile.hsa_per_check} min="0" max={KNOB_MAX.hsa_per_check} step="5" onChange={knob('hsa_per_check')} />
      <div className="slider-box">
        <div className="slider-box-head">
          <span>HSA coverage</span>
        </div>
        <Segmented
          variant="toggle"
          size="sm"
          ariaLabel="HSA coverage"
          options={COVERAGE_OPTIONS}
          value={coverage}
          onChange={(value) =>
            sandbox.set(
              (current) => {
                const draft = { ...current }
                // Back on the stored tier is "not a knob any more", not a knob that agrees
                // with the profile: the URL carries only what DIFFERS from the actual check.
                if (value === profile.hsa_coverage) delete draft.hsa_coverage
                else draft.hsa_coverage = value
                return draft
              },
              { immediate: true },
            )
          }
        />
      </div>
      <SliderBox
        id="tryit-withholding"
        label="Withholding"
        kind="percent"
        hint="The profile's one all-in rate — express a W-4 change here. The Taxes page's withholding card names the per-check remedy."
        value={scenario.withholding_pct ?? ''}
        actual={profile.withholding_pct}
        min="0"
        max={KNOB_MAX.withholding_pct}
        step="0.001"
        onChange={knob('withholding_pct')}
      />
      {/* Both boxes validate through the CODEC's own fence, never a looser Number() test:
          "200000.", "+200000" and ".5" all pass Number() but are refused on arrival, and a
          box that accepted one of them would revert to actual without a word. */}
      <BoxKnob
        id="tryit-salary"
        label="Annual salary"
        kind="money"
        value={scenario.annual_salary ?? ''}
        actual={profile.annual_salary}
        validate={(text) =>
          acceptKnob('annual_salary', text)
            ? null
            : 'Annual salary must be a plain positive amount, like 200000'
        }
        onCommit={knob('annual_salary')}
      />
      <BoxKnob
        id="tryit-periods"
        label="Pay periods per year"
        kind="plain"
        value={scenario.pay_periods_per_year ?? ''}
        actual={String(profile.pay_periods_per_year)}
        validate={(text) =>
          acceptKnob('pay_periods_per_year', text)
            ? null
            : `pay_periods_per_year must be a whole number between ${MIN_PAY_PERIODS} and ${MAX_PAY_PERIODS}`
        }
        onCommit={knob('pay_periods_per_year')}
      />
      <p className="drill-hint">
        Dental &amp; vision flows through unchanged. Percentages are of gross;{' '}
        <Link to="/taxes">the Taxes withholding card</Link> says what a rate change does to the
        year. Coverage tiers: {HSA_TIERS.join(' · ')}.
      </p>
    </SandboxPanel>
  )
}

/** A box-only knob (salary, periods): commits on blur/Enter, the router's fences in the
 *  box's own words, a caption that resets to actual. Money boxes canonicalize ("$200,000" →
 *  "200000") the way the profile form does; the typed text is control-local. */
function BoxKnob({
  id,
  label,
  kind,
  value,
  actual,
  validate,
  onCommit,
}: {
  id: string
  label: string
  kind: 'money' | 'plain'
  value: string
  actual: string
  validate: (canonical: string) => string | null
  onCommit: (next: string, commit: boolean) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const text = draft.trim()
    setDraft(null)
    if (text === '') {
      setError(null)
      onCommit('', true)
      return
    }
    if (!isAmount(text, { expressions: false })) {
      setError(`${label} must be a number`)
      return
    }
    const canonical = canonicalAmount(text, { expressions: false })
    const problem = validate(canonical)
    if (problem !== null) {
      setError(problem)
      return
    }
    setError(null)
    onCommit(canonical, true)
  }
  return (
    <div className="slider-box">
      <div className="slider-box-head">
        <label htmlFor={id}>{label}</label>
        {value === '' && <span className="sandbox-badge">actual</span>}
      </div>
      {/* The wrapper hears the box's blur/Enter; AmountInput's own commit has not reached
          state yet, so `draft` is the TYPED text — which this canonicalizes itself. */}
      <div
        className="slider-box-row"
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
      >
        <AmountInput
          id={id}
          kind={kind}
          aria-label={label}
          aria-describedby={error !== null ? `${id}-error` : undefined}
          value={draft ?? value}
          placeholder={actual}
          onValueChange={setDraft}
        />
        <button
          type="button"
          className="slider-box-actual"
          onClick={() => {
            setError(null)
            onCommit('', true)
          }}
        >
          actual {kind === 'money' ? formatCurrency(actual) : actual}
        </button>
      </div>
      {error !== null && (
        <p id={`${id}-error`} className="sandbox-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
