# Shell 1c — Session, palette registry, error boundary, sidebar footer, polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the remaining shell primitives from `docs/superpowers/specs/2026-09-03-shell-grammar-design.md` §9–§10, §12–§13: a session that renews itself and returns you to where you were, a palette that is findable and finds things, a shell-level error boundary with diagnostics, a sidebar footer with identity and build info, and the polish bundle (assertive error toasts, an edge-aware pinnable InfoHint, targeted cache invalidation). Everything here mounts immediately — none of it waits for a page migration.

**Architecture:** Backend gains a `token_version` claim, `POST /auth/renew`, and a change-password response that carries a fresh token. The client's `session.ts` decodes the token's expiry and renews single-flight after any successful request; the 401 path stores `returnTo` and sends the user to `/login?reason=expired`. The palette moves from a label-only list to `paletteRegistry.ts` (pages with keyword aliases, Settings sections behind `#anchors`, finished actions, lazily loaded entities). `ShellErrorBoundary` wraps the whole layout; `SidebarFooter` replaces the bare Log-out row. `snapshotCache` gains predicate clearing and `client.ts` maps mutation paths to snapshot-key families.

**Tech Stack:** FastAPI + PyJWT + Alembic + pytest; React 19 + react-router 7 + vitest + Testing Library; Vite `define` for the build hash.

**Worktree / commands:** Branch `shell-1c`, worktree `C:\Users\edyli\personal-finance-dashboard\.worktrees\shell-1c`. Frontend from the worktree root. Backend from `<worktree>/backend` with the root venv and a private test DB: `FINANCE_TEST_DB=finance_test_1c ../../../backend/.venv/Scripts/python.exe -m pytest tests/<file> -q`.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/alembic/versions/20260903_0900_b8e4d17c2a90_users_token_version.py` (new) | `users.token_version` |
| `backend/app/models/user.py` (modify) | the column |
| `backend/app/security.py` (modify) | `ver` claim in/out |
| `backend/app/api/deps.py` (modify) | reject stale versions |
| `backend/app/api/auth.py` (modify) | `/renew`; change-password bumps + returns a token |
| `backend/tests/test_auth.py` (modify) | renew, stale version, versionless legacy token, change-password token |
| `src/components/shell/session.ts` (new) | expiry decode, renew threshold, single-flight renew, return-to helpers |
| `src/components/shell/session.test.ts` (new) | all of the above with fake timers |
| `src/api/client.ts` (modify) | after-response hook; 401 → returnTo + reason; family invalidation |
| `src/api/snapshotCache.ts` (modify) | `clearSnapshotsWhere` |
| `src/api/client.test.ts`, `src/api/snapshotCache.test.ts` (modify) | invalidation + 401 behavior |
| `src/api/auth.ts` (modify) | `changePassword` stores the returned token |
| `src/contexts/AuthContext.tsx` (modify) | installs the renew hook; exposes `authError` + `retry` |
| `src/components/ProtectedRoute.tsx` (modify) | branded splash, delayed spinner, unreachable state |
| `src/pages/LoginPage.tsx`, `LoginPage.css` (modify) | expired notice, return-to, last email, show password, Caps Lock |
| `src/components/navItems.ts` (modify) | `keywords` per destination |
| `src/components/paletteBus.ts` (new) | open-request bus (sidebar row → palette) |
| `src/components/paletteRegistry.ts` (new) | entries, matching, grouping, entity loading |
| `src/components/paletteRegistry.test.ts` (new) | keyword hits, sections, grouping, entities |
| `src/components/CommandPalette.tsx` + test (modify) | registry-driven, grouped, toasts, sidebar-row opening |
| `src/components/useArrivalParam.ts` (modify) | `useArrivalValue` for free-form arrival params |
| `src/pages/PortfolioPage.tsx`, `NetWorthPage.tsx`, `SpendingPage.tsx`, `CalendarPage.tsx` (modify, small) | `?ticker=`, `?drill=`, `?trend=`, `?add=1`, records scroll/focus |
| `src/pages/SettingsPage.tsx` + `src/components/settings/*Card.tsx` (modify, small) | card ids; hash arrival scroll + highlight |
| `src/components/shell/ShellErrorBoundary.tsx` + test (new) | chunk vs real error, Reload, Copy details |
| `src/components/shell/SidebarFooter.tsx` + test (new) | email, env pill, build hash, theme toggle, Log out |
| `src/components/Layout.tsx`, `Layout.css` (modify) | search row, footer, boundary |
| `vite.config.ts`, `src/vite-env.d.ts` (modify) | `__BUILD_HASH__` |
| `src/components/ToastProvider.tsx`, `toast.css`, test (modify) | assertive error region |
| `src/components/InfoHint.tsx`, `panels.css`, test (modify) | pinnable, edge-aware popover |

Plan 1a owns `App.tsx`, `index.css`, `theme.ts`, `EChart.tsx`, `shell.css`'s Segmented/PageFrame/footer CSS and the Appearance card. This plan uses `shell.css`'s `.sidebar-footer*` rules and `useTheme` from Plan 1a; if 1a has not merged when you reach Task 7, create a minimal `ThemeProvider.tsx` stub exporting `useTheme()` returning `{ resolved: 'dark', setTheme() {} }` in your branch — the merge takes 1a's real one.

---

### Task 1: `token_version`, `/auth/renew`, change-password token (backend)

**Files:**
- Create: `backend/alembic/versions/20260903_0900_b8e4d17c2a90_users_token_version.py`
- Modify: `backend/app/models/user.py`, `backend/app/security.py`, `backend/app/api/deps.py`, `backend/app/api/auth.py`
- Test: `backend/tests/test_auth.py`

- [ ] **Step 1: Write the failing tests** (append to `tests/test_auth.py`; also change the existing `test_change_password_success` assertion `assert resp.status_code == 204` to `assert resp.status_code == 200` and add `assert resp.json()["access_token"]`)

```python
import jwt as pyjwt

from app.config import settings
from app.security import ALGORITHM, create_access_token


async def test_renew_issues_a_fresh_token_with_a_later_expiry(auth_client, client):
    old = client.headers["Authorization"].split(" ", 1)[1]
    resp = await auth_client.post("/api/v1/auth/renew")
    assert resp.status_code == 200, resp.text
    new = resp.json()["access_token"]
    assert new != old
    old_exp = pyjwt.decode(old, settings.secret_key, algorithms=[ALGORITHM])["exp"]
    new_exp = pyjwt.decode(new, settings.secret_key, algorithms=[ALGORITHM])["exp"]
    assert new_exp >= old_exp
    client.headers["Authorization"] = f"Bearer {new}"
    assert (await client.get("/api/v1/auth/me")).status_code == 200


async def test_renew_requires_auth(client):
    assert (await client.post("/api/v1/auth/renew")).status_code == 401


async def test_change_password_signs_out_every_other_session_but_not_this_one(
    auth_client, client, seeded_user
):
    other = create_access_token(seeded_user.id, seeded_user.token_version)
    resp = await auth_client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "correct-horse", "new_password": "new-pass-123"},
    )
    assert resp.status_code == 200, resp.text
    fresh = resp.json()["access_token"]
    # The token minted BEFORE the change is dead everywhere…
    client.headers["Authorization"] = f"Bearer {other}"
    assert (await client.get("/api/v1/auth/me")).status_code == 401
    # …and the one the response carried keeps this tab signed in.
    client.headers["Authorization"] = f"Bearer {fresh}"
    assert (await client.get("/api/v1/auth/me")).status_code == 200


async def test_legacy_token_without_a_version_claim_still_works(client, seeded_user):
    # Tokens issued before this deploy carry no `ver`; they are read as version 0 and stay
    # valid until their own expiry — the deploy itself logs nobody out.
    payload = pyjwt.decode(
        create_access_token(seeded_user.id, 0), settings.secret_key, algorithms=[ALGORITHM]
    )
    del payload["ver"]
    legacy = pyjwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)
    client.headers["Authorization"] = f"Bearer {legacy}"
    assert (await client.get("/api/v1/auth/me")).status_code == 200
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_1c <venv-python> -m pytest tests/test_auth.py -q`
Expected: the four new tests fail (404 on renew, 204 on change-password, `token_version` attribute missing).

- [ ] **Step 3: Migration**

```python
"""users.token_version — sign out everywhere (2026-09-03 shell spec §10)

Revision ID: b8e4d17c2a90
Revises: f7d3b2a91c40
Create Date: 2026-09-03 09:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b8e4d17c2a90"
down_revision: str | Sequence[str] | None = "f7d3b2a91c40"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # server_default so existing rows read 0 — the version every pre-deploy token implies.
    op.add_column(
        "users",
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("users", "token_version")
```

- [ ] **Step 4: Model, security, deps, router**

`app/models/user.py` — add `Integer` to the sqlalchemy import and the column:

```python
    # Bumped by a password change; every token carries the value it was minted with, and a
    # mismatch is a 401 — "sign out everywhere" without a token table (2026-09-03 shell spec §10).
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
```

`app/security.py`:

```python
def create_access_token(user_id: int, token_version: int = 0) -> str:
    payload = {
        "sub": str(user_id),
        "ver": token_version,
        "exp": datetime.now(UTC) + timedelta(hours=settings.access_token_expire_hours),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> tuple[int, int]:
    """Return (user id, token version), or raise ValueError for any invalid/expired token.
    A token minted before versions existed has no `ver` and reads as 0."""
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[ALGORITHM],
            options={"require": ["exp", "sub"]},
        )
        return int(payload["sub"]), int(payload.get("ver", 0))
    except (jwt.PyJWTError, KeyError, TypeError, ValueError) as exc:
        raise ValueError("invalid token") from exc
```

Grep for other callers of `decode_access_token` (`grep -rn decode_access_token app tests`) and update each to unpack the tuple.

`app/api/deps.py`:

```python
    try:
        user_id, token_version = decode_access_token(credentials.credentials)
    except ValueError:
        raise HTTPException(
            status_code=401, detail="Invalid or expired token", headers=AUTH_401_HEADERS
        ) from None
    user = await db.get(User, user_id)
    if user is None or user.token_version != token_version:
        raise HTTPException(
            status_code=401, detail="Invalid or expired token", headers=AUTH_401_HEADERS
        )
    return user
```

`app/api/auth.py` — login passes the version; add renew; change-password bumps and returns a token:

```python
    return TokenResponse(access_token=create_access_token(user.id, user.token_version))
```

```python
@router.post("/renew", response_model=TokenResponse)
async def renew(user: User = Depends(get_current_user)) -> TokenResponse:
    """A fresh 24 h token for an active session (2026-09-03 shell spec §10). Same version, so
    a password change elsewhere still ends this session at its next request."""
    return TokenResponse(access_token=create_access_token(user.id, user.token_version))


@router.post("/change-password", response_model=TokenResponse)
async def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    try:
        current_ok = verify_password(body.current_password, user.password_hash)
    except ValueError:
        current_ok = False
    if not current_ok:
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    try:
        user.password_hash = hash_password(body.new_password)
    except ValueError:
        raise HTTPException(status_code=400, detail="Password must be at most 72 bytes") from None
    # Every other session's token now carries a stale version and dies at its next request;
    # this response carries the only live one, so the tab that changed the password stays in.
    user.token_version += 1
    await db.commit()
    return TokenResponse(access_token=create_access_token(user.id, user.token_version))
```

Remove the now-unused `Response` import if nothing else uses it.

- [ ] **Step 5: Run the auth module, then the whole backend suite**

Run: `FINANCE_TEST_DB=finance_test_1c <venv-python> -m pytest tests/test_auth.py -q` → all pass. Then `FINANCE_TEST_DB=finance_test_1c <venv-python> -m pytest -q -x` → all pass (the test DB is rebuilt from models each session, so the new column is present). Run `<venv-python> -m alembic upgrade head --sql` from `backend` to confirm the migration renders (do NOT apply it to the dev database from this worktree; the merge lane applies it once).

- [ ] **Step 6: Commit**

```bash
git add backend/alembic/versions/20260903_0900_b8e4d17c2a90_users_token_version.py backend/app/models/user.py backend/app/security.py backend/app/api/deps.py backend/app/api/auth.py backend/tests/test_auth.py
git commit -m "feat(auth): token_version claim, POST /auth/renew, change-password signs out other sessions"
```

---

### Task 2: Client session — renewal, return-to-page, expired notice, splash

**Files:**
- Create: `src/components/shell/session.ts`, `src/components/shell/session.test.ts`
- Modify: `src/api/client.ts`, `src/api/auth.ts`, `src/contexts/AuthContext.tsx`, `src/components/ProtectedRoute.tsx`, `src/pages/LoginPage.tsx`, `src/pages/LoginPage.css`
- Tests: `src/api/client.test.ts`, `src/contexts/AuthContext.test.tsx`, `src/pages/LoginPage.test.tsx` (extend)

- [ ] **Step 1: Write the failing session tests**

```ts
// src/components/shell/session.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RENEW_WITHIN_MS,
  RETURN_TO_KEY,
  consumeReturnTo,
  expiryOf,
  maybeRenew,
  rememberReturnTo,
  shouldRenew,
} from './session'

function tokenExpiringAt(epochSeconds: number): string {
  const b64 = (s: string) => Buffer.from(s).toString('base64url')
  return `${b64('{"alg":"HS256","typ":"JWT"}')}.${b64(JSON.stringify({ sub: '1', exp: epochSeconds }))}.sig`
}

vi.mock('../../api/client', () => ({
  apiReadOnly: vi.fn(),
  getToken: vi.fn(),
  setToken: vi.fn(),
}))
import { apiReadOnly, getToken, setToken } from '../../api/client'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-03T12:00:00Z'))
  sessionStorage.clear()
  vi.mocked(apiReadOnly).mockReset()
  vi.mocked(getToken).mockReset()
  vi.mocked(setToken).mockReset()
})
afterEach(() => vi.useRealTimers())

const NOW = Math.floor(Date.parse('2026-09-03T12:00:00Z') / 1000)

describe('expiryOf / shouldRenew', () => {
  it('decodes exp from a base64url payload and null from garbage', () => {
    expect(expiryOf(tokenExpiringAt(NOW + 100))).toBe((NOW + 100) * 1000)
    expect(expiryOf('not.a.jwt')).toBeNull()
    expect(expiryOf('')).toBeNull()
  })

  it('renews only inside the last six hours of a live token', () => {
    const now = NOW * 1000
    expect(shouldRenew(tokenExpiringAt(NOW + 7 * 3600), now)).toBe(false)
    expect(shouldRenew(tokenExpiringAt(NOW + 5 * 3600), now)).toBe(true)
    expect(shouldRenew(tokenExpiringAt(NOW - 1), now)).toBe(false) // already dead: the 401 path owns it
    expect(RENEW_WITHIN_MS).toBe(6 * 60 * 60 * 1000)
  })
})

describe('maybeRenew', () => {
  it('is a no-op with a fresh token', async () => {
    vi.mocked(getToken).mockReturnValue(tokenExpiringAt(NOW + 20 * 3600))
    await maybeRenew()
    expect(apiReadOnly).not.toHaveBeenCalled()
  })

  it('renews once, single-flight, and stores the new token', async () => {
    vi.mocked(getToken).mockReturnValue(tokenExpiringAt(NOW + 3600))
    let resolve!: (v: { access_token: string }) => void
    vi.mocked(apiReadOnly).mockReturnValue(new Promise((r) => (resolve = r)))
    const a = maybeRenew()
    const b = maybeRenew()
    expect(apiReadOnly).toHaveBeenCalledTimes(1)
    expect(apiReadOnly).toHaveBeenCalledWith('/auth/renew', {})
    resolve({ access_token: 'new.token.here' })
    await Promise.all([a, b])
    expect(setToken).toHaveBeenCalledWith('new.token.here')
  })

  it('swallows a failed renew and lets the next call try again', async () => {
    vi.mocked(getToken).mockReturnValue(tokenExpiringAt(NOW + 3600))
    vi.mocked(apiReadOnly).mockRejectedValueOnce(new Error('offline'))
    await expect(maybeRenew()).resolves.toBeUndefined()
    vi.mocked(apiReadOnly).mockResolvedValueOnce({ access_token: 't2' })
    await maybeRenew()
    expect(setToken).toHaveBeenCalledWith('t2')
  })
})

describe('return-to', () => {
  it('remembers an in-app path and hands it back once', () => {
    rememberReturnTo('/taxes?year=2026')
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBe('/taxes?year=2026')
    expect(consumeReturnTo()).toBe('/taxes?year=2026')
    expect(consumeReturnTo()).toBeNull()
  })

  it('refuses anything that is not a same-origin path', () => {
    rememberReturnTo('//evil.example/x')
    expect(consumeReturnTo()).toBeNull()
    rememberReturnTo('https://evil.example')
    expect(consumeReturnTo()).toBeNull()
    rememberReturnTo('/login?reason=expired')
    expect(consumeReturnTo()).toBeNull() // never bounce back to login itself
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/shell/session.test.ts` → FAIL, module not found.

- [ ] **Step 3: Write `session.ts`**

```ts
// src/components/shell/session.ts
import { apiReadOnly, getToken, setToken } from '../../api/client'

// A session that respects the user (2026-09-03 shell spec §10): renew the bearer token before
// it dies, and after a forced sign-out put the user back where they were.
export const RENEW_WITHIN_MS = 6 * 60 * 60 * 1000
export const RETURN_TO_KEY = 'finance.returnTo'
export const LAST_EMAIL_KEY = 'finance.lastEmail'

/** The token's expiry as epoch milliseconds, or null when it cannot be read. The payload is
 *  decoded, never verified — the server verifies; this only schedules a renewal. */
