import type { Reconciliation, ReconciliationRow } from '../../types/api'
import { formatCurrency, formatDate } from '../../utils/format'
import type { Tone } from '../../utils/tone'

// The "Your inputs vs your records" strip's words (2026-09-23 spec §W4). Pure: every figure is
// the server's — typed, projected, difference, tax effect, the balance if matched — and this
// file only picks clauses and formats. The one client arithmetic is the display-only sign/abs
// the headline tile already does (utils/format.ts's Number() rule), plus whole-dollar rounding
// where the copy says "≈".

/** "$18,265" — the "≈" figures round to whole dollars; the exact cents are in the columns. */
const WHOLE_DOLLARS = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

function wholeDollars(value: string | number): string {
  return WHOLE_DOLLARS.format(Math.abs(Number(value)))
}

/** "Sep 16" — the card is always the current year, so the year would be noise. */
export function dayLabel(iso: string): string {
  return formatDate(iso).replace(/, \d{4}$/, '')
}

/** The typed side: the stored figure, or "not entered" when none of its inputs is stored. */
export function typedText(row: ReconciliationRow): string {
  return row.typed === null ? 'not entered' : formatCurrency(row.typed)
}

/** What the typed salary is made of ("20 pay periods + $27,000 checkpoint"), else null. */
export function typedDetail(row: ReconciliationRow): string | null {
  const parts: string[] = []
  if (row.facts.typed_pay_periods !== null) parts.push(`${Number(row.facts.typed_pay_periods)} pay periods`)
  if (row.facts.typed_checkpoint !== null && Number(row.facts.typed_checkpoint) !== 0)
    parts.push(`${wholeDollars(row.facts.typed_checkpoint)} checkpoint`)
  return parts.length === 0 ? null : parts.join(' + ')
}

const SOURCE_WORDS: Record<ReconciliationRow['source'], string> = {
  paycheck: 'Paycheck',
  comp: 'Comp',
  espp: 'ESPP',
}

/** "Paycheck projects" — which of the app's own records the figure comes from. */
export function projectsWord(row: ReconciliationRow): string {
  return `${SOURCE_WORDS[row.source]} projects`
}

/** How the projection was built, in the row's own terms. */
export function projectedDetail(row: ReconciliationRow, year: number): string | null {
  const { facts } = row
  if (row.key === 'rsu') return 'vests at their vest-day close, later ones at today’s quote'
  if (row.key === 'espp') return `lots sold in ${year}`
  if (facts.capped_at !== null && row.key === 'trad_401k')
    return `capped at the ${year} limit (${wholeDollars(facts.capped_at)})`
  if (facts.capped_at !== null && row.key === 'hsa')
    return `capped at the ${year} limit less the employer deposit (${wholeDollars(facts.capped_at)})`
  if (facts.projected_checks === null || facts.projected_from === null) return null
  return `${facts.projected_checks} checks from ${dayLabel(facts.projected_from)}`
}

/** "+$4,488.33" / "−$2,000.00" — the server's projected − typed, signed. */
export function differenceText(value: string): string {
  const amount = Number(value)
  if (amount === 0) return formatCurrency(value)
  return `${amount > 0 ? '+' : '−'}${formatCurrency(Math.abs(amount))}`
}

/** "≈ +$18,265 tax" — what matching this line would do to the year's liability. */
export function effectText(value: string): string {
  const amount = Number(value)
  if (amount === 0) return 'no change in tax'
  return `≈ ${amount > 0 ? '+' : '−'}${wholeDollars(amount)} tax`
}

/** The strip's lead: how many inputs differ by more than the flag line, and — when the RSU
 *  row is among them — the price that row was judged at. */
export function leadLine(rec: Reconciliation): string {
  const count = rec.flagged_count
  const line = wholeDollars(rec.flag_above)
  if (count === 0) return `Every input is within ${line} of tax of your records`
  const rsu = rec.rows.some((row) => row.key === 'rsu' && row.flagged)
  const clause = rsu ? ' (this month’s reference price for unvested RSUs)' : ''
  return `${count} ${count === 1 ? 'input differs' : 'inputs differ'} from your records by more than ${line} of tax${clause}`
}

/**
 * "Balance if they matched your records: refund ≈ $5,004". The words and the tone follow the
 * headline tile's rules — a positive balance is owed (the bad direction), a negative one is a
 * refund — so the two can never disagree about what a sign means. Null when there is nothing
 * to compare against.
 */
export function matchedFace(value: string | null): { text: string; tone: Tone } | null {
  if (value === null) return null
  const amount = Number(value)
  const lead = 'Balance if they matched your records:'
  if (amount === 0) return { text: `${lead} even`, tone: 'neutral' }
  return amount > 0
    ? { text: `${lead} owe ≈ ${wholeDollars(amount)}`, tone: 'negative' }
    : { text: `${lead} refund ≈ ${wholeDollars(amount)}`, tone: 'positive' }
}
