import { rememberReturnTo } from '../components/shell/returnTo'
import { clearAssistantSession } from './assistantSession'
import { clearSnapshots } from './snapshotCache'

const TOKEN_KEY = 'finance_token'

// 15s: generous for a self-hosted API; without it a hung backend left token-bearing
// users on a permanently blank page (Plan 1 forward note).
const DEFAULT_TIMEOUT_MS = 15_000

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/** The one way a session ends against the user's will (2026-09-03 shell spec §10): the
 *  token and everything that belongs to it go, the page they were reading is remembered,
 *  and the login says why. Exported because the assistant's stream answers its own 401 —
 *  it bypasses request() entirely — and the two must not drift apart. */
export function expireSession(): void {
  clearToken()
  clearSnapshots() // snapshots are session data — they must not outlive the token
  clearAssistantSession() // and a financial chat transcript must not outlive it either
  rememberReturnTo(window.location.pathname + window.location.search)
  window.location.assign('/login?reason=expired')
}

// Called after every successful authenticated response (the session renewer registers
// itself here from AuthContext — a direct import would be a cycle, since session.ts uses
// this module's token helpers).
let afterResponse: (() => void) | null = null
export function setAfterResponseHook(hook: (() => void) | null): void {
  afterResponse = hook
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase()
  try {
    return await request<T>(path, options)
  } finally {
    // Coarse invalidation (2026-08-27 spec §1): ANY non-GET — success or failure, a 500
    // may still have written — drops every page snapshot. Correct beats clever here.
    if (method !== 'GET') clearSnapshots()
  }
}

// POST-for-read: a POST whose body is only the question, answered from a computation that
// writes nothing — the shape the tax what-if endpoint established server-side. For those,
// api()'s coarse non-GET invalidation must NOT fire; the assistant's context preview runs
// on every drawer open and would otherwise cost every page its instant paint. Anything that
// CAN write keeps going through api(). (Today's only caller is that preview; whatif.ts
// still rides api() and is untouched.)
export async function apiReadOnly<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

async function request<T>(path: string, options: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    // FormData bodies must NOT get a manual Content-Type: the browser writes
    // multipart/form-data with its boundary; a hand-set value breaks the upload.
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string> | undefined),
  }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const signal = options.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`/api/v1${path}`, { ...options, headers, signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new ApiError('Request timed out', 0)
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err // caller-initiated abort — not an API failure
    }
    throw new ApiError('Network error — is the server reachable?', 0)
  }

  if (res.status === 401 && !path.startsWith('/auth/login')) {
    expireSession()
    throw new ApiError('Session expired', 401)
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      // FastAPI errors use {detail} (a string, or an ARRAY for 422 validation errors);
      // slowapi's 429 rate-limit body uses {error}
      const body = (await res.json()) as { detail?: unknown; error?: unknown }
      const raw = body.detail ?? body.error
      if (typeof raw === 'string') {
        detail = raw
      } else if (Array.isArray(raw)) {
        detail = raw.map((d) => (d as { msg?: string }).msg ?? 'Invalid input').join('; ')
      }
    } catch {
      // non-JSON error body
    }
    throw new ApiError(detail, res.status)
  }
  // Sliding renewal (spec §10) hangs off any successful authenticated response. /auth/* is
  // excluded so the renew call cannot re-enter itself, and that covers /auth/me BY DESIGN,
  // not by accident: the mount-time identity check would otherwise renew on a bare page
  // load, and the first data fetch behind it renews anyway.
  if (token !== null && !path.startsWith('/auth/')) afterResponse?.()
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
