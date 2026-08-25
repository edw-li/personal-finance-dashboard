# Chart Affordance Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every chart on the dashboard answer like an instrument instead of a picture — six sub-items in one frontend batch: (2a) a house-styled ⤓ export menu on `EChart` (PNG at 2× on the card surface, caller-supplied CSV) opted into six charts; (2b) tooltip Total/share rows propagated from the vesting chart's pattern (spending shares + Total, tax-trend total-tax, net-worth assets subtotal, plus two cosmetic fixes: bold history header, unsigned savings-rate percent); (2c) buy/sell/dividend event markers on the /portfolio performance chart, snapped to weekly bars and clustered with true-date tooltips; (2d) deep-linkable drill state (`/spending?month=`, `/taxes?year=`) and Overview chart click-through; (2e) legend + manual-zoom persistence on the three multi-chart pages so notMerge rebuilds stop resetting them; (2f) a shared "ctrl+scroll to zoom · drag to pan" caption on every inside-zoom card.

**Architecture:** All pure logic lands in React-free modules so it is directly testable: a tiny `src/utils/download.ts` (CSV serializer + two download shims tests can spy), a `ChartExportMenu` component `EChart` mounts when its new optional `exportConfig` prop is present, `buildEventMarkers` + the events tooltip branch in `historyChartOptions.ts`, per-chart CSV builders in the existing `*ChartOptions.ts` modules (plus two new ones for spending/net-worth, whose options themselves stay page-inline), and `rangeZoom`/`RangeState` in `timeZoom.ts` layering a mirrored `{startValue, endValue}` window over the preset. `EChart` gains exactly three additive props — `exportConfig`, `onLegendChange`, `onDataZoom` — wired through its existing latest-handler ref pattern (`chart.on('legendselectchanged'|'datazoom')`); pages mirror those events into state and feed them back through `legend.selected` and `rangeZoom(...)` in the memoized options, which is what makes toggles and windows survive notMerge rebuilds. Drill state moves from `useState` to the URL (`useSearchParams`, replace-style) on SpendingPage and SummaryPanel; the derivation guards (`indexOf`/feed-membership) already make garbled params read as "no drill". No new echarts modules are registered (markers reuse the already-registered plain `ScatterChart`), so the lazy echarts chunk cannot regress.

**Tech Stack:** React 19 + TypeScript + Vite + Vitest (jsdom, no globals — import from `vitest`), ECharts 6 behind the `EChart` wrapper. No new dependencies. FRONTEND ONLY — the backend is not touched.

**Spec:** `docs/superpowers/specs/2026-08-25-five-feature-batch-design.md` §2 ("Chart affordance batch") plus its Decision-log rows ("All six sub-items. Event markers on /portfolio only"; "House-styled ⤓ menu matching the RangeChips grammar — not ECharts' toolbox. CSV data supplied explicitly by callers, never introspected from options"). Cite the spec for any ambiguity. Do NOT edit the spec's status line — four sibling plans share that file; the orchestrator flips it once the whole batch merges.

**Overnight protocol:** work happens in the git worktree `.worktrees/chart-affordances` on branch `chart-affordances` (the orchestrator creates both; Task 0 verifies a clean `git status` and the branch, runs `npm ci` in the worktree, and smokes `npx vitest run src/utils/format.test.ts` before anything else). FRONTEND ONLY: no backend commands, no docker, no pytest. No file deletions. Never push. Frequent small commits.

**Cross-plan note:** a sibling plan (polish-batch) adds a DIFFERENT optional prop (`ariaLabel`) to `EChart.tsx` on a parallel branch. Implement ONLY `exportConfig` (+ the two §2e event props) here, purely additively: append new props at the END of the destructuring and its type literal, add new refs/`chart.on` lines without reordering existing ones, and keep the existing container `<div ref={containerRef} …>` line byte-identical (the menu mounts as a fragment sibling, never a wrapper rewrite) so the orchestrator can merge both branches. `OverviewPage.tsx` is also touched by siblings — keep the onClick edits there minimal and localized (three small additions, no restructuring).

**House rules that bind every task:** server sentences render verbatim; Decimal strings on the wire — `Number()` is display-only and nothing parsed here goes back to the API (format.ts's rule); option builders stay React-free (no React, no fetching, no theme decisions of their own); `escapeHtml` on ALL user text (category/account names, notes, tickers, grant labels) in HTML tooltip strings; echarts is NEVER rendered in jsdom — mock the module or the wrapper, pin drawing in option-builder tests; the palette/series-color law lives in `src/charts/theme.ts` — markers use MUTED, no invented hues; tooltips echo displayed figures; comments explain constraints, not narration.

---

## File structure

| File | Responsibility |
|---|---|
| `src/utils/download.ts` (+ `download.test.ts`) | `ExportTable`, `toCsv` (RFC-4180 quoting, CRLF), `downloadDataUrl`, `downloadText` |
| `src/components/ChartExportMenu.tsx` | The ⤓ menu (`ExportConfig`, `ExportableChart`); RangeChips' segmented grammar |
| `src/components/EChart.tsx` (+ `EChart.test.tsx`) | Additive props: `exportConfig`, `onLegendChange`, `onDataZoom` |
| `src/components/ChartZoomHint.tsx` (+ test) | The shared inside-zoom caption |
| `src/components/panels.css` | `.chart-export`, `.chart-export-glyph`, `.chart-zoom-hint` |
| `src/charts/timeZoom.ts` (+ `timeZoom.test.ts`) | `ZoomWindow`, `RangeState`, `rangeZoom`; `InsideZoomOption.endValue?` |
| `src/components/spending/spendingChartOptions.ts` (+ test) | `spendingBarsTooltipFormatter`, `spendingCsv` |
| `src/components/networth/netWorthChartOptions.ts` (+ test) | `NOTES_SERIES` (moved), `netWorthStackedTooltipFormatter`, `netWorthCsv` |
| `src/components/taxes/taxChartOptions.ts` (+ test) | Trend tooltip Total-tax row; `taxTrendCsv` |
| `src/components/portfolio/historyChartOptions.ts` (+ test) | Bold tooltip header; `EVENTS_SERIES`, `ChartEventPoint`, `buildEventMarkers`, events series + tooltip branch; `portfolioHistoryCsv` |
| `src/components/portfolio/dividendChartOptions.ts` (+ test) | `monthlyIncomeSums` (shared by chart + CSV), `monthlyIncomeCsv` |
| `src/components/projection/projectionChartOptions.ts` (+ test) | `projectionCsv` |
| `src/components/overview/overviewChartOptions.ts` | `RECENT_SPEND_MONTHS` (the bars' slice length, named for the click handler) |
| `src/pages/SpendingPage.tsx` (+ `SpendingPage.test.tsx`) | `?month=` drill↔URL, bars formatter + unsigned savings, legend/zoom persistence, export, captions |
| `src/pages/NetWorthPage.tsx` | Stacked tooltip wiring, legend/zoom persistence, export, captions |
| `src/pages/PortfolioPage.tsx` | Event markers wiring, legend/zoom persistence, export, caption |
| `src/pages/OverviewPage.tsx` (+ `OverviewPage.test.tsx`) | Three chart click-throughs |
| `src/components/taxes/SummaryPanel.tsx` (+ `src/pages/TaxesPage.test.tsx`) | `?year=` drill↔URL, tax-trend export |
| `src/pages/TaxesPage.tsx` | One comment touch-up (the "no history writes" note gains the ?year caveat) |
| `src/pages/ProjectionPage.tsx` | Projection export, two captions |
| `src/components/portfolio/HoldingDetailPanel.tsx` | Price-chart caption |
| `src/components/portfolio/DividendsPanel.tsx` | Dividends export |

---

## Phase 0 — Environment & branch verification

### Task 0: Verify the worktree the orchestrator prepared

**Files:** none (environment only)

- [x] **Step 1: Confirm the worktree, the branch and a clean tree.** All work happens inside `.worktrees/chart-affordances`:

```bash
cd .worktrees/chart-affordances
git status --porcelain   # expected: EMPTY output
git rev-parse --abbrev-ref HEAD   # expected: chart-affordances
```

If the branch is wrong or the tree is dirty, STOP and report — do not "fix" it by switching or stashing; the orchestrator owns branch setup. Every command below runs from the worktree root.

- [x] **Step 2: Install dependencies in the worktree** (worktrees do not share `node_modules`):

Run: `npm ci`
Expected: clean install, exit 0.

- [x] **Step 3: Frontend smoke.**

Run: `npx vitest run src/utils/format.test.ts` → PASS.

---

## Phase 1 — Shared foundations (export plumbing, event props, zoom-state helpers)

### Task 1: `src/utils/download.ts` — CSV serializer + download shims

**Files:**
- Create: `src/utils/download.ts`
- Test: `src/utils/download.test.ts`

- [x] **Step 1: Write the failing tests** — create `src/utils/download.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadDataUrl, downloadText, toCsv } from './download'

describe('toCsv', () => {
  it('joins headers + rows with CRLF and ends with one', () => {
    expect(toCsv(['Month', 'Total'], [['2026-06-01', '2750.00']])).toBe(
      'Month,Total\r\n2026-06-01,2750.00\r\n',
    )
  })

  it('quotes fields carrying commas, quotes or newlines — quotes doubled', () => {
    expect(
      toCsv(['Name', 'Note'], [['Food, dining', 'said "no"'], ['a\nb', 'c\rd']]),
    ).toBe('Name,Note\r\n"Food, dining","said ""no"""\r\n"a\nb","c\rd"\r\n')
  })

  it('stringifies numbers and leaves empty cells empty', () => {
    expect(toCsv(['Year', 'Tax'], [[2024, ''], [2025, 0]])).toBe(
      'Year,Tax\r\n2024,\r\n2025,0\r\n',
    )
  })

  it('serializes a headers-only table', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b\r\n')
  })
})

describe('the download shims', () => {
  // What each captured anchor looked like AT click time — the anchor is removed right
  // after, so reading it later would see nothing.
  let clicks: { download: string; href: string }[]

  beforeEach(() => {
    clicks = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ download: this.download, href: this.href })
    })
    // jsdom implements neither — the stubs also let the Blob be captured.
    URL.createObjectURL = vi.fn(() => 'blob:mock-1')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('downloadDataUrl clicks a temporary anchor and removes it', () => {
    downloadDataUrl('data:image/png;base64,PNG', 'spending.png')
    expect(clicks).toEqual([{ download: 'spending.png', href: 'data:image/png;base64,PNG' }])
    expect(document.querySelector('a')).toBeNull()
  })

  it('downloadText wraps the text in a typed Blob, downloads it and revokes the URL', async () => {
    downloadText('Month,Total\r\n', 'spending.csv', 'text/csv;charset=utf-8')
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    expect(blob.type).toBe('text/csv;charset=utf-8')
    expect(await blob.text()).toBe('Month,Total\r\n')
    expect(clicks).toEqual([{ download: 'spending.csv', href: 'blob:mock-1' }])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1')
  })
})
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/utils/download.test.ts` → FAIL (module not found).

- [x] **Step 3: Implement** — create `src/utils/download.ts`:

```ts
// Chart-export shims (2026-08-25 spec §2a). A module of their own so the export menu's
// tests can vi.mock the file-drop side effects while the menu logic stays real.

/** The caller-supplied CSV shape — explicit rows, never introspected from echarts
 * options (spec Decision log). */
export interface ExportTable {
  headers: string[]
  rows: (string | number)[][]
}

/** RFC-4180 quoting: a field carrying a comma, quote, CR or LF is wrapped in quotes with
 * inner quotes doubled; rows join with CRLF and the file ends with one. UTF-8 is the
 * Blob's job (downloadText's mime) — no BOM: the data is the app's own ASCII-safe
 * figures and ISO dates. */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const field = (value: string | number): string => {
    const text = String(value)
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  const lines = [headers, ...rows].map((row) => row.map(field).join(','))
  return `${lines.join('\r\n')}\r\n`
}

/** Click-through a temporary anchor — the least-magic download that works everywhere. */
export function downloadDataUrl(url: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** Text → typed Blob → object URL → anchor; revoked after so exports don't leak blobs. */
export function downloadText(text: string, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  try {
    downloadDataUrl(url, filename)
  } finally {
    URL.revokeObjectURL(url)
  }
}
```

- [x] **Step 4: Run** — `npx vitest run src/utils/download.test.ts` → PASS.

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(charts): download shims + RFC-4180 CSV serializer"`

### Task 2: `ChartExportMenu` + the three additive `EChart` props

**Files:**
- Create: `src/components/ChartExportMenu.tsx`, `src/components/EChart.test.tsx`
- Modify: `src/components/EChart.tsx`, `src/components/panels.css`

- [x] **Step 1: Write the failing tests** — create `src/components/EChart.test.tsx`. The real echarts needs a canvas jsdom does not have (house law: never rendered in tests); mocking `../charts/echarts` keeps the WRAPPER's whole contract testable — init, the `.on` registry the tests fire by hand, `getDataURL`, `getOption`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EChartsOption } from '../charts/echarts'
import { SURFACE } from '../charts/theme'

interface FakeChartLike {
  handlers: Record<string, (params?: unknown) => void>
  setOption: ReturnType<typeof vi.fn>
  getDataURL: ReturnType<typeof vi.fn>
  getOption: ReturnType<typeof vi.fn>
}

vi.mock('../charts/echarts', () => {
  class FakeChart {
    handlers: Record<string, (params?: unknown) => void> = {}
    setOption = vi.fn()
    dispose = vi.fn()
    resize = vi.fn()
    dispatchAction = vi.fn()
    getDataURL = vi.fn(() => 'data:image/png;base64,PNG')
    getOption = vi.fn(() => ({ dataZoom: [{ startValue: 3, endValue: 9 }] }))
    on(event: string, handler: (params?: unknown) => void) {
      this.handlers[event] = handler
    }
  }
  const instances: FakeChart[] = []
  return {
    echarts: {
      init: () => {
        const chart = new FakeChart()
        instances.push(chart)
        return chart
      },
    },
    __instances: instances,
  }
})
// Identity pass-through: quiesceRipples is reduced-motion armor, not this file's subject.
vi.mock('../charts/motion', () => ({ quiesceRipples: (option: unknown) => option }))
vi.mock('../utils/download', () => ({
  toCsv: vi.fn(() => 'CSV-BODY'),
  downloadDataUrl: vi.fn(),
  downloadText: vi.fn(),
}))

import EChart from './EChart'
import * as chartsModule from '../charts/echarts'
import { downloadDataUrl, downloadText, toCsv } from '../utils/download'

const instances = (chartsModule as unknown as { __instances: FakeChartLike[] }).__instances

function lastChart(): FakeChartLike {
  return instances[instances.length - 1]
}

const OPTION = {} as EChartsOption

beforeEach(() => {
  // jsdom has no ResizeObserver; the wrapper observes its container on mount.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  instances.length = 0
})

describe('EChart export menu', () => {
  it('renders no menu without exportConfig', () => {
    render(<EChart option={OPTION} />)
    expect(screen.queryByRole('group', { name: /Export/ })).toBeNull()
  })

  it('offers PNG always and CSV only when a csv fn is supplied', () => {
    const { unmount } = render(<EChart option={OPTION} exportConfig={{ name: 'demo' }} />)
    expect(screen.getByRole('group', { name: 'Export demo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'PNG' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'CSV' })).toBeNull()
    unmount()
    render(
      <EChart
        option={OPTION}
        exportConfig={{ name: 'demo', csv: () => ({ headers: [], rows: [] }) }}
      />,
    )
    expect(screen.getByRole('button', { name: 'CSV' })).toBeTruthy()
  })

  it('PNG snapshots at 2x on the card surface and downloads {name}.png', () => {
    render(<EChart option={OPTION} exportConfig={{ name: 'demo' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'PNG' }))
    expect(lastChart().getDataURL).toHaveBeenCalledWith({
      pixelRatio: 2,
      backgroundColor: SURFACE,
    })
    expect(downloadDataUrl).toHaveBeenCalledWith('data:image/png;base64,PNG', 'demo.png')
  })

  it('CSV serializes the caller rows and downloads {name}.csv as UTF-8 text/csv', () => {
    const csv = vi.fn(() => ({ headers: ['Month', 'Total'], rows: [['2026-06-01', 1]] }))
    render(<EChart option={OPTION} exportConfig={{ name: 'demo', csv }} />)
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }))
    expect(csv).toHaveBeenCalledTimes(1) // lazy: rows built on click, never on render
    expect(toCsv).toHaveBeenCalledWith(['Month', 'Total'], [['2026-06-01', 1]])
    expect(downloadText).toHaveBeenCalledWith('CSV-BODY', 'demo.csv', 'text/csv;charset=utf-8')
  })
})

describe('EChart event mirrors', () => {
  it('hands legendselectchanged a COPY of the name→shown map', () => {
    const onLegendChange = vi.fn()
    render(<EChart option={OPTION} onLegendChange={onLegendChange} />)
    const selected = { 'Net pay': false, '4% rule': true }
    lastChart().handlers['legendselectchanged']({ name: 'Net pay', selected })
    expect(onLegendChange).toHaveBeenCalledWith({ 'Net pay': false, '4% rule': true })
    // Copied, not aliased: echarts mutates its own map on the next toggle.
    expect(onLegendChange.mock.calls[0][0]).not.toBe(selected)
  })

  it('reads the resolved index window off the option on datazoom', () => {
    const onDataZoom = vi.fn()
    render(<EChart option={OPTION} onDataZoom={onDataZoom} />)
    lastChart().handlers['datazoom']()
    expect(onDataZoom).toHaveBeenCalledWith({ startValue: 3, endValue: 9 })
  })

  it('stays silent when the option carries no numeric window', () => {
    const onDataZoom = vi.fn()
    render(<EChart option={OPTION} onDataZoom={onDataZoom} />)
    lastChart().getOption.mockReturnValue({ dataZoom: [{}] })
    lastChart().handlers['datazoom']()
    expect(onDataZoom).not.toHaveBeenCalled()
  })

  it('always fires the LATEST handler without rebinding (the ref pattern)', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<EChart option={OPTION} onLegendChange={first} />)
    rerender(<EChart option={OPTION} onLegendChange={second} />)
    lastChart().handlers['legendselectchanged']({ selected: { A: false } })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith({ A: false })
  })
})
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/components/EChart.test.tsx` → FAIL (`exportConfig`/`onLegendChange`/`onDataZoom` are not props; `ChartExportMenu` missing).

- [x] **Step 3: Create the menu** — `src/components/ChartExportMenu.tsx`:

```tsx
import { SURFACE } from '../charts/theme'
import { downloadDataUrl, downloadText, toCsv } from '../utils/download'
import type { ExportTable } from '../utils/download'
import './panels.css'

