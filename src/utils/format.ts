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
  if (!iso) return '—'
  const [year, month, day] = iso.split('-')
  return `${MONTH_NAMES[Number(month) - 1]} ${Number(day)}, ${year}`
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
