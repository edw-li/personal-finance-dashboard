// Cash-flow arithmetic over fetched events (2026-09-03 calendar spec §10): INTEGER CENTS
// from the server's 2dp strings, never floats. Feeds the four tiles, the week gutters, the
// drawer's cash line and Overview's 45-day line — one module so they cannot disagree.
import type { CalendarDirection, CalendarEvent } from '../../types/api'

const CENTS_RE = /^(-?)(\d+)(?:\.(\d{1,2}))?$/

/** '6812.44' → 681244. Throws on anything that is not a plain decimal: the wire promises
 *  2dp strings, and an exponent here would be a bug worth hearing about. */
export function toCents(amount: string): number {
  const match = CENTS_RE.exec(amount.trim())
  if (match === null) throw new Error(`not a 2dp decimal: ${amount}`)
  const [, sign, whole, frac = ''] = match
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  return sign === '-' ? -cents : cents
}

export function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** Unsigned compact magnitude: $395 · $6.8k · $41.2k · $1.2M. */
export function formatCompactCents(cents: number): string {
  const dollars = Math.abs(cents) / 100
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`
  return `$${Math.round(dollars)}`
}

const SIGN: Record<CalendarDirection, string> = { in: '+', out: '−', neutral: '' }

/** "+$6.8k" · "−$395" · "~+$41.2k" — direction is the sign, the tilde says estimate. */
export function signedCompact(
  cents: number,
  direction: CalendarDirection,
  estimated: boolean,
): string {
  return `${estimated ? '~' : ''}${SIGN[direction]}${formatCompactCents(cents)}`
}

export interface CashSummary {
  cashIn: number // direction in, source ≠ rsu
  cashOut: number
  net: number // cashIn − cashOut
  vesting: number // source rsu, gross
  estimated: { cashIn: boolean; cashOut: boolean; vesting: boolean }
  /** Events with money we cannot know (null amount) — the tiles say "n unknown". */
  unknown: number
}

/** Hidden events are excluded (they are not on the calendar); done deadlines are included
 *  (the money still moves); null amounts are counted, not summed. */
export function summarize(events: CalendarEvent[]): CashSummary {
  const s: CashSummary = {
    cashIn: 0,
    cashOut: 0,
    net: 0,
    vesting: 0,
    estimated: { cashIn: false, cashOut: false, vesting: false },
    unknown: 0,
  }
  for (const event of events) {
    if (event.hidden) continue
    if (event.amount === null) {
      // A neutral non-vest event (an ESPP qualifying date, an offering start) has no money
      // to know — only the ones that MEAN money count as unknown.
      if (event.direction !== 'neutral' || event.source === 'rsu') s.unknown += 1
      continue
    }
    const cents = toCents(event.amount)
    const estimated = event.basis === 'estimated'
    if (event.source === 'rsu') {
      s.vesting += cents
      s.estimated.vesting ||= estimated
    } else if (event.direction === 'in') {
      s.cashIn += cents
      s.estimated.cashIn ||= estimated
    } else if (event.direction === 'out') {
      s.cashOut += cents
      s.estimated.cashOut ||= estimated
    }
  }
  s.net = s.cashIn - s.cashOut
  return s
}

export function monthSummary(events: CalendarEvent[], monthIso: string): CashSummary {
  const prefix = monthIso.slice(0, 7)
  return summarize(events.filter((e) => e.date.slice(0, 7) === prefix))
}

export function weekSummary(events: CalendarEvent[], days: readonly string[]): CashSummary {
  const set = new Set(days)
  return summarize(events.filter((e) => set.has(e.date)))
}

export function windowSummary(
  events: CalendarEvent[],
  startIso: string,
  endIso: string,
): CashSummary {
  return summarize(events.filter((e) => e.date >= startIso && e.date <= endIso))
}

/** "+$6.8k in · −$395 out · ~$41.2k vesting" — zero legs are left out. */
export function cashLine(s: CashSummary): string {
  const parts: string[] = []
  if (s.cashIn !== 0) parts.push(`${signedCompact(s.cashIn, 'in', s.estimated.cashIn)} in`)
  if (s.cashOut !== 0) parts.push(`${signedCompact(s.cashOut, 'out', s.estimated.cashOut)} out`)
  if (s.vesting !== 0) {
    parts.push(`${signedCompact(s.vesting, 'neutral', s.estimated.vesting)} vesting`)
  }
  if (parts.length === 0) return s.unknown > 0 ? 'amounts unknown' : 'nothing due'
  return parts.join(' · ')
}
