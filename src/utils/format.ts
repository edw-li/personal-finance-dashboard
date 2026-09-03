// Server money/percent values arrive as decimal STRINGS (pydantic v2). Number() here is
// display-only — never feed the result back to the API.

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

export function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return currency.format(Number(value))
}

export function formatCurrencyCompact(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
  return `${sign}$${Math.round(abs)}`
}

export function formatPct(
  value: string | number | null | undefined,
  { signed = true, decimals = 1 }: { signed?: boolean; decimals?: number } = {},
): string {
  if (value === null || value === undefined || value === '') return '—'
  const pct = Number(value) * 100
  const body = `${Math.abs(pct).toFixed(decimals)}%`
  if (!signed) return pct < 0 ? `-${body}` : body
  return pct < 0 ? `-${body}` : `+${body}`
}

export function formatShares(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 6 })
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatMonth(iso: string): string {
  // Never `new Date(iso)` — UTC parsing shifts first-of-month a day back in negative offsets.
  const [year, month] = iso.split('-')
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`
}

export function formatDate(iso: string | null | undefined): string {
  // Same rule as formatMonth: never `new Date(iso)` (UTC parsing shifts a day back).
  // slice(0, 10) makes full ISO datetimes safe — "…T00:00:00Z" would otherwise
  // render "Aug NaN" (Task 12 review I1).
  if (!iso) return '—'
  const [year, month, day] = iso.slice(0, 10).split('-')
  return `${MONTH_NAMES[Number(month) - 1]} ${Number(day)}, ${year}`
}

export function formatDateTime(iso: string | null | undefined): string {
  // The one formatter that IS allowed to `new Date(iso)`: it takes full offset-carrying
  // timestamps only (refresh runs, next-fire times), where parsing is exact and the
  // LOCAL wall clock is the honest rendering — these are "when did/does it happen"
  // stamps, not calendar data. Never hand it a bare date (that is formatDate's job).
  if (!iso) return '—'
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '—'
  const hours24 = at.getHours()
  const hours = hours24 % 12 === 0 ? 12 : hours24 % 12
  const minutes = String(at.getMinutes()).padStart(2, '0')
  const meridiem = hours24 < 12 ? 'AM' : 'PM'
  return `${MONTH_NAMES[at.getMonth()]} ${at.getDate()}, ${at.getFullYear()}, ${hours}:${minutes} ${meridiem}`
}

export function localDateKey(iso: string | null | undefined): string | null {
  // The LOCAL calendar day of an INSTANT, as YYYY-MM-DD. formatDate's slice(0, 10) reads
  // the day off the text, which is the SERVER's day: the 23:30 PT nightly is stamped
  // 06:30 UTC the next morning, so a card that lists it as "Sep 3, 11:30 PM"
  // (formatDateTime, local) would then demand "2026-09-04" in the arm box. One clock, and
  // it is formatDateTime's — these stamps are "when did it happen", not calendar data.
  // Null (never a guess) when there is nothing to read: the callers all have a "—" case.
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${at.getFullYear()}-${month}-${day}`
}

export function formatInstantDate(iso: string | null | undefined): string {
  // formatDate's words on localDateKey's clock — the pair the Restore card shows and asks
  // for. Never for bare dates: those are calendar data and formatDate owns them.
  const key = localDateKey(iso)
  return key === null ? '—' : formatDate(key)
}

export function formatBytes(bytes: number): string {
  // pg_database_size is exact bytes; the card wants a human size. Base 1024 with one
  // decimal past B — the register `du -h` speaks, which the backup row quotes verbatim.
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  let value = bytes
  let unit = 'B'
  for (const next of ['KB', 'MB', 'GB', 'TB']) {
    if (value < 1024) break
    value /= 1024
    unit = next
  }
  return `${value.toFixed(1)} ${unit}`
}

export function escapeHtml(raw: string): string {
  // ECharts tooltip formatters build HTML strings; account/category names are user text.
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
