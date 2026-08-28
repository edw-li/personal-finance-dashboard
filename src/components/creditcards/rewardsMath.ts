import type { OwnerScope } from '../../api/netWorth'
import type {
  CreditCardOut,
  RewardCategoryOut,
  RewardRateOut,
  SpendingMatrix,
} from '../../types/api'

export const TIE_EPSILON = 1e-6

// Internal math shapes — plain numbers, decoupled from the Decimal-string wire.
export interface MathCard {
  id: number
  name: string
  annualFee: number
  pointValueCents: number
  isActive: boolean
  countedCredits: number
  /** Owner; null = JOINT. Only householdAdvantage reads it — optimize() is owner-blind by
   *  design, because the whole lineup is what the matrix is answering about. */
  ownerId: number | null
}

export interface MathCategory {
  id: number
  name: string
  /** Annual $ weight; null = unweighted (excluded from every $ figure). */
  weight: number | null
  pinnedCardId: number | null
  isActive: boolean
}

export interface MathRate {
  cardId: number
  categoryId: number
  multiplier: number
  monthlyCap: number | null
}

export interface Allocation {
  cardId: number
  amount: number
  earnings: number
}

export interface CategoryVerdict {
  categoryId: number
  /** ALL co-best active cards (the green set) — pure effective-rate winners. */
  bestCardIds: number[]
  tie: boolean
  /** The allocated "use this card" answer: pin > best (AF ↑, wins ↓, name ↑). */
  primaryCardId: number | null
  /** Cap-aware spend split; empty when the category is unweighted. */
  allocations: Allocation[]
  earnings: number
}

export interface CardValue {
  cardId: number
  marginal: number
  countedCredits: number
  annualFee: number
  net: number
  wonCategoryIds: number[]
}

export interface OptimizerResult {
  verdicts: Map<number, CategoryVerdict>
  /** Allocated $/yr per card (the matrix footer row). */
  cardEarnings: Map<number, number>
  cardValues: CardValue[]
  optimalTotal: number
  /** optimalTotal + counted credits − fees, over ACTIVE cards (spec §4 KPI mapping —
   *  NOT Σ net(card): marginals don't sum to the total). */
  lineupNet: number
}

export function effectiveRate(multiplier: number, pointValueCents: number): number {
  // 3x at 1.0¢ = 0.03; 2x at 1.7¢ = 0.034.
  return (multiplier * pointValueCents) / 100
}

interface RankedCell {
  cardId: number
  rate: number
  monthlyCap: number | null
}

function rankCells(
  categoryId: number,
  rates: MathRate[],
  cardById: Map<number, MathCard>,
): RankedCell[] {
  return rates
    .filter((r) => r.categoryId === categoryId && cardById.get(r.cardId)?.isActive)
    .map((r) => ({
      cardId: r.cardId,
      rate: effectiveRate(r.multiplier, cardById.get(r.cardId)!.pointValueCents),
      monthlyCap: r.monthlyCap,
    }))
    .sort((a, b) => b.rate - a.rate)
}

/** Outright-win counts (unique best per category, pins ignored) — the second
 *  tie-break: consolidating onto a card you already reach for. */
function outrightWins(
  categories: MathCategory[],
  rates: MathRate[],
  cardById: Map<number, MathCard>,
): Map<number, number> {
  const wins = new Map<number, number>()
  for (const category of categories) {
    if (!category.isActive) continue
    const ranked = rankCells(category.id, rates, cardById)
    if (ranked.length === 0) continue
    const best = ranked.filter((c) => ranked[0].rate - c.rate <= TIE_EPSILON)
    if (best.length === 1) wins.set(best[0].cardId, (wins.get(best[0].cardId) ?? 0) + 1)
  }
  return wins
}

function pickPrimary(
  ranked: RankedCell[],
  pinnedCardId: number | null,
  cardById: Map<number, MathCard>,
  wins: Map<number, number>,
): number | null {
  if (ranked.length === 0) return null
  if (pinnedCardId !== null && ranked.some((c) => c.cardId === pinnedCardId)) return pinnedCardId
  const best = ranked.filter((c) => ranked[0].rate - c.rate <= TIE_EPSILON)
  const sorted = [...best].sort((a, b) => {
    const cardA = cardById.get(a.cardId)!
    const cardB = cardById.get(b.cardId)!
    if (cardA.annualFee !== cardB.annualFee) return cardA.annualFee - cardB.annualFee
    const winsA = wins.get(a.cardId) ?? 0
    const winsB = wins.get(b.cardId) ?? 0
    if (winsA !== winsB) return winsB - winsA
    return cardA.name.localeCompare(cardB.name)
  })
  return sorted[0].cardId
}

