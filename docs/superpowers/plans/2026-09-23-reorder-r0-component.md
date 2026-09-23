# Lane R0 — the shared drag-to-reorder component (2026-09-23) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> implementer for this lane in its own worktree, TDD per task, then a spec-compliance review and a
> code-quality review, then merge into `feat/reorder-base` — never main, never pushed). Steps use
> `- [ ]` checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-23-drag-to-reorder-design.md` — this lane implements **§2
(the shared drag component)** and the §8.2 copy. Read §0, §2, §8.2 and §9 of the spec before Task 1;
the spec is authoritative where this plan is silent.

**Goal:** one in-house, dependency-free drag-to-reorder primitive — a pure math module, a small DOM
module, a React hook, a grip button, two screen-reader helpers and one stylesheet. Every reorderable
list in lanes R2–R5 builds on it.

**Architecture:**
- **Pure half:** `reorderMath.ts` owns every rule about where a row lands: units, peers, slot,
  displacement, clamp, keyboard steps, auto-scroll speed and the announcement copy.
- **DOM half:** `reorderDom.ts` converts between client and list coordinates, finds the scroll
  container and scrolls it.
- **The hook:** `useReorder.ts` is a pointer + keyboard state machine.
  - Per-frame work (transforms, `data-reorder*` attributes) is written straight onto the rows the list
    registered through `itemProps`. React never renders a transform.
  - The only React state is who is lifted and what the live region says.
  - A drop calls the list's `onCommit(next, moved)` exactly once, inside `flushSync`, so the new DOM
    order and the cleared transforms land in the same frame.

**Tech stack:** React 19 + TypeScript 5.9 strict, Vite, vitest 3 + @testing-library/react (jsdom; **no**
jest-dom matchers — assert with plain `getAttribute`/`textContent`), lucide-react for the grip icon.

---

## Mechanics (read once)

- **Worktree:** `C:/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r0`, branch
  `feat/reorder-component`, cut from `feat/reorder-base` (NOT main). Work ONLY inside it.
  - The controller creates it and symlinks `node_modules`
    (`ln -s /c/Users/edyli/personal-finance-dashboard/node_modules node_modules`).
  - First command: `git -C . log --oneline -1`. It must show the spec commit on `feat/reorder-base`.
- **Another Claude job** is working in `.worktrees/{perf-first-four,backend-quick-fixes,
  frontend-quick-fixes,charts-spending-overview,charts-tax-portfolio}` and merging into main. Never
  touch main, the main checkout or those worktrees.
- **Tests:**
  - Per task: `npx vitest run src/components/reorder` from the worktree root.
  - At the end, the full suite once: `npx vitest run`. Never pipe a gate through `tail`/`head`; read
    the exit code.
- **Types and lint:**
  - `npx tsc -b` and `npx eslint src/components/reorder src/testing/pointer.ts` before every commit.
  - `eslint-plugin-react-hooks` v7 runs the React-Compiler rules (`react-hooks/refs`,
    `react-hooks/immutability`, `react-hooks/set-state-in-effect`, `react-hooks/globals`, …).
  - The code below is written to pass them:
    - no `ref.current` read during render;
    - no `setState` in an effect body;
    - no reassignment of outer variables during render.
  - If a rule still fires, fix the code — never add an `eslint-disable`.
- **Commits:** small and conventional (`feat(reorder): …`, `test(reorder): …`). Never push; never
  delete files or branches.
- **Scope fence:** this lane creates `src/components/reorder/**` and `src/testing/pointer.ts` and edits
  NOTHING else. No consumer is wired here (lanes R2–R5 do that).

## Contracts this lane publishes (lanes R2–R5 build against them verbatim)

```ts
// src/components/reorder/reorderMath.ts
export type ReorderKey = string | number
export interface ReorderItem<K extends ReorderKey> { id: K; range?: string; carries?: readonly K[] }
export const REORDER_INSTRUCTIONS: string   // spec §8.2 instructions sentence

// src/components/reorder/useReorder.ts
export function useReorder<K extends ReorderKey>(options: {
  items: readonly ReorderItem<K>[]          // DISPLAY order; carried rows right after their carrier
  labelOf: (id: K) => string                // "Housing" — the row's name, for the live region
  rangeLabelOf?: (range: string) => string | undefined   // "Cash" → "…Position 1 of 3 in Cash."
  disabled?: boolean                        // true while ANY request of the list is in flight
  onCommit: (next: K[], moved: K) => void   // once per drop; `next` = the new flat display order
}): {
  itemProps: (id: K) => { ref: RefCallback<HTMLElement>; 'data-reorder-id': string }
  handleProps: (id: K) => ReorderHandleProps   // spread onto <DragHandle>
  markSaved: (id: K) => void                   // after the save succeeds: 700 ms saved flash
  instructionsId: string                       // pass to <ReorderInstructions id=…>
  announcement: string                         // pass to <ReorderLiveRegion text=…>
  liftedId: K | null
  active: boolean                              // a unit is lifted — disable the row's buttons
}

// src/components/reorder/DragHandle.tsx (default export)
<DragHandle name="Housing" {...reorder.handleProps(id)} />   // <button class="reorder-grip"
                                                            //  aria-label="Reorder Housing">
// src/components/reorder/ReorderStatus.tsx
<ReorderInstructions id={reorder.instructionsId} />   // visually hidden, spec §8.2 sentence
<ReorderLiveRegion text={reorder.announcement} />     // visually hidden, aria-live="assertive"

// src/components/reorder/reorder.css  (imported by DragHandle.tsx — consumers need no import)
.reorder-table       // put on the <table>: border-collapse: separate; border-spacing: 0
.reorder-grip-cell   // put on the grip's <td> and its header <th aria-hidden="true">
```

**Consumer rules** (R2–R5 plans repeat them):
1. Render **every** item exactly once, with `{...reorder.itemProps(id)}` on its row element, in
   `items` order.
2. Never set `style.transform`/`style.transition` on those rows, and never use `.is-dragging`.
3. `onCommit` must set the list's optimistic order **synchronously** (a `setState`). It runs inside
   `flushSync`. Then start the save; on success call `reorder.markSaved(moved)`; on failure restore the
   last server order.
4. Pass `disabled: busy` for the list's in-flight state. While `disabled` the grips are
   `aria-disabled="true"` (still focusable, so a keyboard user keeps focus through a save) and inert.
5. Disable the row's own action buttons while `reorder.active`.
6. The two helpers render outside the `<table>` (a `<span>` is not valid inside it).

---

## File map

| File | Responsibility |
|---|---|
| `src/testing/pointer.ts` (create) | guarded jsdom polyfill: `window.PointerEvent`, `Element.prototype.{set,release,has}PointerCapture` — imported only by tests that need it |
| `src/components/reorder/reorderMath.ts` (create) | pure rules + copy |
| `src/components/reorder/reorderMath.test.ts` (create) | its unit tests |
| `src/components/reorder/reorderDom.ts` (create) | scroll container, coordinates, extents, visible band, scrolling, frame scheduling |
| `src/components/reorder/reorderDom.test.ts` (create) | its unit tests |
| `src/components/reorder/ReorderStatus.tsx` (create) | `ReorderInstructions`, `ReorderLiveRegion` |
| `src/components/reorder/reorderTypes.ts` (create) | `ReorderHandleProps` / `ReorderItemProps` — shared by the grip and the hook |
| `src/components/reorder/DragHandle.tsx` (create) | the grip button |
| `src/components/reorder/reorderStatus.test.tsx` (create) | helpers + grip rendering |
| `src/components/reorder/useReorder.ts` (create) | the hook |
| `src/components/reorder/useReorder.test.tsx` (create) | keyboard, pointer, reduced motion, carried rows, saved flash, cleanup |
| `src/components/reorder/reorder.css` (create) | grip, states, table border model, cursor |
| `src/components/reorder/reorderCss.test.ts` (create) | CSS pins |

---

### Task 1: the jsdom pointer polyfill

**Files:**
- Create: `src/testing/pointer.ts`

jsdom 26 has no `PointerEvent` and no pointer capture. `@testing-library`'s `fireEvent.pointerDown`
builds its event with `window.PointerEvent` when it exists, so a polyfill installed before a test fires
real `clientY`/`button`/`pointerId` fields that React's synthetic pointer events read.

- [ ] **Step 1: Write the file**

```ts
// jsdom has no PointerEvent and no pointer capture (the drag-to-reorder hook needs both; 2026-09-23
// spec §2.6). Imported by the tests that drive pointer drags — deliberately NOT in the global setup,
// so no other suite runs against a polyfilled window. Guarded: a jsdom that grows the real thing wins.
export function installPointerEvents(): void {
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      readonly pointerId: number
      readonly pointerType: string
      readonly isPrimary: boolean
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init)
        this.pointerId = init.pointerId ?? 1
        this.pointerType = init.pointerType ?? 'mouse'
        this.isPrimary = init.isPrimary ?? true
      }
    }
    Object.defineProperty(window, 'PointerEvent', {
      value: PointerEventPolyfill,
      configurable: true,
      writable: true,
    })
  }
  const proto = Element.prototype
  if (typeof proto.setPointerCapture !== 'function') proto.setPointerCapture = () => {}
  if (typeof proto.releasePointerCapture !== 'function') proto.releasePointerCapture = () => {}
  if (typeof proto.hasPointerCapture !== 'function') proto.hasPointerCapture = () => false
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/testing/pointer.ts
git commit -m "test(reorder): a guarded jsdom pointer-event polyfill for the drag tests"
```

---

### Task 2: the pure rules — `reorderMath.ts`

**Files:**
- Create: `src/components/reorder/reorderMath.ts`
- Test: `src/components/reorder/reorderMath.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  AUTO_SCROLL_MAX,
  REORDER_INSTRUCTIONS,
  announce,
  autoScrollSpeed,
  clampOffset,
  keyboardTarget,
  moveUnit,
  peersOf,
  rangeSizes,
  reorderIndices,
  shiftsFor,
  signatureOf,
  slotFor,
  unitOf,
} from './reorderMath'
import type { Extent, ReorderItem } from './reorderMath'

const flat: ReorderItem<string>[] = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }]

// Accounts-shaped (spec §2.2): groups are ranges; parent 10 carries its components 11 and 12, which
// are peers only of each other.
const grouped: ReorderItem<number>[] = [
  { id: 1, range: 'cash' },
  { id: 2, range: 'cash' },
  { id: 10, range: 'pre_tax', carries: [11, 12] },
  { id: 11, range: 'parent:10' },
  { id: 12, range: 'parent:10' },
  { id: 20, range: 'pre_tax' },
  { id: 30, range: 'liability' },
]

function stacked(heights: number[], start = 0): Extent[] {
  let top = start
  return heights.map((height) => {
    const extent = { top, height }
    top += height
    return extent
  })
}

describe('unitOf / peersOf / rangeSizes', () => {
  it('a plain item is its own unit and every item is a peer', () => {
    expect(unitOf(flat, 'B')).toEqual(['B'])
    expect(peersOf(flat, 'B')).toEqual(['A', 'B', 'C', 'D'])
  })

  it('a parent carries its components; components are peers only of their siblings', () => {
    expect(unitOf(grouped, 10)).toEqual([10, 11, 12])
    expect(peersOf(grouped, 10)).toEqual([10, 20])
    expect(peersOf(grouped, 12)).toEqual([11, 12])
    expect(peersOf(grouped, 1)).toEqual([1, 2])
  })

  it('counts the items of each range', () => {
    const sizes = rangeSizes(grouped)
    expect(sizes.get('liability')).toBe(1)
    expect(sizes.get('parent:10')).toBe(2)
    expect(rangeSizes(flat).get('')).toBe(4)
  })

  it('an unknown id has no unit and no peers', () => {
    expect(unitOf(flat, 'Z')).toEqual([])
    expect(peersOf(flat, 'Z')).toEqual([])
  })
})

describe('moveUnit', () => {
  it('moves down, up, to either end, and not at all', () => {
    expect(moveUnit(flat, 'A', 2)).toEqual(['B', 'C', 'A', 'D'])
    expect(moveUnit(flat, 'D', 1)).toEqual(['A', 'D', 'B', 'C'])
    expect(moveUnit(flat, 'B', 0)).toEqual(['B', 'A', 'C', 'D'])
    expect(moveUnit(flat, 'B', 3)).toEqual(['A', 'C', 'D', 'B'])
    expect(moveUnit(flat, 'C', 2)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('ignores a slot outside the range', () => {
    expect(moveUnit(flat, 'A', 9)).toEqual(['A', 'B', 'C', 'D'])
    expect(moveUnit(flat, 'A', -1)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('a parent moves with its components and stays inside its group', () => {
    expect(moveUnit(grouped, 10, 1)).toEqual([1, 2, 20, 10, 11, 12, 30])
    expect(moveUnit(grouped, 20, 0)).toEqual([1, 2, 20, 10, 11, 12, 30])
  })

  it('a component moves among its siblings only', () => {
    expect(moveUnit(grouped, 12, 0)).toEqual([1, 2, 10, 12, 11, 20, 30])
  })
})

describe('slotFor', () => {
  const four = stacked([40, 40, 40, 40])

  it('counts the other peers whose original midpoint is above the lifted centre', () => {
    expect(slotFor(four, 0, 20)).toBe(0)
    expect(slotFor(four, 0, 65)).toBe(1)
    expect(slotFor(four, 0, 105)).toBe(2)
    expect(slotFor(four, 0, 159)).toBe(3)
    expect(slotFor(four, 3, 95)).toBe(2)
    expect(slotFor(four, 3, 15)).toBe(0)
  })

  it('resolves a tie toward the edge the unit came from, so a unit clamped to an end lands there', () => {
    expect(slotFor(four, 0, 140)).toBe(3) // clamped to the bottom: lands last
    expect(slotFor(four, 3, 20)).toBe(0) // clamped to the top: lands first
    expect(slotFor(four, 1, 100)).toBe(2) // dragged down exactly onto C's midpoint: has passed C
    expect(slotFor(four, 2, 60)).toBe(1) // dragged up exactly onto B's midpoint: has not passed B
  })

  it("uses each unit's own midpoint when heights differ", () => {
    // A parent carrying two components (120px), then a plain account (40px) lifted from below.
    const tall = stacked([120, 40])
    expect(slotFor(tall, 1, 70)).toBe(1)
    expect(slotFor(tall, 1, 50)).toBe(0)
  })
})

describe('reorderIndices / shiftsFor', () => {
  it('reorders peer indices', () => {
    expect(reorderIndices(4, 0, 2)).toEqual([1, 2, 0, 3])
    expect(reorderIndices(4, 3, 1)).toEqual([0, 3, 1, 2])
  })

  it('displaced peers move by the lifted height; the lifted entry is its landing offset', () => {
    expect(shiftsFor(stacked([40, 40, 40, 40]), 0, 2)).toEqual([80, -40, -40, 0])
    expect(shiftsFor(stacked([40, 40, 40, 40]), 3, 1)).toEqual([0, 40, 40, -80])
    expect(shiftsFor(stacked([40, 40, 40, 40]), 1, 1)).toEqual([0, 0, 0, 0])
  })

  it('handles units of different heights (a parent carrying components)', () => {
    expect(shiftsFor(stacked([120, 40]), 1, 0)).toEqual([40, -120])
  })

  it('keeps the gaps of a spaced list', () => {
    const spaced: Extent[] = [
      { top: 0, height: 30 },
      { top: 36, height: 30 },
      { top: 72, height: 30 },
    ]
    expect(shiftsFor(spaced, 0, 2)).toEqual([72, -36, -36])
  })
})

describe('clampOffset', () => {
  const four = stacked([40, 40, 40, 40], 100)

  it('keeps the unit between the first top and the last bottom', () => {
    expect(clampOffset(four, 1, -500)).toBe(-40)
    expect(clampOffset(four, 1, 500)).toBe(80)
    expect(clampOffset(four, 1, 25)).toBe(25)
  })
})

describe('keyboardTarget', () => {
  it('maps the four keys and clamps at the ends', () => {
    expect(keyboardTarget('ArrowUp', 0, 4)).toBe(0)
    expect(keyboardTarget('ArrowUp', 2, 4)).toBe(1)
    expect(keyboardTarget('ArrowDown', 3, 4)).toBe(3)
    expect(keyboardTarget('ArrowDown', 1, 4)).toBe(2)
    expect(keyboardTarget('Home', 3, 4)).toBe(0)
    expect(keyboardTarget('End', 0, 4)).toBe(3)
    expect(keyboardTarget('a', 1, 4)).toBeNull()
  })
})

describe('autoScrollSpeed', () => {
  it('is zero away from the edges, full at or past them, quadratic between', () => {
    expect(autoScrollSpeed(300, 0, 600)).toBe(0)
    expect(autoScrollSpeed(40, 0, 600)).toBe(0)
    expect(autoScrollSpeed(0, 0, 600)).toBe(-AUTO_SCROLL_MAX)
    expect(autoScrollSpeed(-30, 0, 600)).toBe(-AUTO_SCROLL_MAX)
    expect(autoScrollSpeed(600, 0, 600)).toBe(AUTO_SCROLL_MAX)
    expect(autoScrollSpeed(20, 0, 600)).toBeCloseTo(-AUTO_SCROLL_MAX / 4)
    expect(autoScrollSpeed(580, 0, 600)).toBeCloseTo(AUTO_SCROLL_MAX / 4)
  })
})

describe('announce / signatureOf / instructions', () => {
  it('speaks the spec §8.2 sentences, positions counted within the range', () => {
    expect(announce.lift({ name: 'Housing', position: 11, count: 19 })).toBe(
      'Picked up Housing. Position 11 of 19.',
    )
    expect(announce.lift({ name: 'Petty Cash', position: 1, count: 2, range: 'Other' })).toBe(
      'Picked up Petty Cash. Position 1 of 2 in Other.',
    )
    expect(announce.move({ name: 'Housing', position: 3, count: 19 })).toBe(
      'Housing, position 3 of 19.',
    )
    expect(announce.drop({ name: 'Housing', position: 3, count: 19 })).toBe(
      'Dropped Housing at position 3 of 19.',
    )
    expect(announce.dropUnmoved({ name: 'Housing', position: 3, count: 19 })).toBe(
      'Dropped Housing where it was.',
    )
    expect(announce.cancel({ name: 'Housing', position: 11, count: 19 })).toBe(
      'Cancelled. Housing is back at position 11 of 19.',
    )
    expect(REORDER_INSTRUCTIONS).toBe(
      'Press Space or Enter to pick up. Use the arrow keys to move, Home or End to jump, Space or Enter to drop, Escape to cancel.',
    )
  })

  it('changes when order, membership, range or carried rows change — and only then', () => {
    const base = signatureOf(grouped)
    expect(signatureOf([...grouped])).toBe(base)
    expect(signatureOf(grouped.slice(1))).not.toBe(base)
    expect(signatureOf([grouped[1], grouped[0], ...grouped.slice(2)])).not.toBe(base)
    expect(signatureOf(grouped.map((item) => (item.id === 1 ? { ...item, range: 'x' } : item)))).not.toBe(base)
    expect(signatureOf(grouped.map((item) => (item.id === 10 ? { ...item, carries: [11] } : item)))).not.toBe(base)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/components/reorder/reorderMath.test.ts`
Expected: FAIL — `Failed to resolve import "./reorderMath"`.

- [ ] **Step 3: Write `reorderMath.ts`**

```ts
// Drag to reorder — the pure half (2026-09-23 spec §2). No DOM and no React: every rule about where
// a row lands lives here, so it is unit-tested once and shared by every reorderable list.
//
// Vocabulary (spec §2.2): an ITEM is one rendered row. Its UNIT is the item plus the rows it
// CARRIES (a parent account's nested components). Its PEERS are the items with the same RANGE, in
// display order — a drag moves a unit among its peers and nowhere else.

export type ReorderKey = string | number

export interface ReorderItem<K extends ReorderKey> {
  id: K
  /** Items move only among items with the same range (default: one range for the whole list). */
  range?: string
  /** Rows that travel with this item — rendered immediately after it, in this order. */
  carries?: readonly K[]
}

