import { rememberReturnTo } from '../components/shell/returnTo'
import { clearAssistantSession } from './assistantSession'
import { clearSnapshots, clearSnapshotsWhere } from './snapshotCache'

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

// Which snapshot-key FAMILIES a mutation can have moved (2026-09-03 shell spec §13). Keys
// are `<family>` or `<family>:…`, so the map is read as a prefix on the PATH and a family
// prefix on the KEY. `shell` rides /spending and /net-worth because the scope ribbon caches
// household + month coverage under it, and both move when a month is saved.
//
// Every family below is one a page actually writes: an entry that matches no live key reads
// as coverage that isn't there. The cross-page rows are the ones that bite — the spending
// matrix's four_pct_rule is computed from the net-worth investable bases; the credit-cards
// page keeps ONE snapshot that embeds the spending categories, the spending matrix and
// /net-worth/accounts; and both the ESPP lots and the comp vesting schedule are valued at the
// portfolio's latest quote, so a price refresh moves them.
const MUTATION_FAMILIES: [prefix: string, families: string[]][] = [
  ['/spending', ['spending', 'overview', 'projection', 'shell', 'credit-cards']],
  ['/net-worth', ['net-worth', 'overview', 'projection', 'shell', 'spending', 'credit-cards']],
  ['/portfolio', ['portfolio', 'overview', 'calendar', 'espp', 'comp']],
  ['/prices', ['portfolio', 'overview', 'calendar', 'espp', 'comp']],
  ['/calendar', ['calendar', 'overview']],
  ['/credit-cards', ['credit-cards']],
  ['/taxes', ['taxes', 'overview']],
  // Pay, equity and the limits that govern them are ONE dependency web: a comp edit moves
  // the paycheck, the ESPP contribution, the tax estimate, the projection and the calendar.
  ['/paycheck', ['paycheck', 'comp', 'espp', 'taxes', 'projection', 'calendar', 'overview']],
  ['/comp', ['paycheck', 'comp', 'espp', 'taxes', 'projection', 'calendar', 'overview']],
  ['/espp', ['paycheck', 'comp', 'espp', 'taxes', 'projection', 'calendar', 'overview']],
  ['/limits', ['paycheck', 'comp', 'espp', 'taxes', 'projection', 'calendar', 'overview']],
]

/** Targeted invalidation for a mutation's path. A path NOT in the map above — /household,
 *  /settings, /import, /auth, and anything added later — deliberately falls through to the
 *  old posture and wipes the whole cache: a new endpoint is stale-by-default, never
 *  silently wrong, and gets listed here only once someone reasons about its blast radius. */
export function invalidateForMutation(path: string): void {
  const hit = MUTATION_FAMILIES.find(([prefix]) => path.startsWith(prefix))
  if (hit === undefined) {
    clearSnapshots() // unknown path: correct beats clever
    return
  }
  const families = hit[1]
  clearSnapshotsWhere((key) =>
    families.some((family) => key === family || key.startsWith(`${family}:`)),
  )
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase()
  try {
    return await request<T>(path, options)
  } finally {
    // ANY non-GET — success or failure, a 500 may still have written — drops the families
    // its path can have moved (2026-08-27 spec §1, narrowed by 2026-09-03 spec §13). The
    // wipe used to be total, which cost every OTHER page its instant paint on every save.
    if (method !== 'GET') invalidateForMutation(path)
  }
}

// POST-for-read: a POST whose body is only the question, answered from a computation that
// writes nothing — the shape the tax what-if endpoint established server-side. For those,
// api()'s coarse non-GET invalidation must NOT fire; the assistant's context preview runs
// on every drawer open and would otherwise cost every page its instant paint. Anything that
// CAN write keeps going through api(). (Callers: the assistant's context preview and the tax
// what-if sandbox — the latter loads a year's stored inputs, runs the engine twice and stores
// nothing.)
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
    // HTTP/2 and /3 carry no reason phrase, so `statusText` is '' on every response the
    // production nginx serves — the status itself is the last-resort message.
    let detail = res.statusText || `HTTP ${res.status}`
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
