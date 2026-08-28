# Motion Grammar Implementation Plan (Batch Plan 4/6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hover states ease instead of snapping, page content enters with a subtle fade-rise, toasts and the command palette animate in (toasts animate out too), the InfoHint bubble fades, buttons give press feedback, and the whole-row click targets get an honest hover affordance — all of it inert under `prefers-reduced-motion: reduce`.

**Architecture:** Two motion tokens in `:root` (`--t-fast: 120ms`, `--t-page: 180ms`); every new `transition`/`animation` lives inside `@media (prefers-reduced-motion: no-preference)` blocks appended per stylesheet (house precedent `PortfolioPage.css:47-50` — opt-in, no counter-override needed). The only JS change is `ToastProvider`: exits need a `leaving` phase (mark → animate → remove after a timeout), which the hover/focus pause latches must skip. There are no clickable whole cards in the app (verified inventory) — the honest-affordance work targets the three whole-row click recipes (`NetWorthPage` accounts table, `HoldingsTable`, `VestingSchedulePanel`).

**Tech Stack:** Plain CSS, React, vitest + @testing-library/react (fake timers for toast exits; no jest-dom — plain attribute/class asserts).

**Spec:** `docs/superpowers/specs/2026-08-27-navigation-ux-polish-design.md` §4, §5, §7.

**Conventions:**
- Run tests with `npx vitest run <file>` from the repo root; never push; commit per task.
- Merge-order note: Plans 1/3 also touch `panels.css` (appends) and the page files. All of this plan's CSS goes at the END of each stylesheet; if a merge conflict appears it is append-vs-append — keep both blocks.

---

### Task 1: Motion tokens + hover transitions + page-enter + press feedback

**Files:**
- Modify: `src/index.css` (`:root` block)
- Modify: `src/components/panels.css` (append)
- Modify: `src/components/Layout.css` (append)
- Modify: `src/components/CommandPalette.css` (append)
- Modify: `src/components/toast.css` (append)

- [ ] **Step 1: Tokens**

In `src/index.css`, inside `:root` (after the `--warn` line and its comment, before `font-family`):

```css
  /* Motion tokens (2026-08-27 spec §4). Consumed only inside
     prefers-reduced-motion: no-preference blocks — under `reduce` nothing reads them. */
  --t-fast: 120ms;
  --t-page: 180ms;
```

- [ ] **Step 2: panels.css — hover easing, press feedback, page-enter**

Append at the END of `src/components/panels.css`:

```css
/* ── Motion grammar (2026-08-27 spec §4) ───────────────────────────── */
/* Opt-in via no-preference (the PortfolioPage.css spinner precedent): under reduced
   motion every rule below is simply absent — hover states snap, exactly as before. */

@media (prefers-reduced-motion: no-preference) {
  .button,
  .chip,
  .month-chip,
  .row-toggle,
  .info-hint,
  .segmented button {
    transition:
      background-color var(--t-fast) ease,
      border-color var(--t-fast) ease,
      color var(--t-fast) ease,
      filter var(--t-fast) ease;
  }

  /* Press feedback: felt, barely seen. */
  .button:active {
    transform: scale(0.985);
  }

  /* Page entrance: one fade-rise per navigation. RouteBoundary is keyed by pathname
     (Layout.tsx), so the .page element remounts exactly once per route change — the
     animation never replays on data refetches. transform is paint-only; EChart's
     ResizeObserver sees no size change. */
  .page {
    animation: page-enter var(--t-page) ease-out;
  }

  @keyframes page-enter {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
}
```

- [ ] **Step 3: Layout.css — sidebar + fallback-button easing**

Append at the END of `src/components/Layout.css`:

```css
/* Motion grammar (2026-08-27 spec §4) — sidebar residents. The skip link is deliberately
   absent: its focus reveal must stay instant. */
@media (prefers-reduced-motion: no-preference) {
  .nav-link,
  .logout-button,
  .route-fallback-button {
    transition:
      background-color var(--t-fast) ease,
      border-color var(--t-fast) ease,
      color var(--t-fast) ease;
  }
}
```

- [ ] **Step 4: CommandPalette.css — option easing (entrances are Task 3)**

Append at the END of `src/components/CommandPalette.css`:

```css
@media (prefers-reduced-motion: no-preference) {
  .palette-option {
    transition: background-color var(--t-fast) ease;
  }
}
```

