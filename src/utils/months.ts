// ISO first-of-month strings ('2026-08-01') are the app's month currency. All math is
// string/int based — Date objects only for "today", avoiding timezone edge cases.

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
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

// Local calendar date as 'YYYY-MM-DD' — the injectable "today" the attention strip's pure
// math runs on. (MonthlyUpdatePage carries a private copy that predates this export.)
export function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
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