/** Where a unit sits, in LIST coordinates: px from the top of the scroll container's content. */
export interface Extent {
  top: number
  height: number
}

export interface AnnounceContext {
  name: string
  /** 1-based, counted within the range. */
  position: number
  count: number
  range?: string
}

function rangeOf<K extends ReorderKey>(item: ReorderItem<K>): string {
  return item.range ?? ''
}

/** The rows a drag of `id` moves: the item, then the rows it carries. */
export function unitOf<K extends ReorderKey>(items: readonly ReorderItem<K>[], id: K): K[] {
  const item = items.find((candidate) => candidate.id === id)
  return item === undefined ? [] : [item.id, ...(item.carries ?? [])]
}

/** The items sharing `id`'s range, in display order — `id` included. */
export function peersOf<K extends ReorderKey>(items: readonly ReorderItem<K>[], id: K): K[] {
  const item = items.find((candidate) => candidate.id === id)
  if (item === undefined) return []
  const range = rangeOf(item)
  return items.filter((candidate) => rangeOf(candidate) === range).map((candidate) => candidate.id)
}

/** How many items share each range — a grip whose range holds one item has nowhere to go. */
export function rangeSizes<K extends ReorderKey>(
  items: readonly ReorderItem<K>[],
): Map<string, number> {
  const sizes = new Map<string, number>()
  for (const item of items) sizes.set(rangeOf(item), (sizes.get(rangeOf(item)) ?? 0) + 1)
  return sizes
}

/** A content signature: a drag started against one list must never drop onto another (spec §2.3 —
 *  data landing under a live drag cancels it). */
export function signatureOf<K extends ReorderKey>(items: readonly ReorderItem<K>[]): string {
  return items
    .map((item) => `${String(item.id)}:${rangeOf(item)}:${(item.carries ?? []).join(',')}`)
    .join('|')
}

/** The new flat display order after `id`'s unit becomes peer number `to` (0-based). A slot outside
 *  the range, or the slot it already holds, returns the order unchanged. */
export function moveUnit<K extends ReorderKey>(
  items: readonly ReorderItem<K>[],
  id: K,
  to: number,
): K[] {
  const flat = items.map((item) => item.id)
  const peers = peersOf(items, id)
  const from = peers.indexOf(id)
  if (from < 0 || to === from || to < 0 || to >= peers.length) return flat
  const unit = unitOf(items, id)
  const rest = flat.filter((key) => !unit.includes(key))
  const others = peers.filter((key) => key !== id)
  let insertAt: number
  if (to < others.length) {
    insertAt = rest.indexOf(others[to])
  } else {
    // After the LAST row of the last peer's unit, so a carrier keeps its carried rows.
    const lastUnit = unitOf(items, others[others.length - 1])
    insertAt = rest.indexOf(lastUnit[lastUnit.length - 1]) + 1
  }
  return [...rest.slice(0, insertAt), ...unit, ...rest.slice(insertAt)]
}

