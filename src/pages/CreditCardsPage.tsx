import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import {
  fetchCreditCards,
  fetchRewardCategories,
  fetchRewardRates,
  putRewardRates,
} from '../api/creditCards'
import { fetchHousehold } from '../api/household'
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
  householdAdvantage,
  optimize,
  ownerMatches,
  resolveWeights,
  suggestedAnnualSpend,
  toMathCards,
  toMathCategories,
  toMathRates,
} from '../components/creditcards/rewardsMath'
import type { OwnerScope } from '../api/netWorth'
import type {
  AccountOut,
  CategoryOut,
  CreditCardOut,
  PersonOut,
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
  // null = the whole household, and that scope is byte-identical to the pre-ownership page.
  const [owner, setOwner] = useState<OwnerScope>(null)

  // The roster rides its OWN fetch, outside the six-call snapshot: it changes once a year,
  // and folding it into the snapshot would invalidate every cached cards payload
  // (NetWorthPage's fetchHousehold pattern). A failure degrades to no roster — the owner
  // select then offers Joint alone and the chips do not render.
  const [people, setPeople] = useState<PersonOut[]>([])
  useEffect(() => {
    fetchHousehold()
      .then((data) => setPeople(data.people))
      .catch(() => setPeople([]))
  }, [])
  const orderedPeople = useMemo(
    () => [...people].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.id - b.id),
    [people],
  )

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

  const activeCategories = useMemo(
    () => (categories ?? []).filter((c) => c.is_active),
    [categories],
  )

  const activeCard = useMemo(
    () => (cardParam === null ? null : ((cards ?? []).find((c) => c.slug === cardParam) ?? null)),
    [cards, cardParam],
  )

  const householdCards = useMemo(() => (cards ?? []).filter((c) => c.is_active), [cards])
  const scopedCards = useMemo(
    () => householdCards.filter((c) => ownerMatches(c.person_id, owner)),
    [householdCards, owner],
  )
  // ONE filter point for the whole page: the roster table, the matrix, the four KPI tiles,
  // the card-value bars and the credit-line history all read this or a memo derived from it.
  //
  // The DRILL opts out on purpose. It renders INSTEAD of the grid and the chips, so a person
  // chip left active must not make another owner's card fall out of the optimizer — the only
  // other reason a card has no value is that it is archived, and the detail says exactly
  // that in words.
  const activeCards = activeCard === null ? scopedCards : householdCards

  const suggested = useMemo(
    () => (matrix ? suggestedAnnualSpend(matrix) : new Map<number, number>()),
    [matrix],
  )
  // ONE weight rule for the page (shared suggestions split across the rows mapped to
  // them) — the Categories panel labels its column from the same function.
  const weights = useMemo(() => resolveWeights(categories ?? [], suggested), [categories, suggested])
  // How many matrix rows actually carry dollars. Zero is a SETUP state, not a verdict:
  // every marginal is $0 by construction, so the $ tiles, the keep/drop bars and the
  // "droppable" sentence would all be reporting the absence of weights as if it were the
  // absence of value (production, 2026-09-03: six cards, five "droppable", no weights).
  const weightedCount = useMemo(
    () => activeCategories.filter((c) => (weights.get(c.id) ?? null) !== null).length,
    [activeCategories, weights],
  )
  const hasWeights = weightedCount > 0
  const unweightedCount = activeCategories.length - weightedCount

  const result = useMemo(
    () =>
      optimize(
        toMathCards(activeCards),
        toMathCategories(categories ?? [], weights),
        toMathRates(rates ?? []),
      ),
    [activeCards, categories, rates, weights],
  )

  // Scope-INDEPENDENT by design: "is merging our wallets worth it" is a household question,
  // and the answer must not change because a chip is filtering the table below it.
  const advantage = useMemo(
    () =>
      householdAdvantage(
        toMathCards(householdCards),
        toMathCategories(categories ?? [], weights),
        toMathRates(rates ?? []),
      ),
    [householdCards, categories, rates, weights],
  )

  const ownerNames = useMemo(
    () => new Map(orderedPeople.map((p) => [p.id, p.name])),
    [orderedPeople],
  )
  // One person means there is nothing to choose between: no chips (NetWorthPage's rule).
  const ownerScopes: { scope: OwnerScope; label: string }[] =
    orderedPeople.length > 1
      ? [
          { scope: null, label: 'All' },
          ...orderedPeople.map((p) => ({ scope: p.id as OwnerScope, label: p.name })),
          { scope: 'joint' as OwnerScope, label: 'Joint' },
        ]
      : []

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
          weighted={hasWeights}
          onClose={() => closeDetail(activeCard.id)}
          onChanged={load}
        />
      ) : (
        <>
          {ownerScopes.length > 0 && (
            <div className="cards-owner-row">
              <span className="eyebrow">Whose card</span>
              <div className="segmented" role="group" aria-label="Owner">
                {ownerScopes.map(({ scope, label }) => (
                  <button
                    key={label}
                    type="button"
                    className={owner === scope ? 'active' : ''}
                    aria-pressed={owner === scope}
                    onClick={() => setOwner(scope)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <InfoHint text="A person's view is their own cards plus the joint ones — either of you can hold a joint card. Joint shows only the shared cards. The matrix, the tiles and the credit-line chart follow this; the roster below always lists every card, since it is where ownership is edited." />
            </div>
          )}

          {kpis && (
            <div className="kpi-row">
              <StatTile
                label="Total credit line"
                value={formatCurrency(kpis.totalLine)}
                hint="Sum of every active card's current limit."
              />
              {/* A dash, not "$0.00/yr", until at least one category has a weight — a
                  zero here would be the absence of setup wearing the costume of a figure. */}
              <StatTile
                label="Optimal rewards (est.)"
                value={hasWeights ? `${formatCurrency(kpis.optimal)}/yr` : '—'}
                hint={
                  hasWeights
                    ? "What the whole lineup earns per year if every weighted category goes on its best card. An estimate from your spend weights — actual card usage isn't tracked."
                    : 'No category has a spend weight yet, so there is nothing to add up. Map each reward category to a spending category or type an annual spend in Categories & weights below.'
                }
              />
              <StatTile
                label="Net after fees (est.)"
                value={hasWeights ? `${formatCurrency(kpis.net)}/yr` : '—'}
                hint={
                  hasWeights
                    ? 'Optimal rewards plus counted credits minus annual fees, across active cards.'
                    : 'Needs spend weights first — without them this would just be credits minus fees.'
                }
              />
              <StatTile
                label="Active cards"
                value={String(kpis.count)}
                hint="Archived cards keep their history but sit outside the matrix and the math."
              />
              {/* ABSENT rather than zero when it has nothing honest to say (spec §6): one
                  person owning every card has no merge to price, and fees can make the
                  merge genuinely lose. */}
              {advantage !== null && (
                <StatTile
                  label="Household wallet advantage"
                  value={`${formatCurrency(advantage)}/yr`}
                  delta="beats the best single wallet"
                  tone="positive"
                  hint="Both wallets are priced the same way — optimal rewards plus counted credits minus every annual fee in that wallet — and a single-owner wallet is that person's cards PLUS the joint ones, because either of you can hold a joint card. Hidden when only one person holds cards, or when merging doesn't win."
                />
              )}
            </div>
          )}

          <div className={`card-grid loading-dim${loading ? ' is-loading' : ''}`}>
            {/* Consult before manage (2026-08-31 audit): the matrix and the keep/drop and
                line-history answers lead; the roster and weights that parameterize them
                follow. The header's "+ Add card" still jumps straight to the roster form. */}
            {activeCards.length > 0 && activeCategories.length > 0 ? (
              <RewardsMatrix
                cards={activeCards}
                categories={activeCategories}
                rates={rates ?? []}
                result={result}
                weights={weights}
                ownerNames={ownerNames}
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
                    add a card below
                    {cards !== null && (categories ?? []).length === 0
                      ? ' and seed the categories'
                      : ''}
                    .
                  </div>
                </div>
              )
            )}

            {valueOption && !hasWeights && (
              <div className="card span-12">
                <h2 className="eyebrow">
                  Is each card worth keeping? (est.)
                  <InfoHint text="Marginal value (optimal lineup with the card minus without it) plus counted credits minus the annual fee. Needs at least one weighted category to say anything." />
                </h2>
                <p className="empty-note">
                  No spend weights yet, so the optimizer values every card at $0 and nothing
                  on this page is a verdict. In Categories &amp; weights below, edit each
                  reward category and either pick its spending category — its trailing
                  12-month spend becomes the weight, split evenly when several rows share
                  one — or type an annual spend override. Rows with neither stay out of the
                  $ math.
                </p>
              </div>
            )}
            {valueOption && hasWeights && (
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
                    {unweightedCount > 0 &&
                      ` Excludes ${unweightedCount} unweighted ${
                        unweightedCount === 1 ? 'category' : 'categories'
                      }.`}
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

            {cards !== null && (
              <CardsPanel
                cards={cards}
                accounts={accounts}
                people={orderedPeople}
                onChanged={load}
              />
            )}

            {categories !== null && (
              <CategoriesPanel
                categories={categories}
                cards={cards ?? []}
                spendingCategories={spendingCategories}
                suggested={suggested}
                onChanged={load}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