export interface ExportConfig {
  /** Download basename — the files land as {name}.png / {name}.csv. */
  name: string
  /** Rows supplied by the CALLER from data already in scope — never introspected from
   * echarts options (2026-08-25 spec Decision log). Invoked lazily, on click. */
  csv?: () => ExportTable
}

/** The chart-handle subset the menu needs: EChart hands in the live instance, tests a
 * stub. Kept minimal so nothing here depends on echarts' own types. */
export interface ExportableChart {
  getDataURL: (opts: { pixelRatio: number; backgroundColor: string }) => string
}

/**
 * The house ⤓ export menu (2026-08-25 spec §2a): RangeChips' segmented button grammar,
 * deliberately NOT echarts' toolbox (Decision log). PNG snapshots the live canvas at 2×
 * on the card surface — the theme paints the canvas transparent, which would export
 * black — and CSV serializes the caller's own table through utils/download's toCsv.
 */
export default function ChartExportMenu({
  config,
  getChart,
}: {
  config: ExportConfig
  getChart: () => ExportableChart | null
}) {
  const png = () => {
    const chart = getChart()
    if (chart === null) return // disposed mid-click: nothing to snapshot
    downloadDataUrl(
      chart.getDataURL({ pixelRatio: 2, backgroundColor: SURFACE }),
      `${config.name}.png`,
    )
  }
  const csv = config.csv
  return (
    <div className="chart-export" role="group" aria-label={`Export ${config.name}`}>
      <span className="chart-export-glyph" aria-hidden="true">
        ⤓
      </span>
      <div className="segmented">
        <button type="button" onClick={png}>
          PNG
        </button>
        {csv && (
          <button
            type="button"
            onClick={() => {
              const { headers, rows } = csv()
              downloadText(toCsv(headers, rows), `${config.name}.csv`, 'text/csv;charset=utf-8')
            }}
          >
            CSV
          </button>
        )}
      </div>
    </div>
  )
}
```

- [x] **Step 4: Extend `EChart.tsx` — additively only** (cross-plan note: the sibling `ariaLabel` branch edits this file too; every change below APPENDS).
  1. Add imports (after the `quiesceRipples` import):
```ts
import ChartExportMenu from './ChartExportMenu'
import type { ExportConfig } from './ChartExportMenu'
```
  2. Append to the destructured props (after `instanceRef,`) and to the props type literal (after the `instanceRef` member):
```ts
  onLegendChange,
  onDataZoom,
  exportConfig,
```
```ts
  /** Mirrors legend toggles into page state (2026-08-25 spec §2e) with echarts' full
   *  name→shown map, COPIED — fed back via legend.selected so notMerge rebuilds keep
   *  the picks. */
  onLegendChange?: (selected: Record<string, boolean>) => void
  /** Mirrors a ctrl+wheel/drag-pan window into page state, as category-axis indices. */
  onDataZoom?: (window: { startValue: number; endValue: number }) => void
  /** Mounts the house ⤓ export menu above the canvas (2026-08-25 spec §2a). */
  exportConfig?: ExportConfig
```
  3. Append two latest-handler refs after `onHoverEndRef` and their refresh lines inside the unkeyed effect:
```ts
  const onLegendChangeRef = useRef(onLegendChange)
  const onDataZoomRef = useRef(onDataZoom)
```
```ts
    onLegendChangeRef.current = onLegendChange
    onDataZoomRef.current = onDataZoom
```
  4. In the init effect, append after the `globalout` binding:
```ts
    chart.on('legendselectchanged', (params) => {
      // Copied, not aliased: echarts mutates its own map on the next toggle.
      onLegendChangeRef.current?.({
        ...(params as { selected: Record<string, boolean> }).selected,
      })
    })
    chart.on('datazoom', () => {
      // The event's own payload is percent-based (and batch-shaped from inside zooms);
      // the RESOLVED category-axis indices live on the option — read them back instead.
      const zoom = (
        chart.getOption() as { dataZoom?: { startValue?: unknown; endValue?: unknown }[] }
      ).dataZoom?.[0]
      if (zoom && typeof zoom.startValue === 'number' && typeof zoom.endValue === 'number') {
        onDataZoomRef.current?.({ startValue: zoom.startValue, endValue: zoom.endValue })
      }
    })
```
  5. Replace ONLY the return statement — the container div line stays byte-identical (the sibling branch adds attributes to it):
```tsx
  return (
    <>
      {exportConfig && (
        <ChartExportMenu config={exportConfig} getChart={() => chartRef.current} />
      )}
      <div ref={containerRef} style={{ height, width: '100%' }} />
    </>
  )
```

- [x] **Step 5: CSS** — append to `src/components/panels.css`:

```css
/* ── Chart export menu (2026-08-25 spec §2a) ───────────────────────── */
/* RangeChips' segmented grammar with a ⤓ glyph, tucked against the card's right edge
   just above the canvas — deliberately NOT echarts' toolbox (spec Decision log). */

.chart-export {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.25rem;
}

.chart-export-glyph {
  color: var(--muted);
  font-size: 0.8rem;
}
```

- [x] **Step 6: Run** — `npx vitest run src/components/EChart.test.tsx` → PASS. Then the neighbors that mock EChart shallowly: `npx vitest run src/pages/SpendingPage.test.tsx src/pages/OverviewPage.test.tsx src/pages/TaxesPage.test.tsx` → PASS (their mocks ignore the new props).

- [x] **Step 7: Commit** — `git add -A && git commit -m "feat(charts): EChart exportConfig menu + legend/datazoom event mirrors"`

### Task 3: `ChartZoomHint` + `rangeZoom` window state

**Files:**
- Create: `src/components/ChartZoomHint.tsx`, `src/components/ChartZoomHint.test.tsx`
- Modify: `src/charts/timeZoom.ts`, `src/charts/timeZoom.test.ts`, `src/components/panels.css`

- [x] **Step 1: Write the failing tests.** Create `src/components/ChartZoomHint.test.tsx`:

```tsx
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import ChartZoomHint from './ChartZoomHint'

afterEach(cleanup)

it('states the inside-zoom gesture in the one shared wording', () => {
  render(<ChartZoomHint />)
  const hint = screen.getByText('ctrl+scroll to zoom · drag to pan')
  expect(hint.className).toBe('chart-zoom-hint')
})
```

Append to `src/charts/timeZoom.test.ts` (extend its import line to `import { rangeStartIndex, rangeZoom, timeZoom } from './timeZoom'`; the file's `MONTHS` fixture already exists):

```ts
describe('rangeZoom', () => {
  it('is exactly the preset zoom when no manual window is mirrored', () => {
    expect(rangeZoom(MONTHS, { preset: '1y' })).toEqual(timeZoom(MONTHS, '1y'))
  })

  it('layers a mirrored {startValue, endValue} window over the preset', () => {
    const [zoom] = rangeZoom(MONTHS, { preset: '1y', window: { startValue: 2, endValue: 5 } })
    expect(zoom.startValue).toBe(2)
    expect(zoom.endValue).toBe(5)
    // The inside-zoom contract itself is untouched — chips still cover presets, the
    // wheel stays ctrl-gated.
    expect(zoom.type).toBe('inside')
    expect(zoom.zoomOnMouseWheel).toBe('ctrl')
    expect(zoom.moveOnMouseWheel).toBe(false)
  })

  it('a fresh preset-only state (the chips) snaps the window away', () => {
    // RangeChips hand back {preset} with NO window — that IS the snap-back contract.
    const [snapped] = rangeZoom(MONTHS, { preset: 'all' })
    expect(snapped.startValue).toBe(0)
    expect(snapped.endValue).toBeUndefined()
  })
})
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/components/ChartZoomHint.test.tsx src/charts/timeZoom.test.ts` → FAIL (missing module / missing export).

- [x] **Step 3: Implement.** Create `src/components/ChartZoomHint.tsx`:

```tsx
import './panels.css'

/**
 * The inside-zoom charts have no visible affordance — the slider flavour is deliberately
 * unregistered (charts/echarts.ts) — so every card that registers one wears this caption
 * (2026-08-25 spec §2f). One component: the gesture must never be worded two ways.
 */
export default function ChartZoomHint() {
  return <p className="chart-zoom-hint">ctrl+scroll to zoom · drag to pan</p>
}
```

In `src/charts/timeZoom.ts`: add `endValue?: number` to `InsideZoomOption` (after `startValue`):

```ts
  /** Present only when a page mirrors a manual window back in (rangeZoom below) —
   * presets deliberately omit it so every window runs to the newest point. */
  endValue?: number
```

and append at the end of the file:

```ts
export interface ZoomWindow {
  /** Category-axis indices, read back off the chart's option by EChart's datazoom
   * mirror — appended categories (the live ping) don't shift them. */
  startValue: number
  endValue: number
}

/**
 * A page's whole window state (2026-08-25 spec §2e): the chips' preset plus, transiently,
 * a manual ctrl+wheel wander. The chips hand back a fresh `{ preset }` carrying NO window
 * — overwriting this state is exactly their existing snap-back contract, now made
 * explicit in the type.
 */
export interface RangeState {
  preset: RangePreset
  window?: ZoomWindow
}

/**
 * timeZoom with any mirrored manual window layered over the preset, so option rebuilds
 * (refetches, notMerge) and same-axis sibling charts keep the window the user dragged
 * out instead of snapping back to the preset on every re-render.
 */
export function rangeZoom(dates: string[], range: RangeState): InsideZoomOption[] {
  const [zoom] = timeZoom(dates, range.preset)
  if (range.window === undefined) return [zoom]
  return [{ ...zoom, startValue: range.window.startValue, endValue: range.window.endValue }]
}
```

Append to `src/components/panels.css`:

```css
/* The inside-zoom caption (2026-08-25 spec §2f) — muted, small, under the canvas. */
.chart-zoom-hint {
  margin: 0.25rem 0 0;
  color: var(--muted);
  font-size: 0.7rem;
  text-align: right;
}
```

- [x] **Step 4: Run** — `npx vitest run src/components/ChartZoomHint.test.tsx src/charts/timeZoom.test.ts` → PASS.

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(charts): ChartZoomHint caption + rangeZoom manual-window state"`

