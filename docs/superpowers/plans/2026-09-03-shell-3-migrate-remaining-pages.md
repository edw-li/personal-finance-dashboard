# Shell 3 — Migrate the remaining pages in pairs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every remaining page renders through `PageFrame`, takes its owner / range / month from the shared scope (where the spec's adoption table says so), and shows feed-level loading and error states through two small shell components instead of hand-rolled markup — per `docs/superpowers/specs/2026-09-03-shell-grammar-design.md` §5–§8 and §16 phase 3.

**Architecture:** Task 1 adds `Feed` (a card-level feed: banner-with-stale-cue, skeleton, dimmed body) and `FeedBanner` (a bare alert for form/save errors) to `src/components/shell/`, so multi-feed pages (Comp, ESPP, Paycheck, Taxes) keep their exact strings and behaviour while the page-level frame handles the title row, actions, sticky scope row and the primary lifecycle. Tasks 2–7 migrate pages in the spec's pairs; each pair is independent of the others and can run in its own worktree once Task 1 is on the base branch. Scope adoption follows Plan 2's pattern: URL first (`useScope`), local mirror state adopted with React's adjust-during-render idiom (the `CategoriesPanel` precedent), ref writes only in promise continuations, never a `setState` inside an effect body.

**Tech Stack:** React 19, react-router 7, vitest + Testing Library.

**Prerequisites:** Plans 1a, 1b, 1c and 2 merged into `main`. Task 1 lands on `main` (or a `shell-3-base` branch) BEFORE the pair lanes branch from it. Pair lanes: `shell-3a` … `shell-3f`, each a worktree with a `node_modules` junction; frontend commands from the worktree root.

---

## File structure

| File | Change |
|---|---|
| `src/components/shell/Feed.tsx` (+ test) | new: `Feed<T>` and `FeedBanner` |
| `src/pages/PortfolioPage.tsx` (+ css, test) | PageFrame; owner + range from scope; header status → subheader |
| `src/pages/SpendingPage.tsx` (+ css, test) | PageFrame; range + month (drill) from scope; ribbon view mode with totals |
| `src/pages/CreditCardsPage.tsx` (+ css, test) | PageFrame; owner from scope (client-side filter, no refetch) |
| `src/pages/MonthlyUpdatePage.tsx` (+ css, test) | PageFrame; ribbon edit mode with the wizard's own handler; steps → subheader |
| `src/pages/PaycheckPage.tsx` (+ css, test) | PageFrame; person chips → owner scope without All/Joint; two `Feed`s |
| `src/pages/CompPage.tsx` (+ test) | PageFrame; two `Feed`s |
| `src/pages/EsppPage.tsx` (+ test) | PageFrame; two `Feed`s + `FeedBanner`s |
| `src/pages/TaxesPage.tsx` (+ test) | PageFrame (years list lifecycle); detail `Feed`; `FeedBanner` |
| `src/pages/ProjectionPage.tsx` (+ test) | PageFrame with the `missing` empty state as ready children |
| `src/pages/CalendarPage.tsx` (+ test) | PageFrame; actions keep the Add-event ref |
| `src/pages/SettingsPage.tsx` (+ test) | PageFrame; card-level `FeedBanner`s |
| `src/pages/NotFoundPage.tsx` | PageFrame |

**Test hygiene for every new or extended test file in this plan:** the repo's vitest config has no `globals` and no setup file, so React Testing Library does NOT auto-clean between tests — add `afterEach(cleanup)` (the house pattern, see `src/components/PageSkeleton.test.tsx`) or role/text queries will find leftovers from earlier renders. `SkeletonCard` exposes its label as visually-hidden text, so query it with `getByText(label)`, not `getByLabelText`.

**Contracts this plan relies on** (from Plans 1a/1b): `PageFrame` props `title`, `actions?`, `subheader?`, `scopeRow?`, `resource: { status, error?, busy?, fromCache?, retry? }`, `skeleton?: { tiles?, cards? }`; `ScopeBar` props `owner?: boolean | { joint: boolean; all?: boolean }`, `range?: boolean`, `month?: { mode: 'view' | 'edit'; anchor?; figures?; editHref?; selected?; onSelect? }`; `useScope(uses)` → `{ scope: { owner, range, month }, setScope }` where `scope.month` is an ISO first-of-month string or null and the URL carries `month=YYYY-MM` (legacy `YYYY-MM-DD` links are accepted and rewritten); `Segmented` props `variant`, `options`, `ariaLabel`, `value`, `onChange`, `multiple?`; `SkeletonCard` from `src/components/PageSkeleton` (`height`, `label`).

---

### Task 1: `Feed` and `FeedBanner`

**Files:**
- Create: `src/components/shell/Feed.tsx`
- Test: `src/components/shell/Feed.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/shell/Feed.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Feed, { FeedBanner } from './Feed'

describe('Feed', () => {
  it('shows the skeleton while busy with no data, and nothing when idle with no data', () => {
    const { rerender } = render(
      <Feed data={null} busy staleNoun="the table" skeleton={{ height: 200, label: 'Loading rows…' }}>
        {() => <p>rows</p>}
      </Feed>,
    )
    expect(screen.getByLabelText('Loading rows…')).toBeTruthy()
    expect(screen.queryByText('rows')).toBeNull()
    rerender(
      <Feed data={null} busy={false} staleNoun="the table" skeleton={{ height: 200, label: 'Loading rows…' }}>
        {() => <p>rows</p>}
      </Feed>,
    )
    expect(screen.queryByLabelText('Loading rows…')).toBeNull()
  })

  it('renders the empty node when idle with no data and one is given', () => {
    render(
      <Feed data={null} busy={false} staleNoun="the table" skeleton={{ height: 200, label: 'x' }} empty={<p>none yet</p>}>
        {() => <p>rows</p>}
      </Feed>,
    )
    expect(screen.getByText('none yet')).toBeTruthy()
  })

  it('renders children from the data and dims them while busy', () => {
    const { container, rerender } = render(
      <Feed data={{ n: 3 }} busy={false} staleNoun="the table" skeleton={{ height: 200, label: 'x' }}>
        {(d) => <p>{d.n} rows</p>}
      </Feed>,
    )
    expect(screen.getByText('3 rows')).toBeTruthy()
    expect(container.querySelector('.loading-dim.is-loading')).toBeNull()
    rerender(
      <Feed data={{ n: 3 }} busy staleNoun="the table" skeleton={{ height: 200, label: 'x' }}>
        {(d) => <p>{d.n} rows</p>}
      </Feed>,
    )
    expect(container.querySelector('.loading-dim.is-loading')).toBeTruthy()
  })

  it('banner: bare error with no data, stale cue with data, Retry with the given label', () => {
    const retry = vi.fn()
    const { rerender } = render(
      <Feed data={null} busy={false} error="offline" staleNoun="the table" retry={retry} retryLabel="Retry loading rows" skeleton={{ height: 1, label: 'x' }}>
        {() => null}
      </Feed>,
    )
    expect(screen.getByRole('alert').textContent).toContain('offline')
    expect(screen.getByRole('alert').textContent).not.toContain('earlier data')
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading rows' }))
    expect(retry).toHaveBeenCalledTimes(1)
    rerender(
      <Feed data={{}} busy={false} error="offline" staleNoun="the table" retry={retry} skeleton={{ height: 1, label: 'x' }}>
        {() => <p>rows</p>}
      </Feed>,
    )
    expect(screen.getByRole('alert').textContent).toBe('offline — the table may be showing earlier data. Retry')
  })
})

describe('FeedBanner', () => {
  it('renders nothing for a null error and an alert otherwise', () => {
    const { container, rerender } = render(<FeedBanner error={null} />)
    expect(container.firstChild).toBeNull()
    rerender(<FeedBanner error="bad input" />)
    expect(screen.getByRole('alert').textContent).toBe('bad input')
  })

  it('offers Retry when given one', () => {
    const retry = vi.fn()
    render(<FeedBanner error="bad" retry={retry} retryLabel="Retry the model" />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry the model' }))
    expect(retry).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/shell/Feed.test.tsx` → FAIL, module not found.

