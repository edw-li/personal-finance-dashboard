import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import {
  createCardCredit,
  createLimitEvent,
  deleteCardCredit,
  deleteLimitEvent,
  updateCardCredit,
} from '../../api/creditCards'
import { fetchMonthBalances, fetchSummary } from '../../api/netWorth'
import AmountInput from '../AmountInput'
import EChart from '../EChart'
import InfoHint from '../InfoHint'
import StatTile from '../StatTile'
import { useToast } from '../ToastProvider'
import type {
  AccountOut,
  CreditCardOut,
  RewardCategoryOut,
  RewardRateOut,
} from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency, formatDate, formatMonth, formatPct } from '../../utils/format'
import { currentMonthIso } from '../../utils/months'
import { creditLineChartOption, limitMonths } from './creditLineChartOptions'
import type { OptimizerResult } from './rewardsMath'
import { FeedBanner } from '../shell/Feed'
import './carddetail.css'

function message(err: unknown, fallback: string): string {
  // 404/409/422 details are the server's own sentences — rendered verbatim (house note).
  return err instanceof ApiError ? err.message : fallback
}

/**
 * Everything about ONE card: meta chips, worth-keeping stat, credits editor, its
 * matrix rewards, limit-history editor + step sparkline, utilization from the linked
 * liability account's latest snapshot balance.
 */
