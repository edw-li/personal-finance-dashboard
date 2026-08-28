# Skeleton First Paints + Delayed Fallbacks Implementation Plan (Batch Plan 3/6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First visits paint a page-shaped ghost (real `kpi-row`/`card`/`card-grid` chrome with silent blocks) instead of a centered `Loading…` line, and every loading fallback appears only after ~250 ms — fast loads show nothing at all instead of a flash.

**Architecture:** Skeleton primitives (`.skeleton`, `.loading-fallback` delayed appear, `.visually-hidden`) live in `panels.css`; two tiny components (`PageSkeleton` for whole-page sentinels, `SkeletonCard` for section sentinels) live in `src/components/PageSkeleton.tsx`. Pages swap their first-visit `Loading…` text for the matching ghost. **Render conditions are byte-identical to today** — only the JSX inside the branch changes — so this plan composes cleanly with Plan 1 (snapshot cache), which changes when those branches fire but not their shape. The route-chunk fallback keeps its text (it must stay independent of panels.css — documented constraint at `Layout.css:100-108`) and gains the same delay via its own rules.

**Tech Stack:** Plain CSS + React, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-27-navigation-ux-polish-design.md` §3.

**Conventions:**
- Run tests with `npx vitest run <file>` from the repo root; never push; commit per task.
- All hidden-but-announced text stays in the DOM, so existing tests that `getByText('Loading…')` (or the section variants like `Loading lots…`) keep passing — the strings move into `.visually-hidden` elements instead of disappearing. If any page test asserts on element TYPE (e.g. `p.empty-note`), update that assertion to the new structure as part of the page's task.
- Reduced motion: the skeleton pulse sits behind `@media (prefers-reduced-motion: no-preference)` (house precedent `PortfolioPage.css:47`); the delayed *appear* is an opacity fade, deliberately unconditional (it is appearance, not movement).

---

### Task 1: Skeleton primitives + components

**Files:**
- Modify: `src/components/panels.css` (append at end of file)
- Create: `src/components/PageSkeleton.tsx`
- Create: `src/components/PageSkeleton.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/PageSkeleton.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import PageSkeleton, { SkeletonCard } from './PageSkeleton'

afterEach(cleanup)

