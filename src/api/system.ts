import { api, ApiError, getToken } from './client'
import type { SystemStatus } from '../types/api'

// GET /system/status — the refresh-status superset (spec §3). Overview swapped its
// /prices/refresh-status fetch for this; PortfolioPage still uses the old endpoint.
export function fetchSystemStatus(): Promise<SystemStatus> {
  return api<SystemStatus>('/system/status')
}

// GET /export/snapshot — the full-data ZIP (2026-08-31 spec §B1), handed to the browser's
// own save flow. NOT api<T>(): that helper json()s every body; this one needs the raw blob
// plus the Content-Disposition filename (same-origin fetch exposes every header). 60s
// budget: the ZIP compresses the whole database and must survive a slow link where the
// client's 15s default would not.
export async function downloadSnapshot(): Promise<void> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let res: Response
  try {
    res = await fetch('/api/v1/export/snapshot', {
      headers,
      signal: AbortSignal.timeout(60_000),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new ApiError('Export timed out', 0)
    }
    throw new ApiError('Network error — is the server reachable?', 0)
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // non-JSON error body
    }
    throw new ApiError(detail, res.status)
  }
  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') ?? ''
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? 'finance-export.zip'
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