- [ ] **Step 3: Write the component**

```tsx
// src/components/shell/Feed.tsx
import type { ReactNode } from 'react'
import { SkeletonCard } from '../PageSkeleton'
import '../panels.css'

// A card-level feed's three states, in the grammar the multi-feed pages (Comp, ESPP,
// Paycheck, Taxes) each hand-rolled (2026-09-03 shell spec §5 — "no bespoke loading or
// error markup"): a banner whose stale cue appears only when there IS something stale, a
// ghost card while the first payload is in flight, and a dimmed body while a later one is.
// Pages keep their own state; this only decides what it looks like.
export interface FeedProps<T> {
  data: T | null
  error?: string | null
  busy: boolean
  /** Names what is stale in the banner: "the table", "the schedule", "this breakdown". */
  staleNoun: string
  retry?: () => void
  retryLabel?: string
  skeleton: { height: number; label: string }
  /** Rendered only when data is present — the render prop narrows the type for callers. */
  children: (data: T) => ReactNode
  /** Idle with no data and no error: an empty state instead of nothing. */
  empty?: ReactNode
}

export default function Feed<T>({
  data,
  error = null,
  busy,
  staleNoun,
  retry,
  retryLabel,
  skeleton,
  children,
  empty,
}: FeedProps<T>) {
  return (
    <>
      <FeedBanner
        error={error === null ? null : data === null ? error : `${error} — ${staleNoun} may be showing earlier data.`}
        retry={retry}
        retryLabel={retryLabel}
      />
      {data === null ? (
        busy ? <SkeletonCard height={skeleton.height} label={skeleton.label} /> : (empty ?? null)
      ) : (
        <div className={`loading-dim${busy ? ' is-loading' : ''}`}>{children(data)}</div>
      )}
    </>
  )
}

/** A bare alert for errors that are not about a feed's freshness: form validation, a save
 *  that failed, a what-if that would not compute. Renders nothing for null. */
export function FeedBanner({
  error,
  retry,
  retryLabel,
}: {
  error: string | null
  retry?: () => void
  retryLabel?: string
}) {
  if (error === null) return null
  return (
    <div className="error-banner" role="alert">
      {error}
      {retry !== undefined && (
        <>
          {' '}
          <button type="button" className="button" aria-label={retryLabel} onClick={retry}>
            Retry
          </button>
        </>
      )}
    </div>
  )
}
```

Check `SkeletonCard`'s props in `src/components/PageSkeleton.tsx`: it must render an element whose accessible label is `label` (the test uses `getByLabelText`). If it uses `aria-label`, fine; if it renders a visually-hidden text instead, switch the test to `getByText`.

