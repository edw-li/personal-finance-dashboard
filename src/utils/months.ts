// ISO first-of-month strings ('2026-08-01') are the app's month currency. All math is
// string/int based — Date objects only for day arithmetic, never parsed from ISO strings.
import { productTodayIso } from './productToday'

export function addMonths(iso: string, delta: number): string {
  const [year, month] = iso.split('-').map(Number)
  const index = year * 12 + (month - 1) + delta
  const y = Math.floor(index / 12)
  const m = (index % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}-01`
}

export function lastNMonths(anchorIso: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addMonths(anchorIso, i - (n - 1)))
}

export function currentMonthIso(): string {
  return `${todayIso().slice(0, 7)}-01`
}

// The product day, 'YYYY-MM-DD' — the SERVER's once any response has named it
// (utils/productToday.ts, 2026-09-23 spec §K1), the browser's local day before that. The
// injectable "today" the attention strip's pure math runs on, and the one every "has the 1st
// arrived / has the month ended / which year is it" rule reads — never `new Date()`.
export function todayIso(): string {
  return productTodayIso()
}

export function currentYear(): number {
  return Number(todayIso().slice(0, 4))
}

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is earlier). Date.UTC day numbers,
 *  never `new Date(isoString)`: a bare-date parse is UTC while a local-midnight subtraction drifts
 *  an hour across DST, so only UTC days count exactly (2026-09-23 spec §0.4(d)). */
export function daysBetween(fromIso: string, toIso: string): number {
  const dayNumber = (iso: string) => {
    const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
    return Date.UTC(year, month - 1, day) / 86_400_000
  }
  return dayNumber(toIso) - dayNumber(fromIso)
}

// Day-level ISO math for the calendar grid. The y/m/d Date CONSTRUCTOR is local and
// safe — the never-parse-ISO rule guards `new Date(string)` (UTC parsing), not this.
export function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + delta)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate(),
  ).padStart(2, '0')}`
}

// 0 = Sunday … 6 = Saturday (the calendar grid is Sunday-first).
export function isoWeekday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

// The month's grid as whole Sunday-first weeks: leading/trailing out-of-month days pad
// to full rows. A 28-day February starting on Sunday is exactly 4 rows, no padding.
export function monthGrid(monthIso: string): string[][] {
  let cursor = addDays(monthIso, -isoWeekday(monthIso))
  const lastOfMonth = addDays(addMonths(monthIso, 1), -1)
  const gridEnd = addDays(lastOfMonth, 6 - isoWeekday(lastOfMonth))
  const weeks: string[][] = []
  while (cursor <= gridEnd) {
    const week: string[] = []
    for (let i = 0; i < 7; i += 1) {
      week.push(cursor)
      cursor = addDays(cursor, 1)
    }
    weeks.push(week)
  }
  return weeks
}
