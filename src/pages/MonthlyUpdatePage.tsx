import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarCheck, CalendarPlus } from 'lucide-react'
import { ApiError } from '../api/client'
import {
  fetchAccounts,
  fetchMonthBalances,
  fetchTimeseries,
  putMonthBalances,
} from '../api/netWorth'
import { fetchCategories, fetchSpendingMonth, putSpendingMonth } from '../api/spending'
import AmountInput from '../components/AmountInput'
import InfoHint from '../components/InfoHint'
import MonthRibbon from '../components/MonthRibbon'
import { GROUP_LABELS, GROUP_ORDER } from '../charts/theme'
import type { AccountOut, CategoryOut } from '../types/api'
import { nestComponents } from '../utils/accounts'
import { canonicalAmount, isAmount } from '../utils/amount'
import { formatCurrency, formatMonth, formatPct } from '../utils/format'
import { addMonths, currentMonthIso } from '../utils/months'
import '../components/panels.css'
import './MonthlyUpdatePage.css'

const STEPS = ['balances', 'spending', 'review'] as const
type Step = (typeof STEPS)[number]

// Terse chip labels — each step's card heading carries the full title ("Spending & net
// pay", "Review & save — Aug 2026"). The chips must NOT repeat a heading verbatim: the
// stepper renders on every step, so a duplicate makes "am I on the review step?" queries
// ambiguous (two matching nodes) and any assertion written against the chip vacuous.
const STEP_LABELS: Record<Step, string> = {
  balances: 'Balances',
  spending: 'Spending',
  review: 'Review',
}

function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
}

// ── Unsaved-work drafts ──────────────────────────────────────────────────────────────
// The wizard's two losses were (a) any navigation away mid-entry — no route guard exists
// under a plain <BrowserRouter> — and (b) the mid-save 401, whose redirect destroyed the
// spending half after the balances PUT had landed. A continuously written sessionStorage
// draft closes both: it survives the SPA route change AND the full-page login redirect,
// and is restored (with a visible note) the next time this month is opened. sessionStorage,
// not localStorage, on purpose: a draft is "this sitting", and a week-old one silently
// resurrecting over fresh server data would be worse than the loss it prevents.

interface WizardDraft {
  balances: Record<string, string>
  amounts: Record<string, string>
  netPay: string
  recordedOn: string
  notes: string
}

const DRAFT_PREFIX = 'finance-update-draft:'

function draftKey(month: string): string {
  return `${DRAFT_PREFIX}${month}`
}

// One serialized shape for three jobs — the dirty comparison, the stored draft, the
// restore. Numeric keys serialize in ascending order (the JS integer-key law), so the
// same values always yield the same string regardless of setState spread order.
function snapshotOf(
  balances: Record<number, string>,
  amounts: Record<number, string>,
  netPay: string,
  recordedOn: string,
  notes: string,
): string {
  return JSON.stringify({ balances, amounts, netPay, recordedOn, notes })
}

function readDraft(month: string): { raw: string; draft: WizardDraft } | null {
  const raw = sessionStorage.getItem(draftKey(month))
  if (raw === null) return null
  try {
    const draft = JSON.parse(raw) as WizardDraft
    // A shape check, not a validator: a corrupt entry is discarded, never restored.
    if (typeof draft !== 'object' || draft === null) return null
    return { raw, draft }
  } catch {
    return null
  }
}