export function expiryOf(token: string): number | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parts[1].length / 4) * 4, '='))
    const exp = (JSON.parse(json) as { exp?: unknown }).exp
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}

/** Inside the last six hours of a still-live token. A dead token is the 401 path's business. */
export function shouldRenew(token: string, nowMs: number): boolean {
  const exp = expiryOf(token)
  if (exp === null) return false
  const remaining = exp - nowMs
  return remaining > 0 && remaining < RENEW_WITHIN_MS
}

let inFlight: Promise<void> | null = null

/** Renew once when due; concurrent callers share one request; failures are swallowed (the
 *  next successful response tries again). apiReadOnly, not api: a renew writes nothing and
 *  must not wipe the page snapshots. */
export function maybeRenew(nowMs: number = Date.now()): Promise<void> {
  const token = getToken()
  if (token === null || !shouldRenew(token, nowMs)) return Promise.resolve()
  if (inFlight === null) {
    inFlight = apiReadOnly<{ access_token: string }>('/auth/renew', {})
      .then((res) => setToken(res.access_token))
      .catch(() => undefined)
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}

/** Same-origin in-app paths only, never the login page itself. */
function safeReturnTo(value: string | null): string | null {
  if (value === null) return null
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/login')) return null
  return value
}

export function rememberReturnTo(pathAndSearch: string): void {
  try {
    if (safeReturnTo(pathAndSearch) !== null) sessionStorage.setItem(RETURN_TO_KEY, pathAndSearch)
    else sessionStorage.removeItem(RETURN_TO_KEY)
  } catch {
    // Storage blocked: the user simply lands on the overview after signing in.
  }
}

/** Reads AND clears the remembered path. */
export function consumeReturnTo(): string | null {
  try {
    const value = sessionStorage.getItem(RETURN_TO_KEY)
    sessionStorage.removeItem(RETURN_TO_KEY)
    return safeReturnTo(value)
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run the session tests** → PASS (7 tests).

- [ ] **Step 5: Wire `client.ts`** — an after-response hook and the return-to on 401

Add near the top of `src/api/client.ts`:

```ts
// Called after every successful authenticated response (the session renewer registers
// itself here from AuthContext — a direct import would be a cycle, since session.ts uses
// this module's token helpers).
let afterResponse: (() => void) | null = null
export function setAfterResponseHook(hook: (() => void) | null): void {
  afterResponse = hook
}
```

In `request()`, replace the 401 block with:

```ts
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    clearToken()
    clearSnapshots() // snapshots are session data — they must not outlive the token
    clearAssistantSession() // and a financial chat transcript must not outlive it either
    // Return-to-page (2026-09-03 shell spec §10): remember where the user was, say why they
    // are seeing the login, and let LoginPage bring them back after they sign in.
    try {
      sessionStorage.setItem('finance.returnTo', window.location.pathname + window.location.search)
    } catch {
      // storage blocked — they land on the overview instead
    }
    window.location.assign('/login?reason=expired')
    throw new ApiError('Session expired', 401)
  }
```

and, just before `if (res.status === 204) return undefined as T`:

```ts
  if (token !== null && !path.startsWith('/auth/')) afterResponse?.()
```

Add to `src/api/client.test.ts`:

```ts
it('a 401 remembers the current path and sends the user to /login?reason=expired', async () => {
  sessionStorage.clear()
  const assign = vi.fn()
  vi.stubGlobal('location', { ...window.location, pathname: '/taxes', search: '?year=2026', assign })
  localStorage.setItem('finance_token', 'x')
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }))
  await expect(api('/net-worth/summary')).rejects.toMatchObject({ status: 401 })
  expect(sessionStorage.getItem('finance.returnTo')).toBe('/taxes?year=2026')
  expect(assign).toHaveBeenCalledWith('/login?reason=expired')
  vi.unstubAllGlobals()
})

it('runs the after-response hook on successful authenticated calls, not on auth routes', async () => {
  localStorage.setItem('finance_token', 'x')
  const hook = vi.fn()
  setAfterResponseHook(hook)
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
  await api('/net-worth/summary')
  expect(hook).toHaveBeenCalledTimes(1)
  await api('/auth/me')
  expect(hook).toHaveBeenCalledTimes(1)
  setAfterResponseHook(null)
})
```

(Adapt the `location` stub to however the existing 401 test in that file stubs `window.location.assign`; reuse its approach.)

- [ ] **Step 6: `auth.ts`, `AuthContext.tsx`, `ProtectedRoute.tsx`**

`src/api/auth.ts` — change-password now returns a token that keeps this tab signed in:

```ts
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await api<TokenResponse>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
  // Every OTHER session was just signed out (token_version bumped); this token is the only
  // live one, so store it before the next request goes out.
  setToken(res.access_token)
}
```

`src/contexts/AuthContext.tsx` — install the renewer and expose an unreachable-server state:

```tsx
import { maybeRenew } from '../components/shell/session'
import { getToken, setAfterResponseHook, ApiError } from '../api/client'
```

Add `authError: string | null` and `retry: () => void` to `AuthState`. In the provider:

```tsx
  const [authError, setAuthError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    setAfterResponseHook(() => {
      void maybeRenew()
    })
    return () => setAfterResponseHook(null)
  }, [])

  useEffect(() => {
    if (!getToken()) return
    authApi
      .fetchMe()
      .then((me) => {
        setEmail(me.email)
        setAuthError(null)
      })
      .catch((err: unknown) => {
        setEmail(null)
        // A 401 has already been redirected by client.ts; anything else is "can't reach
        // the server", which ProtectedRoute shows with a Retry instead of a blank page.
        if (err instanceof ApiError && err.status !== 401) setAuthError(err.message)
      })
      .finally(() => setIsLoading(false))
  }, [attempt])

  const retry = useCallback(() => {
    setIsLoading(true)
    setAuthError(null)
    setAttempt((n) => n + 1)
  }, [])
```

and include `authError, retry` in the provider value. (`isLoading`'s initializer stays `() => getToken() !== null`.)

`src/components/ProtectedRoute.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import './ProtectedRoute.css'

// The branded splash (2026-09-03 shell spec §10): a wordmark at once, a spinner after 300 ms,
// and a real sentence with Retry when the identity check cannot reach the server — never
// the blank page the `null` return used to be.
export default function ProtectedRoute() {
  const { isAuthenticated, isLoading, authError, retry } = useAuth()
  const [showSpinner, setShowSpinner] = useState(false)
  useEffect(() => {
    if (!isLoading) return
    const timer = setTimeout(() => setShowSpinner(true), 300)
    return () => clearTimeout(timer)
  }, [isLoading])

  if (isLoading || (!isAuthenticated && authError !== null)) {
    return (
      <div className="splash" role="status" aria-live="polite">
        <div className="splash-wordmark">Finance</div>
        {isLoading && showSpinner && <div className="splash-spinner" aria-label="Connecting…" />}
        {!isLoading && authError !== null && (
          <p className="splash-error">
            Can&apos;t reach the server — {authError}{' '}
            <button type="button" className="splash-retry" onClick={retry}>
              Retry
            </button>
          </p>
        )}
      </div>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <Outlet />
}
```

`src/components/ProtectedRoute.css` (new; entry-chunk safe, no panels.css dependency):

```css
.splash {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: var(--muted);
}
.splash-wordmark { font-size: 1.4rem; font-weight: 700; color: var(--text); }
.splash-spinner {
  width: 22px; height: 22px; border-radius: 50%;
  border: 2px solid var(--border); border-top-color: var(--accent);
}
@media (prefers-reduced-motion: no-preference) {
  .splash-spinner { animation: splash-spin 0.9s linear infinite; }
  @keyframes splash-spin { to { transform: rotate(360deg); } }
}
.splash-error { font-size: 0.9rem; }
.splash-retry {
  margin-left: 0.35rem; padding: 0.35rem 0.75rem; border: 1px solid var(--border);
  border-radius: 6px; background: var(--surface-2); color: var(--text); cursor: pointer;
}
```

Add to `src/contexts/AuthContext.test.tsx`:

```tsx
it('exposes a server-unreachable error (not on 401) and retries on demand', async () => {
  localStorage.setItem('finance_token', 't')
  vi.mocked(fetchMe).mockRejectedValueOnce(new ApiError('Network error — is the server reachable?', 0))
  vi.mocked(fetchMe).mockResolvedValueOnce({ email: 'me@example.com' })
  function Probe() {
    const { authError, retry, isAuthenticated } = useAuth()
    return <><span data-testid="err">{authError ?? ''}</span><span data-testid="ok">{String(isAuthenticated)}</span><button onClick={retry}>retry</button></>
  }
  render(<AuthProvider><Probe /></AuthProvider>)
  await waitFor(() => expect(screen.getByTestId('err').textContent).toMatch(/reachable/))
  fireEvent.click(screen.getByText('retry'))
  await waitFor(() => expect(screen.getByTestId('ok').textContent).toBe('true'))
})

it('installs the session renewer as the client after-response hook', () => {
  const spy = vi.spyOn(client, 'setAfterResponseHook')
  render(<AuthProvider><span /></AuthProvider>)
  expect(spy).toHaveBeenCalledWith(expect.any(Function))
})
```

(Import `ApiError` and `* as client` from `'../api/client'` in that test; if the file mocks `../api/client`, extend the mock with `setAfterResponseHook: vi.fn()` and assert on the mock instead.)

- [ ] **Step 7: LoginPage**

Replace `src/pages/LoginPage.tsx` with:

```tsx
import { useEffect, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { LAST_EMAIL_KEY, consumeReturnTo } from '../components/shell/session'
import { useAuth } from '../contexts/AuthContext'
import '../components/panels.css'
import './LoginPage.css'

function readLastEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) ?? ''
  } catch {
    return ''
  }
}

export default function LoginPage() {
  const { isAuthenticated, isLoading, login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const expired = searchParams.get('reason') === 'expired'
  const [email, setEmail] = useState(readLastEmail)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    document.title = 'Sign in · Finance'
  }, [])

  if (!isLoading && isAuthenticated) return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
      try {
        localStorage.setItem(LAST_EMAIL_KEY, email)
      } catch {
        // remembering the email is a nicety
      }
      navigate(consumeReturnTo() ?? '/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  const onPasswordKey = (e: KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(e.getModifierState('CapsLock'))
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Finance Dashboard</h1>
        {expired && (
          <p className="login-notice" role="status">
            Your session expired — sign in to continue where you left off.
          </p>
        )}
        <label>
          Email
          <input
            autoFocus={email === ''}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Password
          <div className="login-password">
            <input
              autoFocus={email !== ''}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyUp={onPasswordKey}
              onKeyDown={onPasswordKey}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="login-toggle"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>
        {capsLock && (
          <p className="login-hint" role="status">
            Caps Lock is on.
          </p>
        )}
        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}
        <button type="submit" className="button button-primary" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
```

Append to `src/pages/LoginPage.css`:

```css
.login-notice { margin: 0 0 0.75rem; font-size: 0.85rem; color: var(--warn); }
.login-hint { margin: -0.25rem 0 0.5rem; font-size: 0.78rem; color: var(--muted); }
.login-password { display: flex; gap: 0.4rem; align-items: center; }
.login-password input { flex: 1; }
.login-toggle {
  padding: 0.35rem 0.6rem; border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface-2); color: var(--muted); cursor: pointer; font-size: 0.78rem;
}
.login-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
```

Add to `src/pages/LoginPage.test.tsx` (following its existing mocking of `useAuth`/`login`):

```tsx
it('explains an expired session and returns to the remembered page after sign-in', async () => {
  sessionStorage.setItem('finance.returnTo', '/taxes?year=2026')
  render(<MemoryRouter initialEntries={['/login?reason=expired']}><Routes><Route path="/login" element={<LoginPage />} /><Route path="*" element={<LocationProbe />} /></Routes></MemoryRouter>)
  expect(screen.getByRole('status').textContent).toMatch(/session expired/i)
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/taxes?year=2026'))
  expect(localStorage.getItem('finance.lastEmail')).toBe('me@example.com')
})

it('toggles password visibility and warns about Caps Lock', () => {
  render(<MemoryRouter><LoginPage /></MemoryRouter>)
  const pw = screen.getByLabelText('Password') as HTMLInputElement
  expect(pw.type).toBe('password')
  fireEvent.click(screen.getByRole('button', { name: 'Show' }))
  expect(pw.type).toBe('text')
  fireEvent.keyUp(pw, { key: 'a', getModifierState: () => true })
  expect(screen.getByText('Caps Lock is on.')).toBeTruthy()
})
```

Where `LocationProbe` renders `useLocation().pathname + search` under `data-testid="location"` (define it in the test file). If `fireEvent.keyUp` cannot pass `getModifierState`, dispatch a `new KeyboardEvent('keyup', { key: 'a', modifierCapsLock: true } as KeyboardEventInit)` on the input instead.

- [ ] **Step 8: Update the Settings password caveat**

In `src/pages/SettingsPage.tsx` replace the sentence `Existing sessions stay signed in until their token expires (~24 h).` with `Other devices are signed out; this one stays signed in.`

- [ ] **Step 9: Run the touched suites**

Run: `npx vitest run src/components/shell/session.test.ts src/api/client.test.ts src/contexts/AuthContext.test.tsx src/pages/LoginPage.test.tsx src/pages/SettingsPage.test.tsx`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/components/shell/session.ts src/components/shell/session.test.ts src/api/client.ts src/api/client.test.ts src/api/auth.ts src/contexts/AuthContext.tsx src/contexts/AuthContext.test.tsx src/components/ProtectedRoute.tsx src/components/ProtectedRoute.css src/pages/LoginPage.tsx src/pages/LoginPage.css src/pages/LoginPage.test.tsx src/pages/SettingsPage.tsx
git commit -m "feat(session): sliding renewal, return-to-page after 401, branded splash, login polish"
```

---

### Task 3: Palette registry, sidebar row, finished actions, arrival params

**Files:**
- Modify: `src/components/navItems.ts` (keywords)
- Create: `src/components/paletteBus.ts`, `src/components/paletteRegistry.ts`, `src/components/paletteRegistry.test.ts`
- Modify: `src/components/CommandPalette.tsx`, `CommandPalette.css`, `CommandPalette.test.tsx`
- Modify: `src/components/useArrivalParam.ts`
- Modify: `src/pages/PortfolioPage.tsx`, `NetWorthPage.tsx`, `SpendingPage.tsx`, `CalendarPage.tsx`, `SettingsPage.tsx`, `src/components/settings/{System,Household,Categories,Accounts,Limits,Assistant}Card.tsx`
- Modify: `src/components/Layout.tsx`, `Layout.css`, `Layout.test.tsx`

- [ ] **Step 1: Keywords on the nav registry**

In `src/components/navItems.ts` add `keywords: string[]` to `NavItem` and to every entry:

```ts
export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Palette aliases: what people type when they mean this page (2026-09-03 shell spec §9). */
  keywords: string[]
}
```

| to | keywords |
|---|---|
| `/` | `['home', 'dashboard', 'summary']` |
| `/update` | `['wizard', 'enter', 'balances', 'month']` |
| `/net-worth` | `['401k', 'accounts', 'balance', 'liabilities', 'assets']` |
| `/portfolio` | `['stocks', 'holdings', 'dividends', 'prices', 'refresh', 'shares']` |
| `/spending` | `['budget', 'categories', 'savings', 'expenses']` |
| `/credit-cards` | `['rewards', 'cards', 'points', 'miles', 'fees']` |
| `/paycheck` | `['salary', 'net pay', 'withholding', 'contributions', 'hsa']` |
| `/comp` | `['rsu', 'vest', 'vesting', 'grant', 'equity', 'tc', 'focal']` |
| `/espp` | `['lots', 'purchase', 'offering', 'discount']` |
| `/taxes` | `['what-if', 'brackets', 'withholding', 'refund', 'irs', 'filing']` |
| `/projection` | `['fire', 'retire', 'forecast', 'monte carlo', 'fi']` |
| `/calendar` | `['payday', 'deadline', 'events', 'ics', 'schedule']` |
| `/settings` | `['preferences', 'options']` |

- [ ] **Step 2: Write the failing registry test**

```ts
// src/components/paletteRegistry.test.ts
import { describe, expect, it, vi } from 'vitest'
import { buildEntries, groupMatches, matchEntries, type PaletteEntry } from './paletteRegistry'

const noop = () => {}

describe('paletteRegistry', () => {
  const entries = buildEntries({ month: '2026-09-01', run: { refreshPrices: noop, askAssistant: noop } })

  it('reaches a page through a keyword alias', () => {
    const hits = matchEntries('rsu', entries)
    expect(hits[0].kind).toBe('page')
    expect(hits[0].label).toBe('Comp')
  })

  it('offers Settings sections as anchored destinations', () => {
    const hit = matchEntries('password', entries).find((e) => e.kind === 'section')
    expect(hit?.to).toBe('/settings#password')
    expect(matchEntries('backup', entries).some((e) => e.to === '/settings#system')).toBe(true)
    expect(matchEntries('limits', entries).some((e) => e.to === '/settings#limits')).toBe(true)
  })

  it('keeps the five actions, with the update month spelled out', () => {
    const actions = entries.filter((e) => e.kind === 'action').map((e) => e.label)
    expect(actions).toEqual([
      'Refresh prices',
      'Enter Sep 2026 update',
      'Add dividend',
      'Add custom event',
      'Ask assistant',
    ])
  })

  it('groups matches by kind in the house order and caps each group at six', () => {
    const many: PaletteEntry[] = Array.from({ length: 9 }, (_, i) => ({
      kind: 'entity',
      id: `t${i}`,
      label: `T${i}`,
      sub: 'Holding',
      keywords: [],
      to: `/portfolio?ticker=T${i}`,
      group: 'Holdings',
    }))
    const grouped = groupMatches(matchEntries('t', [...entries, ...many]))
    const holdings = grouped.find((g) => g.title === 'Holdings')
    expect(holdings?.items).toHaveLength(6)
    expect(grouped.map((g) => g.title).indexOf('Actions')).toBeLessThan(grouped.map((g) => g.title).indexOf('Pages'))
  })

  it('an empty query returns everything static, recents first', () => {
    const all = matchEntries('', entries, ['action:add-dividend'])
    expect(all[0].id).toBe('action:add-dividend')
    expect(all.length).toBe(entries.length)
  })
})
```

- [ ] **Step 3: Run to verify it fails** → module not found.

- [ ] **Step 4: Write `paletteBus.ts` and `paletteRegistry.ts`**

```ts
// src/components/paletteBus.ts
// The sidebar's "Search or jump…" row asks the palette to open through this bus rather than
// a shared context — the palette is mounted once in Layout and must answer from anywhere.
const EVENT = 'finance:palette-open'
export function requestPaletteOpen(): void {
  window.dispatchEvent(new CustomEvent(EVENT))
}
export function onPaletteOpen(handler: () => void): () => void {
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
```

```ts
// src/components/paletteRegistry.ts
import { formatMonth } from '../utils/format'
import { fuzzyScore } from '../utils/fuzzy'
import { NAV_ITEMS } from './navItems'

// What the palette can reach (2026-09-03 shell spec §9): pages (with aliases), Settings
// sections (anchored), actions, and lazily loaded entities. Matching is the house fuzzy
// scorer over label + keywords (+ sub for entities).
export type PaletteKind = 'page' | 'section' | 'action' | 'entity'

export interface PaletteEntry {
  kind: PaletteKind
  id: string
  label: string
  /** Secondary line for entities ("NVIDIA", "Cash · Edward"). */
  sub?: string
  keywords: string[]
  /** Destination for page/section/entity entries. */
  to?: string
  /** Runner for actions. */
  run?: () => void
  /** Group title for entities (Holdings, Accounts, Categories, Cards). */
  group?: 'Holdings' | 'Accounts' | 'Categories' | 'Cards'
}

export interface PaletteGroup {
  title: 'Actions' | 'Pages' | 'Settings' | 'Holdings' | 'Accounts' | 'Categories' | 'Cards'
  items: PaletteEntry[]
}

const GROUP_ORDER: PaletteGroup['title'][] = [
  'Actions', 'Pages', 'Settings', 'Holdings', 'Accounts', 'Categories', 'Cards',
]
export const GROUP_CAP = 6

/** Settings cards reachable as anchored destinations; ids match the cards' `id` attributes. */
export const SETTINGS_SECTIONS: { id: string; label: string; keywords: string[] }[] = [
  { id: 'import', label: 'Import workbook', keywords: ['xlsx', 'spreadsheet', 'upload', 'dry run'] },
  { id: 'system', label: 'System status', keywords: ['backup', 'scheduler', 'refresh', 'database', 'alembic', 'export', 'snapshot'] },
  { id: 'app-settings', label: 'App settings', keywords: ['withdrawal rate', 'swr', 'espp ticker', 'cron'] },
  { id: 'password', label: 'Change password', keywords: ['security', 'sign out everywhere'] },
  { id: 'household', label: 'Household', keywords: ['partner', 'spouse', 'marriage', 'people'] },
  { id: 'categories', label: 'Spending categories', keywords: ['category', 'retire category'] },
  { id: 'accounts', label: 'Accounts', keywords: ['account', 'owner', 'component', 'retire account'] },
  { id: 'limits', label: 'Contribution limits', keywords: ['401k limit', 'hsa limit', 'espp limit', 'irs'] },
  { id: 'assistant', label: 'Assistant', keywords: ['ai', 'api key', 'model', 'nvidia'] },
  { id: 'appearance', label: 'Appearance', keywords: ['theme', 'dark', 'light', 'density', 'compact'] },
]

export interface RegistryRunners {
  refreshPrices: () => void
  askAssistant: () => void
}

/** The static half of the registry: pages, sections, actions. Entities are appended by the
 *  palette once loaded (see `entityEntries`). */
export function buildEntries(opts: { month: string; run: RegistryRunners }): PaletteEntry[] {
  const pages: PaletteEntry[] = NAV_ITEMS.map((item) => ({
    kind: 'page',
    id: `nav:${item.to}`,
    label: item.label,
    keywords: item.keywords,
    to: item.to,
  }))
  const sections: PaletteEntry[] = SETTINGS_SECTIONS.map((s) => ({
    kind: 'section',
    id: `section:${s.id}`,
    label: s.label,
    sub: 'Settings',
    keywords: [...s.keywords, 'settings'],
    to: `/settings#${s.id}`,
  }))
  const actions: PaletteEntry[] = [
    { kind: 'action', id: 'action:refresh-prices', label: 'Refresh prices', keywords: ['quotes', 'update prices'], run: opts.run.refreshPrices },
    { kind: 'action', id: 'action:enter-update', label: `Enter ${formatMonth(opts.month)} update`, keywords: ['wizard', 'balances', 'monthly'], to: '/update' },
    { kind: 'action', id: 'action:add-dividend', label: 'Add dividend', keywords: ['payment', 'income'], to: '/portfolio?tab=dividends' },
    { kind: 'action', id: 'action:add-custom-event', label: 'Add custom event', keywords: ['calendar', 'reminder'], to: '/calendar?add=1' },
    { kind: 'action', id: 'action:ask-assistant', label: 'Ask assistant', keywords: ['ai', 'chat', 'help'], run: opts.run.askAssistant },
  ]
  return [...actions, ...pages, ...sections]
}

export interface EntitySources {
  securities: { ticker: string; name: string }[]
  accounts: { slug: string; name: string; group: string }[]
  categories: { slug: string; name: string }[]
  cards: { slug: string; name: string }[]
}

export function entityEntries(sources: EntitySources): PaletteEntry[] {
  return [
    ...sources.securities.map((s) => ({
      kind: 'entity' as const, id: `ticker:${s.ticker}`, label: s.ticker, sub: s.name,
      keywords: [s.name], to: `/portfolio?ticker=${encodeURIComponent(s.ticker)}`, group: 'Holdings' as const,
    })),
    ...sources.accounts.map((a) => ({
      kind: 'entity' as const, id: `account:${a.slug}`, label: a.name, sub: a.group,
      keywords: [a.group], to: `/net-worth?drill=${encodeURIComponent(a.slug)}`, group: 'Accounts' as const,
    })),
    ...sources.categories.map((c) => ({
      kind: 'entity' as const, id: `category:${c.slug}`, label: c.name, sub: 'Spending',
      keywords: [], to: `/spending?trend=${encodeURIComponent(c.slug)}`, group: 'Categories' as const,
    })),
    ...sources.cards.map((c) => ({
      kind: 'entity' as const, id: `card:${c.slug}`, label: c.name, sub: 'Card',
      keywords: [], to: `/credit-cards?card=${encodeURIComponent(c.slug)}`, group: 'Cards' as const,
    })),
  ]
}

function scoreEntry(query: string, entry: PaletteEntry): number | null {
  const label = fuzzyScore(query, entry.label)
  const alias = [...entry.keywords, entry.sub ?? ''].reduce<number | null>((best, word) => {
    const s = fuzzyScore(query, word)
    return s === null ? best : best === null ? s : Math.max(best, s)
  }, null)
  if (label === null && alias === null) return null
  // A label hit outranks an alias hit of equal strength.
  return Math.max(label === null ? -1 : label + 1, alias ?? -1)
}

/** Ranked matches; the empty query returns everything with `recents` first. */
export function matchEntries(query: string, entries: PaletteEntry[], recents: string[] = []): PaletteEntry[] {
  const trimmed = query.trim()
  if (trimmed === '') {
    const rank = new Map(recents.map((id, index) => [id, index]))
    return [...entries].sort((a, b) => (rank.get(a.id) ?? recents.length) - (rank.get(b.id) ?? recents.length))
  }
  return entries
    .map((entry) => ({ entry, score: scoreEntry(trimmed, entry) }))
    .filter((x): x is { entry: PaletteEntry; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.entry)
}

function titleOf(entry: PaletteEntry): PaletteGroup['title'] {
  if (entry.kind === 'action') return 'Actions'
  if (entry.kind === 'page') return 'Pages'
  if (entry.kind === 'section') return 'Settings'
  return entry.group ?? 'Holdings'
}

/** Kind headers in the house order, at most GROUP_CAP per group, rank order preserved. */
export function groupMatches(matches: PaletteEntry[]): PaletteGroup[] {
  const buckets = new Map<PaletteGroup['title'], PaletteEntry[]>()
  for (const entry of matches) {
    const title = titleOf(entry)
    const bucket = buckets.get(title) ?? []
    if (bucket.length < GROUP_CAP) bucket.push(entry)
    buckets.set(title, bucket)
  }
  return GROUP_ORDER.filter((t) => buckets.has(t)).map((title) => ({ title, items: buckets.get(title)! }))
}
```

- [ ] **Step 5: Run the registry test** → PASS.

- [ ] **Step 6: Rewrite `CommandPalette.tsx` on the registry**

Keep the file's keyboard/ARIA/recents mechanics; replace the `items` construction and the list rendering:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchCreditCards } from '../api/creditCards'
import { fetchAccounts } from '../api/netWorth'
import { fetchSecurities } from '../api/portfolio'
import { refreshPrices } from '../api/prices'
import { fetchCategories } from '../api/spending'
import { currentMonthIso } from '../utils/months'
import { requestAssistantOpen } from './assistant/viewState'
import './CommandPalette.css'
import { onPaletteOpen } from './paletteBus'
import { buildEntries, entityEntries, groupMatches, matchEntries, type PaletteEntry } from './paletteRegistry'
import { useToast } from './ToastProvider'
```

(Confirm the four fetcher names in `src/api/*.ts` — the securities list function may be named differently; use whatever returns `SecurityOut[]`, `AccountOut[]`, `CategoryOut[]`, `CreditCardOut[]`.)

Inside the component:

```tsx
  const toast = useToast()
  const [entities, setEntities] = useState<PaletteEntry[]>([])
  const entitiesLoadedAt = useRef(0)

  // Entities load on the first open and refresh when older than ten minutes — the lists
  // are small and the palette must open instantly, so the fetch never gates the UI.
  useEffect(() => {
    if (!open || Date.now() - entitiesLoadedAt.current < 10 * 60 * 1000) return
    entitiesLoadedAt.current = Date.now()
    Promise.allSettled([fetchSecurities(), fetchAccounts(), fetchCategories(), fetchCreditCards()]).then(
      ([securities, accounts, categories, cards]) => {
        setEntities(
          entityEntries({
            securities: securities.status === 'fulfilled' ? securities.value.filter((s) => s.is_active).map((s) => ({ ticker: s.ticker, name: s.name })) : [],
            accounts: accounts.status === 'fulfilled' ? accounts.value.filter((a) => a.is_active).map((a) => ({ slug: a.slug, name: a.name, group: a.group })) : [],
            categories: categories.status === 'fulfilled' ? categories.value.filter((c) => c.is_active).map((c) => ({ slug: c.slug, name: c.name })) : [],
            cards: cards.status === 'fulfilled' ? cards.value.filter((c) => c.is_active).map((c) => ({ slug: c.slug, name: c.name })) : [],
          }),
        )
      },
    )
  }, [open])

  const entries = useMemo<PaletteEntry[]>(
    () => [
      ...buildEntries({
        month: currentMonthIso(),
        run: {
          refreshPrices: () => {
            toast.info('Refreshing prices…')
            refreshPrices()
              .then((res) => toast.success(`Prices refreshed — ${res.updated} updated${res.failed_count ? `, ${res.failed_count} failed` : ''}`))
              .catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'Price refresh failed'))
            navigate('/portfolio')
          },
          askAssistant: () => requestAssistantOpen(),
        },
      }),
      ...entities,
    ],
    [entities, navigate, toast],
  )

  const matches = matchEntries(query, entries, query.trim() === '' ? readRecent() : [])
  const groups = groupMatches(matches)
  const flat = groups.flatMap((g) => g.items)
  const activeIndex = flat.length === 0 ? -1 : Math.min(active, flat.length - 1)

  const execute = (item: PaletteEntry) => {
    pushRecent(item.id)
    closePalette()
    if (item.run) item.run()
    else if (item.to) navigate(item.to)
  }

  useEffect(() => onPaletteOpen(() => openPalette()))
```

(`refreshPrices()` resolves to the refresh-status payload; read `updated` and `failed_count` — check `src/api/prices.ts` for the exact field names and adjust the toast.)

Render grouped lists — replace the `<ul className="palette-list">` block with:

```tsx
          <ul className="palette-list" id="palette-listbox" role="listbox" aria-label="Commands">
            {groups.map((group) => (
              <li key={group.title} role="presentation" className="palette-group">
                <div className="palette-group-title" aria-hidden="true">{group.title}</div>
                <ul role="group" aria-label={group.title}>
                  {group.items.map((item) => {
                    const index = flat.indexOf(item)
                    return (
                      <li
                        key={item.id}
                        id={`palette-option-${item.id}`}
                        role="option"
                        aria-selected={index === activeIndex}
                        className="palette-option"
                        onMouseDown={(event) => {
                          event.preventDefault()
                          execute(item)
                        }}
                        onMouseMove={() => {
                          if (index !== activeIndex) setActive(index)
                        }}
                      >
                        <span>
                          {item.label}
                          {item.sub && <span className="palette-sub"> {item.sub}</span>}
                        </span>
                        <span className="palette-kind">{group.title}</span>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
```

Use `flat` wherever the old code used `filtered` (arrow keys, Enter, `aria-activedescendant`). Add to `CommandPalette.css`:

```css
.palette-group > ul { list-style: none; margin: 0; padding: 0; }
.palette-group-title {
  padding: 0.35rem 0.9rem 0.15rem; font-size: 0.65rem; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--muted);
}
.palette-sub { color: var(--muted); font-size: 0.8em; }
```

Update `CommandPalette.test.tsx`: the existing "Add dividend" test still expects `/portfolio?tab=dividends`; the "Refresh prices" test now also expects an info toast — render the palette inside `ToastProvider` in that test and assert `screen.getByText('Refreshing prices…')`. Mock the four entity fetchers to resolve `[]` in the file's module mocks. Add:

```tsx
it('reaches Comp through the "rsu" alias and Settings sections through anchors', () => {
  openPalette()
  type('rsu')
  expect(screen.getAllByRole('option')[0].textContent).toContain('Comp')
  type('password')
  fireEvent.keyDown(input(), { key: 'Enter' })
  expect(navigate).toHaveBeenCalledWith('/settings#password')
})

it('lists holdings once they load and opens the drill deep link', async () => {
  vi.mocked(fetchSecurities).mockResolvedValue([{ ticker: 'NVDA', name: 'NVIDIA', is_active: true } as SecurityOut])
  openPalette()
  await screen.findByText('Holdings')
  type('nvda')
  fireEvent.keyDown(input(), { key: 'Enter' })
  expect(navigate).toHaveBeenCalledWith('/portfolio?ticker=NVDA')
})

it('opens from the sidebar bus', () => {
  render(<MemoryRouter><CommandPalette /></MemoryRouter>)
  act(() => requestPaletteOpen())
  expect(screen.getByRole('combobox')).toBeTruthy()
})
```

(`openPalette()`, `type()`, `input()` and `navigate` are whatever helpers the file already uses for Ctrl+K, typing and the mocked `useNavigate`.)

- [ ] **Step 7: Sidebar search row**

In `src/components/Layout.tsx` add `import { Search } from 'lucide-react'` and `import { requestPaletteOpen } from './paletteBus'`; render directly under `<div className="sidebar-title">Finance</div>`:

```tsx
        <button type="button" className="sidebar-search" onClick={requestPaletteOpen}>
          <Search size={14} aria-hidden="true" />
          <span>Search or jump…</span>
          <kbd aria-label="Control K">{navigator.platform.startsWith('Mac') ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
```

`Layout.css`:

```css
.sidebar-search {
  display: flex; align-items: center; gap: 0.5rem; margin: 0 0.25rem 0.6rem;
  padding: 0.4rem 0.6rem; border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg); color: var(--muted); font-size: 0.8rem; cursor: pointer; text-align: left;
}
.sidebar-search span { flex: 1; }
.sidebar-search kbd {
  font-family: inherit; font-size: 0.68rem; padding: 0.05rem 0.35rem;
  border: 1px solid var(--border); border-radius: 4px; color: var(--muted);
}
.sidebar-search:hover { color: var(--text); border-color: var(--muted); }
```

Add to `Layout.test.tsx`: `it('offers a visible search row that opens the palette', () => { …click the button named /Search or jump/… expect(screen.getByRole('combobox')).toBeTruthy() })`.

- [ ] **Step 8: Arrival params and Settings anchors**

`src/components/useArrivalParam.ts` — add a free-form variant:

```ts
/** Like useArrivalParam, for values that are data rather than an enum (a ticker, a slug):
 *  any non-empty value is handed to `apply`, then stripped. */
export function useArrivalValue(key: string, apply: (value: string) => void): void {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get(key)
  useEffect(() => {
    if (raw === null) return
    if (raw.trim() !== '') apply(raw.trim())
    const next = new URLSearchParams(searchParams)
    next.delete(key)
    setSearchParams(next, { replace: true })
  }, [raw, key, apply, searchParams, setSearchParams])
}
```

Pages (each a few lines; `apply` callbacks must be `useCallback`-stable):
- `PortfolioPage.tsx`: `useArrivalValue('ticker', useCallback((t) => setDetailTicker(t.toUpperCase()), []))`. For the existing `?tab=` arrival, after `setTab(value)` also `setTimeout(() => { document.getElementById('portfolio-records')?.scrollIntoView({ block: 'start' }); (document.querySelector('#portfolio-records form input, #portfolio-records form select') as HTMLElement | null)?.focus() }, 0)`; give the records strip's wrapper `id="portfolio-records"`.
- `NetWorthPage.tsx`: `useArrivalValue('drill', useCallback((slug) => { const account = (ts?.accounts ?? []).find((a) => a.slug === slug); if (account) setDrill([{ accountId: account.id, slot: 0 }]) }, [ts]))` — confirm the timeseries account rows carry `slug`; if they carry only `id`/`name`, match on `name` slugified with the same rule the API uses (`slug` is on `/net-worth/accounts`, which the page may already fetch — prefer that list).
- `SpendingPage.tsx`: `useArrivalValue('trend', useCallback((slug) => { const cat = (matrix?.categories ?? []).find((c) => c.slug === slug); if (cat) setTrend([{ categoryId: cat.id, slot: 0 }]) }, [matrix]))` (same slug caveat).
- `CalendarPage.tsx`: `useArrivalParam('add', ['1'] as const, useCallback(() => openAddForm(), [openAddForm]))` — `openAddForm` must be stable (wrap in `useCallback` if it is not).

Settings anchors: add `id="import"`, `id="app-settings"`, `id="password"` to the three inline `<section className="card …">` elements in `SettingsPage.tsx`; `id="system"` (SystemCard), `id="household"` (HouseholdCard), `id="categories"` (CategoriesCard), `id="accounts"` (AccountsCard), `id="limits"` (LimitsCard), `id="assistant"` (AssistantCard). In `SettingsPage.tsx` add:

```tsx
  // Anchored arrival from the palette: scroll the card into view and light it for a moment.
  const { hash } = useLocation()
  useEffect(() => {
    if (!hash || loading) return
    const el = document.getElementById(hash.slice(1))
    if (!el) return
    el.scrollIntoView({ block: 'start' })
    el.classList.add('is-highlighted')
    const timer = setTimeout(() => el.classList.remove('is-highlighted'), 1200)
    return () => clearTimeout(timer)
  }, [hash, loading])
```

with `.card.is-highlighted { outline: 2px solid var(--accent); outline-offset: 2px; }` in `settings.css` (plus a fade under `prefers-reduced-motion: no-preference`: `transition: outline-color var(--t-page) ease`).

- [ ] **Step 9: Run the touched suites**

Run: `npx vitest run src/components/paletteRegistry.test.ts src/components/CommandPalette.test.tsx src/components/Layout.test.tsx src/pages/PortfolioPage.test.tsx src/pages/NetWorthPage.test.tsx src/pages/SpendingPage.test.tsx src/pages/CalendarPage.test.tsx src/pages/SettingsPage.test.tsx`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/components/navItems.ts src/components/paletteBus.ts src/components/paletteRegistry.ts src/components/paletteRegistry.test.ts src/components/CommandPalette.tsx src/components/CommandPalette.css src/components/CommandPalette.test.tsx src/components/useArrivalParam.ts src/components/Layout.tsx src/components/Layout.css src/components/Layout.test.tsx src/pages/PortfolioPage.tsx src/pages/NetWorthPage.tsx src/pages/SpendingPage.tsx src/pages/CalendarPage.tsx src/pages/SettingsPage.tsx src/components/settings
git commit -m "feat(palette): registry with keyword aliases, Settings anchors, entity search, finished actions, sidebar search row"
```

---

### Task 4: Build hash, ShellErrorBoundary, SidebarFooter

**Files:**
- Modify: `vite.config.ts`, `src/vite-env.d.ts`, `src/components/Layout.tsx`, `src/components/Layout.css`
- Create: `src/components/shell/ShellErrorBoundary.tsx` + test, `src/components/shell/SidebarFooter.tsx` + test

- [ ] **Step 1: Build hash**

`vite.config.ts` — add at the top `import { execSync } from 'node:child_process'` and

```ts
function buildHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev'
  } catch {
    return 'dev'
  }
}
```

and inside `defineConfig({ … })`: `define: { __BUILD_HASH__: JSON.stringify(buildHash()) },`. In `src/vite-env.d.ts` add `declare const __BUILD_HASH__: string`.

- [ ] **Step 2: Write the failing boundary test**

```tsx
// src/components/shell/ShellErrorBoundary.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ShellErrorBoundary, { classifyError } from './ShellErrorBoundary'

afterEach(cleanup)

function Boom({ message }: { message: string }): never {
  throw new Error(message)
}

describe('ShellErrorBoundary', () => {
  it('classifies chunk-load failures apart from real errors', () => {
    expect(classifyError(new Error('Failed to fetch dynamically imported module: /assets/x.js'))).toBe('chunk')
    expect(classifyError(new Error('Loading chunk 12 failed'))).toBe('chunk')
    expect(classifyError(new Error('Importing a module script failed.'))).toBe('chunk')
    expect(classifyError(new Error('x is not a function'))).toBe('error')
  })

  it('renders the update message for a chunk failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ShellErrorBoundary buildHash="abc123" getDiagnostics={() => ''}><Boom message="Loading chunk 3 failed" /></ShellErrorBoundary>)
    expect(screen.getByRole('alert').textContent).toMatch(/app was updated/i)
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  })

  it('renders Reload and Copy details with the payload for a real error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<ShellErrorBoundary buildHash="abc123" getDiagnostics={() => 'env=prod alembic=f7d3b2a91c40'}><Boom message="kaboom" /></ShellErrorBoundary>)
    expect(screen.getByRole('alert').textContent).toMatch(/something went wrong/i)
    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }))
    expect(writeText).toHaveBeenCalledTimes(1)
    const payload = writeText.mock.calls[0][0] as string
    expect(payload).toContain('kaboom')
    expect(payload).toContain('build abc123')
    expect(payload).toContain('env=prod')
    vi.unstubAllGlobals()
  })

  it('passes children through when nothing throws', () => {
    render(<ShellErrorBoundary buildHash="x" getDiagnostics={() => ''}><p>fine</p></ShellErrorBoundary>)
    expect(screen.getByText('fine')).toBeTruthy()
  })
})
```

- [ ] **Step 3: Write the boundary**

```tsx
// src/components/shell/ShellErrorBoundary.tsx
import { Component, type ReactNode } from 'react'
import '../Layout.css'