/** Cap-aware winner-take-most: primary absorbs spend up to its cap×12 (uncapped =
 *  everything, even a pinned non-best — that is what a pin means); overflow walks the
 *  remaining cards by rate. */
function allocate(ranked: RankedCell[], primaryId: number, weight: number): Allocation[] {
  const order = [
    ranked.find((c) => c.cardId === primaryId)!,
    ...ranked.filter((c) => c.cardId !== primaryId),
  ]
  const out: Allocation[] = []
  let remaining = weight
  for (const cell of order) {
    if (remaining <= 0) break
    const take = cell.monthlyCap === null ? remaining : Math.min(remaining, cell.monthlyCap * 12)
    if (take <= 0) continue
    out.push({ cardId: cell.cardId, amount: take, earnings: take * cell.rate })
    remaining -= take
  }
  // Every card capped below the weight: the tail earns nothing but is still spent —
  // record it on the LAST card at rate 0? No: it simply falls off the lineup (cash,
  // debit) — the optimizer only claims what the cards can earn.
  return out
}

function computeVerdicts(
  cards: MathCard[],
  categories: MathCategory[],
  rates: MathRate[],
): Map<number, CategoryVerdict> {
  const cardById = new Map(cards.map((c) => [c.id, c]))
  const wins = outrightWins(categories, rates, cardById)
  const verdicts = new Map<number, CategoryVerdict>()
  for (const category of categories) {
    if (!category.isActive) continue
    const ranked = rankCells(category.id, rates, cardById)
    const bestCardIds =
      ranked.length === 0
        ? []
        : ranked.filter((c) => ranked[0].rate - c.rate <= TIE_EPSILON).map((c) => c.cardId)
    const primaryCardId = pickPrimary(ranked, category.pinnedCardId, cardById, wins)
    const allocations =
      category.weight === null || primaryCardId === null
        ? []
        : allocate(ranked, primaryCardId, category.weight)
    verdicts.set(category.id, {
      categoryId: category.id,
      bestCardIds,
      tie: bestCardIds.length > 1,
      primaryCardId,
      allocations,
      earnings: allocations.reduce((acc, a) => acc + a.earnings, 0),
    })
  }
  return verdicts
}

function totalOf(verdicts: Map<number, CategoryVerdict>): number {
  let total = 0
  for (const v of verdicts.values()) total += v.earnings
  return total
}

/** The lineup's net: what the whole set earns, plus what its credits are worth, minus every
 *  annual fee in it. ONE definition — optimize()'s KPI and householdAdvantage's two sides
 *  must be priced identically or the difference between them means nothing. */
function netOf(actives: MathCard[], optimalTotal: number): number {
  return (
    optimalTotal +
    actives.reduce((acc, c) => acc + c.countedCredits, 0) -
    actives.reduce((acc, c) => acc + c.annualFee, 0)
  )
}

export function optimize(
  cards: MathCard[],
  categories: MathCategory[],
  rates: MathRate[],
): OptimizerResult {
  const actives = cards.filter((c) => c.isActive)
  const verdicts = computeVerdicts(actives, categories, rates)
  const optimalTotal = totalOf(verdicts)

  const cardEarnings = new Map<number, number>()
  for (const card of actives) cardEarnings.set(card.id, 0)
  for (const v of verdicts.values())
    for (const a of v.allocations)
      cardEarnings.set(a.cardId, (cardEarnings.get(a.cardId) ?? 0) + a.earnings)

  const cardValues: CardValue[] = actives.map((card) => {
    const without = computeVerdicts(
      actives.filter((c) => c.id !== card.id),
      categories,
      rates,
    )
    const marginal = optimalTotal - totalOf(without)
    const wonCategoryIds = [...verdicts.values()]
      .filter((v) => v.primaryCardId === card.id)
      .map((v) => v.categoryId)
    return {
      cardId: card.id,
      marginal,
      countedCredits: card.countedCredits,
      annualFee: card.annualFee,
      net: marginal + card.countedCredits - card.annualFee,
      wonCategoryIds,
    }
  })

  return {
    verdicts,
    cardEarnings,
    cardValues,
    optimalTotal,
    lineupNet: netOf(actives, optimalTotal),
  }
}