---

## Phase 2 — Tooltip totals + cosmetic fixes (spec §2b)

### Task 4: Spending bars share/Total formatter + unsigned savings rate

**Files:**
- Create: `src/components/spending/spendingChartOptions.ts`, `src/components/spending/spendingChartOptions.test.ts`
- Modify: `src/pages/SpendingPage.tsx`, `src/pages/SpendingPage.test.tsx`

- [x] **Step 1: Write the failing formatter tests** — create `src/components/spending/spendingChartOptions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { spendingBarsTooltipFormatter } from './spendingChartOptions'

const format = spendingBarsTooltipFormatter(['Rent', '<b>Fun</b>', 'Other'])

describe('spendingBarsTooltipFormatter', () => {
  it('gives each category its share of the month and closes them with a Total row', () => {
    const html = format([
      { seriesName: 'Rent', marker: '[1]', axisValueLabel: 'Jun 2026', value: 1500 },
      { seriesName: '<b>Fun</b>', marker: '[2]', value: 300 },
      { seriesName: 'Other', marker: '[3]', value: 200 },
      { seriesName: 'Net pay', marker: '[n]', value: 6000 },
      { seriesName: '4% rule', marker: '[f]', value: 4100.5 },
    ])
    expect(html).toBe(
      '<strong>Jun 2026</strong><br/>' +
        '[1]Rent: $1,500.00 (75.0%)<br/>' +
        '[2]&lt;b&gt;Fun&lt;/b&gt;: $300.00 (15.0%)<br/>' +
        '[3]Other: $200.00 (10.0%)<br/>' +
        '<strong>Total: $2,000.00</strong><br/>' +
        '[n]Net pay: $6,000.00<br/>' +
        '[f]4% rule: $4,100.50',
    )
  })

  it('drops the shares when the month nets to zero or below (a refund month)', () => {
    const html = format([
      { seriesName: 'Rent', marker: '', axisValueLabel: 'Jun 2026', value: 100 },
      { seriesName: 'Other', marker: '', value: -100 },
    ])
    expect(html).toContain('Rent: $100.00<br/>')
    expect(html).toContain('<strong>Total: $0.00</strong>')
    expect(html).not.toContain('%')
  })

  it('lists reference lines without a Total when no category row is under the pointer', () => {
    const html = format([
      { seriesName: 'Net pay', marker: '', axisValueLabel: 'Jun 2026', value: 6000 },
    ])
    expect(html).toContain('Net pay: $6,000.00')
    expect(html).not.toContain('Total:')
  })

  it('returns an empty string when nothing under the pointer is finite', () => {
    expect(format([{ seriesName: 'Net pay', value: null }])).toBe('')
    expect(format([])).toBe('')
  })
})
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/components/spending/spendingChartOptions.test.ts` → FAIL (module not found).

- [x] **Step 3: Implement the formatter** — create `src/components/spending/spendingChartOptions.ts`:

```ts
// Pure tooltip + CSV helpers for the spending stacked-bars chart — no React, no
// fetching, no theme decisions of their own (budgetChartOptions.ts's posture). The
// option itself stays in SpendingPage (it reads page state); only the parts worth
// unit-testing live here. Number() is display-only (format.ts's rule).
import { escapeHtml, formatCurrency } from '../../utils/format'

// Axis-tooltip params subset the formatter reads (historyChartOptions' posture).
interface AxisTooltipParam {
  seriesName?: string
  marker?: string
  axisValueLabel?: string
  value?: unknown
}

/**
 * The stacked bars' axis tooltip (2026-08-25 spec §2b, the vestingChartOptions Total-row
 * pattern): each CATEGORY row carries its (xx%) share of the month's category total, a
 * bold Total row closes the categories, and the reference lines — net pay, the 4% rule,
 * budget steps — list AFTER it, excluded from the sum: they are comparisons, not spend.
 * Shares are computed over the rows actually under the pointer, so legend-hidden
 * categories leave percentages that still add to 100. Padded nulls (net pay's gaps) are
 * dropped, historyTooltipFormatter's rule. Category names are USER TEXT — escapeHtml on
 * every series name (the page's own rule); budget-step names carry them too, so
 * reference rows are escaped alike.
 */
export function spendingBarsTooltipFormatter(
  categoryNames: string[],
): (params: unknown) => string {
  const categories = new Set(categoryNames)
  return (params: unknown) => {
    const list = (Array.isArray(params) ? params : [params]) as AxisTooltipParam[]
    const finite = list.flatMap((p) =>
      typeof p.value === 'number' && Number.isFinite(p.value) ? [{ p, value: p.value }] : [],
    )
    if (finite.length === 0) return ''
    const catRows = finite.filter(({ p }) => categories.has(p.seriesName ?? ''))
    const refRows = finite.filter(({ p }) => !categories.has(p.seriesName ?? ''))
    const total = catRows.reduce((sum, { value }) => sum + value, 0)
    const line = ({ p, value }: { p: AxisTooltipParam; value: number }, share: boolean) => {
      // A zero-or-below total cannot scale a share (a refund month) — rows go bare.
      const pct = share && total > 0 ? ` (${((value / total) * 100).toFixed(1)}%)` : ''
      return `${p.marker ?? ''}${escapeHtml(p.seriesName ?? '')}: ${formatCurrency(value)}${pct}`
    }
    return [
      `<strong>${finite[0].p.axisValueLabel ?? ''}</strong>`,
      ...catRows.map((row) => line(row, true)),
      ...(catRows.length > 0 ? [`<strong>Total: ${formatCurrency(total)}</strong>`] : []),
      ...refRows.map((row) => line(row, false)),
    ].join('<br/>')
  }
}
```

Run: `npx vitest run src/components/spending/spendingChartOptions.test.ts` → PASS.

- [x] **Step 4: Wire the page.** In `src/pages/SpendingPage.tsx`:
  1. Add the import (beside the budgetChartOptions import):
```ts
import { spendingBarsTooltipFormatter } from '../components/spending/spendingChartOptions'
```
  2. In `barsOption`, replace the whole `tooltip:` block with:
```ts
      tooltip: {
        trigger: 'axis',
        // Category rows carry (share of month) and a bold Total; the net-pay/4%/budget
        // reference lines list after it, excluded from the sum (2026-08-25 spec §2b).
        // Padded nulls now drop instead of printing '—' rows — the house formatter rule.
        formatter: spendingBarsTooltipFormatter([
          ...topIds.map((id) => nameById.get(id) ?? String(id)),
          'Other',
        ]),
      },
```
  3. In `savingsOption`'s tooltip, change the `valueFormatter` line to print unsigned (spec §2b: "+35.0%" reads as a movement; a rate is a level — the axis labels beside it are already unsigned):
```ts
        valueFormatter: (value) =>
          value === null || value === undefined
            ? '—'
            : formatPct(value as number, { signed: false }),
```

- [x] **Step 5: Upgrade the SpendingPage test mock ONCE for the whole batch.** In `src/pages/SpendingPage.test.tsx`, replace the entire `vi.mock('../components/EChart', …)` block with the version below (later tasks — deep links, persistence, export — assert through these attributes and stand-in events):

```tsx
// echarts needs a real canvas and is NEVER rendered in jsdom (house law) — what each
// chart draws is pinned in its option-builder tests; this marker says which charts are
// up and, via data-* attributes, the option/prop slices these page tests pin: sankey
// links (the flow card), legend.selected (persistence), the first dataZoom entry
// (window persistence), a sampled valueFormatter (the unsigned savings rate) and the
// export name. Clicking a marker stands in for a click on the chart's first month
// (dataIndex 0); mouseEnter/mouseLeave stand in for the legendselectchanged/datazoom
// chart events jsdom cannot raise.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
      onClick,
      onLegendChange,
      onDataZoom,
      exportConfig,
    }: {
      option: {
        series?: { links?: { source?: string; target?: string; value?: number }[] }[]
        legend?: { selected?: Record<string, boolean> }
        dataZoom?: { startValue?: number; endValue?: number }[]
        tooltip?: { valueFormatter?: (value: unknown) => string }
      }
      onClick?: (params: { dataIndex?: number }) => void
      onLegendChange?: (selected: Record<string, boolean>) => void
      onDataZoom?: (window: { startValue: number; endValue: number }) => void
      exportConfig?: { name: string }
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'data-links': (option.series?.[0]?.links ?? [])
          .map((l) => `${l.source}>${l.target}=${l.value}`)
          .join('|'),
        'data-legend-selected': JSON.stringify(option.legend?.selected ?? null),
        'data-zoom': JSON.stringify(option.dataZoom?.[0] ?? null),
        'data-pct-sample': option.tooltip?.valueFormatter?.(0.35) ?? '',
        'data-export-name': exportConfig?.name ?? '',
        onClick: () => onClick?.({ dataIndex: 0 }),
        onMouseEnter: () => onLegendChange?.({ 'Net pay': false, '4% rule': true }),
        onMouseLeave: () => onDataZoom?.({ startValue: 1, endValue: 1 }),
      }),
  }
})
```

Then append the unsigned-rate pin (a new top-level `describe` after the flow-card one):

```tsx
describe('SpendingPage — tooltip fixes', () => {
  it('prints the savings-rate tooltip unsigned — a rate is a level, not a movement', async () => {
    renderPage()
    await screen.findByText('Where Jul 2026 went')
    const samples = screen
      .getAllByTestId('echart')
      .map((el) => el.getAttribute('data-pct-sample'))
    expect(samples).toContain('35.0%') // the savings chart's valueFormatter, sampled at 0.35
    expect(samples).not.toContain('+35.0%')
  })
})
```

- [x] **Step 6: Run** — `npx vitest run src/pages/SpendingPage.test.tsx src/components/spending/spendingChartOptions.test.ts` → ALL PASS (the four pre-existing flow tests ride the new mock unchanged).

- [x] **Step 7: Commit** — `git add -A && git commit -m "feat(spending): bars tooltip shares + Total row; unsigned savings-rate tooltip"`

### Task 5: Net-worth stacked tooltip — assets subtotal

**Files:**
- Create: `src/components/networth/netWorthChartOptions.ts`, `src/components/networth/netWorthChartOptions.test.ts`
- Modify: `src/pages/NetWorthPage.tsx`

- [x] **Step 1: Write the failing tests** — create `src/components/networth/netWorthChartOptions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { NOTES_SERIES, netWorthStackedTooltipFormatter } from './netWorthChartOptions'

const ASSETS = ['Cash', 'Pre-tax', 'Post-tax', 'Taxable', 'Equity', 'Other']
const format = netWorthStackedTooltipFormatter(ASSETS)

describe('netWorthStackedTooltipFormatter', () => {
  it('subtotals the asset rows before liabilities and net worth', () => {
    const html = format([
      { seriesName: 'Cash', marker: '[c]', axisValueLabel: 'Aug 2026', value: 1000 },
      { seriesName: 'Taxable', marker: '[t]', value: 4000.5 },
      { seriesName: 'Liabilities', marker: '[l]', value: -250 },
      { seriesName: 'Net worth', marker: '[n]', value: 4750.5 },
    ])
    expect(html).toBe(
      '<strong>Aug 2026</strong><br/>' +
        '[c]Cash: $1,000.00<br/>' +
        '[t]Taxable: $4,000.50<br/>' +
        '<strong>Assets: $5,000.50</strong><br/>' +
        '[l]Liabilities: -$250.00<br/>' +
        '[n]Net worth: $4,750.50',
    )
  })

  it('keeps the Notes branch: user text escaped, never a money row', () => {
    const html = format([
      { seriesName: 'Cash', marker: '', axisValueLabel: 'Aug 2026', value: 10 },
      { seriesName: NOTES_SERIES, marker: '[d]', data: { note: 'sold <em>car</em>' } },
    ])
    expect(html).toContain('[d]sold &lt;em&gt;car&lt;/em&gt;')
    expect(html).not.toContain('<em>car</em>')
    expect(html).toContain('<strong>Assets: $10.00</strong>')
  })

  it('dashes a non-finite row without letting it dent the subtotal', () => {
    const html = format([
      { seriesName: 'Cash', marker: '', axisValueLabel: 'Aug 2026', value: 10 },
      { seriesName: 'Equity', marker: '', value: null },
    ])
    expect(html).toContain('Equity: —')
    expect(html).toContain('<strong>Assets: $10.00</strong>')
  })

  it('skips the subtotal when nothing under the pointer is an asset row', () => {
    const html = format([
      { seriesName: 'Net worth', marker: '', axisValueLabel: 'Aug 2026', value: 4750.5 },
    ])
    expect(html).not.toContain('Assets:')
    expect(format([])).toBe('')
  })
})
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/components/networth/netWorthChartOptions.test.ts` → FAIL (module not found).

