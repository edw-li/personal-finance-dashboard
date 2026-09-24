import { useState } from 'react'
import { Link } from 'react-router-dom'
import InfoHint from '../InfoHint'
import CompareTable from '../../sandbox/CompareTable'
import { compareDecimals } from '../../sandbox/decimal'
import SandboxPanel from '../../sandbox/SandboxPanel'
import { MONTH_TOKEN } from '../../sandbox/scenarioUrl'
import SliderBox from '../../sandbox/SliderBox'
import { SEP, type Sandbox } from '../../sandbox/useSandbox'
import type { PersonOut, ProjectionOut, VestsOut } from '../../types/api'
import { windowWords } from '../overview/ytd'
import { formatCurrency, formatCurrencyCompact, formatMonth, formatPct } from '../../utils/format'
import { FeedBanner } from '../shell/Feed'
import {
  COMPARE_ROWS,
  KNOBS,
  PLAN_UNTIL_MAX,
  PLAN_UNTIL_MIN,
  PLAN_UNTIL_TOKEN,
  SLIDER,
  derivedOf,
  projectionValue,
  type ProjectionKnob,
  type ProjectionScenario,
} from './projectionScenario'

// The knobs card (2026-09-03 planning-sandboxes spec §11): open by default — on this page the
// knobs ARE the page. Blank means derived: an unset knob sits on the echo's value, wears the
// "derived" badge and shows the echo as its caption; a typed one shows its delta against the
// echo. Reset to derived is the sandbox's reset. No Apply: nothing here is stored — the
// withdrawal rate lives in Settings.
const LABELS: Record<ProjectionKnob, string> = {
  annual_return: 'Annual return',
  annual_spend: 'Annual spend',
  contribution_growth: 'Contribution growth',
  inflation: 'Inflation',
  monthly_contribution: 'Monthly contribution',
  plan_until: 'Plan until',
  swr: 'Withdrawal rate',
  vests: 'Include scheduled vests',
  volatility: 'Volatility',
  years: 'Horizon (years)',
}

const HINTS: Partial<Record<ProjectionKnob, string>> = {
  monthly_contribution:
    'Derived from the months that have BOTH spending and net pay entered: (net pay − living spend − tax paid) plus every earner\'s payroll deductions — 401(k), ESPP and HSA — and their employer 401(k) match. Scheduled RSU vests are added separately (Include scheduled vests).',
  annual_spend:
    'Derived from living spend over that same window, × 12. Tax payments and transfers to your own accounts are not living spend, so neither is in this figure. When budgets exist, "Use my budgets" sets this to twelve times the living-category budgets in force this month. After everyone with a paycheck has retired, this is also what the projection withdraws each year.',
  plan_until:
    'The year the money has to last through. Later years lengthen the horizon. Set a lasting default in Settings › Plan assumptions.',
  swr: 'Derived from Settings. The FI target is annual spend ÷ this rate.',
  volatility: 'Turns the fan on; 0 turns it off.',
  inflation: 'Annual price inflation used in the model. The chart dollar switch changes display units without changing this assumption.',
  contribution_growth: 'Models raises: the contribution escalates at this rate.',
}

// Render order: the derived-from-data knobs (vests beside the contribution they add to, the
// plan-until year beside the horizon it can lengthen), then the three assumptions.
const ORDER: ProjectionKnob[] = ['annual_return', 'monthly_contribution', 'vests', 'annual_spend', 'swr', 'years', 'plan_until', 'volatility', 'inflation', 'contribution_growth']

// A knob added to the codec cannot silently vanish from the card.
if (ORDER.length !== KNOBS.length) throw new Error('ScenarioPanel: ORDER must list every knob')

