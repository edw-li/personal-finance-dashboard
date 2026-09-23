import { formatCurrency, formatDate, formatMonth, formatPct } from '../../utils/format'
import type { ClosingEffect } from './closingEffect'
import type { CardValue, CardVerdictKind, TieGroup } from './rewardsMath'

// The words behind the three card verdicts (2026-09-23 spec §B6). Pure: figures in, sentences
// out, so the footer, the chart tooltip and the drill-in say one thing one way. Every sentence
// names the noun and the reason — "free to keep" has to say WHY it earns nothing extra (a tie,
// never the best rate, a pin) and what closing would give up, or it is only a softer "droppable".

const HALF_CENT = 0.005

/** "Robinhood Gold", "Autograph and Venture X", "A, B and C". */
function andList(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** "ties Robinhood Gold on Dining, Groceries; Autograph on Travel" — null with nothing tied.
 *  `maxCategories` shortens each group's list to a count ("… and 3 more"). */
export function tieWords(
  groups: TieGroup[],
  cardName: (id: number) => string,
  categoryName: (id: number) => string,
  maxCategories = Infinity,
): string | null {
  if (groups.length === 0) return null
  const parts = groups.map((group) => {
    const names = group.categoryIds.map(categoryName)
    const shown = names.slice(0, maxCategories)
    const rest = names.length - shown.length
    const categories = rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ')
    return `${andList(group.withCardIds.map(cardName))} on ${categories}`
  })
  return `ties ${parts.join('; ')}`
}

/** A card's yearly net with a real minus sign: "−$94.13/yr", "+$116.87/yr", "$0.00/yr". */
export function perYear(net: number): string {
  if (Math.abs(net) < HALF_CENT) return `${formatCurrency(0)}/yr`
  return `${net < 0 ? '−' : '+'}${formatCurrency(Math.abs(net))}/yr`
}

/** What a card's rewards and credits come to, e.g. "$31.20 of rewards and $300.00 of credits". */
function brings(value: CardValue): string {
  const rewards = `${formatCurrency(value.marginal)} of rewards`
  return value.countedCredits >= HALF_CENT
    ? `${rewards} and ${formatCurrency(value.countedCredits)} of credits`
    : rewards
}

const signedMoney = (amount: number) =>
  `${amount < 0 ? '−' : ''}${formatCurrency(Math.abs(amount))}`

/** Why the card got its verdict — one sentence. `ties` is `tieWords` for a $0-marginal card. */
export function verdictReason(value: CardValue, ties: string | null): string {
  const hasFee = value.annualFee >= HALF_CENT
  if (value.net >= HALF_CENT) {
    return hasFee
      ? `On these numbers its ${brings(value)} beat its ${formatCurrency(value.annualFee)} fee by ${formatCurrency(value.net)} a year.`
      : `On these numbers it adds ${formatCurrency(value.net)} a year that the rest of the lineup would not earn.`
  }
  if (hasFee && value.net <= -HALF_CENT) {
    return value.marginal < -HALF_CENT
      ? `On these numbers its ${formatCurrency(value.annualFee)} fee buys nothing back, and a pin sends spend to it at a lower rate than the best card: ${signedMoney(value.net)} a year.`
      : `On these numbers its ${formatCurrency(value.annualFee)} fee is more than the ${brings(value)} it brings: ${signedMoney(value.net)} a year.`
  }
  // Free to keep.
  if (hasFee) {
    return `Its ${brings(value)} cover its ${formatCurrency(value.annualFee)} fee exactly.`
  }
  if (value.marginal < -HALF_CENT) {
    return `It has no annual fee, but a pin sends spend to it at a lower rate than the best card, which costs ${formatCurrency(-value.marginal)} a year in rewards — unpin it in Manage › Categories & weights.`
  }
  if (ties !== null) {
    return `It has no annual fee, and it ${ties} — without it, that spend earns the same on the other card.`
  }
  return 'It has no annual fee, and the rest of the lineup earns as much on every weighted category.'
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
  const saves =
    kind === 'costs'
      ? `Closing it saves ${formatCurrency(-value.net)} a year on these numbers`
      : 'Closing it saves nothing'
  const line =
    effect.cardLimit === null
      ? 'no credit limit is recorded for it, so the total line shown would not change'
      : `total credit line ${formatCurrency(effect.lineBefore)} → ${formatCurrency(effect.lineAfter)}`
  const pct = (fraction: number) => formatPct(fraction, { signed: false })
  const utilization = effect.utilization
  const usage =
    utilization === null
      ? ''
      : utilization.after === null
        ? `; household utilization ${pct(utilization.before)} now, with no line left after`
        : `; household utilization ${pct(utilization.before)} → ${pct(utilization.after)} with the same balances (as of ${formatMonth(utilization.month)})`
  const history =
    card.opened_on === null
      ? ''
      : ` Open since ${formatDate(card.opened_on)}${card.oldest ? ' — the oldest card here' : ''} — its age counts toward your credit history.`
  return `${saves}: ${line}${usage}.${history}`
}