- [x] **Step 3: Implement** — create `src/components/networth/netWorthChartOptions.ts` (the page's existing formatter moves here whole, growing the subtotal):

```ts
// Pure tooltip/CSV helpers for the net-worth stacked chart — no React, no fetching, no
// theme decisions of their own (historyChartOptions.ts posture). The option itself stays
// in NetWorthPage (it reads page state); only the parts worth unit-testing live here.
import { escapeHtml, formatCurrency } from '../../utils/format'

/** The wizard's snapshot notes, drawn as markers riding the net-worth line. One name so
 * the legend, the tooltip branch and the series stay in lockstep (moved verbatim from
 * NetWorthPage). */
export const NOTES_SERIES = 'Notes'

interface AxisTooltipParam {
  seriesName?: string
  marker?: string
  axisValueLabel?: string
  value?: unknown
  data?: unknown
}

/**
 * The stacked chart's axis tooltip: asset-group rows, then their SUBTOTAL (2026-08-25
 * spec §2b — liabilities and the net-worth line already render as their own rows), then
 * the rest in series order. A full formatter, not valueFormatter: the Notes series
 * carries TEXT — and note text is USER TEXT, so escapeHtml is mandatory (SpendingPage's
 * rule). Money rows keep the currency treatment; a padded null still reads as a dash.
 */
export function netWorthStackedTooltipFormatter(
  assetNames: string[],
): (params: unknown) => string {
  const assets = new Set(assetNames)
  return (params: unknown) => {
    const list = (Array.isArray(params) ? params : [params]) as AxisTooltipParam[]
    if (list.length === 0) return ''
    const head = `<strong>${list[0].axisValueLabel ?? ''}</strong>`
    const assetLines: string[] = []
    const otherLines: string[] = []
    let assetTotal = 0
    for (const p of list) {
      if (p.seriesName === NOTES_SERIES) {
        const note = (p.data as { note?: string } | undefined)?.note ?? ''
        otherLines.push(`${p.marker ?? ''}${escapeHtml(note)}`)
        continue
      }
      const raw = Array.isArray(p.value) ? p.value[1] : p.value
      const finite = typeof raw === 'number' && Number.isFinite(raw)
      const line = `${p.marker ?? ''}${p.seriesName ?? ''}: ${finite ? formatCurrency(raw) : '—'}`
      if (assets.has(p.seriesName ?? '')) {
        assetLines.push(line)
        if (finite) assetTotal += raw
      } else {
        otherLines.push(line)
      }
    }
    return [
      head,
      ...assetLines,
      // Only when an asset row actually printed — a hover with the stack legend-hidden
      // has nothing to subtotal.
      ...(assetLines.length > 0
        ? [`<strong>Assets: ${formatCurrency(assetTotal)}</strong>`]
        : []),
      ...otherLines,
    ].join('<br/>')
  }
}
```

- [x] **Step 4: Wire the page.** In `src/pages/NetWorthPage.tsx`:
  1. Add the import:
```ts
import {
  NOTES_SERIES,
  netWorthStackedTooltipFormatter,
} from '../components/networth/netWorthChartOptions'
```
  2. Delete the local `const NOTES_SERIES = 'Notes'` declaration (and its two comment lines) — the imported one takes over every use site unchanged.
  3. In `stackedOption`, replace the whole `tooltip:` block with:
```ts
      tooltip: {
        trigger: 'axis',
        // Asset rows + their subtotal, then liabilities/net worth/notes — the formatter
        // (and its escapeHtml duty on note text) lives in netWorthChartOptions.ts.
        formatter: netWorthStackedTooltipFormatter(ASSET_GROUPS.map((g) => GROUP_LABELS[g])),
      },
```
  4. Remove `escapeHtml,` from the `../utils/format` import — the moved formatter was its only consumer here (ESLint flags it otherwise).

- [x] **Step 5: Run** — `npx vitest run src/components/networth/netWorthChartOptions.test.ts` → PASS; `npx eslint src/pages/NetWorthPage.tsx` → clean.

- [x] **Step 6: Commit** — `git add -A && git commit -m "feat(net-worth): stacked tooltip assets subtotal (formatter extracted)"`

### Task 6: Tax-trend total-tax row + bold history tooltip header

**Files:**
- Modify: `src/components/taxes/taxChartOptions.ts`, `src/components/taxes/taxChartOptions.test.ts`, `src/components/portfolio/historyChartOptions.ts`, `src/components/portfolio/historyChartOptions.test.ts`

- [x] **Step 1: Update the pinned trend-tooltip test and add the new cases.** In `src/components/taxes/taxChartOptions.test.ts`, the test `divides the rate back out in BOTH places that render it` pins the exact tooltip string — insert the Total row into its expectation:

```ts
    ).toBe(
      '<strong>2024</strong><br/>[m]Federal: $40,782.88<br/>' +
        '<strong>Total tax: $40,782.88</strong><br/>[r]Effective rate: 30.6%',
    )
```

and append to the same `describe('trendOption', …)` block:

```ts
  it('totals the jurisdiction rows — dashes excluded, the rate line never an addend', () => {
    const html = tooltipFormatterOf(trendOption([summaryFixture(2024)]))([
      { name: '2024', seriesName: 'Federal', value: 40782.88, marker: '[m]' },
      { name: '2024', seriesName: 'State', value: 15884.46, marker: '[s]' },
      { name: '2024', seriesName: 'SDI', value: null, marker: '[d]' },
      { name: '2024', seriesName: 'Effective rate', value: 30.5661, marker: '[r]' },
    ])
    expect(html).toContain('[d]SDI: —')
    // 40782.88 + 15884.46; the null row contributes nothing, the rate is not money.
    expect(html).toContain('<strong>Total tax: $56,667.34</strong>')
    // Ordering: jurisdictions, the total, THEN the rate — a ratio after its parts.
    expect(html.indexOf('Total tax')).toBeGreaterThan(html.indexOf('[s]State'))
    expect(html.indexOf('[r]Effective rate')).toBeGreaterThan(html.indexOf('Total tax'))
  })
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/components/taxes/taxChartOptions.test.ts` → the updated pin and the new case FAIL (no Total row yet).

- [x] **Step 3: Implement the Total-tax row.** In `src/components/taxes/taxChartOptions.ts`, replace `trendOption`'s `formatter` callback body with:

```ts
      formatter: (params) => {
        const list = Array.isArray(params) ? params : [params]
        const head = `<strong>${list[0]?.name ?? ''}</strong>`
        const line = (p: (typeof list)[number]) => {
          const value = p.value as number | null
          const text =
            value === null || value === undefined
              ? '—'
              : p.seriesName === RATE_SERIES_NAME
                ? formatPct(value / 100, { signed: false })
                : formatCurrency(value)
          return `${p.marker ?? ''}${p.seriesName ?? ''}: ${text}`
        }
        // The stacks, then the year's total (vestingChartOptions' Total row,
        // jurisdiction-flavoured — 2026-08-25 spec §2b), then the rate line: the rate is
        // a ratio, not a seventh addend, so it stays out of the sum and under it.
        const taxRows = list.filter((p) => p.seriesName !== RATE_SERIES_NAME)
        const rateRows = list.filter((p) => p.seriesName === RATE_SERIES_NAME)
        const total = taxRows.reduce(
          (sum, p) => sum + (typeof p.value === 'number' ? p.value : 0),
          0,
        )
        return [
          head,
          ...taxRows.map(line),
          ...(taxRows.length > 0
            ? [`<strong>Total tax: ${formatCurrency(total)}</strong>`]
            : []),
          ...rateRows.map(line),
        ].join('<br/>')
      },
```

(The surrounding comment about two units in one tooltip stays.)

- [x] **Step 4: Bold the history tooltip header.** In `src/components/portfolio/historyChartOptions.ts`, `historyTooltipFormatter` currently returns `[header, ...rows.map(…)]` — change the first array element from `header,` to:

```ts
    `<strong>${header}</strong>`,
```

(spec §2b: every other formatter bolds its date header; this one was the odd one out.) Append the pin to `describe('historyTooltipFormatter', …)` in `historyChartOptions.test.ts`:

```ts
  it('bolds the date header like every other formatter', () => {
    const html = historyTooltipFormatter([
      { seriesName: 'Portfolio value', marker: '<i/>', axisValueLabel: 'Aug 10, 2026', value: 1 },
    ])
    expect(html).toContain('<strong>Aug 10, 2026</strong>')
  })
```

(The existing header assertions use `toContain('Aug 14, 2026')`, which the bold form still satisfies — no edits there.)

- [x] **Step 5: Run** — `npx vitest run src/components/taxes/taxChartOptions.test.ts src/components/portfolio/historyChartOptions.test.ts` → ALL PASS. Then `npx vitest run src/pages/TaxesPage.test.tsx` → PASS (it never pins tooltip strings).

- [x] **Step 6: Commit** — `git add -A && git commit -m "feat(charts): tax-trend Total-tax tooltip row + bold history header"`

---

## Phase 3 — Event markers on /portfolio (spec §2c)

### Task 7: `buildEventMarkers` + the Events series and tooltip branch

**Files:**
- Modify: `src/components/portfolio/historyChartOptions.ts`, `src/components/portfolio/historyChartOptions.test.ts`, `src/pages/PortfolioPage.tsx`

- [x] **Step 1: Write the failing tests** — append to `src/components/portfolio/historyChartOptions.test.ts`. Extend its imports:

```ts
import type { DividendOut, PortfolioHistory, TransactionOut } from '../../types/api'
import { MUTED, PALETTE } from '../../charts/theme'
import {
  buildEventMarkers,
  EVENTS_SERIES,
  historyTooltipFormatter,
  liveFromHoldings,
  portfolioHistoryOption,
} from './historyChartOptions'
```

(these REPLACE the file's existing theme/types/historyChartOptions import lines) and append:

```ts
// --- event markers (2026-08-25 spec §2c) --------------------------------------------

const TICKERS = new Map([
  [1, 'NVDA'],
  [2, 'VOO'],
])

function txn(over: Partial<TransactionOut> & Pick<TransactionOut, 'id' | 'type'>): TransactionOut {
  return {
    security_id: 1, account: 'Fidelity', txn_date: null, shares: '10', price: '100.00',
    fees: null, split_factor: null, sort_index: 0, source: 'ui', notes: null, ...over,
  }
}

function div(over: Partial<DividendOut> & Pick<DividendOut, 'id' | 'pay_date'>): DividendOut {
  return {
    security_id: 2, account: null, amount: '12.00', source: 'manual', ex_date: null,
    per_share: null, shares_held: null, notes: null, ...over,
  }
}

describe('buildEventMarkers', () => {
  it('snaps each dated event to the NEAREST weekly bar, riding the value line', () => {
    const points = buildEventMarkers(
      history(), // dates 07-27 / 08-03 / 08-10
      [txn({ id: 1, type: 'buy', txn_date: '2026-08-04' })], // 1 day to 08-03, 6 to 08-10
      [],
      TICKERS,
    )
    expect(points).toEqual([
      {
        value: ['Aug 3, 2026', 710000.5],
        symbol: 'triangle',
        symbolRotate: 0,
        events: [{ text: 'Buy NVDA — 10 sh · Aug 4, 2026' }],
      },
    ])
  })

  it('rotates a sell 180° and circles a dividend, each with its TRUE date in the text', () => {
    const points = buildEventMarkers(
      history(),
      [txn({ id: 1, type: 'sell', txn_date: '2026-07-28', shares: '3' })], // -> bar 0
      [div({ id: 9, pay_date: '2026-08-09' })], // 1 day to 08-10 vs 6 to 08-03 -> bar 2
      TICKERS,
    )
    expect(points).toHaveLength(2)
    expect(points[0]).toEqual({
      value: ['Jul 27, 2026', 700000],
      symbol: 'triangle',
      symbolRotate: 180,
      events: [{ text: 'Sell NVDA — 3 sh · Jul 28, 2026' }],
    })
    expect(points[1]).toEqual({
      value: ['Aug 10, 2026', 718422.07],
      symbol: 'circle',
      symbolRotate: 0,
      events: [{ text: 'Dividend VOO — $12.00 · Aug 9, 2026' }],
    })
  })

  it('clusters same-bar events into ONE marker; a mixed cluster wears the diamond', () => {
    const points = buildEventMarkers(
      history(),
      [txn({ id: 1, type: 'buy', txn_date: '2026-08-04' })],
      [div({ id: 9, pay_date: '2026-08-05' })], // 2 days to 08-03, 5 to 08-10 -> same bar
      TICKERS,
    )
    expect(points).toHaveLength(1)
    expect(points[0].symbol).toBe('diamond') // no single kind may over-claim the cluster
    expect(points[0].events).toEqual([
      { text: 'Buy NVDA — 10 sh · Aug 4, 2026' },
      { text: 'Dividend VOO — $12.00 · Aug 5, 2026' },
    ])
  })

  it('skips dateless transactions, splits, and events off the axis ends', () => {
    expect(
      buildEventMarkers(
        history(),
        [
          txn({ id: 1, type: 'buy' }), // txn_date null: imported, nothing to snap to
          txn({ id: 2, type: 'split', txn_date: '2026-08-04', split_factor: '10' }),
          txn({ id: 3, type: 'buy', txn_date: '2026-07-01' }), // before the first bar
        ],
        [div({ id: 9, pay_date: '2026-08-20' })], // after the last bar
        TICKERS,
      ),
    ).toEqual([])
    expect(buildEventMarkers({ ...history(), dates: [], market_value: [] }, [], [], TICKERS))
      .toEqual([])
  })
})

describe('portfolioHistoryOption with events', () => {
  const EVENT_POINTS = [
    {
      value: ['Aug 3, 2026', 710000.5] as [string, number],
      symbol: 'triangle' as const,
      symbolRotate: 0,
      events: [{ text: 'Buy NVDA — 10 sh · Aug 4, 2026' }],
    },
  ]

  it('appends a MUTED plain-scatter Events series, legend-toggleable and on by default', () => {
    const option = portfolioHistoryOption(history(), null, EVENT_POINTS)
    const series = seriesOf(option!)
    expect(series.map((s) => s.name)).toEqual([
      'Portfolio value', 'Cost basis', 'S&P 500 baseline', 'VOO (your contributions)',
      EVENTS_SERIES,
    ])
    const events = series[4] as SeriesLike & { z?: number }
    expect(events.type).toBe('scatter') // ripple stays reserved for the live ping
    expect(events.color).toBe(MUTED)
    expect(events.z).toBe(11)
    expect(events.data).toBe(EVENT_POINTS)
    // No legend.selected entry: on by default, toggleable like any series.
    expect((option as unknown as { legend: { selected?: unknown } }).legend.selected)
      .toBeUndefined()
  })

  it('draws no Events series for an empty or omitted list (Overview keeps the two-arg call)', () => {
    expect(seriesOf(portfolioHistoryOption(history(), null, [])!)).toHaveLength(4)
    expect(seriesOf(portfolioHistoryOption(history(), null)!)).toHaveLength(4)
  })
})

describe('historyTooltipFormatter — the Events branch', () => {
  it('lists each clustered event (count first), escaped, never as a money row', () => {
    const html = historyTooltipFormatter([
      { seriesName: 'Portfolio value', marker: '<i/>', axisValueLabel: 'Aug 3, 2026', value: 710000.5 },
      {
        seriesName: EVENTS_SERIES,
        marker: '<i/>',
        axisValueLabel: 'Aug 3, 2026',
        value: ['Aug 3, 2026', 710000.5],
        data: {
          events: [
            { text: 'Buy <X> — 10 sh · Aug 4, 2026' },
            { text: 'Dividend VOO — $12.00 · Aug 5, 2026' },
          ],
        },
      },
    ])
    expect(html).toContain('<strong>Aug 3, 2026</strong>')
    expect(html).toContain('<strong>2 events</strong>')
    expect(html).toContain('Buy &lt;X&gt; — 10 sh · Aug 4, 2026') // tickers are server text
    expect(html).toContain('Dividend VOO — $12.00 · Aug 5, 2026')
    // The marker's y is chart geometry (it rides the value line) — never a money row.
    expect(html).not.toContain(`${EVENTS_SERIES}&nbsp;`)
  })

  it('drops the count line for a lone event and stands alone on the live category', () => {
    const html = historyTooltipFormatter([
      {
        seriesName: EVENTS_SERIES,
        marker: '',
        axisValueLabel: 'Aug 10, 2026',
        value: ['Aug 10, 2026', 718422.07],
        data: { events: [{ text: 'Buy NVDA — 10 sh · Aug 10, 2026' }] },
      },
    ])
    expect(html).toContain('<strong>Aug 10, 2026</strong>')
    expect(html).toContain('Buy NVDA — 10 sh · Aug 10, 2026')
    expect(html).not.toContain('events</strong>')
  })
})
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/components/portfolio/historyChartOptions.test.ts` → the new describes FAIL (missing exports); everything pre-existing PASSES.

- [x] **Step 3: Implement.** In `src/components/portfolio/historyChartOptions.ts`:
  1. Extend the imports:
```ts
import { INK, MUTED, PALETTE } from '../../charts/theme'
import type { DividendOut, HoldingsTotals, PortfolioHistory, TransactionOut } from '../../types/api'
import {
  escapeHtml,
  formatCurrency,
  formatCurrencyCompact,
  formatDate,
  formatShares,
} from '../../utils/format'
```
  2. Add `data?: unknown` to `AxisTooltipParam` (after `value?: unknown`).
  3. Below `liveFromHoldings`, add the marker builder:
```ts
// One name so the legend, the tooltip branch and the series stay in lockstep
// (NetWorthPage's NOTES_SERIES idiom).
export const EVENTS_SERIES = 'Events'

export interface ChartEventPoint {
  /** [category label, y] — the marker rides the portfolio-value line at its bar. */
  value: [string, number]
  symbol: 'triangle' | 'circle' | 'diamond'
  symbolRotate: number
  /** Display-ready lines, one per underlying event, TRUE dates included. Escaped at
   * HTML time by the tooltip branch — tickers are server text. */
  events: { text: string }[]
}

// Day-serial for snap distances. Date.UTC over split components — never `new Date(iso)`
// (format.ts's UTC-shift rule); components are exact, no timezone in play.
function dayNumber(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/**
 * The /portfolio ledgers as chart annotations (2026-08-25 spec §2c): every DATED buy,
 * sell and dividend snapped to the NEAREST weekly bar (the axis is categorical — a
 * true-date x would lie between bars), one marker per bar. Same-bar events cluster into
 * one marker whose tooltip lists each with its true date; a single-kind cluster wears
 * its kind's glyph (▲ buy, the same triangle rotated for sell, ● dividend) and a mixed
 * one wears the diamond so no kind over-claims it. Skipped honestly: dateless imported
 * transactions (nothing to snap to), splits (not one of the three glyphs — spec), and
 * events off either axis end (no bar to stand on). /portfolio only by construction —
 * OverviewPage never calls this (Decision log: it must not start fetching ledgers).
 */
export function buildEventMarkers(
  history: Pick<PortfolioHistory, 'dates' | 'market_value'>,
  transactions: TransactionOut[],
  dividends: DividendOut[],
  tickers: Map<number, string>,
): ChartEventPoint[] {
  if (history.dates.length === 0) return []
  const days = history.dates.map(dayNumber)
  const ticker = (id: number) => tickers.get(id) ?? `#${id}`
  interface RawEvent {
    kind: 'buy' | 'sell' | 'dividend'
    date: string
    text: string
  }
  const raw: RawEvent[] = []
  for (const t of transactions) {
    if (t.txn_date === null || (t.type !== 'buy' && t.type !== 'sell')) continue
    raw.push({
      kind: t.type,
      date: t.txn_date,
      text: `${t.type === 'buy' ? 'Buy' : 'Sell'} ${ticker(t.security_id)} — ${formatShares(
        t.shares,
      )} sh · ${formatDate(t.txn_date)}`,
    })
  }
  for (const d of dividends) {
    raw.push({
      kind: 'dividend',
      date: d.pay_date,
      text: `Dividend ${ticker(d.security_id)} — ${formatCurrency(d.amount)} · ${formatDate(
        d.pay_date,
      )}`,
    })
  }
  const byIndex = new Map<number, RawEvent[]>()
  for (const event of raw) {
    const day = dayNumber(event.date)
    if (day < days[0] || day > days[days.length - 1]) continue
    let index = 0
    for (let i = 1; i < days.length; i += 1) {
      // Strict <: an (unreachable-with-weekly-bars) tie keeps the earlier bar.
      if (Math.abs(days[i] - day) < Math.abs(days[index] - day)) index = i
    }
    const bucket = byIndex.get(index)
    if (bucket) bucket.push(event)
    else byIndex.set(index, [event])
  }
  const SYMBOLS = { buy: 'triangle', sell: 'triangle', dividend: 'circle' } as const
  return [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, events]) => {
      events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      const kinds = new Set(events.map((e) => e.kind))
      const kind = kinds.size === 1 ? events[0].kind : null
      return {
        value: [formatDate(history.dates[index]), Number(history.market_value[index])],
        symbol: kind === null ? 'diamond' : SYMBOLS[kind],
        symbolRotate: kind === 'sell' ? 180 : 0,
        events: events.map(({ text }) => ({ text })),
      }
    })
}
```
  4. Replace `historyTooltipFormatter`'s body (keeping its doc comment, extended) so the Events row expands into event lines instead of a money row:
```ts
// Exported for tests. Skipping null rows is the point: on the live category the three
// lines are padding-null and would each print a dash row under the default formatter.
// The Events row expands into its clustered event lines (count first when > 1) rather
// than printing its y — that y is chart geometry, not a figure. Series names and date
// labels are app-generated; EVENT TEXT carries tickers (server text), so it is escaped.
export function historyTooltipFormatter(params: unknown): string {
  const list = (Array.isArray(params) ? params : [params]) as AxisTooltipParam[]
  const rows: { param: AxisTooltipParam; value: number }[] = []
  const eventLines: string[] = []
  for (const param of list) {
    if (param.seriesName === EVENTS_SERIES) {
      const events =
        (param.data as { events?: { text: string }[] } | undefined)?.events ?? []
      if (events.length > 1) eventLines.push(`<strong>${events.length} events</strong>`)
      for (const event of events) {
        eventLines.push(`${param.marker ?? ''} ${escapeHtml(event.text)}`)
      }
      continue
    }
    const value = rowValue(param.value)
    if (value !== null) rows.push({ param, value })
  }
  if (rows.length === 0 && eventLines.length === 0) return ''
  const header = list.find((p) => p.axisValueLabel)?.axisValueLabel ?? ''
  return [
    `<strong>${header}</strong>`,
    ...rows.map(
      ({ param, value }) =>
        `${param.marker ?? ''} ${param.seriesName ?? ''}&nbsp;&nbsp;${formatCurrency(value)}`,
    ),
    ...eventLines,
  ].join('<br/>')
}
```
  5. Give `portfolioHistoryOption` the optional third parameter and the series. Signature becomes:
```ts
export function portfolioHistoryOption(
  history: PortfolioHistory,
  live: LivePoint | null,
  events: ChartEventPoint[] | null = null,
): EChartsOption | null {
```
  and in the `series:` array, insert between the benchmark spread and the `livePt` spread:
```ts
      ...(events !== null && events.length > 0
        ? [
            {
              // Plain scatter in MUTED riding the value line — an annotation layer, not
              // a data hue, and the ripple stays reserved for the live ping (the
              // net-worth notes-diamond rule). Legend-toggleable, ON by default: no
              // legend.selected entry ships for it.
              type: 'scatter' as const,
              name: EVENTS_SERIES,
              color: MUTED,
              symbolSize: 9,
              itemStyle: { borderColor: INK, borderWidth: 1 },
              z: 11,
              data: events,
            },
          ]
        : []),
```
  (No new echarts registration: `ScatterChart` is already in `src/charts/echarts.ts` for the net-worth notes — the lazy chunk cannot grow.)

- [x] **Step 4: Run** — `npx vitest run src/components/portfolio/historyChartOptions.test.ts` → ALL PASS.

- [x] **Step 5: Wire /portfolio (and ONLY /portfolio).** In `src/pages/PortfolioPage.tsx`, extend the historyChartOptions import to
`import { buildEventMarkers, liveFromHoldings, portfolioHistoryOption } from '../components/portfolio/historyChartOptions'`
and replace the `performanceOption` memo with:

```ts
  const performanceOption = useMemo(() => {
    if (!history || !holdings) return null
    // Markers come from the ledgers this page ALREADY fetches in the same Promise.all —
    // Overview keeps the two-arg call and never starts fetching them (spec Decision log).
    const tickerById = new Map(securities.map((s) => [s.id, s.ticker]))
    const events = buildEventMarkers(history, transactions, dividends, tickerById)
    const base = portfolioHistoryOption(history, liveFromHoldings(holdings), events)
    // startValue indexes history.dates; the appended live category sits at the END, so
    // the indices are unshifted and the window always runs out to the ping.
    return base === null ? null : { ...base, dataZoom: timeZoom(history.dates, range.preset) }
  }, [history, holdings, securities, transactions, dividends, range])
```

- [x] **Step 6: Run** — `npx vitest run` → ALL PASS; `npx eslint src/pages/PortfolioPage.tsx src/components/portfolio/historyChartOptions.ts` → clean.

- [x] **Step 7: Commit** — `git add -A && git commit -m "feat(portfolio): buy/sell/dividend event markers with bar-snap + clustering"`

---

## Phase 4 — Deep links + Overview click-through (spec §2d)

### Task 8: `/spending?month=YYYY-MM-01` ↔ the drill-in pie

**Files:**
- Modify: `src/pages/SpendingPage.tsx`, `src/pages/SpendingPage.test.tsx`

- [x] **Step 1: Write the failing tests.** In `src/pages/SpendingPage.test.tsx`: extend the react-router import to `import { MemoryRouter, useLocation } from 'react-router-dom'`, add the probe (TaxesPage.test's idiom) above `renderPage`, and give `renderPage` an entry parameter:

```tsx
// The URL as the router holds it — the deep-link tests pin both directions of the
// drill↔URL sync.
function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>
}

