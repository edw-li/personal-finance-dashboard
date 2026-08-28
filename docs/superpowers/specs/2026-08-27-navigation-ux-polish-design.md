# Navigation & Micro-interaction Polish — Design Spec

**Date:** 2026-08-27
**Status:** Approved
**Source:** User request — "clicking a page shows blank + Loading… until everything renders at once"; wants seamless navigation, better transitions/hover, small friendliness wins.

**Diagnosis.** Navigating feels clunky because every visit pays three stacked waits: the lazy
route chunk (`App.tsx:12-24`, fallback at `Layout.tsx:73`), then the page's full data
snapshot fetched from scratch (`empty-note Loading…` until a `Promise.all` resolves), and
nothing is ever cached (`src/api/client.ts` is a bare fetch wrapper) — so a revisit three
seconds later replays the whole blank wait. On top of that, no easing exists anywhere:
hover states snap, toasts and the palette pop, page content appears without transition.

Eight independent workstreams. Suggested order (each lands alone): snapshot cache →
chunk prefetch → skeletons + delayed fallbacks → motion tokens + page-enter → overlay/toast
entrances → scroll restoration → clickable-card hover → hero count-up.

## Decision log

| Decision | Choice |
|---|---|
| Loading strategy | **Stale-while-revalidate snapshot cache + chunk prefetch**, with skeletons only for true first visits — not perception-only, not TanStack Query. **No new runtime dependencies.** |
| Cache invalidation | **Coarse and always-correct:** any successful non-GET through `api()` wipes the whole snapshot cache; the 401 redirect and `AuthContext.logout` wipe too. In-memory only — a reload starts clean. |
| Stale display | Cached snapshot paints instantly and revalidates under the existing `loading-dim` grammar. A revalidation payload that is byte-identical (JSON) to the cached one **skips setState** — charts must not replay their entrance for unchanged data. |
| Editing surfaces | **MonthlyUpdate and Settings are excluded from the cache.** A form seeded from a stale snapshot that swaps mid-edit is a wrong-money hazard; those pages keep today's fetch-fresh behavior. |
| Router `viewTransition` | **Not adopted.** It stacks with the CSS page-enter (double motion) and snapshotting full pages containing echarts canvases is a jank risk. The CSS page-enter carries the feel; revisit later if wanted. |
| Reduced motion | Every NEW animation/transition sits inside `@media (prefers-reduced-motion: no-preference)` (house precedent `PortfolioPage.css:47`). No global `!important` nuke — existing deliberate cases (chart quiescing, pasted-flash) keep their own handling. |
| Hero count-up | Approved but conservative: hero tiles only, first *fresh* paint only (never cache paints, never revalidations), ~350 ms, exact final string, reduced-motion exempt. |

---

## 1. Snapshot cache (stale-while-revalidate)

**Problem.** Every page mount refetches everything; bouncing Overview → Spending → Overview
shows `Loading…` three times for data the user saw seconds ago.

**Change.** New module `src/api/snapshotCache.ts`:

- A module-level `Map<string, unknown>` with `getSnapshot<T>(key): T | undefined`,
  `setSnapshot(key, value)`, `clearSnapshots()`. Keys are page slugs, with params where a
  fetch is parameterized (`'overview'`, `'overview:flow:2026'`, `'calendar:2026-08…'`).
