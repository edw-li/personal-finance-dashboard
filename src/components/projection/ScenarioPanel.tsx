import { useState } from 'react'
import { Link } from 'react-router-dom'
import CompareTable from '../../sandbox/CompareTable'
import SandboxPanel from '../../sandbox/SandboxPanel'
import { MONTH_TOKEN } from '../../sandbox/scenarioUrl'
import SliderBox from '../../sandbox/SliderBox'
import { SEP, type Sandbox } from '../../sandbox/useSandbox'
import type { PersonOut, ProjectionOut } from '../../types/api'
import { formatCurrency, formatMonth } from '../../utils/format'
import { FeedBanner } from '../shell/Feed'
import {
  COMPARE_ROWS,
  KNOBS,
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
  swr: 'Withdrawal rate',
  volatility: 'Volatility',
  years: 'Horizon (years)',
}

const HINTS: Partial<Record<ProjectionKnob, string>> = {
  monthly_contribution:
    'Derived from the months that have BOTH spending and net pay entered: (net pay − living spend − tax paid) plus every earner\'s payroll deductions — 401(k), ESPP and HSA. RSU vests are not included; raise it to model them.',
  annual_spend:
    'Derived from living spend over that same window, × 12. Tax payments and transfers to your own accounts are not living spend, so neither is in this figure.',
  swr: 'Derived from Settings. The FI target is annual spend ÷ this rate.',
  volatility: 'Turns the fan on; 0 turns it off.',
  inflation: 'Converts the chart to today\'s dollars; 0 reads nominal dollars.',
  contribution_growth: 'Models raises: the contribution escalates at this rate.',
}

// Render order: the five derived-from-data knobs, then the three assumptions.
const ORDER: ProjectionKnob[] = ['annual_return', 'monthly_contribution', 'annual_spend', 'swr', 'years', 'volatility', 'inflation', 'contribution_growth']

// A knob added to the codec cannot silently vanish from the card.
if (ORDER.length !== KNOBS.length) throw new Error('ScenarioPanel: ORDER must list every knob')

export default function ScenarioPanel({
  sandbox,
  baseline,
  people,
}: {
  sandbox: Sandbox<ProjectionScenario, ProjectionOut>
  /** The empty run — every knob's derived value. */
  baseline: ProjectionOut | null
  people: PersonOut[]
}) {
  const [open, setOpen] = useState(true)
  const [monthError, setMonthError] = useState<string | null>(null)
  // The month boxes' own transient text. A browser WITHOUT a month picker renders
  // type="month" as a plain text field and hands over one character at a time, so a
  // URL-controlled box validated per keystroke is untypeable: "2", "20", "203" would each
  // be refused and wiped. The draft holds the half-typed month; blur and Enter commit it.
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const derived = derivedOf(baseline)
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

  return (
    <SandboxPanel
      eyebrow="Scenario"
      hint="Every knob the projection runs on. Blank knobs are derived from your data (or their planning defaults) and re-derive on their own — nothing is saved."
      open={open}
      onToggle={() => setOpen((o) => !o)}
      toggleLabels={{ open: 'Show knobs', close: 'Hide knobs' }}
      sandbox={sandbox}
      resetLabel="Reset to derived"
      staleNoun="this projection"
      skeletonHeight={220}
      compare={
        <CompareTable<ProjectionOut>
          rows={COMPARE_ROWS}
          baseline={baseline}
          scenario={sandbox.result}
          valueOf={projectionValue}
          pins={sandbox.pins.map((pin) => ({ id: pin.id, label: pin.label, result: sandbox.pinResults[pin.id] }))}
          onUnpin={sandbox.unpin}
          caption="Headline figures — baseline (derived) against the live scenario and any pins"
        />
      }
    >
      {ORDER.map((key) => {
        const slider = (
          <SliderBox
            key={key}
            id={`scenario-${key}`}
            label={LABELS[key]}
            hint={HINTS[key]}
            kind={SLIDER[key].kind}
            value={scenario.knobs[key] ?? ''}
            actual={derived[key]}
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
        const windowed = key === 'monthly_contribution' || key === 'annual_spend'
        const showsBreakdown = key === 'monthly_contribution' && breakdown !== null
        if (!showsBreakdown && !(windowed && derivedWindow !== null)) return slider
        return (
          <div key={key} className="slider-box">
            {slider}
            {key === 'monthly_contribution' && breakdown !== null && (
              <span className="projection-derived">
                derived: {formatCurrency(breakdown.cash)} cash savings +{' '}
                {formatCurrency(breakdown.payroll)} payroll deductions
                {breakdown.by_person.length > 0 &&
                  ` (${breakdown.by_person.map((row) => `${row.name} ${formatCurrency(row.monthly)}`).join(' · ')})`}
              </span>
            )}
            {windowed && derivedWindow !== null && (
              <span className="projection-derived">
                over {formatMonth(derivedWindow.from)} – {formatMonth(derivedWindow.to)} (
                {derivedWindow.months} {derivedWindow.months === 1 ? 'month' : 'months'})
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
      {people.length > 0 && (
        // Named only where the boxes are: a roster-less database has no retirement to explain.
        <p className="drill-hint">
          A retirement month drops that person&apos;s CURRENT monthly take-home and payroll
          deductions — the paycheck profile in force today, not a projection of it — out of the
          contribution stream from that month on; whatever is left keeps escalating at the
          contribution-growth rate, so a far-off retirement&apos;s cost is slightly understated,
          since the drop never gets that person&apos;s share of the modelled raises. Spending stays
          a household figure, so the FI target does not move. Blank means that person works for the
          whole horizon.
        </p>
      )}
      <p className="drill-hint">
        Percents are percents (5 = 5%). The Monte Carlo seed is fixed, so scenarios are seed-stable:
        identical knobs redraw identical bands, and two scenarios differ only by their knobs, never
        by sampling noise. The withdrawal rate&apos;s stored value lives in{' '}
        <Link to="/settings">Settings</Link>.
      </p>
    </SandboxPanel>
  )
}
