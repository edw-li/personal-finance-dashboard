import type { CreditCardOut } from '../../types/api'

// What closing a card would change (2026-09-23 spec §B6) — the question a "costs you money" or
// "free to keep" verdict has to answer before anyone acts on it. Pure, display-side sums over
// figures the page already shows (the Total credit line tile's own rule: every card's current
// limit, a missing one counting for nothing). Number() is the chart builders' licence here.

export interface ClosingEffect {
  /** The lineup's total credit line now, and without this card. */
  lineBefore: number
  lineAfter: number
  /** This card's own limit; null when none is recorded — closing it moves no line we can show. */
  cardLimit: number | null
  /** Household utilization now and after, from one balance snapshot; null unless EVERY card
   *  with a limit has a known balance ("when balances are known"). `after` is null when no
   *  line would be left. Carries the snapshot's date and standing, so the sentence can name the
   *  balances by the day they describe (2026-09-23 spec §T9). */
  utilization: {
    before: number
    after: number | null
    month: string
    as_of: string | null
    provisional: boolean
  } | null
}

export interface BalanceSnapshot {
  month: string
  /** The day these balances describe (null = unknown) and whether they were typed before it —
   *  the current net-worth snapshot's, off the summary (2026-09-23 spec §K2, §T9). */
  as_of: string | null
  provisional: boolean
  /** Liability balances by account id, stored negative. */
  byAccount: Map<number, number>
}

function limitOf(card: CreditCardOut): number | null {
  if (card.current_limit === null) return null
  const limit = Number(card.current_limit)
  return limit > 0 ? limit : null
}

export function closingEffect(
  card: CreditCardOut,
  lineup: CreditCardOut[],
  balances: BalanceSnapshot | null,
): ClosingEffect {
  const limited = lineup.filter((c) => limitOf(c) !== null)
  const lineBefore = limited.reduce((sum, c) => sum + (limitOf(c) ?? 0), 0)
  const cardLimit = limitOf(card)
  const closesALine = cardLimit !== null && limited.some((c) => c.id === card.id)
  const lineAfter = closesALine ? lineBefore - cardLimit : lineBefore

  let utilization: ClosingEffect['utilization'] = null
  const known =
    balances !== null &&
    lineBefore > 0 &&
    limited.every((c) => c.account_id !== null && balances.byAccount.has(c.account_id))
  if (known) {
    // The SAME balances over the smaller line: the spend a closed card carried moves to the
    // rest of the lineup, so closing never makes a balance disappear — it only shrinks the
    // line it is measured against.
    const owed = limited.reduce(
      (sum, c) => sum + Math.abs(balances.byAccount.get(c.account_id as number) ?? 0),
      0,
    )
    utilization = {
      before: owed / lineBefore,
      after: lineAfter > 0 ? owed / lineAfter : null,
      month: balances.month,
      as_of: balances.as_of,
      provisional: balances.provisional,
    }
  }
  return { lineBefore, lineAfter, cardLimit, utilization }
}
