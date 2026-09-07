# ESPP visuals — Lane 2 (position strip, lots totals, chain meter) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The non-chart half of `docs/superpowers/specs/2026-09-07-espp-visuals-design.md`: the five-tile position strip that replaces the lone `$25k` tile (§2, §4.1–4.2), the lots table's totals rows (§4.3), and the two-bar `$25k` chain meter with four `StatTile`s replacing the gauge and the hand-rolled tiles inside the modeler card (§7). No ECharts on this lane.

**Architecture:** Two new components in `src/components/espp/` — `PositionStrip` (five `StatTile`s fed by two feeds, ghosting the slots of whichever feed has not answered) and `LimitChainMeter` (HTML meter rows in the pace meter's grammar, both rows on one shared dollar scale) — with their stylesheet `espp.css`. `PageSkeleton` exports its `GhostTile`. `EsppPage.tsx` mounts the strip where the lone tile was, adds a `<tfoot>` to the lots table, and swaps the modeler card's gauge and tiles. Every figure is the server's (`totals.*`, the modeler totals); nothing is summed on the client.

**Tech Stack:** React 19, TypeScript 5.9, vitest 3 + Testing Library, CSS custom properties from `index.css`.

**Worktree / commands:** `C:\Users\edyli\personal-finance-dashboard\.worktrees\espp-2` on branch `espp-visuals-2` (created; `node_modules` is a junction to the main checkout's). From the worktree root: `npx vitest run <file>`, `npx tsc -b`, `npx eslint <files>`. Local commits only. Read first: `src/pages/EsppPage.tsx` (the whole file — 1467 lines, the strip block sits at the end), `src/pages/EsppPage.test.tsx` lines 1–345 (fixtures, helpers, the frame tests), `src/components/StatTile.tsx`, `src/components/PageSkeleton.tsx`, `src/components/paycheck/PacePanel.tsx` + `pace.css` (the meter grammar), `src/components/skeletonMetrics.ts`, `src/types/api.ts` (the `Espp*` types incl. the new optional fields).

**Rules for every task**
- Snippets carry only the comments that encode a rule; match each file's comment density and voice when you write the real thing.
- Every figure rendered is a server string through `formatCurrency` / `formatPct` / `formatShares`. No arithmetic on server figures except a display-only pixel width (`Number(x) / scale`).
- Plan 3 (the chart cards) edits `EsppPage.tsx` in a different region (a `card-grid` under the strip) and adds `src/pages/EsppPage.charts.test.tsx`; this lane must not add chart imports or a card-grid, and must not touch `src/charts/`.
- `.is-highlighted` on a lots row is Plan 3's; this lane does not add it.

---

## File structure

| File | Responsibility |
|---|---|
| `src/components/PageSkeleton.tsx` (modify) | export `GhostTile` |
| `src/components/espp/espp.css` (new) | strip tweaks, totals rows, the chain meter |
| `src/components/espp/PositionStrip.tsx` + `.test.tsx` (new) | the five tiles, per-feed ghosting, the dirty note |
| `src/components/espp/LimitChainMeter.tsx` + `.test.tsx` (new) | two meter rows, legend, capped sentences |
| `src/components/skeletonMetrics.ts` + `.test.ts` (modify) | `esppLots` grows one table row |
| `src/pages/EsppPage.tsx` (modify) | mount the strip; `<tfoot>`; meter + tiles in the modeler card; drop the gauge |
| `src/pages/EsppPage.css` (modify) | delete the `.gauge*` rules |
| `src/pages/EsppPage.test.tsx` (modify) | fixtures gain `totals` / modeler totals; strip, totals row and meter tests |

---

### Task 1: Export `GhostTile`

**Files:** Modify `src/components/PageSkeleton.tsx:53` · Test `src/components/PageSkeleton.test.tsx`

- [ ] **1 Write the failing test** — append inside the file's outer `describe`:

```tsx
  it('exports the one ghost tile so a page can ghost a single slot of a mixed row', () => {
    render(<GhostTile />)
    const tile = document.querySelector('.stat-tile.skeleton-tile')
    expect(tile).not.toBeNull()
    expect(tile?.querySelectorAll('.skeleton').length).toBe(3) // label, value, delta
  })
```

and add `GhostTile` to the file's `import … from './PageSkeleton'` line.

- [ ] **2 Fail:** `npx vitest run src/components/PageSkeleton.test.tsx` → `GhostTile` is not exported (TypeScript/runtime error).
- [ ] **3 Implement** — in `PageSkeleton.tsx`, change `function GhostTile() {` to `export function GhostTile() {` and extend its comment: *"Exported (2026-09-07): the ESPP strip paints four tiles from one feed and one from another, so it ghosts the slots of whichever feed is still in flight with this very tile."*
- [ ] **4 Pass:** `npx vitest run src/components/PageSkeleton.test.tsx`.
- [ ] **5 Commit:** `git add src/components/PageSkeleton.tsx src/components/PageSkeleton.test.tsx && git commit -m "feat(skeleton): export GhostTile for rows that ghost per feed"`

---

### Task 2: `PositionStrip`

**Files:** Create `src/components/espp/espp.css`, `src/components/espp/PositionStrip.tsx`, `src/components/espp/PositionStrip.test.tsx`

- [ ] **1 Write the failing tests** — `src/components/espp/PositionStrip.test.tsx`:

```tsx
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { EsppLotsResponse, EsppModelerOut } from '../../types/api'
import PositionStrip, { STRIP_LABEL } from './PositionStrip'

afterEach(cleanup)

// The page test's own fixture figures (EsppPage.test.tsx): two held lots, two sold.
const lots: EsppLotsResponse = {
  espp_ticker: 'NVDA',
  current_price: '171.3100',
  quoted_at: '2026-08-15T20:00:00Z',
  lots: [],
  totals: {
    held: {
      lots: 2, shares: '501.0000', cost_basis: '20657.56', fmv_value: '62546.50',
      market_value: '85826.31', gain_amount: '65168.75', gain_pct: '3.154717',
      bargain_element: '41888.94', lookback_component: '38243.49', discount_component: '3645.45',
      appreciation: '23279.81', avg_paid: '41.23265',
    },
    sold: { lots: 2, shares: '529.0000', cost_basis: '21812.08', proceeds: '60740.00', gain_amount: '38927.92' },
  },
}
const unpriced: EsppLotsResponse = {
  ...lots,
  current_price: null,
  quoted_at: null,
  totals: {
    held: { ...lots.totals!.held, market_value: null, gain_amount: null, gain_pct: null, appreciation: null },
    sold: lots.totals!.sold,
  },
}
const modeler = {
  year: 2024,
  totals: { total_25k_value: '18917.13', out_of_pocket_cost: '16130.72', fmv_of_shares: '19200.00', remaining_25k: '6082.87' },
} as unknown as EsppModelerOut

const tiles = () => document.querySelectorAll('.kpi-row .stat-tile')
const ghosts = () => document.querySelectorAll('.kpi-row .stat-tile.skeleton-tile')

describe('PositionStrip', () => {
  it('ghosts the whole five-tile row while neither feed has answered', () => {
    render(<PositionStrip lots={null} lotsBusy modeler={null} modelerBusy modelerDirty={false} />)
    expect(screen.getByRole('status').textContent).toBe(STRIP_LABEL)
    expect(ghosts().length).toBe(5)
    expect(document.querySelector('.kpi-row-lone')).toBeNull()
  })

  it('paints the four lot tiles and ghosts the $25k slot until the modeler lands', () => {
    render(<PositionStrip lots={lots} lotsBusy={false} modeler={null} modelerBusy modelerDirty={false} />)
    expect(tiles().length).toBe(5)
    expect(ghosts().length).toBe(1)
    expect(screen.getByText('Market value').closest('.stat-tile')?.textContent).toContain('$85,826.31')
    expect(screen.getByText('Cost basis').closest('.stat-tile')?.textContent).toContain('$20,657.56')
    const gain = screen.getByText('Unrealized gain').closest('.stat-tile') as HTMLElement
    expect(gain.textContent).toContain('$65,168.75')
    expect(gain.textContent).toContain('+315.5%')
    expect(gain.querySelector('.stat-delta')?.className).toContain('stat-delta-positive')
    const shares = screen.getByText('Shares held').closest('.stat-tile') as HTMLElement
    expect(shares.textContent).toContain('501')
    expect(shares.textContent).toContain('2 lots')
  })

  it('paints the $25k tile and ghosts the four lot slots until the lots land', () => {
    render(<PositionStrip lots={null} lotsBusy modeler={modeler} modelerBusy={false} modelerDirty={false} />)
    expect(ghosts().length).toBe(4)
    const tile = screen.getByText('$25k limit used — 2024').closest('.stat-tile') as HTMLElement
    expect(tile.textContent).toContain('$18,917.13')
    expect(tile.textContent).toContain('$6,082.87 left')
  })

  it('treats a lots payload without totals (a pre-batch snapshot) as not loaded yet', () => {
    render(<PositionStrip lots={{ ...lots, totals: undefined }} lotsBusy modeler={modeler} modelerBusy={false} modelerDirty={false} />)
    expect(ghosts().length).toBe(4)
  })

  it('says "no live quote" instead of a zero when the position is unpriced', () => {
    render(<PositionStrip lots={unpriced} lotsBusy={false} modeler={modeler} modelerBusy={false} modelerDirty={false} />)
    const value = screen.getByText('Market value').closest('.stat-tile') as HTMLElement
    expect(value.querySelector('.stat-value')?.textContent).toBe('—')
    expect(value.textContent).toContain('no live quote')
    const gain = screen.getByText('Unrealized gain').closest('.stat-tile') as HTMLElement
    expect(gain.querySelector('.stat-value')?.textContent).toBe('—')
    expect(gain.querySelector('.stat-delta')?.className).toContain('stat-delta-neutral')
    // Cost and shares never need a quote.
    expect(screen.getByText('Cost basis').closest('.stat-tile')?.textContent).toContain('$20,657.56')
  })

  it('names the missing ticker when there is none', () => {
    render(<PositionStrip lots={{ ...unpriced, espp_ticker: null }} lotsBusy={false} modeler={modeler} modelerBusy={false} modelerDirty={false} />)
    expect(screen.getByText('Market value').closest('.stat-tile')?.textContent).toContain('no ESPP ticker configured')
  })

  it('renders nothing when both feeds failed with nothing to show — the banner speaks', () => {
    const { container } = render(<PositionStrip lots={null} lotsBusy={false} modeler={null} modelerBusy={false} modelerDirty={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('dims the row while a feed revalidates and carries the modeler dirty note', () => {
    render(<PositionStrip lots={lots} lotsBusy modeler={modeler} modelerBusy={false} modelerDirty />)
    expect(document.querySelector('.loading-dim.is-loading')).not.toBeNull()
    expect(screen.getByText(/Unsaved period edits below/).className).toBe('hint')
  })
})
```

- [ ] **2 Fail:** `npx vitest run src/components/espp/PositionStrip.test.tsx` → cannot resolve `./PositionStrip`.
- [ ] **3 Create `src/components/espp/espp.css`:**

```css
/* ESPP components' own sheet (portfolio.css's posture): the strip, the lots totals rows and
   the $25k chain meter travel with src/components/espp/*, never with the page stylesheet. */

/* A totals row reads as a footer, not as one more lot. */
.espp-page tfoot .espp-totals td {
  border-top: 1px solid var(--border);
  font-weight: 600;
  color: var(--text);
}

/* ── $25k chain meter (2026-09-07 spec §7): the pace meter grammar, two rows on ONE dollar
   scale, so the limit (shares at the subscription price) and the cash (at the discounted
   price) can be read against each other. ───────────────────────────────────────────── */

.chain-meter {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin: 0.25rem 0 1rem;
}

.chain-row {
  display: grid;
  grid-template-columns: minmax(170px, 260px) 1fr minmax(240px, auto);
  align-items: center;
  gap: 0.75rem;
}

.chain-name {
  font-size: 0.85rem;
  color: var(--text);
}

.chain-bar {
  position: relative;
  height: 14px;
}

/* Row 1's track spans $25,000 on the shared scale — the full row at $25k, shorter when
   contributions push the scale past it. */
.chain-track {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2);
}

/* The 2px gap between segments is the dataviz surface gap: neighbours read distinct because
   of the gap, not a stroke. */
.chain-segments {
  position: absolute;
  inset: 0;
  display: flex;
  gap: 2px;
}

.chain-seg {
  height: 100%;
  border-radius: 3px;
}

/* Two ordered periods = two steps of ONE hue (an ordinal job, never identity). */
.chain-seg.is-period-a,
.chain-swatch.is-period-a {
  background: var(--accent);
}

.chain-seg.is-period-b,
.chain-swatch.is-period-b {
  background: var(--accent);
  opacity: 0.55;
}

.chain-seg.is-refund,
.chain-swatch.is-refund {
  background: var(--other-series);
}

.chain-seg.is-carry,
.chain-swatch.is-remaining,
.chain-swatch.is-carry {
  box-sizing: border-box;
  border: 1px solid var(--border);
  background: var(--surface-2);
}

/* The $25,000 mark — a POSITION cue, redundant with the track's end (CVD-safe). */
.chain-tick {
  position: absolute;
  top: -3px;
  width: 2px;
  height: 20px;
  border-radius: 1px;
  background: var(--muted);
  box-shadow: 0 0 0 1px var(--surface);
  transform: translateX(-1px);
  pointer-events: none;
}

.chain-figures {
  font-variant-numeric: tabular-nums;
  font-size: 0.8rem;
  text-align: right;
  color: var(--muted);
}

.chain-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1rem;
  font-size: 0.72rem;
  color: var(--muted);
}

.chain-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.chain-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

@media (max-width: 720px) {
  .chain-row {
    grid-template-columns: 1fr;
  }

  .chain-figures {
    text-align: left;
  }
}
```

- [ ] **4 Create `src/components/espp/PositionStrip.tsx`:**

```tsx
import { GhostTile, SkeletonTileRow } from '../PageSkeleton'
import StatTile from '../StatTile'
import type { EsppHeldTotals, EsppLotsResponse, EsppModelerOut } from '../../types/api'
import { formatCurrency, formatPct, formatShares } from '../../utils/format'
import '../panels.css'
import './espp.css'

// The one sentence a screen reader gets while the whole row is still a ghost.
export const STRIP_LABEL = 'Loading the ESPP headline…'

/** Why a quote-dependent tile has no figure — the delta line under its em dash. */
function unpricedNote(lots: EsppLotsResponse): string {
  return lots.espp_ticker === null ? 'no ESPP ticker configured' : 'no live quote'
}

function gainTone(gain: string | null): 'positive' | 'negative' | 'neutral' {
  if (gain === null) return 'neutral'
  const n = Number(gain)
  return n > 0 ? 'positive' : n < 0 ? 'negative' : 'neutral'
}

/**
 * The page-top headline (2026-09-07 spec §4): four tiles from the lots feed, the $25k tile
 * from the modeler. Two feeds, ONE row — while neither has answered the row is a five-tile
 * ghost, and once one has, its tiles paint while the other feed's slots stay ghosts, so the
 * row's box never moves (the 2026-09-05 CLS lesson: a strip that appears out of nothing
 * shoved every card below it). Every figure is the server's `totals` / modeler total.
 */
export default function PositionStrip({
  lots,
  lotsBusy,
  modeler,
  modelerBusy,
  modelerDirty,
}: {
  lots: EsppLotsResponse | null
  lotsBusy: boolean
  modeler: EsppModelerOut | null
  modelerBusy: boolean
  /** The modeler card's dirty flag: the $25k figure is stale until the rows are saved. */
  modelerDirty: boolean
}) {
  // A warm snapshot written before this batch has no `totals`: not loaded yet, not empty.
  const held: EsppHeldTotals | undefined = lots?.totals?.held
  if (held === undefined && modeler === null) {
    // Both feeds failed with nothing cached: the page banner carries that; a ghost that never
    // resolves would only promise something that is not coming.
    if (!lotsBusy && !modelerBusy) return null
    return <SkeletonTileRow tiles={5} label={STRIP_LABEL} />
  }
  // Dim only what is being revalidated OVER something already painted.
  const dim = (held !== undefined && lotsBusy) || (modeler !== null && modelerBusy)
  return (
    <div className={`loading-dim${dim ? ' is-loading' : ''}`}>
      <div className="kpi-row">
        {held === undefined || lots === null ? (
          <>
            <GhostTile />
            <GhostTile />
            <GhostTile />
            <GhostTile />
          </>
        ) : (
          <>
            <StatTile
              label="Market value"
              value={formatCurrency(held.market_value)}
              delta={held.market_value === null ? unpricedNote(lots) : undefined}
              tone="neutral"
              hint="Your unsold lots at the current quote."
            />
            <StatTile
              label="Cost basis"
              value={formatCurrency(held.cost_basis)}
              hint="What those lots cost you, after the plan discount."
            />
            <StatTile
              label="Unrealized gain"
              value={formatCurrency(held.gain_amount)}
              delta={held.gain_pct === null ? unpricedNote(lots) : formatPct(held.gain_pct)}
              tone={gainTone(held.gain_amount)}
              hint="Market value less cost basis; the percentage is against cost. Realized gains from sold lots are in the lots table's totals row."
            />
            <StatTile
              label="Shares held"
              value={formatShares(held.shares)}
              delta={`${held.lots} ${held.lots === 1 ? 'lot' : 'lots'}`}
              tone="neutral"
              hint="Unsold ESPP shares across every lot."
            />
          </>
        )}
        {modeler === null ? (
          <GhostTile />
        ) : (
          <StatTile
            label={`$25k limit used — ${modeler.year}`}
            value={formatCurrency(modeler.totals.total_25k_value)}
            delta={`${formatCurrency(modeler.totals.remaining_25k)} left`}
            tone="neutral"
            hint="The Purchase modeler's chained total against the IRS §423 ceiling, at its current year and knobs — the meter in that card draws the same figure long."
          />
        )}
      </div>
      {/* The card's own dirty note, echoed beside the headline it disclaims — the tile and the
          meter must never disagree silently (2026-08-31 review round). */}
      {modelerDirty && modeler !== null && (
        <p className="hint">
          Unsaved period edits below — this figure is stale until you save &amp; recalculate.
        </p>
      )}
    </div>
  )
}
```

- [ ] **5 Pass:** `npx vitest run src/components/espp/PositionStrip.test.tsx` → 8 green.
- [ ] **6 Commit:** `git add src/components/espp && git commit -m "feat(espp): PositionStrip — five headline tiles from two feeds, ghosting per feed"`

---

### Task 3: The lots totals rows and the skeleton's extra row

**Files:** Modify `src/pages/EsppPage.tsx` (LotsPanel's `<table>`), `src/components/skeletonMetrics.ts:74`, `src/components/skeletonMetrics.test.ts:34` · Test `src/pages/EsppPage.test.tsx`

- [ ] **1 Fixtures** — in `src/pages/EsppPage.test.tsx`, give `lotsResponse()` the server's totals for its four lots (two held, two sold) by adding to the returned object, after `lots: [...]`:

```ts
    totals: {
      held: {
        lots: 2, shares: '501.0000', cost_basis: '20657.56', fmv_value: '62546.50',
        market_value: '85826.31', gain_amount: '65168.75', gain_pct: '3.154717',
        bargain_element: '41888.94', lookback_component: '38243.49', discount_component: '3645.45',
        appreciation: '23279.81', avg_paid: '41.23265',
      },
      sold: { lots: 2, shares: '529.0000', cost_basis: '21812.08', proceeds: '60740.00', gain_amount: '38927.92' },
    },
```

and give `modelerResponse()`'s `totals` (and `totalsUsing()`'s) the three new fields: `total_shares: '390', total_contribution: '16812.00', total_refund: '681.28'` (203 + 187 shares; 8400.00 + 8412.00; the derived row's refund).

- [ ] **2 Write the failing test** — in `describe('EsppPage — lots', …)`:

```tsx
  it('closes the table with the server totals — one row for held lots, one for sold', async () => {
    renderPage()
    await screen.findByText('$10,720.49')
    const rows = document.querySelectorAll('tfoot tr.espp-totals')
    expect(rows.length).toBe(2)
    const held = rows[0].textContent ?? ''
    expect(held).toContain('Held')
    expect(held).toContain('501')
    expect(held).toContain('$20,657.56')
    expect(held).toContain('$85,826.31')
    expect(held).toContain('$65,168.75')
    expect(held).toContain('+315.5%')
    expect(held).toContain('2 held')
    const sold = rows[1].textContent ?? ''
    expect(sold).toContain('Sold')
    expect(sold).toContain('529')
    expect(sold).toContain('$60,740.00')
    expect(sold).toContain('$38,927.92')
    expect(sold).toContain('2 sold')
  })

  it('prints no sold row when nothing has been sold', async () => {
    vi.mocked(fetchLots).mockResolvedValue(
      lotsResponse({
        lots: [qualifiedLot],
        totals: {
          held: lotsResponse().totals!.held,
          sold: { lots: 0, shares: '0.0000', cost_basis: '0.00', proceeds: '0.00', gain_amount: '0.00' },
        },
      }),
    )
    renderPage()
    await screen.findByText('$10,720.49')
    expect(document.querySelectorAll('tfoot tr.espp-totals').length).toBe(1)
  })
```

- [ ] **3 Fail:** `npx vitest run src/pages/EsppPage.test.tsx -t "closes the table|no sold row"` → 0 rows found.
- [ ] **4 Implement** — in `LotsPanel`'s table, after `</tbody>` and before `</table>` (13 cells per row — Purchased, Shares, Subscription, FMV, Paid, Cost basis, Price, Market value, Gain, Gain %, Disposition, Notes, actions):

```tsx
            {/* The server's totals (2026-09-07 spec §4.3), never summed here. Absent on a
                pre-batch snapshot, so the footer simply waits for the mount's fetch. */}
            {data.totals !== undefined && (
              <tfoot>
                <tr className="espp-totals">
                  <td>Held</td>
                  <td className="num">{formatShares(data.totals.held.shares)}</td>
                  <td />
                  <td />
                  <td />
                  <td className="num">{formatCurrency(data.totals.held.cost_basis)}</td>
                  <td />
                  <td className="num">{formatCurrency(data.totals.held.market_value)}</td>
                  <td className="num">{formatCurrency(data.totals.held.gain_amount)}</td>
                  <td className="num">{formatPct(data.totals.held.gain_pct)}</td>
                  <td className="disposition">{`${data.totals.held.lots} held`}</td>
                  <td />
                  <td />
                </tr>
                {data.totals.sold.lots > 0 && (
                  <tr className="espp-totals">
                    <td>Sold</td>
                    <td className="num">{formatShares(data.totals.sold.shares)}</td>
                    <td />
                    <td />
                    <td />
                    <td className="num">{formatCurrency(data.totals.sold.cost_basis)}</td>
                    <td />
                    {/* Market value's column: for a sold lot that IS its proceeds. */}
                    <td className="num">{formatCurrency(data.totals.sold.proceeds)}</td>
                    <td className="num">{formatCurrency(data.totals.sold.gain_amount)}</td>
                    <td />
                    <td className="disposition">{`${data.totals.sold.lots} sold`}</td>
                    <td />
                    <td />
                  </tr>
                )}
              </tfoot>
            )}
```

Import `'../components/espp/espp.css'` in `EsppPage.tsx` beside `'./EsppPage.css'`.

In `src/components/skeletonMetrics.ts` change the `esppLots` line to `esppLots: HINT_LINE + 9 * TABLE_ROW, // hint, the add-row form, table header + 5 rows + the held totals row` and in `skeletonMetrics.test.ts:34` change the expected array's fourth value `282` → `315`.

- [ ] **5 Pass:** `npx vitest run src/pages/EsppPage.test.tsx src/components/skeletonMetrics.test.ts` → green (the existing 60 page tests included — the fixture additions are optional fields).
- [ ] **6 Commit:** `git add -A src && git commit -m "feat(espp): the lots table closes with the server's held and sold totals"`

---

### Task 4: `LimitChainMeter`

**Files:** Create `src/components/espp/LimitChainMeter.tsx`, `src/components/espp/LimitChainMeter.test.tsx`

- [ ] **1 Write the failing tests:**

```tsx
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { EsppModelerOut, EsppModelerPeriod } from '../../types/api'
import LimitChainMeter from './LimitChainMeter'

afterEach(cleanup)

// The page test's modeler fixture: a stored February row under the cap and a derived August
// row that hits it and refunds.
const h1 = {
  label: '1H24', over_limit: false, cost: '8370.22', refund: '0.00', carry_forward_out: '29.78', value_25k: '9847.00',
} as unknown as EsppModelerPeriod
const h2 = {
  label: 'Mar–Aug 2024', over_limit: true, cost: '7760.50', refund: '681.28', carry_forward_out: '0.00', value_25k: '9070.13',
} as unknown as EsppModelerPeriod
function modeler(over: Partial<EsppModelerOut['totals']> = {}, carry = '0.00'): EsppModelerOut {
  return {
    year: 2024,
    carry_forward: carry,
    periods: [h1, h2],
    totals: {
      total_25k_value: '18917.13', out_of_pocket_cost: '16130.72', fmv_of_shares: '19200.00', remaining_25k: '6082.87',
      total_shares: '390', total_contribution: '16812.00', total_refund: '681.28', ...over,
    },
  } as unknown as EsppModelerOut
}
const widths = (row: Element) => [...row.querySelectorAll('.chain-seg')].map((s) => (s as HTMLElement).style.width)

describe('LimitChainMeter', () => {
  it('draws the limit row on the $25k scale: two period segments, the track and the tick at $25,000', () => {
    render(<LimitChainMeter data={modeler()} />)
    const [limit] = screen.getAllByRole('meter')
    expect(limit.getAttribute('aria-valuemin')).toBe('0')
    expect(limit.getAttribute('aria-valuemax')).toBe('25000')
    expect(limit.getAttribute('aria-valuenow')).toBe('18917.13')
    expect(limit.getAttribute('aria-valuetext')).toBe('$18,917.13 of $25,000.00 used')
    expect(widths(limit)).toEqual(['39.39%', '36.28%']) // 9847 / 25000, 9070.13 / 25000
    expect((limit.querySelector('.chain-track') as HTMLElement).style.width).toBe('100.00%')
    expect((limit.querySelector('.chain-tick') as HTMLElement).style.left).toBe('100.00%')
    expect(screen.getByText('$18,917.13 used · $6,082.87 left')).toBeTruthy()
  })

  it('draws the contributions row on the SAME scale: cost per period, then the refund', () => {
    render(<LimitChainMeter data={modeler()} />)
    const [, cash] = screen.getAllByRole('meter')
    expect(cash.getAttribute('aria-valuemax')).toBe('25000')
    expect(cash.getAttribute('aria-valuenow')).toBe('16812')
    expect(cash.getAttribute('aria-valuetext')).toBe('$16,812.00 contributed; $16,130.72 bought shares; $681.28 refunded')
    expect(widths(cash)).toEqual(['33.48%', '31.04%', '2.73%']) // 8370.22, 7760.50, 681.28 / 25000
    expect(screen.getByText('$16,812.00 contributed · $681.28 refunded')).toBeTruthy()
  })

  it('grows the shared scale past $25k when contributions exceed it, and the track ends short', () => {
    render(<LimitChainMeter data={modeler({ total_contribution: '30000.00', total_refund: '0.00' })} />)
    const [limit, cash] = screen.getAllByRole('meter')
    expect(cash.getAttribute('aria-valuemax')).toBe('30000')
    expect((limit.querySelector('.chain-track') as HTMLElement).style.width).toBe('83.33%')
    expect((limit.querySelector('.chain-tick') as HTMLElement).style.left).toBe('83.33%')
    expect(widths(limit)).toEqual(['32.82%', '30.23%']) // 9847 / 30000, 9070.13 / 30000
    expect(widths(cash)).toEqual(['27.90%', '25.87%']) // no refund segment at $0
  })

  it('leads the contributions row with the carry-in and says what carries forward', () => {
    const data = modeler({}, '100.00')
    data.periods = [h1, { ...h2, over_limit: false, refund: '0.00', carry_forward_out: '45.10' }]
    data.totals = { ...data.totals, total_refund: '0.00' }
    render(<LimitChainMeter data={data} />)
    const [, cash] = screen.getAllByRole('meter')
    expect(cash.querySelector('.chain-seg')?.className).toContain('is-carry')
    expect(widths(cash)[0]).toBe('0.40%') // 100 / 25000
    expect(screen.getByText('$16,812.00 contributed · $45.10 carries forward')).toBeTruthy()
  })

  it('names every capped period in the advisory register', () => {
    render(<LimitChainMeter data={modeler()} />)
    const note = screen.getByText('Cap reached in Mar–Aug 2024 — $681.28 refunded.')
    expect(note.className).toContain('espp-warning')
  })

  it('draws the legend with the period labels, the refund and the remaining track', () => {
    render(<LimitChainMeter data={modeler()} />)
    const legend = document.querySelector('.chain-legend') as HTMLElement
    expect(legend.textContent).toContain('1H24')
    expect(legend.textContent).toContain('Mar–Aug 2024')
    expect(legend.textContent).toContain('Refunded')
    expect(legend.textContent).toContain('Remaining')
  })

  it('draws the limit row alone when a pre-batch payload carries no contribution totals', () => {
    const stale = modeler()
    delete (stale.totals as Partial<EsppModelerOut['totals']>).total_contribution
    delete (stale.totals as Partial<EsppModelerOut['totals']>).total_refund
    render(<LimitChainMeter data={stale} />)
    expect(screen.getAllByRole('meter').length).toBe(1)
    expect(document.querySelector('.chain-legend')?.textContent).not.toContain('Refunded')
  })
})
```

- [ ] **2 Fail:** `npx vitest run src/components/espp/LimitChainMeter.test.tsx` → cannot resolve `./LimitChainMeter`.
- [ ] **3 Create `src/components/espp/LimitChainMeter.tsx`:**

```tsx
import type { EsppModelerOut } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import '../panels.css'
import './espp.css'

// The IRS §423 ceiling the chain is modeled against (backend espp_calc: unused_25k starts
// here). Exactly as on the gauge it replaces, nothing here is DERIVED from it: it sizes the
// limit row's track and the meter's aria range, and "remaining" is the server's own number.
export const LIMIT_25K = 25000

/** A width on the shared scale — clamped so a rounding hair can never overflow the row. */
function pct(value: number, scale: number): string {
  return `${Math.max(0, Math.min(100, (value / scale) * 100)).toFixed(2)}%`
}

/** Periods alternate two steps of one hue: ordered, not identified. */
const tone = (index: number) => (index % 2 === 0 ? 'is-period-a' : 'is-period-b')

/**
 * The $25k chain as two meter rows on ONE dollar scale (2026-09-07 spec §7): the limit counts
 * shares at the subscription price while the cash buys them at the discounted price, and only a
 * shared scale lets the reader see that gap — the two-limit confusion the 2026-09-02 audit
 * flagged. HTML in the pace meter's grammar, not a chart: this is a filled quantity against a
 * range. Every figure is the server's (the period rows, the modeler totals); the only arithmetic
 * is pixel width. The contributions row draws only when the payload carries the totals it
 * needs — a warm snapshot from before this batch does not.
 */
export default function LimitChainMeter({ data }: { data: EsppModelerOut }) {
  const { totals, periods } = data
  const contribution =
    totals.total_contribution === undefined ? null : Number(totals.total_contribution)
  const refund = totals.total_refund === undefined ? 0 : Number(totals.total_refund)
  const carryIn = Number(data.carry_forward)
  const carryOut = periods.length === 0 ? 0 : Number(periods[periods.length - 1].carry_forward_out)
  // The chain can never exceed the limit by construction (each period is capped at
  // max_shares_25k), so the scale only ever grows past $25k on the cash side.
  const scale = Math.max(LIMIT_25K, contribution === null ? 0 : contribution + carryIn)
  const capped = periods.filter((p) => p.over_limit)

  const cashClauses = [`${formatCurrency(totals.total_contribution)} contributed`]
  if (refund > 0) cashClauses.push(`${formatCurrency(totals.total_refund)} refunded`)
  if (carryOut > 0) cashClauses.push(`${formatCurrency(carryOut.toFixed(2))} carries forward`)

  return (
    <div className="chain-meter">
      <div className="chain-row">
        <span className="chain-name">Limit used, at the subscription price</span>
        <div
          className="chain-bar"
          role="meter"
          aria-label={`${formatCurrency(LIMIT_25K)} limit used in ${data.year}`}
          aria-valuemin={0}
          aria-valuemax={LIMIT_25K}
          aria-valuenow={Number(totals.total_25k_value)}
          aria-valuetext={`${formatCurrency(totals.total_25k_value)} of ${formatCurrency(LIMIT_25K)} used`}
        >
          <div className="chain-track" style={{ width: pct(LIMIT_25K, scale) }} />
          <div className="chain-segments">
            {periods.map((p, i) => (
              <div
                key={p.label}
                className={`chain-seg ${tone(i)}`}
                style={{ width: pct(Number(p.value_25k), scale) }}
                title={`${p.label}: ${formatCurrency(p.value_25k)} at the subscription price`}
              />
            ))}
          </div>
          <span className="chain-tick" style={{ left: pct(LIMIT_25K, scale) }} aria-hidden="true" />
        </div>
        <span className="chain-figures">
          {`${formatCurrency(totals.total_25k_value)} used · ${formatCurrency(totals.remaining_25k)} left`}
        </span>
      </div>
      {contribution !== null && (
        <div className="chain-row">
          <span className="chain-name">Your contributions</span>
          <div
            className="chain-bar"
            role="meter"
            aria-label={`contributions in ${data.year}`}
            aria-valuemin={0}
            aria-valuemax={scale}
            aria-valuenow={contribution}
            aria-valuetext={`${formatCurrency(totals.total_contribution)} contributed; ${formatCurrency(
              totals.out_of_pocket_cost,
            )} bought shares; ${formatCurrency(totals.total_refund)} refunded`}
          >
            <div className="chain-segments">
              {carryIn > 0 && (
                <div
                  className="chain-seg is-carry"
                  style={{ width: pct(carryIn, scale) }}
                  title={`carried in: ${formatCurrency(data.carry_forward)}`}
                />
              )}
              {periods.map((p, i) => (
                <div
                  key={p.label}
                  className={`chain-seg ${tone(i)}`}
                  style={{ width: pct(Number(p.cost), scale) }}
                  title={`${p.label}: ${formatCurrency(p.cost)} bought shares`}
                />
              ))}
              {refund > 0 && (
                <div
                  className="chain-seg is-refund"
                  style={{ width: pct(refund, scale) }}
                  title={`refunded: ${formatCurrency(totals.total_refund)}`}
                />
              )}
            </div>
          </div>
          <span className="chain-figures">{cashClauses.join(' · ')}</span>
        </div>
      )}
      {/* Identity in words as well as tone (never colour alone). */}
      <div className="chain-legend" aria-hidden="true">
        {periods.map((p, i) => (
          <span key={p.label} className="chain-chip">
            <i className={`chain-swatch ${tone(i)}`} />
            {p.label}
          </span>
        ))}
        {contribution !== null && (
          <span className="chain-chip">
            <i className="chain-swatch is-refund" />
            Refunded
          </span>
        )}
        <span className="chain-chip">
          <i className="chain-swatch is-remaining" />
          Remaining
        </span>
      </div>
      {/* Advisory, never the error banner: the chain still ran (the page's espp-warning register). */}
      {capped.map((p) => (
        <p key={p.label} className="drill-hint espp-warning">
          {`Cap reached in ${p.label} — ${formatCurrency(p.refund)} refunded.`}
        </p>
      ))}
    </div>
  )
}
```

- [ ] **4 Pass:** `npx vitest run src/components/espp/LimitChainMeter.test.tsx` → 7 green.
- [ ] **5 Commit:** `git add src/components/espp && git commit -m "feat(espp): LimitChainMeter — the $25k chain as two meter rows on one dollar scale"`

---

### Task 5: The modeler card — meter and four tiles replace the gauge

**Files:** Modify `src/pages/EsppPage.tsx` (`ModelerCard`'s `<div className="gauge">…</div>` and the `kpi-row` under it; the page-level `LIMIT_25K` const), `src/pages/EsppPage.css` (delete the `.gauge*` rules) · Test `src/pages/EsppPage.test.tsx`

- [ ] **1 Rewrite the gauge test** — replace `it('renders the chain, the provenance line and the $25k gauge', …)`'s gauge half (from `// The gauge:` to the end of the test) with:

```tsx
    // The chain meter replaces the gauge (2026-09-07 spec §7): the limit row keeps the
    // gauge's aria contract, and the card's two-tile row becomes four tiles.
    const [limit, cash] = within(modelerCard()).getAllByRole('meter')
    expect(limit.getAttribute('aria-valuenow')).toBe('18917.13')
    expect(limit.getAttribute('aria-valuemin')).toBe('0')
    expect(limit.getAttribute('aria-valuemax')).toBe('25000')
    expect(cash.getAttribute('aria-valuenow')).toBe('16812')
    expect(screen.getByText('$18,917.13 used · $6,082.87 left')).toBeTruthy()
    expect(document.querySelector('.gauge')).toBeNull()
    const card = within(modelerCard())
    expect(card.getByText('Out of pocket').closest('.stat-tile')?.textContent).toContain('$16,130.72')
    expect(card.getByText('Shares bought').closest('.stat-tile')?.textContent).toContain('390')
    expect(card.getByText('FMV of shares').closest('.stat-tile')?.textContent).toContain('$19,200.00')
    expect(card.getByText('Refunded').closest('.stat-tile')?.textContent).toContain('$681.28')
```

In `it('names the discount the modeler priced with, never a hardcoded 15%', …)` change `await screen.findByRole('meter')` to `await screen.findAllByRole('meter')`. Search the file for every other `getByRole('meter')` / `findByRole('meter')` and make each `getAllByRole('meter')[0]` / `(await screen.findAllByRole('meter'))[0]` — the limit row is the first meter on the page and keeps the old attributes.

- [ ] **2 Fail:** `npx vitest run src/pages/EsppPage.test.tsx -t "renders the chain"` → one meter found, no "Shares bought".
- [ ] **3 Implement** — in `EsppPage.tsx`: import `LimitChainMeter` from `'../components/espp/LimitChainMeter'`; delete the page's `LIMIT_25K` constant and its comment (the meter owns it now). In `ModelerCard`'s JSX replace the whole `<div className="gauge">…</div>` block and the `<div className="kpi-row">…two .stat-tile divs…</div>` that follows it with:

```tsx
          <LimitChainMeter data={data} />
          <div className="kpi-row">
            <StatTile
              label="Out of pocket"
              value={formatCurrency(data.totals.out_of_pocket_cost)}
              hint="Your contributions after the carry-forward — what the purchase actually costs you."
            />
            <StatTile
              label="Shares bought"
              // '—' on a pre-batch snapshot (formatShares renders the dash for undefined).
              value={formatShares(data.totals.total_shares)}
              hint="Every share the chain buys this year, both periods together."
            />
            <StatTile
              label="FMV of shares"
              value={formatCurrency(data.totals.fmv_of_shares)}
              hint="The purchased shares valued at the period's fair market value."
            />
            <StatTile
              label="Refunded"
              value={formatCurrency(data.totals.total_refund)}
              hint="Cash the cap sent back — nothing carries when a purchase is capped."
            />
          </div>
```

In `EsppPage.css` delete everything from `/* ── $25k gauge ─…` to the end of the `.gauge-labels` rule (the four `.gauge*` blocks).

- [ ] **4 Pass:** `npx vitest run src/pages/EsppPage.test.tsx` → green.
- [ ] **5 Commit:** `git add src/pages/EsppPage.tsx src/pages/EsppPage.css src/pages/EsppPage.test.tsx && git commit -m "feat(espp): the modeler card draws the chain meter and four tiles where the gauge stood"`

---

### Task 6: Mount the strip where the lone tile was

**Files:** Modify `src/pages/EsppPage.tsx` (the page's return: the `SkeletonTileRow lone` block and the `kpi-row kpi-row-lone` block) · Test `src/pages/EsppPage.test.tsx`

- [ ] **1 Rewrite the two frame/strip tests** — replace `it('reserves the $25k headline strip while the modeler is in flight', …)` with:

```tsx
  it('reserves a five-tile headline row while both feeds are in flight, then fills it per feed', async () => {
    let landLots: (value: EsppLotsResponse) => void = () => {}
    let landModeler: (value: EsppModelerOut) => void = () => {}
    vi.mocked(fetchLots).mockReturnValue(new Promise<EsppLotsResponse>((resolve) => { landLots = resolve }))
    vi.mocked(fetchModeler).mockReturnValue(new Promise<EsppModelerOut>((resolve) => { landModeler = resolve }))
    renderPage()

    expect(await screen.findByText('Loading the ESPP headline…')).toBeTruthy()
    expect(document.querySelectorAll('.kpi-row .stat-tile.skeleton-tile').length).toBe(5)
    expect(document.querySelector('.kpi-row-lone')).toBeNull()

    // The lots land first: four real tiles, the $25k slot still a ghost — same row, same box.
    await act(async () => { landLots(lotsResponse()) })
    await screen.findByText('Market value')
    expect(document.querySelectorAll('.kpi-row .stat-tile.skeleton-tile').length).toBe(1)

    await act(async () => { landModeler(modelerResponse()) })
    await screen.findByText(/\$25k limit used — 2024/)
    expect(document.querySelector('.skeleton-tile')).toBeNull()
    expect(document.querySelectorAll('.kpi-row')[0].querySelectorAll('.stat-tile').length).toBe(5)
  })
```

and in `it('surfaces the $25k figure at the page top, above the lots (2026-08-31 audit)', …)` add, after the existing assertions:

```tsx
    // …and the four position tiles stand beside it, from the lots feed's totals block.
    const row = tile.closest('.kpi-row') as HTMLElement
    expect(row.querySelectorAll('.stat-tile').length).toBe(5)
    expect(within(row).getByText('Market value').closest('.stat-tile')?.textContent).toContain('$85,826.31')
    expect(within(row).getByText('Unrealized gain').closest('.stat-tile')?.textContent).toContain('+315.5%')
```

Any other test asserting `.kpi-row-lone` or `'Loading the $25k headline…'` changes to the new class-less row / `'Loading the ESPP headline…'`.

- [ ] **2 Fail:** `npx vitest run src/pages/EsppPage.test.tsx -t "five-tile|surfaces the"` → old lone markup.
- [ ] **3 Implement** — in `EsppPage.tsx`: import `PositionStrip` from `'../components/espp/PositionStrip'`; remove the `SkeletonTileRow` import if nothing else uses it (keep `StatTile` — the modeler card uses it). Replace the block from `{modeler === null && modelerBusy && (` through the closing `)}` of the `loading-dim` wrapper that holds the lone tile and the dirty note with:

```tsx
        {/* The headline strip (2026-09-07 spec §4): four position tiles from the lots feed and
            the modeler's $25k tile, one row, each feed ghosting its own slots until it answers
            so the box below never moves (the 2026-09-05 CLS fix, widened to five tiles). */}
        <PositionStrip
          lots={lots}
          lotsBusy={lotsBusy}
          modeler={modeler}
          modelerBusy={modelerBusy}
          modelerDirty={modelerDirty}
        />
```

The `.kpi-row-lone` CSS in `panels.css` stays (other pages may use it); this page no longer references it.

- [ ] **4 Pass:** `npx vitest run src/pages/EsppPage.test.tsx src/components/PageSkeleton.test.tsx` → green. `PageSkeleton.test.tsx`'s `'leaves no hand-written ghost height…'` still finds `FEED_SKELETON.esppLots` / `esppOfferings` in the page.
- [ ] **5 Commit:** `git add src/pages/EsppPage.tsx src/pages/EsppPage.test.tsx && git commit -m "feat(espp): the position strip replaces the lone $25k tile"`

---

### Task 7: Lane gate

- [ ] **1** `npx vitest run` → all green; record the count.
- [ ] **2** `npx tsc -b` → clean. `npx eslint src/components/espp src/pages/EsppPage.tsx src/pages/EsppPage.test.tsx src/components/PageSkeleton.tsx src/components/skeletonMetrics.ts` → clean.
- [ ] **3** `git log --oneline main..HEAD` — six commits. Report them, the vitest count, and any deviation with its reason.