/** The lifted unit's landing slot: how many OTHER peers have their original midpoint above the
 *  lifted unit's current centre. Measured against where rows stood at lift, so heights may differ.
 *  Ties resolve toward the edge the unit came from: a peer below the start counts when the centre
 *  reaches its midpoint, a peer above only once the centre is past it — so a unit clamped to either
 *  end of the list (its centre exactly on the end peer's midpoint) lands at that end. */
export function slotFor(extents: readonly Extent[], from: number, liftedCentre: number): number {
  let slot = 0
  extents.forEach((extent, index) => {
    if (index === from) return
    const mid = extent.top + extent.height / 2
    if (index < from ? mid < liftedCentre : mid <= liftedCentre) slot += 1
  })
  return slot
}

/** Peer indices in their new order when the peer at `from` lands at `to`. */
export function reorderIndices(count: number, from: number, to: number): number[] {
  const order = Array.from({ length: count }, (_, index) => index)
  const [moved] = order.splice(from, 1)
  order.splice(to, 0, moved)
  return order
}

/** Each peer's translateY when `from` lands at `to`: the peers are re-laid in the new order from the
 *  first peer's top, keeping the original gap after each slot. The lifted peer's own entry is where
 *  it will land — the keyboard preview draws it there and the pointer drop eases it there. */
export function shiftsFor(extents: readonly Extent[], from: number, to: number): number[] {
  const order = reorderIndices(extents.length, from, to)
  const shifts = new Array<number>(extents.length).fill(0)
  let cursor = extents[0]?.top ?? 0
  order.forEach((peer, slot) => {
    shifts[peer] = cursor - extents[peer].top
    const gap =
      slot < extents.length - 1
        ? extents[slot + 1].top - (extents[slot].top + extents[slot].height)
        : 0
    cursor += extents[peer].height + gap
  })
  return shifts
}

/** The lifted unit's pointer offset, kept between the first peer's top and the last peer's bottom. */
export function clampOffset(extents: readonly Extent[], from: number, delta: number): number {
  const first = extents[0]
  const last = extents[extents.length - 1]
  const self = extents[from]
  const min = first.top - self.top
  const max = last.top + last.height - (self.top + self.height)
  return Math.min(max, Math.max(min, delta))
}