- [ ] **Step 5: toast.css — button easing (entrances/exits are Task 2)**

Append at the END of `src/components/toast.css`:

```css
@media (prefers-reduced-motion: no-preference) {
  .toast-action,
  .toast-close {
    transition:
      border-color var(--t-fast) ease,
      color var(--t-fast) ease;
  }
}
```

- [ ] **Step 6: Verify + commit**

Run: `npx vitest run` — green (CSS-only; nothing should move).
Sanity: `npx vite build` — clean.

```bash
git add src/index.css src/components/panels.css src/components/Layout.css src/components/CommandPalette.css src/components/toast.css
git commit -m "feat(motion): tokens, hover easing, press feedback, page-enter fade-rise"
```

---

### Task 2: Toast entrances and exits (`leaving` phase)

**Files:**
- Modify: `src/components/ToastProvider.tsx`
- Modify: `src/components/ToastProvider.test.tsx`
- Modify: `src/components/toast.css` (append)

**Design (read first):** `ToastEntry` gains `leaving?: boolean`. `dismiss(id)` becomes: already-leaving → no-op; otherwise clear the auto-timer, mark the entry leaving, and schedule the actual removal ~160 ms out in a SEPARATE timer map (`removalTimers`) that the hover/focus hold-release machinery never touches — holding the pointer over a dying toast must not resurrect it. `arm`/`releaseTimers`/the focus-latch effect skip leaving entries (re-arming one would schedule a second dismiss for a toast already on its way out).

- [ ] **Step 1: Write the failing tests**

Add to `src/components/ToastProvider.test.tsx`, following the file's existing render/probe pattern (a probe component calling `useToast()`; fake timers where the file already uses them):

```tsx
describe('toast exit animation', () => {
  it('dismiss marks the toast leaving, then removes it after the exit window', () => {
    vi.useFakeTimers()
    // render provider + probe; push one toast; click its Dismiss button
    // 1) still in the DOM, now carrying the leaving class:
    const toast = document.querySelector('.toast') as HTMLElement
    expect(toast.className).toContain('toast-leaving')
    // 2) after the exit window it is gone:
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(document.querySelector('.toast')).toBeNull()
    vi.useRealTimers()
  })

  it('auto-dismiss also runs the leaving phase', () => {
    vi.useFakeTimers()
    // push one toast; advance 6000ms (AUTO_DISMISS_MS)
    // → still present with toast-leaving; advance 200ms more → gone
    vi.useRealTimers()
  })

  it('a second dismiss on a leaving toast is a no-op (no double timers, no crash)', () => {
    vi.useFakeTimers()
    // push; click Dismiss twice; advance 200ms; toast gone; no errors
    vi.useRealTimers()
  })

  it('hovering the region does not resurrect a leaving toast', () => {
    vi.useFakeTimers()
    // push; click Dismiss; fire mouseEnter then mouseLeave on .toast-region;
    // advance 200ms → toast gone (release must not re-arm a leaving entry)
    vi.useRealTimers()
  })
})
```

**Also update existing dismissal assertions in this file:** any test that clicks Dismiss/Undo (or advances past `AUTO_DISMISS_MS`) and immediately asserts the toast is gone must now advance timers by 200 ms first (the leaving window). Keep the assertions themselves unchanged.

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/ToastProvider.test.tsx`.

- [ ] **Step 3: Implement in ToastProvider.tsx**

1. Extend the entry type (lines 30–35):

```tsx
interface ToastEntry {
  id: number
  variant: ToastVariant
  message: string
  action?: ToastAction
  /** Exit phase: still rendered (with .toast-leaving) but no longer armable. */
  leaving?: boolean
}
```

2. Add the exit-window constant next to `AUTO_DISMISS_MS` (line 38):

```tsx
// The exit animation's length plus a hair; removal is timer-driven (not animationend)
// so reduced-motion and jsdom behave identically.
const LEAVE_MS = 160
```

3. Add a second timer map next to `timers` (line 53):

```tsx
  // Exit timers live apart from the auto-dismiss map: hold/release pauses reading time,
  // and a toast already leaving has no reading time left to pause.
  const removalTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