export default function ScenarioPanel({
  sandbox,
  baseline,
  people,
  compact = false,
}: {
  sandbox: Sandbox<ProjectionScenario, ProjectionOut>
  /** The empty run — every knob's derived value. */
  baseline: ProjectionOut | null
  people: PersonOut[]
  compact?: boolean
}) {
  const [open, setOpen] = useState(true)
  const [monthError, setMonthError] = useState<string | null>(null)
  // The month boxes' own transient text. A browser WITHOUT a month picker renders
  // type="month" as a plain text field and hands over one character at a time, so a
  // URL-controlled box validated per keystroke is untypeable: "2", "20", "203" would each
  // be refused and wiped. The draft holds the half-typed month; blur and Enter commit it.
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  // The plan-until box's own half-typed text and refusal (the retire boxes' draft posture).
  const [planDraft, setPlanDraft] = useState<string | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const derived = derivedOf(baseline)
  // The plan-until year and the vests speak for the run ON SCREEN: the horizon default moves
  // with the Horizon knob, and the vests stop with a retirement month.
  const live = sandbox.result ?? baseline
  const vests = live?.vests ?? null
  const primary = people.find((person) => person.is_primary) ?? null
  const breakdown = baseline?.contribution_breakdown ?? null
  const { scenario } = sandbox

  // Reconciled to the URL during RENDER, never from an effect body (the house rule): when
  // the committed entries change — Reset to derived, a pasted link, the back button — the
  // drafts and whatever refusal they earned are stale by definition.
  const entriesKey = sandbox.entries.join(SEP)
  const [seen, setSeen] = useState(entriesKey)
  if (seen !== entriesKey) {
    setSeen(entriesKey)
    setDrafts({})
    setMonthError(null)
    setPlanDraft(null)
    setPlanError(null)
  }

  const knob = (key: ProjectionKnob) => (next: string, commit: boolean) =>
    sandbox.set(
      (current) => {
        const knobs = { ...current.knobs }
        if (next === '') delete knobs[key]
        else knobs[key] = next
        return { ...current, knobs }
      },
      { immediate: commit },
    )

  const commitRetire = (person: PersonOut, month: string) => {
    const text = month.trim()
    if (text !== '' && !MONTH_TOKEN.test(text)) {
      setMonthError(`${person.name}'s retirement month must look like YYYY-MM`)
      return
    }
    setMonthError(null)
    sandbox.set(
      (current) => {
        const retirements = { ...current.retirements }
        if (text === '') delete retirements[person.id]
        else retirements[person.id] = text
        return { ...current, retirements }
      },
      { immediate: true },
    )
  }

  const onRetireChange = (person: PersonOut, raw: string) => {
    setDrafts((current) => ({ ...current, [person.id]: raw }))
    setMonthError(null) // the sentence described what WAS in the box
    // A month picker (and a cleared box) hands over a complete answer in ONE event — commit
    // it at once, so choosing a month is still immediate. Anything partial is a keystroke
    // from a browser without a picker: hold it until blur or Enter.
    if (raw === '' || MONTH_TOKEN.test(raw)) commitRetire(person, raw)
  }

  const onRetireCommit = (person: PersonOut) => {
    const draft = drafts[person.id]
    if (draft !== undefined) commitRetire(person, draft)
  }

  // A year the URL can carry (the codec's 2000–2199 fence); the server answers the exact range
  // with its own 422 in the card's error slot (2026-09-23 spec §R3).
  const commitPlanUntil = () => {
    if (planDraft === null) return
    const text = planDraft.trim()
    const year = Number(text)
    if (text !== '' && !(PLAN_UNTIL_TOKEN.test(text) && year >= PLAN_UNTIL_MIN && year <= PLAN_UNTIL_MAX)) {
      setPlanError(`Plan until must be a year from ${PLAN_UNTIL_MIN} through ${PLAN_UNTIL_MAX}`)
      return
    }
    setPlanDraft(null)
    setPlanError(null)
    knob('plan_until')(text, true)
  }

  const planPlaceholder =
    live?.plan_until == null ? undefined : live.plan_until_source === 'setting' ? `${live.plan_until} (from Settings)` : String(live.plan_until)

  const vestsOn = scenario.knobs.vests === undefined ? (vests?.included ?? false) : scenario.knobs.vests !== '0'
  const vestsHint = vests === null ? '' : vestsHintText(vests, primary?.name ?? null)

  return (
    <SandboxPanel
      eyebrow="Planning assumptions"
      hint="Inputs from your records, Settings, or planning defaults. An edited input is a scenario override. Clearing it restores its baseline; your financial records stay unchanged."
      open={open}
      onToggle={() => setOpen((o) => !o)}
      toggleLabels={{ open: 'Show assumptions', close: 'Hide assumptions' }}
      sandbox={sandbox}
      resetLabel="Reset to baseline"
      staleNoun="this projection"
      skeletonHeight={220}
      hidePins={compact}
      compare={compact ? undefined :
        <CompareTable<ProjectionOut>
          rows={COMPARE_ROWS}
          baseline={baseline}
          scenario={sandbox.result}
          valueOf={projectionValue}
          pins={sandbox.pins.map((pin) => ({ id: pin.id, label: pin.label, result: sandbox.pinResults[pin.id] }))}
          onUnpin={sandbox.unpin}
          caption="Headline figures — baseline against the live scenario and any pins"
        />
      }
    >
      {ORDER.map((key) => {
        if (key === 'plan_until') {
          return (
            <div key={key} className="slider-box projection-plan-until">
              <div className="slider-box-head">
                <label htmlFor="scenario-plan_until">
                  {LABELS.plan_until}
                  <InfoHint text={HINTS.plan_until ?? ''} />
                </label>
                {scenario.knobs.plan_until === undefined && live?.plan_until != null && (
                  <span className="sandbox-badge">{live.plan_until_source === 'setting' ? 'Settings' : 'Horizon default'}</span>
                )}
              </div>
              <input
                id="scenario-plan_until"
                className="field-input"
                inputMode="numeric"
                aria-label={LABELS.plan_until}
                aria-describedby={planError !== null ? 'scenario-plan-until-error' : undefined}
                placeholder={planPlaceholder}
                value={planDraft ?? scenario.knobs.plan_until ?? ''}
                onChange={(e) => {
                  setPlanDraft(e.target.value)
                  setPlanError(null) // the sentence described what WAS in the box
                }}
                onBlur={commitPlanUntil}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault() // Enter inside a card must not implicit-submit
                  commitPlanUntil()
                }}
              />
              {planError !== null && (
                <p id="scenario-plan-until-error" className="sandbox-field-error" role="alert">
                  {planError}
                </p>
              )}
            </div>
          )
        }
        if (key === 'vests') {
          // Only when there are grants to include (the echo is null without them).
          if (vests === null) return null
          return (
            <div key={key} className="slider-box projection-vests">
              <div className="slider-box-head">
                {/* The ⓘ sits beside the words, as on every other knob, but outside the <label>:
                    a label would otherwise name the hint button too. */}
                <span className="projection-toggle-head">
                  <label htmlFor="scenario-vests" className="projection-toggle">
                    <input
                      id="scenario-vests"
                      type="checkbox"
                      checked={vestsOn}
                      disabled={vests.excluded_reason !== null}
                      // Checked is the default: drop the entry rather than spell `vests:1`.
                      onChange={(e) => knob('vests')(e.target.checked ? '' : '0', true)}
                    />
                    {LABELS.vests}
                  </label>
                  <InfoHint text={vestsHint} />
                </span>
              </div>
              <span className="projection-derived">
                {vests.excluded_reason ??
                  (vests.next_12_months === null
                    ? null
                    : `≈ ${formatCurrencyCompact(vests.next_12_months)} over the next 12 months, after withholding`)}
              </span>
            </div>
          )
        }
        const slider = (
          <SliderBox
            key={key}
            id={`scenario-${key}`}
            label={LABELS[key]}
            hint={HINTS[key]}
            kind={SLIDER[key].kind}
            value={scenario.knobs[key] ?? ''}
            actual={derived[key]}
            sourceLabel={key === 'annual_spend' || key === 'monthly_contribution' ? 'From your records' : key === 'swr' ? 'Settings' : 'Planning default'}
            baselineLabel="Baseline"
            min={SLIDER[key].min}
            max={SLIDER[key].max}
            step={SLIDER[key].step}
            onChange={knob(key)}
          />
        )
        // The echo's own arithmetic under the contribution knob, so a derived figure is
        // never a bare number the reader has to trust: cash savings + payroll deductions,
        // per person. Absent on a backend older than the breakdown, and whenever the
        // derived run computed the contribution from nothing.
        // The echo's own arithmetic under the contribution knob, and the WINDOW under both
        // figures the data derives (spec §3): a trailing mean is only honest beside the
        // months it averaged, and those months are no longer "the last 12" — they are the
        // last 12 that were entered AND paid. The window comes from the BASELINE echo, so it
        // keeps describing the derivation even while a typed knob overrides the value.
        const derivedWindow = baseline?.derived_window ?? null
        // 2026-09-07 budget-seed spec §4: the budgets' own annual figure as a preset beside
        // the derived one. Absent from an older backend and null without budgets, so the
        // button exists only when the echo carries a number.
        const budgetAnnual = key === 'annual_spend' ? (baseline?.budget_annual_spend ?? null) : null
        const budgetMonth = baseline?.budget_month ?? null
        const showsBudgets = budgetAnnual !== null
        // Compared as a DECIMAL, not as text: a hand-typed 61752 is the same annual spend as
        // the echo's 61752.00, and both spellings survive the URL, so a string test would
        // leave the preset offering a figure the knob already carries.
        const usingBudgets =
          budgetAnnual !== null &&
          scenario.knobs.annual_spend !== undefined &&
          compareDecimals(scenario.knobs.annual_spend, budgetAnnual) === 0
        const windowed = key === 'monthly_contribution' || key === 'annual_spend'
        const showsBreakdown = key === 'monthly_contribution' && breakdown !== null
        if (!showsBreakdown && !(windowed && derivedWindow !== null) && !showsBudgets) return slider
        return (
          <div key={key} className="slider-box">
            {slider}
            {key === 'monthly_contribution' && breakdown !== null && (
              <span className="projection-derived">
                From records: {formatCurrency(breakdown.cash)} cash savings +{' '}
                {formatCurrency(breakdown.payroll)} payroll deductions
                {Number(breakdown.employer) !== 0 &&
                  ` + ${formatCurrency(breakdown.employer)} employer match`}
                {' = '}
                {formatCurrency(breakdown.total)}
                {breakdown.by_person.length > 0 &&
                  ` (${breakdown.by_person
                    .map((row) =>
                      Number(row.employer_monthly) === 0
                        ? `${row.name} ${formatCurrency(row.monthly)}`
                        : `${row.name} ${formatCurrency(row.monthly)} + ${formatCurrency(row.employer_monthly)} match`,
                    )
                    .join(' · ')})`}
              </span>
            )}
            {windowed && derivedWindow !== null && (
              <span className="projection-derived">
                Records from {windowWords(derivedWindow)} ({derivedWindow.months}{' '}
                {derivedWindow.months === 1 ? 'month' : 'months'})
              </span>
            )}
            {budgetAnnual !== null && (
              // A flex row (ProjectionPage.css): the sentence is its own item and wraps as a unit
              // under the button when the column is narrow (audit P-8).
              <span className="projection-derived projection-derived-preset">
                <button
                  type="button"
                  className="button"
                  disabled={usingBudgets}
                  onClick={() => knob('annual_spend')(budgetAnnual, true)}
                >
                  {usingBudgets
                    ? 'using your budgets'
                    : `Use my budgets · ${formatCurrency(budgetAnnual)}/yr`}
                </button>
                {budgetMonth !== null && (
                  <span>12 × the living-category budgets resolved for {formatMonth(budgetMonth)}.</span>
                )}
              </span>
            )}
          </div>
        )
      })}
      {people.map((person) => (
        <div key={person.id} className="slider-box">
          <div className="slider-box-head">
            <label htmlFor={`scenario-retire-${person.id}`}>Retires — {person.name}</label>
            {scenario.retirements[person.id] === undefined && <span className="sandbox-badge">works throughout</span>}
          </div>
          <input
            id={`scenario-retire-${person.id}`}
            type="month"
            className="field-input"
            aria-describedby={monthError !== null ? 'scenario-retire-error' : undefined}
            value={drafts[person.id] ?? scenario.retirements[person.id] ?? ''}
            onChange={(e) => onRetireChange(person, e.target.value)}
            onBlur={() => onRetireCommit(person)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault() // Enter inside a card must not implicit-submit
              onRetireCommit(person)
            }}
          />
        </div>
      ))}
      <div id="scenario-retire-error">
        <FeedBanner error={monthError} />
      </div>
      {!compact && <ScenarioHints people={people} vests={vests} />}
    </SandboxPanel>
  )
}