/** The slot a key moves a keyboard-lifted unit to, or null for a key the reorder does not own. */
export function keyboardTarget(key: string, current: number, count: number): number | null {
  switch (key) {
    case 'ArrowUp':
      return Math.max(0, current - 1)
    case 'ArrowDown':
      return Math.min(count - 1, current + 1)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/** The auto-scroll zone (px inside a visible edge) and its top speed (px per frame), spec §2.3. */
export const AUTO_SCROLL_EDGE = 40
export const AUTO_SCROLL_MAX = 18

/** Pixels per frame to scroll: quadratic in closeness to the edge, full speed at or past it, zero
 *  outside the zone. Negative scrolls up. */
export function autoScrollSpeed(pointerY: number, top: number, bottom: number): number {
  if (pointerY < top + AUTO_SCROLL_EDGE) {
    const closeness = 1 - Math.max(0, pointerY - top) / AUTO_SCROLL_EDGE
    return -AUTO_SCROLL_MAX * closeness ** 2
  }
  if (pointerY > bottom - AUTO_SCROLL_EDGE) {
    const closeness = 1 - Math.max(0, bottom - pointerY) / AUTO_SCROLL_EDGE
    return AUTO_SCROLL_MAX * closeness ** 2
  }
  return 0
}

/** The live region's sentences (spec §8.2). */
export const announce = {
  lift: ({ name, position, count, range }: AnnounceContext) =>
    `Picked up ${name}. Position ${position} of ${count}${range ? ` in ${range}` : ''}.`,
  move: ({ name, position, count }: AnnounceContext) =>
    `${name}, position ${position} of ${count}.`,
  drop: ({ name, position, count }: AnnounceContext) =>
    `Dropped ${name} at position ${position} of ${count}.`,
  dropUnmoved: ({ name }: AnnounceContext) => `Dropped ${name} where it was.`,
  cancel: ({ name, position, count }: AnnounceContext) =>
    `Cancelled. ${name} is back at position ${position} of ${count}.`,
}

/** The grips' `aria-describedby` target (spec §8.2). */
export const REORDER_INSTRUCTIONS =
  'Press Space or Enter to pick up. Use the arrow keys to move, Home or End to jump, Space or Enter to drop, Escape to cancel.'
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/components/reorder/reorderMath.test.ts`
Expected: PASS (all tests in 10 `describe` blocks).

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/reorder
git add src/components/reorder/reorderMath.ts src/components/reorder/reorderMath.test.ts
git commit -m "feat(reorder): the pure rules — units, peers, slots, shifts, clamp, keys, auto-scroll speed, copy"
```

---

### Task 3: the DOM half — `reorderDom.ts`

**Files:**
- Create: `src/components/reorder/reorderDom.ts`
- Test: `src/components/reorder/reorderDom.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureVisible, listY, scrollParentOf, unitExtent, visibleBounds } from './reorderDom'

function rect(top: number, height: number): DOMRect {
  return {
    top,
    height,
    bottom: top + height,
    left: 0,
    right: 100,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

function setBox(element: HTMLElement, box: { scrollHeight?: number; clientHeight?: number; scrollTop?: number }) {
  for (const [key, value] of Object.entries(box)) {
    Object.defineProperty(element, key, { value, writable: true, configurable: true })
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('scrollParentOf', () => {
  it('finds the nearest ancestor that scrolls vertically, or null for the page', () => {
    document.body.innerHTML =
      '<div id="scroller" style="overflow-y: auto"><table><tbody><tr id="row"><td>x</td></tr></tbody></table></div>'
    const scroller = document.getElementById('scroller') as HTMLElement
    setBox(scroller, { scrollHeight: 900, clientHeight: 420 })
    expect(scrollParentOf(document.getElementById('row'))).toBe(scroller)
    // Same overflow rule, nothing to scroll: the page owns the scroll.
    setBox(scroller, { scrollHeight: 300, clientHeight: 420 })
    expect(scrollParentOf(document.getElementById('row'))).toBeNull()
  })

  it('an element with no scrolling ancestor answers the page', () => {
    document.body.innerHTML = '<ul><li id="item">x</li></ul>'
    expect(scrollParentOf(document.getElementById('item'))).toBeNull()
    expect(scrollParentOf(null)).toBeNull()
  })
})

describe('listY / unitExtent / visibleBounds', () => {
  it('page coordinates add the window scroll', () => {
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(250)
    expect(listY(null, 100)).toBe(350)
  })

  it('element coordinates are relative to the scroller content', () => {
    const scroller = document.createElement('div')
    scroller.getBoundingClientRect = () => rect(300, 420)
    setBox(scroller, { scrollTop: 80 })
    expect(listY(scroller, 310)).toBe(90)
  })

  it('a unit spans from its first row top to its last row bottom', () => {
    const a = document.createElement('tr')
    a.getBoundingClientRect = () => rect(200, 40)
    const b = document.createElement('tr')
    b.getBoundingClientRect = () => rect(240, 30)
    expect(unitExtent([a, b], null)).toEqual({ top: 200, height: 70 })
    expect(unitExtent([], null)).toEqual({ top: 0, height: 0 })
  })

  it("the page's visible band is the viewport; an element's is its box", () => {
    expect(visibleBounds(null)).toEqual({ top: 0, bottom: window.innerHeight })
    const scroller = document.createElement('div')
    scroller.getBoundingClientRect = () => rect(120, 420)
    expect(visibleBounds(scroller)).toEqual({ top: 120, bottom: 540 })
  })
})

describe('ensureVisible', () => {
  it('scrolls an element scroller the least amount that shows the unit clear of the edge zone', () => {
    const scroller = document.createElement('div')
    setBox(scroller, { clientHeight: 400, scrollTop: 0 })
    ensureVisible(scroller, 500, 40) // bottom 540 past 0 + 400 - 40 → down by 180
    expect(scroller.scrollTop).toBe(180)
    ensureVisible(scroller, 100, 40) // top 100 above 180 + 40 → up by 120
    expect(scroller.scrollTop).toBe(60)
    ensureVisible(scroller, 200, 40) // already clear of both edge zones
    expect(scroller.scrollTop).toBe(60)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/components/reorder/reorderDom.test.ts`
Expected: FAIL — `Failed to resolve import "./reorderDom"`.

- [ ] **Step 3: Write `reorderDom.ts`**

```ts
// Drag to reorder — the DOM half (2026-09-23 spec §2.3). The hook measures rows once at lift and
// then reasons in LIST coordinates (px from the top of the scroll container's content), so an
// auto-scroll in the middle of a drag never invalidates a measurement: only the pointer is
// re-converted, on every move and every scroll.
import { AUTO_SCROLL_EDGE } from './reorderMath'
import type { Extent } from './reorderMath'

/** The element that scrolls the list, or null for the page. */
export type Scroller = HTMLElement | null

/** The nearest ancestor that actually scrolls vertically (the Settings tables' 420px
 *  `.settings-scroll`), or null when the page does. */
export function scrollParentOf(element: Element | null | undefined): Scroller {
  let node = element?.parentElement ?? null
  while (node !== null && node !== document.body && node !== document.documentElement) {
    const overflowY = getComputedStyle(node).overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node
    }
    node = node.parentElement
  }
  return null
}

/** A client y in list coordinates. */
export function listY(scroller: Scroller, clientY: number): number {
  if (scroller === null) return clientY + window.scrollY
  return clientY - scroller.getBoundingClientRect().top + scroller.scrollTop
}

/** The extent of a unit's rows, first top to last bottom, in list coordinates. */
export function unitExtent(elements: readonly HTMLElement[], scroller: Scroller): Extent {
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const element of elements) {
    const box = element.getBoundingClientRect()
    top = Math.min(top, listY(scroller, box.top))
    bottom = Math.max(bottom, listY(scroller, box.bottom))
  }
  return top === Number.POSITIVE_INFINITY ? { top: 0, height: 0 } : { top, height: bottom - top }
}

/** The client-y band the reader can currently see of the scroller (the viewport for the page). */
export function visibleBounds(scroller: Scroller): { top: number; bottom: number } {
  if (scroller === null) return { top: 0, bottom: window.innerHeight }
  const box = scroller.getBoundingClientRect()
  return { top: box.top, bottom: box.bottom }
}

export function scrollByY(scroller: Scroller, dy: number): void {
  if (scroller === null) window.scrollBy(0, dy)
  else scroller.scrollTop += dy
}

/** Scroll the least amount that shows [top, top + height) (list coordinates) clear of the
 *  auto-scroll zone at either edge — the keyboard path's "keep the lifted row in view". */
export function ensureVisible(
  scroller: Scroller,
  top: number,
  height: number,
  margin = AUTO_SCROLL_EDGE,
): void {
  const viewTop = scroller === null ? window.scrollY : scroller.scrollTop
  const viewHeight = scroller === null ? window.innerHeight : scroller.clientHeight
  if (top < viewTop + margin) scrollByY(scroller, top - (viewTop + margin))
  else if (top + height > viewTop + viewHeight - margin) {
    scrollByY(scroller, top + height - (viewTop + viewHeight - margin))
  }
}

/** requestAnimationFrame when the environment has it (jsdom may not), a 16ms timer otherwise. */
export function nextFrame(callback: () => void): number {
  return typeof window.requestAnimationFrame === 'function'
    ? window.requestAnimationFrame(() => callback())
    : window.setTimeout(callback, 16)
}

export function cancelFrame(id: number): void {
  if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(id)
  else window.clearTimeout(id)
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/components/reorder/reorderDom.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/reorder
git add src/components/reorder/reorderDom.ts src/components/reorder/reorderDom.test.ts
git commit -m "feat(reorder): the DOM half — scroll container, list coordinates, extents, keep-in-view"
```

---

### Task 4: the grip and the two screen-reader helpers

**Files:**
- Create: `src/components/reorder/ReorderStatus.tsx`
- Create: `src/components/reorder/DragHandle.tsx`
- Create: `src/components/reorder/reorder.css` (a first version: the grip rules only; Task 7 completes it)
- Test: `src/components/reorder/reorderStatus.test.tsx`

`DragHandle` types its props against `ReorderHandleProps`. Task 5 defines that type in `useReorder.ts`;
to keep this task self-contained it declares the type in a tiny `reorderTypes.ts` that Task 5 imports
and re-exports.

- [ ] **Step 1: Create `src/components/reorder/reorderTypes.ts`**

```ts
import type { KeyboardEvent, PointerEvent, RefCallback } from 'react'

/** What `useReorder().handleProps(id)` returns — spread onto a DragHandle (2026-09-23 spec §2.4). */
export interface ReorderHandleProps {
  ref: RefCallback<HTMLButtonElement>
  /** True only when the item's range holds nothing else to move among. */
  disabled: boolean
  /** The list is busy (a save in flight): inert but still focusable, so focus survives a save. */
  'aria-disabled': true | undefined
  'aria-describedby': string
  'aria-pressed': true | undefined
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void
  onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
  onBlur: () => void
}

/** What `useReorder().itemProps(id)` returns — spread onto every rendered row. */
export interface ReorderItemProps {
  ref: RefCallback<HTMLElement>
  'data-reorder-id': string
}
```

- [ ] **Step 2: Write the failing test `reorderStatus.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DragHandle from './DragHandle'
import { ReorderInstructions, ReorderLiveRegion } from './ReorderStatus'
import type { ReorderHandleProps } from './reorderTypes'

function handle(overrides: Partial<ReorderHandleProps> = {}): ReorderHandleProps {
  return {
    ref: () => {},
    disabled: false,
    'aria-disabled': undefined,
    'aria-describedby': 'how',
    'aria-pressed': undefined,
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onPointerCancel: vi.fn(),
    onLostPointerCapture: vi.fn(),
    onKeyDown: vi.fn(),
    onBlur: vi.fn(),
    ...overrides,
  }
}

describe('ReorderInstructions / ReorderLiveRegion', () => {
  it('are visually hidden and speak the spec §8.2 copy', () => {
    render(
      <>
        <ReorderInstructions id="how" />
        <ReorderLiveRegion text="Dropped Housing at position 3 of 19." />
      </>,
    )
    const instructions = document.getElementById('how')
    expect(instructions?.textContent).toBe(
      'Press Space or Enter to pick up. Use the arrow keys to move, Home or End to jump, Space or Enter to drop, Escape to cancel.',
    )
    expect(instructions?.className).toBe('visually-hidden')
    const region = document.querySelector('[aria-live="assertive"]')
    expect(region?.getAttribute('aria-atomic')).toBe('true')
    expect(region?.className).toBe('visually-hidden')
    expect(region?.textContent).toBe('Dropped Housing at position 3 of 19.')
  })
})

describe('DragHandle', () => {
  it('is a real button named for its row and described by the instructions', () => {
    render(<DragHandle name="Housing" {...handle()} />)
    const grip = screen.getByRole('button', { name: 'Reorder Housing' })
    expect(grip.getAttribute('type')).toBe('button')
    expect(grip.className).toBe('reorder-grip')
    expect(grip.getAttribute('aria-describedby')).toBe('how')
    expect(grip.getAttribute('aria-pressed')).toBeNull()
    expect(grip.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('says when it is lifted, busy, or has nowhere to go', () => {
    const { rerender } = render(<DragHandle name="Housing" {...handle({ 'aria-pressed': true })} />)
    expect(screen.getByRole('button', { name: 'Reorder Housing' }).getAttribute('aria-pressed')).toBe('true')
    rerender(<DragHandle name="Housing" {...handle({ 'aria-disabled': true })} />)
    expect(screen.getByRole('button', { name: 'Reorder Housing' }).getAttribute('aria-disabled')).toBe('true')
    rerender(<DragHandle name="Housing" {...handle({ disabled: true })} />)
    expect((screen.getByRole('button', { name: 'Reorder Housing' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
```

- [ ] **Step 3: Run the test to see it fail**

Run: `npx vitest run src/components/reorder/reorderStatus.test.tsx`
Expected: FAIL — `Failed to resolve import "./DragHandle"`.

- [ ] **Step 4: Write `ReorderStatus.tsx`, `DragHandle.tsx` and the first `reorder.css`**

`src/components/reorder/ReorderStatus.tsx`:

```tsx
import '../panels.css'
import { REORDER_INSTRUCTIONS } from './reorderMath'

/** The grips' description (spec §8.2): how to reorder from the keyboard. Visually hidden; each list
 *  renders one and points every grip's aria-describedby at it. Outside the <table> — a <span> is not
 *  a valid child of one. */
export function ReorderInstructions({ id }: { id: string }) {
  return (
    <span id={id} className="visually-hidden">
      {REORDER_INSTRUCTIONS}
    </span>
  )
}

/** The list's live region: lift, move, drop and cancel are spoken as they happen (spec §2.4).
 *  Assertive, because each sentence answers a key the reader just pressed. */
export function ReorderLiveRegion({ text }: { text: string }) {
  return (
    <span className="visually-hidden" aria-live="assertive" aria-atomic="true">
      {text}
    </span>
  )
}
```

`src/components/reorder/DragHandle.tsx`:

```tsx
import { GripVertical } from 'lucide-react'
import './reorder.css'
import type { ReorderHandleProps } from './reorderTypes'

/** The grip every reorderable row wears (2026-09-23 spec §2.4): a real button named for its row and
 *  described by the list's instructions. All behaviour arrives in `handleProps` — this component
 *  only draws. */
export default function DragHandle({ name, ...handle }: { name: string } & ReorderHandleProps) {
  return (
    <button type="button" className="reorder-grip" aria-label={`Reorder ${name}`} {...handle}>
      <GripVertical size={14} aria-hidden="true" />
    </button>
  )
}
```

`src/components/reorder/reorder.css` (first version — Task 7 adds the row states):

```css
/* Drag to reorder (2026-09-23 spec §2). The grip — Task 7 of lane R0 adds the row states. */

.reorder-grip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--muted);
  cursor: grab;
  /* A touch drag on the grip is a reorder, never a page scroll. */
  touch-action: none;
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `npx vitest run src/components/reorder/reorderStatus.test.tsx`
Expected: PASS.

- [ ] **Step 6: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/reorder
git add src/components/reorder/reorderTypes.ts src/components/reorder/ReorderStatus.tsx src/components/reorder/DragHandle.tsx src/components/reorder/reorder.css src/components/reorder/reorderStatus.test.tsx
git commit -m "feat(reorder): the grip button, the hidden instructions and the live region"
```

---

### Task 5: the hook — keyboard path first

**Files:**
- Create: `src/components/reorder/useReorder.ts`
- Test: `src/components/reorder/useReorder.test.tsx`

The whole hook is written in this task (the pointer path shares every helper). This task's tests
cover the keyboard path, and Task 6 adds the pointer tests.

- [ ] **Step 1: Write the failing keyboard tests**

`src/components/reorder/useReorder.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installPointerEvents } from '../../testing/pointer'
import { MOTION_MS } from '../../theme/motion'
import DragHandle from './DragHandle'
import { ReorderInstructions, ReorderLiveRegion } from './ReorderStatus'
import type { ReorderItem } from './reorderMath'
import { useReorder } from './useReorder'

const LABELS: Record<string, string> = {
  A: 'Alpha',
  B: 'Bravo',
  C: 'Charlie',
  D: 'Delta',
  P: 'Parent',
  C1: 'Comp one',
  C2: 'Comp two',
  Q: 'Quebec',
}

function List({
  items,
  onCommit,
  disabled = false,
}: {
  items: ReorderItem<string>[]
  onCommit: (next: string[], moved: string) => void
  disabled?: boolean
}) {
  const reorder = useReorder({
    items,
    labelOf: (id) => LABELS[id] ?? id,
    rangeLabelOf: (range) => (range === 'g' ? 'Group' : undefined),
    disabled,
    onCommit,
  })
  return (
    <div>
      <ReorderInstructions id={reorder.instructionsId} />
      <ReorderLiveRegion text={reorder.announcement} />
      <p data-testid="active">{String(reorder.active)}</p>
      <button type="button" onClick={() => reorder.markSaved('B')}>
        mark Bravo saved
      </button>
      <ul>
        {items.map((item) => (
          <li key={item.id} {...reorder.itemProps(item.id)}>
            <DragHandle name={LABELS[item.id] ?? item.id} {...reorder.handleProps(item.id)} />
            {LABELS[item.id]}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A list that applies its commits, the way every consumer's optimistic order does. */
function Stateful({
  initial,
  onCommit = () => {},
  disabled,
}: {
  initial: ReorderItem<string>[]
  onCommit?: (next: string[], moved: string) => void
  disabled?: boolean
}) {
  const [items, setItems] = useState(initial)
  return (
    <List
      items={items}
      disabled={disabled}
      onCommit={(next, moved) => {
        const byId = new Map(items.map((item) => [item.id, item]))
        setItems(
          next.flatMap((id) => {
            const item = byId.get(id)
            return item === undefined ? [] : [item]
          }),
        )
        onCommit(next, moved)
      }}
    />
  )
}

const flat = (...ids: string[]): ReorderItem<string>[] => ids.map((id) => ({ id }))

/** jsdom has no layout: every row gets a box `height` tall, stacked from y=200 in CURRENT DOM order
 *  (well clear of the viewport's auto-scroll zones). Call again after a reorder. */
function layoutRows(height = 40, start = 200) {
  document.querySelectorAll<HTMLElement>('[data-reorder-id]').forEach((row, index) => {
    const top = start + index * height
    row.getBoundingClientRect = () =>
      ({
        top,
        bottom: top + height,
        height,
        left: 0,
        right: 300,
        width: 300,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect
  })
}

function row(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-reorder-id="${id}"]`)
  if (element === null) throw new Error(`no row ${id}`)
  return element
}

const grip = (name: string) => screen.getByRole('button', { name: `Reorder ${name}` })
const order = () =>
  [...document.querySelectorAll('[data-reorder-id]')].map((element) => element.getAttribute('data-reorder-id'))
const live = () => document.querySelector('[aria-live="assertive"]')?.textContent ?? ''