// The shell-level boundary (2026-09-03 shell spec §12). RouteBoundary keeps its per-route
// job; this one wraps the sidebar, palette, drawer and outlet so a throw in an overlay can no
// longer unmount the whole app. Chunk-load failures after a deploy get their own sentence.
const CHUNK_PATTERN =
  /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i

export function classifyError(error: Error): 'chunk' | 'error' {
  return CHUNK_PATTERN.test(`${error.name} ${error.message}`) ? 'chunk' : 'error'
}

interface Props {
  buildHash: string
  /** Extra lines for the copied report — environment, alembic head — supplied by Layout. */
  getDiagnostics: () => string
  children: ReactNode
}
interface State {
  error: Error | null
}

export default class ShellErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  copy = () => {
    const { error } = this.state
    if (!error) return
    const lines = [
      `${error.name}: ${error.message}`,
      error.stack ?? '',
      `route ${window.location.pathname}${window.location.search}`,
      `build ${this.props.buildHash}`,
      this.props.getDiagnostics(),
    ]
    void navigator.clipboard?.writeText(lines.filter(Boolean).join('\n'))
  }

  render() {
    const { error } = this.state
    if (error === null) return this.props.children
    const kind = classifyError(error)
    return (
      <div className="route-fallback shell-fallback" role="alert">
        {kind === 'chunk' ? (
          <>
            The app was updated — reload to get the new version.{' '}
            <button className="route-fallback-button" onClick={() => location.reload()}>
              Reload
            </button>
          </>
        ) : (
          <>
            Something went wrong.{' '}
            <button className="route-fallback-button" onClick={() => location.reload()}>
              Reload
            </button>
            <button className="route-fallback-button" onClick={this.copy}>
              Copy details
            </button>
          </>
        )}
      </div>
    )
  }
}
```

Add to `Layout.css`: `.shell-fallback { min-height: 40vh; display: flex; align-items: center; justify-content: center; gap: 0.35rem; }`.

- [ ] **Step 4: Write the failing footer test**

```tsx
// src/components/shell/SidebarFooter.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../../api/system', () => ({ fetchSystemStatus: vi.fn() }))
import { fetchSystemStatus } from '../../api/system'
import { useAuth } from '../../contexts/AuthContext'
import ThemeProvider from './ThemeProvider'
import SidebarFooter from './SidebarFooter'