export default function MonthlyUpdatePage() {
  const [params, setParams] = useSearchParams()
  const month = params.get('month') ?? currentMonthIso()
  const stepParam = params.get('step')
  const step: Step = STEPS.includes(stepParam as Step) ? (stepParam as Step) : 'balances'

  const [accounts, setAccounts] = useState<AccountOut[]>([])
  const [categories, setCategories] = useState<CategoryOut[]>([])
  const [balances, setBalances] = useState<Record<number, string>>({})
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [netPay, setNetPay] = useState('')
  const [recordedOn, setRecordedOn] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [prevNetWorth, setPrevNetWorth] = useState<number | null>(null)
  // The prior month's per-account balances — the table's "Last month" column and the
  // reference every live Δ is measured against. The prior fetch already ran for the seed
  // and prevNetWorth; this keeps its per-account detail instead of discarding it.
  const [priorBalances, setPriorBalances] = useState<Record<number, string>>({})
  const [monthExisted, setMonthExisted] = useState(false)
  const [coveredMonths, setCoveredMonths] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  // What the server seeded for the month on screen, serialized — the draft machinery's
  // reference point. Carries its OWN month so a mid-switch render can never write the old
  // month's values under the new month's key.
  const [baseline, setBaseline] = useState<{ month: string; data: string } | null>(null)
  // A draft was restored over the seed this load — the banner's flag.
  const [restored, setRestored] = useState(false)

  // Both keys are always written together, so the step never loses the month (and any
  // unrelated query param a deep link carried survives the copy).
  const setStep = (next: Step) =>
    setParams((current) => {
      const copy = new URLSearchParams(current)
      copy.set('month', month)
      copy.set('step', next)
      return copy
    })

  // Promise callbacks, no setState in the effect's synchronous body
  // (react-hooks/set-state-in-effect) — same discipline as the module pages. Those
  // pages park this chain in a useCallback because their Retry button is a second
  // caller; here the effect is the only caller, so the chain lives inline: a
  // useCallback with 13 setters in its body is manual memoization React Compiler
  // cannot preserve (react-hooks/preserve-manual-memoization errors, and the whole
  // component drops out of compilation). The loading/saved/error flips for a MONTH
  // CHANGE live in the ribbon's onSelect handler; the mount fetch is covered by the
  // initial state values.
  useEffect(() => {
    Promise.all([
      fetchAccounts(),
      fetchCategories(),
      fetchMonthBalances(month),
      fetchMonthBalances(addMonths(month, -1)),
      fetchSpendingMonth(month),
      fetchTimeseries(),
    ])
      .then(([accountList, categoryList, thisMonth, priorMonth, spendMonth, timeseries]) => {
        setError(null)
        setSaved(null)
        // Nested order: component inputs sit right after their aggregate's input
        // (the group filter below preserves it — components share the parent's group).
        const activeAccounts = nestComponents(accountList.filter((a) => a.is_active))
        setAccounts(activeAccounts)
        setCategories(categoryList.filter((c) => c.is_active))
        setMonthExisted(thisMonth.exists)
        setCoveredMonths(new Set(timeseries.months))

        // Pre-fill: the month's own values win; otherwise the prior month's (the sheet
        // ritual starts from last month's numbers); otherwise 0.00.
        const source = thisMonth.exists ? thisMonth.balances : priorMonth.balances
        const byId = new Map(source.map((b) => [b.account_id, b.balance]))
        const seededBalances = Object.fromEntries(
          activeAccounts.map((a) => [a.id, byId.get(a.id) ?? '0.00']),
        )
        // Reset on EVERY month load — stale notes/date must never leak into another
        // month's save (the next PUT would silently write them there).
        const seededRecordedOn =
          thisMonth.exists && thisMonth.recorded_on ? thisMonth.recorded_on : todayIso()
        const seededNotes = thisMonth.exists && thisMonth.notes ? thisMonth.notes : ''

        const prevSum = priorMonth.exists
          ? priorMonth.balances.reduce((acc, b) => {
              const account = accountList.find((a) => a.id === b.account_id)
              return account && !account.is_component ? acc + Number(b.balance) : acc
            }, 0)
          : null
        setPrevNetWorth(prevSum)
        setPriorBalances(
          priorMonth.exists
            ? Object.fromEntries(priorMonth.balances.map((b) => [b.account_id, b.balance]))
            : {},
        )

        const activeCategories = categoryList.filter((c) => c.is_active)
        const spendById = new Map(spendMonth.amounts.map((a) => [a.category_id, a.amount]))
        const seededAmounts = Object.fromEntries(
          activeCategories.map((c) => [c.id, spendById.get(c.id) ?? '0.00']),
        )
        const seededNetPay = spendMonth.net_pay ?? ''

        // A stored draft that differs from the seed is unsaved work — restore it over the
        // seed (per field, keyed by id, so an account added since the draft still seeds).
        // One that MATCHES the seed is a leftover with nothing to say and is dropped.
        const seedSnapshot = snapshotOf(
          seededBalances,
          seededAmounts,
          seededNetPay,
          seededRecordedOn,
          seededNotes,
        )
        const stored = readDraft(month)
        const draft = stored !== null && stored.raw !== seedSnapshot ? stored.draft : null
        if (stored !== null && draft === null) sessionStorage.removeItem(draftKey(month))
        setBalances(
          draft
            ? Object.fromEntries(
                activeAccounts.map((a) => [
                  a.id,
                  draft.balances?.[String(a.id)] ?? seededBalances[a.id],
                ]),
              )
            : seededBalances,
        )
        setAmounts(
          draft
            ? Object.fromEntries(
                activeCategories.map((c) => [
                  c.id,
                  draft.amounts?.[String(c.id)] ?? seededAmounts[c.id],
                ]),
              )
            : seededAmounts,
        )
        setNetPay(draft ? (draft.netPay ?? seededNetPay) : seededNetPay)
        setRecordedOn(draft ? (draft.recordedOn ?? seededRecordedOn) : seededRecordedOn)
        setNotes(draft ? (draft.notes ?? seededNotes) : seededNotes)
        setBaseline({ month, data: seedSnapshot })
        setRestored(draft !== null)
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load month data')
      })
      .finally(() => setLoading(false))
  }, [month])

  // Persist typed-but-unsaved work continuously: the draft is written on every edit and
  // deleted the moment the boxes match the seed again, so storage always mirrors "what
  // would be lost". Gated on the BASELINE's month (never the URL's) and on loading — a
  // mid-switch render still holds the old month's values under the new month's URL, and
  // this is what keeps them from being filed under the wrong key. No setState here, so
  // the effect-body rule has nothing to say.
  useEffect(() => {
    if (loading || baseline === null || baseline.month !== month) return
    const current = snapshotOf(balances, amounts, netPay, recordedOn, notes)
    if (current === baseline.data) {
      sessionStorage.removeItem(draftKey(baseline.month))
    } else {
      sessionStorage.setItem(draftKey(baseline.month), current)
    }
  }, [balances, amounts, netPay, recordedOn, notes, baseline, month, loading])

  // Back to the server's seed, forgetting the draft — the restore banner's exit.
  const discardDraft = () => {
    if (baseline === null || baseline.month !== month) return
    const seed = JSON.parse(baseline.data) as WizardDraft
    setBalances(seed.balances as Record<number, string>)
    setAmounts(seed.amounts as Record<number, string>)
    setNetPay(seed.netPay)
    setRecordedOn(seed.recordedOn)
    setNotes(seed.notes)
    setRestored(false)
    sessionStorage.removeItem(draftKey(month))
  }

  // Every wizard cell is an AmountInput of the default kind="money", so the page's
  // option-less isAmount/canonicalAmount (expressions ON) agree with what the component
  // accepts and commits. A non-money cell added here must switch BOTH sides to
  // { expressions: false }, or the page would green-light an "=" the box never evaluates.
  const balancesValid = accounts.every((a) => isAmount(balances[a.id] ?? ''))
  const amountsValid =
    categories.every((c) => isAmount(amounts[c.id] ?? '')) &&
    (netPay.trim() === '' || isAmount(netPay))

  // Sums the COMMITTED values, not the raw ones: a cell still holding "$1,600" or "=200+50"
  // (no blur yet — jsdom clicks and Ctrl+Enter never fire one) would read as NaN → 0 and
  // preview a wrong net worth for the number that is about to be saved.
  const preview = useMemo(() => {
    const netWorth = accounts.reduce(
      (acc, a) =>
        a.is_component ? acc : acc + (Number(canonicalAmount(balances[a.id] ?? '')) || 0),
      0,
    )
    const totalSpend = categories.reduce(
      (acc, c) => acc + (Number(canonicalAmount(amounts[c.id] ?? '')) || 0),
      0,
    )
    const pay = netPay.trim() === '' ? null : Number(canonicalAmount(netPay))
    return {
      netWorth,
      delta: prevNetWorth === null ? null : netWorth - prevNetWorth,
      totalSpend,
      savings: pay === null || pay === 0 ? null : (pay - totalSpend) / pay,
    }
  }, [accounts, balances, categories, amounts, netPay, prevNetWorth])

  const save = async () => {
    setSaving(true)
    setError(null)
    // canonicalAmount, not .trim(): a cell committed by blur is already canonical, but a save
    // reached without one (Ctrl+Enter, or a click in jsdom) must not ship "$1,600.00" or
    // "=200+50" to a Decimal column. Computed ONCE, then spent three ways — the wire, the
    // boxes and the baseline — which is what keeps those three from drifting apart below.
    // `?? ''` so a key missing from the record can never throw inside the payload builder.
    const canonBalances: Record<number, string> = Object.fromEntries(
      accounts.map((a) => [a.id, canonicalAmount(balances[a.id] ?? '')]),
    )
    const canonAmounts: Record<number, string> = Object.fromEntries(
      categories.map((c) => [c.id, canonicalAmount(amounts[c.id] ?? '')]),
    )
    const canonNetPay = netPay.trim() === '' ? '' : canonicalAmount(netPay)
    try {
      const balanceResult = await putMonthBalances(month, {
        recorded_on: recordedOn === '' ? undefined : recordedOn,
        // null (not undefined): blanking the field must CLEAR a previously saved note.
        notes: notes.trim() === '' ? null : notes,
        balances: accounts.map((a) => ({ account_id: a.id, balance: canonBalances[a.id] })),
      })
      const body: { net_pay?: string; amounts: { category_id: number; amount: string }[] } = {
        amounts: categories.map((c) => ({ category_id: c.id, amount: canonAmounts[c.id] })),
      }
      if (netPay.trim() !== '') body.net_pay = canonNetPay
      const spendResult = await putSpendingMonth(month, body)
      setSaved(
        `Balances: ${balanceResult.created} added, ${balanceResult.updated} changed, ` +
          `${balanceResult.unchanged} unchanged. Spending: ${spendResult.created} added, ` +
          `${spendResult.updated} changed, ${spendResult.unchanged} unchanged.`,
      )
      // What the wire received IS what the boxes now hold. Adopting the canonical values
      // into the STATE as well as the baseline is load-bearing: a cell advanced past by
      // clicks still held raw text ("9,000"), and a baseline taken from that raw state
      // would differ from the "9000" the next focus+blur commits — filing a draft for
      // fully saved work, so the following visit announced "Restored unsaved entries —
      // they are not saved yet" about nothing. Canonical on both sides makes that blur a
      // no-op, and the draft effect deletes the stored copy on the same render.
      setBalances(canonBalances)
      setAmounts(canonAmounts)
      setNetPay(canonNetPay)
      setBaseline({
        month,
        data: snapshotOf(canonBalances, canonAmounts, canonNetPay, recordedOn, notes),
      })
      setRestored(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Saving failed — nothing was lost, retry')
    } finally {
      setSaving(false)
    }
  }

  const stepIndex = STEPS.indexOf(step)

  // Month change refetches via the [month] dep — flip the fetch state here, in the
  // event handler, never in the effect (react-hooks/set-state-in-effect). Same-month
  // click: the [month] effect would never re-run, so an unconditional setLoading(true)
  // would blank the wizard forever.
  const selectMonth = (m: string) => {
    if (m === month) return
    setLoading(true)
    setError(null)
    setSaved(null)
    // The banner describes the month being LEFT; the new load re-derives it. The typed
    // work itself needs no goodbye — the draft effect has been persisting it all along.
    setRestored(false)
    setParams(() => new URLSearchParams({ month: m, step: 'balances' }))
  }

  // The ribbon anchors one month PAST the latest covered month once the current month
  // is filled: chips end at the anchor, so otherwise "add next month" is impossible
  // until the calendar rolls over (the sheet's next-empty-row affordance, ported).
  const current = currentMonthIso()
  const latestCovered = [...coveredMonths].sort().at(-1)
  const nextEntryMonth = latestCovered === undefined ? current : addMonths(latestCovered, 1)
  const anchor = nextEntryMonth > current ? nextEntryMonth : current

  // The first RENDERED cell (groups render in GROUP_ORDER, not array order).
  const firstBalanceId = GROUP_ORDER.flatMap((g) => accounts.filter((a) => a.group === g))[0]?.id

  // Committed value of one cell for the live columns — the preview memo's rule.
  const committed = (raw: string | undefined) => Number(canonicalAmount(raw ?? '')) || 0

  // Per-group live subtotal + its prior twin (components excluded, exactly like net worth).
  const groupTotals = (group: (typeof GROUP_ORDER)[number]) => {
    const rows = accounts.filter((a) => a.group === group && !a.is_component)
    const now = rows.reduce((acc, a) => acc + committed(balances[a.id]), 0)
    const prior = rows.reduce(
      (acc, a) => acc + (priorBalances[a.id] === undefined ? 0 : Number(priorBalances[a.id])),
      0,
    )
    return { now, prior }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>
          <CalendarCheck size={20} style={{ verticalAlign: '-3px', marginRight: '0.5rem' }} />
          Monthly update — {formatMonth(month)}
        </h1>
        <div className="spacer" />
        <MonthRibbon
          anchor={anchor}
          filledMonths={coveredMonths}
          selected={month}
          onSelect={selectMonth}
        />
        {!coveredMonths.has(anchor) && month !== anchor && (
          <button className="button" onClick={() => selectMonth(anchor)}>
            <CalendarPlus size={15} /> Start {formatMonth(anchor)}
          </button>
        )}
      </div>

      <div className="wizard-steps">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            className={`wizard-step${s === step ? ' active' : ''}`}
            onClick={() => setStep(s)}
          >
            <span className="step-index">{i + 1}</span>
            {STEP_LABELS[s]}
          </button>
        ))}
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {restored && (
        // Advisory, not an error: nothing failed — work was preserved. The discard button
        // is the only way to decline it; saving is the way to accept it.
        <div className="draft-note" role="status">
          <span>
            Restored unsaved entries for {formatMonth(month)} — they are not saved yet.
          </span>
          <button type="button" className="button" onClick={discardDraft}>
            Discard restored entries
          </button>
        </div>
      )}
      {saved && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 className="eyebrow">Month saved</h2>
          <p>{saved}</p>
          <p>
            <Link to="/net-worth">See net worth</Link> · <Link to="/spending">See spending</Link>
          </p>
        </div>
      )}

      {!loading && step === 'balances' && (
        <div className="card" data-entry-scope="">
          <h2 className="eyebrow">
            {monthExisted ? 'Edit balances' : 'Enter balances (pre-filled from last month)'}
            <InfoHint text="Every account&apos;s balance for the month, pre-filled from the prior month; components are tracked inside their parent." />
          </h2>
          <div className="meta-row">
            <label>
              Recorded on
              <input
                type="date"
                className="field-input"
                value={recordedOn}
                onChange={(e) => setRecordedOn(e.target.value)}
              />
            </label>
            <label>
              Notes
              <input
                type="text"
                className="field-input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="optional"
              />
            </label>
          </div>
          {/* One table, not a card per group: cells sit in a single visual column so the
              Phase 1 Enter/arrow protocol (DOM order = this GROUP_ORDER walk) goes straight
              down, the way the sheet's muscle memory expects (spec §4.2). */}
          <table className="data-table entry-table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="num entry-ref">Last month</th>
                <th className="num">This month</th>
                <th className="num entry-delta">Δ</th>
              </tr>
            </thead>
            <tbody>
              {GROUP_ORDER.map((group) => {
                const groupAccounts = accounts.filter((a) => a.group === group)
                if (groupAccounts.length === 0) return null
                const totals = groupTotals(group)
                return (
                  <Fragment key={group}>
                    <tr className="entry-group-row">
                      <th colSpan={4}>{GROUP_LABELS[group]}</th>
                    </tr>
                    {groupAccounts.map((account) => {
                      const value = balances[account.id] ?? ''
                      const prior = priorBalances[account.id]
                      const delta = prior === undefined ? null : committed(value) - Number(prior)
                      return (
                        <tr key={account.id}>
                          <td className={account.is_component ? 'entry-component' : undefined}>
                            <label htmlFor={`bal-${account.id}`}>
                              {account.name}
                              {account.is_component && <span className="badge">component</span>}
                            </label>
                          </td>
                          <td className="num entry-ref">
                            {prior === undefined ? '—' : formatCurrency(prior)}
                          </td>
                          <td className="num entry-cell-col">
                            <AmountInput
                              id={`bal-${account.id}`}
                              className={isAmount(value) ? undefined : 'invalid'}
                              autoFocus={account.id === firstBalanceId}
                              value={value}
                              onValueChange={(next) =>
                                setBalances((cur) => ({ ...cur, [account.id]: next }))
                              }
                            />
                          </td>
                          <td
                            className={`num entry-delta${
                              delta === null || delta === 0
                                ? ''
                                : delta > 0
                                  ? ' delta-positive'
                                  : ' delta-negative'
                            }`}
                          >
                            {/* Typo tripwire: a fat-fingered digit shows a huge Δ instantly. */}
                            {delta === null ? '—' : formatCurrency(delta)}
                          </td>
                        </tr>
                      )
                    })}
                    <tr className="entry-subtotal-row">
                      <td>Subtotal</td>
                      <td className="num entry-ref">{formatCurrency(totals.prior)}</td>
                      <td className="num">{formatCurrency(totals.now)}</td>
                      <td className="num entry-delta">{formatCurrency(totals.now - totals.prior)}</td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          <p className="drill-hint">
            Liabilities are stored signed — enter card balances as negative numbers.
          </p>
          <div className="entry-footer" role="status">
            <span>
              Net worth (live): <strong>{formatCurrency(preview.netWorth)}</strong>
            </span>
            {preview.delta !== null && (
              <span className={preview.delta >= 0 ? 'delta-positive' : 'delta-negative'}>
                {/* Glyph + color, never color alone (Global visual rule; StatTile's pattern). */}
                <span aria-hidden="true">{preview.delta >= 0 ? '▲ ' : '▼ '}</span>
                {formatCurrency(preview.delta)} vs prior month
              </span>
            )}
          </div>
          <div className="wizard-footer">
            <span />
            <button
              className="button button-primary"
              data-entry-primary=""
              disabled={loading || accounts.length === 0 || !balancesValid}
              onClick={() => setStep('spending')}
            >
              Next: spending
            </button>
          </div>
        </div>
      )}

      {!loading && step === 'spending' && (
        <div className="card" data-entry-scope="">
          <h2 className="eyebrow">
            Spending & net pay
            <InfoHint text="The month&apos;s spend per category plus take-home pay — a blank net pay skips the cashflow row." />
          </h2>
          <div className="meta-row">
            <label>
              Net pay (take-home)
              <AmountInput
                className={netPay.trim() === '' || isAmount(netPay) ? undefined : 'invalid'}
                autoFocus
                value={netPay}
                onValueChange={setNetPay}
                placeholder="leave blank to skip"
              />
            </label>
          </div>
          <div className="entry-grid">
            {categories.map((category) => {
              const value = amounts[category.id] ?? ''
              return (
                <div key={category.id} className="entry-field">
                  <label htmlFor={`amt-${category.id}`}>{category.name}</label>
                  <AmountInput
                    id={`amt-${category.id}`}
                    className={isAmount(value) ? undefined : 'invalid'}
                    value={value}
                    onValueChange={(next) =>
                      setAmounts((cur) => ({ ...cur, [category.id]: next }))
                    }
                  />
                </div>
              )
            })}
          </div>
          <div className="wizard-footer">
            <button className="button" onClick={() => setStep('balances')}>
              Back
            </button>
            <button
              className="button button-primary"
              data-entry-primary=""
              disabled={!amountsValid}
              onClick={() => setStep('review')}
            >
              Next: review
            </button>
          </div>
        </div>
      )}

      {!loading && step === 'review' && (
        <div className="card">
          <h2 className="eyebrow">
            Review & save — {formatMonth(month)}
            <InfoHint text="A client-side preview; the server&apos;s rounding is authoritative once saved." />
          </h2>
          <div className="review-grid">
            <div>
              <div className="stat-label">Net worth (preview)</div>
              <div className="stat-value">{formatCurrency(preview.netWorth)}</div>
              {preview.delta !== null && (
                <div
                  className={`stat-delta ${preview.delta >= 0 ? 'stat-delta-positive' : 'stat-delta-negative'}`}
                >
                  {/* Glyph + color, never color alone (Global visual rule; StatTile's pattern). */}
                  <span aria-hidden="true">{preview.delta >= 0 ? '▲ ' : '▼ '}</span>
                  {formatCurrency(preview.delta)} vs prior month
                </div>
              )}
            </div>
            <div>
              <div className="stat-label">Total spend</div>
              <div className="stat-value">{formatCurrency(preview.totalSpend)}</div>
            </div>
            <div>
              <div className="stat-label">Savings rate</div>
              <div className="stat-value">
                {preview.savings === null ? '—' : formatPct(preview.savings, { signed: false })}
              </div>
            </div>
          </div>
          <p className="drill-hint" style={{ marginTop: '0.75rem' }}>
            Server-side rounding (2 decimals, half-up) is authoritative; the preview is
            client math. {stepIndex === 2 && !balancesValid ? 'Fix balance entries first.' : ''}
          </p>
          <div className="wizard-footer">
            <button className="button" onClick={() => setStep('spending')}>
              Back
            </button>
            {/* accounts.length === 0 doubles as the "load succeeded" sentinel: after a
                failed load both validity flags are vacuously true, and a meta-only PUT
                to an existing month would clear its saved note. */}
            <button
              className="button button-primary"
              disabled={
                saving || loading || accounts.length === 0 || !balancesValid || !amountsValid
              }
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save month'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