- **Wire-in pattern (per page, mechanical — no shared hook.** The pages hand-roll `load()`
  with seq guards and per-page invariants; a hook would fight the documented
  preserve-manual-memoization wall and Overview's three isolated fetch tracks.):
  - Seed state from cache: `useState<Data | null>(() => (getSnapshot(KEY) as Data) ?? null)`;
    the initial `busy`/`loading` flag starts `false` on a cache hit.
  - `load()` still fires on mount (revalidation). On resolve: if
    `JSON.stringify(payload) === JSON.stringify(getSnapshot(KEY))`, skip `setState`;
    otherwise `setSnapshot` + `setState` as today. Seq guards unchanged.
  - While revalidating over a cached paint, the page shows the `loading-dim is-loading`
    treatment (`panels.css:313`). Pages that lack it on their snapshot container gain it.
- **Participating pages:** Overview (snapshot + up-next + money-flow, three keys), NetWorth,
  Spending, Portfolio, CreditCards, Taxes, ESPP, Paycheck, Comp, Calendar (range-keyed),
  Projection. **Excluded:** MonthlyUpdate, Settings (decision log), Login/NotFound (no data).
- **Invalidation:** in `client.ts`, after a successful response to any request whose
  effective method ≠ GET (`options.method` defaults to GET), call `clearSnapshots()`.
  Also clear in the existing 401 branch (`client.ts:52-56`) and in `AuthContext.logout`
  (`AuthContext.tsx:40`) — cached snapshots are token-scoped data and must not survive a
  session.

**Chart entrance on cached revisits.** Component remount per navigation means echarts
re-inits and would replay its entrance dance even when painting cached data — the opposite
of seamless. `EChart` gains an optional additive prop `animateEntrance?: boolean`
(default `true`; the signature only ever grows, per its contract). Pages that paint from
cache pass `animateEntrance={false}` for that render; fresh or changed data keeps the
entrance. Under the hood the wrapper merges `animation: false` exactly as the
reduced-motion path already does (`EChart.tsx:120-124`).

**Tests.** `snapshotCache` unit tests (get/set/clear); `client.test.ts`: non-GET success
wipes, 401 wipes; `AuthContext.test.tsx`: logout wipes; on 2–3 representative pages
(Overview, Spending): seeded cache renders data immediately with no `Loading…`, revalidation
with a changed payload updates, identical payload leaves the rendered option object alone.

---

## 2. Route-chunk prefetch

**Problem.** First visit to each page per deploy waits on its JS chunk behind the Suspense
fallback.

**Change.** New `src/components/routeChunks.ts`: one map
`ROUTE_CHUNKS: Record<string, () => Promise<{ default: ComponentType }>>` covering the 13
lazy pages. `App.tsx`'s `lazy()` calls consume these same thunks — a prefetched path is by
construction the identical module `lazy` resolves (single source of truth; a drifted
duplicate would prefetch dead bytes).

- **Hover/focus prefetch:** in `Layout`, nav links get `onMouseEnter`/`onFocus` →
  `ROUTE_CHUNKS[to]?.().catch(() => {})` — fire-and-forget; a failed prefetch must stay
  silent (RouteBoundary + Reload remains the real recovery path, `RouteBoundary.tsx`).
- **Idle warm-all:** after first paint, a `Layout` effect walks all thunks via
  `requestIdleCallback` (setTimeout fallback — Safari), one per idle slot. Thirteen small
  chunks on a personal app: warm them all; chunk waits then only exist on cold hard-loads
  with an immediate direct navigation.

**Tests.** Map covers every lazy route in `App.tsx` (import-and-compare test); hovering a
nav link invokes the matching thunk (spy map injected or module-mocked); idle warm calls
every thunk (mocked `requestIdleCallback`).

---

## 3. Skeleton first paints + delayed fallbacks

**Problem.** First visits show a centered `Loading…` line (`OverviewPage.tsx:293`,
`PortfolioPage.tsx:332`, `TaxesPage.tsx:590`, `CalendarPage.tsx:247`, …) and then the whole
page pops in at once. Fast loads flash the text for tens of milliseconds — churn that reads
clunkier than the wait itself.

**Change.**

- **Skeleton primitives** in `panels.css`: `.skeleton` (block, `var(--surface-2)`,
  radius 6px; a subtle opacity pulse **only** under `prefers-reduced-motion: no-preference`,
  static otherwise), composed into ghost stat tiles and ghost cards that reuse the real
  `.stat-tile` / `.card` chrome so nothing jumps when data lands.
- **`src/components/PageSkeleton.tsx`**: props
  `{ tiles?: number; cards?: Array<{ span: 4 | 6 | 8 | 12; height?: number }> }`, rendering
  a `kpi-row` of ghost tiles + a `card-grid` of ghost cards. Ghost elements are
  `aria-hidden`; a visually-hidden `role="status"` "Loading…" preserves today's announcement
  (`.visually-hidden` utility added to `panels.css`).
- **Pages:** data-heavy pages replace the first-visit `Loading…` with a `PageSkeleton`
  roughly matching their real layout (counts enumerated in the plan). Skeletons render only
  when there is **no snapshot** (cache miss); revalidation always uses `loading-dim`, never
  a skeleton. Pages whose shape a generic skeleton would misrepresent (Calendar's grid) may
  keep a simpler treatment — plan decides per page.
- **Delayed appearance (CSS-only):** skeleton containers and the route fallback start at
  `opacity: 0` with a ~200 ms fade that begins after a ~250 ms `animation-delay` — anything
  that resolves faster shows nothing at all. `.route-fallback` keeps its text form and gets
  its delay in `Layout.css` (it must stay independent of `panels.css`, per the documented
  entry-css constraint at `Layout.css:100-108`).

**Tests.** `PageSkeleton` renders the announced status + `aria-hidden` ghosts; a
representative page shows the skeleton on cache-miss busy state and `loading-dim` (not
skeleton) on revalidation.

---

## 4. Motion tokens + page-enter

**Change.**

- `index.css` `:root` gains motion tokens: `--t-fast: 120ms` (hover/state),
  `--t-page: 180ms` (page entrance).
- **Hover stops snapping:** under `no-preference`, add
  `transition: background-color var(--t-fast) ease, border-color var(--t-fast) ease, color var(--t-fast) ease`
  to `.nav-link`, `.logout-button`, `.route-fallback-button` (Layout.css), `.button`,
  `.chip`, `.month-chip`, `.row-toggle`, `.info-hint` (panels.css), `.palette-option`
  (CommandPalette.css), `.toast-action`, `.toast-close` (toast.css). The `.skip-link` is
  **excluded** — its focus reveal must remain instant.
- **Press feedback:** `.button:active { transform: scale(0.985); }` under `no-preference`
  (both variants inherit).
- **Page entrance:** under `no-preference`,
  `.page { animation: page-enter var(--t-page) ease-out; }` with
  `@keyframes page-enter { from { opacity: 0; transform: translateY(6px); } }` in
  `panels.css`. It runs exactly once per navigation because `RouteBoundary` is keyed by
  pathname (`Layout.tsx:72`) — remount per nav is already guaranteed. Transform is
  paint-only; EChart's ResizeObserver sees no size change.

**Tests.** Motion is CSS; covered by the visual pass (below). No JS behavior changes here.

---

## 5. Overlay & toast entrances; InfoHint fade

**Change.**

- **Command palette** (`CommandPalette.css`): overlay backdrop fades in ~120 ms; the panel
  scales `0.985 → 1` with a ~140 ms fade. Enter only — Esc/close stays instant (dismissal
  must feel immediate).
- **Toasts** (`toast.css` + `ToastProvider.tsx`): enter = 8 px slide-up + fade ~160 ms
  (CSS only). Exit = fade ~140 ms, which needs a `leaving` state in `ToastProvider`:
  mark, then remove after a ~150 ms timeout (timeout, not `animationend` — robust under
  reduced-motion and jsdom). Undo/close continue to work while leaving; auto-dismiss timing
  is otherwise unchanged.
- **InfoHint bubble** (`panels.css:396-423`): replace the `display: none/block` toggle with
  `visibility: hidden; opacity: 0` ↔ `visibility: visible; opacity: 1` plus a 100 ms opacity
  transition under `no-preference`. AT-equivalent to today (visibility hides from screen
  readers as display did); under reduced motion the toggle is instant, exactly as now.

**Tests.** `ToastProvider.test.tsx`: dismissal marks leaving then removes after the timeout
(fake timers); existing toast tests keep passing. Palette/InfoHint are CSS-only.

---

## 6. Back/forward scroll restoration

**Problem.** `Layout.tsx:20-27` scrolls to top and focuses `main` on *every* in-app pathname
change — including the Back button, which loses the reader's place.

**Change.** In `Layout`:

- `history.scrollRestoration = 'manual'` (we own POP restoration; the browser's own restore
  fires before React has rendered the page and lands wrong).
- Record scroll continuously: a passive, rAF-throttled scroll listener writes
  `sessionStorage['scroll:' + location.key] = window.scrollY` (survives reload;
  `location.key` persists in history state).
- On pathname change: `useNavigationType()` distinguishes PUSH/REPLACE (today's behavior —
  focus main, scroll to top) from **POP** — `mainRef.current?.focus({ preventScroll: true })`
  then restore the saved Y (default 0). The focus hand-off for keyboard users is preserved
  in both branches.

**Tests.** `Layout.test.tsx` (MemoryRouter): navigate forward → top; `navigate(-1)` →
restored Y (mock `sessionStorage` + `scrollTo`); focus lands on main in both branches.

---

## 7. Clickable-card hover affordance

**Change.** New `panels.css` class `.card-link`: `cursor: pointer` and on hover
`border-color: var(--muted)` (riding the §4 transition token). Applied **only** to cards and
tiles that actually navigate or expand on click — the plan enumerates them by grepping card
wrappers with `onClick`/`NavLink` (Overview's drill-through cards, spending drill rows,
etc.). Non-interactive cards are untouched; the hover signal must not lie.

**Tests.** None beyond the visual pass (class presence is trivially covered by the pages'
existing render tests where relevant).

---

## 8. Hero stat count-up

**Change.** `StatTile` (`StatTile.tsx:15`) gains one additive optional prop:
`countUp?: { value: number; format: (n: number) => string }`.

- When present **and** motion is allowed **and** the page passes it (pages do so only on a
  fresh first paint — never on cache paints or revalidations): a rAF loop eases 0 → value
  over ~350 ms rendering `format(current)`; the final frame renders the existing `value`
  string exactly, so the end state is bit-identical to today's static render.
- Reduced motion, cached paints, tests without rAF: static `value`, today's behavior.
- Applied to **hero tiles only** (`stat-tile-hero` call sites — Overview and NetWorth heroes;
  plan enumerates). Deltas and glyphs never animate. `.stat-value` is already monospace —
  no layout shift.

**Tests.** `StatTile.test.tsx`: no `countUp` → unchanged; `countUp` with mocked
reduced-motion → immediate final string; with stubbed rAF → intermediate then exact final
string.

---

## Verification

Unit/API suites as listed per section. Because most of this batch is motion and paint
behavior that jsdom cannot see, the acceptance gate is the **real-browser smoke on the
running dev servers** (2026-08-25 lesson): click through all sidebar pages twice (first
visit vs. cached revisit), confirm skeleton → data on first visit, instant paint + dim
revalidate on revisit, no chart entrance replay on unchanged data, Back restores scroll,
toasts/palette animate, and the whole app under OS reduced-motion shows no new movement.

## Out of scope

- MonthlyUpdate/Settings caching (editing surfaces stay fetch-fresh).
- Router `viewTransition`, framer-motion or any animation dependency, page slide/carousel
  transitions.
- Mobile/PWA work and the other audit-backlog items (export/backup, TWR, session
  resilience, …).
- Chart-internal animation retuning beyond entrance suppression on cached paints
  *(superseded for zoom/update animation by Addendum §A2)*.

---

# Addendum — 2026-08-27 evening (user visual pass)

Two user-reported items after the six-plan batch landed. **Status: Approved.**

| Decision | Choice |
|---|---|
| Scrollbar layout shift | **`scrollbar-gutter: stable` on `html`** — one global rule; the wizard's unmount-while-loading stays (form-correctness choice). Fixes the whole class (skeleton phases on short pages too). Rejected: `overflow-y: scroll` (heavier visual), keeping the wizard body mounted (stale-month form hazard). |
| Range-toggle animation mechanism | **Dispatch, not rebuild:** when a new option differs from the last applied option ONLY in its `dataZoom` window, `EChart` applies it via `dispatchAction({ type: 'dataZoom', … })` on the live instance — echarts morphs the series (~300 ms update animation) instead of the notMerge snap. Detection = stripped-JSON compare inside the wrapper; pages supply the resolved target window (they own the axis length). Opt-in per chart. |
| Entrance suppression narrowed | `animateEntrance={false}` now merges **`animationDuration: 0`** (entrance only) instead of `animation: false`, so UPDATE animations (zoom morphs, Projection's 10Y/40Y trend-span data morphs) stay alive on cached paints. Retires the "fromCache suppresses ALL chart animation" morning-list item. Reduced motion is untouched: full `animation: false` + ripple quiescing, and the dispatch fast-path is skipped entirely (snap, exactly as today). |

## A1. Scrollbar-stable gutter

**Problem.** Clicking between months on `/update` unmounts the wizard body while the month
loads (`!loading &&` gates — deliberate); the page briefly drops under viewport height, the
document scrollbar vanishes, and the ~15 px width change shifts everything sideways until
data lands.

**Change.** `src/index.css`: `html { scrollbar-gutter: stable; }` with a comment naming the
wizard case. No page changes. Verified in the browser smoke by asserting
`document.documentElement.clientWidth` is identical before and during a month switch.

## A2. Animated zoom windows + live update animation

**Problem.** The All/1Y/YTD chips bake a new `dataZoom` into the option; the wrapper's
`notMerge` rebuild snaps. Projection's 10Y/40Y span chips rebuild series data and snap for
the same reason on cached paints (update animation was force-killed by `animation: false`).

**Change.**
- `src/charts/timeZoom.ts` gains `resolvedWindow(dates, range): ZoomWindow` — the preset's
  `startValue` with `endValue` resolved to the last axis index (presets omit it in options
  by design; the dispatch action needs it explicit).
- `EChart` gains optional `zoomWindow?: ZoomWindow`. The option effect keeps a
  stripped-JSON fingerprint (option minus `dataZoom`) of the last applied option; when the
  fingerprint is unchanged, `zoomWindow` is present, and motion is allowed, it dispatches
  `{ type: 'dataZoom', startValue, endValue }` instead of `setOption` — with an equality
  guard against the chart's current resolved window so the ctrl+wheel mirror
  (`onDataZoom` → page state → option rebuild → same window) settles as a no-op instead of
  looping. Any other difference (data, legend) takes the existing `notMerge` path.
- Entrance suppression: `!animateEntrance` merges `{ animationDuration: 0 }`;
  `REDUCED_MOTION` keeps `{ animation: false }` and never enters the dispatch path.
- Wired (`zoomWindow` + existing `onDataZoom`) on the six zoomable charts: NetWorth
  stacked + drill, Spending bars + savings + trend, Portfolio performance. Projection needs
  no wiring — its span toggle is a data change that the revived update animation morphs.

**Tests.** `EChart.test.tsx`: the `animateEntrance` assertion updates to
`animationDuration: 0` (behavior revision, deliberate); new cases — zoom-only change
dispatches (one `setOption` total), equal-window change neither dispatches nor re-applies,
non-zoom change takes `setOption`. `timeZoom.test.ts` (new or existing): `resolvedWindow`
end-index resolution incl. the manual-window and empty-axis cases. Motion itself is
browser-smoke territory (chip clicks on /net-worth: no console errors, screenshot; month
switch on /update: constant `clientWidth`).
