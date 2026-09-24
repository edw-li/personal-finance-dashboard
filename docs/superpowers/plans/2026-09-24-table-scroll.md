# Long tables: capped scroll boxes + dividends by month — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seven long tables scroll inside a capped box (pinned header, pinned totals row, a "more below" fade, keyboard-reachable, full on paper), and the dividend ledger is grouped into collapsible months inside its box.

**Architecture:** One shared primitive — `TableScroll` (component + `tableScroll.css`) plus two small DOM helpers in `tableScrollDom.ts` (`useStickyInsets`, `revealInBox`) and an opt-in vertical mode for the existing `useScrollEdges` — wraps each target table in place of its old wrapper div, keeping the old class. The dividend ledger gets a pure grouping helper (`dividendMonths.ts`) and renders one `<tbody>` per month inside its `TableScroll`. Frontend only; no backend, no migration.

**Tech Stack:** React 19 + TypeScript 5.9, Vite 6, Vitest 3 + Testing Library (jsdom), plain CSS; Playwright-core driving Edge for the browser smoke.

**Spec:** `docs/superpowers/specs/2026-09-24-long-tables-capped-scroll-and-dividend-months-design.md` (read §2–§4 before Task 3).

---

## Ground rules (every task)

- **Where:** the worktree `C:\Users\edyli\personal-finance-dashboard\.worktrees\table-scroll`, branch
  `feat/table-scroll`. Run every command from the worktree root. NEVER touch the main checkout
  (`C:\Users\edyli\personal-finance-dashboard`): another session is working there. No `git checkout`
  of other branches, no bare `git stash`, no commits outside this branch, no push.
- **Commands:** `npx vitest run <paths>` (targeted), `npx tsc -b`, `npx eslint <paths>`,
  `npx vite build`. The full vitest run is Task 11's.
- **Vitest globals are OFF:** import `describe/it/expect/vi/afterEach` from `'vitest'`; every file that
  renders calls `afterEach(cleanup)` (or a cleanup inside its own `afterEach`).
- **jsdom lays nothing out:** every size is 0, there is no `ResizeObserver` and no `scrollIntoView`.
  `scrollTop`/`scrollLeft` ARE settable and keep fractions. Fake sizes with
  `Object.defineProperty(el, 'scrollHeight', { value, configurable: true })`; fake a rect by assigning
  `el.getBoundingClientRect = () => rect` or `vi.spyOn(Element.prototype, 'getBoundingClientRect')`.
- **`@testing-library/user-event` is not installed** — use `fireEvent`.
- **Comments:** this codebase writes WHY-comments, dense and specific; match the file you are in. The
  code blocks below carry the comments to write.
- **Dev servers:** do not start, stop or restart anything on ports 8000/5173, 8041–8045/5241–5245.
  Only Task 9/11 use the private pair 8061 (uvicorn) / 5261 (vite), already running for this branch.
- **Implementers run model "opus"** (standing user rule).

## File structure

| File | New? | Responsibility |
|---|---|---|
| `src/components/useScrollEdges.ts` | modify | opt-in `'xy'` mode: also names `top` / `bottom`; watches the box's table |
| `src/components/tableScrollDom.ts` | new | `useStickyInsets` (writes `--table-head-h` / `--table-foot-h`), `revealInBox` (scroll the box, never the page) |
| `src/components/TableScroll.tsx` | new | THE capped table box: region + label + tabIndex, runs both hooks, forwards a ref |
| `src/components/tableScroll.css` | new | the cap, separate borders, pinned header/totals, body-row scroll margins, the fade, the focused box's mask drop; print hides the fade |
| `src/index.css` | modify | `.table-scroll` joins the inset focus-ring container list; the print release for every capped box (`:root :is(…)`, static cells, no mask) |
| `src/components/portfolio/HoldingsScroll.tsx` | delete | replaced by `TableScroll` |
| `src/components/portfolio/{TransactionsPanel,SecuritiesPanel,HoldingsTable,ClassificationEditor}.tsx` | modify | wrap in `TableScroll` (+ Classification focus fix) |
| `src/components/creditcards/RewardsMatrix.tsx` | modify | wrap in `TableScroll` |
| `src/pages/NetWorthPage.tsx` | modify | wrap the accounts table in `TableScroll` — wrapper lines only, NO re-indent (lane T edits the rows) |
| `src/components/portfolio/dividendMonths.ts` | new | pure grouping: months, labels, integer-cent totals |
| `src/components/portfolio/DividendsPanel.tsx` | modify | ledger by month in a `TableScroll`, open state, Expand/Collapse all, reveal-after-save |
| `src/components/portfolio/dividends.css` | new | month lines, toolbar, indent, dividend scroll padding |
| `tools/probes/table-scroll-v/smoke.mjs` + `tools/probes/README.md` | new / modify | the real-browser verification |
| `tools/probes/reorder-v/smoke.mjs` | modify | the ledger's long drag now scrolls the BOX |

Tests: `useScrollEdges.test.ts` (modify), `tableScrollDom.test.ts`, `TableScroll.test.tsx`,
`tableScrollCss.test.ts` (new), `src/focusCss.test.ts`, `TransactionsPanel.test.tsx`,
`SecuritiesPanel.test.tsx`, `HoldingsTable.test.tsx`, `ClassificationEditor.test.tsx`,
`DividendsPanel.test.tsx` (modify), `dividendMonths.test.ts`, `RewardsMatrix.test.tsx`,
`src/pages/NetWorthPage.tableScroll.test.tsx` (new).

---

### Task 0: Baseline

- [ ] **Step 1: Record the branch's starting gates**

Run (from the worktree root):
```bash
npx tsc -b && echo TSC-OK
npx eslint . 2>&1 | tail -3
npx vitest run 2>&1 | tail -6
```
Expected: `TSC-OK`; eslint `0 errors` and N warnings (write N down — Task 11 must not exceed it);
vitest all passing (write the file/test counts down). If anything fails at baseline, stop and report it:
it is not this plan's to fix.

---

### Task 1: `useScrollEdges` — opt-in vertical edges

**Files:**
- Modify: `src/components/useScrollEdges.ts`
- Test: `src/components/useScrollEdges.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/components/useScrollEdges.test.ts`, change the vitest import line to
`import { afterEach, describe, expect, it, vi } from 'vitest'`, then append:

```ts
// Vertical twins (2026-09-24 table-scroll spec §2.3). A capped table box scrolls both ways, and
// `axes: 'xy'` names its hidden top and bottom edges too; every existing caller stays on 'x'.
function BothWays({ axes }: { axes?: 'x' | 'xy' }) {
  const ref = useRef<HTMLDivElement>(null)
  useScrollEdges(ref, true, axes)
  // eslint-disable-next-line react-hooks/refs
  return createElement('div', { ref, 'data-testid': 'scroller' }, createElement('table'))
}

function tall(el: HTMLElement, scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
}

describe('useScrollEdges, vertical', () => {
  it("names the hidden top and bottom after the sideways edges, with the right edge's 1px tolerance", () => {
    const { getByTestId } = render(createElement(BothWays, { axes: 'xy' }))
    const el = getByTestId('scroller')
    tall(el, 1000, 400)
    el.dispatchEvent(new Event('scroll'))
    expect(el.getAttribute('data-scroll-more')).toBe('bottom')
    el.scrollTop = 300
    el.dispatchEvent(new Event('scroll'))
    expect(el.getAttribute('data-scroll-more')).toBe('top bottom')
    // 599.5 + 400 is within a pixel of 1000: a box whose content rounds fractionally is at its foot.
    el.scrollTop = 599.5
    el.dispatchEvent(new Event('scroll'))
    expect(el.getAttribute('data-scroll-more')).toBe('top')
    box(el, 600, 300)
    el.scrollLeft = 100
    el.dispatchEvent(new Event('scroll'))
    expect(el.getAttribute('data-scroll-more')).toBe('left right top')
  })

  it('stays sideways-only by default, so every existing scroller keeps its exact attribute', () => {
    const { getByTestId } = render(createElement(BothWays, {}))
    const el = getByTestId('scroller')
    tall(el, 1000, 400)
    box(el, 600, 300)
    el.dispatchEvent(new Event('scroll'))
    expect(el.getAttribute('data-scroll-more')).toBe('right')
  })

  it("watches the box's table in 'xy', so rows landing refresh the edges without a scroll", () => {
    const observed: Element[] = []
    let fire: () => void = () => {}
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          fire = callback
        }
        observe(target: Element) {
          observed.push(target)
        }
        disconnect() {}
      },
    )
    try {
      const { getByTestId } = render(createElement(BothWays, { axes: 'xy' }))
      const el = getByTestId('scroller')
      expect(observed).toEqual([el, el.querySelector('table')])
      tall(el, 1000, 400)
      fire()
      expect(el.getAttribute('data-scroll-more')).toBe('bottom')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run src/components/useScrollEdges.test.ts`
Expected: the three new tests FAIL (the hook ignores a third argument: no `top`/`bottom`, and the
observer sees only the box); the three existing tests PASS.

- [ ] **Step 3: Implement**

Replace the whole of `src/components/useScrollEdges.ts` with:

```ts
import { useEffect, type RefObject } from 'react'

/**
 * Which edges of a horizontal scroller still hide content (2026-09-13 polish §7). Written as a
 * space-separated `data-scroll-more` token list ("left", "right", "left right") so panels.css can
 * mask the hidden edge with [data-scroll-more~="…"]; removed outright when nothing is hidden, so
 * a table that fits its card carries no attribute and no mask. Re-read on scroll, on the
 * scroller's own resize (a dock opening narrows it with no window event) and on window resize.
 * Page lanes attach it to their `*-scroll` wrappers alongside the `.row-actions` cells.
 *
 * `axes` (2026-09-24 table-scroll spec §2.3): the default 'x' reads the sideways edges only, exactly
 * as it always has; 'xy' also names "top" and "bottom", after them, for a box capped in height
 * (TableScroll). Opt-in, because an `overflow-x: auto` box computes `overflow-y: auto` and display
 * scaling can round its content a pixel taller than the box — every existing caller's attribute
 * stays byte-identical. In 'xy' the ResizeObserver also watches the box's table: once the box is
 * capped its own size stops changing, so rows landing (or a dividend month opening) would otherwise
 * leave "bottom" stale until the next scroll.
 *
 * A ref is not a reactive value — it is filled during the commit, silently — so an effect that
 * finds `ref.current` null and returns has nothing to wake it when the element finally arrives.
 * Callers therefore pick one of two shapes (2026-09-13 review round: before `active` existed, a
 * hook placed above a table that renders only once rows load attached on WARM renders and never
 * on the first load, so that table was never masked):
 *
 * - call the hook INSIDE the component that renders the scroller unconditionally, so the ref is
 *   filled by the first commit; or
 * - keep it above a conditional scroller and pass `active={rows.length > 0}` — the flip re-runs
 *   the effect, by which time the element exists. `active` going false detaches and clears the
 *   attribute, which is what a scroller on its way out wants anyway.
 */
export function useScrollEdges(
  ref: RefObject<HTMLElement | null>,
  active = true,
  axes: 'x' | 'xy' = 'x',
): void {
  useEffect(() => {
    const el = active ? ref.current : null
    if (el === null) return
    const update = () => {
      const edges: string[] = []
      if (el.scrollLeft > 0) edges.push('left')
      // A 1px tolerance: fractional widths leave scrollLeft + clientWidth a hair short of
      // scrollWidth at the far right, which would pin a phantom "more" on a fully scrolled table.
      if (el.scrollLeft + el.clientWidth < el.scrollWidth - 1) edges.push('right')
      if (axes === 'xy') {
        if (el.scrollTop > 0) edges.push('top')
        // The same tolerance at the foot.
        if (el.scrollTop + el.clientHeight < el.scrollHeight - 1) edges.push('bottom')
      }
      if (edges.length === 0) el.removeAttribute('data-scroll-more')
      else el.setAttribute('data-scroll-more', edges.join(' '))
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    // Guarded for jsdom and old browsers (PageFrame's idiom): without it the edges refresh on
    // the next scroll or window resize instead.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(el)
    const table = axes === 'xy' ? el.querySelector(':scope > table') : null
    if (table !== null) observer?.observe(table)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      observer?.disconnect()
      el.removeAttribute('data-scroll-more')
    }
    // `active` is in the deps for the whole point of it: the effect has to run again when the
    // scroller appears. `axes` because a caller that switched it wants the other token set. `ref`
    // is here only because the lint rule asks for it — a ref's identity never changes, and its
    // .current is invisible to this list.
  }, [ref, active, axes])
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/useScrollEdges.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Lint, then commit**

```bash
npx eslint src/components/useScrollEdges.ts src/components/useScrollEdges.test.ts
git add src/components/useScrollEdges.ts src/components/useScrollEdges.test.ts
git commit -m "feat(tables): useScrollEdges names a capped box's hidden top and bottom edges on request ('xy'), watching its table for rows that land — every existing caller stays sideways-only and byte-identical (table-scroll spec §2.3)"
```

---

### Task 2: `tableScrollDom.ts` — pinned-row heights and reveal-in-box

**Files:**
- Create: `src/components/tableScrollDom.ts`
- Test: `src/components/tableScrollDom.test.ts`

(The name is `tableScrollDom`, NOT `tableScroll`: on this case-insensitive Windows box
`import './TableScroll'` would resolve to a `tableScroll.ts` before `TableScroll.tsx`.)

- [ ] **Step 1: Write the failing tests**

Create `src/components/tableScrollDom.test.ts`:

```ts
import { cleanup, render } from '@testing-library/react'
import { createElement, useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { revealInBox, useStickyInsets } from './tableScrollDom'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function Box({ foot }: { foot: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useStickyInsets(ref)
  // react-hooks/refs reads createElement(type, props) as "a ref handed to a function"; the ref is
  // never READ here — React attaches it after the commit (useScrollEdges.test.ts's note).
  // eslint-disable-next-line react-hooks/refs
  return createElement(
    'div',
    { ref, 'data-testid': 'box' },
    createElement(
      'table',
      null,
      createElement('thead', null, createElement('tr', null, createElement('th', null, 'Col'))),
      createElement('tbody', null, createElement('tr', null, createElement('td', null, 'x'))),
      foot ? createElement('tfoot', null, createElement('tr', null, createElement('td', null, 'Total'))) : null,
    ),
  )
}

/** jsdom lays nothing out: a section's height comes from this table, keyed by tag name. */
function sectionHeights(heights: Record<string, number>): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const height = heights[this.tagName] ?? 0
    return { top: 0, bottom: height, left: 0, right: 0, width: 0, height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
}

describe('useStickyInsets', () => {
  it("writes the header's and the footer's heights on the box, fractions kept", () => {
    sectionHeights({ THEAD: 30.4, TFOOT: 33 })
    const { getByTestId } = render(createElement(Box, { foot: true }))
    const box = getByTestId('box')
    expect(box.style.getPropertyValue('--table-head-h')).toBe('30.4px')
    expect(box.style.getPropertyValue('--table-foot-h')).toBe('33px')
  })

  it('writes 0px for a table with no tfoot', () => {
    sectionHeights({ THEAD: 30 })
    const { getByTestId } = render(createElement(Box, { foot: false }))
    expect(getByTestId('box').style.getPropertyValue('--table-foot-h')).toBe('0px')
  })

  it('re-measures when the table resizes, and clears both on unmount', () => {
    const observed: Element[] = []
    let fire: () => void = () => {}
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          fire = callback
        }
        observe(target: Element) {
          observed.push(target)
        }
        disconnect() {}
      },
    )
    const heights: Record<string, number> = { THEAD: 30 }
    sectionHeights(heights)
    const view = render(createElement(Box, { foot: false }))
    const box = view.getByTestId('box')
    expect(observed).toEqual([box.querySelector('table')])
    heights.THEAD = 52 // the header wrapped onto two lines
    fire()
    expect(box.style.getPropertyValue('--table-head-h')).toBe('52px')
    view.unmount()
    expect(box.style.getPropertyValue('--table-head-h')).toBe('')
    expect(box.style.getPropertyValue('--table-foot-h')).toBe('')
  })
})

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

