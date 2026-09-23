# Lane R4 — Overview › Customize: drag to reorder (2026-09-23) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> implementer for this lane in its own worktree, TDD per task, then a spec-compliance review and a
> code-quality review, then merge into `feat/reorder-base` — never main, never pushed). Steps use
> `- [ ]` checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-23-drag-to-reorder-design.md` — this lane implements
**§6 (Overview › Customize)** and its rows of **§8.1** (the "Hidden" divider), **§9** (popover
Escape), **§10** (verification) and **§11** (ownership). Before Task 1, read spec §2.2–§2.5, §6,
§8 and §9, and the R0 plan's "Contracts this lane publishes" and "Consumer rules"
(`docs/superpowers/plans/2026-09-23-reorder-r0-component.md`). The spec is authoritative where
this plan is silent.

**Goal:** the Customize popover lists each group's showing views in their stored order as drag
rows (grip · box · label) and the hidden views under a quiet "Hidden" divider, and reorders them
by pointer or keyboard through R0's shared component. The ↑/↓ buttons and position numbers are
retired, and an Escape mid-drag cancels only the drag.

**Architecture:**
- `OverviewCustomize.tsx` keeps its popover shell: the trigger, `usePopoverDismiss`, the focus
  contract, Reset to defaults and Done.
- It renders one internal `CustomizeGroup` per fieldset, mounted only while the popover is open.
  Each group owns:
  - one `useReorder` (items = the showing ids, one range; `labelOf` = the existing labels;
    `onCommit(next)` → the group's typed setter → `onChange({ ...value, tiles|cards: next })`);
  - its own `ReorderInstructions` + `ReorderLiveRegion`.
- Ticks change membership (append / remove) and hand the caret to the moved box.
- There is no server call, no toast and no busy state. The page's wiring (`OverviewPage.tsx`:
  `setLayout` + `setLocal('overview_layout')`) is unchanged, so the pref shape and its server
  validator are unchanged.
- `OverviewPage.css` gives every row one height and one gap (the drag keeps the gaps it measured
  at lift), a fixed grip column, an inset for hidden rows, and the divider.

**Tech stack:** React 19 + TypeScript 5.9 strict (`noUnusedLocals`), vitest 3 +
@testing-library/react (jsdom; **no** jest-dom matchers — assert with `getAttribute`,
`textContent`, `.disabled`; vitest globals are OFF, so RTL cannot auto-clean and every test file
calls `cleanup()` itself), R0's `src/components/reorder/**`, playwright-core + Edge for the
browser check.

---

## Mechanics (read once)

- **Worktree:** `C:/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r4`, branch
  `feat/reorder-overview`, cut from `feat/reorder-base` **after lane R0 is merged into it** (NOT
  main). Work ONLY inside it.
  - The controller creates it and symlinks `node_modules`
    (`ln -s /c/Users/edyli/personal-finance-dashboard/node_modules node_modules`).
  - Task 1 proves R0 is on the branch before anything else happens.
- **Another Claude job** is working in `.worktrees/{perf-first-four,backend-quick-fixes,
  frontend-quick-fixes,charts-spending-overview,charts-tax-portfolio}` and merging into main.
  Never touch main, the main checkout, those worktrees or the other `reorder-*` worktrees.
  - R4 does **not** edit `src/pages/OverviewPage.tsx`. The in-flight lanes edit it, and its
    Customize wiring (`value={layout}`, `onChange={next => { setLayout(next); setLocal(…) }}`)
    already does what §6 needs.
- **Tests:**
  - Per task: `npx vitest run src/components/overview/OverviewCustomize.test.tsx src/pages/OverviewPage.test.tsx`
    from the worktree root.
  - The full suite once, in Task 6. Never pipe a gate through `tail`/`head`; read the exit code.
- **Types and lint** before every commit: `npx tsc -b` and `npx eslint <the files the task touched>`.
  - `eslint-plugin-react-hooks` v7 runs the React-Compiler rules (`react-hooks/refs`,
    `react-hooks/immutability`, `react-hooks/set-state-in-effect`, …).
  - The code below is written to pass them: `fieldsetRef.current` is read only inside an event
    handler, nothing reads a ref during render, and no effect sets state.
  - If a rule still fires, fix the code — never add an `eslint-disable`.
- **Commits:** small and conventional (`feat(overview): …`, `test(overview): …`,
  `style(overview): …`). `git add` exactly the paths each task names — never `git add -A` or
  `git add .`. Never push; never delete files, branches or databases.
- **Scope fence:**
  - `src/components/overview/OverviewCustomize.tsx`;
  - `src/pages/OverviewPage.css` (the Customize row rules only);
  - the new `src/components/overview/OverviewCustomize.test.tsx`;
  - the customize tests inside `src/pages/OverviewPage.test.tsx`;
  - this plan's Results section.
  - Task 5 (one Guide step list) is **outside** the fence and runs only if the controller approved
    it when dispatching the lane.
  - Nothing under `src/components/reorder/**` (R0 owns it): a defect there is reported to the
    controller, not patched here.
- **Merge note (for the controller):**
  - In-flight lane B1 adds `.up-next-clause` to `OverviewPage.css` (around line 151) and edits
    `OverviewPage.test.tsx` between lines 1393 and 1625.
  - CS appends to `OverviewPage.test.tsx` after line 2041, and CT edits it around line 1847.
  - R4's hunks (CSS lines 185–188; tests 1951–2015) touch none of those lines.
- **Browser check (Task 7):** a private database `finance_reorder_r4`, the lane's own backend on
  8094 and vite on 5194. The controller creates the database (the prerequisite commands are in
  Task 7). Nothing in this lane ever writes to `finance_realdata` or `finance`.
- **The pref shape does not change.**
  - `isOverviewLayout` (`src/prefs/overviewLayout.ts`) and the server's `_overview_layout`
    validator (`backend/app/services/prefs_registry.py:43`, pinned by
    `backend/tests/test_prefs_registry.py`) both accept unique allowed ids with at least one tile.
  - That covers every value this UI can write, so no backend file changes.

## What this lane builds on (R0's contracts verbatim, plus two test-only imports)

```ts
import DragHandle from '../reorder/DragHandle'                                   // <DragHandle name="Portfolio" {...reorder.handleProps(id)} />
import { ReorderInstructions, ReorderLiveRegion } from '../reorder/ReorderStatus'
import { useReorder } from '../reorder/useReorder'
// useReorder<K>({ items, labelOf, onCommit }) → { itemProps, handleProps, instructionsId, announcement, liftedId, active, markSaved }
import { installPointerEvents } from '../../testing/pointer'                      // tests only
import { MOTION_MS } from '../../theme/motion'                                    // tests only: MOTION_MS.fast is the pointer drop's settle
```

R0's consumer rules, as they apply here:
1. Every showing view is rendered exactly once, with `{...reorder.itemProps(id)}` on its
   `<div className="overview-customize-row">`, in `items` order. Hidden rows are not items and
   carry no `itemProps`.
2. This code never sets `style.transform`/`style.transition` on a row and never uses
   `.is-dragging`.
3. `onCommit` sets the new order synchronously. It calls the page's `onChange`, whose `setLayout`
   is a plain `setState`, and it runs inside R0's `flushSync`. There is no save to wait for, so
   there is no `markSaved` call and no failure path.
4. There is no `disabled` option: nothing is ever in flight.
5. While `reorder.active`, every box of that list is disabled (Task 3).
6. `ReorderInstructions` and `ReorderLiveRegion` sit inside each fieldset (there is no table here).

The pieces R0 provides that this plan leans on:
- The grip is named **"Reorder {label}"**, is `disabled` when its list has one row, and carries
  `aria-pressed` while lifted.
- Escape while a row is up is caught on `window` in the **capture** phase (`preventDefault` +
  `stopPropagation`) and cancels only the drag. `usePopoverDismiss`, a capture listener on
  `document` that also yields to a `defaultPrevented` Escape, never sees it.
- After a keyboard drop, focus goes back to the moved row's grip.

## DOM this lane publishes (lane V's probe reads it)

- `[role=dialog][aria-label="Customize overview"]` — unchanged.
- Two `fieldset` groups named **Summary tiles** and **Deeper views** (their `<legend>`).
- A showing view: `.overview-customize-row[data-reorder-id="<id>"]`, holding
  `button.reorder-grip` (named "Reorder {label}") and a checked box.
- The divider: `.overview-customize-divider` with the text `Hidden`, present only when the group
  hides something.
- A hidden view: `.overview-customize-row.is-off`, with an unchecked box and no grip.

## Decisions this plan takes where the spec is silent (recorded for review)

1. **Instructions and live region: one pair per fieldset.**
   - Each `useReorder` owns its own `instructionsId` (`useId`) and `announcement`.
   - Rendering the pair inside its fieldset means every grip's `aria-describedby` resolves without
     overriding `handleProps`, and each list speaks in its own region.
   - Only one list can have a row up at a time, so the two regions never talk over each other.
   - The duplicated hidden sentence costs nothing: it is only read as the description of a
     focused grip.
2. **One component per fieldset, mounted only while the popover is open.**
   - "Two `useReorder` instances, one per fieldset" is literally two mounted `CustomizeGroup`s.
   - Each opening starts with a fresh drag state and an empty live region.
   - Closing the popover mid-lift (an outside pointer) unmounts the hook, and R0's unmount
     cleanup drops the lift.
3. **A typed setter per group.**
   - The spec's `onChange({ ...value, [group]: next })` is written as
     `onChange({ ...value, tiles: next })` / `onChange({ ...value, cards: next })`, passed down as
     `CustomizeGroup`'s `onChange`.
   - It is the same call, without the computed-key widening that would let a card id type-check
     into `tiles`.
4. **The caret follows a ticked box.**
   - Ticking or unticking moves the row across the divider. Visible and hidden rows are separate
     keyed lists, so React mounts a new box and the old one takes the focus with it.
   - `toggle` therefore commits the change inside `flushSync` and focuses the new box (found by
     `input[value="<id>"]` inside the fieldset).
   - Without this, a keyboard reader lands on `<body>` after every tick.
5. **Boxes are inert while their list has a row up** (R0 consumer rule 5). This covers the showing
   and the hidden boxes of that list; the other list and Reset/Done stay live. A Reset mid-lift
   changes the items, and R0 cancels the lift silently.
6. **Opening focuses the first control that can take focus.**
   - The selector becomes `input:not(:disabled), button:not(:disabled)`.
   - With a lone summary tile, its grip (a list of one) and its box (the tile minimum) are both
     disabled, and `focus()` on a disabled control is a no-op. That would leave the caret outside
     a `role="dialog"`.
7. **No saved flash (`markSaved` is not called).**
   - On the other five lists the flash means "the server took it".
   - Here the layout writes locally at once and syncs silently, and the tiles re-ordering behind
     the popover are the confirmation.
8. **Hidden rows** are box · label with no grip.
   - They are inset by the grip column so every box stands in one column.
   - Their modifier is `.is-off`, because `.is-hidden` reads like a `display: none` utility.
9. **The divider is plain text**, `<div className="overview-customize-divider">Hidden</div>`, with
   a CSS hairline.
   - It is not `role="separator"`: a separator's children are presentational, so its word would
     not be read.
   - As plain text, a screen reader meets "Hidden" right before the unticked boxes.
10. **The CSS pins live in `OverviewCustomize.test.tsx`**, not `src/pages/overviewCss.test.ts`.
    That file is outside this lane's fence, and in-flight lane B1 edits it.
11. **Private database.**
    - Spec §10 names a shared `finance_reorder_scratch`.
    - The controller refined that to one copy per lane (`finance_reorder_r4`), so parallel lanes
      never write into each other's data.
12. **The Guide's Customize task.**
    - `src/guide/content/pages-tracking.tsx:34` tells the reader to "Reorder an item with its ↑ or
      ↓ button" — the control this lane removes.
    - The Guide's label fence cannot catch it: the arrows are not a `**Label**`.
    - The spec assigns no Guide copy, so Task 5 updates that step list and is gated on the
      controller's approval (it is outside the fence).

## File map

| File | Change |
|---|---|
| `src/components/overview/OverviewCustomize.tsx` | rewritten: `CustomizeGroup` per fieldset, a `useReorder` per list, the Hidden divider, the caret following ticks, the first enabled control focused on open |
| `src/components/overview/OverviewCustomize.test.tsx` (create) | the lists, the ticks, the caret, the tile minimum, Reset, keyboard and pointer drags, Escape, inert boxes, CSS pins |
| `src/pages/OverviewPage.css` | lines 185–188 (the row, its label, the position number, the ↑/↓ buttons) → the row, the grip column, the hidden-row inset, the label, the divider and its hairline |
| `src/pages/OverviewPage.test.tsx` | "persists hidden and reordered views…" drives Space/↓/Space and asserts the stored order and the re-show append; "falls back…" asserts the lone grip is disabled; a new Escape-while-lifted test |
| `src/guide/content/pages-tracking.tsx` | Task 5 only (controller-gated): the Customize task's steps |
| `scratchpad/reorder-r4/customize.mjs` | Task 7: gitignored browser check, never committed |

---

### Task 1: preflight — R0 is on the branch, the baseline is green

**Files:** none (verification only).

- [ ] **Step 1: The branch and R0's files**

Run:

```bash
git log --oneline -8
ls src/components/reorder src/testing/pointer.ts
grep -n "export function useReorder\|export default function DragHandle\|export function ReorderInstructions\|export function ReorderLiveRegion\|export function installPointerEvents" \
  src/components/reorder/useReorder.ts src/components/reorder/DragHandle.tsx \
  src/components/reorder/ReorderStatus.tsx src/testing/pointer.ts
```

Expected:
- The log shows lane R0's commits (or its merge) on `feat/reorder-base`.
- `src/components/reorder` lists `DragHandle.tsx`, `ReorderStatus.tsx`, `reorder.css`,
  `reorderDom.ts`, `reorderMath.ts`, `reorderTypes.ts` and `useReorder.ts` (plus their tests), and
  `src/testing/pointer.ts` exists.
- The grep prints exactly five lines.
- If any file or export is missing, or a name differs from this plan's imports, **stop and report
  BLOCKED**. This plan builds against those names verbatim.

- [ ] **Step 2: The baseline tests**

Run: `npx vitest run src/components/reorder src/pages/OverviewPage.test.tsx`
Expected: PASS. A failure here is the base's, not this lane's: stop and report it with the output.

---

### Task 2: the lists — showing views in stored order with grips, hidden views under "Hidden"

**Files:**
- Create: `src/components/overview/OverviewCustomize.test.tsx`
- Modify: `src/components/overview/OverviewCustomize.tsx` (full rewrite)
- Modify: `src/pages/OverviewPage.test.tsx:1951-1986` (the "persists…" and "falls back…" tests)

- [ ] **Step 1: Write the failing component tests**

Create `src/components/overview/OverviewCustomize.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_OVERVIEW_LAYOUT } from '../../prefs/overviewLayout'
import type { OverviewLayout } from '../../prefs/overviewLayout'
import OverviewCustomize from './OverviewCustomize'

// Overview › Customize (2026-09-23 drag-to-reorder spec §6). This file pins the popover's own
// lists — their order, the Hidden divider, the ticks, the drag and its Escape. The layout
// reaching the page's tiles and the pref store is pinned in OverviewPage.test.tsx.

type Legend = 'Summary tiles' | 'Deeper views'

const DEFAULT_CARDS = ['ytd', 'performance', 'spending', 'money_flow']

/** The page's wiring (OverviewPage.tsx): the layout is state, and every change lands at once. */
function Harness({
  initial = DEFAULT_OVERVIEW_LAYOUT,
  onChange = () => {},
}: {
  initial?: OverviewLayout
  onChange?: (value: OverviewLayout) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <OverviewCustomize
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

function openPopover(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Customize' }))
  return screen.getByRole('dialog', { name: 'Customize overview' })
}

const list = (legend: Legend) => screen.getByRole('group', { name: legend })
const grip = (name: string) => screen.getByRole('button', { name: `Reorder ${name}` }) as HTMLButtonElement
const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement

/** A list as a reader meets it, top to bottom: "⋮ [x] Net worth" is a view that shows (grip,
 *  ticked box, label), "— Hidden —" the divider, "[ ] Portfolio" a hidden view (box, label, no
 *  grip). A leftover position number or ↑/↓ would show up in the label text. */
function lines(legend: Legend): string[] {
  return [...list(legend).querySelectorAll<HTMLElement>('.overview-customize-row, .overview-customize-divider')].map(
    (row) => {
      if (row.classList.contains('overview-customize-divider')) return `— ${row.textContent} —`
      const ticked = (row.querySelector('input') as HTMLInputElement).checked
      return `${row.querySelector('.reorder-grip') === null ? '' : '⋮ '}${ticked ? '[x]' : '[ ]'} ${row.textContent}`
    },
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('OverviewCustomize — the lists (2026-09-23 spec §6)', () => {
  it('lists the views that show in their stored order, each with a grip, then the hidden ones under "Hidden" in default order', () => {
    render(<Harness initial={{ tiles: ['tax', 'net_worth'], cards: ['money_flow', 'ytd'] }} />)
    openPopover()
    expect(lines('Summary tiles')).toEqual([
      '⋮ [x] Estimated tax',
      '⋮ [x] Net worth',
      '— Hidden —',
      '[ ] Portfolio',
      '[ ] Living spending',
    ])
    expect(lines('Deeper views')).toEqual([
      '⋮ [x] Money flow',
      '⋮ [x] Year to date',
      '— Hidden —',
      '[ ] Portfolio performance',
      '[ ] Recent spending',
    ])
    // Only the views that show are drag items, and the ↑/↓ buttons are gone.
    expect(list('Summary tiles').querySelectorAll('[data-reorder-id]')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /^Move .* (earlier|later)$/ })).toBeNull()
  })

  it('draws no divider while every view shows', () => {
    render(<Harness />)
    openPopover()
    expect(lines('Summary tiles')).toEqual([
      '⋮ [x] Net worth',
      '⋮ [x] Portfolio',
      '⋮ [x] Living spending',
      '⋮ [x] Estimated tax',
    ])
    expect(within(list('Deeper views')).queryByText('Hidden')).toBeNull()
  })

  it('gives each list its own hidden instructions and its own live region', () => {
    render(<Harness />)
    openPopover()
    for (const [legend, name] of [
      ['Summary tiles', 'Net worth'],
      ['Deeper views', 'Year to date'],
    ] as const) {
      const instructions = document.getElementById(grip(name).getAttribute('aria-describedby') ?? '')
      expect(instructions?.textContent).toBe(
        'Press Space or Enter to pick up. Use the arrow keys to move, Home or End to jump, Space or Enter to drop, Escape to cancel.',
      )
      expect(list(legend).contains(instructions)).toBe(true)
      expect(list(legend).querySelectorAll('[aria-live="assertive"]')).toHaveLength(1)
    }
  })

  it('ticking a hidden view appends it to the order; unticking one that shows moves it under Hidden', () => {
    const onChange = vi.fn()
    render(<Harness initial={{ tiles: ['tax', 'net_worth'], cards: [...DEFAULT_OVERVIEW_LAYOUT.cards] }} onChange={onChange} />)
    openPopover()
    fireEvent.click(box('Portfolio'))
    expect(onChange).toHaveBeenLastCalledWith({ tiles: ['tax', 'net_worth', 'portfolio'], cards: DEFAULT_CARDS })
    expect(lines('Summary tiles')).toEqual([
      '⋮ [x] Estimated tax',
      '⋮ [x] Net worth',
      '⋮ [x] Portfolio',
      '— Hidden —',
      '[ ] Living spending',
    ])
    fireEvent.click(box('Recent spending'))
    expect(onChange).toHaveBeenLastCalledWith({
      tiles: ['tax', 'net_worth', 'portfolio'],
      cards: ['ytd', 'performance', 'money_flow'],
    })
    expect(lines('Deeper views')).toEqual([
      '⋮ [x] Year to date',
      '⋮ [x] Portfolio performance',
      '⋮ [x] Money flow',
      '— Hidden —',
      '[ ] Recent spending',
    ])
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('a ticked or unticked box keeps the keyboard caret as its row crosses the divider', () => {
    render(<Harness />)
    openPopover()
    box('Portfolio').focus()
    fireEvent.click(box('Portfolio'))
    expect(lines('Summary tiles').at(-1)).toBe('[ ] Portfolio')
    expect(document.activeElement).toBe(box('Portfolio'))
    fireEvent.click(box('Portfolio'))
    expect(lines('Summary tiles').at(-1)).toBe('⋮ [x] Portfolio')
    expect(document.activeElement).toBe(box('Portfolio'))
  })

  it('keeps one summary tile — its box and grip are disabled — while the deeper views may all go', () => {
    const onChange = vi.fn()
    render(<Harness initial={{ tiles: ['portfolio'], cards: ['ytd'] }} onChange={onChange} />)
    const dialog = openPopover()
    expect(box('Portfolio').disabled).toBe(true)
    expect(grip('Portfolio').disabled).toBe(true)
    // Opening hands the caret to the first control that can take it: the lone tile's grip and box
    // cannot, so it lands on the first hidden tile's box.
    expect(document.activeElement).toBe(box('Net worth'))
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.click(box('Year to date'))
    expect(onChange).toHaveBeenLastCalledWith({ tiles: ['portfolio'], cards: [] })
    expect(lines('Deeper views')).toEqual([
      '— Hidden —',
      '[ ] Year to date',
      '[ ] Portfolio performance',
      '[ ] Recent spending',
      '[ ] Money flow',
    ])
  })

  it('Reset to defaults brings every view back in its default place', () => {
    const onChange = vi.fn()
    render(<Harness initial={{ tiles: ['tax'], cards: [] }} onChange={onChange} />)
    openPopover()
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    expect(onChange).toHaveBeenCalledWith(DEFAULT_OVERVIEW_LAYOUT)
    expect(lines('Summary tiles')).toEqual([
      '⋮ [x] Net worth',
      '⋮ [x] Portfolio',
      '⋮ [x] Living spending',
      '⋮ [x] Estimated tax',
    ])
    expect(lines('Deeper views')).toEqual([
      '⋮ [x] Year to date',
      '⋮ [x] Portfolio performance',
      '⋮ [x] Recent spending',
      '⋮ [x] Money flow',
    ])
  })
})
```

- [ ] **Step 2: Update the two page tests the rewrite breaks**

In `src/pages/OverviewPage.test.tsx`, replace the whole
`it('persists hidden and reordered views across remounts and resets to the supported defaults', …)`
block (lines 1951–1974) with:

```tsx
  it('persists hidden and reordered views across remounts and resets to the supported defaults', async () => {
    // A keyboard move keeps the lifted row in view with window.scrollBy, which jsdom only logs as
    // not implemented (the drag itself is pinned in OverviewCustomize.test.tsx).
    const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    serve()
    renderPage()
    await screen.findByText('Net worth — Aug 2026')
    fireEvent.click(screen.getByText('Customize'))
    // Space · ↓ · Space on Net worth's grip (2026-09-23 drag spec §6): Portfolio now leads.
    const grip = screen.getByRole('button', { name: 'Reorder Net worth' })
    grip.focus()
    for (const key of [' ', 'ArrowDown', ' ']) fireEvent.keyDown(grip, { key })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Living spending' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Money flow' }))
    expect(document.querySelector('.kpi-row .stat-label')?.textContent).toBe('Portfolio')
    expect(within(document.querySelector('.kpi-row') as HTMLElement).queryByText('Living spending')).toBeNull()
    expect(screen.queryByRole('heading', { name: new RegExp(`Money flow.*${CURRENT_YEAR}`) })).toBeNull()
    const saved = getLocal('overview_layout')!
    expect(saved.tiles).toEqual(['portfolio', 'net_worth', 'tax'])
    expect(saved.cards).not.toContain('money_flow')
    cleanup()
    renderPage()
    expect(document.querySelector('.kpi-row .stat-label')?.textContent).toBe('Portfolio')
    expect(screen.queryByRole('heading', { name: new RegExp(`Money flow.*${CURRENT_YEAR}`) })).toBeNull()
    fireEvent.click(screen.getByText('Customize'))
    // The popover lists the STORED order, and the hidden tile waits under its divider.
    const tiles = screen.getByRole('group', { name: 'Summary tiles' })
    expect(
      within(tiles)
        .getAllByRole('checkbox')
        .map((box) => `${(box as HTMLInputElement).checked ? '[x]' : '[ ]'} ${box.closest('label')?.textContent}`),
    ).toEqual(['[x] Portfolio', '[x] Net worth', '[x] Estimated tax', '[ ] Living spending'])
    expect(within(tiles).getByText('Hidden')).toBeTruthy()
    // Showing it again appends it: it becomes the last tile on the page.
    fireEvent.click(within(tiles).getByRole('checkbox', { name: 'Living spending' }))
    expect(getLocal('overview_layout')?.tiles).toEqual(['portfolio', 'net_worth', 'tax', 'living_spending'])
    expect(document.querySelector('.kpi-row > :last-child')?.textContent).toContain('Living spending')
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    expect(getLocal('overview_layout')).toEqual(DEFAULT_OVERVIEW_LAYOUT)
    expect(document.querySelector('.kpi-row .stat-label')?.textContent).toBe('Net worth — Aug 2026')
    expect(await screen.findByRole('heading', { name: new RegExp(`Money flow.*${CURRENT_YEAR}`) })).toBeTruthy()
    scroll.mockRestore()
  })
```

Then replace the whole
`it('falls back from an invalid saved layout and keeps at least one headline tile visible', …)`
block (lines 1976–1986 before the edit above) with:

```tsx
  it('falls back from an invalid saved layout and keeps at least one headline tile visible', async () => {
    localStorage.setItem(STORAGE_KEYS.overview_layout, JSON.stringify({ tiles: [], cards: ['not-a-card'] }))
    serve()
    renderPage()
    await screen.findByText('Net worth — Aug 2026')
    expect(document.querySelectorAll('.kpi-row .stat-tile')).toHaveLength(4)
    fireEvent.click(screen.getByText('Customize'))
    for (const name of ['Portfolio', 'Living spending', 'Estimated tax']) fireEvent.click(screen.getByRole('checkbox', { name }))
    expect((screen.getByRole('checkbox', { name: 'Net worth' }) as HTMLInputElement).disabled).toBe(true)
    // …and its grip too: a list of one has nowhere to move (2026-09-23 drag spec §9).
    expect((screen.getByRole('button', { name: 'Reorder Net worth' }) as HTMLButtonElement).disabled).toBe(true)
    expect(getLocal('overview_layout')?.tiles).toEqual(['net_worth'])
  })
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run src/components/overview/OverviewCustomize.test.tsx src/pages/OverviewPage.test.tsx`

Expected: FAIL.
- All 7 tests in `OverviewCustomize.test.tsx` fail: rows come in default order with their position
  number and arrows in the text (`'Net worth1↑↓'`), and there is no grip (`Unable to find an
  accessible element with the role "button" and name "Reorder …"`).
- In `OverviewPage.test.tsx`, "persists hidden and reordered views…" and "falls back from an
  invalid saved layout…" fail with `Unable to find an accessible element with the role "button"
  and name "Reorder Net worth"`.
- Every other page test passes.

- [ ] **Step 4: Rewrite `src/components/overview/OverviewCustomize.tsx`**

Replace the whole file with:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { DEFAULT_OVERVIEW_LAYOUT, OVERVIEW_CARDS, OVERVIEW_TILES } from '../../prefs/overviewLayout'
import type { OverviewCard, OverviewLayout, OverviewTile } from '../../prefs/overviewLayout'
import DragHandle from '../reorder/DragHandle'
import { ReorderInstructions, ReorderLiveRegion } from '../reorder/ReorderStatus'
import { useReorder } from '../reorder/useReorder'
import { usePopoverDismiss } from '../usePopoverDismiss'

type View = OverviewTile | OverviewCard

// Labels mirror the tile and card titles exactly (2026-09-13 polish spec §14): the spending
// card is titled "Recent spending", so its checkbox is too.
const LABELS: Record<View, string> = {
  net_worth: 'Net worth',
  portfolio: 'Portfolio',
  living_spending: 'Living spending',
  tax: 'Estimated tax',
  ytd: 'Year to date',
  performance: 'Portfolio performance',
  spending: 'Recent spending',
  money_flow: 'Money flow',
}

const labelOf = (id: View) => LABELS[id]

// One fieldset of the popover (2026-09-23 drag-to-reorder spec §6). The views that show come
// first, in the stored order — each a grip · box · label row the drag moves. Then, only when
// something is hidden, a quiet "Hidden" divider and the rest in default order: box · label, no
// grip. Ticking appends a view to the order; unticking takes it out; a drop is one onChange with
// the new order. The layout is a local preference that applies at once (Reset to defaults is its
// undo), so there is no busy state, no toast and no saved flash — on the other five lists the
// flash means "the server took it", and nothing here waits on a server. Mounted only while the
// popover is open: every opening starts with a fresh drag state, and a popover closed mid-lift
// takes the lift down with it.
function CustomizeGroup<K extends View>({
  legend,
  all,
  visible,
  keepOne,
  onChange,
}: {
  legend: string
  /** Every view of the group, in default order. */
  all: readonly K[]
  /** The views that show, in the stored order. */
  visible: readonly K[]
  /** The summary tiles never go empty: the last one's box is disabled. */
  keepOne: boolean
  onChange: (next: K[]) => void
}) {
  const fieldsetRef = useRef<HTMLFieldSetElement>(null)
  const reorder = useReorder<K>({
    items: visible.map((id) => ({ id })),
    labelOf,
    onCommit: (next) => onChange(next),
  })
  const hidden = all.filter((id) => !visible.includes(id))
  // A tick moves its row across the divider, and React mounts a new box for it there: commit the
  // change now and hand the caret to the new box, or a keyboard reader lands on <body>.
  const toggle = (id: K, show: boolean) => {
    flushSync(() => onChange(show ? [...visible, id] : visible.filter((item) => item !== id)))
    fieldsetRef.current?.querySelector<HTMLInputElement>(`input[value="${id}"]`)?.focus()
  }
  return (
    <fieldset ref={fieldsetRef}>
      <legend>{legend}</legend>
      {/* One pair per list (spec §8.2): this list's grips point at these instructions, and the
          list speaks in its own region. */}
      <ReorderInstructions id={reorder.instructionsId} />
      <ReorderLiveRegion text={reorder.announcement} />
      {visible.map((id) => (
        <div key={id} className="overview-customize-row" {...reorder.itemProps(id)}>
          <DragHandle name={LABELS[id]} {...reorder.handleProps(id)} />
          <label>
            <input type="checkbox" value={id} checked disabled={keepOne && visible.length === 1} onChange={() => toggle(id, false)} />
            {LABELS[id]}
          </label>
        </div>
      ))}
      {hidden.length > 0 && <div className="overview-customize-divider">Hidden</div>}
      {hidden.map((id) => (
        <div key={id} className="overview-customize-row is-off">
          <label>
            <input type="checkbox" value={id} checked={false} onChange={() => toggle(id, true)} />
            {LABELS[id]}
          </label>
        </div>
      ))}
    </fieldset>
  )
}

// A popover, not a <details> (spec §11): outside pointer and Escape close it, focus returns to
// the button, and it wears the shared .popover-surface (F2's tokens and pop-in motion). An Escape
// pressed while a row is lifted never reaches usePopoverDismiss: useReorder takes it on window in
// the capture phase and cancels only the drag (2026-09-23 drag spec §2.3).
export default function OverviewCustomize({ value, onChange }: { value: OverviewLayout; onChange: (value: OverviewLayout) => void }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  // Stable (useCallback): usePopoverDismiss re-subscribes its document listeners on every new
  // identity, and this component re-renders on every layout edit made inside the popover.
  const close = useCallback(() => setOpen(false), [])
  usePopoverDismiss(open, close, triggerRef, surfaceRef)
  // role="dialog" contract: opening moves focus INTO the surface — onto the first control that can
  // take it (a lone summary tile's grip and box are both disabled); Escape, an outside pointer and
  // Done all hand it back to the trigger.
  useEffect(() => {
    if (!open) return
    surfaceRef.current?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')?.focus()
  }, [open])
  const done = () => { setOpen(false); triggerRef.current?.focus() }
  return <div className="overview-customize">
    <button ref={triggerRef} type="button" className="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)}>Customize</button>
    {open && <div ref={surfaceRef} className="popover-surface overview-customize-menu" role="dialog" aria-label="Customize overview">
      <CustomizeGroup legend="Summary tiles" all={OVERVIEW_TILES} visible={value.tiles} keepOne onChange={(tiles) => onChange({ ...value, tiles })} />
      <CustomizeGroup legend="Deeper views" all={OVERVIEW_CARDS} visible={value.cards} keepOne={false} onChange={(cards) => onChange({ ...value, cards })} />
      <div className="overview-customize-actions">
        <button type="button" className="button" onClick={() => onChange(DEFAULT_OVERVIEW_LAYOUT)}>Reset to defaults</button>
        <button type="button" className="button button-primary" onClick={done}>Done</button>
      </div>
    </div>}
  </div>
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/components/overview/OverviewCustomize.test.tsx src/pages/OverviewPage.test.tsx`

Expected: PASS — 7 tests in the new file, and every test in `OverviewPage.test.tsx`, including the
unchanged "the Customize popover opens as a dialog…" test. The first enabled control is now the
"Reorder Net worth" grip, which sits inside the dialog.

If the caret test fails with `document.activeElement` = `<body>`, check that `toggle` focuses
**after** `flushSync` returns and that the query runs inside `fieldsetRef.current`.

- [ ] **Step 6: Type-check and lint**

Run:

```bash
npx tsc -b
npx eslint src/components/overview/OverviewCustomize.tsx src/components/overview/OverviewCustomize.test.tsx src/pages/OverviewPage.test.tsx
```

Expected: exit 0, no warnings.

- [ ] **Step 7: Commit**

```bash
git add src/components/overview/OverviewCustomize.tsx src/components/overview/OverviewCustomize.test.tsx src/pages/OverviewPage.test.tsx
git commit -m "feat(overview): Customize lists showing views in their order with grips, hidden ones under a Hidden divider — the ↑/↓ buttons and position numbers retire"
```

---

### Task 3: the drag — boxes inert while a row is up; keyboard, Escape and pointer pinned

**Files:**
- Modify: `src/components/overview/OverviewCustomize.test.tsx` (the import block + one appended
  `describe`)
- Modify: `src/components/overview/OverviewCustomize.tsx` (the `inert` constant and two `disabled`
  props)
- Modify: `src/pages/OverviewPage.test.tsx` (one new test after the popover test)

Task 2 already wired `useReorder`. Four of the five component tests below **pin** that wiring and
pass on their first run, and so does the page test (R0 Task 6 works the same way). One test —
"lifting a row makes every box of its own list inert" — is new behaviour and fails first.

- [ ] **Step 1: Widen the test file's imports**

In `src/components/overview/OverviewCustomize.test.tsx`, replace the import block (the first six
lines) with:

```tsx
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_OVERVIEW_LAYOUT } from '../../prefs/overviewLayout'
import type { OverviewLayout } from '../../prefs/overviewLayout'
import { installPointerEvents } from '../../testing/pointer'
import { MOTION_MS } from '../../theme/motion'
import OverviewCustomize from './OverviewCustomize'
```

- [ ] **Step 2: Append the drag tests**

Append to the end of `src/components/overview/OverviewCustomize.test.tsx`:

```tsx
/** jsdom has no layout: every drag row gets a box `height` tall, stacked from y=200 in DOM order
 *  (the tiles' rows first, then the cards'), clear of the viewport's 40px auto-scroll zones.
 *  useReorder measures these once at lift (R0's useReorder.test.tsx helper). */
function layoutRows(height = 40, start = 200) {
  document.querySelectorAll<HTMLElement>('[data-reorder-id]').forEach((row, index) => {
    const top = start + index * height
    row.getBoundingClientRect = () =>
      ({ top, bottom: top + height, height, left: 0, right: 360, width: 360, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
  })
}

const live = (legend: Legend) => list(legend).querySelector('[aria-live="assertive"]')?.textContent ?? ''

describe('OverviewCustomize — dragging (2026-09-23 spec §6, §2.3–§2.4)', () => {
  beforeAll(() => installPointerEvents())

  beforeEach(() => {
    // jsdom only logs window.scrollBy as not implemented; the hook scrolls when a row nears an edge.
    vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  })

  it('Space lifts a tile, ↓ moves it, Space drops: one layout change, the rows follow, the grip keeps its focus', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    openPopover()
    layoutRows()
    grip('Net worth').focus()
    fireEvent.keyDown(grip('Net worth'), { key: ' ' })
    expect(live('Summary tiles')).toBe('Picked up Net worth. Position 1 of 4.')
    expect(grip('Net worth').getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(grip('Net worth'), { key: 'ArrowDown' })
    expect(live('Summary tiles')).toBe('Net worth, position 2 of 4.')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(grip('Net worth'), { key: ' ' })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({
      tiles: ['portfolio', 'net_worth', 'living_spending', 'tax'],
      cards: DEFAULT_CARDS,
    })
    expect(lines('Summary tiles')).toEqual([
      '⋮ [x] Portfolio',
      '⋮ [x] Net worth',
      '⋮ [x] Living spending',
      '⋮ [x] Estimated tax',
    ])
    expect(live('Summary tiles')).toBe('Dropped Net worth at position 2 of 4.')
    expect(document.activeElement).toBe(grip('Net worth'))
  })

  it('the deeper views reorder on their own: End sends one to the bottom and the tiles stay put', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    openPopover()
    layoutRows()
    fireEvent.keyDown(grip('Year to date'), { key: 'Enter' })
    expect(live('Deeper views')).toBe('Picked up Year to date. Position 1 of 4.')
    expect(live('Summary tiles')).toBe('')
    fireEvent.keyDown(grip('Year to date'), { key: 'End' })
    fireEvent.keyDown(grip('Year to date'), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({
      tiles: ['net_worth', 'portfolio', 'living_spending', 'tax'],
      cards: ['performance', 'spending', 'money_flow', 'ytd'],
    })
  })

  it('Escape while a row is lifted cancels only the drag; the next Escape closes the popover and hands focus back', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    openPopover()
    layoutRows()
    grip('Portfolio').focus()
    fireEvent.keyDown(grip('Portfolio'), { key: ' ' })
    fireEvent.keyDown(grip('Portfolio'), { key: 'ArrowUp' })
    fireEvent.keyDown(grip('Portfolio'), { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Customize overview' })).toBeTruthy()
    expect(live('Summary tiles')).toBe('Cancelled. Portfolio is back at position 2 of 4.')
    expect(lines('Summary tiles')[1]).toBe('⋮ [x] Portfolio')
    fireEvent.keyDown(grip('Portfolio'), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Customize overview' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Customize' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('lifting a row makes every box of its own list inert until it lands', () => {
    render(<Harness initial={{ tiles: ['net_worth', 'portfolio'], cards: ['ytd'] }} />)
    openPopover()
    layoutRows()
    fireEvent.keyDown(grip('Net worth'), { key: ' ' })
    expect(box('Net worth').disabled).toBe(true)
    expect(box('Living spending').disabled).toBe(true)
    expect(box('Year to date').disabled).toBe(false)
    fireEvent.keyDown(grip('Net worth'), { key: 'Escape' })
    expect(box('Net worth').disabled).toBe(false)
    expect(box('Living spending').disabled).toBe(false)
  })

  it('a mouse drag lands where the gap opened and commits once; released far below the popover, it leaves it open', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    openPopover()
    layoutRows()
    // Pressing the grip is a pointerdown INSIDE the surface: usePopoverDismiss lets it be.
    fireEvent.pointerDown(grip('Net worth'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Net worth'), { pointerId: 1, clientY: 230 })
    expect(live('Summary tiles')).toBe('Picked up Net worth. Position 1 of 4.')
    fireEvent.pointerMove(grip('Net worth'), { pointerId: 1, clientY: 305 })
    expect(live('Summary tiles')).toBe('Net worth, position 3 of 4.')
    // Far below the popover the row clamps to the end of its list. Capture keeps the up on the
    // grip, and the popover's dismissal listens to pointerdown only, so nothing here closes it.
    fireEvent.pointerMove(grip('Net worth'), { pointerId: 1, clientY: 900 })
    expect(live('Summary tiles')).toBe('Net worth, position 4 of 4.')
    fireEvent.pointerUp(grip('Net worth'), { pointerId: 1, clientY: 900 })
    expect(onChange).not.toHaveBeenCalled() // still easing into its gap
    act(() => {
      vi.advanceTimersByTime(MOTION_MS.fast)
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({
      tiles: ['portfolio', 'living_spending', 'tax', 'net_worth'],
      cards: DEFAULT_CARDS,
    })
    expect(lines('Summary tiles')).toEqual([
      '⋮ [x] Portfolio',
      '⋮ [x] Living spending',
      '⋮ [x] Estimated tax',
      '⋮ [x] Net worth',
    ])
    expect(screen.getByRole('dialog', { name: 'Customize overview' })).toBeTruthy()
  })
})
```

The arithmetic behind the pointer test: rows are 40 px tall from y=200, so the tile midpoints are
220, 260, 300 and 340.
- Net worth dragged +85 has its centre at 305. That passes Portfolio (260) and Living spending
  (300) but not Estimated tax (340), so it goes to slot 2 ("position 3 of 4").
- Dragged to 900 it clamps at +120, which puts its centre exactly on Estimated tax's midpoint.
  R0's tie rule lands it last.

- [ ] **Step 3: Add the page-level Escape test**

In `src/pages/OverviewPage.test.tsx`, directly after the
`it('the Customize popover opens as a dialog, closes on Escape / outside pointer / Done, and names the spending card as titled', …)`
block, and before the `})` that closes `describe('OverviewPage independent groups and preferences')`,
insert:

```tsx
  // 2026-09-23 drag spec §6/§9: an Escape while a tile is lifted cancels the lift, never the popover.
  it('Escape while a tile is lifted cancels only the drag — the popover stays open and the tiles keep their order', async () => {
    const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    serve()
    renderPage()
    await screen.findByText('Net worth — Aug 2026')
    const trigger = screen.getByRole('button', { name: 'Customize' })
    fireEvent.click(trigger)
    const grip = screen.getByRole('button', { name: 'Reorder Portfolio' })
    grip.focus()
    for (const key of [' ', 'ArrowUp', 'Escape']) fireEvent.keyDown(grip, { key })
    expect(screen.getByRole('dialog', { name: 'Customize overview' })).toBeTruthy()
    expect(document.querySelector('.kpi-row .stat-label')?.textContent).toBe('Net worth — Aug 2026')
    expect(getLocal('overview_layout')).toBeUndefined()
    fireEvent.keyDown(grip, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Customize overview' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
    scroll.mockRestore()
  })
```

- [ ] **Step 4: Run the tests — exactly one failure**

Run: `npx vitest run src/components/overview/OverviewCustomize.test.tsx src/pages/OverviewPage.test.tsx`

Expected: FAIL with exactly **one** failed test, "lifting a row makes every box of its own list
inert until it lands" (`expected false to be true` on `box('Net worth').disabled`). Every other
test passes, including the four new pinned drag tests and the new page test.
- If a pinned test fails instead, the Task 2 wiring is wrong: fix `OverviewCustomize.tsx`, never
  the test.
- If the Escape test sees the dialog close on the first Escape, the capture-phase Escape is not
  reaching R0's window listener. Report that to the controller: it is R0's, not this lane's.

- [ ] **Step 5: Make the boxes inert while a row is up**

Replace `src/components/overview/OverviewCustomize.tsx` with the version below. The only changes
from Task 2 are the `inert` constant and the two `disabled` props that read it.

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { DEFAULT_OVERVIEW_LAYOUT, OVERVIEW_CARDS, OVERVIEW_TILES } from '../../prefs/overviewLayout'
import type { OverviewCard, OverviewLayout, OverviewTile } from '../../prefs/overviewLayout'
import DragHandle from '../reorder/DragHandle'
import { ReorderInstructions, ReorderLiveRegion } from '../reorder/ReorderStatus'
import { useReorder } from '../reorder/useReorder'
import { usePopoverDismiss } from '../usePopoverDismiss'

type View = OverviewTile | OverviewCard

// Labels mirror the tile and card titles exactly (2026-09-13 polish spec §14): the spending
// card is titled "Recent spending", so its checkbox is too.
const LABELS: Record<View, string> = {
  net_worth: 'Net worth',
  portfolio: 'Portfolio',
  living_spending: 'Living spending',
  tax: 'Estimated tax',
  ytd: 'Year to date',
  performance: 'Portfolio performance',
  spending: 'Recent spending',
  money_flow: 'Money flow',
}

const labelOf = (id: View) => LABELS[id]

// One fieldset of the popover (2026-09-23 drag-to-reorder spec §6). The views that show come
// first, in the stored order — each a grip · box · label row the drag moves. Then, only when
// something is hidden, a quiet "Hidden" divider and the rest in default order: box · label, no
// grip. Ticking appends a view to the order; unticking takes it out; a drop is one onChange with
// the new order. The layout is a local preference that applies at once (Reset to defaults is its
// undo), so there is no busy state, no toast and no saved flash — on the other five lists the
// flash means "the server took it", and nothing here waits on a server. Mounted only while the
// popover is open: every opening starts with a fresh drag state, and a popover closed mid-lift
// takes the lift down with it.
function CustomizeGroup<K extends View>({
  legend,
  all,
  visible,
  keepOne,
  onChange,
}: {
  legend: string
  /** Every view of the group, in default order. */
  all: readonly K[]
  /** The views that show, in the stored order. */
  visible: readonly K[]
  /** The summary tiles never go empty: the last one's box is disabled. */
  keepOne: boolean
  onChange: (next: K[]) => void
}) {
  const fieldsetRef = useRef<HTMLFieldSetElement>(null)
  const reorder = useReorder<K>({
    items: visible.map((id) => ({ id })),
    labelOf,
    onCommit: (next) => onChange(next),
  })
  const hidden = all.filter((id) => !visible.includes(id))
  // While a row is up, every box of this list is inert (R0's consumer rule 5): a tick mid-lift
  // would change the items under the drag, and the hook would silently cancel it.
  const inert = reorder.active
  // A tick moves its row across the divider, and React mounts a new box for it there: commit the
  // change now and hand the caret to the new box, or a keyboard reader lands on <body>.
  const toggle = (id: K, show: boolean) => {
    flushSync(() => onChange(show ? [...visible, id] : visible.filter((item) => item !== id)))
    fieldsetRef.current?.querySelector<HTMLInputElement>(`input[value="${id}"]`)?.focus()
  }
  return (
    <fieldset ref={fieldsetRef}>
      <legend>{legend}</legend>
      {/* One pair per list (spec §8.2): this list's grips point at these instructions, and the
          list speaks in its own region. */}
      <ReorderInstructions id={reorder.instructionsId} />
      <ReorderLiveRegion text={reorder.announcement} />
      {visible.map((id) => (
        <div key={id} className="overview-customize-row" {...reorder.itemProps(id)}>
          <DragHandle name={LABELS[id]} {...reorder.handleProps(id)} />
          <label>
            <input type="checkbox" value={id} checked disabled={inert || (keepOne && visible.length === 1)} onChange={() => toggle(id, false)} />
            {LABELS[id]}
          </label>
        </div>
      ))}
      {hidden.length > 0 && <div className="overview-customize-divider">Hidden</div>}
      {hidden.map((id) => (
        <div key={id} className="overview-customize-row is-off">
          <label>
            <input type="checkbox" value={id} checked={false} disabled={inert} onChange={() => toggle(id, true)} />
            {LABELS[id]}
          </label>
        </div>
      ))}
    </fieldset>
  )
}

// A popover, not a <details> (spec §11): outside pointer and Escape close it, focus returns to
// the button, and it wears the shared .popover-surface (F2's tokens and pop-in motion). An Escape
// pressed while a row is lifted never reaches usePopoverDismiss: useReorder takes it on window in
// the capture phase and cancels only the drag (2026-09-23 drag spec §2.3).
export default function OverviewCustomize({ value, onChange }: { value: OverviewLayout; onChange: (value: OverviewLayout) => void }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  // Stable (useCallback): usePopoverDismiss re-subscribes its document listeners on every new
  // identity, and this component re-renders on every layout edit made inside the popover.
  const close = useCallback(() => setOpen(false), [])
  usePopoverDismiss(open, close, triggerRef, surfaceRef)
  // role="dialog" contract: opening moves focus INTO the surface — onto the first control that can
  // take it (a lone summary tile's grip and box are both disabled); Escape, an outside pointer and
  // Done all hand it back to the trigger.
  useEffect(() => {
    if (!open) return
    surfaceRef.current?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')?.focus()
  }, [open])
  const done = () => { setOpen(false); triggerRef.current?.focus() }
  return <div className="overview-customize">
    <button ref={triggerRef} type="button" className="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)}>Customize</button>
    {open && <div ref={surfaceRef} className="popover-surface overview-customize-menu" role="dialog" aria-label="Customize overview">
      <CustomizeGroup legend="Summary tiles" all={OVERVIEW_TILES} visible={value.tiles} keepOne onChange={(tiles) => onChange({ ...value, tiles })} />
      <CustomizeGroup legend="Deeper views" all={OVERVIEW_CARDS} visible={value.cards} keepOne={false} onChange={(cards) => onChange({ ...value, cards })} />
      <div className="overview-customize-actions">
        <button type="button" className="button" onClick={() => onChange(DEFAULT_OVERVIEW_LAYOUT)}>Reset to defaults</button>
        <button type="button" className="button button-primary" onClick={done}>Done</button>
      </div>
    </div>}
  </div>
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run src/components/overview/OverviewCustomize.test.tsx src/pages/OverviewPage.test.tsx`
Expected: PASS — 12 tests in `OverviewCustomize.test.tsx` (7 list tests + 5 drag tests), and every
test in `OverviewPage.test.tsx`.

- [ ] **Step 7: Type-check, lint, commit**

```bash
npx tsc -b
npx eslint src/components/overview/OverviewCustomize.tsx src/components/overview/OverviewCustomize.test.tsx src/pages/OverviewPage.test.tsx
git add src/components/overview/OverviewCustomize.tsx src/components/overview/OverviewCustomize.test.tsx src/pages/OverviewPage.test.tsx
git commit -m "feat(overview): a lifted Customize row makes its list's boxes inert; keyboard, Escape-in-the-popover and pointer drags pinned"
```

---

### Task 4: the rows' CSS — one height with or without a grip, boxes in one column, a quiet divider

**Files:**
- Modify: `src/pages/OverviewPage.css:185-188`
- Modify: `src/components/overview/OverviewCustomize.test.tsx` (the import block + one appended
  `describe`)

jsdom computes no layout, so these rules can only be pinned as text here. Task 7 then measures them
in a real browser.

- [ ] **Step 1: Widen the imports again**

In `src/components/overview/OverviewCustomize.test.tsx`, replace the import block (the first eight
lines) with:

```tsx
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_OVERVIEW_LAYOUT } from '../../prefs/overviewLayout'
import type { OverviewLayout } from '../../prefs/overviewLayout'
import { installPointerEvents } from '../../testing/pointer'
import { MOTION_MS } from '../../theme/motion'
import OverviewCustomize from './OverviewCustomize'
```

- [ ] **Step 2: Append the failing CSS pins**

Append to the end of `src/components/overview/OverviewCustomize.test.tsx`:

```tsx
/** Comments first, over the WHOLE file (overviewCss.test.ts's rule): a `}` inside a comment would
 *  otherwise truncate a block. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every declaration of `selector`, concatenated across blocks. */
function declarationsFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blocks = [...stripComments(css).matchAll(new RegExp(`(^|[,{}])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
  if (blocks.length === 0) throw new Error(`no ${selector} block`)
  return blocks.map((match) => match[2]).join(' ')
}

// The rows' CSS lives with the page (OverviewPage.css). It is pinned here rather than in
// overviewCss.test.ts because that file is outside this lane's fence and an in-flight lane edits it.
describe('OverviewPage.css — the Customize rows (2026-09-23 spec §6)', () => {
  const css = readFileSync(path.resolve(__dirname, '../../pages/OverviewPage.css'), 'utf8')

  it('gives every row one height and one gap, grip or not, and room for the lifted surface', () => {
    // useReorder measures the rows once at lift and keeps those gaps while it makes room.
    const row = declarationsFor(css, '.overview-customize-row')
    expect(row).toContain('min-height: 1.75rem;')
    expect(row).toContain('margin: .3rem -.35rem;')
    expect(row).toContain('padding: 0 .35rem;')
    expect(row).toContain('--customize-grip: 1.25rem;')
  })

  it("stands a hidden row's box under the boxes above it and draws the divider quietly", () => {
    expect(declarationsFor(css, '.overview-customize-row > .reorder-grip')).toContain('flex: 0 0 var(--customize-grip);')
    expect(declarationsFor(css, '.overview-customize-row.is-off')).toContain(
      'padding-left: calc(.35rem + var(--customize-grip) + .35rem);',
    )
    expect(declarationsFor(css, '.overview-customize-divider')).toContain('color: var(--muted);')
    expect(declarationsFor(css, '.overview-customize-divider::after')).toContain('border-top: 1px solid var(--border);')
  })

  it('keeps no rule for the retired position number or ↑/↓ buttons', () => {
    const plain = stripComments(css)
    expect(plain).not.toContain('.overview-customize-row > span')
    expect(plain).not.toContain('.overview-customize-row .button')
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/components/overview/OverviewCustomize.test.tsx`

Expected: FAIL — the three CSS tests fail, and the 12 component tests still pass.
- The row block lacks `min-height: 1.75rem;`.
- `no .overview-customize-row > .reorder-grip block` is thrown.
- `.overview-customize-row > span` is still in the file.

- [ ] **Step 4: Replace the row rules in `src/pages/OverviewPage.css`**

Replace these four lines (185–188):

```css
.overview-customize-row { display: flex; align-items: center; gap: .35rem; margin: .45rem 0; font-size: .8rem; }
.overview-customize-row label { flex: 1; display: flex; gap: .45rem; align-items: center; }
.overview-customize-row > span { color: var(--muted); font-size: .7rem; min-width: 2rem; text-align: center; }
.overview-customize-row .button { padding: .25rem .45rem; }
```

with:

```css
/* Customize rows (2026-09-23 drag-to-reorder spec §6): grip · box · label for a view that shows,
   box · label under the "Hidden" divider for one that does not. One height with or without a
   grip, and one collapsed margin between rows: useReorder measures the rows once at lift and keeps
   those gaps while it makes room, so a row that changed height mid-drag would land off by the
   difference. The side padding, cancelled by the negative margin, is room for the lifted row's
   surface and shadow (reorder.css); the grip column is a fixed width so a hidden row's box stands
   under the boxes above it. */
.overview-customize-row { --customize-grip: 1.25rem; display: flex; align-items: center; gap: .35rem; min-height: 1.75rem; margin: .3rem -.35rem; padding: 0 .35rem; font-size: .8rem; }
.overview-customize-row > .reorder-grip { flex: 0 0 var(--customize-grip); }
.overview-customize-row.is-off { padding-left: calc(.35rem + var(--customize-grip) + .35rem); }
.overview-customize-row label { flex: 1; display: flex; gap: .45rem; align-items: center; }
/* The quiet line between what shows and what does not: a muted word, then a hairline. */
.overview-customize-divider { display: flex; align-items: center; gap: .5rem; margin: .5rem 0 .2rem; color: var(--muted); font-size: .7rem; }
.overview-customize-divider::after { content: ''; flex: 1; border-top: 1px solid var(--border); }
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/components/overview/OverviewCustomize.test.tsx src/pages/overviewCss.test.ts src/theme/motion.test.ts`
Expected: PASS.
- `OverviewCustomize.test.tsx` passes all 15 tests.
- `overviewCss.test.ts`'s existing pins are untouched.
- `motion.test.ts` still finds no literal duration in any stylesheet.

- [ ] **Step 6: Lint and commit**

```bash
npx tsc -b
npx eslint src/components/overview/OverviewCustomize.test.tsx
git add src/pages/OverviewPage.css src/components/overview/OverviewCustomize.test.tsx
git commit -m "style(overview): Customize rows keep one height with or without a grip, hidden boxes line up, a quiet Hidden divider"
```

---

### Task 5: the Guide's Customize task (APPROVED by the controller, 2026-09-23)

**Approved — run it.** The Guide must not describe controls this lane removes, and the user asked
for every recommendation to be applied. The fence for this lane now includes
`src/guide/content/pages-tracking.tsx`, limited to the `overview-customize` task's `steps`.

**Files:**
- Modify: `src/guide/content/pages-tracking.tsx:31-36` (the `overview-customize` task's `steps`)

The fence tests in `src/guide/guideContent.test.ts` keep this honest:
- every `**Label**` must be text the UI source contains (`Summary tiles`, `Deeper views`, `Hidden`
  and `Reset to defaults` all do after Task 2);
- every step must be at most 160 characters. The longest line below is 148.

In-flight lane CT edits this file around line 376, far from these lines.

- [ ] **Step 1: Replace the steps**

Replace:

```ts
        steps: [
          'Press **Customize** in the title row.',
          'Tick or untick items under **Summary tiles** and **Deeper views**.',
          'Reorder an item with its ↑ or ↓ button; **Reset to defaults** restores the shipped order.',
          'Press **Done** — the layout saves to your account, not to this browser alone.',
        ],
```

with:

```ts
        steps: [
          'Press **Customize** in the title row.',
          'Tick or untick items under **Summary tiles** and **Deeper views**; an unticked item waits under **Hidden**, and ticking it again adds it at the end.',
          'Drag an item by its grip to reorder it, or focus the grip and press Space, move it with the arrow keys and press Space again.',
          '**Reset to defaults** restores the shipped order and shows everything.',
          'Press **Done** — the layout saves to your account, not to this browser alone.',
        ],
```

- [ ] **Step 2: Run the Guide's fences and page tests**

Run: `npx vitest run src/guide src/pages/GuidePage.test.tsx src/components/paletteRegistry.guide.test.ts`
Expected: PASS.

- [ ] **Step 3: Lint and commit**

```bash
npx eslint src/guide/content/pages-tracking.tsx
git add src/guide/content/pages-tracking.tsx
git commit -m "fix(guide): the Customize task names the grip and the Hidden divider, not the retired ↑/↓ buttons"
```

---

### Task 6: the lane's gates

**Files:** none (verification only). Record every result in Task 8.

- [ ] **Step 1: The lane's own tests**

Run: `npx vitest run src/components/overview/OverviewCustomize.test.tsx src/pages/OverviewPage.test.tsx src/components/reorder src/guide`
Expected: PASS.

- [ ] **Step 2: The full frontend suite**

Run: `npx vitest run`
Expected: exit 0. Record the file and test counts.

If anything outside this lane's files fails:
1. Run the same command in `.worktrees/reorder-base` (it has its own `node_modules` symlink).
2. If it also fails there, it is pre-existing: record it and do not fix it here.
3. If it only fails here, it is this lane's: fix it (TDD) before going on.

- [ ] **Step 3: Types, lint, build**

Run: `npx tsc -b && npx eslint . && npm run build`
Expected: all three exit 0. `eslint .` reports no warning in any file this lane touched.

- [ ] **Step 4: Scope check**

Run: `git diff --stat feat/reorder-base...HEAD`

Expected: only these files —
- `src/components/overview/OverviewCustomize.tsx`
- `src/components/overview/OverviewCustomize.test.tsx`
- `src/pages/OverviewPage.css`
- `src/pages/OverviewPage.test.tsx`
- and, if Task 5 ran, `src/guide/content/pages-tracking.tsx`.

Also confirm with `git diff feat/reorder-base...HEAD -- src/pages/OverviewPage.css` that only the
Customize row block changed.

---

### Task 7: browser check — both themes at 1280 and 1600, on the lane's own servers

**Files:**
- Create: `scratchpad/reorder-r4/customize.mjs` (the repo's `.gitignore` covers `scratchpad/` —
  never commit it)

What it proves in a real browser, for dark and light at 1280 and 1600:
- a real mouse drag lifts a row that follows the pointer, its peers make room, and the Overview's
  tiles behind the popover take the new order;
- Escape mid-drag keeps the popover open, and the next Escape closes it and returns focus;
- a card hides and re-shows (appended), every row is one height, and every box stands in one
  column;
- the layout survives a reload and reaches a fresh browser through the server (the pref sync);
- the console is clean.

It writes only through the lane's backend on the private copy — the account's prefs — and puts the
layout back to the defaults at the end.

- [ ] **Step 1: Prerequisites — the private database (the CONTROLLER runs these once)**

```bash
# The lane's private copy of the shared read-only restore. pg_dump | psql — never
# CREATE DATABASE … TEMPLATE, which fails while other sessions hold finance_realdata open.
docker exec finance-dashboard-db-1 createdb -U finance finance_reorder_r4
docker exec finance-dashboard-db-1 sh -c 'pg_dump -U finance --no-owner --no-privileges finance_realdata | psql -q -v ON_ERROR_STOP=1 -U finance -d finance_reorder_r4'
# Migrate it to the branch's head (a no-op unless R1's migration is already on the base).
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r4/backend
DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_reorder_r4 \
  /c/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m alembic upgrade head
```

The implementer only checks that the copy is there:

```bash
docker exec finance-dashboard-db-1 psql -U finance -d finance_reorder_r4 -tAc "select count(*) from accounts"
```

Expected: `29`. If the database does not exist, stop and report BLOCKED — the controller owns it.
Never point anything at `finance_realdata` or `finance`.

- [ ] **Step 2: Start the lane's backend (background)**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r4/backend
PY=/c/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe
$PY -c "import app; print(app.__file__)"
```

The last line must print `…/.worktrees/reorder-r4/backend/app/__init__.py`. Then start the server
with `run_in_background`:

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r4/backend && \
DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_reorder_r4 SCHEDULER_ENABLED=0 \
/c/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8094
```

Check: `curl -s http://127.0.0.1:8094/api/v1/health` prints `{"status":"ok"}`.

- [ ] **Step 3: Start the lane's vite (background)**

With `run_in_background`:

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r4 && \
VITE_API_PROXY=http://127.0.0.1:8094 npx vite --port 5194 --strictPort
```

Check: `curl -s -o /dev/null -w '%{http_code}' http://localhost:5194/` prints `200`. Use
`localhost`, not `127.0.0.1`: vite listens on `[::1]` on this box.

- [ ] **Step 4: Write the driver**

Run `mkdir -p scratchpad/reorder-r4` from the worktree root, then create
`scratchpad/reorder-r4/customize.mjs`:

```js
// scratchpad/reorder-r4/customize.mjs — lane R4's browser check (2026-09-23 drag-to-reorder
// spec §6, §9, §10). NOT a tracked probe (lane V owns tools/probes/reorder-v/): a lane-local
// driver in the gitignored scratchpad, run against the lane's OWN servers — uvicorn on 8094
// serving the private copy finance_reorder_r4, vite on 5194 proxying to it.
//
// For each theme × width (dark/light × 1280/1600) it opens /, opens Customize, and:
//   1. drags Net worth's grip with a real mouse (down · move · up) to the bottom of the tiles —
//      the row lifts and follows the pointer, its peers make room, and the Overview's tiles
//      BEHIND the popover take the new order when it lands;
//   2. presses Escape mid-drag — the drag is cancelled, the popover stays open, nothing moved;
//      the next Escape closes it and hands focus back to the trigger;
//   3. hides Recent spending (its card leaves the page, its row goes under "Hidden"), measures
//      that every row is one height and every box one column, then shows it again (appended);
//   4. checks the server holds the new layout, reloads, then opens a FRESH browser (no
//      localStorage) — both must show the new order: that is the pref sync.
// Every mutating request except the login and PATCH /prefs is ABORTED and reported. The layout
// is put back to the defaults through the API before each pass and at the end.
//
// Run from the worktree root:  node scratchpad/reorder-r4/customize.mjs
// Prints `R4 CUSTOMIZE CHECK OK — 112 checks, 20 screenshots …` or exits 1 listing every problem;
// report.json and the PNGs land next to this file.
//
// The first two lines spoof the node version: this box runs node 18 and playwright-core refuses
// anything under 20 (the sandbox-v smoke's boilerplate, as is the launch below).
Object.defineProperty(process, 'version', { value: 'v20.19.0' })
Object.defineProperty(process.versions, 'node', { value: '20.19.0' })
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_CORE ??
    'C:/Users/edyli/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core',
)

const out = process.env.SMOKE_OUT ?? path.dirname(fileURLToPath(import.meta.url))
mkdirSync(out, { recursive: true })
const APP = process.env.APP_BASE ?? 'http://localhost:5194'
const API = process.env.API_BASE ?? 'http://127.0.0.1:8094'
const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const THEMES = ['dark', 'light']
const WIDTHS = [1280, 1600]
const SETTLE = 1800
const MOTION_FAST = 120 // MOTION_MS.fast (src/theme/motion.ts): the pointer drop's settle
const DEFAULT = {
  tiles: ['net_worth', 'portfolio', 'living_spending', 'tax'],
  cards: ['ytd', 'performance', 'spending', 'money_flow'],
}
// After step 1 (Net worth dragged last) and step 3 (Recent spending hidden, then shown again).
const EXPECTED = {
  tiles: ['portfolio', 'living_spending', 'tax', 'net_worth'],
  cards: ['ytd', 'performance', 'money_flow', 'spending'],
}
const TILE_KEYS = [
  ['Net worth', 'net_worth'],
  ['Portfolio', 'portfolio'],
  ['Living spending', 'living_spending'],
  ['Estimated tax', 'tax'],
]
const CARD_KEYS = [
  ['Year to date', 'ytd'],
  ['Portfolio performance', 'performance'],
  ['Recent spending', 'spending'],
  ['Money flow', 'money_flow'],
]
const WRITE_ALLOW = [/\/api\/v1\/auth\/(login|renew)$/, /\/api\/v1\/prefs$/]
const NOISE = /favicon|DevTools|\[vite\]|@vite\/client|Download the React DevTools|React Router Future Flag/i

const report = {
  generatedAt: new Date().toISOString(),
  app: APP,
  api: API,
  checks: [],
  prefsWrites: [],
  blockedWrites: [],
  files: [],
  problems: [],
}
const check = (where, name, ok, observed) => {
  report.checks.push({ where, name, ok, observed })
  if (!ok) report.problems.push(`${where}: ${name} — observed ${JSON.stringify(observed)}`)
  return ok
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// The cards on the page must follow the expected order; a feed that has not drawn the YTD card
// leaves it out, which never reorders the rest.
const followsOrder = (seen, expected) => same(seen, expected.filter((id) => seen.includes(id)))
const keyOf = (pairs, text) =>
  pairs.find(([prefix]) => text.trim().startsWith(prefix))?.[1] ?? `?${text.trim().slice(0, 40)}`
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ── API: the dev seed login and the layout reset (the private copy only) ──────────────────────
const login = await fetch(`${API}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@example.com', password: 'changeme123' }),
})
if (!login.ok) {
  console.error(`login on ${API} failed: HTTP ${login.status} — is the lane's uvicorn up on finance_reorder_r4?`)
  process.exit(1)
}
const TOKEN = (await login.json()).access_token
const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

async function serverLayout() {
  const response = await fetch(`${API}/api/v1/prefs`, { headers: auth })
  return (await response.json()).prefs?.overview_layout?.value ?? null
}

async function resetLayout() {
  const response = await fetch(`${API}/api/v1/prefs`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ overview_layout: DEFAULT }),
  })
  if (!response.ok) throw new Error(`layout reset failed: HTTP ${response.status}`)
}

