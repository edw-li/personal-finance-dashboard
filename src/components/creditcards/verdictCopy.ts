import { asOfPhrase } from '../../utils/asOf'
import { formatCurrency, formatDate, formatPct } from '../../utils/format'
import type { ClosingEffect } from './closingEffect'
import {
  cardTies,
  pinCost,
  roundsToZero,
  verdictKind,
  type CardValue,
  type CardVerdictKind,
  type OptimizerResult,
  type TieGroup,
} from './rewardsMath'

// The words behind the three card verdicts (2026-09-23 spec §B6). Pure: figures in, sentences
// out, so the footer, the chart tooltip and the drill-in say one thing one way. Every sentence
// names the noun and the reason — "free to keep" has to say WHY it earns nothing extra (a tie,
// never the best rate, a pin) and what closing would give up, or it is only a softer "droppable".
// The money edges (half a cent, a costly pin) are rewardsMath's: read, never re-spelled here.

/** "Robinhood Gold", "Autograph and Venture X", "A, B and C". */
function andList(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/**
 * "ties Robinhood Gold on Dining, Groceries and Streaming" — null with nothing tied.
 *
 * Explained by the FEWEST partner cards: the card tying the most of these categories is named
 * first, and another partner only for categories the first does not tie. Every tie needs just
 * one partner to be the reason ("without it, that spend earns the same on the other card"), and
 * listing each partner SET read as a paragraph on production data (Savor ties Robinhood Gold on
 * four categories, three of them with other cards as well). `maxCategories` shortens each
 * partner's list to a count ("Dining, Groceries and 3 more").
 */
export function tieWords(
  groups: TieGroup[],
  cardName: (id: number) => string,
  categoryName: (id: number) => string,
  maxCategories = Infinity,
): string | null {
  // Every tied category once, in the optimizer's order, and which partners tie each.
  const order: number[] = []
  const partnersOf = new Map<number, Set<number>>()
  for (const group of groups)
    for (const categoryId of group.categoryIds) {
      if (!partnersOf.has(categoryId)) {
        order.push(categoryId)
        partnersOf.set(categoryId, new Set())
      }
      for (const partner of group.withCardIds) partnersOf.get(categoryId)?.add(partner)
    }
  const uncovered = new Set(order)
  const parts: { partner: number; categories: number[] }[] = []
  while (uncovered.size > 0) {
    const coverage = new Map<number, number[]>()
    for (const categoryId of order) {
      if (!uncovered.has(categoryId)) continue
      for (const partner of partnersOf.get(categoryId) ?? [])
        coverage.set(partner, [...(coverage.get(partner) ?? []), categoryId])
    }
    // Categories no partner card ties are nobody's to name — stop, never loop or throw.
    if (coverage.size === 0) break
    const [partner, categories] = [...coverage.entries()].sort(
      ([a, ca], [b, cb]) => cb.length - ca.length || cardName(a).localeCompare(cardName(b)),
    )[0]
    parts.push({ partner, categories })
    for (const categoryId of categories) uncovered.delete(categoryId)
  }
  if (parts.length === 0) return null
  // Read in the categories' own order, whichever partner claimed them first.
  parts.sort((a, b) => order.indexOf(a.categories[0]) - order.indexOf(b.categories[0]))
  const phrase = ({ partner, categories }: { partner: number; categories: number[] }) => {
    const names = categories.map(categoryName)
    const shown = names.slice(0, maxCategories)
    const rest = names.length - shown.length
    const list = rest > 0 ? `${shown.join(', ')} and ${rest} more` : andList(shown)
    return `${cardName(partner)} on ${list}`
  }
  return `ties ${parts.map(phrase).join('; ')}`
}

/**
 * The tie that explains a card's rewards — named only when its marginal prints $0.00: a
 * one-at-a-time marginal prices BOTH tied cards at $0, and past that the card's own figure is
 * the story. The ONE place that rule lives (the page, the drill-in, the footer and the chart
 * tooltip all read it).
 */
export function tieReason(
  value: CardValue,
  result: OptimizerResult,
  cardName: (id: number) => string,
  categoryName: (id: number) => string,
  maxCategories = Infinity,
): string | null {
  if (!roundsToZero(value.marginal)) return null
  return tieWords(cardTies(value.cardId, result), cardName, categoryName, maxCategories)
}

/** The short "why" beside a card's name (the footer, the chart tooltip): a pin that costs it
 *  rewards first — that is the thing to fix — else the tie; null when the figures say it all. */
export function verdictNote(value: { marginal: number }, ties: string | null): string | null {
  const pin = pinCost(value)
  if (pin !== null) return `a pin costs ${formatCurrency(pin)}/yr — unpin it`
  return ties
}

/** A card's yearly net with a real minus sign: "−$94.13/yr", "+$116.87/yr", "$0.00/yr". */
export function perYear(net: number): string {
  if (roundsToZero(net)) return `${formatCurrency(0)}/yr`
  return `${net < 0 ? '−' : '+'}${formatCurrency(Math.abs(net))}/yr`
}

/** What a card's rewards and credits come to, e.g. "$31.20 of rewards and $300.00 of credits". */
function brings(value: CardValue): string {
  const rewards = `${formatCurrency(value.marginal)} of rewards`
  return roundsToZero(value.countedCredits)
    ? rewards
    : `${rewards} and ${formatCurrency(value.countedCredits)} of credits`
}

const signedMoney = (amount: number) =>
  `${amount < 0 ? '−' : ''}${formatCurrency(Math.abs(amount))}`

/** Why the card got its verdict — one sentence, branching on the verdict itself so the words
 *  can never tell a different story from the tag beside them. `ties` is `tieReason`'s answer. */
export function verdictReason(value: CardValue, ties: string | null): string {
  const fee = formatCurrency(value.annualFee)
  const pin = pinCost(value)
  const noFee = roundsToZero(value.annualFee)
  switch (verdictKind(value)) {
    case 'earns':
      return noFee
        ? `On these numbers it adds ${formatCurrency(value.net)} a year that the rest of the lineup would not earn.`
        : `On these numbers its ${brings(value)} beat its ${fee} fee by ${formatCurrency(value.net)} a year.`
    case 'costs':
      if (pin !== null) {
        return `On these numbers its ${fee} fee buys nothing back, and a pin sends spend to it at a lower rate than the best card: ${signedMoney(value.net)} a year.`
      }
      // A fee card's $0 marginal can be a tie too (review of spec §B6): two fee cards that tie
      // each other BOTH read as costing money, and closing both would lose the spend — the
      // partner is the reason, and the reader needs its name to close only one.
      if (ties !== null) {
        return roundsToZero(value.countedCredits)
          ? `On these numbers its ${fee} fee buys no extra rewards — it ${ties}, so that spend earns the same without it: ${signedMoney(value.net)} a year.`
          : `On these numbers its ${fee} fee is more than the ${formatCurrency(value.countedCredits)} of credits it brings, and it ${ties}, so its rewards are not extra: ${signedMoney(value.net)} a year.`
      }
      return `On these numbers its ${fee} fee is more than the ${brings(value)} it brings: ${signedMoney(value.net)} a year.`
    case 'free':
      if (!noFee) return `Its ${brings(value)} cover its ${fee} fee exactly.`
      if (pin !== null) {
        return `It has no annual fee, but a pin sends spend to it at a lower rate than the best card, which costs ${formatCurrency(pin)} a year in rewards — unpin it in Manage › Categories & weights.`
      }
      if (ties !== null) {
        return `It has no annual fee, and it ${ties} — without it, that spend earns the same on the other card.`
      }
      return 'It has no annual fee, and the rest of the lineup earns as much on every weighted category.'
  }
}

/** What closing the card would change — the spec's "total credit line $A → $B and, when
 *  balances are known, household utilization X % → Y %" — plus, for a card worth keeping
 *  open, the credit history it carries. Only "costs" and "free" cards are asked this. */
export function closingSentence(
  kind: Exclude<CardVerdictKind, 'earns'>,
  value: CardValue,
  effect: ClosingEffect,
  card: { opened_on: string | null; oldest: boolean },
): string {
  // A free card whose pin costs rewards is the one free card closing does save on — the pin's
  // cost — and unpinning saves the same while keeping the card (its reason says unpin it).
  const pin = pinCost(value)
  const saves =
    kind === 'costs'
      ? `Closing it saves ${formatCurrency(-value.net)} a year on these numbers`
      : pin !== null
        ? `Closing it would win back the ${formatCurrency(pin)} a year its pin costs — unpinning does that too and keeps the card`
        : 'Closing it saves nothing'
  const line =
    effect.cardLimit === null
      ? 'no credit limit is recorded for it, so the total line shown would not change'
      : `total credit line ${formatCurrency(effect.lineBefore)} → ${formatCurrency(effect.lineAfter)}`
  const pct = (fraction: number) => formatPct(fraction, { signed: false })
  // A card with no recorded limit moves no line, so it cannot move utilization either — a
  // "4.2% → 4.2%" would only be noise.
  const utilization = effect.cardLimit === null ? null : effect.utilization
  const usage =
    utilization === null
      ? ''
      : utilization.after === null
        ? `; household utilization ${pct(utilization.before)} now, with no line left after`
        : // Named by the day the balances describe — "(as of Oct 1)", "(as of Sep 22 ·
          // provisional)" — never by a month key (2026-09-23 spec §T9).
          `; household utilization ${pct(utilization.before)} → ${pct(utilization.after)} with the same balances (${asOfPhrase(utilization)})`
  // The spec's "credit history AND available credit": the line clause above is the available
  // credit; the history is said whether or not the card's opened date is on record.
  const history =
    card.opened_on === null
      ? ' Its age counts toward your credit history.'
      : ` Open since ${formatDate(card.opened_on)}${card.oldest ? ' — the oldest card here' : ''} — its age counts toward your credit history.`
  return `${saves}: ${line}${usage}.${history}`
}
