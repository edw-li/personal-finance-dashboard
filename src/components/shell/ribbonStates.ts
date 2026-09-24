import type { SnapshotStateOut, TimeStatusOut } from '../../types/api'
import { dayName, dueByName, monthName } from '../../utils/timeWords'

// What one ribbon chip says (2026-09-23 spec §T8) — pure. The two halves of a chip are the two
// INDEPENDENT parts of the monthly update: the left is that month's 1st balances — filled when
// final, hatched when provisional (typed before the 1st) — and the right is that month's own
// spending and take-home — filled only once the spending is ENTERED (K3: not merely saved while
// the month was running) and the take-home is in, hatched while the month is in progress, partly
// entered or missing one of the two, empty when it has neither. A month whose flows are due wears
// a dot, amber once overdue — and the words say the same, because a colour is never the only
// channel. Everything comes from `GET /coverage`: presence lists and `time` (never re-derived).

export type Half = 'full' | 'partial' | 'empty'

export interface ChipState {
  balances: Half
  flows: Half
  due: 'due' | 'overdue' | null
  /** The chip's words after its month: "Sep 1 balances · spending entered during September
   *  (partial) · take-home missing · due by Oct 15". */
  words: string
}

/** The feeds a chip reads: coverage's presence lists and, from a current backend, its `time`. */
export interface RibbonFeeds {
  balances: ReadonlySet<string>
  /** coverage.spending — ENTERED months (a non-zero amount, a take-home or a confirmed zero). */
  spending: ReadonlySet<string>
  netPay?: ReadonlySet<string>
  time?: TimeStatusOut | null
}

/** The presence words the ribbon printed before the time model — an older backend's. */
function legacyState(month: string, feeds: RibbonFeeds): ChipState {
  const hasBalances = feeds.balances.has(month)
  const hasSpending = feeds.spending.has(month)
  const words =
    hasBalances && hasSpending
      ? 'balances and spending entered'
      : hasBalances
        ? 'balances entered, spending missing'
        : hasSpending
          ? 'spending entered, balances missing'
          : 'nothing entered'
  return { balances: hasBalances ? 'full' : 'empty', flows: hasSpending ? 'full' : 'empty', due: null, words }
}

/** Every snapshot state `time` names, by month. A balances month not named there is final —
 *  `provisional_past` lists the earlier provisional ones — unless its month is still ahead. */
function knownStates(time: TimeStatusOut): Map<string, SnapshotStateOut> {
  const states = [time.current_snapshot, time.previous_snapshot, time.balances.snapshot, ...time.provisional_past]
  return new Map(states.flatMap((state) => (state === null ? [] : [[state.month, state]])))
}

export function chipState(month: string, feeds: RibbonFeeds, currentMonth: string): ChipState {
  const time = feeds.time
  if (time == null) return legacyState(month, feeds)

  const first = dayName(month)
  let balances: Half = 'empty'
  let balancesWords = `${first} balances not recorded`
  if (feeds.balances.has(month)) {
    const provisional = knownStates(time).get(month)?.provisional ?? month > currentMonth
    balances = provisional ? 'partial' : 'full'
    balancesWords = provisional ? `${first} balances recorded early (provisional)` : `${first} balances`
  }

  const hasSpending = feeds.spending.has(month)
  const hasTakeHome = feeds.netPay?.has(month) ?? false
  const name = monthName(month)
  if (month >= currentMonth) {
    const running = month === currentMonth ? `${name} in progress` : `${name} has not begun`
    return {
      balances,
      flows: hasSpending || hasTakeHome ? 'partial' : 'empty',
      due: null,
      words: `${balancesWords} · spending not due yet (${running})`,
    }
  }

  const flows = time.flows_due.find((part) => part.month === month)
  if (flows !== undefined) {
    const spendingWords =
      flows.spending === 'partial'
        ? `spending entered during ${name} (partial)`
        : flows.spending === 'missing'
          ? 'spending not entered'
          : 'spending entered'
    const half: Half = flows.spending === 'missing' && !flows.take_home_entered ? 'empty' : 'partial'
    const dueWords = flows.overdue ? `overdue (was due by ${dueByName(flows)})` : `due by ${dueByName(flows)}`
    return {
      balances,
      flows: half,
      due: flows.overdue ? 'overdue' : 'due',
      words: `${balancesWords} · ${spendingWords} · ${flows.take_home_entered ? 'take-home entered' : 'take-home missing'} · ${dueWords}`,
    }
  }

  // Not listed: from the book's first snapshot month on, both parts are in (flows_due lists every
  // ended month that lacks one). Before it, only presence can speak.
  const bookStart = [...feeds.balances].sort()[0]
  if (bookStart !== undefined && month >= bookStart) {
    return { balances, flows: 'full', due: null, words: `${balancesWords} · spending and take-home entered` }
  }
  const presence: Half = hasSpending && hasTakeHome ? 'full' : hasSpending || hasTakeHome ? 'partial' : 'empty'
  const presenceWords =
    hasSpending && hasTakeHome
      ? 'spending and take-home entered'
      : hasSpending
        ? 'spending entered · take-home missing'
        : hasTakeHome
          ? 'take-home entered · spending missing'
          : 'nothing entered'
  return { balances, flows: presence, due: null, words: `${balancesWords} · ${presenceWords}` }
}
