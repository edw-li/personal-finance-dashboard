# Back/Forward Scroll Restoration Implementation Plan (Batch Plan 5/6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Back/Forward buttons return the reader to the scroll depth they left, while normal (PUSH) navigation keeps today's focus-main + scroll-to-top behavior.

**Architecture:** `Layout` already owns the navigation reset (`Layout.tsx:15-27`). We take ownership of POP restoration (`history.scrollRestoration = 'manual'` — the browser's own restore fires before React has rendered the target page and lands at a stale height), record scroll depth per history entry into `sessionStorage` keyed by `location.key` (survives reload; the key persists in history state), and branch the existing navigation effect on `useNavigationType()`: POP restores, PUSH/REPLACE resets. The effect stays keyed on `pathname` ONLY — search-param navigations (`useSearchParams` drills on Spending/CreditCards/Taxes, `useArrivalParam`) change `location.key` but must NOT yank focus or scroll, exactly as today.

**Tech Stack:** react-router-dom 7 (`useNavigationType`), sessionStorage, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-27-navigation-ux-polish-design.md` §6.

**Conventions:**
- Run tests with `npx vitest run <file>` from the repo root.
- Never push. Commit after each task exactly as written.
- **Coordination note:** Plan 2 (route prefetch) also edits `Layout.tsx`/`Layout.test.tsx` (nav-link props + a warm-all effect + a prefetch describe block). This plan edits the navigation-reset effect and adds its own describe block — different regions. If Plan 2 merged first, apply these edits on top of its versions; the anchor lines quoted below are from pre-Plan-2 `main` but the surrounding code is identical.

---

### Task 1: Scroll recording + POP restoration in Layout

**Files:**
- Modify: `src/components/Layout.tsx`
- Modify: `src/components/Layout.test.tsx`

- [ ] **Step 1: Write the failing tests**

`src/components/Layout.test.tsx` currently renders a two-route shell via `renderShell` and spies `window.scrollTo` in `beforeEach`. Add the following.

1. At the top of the file, extend the react-router import in the shell — replace the existing import line

```tsx
import { MemoryRouter, Route, Routes } from 'react-router-dom'
```

with

```tsx
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
```

2. Below the `renderShell` function, add a probe page + a second shell used only by the new tests (the existing `renderShell` and its tests stay untouched):

```tsx
// POP can't be clicked in a MemoryRouter — a probe button issues navigate(-1).
function BackProbe() {
  const navigate = useNavigate()
  return <button onClick={() => navigate(-1)}>go back</button>
}

function renderBackShell() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>home body</div>} />
          <Route
            path="/spending"
            element={
              <div>
                spending body
                <BackProbe />
              </div>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}
```

3. Add a new describe block at the end of the file:

```tsx
describe('Layout — scroll restoration', () => {
  it('takes manual control of history scroll restoration', () => {
    renderShell()
    expect(history.scrollRestoration).toBe('manual')
  })

  it('restores the recorded depth on POP and still resets on PUSH', () => {
    // Deterministic rAF: the recorder's throttle collapses to a synchronous call.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    renderBackShell()

    // Scroll the home page to 480 — the recorder stores it for this history entry.
    Object.defineProperty(window, 'scrollY', { value: 480, configurable: true })
    fireEvent.scroll(window)

    // PUSH to /spending: today's behavior — focus main, top of page.
    fireEvent.click(screen.getByRole('link', { name: 'Spending' }))
    expect(screen.getByText('spending body')).toBeTruthy()
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0)
    expect(document.activeElement).toBe(screen.getByRole('main'))

    // POP back home: the recorded 480 comes back, focus still lands on main.
    fireEvent.click(screen.getByRole('button', { name: 'go back' }))
    expect(screen.getByText('home body')).toBeTruthy()
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 480)
    expect(document.activeElement).toBe(screen.getByRole('main'))
  })

  it('defaults a POP with no recording to the top', () => {
    renderBackShell()
    fireEvent.click(screen.getByRole('link', { name: 'Spending' }))
    fireEvent.click(screen.getByRole('button', { name: 'go back' }))
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0)
  })
})
```

4. In the file's `beforeEach`, add cleanup so recordings never leak between tests (place after the `scrollTo` spy line):

```tsx
  sessionStorage.clear()
