import { useEffect, useMemo, useRef, useState } from 'react'
import { errorDetail } from '../../api/client'
import BusyButton from '../feedback/BusyButton'
import { SaveButton } from '../feedback/SaveButton'
import { SaveStatus } from '../feedback/SaveStatus'
import { useSaveState } from '../feedback/useSaveState'
import { useDeleteWithUndo } from '../feedback/useDeleteWithUndo'
import { flashElement, revealRow } from '../feedback/reveal'
import { useLatest } from '../reorder/useLatest'
import {
  createCardCredit,
  createLimitEvent,
  deleteCardCredit,
  deleteLimitEvent,
  updateCardCredit,
} from '../../api/creditCards'
import { fetchMonthBalances, fetchSummary } from '../../api/netWorth'
import AmountInput from '../AmountInput'
import ChartCard from '../ChartCard'
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
import { asOfPhrase } from '../../utils/asOf'
import { formatCurrency, formatDate, formatPct } from '../../utils/format'
import { currentMonthIso } from '../../utils/months'
import { summaryState } from '../networth/snapshotStates'
import { closingEffect, type BalanceSnapshot } from './closingEffect'
import { creditLineChartOption, creditLineCsv, limitMonths } from './creditLineChartOptions'
import { VERDICT_LABEL, VERDICT_TONE, verdictKind, type OptimizerResult } from './rewardsMath'
import { closingSentence, tieReason, verdictReason } from './verdictCopy'
import { FeedBanner } from '../shell/Feed'
import './carddetail.css'
import './verdicts.css'

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
  lineup,
  rankIds,
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
  /** The active cards the optimizer valued this card against (the whole household — the drill
   *  ignores the Whose chips): whose line and balances closing this card would change. */
  lineup: CreditCardOut[]
  /** The ids the page chart ranks credit-line colours against (the household's active cards),
   *  so this card's line wears its page colour (2026-09-23 drag-to-reorder spec §7). */
  rankIds: readonly number[]
  busy: boolean
  /** False when NO active category carries a spend weight: every marginal is then $0 by
   *  construction, and the tile must read as "unweighted", never as a verdict. */
  weighted?: boolean
  onClose: () => void
  onChanged: () => void | Promise<void>
}) {
  const [creditError, setCreditError] = useState<string | null>(null)
  const [limitError, setLimitError] = useState<string | null>(null)
  const [localBusy, setLocalBusy] = useState(false)
  const [creditForm, setCreditForm] = useState({ label: '', annual_value: '' })
  const [limitForm, setLimitForm] = useState({ effective_date: '', limit_amount: '', note: '' })
  const creditSave = useSaveState({ dirty: creditForm.label !== '' || creditForm.annual_value !== '' })
  const limitSave = useSaveState({ dirty: limitForm.effective_date !== '' || limitForm.limit_amount !== '' || limitForm.note !== '' })
  const creditFormRef = useRef<HTMLFormElement>(null)
  const limitFormRef = useRef<HTMLFormElement>(null)
  const changedRef = useLatest(onChanged)
  const reload = () => changedRef.current()
  const deleteWithUndo = useDeleteWithUndo()
  const firstCreditField = () => creditFormRef.current?.querySelector<HTMLInputElement>('input') ?? null
  const firstLimitField = () => limitFormRef.current?.querySelector<HTMLInputElement>('input') ?? null

  // The CURRENT net-worth snapshot's balances, every account — this card's own utilization line
  // and the household utilization closing it would change (2026-09-23 spec §B6) both read it,
  // and both name it by its date and standing (§T9). null = nothing linked, not loaded, or the
  // fetch failed.
  const [balances, setBalances] = useState<BalanceSnapshot | null>(null)
  const toast = useToast()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const anyBusy = busy || localBusy || creditSave.status === 'saving' || limitSave.status === 'saving'

  // Hand focus to the heading on open — the drill-in replaced the page the trigger
  // button lived on (the house focus-management posture).
  useEffect(() => {
    headingRef.current?.focus()
  }, [card.id])

  // Only when some card is linked to a liability account: otherwise no balance could answer.
  const needsBalances = card.account_id !== null || lineup.some((c) => c.account_id !== null)
  useEffect(() => {
    if (!needsBalances) return
    let cancelled = false
    // The summary's default IS the current snapshot (2026-09-23 spec §K2: the latest at most one
    // month ahead), with the day its balances describe and whether they are provisional.
    fetchSummary()
      .then((summary) => {
        const state = summaryState(summary)
        if (state === null) return null
        return fetchMonthBalances(state.month).then((snapshot) => ({ snapshot, state }))
      })
      .then((read) => {
        if (cancelled || !read) return
        setBalances({
          month: read.snapshot.month,
          as_of: read.state.as_of,
          provisional: read.state.provisional,
          byAccount: new Map(read.snapshot.balances.map((b) => [b.account_id, Number(b.balance)])),
        })
      })
      .catch(() => {
        // Utilization is a nicety — degrade silently, never an error banner.
      })
    return () => {
      cancelled = true
    }
  }, [needsBalances])

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
    if (anyBusy || creditSave.status === 'clean' || creditSave.status === 'saved') return
    const label = creditForm.label.trim()
    const amount = creditForm.annual_value.trim()
    if (!label || !amount) {
      setCreditError('Credit label and annual value are required')
      creditFormRef.current?.querySelector<HTMLInputElement>(!label ? '[aria-label="Credit label"]' : '[aria-label="Credit annual value"]')?.focus()
      return
    }
    if (!isAmount(amount, { expressions: false }) || Number(canonicalAmount(amount, { expressions: false })) < 0) {
      setCreditError('annual_value must be non-negative')
      creditFormRef.current?.querySelector<HTMLInputElement>('[aria-label="Credit annual value"]')?.focus()
      return
    }
    setCreditError(null)
    void creditSave.run(async () => {
      const saved = await createCardCredit(card.id, {
        label, annual_value: canonicalAmount(amount, { expressions: false }), counts: true,
        reset_cadence: 'calendar',
      })
      firstCreditField()?.focus()
      setCreditForm({ label: '', annual_value: '' })
      await reload()
      requestAnimationFrame(() => {
        const row = document.getElementById(`credit-row-${saved.id}`)
        revealRow(row)
        flashElement(row)
        firstCreditField()?.focus({ preventScroll: true })
      })
    })
  }

  const toggleCredit = (creditId: number) => {
    const credit = card.credits.find((c) => c.id === creditId)
    if (!credit) return
    setLocalBusy(true)
    // Full-object PATCH (the router validates the whole credit), house style: the two
    // fields that are NOT changing travel back verbatim, so a flip never rewrites them.
    updateCardCredit(creditId, {
      label: credit.label,
      annual_value: credit.annual_value,
      counts: !credit.counts,
      reset_cadence: credit.reset_cadence,
    })
      .then(() => reload())
      .catch((err: unknown) => toast.error(errorDetail(err)))
      .finally(() => setLocalBusy(false))
  }

  const toggleCadence = (creditId: number) => {
    const credit = card.credits.find((c) => c.id === creditId)
    if (!credit) return
    setLocalBusy(true)
    // Full-object PATCH (house style): only the cadence changes, everything else travels
    // back verbatim.
    updateCardCredit(creditId, {
      label: credit.label,
      annual_value: credit.annual_value,
      counts: credit.counts,
      reset_cadence: credit.reset_cadence === 'calendar' ? 'anniversary' : 'calendar',
    })
      .then(() => reload())
      .catch((err: unknown) => toast.error(errorDetail(err)))
      .finally(() => setLocalBusy(false))
  }

  const removeCredit = (creditId: number) => {
    const credit = card.credits.find((row) => row.id === creditId)
    if (!credit) return
    setLocalBusy(true)
    void deleteWithUndo({
      name: `the ${credit.label} credit`,
      row: document.getElementById(`credit-row-${creditId}`),
      request: () => deleteCardCredit(creditId),
      onDeleted: reload,
      focusAfter: firstCreditField,
      onRestored: reload,
      restoredRow: () => document.getElementById(`credit-row-${creditId}`),
    }).finally(() => setLocalBusy(false))
  }

  const addLimit = () => {
    if (anyBusy || limitSave.status === 'clean' || limitSave.status === 'saved') return
    const amount = limitForm.limit_amount.trim()
    if (!limitForm.effective_date || !amount) {
      setLimitError('Limit date and amount are required')
      limitFormRef.current?.querySelector<HTMLInputElement>(!limitForm.effective_date ? '[type="date"]' : '[aria-label="Limit amount"]')?.focus()
      return
    }
    if (!isAmount(amount, { expressions: false }) || Number(canonicalAmount(amount, { expressions: false })) <= 0) {
      setLimitError('limit_amount must be positive')
      limitFormRef.current?.querySelector<HTMLInputElement>('[aria-label="Limit amount"]')?.focus()
      return
    }
    setLimitError(null)
    void limitSave.run(async () => {
      const history = await createLimitEvent(card.id, {
        effective_date: limitForm.effective_date,
        limit_amount: canonicalAmount(amount, { expressions: false }),
        note: limitForm.note.trim() || null,
      })
      const saved = history.find((row) => row.effective_date === limitForm.effective_date)
      firstLimitField()?.focus()
      setLimitForm({ effective_date: '', limit_amount: '', note: '' })
      await reload()
      requestAnimationFrame(() => {
        const row = saved ? document.getElementById(`limit-row-${saved.id}`) : null
        revealRow(row)
        flashElement(row)
        firstLimitField()?.focus({ preventScroll: true })
      })
    })
  }

  const removeLimit = (eventId: number) => {
    const event = card.limit_events.find((row) => row.id === eventId)
    if (!event) return
    setLocalBusy(true)
    void deleteWithUndo({
      name: `the ${event.effective_date} limit event`,
      row: document.getElementById(`limit-row-${eventId}`),
      request: () => deleteLimitEvent(card.id, eventId),
      onDeleted: reload,
      focusAfter: firstLimitField,
      onRestored: reload,
      restoredRow: () => document.getElementById(`limit-row-${eventId}`),
    }).finally(() => setLocalBusy(false))
  }

  // Memoized: EChart keys its effect on [option] with notMerge, so a fresh object every
  // render would replay the chart on every keystroke in the two forms below (CompPage's
  // note). One series, no Total — a single card's own line is the whole story here — in the
  // colour the page chart gives this card: its rank by id among the page's rankIds, never the
  // first slot every lone card would take (2026-09-23 drag-to-reorder spec §7, as amended).
  const sparkOption = useMemo(() => {
    if (card.limit_events.length === 0) return null
    const history = [{ id: card.id, name: card.name, events: card.limit_events }]
    return creditLineChartOption(history, limitMonths(history, currentMonthIso()), {
      includeTotal: false,
      rankIds,
    })
  }, [card.id, card.name, card.limit_events, rankIds])

  // This card's own balance from the snapshot; null = not linked / not loaded.
  const ownBalance =
    card.account_id === null || balances === null ? undefined : balances.byAccount.get(card.account_id)
  const utilization =
    balances === null || ownBalance === undefined
      ? null
      : { month: balances.month, as_of: balances.as_of, provisional: balances.provisional, balance: ownBalance }
  const utilizationPct =
    utilization !== null && card.current_limit !== null && Number(card.current_limit) > 0
      ? Math.abs(utilization.balance) / Number(card.current_limit)
      : null

  // The verdict (2026-09-23 spec §B6), its reason and — for a card someone might close — what
  // closing would change. The tie is only the reason for a $0 marginal (tieReason's rule).
  const kind = value === undefined ? null : verdictKind(value)
  const cardName = (id: number) => lineup.find((c) => c.id === id)?.name ?? `#${id}`
  const categoryName = (id: number) => nameByCategory.get(id) ?? `#${id}`
  const ties = value === undefined ? null : tieReason(value, result, cardName, categoryName)
  const openedDates = lineup.flatMap((c) => (c.opened_on === null ? [] : [c.opened_on]))
  const oldest =
    card.opened_on !== null &&
    openedDates.length > 1 &&
    openedDates.every((opened) => opened >= (card.opened_on as string))
  const effect = closingEffect(card, lineup, balances)

  return (
    <div className="card-detail">
      <div className="page-header">
        <BusyButton type="button" className="button" onClick={onClose} aria-label="Back to the matrix">
          ✕ Back to matrix
        </BusyButton>
        {/* tabIndex -1: focus target on open, not in the tab order. */}
        <h2 ref={headingRef} tabIndex={-1} className="card-detail-title">
          {card.name}
        </h2>
        <div className="spacer" />
      </div>


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
            // A named region, so the verdict is a landmark to assistive tech (and to the tests,
            // which find it by role and name — never by a test id).
            <section className="card-verdict" aria-label="Verdict">
              {/* The tile's second line IS the verdict, in its tone — the old sign rule painted a
                  $0 no-fee card red and called it droppable. */}
              <StatTile
                label="Net value per year"
                value={formatCurrency(value.net)}
                delta={weighted && kind !== null ? VERDICT_LABEL[kind] : undefined}
                tone={!weighted || kind === null ? 'neutral' : VERDICT_TONE[kind]}
                hint="marginal + counted credits − annual fee"
              />
              <p className="drill-hint">
                {formatCurrency(value.marginal)} marginal + {formatCurrency(value.countedCredits)}{' '}
                credits − {formatCurrency(value.annualFee)} fee
                {!weighted &&
                  ' — no spend weights yet, so the marginal reads $0 by construction; set weights in Categories & weights to judge this card.'}
              </p>
              {weighted && kind !== null && (
                <>
                  <p className="card-verdict-reason">{verdictReason(value, ties)}</p>
                  {kind !== 'earns' && (
                    <p className="drill-hint">
                      {closingSentence(kind, value, effect, { opened_on: card.opened_on, oldest })}
                    </p>
                  )}
                </>
              )}
            </section>
          ) : (
            <p className="empty-note">Archived cards sit outside the optimizer.</p>
          )}

          <h2 className="eyebrow">Recurring credits</h2>
          {card.credits.length === 0 && <p className="empty-note">No credits tracked.</p>}
          {card.credits.map((credit) => (
            <div key={credit.id} id={`credit-row-${credit.id}`} className="credit-row">
              <span>
                {credit.label} · {formatCurrency(credit.annual_value)}/yr
              </span>
              <span className="credit-row-actions">
                <BusyButton
                  type="button"
                  className="button"
                  aria-pressed={credit.reset_cadence === 'anniversary'}
                  aria-label={`${credit.label} resets on the card anniversary`}
                  title={
                    card.opened_on === null && credit.reset_cadence === 'anniversary'
                      ? "Needs the card's opened date to land on the calendar"
                      : 'When the credit resets — the calendar dates its reset event by this'
                  }
                  disabled={anyBusy}
                  onClick={() => toggleCadence(credit.id)}
                >
                  {credit.reset_cadence === 'anniversary' ? 'Resets on anniversary' : 'Resets Jan 1'}
                </BusyButton>
                <BusyButton
                  type="button"
                  className="button"
                  aria-pressed={credit.counts}
                  aria-label={`${credit.label} counts toward the math`}
                  disabled={anyBusy}
                  onClick={() => toggleCredit(credit.id)}
                >
                  {credit.counts ? 'Counts ✓' : 'Ignored'}
                </BusyButton>
                <BusyButton
                  type="button"
                  className="button"
                  aria-label={`Delete the ${credit.label} credit`}
                  disabled={anyBusy}
                  onClick={() => removeCredit(credit.id)}
                >
                  Delete
                </BusyButton>
              </span>
            </div>
          ))}
          <form
            className="credit-add"
            ref={creditFormRef}
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
              onChange={(e) => { setCreditError(null); creditSave.clearError(); setCreditForm((f) => ({ ...f, label: e.target.value })) }}
            />
            <AmountInput
              kind="money"
              value={creditForm.annual_value}
              onValueChange={(v) => { setCreditError(null); creditSave.clearError(); setCreditForm((f) => ({ ...f, annual_value: v })) }}
              placeholder="$/yr"
              aria-label="Credit annual value"
            />
            <SaveButton type="submit" className="button button-primary" state={creditSave} aria-disabled={busy || localBusy || limitSave.status === 'saving' || undefined}>
              Add credit
            </SaveButton>
            <FeedBanner error={creditError} />
            {creditError === null && <SaveStatus state={creditSave} />}
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

        <ChartCard
          span={6}
          title="Credit line"
          hint="Dated limit changes; the newest is the current line. Steps, not slopes — the line holds level between events."
          ariaLabel={`Step chart of ${card.name}'s credit limit over time`}
          option={sparkOption}
          empty="No limit history yet — add the opening line below."
          exportName={`${card.slug}-credit-line`}
          csv={() =>
            creditLineCsv(
              [{ name: card.name, events: card.limit_events }],
              limitMonths([{ name: card.name, events: card.limit_events }], currentMonthIso()),
            )
          }
          height={180}
          footer={
            <>
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
                <tr key={event.id} id={`limit-row-${event.id}`}>
                  <td>{formatDate(event.effective_date)}</td>
                  <td className="num">{formatCurrency(event.limit_amount)}</td>
                  <td>{event.note ?? '—'}</td>
                  <td className="row-actions">
                    <BusyButton
                      type="button"
                      className="button"
                      aria-label={`Delete the ${event.effective_date} limit event`}
                      disabled={anyBusy}
                      onClick={() => removeLimit(event.id)}
                    >
                      Delete
                    </BusyButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form
            className="limit-add"
            ref={limitFormRef}
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
              onChange={(e) => { setLimitError(null); limitSave.clearError(); setLimitForm((f) => ({ ...f, effective_date: e.target.value })) }}
            />
            <AmountInput
              kind="money"
              value={limitForm.limit_amount}
              onValueChange={(v) => { setLimitError(null); limitSave.clearError(); setLimitForm((f) => ({ ...f, limit_amount: v })) }}
              placeholder="New limit"
              aria-label="Limit amount"
            />
            <input
              className="field-input"
              placeholder="Note (CLI request, auto…)"
              aria-label="Limit note"
              value={limitForm.note}
              onChange={(e) => { setLimitError(null); limitSave.clearError(); setLimitForm((f) => ({ ...f, note: e.target.value })) }}
            />
            <SaveButton type="submit" className="button button-primary" state={limitSave} aria-disabled={busy || localBusy || creditSave.status === 'saving' || undefined}>
              Add
            </SaveButton>
            <FeedBanner error={limitError} />
            {limitError === null && <SaveStatus state={limitSave} />}
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
              {formatPct(utilizationPct, { signed: false })} ({asOfPhrase(utilization)}) —
              balances are stored negative; this reads the current net-worth snapshot.
            </p>
          )}
            </>
          }
        />
      </div>
    </div>
  )
}