- [ ] **Step 4: Run the test** → PASS (6).

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/Feed.tsx src/components/shell/Feed.test.tsx
git commit -m "feat(shell): Feed and FeedBanner — card-level loading/stale/error grammar"
```

---

### Task 2: Portfolio + Spending (lane 3a)

**Files:**
- Modify: `src/pages/PortfolioPage.tsx`, `src/pages/PortfolioPage.css`, `src/pages/PortfolioPage.test.tsx`
- Modify: `src/pages/SpendingPage.tsx`, `src/pages/SpendingPage.css`, `src/pages/SpendingPage.test.tsx`

#### Portfolio

Today (PortfolioPage.tsx ≈ lines 452–560): a `<header className="page-header">` holding the h1, the `.header-actions` group (as-of span + "Refresh prices"), then the `.portfolio-owner-row` chips (`aria-label="Owner"`), the refresh note (`role` status/alert), the refresh-status line, the failure chips, `{error && <div className="error-banner">}`, `loading ? <PageSkeleton …/> : holdings ? <div className="loading-dim…">` — and `<RangeChips value={range.preset} onChange={setRange} />` in the Performance panel header (≈ line 610). State: `owner` (`useState<OwnerScope>(null)`, `selectOwner` with a cache peek via `applySnapshot(peeked, true)`), `range` (`useState<RangeState>({ preset: 'all' })`), `loading`, `reloading`, `error`, `holdings`, `fromCache`, `load` (useCallback over owner), `reload`.

- [ ] **Step 1: Failing tests** (append to `PortfolioPage.test.tsx`; the file already mocks `fetchHousehold`)

```tsx
describe('PortfolioPage — shell scope', () => {
  it('reads owner and range from the URL', async () => {
    renderPage('/portfolio?owner=joint&range=ytd')
    await screen.findByText('Portfolio')
    await waitFor(() => expect(vi.mocked(fetchHoldings)).toHaveBeenCalledWith('joint'))
    expect(screen.getByRole('button', { name: 'YTD' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('group', { name: 'Whose' })).toBeTruthy()
    expect(document.querySelector('.portfolio-owner-row')).toBeNull()
  })

  it('an owner chip in the scope row rewrites the URL, closes the drill-in and refetches', async () => {
    renderPage('/portfolio')
    fireEvent.click(await screen.findByRole('button', { name: 'Grace' }))
    await waitFor(() => expect(vi.mocked(fetchHoldings)).toHaveBeenLastCalledWith(2))
    expect(screen.getByTestId('location').textContent).toContain('owner=2')
  })

  it('renders the price status under the title row, not inside it', async () => {
    renderPage('/portfolio')
    await screen.findByText(/prices as of|prices never refreshed/)
    expect(document.querySelector('.page-frame-subheader .as-of')).toBeTruthy()
    expect(document.querySelector('.page-header')).toBeNull()
    expect(screen.getByRole('button', { name: /Refresh prices/ }).closest('.page-frame-actions')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run** → the new tests fail.

- [ ] **Step 3: Migrate**

Imports: add `PageFrame`, `ScopeBar`, `useScope`; remove `RangeChips`, `PageSkeleton`.

Scope adoption (replace the `owner`/`range` state and `selectOwner`):

```tsx
  const { scope } = useScope({ owner: true, range: true })

  // URL → page: adopted with the adjust-during-render idiom (CategoriesPanel's precedent;
  // Plan 2's Net worth), so owner switches never put a setState inside an effect body.
  const [owner, setOwner] = useState<OwnerScope>(scope.owner)
  if (scope.owner !== owner) {
    setReloading(true)
    setError(null)
    // The open drill-in holds a TICKER the next scope may not own.
    setDetailTicker(null)
    // Already-seen scope: paint it instantly and revalidate underneath. State setters only —
    // `shown`/ref bookkeeping belongs to load()'s continuation, never to render.
    const peeked = getSnapshot<PortfolioSnapshot>(portfolioKey(scope.owner))
    if (peeked !== undefined) applySnapshot(peeked, true)
    setOwner(scope.owner)
  }

  const [range, setRange] = useState<RangeState>({ preset: scope.range })
  if (scope.range !== range.preset) setRange({ preset: scope.range })
```

If `applySnapshot` writes a ref (e.g. `shown.current = …`), split it: keep the setState half callable from render and move the ref assignment into `load()`'s `.then` (compare against `getSnapshot(portfolioKey(owner))` there). `load` keeps `owner` in its deps, so the existing `useEffect(() => { load().finally(...) }, [load])` refetches on adoption exactly as `selectOwner` did.

Render:

```tsx
    <div className="page portfolio-page">
      <PageFrame
        title="Portfolio"
        actions={
          <button type="button" className="refresh-btn" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'spin' : undefined} />
            {refreshing ? 'Refreshing…' : 'Refresh prices'}
          </button>
        }
        subheader={
          <>
            {/* the existing as-of span (with its stale class and title), then the refresh
                note div, the refresh-status-line, and the refresh-failures block — moved
                here verbatim */}
          </>
        }
        scopeRow={<ScopeBar owner range />}
        resource={{
          status: holdings === null ? (error !== null ? 'error' : 'loading') : 'ready',
          error,
          busy: reloading,
          fromCache,
          retry: reload,
        }}
        skeleton={{ tiles: 4, cards: [{ span: 12, height: 340 }, { span: 12, height: 300 }] }}
      >
        {holdings !== null && (
          <>
            …the existing body (tiles-row, panels, record tabs), minus the `loading-dim` wrapper…
          </>
        )}
      </PageFrame>
    </div>
```

Delete the `.portfolio-owner-row` block and `ownerScopes`; fold its InfoHint sentence ("A person's view is their own portfolio accounts plus the joint ones — that is what a joint account is. Joint shows only the shared accounts. Performance, sparklines and price refresh always cover the whole household.") into the existing `owner !== null` caveat paragraph under Performance. Remove `<RangeChips …/>` from the Performance header. `.page-frame-subheader` may need `.as-of` spacing — move any `.header-actions .as-of` rules in `PortfolioPage.css` to `.page-frame-subheader .as-of` and delete `.portfolio-owner-row` rules.

- [ ] **Step 4: Update existing Portfolio tests**: `getByRole('group', { name: 'Owner' })` → `'Whose'`; range chip tests now find the chips in the scope row (same names `All`/`1Y`/`YTD`; default preset is now `1y` — adjust any test that assumed `all`); error banner → `getByRole('alert')` (first load) or the `Showing earlier data — …` line; the skeleton assertion (if any) still finds `.skeleton` nodes rendered by PageFrame.

- [ ] **Step 5: Run** `npx vitest run src/pages/PortfolioPage.test.tsx && npx tsc -b && npx eslint src/pages/PortfolioPage.tsx`.

#### Spending

Today (SpendingPage.tsx ≈ lines 607–690): `<div className="page-header">` with h1, old `MonthRibbon` (`anchor={currentMonthIso()} filledMonths onSelect={m => navigate(`/update?month=${m}&step=spending`)}`), the Enter-month button; `{error && banner with Retry (beginLoad(); load())}`; `kpis` row; `<div className="card-grid loading-dim…">`; in the first card's header `activeDetail ? <button>All months</button> : <RangeChips …/>`. State: `detailMonth = searchParams.get('month')` with `setDetailMonth` (replace-navigation), `range` (`{ preset: 'all' }`), `matrix`, `loading`, `error`, `fromCache`, `filledMonths` memo.

- [ ] **Step 6: Failing tests** (append to `SpendingPage.test.tsx`; mock `../api/coverage` → `{ balances: [], spending: [...fixture months], net_pay: [...] }`)

```tsx
describe('SpendingPage — shell scope', () => {
  it('drills a month from the ribbon into ?month=YYYY-MM and shows that month’s breakdown', async () => {
    renderPage('/spending')
    await screen.findByText('Spending')
    fireEvent.click(await screen.findByRole('button', { name: /^Jul 2026/ }))
    expect(screen.getByTestId('location').textContent).toContain('month=2026-07')
    expect(await screen.findByText(/Spending breakdown — Jul 2026/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'All months' }))
    expect(screen.getByTestId('location').textContent).not.toContain('month=')
  })

  it('accepts a legacy ?month=YYYY-MM-01 link (Overview’s deep link) and normalizes it', async () => {
    renderPage('/spending?month=2026-07-01')
    expect(await screen.findByText(/Spending breakdown — Jul 2026/)).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('month=2026-07'))
    expect(screen.getByTestId('location').textContent).not.toContain('2026-07-01')
  })

  it('takes the range from the scope row and renders no chips of its own', async () => {
    renderPage('/spending?range=ytd')
    await screen.findByText('Spending')
    expect(screen.getByRole('button', { name: 'YTD' }).getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelectorAll('[aria-label="Time range"]')).toHaveLength(1)
    expect(document.querySelector('.page-header')).toBeNull()
  })
})
```

- [ ] **Step 7: Run** → fail.

- [ ] **Step 8: Migrate**

```tsx
  const { scope, setScope } = useScope({ range: true, month: true })
  const detailMonth = scope.month
  const setDetailMonth = (month: string | null) => setScope({ month })

  const [range, setRange] = useState<RangeState>({ preset: scope.range })
  if (scope.range !== range.preset) setRange({ preset: scope.range })

  const ribbonFigures = useMemo(
    () =>
      matrix === null
        ? undefined
        : Object.fromEntries(matrix.months.map((m, i) => [m, formatCurrency(matrix.totals[i])])),
    [matrix],
  )
```

Delete `useSearchParams`, `filledMonths`, the `MonthRibbon`/`RangeChips`/`currentMonthIso` imports if now unused. Render:

```tsx
    <div className="page">
      <PageFrame
        title="Spending"
        actions={
          <button className="button button-primary" onClick={() => navigate('/update?step=spending')}>
            <PencilLine size={15} /> Enter month
          </button>
        }
        scopeRow={
          <ScopeBar
            range
            month={{ mode: 'view', figures: ribbonFigures, editHref: (m) => `/update?month=${m}&step=spending` }}
          />
        }
        resource={{
          status: matrix === null ? (error !== null ? 'error' : 'loading') : 'ready',
          error,
          busy: loading,
          fromCache,
          retry: () => {
            beginLoad()
            load()
          },
        }}
        skeleton={{ tiles: 4, cards: [{ span: 12, height: 360 }, { span: 6, height: 300 }, { span: 6, height: 300 }] }}
      >
        {kpis && (<div className="kpi-row">…unchanged…</div>)}
        <div className="card-grid">
          …unchanged, except the header slot is now `activeDetail ? <button className="button" onClick={() => setDetailMonth(null)}>All months</button> : null`…
        </div>
      </PageFrame>
    </div>
```

(The scope row's "Back to latest" chip also clears the drill; keep "All months" because it sits where the eye is and the tests name it.)

- [ ] **Step 9: Update existing Spending tests**: URL assertions `month=2026-07-01` → `month=2026-07` (entries may still use the long form); ribbon selectors → new labels (`/^Jul 2026/`); the ribbon-click-navigates-to-wizard test becomes the Edit link: `getByRole('link', { name: 'Edit Jul 2026 in the wizard' })` has `href` `/update?month=2026-07-01&step=spending`; range default now `1y`; Retry → `getByRole('button', { name: 'Retry' })`.

- [ ] **Step 10: Run, lint, commit**

```bash
npx vitest run src/pages/SpendingPage.test.tsx src/pages/PortfolioPage.test.tsx && npx tsc -b && npx eslint src/pages/PortfolioPage.tsx src/pages/SpendingPage.tsx
git add src/pages/PortfolioPage.tsx src/pages/PortfolioPage.css src/pages/PortfolioPage.test.tsx src/pages/SpendingPage.tsx src/pages/SpendingPage.css src/pages/SpendingPage.test.tsx
git commit -m "feat(shell): Portfolio and Spending render through PageFrame with shared owner/range/month scope"
```

---

### Task 3: Credit cards + Monthly update (lane 3b)

**Files:**
- Modify: `src/pages/CreditCardsPage.tsx`, `src/pages/CreditCardsPage.css`, `src/pages/CreditCardsPage.test.tsx`
- Modify: `src/pages/MonthlyUpdatePage.tsx`, `src/pages/MonthlyUpdatePage.css`, `src/pages/MonthlyUpdatePage.test.tsx`

#### Credit cards

Today (≈ lines 306–420): `.page-header` with h1 and "+ Add card" (focuses `#card-name`); `{error && banner with Retry (beginLoad(); load())}`; `activeCard ? <CardDetail…/> : (…tiles…, <div className="card-grid loading-dim…">…)`. Owner: `useState<OwnerScope>(null)` + an `ownerScopes` chip row (`aria-label="Owner"`) rendered inside the non-detail branch; the filter is client-side — no refetch on owner change (spec §6 data invariant). `?card=` drill stays on `useSearchParams`. Plan 1c may have added a `?add=1` arrival effect — keep it.

- [ ] **Step 1: Failing tests**

```tsx
describe('CreditCardsPage — shell scope', () => {
  it('filters by the URL owner without refetching', async () => {
    renderPage('/credit-cards?owner=2')
    await screen.findByText('Credit cards')
    await waitFor(() => expect(screen.getByRole('group', { name: 'Whose' })).toBeTruthy())
    const calls = vi.mocked(fetchCards).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Joint' }))
    expect(screen.getByTestId('location').textContent).toContain('owner=joint')
    expect(vi.mocked(fetchCards).mock.calls.length).toBe(calls)
    expect(document.querySelector('.credit-owner-row, .cards-owner-row')).toBeNull()
  })

  it('renders through PageFrame with the add action in the title row', async () => {
    renderPage('/credit-cards')
    await screen.findByText('Credit cards')
    expect(screen.getByRole('button', { name: '+ Add card' }).closest('.page-frame-actions')).toBeTruthy()
    expect(document.querySelector('.page-header')).toBeNull()
  })
})
```

(Use the file's actual fetch mock name for the cards list in place of `fetchCards`, and the actual owner-row class name in the null assertion — read the render to find it.)

- [ ] **Step 2: Run** → fail.

- [ ] **Step 3: Migrate**

```tsx
  const { scope } = useScope({ owner: true })
  const owner = scope.owner   // replaces `const [owner, setOwner] = useState<OwnerScope>(null)`
```

Delete `ownerScopes` and the chip row (+ its CSS); keep the `people` roster fetch (the card form's owner select uses it). Render:

```tsx
    <div className="page credit-cards-page">
      <PageFrame
        title="Credit cards"
        actions={
          <button className="button button-primary" onClick={() => document.getElementById('card-name')?.focus()}>
            + Add card
          </button>
        }
        scopeRow={<ScopeBar owner />}
        resource={{
          status: cards === null ? (error !== null ? 'error' : 'loading') : 'ready',
          error,
          busy: loading,
          fromCache,
          retry: () => {
            beginLoad()
            load()
          },
        }}
        skeleton={{ tiles: 3, cards: [{ span: 12, height: 320 }, { span: 12, height: 260 }] }}
      >
        {activeCard ? <CardDetail …unchanged… /> : (<>…tiles + <div className="card-grid">…</div>…</>)}
      </PageFrame>
    </div>
```

(`cards` = the page's cards-list state; if it is never null after a seed, gate on whatever the page's first-load sentinel is — the point is `status: 'loading'` only before the first payload.) The `card-grid` loses its `loading-dim` class (the frame dims).

- [ ] **Step 4: Update existing tests**: `'Owner'` group → `'Whose'`; Retry → `{ name: 'Retry' }`; stale copy.

- [ ] **Step 5: Run** `npx vitest run src/pages/CreditCardsPage.test.tsx`.

#### Monthly update

Today (≈ lines 716–770): `.page-header` with an h1 carrying a `CalendarCheck` icon + `Monthly update — {formatMonth(month)}`, the old `MonthRibbon` (`anchor`, `filledMonths={coveredMonths}`, `selected={month}`, `onSelect={selectMonth}`), the "Start {formatMonth(anchor)}" button; then `.wizard-steps`; `{error && <div className="error-banner">{error}</div>}`; `restored`/`saved` notes; the step bodies gated on `!loading`.

- [ ] **Step 6: Failing tests**

```tsx
describe('MonthlyUpdatePage — shell frame', () => {
  it('renders the month title without an icon, the steps under it, and the ribbon in the scope row', async () => {
    renderPage('/update?month=2026-09-01')
    expect(await screen.findByRole('heading', { level: 1, name: 'Monthly update — Sep 2026' })).toBeTruthy()
    expect(document.querySelector('.page-frame-subheader .wizard-steps')).toBeTruthy()
    expect(document.querySelector('.page-frame-scope .month-ribbon, .page-frame-scope [class*="ribbon"]')).toBeTruthy()
    expect(document.querySelector('.page-header')).toBeNull()
  })

  it('a ribbon click goes through the wizard’s own handler (draft-safe) and lands on balances', async () => {
    renderPage('/update?month=2026-09-01&step=spending')
    fireEvent.click(await screen.findByRole('button', { name: /^Aug 2026/ }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/update?month=2026-08-01&step=balances'))
  })
})
```

- [ ] **Step 7: Run** → fail.

- [ ] **Step 8: Migrate**

```tsx
    <div className="page">
      <PageFrame
        title={`Monthly update — ${formatMonth(month)}`}
        subheader={
          <div className="wizard-steps">…unchanged step buttons…</div>
        }
        scopeRow={
          <>
            <ScopeBar
              month={{ mode: 'edit', anchor, selected: month, onSelect: selectMonth }}
              revalidate={saveNonce}
            />
            {!coveredMonths.has(anchor) && month !== anchor && (
              <button className="button" onClick={() => selectMonth(anchor)}>
                <CalendarPlus size={15} /> Start {formatMonth(anchor)}
              </button>
            )}
          </>
        }
        resource={{ status: 'ready' }}
      >
        <FeedBanner error={error} />
        {restored && (…unchanged…)}
        {saved && (…unchanged…)}
        …the step bodies, unchanged…
      </PageFrame>
    </div>
```

Remove the `CalendarCheck` import and the old `MonthRibbon` import. `coveredMonths` stays (the Start button and `anchor` need it). The wizard's sticky bottom footer is untouched.

`saveNonce` is a `useState(0)` counter the wizard bumps in its save-success path (next to `setSaved(...)`); `ScopeBar`'s `revalidate` prop re-runs its household/coverage fetches whenever the value changes, so the just-saved month's chip fills without leaving the page (the legacy wizard reloaded `coveredMonths` on every month change). Add a test: after a successful save, `fetchCoverage` is called again.

- [ ] **Step 9: Update existing tests**: the heading no longer contains the icon (text unchanged); ribbon chip names now carry coverage words — use `/^Aug 2026/` prefixes; any test that clicked a ribbon chip still lands on `month=…&step=balances`. Mock `../api/coverage` for the ScopeBar.

- [ ] **Step 10: Run, lint, commit**

```bash
npx vitest run src/pages/CreditCardsPage.test.tsx src/pages/MonthlyUpdatePage.test.tsx && npx tsc -b && npx eslint src/pages/CreditCardsPage.tsx src/pages/MonthlyUpdatePage.tsx
git add src/pages/CreditCardsPage.tsx src/pages/CreditCardsPage.css src/pages/CreditCardsPage.test.tsx src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.css src/pages/MonthlyUpdatePage.test.tsx
git commit -m "feat(shell): Credit cards and Monthly update render through PageFrame; wizard ribbon in edit mode"
```

---

### Task 4: Paycheck + Comp (lane 3c)

**Files:**
- Modify: `src/pages/PaycheckPage.tsx`, `src/pages/PaycheckPage.css`, `src/pages/PaycheckPage.test.tsx`
- Modify: `src/pages/CompPage.tsx`, `src/pages/CompPage.test.tsx`

#### Paycheck

Today (≈ lines 975–1100): `.page-header` (h1 only); `{switchable && <div className="paycheck-person-row">` with `aria-label="Person"` chips calling `selectPerson(index === 0 ? null : person.id)` and an InfoHint; the household section; the breakdown feed (banner with stale cue "— this breakdown may be showing earlier data." and `aria-label="Retry the breakdown"`, `breakdownMissing` empty card, `SkeletonCard height={320} label="Loading the breakdown…"`, dimmed `BreakdownPanel`/`PacePanel`/`FlowPanel`); the profiles feed (banner "— the table may be showing earlier data.", `aria-label="Retry loading profiles"`, `SkeletonCard height={240} label="Loading profiles…"`, dimmed `ProfilesPanel`). `selection = { personId, profileId }` (`personId` null = primary); `selectPerson(personId)` (≈ line 916) sets busy/error/missing, peeks the cache (`shownBreakdown.current = peeked` + setters), then `setSelection({ profileId: null, personId })`.

- [ ] **Step 1: Failing tests**

```tsx
describe('PaycheckPage — shell scope', () => {
  it('the scope row shows the two people without All or Joint, primary pressed by default', async () => {
    renderPage('/paycheck')
    await screen.findByRole('group', { name: 'Whose' })
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Joint' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edward' }).getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.paycheck-person-row')).toBeNull()
  })

  it('?owner=<spouse> fetches that person’s breakdown; the primary means no person param', async () => {
    renderPage('/paycheck?owner=2')
    await waitFor(() => expect(vi.mocked(fetchBreakdown)).toHaveBeenLastCalledWith(expect.objectContaining({ personId: 2 })))
    fireEvent.click(screen.getByRole('button', { name: 'Edward' }))
    await waitFor(() => expect(vi.mocked(fetchBreakdown)).toHaveBeenLastCalledWith(expect.objectContaining({ personId: null })))
    expect(screen.getByTestId('location').textContent).toContain('owner=1')
  })
})
```

(Match `fetchBreakdown`'s real signature from `src/api/paycheck.ts` — the assertion is "person 2 on the wire, then no person".)

- [ ] **Step 2: Run** → fail.

- [ ] **Step 3: Migrate**

```tsx
  const { scope } = useScope({ owner: true })

  // The scope row's person chip IS the page's person picker now (spec §6: no Joint, no All —
  // a paycheck belongs to one person). null / joint / an unknown id all mean the primary,
  // exactly what `selection.personId === null` has always meant on the wire.
  const primaryId = orderedPeople[0]?.id ?? null
  const wantedPersonId: number | null =
    !switchable ||
    typeof scope.owner !== 'number' ||
    scope.owner === primaryId ||
    !orderedPeople.some((p) => p.id === scope.owner)
      ? null
      : scope.owner
  if (wantedPersonId !== selection.personId) selectPerson(wantedPersonId)
```

placed after `orderedPeople`/`switchable`/`selection` are defined and BEFORE any early return. `selectPerson` becomes render-safe: delete its `shownBreakdown.current = peeked` line (state setters only). In the breakdown loader's `.then`, the identical-payload skip compares against `shownBreakdown.current`; with the ref no longer pre-seeded, a peeked paint is replaced by the live payload once — acceptable, and note it in a comment. Also drop the `if (personId === selection.personId) return` guard's reliance on a stale closure: the adjust block only calls when they differ.

Render:

```tsx
    <div className="page paycheck-page">
      <PageFrame title="Paycheck" scopeRow={<ScopeBar owner={{ joint: false, all: false }} />} resource={{ status: 'ready' }}>
        {householdNets !== null && householdNets.length > 1 && (<section className="paycheck-household">…unchanged; append the former person-row InfoHint sentence ("Each person has their own profile timeline. The waterfall, the flow and the history below all follow the chip; the household figure does not — it is always both of you.") to the household tile's hint…</section>)}

        <Feed
          data={breakdownMissing ? null : breakdown}
          error={breakdownMissing ? null : breakdownError}
          busy={breakdownBusy && !breakdownMissing}
          staleNoun="this breakdown"
          retry={() => reselect(selection.profileId)}
          retryLabel="Retry the breakdown"
          skeleton={{ height: 320, label: 'Loading the breakdown…' }}
          empty={
            breakdownMissing ? (
              <section className="card">…the existing "Per-check breakdown" empty-note section, unchanged…</section>
            ) : undefined
          }
        >
          {(data) => (
            <>
              <BreakdownPanel data={data} still={fromCache} />
              <PacePanel items={data.pace} />
              <FlowPanel data={data} still={fromCache} />
            </>
          )}
        </Feed>

        <Feed
          data={profiles}
          error={profilesError}
          busy={profilesBusy}
          staleNoun="the table"
          retry={reloadProfiles}
          retryLabel="Retry loading profiles"
          skeleton={{ height: 240, label: 'Loading profiles…' }}
        >
          {(rows) => <ProfilesPanel …the existing props, with `profiles={rows}`-derived `shownProfiles`… />}
        </Feed>
      </PageFrame>
    </div>
```

(`shownProfiles` is derived from `profiles` today; keep the memo and pass it through — the render prop's `rows` just proves non-null.) Delete `.paycheck-person-row` CSS and the `SkeletonCard` import.

- [ ] **Step 4: Update existing tests**: `'Person'` group → `'Whose'`; "the first chip carries null" test → clicking `Edward` yields `owner=1` in the URL and no person param on the wire; the single-person test (no chips) still holds because the ScopeBar hides the control for one person — but the page's `fetchHousehold` mock must be shared with the ScopeBar (same module mock). Mock `../api/coverage` is not needed (no month).

- [ ] **Step 5: Run** `npx vitest run src/pages/PaycheckPage.test.tsx`.

#### Comp

Today (≈ lines 562–660): `.page-header` (h1); schedule banner ("— the schedule may be showing earlier data.", `aria-label="Retry loading the vesting schedule"`) then `schedule !== null && dim(<VestingTiles/>)`; events banner ("— the table may be showing earlier data.", `aria-label="Retry loading comp events"`); `events === null ? busy && <SkeletonCard height={240} label="Loading comp events…"/> : dim(<EventsPanel/>)`; the TC chart card in its own `busy` dim (renders an empty-note when `events !== null` and no trajectory); `schedule === null ? scheduleBusy && <SkeletonCard height={280} label="Loading the vesting schedule…"/> : dim(<RsuGrantsPanel/> <VestingSchedulePanel/>)`.

- [ ] **Step 6: Failing test**

```tsx
it('renders through PageFrame and keeps both feeds’ strings', async () => {
  renderPage()
  await screen.findByText('Comp')
  expect(document.querySelector('.page-header')).toBeNull()
  expect(document.querySelector('.page-frame-header h1')?.textContent).toBe('Comp')
  vi.mocked(fetchVestingSchedule).mockRejectedValueOnce(new ApiError('nope', 500))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry loading the vesting schedule' }).catch(() => screen.getByText('Comp')))
})
```

Replace the last two lines with the file's existing pattern for provoking a schedule reload failure, then assert `screen.getByRole('alert').textContent` ends with `— the schedule may be showing earlier data. Retry`.

- [ ] **Step 7: Migrate**

```tsx
    <div className="page comp-page">
      <PageFrame title="Comp" resource={{ status: 'ready' }}>
        <Feed
          data={schedule}
          error={scheduleError}
          busy={scheduleBusy}
          staleNoun="the schedule"
          retry={reloadSchedule}
          retryLabel="Retry loading the vesting schedule"
          skeleton={{ height: 96, label: 'Loading the vesting schedule…' }}
        >
          {(s) => <VestingTiles schedule={s} />}
        </Feed>

        <Feed
          data={events}
          error={error}
          busy={busy}
          staleNoun="the table"
          retry={reload}
          retryLabel="Retry loading comp events"
          skeleton={{ height: 240, label: 'Loading comp events…' }}
        >
          {(rows) => <EventsPanel events={rows} onChanged={onEventsChanged} />}
        </Feed>

        <div className={`loading-dim${busy ? ' is-loading' : ''}`}>
          …the TC chart card, unchanged…
        </div>

        <Feed data={schedule} busy={scheduleBusy} staleNoun="the schedule" skeleton={{ height: 280, label: 'Loading the vesting schedule…' }}>
          {(s) => (
            <>
              <RsuGrantsPanel grants={s.grants} seedCandidates={s.seed_candidates} onChanged={reloadSchedule} />
              <VestingSchedulePanel schedule={s} />
            </>
          )}
        </Feed>
      </PageFrame>
    </div>
```

(The second schedule `Feed` passes no `error` — the banner already sits above the tiles, where the 2026-08-31 review put it.) Remove the `SkeletonCard` import. The `EventsPanel`'s own inner `error-banner` (≈ line 272, a form error) becomes `<FeedBanner error={…} />`.

- [ ] **Step 8: Update existing Comp tests** (strings are preserved; only `.page-header` queries change). Run `npx vitest run src/pages/CompPage.test.tsx`.

- [ ] **Step 9: Lint, commit**

```bash
npx tsc -b && npx eslint src/pages/PaycheckPage.tsx src/pages/CompPage.tsx
git add src/pages/PaycheckPage.tsx src/pages/PaycheckPage.css src/pages/PaycheckPage.test.tsx src/pages/CompPage.tsx src/pages/CompPage.test.tsx
git commit -m "feat(shell): Paycheck and Comp render through PageFrame; person chips become the owner scope"
```

---

### Task 5: ESPP + Taxes (lane 3d)

**Files:**
- Modify: `src/pages/EsppPage.tsx`, `src/pages/EsppPage.test.tsx`
- Modify: `src/pages/TaxesPage.tsx`, `src/pages/TaxesPage.test.tsx`

#### ESPP

Today (≈ lines 1369–1460): `.page-header`; `modeler !== null && dim(modelerBusy)(kpi tile)`; lots feed (banner "— the table may be showing earlier data.", `aria-label="Retry loading lots"`, `SkeletonCard height={260} label="Loading lots…"`, dim(`LotsPanel`)); offerings feed (same stale noun, `aria-label="Retry loading offerings"`, `SkeletonCard height={220} label="Loading offerings…"`, dim(`OfferingsPanel`)); modeler banner (no stale cue, `aria-label="Retry the model"`) + dim(`ModelerCard data={modeler}` nullable). Inner panels carry form-error banners at ≈ 319, 631, 1037.

- [ ] **Step 1: Migrate**

```tsx
    <div className="page espp-page">
      <PageFrame title="ESPP" resource={{ status: 'ready' }}>
        {modeler !== null && (
          <div className={`loading-dim${modelerBusy ? ' is-loading' : ''}`}>…the $25k tile, unchanged…</div>
        )}

        <Feed data={lots} error={lotsError} busy={lotsBusy} staleNoun="the table" retry={reloadLots} retryLabel="Retry loading lots" skeleton={{ height: 260, label: 'Loading lots…' }}>
          {(data) => <LotsPanel data={data} offerings={offerings ?? []} onChanged={reloadLots} />}
        </Feed>

        <Feed data={offerings} error={offeringsError} busy={offeringsBusy} staleNoun="the table" retry={onOfferingsChanged} retryLabel="Retry loading offerings" skeleton={{ height: 220, label: 'Loading offerings…' }}>
          {(rows) => <OfferingsPanel offerings={rows} bars={bars} onChanged={onOfferingsChanged} />}
        </Feed>

        <FeedBanner error={modelerError} retry={() => runModeler()} retryLabel="Retry the model" />
        <div className={`loading-dim${modelerBusy ? ' is-loading' : ''}`}>
          <ModelerCard …unchanged… />
        </div>
      </PageFrame>
    </div>
```

Replace the three inner-panel `error-banner` divs with `<FeedBanner error={theirErrorState} />` (no retry). Remove the `SkeletonCard` import.

- [ ] **Step 2: Tests**: add one PageFrame assertion (`.page-header` null, h1 "ESPP"); existing strings unchanged. Run `npx vitest run src/pages/EsppPage.test.tsx`.

#### Taxes

Today (≈ lines 557–710): `.page-header`; `{error && banner with Retry (retry)}`; the years section with chips + create form (+ `createError` banner ≈ 679); `(loading || (busy && detail === null && years.length > 0)) && <PageSkeleton cards=[90, 320]/>`; `!loading && !busy && selection === null && years.length > 0 && <p className="empty-note">Select a tax year above.</p>`; `detail !== null && dim(busy)(…panels…)`.

- [ ] **Step 3: Migrate**

```tsx
    <div className="page taxes-page">
      <PageFrame
        title="Taxes"
        resource={{
          // The years LIST is the page's lifecycle; a year's detail is a feed below.
          status: loading ? 'loading' : error !== null && years.length === 0 ? 'error' : 'ready',
          error,
          busy: busy && detail !== null,
          retry,
        }}
        skeleton={{ tiles: 0, cards: [{ span: 12, height: 90 }, { span: 12, height: 320 }] }}
      >
        <section …the years chips + create form, unchanged…>
          …
          <FeedBanner error={createError} />
        </section>

        <Feed
          data={detail}
          busy={busy}
          staleNoun="the year"
          skeleton={{ height: 320, label: 'Loading the year…' }}
          empty={selection === null && years.length > 0 ? <p className="empty-note">Select a tax year above.</p> : undefined}
        >
          {(d) => (<>…SummaryPanel and the rest of the year-scoped panels, unchanged…</>)}
        </Feed>
      </PageFrame>
    </div>
```

(The `busy && detail !== null` frame dim plus the Feed's own dim double up harmlessly; if the double dim reads too dark, pass `busy={busy && detail === null}` to the Feed so only one applies.) Remove the `PageSkeleton` import. If `PageSkeleton` renders an empty tile row for `tiles: 0`, guard it inside `PageFrame` (`tiles > 0 &&`) — a one-line fix in the shell, note it in the report.

- [ ] **Step 4: Tests**: Retry → `{ name: 'Retry' }`; first-load failure → `getByRole('alert')`; the "Select a tax year above." and skeleton behaviours unchanged. Run `npx vitest run src/pages/TaxesPage.test.tsx`.

- [ ] **Step 5: Lint, commit**

```bash
npx tsc -b && npx eslint src/pages/EsppPage.tsx src/pages/TaxesPage.tsx
git add src/pages/EsppPage.tsx src/pages/EsppPage.test.tsx src/pages/TaxesPage.tsx src/pages/TaxesPage.test.tsx
git commit -m "feat(shell): ESPP and Taxes render through PageFrame with Feed-level states"
```

---

### Task 6: Projection + Calendar (lane 3e)

**Files:**
- Modify: `src/pages/ProjectionPage.tsx`, `src/pages/ProjectionPage.test.tsx`
- Modify: `src/pages/CalendarPage.tsx`, `src/pages/CalendarPage.test.tsx`

#### Projection

Today (≈ lines 362–695): `.page-header`; `error !== null && !missing && banner with Retry (recalculate, aria-label "Retry the projection")`; `missing ? <section card empty-note with Link to /update/> : data && dim(busy)(…)`; a `formError` banner inside (≈ 679); `data === null && !missing && busy && <PageSkeleton tiles={5} cards=[340]/>`.

- [ ] **Step 1: Migrate**

```tsx
    <div className="page projection-page">
      <PageFrame
        title="Projection"
        resource={{
          status: missing ? 'ready' : data === null ? (error !== null ? 'error' : 'loading') : 'ready',
          error: missing ? null : error,
          busy,
          retry: recalculate,
        }}
        skeleton={{ tiles: 5, cards: [{ span: 12, height: 340 }] }}
      >
        {missing ? (
          <section className="card">…unchanged empty state…</section>
        ) : (
          data !== null && (<>…the body without its `loading-dim` wrapper…</>)
        )}
      </PageFrame>
    </div>
```

`formError` banner → `<FeedBanner error={formError} />`. Remove `PageSkeleton`.

- [ ] **Step 2: Tests**: `aria-label="Retry the projection"` → `{ name: 'Retry' }`; first-load failure → alert. Run `npx vitest run src/pages/ProjectionPage.test.tsx`.

#### Calendar

Today (≈ lines 278–320): `<header className="page-header">` with h1, "Add event" (with `ref={addEventBtnRef}`), "Add to calendar (.ics)"; banner ("— the page may be showing earlier data.", `aria-label="Retry loading the calendar"`); `events === null ? busy && <p className="empty-note loading-fallback">Loading…</p> : <div className="card-grid loading-dim…">` with the form card (`formError` banner) etc.

- [ ] **Step 3: Migrate**

```tsx
    <div className="page calendar-page">
      <PageFrame
        title="Calendar"
        actions={
          <>
            <button type="button" className="button" ref={addEventBtnRef} onClick={openAddForm}>Add event</button>
            <button type="button" className="button" disabled={events === null || events.length === 0} onClick={() => events !== null && downloadIcs(events)}>
              Add to calendar (.ics)
            </button>
          </>
        }
        resource={{
          status: events === null ? (error !== null ? 'error' : 'loading') : 'ready',
          error,
          busy,
          retry: reload,
        }}
        skeleton={{ tiles: 0, cards: [{ span: 12, height: 420 }] }}
      >
        {events !== null && (
          <div className="card-grid">
            {form !== null && (<section className="card span-12">… <FeedBanner error={formError} /> …</section>)}
            …unchanged…
          </div>
        )}
      </PageFrame>
    </div>
```

- [ ] **Step 4: Tests**: "Loading…" assertion → skeleton present (`.skeleton` or the frame's ghost); Retry → `{ name: 'Retry' }`; stale copy → `Showing earlier data — …`. Run `npx vitest run src/pages/CalendarPage.test.tsx`.

- [ ] **Step 5: Lint, commit**

```bash
npx tsc -b && npx eslint src/pages/ProjectionPage.tsx src/pages/CalendarPage.tsx
git add src/pages/ProjectionPage.tsx src/pages/ProjectionPage.test.tsx src/pages/CalendarPage.tsx src/pages/CalendarPage.test.tsx
git commit -m "feat(shell): Projection and Calendar render through PageFrame"
```

---

### Task 7: Settings + Not found (lane 3f)

**Files:**
- Modify: `src/pages/SettingsPage.tsx`, `src/pages/SettingsPage.test.tsx`
- Modify: `src/pages/NotFoundPage.tsx` (+ its test if one exists)

Today Settings (≈ lines 247–275): `.page-header`; `{error && banner with Retry (setLoading(true); load())}`; `loading && !loadedOnce && <p className="empty-note">Loading…</p>`; `loadedOnce && <div className="card-grid loading-dim…">` with card-level banners (≈ 320, 407, 467). Plan 1a mounted `AppearanceCard` and Plan 1c added card ids/hash highlight — leave them exactly as they are.

- [ ] **Step 1: Migrate Settings**

```tsx
    <div className="page settings-page">
      <PageFrame
        title="Settings"
        resource={{
          status: loadedOnce ? 'ready' : error !== null ? 'error' : 'loading',
          error,
          busy: loading && loadedOnce,
          retry: () => {
            setLoading(true)
            load()
          },
        }}
        skeleton={{ tiles: 0, cards: [{ span: 12, height: 200 }, { span: 6, height: 260 }, { span: 6, height: 260 }] }}
      >
        {loadedOnce && (
          <div className="card-grid">…unchanged, with each card-level `error-banner` div replaced by `<FeedBanner error={…} />`…</div>
        )}
      </PageFrame>
    </div>
```

- [ ] **Step 2: Migrate Not found**

```tsx
import { Link, useLocation } from 'react-router-dom'
import PageFrame from '../components/shell/PageFrame'

export default function NotFoundPage() {
  const { pathname } = useLocation()
  return (
    <div className="page">
      <PageFrame title="Not found" resource={{ status: 'ready' }}>
        <p className="empty-note">
          <span>No page at {pathname}.</span> <Link to="/">Back to the overview →</Link>
        </p>
      </PageFrame>
    </div>
  )
}
```

- [ ] **Step 3: Tests**: Settings "Loading…" → skeleton; Retry → `{ name: 'Retry' }`; the Appearance card and hash-highlight tests untouched. Run `npx vitest run src/pages/SettingsPage.test.tsx src/pages/NotFoundPage.test.tsx` (skip the latter if absent).

- [ ] **Step 4: Lint, commit**

```bash
npx tsc -b && npx eslint src/pages/SettingsPage.tsx src/pages/NotFoundPage.tsx
git add src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx src/pages/NotFoundPage.tsx
git commit -m "feat(shell): Settings and Not found render through PageFrame"
```

---

### Task 8: Merge the lanes, whole-suite check, smoke

- [ ] Merge lanes 3a–3f into the base branch in any order (they touch disjoint page files; the only shared file is `PageFrame.tsx` if a lane guarded `tiles: 0`, which merges trivially).
- [ ] Run `npx tsc -b && npx eslint src && npx vitest run`. Fix anything red (commit as `fix(shell): plan 3 suite fixes`).
- [ ] Success-criteria grep (spec §5) — expected: no matches in `src/pages`:

```bash
grep -rn 'className="page-header"\|className="header-actions"' src/pages
grep -rn "from '../components/PageSkeleton'\|from '../components/MonthRibbon'\|from '../components/RangeChips'" src/pages
grep -rn 'className="error-banner"' src/pages src/components --include=*.tsx | grep -v 'components/shell/'
grep -rn '>Loading…<' src/pages
```

- [ ] With the dev stack running, walk all thirteen routes in both themes with the audit's headless script; confirm sticky scope rows on Net worth, Spending, Portfolio, Credit cards, Monthly update and Overview; no console errors; screenshots under the session scratchpad.

---

## Self-review

**Spec coverage:** §5 all pages through PageFrame, no bespoke header/skeleton/banner → Tasks 2–7 (+ Feed for card-level feeds, Task 1); §6 adoption table — Portfolio owner+range, Spending range+month(drill), Credit cards owner (no refetch), Paycheck owner without Joint (and without All, by the 1b amendment), Monthly update month(edit), others none → Tasks 2–4; §7 ribbon view (Spending figures/Edit link) and edit (wizard's own handler) → Tasks 2–3; §16 phase 3 pairs → Tasks 2–7; success-criteria grep → Task 8. **Placeholders:** none — where a page's state variable name must be read from the file, the step says what it stands for. **Type consistency:** `Feed<T>` props and `FeedBanner` props match Task 1 in every later task; `ScopeBar owner={{ joint: false, all: false }}` and `month={{ mode: 'edit', anchor, selected, onSelect }}` match the amended Plan 1b; `PageFrame` props match Plan 1a.