/** A 400px box at y=100 whose pinned header is 30px, scrolled to 1000, and a row at `rowTop`. */
function scene(rowTop: number, rowHeight = 44, foot = 0) {
  const box = document.createElement('div')
  const row = document.createElement('div')
  box.style.setProperty('--table-head-h', '30px')
  box.style.setProperty('--table-foot-h', `${foot}px`)
  Object.defineProperty(box, 'clientHeight', { value: 400, configurable: true })
  Object.defineProperty(box, 'clientTop', { value: 0, configurable: true })
  box.getBoundingClientRect = () => rect(100, 400)
  row.getBoundingClientRect = () => rect(rowTop, rowHeight)
  box.scrollTop = 1000
  return { box, row }
}

describe('revealInBox', () => {
  it('leaves a row that already shows inside the band alone', () => {
    const { box, row } = scene(200)
    expect(revealInBox(box, row)).toBe(false)
    expect(box.scrollTop).toBe(1000)
  })

  it('scrolls up so a row under the pinned header lands just below it', () => {
    const { box, row } = scene(110) // the band starts at 100 + 30 = 130
    expect(revealInBox(box, row)).toBe(true)
    expect(box.scrollTop).toBe(980)
  })

  it('counts a pinned group line as part of the header', () => {
    const { box, row } = scene(150) // the band starts at 130 + 32 = 162
    expect(revealInBox(box, row, 32)).toBe(true)
    expect(box.scrollTop).toBe(988)
  })

  it('scrolls down just enough for a row below the band, clear of a pinned footer', () => {
    const { box, row } = scene(480, 44, 33) // the band ends at 100 + 400 − 33 = 467; the row at 524
    expect(revealInBox(box, row)).toBe(true)
    expect(box.scrollTop).toBe(1057)
  })

  it('aligns a row taller than the band by its top', () => {
    const { box, row } = scene(600, 500) // down by min(1100 − 500, 600 − 130) = 470
    expect(revealInBox(box, row)).toBe(true)
    expect(box.scrollTop).toBe(1470)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/tableScrollDom.test.ts`
Expected: FAIL — `Failed to resolve import "./tableScrollDom"`.

- [ ] **Step 3: Implement**

Create `src/components/tableScrollDom.ts`:

```ts
import { useEffect, type RefObject } from 'react'

/**
 * The heights of a capped table's pinned rows (2026-09-24 table-scroll spec §2.4), written on the
 * box as `--table-head-h` and `--table-foot-h` (px; `0px` for a table with no thead or tfoot).
 * TableScroll's scroll padding reads them — a Tab, a keyboard reorder or a scrollIntoView lands a
 * row clear of the pinned rows — and so do the dividend month lines, which pin just under the
 * column header. Re-measured by a ResizeObserver on the TABLE: a header that wraps, a density
 * switch or a tfoot that arrives with the data all change the table's size, while the capped box's
 * own size does not. Read off getBoundingClientRect rather than offsetHeight: a 30.4px header
 * rounded to 30 would let a month line slide 0.4px under it. Without ResizeObserver (jsdom), it
 * measures once.
 */
export function useStickyInsets(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const box = ref.current
    if (box === null) return
    const table = box.querySelector<HTMLTableElement>(':scope > table')
    if (table === null) return
    const measure = () => {
      box.style.setProperty('--table-head-h', `${table.tHead?.getBoundingClientRect().height ?? 0}px`)
      box.style.setProperty('--table-foot-h', `${table.tFoot?.getBoundingClientRect().height ?? 0}px`)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(table)
    return () => {
      observer?.disconnect()
      box.style.removeProperty('--table-head-h')
      box.style.removeProperty('--table-foot-h')
    }
    // `ref` only for the lint rule: TableScroll's table lives as long as its box (the contract).
  }, [ref])
}

/**
 * Scroll `box` — never the page — just far enough that `row` shows inside the band the box's
 * pinned lines leave (spec §4.5): below the sticky header (`--table-head-h`) plus `extraTop` (a
 * pinned group line, such as a dividend month), and above the pinned footer (`--table-foot-h`). A
 * row already inside the band stays put; a row taller than the band is aligned by its top. Returns
 * whether it scrolled. Not scrollIntoView: that scrolls every scrollable ancestor too — the page
 * among them — which would carry the entry form, and the caret in it, out of view mid-session.
 */
export function revealInBox(box: HTMLElement, row: HTMLElement, extraTop = 0): boolean {
  const view = box.getBoundingClientRect()
  const head = parseFloat(box.style.getPropertyValue('--table-head-h')) || 0
  const foot = parseFloat(box.style.getPropertyValue('--table-foot-h')) || 0
  // clientTop + clientHeight, not the rect's bottom: a sideways scrollbar sits inside the rect.
  const top = view.top + box.clientTop + head + extraTop
  const bottom = view.top + box.clientTop + box.clientHeight - foot
  const r = row.getBoundingClientRect()
  if (r.top < top) {
    box.scrollTop -= top - r.top
    return true
  }
  if (r.bottom > bottom) {
    box.scrollTop += Math.min(r.bottom - bottom, r.top - top)
    return true
  }
  return false
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/tableScrollDom.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Lint, then commit**

```bash
npx eslint src/components/tableScrollDom.ts src/components/tableScrollDom.test.ts
git add src/components/tableScrollDom.ts src/components/tableScrollDom.test.ts
git commit -m "feat(tables): useStickyInsets measures a capped table's pinned header and totals rows onto its box, and revealInBox scrolls the box — never the page — to show a row clear of them (table-scroll spec §2.4, §4.5)"
```

---

### Task 3: `TableScroll`, its stylesheet, and the inset focus ring

> **Amended in execution (2026-09-24; the committed files are authoritative, the blocks below are the
> first draft):** a61d90be moved the print release to `index.css` as `@media print { :root :is(…) }`
> (tableScroll.css loads lazily with route chunks, and cap sheets can load after it at equal
> specificity); 485287d0 replaced the box's `scroll-padding` with `scroll-margin` on
> `.table-scroll > table > tbody *` (padding treated the pinned header's own controls as out of view and
> jumped the box on their focus — 240px per Tab on a sort header), made pinned cells `position: static`
> and dropped the edge mask on paper, and drops the edge mask while the box has `:focus-visible` (a mask
> clips the focus ring). A fourth TableScroll test pins the 'xy' wiring.

**Files:**
- Create: `src/components/TableScroll.tsx`, `src/components/tableScroll.css`
- Modify: `src/index.css` (the inset focus-ring rule, ~line 179)
- Test: `src/components/TableScroll.test.tsx`, `src/components/tableScrollCss.test.ts` (new),
  `src/focusCss.test.ts` (modify)

- [ ] **Step 1: Write the failing tests**

Create `src/components/TableScroll.test.tsx`:

```tsx
import { cleanup, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import TableScroll from './TableScroll'

afterEach(cleanup)

describe('TableScroll', () => {
  it('is a named region a keyboard can reach, around its table, keeping the old wrapper class', () => {
    render(
      <TableScroll label="Holdings table" className="holdings-scroll">
        <table>
          <thead><tr><th>Ticker</th></tr></thead>
          <tbody><tr><td>NVDA</td></tr></tbody>
        </table>
      </TableScroll>,
    )
    const box = screen.getByRole('region', { name: 'Holdings table' })
    expect(box.className).toBe('table-scroll holdings-scroll')
    expect(box.tabIndex).toBe(0)
    expect(box.querySelector(':scope > table')).toBe(screen.getByRole('table'))
  })

  it('carries only its own class when given none', () => {
    render(
      <TableScroll label="Accounts table">
        <table><tbody><tr><td>x</td></tr></tbody></table>
      </TableScroll>,
    )
    expect(screen.getByRole('region', { name: 'Accounts table' }).className).toBe('table-scroll')
  })

  it('hands its box to a ref, with the pinned-row heights written on it', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <TableScroll label="Dividends by month" ref={ref}>
        <table>
          <thead><tr><th>a</th></tr></thead>
          <tbody><tr><td>b</td></tr></tbody>
        </table>
      </TableScroll>,
    )
    expect(ref.current).toBe(screen.getByRole('region', { name: 'Dividends by month' }))
    // jsdom lays nothing out, so both read 0px: here only their presence matters — the values are
    // tableScrollDom.test.ts's.
    expect(ref.current!.style.getPropertyValue('--table-head-h')).toBe('0px')
    expect(ref.current!.style.getPropertyValue('--table-foot-h')).toBe('0px')
  })
})
```

Create `src/components/tableScrollCss.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (surfaceGrammar.test.ts's idiom): a pin survives a re-indent
// and a comment moving, and fails only when a declaration actually changes. jsdom computes none of
// these rules, so the text is what can be held to the spec (2026-09-24 table-scroll §2.2, §2.5).
const CSS = readFileSync(path.join(__dirname, 'tableScroll.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')

describe('the capped table box (tableScroll.css)', () => {
  it("caps at the vesting schedule's clamp and scrolls both ways", () => {
    expect(CSS).toMatch(/\.table-scroll \{[^}]*max-height: clamp\(420px, 60vh, 720px\);[^}]*overflow: auto;/)
  })

  it('keeps a Tab or a reveal clear of the pinned rows', () => {
    expect(CSS).toMatch(/\.table-scroll \{[^}]*scroll-padding-top: calc\(var\(--table-head-h, 0px\) \+ 4px\);/)
    expect(CSS).toMatch(/\.table-scroll \{[^}]*scroll-padding-bottom: calc\(var\(--table-foot-h, 0px\) \+ 4px\);/)
  })

  it('draws separate borders, so a stuck header cell carries its own hairline', () => {
    expect(CSS).toContain('.table-scroll > table { border-collapse: separate; border-spacing: 0; }')
  })

  it('pins the header cells at z 1 on the card surface, and the two-axis corners at z 2', () => {
    expect(CSS).toContain(
      '.table-scroll > table > thead th { position: sticky; top: 0; z-index: 1; background: var(--surface); }',
    )
    expect(CSS).toContain(
      '.table-scroll > table > thead th.col-identity, .table-scroll > table:has(td.row-actions) > thead th:last-child { z-index: 2; }',
    )
  })

  it('pins the totals row at the foot with a hairline above it', () => {
    expect(CSS).toContain(
      '.table-scroll > table > tfoot :is(td, th) { position: sticky; bottom: 0; z-index: 1; background: var(--surface); box-shadow: 0 -1px 0 var(--border); }',
    )
  })

  it('fades the foot only while rows hide below and no totals row marks the edge', () => {
    expect(CSS).toMatch(/\.table-scroll::after \{[^}]*position: sticky;[^}]*bottom: 0;[^}]*opacity: 0;/)
    expect(CSS).toContain(
      '.table-scroll[data-scroll-more~="bottom"]:not(:has(> table > tfoot))::after { opacity: 1; }',
    )
    expect(CSS).toContain('@media (forced-colors: active) { .table-scroll::after { display: none; } }')
  })

  it('releases every capped box on paper, the older four included', () => {
    expect(CSS).toContain(
      '@media print { .table-scroll, .settings-scroll, .categories-scroll, .vest-scroll, .chart-table-scroll { max-height: none; overflow: visible; }',
    )
  })
})
```

In `src/focusCss.test.ts`, inside `describe('the ring inside a clipping scroll container (index.css)'`,
change the container list of the first test to include the new box:

```ts
    for (const container of ['.attention-strip', '.settings-scroll', '.categories-scroll', '.table-scroll']) {
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/TableScroll.test.tsx src/components/tableScrollCss.test.ts src/focusCss.test.ts`
Expected: FAIL — `./TableScroll` does not resolve, `tableScroll.css` is not found (ENOENT), and the
focus test reports the missing `.table-scroll` container.

- [ ] **Step 3: Implement the component**

Create `src/components/TableScroll.tsx`:

```tsx
import { useImperativeHandle, useRef } from 'react'
import type { ReactNode, Ref } from 'react'
import { useStickyInsets } from './tableScrollDom'
import { useScrollEdges } from './useScrollEdges'
import './tableScroll.css'

// THE capped table box (2026-09-24 table-scroll spec §2). A long table scrolls inside its card at
// the vesting schedule's cap — clamp(420px, 60vh, 720px) — with its header row pinned, a totals row
// pinned where it has one and a fade on the edge that still hides rows, instead of making the page
// thousands of pixels tall (the dividend ledger measured 16,733px on production). A table shorter
// than the cap renders exactly as it did. A COMPONENT rather than hook calls in each panel
// (HoldingsScroll's reasoning, which this replaces): most ledgers render their table only once rows
// exist, and a hook keyed on a stable ref in the panel body would run against a null element at mount
// and never re-arm — mounting the box mounts the hooks with it. Contract: exactly one <table> as the
// direct child, living as long as the box.
export default function TableScroll({
  label,
  className,
  children,
  ref,
}: {
  /** Names the box for screen readers — "Holdings table, region". */
  label: string
  /** The old wrapper's class (holdings-scroll, matrix-scroll…): its sideways rules, and the tests
   *  that find a table by it, keep working. */
  className?: string
  children: ReactNode
  /** React 19 ref-as-prop (ClassificationEditor's idiom), for a caller that scrolls the box itself. */
  ref?: Ref<HTMLDivElement>
}) {
  const own = useRef<HTMLDivElement>(null)
  useScrollEdges(own, true, 'xy')
  useStickyInsets(own)
  // The box always renders, so the handle is simply the element.
  useImperativeHandle(ref, () => own.current as HTMLDivElement, [])
  return (
    // tabIndex 0: a read-only table holds nothing focusable, so without it a keyboard could not
    // scroll the box at all; index.css's :where(…, [tabindex]):focus-visible ring draws its focus.
    <div
      ref={own}
      className={className === undefined ? 'table-scroll' : `table-scroll ${className}`}
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      {children}
    </div>
  )
}
```

If `npx eslint src/components/TableScroll.tsx` reports `react-hooks/refs` on the
`useImperativeHandle` line, replace that line and the `ref={own}` prop with a callback ref (same
behaviour, no ref read outside a callback):

```tsx
  const setBox = useCallback(
    (node: HTMLDivElement | null) => {
      own.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref],
  )
  // …and on the div: ref={setBox}   (import useCallback instead of useImperativeHandle)
```

- [ ] **Step 4: Implement the stylesheet**

Create `src/components/tableScroll.css`:

```css
/* THE capped table box (2026-09-24 table-scroll spec §2.2), TableScroll's own sheet. A long table
   scrolls inside its card instead of down the page; one that fits renders as it always did —
   max-height only bites when the table outgrows it. The cap is the vesting schedule's
   (CompPage.css, 2026-09-13 polish §7): one scroll usually suffices on a tall screen, and a short
   one still gets a box rather than a card that swallows the page. Scroll chaining is the browser's
   default: at the box's end the wheel carries on down the page, so nothing traps it.
   --table-head-h / --table-foot-h are the pinned rows' measured heights (tableScrollDom.ts): the
   padding keeps a Tab, a keyboard reorder or a reveal clear of them, with room for an outside ring. */
.table-scroll {
  max-height: clamp(420px, 60vh, 720px);
  overflow: auto;
  scroll-padding-top: calc(var(--table-head-h, 0px) + 4px);
  scroll-padding-bottom: calc(var(--table-foot-h, 0px) + 4px);
}

/* The reorder tables' border model (reorder.css), for every capped table: a collapsed border belongs
   to the table's grid and stays behind when its cell sticks, so a pinned header would float
   hairline-less over the rows. Separate borders with zero spacing give each cell its own
   border-bottom — every target table draws bottom borders only, so the resting table still shows
   one hairline per row boundary. */
.table-scroll > table {
  border-collapse: separate;
  border-spacing: 0;
}

/* The pinned header: the card's own solid surface, or the rows would ghost through it. z 1 like
   .settings-scroll's and .categories-scroll's, so a lifted reorder row (z 2, reorder.css) still
   paints over it as lane R7 accepted. These rules live here, not in panels.css: the pinned-column
   rules there are pinned verbatim by surfaceGrammar.test.ts. */
.table-scroll > table > thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--surface);
}

/* The two corners that stick on both axes — the identity column's header and the last header cell
   of a table with pinned row actions — sit above the body cells pinned on the same axis (col-identity
   is z 1 and later in the DOM, so it would otherwise paint over its own header). */
.table-scroll > table > thead th.col-identity,
.table-scroll > table:has(td.row-actions) > thead th:last-child {
  z-index: 2;
}

/* The pinned totals row (Net worth's, the rewards matrix's). Its top hairline is an OUTER shadow: at
   rest it lands exactly on the last body row's own bottom border (one line); stuck, it draws the
   edge the scrolling rows pass under. */
.table-scroll > table > tfoot :is(td, th) {
  position: sticky;
  bottom: 0;
  z-index: 1;
  background: var(--surface);
  box-shadow: 0 -1px 0 var(--border);
}

.table-scroll > table > tfoot .col-identity {
  z-index: 2;
  box-shadow: 0 -1px 0 var(--border), 1px 0 0 var(--border);
}

/* "More below": a fade stuck to the box's foot while rows hide there. A child of the box, so it does
   not compete with the box's own horizontal mask (panels.css); sticky on both axes, so a table that
   also scrolls sideways keeps it in view. Hidden at the end (the last row is never faded) and
   wherever a pinned totals row already marks that edge. The top edge needs no cue: the pinned
   header is the edge. */
.table-scroll::after {
  content: '';
  position: sticky;
  left: 0;
  bottom: 0;
  z-index: 1;
  display: block;
  height: 28px;
  margin-top: -28px;
  pointer-events: none;
  background: linear-gradient(to bottom, transparent, var(--surface));
  opacity: 0;
}

.table-scroll[data-scroll-more~="bottom"]:not(:has(> table > tfoot))::after {
  opacity: 1;
}

@media (prefers-reduced-motion: no-preference) {
  .table-scroll::after {
    transition: opacity var(--t-fast) var(--ease-out);
  }
}

/* Forced colours drop author backgrounds; a gradient left alone there reads as a smear. */
@media (forced-colors: active) {
  .table-scroll::after {
    display: none;
  }
}

/* Paper has no scroller: every capped box prints whole — the four older caps too, which until now
   printed only their visible slice (spec §2.5). Listed here so their own sheets stay untouched. */
@media print {
  .table-scroll,
  .settings-scroll,
  .categories-scroll,
  .vest-scroll,
  .chart-table-scroll {
    max-height: none;
    overflow: visible;
  }

  .table-scroll::after {
    display: none;
  }
}
```

- [ ] **Step 5: Add the box to the inset focus-ring rule**

In `src/index.css`, change the rule (currently
`:is(.attention-strip, .settings-scroll, .categories-scroll) :is(a, button, .button):focus-visible {`)
to:

```css
:is(.attention-strip, .settings-scroll, .categories-scroll, .table-scroll) :is(a, button, .button):focus-visible {
  outline-offset: -2px;
}
```

and append this sentence to the end of the comment directly above it (before `*/`):
` Every capped table box (TableScroll, 2026-09-24) clips the same way, so it is listed too.`

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/TableScroll.test.tsx src/components/tableScrollCss.test.ts src/focusCss.test.ts src/components/surfaceGrammar.test.ts`
Expected: all pass (surfaceGrammar untouched and still green).

- [ ] **Step 7: Lint, type-check, commit**

```bash
npx eslint src/components/TableScroll.tsx src/components/TableScroll.test.tsx src/components/tableScrollCss.test.ts src/focusCss.test.ts
npx tsc -b && echo TSC-OK
git add src/components/TableScroll.tsx src/components/TableScroll.test.tsx src/components/tableScroll.css src/components/tableScrollCss.test.ts src/index.css src/focusCss.test.ts
git commit -m "feat(tables): TableScroll — the capped table box: clamp(420px, 60vh, 720px), pinned header and totals row on separate borders, a fade while rows hide below, a named keyboard-reachable region with the inset focus ring, and every capped box printing whole (table-scroll spec §2)"
```

---

### Task 4: The two ledgers — Transactions and Securities

**Files:**
- Modify: `src/components/portfolio/TransactionsPanel.tsx` (import line 29; the wrapper at ~686 and ~747)
- Modify: `src/components/portfolio/SecuritiesPanel.tsx` (import line 11; the wrapper at ~273 and ~334)
- Delete: `src/components/portfolio/HoldingsScroll.tsx`
- Test: `src/components/portfolio/TransactionsPanel.test.tsx:287-293`, `src/components/portfolio/SecuritiesPanel.test.tsx:128-134`

- [ ] **Step 1: Extend the two wrapper tests (failing)**

In `TransactionsPanel.test.tsx`, the test `'keeps the ledger in a .holdings-scroll scroller so the
sticky row actions can pin (2026-09-13 polish §7)'` — append after its last `expect`:

```ts
    // …and that scroller is the capped table box (2026-09-24 table-scroll spec §3.2): a named region a
    // keyboard can reach, so the ledger scrolls inside its card instead of down the page.
    expect(scroller.classList.contains('table-scroll')).toBe(true)
    expect(screen.getByRole('region', { name: 'Transactions table' })).toBe(scroller)
```

In `SecuritiesPanel.test.tsx`, the same-named test — append:

```ts
    // …and that scroller is the capped table box (2026-09-24 table-scroll spec §3.3).
    expect(scroller.classList.contains('table-scroll')).toBe(true)
    expect(screen.getByRole('region', { name: 'Securities table' })).toBe(scroller)
```

(Both files already import `screen` from `@testing-library/react`; if one does not, add it to that
import.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/portfolio/TransactionsPanel.test.tsx src/components/portfolio/SecuritiesPanel.test.tsx`
Expected: the two extended tests FAIL (no `table-scroll` class / no such region); the rest pass.

- [ ] **Step 3: Swap the wrapper**

`TransactionsPanel.tsx`: replace the line `import HoldingsScroll from './HoldingsScroll'` with
`import TableScroll from '../TableScroll'`; replace
`<HoldingsScroll><table className="port-table reorder-table">` with
`<TableScroll className="holdings-scroll" label="Transactions table"><table className="port-table reorder-table">`;
replace `</table></HoldingsScroll>` with `</table></TableScroll>`.

`SecuritiesPanel.tsx`: replace `import HoldingsScroll from './HoldingsScroll'` with
`import TableScroll from '../TableScroll'`; replace `<HoldingsScroll><table className="port-table">`
with `<TableScroll className="holdings-scroll" label="Securities table"><table className="port-table">`;
replace `</table></HoldingsScroll>` with `</table></TableScroll>`.

Delete the old component (both callers import `portfolio.css` themselves, so nothing loses its sheet):

```bash
git rm src/components/portfolio/HoldingsScroll.tsx
grep -rn "HoldingsScroll" src && echo "STILL REFERENCED" || echo "no references"
```
Expected: `no references`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/components/portfolio/TransactionsPanel.test.tsx src/components/portfolio/SecuritiesPanel.test.tsx src/pages/PortfolioPage.test.tsx`
Expected: all pass.

- [ ] **Step 5: Lint, type-check, commit**

```bash
npx eslint src/components/portfolio/TransactionsPanel.tsx src/components/portfolio/SecuritiesPanel.tsx src/components/portfolio/TransactionsPanel.test.tsx src/components/portfolio/SecuritiesPanel.test.tsx
npx tsc -b && echo TSC-OK
git add -A src/components/portfolio
git commit -m "feat(tables): the transactions and securities ledgers scroll inside the capped box (80 and 87 rows on production) — HoldingsScroll retired into TableScroll; a drag now auto-scrolls the box, not the page (table-scroll spec §3.2–§3.3)"
```

---

### Task 5: Holdings and Security classifications

**Files:**
- Modify: `src/components/portfolio/HoldingsTable.tsx` (imports; wrapper at line 83 and its `</div>` at ~188)
- Modify: `src/components/portfolio/ClassificationEditor.tsx` (imports; the focus effect ~51-57; wrapper at ~87-93)
- Test: `src/components/portfolio/HoldingsTable.test.tsx`, `src/components/portfolio/ClassificationEditor.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to the `describe('HoldingsTable'` block in `HoldingsTable.test.tsx`:

```tsx
  it('scrolls inside a capped, named box rather than down the page (2026-09-24 table-scroll spec §3.4)', () => {
    render(<HoldingsTable holdings={rows} sparklines={{}} />)
    const box = screen.getByRole('region', { name: 'Holdings table' })
    expect(box.className).toBe('table-scroll holdings-scroll')
    expect(box.querySelector(':scope > table.port-table')).toBe(screen.getByRole('table'))
  })
```

Append to the last `describe` block in `ClassificationEditor.test.tsx` (the one holding the
`focusUnclassified()` test):

```tsx
  it('focusUnclassified() brings the capped box back to its first row (2026-09-24 table-scroll spec §3.5)', () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true })
    try {
      const handle = createRef<ClassificationEditorHandle>()
      render(<ClassificationEditor ref={handle} classifications={[fund, stock]} onChanged={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /^All/ }))
      const box = screen.getByRole('region', { name: 'Security classifications table' })
      box.scrollTop = 240 // the reader had scrolled the box down the All list
      act(() => handle.current?.focusUnclassified())
      // preventScroll keeps the page still, so the box has to bring the first row back itself.
      expect(box.scrollTop).toBe(0)
      expect(document.activeElement).toBe(screen.getByLabelText('FUND asset class'))
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/portfolio/HoldingsTable.test.tsx src/components/portfolio/ClassificationEditor.test.tsx`
Expected: the two new tests FAIL (no such region).

- [ ] **Step 3: Wrap Holdings**

`HoldingsTable.tsx`: add `import TableScroll from '../TableScroll'` directly after
`import { isStaleQuote } from '../../utils/staleness'`. Replace the opening
`    <div className="holdings-scroll">` (the `return (` block) with
`    <TableScroll className="holdings-scroll" label="Holdings table">`, and the matching closing
`    </div>` (the line after `      </table>`, just before `  )` / `}` at the end of the file) with
`    </TableScroll>`.

- [ ] **Step 4: Wrap Classifications and fix the focus**

`ClassificationEditor.tsx`: add `import TableScroll from '../TableScroll'` directly after
`import { useToast } from '../ToastProvider'`. Replace
`      : <div className="holdings-scroll"><table className="port-table classification-table">` with
`      : <TableScroll className="holdings-scroll" label="Security classifications table"><table className="port-table classification-table">`,
and `        </table></div>}` with `        </table></TableScroll>}`.

Replace the focus effect:

```tsx
  // The focus has to wait for the commit that renders the Unclassified rows — an effect keyed on
  // the tick IS that commit. DOM focus only; no state is written here (react-hooks v7).
  useEffect(() => {
    if (focusTick === 0) return
    rootRef.current
      ?.querySelector<HTMLSelectElement>('tbody select[data-field="asset_class"]')
      ?.focus({ preventScroll: true })
  }, [focusTick])
```

with:

```tsx
  // The focus has to wait for the commit that renders the Unclassified rows — an effect keyed on
  // the tick IS that commit. DOM focus and a scroll only; no state is written here (react-hooks v7).
  // The filtered list's first row is the capped box's first row (2026-09-24 table-scroll spec §3.5):
  // a box the reader had scrolled down would hold it out of view, and preventScroll moves neither
  // the box nor the page — so the box goes back to its top first.
  useEffect(() => {
    if (focusTick === 0) return
    const root = rootRef.current
    const box = root?.querySelector<HTMLElement>('.table-scroll')
    if (box) box.scrollTop = 0
    root?.querySelector<HTMLSelectElement>('tbody select[data-field="asset_class"]')?.focus({ preventScroll: true })
  }, [focusTick])
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/components/portfolio/HoldingsTable.test.tsx src/components/portfolio/ClassificationEditor.test.tsx src/components/portfolio/AllocationPanel.test.tsx`
Expected: all pass (AllocationPanel's `region 'Security classifications'` lookup still finds the card:
the box's name is `'Security classifications table'`, a different exact name).

- [ ] **Step 6: Lint, type-check, commit**

```bash
npx eslint src/components/portfolio/HoldingsTable.tsx src/components/portfolio/ClassificationEditor.tsx src/components/portfolio/HoldingsTable.test.tsx src/components/portfolio/ClassificationEditor.test.tsx
npx tsc -b && echo TSC-OK
git add src/components/portfolio/HoldingsTable.tsx src/components/portfolio/ClassificationEditor.tsx src/components/portfolio/HoldingsTable.test.tsx src/components/portfolio/ClassificationEditor.test.tsx
git commit -m "feat(tables): holdings (73 rows on production) and security classifications (37) scroll inside the capped box, gaining the sideways edge masks their bare wrappers never had; 'Classify these' brings the box back to its first row before focusing it (table-scroll spec §3.4–§3.5)"
```

---

### Task 6: Net worth › Accounts and the Rewards matrix

**Files:**
- Modify: `src/pages/NetWorthPage.tsx` (imports ~line 18; the accounts `<table>` at ~870 and `</table>` at ~935)
- Modify: `src/components/creditcards/RewardsMatrix.tsx` (imports; wrapper at ~213 and its `</div>` at ~331)
- Test (both NEW files): `src/pages/NetWorthPage.tableScroll.test.tsx`, `src/components/creditcards/RewardsMatrix.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/pages/NetWorthPage.tableScroll.test.tsx` (its own file on purpose: `NetWorthPage.test.tsx`
is being rewritten by the concurrent correctness batch's lane T, and this pin must merge beside it
untouched):

```tsx
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearSnapshots } from '../api/snapshotCache'
import type { NetWorthSummary, NetWorthTimeseries } from '../types/api'
import NetWorthPage from './NetWorthPage'

// Its own file, not NetWorthPage.test.tsx: that file is being rewritten by the concurrent
// correctness batch (lane T), and this pin has to merge beside it untouched (2026-09-24
// table-scroll spec §5.2). The harness is that file's, trimmed to what the accounts table needs.
vi.mock('../api/netWorth', () => ({ fetchTimeseries: vi.fn(), fetchSummary: vi.fn() }))
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))
vi.mock('../api/coverage', () => ({ fetchCoverage: vi.fn() }))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law).
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return { default: () => createElement('div', { 'data-testid': 'echart' }) }
})