```

4. Replace `dismiss` (lines 62–67) with the two-phase version:

```tsx
  const remove = useCallback((id: number) => {
    const timer = removalTimers.current.get(id)
    if (timer !== undefined) clearTimeout(timer)
    removalTimers.current.delete(id)
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const dismiss = useCallback(
    (id: number) => {
      if (removalTimers.current.has(id)) return // already on its way out
      const timer = timers.current.get(id)
      if (timer !== undefined) clearTimeout(timer)
      timers.current.delete(id)
      setToasts((current) =>
        current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)),
      )
      removalTimers.current.set(
        id,
        setTimeout(() => remove(id), LEAVE_MS),
      )
    },
    [remove],
  )
```

5. Skip leaving entries wherever survivors are re-armed. In `releaseTimers` (line 115):

```tsx
    for (const toast of toasts) if (!toast.leaving) arm(toast.id)
```

and in the focus-latch effect (line 128):

```tsx
    if (!hoverPaused.current) for (const toast of toasts) if (!toast.leaving) arm(toast.id)
```

6. Carry the phase onto the element (line 160):

```tsx
              <div
                key={toast.id}
                className={`toast toast-${toast.variant}${toast.leaving ? ' toast-leaving' : ''}`}
              >
```

- [ ] **Step 4: Toast entrance/exit CSS**

Append to `src/components/toast.css` (inside a new no-preference block after Task 1's):

```css
@media (prefers-reduced-motion: no-preference) {
  .toast {
    animation: toast-in 160ms ease-out;
  }

  .toast.toast-leaving {
    animation: toast-out 140ms ease-in forwards;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }

  @keyframes toast-out {
    to {
      opacity: 0;
      transform: translateY(4px) scale(0.98);
    }
  }
}
```

(Under reduced motion the toast simply lingers unanimated for 160 ms before removal — invisible and harmless.)

- [ ] **Step 5: Run to verify pass** — `npx vitest run src/components/ToastProvider.test.tsx`, then any suites that consume toasts (`npx vitest run src/pages/CalendarPage.test.tsx`) — green.

- [ ] **Step 6: Commit**

```bash
git add src/components/ToastProvider.tsx src/components/ToastProvider.test.tsx src/components/toast.css
git commit -m "feat(motion): toast enter/exit — leaving phase the pause latches skip"
```

---

### Task 3: Palette entrance + InfoHint fade

**Files:**
- Modify: `src/components/CommandPalette.css` (append)
- Modify: `src/components/panels.css` (the `.info-hint::after` rules, lines 396–423)

- [ ] **Step 1: Palette entrance CSS**

Append to `src/components/CommandPalette.css`:

```css
/* Entrance only — Esc/close stays instant: dismissal must feel immediate. */
@media (prefers-reduced-motion: no-preference) {
  .palette-overlay {
    animation: palette-overlay-in 120ms ease-out;
  }

  .palette {
    animation: palette-in 140ms ease-out;
  }

  @keyframes palette-overlay-in {
    from {
      opacity: 0;
    }
  }

  @keyframes palette-in {
    from {
      opacity: 0;
      transform: scale(0.985);
    }
  }
}
```

- [ ] **Step 2: InfoHint fade**

In `src/components/panels.css`, the bubble currently toggles `display: none` ↔ `block` (`.info-hint::after` has `display: none;` at line ~404, and lines 420–423 switch it to `display: block`). Replace that mechanism with visibility+opacity so it can fade:

1. In the `.info-hint::after` rule, replace the line `display: none;` with:

```css
  display: block;
  visibility: hidden;
  opacity: 0;
```

2. Replace the reveal rule (lines 420–423):

```css
.info-hint:hover::after,
.info-hint:focus-visible::after {
  display: block;
}
```

with:

```css
.info-hint:hover::after,
.info-hint:focus-visible::after {
  visibility: visible;
  opacity: 1;
}
```

3. Add to the panels.css no-preference block from Task 1 (inside the same `@media`, after the `.button:active` rule):

```css
  /* The bubble fades; visibility rides the same duration so it stays interactable-none
     while invisible. AT-equivalent to the old display toggle: hidden visibility is
     hidden from screen readers too. */
  .info-hint::after {
    transition:
      opacity 100ms ease,
      visibility 100ms;
  }