// ── Browser plumbing ──────────────────────────────────────────────────────────────────────────
async function openContext(browser, theme, width, where) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 })
  // Seeded before first paint: the app boots its auth and theme out of localStorage, and the
  // "landed" flag keeps an account landing page from bouncing `/` elsewhere.
  await ctx.addInitScript(
    ([token, th]) => {
      localStorage.setItem('finance_token', token)
      localStorage.setItem('finance.theme', th)
      sessionStorage.setItem('finance.landed', '1')
    },
    [TOKEN, theme],
  )
  // The write fence — registered FIRST: playwright runs the last-registered matching handler and
  // continue() goes straight to the network, so the /prefs handler below must come after it.
  await ctx.route('**/api/v1/**', (route) => {
    const request = route.request()
    const method = request.method()
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue()
    if (WRITE_ALLOW.some((re) => re.test(new URL(request.url()).pathname))) return route.continue()
    report.blockedWrites.push({ where, method, url: request.url() })
    report.problems.push(`${where}: BLOCKED a write this check must never make — ${method} ${request.url()}`)
    return route.abort()
  })
  // The account owns the theme: this pass's theme is injected into GET /prefs so the app adopts
  // it. PATCH /prefs goes THROUGH — the layout's server sync is what step 4 checks (private DB).
  const themeEntry = { value: theme, updated_at: new Date().toISOString() }
  await ctx.route('**/api/v1/prefs', async (route) => {
    const request = route.request()
    if (request.method() !== 'GET') {
      report.prefsWrites.push({ where, method: request.method(), body: (request.postData() ?? '').slice(0, 300) })
      return route.continue()
    }
    try {
      const response = await route.fetch()
      const body = await response.json()
      body.prefs = { ...(body.prefs ?? {}), theme: themeEntry }
      return route.fulfill({ status: response.status(), contentType: 'application/json', body: JSON.stringify(body) })
    } catch (error) {
      report.problems.push(`${where}: GET /prefs could not be read (${error.message})`)
      return route.continue()
    }
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error' && !NOISE.test(message.text())) errors.push(message.text().slice(0, 300))
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${String(error.message).slice(0, 300)}`))
  return { ctx, page, errors }
}

async function landOnOverview(page) {
  try {
    await page.goto(`${APP}/`, { waitUntil: 'networkidle', timeout: 45000 })
  } catch {
    await page.goto(`${APP}/`, { waitUntil: 'load', timeout: 45000 })
  }
  await page.waitForFunction(() => document.querySelectorAll('.kpi-row .stat-label-text').length === 4, null, {
    timeout: 30000,
  })
  await page.waitForTimeout(SETTLE)
}

const tileOrder = async (page) =>
  (await page.locator('.kpi-row .stat-label-text').allTextContents()).map((text) => keyOf(TILE_KEYS, text))
const cardOrder = async (page) =>
  (await page.locator('.overview-deeper > *').evaluateAll((cards) => cards.map((card) => card.querySelector('h2')?.textContent ?? '')))
    .filter((title) => title !== '')
    .map((title) => keyOf(CARD_KEYS, title))
const dialog = (page) => page.getByRole('dialog', { name: 'Customize overview' })
const gripOf = (page, name) => page.getByRole('button', { name: `Reorder ${name}`, exact: true })

async function openCustomize(page) {
  if ((await dialog(page).count()) === 0) await page.getByRole('button', { name: 'Customize', exact: true }).click()
  await dialog(page).waitFor({ state: 'visible' })
  await page.waitForTimeout(MOTION_FAST + 100) // the pop-in
}

const rowsOf = (page, legend) =>
  page
    .getByRole('group', { name: legend, exact: true })
    .locator('.overview-customize-row, .overview-customize-divider')
    .evaluateAll((rows) =>
      rows.map((row) =>
        row.classList.contains('overview-customize-divider')
          ? `— ${row.textContent.trim()} —`
          : `${row.querySelector('.reorder-grip') ? '⋮ ' : ''}${row.querySelector('input').checked ? '[x]' : '[ ]'} ${row.textContent.trim()}`,
      ),
    )

async function centre(locator) {
  const box = await locator.boundingBox()
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function shot(page, where, name) {
  const file = path.join(out, `${where}-${name}.png`)
  await page.screenshot({ path: file })
  report.files.push(path.basename(file))
}

// ── The passes ────────────────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'],
})
try {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const where = `${theme}-${width}`
      await resetLayout()
      const { ctx, page, errors } = await openContext(browser, theme, width, where)
      await landOnOverview(page)
      check(where, 'signed in (no bounce to /login)', !/\/login/.test(page.url()), page.url())
      const painted = await page.evaluate(() => document.documentElement.dataset.theme ?? null)
      check(where, 'the page paints this theme', painted === theme, painted)
      check(where, 'the tiles start in the default order', same(await tileOrder(page), DEFAULT.tiles), await tileOrder(page))

      await openCustomize(page)
      check(
        where,
        'the tiles list shows the stored order, a grip on every row',
        same(await rowsOf(page, 'Summary tiles'), ['⋮ [x] Net worth', '⋮ [x] Portfolio', '⋮ [x] Living spending', '⋮ [x] Estimated tax']),
        await rowsOf(page, 'Summary tiles'),
      )
      await shot(page, where, 'rest')

      // 1. A real mouse drag: Net worth to the bottom of the tiles.
      const from = await centre(gripOf(page, 'Net worth'))
      const to = await centre(page.locator('[data-reorder-id="tax"]'))
      const before = await page.locator('[data-reorder-id="net_worth"]').boundingBox()
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await page.mouse.move(from.x, from.y + 8, { steps: 2 }) // past the 4px threshold: lifts
      await page.mouse.move(from.x, to.y + 6, { steps: 12 })
      await page.waitForTimeout(MOTION_FAST + 60)
      const mid = await page.evaluate(() => ({
        lifted: document.querySelector('[data-reorder="lifted"]')?.getAttribute('data-reorder-id') ?? null,
        shifting: document.querySelectorAll('[data-reorder="shifting"]').length,
        grabbing: document.documentElement.classList.contains('reorder-active'),
      }))
      const during = await page.locator('[data-reorder-id="net_worth"]').boundingBox()
      check(where, 'the pressed row lifts', mid.lifted === 'net_worth', mid)
      check(where, 'its three peers make room', mid.shifting === 3, mid)
      check(where, 'the page says grabbing mid-drag', mid.grabbing, mid)
      check(where, 'the lifted row follows the pointer', during.y - before.y >= (to.y - from.y) * 0.8, {
        before: before.y,
        during: during.y,
        pointerTravel: to.y - from.y,
      })
      await shot(page, where, 'dragging')
      await page.mouse.up()
      await page.waitForTimeout(MOTION_FAST + 400)
      check(where, 'the tiles behind the popover took the new order', same(await tileOrder(page), EXPECTED.tiles), await tileOrder(page))
      check(
        where,
        'the popover lists the new order',
        same(await rowsOf(page, 'Summary tiles'), ['⋮ [x] Portfolio', '⋮ [x] Living spending', '⋮ [x] Estimated tax', '⋮ [x] Net worth']),
        await rowsOf(page, 'Summary tiles'),
      )
      check(where, 'the drop left the popover open', await dialog(page).isVisible(), null)
      await shot(page, where, 'dropped')

      // 2. Escape mid-drag cancels the drag only.
      const press = await centre(gripOf(page, 'Portfolio'))
      await page.mouse.move(press.x, press.y)
      await page.mouse.down()
      await page.mouse.move(press.x, press.y + 40, { steps: 5 })
      const liftedForEscape = await page.evaluate(
        () => document.querySelector('[data-reorder="lifted"]')?.getAttribute('data-reorder-id') ?? null,
      )
      await page.keyboard.press('Escape')
      await page.waitForTimeout(MOTION_FAST + 200)
      check(where, 'a row was up when Escape landed', liftedForEscape === 'portfolio', liftedForEscape)
      check(where, 'Escape mid-drag leaves the popover open', await dialog(page).isVisible(), null)
      await page.mouse.up()
      await page.waitForTimeout(MOTION_FAST + 200)
      check(where, 'the cancelled drag moved nothing', same(await tileOrder(page), EXPECTED.tiles), await tileOrder(page))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
      check(where, 'the next Escape closes the popover', (await dialog(page).count()) === 0, null)
      const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? null)
      check(where, '…and hands focus back to Customize', focused === 'Customize', focused)

      // 3. Hide a card, measure the rows, show it again.
      await openCustomize(page)
      await page.getByRole('checkbox', { name: 'Recent spending', exact: true }).click()
      await page.waitForTimeout(400)
      check(where, 'hiding Recent spending takes its card off the page', !(await cardOrder(page)).includes('spending'), await cardOrder(page))
      const deeper = await rowsOf(page, 'Deeper views')
      check(where, 'the hidden card waits under the Hidden divider', same(deeper.slice(-2), ['— Hidden —', '[ ] Recent spending']), deeper)
      const heights = await page
        .locator('.overview-customize-row')
        .evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)))
      check(where, 'every row is one height, grip or not', new Set(heights).size === 1, heights)
      const lefts = await page
        .locator('.overview-customize-row input')
        .evaluateAll((boxes) => boxes.map((b) => Math.round(b.getBoundingClientRect().left)))
      check(where, 'every box stands in one column', new Set(lefts).size === 1, lefts)
      await shot(page, where, 'hidden')
      await page.getByRole('checkbox', { name: 'Recent spending', exact: true }).click()
      await page.waitForTimeout(400)
      const shown = await cardOrder(page)
      check(where, 'showing it again appends it last', shown[shown.length - 1] === 'spending' && followsOrder(shown, EXPECTED.cards), shown)

      // 4. The pref sync: the server, a reload, a fresh browser.
      let stored = null
      for (let attempt = 0; attempt < 20; attempt += 1) {
        stored = await serverLayout()
        if (same(stored, EXPECTED)) break
        await pause(250)
      }
      check(where, 'the server holds the new layout', same(stored, EXPECTED), stored)
      await page.reload({ waitUntil: 'load' })
      await page.waitForFunction(() => document.querySelectorAll('.kpi-row .stat-label-text').length === 4, null, {
        timeout: 30000,
      })
      await page.waitForTimeout(SETTLE)
      check(where, 'a reload keeps the tile order', same(await tileOrder(page), EXPECTED.tiles), await tileOrder(page))
      check(where, 'a reload keeps the card order', followsOrder(await cardOrder(page), EXPECTED.cards), await cardOrder(page))
      check(where, 'clean console', errors.length === 0, errors)
      await ctx.close()

      const fresh = await openContext(browser, theme, width, `${where}-fresh`)
      await landOnOverview(fresh.page)
      let freshTiles = await tileOrder(fresh.page)
      for (let attempt = 0; attempt < 20 && !same(freshTiles, EXPECTED.tiles); attempt += 1) {
        await pause(250)
        freshTiles = await tileOrder(fresh.page)
      }
      check(where, 'a fresh browser gets the tile order from the server', same(freshTiles, EXPECTED.tiles), freshTiles)
      check(where, '…and the card order', followsOrder(await cardOrder(fresh.page), EXPECTED.cards), await cardOrder(fresh.page))
      await shot(fresh.page, where, 'fresh-browser')
      check(where, 'clean console (fresh browser)', fresh.errors.length === 0, fresh.errors)
      await fresh.ctx.close()
    }
  }
} finally {
  await resetLayout().catch((error) => report.problems.push(`final layout reset failed: ${error.message}`))
  await browser.close()
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
}

if (report.problems.length > 0) {
  console.error(`R4 CUSTOMIZE CHECK FAILED — ${report.problems.length} problem(s):`)
  for (const problem of report.problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log(`R4 CUSTOMIZE CHECK OK — ${report.checks.length} checks, ${report.files.length} screenshots in ${out}`)
```

- [ ] **Step 5: Run it**

Run: `node scratchpad/reorder-r4/customize.mjs`

Expected: `R4 CUSTOMIZE CHECK OK — 112 checks, 20 screenshots in …`. That is 28 checks and 5
screenshots per pass: `rest`, `dragging`, `dropped`, `hidden` and `fresh-browser` for
`dark-1280`, `dark-1600`, `light-1280` and `light-1600`.

When a check fails, read `report.json` and act by cause:
- **This lane's code or CSS:** fix it with a failing jsdom test first where jsdom can express it,
  re-run Task 6's gates, then re-run this driver.
- **R0's component** (the lift, the shifts, the cursor, the Escape capture): report it to the
  controller with the report line. `src/components/reorder/**` is outside this fence.
- **A console error unrelated to Customize** (it names another card, feed or page): record its
  text in Results and hand it to the controller, who can reproduce it on the base's own servers.
  Do not fix it here, and do not switch this worktree's branch to check.

- [ ] **Step 6: Look at the screenshots**

Open the 20 PNGs and confirm, in both themes:
- the grips sit in one column with the boxes beside them;
- the lifted row (`dragging`) wears the raised surface and shadow, and its shadow is not clipped
  by the popover;
- the "Hidden" divider (`hidden`) is a muted word with a hairline, quieter than the legends;
- the hidden row's box lines up under the boxes above;
- the tiles behind the popover are in the new order (`dropped`, `fresh-browser`).

Note anything off in Results.

- [ ] **Step 7: Stop the two servers**

Stop the background uvicorn (8094) and vite (5194) this task started. If the tool no longer holds
them, find them with `netstat -ano | grep -E ':(8094|5194) .*LISTENING'` and stop each with
`taskkill //F //T //PID <pid>`.

The private database stays (never delete databases), and nothing in this task is committed.

---

### Task 8: results

**Files:**
- Modify: this plan (`docs/superpowers/plans/2026-09-23-reorder-r4-overview.md`), the Results
  section below

- [ ] **Step 1: Fill in Results** with the numbers and outputs from Tasks 1–7.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-09-23-reorder-r4-overview.md
git commit -m "docs(plan): lane R4 — results, gates and browser check"
```

## Results (filled in by the implementer)

- Preflight (Task 1): the branch was cut at `0d805010` (the lane R0 merge into `feat/reorder-base`,
  which also holds main through lane B2). All seven R0 modules, their tests and
  `src/testing/pointer.ts` were present, and the grep printed exactly the five exports. Baseline
  `src/components/reorder` + `OverviewPage.test.tsx`: 6 files / 167 tests pass.
- R0's final API matched this plan's imports and calls verbatim, so no code deviated from it. The
  pointer test already advances `MOTION_MS.fast` before asserting the commit.
- Red before green, as planned:
  - Task 2: all 7 list tests failed, plus "persists…" and "falls back…" (no "Reorder Net worth"
    button).
  - Task 3: exactly one failure (the inert boxes, `expected false to be true`).
  - Task 4: the three CSS pins failed for the three predicted reasons.
- Component tests (`OverviewCustomize.test.tsx`): **16 / 16** — the plan's 15, plus one pin (see
  Corrections 1).
- Page tests (`OverviewPage.test.tsx`): 81 / 81 — the 80 existing tests (two of them rewritten per
  Task 2) plus the new "Escape while a tile is lifted…" test.
- Guide line (Task 5): applied (approved). `src/guide` + `GuidePage.test.tsx` +
  `paletteRegistry.guide.test.ts`: 8 files / 55 tests pass. The longest step is 148 characters.
- Lane set (Task 6 step 1): 13 files / 221 tests pass.
- Full vitest: **245 files / 3380 tests, exit 0.**
  - Neither known load flake fired.
  - The only stderr was jsdom "Not implemented" noise from two unrelated existing suites
    (`exportImage.test.ts` canvas, `LotAnatomyCard.test.tsx` navigation).
- tsc / eslint . / build:
  - `tsc -b` exit 0. Because `tsc -b`'s buildinfo lives in the shared `node_modules` junction, both
    projects were also checked with no cache: `tsc -p tsconfig.app.json --noEmit --incremental false`
    and the same for `tsconfig.node.json`, both exit 0.
  - `eslint .` exit 0: 0 errors, and the 26 pre-existing `react-refresh/only-export-components`
    warnings, none in a file this lane touched.
  - `npm run build` exit 0.
- Scope check: `git diff --stat feat/reorder-base...HEAD` lists exactly `OverviewCustomize.tsx`,
  `OverviewCustomize.test.tsx`, `OverviewPage.css`, `OverviewPage.test.tsx` and
  `src/guide/content/pages-tracking.tsx`. The CSS diff is the Customize row block alone (the old
  four lines became the commented row, grip, hidden-row, label and divider rules).
- Browser check: **`R4 CUSTOMIZE CHECK OK — 112 checks, 20 screenshots`**.
  - Run on the lane's own 8094/5194 against `finance_reorder_r4` (29 accounts, at head
    `f12026091203`).
  - Measured in all four passes (dark/light × 1280/1600):
    - every Customize row is 28 px, with or without a grip;
    - every box stands at one x (805 px at 1280, 1125 px at 1600);
    - the lifted row travelled exactly the pointer's 98.4 px (clamped at the list's end);
    - three peers shifted, and `html.reorder-active` was on mid-drag.
  - No write was blocked. The 12 `PATCH /prefs` (3 per pass: the drop, the hide, the re-show) all
    carried `overview_layout` alone.
  - The console was clean in all 8 browser contexts.
  - The driver put the private copy's layout back to the defaults (verified with a read-only query).
  - Both servers were stopped. Vite's node child outlived its shell and was stopped with
    `taskkill //F //T` (the plan's fallback).
- Screenshot notes (both themes, both widths):
  - the grips stand in one column beside the boxes;
  - `dragging`: the lifted row wears the raised surface with its accent grip, and its shadow is not
    clipped by the popover. Its own list's boxes are greyed (inert) while Deeper views stays live;
  - `hidden`: "Hidden" is a small muted word with a hairline, quieter than the bold legends, and
    level with them on the left. The hidden row's box sits under the boxes above;
  - `dropped` and `fresh-browser`: the tiles are in the new order (Portfolio · Living spending ·
    Estimated tax · Net worth), in a fresh browser too.
  - Not this lane's: the Net worth tile keeps its hero styling wherever it is placed. Tiles are keyed
    by identity, so this is pre-existing behaviour.
- Corrections to this plan:
  1. **One added pin, welcomed by the controller:** "keeps the console quiet through a tick and a
     drag". It spies on `console.error` through open → tick → Space/Home/Space and asserts no call at
     all. That covers R0's development contract check (each list is one range with no carries) and
     any React warning, such as `flushSync` inside `toggle`. With it, Task 3 ends at 13 tests (plan:
     12) and Task 4 at 16 (plan: 15).
  2. **The browser driver's server check was key-order sensitive.**
     - The first run failed only "the server holds the new layout", in all four passes.
     - The observed value was exactly `EXPECTED`, but JSONB hands its keys back as
       `{cards, tiles}`, and `same()` compares JSON strings.
     - The driver (gitignored scratch) now compares a stored layout list by list (`sameLayout`).
       The re-run passed all 112 checks. The reload and fresh-browser checks had passed in both runs.
  3. **Decision 5's wording.** With R0's final code, a change to the items under a *live* lift is not
     silent: the hook cancels at once and the live region says "Cancelled — the list changed."
     (spec §2.3.7, amended at R0's review).
     - Reset cannot reach a live lift in practice: a click on it first blurs the lifted grip, and
       blur cancels.
     - The path that can is a server pref adoption landing mid-lift (`subscribe('overview_layout', …)`
       in `OverviewPage.tsx`).
- Notes for the controller / lane V:
  - `src/pages/OverviewPage.tsx` is untouched.
  - The DOM this lane publishes is as listed under "DOM this lane publishes".
  - The browser driver stays in `scratchpad/reorder-r4/` (gitignored), with `report.json` and the 20
    PNGs next to it.

## Notes for the controller (outside this lane — found while planning it)

- **R2 and the Guide's label fence.**
  - `src/guide/content/pages-planning.tsx:277` and `:314` tell the reader to set the
    **Sort order**.
  - Once R2 removes those boxes, `guideContent.test.ts` "every **Label** … exists somewhere in the
    UI" fails, unless the words survive elsewhere in the UI source.
  - R2 needs a Guide edit the spec does not assign.
- **R5 and the Guide.** `src/guide/content/pages-tracking.tsx:729` describes the old Categories &
  weights keyboard model ("press the up and down arrows, to reorder"). That model becomes
  lift-and-drop in R5.
- **R0's test files never call RTL's `cleanup()`.**
  - The files are `useReorder.test.tsx` and `reorderStatus.test.tsx` in the R0 plan.
  - Vitest globals are off in `vite.config.ts`, so RTL cannot register its own `afterEach`.
  - The second render in each file therefore duplicates the grips, and `getByRole('button', { name:
    'Reorder …' })` throws "Found multiple elements".
  - The house idiom is `afterEach(cleanup)`; this plan's test file does it.

## Self-review (spec coverage)

| Requirement | Where the spec says it | Task |
|---|---|---|
| Each fieldset lists the showing items first, in stored order; each row is grip + checked box + label | §6 | 2 |
| The hidden items follow under a quiet "Hidden" divider, in default order, with unchecked boxes and no grip | §6, §8.1 | 2 (markup), 4 (quiet style) |
| Checking a hidden item appends it; unchecking a showing item moves it to hidden | §6 | 2 |
| The ↑/↓ buttons and the position number are removed | §6 | 2 (component), 4 (their CSS) |
| The last-visible-tile rule is kept (its box is disabled; its grip too, as a list of one) | §6, §9 | 2 (component test + page test) |
| Two `useReorder` instances, one per fieldset; `onCommit` → `onChange({ ...value, [group]: next })` | §6 | 2 (typed per-group setter — Decision 3) |
| Changes apply at once; no toast | §6 | 2 |
| Escape during a drag cancels only the drag, and the popover stays open | §6, §2.3, §9 | 3 (component + page tests), 7 (real browser) |
| Escape with nothing lifted still closes it and returns focus to the trigger | §6 | 3 (second Escape), existing page popover test, 7 |
| A pointer drag ending outside the popover does not close it (`usePopoverDismiss` listens to `pointerdown` only) | §2.3 | 3 (pointer test), 7 (real mouse) |
| Acceptance: the page tests are updated for stored order, Space/↓/Space → pref, hide/show and the tile minimum | §6 | 2 |
| Acceptance: a new test for Escape while lifted | §6 | 3 (component + page) |
| Announcements and instructions (§8.2 copy), one pair per list | §8.2, §2.4 | 2 (Decision 1), 3 (live text) |
| R0 consumer rules 1–6 (rows, no transforms, synchronous commit, no busy state, inert boxes while lifted, helpers placed) | R0 plan | 2, 3 |
| Stable row height and uniform gaps for `shiftsFor` | §2.3 (measure once, keep gaps) | 4 (CSS + pins), 7 (measured) |
| Lists with nothing to move have a disabled grip | §9 | 2 |
| Cancelled drags make no change (Escape, data landing mid-drag) | §9 | 3 (Escape; data landing is R0's, tested there) |
| Per-lane gates: vitest, tsc, eslint, build | §10 | 6 |
| Browser check on the lane's own servers (8094/5194), both themes, 1280 and 1600 | §10 | 7 |
| Ownership fence, `feat/reorder-overview` from base after R0, no push | §11 | Mechanics, 6 (scope check) |
| Pref shape unchanged (client guard + server registry) | — | Mechanics (no backend change) |