import { fetchSummary, fetchTimeseries } from '../api/netWorth'
import { fetchCoverage } from '../api/coverage'
import { fetchHousehold } from '../api/household'

const TIMESERIES: NetWorthTimeseries = {
  months: ['2026-07-01', '2026-08-01'],
  accounts: [
    {
      id: 1, name: 'My Checking', slug: 'my-checking', group: 'cash', sort_order: 1,
      is_active: true, is_component: false, parent_account_id: null, person_id: 1,
    },
    {
      id: 2, name: 'Joint Savings', slug: 'joint-savings', group: 'cash', sort_order: 2,
      is_active: true, is_component: false, parent_account_id: null, person_id: null,
    },
  ],
  series: [
    { account_id: 1, values: ['100.00', '150.00'] },
    { account_id: 2, values: ['70.00', '80.00'] },
  ],
  group_totals: {
    cash: ['170.00', '230.00'], pre_tax: ['0.00', '0.00'], post_tax: ['0.00', '0.00'],
    taxable: ['0.00', '0.00'], equity: ['0.00', '0.00'], other: ['0.00', '0.00'],
    liability: ['0.00', '0.00'],
  },
  net_worth: ['170.00', '230.00'],
  mom_pct: [null, '0.352941'],
  notes: [null, null],
  owner_series: [
    { person_id: 1, name: 'Me', values: ['100.00', '150.00'] },
    { person_id: null, name: null, values: ['70.00', '80.00'] },
  ],
}