const logout = vi.fn()
beforeEach(() => {
  localStorage.clear()
  vi.mocked(useAuth).mockReturnValue({ email: 'me@example.com', isAuthenticated: true, isLoading: false, login: vi.fn(), logout, authError: null, retry: vi.fn() })
  vi.mocked(fetchSystemStatus).mockResolvedValue({ environment: 'prod', database: { alembic_head: 'f7d3b2a91c40', size_bytes: 1 } } as never)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('SidebarFooter', () => {
  it('shows email, environment pill, build hash, and logs out', async () => {
    render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    expect(screen.getByText('me@example.com')).toBeTruthy()
    expect(screen.getByText('abc123')).toBeTruthy()
    expect(await screen.findByText('prod')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /log out/i }))
    expect(logout).toHaveBeenCalled()
  })

  it('toggles the theme explicitly', async () => {
    render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    fireEvent.click(screen.getByRole('button', { name: /switch to light theme/i }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
    expect(localStorage.getItem('finance.theme')).toBe('light')
    expect(screen.getByRole('button', { name: /switch to dark theme/i })).toBeTruthy()
  })

  it('hides the pill until the status answers, and survives a failed status', async () => {
    vi.mocked(fetchSystemStatus).mockRejectedValue(new Error('offline'))
    render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    await waitFor(() => expect(fetchSystemStatus).toHaveBeenCalled())
    expect(screen.queryByText('prod')).toBeNull()
    expect(screen.getByText('me@example.com')).toBeTruthy()
  })
})
```

(Confirm the system-status fetcher name and payload shape in `src/api/system.ts` / `types/api.ts`; the `environment` and `database.alembic_head` fields exist in the live payload.)

- [ ] **Step 5: Write the footer**

```tsx
// src/components/shell/SidebarFooter.tsx
import { LogOut, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getSnapshot, setSnapshot } from '../../api/snapshotCache'
import { fetchSystemStatus } from '../../api/system'
import { useAuth } from '../../contexts/AuthContext'
import type { SystemStatusOut } from '../../types/api'
import { useTheme } from './ThemeProvider'
import './shell.css'

export const SYSTEM_SNAPSHOT = 'shell:system'

// Identity and environment at the bottom of the sidebar (2026-09-03 shell spec §12): who is
// signed in, which deployment this is, which build — so two tabs (dev vs prod) can never be
// confused — plus a one-click theme toggle and Log out.
export default function SidebarFooter({ buildHash }: { buildHash: string }) {
  const { email, logout } = useAuth()
  const { resolved, setTheme } = useTheme()
  const [status, setStatus] = useState<SystemStatusOut | null>(
    () => getSnapshot<SystemStatusOut>(SYSTEM_SNAPSHOT) ?? null,
  )
  useEffect(() => {
    fetchSystemStatus()
      .then((data) => {
        setSnapshot(SYSTEM_SNAPSHOT, data)
        setStatus(data)
      })
      .catch(() => setStatus((current) => current))
  }, [])

  const next = resolved === 'dark' ? 'light' : 'dark'
  return (
    <div className="sidebar-footer">
      <div className="sidebar-footer-row">
        {email && <span className="sidebar-footer-email" title={email}>{email}</span>}
      </div>
      <div className="sidebar-footer-row">
        {status !== null && (
          <span className={`sidebar-footer-pill${status.environment === 'dev' ? ' is-dev' : ''}`}>
            {status.environment}
          </span>
        )}
        <span className="sidebar-footer-hash" title={status ? `alembic ${status.database.alembic_head}` : undefined}>
          {buildHash}
        </span>
      </div>
      <button type="button" className="sidebar-footer-icon" onClick={() => setTheme(next)} aria-label={`Switch to ${next} theme`}>
        {resolved === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
        <span>{resolved === 'dark' ? 'Light theme' : 'Dark theme'}</span>
      </button>
      <button type="button" className="sidebar-footer-icon" onClick={logout}>
        <LogOut size={16} aria-hidden="true" />
        <span>Log out</span>
      </button>
    </div>
  )
}
```

- [ ] **Step 6: Mount both in `Layout.tsx`**

Replace the `<div className="sidebar-separator" …/>` + `<button className="logout-button">…</button>` pair with `<SidebarFooter buildHash={__BUILD_HASH__} />`, and wrap the returned tree:

```tsx
    <ShellErrorBoundary
      buildHash={__BUILD_HASH__}
      getDiagnostics={() => {
        const status = getSnapshot<SystemStatusOut>(SYSTEM_SNAPSHOT)
        return status ? `env=${status.environment} alembic=${status.database.alembic_head}` : ''
      }}
    >
      <div className="layout">…existing children…</div>
    </ShellErrorBoundary>
```

Update `Layout.test.tsx`'s log-out assertion to the new button (same accessible name "Log out"); it may need `ThemeProvider` around `Layout` and a mocked `fetchSystemStatus`.

- [ ] **Step 7: Run and commit**

Run: `npx vitest run src/components/shell/ShellErrorBoundary.test.tsx src/components/shell/SidebarFooter.test.tsx src/components/Layout.test.tsx && npx tsc -b`

```bash
git add vite.config.ts src/vite-env.d.ts src/components/shell/ShellErrorBoundary.tsx src/components/shell/ShellErrorBoundary.test.tsx src/components/shell/SidebarFooter.tsx src/components/shell/SidebarFooter.test.tsx src/components/Layout.tsx src/components/Layout.css src/components/Layout.test.tsx
git commit -m "feat(shell): shell error boundary with chunk detection and Copy details; sidebar footer with identity, env pill, build hash, theme toggle"
```

---

### Task 5: Polish — assertive error toasts, pinnable edge-aware InfoHint, targeted cache invalidation

**Files:**
- Modify: `src/components/ToastProvider.tsx`, `toast.css`, `ToastProvider.test.tsx`
- Modify: `src/components/InfoHint.tsx`, `panels.css`, `InfoHint.test.tsx`
- Modify: `src/api/snapshotCache.ts`, `snapshotCache.test.ts`, `src/api/client.ts`, `client.test.ts`

- [ ] **Step 1: Toasts** — render errors in their own assertive region

In `ToastProvider.tsx` split the region: keep the existing `<div className="toast-region" aria-live="polite" …>` for success/info toasts and add a sibling `<div className="toast-region toast-region-alert" role="alert" aria-live="assertive" …>` with the same hover/focus handlers, rendering `toasts.filter((t) => t.variant === 'error')`; the polite region renders the rest. Both share `regionRef`-style containment for the focus latch (check `document.activeElement` against either region). Update `ToastProvider.test.tsx`'s "carries the error variant" case to assert the error toast sits inside `[role="alert"]`, and the first test's "toasts land inside it" to use a success toast. `toast.css`: `.toast-region-alert { bottom: auto; top: 1rem; }` so alerts stack from the top-right while polite toasts stay bottom-right (keep them clear of the assistant launcher as the existing offset does).

- [ ] **Step 2: InfoHint** — a real popover

Replace `InfoHint.tsx`:

```tsx
import { Info } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import './panels.css'

// The ⓘ beside titles and tile labels. A real disclosure now (2026-09-03 shell spec §13):
// hover opens after 150 ms, click pins, Escape/outside-click unpins, and the bubble flips to
// the left when it would run off the viewport's right edge — no more clipping at card edges.
export default function InfoHint({ text }: { text: string }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [flip, setFlip] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), 150)
  }
  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    if (!pinned) setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const el = wrapRef.current
    if (el) {
      const rect = el.getBoundingClientRect()
      setFlip(rect.left + 280 > window.innerWidth)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPinned(false); setOpen(false) }
    }
    const onDown = (e: MouseEvent) => {
      if (el && !el.contains(e.target as Node)) { setPinned(false); setOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [open])

  return (
    <span ref={wrapRef} className="info-hint-wrap" onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        className="info-hint"
        aria-label={text}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => { if (!pinned) setOpen(false) }}
        onClick={() => { setPinned((p) => !p); setOpen(true) }}
      >
        <Info size={13} aria-hidden="true" />
      </button>
      {open && (
        <span id={id} role="tooltip" className={`info-hint-bubble${flip ? ' is-flipped' : ''}`}>
          {text}
        </span>
      )}
    </span>
  )
}
```

`panels.css`: replace the `.info-hint::after` / `:hover::after` / `:focus-visible::after` rules with:

```css
.info-hint-wrap { position: relative; display: inline-flex; vertical-align: middle; }
.info-hint-bubble {
  position: absolute; bottom: calc(100% + 6px); left: -8px; z-index: 2;
  width: max-content; max-width: 280px; padding: 0.5rem 0.65rem;
  border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2);
  color: var(--text); font-size: 0.78rem; font-weight: 400; line-height: 1.45;
  letter-spacing: normal; text-transform: none; text-align: left; white-space: normal;
}
.info-hint-bubble.is-flipped { left: auto; right: -8px; }
```

and delete the `.info-hint::after` transition inside the motion block. Update `InfoHint.test.tsx`: the label test stays; replace the "hands the same text to the CSS bubble" assertion with: click → `screen.getByRole('tooltip').textContent === text` and `aria-expanded="true"`; Escape closes; a second click unpins.

- [ ] **Step 3: Targeted invalidation**

`snapshotCache.ts` — add:

```ts
/** Drop every key the predicate accepts (family invalidation, 2026-09-03 shell spec §13). */
export function clearSnapshotsWhere(predicate: (key: string) => boolean): void {
  for (const key of [...cache.keys()]) if (predicate(key)) cache.delete(key)
}
```

`client.ts` — replace the coarse `if (method !== 'GET') clearSnapshots()` with `if (method !== 'GET') invalidateForMutation(path)` and add:

```ts
// Which snapshot-key FAMILIES a mutation can have moved (2026-09-03 shell spec §13). Keys are
// `<family>:…`. Unknown paths keep the old posture: wipe everything.
const MUTATION_FAMILIES: [prefix: string, families: string[]][] = [
  ['/spending', ['spending', 'overview', 'projection', 'shell']],
  ['/net-worth', ['networth', 'net-worth', 'overview', 'projection', 'update', 'shell']],
  ['/portfolio', ['portfolio', 'overview', 'calendar']],
  ['/prices', ['portfolio', 'overview', 'calendar']],
  ['/calendar', ['calendar', 'overview']],
  ['/credit-cards', ['cards', 'credit-cards']],
  ['/taxes', ['taxes', 'overview']],
  ['/paycheck', ['paycheck', 'comp', 'espp', 'taxes', 'projection', 'calendar', 'overview']],
  ['/comp', ['paycheck', 'comp', 'espp', 'taxes', 'projection', 'calendar', 'overview']],
  ['/espp', ['paycheck', 'comp', 'espp', 'taxes', 'projection', 'calendar', 'overview']],
  ['/limits', ['paycheck', 'comp', 'espp', 'taxes', 'projection', 'calendar', 'overview']],
]

