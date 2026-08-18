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
