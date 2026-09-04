# Motion & polish — Lane M3 (skeleton parity + cross-fade) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nothing moves when data lands. `ChartCard` reserves the export row and zoom caption it only used to mount WITH the option; `Feed` and `PageSkeleton` ghosts stand in the box their block actually occupies (115px tiles, the net-worth chart card, the owner strip, a per-call-site height per feed); the swap from ghost to content is a cross-fade under a veil over `--t-xfade`, not a jump.

**Architecture:** One module owns every reserved height (`src/components/skeletonMetrics.ts`) and one CSS block owns the row heights as `--m-*` variables read by BOTH the real row and its empty twin — parity by construction, not two numbers that agree today; a two-way pin (`skeletonMetrics.test.ts` parses `panels.css`, `src/theme/tokens.test.ts`'s precedent) stops them drifting. The cross-fade is CSS; React only decides when the veil is mounted, with the house adjust-during-render latch (`NetWorthPage.tsx:186`) — never a `setState` in an effect body. React 19, TS 5.9, vitest 3 + @testing-library/react (jsdom, no `globals` — every suite calls `cleanup()` itself).

**Worktree / commands:** `git worktree add .worktrees/motion-m3 -b motion-m3 main`, then inside it `cmd //c "mklink /J node_modules ..\..\node_modules"`. From the worktree root: `npx vitest run <files>`, `npx tsc -b`, `npx eslint <files>`. LF endings, one commit per task, local commits only — **never push**. **Read first:** spec `2026-09-05-motion-polish-design.md` §7, §10, §11; `ChartCard.tsx`; `shell/Feed.tsx`; `PageSkeleton.tsx`; `panels.css` (`.card` :32, `.stat-tile` :82, `.loading-dim` :296, `.chart-export` :416, skeletons :443, chart card :558). **Done when** `npx tsc -b`, `npx eslint .` and `npx vitest run` are green from the worktree root.

## Coordination

- **M2 owns `src/index.css`** (the `--t-*` tokens) and APPENDS its reveal/stagger block to the end of `panels.css`. This lane never edits `index.css` and never appends at the end — its CSS goes beside the rules it changes (:296, :443, :558) — and writes every duration as `var(--t-xfade, 180ms)` / `var(--t-fast, 120ms)` so it stands alone.
- **M4 owns `FeedBanner` inside `Feed.tsx`** and the infohint block in `panels.css`. Touch only the `Feed` body (skeleton, `.xfade`, loaded wrapper); reformatting `FeedBanner` turns an additive merge into a conflict.
- **M1 owns `EChart.tsx`** — its call inside `ChartCard` is copied through unchanged.

### Task 1: the reserved-height table and its CSS twin

**Files:** create `src/components/skeletonMetrics.ts` + `.test.ts`; modify `src/components/panels.css`.

- [ ] **Step 1: Write the failing test** — create `src/components/skeletonMetrics.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CARD_CHROME, CHART_CARD_ROWS, FEED_SKELETON, OWNER_STRIP, STAT_TILE, chartCardBox, ghostCardBody } from './skeletonMetrics'

const CSS = readFileSync(path.join(__dirname, 'panels.css'), 'utf8')
describe('skeletonMetrics', () => {
  it('mirrors the CSS variables panels.css declares — a two-way pin, so neither can drift', () => {
    // The stylesheet owns the row heights; this module only names them. A number that moves in
    // one place and not the other is the layout shift coming straight back.
    expect(CSS).toContain(`--m-export-row: ${CHART_CARD_ROWS.exportRow}px`)
    expect(CSS).toContain(`--m-zoom-row: ${CHART_CARD_ROWS.zoom}px`)
    expect(CSS).toContain(`--m-caption-row: ${CHART_CARD_ROWS.caption}px`)
    expect(CSS).toContain(`--m-stat-tile: ${STAT_TILE}px`)
    expect(CSS).toContain(`--m-owner-strip: ${OWNER_STRIP}px`)
  })
  it('converts an outer box to a ghost BODY (never negative), sizes a chart card, derives each feed', () => {
    expect([ghostCardBody(491), ghostCardBody(20), chartCardBox(320), chartCardBox(360, { zoomable: true })]).toEqual([491 - CARD_CHROME, 0, 420, 481])
    expect([FEED_SKELETON.paycheckBreakdown, FEED_SKELETON.compVesting, FEED_SKELETON.esppLots, FEED_SKELETON.esppOfferings]).toEqual([581, 71, 282, 216])
  })
})
```

- [ ] **Step 2: Implement** — create `src/components/skeletonMetrics.ts`:

```ts
// Every height a skeleton RESERVES, in one place (motion spec §7): a ghost standing in a different
// box than the block that replaces it IS the layout shift. Each number is the loaded layout's own
// arithmetic at a 16px root, from index.css (--density-card-pad) and panels.css — never a guess.
/** Ghost .card chrome: 17.6 + 20 padding + 2 border + 11 label + 9.6 label margin. */
export const CARD_CHROME = 60
/** One .drill-hint line (0.75rem × 1.5); one table row (0.85rem + 0.45rem padding, top and bottom). */
export const HINT_LINE = 18
export const TABLE_ROW = 33
/** The real .stat-tile (the audit measured 115 against the ghost's 76): 0.9 + 1rem padding + 2
 *  border + label 11 + 7.2 + value 26 + delta 13 + 5.6; a .kpi-row and .networth-owner-strip
 *  (dt 15 + dd 26) each add the 1rem bottom margin. */
export const STAT_TILE = 115
export const TILE_ROW = STAT_TILE + 16
export const OWNER_STRIP = 57
/** Rows a ChartCard reserves whether or not the option landed — mirrored as --m-export-row /
 *  --m-zoom-row / --m-caption-row in panels.css, which the test pins. */
export const CHART_CARD_ROWS = {
  exportRow: 40, // .chart-export: the .segmented row (30) + its 0.4rem/0.25rem margins
  zoom: 21, // .chart-zoom-hint: 0.7rem × 1.5 + its 0.25rem top margin
  caption: 26, // one .drill-hint footer line + its 0.5rem margin
} as const
/** ms — mirrors `--t-xfade` (M2's token); only a timer can say when the fade ends and the veil goes. */
export const XFADE_MS = 180

/** SkeletonCard and PageSkeleton take the ghost BODY height; call sites think in the box the
 *  reader sees, and one place converts. */
export function ghostCardBody(outerHeight: number): number {
  return Math.max(0, outerHeight - CARD_CHROME)
}
/** A loaded ChartCard's outer box, so a ghost standing in for one can say so out loud. */
export function chartCardBox(canvas: number, opts: { zoomable?: boolean } = {}): number {
  return CARD_CHROME + CHART_CARD_ROWS.exportRow + canvas + (opts.zoomable === true ? CHART_CARD_ROWS.zoom : 0)
}
/** Feed ghosts per call site (spec §7), each a BODY height — a block that is NOT a card (comp's bare
 *  tile row) takes the chrome SkeletonCard adds back off. */
export const FEED_SKELETON = {
  paycheckBreakdown: 3 * HINT_LINE + TILE_ROW + 12 * TABLE_ROW, // 3-line hint, net-pay tile, 11 waterfall lines + total
  compVesting: ghostCardBody(TILE_ROW), // VestingTiles is a bare .kpi-row, not a card
  esppLots: HINT_LINE + 8 * TABLE_ROW, // hint, the add-row form, table header + 5 rows
  esppOfferings: HINT_LINE + 6 * TABLE_ROW, // hint, add form, header + 3 rows
} as const
```

and add both variable blocks to `panels.css`, each beside the rules it serves:

```css
/* Reserved rows (spec §7): one variable per row, read by the REAL row and by the empty twin the
   skeleton leaves in its place. Beside .chart-card-skeleton (~:585). */
.chart-card { --m-export-row: 40px; --m-zoom-row: 21px; --m-caption-row: 26px; }
/* The boxes the real layout occupies: a 76px tile ghost under a 115px tile moved every page's first
   paint by 39px a row. After the fallback-appear keyframes (~:475). */
.page-skeleton { --m-stat-tile: 115px; --m-owner-strip: 57px; }
```

- [ ] **Step 3: Run, then prove the tests fail on a regression (mutation check)** — `npx vitest run src/components/skeletonMetrics.test.ts`: PASS, 2 tests. Then set `--m-export-row: 44px`, re-run: FAIL, the mirror test receives `44px`. Restore; change `ghostCardBody`'s `Math.max(0, …)` to a bare subtraction, re-run: FAIL, `ghostCardBody(20)` receives `-40`. Revert both: PASS.
- [ ] **Step 4: Commit** — `npx tsc -b && npx eslint src/components/skeletonMetrics.ts src/components/skeletonMetrics.test.ts && git add -A && git commit -m "feat(motion): one table of reserved skeleton heights, pinned against panels.css (motion spec §7)"`

---

### Task 2: ChartCard reserves every row in every state, and the CLS pin

**Files:** modify `ChartCard.tsx`, `ChartCard.test.tsx`, `panels.css`. Header and controls already render in both states; the export row and the zoom caption mount WITH the option, which is what grows the card when data lands.

- [ ] **Step 1: Write the failing test** — in `src/components/ChartCard.test.tsx`, give the existing `EChart` mock an inline height (`style: { height }` alongside its `data-*` attributes — the real one declares one, and the pin below reads declared boxes), then append:

```tsx
describe('ChartCard reserved rows (motion spec §7)', () => {
  const rows = () => Array.from(document.querySelectorAll('.chart-card-row')).map((r) => r.className)
  const full = { ...base, height: 280, zoomable: true, controls: <button>Monthly</button>, footer: <p className="drill-hint">Click a bar.</p> }
  // jsdom lays nothing out, so "did it move?" is asked of what the card DECLARES: an inline height,
  // or a --m-* row whose px value panels.css fixes (Task 1 pins the two together).
  const ROW_PX: Record<string, number> = { 'chart-card-row-export': CHART_CARD_ROWS.exportRow, 'chart-card-row-zoom': CHART_CARD_ROWS.zoom, 'chart-card-row-caption': CHART_CARD_ROWS.caption }
  const reserved = (el: Element): number =>
    parseFloat((el as HTMLElement).style.height || '0') ||
    Array.from(el.classList).map((cls) => ROW_PX[cls]).find((px) => px !== undefined) ||
    Array.from(el.children).reduce((sum, kid) => sum + reserved(kid), 0)
  it('declares the same rows AND the same total height with a skeleton up as loaded (CLS pin)', () => {
    const card = () => document.querySelector('section.chart-card') as HTMLElement
    const { rerender } = render(<ChartCard {...full} option={null} busy />)
    const loading = rows()
    expect(loading).toEqual(['chart-card-row chart-card-row-export', 'chart-card-row chart-card-row-zoom', 'chart-card-row chart-card-row-caption'])
    expect(document.querySelector('.chart-card-header .chart-card-controls')).toBeTruthy()
    expect((document.querySelector('.chart-card-skeleton') as HTMLElement).style.height).toBe('280px')
    expect(reserved(card())).toBe(280 + CHART_CARD_ROWS.exportRow + CHART_CARD_ROWS.zoom + CHART_CARD_ROWS.caption)
    rerender(<ChartCard {...full} option={OPTION} />)
    expect(rows()).toEqual(loading) // same rows, same order — only their CONTENTS arrive with the data
    expect(reserved(card())).toBe(280 + CHART_CARD_ROWS.exportRow + CHART_CARD_ROWS.zoom + CHART_CARD_ROWS.caption)
    expect(document.querySelector('.chart-card-row-export .chart-export')).toBeTruthy()
    expect(document.querySelector('.chart-card-row-zoom .chart-zoom-hint')).toBeTruthy()
  })
  it('reserves only the rows the card actually declares', () => {
    render(<ChartCard {...base} option={null} busy />) // no zoom, no footer
    expect(rows()).toEqual(['chart-card-row chart-card-row-export'])
  })
})
```

- [ ] **Step 2: Implement** — import `CHART_CARD_ROWS` in the test; in `ChartCard.tsx` replace everything in the returned `<section>` from the `{option !== null && (<ChartExportMenu …/>)}` block down to `{footer}`:

```tsx
      {/* Rows the card reserves in EVERY state (spec §7). The export row and the zoom caption used
          to mount WITH the option, so the card grew the instant data landed and shoved the next
          card down the page; the twin is the same element with nothing in it, and panels.css
          gives both their height. */}
      <div className="chart-card-row chart-card-row-export">
        {option !== null && (
          <ChartExportMenu
            config={{ name: exportName, csv, title, caption }}
            getChart={() => chartRef.current}
            tableShown={showTable}
            onToggleTable={csv === undefined ? undefined : () => setTableOpen((open) => !open)}
          />
        )}
      </div>
      {option !== null && error !== null && (
        <p className="chart-card-error" role="status">{error}</p>
      )}
      {body}
      {zoomable && (
        <div className="chart-card-row chart-card-row-zoom">{option !== null && <ChartZoomHint />}</div>
      )}
      {showTable && csv !== undefined && <ChartTable table={csv()} caption={`${title} — data table`} />}
      {footer !== undefined && <div className="chart-card-row chart-card-row-caption">{footer}</div>}
```

Add to `panels.css` beside Task 1's `--m-*` block:

```css
.chart-card-row-export { min-height: var(--m-export-row); }
.chart-card-row-zoom { min-height: var(--m-zoom-row); }
.chart-card-row-caption { min-height: var(--m-caption-row); }
/* flow-root, not overflow:hidden: a block formatting context keeps the child's margins INSIDE the
   reserved row (an escaping 0.4rem makes the loaded row taller than its twin) without clipping the
   segmented buttons' focus ring. */
.chart-card-row { display: flow-root; }
```

- [ ] **Step 3: Run, then prove the tests fail on a regression (mutation check)** — `npx vitest run src/components/ChartCard.test.tsx`: PASS, 2 new tests plus the 8 that were there (the wrappers break no query the old ones make). Then drop the zoom wrapper back to `{zoomable && option !== null && <ChartZoomHint />}`, re-run: FAIL, both the roster (2 rows against 3) and the CLS pin (21px short when loaded). Restore; make the caption row unconditional, re-run: FAIL, "reserves only the rows the card actually declares" sees two. Revert both: PASS.
- [ ] **Step 4: Commit** — `npx tsc -b && npx eslint src/components/ChartCard.tsx src/components/ChartCard.test.tsx && git add -A && git commit -m "fix(charts): a chart card reserves its export, zoom and caption rows before the data lands (motion spec §7)"`

### Task 3: the skeleton → content cross-fade

**Files:** modify `shell/Feed.tsx`, `shell/Feed.test.tsx`, `panels.css`. **Leave `FeedBanner` byte-identical — it is M4's.**

- [ ] **Step 1: Write the failing test** — append to `Feed.test.tsx`, adding `act` to the RTL import, `beforeEach` to the vitest one, and `readFileSync` / `path` / `import { XFADE_MS } from '../skeletonMetrics'` at the top:

```tsx
describe('Feed cross-fade (motion spec §7)', () => {
  const props = { busy: false, staleNoun: 'the table', skeleton: { height: 200, label: 'Loading rows…' } }
  beforeEach(() => { vi.stubGlobal('matchMedia', () => ({ matches: false })) })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
  it('holds the ghost OVER the content for one --t-xfade, drops it, and re-arms', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Feed {...props} data={null} busy>{() => <p>rows</p>}</Feed>)
    rerender(<Feed {...props} data={{ n: 1 }}>{() => <p>rows</p>}</Feed>)
    expect(screen.getByText('rows')).toBeTruthy() // content and ghost coexist, in ONE box
    expect(document.querySelector('.xfade.is-fading .xfade-veil')?.getAttribute('aria-hidden')).toBe('true')
    act(() => { vi.advanceTimersByTime(XFADE_MS) })
    expect(document.querySelector('.xfade-veil')).toBeNull()
    rerender(<Feed {...props} data={null} busy>{() => <p>rows</p>}</Feed>) // a scope change…
    rerender(<Feed {...props} data={{ n: 2 }}>{() => <p>rows</p>}</Feed>) // …and the next arrival fades too
    expect(document.querySelector('.xfade-veil')).toBeTruthy()
  })
  it('does not fade content that was never behind a ghost', () => {
    render(<Feed {...props} data={{ n: 1 }}>{() => <p>rows</p>}</Feed>)
    expect(document.querySelector('.xfade.is-fading')).toBeNull()
  })
  it('swaps instantly under prefers-reduced-motion — no veil, no fade class', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { rerender } = render(<Feed {...props} data={null} busy>{() => <p>rows</p>}</Feed>)
    rerender(<Feed {...props} data={{ n: 1 }}>{() => <p>rows</p>}</Feed>)
    expect(document.querySelector('.xfade-veil')).toBeNull()
    expect([document.querySelector('.xfade.is-fading'), screen.queryByText('rows')?.textContent]).toEqual([null, 'rows'])
  })
  it('pins the CSS: one token for the dim, inside the no-preference gate', () => {
    const css = readFileSync(path.join(__dirname, '..', 'panels.css'), 'utf8').replace(/\s+/g, ' ')
    expect(css).toContain('@media (prefers-reduced-motion: no-preference) { .loading-dim { transition: opacity var(--t-fast, 120ms) ease; } }')
    expect(css).not.toContain('transition: opacity 0.15s ease')
    expect(css).toContain('var(--t-xfade, 180ms)')
  })
})
```

- [ ] **Step 2: Implement** — in `Feed.tsx` extend the imports (`import { useEffect, useState } from 'react'`, `import { XFADE_MS } from '../skeletonMetrics'`, `import { useReducedMotion } from '../useReducedMotion'`) and replace the body from the `banner` line down:

```tsx
  const reduced = useReducedMotion()
  const [seenNull, setSeenNull] = useState(data === null)
  const [fading, setFading] = useState(false)
  // Adopting the arrival during RENDER is the house pattern (NetWorthPage:186) and the only correct
  // moment: the first frame that paints the content must ALREADY carry the ghost over it, or the
  // skeleton blinks out a frame before the data draws — which is the flash this removes.
  if ((data === null) !== seenNull) {
    setSeenNull(data === null)
    setFading(data !== null && !reduced)
  }
  // The veil outlives the fade by nothing; the timer's CALLBACK sets the state, never the effect body.
  useEffect(() => {
    if (!fading) return
    const id = setTimeout(() => setFading(false), XFADE_MS)
    return () => clearTimeout(id)
  }, [fading])
  const banner = !error ? null : data === null ? error : `${error} — ${staleNoun} may be showing earlier data.`
  return (
    <>
      <FeedBanner error={banner} retry={retry} retryLabel={retryLabel} />
      {data === null ? (
        busy ? <SkeletonCard height={skeleton.height} label={skeleton.label} /> : (empty ?? null)
      ) : (
        <div className={`xfade${fading ? ' is-fading' : ''}`}>
          <div className={`loading-dim${busy ? ' is-loading' : ''}`}>{children(data)}</div>
          {/* The outgoing ghost, absolutely over the content that already occupies its box: it fades
              out, the content fades in, the height never changes. No label — the status line
              belonged to the skeleton that just left. */}
          {fading && (
            <div className="xfade-veil" aria-hidden="true"><SkeletonCard height={skeleton.height} label="" /></div>
          )}
        </div>
      )}
    </>
  )
```

In `panels.css`, replace the `.loading-dim` rules (~:296) with:

```css
.loading-dim { opacity: 1; }
/* The dim was a hard-coded 0.15s (spec §1): one token, and only where motion is welcome. */
@media (prefers-reduced-motion: no-preference) { .loading-dim { transition: opacity var(--t-fast, 120ms) ease; } }
.loading-dim.is-loading { opacity: 0.55; }
/* Skeleton → content cross-fade (spec §7): the content mounts in its final box and the ghost lies
   over it, so the swap is a fade, never a jump. `.is-fading` gates the incoming half — content that
   was never behind a ghost must not fade in on every render. */
.xfade { position: relative; }
.xfade.is-fading > .loading-dim { animation: xfade-in var(--t-xfade, 180ms) var(--ease-out, ease) both; }
.xfade-veil { position: absolute; inset: 0; pointer-events: none; animation: xfade-out var(--t-xfade, 180ms) var(--ease-out, ease) both; }
/* A ghost mid-exit must not also pulse: two animations on one element read as a glitch. */
.xfade-veil .skeleton { animation: none; }
@keyframes xfade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes xfade-out { from { opacity: 1; } to { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .xfade.is-fading > .loading-dim, .xfade-veil { animation: none; } }
```

- [ ] **Step 3: Run, then prove the tests fail on a regression (mutation check)** — `npx vitest run src/components/shell/Feed.test.tsx`: PASS, 4 new tests plus the 9 that were there. Then move the `setSeenNull`/`setFading` pair into `useEffect(() => { … }, [data])`, re-run: FAIL, no `.xfade-veil` on the frame the content arrives (and eslint reports `react-hooks/set-state-in-effect`). Restore; drop the `!reduced` term, re-run: FAIL, the reduced-motion test finds a veil. Revert both: PASS.
- [ ] **Step 4: Commit** — `npx tsc -b && npx eslint src/components/shell/Feed.tsx src/components/shell/Feed.test.tsx && git add -A && git commit -m "feat(shell): a feed cross-fades from ghost to content over --t-xfade, gated by reduced motion (motion spec §7)"`

---

### Task 4: the ghosts match the blocks they stand in for

**Files:** modify `PageSkeleton.tsx` + `.test.tsx`, `panels.css`, `PaycheckPage.tsx`, `CompPage.tsx`, `EsppPage.tsx`, `NetWorthPage.tsx`.

- [ ] **Step 1: Write the failing test** — append to `src/components/PageSkeleton.test.tsx` (add `readFileSync` / `path` imports):

```tsx
describe('ghost parity (motion spec §7)', () => {
  it('draws tiles at the real tile box — delta line included — and the owner strip on request', () => {
    const { rerender } = render(<PageSkeleton tiles={2} strip />)
    const tiles = document.querySelectorAll('.kpi-row .stat-tile.skeleton-tile')
    expect(tiles.length).toBe(2)
    expect(tiles[0].querySelectorAll('.skeleton').length).toBe(3) // label, value, delta
    expect(document.querySelector('.skeleton-strip')?.getAttribute('aria-hidden')).toBe('true')
    rerender(<PageSkeleton tiles={2} />)
    expect(document.querySelector('.skeleton-strip')).toBeNull()
  })
  it('leaves no hand-written ghost height at the call sites this lane owns', () => {
    // A literal here is a number nobody can check against the block it stands in for.
    const page = (name: string) => readFileSync(path.join(__dirname, '..', 'pages', `${name}.tsx`), 'utf8')
    expect(page('PaycheckPage')).toContain('height: FEED_SKELETON.paycheckBreakdown')
    expect(page('CompPage')).toContain('height: FEED_SKELETON.compVesting')
    expect(page('EsppPage')).toContain('height: FEED_SKELETON.esppLots')
    expect(page('EsppPage')).toContain('height: FEED_SKELETON.esppOfferings')
    expect(page('NetWorthPage')).toContain('ghostCardBody(chartCardBox(360, { zoomable: true }))')
  })
})
```

- [ ] **Step 2: Implement** — `PageSkeleton.tsx` takes a `strip` prop, wears the parity class on its tiles and ghosts the delta line:

```tsx
export default function PageSkeleton({ tiles = 0, cards = [], strip = false }: {
  tiles?: number
  cards?: { span: 4 | 6 | 8 | 12; height?: number }[]
  /** Net worth's per-owner strip under the tiles — ghosted, or the tiles jump when it lands. */
  strip?: boolean
}) {
```

```tsx
            {/* The real tile carries a delta line: a two-block ghost measured 76 against its 115, so
                every KPI row dropped 39px when the data landed (2026-09-05 audit). */}
            <div className="stat-tile skeleton-tile" key={i}>
              <div className="skeleton skeleton-label" />
              <div className="skeleton skeleton-value" />
              <div className="skeleton skeleton-delta" />
            </div>
```

and, directly after the `{tiles > 0 && (…)}` block:

```tsx
      {strip && <div className="skeleton-strip" aria-hidden="true"><div className="skeleton skeleton-label" /></div>}
```

`panels.css`, beside the other skeleton rules (~:455):

```css
.skeleton-tile { min-height: var(--m-stat-tile); }
.skeleton-delta { width: 50%; height: 0.8rem; margin-top: 0.35rem; }
.skeleton-strip { min-height: var(--m-owner-strip); margin: 0 0 1rem; }
```

Then the call sites — import from `../components/skeletonMetrics` in each page and replace the literal:

- `PaycheckPage.tsx:1096` → `skeleton={{ height: FEED_SKELETON.paycheckBreakdown, label: 'Loading the breakdown…' }}`
- `CompPage.tsx:587` → `skeleton={{ height: FEED_SKELETON.compVesting, label: 'Loading vesting totals…' }}`
- `EsppPage.tsx:1399` / `:1411` → `FEED_SKELETON.esppLots` / `FEED_SKELETON.esppOfferings`, labels unchanged
- `NetWorthPage.tsx:415` → the ghost the page actually draws:

```tsx
        // strip: the owner row sits between the tiles and the first chart; unghosted it pushed both
        // charts down when the summary landed. cards: the loaded boxes — 360px zoomable, then 300px.
        skeleton={{
          tiles: 4,
          strip: true,
          cards: [
            { span: 12, height: ghostCardBody(chartCardBox(360, { zoomable: true })) },
            { span: 12, height: ghostCardBody(chartCardBox(300)) },
          ],
        }}
```

- [ ] **Step 3: Run, then prove the tests fail on a regression (mutation check)** — `npx vitest run src/components/PageSkeleton.test.tsx src/pages/NetWorthPage.test.tsx src/pages/PaycheckPage.test.tsx src/pages/CompPage.test.tsx src/pages/EsppPage.test.tsx`: PASS, since the page tests query labels and text, never ghost heights. Then delete the `skeleton-delta` ghost, re-run: FAIL, the tile carries 2 blocks against 3. Restore; put `PaycheckPage`'s `height: 320` back, re-run: FAIL, the no-literals pin. Revert both: PASS.
- [ ] **Step 4: Commit** — `npx tsc -b && npx eslint src/components/PageSkeleton.tsx src/pages/NetWorthPage.tsx src/pages/PaycheckPage.tsx src/pages/CompPage.tsx src/pages/EsppPage.tsx && git add -A && git commit -m "fix(shell): ghosts stand in the box their block occupies — 115px tiles, the owner strip, per-call-site feed heights (motion spec §7)"`

### Task 5: the lane gate

- [ ] **Step 1: The full suites** — `npx tsc -b && npx eslint . && npx vitest run`. Expected: `tsc` and eslint silent; vitest green (the current baseline plus this lane's ~9 tests), 0 failing, no unhandled rejections.
- [ ] **Step 2: Grep the retired shapes out**

```bash
grep -rn "0.15s" src/components/panels.css
grep -rn "skeleton={{ height: [0-9]" src/pages/PaycheckPage.tsx src/pages/CompPage.tsx src/pages/EsppPage.tsx
grep -rn "chart-card-row" src/components/panels.css src/components/ChartCard.tsx
```

Expected: the first grep matches only the comment that records what was retired (`/* The dim was a hard-coded 0.15s … */`), no rule; the third lists the `min-height` rules, the `flow-root` rule and the three wrappers — a row declared in the component but not in the CSS reserves nothing.

**Follow-ups left open (2026-09-05 review):** the second grep still matches two Feed call sites this
lane never sized, because they are below the first viewport and their loaded blocks were not
measured: `CompPage.tsx:642` (`height: 280`, the vesting schedule — RsuGrantsPanel stacked over
VestingSchedulePanel) and `PaycheckPage.tsx:1155` (`height: 240`, the profiles table and its
carry-forward form). `CompPage.tsx:604` (comp events) WAS measured and is now
`FEED_SKELETON.compEvents`. Measuring the other two means reading each panel's loaded markup the
way `FEED_SKELETON` names its terms; inventing a number instead would be exactly the unverifiable
literal the pin exists to stop.

- [ ] **Step 3: Confirm the commits, then commit any stragglers** — `git log --oneline main..HEAD` shows four, one per task, newest first, nothing pushed; then `git add -A && git commit -m "chore(motion-m3): verify pass — lint and call-site fixes"` for a fifth, or "nothing to commit, working tree clean".

The `Feed` half needs no arithmetic pin: the veil is absolutely positioned inside the wrapper, so the content's box is the wrapper's box in both frames — V's smoke measures the real CLS (spec §10, budget ≤ 0.05). Merge order M2 → M1 → M3 → M4 → V; re-run Steps 1–2 after the merge, since M2 replaces the `var(--t-*, …)` fallbacks with real tokens.