export function invalidateForMutation(path: string): void {
  const hit = MUTATION_FAMILIES.find(([prefix]) => path.startsWith(prefix))
  if (hit === undefined) {
    clearSnapshots() // /household, /settings, /import, /auth, anything new: correct beats clever
    return
  }
  const families = hit[1]
  clearSnapshotsWhere((key) => families.some((family) => key === family || key.startsWith(`${family}:`)))
}
```

Then run `grep -rn "setSnapshot(\|getSnapshot<" src --include=*.tsx --include=*.ts | grep -v test` and list every snapshot key literal or constant. Every key must start with one of the family names above followed by `:` (or equal it). Rename any that do not (e.g. a bare `'credit-cards'` becomes `'cards:page'`; a `'projection:default'` already conforms) and update its page's tests. Add to `client.test.ts`:

```ts
it('a POST to /spending drops spending, overview and projection snapshots but keeps portfolio', async () => {
  setSnapshot('spending:matrix', 1); setSnapshot('overview:main', 1); setSnapshot('projection:default', 1); setSnapshot('portfolio:holdings:all', 1)
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
  await api('/spending/months/2026-09-01', { method: 'PUT', body: '{}' })
  expect(getSnapshot('spending:matrix')).toBeUndefined()
  expect(getSnapshot('overview:main')).toBeUndefined()
  expect(getSnapshot('projection:default')).toBeUndefined()
  expect(getSnapshot('portfolio:holdings:all')).toBe(1)
})