function renderPage(entry = '/spending') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SpendingPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}
```

Append a new describe:

```tsx
describe('SpendingPage — ?month= deep link (2026-08-25 spec §2d)', () => {
  it('opens the month drill-in straight from the URL', async () => {
    renderPage('/spending?month=2026-06')
    expect(await screen.findByText('Spending breakdown — Jun 2026')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'All months' })).toBeTruthy()
  })

  it('ignores a month the matrix does not carry — no drill, no crash', async () => {
    renderPage('/spending?month=banana')
    expect(await screen.findByText(/Monthly spend vs net pay/)).toBeTruthy()
    expect(screen.queryByText(/Spending breakdown/)).toBeNull()
  })

  it('mirrors a bar-click drill into the URL and clears it on the way back', async () => {
    renderPage()
    await screen.findByText('Where Jul 2026 went')
    fireEvent.click(screen.getAllByTestId('echart')[0]) // the bars chart, dataIndex 0
    expect(await screen.findByText('Spending breakdown — Jun 2026')).toBeTruthy()
    // The fixture months carry no '-01' suffix; the contract is string equality with
    // matrix.months entries, which in production are the wizard's YYYY-MM-01 grammar.
    expect(screen.getByTestId('location').textContent).toBe('/spending?month=2026-06')
    fireEvent.click(screen.getByRole('button', { name: 'All months' }))
    await screen.findByText(/Monthly spend vs net pay/)
    expect(screen.getByTestId('location').textContent).toBe('/spending')
  })
})
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/pages/SpendingPage.test.tsx` → the three new tests FAIL (no URL sync); the pre-existing ones PASS.

- [x] **Step 3: Implement.** In `src/pages/SpendingPage.tsx`:
  1. Change the react-router import to `import { useNavigate, useSearchParams } from 'react-router-dom'`.
  2. Replace the `detailMonth` useState (and its comment) with the URL-derived pair, placed right after `const navigate = useNavigate()`:
```ts
  // Month drill-in: the ISO month whose breakdown pie replaces the bars chart — READ
  // from the URL (?month=YYYY-MM-01, the wizard's own param grammar) so a drill is
  // shareable and Overview can link straight into it (2026-08-25 spec §2d). Month
  // STRING, never an index: a refetch that reshapes the month list cannot mis-target,
  // and a month that vanished (or a garbled param) falls back to the all-months view
  // through the indexOf guard below.
  const [searchParams, setSearchParams] = useSearchParams()
  const detailMonth = searchParams.get('month')
  const setDetailMonth = (month: string | null) => {
    // replace, not push: a drill is a view state — Back should leave the page, not
    // unwind every pie the user peeked at.
    setSearchParams(
      (current) => {
        const copy = new URLSearchParams(current)
        if (month === null) copy.delete('month')
        else copy.set('month', month)
        return copy
      },
      { replace: true },
    )
  }
```
  3. Nothing else changes — `handleSpendChartClick`, the two `setDetailMonth(null)` buttons, and the `detailIndex` memo all keep their call shapes.

- [x] **Step 4: Run** — `npx vitest run src/pages/SpendingPage.test.tsx` → ALL PASS (including the pre-existing "follows the drilled month" test, now flowing through the URL).

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(spending): ?month= deep link <-> drill-in pie"`

### Task 9: `/taxes?year=YYYY` ↔ the jurisdiction pie

**Files:**
- Modify: `src/components/taxes/SummaryPanel.tsx`, `src/pages/TaxesPage.tsx` (comment only), `src/pages/TaxesPage.test.tsx`

- [x] **Step 1: Write the failing tests** — append to `src/pages/TaxesPage.test.tsx` (its `renderPage(entry)`, `trendCategories()` and `summaryFor()` helpers already exist):

