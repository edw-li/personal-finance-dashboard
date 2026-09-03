import { ApiError, api, getToken } from './client'
import type { FeedTokenCreated, FeedTokenOut } from '../types/api'
import { downloadText } from '../utils/download'

export function fetchFeedTokens(): Promise<FeedTokenOut[]> {
  return api<FeedTokenOut[]>('/calendar/feed-tokens')
}

/** The answer carries the plaintext ONCE — the card shows it and never asks again. */
export function createFeedToken(label: string): Promise<FeedTokenCreated> {
  return api<FeedTokenCreated>('/calendar/feed-tokens', {
    method: 'POST',
    body: JSON.stringify({ label }),
  })
}

export function revokeFeedToken(id: number): Promise<void> {
  return api<void>(`/calendar/feed-tokens/${id}`, { method: 'DELETE' })
}

/** The feed URL a calendar app subscribes to — built from the page's own origin so it works
 *  wherever the dashboard is served from. */
export function feedUrl(token: string): string {
  return `${window.location.origin}/api/v1/calendar/feed.ics?token=${encodeURIComponent(token)}`
}

/** "Add to calendar (.ics)": the server renders the window (2026-09-03 calendar spec §11)
 *  and the blob is saved through download.ts. A raw fetch rather than api(): the body is
 *  text/calendar, not JSON, and a GET has nothing to invalidate. */
export async function downloadCalendarIcs(
  start: string,
  end: string,
  filename = 'financial-calendar.ics',
): Promise<void> {
  const token = getToken()
  let res: Response
  try {
    // 60 s like downloadSnapshot's, not api()'s 15: the server composes up to 400 days of
    // derived events before it can write a byte, and a slow link must not read as a failure.
    res = await fetch(`/api/v1/calendar/export.ics?start=${start}&end=${end}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(60_000),
    })
  } catch (err) {
    // A raw fetch REJECTS on a dead network; without this the caller would see a bare
    // TypeError instead of the ApiError every other call in this app throws (system.ts).
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new ApiError('Export timed out', 0)
    }
    throw new ApiError('Network error — is the server reachable?', 0)
  }
  if (!res.ok) {
    let detail = `Export failed (${res.status})`
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // non-JSON error body
    }
    throw new ApiError(detail, res.status)
  }
  downloadText(await res.text(), filename, 'text/calendar;charset=utf-8')
}