it('an unknown mutation path still wipes everything', async () => {
  setSnapshot('portfolio:holdings:all', 1)
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
  await api('/household/people', { method: 'POST', body: '{}' })
  expect(getSnapshot('portfolio:holdings:all')).toBeUndefined()
})
```

and adjust the existing "a successful POST wipes the snapshot cache" test to use an unknown path (or the family expectations). `snapshotCache.test.ts` gets a `clearSnapshotsWhere` case.

- [ ] **Step 4: Run the touched suites, then everything**

Run: `npx vitest run src/components/ToastProvider.test.tsx src/components/InfoHint.test.tsx src/api && npx tsc -b && npx eslint src/components src/api src/pages && npx vitest run`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/components/ToastProvider.tsx src/components/toast.css src/components/ToastProvider.test.tsx src/components/InfoHint.tsx src/components/InfoHint.test.tsx src/components/panels.css src/api/snapshotCache.ts src/api/snapshotCache.test.ts src/api/client.ts src/api/client.test.ts
git add -u src   # any snapshot-key renames in pages/tests
git commit -m "feat(shell): assertive error toasts, pinnable edge-aware InfoHint, family-scoped snapshot invalidation"
```

---

### Task 6: Final checks

- [ ] Run `npx tsc -b && npx eslint . && npx vitest run` from the worktree root and, from `<worktree>/backend`, `FINANCE_TEST_DB=finance_test_1c <venv-python> -m pytest -q -x` plus ruff check/format. Fix anything red and commit with `chore(shell): 1c final checks`.