```tsx
describe('?year= deep link (2026-08-25 spec §2d)', () => {
  it('opens the year pie straight from the URL', async () => {
    const taxed2023 = summaryFor(2023)
    taxed2023.federal = { ...taxed2023.federal, tax: '1000.00' }
    vi.mocked(fetchAllTaxSummaries).mockResolvedValue({ years: [taxed2023, summaryFor(2024)] })
    renderPage('/taxes?year=2023')
    expect(await screen.findByText('Tax breakdown — 2023')).toBeTruthy()
  })

  it('ignores a garbled or unknown year — the trend renders as usual', async () => {
    vi.mocked(fetchAllTaxSummaries).mockResolvedValue({
      years: [summaryFor(2023), summaryFor(2024)],
    })
    renderPage('/taxes?year=banana')
    await waitFor(() => expect(trendCategories()).toBe('2023,2024'))
    expect(screen.queryByText(/Tax breakdown —/)).toBeNull()
    cleanup()
    renderPage('/taxes?year=1999')
    await waitFor(() => expect(trendCategories()).toBe('2023,2024'))
    expect(screen.queryByText(/Tax breakdown —/)).toBeNull()
  })

  it('mirrors a trend-click drill into the URL, preserving sibling params, and clears it', async () => {
    const taxed2023 = summaryFor(2023)
    taxed2023.federal = { ...taxed2023.federal, tax: '1000.00' }
    vi.mocked(fetchAllTaxSummaries).mockResolvedValue({ years: [taxed2023, summaryFor(2024)] })
    renderPage('/taxes?whatif=VTI')
    await waitFor(() => expect(trendCategories()).toBe('2023,2024'))
    fireEvent.click(screen.getAllByTestId('echart')[1]) // the trend; the mock clicks 2023
    await screen.findByText('Tax breakdown — 2023')
    expect(screen.getByTestId('location').textContent).toBe('/taxes?whatif=VTI&year=2023')
    fireEvent.click(screen.getAllByTestId('echart')[1]) // any click in detail mode returns
    await waitFor(() => expect(trendCategories()).toBe('2023,2024'))
    expect(screen.getByTestId('location').textContent).toBe('/taxes?whatif=VTI')
  })
})
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/pages/TaxesPage.test.tsx` → the three new tests FAIL; everything pre-existing PASSES.