describe('PageSkeleton', () => {
  it('announces loading and hides the ghosts from AT', () => {
    render(<PageSkeleton tiles={3} cards={[{ span: 12 }]} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('Loading…')
    expect(status.className).toContain('visually-hidden')
    // Every ghost container is aria-hidden; nothing but the status line is exposed.
    expect(document.querySelector('.kpi-row')?.getAttribute('aria-hidden')).toBe('true')
    expect(document.querySelector('.card-grid')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('renders the requested shape with the house chrome', () => {
    render(
      <PageSkeleton
        tiles={4}
        cards={[
          { span: 6, height: 220 },
          { span: 12, height: 340 },
        ]}
      />,
    )
    expect(document.querySelectorAll('.kpi-row .stat-tile').length).toBe(4)
    const cards = document.querySelectorAll('.card-grid .card')
    expect(cards.length).toBe(2)
    expect(cards[0].className).toContain('span-6')
    expect(cards[1].className).toContain('span-12')
    expect(
      (cards[1].querySelector('.skeleton-body') as HTMLElement).style.height,
    ).toBe('340px')
    expect(document.querySelector('.page-skeleton')?.className).toContain('loading-fallback')
  })

  it('omits empty sections', () => {
    render(<PageSkeleton cards={[{ span: 12 }]} />)
    expect(document.querySelector('.kpi-row')).toBeNull()
  })
})

describe('SkeletonCard', () => {
  it('announces its label and ghosts a single card', () => {
    render(<SkeletonCard height={260} label="Loading lots…" />)
    expect(screen.getByText('Loading lots…').className).toContain('visually-hidden')
    const card = document.querySelector('section.card') as HTMLElement
    expect(card.className).toContain('loading-fallback')
    expect(card.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect((card.querySelector('.skeleton-body') as HTMLElement).style.height).toBe('260px')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/PageSkeleton.test.tsx`
Expected: FAIL — cannot resolve `./PageSkeleton`.

- [ ] **Step 3: Implement the component**

Create `src/components/PageSkeleton.tsx`:

```tsx
import './panels.css'

// Ghost first paint (2026-08-27 spec §3): the page's REAL chrome — kpi-row, card,
// card-grid — with silent blocks where data will land, so the structure appears
// immediately and nothing jumps when the payload fills it. Ghosts are aria-hidden;
// what a screen reader gets is the visually-hidden status line, exactly the sentence
// the old text fallback carried. Both components ride .loading-fallback, so anything
// resolving inside the delay window shows nothing at all.

export default function PageSkeleton({
  tiles = 0,
  cards = [],
}: {
  tiles?: number
  cards?: { span: 4 | 6 | 8 | 12; height?: number }[]
}) {
  return (
    <div className="page-skeleton loading-fallback">
      <p className="visually-hidden" role="status">
        Loading…
      </p>
      {tiles > 0 && (
        <div className="kpi-row" aria-hidden="true">
          {Array.from({ length: tiles }, (_, i) => (
            <div className="stat-tile" key={i}>
              <div className="skeleton skeleton-label" />
              <div className="skeleton skeleton-value" />
            </div>
          ))}
        </div>
      )}
      {cards.length > 0 && (
        <div className="card-grid" aria-hidden="true">
          {cards.map((card, i) => (
            <section className={`card span-${card.span}`} key={i}>
              <div className="skeleton skeleton-label" />
              <div
                className="skeleton skeleton-body"
                style={{ height: card.height ?? 220 }}
              />
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

/** Section-level ghost for pages whose sentinels are per-card ("Loading lots…"):
 *  one house card, same delay, label preserved for AT parity with the old text. */
export function SkeletonCard({
  height = 200,
  label = 'Loading…',
}: {
  height?: number
  label?: string
}) {
  return (
    <section className="card loading-fallback">
      <p className="visually-hidden">{label}</p>
      <div aria-hidden="true">
        <div className="skeleton skeleton-label" />
        <div className="skeleton skeleton-body" style={{ height }} />
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Add the CSS primitives**

Append to the END of `src/components/panels.css`:

```css
/* ── Skeleton first paint (2026-08-27 spec §3) ─────────────────────── */

.skeleton {
  background: var(--surface-2);
  border-radius: 6px;
}

.skeleton-label {
  width: 40%;
  height: 0.6875rem;
  margin-bottom: 0.6rem;
}

.skeleton-value {
  width: 65%;
  height: 1.45rem;
}

/* Delayed appearance: anything that resolves inside the delay shows NOTHING — flashing
   a fallback for 80ms reads clunkier than the wait it fills. Opacity, not display, so
   the appear can fade. Deliberately outside the reduced-motion gate: a delayed fade-in
   is appearance, not movement; the pulse below is movement and stays gated. */
.loading-fallback {
  opacity: 0;
  animation: fallback-appear 200ms ease 250ms forwards;
}

@keyframes fallback-appear {
  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .skeleton {
    animation: skeleton-pulse 1.4s ease-in-out infinite;
  }

  @keyframes skeleton-pulse {
    0%,
    100% {
      opacity: 1;
    }

    50% {
      opacity: 0.55;
    }
  }
}

/* Screen-reader-only text (the skeletons' announced state). */
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/components/PageSkeleton.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/PageSkeleton.tsx src/components/PageSkeleton.test.tsx src/components/panels.css
git commit -m "feat(loading): skeleton primitives — PageSkeleton, SkeletonCard, delayed fallback"
```

---

### Task 2: Overview + Portfolio first paints

**Files:**
- Modify: `src/pages/OverviewPage.tsx:292-293`
- Modify: `src/pages/PortfolioPage.tsx:331-332`

- [ ] **Step 1: OverviewPage**

Add the import (with the other component imports, after the `MoneyFlowCard` import):

```tsx
import PageSkeleton from '../components/PageSkeleton'
```

At lines 292–293, the current branch is:

```tsx
        // A failed FIRST load shows the banner alone rather than a page of $0.00 tiles that
        // reads as "you are broke" (PortfolioPage posture).
        busy && <p className="empty-note">Loading…</p>
```

Replace ONLY the JSX line (keep the comment):

```tsx
        busy && (
          <PageSkeleton
            tiles={4}
            cards={[
              { span: 6, height: 220 },
              { span: 6, height: 280 },
              { span: 6, height: 240 },
              { span: 6, height: 200 },
            ]}
          />
        )
```

- [ ] **Step 2: PortfolioPage**

Add the import (after the `RangeChips` import):

```tsx
import PageSkeleton from '../components/PageSkeleton'
```

At lines 331–332, the current branch is:

```tsx
      {loading ? (
        <p className="empty-note">Loading…</p>
```

Replace the fallback element only (the `loading ?` condition is untouched):

```tsx
      {loading ? (
        <PageSkeleton
          tiles={4}
          cards={[
            { span: 12, height: 340 },
            { span: 12, height: 300 },
          ]}
        />
```

- [ ] **Step 3: Run both page suites**

Run: `npx vitest run src/pages/OverviewPage.test.tsx src/pages/PortfolioPage.tsx src/pages/SpendingPage.test.tsx`
(If `PortfolioPage` has no test file — it doesn't as of `main` — run just the Overview suite.)
Expected: PASS. If a test queried `Loading…` by text it still passes (the string lives in the skeleton's status line); if one asserted on `p.empty-note` for the loading state, repoint it at `screen.getByRole('status')`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/OverviewPage.tsx src/pages/PortfolioPage.tsx
git commit -m "feat(loading): Overview + Portfolio first visits paint page-shaped skeletons"
```

---

### Task 3: Taxes + Projection first paints

**Files:**
- Modify: `src/pages/TaxesPage.tsx:589-591`
- Modify: `src/pages/ProjectionPage.tsx:553`

- [ ] **Step 1: TaxesPage**

Add the import (after the `InfoHint` import):

```tsx
import PageSkeleton from '../components/PageSkeleton'
```

At lines 589–591, the current branch is:

```tsx
      {(loading || (busy && detail === null && years.length > 0)) && (
        <p className="empty-note">Loading…</p>
      )}
```

Replace with (condition unchanged):

```tsx
      {(loading || (busy && detail === null && years.length > 0)) && (
        <PageSkeleton
          cards={[
            { span: 12, height: 90 },
            { span: 12, height: 320 },
          ]}
        />
      )}
```

- [ ] **Step 2: ProjectionPage**

Add the import (after the `StatTile` import):

```tsx
import PageSkeleton from '../components/PageSkeleton'
```

At line 553, the current sentinel is:

```tsx
      {data === null && !missing && busy && <p className="empty-note">Loading the projection…</p>}
```

Replace with:

```tsx
      {data === null && !missing && busy && (
        <PageSkeleton tiles={3} cards={[{ span: 12, height: 340 }]} />
      )}
```

Note: `PageSkeleton`'s announced text is `Loading…` — the projection-specific sentence is not preserved verbatim. Check `src/pages/ProjectionPage.test.tsx` for an assertion on `Loading the projection…`; if present, update it to `screen.getByRole('status')` / `Loading…`.

- [ ] **Step 3: Run both suites**

Run: `npx vitest run src/pages/TaxesPage.test.tsx src/pages/ProjectionPage.test.tsx`
Expected: PASS after any assertion repointing per the note above.

- [ ] **Step 4: Commit**

```bash
git add src/pages/TaxesPage.tsx src/pages/ProjectionPage.tsx
git commit -m "feat(loading): Taxes + Projection first visits paint skeletons"
```

---

### Task 4: Section skeletons — ESPP, Paycheck, Comp

These pages sentinel per SECTION, so they take `SkeletonCard` (label preserved for AT parity).

**Files:**
- Modify: `src/pages/EsppPage.tsx:1344,1369`
- Modify: `src/pages/PaycheckPage.tsx:768,795`
- Modify: `src/pages/CompPage.tsx:569,615`

- [ ] **Step 1: EsppPage**

Add the import (after the `InfoHint` import):

```tsx
import { SkeletonCard } from '../components/PageSkeleton'
```

Line 1344 — replace:

```tsx
        lotsBusy && <p className="empty-note">Loading lots…</p>
```

with:

```tsx
        lotsBusy && <SkeletonCard height={260} label="Loading lots…" />
```

Line 1369 — replace:

```tsx
        offeringsBusy && <p className="empty-note">Loading offerings…</p>
```

with:

```tsx
        offeringsBusy && <SkeletonCard height={220} label="Loading offerings…" />
```

- [ ] **Step 2: PaycheckPage**

Add the same import (after the `InfoHint` import). Line 768 — replace:

```tsx
        breakdownBusy && <p className="empty-note">Loading the breakdown…</p>
```

with:

```tsx
        breakdownBusy && <SkeletonCard height={320} label="Loading the breakdown…" />
```

Line 795 — replace:

```tsx
        profilesBusy && <p className="empty-note">Loading profiles…</p>
```

with:

```tsx
        profilesBusy && <SkeletonCard height={240} label="Loading profiles…" />
```

- [ ] **Step 3: CompPage**

Add the same import (after the `InfoHint` import). Line 569 — replace:

```tsx
        busy && <p className="empty-note">Loading comp events…</p>
```

with:

```tsx
        busy && <SkeletonCard height={240} label="Loading comp events…" />
```

Line 615 — replace:

```tsx
        scheduleBusy && <p className="empty-note">Loading the vesting schedule…</p>
```

with:

```tsx
        scheduleBusy && <SkeletonCard height={280} label="Loading the vesting schedule…" />
```

- [ ] **Step 4: Run the three suites**

Run: `npx vitest run src/pages/EsppPage.test.tsx src/pages/PaycheckPage.test.tsx src/pages/CompPage.test.tsx`
Expected: PASS — the labels remain queryable by text. Repoint any assertion that targeted `p.empty-note` structurally.

- [ ] **Step 5: Commit**

```bash
git add src/pages/EsppPage.tsx src/pages/PaycheckPage.tsx src/pages/CompPage.tsx
git commit -m "feat(loading): section skeletons on ESPP, Paycheck, Comp"
```

---

### Task 5: Calendar delay + route-fallback delay

Calendar's month grid is a shape the generic skeleton would misrepresent (spec §3) — it keeps its text but gains the delay. The route fallback does the same, self-contained in `Layout.css`.

**Files:**
- Modify: `src/pages/CalendarPage.tsx:247`
- Modify: `src/components/Layout.css:103-108`

- [ ] **Step 1: CalendarPage**

Line 247 — replace:

```tsx
        busy && <p className="empty-note">Loading…</p>
```

with:

```tsx
        busy && <p className="empty-note loading-fallback">Loading…</p>
```

(`panels.css` is already imported by this page, so `.loading-fallback` resolves.)

- [ ] **Step 2: Route fallback delay in Layout.css**

`.route-fallback` (Layout.css:103-108) styles BOTH the Suspense `Loading…` and RouteBoundary's error line; delaying the error line 250 ms is equally desirable (no flash). It must not depend on panels.css, so it gets its own keyframes. Replace the existing `.route-fallback` rule with:

```css
.route-fallback {
  color: var(--muted);
  font-size: 0.85rem;
  padding: 1.5rem 0;
  text-align: center;
  /* Appears only after ~250ms: a chunk that lands faster never flashes the fallback.
     Own keyframes, not panels.css's fallback-appear — this file must stay standalone
     (the note above). */
  opacity: 0;
  animation: route-fallback-appear 200ms ease 250ms forwards;
}

@keyframes route-fallback-appear {
  to {
    opacity: 1;
  }
}
```

- [ ] **Step 3: Run the two suites + full suite**

Run: `npx vitest run src/pages/CalendarPage.test.tsx src/components/Layout.test.tsx && npx vitest run`
Expected: PASS (classes don't change queries).

- [ ] **Step 4: Commit**

```bash
git add src/pages/CalendarPage.tsx src/components/Layout.css
git commit -m "feat(loading): delayed appearance for calendar + route fallbacks"
```

---

### Task 6: Full verification

- [ ] **Step 1:** `npx tsc -b` — clean.
- [ ] **Step 2:** `npx vitest run` — fully green.
- [ ] **Step 3:** `npx eslint src` — clean.
- [ ] **Step 4:** Commit anything outstanding; confirm `git status` clean.

---

## Self-review checklist (run before handing back)

- [ ] Every replaced sentinel's CONDITION is byte-identical to before (grep each page for `busy &&` / `loading ?` context above) — Plan 1 depends on that.
- [ ] `Loading…` / section labels still reachable by text queries (AT + test parity).
- [ ] The pulse is inside `@media (prefers-reduced-motion: no-preference)`; the delayed appear is not (deliberate — see Task 1 CSS comment).
- [ ] NetWorth / Spending / CreditCards / MonthlyUpdate / Settings pages untouched (they have no first-visit text sentinel; the last two are excluded surfaces).
- [ ] No changes outside the files listed in this plan.