```

And in the `afterEach`, add (before `vi.restoreAllMocks()`):

```tsx
  vi.unstubAllGlobals()
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/Layout.test.tsx`
Expected: FAIL — `history.scrollRestoration` is `'auto'` and the POP assertion sees `(0, 0)` instead of `(0, 480)`.

- [ ] **Step 3: Implement in Layout.tsx**

1. Extend the router import (line 3):

```tsx
import { NavLink, Outlet, useLocation, useNavigationType } from 'react-router-dom'
```

2. Replace the destructuring at line 13 and add hook reads:

```tsx
  const { pathname, key: locationKey } = useLocation()
  const navigationType = useNavigationType()
```

3. Replace the whole navigation-reset block (currently lines 15–27: the `mainRef` declaration through the end of the `useEffect`) with:

```tsx
  const mainRef = useRef<HTMLElement>(null)

  // The nav-reset effect below is deliberately keyed on pathname ONLY: search-param
  // navigations (drill state on Spending/CreditCards/Taxes, useArrivalParam) change
  // location.key but must not yank focus or scroll. The POP branch still needs the
  // CURRENT key and type at fire time, so both ride refs kept fresh each render.
  const navigationTypeRef = useRef(navigationType)
  const locationKeyRef = useRef(locationKey)
  useEffect(() => {
    navigationTypeRef.current = navigationType
    locationKeyRef.current = locationKey
  })

  // Record scroll depth per history entry (rAF-throttled, passive). sessionStorage, not
  // memory: the map must survive a reload for Back to keep working afterwards. We own
  // POP restoration ourselves because the browser's own restore fires before React has
  // rendered the target page and lands at a stale height.
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    let frame = 0
    const record = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        try {
          sessionStorage.setItem(`scroll:${locationKeyRef.current}`, String(window.scrollY))
        } catch {
          // Storage full or blocked — losing restoration is acceptable.
        }
      })
    }
    window.addEventListener('scroll', record, { passive: true })
    return () => {
      window.removeEventListener('scroll', record)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  // First render is the browser's own arrival (its focus and scroll are already right);
  // every LATER pathname change is an in-app navigation, where focus would otherwise
  // strand on the unmounted page's trigger and scroll would keep the old page's depth.
  const arrivedRef = useRef(false)
  useEffect(() => {
    if (!arrivedRef.current) {
      arrivedRef.current = true
      return
    }
    if (navigationTypeRef.current === 'POP') {
      // Back/forward: put the reader where they left off (top for an entry we never
      // saw scroll). preventScroll — the focus hand-off must not fight the restore.
      mainRef.current?.focus({ preventScroll: true })
      const saved = Number(
        sessionStorage.getItem(`scroll:${locationKeyRef.current}`) ?? 0,
      )
      window.scrollTo(0, Number.isFinite(saved) ? saved : 0)
      return
    }
    mainRef.current?.focus()
    window.scrollTo(0, 0)
  }, [pathname])
```

Note the ref-sync effect MUST appear before the two effects that read the refs (source order = run order).

- [ ] **Step 4: Run the Layout tests**

Run: `npx vitest run src/components/Layout.test.tsx`
Expected: PASS — all pre-existing tests (arrival/PUSH behavior unchanged) plus the three new ones.

- [ ] **Step 5: Run the full suite and type-check**

Run: `npx tsc -b && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/Layout.tsx src/components/Layout.test.tsx
git commit -m "feat(nav): Back/Forward restores scroll depth; PUSH keeps focus-main + top"
```

---

## Self-review checklist (run before handing back)

- [ ] PUSH behavior is byte-identical to before (focus main, `scrollTo(0, 0)`); the arrival short-circuit still skips the first render.
- [ ] The nav-reset effect deps are exactly `[pathname]` — a search-param change must not fire it (this is the page-drill contract).
- [ ] `npx tsc -b` clean, `npx vitest run` fully green, ESLint clean (`npx eslint src/components/Layout.tsx`).
- [ ] No changes outside `src/components/Layout.tsx` and `src/components/Layout.test.tsx`.