export default function CardDetail({
  card,
  result,
  rates,
  categories,
  accounts,
  busy,
  weighted = true,
  onClose,
  onChanged,
}: {
  card: CreditCardOut
  result: OptimizerResult
  rates: RewardRateOut[]
  categories: RewardCategoryOut[]
  accounts: AccountOut[]
  busy: boolean
  /** False when NO active category carries a spend weight: every marginal is then $0 by
   *  construction, and the tile must read as "unweighted", never as a verdict. */
  weighted?: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [localBusy, setLocalBusy] = useState(false)
  const [creditForm, setCreditForm] = useState({ label: '', annual_value: '' })
  const [limitForm, setLimitForm] = useState({ effective_date: '', limit_amount: '', note: '' })
  // Latest-snapshot balance for the linked account; null = not linked / not loaded.
  const [utilization, setUtilization] = useState<{ month: string; balance: number } | null>(null)
  const toast = useToast()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const anyBusy = busy || localBusy

  // Hand focus to the heading on open — the drill-in replaced the page the trigger
  // button lived on (the house focus-management posture).
  useEffect(() => {
    headingRef.current?.focus()
  }, [card.id])

  useEffect(() => {
    if (card.account_id === null) return
    let cancelled = false
    fetchSummary()
      .then((summary) => {
        if (summary.month === null) return null
        return fetchMonthBalances(summary.month)
      })
      .then((balances) => {
        if (cancelled || !balances) return
        const entry = balances.balances.find((b) => b.account_id === card.account_id)
        if (entry) setUtilization({ month: balances.month, balance: Number(entry.balance) })
      })
      .catch(() => {
        // Utilization is a nicety — degrade silently, never an error banner.
      })
    return () => {
      cancelled = true
    }
  }, [card.account_id])

  const accountName =
    card.account_id === null
      ? null
      : (accounts.find((a) => a.id === card.account_id)?.name ?? null)
  const value = result.cardValues.find((v) => v.cardId === card.id)
  const nameByCategory = new Map(categories.map((c) => [c.id, c.name]))
  const myRates = rates
    .filter((r) => r.card_id === card.id)
    .map((r) => ({ ...r, categoryName: nameByCategory.get(r.category_id) ?? String(r.category_id) }))
  const wonIds = new Set(value?.wonCategoryIds ?? [])

  const addCredit = () => {
    const label = creditForm.label.trim()
    const amount = creditForm.annual_value.trim()
    if (!label || !amount) {
      setError('Credit label and annual value are required')
      return
    }
    if (!isAmount(amount, { expressions: false }) || Number(canonicalAmount(amount, { expressions: false })) < 0) {
      setError('annual_value must be non-negative')
      return
    }
    setLocalBusy(true)
    setError(null)
    createCardCredit(card.id, {
      label,
      annual_value: canonicalAmount(amount, { expressions: false }),
      counts: true,
    })
      .then(() => {
        setCreditForm({ label: '', annual_value: '' })
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Save failed')))
      .finally(() => setLocalBusy(false))
  }

  const toggleCredit = (creditId: number) => {
    const credit = card.credits.find((c) => c.id === creditId)
    if (!credit) return
    setLocalBusy(true)
    setError(null)
    // Full-object PATCH (the router validates the whole credit), house style: the two
    // fields that are NOT changing travel back verbatim, so a flip never rewrites them.
    updateCardCredit(creditId, {
      label: credit.label,
      annual_value: credit.annual_value,
      counts: !credit.counts,
    })
      .then(() => onChanged())
      .catch((err: unknown) => setError(message(err, 'Update failed')))
      .finally(() => setLocalBusy(false))
  }

  const removeCredit = (creditId: number) => {
    const credit = card.credits.find((c) => c.id === creditId)
    if (!credit) return
    setLocalBusy(true)
    setError(null)
    deleteCardCredit(creditId)
      .then(() => {
        onChanged()
        // Confirm-free delete + Undo (the house recovery affordance); the re-POST takes a
        // new id, which nothing here holds onto.
        toast.success(`Deleted the ${credit.label} credit`, {
          action: {
            label: 'Undo',
            onAction: () => {
              createCardCredit(card.id, {
                label: credit.label,
                annual_value: credit.annual_value,
                counts: credit.counts,
              })
                .then(() => onChanged())
                .catch(() => toast.error(`Could not restore the ${credit.label} credit`))
            },
          },
        })
      })
      .catch((err: unknown) => setError(message(err, 'Delete failed')))
      .finally(() => setLocalBusy(false))
  }

  const addLimit = () => {
    const amount = limitForm.limit_amount.trim()
    if (!limitForm.effective_date || !amount) {
      setError('Limit date and amount are required')
      return
    }
    if (!isAmount(amount, { expressions: false }) || Number(canonicalAmount(amount, { expressions: false })) <= 0) {
      setError('limit_amount must be positive')
      return
    }
    setLocalBusy(true)
    setError(null)
    createLimitEvent(card.id, {
      effective_date: limitForm.effective_date,
      limit_amount: canonicalAmount(amount, { expressions: false }),
      note: limitForm.note.trim() || null,
    })
      .then(() => {
        setLimitForm({ effective_date: '', limit_amount: '', note: '' })
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Save failed')))
      .finally(() => setLocalBusy(false))
  }

  const removeLimit = (eventId: number) => {
    setLocalBusy(true)
    setError(null)
    deleteLimitEvent(card.id, eventId)
      .then(() => onChanged())
      .catch((err: unknown) => setError(message(err, 'Delete failed')))
      .finally(() => setLocalBusy(false))
  }

  // Memoized: EChart keys its effect on [option] with notMerge, so a fresh object every
  // render would replay the chart on every keystroke in the two forms below (CompPage's
  // note). One series, no Total — a single card's own line is the whole story here.
  const sparkOption = useMemo(() => {
    if (card.limit_events.length === 0) return null
    const history = [{ name: card.name, events: card.limit_events }]
    return creditLineChartOption(history, limitMonths(history, currentMonthIso()), {
      includeTotal: false,
    })
  }, [card.name, card.limit_events])

  const utilizationPct =
    utilization !== null && card.current_limit !== null && Number(card.current_limit) > 0
      ? Math.abs(utilization.balance) / Number(card.current_limit)
      : null

  return (
    <div className="card-detail">
      <div className="page-header">
        <button type="button" className="button" onClick={onClose} aria-label="Back to the matrix">
          ✕ Back to matrix
        </button>
        {/* tabIndex -1: focus target on open, not in the tab order. */}
        <h2 ref={headingRef} tabIndex={-1} className="card-detail-title">
          {card.name}
        </h2>
        <div className="spacer" />
      </div>

      <FeedBanner error={error} />

      <div className="chip-row">
        <span className="chip">Holder: {card.primary_holder ?? '—'}</span>
        <span className="chip">AU: {card.authorized_users ?? '—'}</span>
        <span className="chip">
          Opened {card.opened_on ? formatDate(card.opened_on) : '—'}
        </span>
        <span className="chip">AF {formatCurrency(card.annual_fee)}</span>
        <span className="chip">
          {card.rewards_currency} @ {Number(card.point_value_cents)}¢/pt
        </span>
        {accountName && <span className="chip">Linked: {accountName}</span>}
        {!card.is_active && <span className="chip">Archived</span>}
      </div>

      <div className="card-grid">
        <div className="card span-6">
          <h2 className="eyebrow">
            Worth keeping? (est.)
            <InfoHint text="Marginal rewards (optimal lineup with this card minus without it) plus counted credits, minus the annual fee. Estimates from your category weights." />
          </h2>
          {value ? (
            <>
              <StatTile
                label="Net value per year"
                value={formatCurrency(value.net)}
                tone={!weighted ? 'neutral' : value.net > 0 ? 'positive' : 'negative'}
                hint="marginal + counted credits − annual fee"
              />
              <p className="drill-hint">
                {formatCurrency(value.marginal)} marginal + {formatCurrency(value.countedCredits)}{' '}
                credits − {formatCurrency(value.annualFee)} fee
                {!weighted
                  ? ' — no spend weights yet, so the marginal reads $0 by construction; set weights in Categories & weights to judge this card.'
                  : value.net <= 0 && ' — droppable: the rest of the lineup catches this spend.'}
              </p>
            </>
          ) : (
            <p className="empty-note">Archived cards sit outside the optimizer.</p>
          )}

          <h2 className="eyebrow">Recurring credits</h2>
          {card.credits.length === 0 && <p className="empty-note">No credits tracked.</p>}
          {card.credits.map((credit) => (
            <div key={credit.id} className="credit-row">
              <span>
                {credit.label} · {formatCurrency(credit.annual_value)}/yr
              </span>
              <span className="credit-row-actions">
                <button
                  type="button"
                  className="button"
                  aria-pressed={credit.counts}
                  aria-label={`${credit.label} counts toward the math`}
                  disabled={anyBusy}
                  onClick={() => toggleCredit(credit.id)}
                >
                  {credit.counts ? 'Counts ✓' : 'Ignored'}
                </button>
                <button
                  type="button"
                  className="button"
                  aria-label={`Delete the ${credit.label} credit`}
                  disabled={anyBusy}
                  onClick={() => removeCredit(credit.id)}
                >
                  Delete
                </button>
              </span>
            </div>
          ))}
          <form
            className="credit-add"
            onSubmit={(e) => {
              e.preventDefault()
              addCredit()
            }}
          >
            <input
              className="field-input"
              placeholder="Credit label"
              aria-label="Credit label"
              value={creditForm.label}
              onChange={(e) => setCreditForm((f) => ({ ...f, label: e.target.value }))}
            />
            <AmountInput
              kind="money"
              value={creditForm.annual_value}
              onValueChange={(v) => setCreditForm((f) => ({ ...f, annual_value: v }))}
              placeholder="$/yr"
              aria-label="Credit annual value"
            />
            <button type="submit" className="button button-primary" disabled={anyBusy}>
              Add credit
            </button>
          </form>

          <h2 className="eyebrow">Its rewards</h2>
          {myRates.length === 0 ? (
            <p className="empty-note">No multipliers yet — add them in the matrix.</p>
          ) : (
            <p className="drill-hint">
              {myRates
                .map(
                  (r) =>
                    `${r.categoryName} ${Number(r.multiplier)}x${wonIds.has(r.category_id) ? ' ★' : ''}`,
                )
                .join(' · ')}
              {wonIds.size > 0 && ' — ★ = the card to reach for'}
            </p>
          )}
        </div>

        <div className="card span-6">
          <h2 className="eyebrow">
            Credit line
            <InfoHint text="Dated limit changes; the newest is the current line. Steps, not slopes — the sparkline holds level between events." />
          </h2>
          {sparkOption ? (
            <EChart
              option={sparkOption}
              height={180}
              ariaLabel={`Step chart of ${card.name}'s credit limit over time`}
            />
          ) : (
            <p className="empty-note">No limit history yet — add the opening line below.</p>
          )}
          <table className="data-table limit-table">
            <thead>
              <tr>
                <th>Effective</th>
                <th className="num">Limit</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {card.limit_events.map((event) => (
                <tr key={event.id}>
                  <td>{formatDate(event.effective_date)}</td>
                  <td className="num">{formatCurrency(event.limit_amount)}</td>
                  <td>{event.note ?? '—'}</td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="button"
                      aria-label={`Delete the ${event.effective_date} limit event`}
                      disabled={anyBusy}
                      onClick={() => removeLimit(event.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form
            className="limit-add"
            onSubmit={(e) => {
              e.preventDefault()
              addLimit()
            }}
          >
            <input
              className="field-input"
              type="date"
              aria-label="Limit effective date"
              value={limitForm.effective_date}
              onChange={(e) => setLimitForm((f) => ({ ...f, effective_date: e.target.value }))}
            />
            <AmountInput
              kind="money"
              value={limitForm.limit_amount}
              onValueChange={(v) => setLimitForm((f) => ({ ...f, limit_amount: v }))}
              placeholder="New limit"
              aria-label="Limit amount"
            />
            <input
              className="field-input"
              placeholder="Note (CLI request, auto…)"
              aria-label="Limit note"
              value={limitForm.note}
              onChange={(e) => setLimitForm((f) => ({ ...f, note: e.target.value }))}
            />
            <button type="submit" className="button button-primary" disabled={anyBusy}>
              Add
            </button>
          </form>

          <h2 className="eyebrow">Utilization</h2>
          {card.account_id === null ? (
            <p className="drill-hint">
              Link a liability account (roster → edit) to see utilization here.
            </p>
          ) : utilization === null || utilizationPct === null ? (
            <p className="drill-hint">Utilization needs a snapshot balance and a current limit.</p>
          ) : (
            // The `utilization === null` arm above is what narrows it here — a non-null
            // assertion would read as a claim rather than a check (task note).
            <p className="drill-hint" data-utilization>
              {formatCurrency(Math.abs(utilization.balance))} of{' '}
              {formatCurrency(card.current_limit)} ={' '}
              {formatPct(utilizationPct, { signed: false })} (as of{' '}
              {formatMonth(utilization.month)}) — balances are stored negative; this reads the
              latest net-worth snapshot.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