---

## Self-review

**Spec coverage:** §10 (renew endpoint, token_version + `ver`, change-password token, sliding renewal, return-to-page + expired notice, splash, last email, show password, Caps Lock) → Tasks 1–2. §9 (registry, aliases, sections with anchors and highlight, entities from four lists, finished actions with toasts, sidebar row, grouping/caps) → Task 3. §12 (boundary classification, Copy details payload, build hash, footer) → Task 4. §13 (assertive toasts, InfoHint popover with delay/pin/flip/aria, family invalidation with the spec's table plus `shell` and legacy `net-worth`/`credit-cards` spellings) → Task 5. Legibility floor and hero clamp are Plan 1a. **Placeholders:** none — where a name must be confirmed in the codebase (fetcher names, payload fields, whether timeseries accounts carry `slug`) the step says exactly what to look up and what to do in each case. **Type consistency:** `PaletteEntry`/`PaletteGroup`/`buildEntries`/`entityEntries`/`matchEntries`/`groupMatches`, `useArrivalValue`, `setAfterResponseHook`, `maybeRenew`/`consumeReturnTo`/`rememberReturnTo`/`LAST_EMAIL_KEY`, `classifyError`, `SYSTEM_SNAPSHOT`, `clearSnapshotsWhere`/`invalidateForMutation` are used consistently across tasks.
