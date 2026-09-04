// The freshness sentence the Overview footer prints (2026-09-04 honest-numbers spec §3) —
// pure, no React, no fetching (attention.ts's posture). One clause per hand-entered feed,
// each standing on the month it actually has, and the spending clause naming what the
// window is still waiting for. Balances are the ritual's anchor (spec §3), so "late" is
// measured against them and nothing else.
import type { CoverageOut } from '../../types/api'
import { formatMonth } from '../../utils/format'

export type FreshnessKey = 'balances' | 'spending' | 'net_pay'

export interface FreshnessClause {
  key: FreshnessKey
  text: string
  /** Amber: this feed is at least one whole month behind the balances. */
  lagging: boolean
}

/** How many gap months the parenthetical names before it folds into "+N more". */
export const GAP_NAMES = 3

/** A month as a comparable integer. Never `new Date(iso)` — formatMonth's rule: UTC
 *  parsing shifts a first-of-month a day back in negative offsets. */
function monthIndex(iso: string): number {
  const [year, month] = iso.split('-').map(Number)
  return year * 12 + month
}

/** The newest month of a feed: the wire's own `latest` when the server sends it, else the
 *  tail of the ascending array — the same figure by construction, so a backend older than
 *  this program still gets a footer instead of a blank. */
function latestOf(coverage: CoverageOut, key: FreshnessKey): string | null {
  return coverage.latest?.[key] ?? coverage[key][coverage[key].length - 1] ?? null
}

/**
 * The balances window (spec §3): first snapshot month … latest, inclusive. Balances are the
 * ritual's anchor, so a month outside them was never part of the book. The server windows
 * `spending_missing` and `net_pay_missing` itself but NOT `spending_empty` — every surface
 * that names an empty month filters it through here, so the footer and the strip cannot
 * disagree about which months the window even contains.
 */
export function insideBalancesWindow(coverage: CoverageOut): (month: string) => boolean {
  const months = coverage.balances
  // No balances = no window at all, and nothing can be inside one that does not exist.
  if (months.length === 0) return () => false
  const first = monthIndex(months[0])
  const last = monthIndex(months[months.length - 1])
  return (month) => monthIndex(month) >= first && monthIndex(month) <= last
}

/** "Aug" inside the clause's own year, "Aug 2025" outside it: the clause already names the
 *  year once, and repeating it on every gap turns a footer into a paragraph. */
function gapName(month: string, referenceYear: string | null): string {
  return month.slice(0, 4) === referenceYear ? formatMonth(month).slice(0, 3) : formatMonth(month)
}

/**
 * The spending clause's parenthetical: every month AFTER the latest entered one, labelled
 * `missing` (no rows at all) or `empty` (saved as all $0.00), in calendar order. The TAIL
 * only — an older hole is a repair job the attention strip and the Health card own, while
 * this line answers "where does this page stand", a question about the end of the window.
 */
export function spendingGaps(coverage: CoverageOut): string {
  const entered = latestOf(coverage, 'spending')
  const floor = entered === null ? 0 : monthIndex(entered)
  const reference = (entered ?? latestOf(coverage, 'balances'))?.slice(0, 4) ?? null
  // `spending_missing` arrives windowed; `spending_empty` does not (see the field's note
  // in types/api.ts), so only that one is filtered here.
  const windowed = insideBalancesWindow(coverage)
  const gaps = [
    ...(coverage.spending_missing ?? []).map((month) => ({ month, word: 'missing' })),
    ...(coverage.spending_empty ?? []).filter(windowed).map((month) => ({ month, word: 'empty' })),
  ]
    .filter((gap) => monthIndex(gap.month) > floor)
    .sort((a, b) => a.month.localeCompare(b.month))
  if (gaps.length === 0) return ''
  const named = gaps
    .slice(0, GAP_NAMES)
    .map((gap) => `${gapName(gap.month, reference)} ${gap.word}`)
  const more = gaps.length - named.length
  return more > 0 ? `${named.join(', ')}, +${more} more` : named.join(', ')
}

/** The three clauses, in reading order. The page prints them with dot separators and wears
 *  the amber class on the ones that lag. */
export function freshnessClauses(coverage: CoverageOut): FreshnessClause[] {
  const balances = latestOf(coverage, 'balances')
  const anchor = balances === null ? null : monthIndex(balances)
  // A feed with no months at all has never started, which its own clause says out loud;
  // amber is for a feed that fell BEHIND a running ritual, never for a fresh database.
  const lags = (month: string | null): boolean =>
    anchor !== null && month !== null && anchor - monthIndex(month) >= 1
  const spending = latestOf(coverage, 'spending')
  const netPay = latestOf(coverage, 'net_pay')
  const gaps = spendingGaps(coverage)
  return [
    {
      key: 'balances',
      text:
        balances === null ? 'Balances — no months' : `Balances through ${formatMonth(balances)}`,
      // The anchor cannot lag itself.
      lagging: false,
    },
    {
      key: 'spending',
      text:
        spending === null
          ? 'Spending — no months'
          : `Spending through ${formatMonth(spending)}${gaps === '' ? '' : ` (${gaps})`}`,
      lagging: lags(spending),
    },
    {
      key: 'net_pay',
      text: netPay === null ? 'Net pay — no months' : `Net pay through ${formatMonth(netPay)}`,
      lagging: lags(netPay),
    },
  ]
}