function reduceMotion() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
}

beforeAll(() => installPointerEvents())

beforeEach(() => {
  // jsdom logs "not implemented" for window.scrollBy; the hook only scrolls near an edge.
  window.scrollBy = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.documentElement.className = ''
})

describe('useReorder — keyboard', () => {
  it('Space lifts, arrows preview, Space drops: one commit, the new order, focus kept on the grip', () => {
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />)
    layoutRows()
    expect(grip('Alpha').getAttribute('aria-describedby')).toBe(
      document.querySelector('.visually-hidden')?.id,
    )
    grip('Alpha').focus()
    fireEvent.keyDown(grip('Alpha'), { key: ' ' })
    expect(live()).toBe('Picked up Alpha. Position 1 of 4.')
    expect(grip('Alpha').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('active').textContent).toBe('true')
    expect(row('A').getAttribute('data-reorder')).toBe('lifted')
    expect(row('A').getAttribute('data-reorder-mode')).toBe('keyboard')
    expect(row('B').getAttribute('data-reorder')).toBe('shifting')

    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowDown' })
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowDown' })
    expect(live()).toBe('Alpha, position 3 of 4.')
    expect(row('A').style.transform).toBe('translateY(80px)')
    expect(row('B').style.transform).toBe('translateY(-40px)')
    expect(row('C').style.transform).toBe('translateY(-40px)')
    expect(row('D').style.transform).toBe('')
    expect(onCommit).not.toHaveBeenCalled()

    fireEvent.keyDown(grip('Alpha'), { key: ' ' })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(['B', 'C', 'A', 'D'], 'A')
    expect(order()).toEqual(['B', 'C', 'A', 'D'])
    expect(live()).toBe('Dropped Alpha at position 3 of 4.')
    expect(row('A').style.transform).toBe('')
    expect(row('A').hasAttribute('data-reorder')).toBe(false)
    expect(row('B').hasAttribute('data-reorder')).toBe(false)
    expect(document.activeElement).toBe(grip('Alpha'))
    expect(grip('Alpha').getAttribute('aria-pressed')).toBeNull()
    expect(screen.getByTestId('active').textContent).toBe('false')
  })

  it('Enter lifts too; Home and End jump to the ends; the arrows clamp there', () => {
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.keyDown(grip('Charlie'), { key: 'Enter' })
    fireEvent.keyDown(grip('Charlie'), { key: 'Home' })
    expect(live()).toBe('Charlie, position 1 of 4.')
    fireEvent.keyDown(grip('Charlie'), { key: 'ArrowUp' })
    expect(live()).toBe('Charlie, position 1 of 4.')
    fireEvent.keyDown(grip('Charlie'), { key: 'End' })
    fireEvent.keyDown(grip('Charlie'), { key: 'ArrowDown' })
    expect(live()).toBe('Charlie, position 4 of 4.')
    fireEvent.keyDown(grip('Charlie'), { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith(['A', 'B', 'D', 'C'], 'C')
  })

  it('a drop where it started commits nothing', () => {
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.keyDown(grip('Bravo'), { key: ' ' })
    fireEvent.keyDown(grip('Bravo'), { key: 'ArrowDown' })
    fireEvent.keyDown(grip('Bravo'), { key: 'ArrowUp' })
    fireEvent.keyDown(grip('Bravo'), { key: ' ' })
    expect(onCommit).not.toHaveBeenCalled()
    expect(live()).toBe('Dropped Bravo where it was.')
  })

  it('Escape cancels, eases every row home, and never reaches a popover listening on document', () => {
    vi.useFakeTimers()
    const onCommit = vi.fn()
    const popover = vi.fn()
    document.addEventListener('keydown', popover, true)
    render(<Stateful initial={flat('A', 'B', 'C')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.keyDown(grip('Bravo'), { key: 'Enter' })
    fireEvent.keyDown(grip('Bravo'), { key: 'ArrowUp' })
    expect(row('B').style.transform).toBe('translateY(-40px)')
    fireEvent.keyDown(grip('Bravo'), { key: 'Escape' })
    expect(popover).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
    expect(live()).toBe('Cancelled. Bravo is back at position 2 of 3.')
    expect(row('B').style.transform).toBe('')
    expect(row('A').style.transform).toBe('')
    act(() => {
      vi.advanceTimersByTime(MOTION_MS.fast)
    })
    expect(row('B').hasAttribute('data-reorder')).toBe(false)
    expect(order()).toEqual(['A', 'B', 'C'])
    document.removeEventListener('keydown', popover, true)
  })

  it('tabbing away (the grip blurs) cancels a keyboard lift', () => {
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C')} onCommit={onCommit} />)
    layoutRows()
    grip('Bravo').focus()
    fireEvent.keyDown(grip('Bravo'), { key: ' ' })
    fireEvent.keyDown(grip('Bravo'), { key: 'ArrowDown' })
    act(() => {
      grip('Bravo').blur()
    })
    expect(live()).toBe('Cancelled. Bravo is back at position 2 of 3.')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('data landing under a live lift cancels it silently; the next Space lifts afresh', () => {
    const onCommit = vi.fn()
    const { rerender } = render(<List items={flat('A', 'B', 'C')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.keyDown(grip('Bravo'), { key: ' ' })
    fireEvent.keyDown(grip('Bravo'), { key: 'ArrowDown' })
    rerender(<List items={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />)
    expect(grip('Bravo').getAttribute('aria-pressed')).toBeNull()
    expect(row('B').style.transform).toBe('')
    expect(row('C').hasAttribute('data-reorder')).toBe(false)
    layoutRows()
    fireEvent.keyDown(grip('Bravo'), { key: ' ' })
    expect(live()).toBe('Picked up Bravo. Position 2 of 4.')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('a busy list keeps its grips focusable but inert', () => {
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B')} onCommit={onCommit} disabled />)
    layoutRows()
    expect(grip('Alpha').getAttribute('aria-disabled')).toBe('true')
    expect((grip('Alpha') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.keyDown(grip('Alpha'), { key: ' ' })
    expect(live()).toBe('')
    expect(grip('Alpha').getAttribute('aria-pressed')).toBeNull()
  })

  it('a range of one has a disabled grip', () => {
    render(<Stateful initial={flat('A')} />)
    expect((grip('Alpha') as HTMLButtonElement).disabled).toBe(true)
  })

  it('carried rows travel with their unit; a component moves among its siblings only', () => {
    const onCommit = vi.fn()
    const items: ReorderItem<string>[] = [
      { id: 'P', range: 'g', carries: ['C1', 'C2'] },
      { id: 'C1', range: 'parent:P' },
      { id: 'C2', range: 'parent:P' },
      { id: 'Q', range: 'g' },
    ]
    render(<Stateful initial={items} onCommit={onCommit} />)
    layoutRows()
    fireEvent.keyDown(grip('Quebec'), { key: ' ' })
    expect(live()).toBe('Picked up Quebec. Position 2 of 2 in Group.')
    fireEvent.keyDown(grip('Quebec'), { key: 'ArrowUp' })
    expect(row('Q').style.transform).toBe('translateY(-120px)')
    expect(row('P').style.transform).toBe('translateY(40px)')
    expect(row('C1').style.transform).toBe('translateY(40px)')
    expect(row('C2').style.transform).toBe('translateY(40px)')
    fireEvent.keyDown(grip('Quebec'), { key: ' ' })
    expect(onCommit).toHaveBeenLastCalledWith(['Q', 'P', 'C1', 'C2'], 'Q')

    layoutRows()
    fireEvent.keyDown(grip('Comp two'), { key: ' ' })
    expect(live()).toBe('Picked up Comp two. Position 2 of 2.')
    fireEvent.keyDown(grip('Comp two'), { key: 'ArrowUp' })
    fireEvent.keyDown(grip('Comp two'), { key: ' ' })
    expect(onCommit).toHaveBeenLastCalledWith(['Q', 'P', 'C2', 'C1'], 'C2')
  })

  it('markSaved flashes the unit for MOTION_MS.flash', () => {
    vi.useFakeTimers()
    render(<Stateful initial={flat('A', 'B', 'C')} />)
    fireEvent.click(screen.getByRole('button', { name: 'mark Bravo saved' }))
    expect(row('B').hasAttribute('data-reorder-saved')).toBe(true)
    act(() => {
      vi.advanceTimersByTime(MOTION_MS.flash)
    })
    expect(row('B').hasAttribute('data-reorder-saved')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/components/reorder/useReorder.test.tsx`
Expected: FAIL — `Failed to resolve import "./useReorder"`.

- [ ] **Step 3: Write `useReorder.ts`**

```ts
// Drag to reorder — the React half (2026-09-23 spec §2). A pointer + keyboard state machine for ONE
// list. Per-frame work — transforms, data-reorder* attributes — is written straight onto the rows the
// list registered through `itemProps`: React never renders a transform, so a 60fps drag costs no
// renders. The only React state is who is lifted and what the live region says.
//
// Consumer rules (lanes R2–R5):
//   1. Render EVERY item once, `{...itemProps(id)}` on its row, in `items` order (carried rows
//      right after their carrier).
//   2. Never set style.transform / style.transition on those rows.
//   3. `onCommit(next, moved)` must set the optimistic order SYNCHRONOUSLY — it runs inside
//      flushSync, so the DOM reorder and the cleared transforms land in one frame — then save, then
//      `markSaved(moved)` on success (restore the server order on failure).
//   4. Pass `disabled: busy`; disable the row's own buttons while `active`.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { flushSync } from 'react-dom'
import { EASE_OUT, MOTION_MS } from '../../theme/motion'
import { useReducedMotion } from '../useReducedMotion'
import {
  announce,
  autoScrollSpeed,
  clampOffset,
  keyboardTarget,
  moveUnit,
  peersOf,
  rangeSizes,
  shiftsFor,
  signatureOf,
  slotFor,
  unitOf,
} from './reorderMath'
import type { AnnounceContext, Extent, ReorderItem, ReorderKey } from './reorderMath'
import {
  cancelFrame,
  ensureVisible,
  listY,
  nextFrame,
  scrollByY,
  scrollParentOf,
  unitExtent,
  visibleBounds,
} from './reorderDom'
import type { Scroller } from './reorderDom'
import type { ReorderHandleProps, ReorderItemProps } from './reorderTypes'

export type { ReorderHandleProps, ReorderItemProps } from './reorderTypes'

/** A pointer must travel this far before a press becomes a drag: a click on a grip never lifts. */
export const LIFT_THRESHOLD = 4

export interface UseReorderOptions<K extends ReorderKey> {
  /** DISPLAY order — carried rows right after their carrier. */
  items: readonly ReorderItem<K>[]
  /** The row's name for the live region ("Housing"). */
  labelOf: (id: K) => string
  /** A range's name for the lift sentence ("…in Cash"); undefined says nothing. */
  rangeLabelOf?: (range: string) => string | undefined
  /** True while ANY request of the list is in flight: grips go inert (still focusable). */
  disabled?: boolean
  /** Once per drop that moved something: the new flat display order and the unit's id. */
  onCommit: (next: K[], moved: K) => void
}

export interface UseReorder<K extends ReorderKey> {
  itemProps: (id: K) => ReorderItemProps
  handleProps: (id: K) => ReorderHandleProps
  /** Call after the save succeeds: the unit's rows flash for MOTION_MS.flash. */
  markSaved: (id: K) => void
  instructionsId: string
  announcement: string
  liftedId: K | null
  /** A unit is lifted — the list disables its rows' own buttons. */
  active: boolean
}

interface Drag<K extends ReorderKey> {
  id: K
  mode: 'pointer' | 'keyboard'
  phase: 'pressing' | 'lifted' | 'settling'
  pointerId: number | null
  startClientY: number
  startListY: number
  lastClientY: number
  scroller: Scroller
  peers: K[]
  units: K[][]
  extents: Extent[]
  from: number
  to: number
  offset: number
  signature: string
  frame: number | null
  timer: number | null
  detach: (() => void) | null
}

interface Machine<K extends ReorderKey> {
  drag: Drag<K> | null
}

interface Snapshot<K extends ReorderKey> {
  liftedId: K | null
  announcement: string
  /** The list's signature while a drag holds it; null when none does. */
  signature: string | null
}

const REORDER_ATTRIBUTES = ['data-reorder', 'data-reorder-mode', 'data-reorder-drop'] as const

function fullSignature<K extends ReorderKey>(items: readonly ReorderItem<K>[], disabled: boolean): string {
  // `disabled` rides the signature: a list that turns busy under a live drag cancels it.
  return `${signatureOf(items)}#${disabled ? 'busy' : 'idle'}`
}

function clearRow(element: HTMLElement): void {
  element.style.transform = ''
  element.style.transition = ''
  for (const attribute of REORDER_ATTRIBUTES) element.removeAttribute(attribute)
}

function clearRows<K extends ReorderKey>(rows: Map<K, HTMLElement>): void {
  rows.forEach(clearRow)
  document.documentElement.classList.remove('reorder-active')
}

function stopDrag<K extends ReorderKey>(drag: Drag<K>): void {
  drag.detach?.()
  drag.detach = null
  if (drag.frame !== null) cancelFrame(drag.frame)
  drag.frame = null
  if (drag.timer !== null) window.clearTimeout(drag.timer)
  drag.timer = null
}

export function useReorder<K extends ReorderKey>(options: UseReorderOptions<K>): UseReorder<K> {
  const reduced = useReducedMotion()
  const instructionsId = useId()
  const signature = fullSignature(options.items, options.disabled === true)
  const sizes = rangeSizes(options.items)
  const [snap, setSnap] = useState<Snapshot<K>>({ liftedId: null, announcement: '', signature: null })

  // Data landed under a live drag (spec §2.3): the lift is void. React state resets here, during
  // render — the house's adjust-during-render pattern (CategoriesPanel's pendingOrder), so
  // set-state-in-effect stays clean. The DOM half resets in the layout effect below.
  if (snap.signature !== null && snap.signature !== signature) {
    setSnap({ liftedId: null, announcement: '', signature: null })
  }

  const rows = useRef(new Map<K, HTMLElement>())
  const grips = useRef(new Map<K, HTMLButtonElement>())
  const savedTimers = useRef(new Map<K, number>())
  const machine = useRef<Machine<K>>({ drag: null })
  const latest = useRef({ options, reduced })

  useLayoutEffect(() => {
    latest.current = { options, reduced }
  })

  useLayoutEffect(() => {
    const state = machine.current
    const drag = state.drag
    if (drag === null || drag.signature === signature) return
    stopDrag(drag)
    state.drag = null
    clearRows(rows.current)
  }, [signature])

  useEffect(() => {
    const state = machine.current
    const rowMap = rows.current
    const timers = savedTimers.current
    return () => {
      if (state.drag !== null) stopDrag(state.drag)
      state.drag = null
      clearRows(rowMap)
      timers.forEach((timer) => window.clearTimeout(timer))
      timers.clear()
    }
  }, [])

  const context = (drag: Drag<K>, index: number): AnnounceContext => {
    const { options: current } = latest.current
    const range = current.items.find((item) => item.id === drag.id)?.range
    return {
      name: current.labelOf(drag.id),
      position: index + 1,
      count: drag.peers.length,
      range: range === undefined ? undefined : current.rangeLabelOf?.(range),
    }
  }

  const measure = (drag: Drag<K>) => {
    const { items } = latest.current.options
    drag.units = drag.peers.map((peer) => unitOf(items, peer))
    drag.extents = drag.units.map((unit) =>
      unitExtent(
        unit.flatMap((rowId) => {
          const element = rows.current.get(rowId)
          return element === undefined ? [] : [element]
        }),
        drag.scroller,
      ),
    )
  }

  const markRows = (drag: Drag<K>) => {
    const still = latest.current.reduced
    drag.units.forEach((unit, index) => {
      for (const rowId of unit) {
        const element = rows.current.get(rowId)
        if (element === undefined) continue
        if (index === drag.from) {
          element.setAttribute('data-reorder', 'lifted')
          if (drag.mode === 'keyboard') element.setAttribute('data-reorder-mode', 'keyboard')
        } else if (!still) {
          element.setAttribute('data-reorder', 'shifting')
        }
      }
    })
  }

  // Draw the drag at slot `to`: the lifted unit under the pointer (or, from the keyboard, at its
  // landing slot); peers shifted to make room — or, under reduced motion, left alone with an accent
  // drop line on the landing edge instead (spec §2.5).
  const paint = (drag: Drag<K>, to: number) => {
    const still = latest.current.reduced
    const shifts = shiftsFor(drag.extents, drag.from, to)
    drag.units.forEach((unit, index) => {
      let y = 0
      if (index === drag.from) y = drag.mode === 'pointer' ? drag.offset : still ? 0 : shifts[index]
      else if (!still) y = shifts[index]
      for (const rowId of unit) {
        const element = rows.current.get(rowId)
        if (element === undefined) continue
        element.style.transform = y === 0 ? '' : `translateY(${y}px)`
        element.removeAttribute('data-reorder-drop')
      }
    })
    if (still && to !== drag.from) {
      const target = drag.units[to]
      const edge = to < drag.from ? target[0] : target[target.length - 1]
      rows.current.get(edge)?.setAttribute('data-reorder-drop', to < drag.from ? 'before' : 'after')
    }
  }

  const track = (drag: Drag<K>) => {
    const delta = listY(drag.scroller, drag.lastClientY) - drag.startListY
    drag.offset = clampOffset(drag.extents, drag.from, delta)
    const self = drag.extents[drag.from]
    const to = slotFor(drag.extents, drag.from, self.top + drag.offset + self.height / 2)
    paint(drag, to)
    if (to !== drag.to) {
      drag.to = to
      const message = announce.move(context(drag, to))
      setSnap((current) => ({ ...current, announcement: message }))
    }
  }

  const finish = (drag: Drag<K>) => {
    stopDrag(drag)
    if (machine.current.drag === drag) machine.current.drag = null
    clearRows(rows.current)
    setSnap((current) => ({ ...current, liftedId: null, signature: null }))
  }

  // Back where it started (Escape, an unmoved drop, a lost pointer): every row eases home.
  const settleBack = (drag: Drag<K>, message: string) => {
    stopDrag(drag)
    drag.phase = 'settling'
    setSnap({ liftedId: null, announcement: message, signature: drag.signature })
    if (latest.current.reduced) {
      finish(drag)
      return
    }
    for (const rowId of drag.units.flat()) {
      const element = rows.current.get(rowId)
      if (element === undefined) continue
      element.style.transition = `transform ${MOTION_MS.fast}ms ${EASE_OUT}`
      element.style.transform = ''
    }
    drag.timer = window.setTimeout(() => finish(drag), MOTION_MS.fast)
  }

  const cancel = (drag: Drag<K>) => {
    if (drag.phase === 'pressing') {
      stopDrag(drag)
      machine.current.drag = null
      return
    }
    if (drag.phase === 'lifted') settleBack(drag, announce.cancel(context(drag, drag.from)))
  }

  const commit = (drag: Drag<K>, next: K[]) => {
    stopDrag(drag)
    machine.current.drag = null
    const message = announce.drop(context(drag, drag.to))
    // One frame: the list's optimistic order renders AND the transforms clear before paint.
    flushSync(() => {
      setSnap({ liftedId: null, announcement: message, signature: null })
      latest.current.options.onCommit(next, drag.id)
    })
    clearRows(rows.current)
    // A DOM move can blur the grip; a keyboard reader keeps their place.
    if (drag.mode === 'keyboard') grips.current.get(drag.id)?.focus()
  }

  const drop = (drag: Drag<K>) => {
    if (drag.to === drag.from) {
      settleBack(drag, announce.dropUnmoved(context(drag, drag.from)))
      return
    }
    const next = moveUnit(latest.current.options.items, drag.id, drag.to)
    if (drag.mode === 'keyboard' || latest.current.reduced) {
      commit(drag, next)
      return
    }
    // Pointer: the unit eases from under the pointer into its gap, THEN the order commits — the DOM
    // reorder lands on rows that already stand where it puts them.
    stopDrag(drag)
    drag.phase = 'settling'
    const slot = shiftsFor(drag.extents, drag.from, drag.to)[drag.from]
    for (const rowId of drag.units[drag.from]) {
      const element = rows.current.get(rowId)
      if (element === undefined) continue
      element.style.transition = `transform ${MOTION_MS.fast}ms ${EASE_OUT}`
      element.style.transform = slot === 0 ? '' : `translateY(${slot}px)`
    }
    drag.timer = window.setTimeout(() => commit(drag, next), MOTION_MS.fast)
  }

  // Window listeners for a live drag. Escape is caught on WINDOW in the CAPTURE phase, before any
  // document listener: usePopoverDismiss and the detail panel never see it (spec §2.3).
  const listen = (drag: Drag<K>) => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      cancel(drag)
    }
    const onAbandon = () => cancel(drag)
    const onScroll = () => {
      if (drag.mode === 'pointer' && drag.phase === 'lifted') track(drag)
    }
    const scrollTarget: HTMLElement | Window = drag.scroller ?? window
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onAbandon)
    window.addEventListener('resize', onAbandon)
    scrollTarget.addEventListener('scroll', onScroll, { passive: true })
    drag.detach = () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onAbandon)
      window.removeEventListener('resize', onAbandon)
      scrollTarget.removeEventListener('scroll', onScroll)
    }
  }

  const autoScroll = (drag: Drag<K>) => {
    const step = () => {
      if (machine.current.drag !== drag || drag.phase !== 'lifted') return
      const bounds = visibleBounds(drag.scroller)
      const speed = autoScrollSpeed(drag.lastClientY, bounds.top, bounds.bottom)
      if (speed !== 0) scrollByY(drag.scroller, speed)
      drag.frame = nextFrame(step)
    }
    drag.frame = nextFrame(step)
  }

  const lift = (drag: Drag<K>) => {
    measure(drag)
    drag.phase = 'lifted'
    markRows(drag)
    if (drag.mode === 'pointer') {
      document.documentElement.classList.add('reorder-active')
      autoScroll(drag)
    }
    listen(drag)
    const message = announce.lift(context(drag, drag.from))
    setSnap({ liftedId: drag.id, announcement: message, signature: drag.signature })
  }

  const begin = (id: K, mode: 'pointer' | 'keyboard', pointer: { id: number; clientY: number } | null) => {
    const { options: current } = latest.current
    if (current.disabled === true || machine.current.drag !== null) return null
    const peers = peersOf(current.items, id)
    if (peers.length < 2) return null
    const scroller = scrollParentOf(rows.current.get(id) ?? grips.current.get(id) ?? null)
    const from = peers.indexOf(id)
    const drag: Drag<K> = {
      id,
      mode,
      phase: 'pressing',
      pointerId: pointer?.id ?? null,
      startClientY: pointer?.clientY ?? 0,
      startListY: pointer === null ? 0 : listY(scroller, pointer.clientY),
      lastClientY: pointer?.clientY ?? 0,
      scroller,
      peers,
      units: [],
      extents: [],
      from,
      to: from,
      offset: 0,
      signature: fullSignature(current.items, false),
      frame: null,
      timer: null,
      detach: null,
    }
    machine.current.drag = drag
    return drag
  }

  const onPointerDown = (id: K, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    const drag = begin(id, 'pointer', { id: event.pointerId, clientY: event.clientY })
    if (drag === null) return
    // No text selection, no focus theft: the press belongs to the drag.
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = machine.current.drag
    if (drag === null || drag.mode !== 'pointer' || event.pointerId !== drag.pointerId) return
    drag.lastClientY = event.clientY
    if (drag.phase === 'pressing') {
      if (Math.abs(event.clientY - drag.startClientY) < LIFT_THRESHOLD) return
      lift(drag)
    }
    if (drag.phase === 'lifted') track(drag)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = machine.current.drag
    if (drag === null || drag.mode !== 'pointer' || event.pointerId !== drag.pointerId) return
    if (drag.phase === 'pressing') {
      machine.current.drag = null // a click: nothing was lifted
      return
    }
    if (drag.phase === 'lifted') drop(drag)
  }

  // pointercancel, or capture lost with no up (the OS took the pointer): the drag is abandoned.
  const onPointerLost = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = machine.current.drag
    if (drag === null || drag.mode !== 'pointer' || event.pointerId !== drag.pointerId) return
    cancel(drag)
  }

  const onKeyDown = (id: K, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const pick = event.key === ' ' || event.key === 'Enter'
    const drag = machine.current.drag
    if (drag === null) {
      if (!pick) return
      event.preventDefault()
      const started = begin(id, 'keyboard', null)
      if (started !== null) lift(started)
      return
    }
    if (drag.id !== id || drag.mode !== 'keyboard' || drag.phase !== 'lifted') return
    if (pick) {
      event.preventDefault()
      drop(drag)
      return
    }
    const to = keyboardTarget(event.key, drag.to, drag.peers.length)
    if (to === null) return
    event.preventDefault()
    drag.to = to
    paint(drag, to)
    const self = drag.extents[drag.from]
    ensureVisible(drag.scroller, self.top + shiftsFor(drag.extents, drag.from, to)[drag.from], self.height)
    const message = announce.move(context(drag, to))
    setSnap((current) => ({ ...current, announcement: message }))
  }

  const onBlur = (id: K) => {
    const drag = machine.current.drag
    if (drag !== null && drag.id === id && drag.mode === 'keyboard' && drag.phase === 'lifted') cancel(drag)
  }

  const markSaved = (id: K) => {
    const unit = unitOf(latest.current.options.items, id)
    const timers = savedTimers.current
    const previous = timers.get(id)
    if (previous !== undefined) window.clearTimeout(previous)
    for (const rowId of unit) rows.current.get(rowId)?.setAttribute('data-reorder-saved', '')
    timers.set(
      id,
      window.setTimeout(() => {
        for (const rowId of unit) rows.current.get(rowId)?.removeAttribute('data-reorder-saved')
        timers.delete(id)
      }, MOTION_MS.flash),
    )
  }

  const itemProps = (id: K): ReorderItemProps => ({
    ref: (element: HTMLElement | null) => {
      if (element === null) return
      rows.current.set(id, element)
      return () => {
        if (rows.current.get(id) === element) rows.current.delete(id)
      }
    },
    'data-reorder-id': String(id),
  })

  const handleProps = (id: K): ReorderHandleProps => {
    const range = options.items.find((item) => item.id === id)?.range ?? ''
    return {
      ref: (element: HTMLButtonElement | null) => {
        if (element === null) return
        grips.current.set(id, element)
        return () => {
          if (grips.current.get(id) === element) grips.current.delete(id)
        }
      },
      disabled: (sizes.get(range) ?? 0) < 2,
      'aria-disabled': options.disabled === true ? true : undefined,
      'aria-describedby': instructionsId,
      'aria-pressed': snap.liftedId === id ? true : undefined,
      onPointerDown: (event) => onPointerDown(id, event),
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerLost,
      onLostPointerCapture: onPointerLost,
      onKeyDown: (event) => onKeyDown(id, event),
      onBlur: () => onBlur(id),
    }
  }

  return {
    itemProps,
    handleProps,
    markSaved,
    instructionsId,
    announcement: snap.announcement,
    liftedId: snap.liftedId,
    active: snap.liftedId !== null,
  }
}
```

- [ ] **Step 4: Run the keyboard tests to see them pass**

Run: `npx vitest run src/components/reorder/useReorder.test.tsx`
Expected: PASS (10 tests). If the focus assertion after the drop fails, check that `commit` calls
`focus()` **after** `flushSync` and that the grip's `ref` callback registered the new element.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc -b && npx eslint src/components/reorder src/testing/pointer.ts`
Expected: exit 0, no warnings. If `react-hooks/refs` or `react-hooks/immutability` reports anything,
restructure so no `.current` is read during render and no hook-returned value is mutated. Never add a
disable comment.

- [ ] **Step 6: Commit**

```bash
git add src/components/reorder/useReorder.ts src/components/reorder/useReorder.test.tsx
git commit -m "feat(reorder): useReorder — the keyboard path (lift, preview, drop, cancel, focus kept, announcements)"
```

---

### Task 6: the pointer path and reduced motion

**Files:**
- Modify: `src/components/reorder/useReorder.test.tsx` (append two `describe` blocks)

The hook already implements the pointer path (Task 5); these tests pin it.

- [ ] **Step 1: Append the pointer and reduced-motion tests**

```tsx
describe('useReorder — pointer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('a press that travels under 4px is a click: no lift, no commit', () => {
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 223 })
    fireEvent.pointerUp(grip('Alpha'), { pointerId: 1, clientY: 223 })
    expect(live()).toBe('')
    expect(onCommit).not.toHaveBeenCalled()
    expect(row('A').hasAttribute('data-reorder')).toBe(false)
  })

  it('drags: the unit follows the pointer, peers make room, the drop eases in and commits once', () => {
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 230 })
    expect(live()).toBe('Picked up Alpha. Position 1 of 4.')
    expect(document.documentElement.classList.contains('reorder-active')).toBe(true)
    expect(row('A').getAttribute('data-reorder')).toBe('lifted')
    expect(row('A').hasAttribute('data-reorder-mode')).toBe(false)
    expect(row('B').getAttribute('data-reorder')).toBe('shifting')
    expect(screen.getByTestId('active').textContent).toBe('true')

    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 305 })
    expect(row('A').style.transform).toBe('translateY(85px)')
    expect(row('B').style.transform).toBe('translateY(-40px)')
    expect(row('C').style.transform).toBe('translateY(-40px)')
    expect(row('D').style.transform).toBe('')
    expect(live()).toBe('Alpha, position 3 of 4.')

    fireEvent.pointerUp(grip('Alpha'), { pointerId: 1, clientY: 305 })
    expect(row('A').style.transform).toBe('translateY(80px)') // easing into its gap
    expect(onCommit).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(MOTION_MS.fast)
    })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(['B', 'C', 'A', 'D'], 'A')
    expect(order()).toEqual(['B', 'C', 'A', 'D'])
    expect(row('A').style.transform).toBe('')
    expect(row('B').hasAttribute('data-reorder')).toBe(false)
    expect(document.documentElement.classList.contains('reorder-active')).toBe(false)
    expect(live()).toBe('Dropped Alpha at position 3 of 4.')
  })

  it('clamps the unit to the list', () => {
    render(<Stateful initial={flat('A', 'B', 'C', 'D')} />)
    layoutRows()
    fireEvent.pointerDown(grip('Bravo'), { pointerId: 1, button: 0, clientY: 260 })
    fireEvent.pointerMove(grip('Bravo'), { pointerId: 1, clientY: 900 })
    expect(row('B').style.transform).toBe('translateY(80px)')
    expect(live()).toBe('Bravo, position 4 of 4.')
    fireEvent.pointerMove(grip('Bravo'), { pointerId: 1, clientY: -400 })
    expect(row('B').style.transform).toBe('translateY(-40px)')
    expect(live()).toBe('Bravo, position 1 of 4.')
  })

  it('a drop where it started eases home and commits nothing', () => {
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.pointerDown(grip('Bravo'), { pointerId: 1, button: 0, clientY: 260 })
    fireEvent.pointerMove(grip('Bravo'), { pointerId: 1, clientY: 270 })
    fireEvent.pointerMove(grip('Bravo'), { pointerId: 1, clientY: 262 })
    fireEvent.pointerUp(grip('Bravo'), { pointerId: 1, clientY: 262 })
    expect(live()).toBe('Dropped Bravo where it was.')
    act(() => {
      vi.advanceTimersByTime(MOTION_MS.fast)
    })
    expect(onCommit).not.toHaveBeenCalled()
    expect(row('B').hasAttribute('data-reorder')).toBe(false)
  })

  it('pointercancel and Escape abandon the drag; a second pointer is ignored', () => {
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 290 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 2, clientY: 220 })
    expect(row('A').style.transform).toBe('translateY(70px)')
    fireEvent.pointerCancel(grip('Alpha'), { pointerId: 1 })
    expect(live()).toBe('Cancelled. Alpha is back at position 1 of 3.')
    act(() => {
      vi.advanceTimersByTime(MOTION_MS.fast)
    })

    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 290 })
    fireEvent.keyDown(grip('Alpha'), { key: 'Escape' })
    expect(live()).toBe('Cancelled. Alpha is back at position 1 of 3.')
    fireEvent.pointerUp(grip('Alpha'), { pointerId: 1, clientY: 290 })
    act(() => {
      vi.advanceTimersByTime(MOTION_MS.fast)
    })
    expect(onCommit).not.toHaveBeenCalled()
    expect(order()).toEqual(['A', 'B', 'C'])
  })

  it('a secondary button never starts a drag', () => {
    render(<Stateful initial={flat('A', 'B')} />)
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 2, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 300 })
    expect(live()).toBe('')
  })

  it('unmounting mid-drag leaves no cursor class behind', () => {
    const { unmount } = render(<Stateful initial={flat('A', 'B')} />)
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 250 })
    expect(document.documentElement.classList.contains('reorder-active')).toBe(true)
    unmount()
    expect(document.documentElement.classList.contains('reorder-active')).toBe(false)
  })
})

describe('useReorder — reduced motion (spec §2.5)', () => {
  it('keyboard: peers never move, a drop line marks the landing edge, the drop commits at once', () => {
    reduceMotion()
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.keyDown(grip('Alpha'), { key: ' ' })
    expect(row('B').hasAttribute('data-reorder')).toBe(false)
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowDown' })
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowDown' })
    expect(row('A').style.transform).toBe('')
    expect(row('B').style.transform).toBe('')
    expect(row('C').getAttribute('data-reorder-drop')).toBe('after')
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowUp' })
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowUp' })
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowUp' })
    expect(row('C').hasAttribute('data-reorder-drop')).toBe(false)
    fireEvent.keyDown(grip('Alpha'), { key: 'End' })
    fireEvent.keyDown(grip('Alpha'), { key: ' ' })
    expect(onCommit).toHaveBeenCalledWith(['B', 'C', 'D', 'A'], 'A')
    expect(row('D').hasAttribute('data-reorder-drop')).toBe(false)
  })

  it('pointer: the unit still follows the pointer; the line marks a move upward on the top edge', () => {
    reduceMotion()
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.pointerDown(grip('Delta'), { pointerId: 1, button: 0, clientY: 340 })
    fireEvent.pointerMove(grip('Delta'), { pointerId: 1, clientY: 255 })
    expect(row('D').style.transform).toBe('translateY(-85px)')
    expect(row('B').style.transform).toBe('')
    expect(row('B').getAttribute('data-reorder-drop')).toBe('before')
    fireEvent.pointerUp(grip('Delta'), { pointerId: 1, clientY: 255 })
    expect(onCommit).toHaveBeenCalledWith(['A', 'D', 'B', 'C'], 'D')
  })
})
```

The drag arithmetic behind these expectations: rows are 40 px tall, stacked from y=200, so the
midpoints are A 220, B 260, C 300, D 340.
- **Alpha dragged +85** (its centre at 305) passes B and C, not D → slot 2. Its landing offset is
  +80.
- **Bravo clamped** to +80 or −40: its centre sits exactly on D's or A's midpoint, and the tie rule
  (Task 2) lands it at the end.
- **Delta dragged −85** (its centre at 255) passes A only → slot 1, with the drop line on B's top edge.

- [ ] **Step 2: Run the hook tests**

Run: `npx vitest run src/components/reorder/useReorder.test.tsx`
Expected: PASS (19 tests: 10 keyboard, 7 pointer, 2 reduced-motion).
- If the rAF loop throws in jsdom, `nextFrame` falls back to a timer and fake timers drive it.
- If `window.scrollBy` shows up in a failure, a row sits inside an edge zone: `layoutRows` starts at
  y=200 to keep the default tests clear of the 40 px zones of jsdom's 768 px viewport.
- `markSaved` and the unmount cleanup are covered by the last keyboard test and the last pointer test.

- [ ] **Step 3: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/reorder src/testing/pointer.ts
git add src/components/reorder/useReorder.test.tsx
git commit -m "test(reorder): pointer drags pinned — threshold, clamp, settle, cancel, second pointer, cleanup, reduced motion"
```

---

### Task 7: the stylesheet

**Files:**
- Modify: `src/components/reorder/reorder.css` (complete it)
- Test: `src/components/reorder/reorderCss.test.ts`

- [ ] **Step 1: Write the failing CSS test**

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** Comments first, over the WHOLE file (settingsCss.test.ts's rule). */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every declaration of `selector`, concatenated across blocks. */
function declarationsFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blocks = [
    ...stripComments(css).matchAll(new RegExp(`(^|[,{}])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g')),
  ]
  if (blocks.length === 0) throw new Error(`no ${selector} block`)
  return blocks.map((match) => match[2]).join(' ')
}

const css = readFileSync(path.resolve(__dirname, 'reorder.css'), 'utf8')

describe('reorder.css', () => {
  it('gives each cell of a reorderable table its own hairline (a collapsed border stays behind)', () => {
    const table = declarationsFor(css, '.reorder-table')
    expect(table).toContain('border-collapse: separate;')
    expect(table).toContain('border-spacing: 0;')
  })

  it('moves peers — and a keyboard-lifted unit — on the motion tokens only', () => {
    expect(declarationsFor(css, "[data-reorder='shifting']")).toContain(
      'transition: transform var(--t-fast) var(--ease-out);',
    )
    expect(declarationsFor(css, "[data-reorder='lifted'][data-reorder-mode='keyboard']")).toContain(
      'transition: transform var(--t-fast) var(--ease-out);',
    )
  })

  it('lifts the unit above its neighbours', () => {
    const lifted = declarationsFor(css, "[data-reorder='lifted']")
    expect(lifted).toContain('position: relative;')
    expect(lifted).toContain('z-index: 2;')
  })

  it('flashes a saved row for --t-flash and draws the reduced-motion drop line in the accent', () => {
    const plain = stripComments(css)
    expect(plain).toMatch(/animation:\s*reorder-saved var\(--t-flash\)/)
    expect(plain).toContain("[data-reorder-drop='before']")
    expect(plain).toContain('inset 0 2px 0 var(--accent)')
    expect(plain).toContain('inset 0 -2px 0 var(--accent)')
  })

  it('never styles .is-dragging — the detail-panel resizer owns that name', () => {
    expect(stripComments(css)).not.toContain('.is-dragging')
  })

  it('keeps a touch drag on the grip from scrolling the page, and the cursor honest mid-drag', () => {
    expect(declarationsFor(css, '.reorder-grip')).toContain('touch-action: none;')
    expect(stripComments(css)).toMatch(/html\.reorder-active \*[^{]*\{[^}]*cursor: grabbing !important;/)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/reorder/reorderCss.test.ts`
Expected: FAIL — `no .reorder-table block`.

- [ ] **Step 3: Complete `reorder.css`**

```css
/* Drag to reorder (2026-09-23 spec §2). One stylesheet for every reorderable list: the grip, the
   row states the hook writes as data-reorder* ATTRIBUTES (never classes — `.is-dragging` belongs to
   the detail-panel resizer, details.css), the table border model and the mid-drag cursor. Tokens
   only: --t-fast/--ease-out move rows (index.css zeroes them under reduced motion, and the hook stops
   shifting peers there — spec §2.5), --t-flash times the saved flash, the colours are theme tokens. */

.reorder-grip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--muted);
  cursor: grab;
  /* A touch drag on the grip is a reorder, never a page scroll. */
  touch-action: none;
}

.reorder-grip:hover:not(:disabled):not([aria-disabled='true']) {
  color: var(--text);
}

.reorder-grip:disabled {
  cursor: default;
  opacity: 0.35;
}

/* Busy (a save in flight): inert but focusable, so a keyboard reader keeps their place. */
.reorder-grip[aria-disabled='true'] {
  cursor: progress;
  opacity: 0.6;
}

.reorder-grip:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.reorder-grip[aria-pressed='true'] {
  color: var(--accent);
  cursor: grabbing;
}

/* The grip's column (its <td> and the empty header <th>): as narrow as the icon. */
.reorder-grip-cell {
  width: 2rem;
  padding-right: 0;
}

/* Mid-drag (pointer): the whole page says "grabbing" and nothing selects under the sweep. */
html.reorder-active,
html.reorder-active * {
  cursor: grabbing !important;
  user-select: none !important;
}

/* A collapsed border is painted by the TABLE, so a translated row would leave its hairline behind
   (spec §0.11). Separate borders with zero spacing give every cell its own border-bottom — the
   resting look is the same, and the hairline travels with its row. */
.reorder-table {
  border-collapse: separate;
  border-spacing: 0;
}

[data-reorder='shifting'] {
  transition: transform var(--t-fast) var(--ease-out);
}

/* From the keyboard the lifted unit steps slot to slot, so it eases like its peers; under the pointer
   it follows the hand with no transition at all. */
[data-reorder='lifted'][data-reorder-mode='keyboard'] {
  transition: transform var(--t-fast) var(--ease-out);
}

[data-reorder='lifted'] {
  position: relative;
  z-index: 2;
}

tr[data-reorder='lifted'] > td,
:not(tr)[data-reorder='lifted'] {
  background: var(--surface-2);
  box-shadow:
    inset 0 1px 0 var(--border),
    inset 0 -1px 0 var(--border);
}

/* A list of boxes (Overview › Customize) lifts with a real shadow; a table row cannot wear one. */
:not(tr)[data-reorder='lifted'] {
  border-radius: 6px;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.28);
}

/* Reduced motion: peers stay put and an accent line marks the landing edge instead. */
tr[data-reorder-drop='before'] > td,
:not(tr)[data-reorder-drop='before'] {
  box-shadow: inset 0 2px 0 var(--accent);
}

tr[data-reorder-drop='after'] > td,
:not(tr)[data-reorder-drop='after'] {
  box-shadow: inset 0 -2px 0 var(--accent);
}

/* Saved: one accent wash fading out (the pasted-cell flash's language, MonthlyUpdatePage.css). */
@keyframes reorder-saved {
  from {
    background-color: var(--surface-2);
    background-color: color-mix(in srgb, var(--accent) 22%, transparent);
  }
  to {
    background-color: transparent;
  }
}

tr[data-reorder-saved] > td,
:not(tr)[data-reorder-saved] {
  animation: reorder-saved var(--t-flash) var(--ease-out);
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/components/reorder/reorderCss.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/reorder/reorder.css src/components/reorder/reorderCss.test.ts
git commit -m "feat(reorder): the stylesheet — grip, lifted/shifting/drop/saved states, per-cell hairlines, drag cursor"
```

---

### Task 8: the lane's gates

**Files:** none (verification only). Record results in this plan's "Results" section.

- [ ] **Step 1: Lane tests**

Run: `npx vitest run src/components/reorder`
Expected: every test in the five files passes.

- [ ] **Step 2: The full frontend suite**

Run: `npx vitest run`
Expected: exit 0. Record the file and test counts. The reorder lane adds files only, so any failure
elsewhere is pre-existing. Compare against `feat/reorder-base` by running the same command in
`.worktrees/reorder-base` (with its own `node_modules` symlink) before reporting.

- [ ] **Step 3: Types, lint, build**

Run: `npx tsc -b && npx eslint . && npm run build`
Expected: all three exit 0. `eslint .` reports **no warnings** in `src/components/reorder` or
`src/testing/pointer.ts`.

- [ ] **Step 4: Scope check**

Run: `git diff --stat feat/reorder-base...HEAD`
Expected: only `src/components/reorder/**`, `src/testing/pointer.ts` and this plan's Results section.

- [ ] **Step 5: Commit the results**

```bash
git add docs/superpowers/plans/2026-09-23-reorder-r0-component.md
git commit -m "docs(plan): lane R0 — results and gates"
```

## Results (filled in by the implementer)

- Lane tests: …
- Full vitest: … files / … tests
- tsc / eslint / build: …
- Notes for R2–R5 (anything the contract section should say that it does not): …

## Self-review (spec coverage)

| Spec requirement | Task |
|---|---|
| §2.1 files, no dependency | 1–7 |
| §2.2 model: units, ranges, carries, one `onCommit` per drop, hook surface | 2, 5 |
| §2.3 pointer: capture, 4 px threshold, list coordinates, clamp, slot, shifts, auto-scroll, drop settle, cancel (Escape at window capture, pointercancel, lost capture, blur, resize, data change) | 3, 5, 6 |
| §2.4 keyboard: grip name/description/`aria-pressed`/disabled, Space/Enter/↑/↓/Home/End/Escape/Tab, keep in view, focus kept, announcements | 2, 4, 5 |
| §2.5 motion: tokens, reduced motion (no shifts, drop line), saved flash, attribute states not `.is-dragging`, `.reorder-table` border model | 5, 6, 7 |
| §2.6 acceptance list | 2–7 |
| §8.2 copy | 2, 4 |
| §9 edge cases owned by the component (one-item range, busy grips focusable, data landing mid-drag, Escape inside a popover) | 5, 6 |
