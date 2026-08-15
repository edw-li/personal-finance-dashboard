import { api } from './client'
import type { LatestPriceOut, RefreshResult, SparklinesResponse } from '../types/api'

// A live refresh walks ~37 tickers sequentially (tens of seconds) — the caller-supplied
// signal REPLACES the client's 15s default (Plan 3 forward note).
const REFRESH_TIMEOUT_MS = 120_000

export function refreshPrices(): Promise<RefreshResult> {
  return api<RefreshResult>('/prices/refresh', {
    method: 'POST',
    signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
  })
}

export function fetchSparklines(days = 365): Promise<SparklinesResponse> {
  return api<SparklinesResponse>(`/prices/sparklines?days=${days}`)
}

export function putManualPrice(
  ticker: string,
  body: { price: string; as_of?: string },
): Promise<LatestPriceOut> {
  return api<LatestPriceOut>(`/prices/${encodeURIComponent(ticker)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
