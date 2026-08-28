import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import {
  fetchCreditCards,
  fetchRewardCategories,
  fetchRewardRates,
  putRewardRates,
} from '../api/creditCards'
import { fetchAccounts } from '../api/netWorth'
import { fetchCategories, fetchMatrix } from '../api/spending'
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
import EChart from '../components/EChart'
import InfoHint from '../components/InfoHint'
import StatTile from '../components/StatTile'
import CardDetail from '../components/creditcards/CardDetail'
import CardsPanel from '../components/creditcards/CardsPanel'
import CategoriesPanel from '../components/creditcards/CategoriesPanel'
import RewardsMatrix from '../components/creditcards/RewardsMatrix'
import { cardValueChartOption } from '../components/creditcards/cardValueChartOptions'
import { creditLineChartOption, limitMonths } from '../components/creditcards/creditLineChartOptions'
import {
  optimize,
  resolveWeight,
  suggestedAnnualSpend,
  toMathCards,
  toMathCategories,
  toMathRates,
} from '../components/creditcards/rewardsMath'
import type {
  AccountOut,
  CategoryOut,
  CreditCardOut,
  RewardCategoryOut,
  RewardRateOut,
  RewardRatePut,
  SpendingMatrix,
} from '../types/api'
import { formatCurrency } from '../utils/format'
import { currentMonthIso } from '../utils/months'
import '../components/panels.css'
import './CreditCardsPage.css'

const SNAPSHOT_KEY = 'credit-cards'

interface CreditCardsSnapshot {
  cards: CreditCardOut[]
  categories: RewardCategoryOut[]
  rates: RewardRateOut[]
  spendingCategories: CategoryOut[]
  matrix: SpendingMatrix
  accounts: AccountOut[]
}