/** Owner-scope membership, the net-worth grammar verbatim: absent (null) is the whole
 *  household, a person id is THEIR cards plus the JOINT ones — either spouse can hold a
 *  joint card — and 'joint' is the NULL-owned slice alone. */
export function ownerMatches(personId: number | null, scope: OwnerScope): boolean {
  if (scope === null) return true
  if (scope === 'joint') return personId === null
  return personId === scope || personId === null
}

/**
 * "Merging our wallets is worth $X/yr": the household lineup's net minus the BEST single
 * owner's, where a single-owner wallet is that person's active cards ∪ the joint ones.
 *
 * Returns null — the tile is absent, never zero — when there is nothing honest to say:
 * fewer than two distinct non-joint owners hold active cards (one person owning everything
 * has no merge to price), or the delta is not positive. The delta really can be negative:
 * lineup net subtracts EVERY fee in the wallet, so a partner's high-fee card that wins no
 * category costs the household more than it costs the other spouse's wallet.
 *
 * Cost is `1 + owners` verdict passes, not `1 + owners` optimizations — nothing here needs
 * the per-card marginal loop that dominates optimize().
 */
export function householdAdvantage(
  cards: MathCard[],
  categories: MathCategory[],
  rates: MathRate[],
): number | null {
  const actives = cards.filter((c) => c.isActive)
  const owners = [...new Set(actives.map((c) => c.ownerId).filter((id) => id !== null))]
  if (owners.length < 2) return null
  const netFor = (wallet: MathCard[]): number =>
    netOf(wallet, totalOf(computeVerdicts(wallet, categories, rates)))
  const household = netFor(actives)
  const best = Math.max(
    // ownerMatches is the single owner-of-record rule the sibling test pins: a person's
    // wallet is their cards plus joint.
    ...owners.map((owner) => netFor(actives.filter((c) => ownerMatches(c.ownerId, owner)))),
  )
  const delta = household - best
  // TIE_EPSILON, not > 0: float dust from three independent sums must not render as
  // "$0/yr" under a headline that claims the household wins.
  return delta > TIE_EPSILON ? delta : null
}

// --- wire adapters -----------------------------------------------------------------------

export function toMathCards(cards: CreditCardOut[]): MathCard[] {
  return cards.map((c) => ({
    id: c.id,
    name: c.name,
    annualFee: Number(c.annual_fee),
    pointValueCents: Number(c.point_value_cents),
    isActive: c.is_active,
    ownerId: c.person_id,
    countedCredits: c.credits
      .filter((credit) => credit.counts)
      .reduce((acc, credit) => acc + Number(credit.annual_value), 0),
  }))
}

export function toMathCategories(
  categories: RewardCategoryOut[],
  weights: Map<number, number | null>,
): MathCategory[] {
  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    weight: weights.get(c.id) ?? null,
    pinnedCardId: c.pinned_card_id,
    isActive: c.is_active,
  }))
}

export function toMathRates(rates: RewardRateOut[]): MathRate[] {
  return rates.map((r) => ({
    cardId: r.card_id,
    categoryId: r.category_id,
    multiplier: Number(r.multiplier),
    monthlyCap: r.monthly_cap === null ? null : Number(r.monthly_cap),
  }))
}

/** Trailing-12-month ANNUALIZED spend per spending category from the matrix: sum of
 *  the last up-to-12 months, scaled by 12/n when fewer months exist — an honest
 *  suggestion, not a claim. Categories with no non-null value in the window are absent. */
export function suggestedAnnualSpend(matrix: SpendingMatrix): Map<number, number> {
  const out = new Map<number, number>()
  const n = Math.min(12, matrix.months.length)
  if (n === 0) return out
  for (const series of matrix.series) {
    const window = series.values.slice(-n)
    let sum = 0
    let any = false
    for (const value of window) {
      if (value === null) continue
      any = true
      sum += Number(value)
    }
    if (any) out.set(series.category_id, (sum * 12) / n)
  }
  return out
}

/** Weight resolution (spec §4): manual override ?? suggestion via the mapping ?? null. */
export function resolveWeight(
  category: RewardCategoryOut,
  suggested: Map<number, number>,
): number | null {
  if (category.annual_spend !== null) return Number(category.annual_spend)
  if (category.spending_category_id !== null) {
    const auto = suggested.get(category.spending_category_id)
    if (auto !== undefined) return auto
  }
  return null
}