const SUMMARY: NetWorthSummary = {
  month: '2026-08-01',
  net_worth: '230.00',
  mom_delta: '60.00',
  mom_pct: '0.352941',
  groups: [],
  owner_totals: [
    { person_id: 1, name: 'Me', total: '150.00' },
    { person_id: null, name: null, total: '80.00' },
  ],
}

beforeEach(() => {
  clearSnapshots()
  localStorage.clear()
  vi.mocked(fetchTimeseries).mockResolvedValue(TIMESERIES)
  vi.mocked(fetchSummary).mockResolvedValue(SUMMARY)
  vi.mocked(fetchHousehold).mockResolvedValue({ people: [{ id: 1, name: 'Me', is_primary: true }], marriage_date: null })
  vi.mocked(fetchCoverage).mockResolvedValue({ balances: ['2026-07-01', '2026-08-01'], spending: [], net_pay: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('scrolls the accounts table inside a capped, named box, its Net worth row pinned inside it (2026-09-24 table-scroll spec §3.6)', async () => {
  render(
    <MemoryRouter initialEntries={['/net-worth?section=accounts']}>
      <Routes>
        <Route path="/net-worth" element={<NetWorthPage />} />
      </Routes>
    </MemoryRouter>,
  )
  const box = await screen.findByRole('region', { name: 'Accounts table' })
  expect(box.className).toBe('table-scroll')
  const table = box.querySelector<HTMLElement>(':scope > table.data-table')!
  expect(within(table).getByRole('button', { name: 'My Checking' })).toBeTruthy()
  expect(await within(table).findByText('Net worth')).toBeTruthy()
  expect(table.querySelector('tfoot')?.textContent).toContain('Net worth')
})
```

Create `src/components/creditcards/RewardsMatrix.test.tsx`:

```tsx
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CreditCardOut, RewardCategoryOut, RewardRateOut } from '../../types/api'
import RewardsMatrix from './RewardsMatrix'
import { optimize, toMathCards, toMathCategories, toMathRates } from './rewardsMath'

afterEach(cleanup)

const CARD: CreditCardOut = {
  id: 1, name: 'SavorOne', slug: 'savorone', annual_fee: '0.00', rewards_currency: 'cash',
  point_value_cents: '1.0000', person_id: 1, primary_holder: null, authorized_users: null,
  opened_on: null, is_active: true, account_id: null, notes: null, sort_order: 1, credits: [],
  current_limit: null, limit_events: [],
}
const CATEGORY: RewardCategoryOut = {
  id: 1, name: 'Groceries', slug: 'groceries', sort_order: 1, is_active: true,
  annual_spend: '4000.00', spending_category_id: null, pinned_card_id: null,
}
const RATE: RewardRateOut = { id: 1, card_id: 1, category_id: 1, multiplier: '3', note: null, monthly_cap: null }

describe('RewardsMatrix', () => {
  it('scrolls inside a capped, named box with the Est. $/yr won row pinned inside it (2026-09-24 table-scroll spec §3.7)', () => {
    const weights = new Map<number, number | null>([[1, 4000]])
    const result = optimize(toMathCards([CARD]), toMathCategories([CATEGORY], weights), toMathRates([RATE]))
    render(
      <RewardsMatrix
        cards={[CARD]}
        categories={[CATEGORY]}
        rates={[RATE]}
        result={result}
        weights={weights}
        ownerNames={new Map([[1, 'Ed']])}
        busy={false}
        onCardClick={vi.fn()}
        onSaveRates={vi.fn()}
      />,
    )
    const box = screen.getByRole('region', { name: 'Rewards matrix' })
    expect(box.className).toBe('table-scroll matrix-scroll')
    expect(box.querySelector(':scope > table.rewards-matrix > tfoot')?.textContent).toContain('Est. $/yr won')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/pages/NetWorthPage.tableScroll.test.tsx src/components/creditcards/RewardsMatrix.test.tsx`
Expected: both FAIL (no `Accounts table` / `Rewards matrix` region).

- [ ] **Step 3: Wrap the Net worth accounts table — wrapper lines ONLY**

`NetWorthPage.tsx`: add `import TableScroll from '../components/TableScroll'` directly after
`import StatTile from '../components/StatTile'`.

Then insert exactly two lines and change NOTHING between them — do not re-indent the table. Lane T of
the concurrent batch edits these rows (spec lines 882–931); untouched lines let git merge both
branches cleanly. Before:

```tsx
                  <table className="data-table">
```

After:

```tsx
                  <TableScroll label="Accounts table">
                  <table className="data-table">
```

and before:

```tsx
                  </table>
                  <p className="drill-hint" style={{ marginTop: '0.5rem' }}>
```

after:

```tsx
                  </table>
                  </TableScroll>
                  <p className="drill-hint" style={{ marginTop: '0.5rem' }}>
```

(The commit message records why the wrapper sits flush with its child; reviewers: this is deliberate.)

- [ ] **Step 4: Wrap the Rewards matrix**

`RewardsMatrix.tsx`: add `import TableScroll from '../TableScroll'` directly after
`import InfoHint from '../InfoHint'`. Replace `      <div className="matrix-scroll">` with
`      <TableScroll className="matrix-scroll" label="Rewards matrix">`, and the closing lines

```tsx
          </tfoot>
        </table>
      </div>
```

with

```tsx
          </tfoot>
        </table>
      </TableScroll>
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/pages/NetWorthPage.tableScroll.test.tsx src/components/creditcards/RewardsMatrix.test.tsx src/pages/NetWorthPage.test.tsx src/pages/CreditCardsPage.test.tsx`
Expected: all pass.

- [ ] **Step 6: Lint, type-check, commit**

```bash
npx eslint src/pages/NetWorthPage.tsx src/pages/NetWorthPage.tableScroll.test.tsx src/components/creditcards/RewardsMatrix.tsx src/components/creditcards/RewardsMatrix.test.tsx
npx tsc -b && echo TSC-OK
git add src/pages/NetWorthPage.tsx src/pages/NetWorthPage.tableScroll.test.tsx src/components/creditcards/RewardsMatrix.tsx src/components/creditcards/RewardsMatrix.test.tsx
git commit -m "feat(tables): Net worth's accounts table and the rewards matrix scroll inside the capped box with their totals rows pinned at its foot (table-scroll spec §3.6–§3.7) — the accounts table's lines are deliberately NOT re-indented under the new wrapper: the concurrent correctness batch edits those rows, and untouched lines merge cleanly"
```

---

### Task 7: `dividendMonths.ts` — the ledger as months

> **Amended in execution (2026-09-24):** 6ff2b6af sums cents through the shared `toCents` (utils/cents.ts);
> 96553fa2 and the follow-up review commit reword the doc comments (the dividend chart sums floats and rounds
> once per month; the parity holds only for months inside its trailing window) and pin a future-dated month
> sorting first. The committed files are authoritative.

**Files:**
- Create: `src/components/portfolio/dividendMonths.ts`
- Test: `src/components/portfolio/dividendMonths.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/portfolio/dividendMonths.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DividendOut } from '../../types/api'
import { monthlyIncomeSums } from './dividendChartOptions'
import { entriesLabel, groupDividendsByMonth, monthKeyOf, monthsLabel } from './dividendMonths'

function entry(id: number, pay_date: string, amount: string): DividendOut {
  return {
    id, security_id: 1, account: null, pay_date, amount, source: 'manual',
    ex_date: null, per_share: null, shares_held: null, notes: null,
  }
}

// The API's order: pay_date desc, id desc.
const LEDGER = [
  entry(6, '2026-09-21', '0.44'),
  entry(5, '2026-09-02', '0.48'),
  entry(4, '2026-06-19', '8.20'),
  entry(3, '2025-12-31', '0.10'),
  entry(2, '2025-12-15', '0.20'),
  entry(1, '2025-12-01', '100.00'),
]

describe('groupDividendsByMonth', () => {
  it("groups by the Recorded date's month, newest month first, keeping each month's row order", () => {
    const months = groupDividendsByMonth(LEDGER)
    expect(months.map((m) => m.key)).toEqual(['2026-09', '2026-06', '2025-12'])
    expect(months.map((m) => m.label)).toEqual(['Sep 2026', 'Jun 2026', 'Dec 2025'])
    expect(months[2].rows.map((d) => d.id)).toEqual([3, 2, 1])
  })

  it('orders the months newest first even when the rows arrive unordered', () => {
    const months = groupDividendsByMonth([LEDGER[5], LEDGER[0], LEDGER[3]])
    expect(months.map((m) => m.key)).toEqual(['2026-09', '2025-12'])
    expect(months[1].rows.map((d) => d.id)).toEqual([1, 3])
  })

  it('totals each month in integer cents — no float drift', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in floats; the ledger says exactly $0.30.
    expect(groupDividendsByMonth([entry(1, '2026-01-05', '0.10'), entry(2, '2026-01-06', '0.20')])[0].totalCents).toBe(30)
    expect(groupDividendsByMonth(LEDGER).map((m) => m.totalCents)).toEqual([92, 820, 10030])
  })

  it('lists nothing for an empty ledger — a month with no entries is absent, never a $0 line', () => {
    expect(groupDividendsByMonth([])).toEqual([])
  })

  it("totals every month the chart above draws to the cent of its bar (monthlyIncomeSums' basis)", () => {
    const bars = monthlyIncomeSums(LEDGER, '2026-09-24')!
    for (const month of groupDividendsByMonth(LEDGER)) {
      const bar = bars.find((b) => b.month === `${month.key}-01`)!
      expect(month.totalCents / 100).toBe(bar.amount)
    }
  })
})

describe('the words around the months', () => {
  it('keys a date by its month', () => {
    expect(monthKeyOf('2026-09-21')).toBe('2026-09')
  })

  it('counts entries and months', () => {
    expect(entriesLabel(1)).toBe('1 entry')
    expect(entriesLabel(40)).toBe('40 entries')
    expect(monthsLabel(1)).toBe('1 month')
    expect(monthsLabel(14)).toBe('14 months')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/portfolio/dividendMonths.test.ts`
Expected: FAIL — `Failed to resolve import "./dividendMonths"`.

- [ ] **Step 3: Implement**

Create `src/components/portfolio/dividendMonths.ts`:

```ts
// The dividend ledger as months (2026-09-24 table-scroll spec §4.1) — pure, no React. Production's
// ledger held 378 entries over 14 months; grouped, the card is one line a month.
import type { DividendOut } from '../../types/api'
import { formatMonth } from '../../utils/format'

/** One month of the ledger. */
export interface DividendMonth {
  /** 'YYYY-MM' of the entries' pay_date — the Recorded date column, which is also
   *  monthlyIncomeSums' basis, so a month's total is its bar in the chart above the ledger. */
  key: string
  /** 'Sep 2026'. */
  label: string
  /** The month's entries in the order given (the API's pay_date desc, id desc). */
  rows: DividendOut[]
  /** Σ round(amount × 100): integer cents, so ten $0.10 entries total exactly $1.00. */
  totalCents: number
}

/** The ledger's months, newest first. A month with no entries is absent — never a $0 line. */
export function groupDividendsByMonth(dividends: readonly DividendOut[]): DividendMonth[] {
  const months = new Map<string, DividendMonth>()
  for (const d of dividends) {
    const key = monthKeyOf(d.pay_date)
    let month = months.get(key)
    if (month === undefined) {
      month = { key, label: formatMonth(`${key}-01`), rows: [], totalCents: 0 }
      months.set(key, month)
    }
    month.rows.push(d)
    month.totalCents += Math.round(Number(d.amount) * 100)
  }
  // 'YYYY-MM' sorts as text.
  return [...months.values()].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
}

/** 'YYYY-MM' of an ISO date: the grouping key, and the month a saved entry lands in. */
export function monthKeyOf(isoDate: string): string {
  return isoDate.slice(0, 7)
}

/** "1 entry", "40 entries" — the ledger's own word for a row (the chart says "dividend entries"). */
export function entriesLabel(count: number): string {
  return `${count} ${count === 1 ? 'entry' : 'entries'}`
}

/** "1 month", "14 months". */
export function monthsLabel(count: number): string {
  return `${count} ${count === 1 ? 'month' : 'months'}`
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/components/portfolio/dividendMonths.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Lint, commit**

```bash
npx eslint src/components/portfolio/dividendMonths.ts src/components/portfolio/dividendMonths.test.ts
git add src/components/portfolio/dividendMonths.ts src/components/portfolio/dividendMonths.test.ts
git commit -m "feat(dividends): the ledger as months — grouped by the Recorded date's month (the chart's basis, so a month's total is its bar), newest first, integer-cent totals (table-scroll spec §4.1)"
```

---

### Task 8: The dividend ledger by month, in its capped box

> **Amended before execution (2026-09-24, from the Task 3/5/7 reviews):** the box carries no
> `dividend-scroll` class; entry rows get a `scroll-margin-top` (never box `scroll-padding`); a focus or
> click on a covered (stacked) month line first scrolls its group into place (`uncoverMonth`); and the
> month that opens by itself is the newest on or before TODAY's (`defaultOpenMonth`, a new pure helper in
> `dividendMonths.ts` with its tests — Step 0 below), so a future-dated manual entry cannot fold the
> current month away.

**Files:**
- Modify: `src/components/portfolio/DividendsPanel.tsx`
- Modify: `src/components/portfolio/dividendMonths.ts`, `src/components/portfolio/dividendMonths.test.ts` (Step 0)
- Create: `src/components/portfolio/dividends.css`
- Test: `src/components/portfolio/DividendsPanel.test.tsx`

- [ ] **Step 0: `defaultOpenMonth` (test first)**

Append to `dividendMonths.test.ts` (and add `defaultOpenMonth` to its import from `./dividendMonths`):

```ts
describe('defaultOpenMonth', () => {
  it('opens the newest month on or before today — a future-dated entry does not fold the current month', () => {
    const months = groupDividendsByMonth([entry(9, '2026-10-15', '1.00'), ...LEDGER])
    expect(months[0].key).toBe('2026-10') // listed first all the same: the helper never hides an entry
    expect(defaultOpenMonth(months, '2026-09-24')).toBe('2026-09')
  })

  it('falls back to the newest month when every month is in the future, and to null for an empty ledger', () => {
    expect(defaultOpenMonth(groupDividendsByMonth([entry(9, '2026-10-15', '1.00')]), '2026-09-24')).toBe('2026-10')
    expect(defaultOpenMonth([], '2026-09-24')).toBeNull()
  })
})
```

Run it (FAIL: `defaultOpenMonth` is not exported), then append to `dividendMonths.ts`:

```ts
/** The month the ledger opens on by itself (spec §4.4): the newest on or before `todayIso`'s month —
 *  a future-dated manual entry (the form allows one) must not fold the current month away — else the
 *  newest; null for an empty ledger. `todayIso` injected, as monthlyIncomeSums takes it. */
export function defaultOpenMonth(months: readonly DividendMonth[], todayIso: string): string | null {
  const current = monthKeyOf(todayIso)
  return (months.find((month) => month.key <= current) ?? months[0])?.key ?? null
}
```

Run `npx vitest run src/components/portfolio/dividendMonths.test.ts` (all pass).

- [ ] **Step 1: Adjust the two existing tests that reach a now-folded month**

In `DividendsPanel.test.tsx`, add below the existing `vi.mock('../EChart', …)` block:

```ts
// revealInBox does geometry jsdom cannot lay out (its arithmetic is pinned in tableScrollDom.test.ts);
// here the question is only WHEN the panel asks for it, and with which box and row.
vi.mock('../tableScrollDom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tableScrollDom')>()),
  revealInBox: vi.fn(),
}))
import { revealInBox } from '../tableScrollDom'
```

In `'badges every row with its owner and spells out the resurrect rule'`, insert as the line after
`renderPanel([dividend(), AUTO])`:

```ts
    // The two rows sit in different months and only the newest opens by itself (2026-09-24
    // table-scroll spec §4.4) — open them all, as a reader looking for both would.
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
```

Replace the body of `"shows an auto row's per-share × shares and dashes a manual one"` with:

```ts
    renderPanel([dividend(), AUTO])
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    // Addressed by id: month lines now sit between the entry rows, so positions no longer name them.
    const manual = document.querySelector<HTMLElement>('tr[data-dividend-id="1"]')!
    const auto = document.querySelector<HTMLElement>('tr[data-dividend-id="2"]')!
    expect(within(manual).getByText('—')).toBeTruthy() // manual: no event provenance
    expect(within(auto).getByText('$0.82')).toBeTruthy()
    expect(within(auto).getByText('× 10')).toBeTruthy()
```

- [ ] **Step 2: Write the new tests (failing)**

Append to `DividendsPanel.test.tsx`:

```tsx
// Three months, newest first as the API sends them: June 2026 (two entries), March 2026, December 2025.
const JUNE_A = dividend({ id: 11, pay_date: '2026-06-19', amount: '0.10' })
const JUNE_B = dividend({ id: 12, pay_date: '2026-06-02', amount: '0.20' })
const MARCH = dividend({ id: 13, pay_date: '2026-03-10', amount: '5.00' })
const DECEMBER = dividend({ id: 14, pay_date: '2025-12-15', amount: '100.00' })
const LEDGER = [JUNE_A, JUNE_B, MARCH, DECEMBER]

const monthButton = (name: string) => screen.getByRole('button', { name })
const shownIds = () =>
  [...document.querySelectorAll('tr[data-dividend-id]')].map((row) => Number(row.getAttribute('data-dividend-id')))
const rectAt = (top: number, height: number) =>
  ({ top, bottom: top + height, height, left: 0, right: 800, width: 800, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

describe('DividendsPanel months (2026-09-24 table-scroll spec §4)', () => {
  it('lists one line per recorded month, newest first, with only the newest open', () => {
    renderPanel(LEDGER)
    const lines = [...document.querySelectorAll('.dividend-month-toggle')].map((b) => [
      b.textContent,
      b.getAttribute('aria-expanded'),
    ])
    expect(lines).toEqual([
      ['Jun 2026 2 entries', 'true'],
      ['Mar 2026 1 entry', 'false'],
      ['Dec 2025 1 entry', 'false'],
    ])
    expect(shownIds()).toEqual([11, 12])
    expect(screen.getByText('3 months · 4 entries')).toBeTruthy()
  })

  it('opens the current month by itself even when a future-dated entry is listed above it', () => {
    // 2099: after any real clock this suite runs on — no need to pin the date.
    renderPanel([dividend({ id: 20, pay_date: '2099-01-10', amount: '1.00' }), ...LEDGER])
    expect(monthButton('Jan 2099 1 entry').getAttribute('aria-expanded')).toBe('false')
    expect(monthButton('Jun 2026 2 entries').getAttribute('aria-expanded')).toBe('true')
    expect(shownIds()).toEqual([11, 12])
  })

  it("totals each month's entries to the cent on its line, under the Amount column", () => {
    renderPanel(LEDGER)
    const totals = [...document.querySelectorAll('.dividend-month-row')].map(
      (row) => row.querySelector('td.num')!.textContent,
    )
    // 0.10 + 0.20 is 0.30000000000000004 in floats; the line says $0.30.
    expect(totals).toEqual(['$0.30', '$5.00', '$100.00'])
  })

  it('opens and closes a month from its button or anywhere on its line — one toggle per press', () => {
    renderPanel(LEDGER)
    fireEvent.click(monthButton('Mar 2026 1 entry'))
    expect(monthButton('Mar 2026 1 entry').getAttribute('aria-expanded')).toBe('true')
    expect(shownIds()).toEqual([11, 12, 13])
    // The line's total cell is part of the target too.
    fireEvent.click(monthButton('Jun 2026 2 entries').closest('tr')!.querySelector('td.num')!)
    expect(monthButton('Jun 2026 2 entries').getAttribute('aria-expanded')).toBe('false')
    expect(shownIds()).toEqual([13])
  })

  it('Expand all opens every month and turns into Collapse all, which folds them all', () => {
    renderPanel(LEDGER)
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(shownIds()).toEqual([11, 12, 13, 14])
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(shownIds()).toEqual([])
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeTruthy()
  })

  it('offers no Expand all for a single month', () => {
    renderPanel([JUNE_A, JUNE_B])
    expect(screen.getByText('1 month · 2 entries')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /expand all|collapse all/i })).toBeNull()
  })

  it('opens the newest month when a cold ledger lands after the first render', () => {
    const view = renderPanel([])
    view.rerender(
      <DividendsPanel securities={securities} dividends={LEDGER} annualIncome="432.10" onChanged={() => {}} />,
    )
    expect(monthButton('Jun 2026 2 entries').getAttribute('aria-expanded')).toBe('true')
    expect(shownIds()).toEqual([11, 12])
  })

  it('keeps the months the reader opened when the ledger refreshes', () => {
    const view = renderPanel(LEDGER)
    fireEvent.click(monthButton('Dec 2025 1 entry'))
    view.rerender(
      <DividendsPanel securities={securities} dividends={[JUNE_A, MARCH, DECEMBER]} annualIncome="432.10" onChanged={() => {}} />,
    )
    expect(monthButton('Jun 2026 1 entry').getAttribute('aria-expanded')).toBe('true')
    expect(monthButton('Dec 2025 1 entry').getAttribute('aria-expanded')).toBe('true')
    expect(shownIds()).toEqual([11, 14])
  })

  it('scrolls inside a capped, named box', () => {
    renderPanel(LEDGER)
    const box = screen.getByRole('region', { name: 'Dividends by month' })
    expect(box.className).toBe('table-scroll')
    expect(box.querySelector(':scope > table')).toBe(screen.getByRole('table'))
  })

  it("scrolls the box to a month's start when its covered line takes focus or a click (spec §4.3)", () => {
    renderPanel(LEDGER)
    const box = screen.getByRole('region', { name: 'Dividends by month' })
    // jsdom lays nothing out: a 400px box at y=100 under a 30px header, scrolled deep into the ledger,
    // and March's group, whose line is stacked under a later month's — it began 70px above the band.
    box.style.setProperty('--table-head-h', '30px')
    box.getBoundingClientRect = () => rectAt(100, 400)
    const march = monthButton('Mar 2026 1 entry')
    march.closest('tbody')!.getBoundingClientRect = () => rectAt(60, 44)
    box.scrollTop = 900
    act(() => march.focus())
    expect(box.scrollTop).toBe(830) // the band starts at 100 + 30 = 130; the group began at 60
    // …and a click on the line does the same before it toggles.
    box.scrollTop = 900
    fireEvent.click(march.closest('tr')!.querySelector('td.num')!)
    expect(box.scrollTop).toBe(830)
    expect(march.getAttribute('aria-expanded')).toBe('true')
  })

  it('leaves the box alone when a month line already shows at its own place', () => {
    renderPanel(LEDGER)
    const box = screen.getByRole('region', { name: 'Dividends by month' })
    box.style.setProperty('--table-head-h', '30px')
    box.getBoundingClientRect = () => rectAt(100, 400)
    const march = monthButton('Mar 2026 1 entry')
    march.closest('tbody')!.getBoundingClientRect = () => rectAt(250, 44)
    box.scrollTop = 900
    act(() => march.focus())
    expect(box.scrollTop).toBe(900)
  })

  it('opens the month an added entry lands in, keeping the caret in the amount box', async () => {
    const onChanged = vi.fn()
    renderPanel(LEDGER, '432.10', onChanged)
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2025-12-20' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '4.10' } })
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(monthButton('Dec 2025 1 entry').getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(screen.getByLabelText('Amount'))
  })

  it('opens the month an edit moves an entry into', async () => {
    const onChanged = vi.fn()
    renderPanel(LEDGER, '432.10', onChanged)
    const june = document.querySelector<HTMLElement>('tr[data-dividend-id="11"]')!
    fireEvent.click(within(june).getByRole('button', { name: 'Edit this dividend' }))
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2026-03-31' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(monthButton('Mar 2026 1 entry').getAttribute('aria-expanded')).toBe('true')
  })

  it('brings a saved entry into view in the BOX once the refreshed ledger renders — not before, and once', async () => {
    const saved = dividend({ id: 15, pay_date: '2025-12-20', amount: '4.10' })
    vi.mocked(createDividend).mockResolvedValueOnce(saved)
    const onChanged = vi.fn()
    const view = renderPanel(LEDGER, '432.10', onChanged)
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2025-12-20' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '4.10' } })
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    // Its month is open, but the refetch has not landed: nothing to bring into view yet.
    expect(revealInBox).not.toHaveBeenCalled()
    view.rerender(
      <DividendsPanel securities={securities} dividends={[JUNE_A, JUNE_B, MARCH, saved, DECEMBER]} annualIncome="432.10" onChanged={onChanged} />,
    )
    const box = screen.getByRole('region', { name: 'Dividends by month' })
    expect(revealInBox).toHaveBeenCalledTimes(1)
    expect(vi.mocked(revealInBox).mock.calls[0][0]).toBe(box)
    expect(vi.mocked(revealInBox).mock.calls[0][1]).toBe(box.querySelector('tr[data-dividend-id="15"]'))
    // A later refresh does not scroll the box again.
    view.rerender(
      <DividendsPanel securities={securities} dividends={[...LEDGER]} annualIncome="432.10" onChanged={onChanged} />,
    )
    expect(revealInBox).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Run to verify the new tests fail**

Run: `npx vitest run src/components/portfolio/DividendsPanel.test.tsx`
Expected: the new `months` tests and the two adjusted tests FAIL (no month lines, no Expand all, no
region); the other existing tests PASS.

- [ ] **Step 4: Implement the panel**

In `src/components/portfolio/DividendsPanel.tsx`:

(a) Replace the import block's first line `import { useMemo, useState } from 'react'` with:

```ts
import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
```

add after `import StatTile from '../StatTile'`:

```ts
import TableScroll from '../TableScroll'
import { revealInBox } from '../tableScrollDom'
```

add after `import { incomeStats, monthlyIncomeCsv, monthlyIncomeOption } from './dividendChartOptions'`:

```ts
import { defaultOpenMonth, entriesLabel, groupDividendsByMonth, monthKeyOf, monthsLabel } from './dividendMonths'
```

and after `import './portfolio.css'`:

```ts
import './dividends.css'
```

(b) Directly after the line `const stats = incomeStats(dividends, todayIso())`, insert:

```tsx
  // The ledger as months (2026-09-24 table-scroll spec §4): 378 entries on production made this card
  // ~19 screens tall; grouped, it is one line a month inside a capped box.
  const months = useMemo(() => groupDividendsByMonth(dividends), [dividends])
  // One month open, the rest folded — the newest on or before today's (defaultOpenMonth: a
  // future-dated manual entry must not fold the current month away) — seeded the first time rows
  // exist: a cold load renders with none and seeds when the payload lands, a warm snapshot seeds at
  // mount. Adjusted during render (React's derived-state idiom, PortfolioPage's owner switch), never
  // in an effect. Not persisted: every visit opens on the current month.
  const firstOpen = defaultOpenMonth(months, todayIso())
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(firstOpen === null ? [] : [firstOpen]),
  )
  const [seeded, setSeeded] = useState(firstOpen !== null)
  if (!seeded && firstOpen !== null) {
    setSeeded(true)
    setOpen(new Set([firstOpen]))
  }
  const allOpen = months.every((month) => open.has(month.key))
  const toggleMonth = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const openMonth = (key: string) => setOpen((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
  // Passed month lines stack at one offset — the browser pins a table's sticky cells against the whole
  // table, not their row group (measured in Edge, 2026-09-24) — so the newest one passed covers the
  // rest (spec §4.3). A focus or click that lands on a line whose month began above the band first
  // scrolls the BOX until that month's group starts just under the column header: Shift+Tab back up
  // the ledger would otherwise rest on a toggle hidden under a later month's line, which the browser
  // will not scroll to because it counts as in view (WCAG 2.4.11), and collapsing the month you are
  // inside keeps your place instead of dropping you among the months below.
  const uncoverMonth = (group: HTMLElement | null) => {
    const box = boxRef.current
    if (box === null || group === null) return
    const head = parseFloat(box.style.getPropertyValue('--table-head-h')) || 0
    const bandTop = box.getBoundingClientRect().top + box.clientTop + head
    const top = group.getBoundingClientRect().top
    if (top < bandTop - 1) box.scrollTop -= bandTop - top
  }
  // A saved entry to bring into view once the refreshed ledger renders (spec §4.5): its id and the
  // ledger it was saved against. The commit that opens its month still holds that ledger and waits;
  // the refetch's commit (a new ledger) consumes it, found or not, so it can never fire on some later
  // render. A ref, not state: it is never drawn.
  const boxRef = useRef<HTMLDivElement>(null)
  const pendingReveal = useRef<{ id: number; ledger: DividendOut[] } | null>(null)
  useEffect(() => {
    const pending = pendingReveal.current
    if (pending === null || pending.ledger === dividends) return
    pendingReveal.current = null
    const box = boxRef.current
    const row = box?.querySelector<HTMLElement>(`tr[data-dividend-id="${pending.id}"]`)
    if (!box || !row) return
    // The month line pins under the column header, so the row lands below both.
    const monthLine = row.closest('tbody')?.querySelector<HTMLElement>('.dividend-month-row')
    revealInBox(box, row, monthLine?.getBoundingClientRect().height ?? 0)
  }, [dividends])
```

(c) In `submit`, the request chain currently begins `request\n      .then(() => {`. Change the callback's
parameter and add the month/reveal lines just before its closing `onChanged()`:

```tsx
    request
      .then((saved) => {
```

…(the existing `if (editingId === null) { … } else { … }` stays exactly as it is)…

```tsx
        // The entry's month opens — the month it was saved INTO, which an edit may have moved it to —
        // and once the refetched ledger renders, the box scrolls to it (spec §4.5). The id is the
        // response's (a create) or the row's own (an edit); the page never moves, so the caret the
        // create path just parked in the amount box stays in view.
        openMonth(monthKeyOf(body.pay_date))
        const id = typeof saved?.id === 'number' ? saved.id : editingId
        if (id !== null) pendingReveal.current = { id, ledger: dividends }
        onChanged()
```

(d) Replace the whole ledger block — from `      {dividends.length === 0 ? (` through its closing
`      )}` just before `    </section>` — with:

```tsx
      {dividends.length === 0 ? (
        <p className="empty-note">No dividends recorded.</p>
      ) : (
        <>
          <div className="dividend-months-bar">
            <p className="hint">
              {monthsLabel(months.length)} · {entriesLabel(dividends.length)}
            </p>
            {/* The find-in-page door: a folded month's rows are not rendered, so Ctrl+F reaches only
                what is open (spec §4.2). A single month has nothing to fold. */}
            {months.length > 1 && (
              <button
                type="button"
                className="button"
                onClick={() => setOpen(allOpen ? new Set() : new Set(months.map((month) => month.key)))}
              >
                {allOpen ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </div>
          <TableScroll label="Dividends by month" ref={boxRef}>
            <table className="port-table dividend-table">
              <thead>
                <tr>
                  <th>Ticker</th><th>Account</th><th>Recorded date</th>
                  <th className="num">Amount</th><th>Source</th>
                  <th className="num">Per share</th><th>Notes</th><th />
                </tr>
              </thead>
              {months.map((month) => {
                const isOpen = open.has(month.key)
                return (
                  // One row group per month inside ONE table: the column grid stays shared, so the
                  // amounts line up down the whole ledger.
                  <tbody key={month.key}>
                    {/* The whole line toggles for the mouse; the button is the keyboard's and the
                        screen reader's control — its click bubbles here, so one toggle per press. */}
                    <tr
                      className="dividend-month-row"
                      onClick={(event) => {
                        uncoverMonth(event.currentTarget.closest('tbody'))
                        toggleMonth(month.key)
                      }}
                    >
                      <th scope="rowgroup" colSpan={3}>
                        <button
                          type="button"
                          className="dividend-month-toggle"
                          aria-expanded={isOpen}
                          onFocus={(event) => uncoverMonth(event.currentTarget.closest('tbody'))}
                        >
                          <ChevronRight size={14} aria-hidden="true" className="dividend-month-chevron" />
                          <span className="dividend-month-label">{month.label}</span>{' '}
                          <span className="dividend-month-count">{entriesLabel(month.rows.length)}</span>
                        </button>
                      </th>
                      <td className="num">{formatCurrency(month.totalCents / 100)}</td>
                      <td colSpan={4} />
                    </tr>
                    {isOpen &&
                      month.rows.map((d) => (
                        <tr key={d.id} data-dividend-id={d.id}>
                          <td>{tickers.get(d.security_id) ?? '?'}</td>
                          <td>{d.account ?? '—'}</td>
                          <td>{formatDate(d.pay_date)}<span className="sub">{d.source === 'auto' ? ' · ex-date' : ' · entered pay date'}</span></td>
                          <td className="num">{formatCurrency(d.amount)}</td>
                          <td><span className="badge">{d.source === 'auto' ? 'auto' : 'manual'}</span></td>
                          <td className="num">
                            {d.per_share === null ? '—' : formatCurrency(d.per_share)}
                            {d.shares_held !== null && (
                              <span className="sub"> × {formatShares(d.shares_held)}</span>
                            )}
                          </td>
                          <td className="notes-cell">{d.notes ?? ''}</td>
                          {/* disabled={busy} on both: submit()'s .then closes over editingId and the
                              form as they were when it fired, so a row action taken mid-flight is
                              undone by the reset that lands after it — a seeded edit silently wiped,
                              or worse, a PATCH aimed at whatever editingId the closure still holds.
                              Shutting the row for the duration of a save is the cheap fix. */}
                          <td className="row-actions">
                            {/* aria-label: a row button named just "Edit"/"Delete" tells a
                                screen-reader user nothing about what it acts on. Delete needs it
                                MORE since the delete went instant (2026-08-25 polish §8): the
                                confirm() sentence that used to name the row before anything
                                happened is gone, so the button is the last chance to say it. */}
                            <button
                              type="button"
                              disabled={busy}
                              aria-label="Edit this dividend"
                              onClick={() => startEdit(d)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              aria-label="Delete this dividend"
                              onClick={() => remove(d)}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                )
              })}
            </table>
          </TableScroll>
        </>
      )}
```

- [ ] **Step 5: Add the month styles**

Create `src/components/portfolio/dividends.css`:

```css
/* The dividend ledger by month (2026-09-24 table-scroll spec §4). Imported by DividendsPanel after
   portfolio.css; the capped box itself is TableScroll's (tableScroll.css). */

/* "14 months · 378 entries" and the Expand all door, on the line above the box. */
.dividend-months-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin: 0.75rem 0 0.4rem;
}

.dividend-months-bar .hint {
  margin: 0;
}

/* A month line: an opaque band — a sticky cell needs a solid fill or the rows would ghost through —
   pinned just under the column header while its month scrolls (TableScroll measures that header into
   --table-head-h). z 1 like the header cells; later in the DOM, so it paints over the rows passing
   under it. */
.dividend-month-row > th,
.dividend-month-row > td {
  position: sticky;
  top: var(--table-head-h, 0px);
  z-index: 1;
  background: var(--surface-2);
  cursor: pointer;
}

/* Opaque on purpose (a translucent wash would let the rows under a pinned line show through). */
.dividend-month-row:hover > th,
.dividend-month-row:hover > td {
  background: color-mix(in srgb, var(--text) 6%, var(--surface-2));
}

.dividend-month-row > th {
  font-weight: 600;
  color: var(--text);
}

.dividend-month-row > td.num {
  font-weight: 600;
}

/* The toggle reads as the line's text, not as button chrome; index.css still draws the house focus
   ring on it, inset because the box clips. */
.dividend-month-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.dividend-month-count {
  color: var(--muted);
  font-weight: 400;
}

/* The Disclosure grammar's chevron (disclosure.css), turned by the button's own state. */
.dividend-month-chevron {
  flex: none;
}

.dividend-month-toggle[aria-expanded="true"] .dividend-month-chevron {
  transform: rotate(90deg);
}

@media (prefers-reduced-motion: no-preference) {
  .dividend-month-chevron {
    transition: transform var(--t-fast) var(--ease-out);
  }
}

/* Entries read as their month's children: the Ticker column steps in (component-row's 1.6rem), the
   header with it so the column still lines up. */
.dividend-table > thead th:first-child,
.dividend-table > tbody > tr:not(.dividend-month-row) > td:first-child {
  padding-left: 1.6rem;
}

/* An entry row sits under TWO pinned lines — the column header and its month's line — so a Tab, a
   keyboard move or a scrollIntoView lands it clear of both (2.5rem is at least one month line in
   either density). A scroll MARGIN on the entry rows, never scroll padding on the box: padding would
   count the pinned lines' own toggles as out of view and jump the box whenever one takes focus
   (TableScroll's review, 485287d0). (0,3,2) outranks tableScroll.css's (0,1,2) tbody margin. */
.table-scroll > .dividend-table > tbody > tr:not(.dividend-month-row) * {
  scroll-margin-top: calc(var(--table-head-h, 0px) + 2.5rem);
}
```

- [ ] **Step 6: Run to verify everything passes**

Run: `npx vitest run src/components/portfolio/DividendsPanel.test.tsx src/components/portfolio/dividendMonths.test.ts src/pages/PortfolioPage.test.tsx`
Expected: all pass.

- [ ] **Step 7: Lint, type-check, commit**

```bash
npx eslint src/components/portfolio/DividendsPanel.tsx src/components/portfolio/DividendsPanel.test.tsx
npx tsc -b && echo TSC-OK
git add src/components/portfolio/DividendsPanel.tsx src/components/portfolio/DividendsPanel.test.tsx src/components/portfolio/dividends.css
git commit -m "feat(dividends): the ledger reads by month inside its capped box — a pinned line per month with its entry count and cent-exact total, the newest month open, Expand all / Collapse all, and a saved entry's month opened and scrolled into view in the box without moving the page (table-scroll spec §4)"
```

---

### Task 9: The real-browser smoke — `tools/probes/table-scroll-v`

**Files:**
- Create: `tools/probes/table-scroll-v/smoke.mjs`
- Modify: `tools/probes/README.md` (a table row + a "Running" section)

- [ ] **Step 1: Write the smoke**

Create `tools/probes/table-scroll-v/smoke.mjs`:

```js
// tools/probes/table-scroll-v/smoke.mjs — the capped table boxes and the dividend months in a real
// browser (2026-09-24 table-scroll spec §6). Recipe: tools/probes/README.md.
// READ-ONLY BY CONSTRUCTION: every non-GET /api/v1 call is answered from memory (PATCH /prefs
// included) and recorded, so a dropped drag or a stray click persists nothing — and "nothing was
// sent" is itself a check. Judge it on a book whose tables are long: the spec's run used
// `finance_scroll`, a private copy of production (dividends 378 rows / 14 months, transactions 80,
// securities 87, holdings 73).
// Env: TOKEN_FILE (required), APP_BASE, API_BASE, SMOKE_OUT, EDGE_PATH, PLAYWRIGHT_CORE,
// ONLY_THEME (dark|light), ONLY_SIZE (1280|1600|1920), ONLY_TARGET (a TARGETS name).
// The first two lines spoof the node version: this box runs node 18, playwright-core wants 20.
Object.defineProperty(process, 'version', { value: 'v20.19.0' })
Object.defineProperty(process.versions, 'node', { value: '20.19.0' })
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_CORE ??
    'C:/Users/edyli/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core',
)
const OUT = process.env.SMOKE_OUT ?? path.join(process.cwd(), 'scratchpad', 'table-scroll-v')
mkdirSync(OUT, { recursive: true })
const TOKEN = readFileSync(process.env.TOKEN_FILE ?? path.join(OUT, 'token.txt'), 'utf8').trim()
const BASE = process.env.APP_BASE ?? 'http://localhost:5261'
const API = process.env.API_BASE ?? 'http://127.0.0.1:8061'
const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const SIZES = [
  { width: 1280, height: 800 },
  { width: 1600, height: 1000 },
  { width: 1920, height: 1080 },
].filter((s) => !process.env.ONLY_SIZE || String(s.width) === process.env.ONLY_SIZE)
const THEMES = ['dark', 'light'].filter((t) => !process.env.ONLY_THEME || t === process.env.ONLY_THEME)
// The seven boxes (spec §3). `foot`: the table pins a totals row. `prepare`: what puts the long
// version of the table on screen.
const TARGETS = [
  { name: 'dividends', url: '/portfolio?owner=all&section=income', label: 'Dividends by month', foot: false },
  { name: 'transactions', url: '/portfolio?owner=all&section=manage', label: 'Transactions table', foot: false },
  { name: 'securities', url: '/portfolio?owner=all&tab=securities', label: 'Securities table', foot: false },
  { name: 'holdings', url: '/portfolio?owner=all&section=holdings', label: 'Holdings table', foot: false },
  { name: 'classifications', url: '/portfolio?owner=all&section=allocation', label: 'Security classifications table', foot: false, prepare: 'all-chip' },
  { name: 'networth', url: '/net-worth?owner=all&section=accounts', label: 'Accounts table', foot: true },
  { name: 'rewards', url: '/credit-cards?owner=all&section=rewards', label: 'Rewards matrix', foot: true },
].filter((t) => !process.env.ONLY_TARGET || t.name === process.env.ONLY_TARGET)
const NOISE = /favicon|DevTools|\[vite\]|@vite\/client|React DevTools|React Router Future Flag/i
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const boxSel = (label) => `[role="region"][aria-label="${label}"]`
const report = { at: new Date().toISOString(), base: BASE, sizes: SIZES, themes: THEMES, checks: [], writesBlocked: [], problems: [] }
const check = (where, name, ok, observed) => {
  report.checks.push({ where, name, ok, observed })
  if (!ok) report.problems.push(`${where}: ${name} — observed ${JSON.stringify(observed)}`)
  return ok
}
const note = (where, name, observed) => report.checks.push({ where, name, ok: null, observed })

// Layout shifts from document start (CLS per load), and the app's own echarts module so the
// dividend chart's bars can be read off the live instance (pace-v's hook).
const INIT = `(() => {
  window.__cls = 0
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value
    }).observe({ type: 'layout-shift', buffered: true })
  } catch {}
  ;(async () => { try { const m = await import('/src/charts/echarts.ts'); window.__echarts = m.echarts } catch (e) { window.__hookError = String(e) } })()
})()`

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'] })
let page

async function makeContext(theme, size) {
  // Reduced motion zeroes the motion tokens, so the fade's opacity reads final at once.
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  await ctx.addInitScript(([t, th]) => {
    localStorage.setItem('finance_token', t)
    localStorage.setItem('finance.theme', th)
    localStorage.setItem('finance.chartDecals', 'off')
  }, [TOKEN, theme])
  await ctx.addInitScript(INIT)
  const themeEntry = { value: theme, updated_at: new Date().toISOString() }
  await ctx.route('**/api/v1/**', async (route) => {
    const req = route.request()
    const method = req.method()
    if (/\/api\/v1\/prefs/.test(req.url())) {
      if (method === 'GET') {
        let body = { prefs: {} }
        try {
          body = await (await route.fetch()).json()
        } catch {
          // the default stands
        }
        body.prefs = { ...body.prefs, theme: themeEntry }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ prefs: { theme: themeEntry } }) })
    }
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue()
    report.writesBlocked.push({ theme, method, url: req.url() })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  return ctx
}

/** Two animation frames: enough for a scroll event (and useScrollEdges' attribute) to land. */
const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

async function open(target) {
  await page.goto(BASE + target.url, { waitUntil: 'networkidle' })
  await sleep(1500)
  if (target.prepare === 'all-chip') {
    await page.locator('.classification-toolbar button', { hasText: /^All/ }).first().click()
    await sleep(400)
  }
  await page.locator(boxSel(target.label)).waitFor({ state: 'visible', timeout: 15000 })
  await sleep(300)
}

async function geometry(where, target) {
  const g = await page.evaluate((sel) => {
    const box = document.querySelector(sel)
    const table = box.querySelector(':scope > table')
    return {
      cls: box.className,
      tabIndex: box.tabIndex,
      height: box.getBoundingClientRect().height,
      tableHeight: table.getBoundingClientRect().height,
      overflows: box.scrollHeight > box.clientHeight + 1,
      cap: Math.min(720, Math.max(420, window.innerHeight * 0.6)),
      pageHeight: document.documentElement.scrollHeight,
      headH: box.style.getPropertyValue('--table-head-h'),
      footH: box.style.getPropertyValue('--table-foot-h'),
    }
  }, boxSel(target.label))
  note(where, 'page height with the box', { pageHeight: g.pageHeight, box: Math.round(g.height), table: Math.round(g.tableHeight) })
  check(where, 'the box is a table-scroll region a keyboard can reach', g.cls.split(' ').includes('table-scroll') && g.tabIndex === 0, g)
  check(where, 'the box is never taller than the cap', g.height <= g.cap + 1, g)
  if (g.tableHeight > g.cap + 1) check(where, 'a table taller than the cap fills exactly the cap', g.height >= g.cap - 1, g)
  else note(where, 'the table fits under the cap — rendered at its own height', g)
  check(where, 'the pinned-row heights are measured onto the box', /px$/.test(g.headH) && /px$/.test(g.footH), { headH: g.headH, footH: g.footH })
  return g
}

async function pins(where, target) {
  await page.evaluate((sel) => {
    const box = document.querySelector(sel)
    box.scrollIntoView({ block: 'center' })
    box.scrollTop = Math.round((box.scrollHeight - box.clientHeight) / 2)
  }, boxSel(target.label))
  await frames()
  await sleep(150)
  const p = await page.evaluate((sel) => {
    const box = document.querySelector(sel)
    const table = box.querySelector(':scope > table')
    const top = box.getBoundingClientRect().top + box.clientTop
    const bottom = top + box.clientHeight
    const heads = [...table.tHead.rows[0].cells]
    const first = heads[0].getBoundingClientRect()
    const hit = document.elementFromPoint(first.left + Math.min(first.width / 2, 24), first.top + first.height / 2)
    const footRow = table.tFoot ? table.tFoot.rows[table.tFoot.rows.length - 1] : null
    const card = box.closest('.card')
    return {
      scrollTop: box.scrollTop,
      headOff: Math.max(...heads.map((c) => Math.abs(c.getBoundingClientRect().top - top))),
      headWins: hit !== null && table.tHead.contains(hit),
      footOff: footRow ? Math.max(...[...footRow.cells].map((c) => Math.abs(c.getBoundingClientRect().bottom - bottom))) : null,
      headBg: getComputedStyle(heads[0]).backgroundColor,
      footBg: footRow ? getComputedStyle(footRow.cells[0]).backgroundColor : null,
      cardBg: card === null ? null : getComputedStyle(card).backgroundColor,
    }
  }, boxSel(target.label))
  check(where, 'mid-scroll, the header row sits at the top of the box', p.scrollTop > 0 && p.headOff <= 1, p)
  check(where, 'the pinned header paints over the rows sliding under it', p.headWins, p)
  check(where, "the pinned header wears the card's own surface", p.headBg === p.cardBg, p)
  if (target.foot) {
    check(where, 'mid-scroll, the totals row sits at the foot of the box', p.footOff !== null && p.footOff <= 1, p)
    check(where, "the pinned totals row wears the card's own surface", p.footBg === p.cardBg, p)
  }
  await page.locator(boxSel(target.label)).screenshot({ path: path.join(OUT, `${where.replace(/[^a-z0-9]+/gi, '-')}-mid.png`) })
}

async function fade(where, target) {
  const f = await page.evaluate(async (sel) => {
    const box = document.querySelector(sel)
    const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const read = () => getComputedStyle(box, '::after').opacity
    box.scrollTop = 0
    await settle()
    const atTop = read()
    box.scrollTop = box.scrollHeight
    await settle()
    const atEnd = read()
    box.scrollTop = 0
    return { atTop, atEnd }
  }, boxSel(target.label))
  if (target.foot) check(where, 'no fade where a pinned totals row marks the edge', f.atTop === '0' && f.atEnd === '0', f)
  else check(where, 'the foot fades while rows hide below, and not at the end', f.atTop === '1' && f.atEnd === '0', f)
}

async function keyboard(where, target) {
  // A keyboard interaction first, so the scripted focus below counts as :focus-visible.
  await page.keyboard.press('Tab')
  await page.evaluate((sel) => {
    const box = document.querySelector(sel)
    box.scrollIntoView({ block: 'center' })
    box.scrollTop = 0
    box.focus()
  }, boxSel(target.label))
  const ring = await page.evaluate((sel) => {
    const box = document.querySelector(sel)
    return { focused: document.activeElement === box, visible: box.matches(':focus-visible'), outline: getComputedStyle(box).outlineStyle }
  }, boxSel(target.label))
  check(where, 'the focused box shows the focus ring', ring.focused && ring.visible && ring.outline !== 'none', ring)
  await page.keyboard.press('PageDown')
  await sleep(300)
  const after = await page.evaluate((sel) => document.querySelector(sel).scrollTop, boxSel(target.label))
  check(where, 'PageDown scrolls the focused box', after > 0, { scrollTop: after })
}

async function wheel(where, target) {
  const start = await page.evaluate((sel) => {
    const box = document.querySelector(sel)
    window.scrollTo(0, 0)
    box.scrollIntoView({ block: 'start' })
    box.scrollTop = box.scrollHeight
    const r = box.getBoundingClientRect()
    return {
      x: r.left + r.width / 2,
      y: (Math.max(r.top, 0) + Math.min(r.bottom, window.innerHeight)) / 2,
      y0: window.scrollY,
      canScroll: window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 1,
    }
  }, boxSel(target.label))
  await page.mouse.move(start.x, start.y)
  await page.mouse.wheel(0, 400)
  await sleep(500)
  const y1 = await page.evaluate(() => window.scrollY)
  if (start.canScroll) check(where, 'a wheel over the box at its end scrolls the page on — no trap', y1 > start.y0, { y0: start.y0, y1 })
  else note(where, 'the page is already at its end below this box — chaining not measurable here', start)
}

async function dividendMonths(where) {
  const res = await page.request.get(`${API}/api/v1/portfolio/dividends`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  const all = await res.json()
  const cents = new Map()
  const counts = new Map()
  for (const d of all) {
    const k = d.pay_date.slice(0, 7)
    cents.set(k, (cents.get(k) ?? 0) + Math.round(Number(d.amount) * 100))
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const keys = [...cents.keys()].sort().reverse()
  const label = (k) => `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`
  const lines = await page.$$eval('.dividend-month-row', (rows) =>
    rows.map((r) => ({
      text: r.querySelector('.dividend-month-label').textContent,
      total: r.querySelector('td.num').textContent,
      expanded: r.querySelector('button').getAttribute('aria-expanded'),
    })),
  )
  check(where, 'one line per recorded month, newest first', JSON.stringify(lines.map((l) => l.text)) === JSON.stringify(keys.map(label)), { dom: lines.map((l) => l.text), api: keys.map(label) })
  check(where, 'only the newest month is open', lines.length > 0 && lines[0].expanded === 'true' && lines.slice(1).every((l) => l.expanded === 'false'), lines.map((l) => l.expanded))
  const wrong = lines.filter((l, i) => l.total !== money.format(cents.get(keys[i]) / 100))
  check(where, "every month's total is the cent-exact sum of its entries", wrong.length === 0, wrong.slice(0, 3))
  const bars = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.chart-card')].find((c) => /Monthly dividend income/i.test(c.textContent ?? ''))
    const host = card?.querySelector('[_echarts_instance_]')
    const chart = host && window.__echarts ? window.__echarts.getInstanceByDom(host) : null
    if (!chart) return null
    const option = chart.getOption()
    return { cats: option.xAxis[0].data, values: option.series[0].data.map((v) => (v !== null && typeof v === 'object' ? v.value : v)) }
  })
  if (bars === null) note(where, 'the chart instance was not reachable — bar parity not read', null)
  else {
    const mismatched = []
    bars.cats.forEach((cat, i) => {
      const k = keys.find((key) => label(key) === cat)
      if (k !== undefined && Math.round(Number(bars.values[i]) * 100) !== cents.get(k)) mismatched.push({ cat, bar: bars.values[i], total: cents.get(k) / 100 })
    })
    check(where, "each month's total equals its bar in the Monthly dividend income chart", mismatched.length === 0, mismatched.slice(0, 3))
  }
  await page.getByRole('button', { name: 'Expand all' }).click()
  await sleep(400)
  const expanded = await page.$$eval('tr[data-dividend-id]', (rows) => rows.length)
  check(where, 'Expand all renders every entry', expanded === all.length, { expanded, api: all.length })
  await page.getByRole('button', { name: 'Collapse all' }).click()
  await sleep(400)
  check(where, 'Collapse all folds every month', (await page.$$eval('tr[data-dividend-id]', (rows) => rows.length)) === 0, null)
  // The fullest month alone, scrolled to its middle: its line must stay pinned under the header.
  const fullest = keys.reduce((a, b) => (counts.get(b) > counts.get(a) ? b : a))
  await page.getByRole('button', { name: new RegExp(`^${label(fullest)} `) }).click()
  await sleep(400)
  await page.evaluate((monthText) => {
    const box = document.querySelector('[role="region"][aria-label="Dividends by month"]')
    box.scrollIntoView({ block: 'center' })
    const line = [...box.querySelectorAll('.dividend-month-row')].find((r) => r.querySelector('.dividend-month-label').textContent === monthText)
    const rows = line.closest('tbody').querySelectorAll('tr[data-dividend-id]')
    const middle = rows[Math.floor(rows.length / 2)]
    box.scrollTop += middle.getBoundingClientRect().top - (box.getBoundingClientRect().top + box.clientHeight / 2)
  }, label(fullest))
  await frames()
  await sleep(200)
  const pinned = await page.evaluate((monthText) => {
    const box = document.querySelector('[role="region"][aria-label="Dividends by month"]')
    const line = [...box.querySelectorAll('.dividend-month-row')].find((r) => r.querySelector('.dividend-month-label').textContent === monthText)
    const cell = line.cells[0].getBoundingClientRect()
    const expected = box.getBoundingClientRect().top + box.clientTop + parseFloat(box.style.getPropertyValue('--table-head-h'))
    const hit = document.elementFromPoint(cell.left + 30, cell.top + cell.height / 2)
    return { offBy: Math.abs(cell.top - expected), wins: hit !== null && line.contains(hit), scrollTop: box.scrollTop }
  }, label(fullest))
  check(where, `the open month's line (${label(fullest)}) stays pinned under the column header mid-month`, pinned.scrollTop > 0 && pinned.offBy <= 1 && pinned.wins, pinned)
  await page.locator(boxSel('Dividends by month')).screenshot({ path: path.join(OUT, `${where.replace(/[^a-z0-9]+/gi, '-')}-month-pinned.png`) })
}

async function ledgerDrag(where) {
  const BOX = boxSel('Transactions table')
  const ROWS = `${BOX} tbody tr[data-reorder-id]`
  const order = () => page.$$eval(ROWS, (els) => els.map((e) => e.getAttribute('data-reorder-id')))
  const before = await order()
  await page.evaluate((b) => {
    const box = document.querySelector(b)
    box.scrollIntoView({ block: 'center' })
    box.scrollTop = 0
  }, BOX)
  await sleep(300)
  const band = await page.evaluate((b) => {
    const r = document.querySelector(b).getBoundingClientRect()
    return { top: r.top, bottom: Math.min(r.bottom, window.innerHeight) }
  }, BOX)
  const writesBefore = report.writesBlocked.length
  const pageY0 = await page.evaluate(() => window.scrollY)
  const grip = await page.locator(`${ROWS} .reorder-grip`).first().boundingBox()
  const x = grip.x + grip.width / 2
  const y = grip.y + grip.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 6, { steps: 2 })
  await page.mouse.move(x, band.bottom - 12, { steps: 20 })
  await sleep(1200)
  const mid = await page.evaluate((b) => ({
    boxTop: document.querySelector(b).scrollTop,
    pageY: window.scrollY,
    grabbing: document.documentElement.classList.contains('reorder-active'),
  }), BOX)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await sleep(800)
  check(where, 'a drag held at the box foot auto-scrolls the BOX', mid.grabbing && mid.boxTop > 100, mid)
  check(where, 'the page stays put while the box scrolls', mid.pageY === pageY0, { pageY0, pageY: mid.pageY })
  check(where, 'Escape drops the drag: same order, nothing sent', JSON.stringify(await order()) === JSON.stringify(before) && report.writesBlocked.length === writesBefore, report.writesBlocked.slice(writesBefore))
  // From the keyboard: lift the first row and walk it past the visible band — it stays in view.
  await page.evaluate((b) => {
    document.querySelector(b).scrollTop = 0
  }, BOX)
  await page.locator(`${ROWS} .reorder-grip`).first().focus()
  await page.keyboard.press('Space')
  for (let i = 0; i < 15; i += 1) {
    await page.keyboard.press('ArrowDown')
    await sleep(60)
  }
  await sleep(400)
  const kb = await page.evaluate(([b, rows]) => {
    const box = document.querySelector(b)
    const lifted = document.querySelector(`${rows}[data-reorder="lifted"]`)
    if (lifted === null) return null
    const top = box.getBoundingClientRect().top + box.clientTop
    const head = parseFloat(box.style.getPropertyValue('--table-head-h')) || 0
    const r = lifted.getBoundingClientRect()
    return { rowTop: r.top, rowBottom: r.bottom, bandTop: top + head, bandBottom: top + box.clientHeight, boxTop: box.scrollTop }
  }, [BOX, ROWS])
  await page.keyboard.press('Escape')
  await sleep(600)
  check(where, 'a keyboard-lifted row walked past the band stays in view inside the box', kb !== null && kb.boxTop > 0 && kb.rowTop >= kb.bandTop - 1 && kb.rowBottom <= kb.bandBottom + 1, kb)
  check(where, 'Escape drops the keyboard move: same order, nothing sent', JSON.stringify(await order()) === JSON.stringify(before) && report.writesBlocked.length === writesBefore, report.writesBlocked.slice(writesBefore))
}

/** Spec §2.6: the panels re-render in place when the page reloads after a row action, so the box
 *  keeps its place. Driven read-only: a mid-box row's Delete goes to the fence (nothing reaches the
 *  server), the panel takes the fenced 200 as done, and the page reloads the — unchanged — ledger. */
async function reloadKeepsPlace(where) {
  const BOX = boxSel('Transactions table')
  const before = await page.evaluate((b) => {
    const box = document.querySelector(b)
    box.scrollIntoView({ block: 'center' })
    box.scrollTop = Math.round((box.scrollHeight - box.clientHeight) / 2)
    return box.scrollTop
  }, BOX)
  await frames()
  const id = await page.evaluate((b) => {
    const box = document.querySelector(b)
    const middle = box.getBoundingClientRect().top + box.clientHeight / 2
    const row = [...box.querySelectorAll('tbody tr[data-reorder-id]')].find((r) => {
      const rect = r.getBoundingClientRect()
      return rect.top <= middle && rect.bottom >= middle
    })
    return row ? row.getAttribute('data-reorder-id') : null
  }, BOX)
  if (id === null) {
    note(where, 'no row under the middle of the box — the reload check was skipped', null)
    return
  }
  await page.locator(`${BOX} tr[data-reorder-id="${id}"] button[aria-label^="Delete"]`).click()
  await page.waitForLoadState('networkidle').catch(() => {})
  await sleep(1000)
  const after = await page.evaluate((b) => document.querySelector(b).scrollTop, BOX)
  check(where, 'a reload after a row action leaves the box where the reader had it', Math.abs(after - before) <= 2, { before, after })
}

try {
  for (const theme of THEMES) {
    for (const size of SIZES) {
      const ctx = await makeContext(theme, size)
      page = await ctx.newPage()
      const errors = []
      page.on('console', (m) => {
        if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text())
      })
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
      for (const target of TARGETS) {
        const where = `${theme} ${size.width}x${size.height} ${target.name}`
        try {
          await open(target)
          const cls = await page.evaluate(() => window.__cls)
          check(where, 'the load shifts the layout less than 0.1 (CLS)', cls < 0.1, { cls })
          const g = await geometry(where, target)
          if (g.overflows) {
            await pins(where, target)
            await fade(where, target)
            await keyboard(where, target)
            await wheel(where, target)
          } else note(where, 'the table fits its box here — pin, fade, keyboard and wheel checks skipped', g)
          if (target.name === 'dividends') await dividendMonths(where)
          if (target.name === 'transactions' && g.overflows) {
            await ledgerDrag(where)
            // Last: its fenced Delete adds to writesBlocked, which the drag checks count.
            await reloadKeepsPlace(where)
          }
        } catch (error) {
          report.problems.push(`${where}: ${error.message}`)
        }
        if (errors.length > 0) {
          report.problems.push(`${where}: console — ${errors.slice(0, 4).join(' | ')}`)
          errors.length = 0
        }
      }
      await ctx.close()
    }
  }
} finally {
  await browser.close()
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
}

const passed = report.checks.filter((c) => c.ok === true).length
const notes = report.checks.filter((c) => c.ok === null).length
if (report.problems.length > 0) {
  console.log(`TABLE SCROLL SMOKE FAILED — ${report.problems.length} problem(s):`)
  for (const p of report.problems) console.log(`  - ${p}`)
  process.exit(1)
}
console.log(`TABLE SCROLL SMOKE OK — ${passed} checks, ${notes} notes, ${report.writesBlocked.length} writes fenced`)
```

- [ ] **Step 2: Document it**

In `tools/probes/README.md`, add this row to the tools table, directly after the `reorder-v/smoke.mjs` row:

```markdown
| `table-scroll-v/smoke.mjs` | The capped table boxes (2026-09-24): on Dividends, Transactions, Securities, Holdings, Security classifications, Net worth › Accounts and the Rewards matrix, in both themes at 1280×800, 1600×1000 and 1920×1080 — the box is a keyboard-reachable region never taller than `clamp(420px, 60vh, 720px)` and filling it when the table is longer; mid-scroll the header row sits at the box top and paints over the rows (hit test) on the card's own surface, the totals row sits at its foot; the foot fades while rows hide below and not at the end; the focused box shows its ring and PageDown scrolls it; a wheel at its end carries on down the page. Dividends: one line per recorded month newest first, only the newest open, each total cent-exact against `GET /portfolio/dividends` and equal to its bar in the live chart, Expand all → every entry, Collapse all → none, the fullest month's line pinned under the header mid-month. Transactions: a held drag auto-scrolls the BOX while the page stays put, a keyboard lift walked past the band stays in view, Escape drops both with nothing sent, and a reload after a (fenced) row Delete leaves the box where it was. CLS < 0.1 and a clean console. READ-ONLY BY CONSTRUCTION — a write fence | needs a stack whose book has long tables — see below |
```

and append this section at the end of the file:

````markdown
## Running the table-scroll smoke (a stack with long tables)

Read-only, so any stack will do — but the checks that matter (pins, fade, the drag's auto-scroll,
month lines) are only exercised where the tables outgrow their boxes. The 2026-09-24 run used a
private copy of production on its own pair of servers, started FROM THE WORKTREE with a private vite
dependency cache (a worktree's `node_modules` is a junction, so the default cache is shared by every
dev server on the box):

```bash
# a vite wrapper config with its own cacheDir, next to the scratch data (never in the repo)
cat > "$SCRATCH/vite.private.config.mts" <<'EOF'
import base from '<worktree>/vite.config.ts'
export default { ...base, cacheDir: '<scratch>/vite-cache' }
EOF
(cd backend && DATABASE_URL=postgresql+asyncpg://finance:finance@127.0.0.1:5433/<db> SCHEDULER_ENABLED=0 SNAPSHOT_ENABLED=0 $PY -m uvicorn app.main:app --host 127.0.0.1 --port 8061)
VITE_API_PROXY=http://127.0.0.1:8061 npx vite --config "$SCRATCH/vite.private.config.mts" --port 5261 --strictPort
curl -s http://127.0.0.1:8061/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"<login>","password":"<password>"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token))" > "$SCRATCH/token.txt"
TOKEN_FILE=$SCRATCH/token.txt SMOKE_OUT=scratchpad/table-scroll-v node tools/probes/table-scroll-v/smoke.mjs
```

Prints `TABLE SCROLL SMOKE OK — N checks, M notes, W writes fenced`, or exits 1 listing every
problem. `ONLY_THEME`, `ONLY_SIZE` (1280|1600|1920) and `ONLY_TARGET` narrow a run. Notes (`ok: null`
in `report.json`) are observations, not votes: a table that fits its box at that size, or a page
already at its end below a box (no wheel chaining to measure).
````

- [ ] **Step 3: Syntax-check and commit**

Run: `node --check tools/probes/table-scroll-v/smoke.mjs && echo SYNTAX-OK`
Expected: `SYNTAX-OK`. (The real run is Task 11's.)

```bash
git add tools/probes/table-scroll-v/smoke.mjs tools/probes/README.md
git commit -m "test(probes): table-scroll-v — the seven capped boxes, the dividend months and the ledger's drag in a real browser, both themes at three widths, read-only by construction (table-scroll spec §6)"
```

---

### Task 10: The reorder smoke's long drag now scrolls the box

**Files:**
- Modify: `tools/probes/reorder-v/smoke.mjs` (constants ~line 150; `longDrag` ~1221–1254)

- [ ] **Step 1: Re-aim `longDrag`**

After the line `const TXN_ROWS = \`${LEDGER} tbody tr[data-reorder-id]\``, add:

```js
// The ledger's capped box (2026-09-24 table-scroll spec §3.2): since the cap, a drag auto-scrolls it.
const LEDGER_BOX = `${LEDGER_PANEL} .table-scroll`
```

Replace the whole `longDrag` function (its doc comment included) with:

```js
/** The ledger at 1280×800 is taller than its capped box (2026-09-24 table-scroll spec §2.6): a
 *  pointer parked in the bottom 40px zone of the box's visible band scrolls the BOX under the lifted
 *  row, and the page stays put (spec §2.3.5, §10). Lane R3's long drag, re-aimed when the ledger
 *  got its cap — before it, the same drag scrolled the page. */
async function longDrag(rows, id) {
  await clearToasts()
  await ready(rows)
  const before = await order(rows)
  const from = before.indexOf(String(id))
  await standAt(rowSel(rows, id), 0.35)
  await page.waitForTimeout(250)
  const pageBefore = await page.evaluate(() => window.scrollY)
  const boxBefore = await scrollTopOf(LEDGER_BOX)
  const band = await visibleBand(LEDGER_BOX)
  const g = await page.locator(gripSel(rows, id)).boundingBox()
  const x = g.x + g.width / 2
  const y0 = g.y + g.height / 2
  await page.mouse.move(x, y0)
  await page.mouse.down()
  await page.mouse.move(x, y0 + 6, { steps: 2 })
  await page.mouse.move(x, band.bottom - 12, { steps: 20 })
  await page.waitForTimeout(1200)
  const mid = await liftState(rows)
  const boxScrolled = (await scrollTopOf(LEDGER_BOX)) - boxBefore
  const pageScrolled = (await page.evaluate(() => window.scrollY)) - pageBefore
  await snap('ledger-auto-scroll')
  await page.mouse.move(x, (band.top + band.bottom) / 2, { steps: 10 })
  await page.waitForTimeout(250)
  await page.mouse.up()
  await page.waitForTimeout(MOTION + 700)
  const after = await order(rows)
  const to = after.indexOf(String(id))
  check('a row lifts and the page says grabbing', mid !== null && mid.grabbing, mid)
  check('the ledger box auto-scrolls under a pointer held in its bottom 40px zone', boxScrolled > 200, { boxScrolled })
  check('the page stays put while the box scrolls', pageScrolled === 0, { pageScrolled })
  check('the row travels with the scroll', to - from >= 8, { from, to })
  check('nothing else moved', same(after, moveTo(before, from, to)), after)
  return after
}
```

- [ ] **Step 2: Syntax-check and commit**

Run: `node --check tools/probes/reorder-v/smoke.mjs && echo SYNTAX-OK`
Expected: `SYNTAX-OK`.

```bash
git add tools/probes/reorder-v/smoke.mjs
git commit -m "test(probes): reorder-v's long ledger drag measures the capped box's scroll — the ledger scrolls inside TableScroll now, so the page staying put is the new claim (table-scroll spec §2.6)"
```

(Running the reorder smoke needs its own lane stack on 8096/5196 with `finance_reorder_scratch`
rebuilt from `finance_realdata` — its README section. Task 11 runs the portfolio surface once if that
stack can be stood up without touching the other session's ports; otherwise it records that it was
not run.)

---

### Task 11: Gates, the browser run, and the record

- [ ] **Step 1: Frontend gates on the branch**

```bash
npx tsc -b && echo TSC-OK
npx eslint . 2>&1 | tail -3
npx vitest run 2>&1 | tail -6
npx vite build 2>&1 | tail -4
```
Expected: `TSC-OK`; eslint `0 errors`, warnings ≤ Task 0's N; vitest all passing (Task 0's count plus
the new tests); build succeeds (the chunk-size advisory stays under its 760 kB limit).

- [ ] **Step 2: The real-browser smoke on the production copy**

The private pair must be up: uvicorn 8061 on `finance_scroll`, vite 5261 from THIS worktree with the
private cache (vite picks up the branch's code live; restart uvicorn only if it died). Then:

```bash
SCRATCH=/c/Users/edyli/AppData/Local/Temp/claude/C--Users-edyli-personal-finance-dashboard/3f07990a-a778-4b40-804b-9e0780f62316/scratchpad
TOKEN_FILE=$SCRATCH/token.txt SMOKE_OUT=$SCRATCH/table-scroll-v node tools/probes/table-scroll-v/smoke.mjs
```
Expected: `TABLE SCROLL SMOKE OK — …`. On a failure: read `report.json` and the `-mid.png` /
`-month-pinned.png` shots, fix the cause in the task that owns it (with a test), re-run.
Also eyeball, in both themes, one shot each of: Dividends with a month pinned, Holdings mid-scroll,
Net worth with its pinned total, the Rewards matrix with its two-line header pinned.

- [ ] **Step 3: The reorder smoke's portfolio surface (if its stack can be stood up)**

Per `tools/probes/README.md` › "Running the reorder smoke", on 8096/5196 only:
`ONLY_THEME=dark ONLY_WIDTH=1280 ONLY_SURFACE=portfolio node tools/probes/reorder-v/smoke.mjs`.
Expected: `REORDER SMOKE OK — dark: N checks`. Record the result (or "not run" and why) in Step 4.

- [ ] **Step 4: Record the outcome in the spec and commit**

At the top of the spec, replace the `**Status:**` paragraph with the implemented status: the merge
SHA placeholder is filled at merge time, so write "implemented on `feat/table-scroll` (<last commit
SHA>)", the gates' numbers from Step 1, the smoke's line from Step 2, the reorder smoke's result from
Step 3, and the before/after page heights the smoke noted (Portfolio › Income before: 17,586 px at
1440×900).

```bash
git add docs/superpowers/specs/2026-09-24-long-tables-capped-scroll-and-dividend-months-design.md
git commit -m "docs(spec): table scroll — implemented on feat/table-scroll: gates, the real-browser smoke on the production copy, and the page heights before and after"
```

---

### Task 12: Merge to local main (coordinator only — never a subagent)

- [ ] **Step 1:** `git -C C:/Users/edyli/personal-finance-dashboard log --oneline -5 main` — note
  main's head (the correctness batch may have landed lanes since f50abe8d).
- [ ] **Step 2:** in the worktree, `git merge --no-ff main -m "Merge main into feat/table-scroll"`;
  resolve conflicts (expected only in `src/pages/NetWorthPage.tsx`, mechanical), then re-run Task 11
  Step 1's gates.
- [ ] **Step 3:** message the other session's coordinator that a merge into main is coming (ListAgents
  → SendMessage), and wait for its OK or a quiet window; confirm `git -C <main checkout> status` shows
  nothing staged by them in files this branch touches.
- [ ] **Step 4:** in the main checkout, merge with a house-style message built from Task 11's numbers:
  `git merge --no-ff feat/table-scroll -m "Merge feat/table-scroll — long tables scroll inside a capped box (clamp(420px, 60vh, 720px)) with the header and totals rows pinned, a fade while rows hide below, keyboard-reachable and whole on paper, on seven tables; the dividend ledger reads by month (Portfolio › Income <before> → <after> px at 1440×900); vitest <n> passed, smoke <n> checks (2026-09-24)"`
  with the `<…>` values replaced by the recorded figures. No push.
- [ ] **Step 5:** cleanup: stop 8061/5261, `dropdb finance_scroll`, delete the prod dump from the
  session scratchpad, junction-safe worktree removal (`cmd /c rmdir` the node_modules junction first),
  `git branch -d feat/table-scroll`; update memory.