export default function CreditCardsPage() {
  const cached = getSnapshot<CreditCardsSnapshot>(SNAPSHOT_KEY)
  const [cards, setCards] = useState<CreditCardOut[] | null>(cached?.cards ?? null)
  const [categories, setCategories] = useState<RewardCategoryOut[] | null>(
    cached?.categories ?? null,
  )
  const [rates, setRates] = useState<RewardRateOut[] | null>(cached?.rates ?? null)
  const [spendingCategories, setSpendingCategories] = useState<CategoryOut[]>(
    cached?.spendingCategories ?? [],
  )
  const [matrix, setMatrix] = useState<SpendingMatrix | null>(cached?.matrix ?? null)
  const [accounts, setAccounts] = useState<AccountOut[]>(cached?.accounts ?? [])
  // `loading` starts true on purpose: a seeded grid renders full and dims under
  // `loading-dim is-loading` until the mount revalidation resolves — the house
  // revalidation cue. The `!loading &&` empty-notes cannot flash during that window
  // because each one only renders when its data half is absent, and the seed fills them.
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fromCache, setFromCache] = useState(cached !== undefined)

  // Drill-in: ?card=<slug> — the SpendingPage ?month= grammar (replace, not push).
  const [searchParams, setSearchParams] = useSearchParams()
  const cardParam = searchParams.get('card')
  const setCardParam = (slug: string | null) => {
    setSearchParams(
      (current) => {
        const copy = new URLSearchParams(current)
        if (slug === null) copy.delete('card')
        else copy.set('card', slug)
        return copy
      },
      { replace: true },
    )
  }

  const load = useCallback(() => {
    Promise.all([
      fetchCreditCards(),
      fetchRewardCategories(),
      fetchRewardRates(),
      fetchCategories(),
      fetchMatrix(),
      fetchAccounts(),
    ])
      .then(([cardsData, categoriesData, ratesData, spendingData, matrixData, accountsData]) => {
        const snapshot: CreditCardsSnapshot = {
          cards: cardsData,
          categories: categoriesData,
          rates: ratesData,
          spendingCategories: spendingData,
          matrix: matrixData,
          accounts: accountsData,
        }
        const previous = getSnapshot<CreditCardsSnapshot>(SNAPSHOT_KEY)
        setSnapshot(SNAPSHOT_KEY, snapshot)
        setError(null)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(snapshot))
          return
        setFromCache(false)
        setCards(cardsData)
        setCategories(categoriesData)
        setRates(ratesData)
        setSpendingCategories(spendingData)
        setMatrix(matrixData)
        setAccounts(accountsData)
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load credit cards')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const beginLoad = () => {
    setLoading(true)
    setError(null)
  }

  const activeCards = useMemo(() => (cards ?? []).filter((c) => c.is_active), [cards])
  const activeCategories = useMemo(
    () => (categories ?? []).filter((c) => c.is_active),
    [categories],
  )

  const suggested = useMemo(
    () => (matrix ? suggestedAnnualSpend(matrix) : new Map<number, number>()),
    [matrix],
  )
  const weights = useMemo(() => {
    const out = new Map<number, number | null>()
    for (const category of categories ?? []) out.set(category.id, resolveWeight(category, suggested))
    return out
  }, [categories, suggested])

  const result = useMemo(
    () =>
      optimize(
        toMathCards(cards ?? []),
        toMathCategories(categories ?? [], weights),
        toMathRates(rates ?? []),
      ),
    [cards, categories, rates, weights],
  )

  const activeCard = useMemo(
    () => (cardParam === null ? null : ((cards ?? []).find((c) => c.slug === cardParam) ?? null)),
    [cards, cardParam],
  )

  const closeDetail = (cardId: number) => {
    setCardParam(null)
    // Hand focus back to the column header that opened the drill (house hand-off).
    setTimeout(() => document.getElementById(`card-col-${cardId}`)?.focus(), 0)
  }

  const saveRates = (puts: RewardRatePut[]) => {
    if (puts.length === 0) return Promise.resolve()
    setBusy(true)
    return putRewardRates(puts)
      .then((fresh) => {
        setRates(fresh) // the PUT returns the full post-save list — no refetch
      })
      .finally(() => setBusy(false))
  }

  const kpis = useMemo(() => {
    if (!cards) return null
    const totalLine = activeCards.reduce(
      (acc, card) => acc + (card.current_limit === null ? 0 : Number(card.current_limit)),
      0,
    )
    return {
      totalLine,
      optimal: result.optimalTotal,
      net: result.lineupNet,
      count: activeCards.length,
    }
  }, [cards, activeCards, result])

  const valueRows = useMemo(
    () =>
      [...result.cardValues]
        .sort((a, b) => b.net - a.net)
        .map((v) => {
          const card = (cards ?? []).find((c) => c.id === v.cardId)
          return {
            name: card?.name ?? String(v.cardId),
            marginal: v.marginal,
            credits: v.countedCredits,
            fee: v.annualFee,
            net: v.net,
          }
        }),
    [result, cards],
  )
  const valueOption = useMemo(
    () => (valueRows.length ? cardValueChartOption(valueRows) : null),
    [valueRows],
  )
  const droppable = valueRows.filter((r) => r.net <= 0).map((r) => r.name)

  const lineCards = useMemo(
    () =>
      activeCards
        .filter((card) => card.limit_events.length > 0)
        .map((card) => ({ name: card.name, events: card.limit_events })),
    [activeCards],
  )
  const lineMonths = useMemo(() => limitMonths(lineCards, currentMonthIso()), [lineCards])
  const lineOption = useMemo(
    () =>
      lineCards.length > 0
        ? creditLineChartOption(lineCards, lineMonths, { includeTotal: lineCards.length > 1 })
        : null,
    [lineCards, lineMonths],
  )

  return (
    <div className="page credit-cards-page">
      <div className="page-header">
        <h1>Credit cards</h1>
        <div className="spacer" />
        <button
          className="button button-primary"
          onClick={() => document.getElementById('card-name')?.focus()}
        >
          + Add card
        </button>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button
            className="button"
            onClick={() => {
              beginLoad()
              load()
            }}
          >
            Retry
          </button>
        </div>
      )}

      {activeCard ? (
        <CardDetail
          key={activeCard.id}
          card={activeCard}
          result={result}
          rates={rates ?? []}
          categories={categories ?? []}
          accounts={accounts}
          busy={busy}
          onClose={() => closeDetail(activeCard.id)}
          onChanged={load}
        />
      ) : (
        <>
          {kpis && (
            <div className="kpi-row">
              <StatTile
                label="Total credit line"
                value={formatCurrency(kpis.totalLine)}
                hint="Sum of every active card's current limit."
              />
              <StatTile
                label="Optimal rewards (est.)"
                value={`${formatCurrency(kpis.optimal)}/yr`}
                hint="What the whole lineup earns per year if every weighted category goes on its best card. An estimate from your spend weights — actual card usage isn't tracked."
              />
              <StatTile
                label="Net after fees (est.)"
                value={`${formatCurrency(kpis.net)}/yr`}
                hint="Optimal rewards plus counted credits minus annual fees, across active cards."
              />
              <StatTile
                label="Active cards"
                value={String(kpis.count)}
                hint="Archived cards keep their history but sit outside the matrix and the math."
              />
            </div>
          )}

          <div className={`card-grid loading-dim${loading ? ' is-loading' : ''}`}>
            {cards !== null && <CardsPanel cards={cards} accounts={accounts} onChanged={load} />}

            {categories !== null && (
              <CategoriesPanel
                categories={categories}
                cards={cards ?? []}
                spendingCategories={spendingCategories}
                suggested={suggested}
                onChanged={load}
              />
            )}

            {activeCards.length > 0 && activeCategories.length > 0 ? (
              <RewardsMatrix
                cards={activeCards}
                categories={activeCategories}
                rates={rates ?? []}
                result={result}
                weights={weights}
                busy={busy}
                onCardClick={(card) => setCardParam(card.slug)}
                onSaveRates={saveRates}
              />
            ) : (
              !loading &&
              !error && (
                <div className="card span-12">
                  <h2 className="eyebrow">Rewards matrix</h2>
                  <div className="empty-note">
                    The matrix appears once there is at least one active card and one category —
                    add a card above
                    {cards !== null && (categories ?? []).length === 0
                      ? ' and seed the categories'
                      : ''}
                    .
                  </div>
                </div>
              )
            )}

            {valueOption && (
              <div className="card span-12">
                <h2 className="eyebrow">
                  Is each card worth keeping? (est.)
                  <InfoHint text="Marginal value (optimal lineup with the card minus without it) plus counted credits minus the annual fee. A $0 bar means the rest of the lineup already catches that spend." />
                </h2>
                <EChart
                  option={valueOption}
                  height={Math.max(140, valueRows.length * 34 + 70)}
                  ariaLabel="Horizontal bars of each card's estimated net annual value"
                  animateEntrance={!fromCache}
                />
                {droppable.length > 0 && (
                  <p className="drill-hint">
                    Droppable on these numbers: {droppable.join(', ')} — zero or negative net value
                    after fees.
                  </p>
                )}
              </div>
            )}

            <div className="card span-12">
              <h2 className="eyebrow">
                Credit line history
                <InfoHint text="Each card's limit as a step line — level between changes, stepping at each dated event — plus the total line across active cards." />
              </h2>
              {lineOption ? (
                <EChart
                  option={lineOption}
                  height={300}
                  ariaLabel="Step chart of credit limits over time per card, with the total"
                  animateEntrance={!fromCache}
                />
              ) : (
                !loading && (
                  <div className="empty-note">
                    No limit history yet — open a card's details and add its opening credit line.
                  </div>
                )
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
