import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarCheck } from 'lucide-react'
import { ApiError } from '../api/client'
import {
  fetchAccounts,
  fetchMonthBalances,
  fetchTimeseries,
  putMonthBalances,
} from '../api/netWorth'
import { fetchCategories, fetchSpendingMonth, putSpendingMonth } from '../api/spending'
import MonthRibbon from '../components/MonthRibbon'
import { GROUP_LABELS, GROUP_ORDER } from '../charts/theme'
import type { AccountOut, CategoryOut } from '../types/api'
import { nestComponents } from '../utils/accounts'
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

function isNumeric(raw: string): boolean {
  return raw.trim() !== '' && !Number.isNaN(Number(raw))
}

function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
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
  const [monthExisted, setMonthExisted] = useState(false)
  const [coveredMonths, setCoveredMonths] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

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
        setBalances(
          Object.fromEntries(activeAccounts.map((a) => [a.id, byId.get(a.id) ?? '0.00'])),
        )
        // Reset on EVERY month load — stale notes/date must never leak into another
        // month's save (the next PUT would silently write them there).
        setRecordedOn(
          thisMonth.exists && thisMonth.recorded_on ? thisMonth.recorded_on : todayIso(),
        )
        setNotes(thisMonth.exists && thisMonth.notes ? thisMonth.notes : '')

        const prevSum = priorMonth.exists
          ? priorMonth.balances.reduce((acc, b) => {
              const account = accountList.find((a) => a.id === b.account_id)
              return account && !account.is_component ? acc + Number(b.balance) : acc
            }, 0)
          : null
        setPrevNetWorth(prevSum)

        const spendById = new Map(spendMonth.amounts.map((a) => [a.category_id, a.amount]))
        setAmounts(
          Object.fromEntries(
            categoryList
              .filter((c) => c.is_active)
              .map((c) => [c.id, spendById.get(c.id) ?? '0.00']),
          ),
        )
        setNetPay(spendMonth.net_pay ?? '')
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load month data')
      })
      .finally(() => setLoading(false))
  }, [month])

  const balancesValid = accounts.every((a) => isNumeric(balances[a.id] ?? ''))
  const amountsValid =
    categories.every((c) => isNumeric(amounts[c.id] ?? '')) &&
    (netPay.trim() === '' || isNumeric(netPay))

  const preview = useMemo(() => {
    const netWorth = accounts.reduce(
      (acc, a) => (a.is_component ? acc : acc + (Number(balances[a.id]) || 0)),
      0,
    )
    const totalSpend = categories.reduce((acc, c) => acc + (Number(amounts[c.id]) || 0), 0)
    const pay = netPay.trim() === '' ? null : Number(netPay)
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
    try {
      const balanceResult = await putMonthBalances(month, {
        recorded_on: recordedOn === '' ? undefined : recordedOn,
        // null (not undefined): blanking the field must CLEAR a previously saved note.
        notes: notes.trim() === '' ? null : notes,
        balances: accounts.map((a) => ({ account_id: a.id, balance: balances[a.id].trim() })),
      })
      const body: { net_pay?: string; amounts: { category_id: number; amount: string }[] } = {
        amounts: categories.map((c) => ({ category_id: c.id, amount: amounts[c.id].trim() })),
      }
      if (netPay.trim() !== '') body.net_pay = netPay.trim()
      const spendResult = await putSpendingMonth(month, body)
      setSaved(
        `Balances: ${balanceResult.created} added, ${balanceResult.updated} changed, ` +
          `${balanceResult.unchanged} unchanged. Spending: ${spendResult.created} added, ` +
          `${spendResult.updated} changed, ${spendResult.unchanged} unchanged.`,
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Saving failed — nothing was lost, retry')
    } finally {
      setSaving(false)
    }
  }

  const stepIndex = STEPS.indexOf(step)

  return (
    <div className="page">
      <div className="page-header">
        <h1>
          <CalendarCheck size={20} style={{ verticalAlign: '-3px', marginRight: '0.5rem' }} />
          Monthly update — {formatMonth(month)}
        </h1>
        <div className="spacer" />
        <MonthRibbon
          anchor={currentMonthIso()}
          filledMonths={coveredMonths}
          selected={month}
          onSelect={(m) => {
            // Same-month click: the [month] effect would never re-run, so an
            // unconditional setLoading(true) would blank the wizard forever.
            if (m === month) return
            // Month change refetches via the [month] dep — flip the fetch state here,
            // in the event handler, never in the effect (react-hooks/set-state-in-effect).
            setLoading(true)
            setError(null)
            setSaved(null)
            setParams(() => new URLSearchParams({ month: m, step: 'balances' }))
          }}
        />
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
        <div className="card">
          <h2 className="eyebrow">
            {monthExisted ? 'Edit balances' : 'Enter balances (pre-filled from last month)'}
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
          {GROUP_ORDER.map((group) => {
            const groupAccounts = accounts.filter((a) => a.group === group)
            if (groupAccounts.length === 0) return null
            return (
              <div key={group} className="group-block">
                <h3 className="eyebrow">{GROUP_LABELS[group]}</h3>
                <div className="entry-grid">
                  {groupAccounts.map((account) => {
                    const value = balances[account.id] ?? ''
                    return (
                      <div key={account.id} className="entry-field">
                        <label htmlFor={`bal-${account.id}`}>
                          {account.name}
                          {account.is_component && <span className="badge">component</span>}
                        </label>
                        <input
                          id={`bal-${account.id}`}
                          className={`field-input${isNumeric(value) ? '' : ' invalid'}`}
                          inputMode="decimal"
                          value={value}
                          onChange={(e) =>
                            setBalances((cur) => ({ ...cur, [account.id]: e.target.value }))
                          }
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <p className="drill-hint">
            Liabilities are stored signed — enter card balances as negative numbers.
          </p>
          <div className="wizard-footer">
            <span />
            <button
              className="button button-primary"
              disabled={loading || accounts.length === 0 || !balancesValid}
              onClick={() => setStep('spending')}
            >
              Next: spending
            </button>
          </div>
        </div>
      )}

      {!loading && step === 'spending' && (
        <div className="card">
          <h2 className="eyebrow">Spending & net pay</h2>
          <div className="meta-row">
            <label>
              Net pay (take-home)
              <input
                className={`field-input${netPay.trim() === '' || isNumeric(netPay) ? '' : ' invalid'}`}
                inputMode="decimal"
                value={netPay}
                onChange={(e) => setNetPay(e.target.value)}
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
                  <input
                    id={`amt-${category.id}`}
                    className={`field-input${isNumeric(value) ? '' : ' invalid'}`}
                    inputMode="decimal"
                    value={value}
                    onChange={(e) =>
                      setAmounts((cur) => ({ ...cur, [category.id]: e.target.value }))
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
          <h2 className="eyebrow">Review & save — {formatMonth(month)}</h2>
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