/** What the vests toggle adds, from the echo: the quote, the calendar's sell-to-cover and the
 *  grant holder (2026-09-23 spec §R4). */
function vestsHintText(vests: VestsOut, primaryName: string | null): string {
  const price = vests.price === null ? 'the latest employer-stock quote' : `the latest employer-stock quote (${formatCurrency(vests.price)})`
  const stop = primaryName === null ? 'Vests stop at the grant holder\'s retirement.' : `Vests stop at ${primaryName}'s retirement.`
  return `Your granted, unvested RSUs, added in the month each vests at ${price} less about ${formatPct(vests.withholding_rate, { signed: false, decimals: 2 })} sell-to-cover withholding, in today's dollars. A vest already in your starting balance is not counted again. ${stop}`
}

/** The assumptions' fine print. ScenarioPanel renders it itself only when it stands alone; on the
 *  Projection page (`compact`) the PAGE renders it inside the compare card, so the knobs column
 *  ends at its last control and nothing has to be scrolled past to reach a knob (2026-09-13 polish
 *  spec §12, audit P-2). */
export function ScenarioHints({ people, vests = null }: { people: PersonOut[]; vests?: VestsOut | null }) {
  const primary = people.find((person) => person.is_primary) ?? null
  return (
    <>
      {people.length > 0 && (
        // Named only where the boxes are: a roster-less database has no retirement to explain.
        // The phases, in the user's rules (2026-09-23 spec §R2, §R7).
        <p className="drill-hint">
          Retirement months split the plan into phases. While one of you works, that person&apos;s
          401(k), HSA and ESPP deductions and employer match keep going, and their pay is assumed to
          cover your spending — the chart&apos;s notes say when it does not, and the difference is not
          withdrawn. From the last retirement on, the projection withdraws your annual spend each year
          in today&apos;s dollars. Taxes on withdrawals and Social Security are not modelled.
          {vests !== null && primary !== null && ` RSU vests stop at ${primary.name}'s retirement.`}
        </p>
      )}
      <p className="drill-hint">
        Enter 5 for 5%. Scenarios with the same Horizon (years) setting reuse the same random samples,
        so changes reflect your assumptions. Money inputs use today&apos;s dollars at the projection
        start date. The withdrawal rate&apos;s stored value lives in{' '}
        <Link to="/settings">Settings</Link>.
      </p>
    </>
  )
}
