// The freshness sentence the Overview's Data status card and Settings › System print
// (2026-09-04 honest-numbers spec §3; 2026-09-23 spec §T4) — pure, no React, no fetching
// (attention.ts's posture). One clause per hand-entered feed. Balances are named by the day they
// describe ("as of Sep 22 — provisional, for Oct 1"); spending and take-home by the newest ENDED
// month that is complete, then what is still to come: the month in progress, a month partly
// entered or not entered and whether it is due or overdue. A feed wears amber only when one of
// its parts is overdue (`GET /coverage` `time`, services/month_status.py) — never merely for
// trailing the balances, which in the monthly routine it always does: balances are due on the
// 1st, the month just ended's flows once its charges have posted.
import type { CoverageOut, FlowsPartOut, TimeStatusOut } from '../../types/api'
import { formatAsOf } from '../../utils/asOf'
import { formatMonth } from '../../utils/format'
import { dayName } from '../../utils/timeWords'

export type FreshnessKey = 'balances' | 'spending' | 'net_pay'

export interface FreshnessClause {
  key: FreshnessKey
  /** The row's <dt>: "Balances as of" / "Spending through" while the feed has months, the bare
   *  feed name once it never started. */
  label: string
  /** The row's <dd>: the date or month, then what is still to come — or "no months". */
  detail: string
  /** `${label} ${detail}` as one sentence (Settings › System prints this). */
  text: string
  /** Amber: one of this feed's parts is overdue (2026-09-23 spec §T4). */
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

/** A clause from its parts: "<name> through <month>" or "<name> — no months", then the tail. */
function clause(key: FreshnessKey, name: string, latest: string | null, tail: string, lagging: boolean): FreshnessClause {
  if (latest === null) {
    const detail = `no months${tail}`
    return { key, label: name, detail, text: `${name} — ${detail}`, lagging }
  }
  const detail = `${formatMonth(latest)}${tail}`
  return { key, label: `${name} through`, detail, text: `${name} through ${detail}`, lagging }
}

/** Without a time status — an empty book, or a backend older than it — the clauses name the
 *  months each feed has and never wear amber: "a month behind the balances" is the routine, not
 *  a lapse (2026-09-23 spec §T4). */
function presenceClauses(coverage: CoverageOut): FreshnessClause[] {
  const gaps = spendingGaps(coverage)
  return [
    clause('balances', 'Balances', latestOf(coverage, 'balances'), '', false),
    clause('spending', 'Spending', latestOf(coverage, 'spending'), gaps === '' ? '' : ` (${gaps})`, false),
    clause('net_pay', 'Net pay', latestOf(coverage, 'net_pay'), '', false),
  ]
}

/** "Balances as of Sep 22 — provisional, for Oct 1" (+ " · Oct 1 due|overdue" while the current
 *  month has none, + " · Oct 1 still provisional" for an earlier snapshot never confirmed);
 *  amber only when the balances are overdue or an earlier snapshot stayed provisional. */
function balancesClause(time: TimeStatusOut): FreshnessClause {
  const current = time.current_snapshot
  const tails: string[] = []
  if (time.balances.status === 'missing') {
    tails.push(` · ${dayName(time.balances.due_on)} ${time.balances.overdue ? 'overdue' : 'due'}`)
  }
  const stayed = time.provisional_past[0]
  if (stayed !== undefined && stayed.month !== current?.month) {
    tails.push(` · ${dayName(stayed.month)} still provisional`)
  }
  const lagging = time.balances.overdue || time.provisional_past.length > 0
  if (current === null) {
    const detail = `no months${tails.join('')}`
    return { key: 'balances', label: 'Balances', detail, text: `Balances — ${detail}`, lagging }
  }
  const detail =
    formatAsOf(current) +
    (current.provisional ? ` — provisional, for ${dayName(current.month)}` : '') +
    tails.join('')
  return { key: 'balances', label: 'Balances as of', detail, text: `Balances as of ${detail}`, lagging }
}

/** Spending or take-home ("Net pay"): through the newest ended month that is complete, then
 *  " · Sep in progress" (the running month has entries), the newest month still to come —
 *  " · Sep partly entered — due" / " · Sep due" / "— overdue" — and any older ones after the
 *  latest in brackets. Amber when one of those is overdue. An older hole before the latest
 *  complete month is the attention strip's and the Health card's job, not this line's. */
function flowsClause(coverage: CoverageOut, time: TimeStatusOut, key: 'spending' | 'net_pay'): FreshnessClause {
  const current = time.current_month
  const flows = new Map(time.flows_due.map((part) => [part.month, part]))
  const lacks = (part: FlowsPartOut | undefined) =>
    part !== undefined && (key === 'spending' ? part.spending !== 'entered' : !part.take_home_entered)
  const feed = key === 'spending' ? coverage.spending : coverage.net_pay
  const complete = [...feed].sort().filter((month) => month < current && !lacks(flows.get(month)))
  const latest = complete.at(-1) ?? null
  const reference = (latest ?? latestOf(coverage, 'balances'))?.slice(0, 4) ?? null
  const tails: string[] = []
  if (feed.includes(current)) tails.push(` · ${gapName(current, reference)} in progress`)
  const pending = time.flows_due.filter((part) => lacks(part) && (latest === null || part.month > latest)) // newest first
  const [newest, ...older] = pending
  if (newest !== undefined) {
    const when = newest.overdue ? 'overdue' : 'due'
    tails.push(
      key === 'spending' && newest.spending === 'partial'
        ? ` · ${gapName(newest.month, reference)} partly entered — ${when}`
        : ` · ${gapName(newest.month, reference)} ${when}`,
    )
  }
  if (older.length > 0) {
    const empty = new Set(coverage.spending_empty ?? [])
    const words = [...older].reverse().map((part) => {
      const word =
        key === 'spending' && part.spending === 'partial'
          ? 'partly entered'
          : key === 'spending' && empty.has(part.month)
            ? 'empty'
            : 'missing'
      return `${gapName(part.month, reference)} ${word}`
    })
    const named = words.slice(0, GAP_NAMES)
    const more = words.length - named.length
    tails.push(` (${named.join(', ')}${more > 0 ? `, +${more} more` : ''})`)
  }
  return clause(key, key === 'spending' ? 'Spending' : 'Net pay', latest, tails.join(''), pending.some((part) => part.overdue))
}

/** The three clauses, in reading order. The page prints them as dt/dd rows (Settings › System
 *  as sentences) and wears the amber class on the ones that are overdue. */
export function freshnessClauses(coverage: CoverageOut): FreshnessClause[] {
  const time = coverage.time
  if (time == null) return presenceClauses(coverage)
  return [balancesClause(time), flowsClause(coverage, time, 'spending'), flowsClause(coverage, time, 'net_pay')]
}