- [x] **Step 3: Implement.** In `src/components/taxes/SummaryPanel.tsx`:
  1. Add `import { useSearchParams } from 'react-router-dom'` (first import line — the panel always renders under TaxesPage's router).
  2. Replace the `detailYear` useState (and its comment) with:
```ts
  // Year drill-in: the year whose jurisdiction pie replaces the trend chart — READ from
  // the URL (?year=YYYY, 2026-08-25 spec §2d) so a drill is shareable. Stored as the
  // YEAR (never an index); a year the feed does not carry — including any garbled param,
  // which the integer fence below already nulls (TaxesPage's whatif-lot idiom) — falls
  // back to the all-years view through the detailSummary find.
  const [searchParams, setSearchParams] = useSearchParams()
  const yearParam = Number(searchParams.get('year'))
  const detailYear = Number.isInteger(yearParam) && yearParam > 0 ? yearParam : null
  const setDetailYear = (year: number | null) => {
    // replace, not push (SpendingPage's drill rule) — and a COPY, so the page's own
    // ?whatif= seeds ride along untouched.
    setSearchParams(
      (current) => {
        const copy = new URLSearchParams(current)
        if (year === null) copy.delete('year')
        else copy.set('year', String(year))
        return copy
      },
      { replace: true },
    )
  }
```
  3. `handleTrendClick`, the "All years" button and the `detailSummary`/`detailPie` memos keep their call shapes — no other edits.
  4. In `src/pages/TaxesPage.tsx`, update the deep-link seeds comment (lines ~43-45): change "…and the params are deliberately NOT cleared: this page owns no history writes, and a reload re-seeding the same leg is the honest reading of the URL the user is sitting on." to:
```ts
  // The deep links' seeds — /taxes?whatif=TICKER from the holdings drill-in, ?whatif-lot={id}
  // from the ESPP lots table. A plain read per render (it is a hook, not a fetch), and the
  // params are deliberately NOT cleared: this page itself owns no history writes (the
  // ?year drill param is SummaryPanel's, written replace-style beside these), and a
  // reload re-seeding the same leg is the honest reading of the URL the user is sitting on.
```

- [x] **Step 4: Run** — `npx vitest run src/pages/TaxesPage.test.tsx` → ALL PASS (the pre-existing drill tests now flow through the URL; the whatif test's "location stays put" pin still holds — no drill happens there).

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(taxes): ?year= deep link <-> jurisdiction pie"`

### Task 10: Overview chart click-through

**Files:**
- Modify: `src/pages/OverviewPage.tsx`, `src/components/overview/overviewChartOptions.ts`, `src/pages/OverviewPage.test.tsx`

- [x] **Step 1: Write the failing tests.** In `src/pages/OverviewPage.test.tsx`:
  1. Extend the react-router import to `import { MemoryRouter, useLocation } from 'react-router-dom'`.
  2. Extend the EChart mock so a marker click forwards `dataIndex: 0` (replace the mock's `default:` component):
```tsx
    default: ({
      option,
      onClick,
    }: {
      option: { xAxis?: { data?: unknown[] } }
      onClick?: (params: { dataIndex?: number }) => void
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'data-categories': (option.xAxis?.data ?? []).join(','),
        // A click stands in for a click on the chart's FIRST point (dataIndex 0) —
        // enough to walk the click-through door without a canvas (SpendingPage.test's
        // idiom). Charts given no handler stay inert, like the real thing.
        onClick: () => onClick?.({ dataIndex: 0 }),
      }),
```
  3. Add the probe + include it in `renderPage`:
```tsx
function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>
}

function renderPage() {
  return render(
    <MemoryRouter>
      <OverviewPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}
```
  4. Append a new describe:
```tsx
describe('OverviewPage click-through (2026-08-25 spec §2d)', () => {
  it('spending bars carry the clicked month into the /spending drill deep link', async () => {
    serve()
    renderPage()
    await screen.findByText('Net worth — Aug 2026')
    fireEvent.click(screen.getAllByTestId('echart')[2]) // bars: first of the 12-month slice
    expect(screen.getByTestId('location').textContent).toBe('/spending?month=2025-08-01')
  })

  it('maps the bar index through the trailing-12 slice offset', async () => {
    // 13 months on the wire, 12 drawn: dataIndex 0 is the SECOND month, not the first.
    serve({
      matrix: matrixOut({
        months: monthsFrom('2025-07-01', 13),
        totals: [...Array<string>(12).fill('5000.00'), '6000.00'],
      }),
    })
    renderPage()
    await screen.findByText('Net worth — Aug 2026')
    fireEvent.click(screen.getAllByTestId('echart')[2])
    expect(screen.getByTestId('location').textContent).toBe('/spending?month=2025-08-01')
  })

  it('performance goes to /portfolio, the spark to /net-worth', async () => {
    serve()
    renderPage()
    await screen.findByText('Net worth — Aug 2026')
    fireEvent.click(screen.getAllByTestId('echart')[1])
    expect(screen.getByTestId('location').textContent).toBe('/portfolio')
    cleanup()
    serve()
    renderPage()
    await screen.findByText('Net worth — Aug 2026')
    fireEvent.click(screen.getAllByTestId('echart')[0])
    expect(screen.getByTestId('location').textContent).toBe('/net-worth')
  })
})
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/pages/OverviewPage.test.tsx` → the new describe FAILS (no onClick handlers); everything else PASSES.

- [x] **Step 3: Name the slice length.** In `src/components/overview/overviewChartOptions.ts`, add above `recentSpendOption`:

```ts
/** The bars' trailing-window length — named so OverviewPage's click handler can map a
 * dataIndex back through the same slice (2026-08-25 spec §2d). */
export const RECENT_SPEND_MONTHS = 12
```

and change the signature's default to `months = RECENT_SPEND_MONTHS`.

- [x] **Step 4: Wire the page — minimal and localized** (siblings touch this file). In `src/pages/OverviewPage.tsx`:
  1. Change the react-router import to `import { NavLink, useNavigate } from 'react-router-dom'`.
  2. Extend the overviewChartOptions import with `RECENT_SPEND_MONTHS,` and the EChart import with the type: `import EChart from '../components/EChart'` plus `import type { EChartEventParams } from '../components/EChart'`.
  3. First line of the component body: `const navigate = useNavigate()`.
  4. Below the `bars` memo, add one handler:
```ts
  // 2026-08-25 spec §2d: each chart clicks through to the page that owns its numbers;
  // the bars carry the clicked month into /spending's ?month= drill deep link, mapped
  // back through the option's own trailing-12 slice.
  const openSpendingMonth = (params: EChartEventParams) => {
    if (!data || typeof params.dataIndex !== 'number') return
    const months = data.matrix.months
    const month = months[Math.max(0, months.length - RECENT_SPEND_MONTHS) + params.dataIndex]
    if (month) navigate(`/spending?month=${month}`)
  }
```
  5. Add the three onClick props (nothing else on those lines changes):
     - spark: `<EChart option={spark} height={220} onClick={() => navigate('/net-worth')} />`
     - performance: `<EChart option={perf} height={280} onClick={() => navigate('/portfolio')} />`
     - bars: `<EChart option={bars} height={240} onClick={openSpendingMonth} />`

- [x] **Step 5: Run** — `npx vitest run src/pages/OverviewPage.test.tsx` → ALL PASS.

- [x] **Step 6: Commit** — `git add -A && git commit -m "feat(overview): chart click-through to owning pages with ?month= carry"`

---

## Phase 5 — Legend + manual-zoom persistence (spec §2e)

### Task 11: SpendingPage — mirrored legend picks + shared zoom window

**Files:**
- Modify: `src/pages/SpendingPage.tsx`, `src/pages/SpendingPage.test.tsx`

- [x] **Step 1: Write the failing tests** — append to `src/pages/SpendingPage.test.tsx` (the Task 4 mock already exposes the attributes and stand-in events):

```tsx
describe('SpendingPage — legend + zoom persistence (2026-08-25 spec §2e)', () => {
  it('keeps legend toggles across an option rebuild — the budget-line reset bug dies', async () => {
    renderPage()
    await screen.findByText('Where Jul 2026 went')
    const bars = screen.getAllByTestId('echart')[0]
    // Before any toggle: only the shipped default rides legend.selected.
    expect(bars.getAttribute('data-legend-selected')).toBe(
      JSON.stringify({ 'Total budget': false }),
    )
    fireEvent.mouseEnter(bars) // stands in for legendselectchanged {'Net pay': false, '4% rule': true}
    // Rebuild the options with a fresh identity — the active chip re-press class of event.
    fireEvent.click(screen.getByRole('button', { name: '1Y' }))
    expect(
      JSON.parse(
        screen.getAllByTestId('echart')[0].getAttribute('data-legend-selected') ?? '{}',
      ),
    ).toEqual({ 'Total budget': false, 'Net pay': false, '4% rule': true })
  })

  it('mirrors a manual window into every sibling time chart and snaps back on a chip', async () => {
    renderPage()
    await screen.findByText('Where Jul 2026 went')
    fireEvent.mouseLeave(screen.getAllByTestId('echart')[0]) // datazoom {startValue:1, endValue:1}
    const zoomed = screen
      .getAllByTestId('echart')
      .filter((el) => (el.getAttribute('data-zoom') ?? 'null') !== 'null')
    // bars + savings rate + category trends share the window; the heatmap (whole by
    // design) and the flow sankey never zoom.
    expect(zoomed).toHaveLength(3)
    for (const el of zoomed) {
      const zoom = JSON.parse(el.getAttribute('data-zoom') ?? '{}') as {
        startValue?: number
        endValue?: number
      }
      expect(zoom.startValue).toBe(1)
      expect(zoom.endValue).toBe(1)
    }
    // Chips overwrite the shared state — fresh {preset}, no window (snap-back contract).
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    const snapped = JSON.parse(
      screen.getAllByTestId('echart')[0].getAttribute('data-zoom') ?? '{}',
    ) as { startValue?: number; endValue?: number }
    expect(snapped.startValue).toBe(0)
    expect(snapped.endValue).toBeUndefined()
  })
})
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/pages/SpendingPage.test.tsx` → the two new tests FAIL.

- [x] **Step 3: Implement.** In `src/pages/SpendingPage.tsx`:
  1. Swap the timeZoom imports:
```ts
import { rangeZoom } from '../charts/timeZoom'
import type { RangeState, ZoomWindow } from '../charts/timeZoom'
```
  (drop the `timeZoom` and `RangePreset` names — both become unused).
  2. Retype the range state and add the mirrors (replace the `range` useState line; its comment keeps the first sentence and gains the window clause):
```ts
  // The page's time window, applied to the three time charts together (bars, savings
  // rate, category trends — one month axis, one answer), PLUS any manual ctrl+wheel
  // window mirrored back from a chart's datazoom event (2026-08-25 spec §2e) — so
  // rebuilds and same-axis siblings keep the wander. Chips hand back a fresh {preset}
  // with no window: their snap-back contract, unchanged. The heatmap stays whole.
  const [range, setRange] = useState<RangeState>({ preset: 'all' })
  // Legend picks, mirrored from legendselectchanged and fed back via legend.selected —
  // a refetch/notMerge rebuild no longer resets toggles (the budget-line reset bug).
  const [legendSelected, setLegendSelected] = useState<Record<string, boolean>>({})
  const onLegendChange = (selected: Record<string, boolean>) => setLegendSelected(selected)
  const onZoomWindow = (nextWindow: ZoomWindow) =>
    setRange((current) => ({ preset: current.preset, window: nextWindow }))
```
  3. In `barsOption`: `dataZoom: rangeZoom(matrix.months, range),` — and the legend line becomes (keeping its comment, minus the now-false "notMerge resets legend picks" sentence):
```ts
      // 'Total budget' ships DESELECTED: it wears the same dashed-MUTED grammar as the
      // 4% line (one reference-line language), so both on at once would be ambiguous;
      // the legend chip is the summon. Mirrored picks spread OVER the default, so a
      // deliberate summon now survives option rebuilds (2026-08-25 spec §2e).
      legend: { top: 0, selected: { 'Total budget': false, ...legendSelected } },
```
  Add `legendSelected` to the memo's dep array: `[matrix, topIds, monthLabels, nameById, range, legendSelected]`.
  4. In `savingsOption`: `dataZoom: rangeZoom(matrix.months, range),` (comment stays; no legend on this chart).
  5. In `trendOption`: `dataZoom: rangeZoom(matrix.months, range),` and `legend: { top: 0, selected: legendSelected },`; deps gain `legendSelected`.
  6. Give the three EChart mounts the mirrors — bars:
```tsx
              <EChart
                option={barsOption}
                height={340}
                onClick={handleSpendChartClick}
                instanceRef={barsChartRef}
                onLegendChange={onLegendChange}
                onDataZoom={onZoomWindow}
              />
```
  savings: `{savingsOption && <EChart option={savingsOption} height={260} onDataZoom={onZoomWindow} />}` — trend: `<EChart option={trendOption} height={220} onLegendChange={onLegendChange} onDataZoom={onZoomWindow} />`.

- [x] **Step 4: Run** — `npx vitest run src/pages/SpendingPage.test.tsx` → ALL PASS; `npx eslint src/pages/SpendingPage.tsx` → clean.

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(spending): legend picks + manual zoom window survive rebuilds"`

### Task 12: NetWorthPage + PortfolioPage — the same wiring

Identical pattern to Task 11; those pages have no page-test files, so the behavior stands on Task 11's page-level pin, Task 2's EChart event tests and Task 3's `rangeZoom` tests — this task is wiring, verified by lint + the full suite staying green.

**Files:**
- Modify: `src/pages/NetWorthPage.tsx`, `src/pages/PortfolioPage.tsx`

- [ ] **Step 1: NetWorthPage.** In `src/pages/NetWorthPage.tsx`:
  1. Swap imports: `import { rangeZoom } from '../charts/timeZoom'` + `import type { RangeState, ZoomWindow } from '../charts/timeZoom'` (drop `timeZoom`, `RangePreset`).
  2. Retype + mirrors (replace the `range` useState; keep its comment's first two sentences, append the window clause as in Task 11):
```ts
  const [range, setRange] = useState<RangeState>({ preset: 'all' })
  // Mirrors of the charts' own events (2026-08-25 spec §2e): legend picks and a manual
  // ctrl+wheel window become page state, fed back through the memoized options, so a
  // granularity refetch or notMerge rebuild no longer resets them — and both charts
  // share one window, like they share the chips.
  const [legendSelected, setLegendSelected] = useState<Record<string, boolean>>({})
  const onLegendChange = (selected: Record<string, boolean>) => setLegendSelected(selected)
  const onZoomWindow = (nextWindow: ZoomWindow) =>
    setRange((current) => ({ preset: current.preset, window: nextWindow }))
```
  3. `stackedOption`: `dataZoom: rangeZoom(data.months, range),` and `legend: { top: 0, selected: legendSelected },`; deps `[data, range, legendSelected]`.
  4. `drillOption`: `dataZoom: rangeZoom(data.months, range),` and `legend: { top: 0, selected: legendSelected },`; deps `[data, drill, range, legendSelected]`.
  5. Mounts: `<EChart option={stackedOption} height={360} onLegendChange={onLegendChange} onDataZoom={onZoomWindow} />` and `<EChart option={drillOption} height={280} onLegendChange={onLegendChange} onDataZoom={onZoomWindow} />`.

- [ ] **Step 2: PortfolioPage.** In `src/pages/PortfolioPage.tsx`:
  1. Swap imports: `import { rangeZoom } from '../charts/timeZoom'` + `import type { RangeState, ZoomWindow } from '../charts/timeZoom'` (drop `timeZoom`, `RangePreset`).
  2. Retype + mirrors (replace the `range` useState; comment as in Task 11):
```ts
  const [range, setRange] = useState<RangeState>({ preset: 'all' })
  const [legendSelected, setLegendSelected] = useState<Record<string, boolean>>({})
  const onLegendChange = (selected: Record<string, boolean>) => setLegendSelected(selected)
  const onZoomWindow = (nextWindow: ZoomWindow) =>
    setRange((current) => ({ preset: current.preset, window: nextWindow }))
```
  3. In the `performanceOption` memo (as left by Task 7), replace the return with:
```ts
    return base === null
      ? null
      : {
          ...base,
          // The builder's legend is a plain {top: 0}, shared verbatim with OverviewPage
          // (which has no picks to persist) — the page layers its mirrors over it here.
          legend: { top: 0, selected: legendSelected },
          // startValue indexes history.dates; the appended live category sits at the
          // END, so the indices are unshifted and the window runs out to the ping.
          dataZoom: rangeZoom(history.dates, range),
        }
```
  deps: `[history, holdings, securities, transactions, dividends, range, legendSelected]`.
  4. Mount: `<EChart option={performanceOption} height={300} onLegendChange={onLegendChange} onDataZoom={onZoomWindow} />`.

- [ ] **Step 3: Verify** — `npx vitest run` → ALL PASS; `npx eslint src/pages/NetWorthPage.tsx src/pages/PortfolioPage.tsx` → clean; `npx tsc -b` → clean.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(charts): legend/zoom persistence on net-worth + portfolio pages"`

---

## Phase 6 — Export opt-ins (spec §2a) + zoom captions (spec §2f)

### Task 13: CSV builders A — spending, net-worth, portfolio performance

**Files:**
- Modify: `src/components/spending/spendingChartOptions.ts` (+ test), `src/components/networth/netWorthChartOptions.ts` (+ test), `src/components/portfolio/historyChartOptions.ts` (+ test)

- [ ] **Step 1: Write the failing tests.** Append to `src/components/spending/spendingChartOptions.test.ts` (extend the import to include `spendingCsv`):

```ts
describe('spendingCsv', () => {
  it('lays out month rows × top categories + Other + Total + Net pay, verbatim strings', () => {
    const matrix = {
      months: ['2026-06-01', '2026-07-01'],
      series: [
        { category_id: 1, values: ['2000.00', '2000.00'], budgets: [null, null] },
        { category_id: 2, values: ['150.00', null], budgets: [null, null] }, // folded
      ],
      totals: ['2150.00', '2000.00'],
      net_pay: ['6000.00', null],
    }
    expect(spendingCsv(matrix, [1], new Map([[1, 'Rent']]))).toEqual({
      headers: ['Month', 'Rent', 'Other', 'Total', 'Net pay'],
      rows: [
        ['2026-06-01', '2000.00', '150.00', '2150.00', '6000.00'],
        // null cells go EMPTY, never '0.00' — absent is not zero; Other re-sums the fold.
        ['2026-07-01', '2000.00', '0.00', '2000.00', ''],
      ],
    })
  })
})
```

Append to `src/components/networth/netWorthChartOptions.test.ts` (extend the import to include `netWorthCsv`):

```ts
describe('netWorthCsv', () => {
  it('lays out month rows × the seven group columns + net worth, verbatim strings', () => {
    const csv = netWorthCsv({
      months: ['2026-07-01', '2026-08-01'],
      group_totals: {
        cash: ['100.00', '110.00'], pre_tax: ['200.00', '210.00'],
        post_tax: ['300.00', '310.00'], taxable: ['400.00', '410.00'],
        equity: ['500.00', '510.00'], other: ['0.00', '0.00'],
        liability: ['-50.00', '-40.00'],
      },
      net_worth: ['1450.00', '1500.00'],
    })
    expect(csv.headers).toEqual([
      'Month', 'Cash', 'Pre-tax', 'Post-tax', 'Taxable', 'Equity', 'Other',
      'Liabilities', 'Net worth',
    ])
    expect(csv.rows).toEqual([
      ['2026-07-01', '100.00', '200.00', '300.00', '400.00', '500.00', '0.00', '-50.00', '1450.00'],
      ['2026-08-01', '110.00', '210.00', '310.00', '410.00', '510.00', '0.00', '-40.00', '1500.00'],
    ])
  })
})
```

Append to `src/components/portfolio/historyChartOptions.test.ts` (extend the import to include `portfolioHistoryCsv`):

```ts
describe('portfolioHistoryCsv', () => {
  it('lays out date rows × the four series, verbatim strings', () => {
    expect(portfolioHistoryCsv(history())).toEqual({
      headers: ['Date', 'Portfolio value', 'Cost basis', 'S&P 500 baseline', 'VOO (your contributions)'],
      rows: [
        ['2026-07-27', '700000.00', '395000.00', '96000.00', '96000.00'],
        ['2026-08-03', '710000.50', '399542.36', '97000.00', '97250.00'],
        ['2026-08-10', '718422.07', '400243.74', '98636.70', '99001.13'],
      ],
    })
  })

  it('empties the VOO cells on a degraded or stale-payload benchmark', () => {
    const rows = portfolioHistoryCsv(history({ benchmark: [null, null, null] })).rows
    expect(rows.map((r) => r[4])).toEqual(['', '', ''])
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/spending/spendingChartOptions.test.ts src/components/networth/netWorthChartOptions.test.ts src/components/portfolio/historyChartOptions.test.ts` → the three new describes FAIL (missing exports).

- [ ] **Step 3: Implement.** Append to `src/components/spending/spendingChartOptions.ts` (add `import type { ExportTable } from '../../utils/download'` and `import type { SpendingMatrix } from '../../types/api'` up top):

```ts
/**
 * The stacked chart as a table (2026-08-25 spec §2a): month rows × the SAME top-N fold
 * the bars draw, plus Other, the server's Total and Net pay — the export echoes the
 * displayed chart, verbatim server strings. Null cells go empty, never '0.00': absent
 * is not zero.
 */
export function spendingCsv(
  matrix: Pick<SpendingMatrix, 'months' | 'series' | 'totals' | 'net_pay'>,
  topIds: number[],
  nameById: Map<number, string>,
): ExportTable {
  const topSet = new Set(topIds)
  const valuesById = new Map(matrix.series.map((s) => [s.category_id, s.values]))
  return {
    headers: [
      'Month',
      ...topIds.map((id) => nameById.get(id) ?? String(id)),
      'Other',
      'Total',
      'Net pay',
    ],
    rows: matrix.months.map((month, i) => [
      month,
      ...topIds.map((id) => valuesById.get(id)?.[i] ?? ''),
      matrix.series
        .reduce(
          (acc, s) => (topSet.has(s.category_id) ? acc : acc + Number(s.values[i] ?? 0)),
          0,
        )
        .toFixed(2),
      matrix.totals[i],
      matrix.net_pay[i] ?? '',
    ]),
  }
}
```

Append to `src/components/networth/netWorthChartOptions.ts` (add `import { GROUP_LABELS, GROUP_ORDER } from '../../charts/theme'` and `import type { NetWorthTimeseries } from '../../types/api'` and `import type { ExportTable } from '../../utils/download'`):

```ts
/** The stacked chart as a table (2026-08-25 spec §2a): month rows × the seven fixed
 * groups + net worth, verbatim server strings in the palette's own group order. */
export function netWorthCsv(
  ts: Pick<NetWorthTimeseries, 'months' | 'group_totals' | 'net_worth'>,
): ExportTable {
  return {
    headers: ['Month', ...GROUP_ORDER.map((g) => GROUP_LABELS[g]), 'Net worth'],
    rows: ts.months.map((month, i) => [
      month,
      ...GROUP_ORDER.map((g) => ts.group_totals[g][i] ?? ''),
      ts.net_worth[i],
    ]),
  }
}
```

Append to `src/components/portfolio/historyChartOptions.ts` (add `import type { ExportTable } from '../../utils/download'`):

```ts
/** The performance chart as a table (2026-08-25 spec §2a): date rows × the four series,
 * verbatim server strings; degraded/stale benchmark cells go empty. The live ping stays
 * out — it is a quote, not a history row. */
export function portfolioHistoryCsv(history: PortfolioHistory): ExportTable {
  const benchmark = history.benchmark ?? []
  return {
    headers: [
      'Date',
      'Portfolio value',
      'Cost basis',
      'S&P 500 baseline',
      'VOO (your contributions)',
    ],
    rows: history.dates.map((date, i) => [
      date,
      history.market_value[i],
      history.cost_basis[i],
      history.sp500[i],
      benchmark[i] ?? '',
    ]),
  }
}
```

- [ ] **Step 4: Run** — the three test files again → ALL PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(charts): CSV builders — spending, net-worth, portfolio performance"`

### Task 14: CSV builders B — dividends (shared sums), tax trend, projection

**Files:**
- Modify: `src/components/portfolio/dividendChartOptions.ts` (+ test), `src/components/taxes/taxChartOptions.ts` (+ test), `src/components/projection/projectionChartOptions.ts` (+ test)

- [ ] **Step 1: Write the failing tests.** Append to `src/components/portfolio/dividendChartOptions.test.ts` (extend the import to include `monthlyIncomeCsv, monthlyIncomeSums`; the file's `dividend(payDate, amount)` helper and `TODAY` constant already exist):

```ts
describe('monthlyIncomeSums / monthlyIncomeCsv', () => {
  it('mirrors the chart: the zero-filled trailing window, rounded to cents', () => {
    const rows = monthlyIncomeSums(
      [dividend('2026-08-03', '5.005'), dividend('2026-08-20', '5.005')],
      TODAY,
    )
    expect(rows).not.toBeNull()
    expect(rows).toHaveLength(24)
    expect(rows![23]).toEqual({ month: '2026-08-01', amount: 10.01 })
    expect(rows![0].amount).toBe(0) // quiet months read as quiet, not absent
  })

  it('is null with nothing in the window (the same guard the chart nulls on)', () => {
    expect(monthlyIncomeSums([], TODAY)).toBeNull()
    expect(monthlyIncomeSums([dividend('2023-01-15', '99.00')], TODAY)).toBeNull()
  })

  it('CSVs as month/amount rows with 2dp strings', () => {
    const csv = monthlyIncomeCsv([dividend('2026-08-03', '5.00')], TODAY)
    expect(csv.headers).toEqual(['Month', 'Dividends'])
    expect(csv.rows).toHaveLength(24)
    expect(csv.rows[23]).toEqual(['2026-08-01', '5.00'])
    expect(csv.rows[0]).toEqual([csv.rows[0][0], '0.00'])
  })
})
```

(`TODAY` and `dividend(payDate, amount)` are that file's existing fixtures — reuse them, never add seconds.) Append to `src/components/taxes/taxChartOptions.test.ts` (extend the taxChartOptions import to include `taxTrendCsv`):

```ts
describe('taxTrendCsv', () => {
  it('lays out year × jurisdiction + total, ascending, verbatim server strings', () => {
    const y24 = summaryFixture(2024)
    const y26 = summaryFixture(2026)
    const csv = taxTrendCsv([y26, y24]) // deliberately unordered on the way in
    expect(csv.headers).toEqual([
      'Year', 'Federal', 'State', 'Medicare', 'Soc. Sec.', 'SDI', 'Cap. gains', 'Total tax',
    ])
    expect(csv.rows.map((r) => r[0])).toEqual([2024, 2026])
    expect(csv.rows[0]).toEqual([
      2024, y24.federal.tax, y24.state.tax, y24.medicare.tax, y24.social_security.tax,
      y24.disability.tax, y24.capital_gains.tax, y24.totals.total_tax,
    ])
  })
})
```

Append to `src/components/projection/projectionChartOptions.test.ts` (extend the import to include `projectionCsv`):

```ts
describe('projectionCsv', () => {
  const BASE = {
    months: ['2026-09-01', '2026-10-01'],
    projected: ['1000.00', '1100.00'],
    coast: ['1000.00', '1005.00'],
    bands: null,
  }

  it('is month/projected/coast without the fan', () => {
    expect(projectionCsv(BASE)).toEqual({
      headers: ['Month', 'Projected', 'Growth only'],
      rows: [
        ['2026-09-01', '1000.00', '1000.00'],
        ['2026-10-01', '1100.00', '1005.00'],
      ],
    })
  })

  it('appends p10/p50/p90 when the fan is on', () => {
    const csv = projectionCsv({
      ...BASE,
      bands: {
        p10: ['900.00', '950.00'], p25: ['950.00', '990.00'], p50: ['1000.00', '1080.00'],
        p75: ['1050.00', '1180.00'], p90: ['1200.00', '1300.00'],
      },
    })
    expect(csv.headers).toEqual(['Month', 'Projected', 'Growth only', 'p10', 'p50', 'p90'])
    expect(csv.rows[1]).toEqual(['2026-10-01', '1100.00', '1005.00', '950.00', '1080.00', '1300.00'])
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/portfolio/dividendChartOptions.test.ts src/components/taxes/taxChartOptions.test.ts src/components/projection/projectionChartOptions.test.ts` → the new describes FAIL; every pre-existing test PASSES.

- [ ] **Step 3: Implement.** In `src/components/portfolio/dividendChartOptions.ts` (add `import type { ExportTable } from '../../utils/download'`): insert above `monthlyIncomeOption`:

```ts
/** Sums of `amount` by pay-date month over the trailing window, zero-filled and rounded
 * to cents; null with no rows in the window. ONE computation shared by the chart and its
 * CSV export (2026-08-25 spec §2a) so the two can never disagree. `todayIso` injectable
 * for tests. */
export function monthlyIncomeSums(
  dividends: DividendOut[],
  todayIso: string,
): { month: string; amount: number }[] | null {
  const end = `${todayIso.slice(0, 7)}-01`
  const start = addMonths(end, -(INCOME_WINDOW_MONTHS - 1))
  const sums = new Map<string, number>()
  for (const d of dividends) {
    const month = `${d.pay_date.slice(0, 7)}-01`
    if (month < start || month > end) continue
    sums.set(month, (sums.get(month) ?? 0) + Number(d.amount))
  }
  if (sums.size === 0) return null
  const rows: { month: string; amount: number }[] = []
  for (let m = start; m <= end; m = addMonths(m, 1)) {
    rows.push({ month: m, amount: Math.round((sums.get(m) ?? 0) * 100) / 100 })
  }
  return rows
}

/** Month/amount rows for the ⤓ menu — empty when the chart itself would be absent. */
export function monthlyIncomeCsv(dividends: DividendOut[], todayIso: string): ExportTable {
  const rows = monthlyIncomeSums(dividends, todayIso) ?? []
  return { headers: ['Month', 'Dividends'], rows: rows.map((r) => [r.month, r.amount.toFixed(2)]) }
}
```

then rewrite `monthlyIncomeOption`'s body on top of it (the doc comment keeps its first sentence and gains "computation shared with monthlyIncomeCsv"):

```ts
export function monthlyIncomeOption(
  dividends: DividendOut[],
  todayIso: string,
): EChartsOption | null {
  const rows = monthlyIncomeSums(dividends, todayIso)
  if (rows === null) return null
  return {
    grid: { left: 70, right: 16, top: 16, bottom: 28 },
    xAxis: { type: 'category', data: rows.map((r) => formatMonth(r.month)) },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (v: number) => formatCurrencyCompact(v) },
    },
    tooltip: { trigger: 'axis', valueFormatter: (v) => formatCurrency(v as number) },
    series: [
      {
        type: 'bar',
        name: 'Dividends',
        barMaxWidth: 22,
        color: PALETTE[0],
        itemStyle: { borderColor: SURFACE, borderWidth: 1 },
        data: rows.map((r) => r.amount),
      },
    ],
  }
}
```

In `src/components/taxes/taxChartOptions.ts` (add `import type { ExportTable } from '../../utils/download'`), append:

```ts
/** The trend chart as a table (2026-08-25 spec §2a): year rows × TAX_LABELS order plus
 * the server's own total_tax, ascending like the chart's axis, verbatim strings. */
export function taxTrendCsv(years: TaxSummaryOut[]): ExportTable {
  const ordered = [...years].sort((a, b) => a.year - b.year)
  return {
    headers: ['Year', ...TAX_LABELS, 'Total tax'],
    rows: ordered.map((y) => [
      y.year, y.federal.tax, y.state.tax, y.medicare.tax, y.social_security.tax,
      y.disability.tax, y.capital_gains.tax, y.totals.total_tax,
    ]),
  }
}
```

In `src/components/projection/projectionChartOptions.ts` (add `import type { ExportTable } from '../../utils/download'`), append:

```ts
/** The projection as a table (2026-08-25 spec §2a): month rows × projected/coast, plus
 * p10/p50/p90 when the Monte Carlo fan is on — verbatim server strings. */
export function projectionCsv(
  data: Pick<ProjectionOut, 'months' | 'projected' | 'coast' | 'bands'>,
): ExportTable {
  const bands = data.bands ?? null
  return {
    headers: ['Month', 'Projected', 'Growth only', ...(bands ? ['p10', 'p50', 'p90'] : [])],
    rows: data.months.map((month, i) => [
      month,
      data.projected[i],
      data.coast[i],
      ...(bands ? [bands.p10?.[i] ?? '', bands.p50?.[i] ?? '', bands.p90?.[i] ?? ''] : []),
    ]),
  }
}
```

- [ ] **Step 4: Run** — the three test files again → ALL PASS (the pre-existing `monthlyIncomeOption` tests pin the refactor's parity).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(charts): CSV builders — dividends (shared sums), tax trend, projection"`

### Task 15: Opt the six charts into the ⤓ menu

**Files:**
- Modify: `src/pages/SpendingPage.tsx` (+ test), `src/pages/NetWorthPage.tsx`, `src/pages/PortfolioPage.tsx`, `src/components/portfolio/DividendsPanel.tsx`, `src/components/taxes/SummaryPanel.tsx`, `src/pages/ProjectionPage.tsx`

The six names, fixed here and used verbatim: `spending`, `net-worth`, `portfolio-performance`, `dividends`, `tax-trend`, `projection`. Each `csv` closure needs its payload narrowed non-null, so four render branches gain an `&& <payload>` guard — the guard is always already true when the option is non-null.

- [ ] **Step 1: Write the failing page pin** — append to the export describe-less end of `src/pages/SpendingPage.test.tsx` (inside the `tooltip fixes` describe or its own):

```tsx
it('opts the bars chart into the export menu as "spending"', async () => {
  renderPage()
  await screen.findByText('Where Jul 2026 went')
  expect(screen.getAllByTestId('echart')[0].getAttribute('data-export-name')).toBe('spending')
})
```

Run: `npx vitest run src/pages/SpendingPage.test.tsx` → the new test FAILS (attr empty).

- [ ] **Step 2: Wire all six.**
  1. `src/pages/SpendingPage.tsx` — import `spendingCsv` (extend the spendingChartOptions import); change the bars branch condition `) : barsOption ? (` to `) : barsOption && matrix ? (` and add to the bars `<EChart …>`:
```tsx
                exportConfig={{ name: 'spending', csv: () => spendingCsv(matrix, topIds, nameById) }}
```
  2. `src/pages/NetWorthPage.tsx` — import `netWorthCsv` (extend the netWorthChartOptions import); change `{stackedOption ? (` to `{stackedOption && data ? (` and the mount to:
```tsx
            <EChart
              option={stackedOption}
              height={360}
              onLegendChange={onLegendChange}
              onDataZoom={onZoomWindow}
              exportConfig={{ name: 'net-worth', csv: () => netWorthCsv(data) }}
            />
```
  3. `src/pages/PortfolioPage.tsx` — import `portfolioHistoryCsv` (extend the historyChartOptions import); change `{performanceOption ? (` to `{performanceOption && history ? (` and add to the mount:
```tsx
                  exportConfig={{
                    name: 'portfolio-performance',
                    csv: () => portfolioHistoryCsv(history),
                  }}
```
  4. `src/components/portfolio/DividendsPanel.tsx` — extend the dividendChartOptions import with `monthlyIncomeCsv,` and the mount becomes:
```tsx
          {chart && (
            <EChart
              option={chart}
              height={220}
              exportConfig={{ name: 'dividends', csv: () => monthlyIncomeCsv(dividends, todayIso()) }}
            />
          )}
```
  5. `src/components/taxes/SummaryPanel.tsx` — extend the taxChartOptions import with `taxTrendCsv,`; change the trend branch `) : trend ? (` to `) : trend && years ? (` and the mount to:
```tsx
            <EChart
              option={trend}
              height={320}
              onClick={handleTrendClick}
              exportConfig={{ name: 'tax-trend', csv: () => taxTrendCsv(years) }}
            />
```
  6. `src/pages/ProjectionPage.tsx` — import `projectionCsv` (extend the projectionChartOptions import); the investable-balance mount becomes:
```tsx
                <EChart
                  option={chart}
                  height={340}
                  exportConfig={{ name: 'projection', csv: () => projectionCsv(data) }}
                />
```
  (only the six spec'd charts opt in — pies, heatmap, sankeys, sparks and the drill/trend siblings deliberately stay menu-less; others may opt in later.)

- [ ] **Step 3: Run** — `npx vitest run` → ALL PASS (page tests mock EChart and ignore the new prop; the SpendingPage pin now passes); `npx tsc -b` → clean.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(charts): opt six charts into the export menu with real CSVs"`

### Task 16: Zoom captions on every inside-zoom card

**Files:**
- Modify: `src/pages/SpendingPage.tsx` (+ test), `src/pages/NetWorthPage.tsx`, `src/pages/PortfolioPage.tsx`, `src/pages/ProjectionPage.tsx`, `src/components/portfolio/HoldingDetailPanel.tsx`

- [ ] **Step 1: Write the failing page pin** — append to `src/pages/SpendingPage.test.tsx`:

```tsx
it('captions every inside-zoom chart — bars, savings rate, trends — and nothing else', async () => {
  renderPage()
  await screen.findByText('Where Jul 2026 went')
  expect(screen.getAllByText('ctrl+scroll to zoom · drag to pan')).toHaveLength(3)
})
```

Run: `npx vitest run src/pages/SpendingPage.test.tsx` → FAIL (0 found).

- [ ] **Step 2: Place the caption under each of the nine inside-zoom mounts** — `import ChartZoomHint from '../components/ChartZoomHint'` (or `'../ChartZoomHint'` from `src/components/portfolio/`) in each file, then add `<ChartZoomHint />` directly AFTER the `<EChart …/>` element. Where a mount sits alone in a JSX expression (`{cond && <EChart …/>}` or a ternary branch), wrap the pair in a fragment: `{cond && (<><EChart …/><ChartZoomHint /></>)}`.
  1. `SpendingPage.tsx`: the bars mount (non-drilled branch only — the pie has no zoom), the savings mount, the trend mount.
  2. `NetWorthPage.tsx`: the stacked mount, the drill mount.
  3. `PortfolioPage.tsx`: the performance mount (before the S&P-baseline `<p className="hint">`).
  4. `ProjectionPage.tsx`: both chart mounts (the trend card's caption sits before its existing `drill-hint` paragraph; the investable card's before its own).
  5. `HoldingDetailPanel.tsx`: the price-chart mount (inside its `loading-dim` div).

  The heatmap, pies, sankeys, dividends bars and the Overview charts register no inside zoom — no caption (the caption would promise a gesture those charts refuse).

- [ ] **Step 3: Run** — `npx vitest run` → ALL PASS (the caption text collides with no existing assertion — it is new wording; the SpendingPage count pin now passes: bars + savings + trends).

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(charts): zoom-gesture caption on every inside-zoom card"`

---

## Phase 7 — Verification

### Task 17: Full verification (STOP here — the orchestrator merges)

**Files:** none

- [ ] **Step 1: Full frontend suite** — `npx vitest run` → ALL PASS (record the count; the pre-batch baseline was 791).
- [ ] **Step 2: Types** — `npx tsc -b` → clean, no output.
- [ ] **Step 3: Lint** — `npx eslint .` → clean.
- [ ] **Step 4: Commit anything the verification steps touched** — `git add -A && git commit -m "chore(charts): verification pass"` (skip if `git status --porcelain` is already empty), then `git status --porcelain` → EMPTY.
- [ ] **Step 5: STOP.** Do not merge, do not push, do not delete anything — the orchestrator reviews and merges this branch (and reconciles the `EChart.tsx`/`OverviewPage.tsx` overlap with the polish-batch sibling). Leave a summary listing: the test count; the three additive `EChart` props (`exportConfig`, `onLegendChange`, `onDataZoom` — appended, container div untouched, per the cross-plan note); the six export names (`spending`, `net-worth`, `portfolio-performance`, `dividends`, `tax-trend`, `projection`); the deliberate behavior decisions worth a reviewer's eye (spending bars tooltip drops padded-null dash rows like every full formatter; events off the axis ends and splits are skipped; a mixed same-bar cluster wears the diamond; drill URL updates are replace-style); and that no new echarts modules were registered (chunk limit untouched).