```

- [ ] **Step 3: Run** — `npx vitest run src/components/InfoHint.test.tsx src/components/CommandPalette.test.tsx` — green. If an InfoHint test asserts the `display` computed style, repoint it at `visibility` (jsdom does not compute cascaded styles, so most likely the tests only assert `data-tip`/roles and pass untouched).

- [ ] **Step 4: Commit**

```bash
git add src/components/CommandPalette.css src/components/panels.css
git commit -m "feat(motion): palette entrance, InfoHint bubble fade"
```

---

### Task 4: Whole-row hover affordance

There are no clickable whole cards in the app; the click-target inventory (spec §7 verification) found exactly three whole-row recipes, each already carrying `cursor: pointer` inline and a nested `.row-toggle` for the keyboard. Give the mouse path a hover surface.

**Files:**
- Modify: `src/components/panels.css` (append inside the Task 1 no-preference block + one base rule)
- Modify: `src/pages/NetWorthPage.tsx:597-601`
- Modify: `src/components/portfolio/HoldingsTable.tsx:106-119`
- Modify: `src/components/comp/VestingSchedulePanel.tsx:32-46`

- [ ] **Step 1: CSS**

Append to `src/components/panels.css` (base rule, OUTSIDE the media query — the hover surface itself is not motion):

```css
/* Whole-row click targets (the NetWorthPage accounts-table recipe): hover names the
   row clickable without lying — only rows that actually navigate/toggle carry it.
   An inline selected background (style attr) still wins over this class rule. */
.row-click:hover {
  background: var(--surface-2);
}
```

and inside the Task 1 `@media (prefers-reduced-motion: no-preference)` block:

```css
  .row-click {
    transition: background-color var(--t-fast) ease;
  }
```

- [ ] **Step 2: Tag the three recipes**

1. `src/pages/NetWorthPage.tsx:599` — the `<tr>` className currently:

```tsx
                    className={account.is_component ? 'component-row' : undefined}
```

becomes:

```tsx
                    className={account.is_component ? 'component-row row-click' : 'row-click'}
```

2. `src/components/portfolio/HoldingsTable.tsx` — the `<tr>` at line 106 has no className today and its `onClick`/cursor are conditional on `onSelect`; the class must be too:

```tsx
                className={onSelect ? 'row-click' : undefined}
```

(add as a prop on that `<tr>`, keeping `onClick`/`style` exactly as they are).

3. `src/components/comp/VestingSchedulePanel.tsx` — the clickable `<tr>` (the `onClick={onToggle}` one at ~line 32): add `row-click` to its className, preserving any existing class string on that element (if it has none, add `className="row-click"`).

- [ ] **Step 3: Run** — `npx vitest run src/pages/NetWorthPage.test.tsx src/components/portfolio/HoldingsTable.test.tsx` and the comp panel suite — green (class additions must not break row queries; fix any exact-className assertion by loosening to `toContain`).

- [ ] **Step 4: Commit**

```bash
git add src/components/panels.css src/pages/NetWorthPage.tsx src/components/portfolio/HoldingsTable.tsx src/components/comp/VestingSchedulePanel.tsx
git commit -m "feat(motion): hover affordance on whole-row click targets"
```

---

### Task 5: Full verification

- [ ] **Step 1:** `npx tsc -b` — clean.
- [ ] **Step 2:** `npx vitest run` — fully green.
- [ ] **Step 3:** `npx eslint src` — clean.
- [ ] **Step 4:** `npx vite build` — clean.
- [ ] **Step 5:** `git status` clean.

---

## Self-review checklist (run before handing back)

- [ ] Every page component renders a `.page` wrapper (verify: `grep -rn "className=\"page\"" src/pages` — every routed page must hit; if one doesn't, the page-enter animation silently skips it and the miss must be reported, not patched ad hoc).
- [ ] Every new `transition`/`animation` sits inside `@media (prefers-reduced-motion: no-preference)` EXCEPT the `.row-click:hover` background (a static hover surface, not motion) and the InfoHint visibility/opacity BASE states (state, not motion — only their `transition` is gated).
- [ ] `.skip-link` gained nothing.
- [ ] Toast pause/release logic: leaving entries are never re-armed (both call sites), and `removalTimers` is untouched by `holdTimers`/`releaseTimers`.
- [ ] The Undo path still consumes-then-acts (`dismiss(toast.id)` before `action.onAction()`) — unchanged semantics, now with a leaving phase.
- [ ] No changes outside the files listed.
