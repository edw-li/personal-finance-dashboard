import { api, ApiError, getToken } from './client'
import type { SystemStatus } from '../types/api'

// GET /system/status — the refresh-status superset (spec §3). Overview swapped its
// /prices/refresh-status fetch for this; PortfolioPage still uses the old endpoint.
export function fetchSystemStatus(): Promise<SystemStatus> {
  return api<SystemStatus>('/system/status')
}

// An authenticated ZIP handed to the browser's own save flow. NOT api<T>(): that helper
// json()s every body; this one needs the raw blob plus the Content-Disposition filename
// (same-origin fetch exposes every header). 60s budget: a ZIP of the whole database must
// survive a slow link where the client's 15s default would not. `noun` names the request in
// its timeout sentence; `fallbackName` saves a body that arrived without a filename.
async function saveDownload(path: string, fallbackName: string, noun: string): Promise<void> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let res: Response
  try {
    res = await fetch(path, {
      headers,
      signal: AbortSignal.timeout(60_000),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new ApiError(`${noun} timed out`, 0)
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
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Deferred revoke: Safari can cancel a download whose blob URL is revoked before
  // the save begins; a tick's delay is the conventional armor (final review, minor 2).
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// GET /export/snapshot — the full-data ZIP of the database as it is now (2026-08-31 spec §B1).
export function downloadSnapshot(): Promise<void> {
  return saveDownload('/api/v1/export/snapshot', 'finance-export.zip', 'Export')
}

// GET /system/snapshots/{name}/download — a stored snapshot or a restore point, byte for byte
// (2026-09-23 spec §B3). The file's own name is the save name.
export function downloadStoredSnapshot(name: string): Promise<void> {
  return saveDownload(
    `/api/v1/system/snapshots/${encodeURIComponent(name)}/download`,
    name,
    'Download',
  )
}
