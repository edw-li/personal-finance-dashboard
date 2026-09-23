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

/** What `items` owes the hook (spec §2.2), as one sentence per breach — none when well-formed:
 *  - an item's `carries` are the items right after it, in that order;
 *  - each range's units stand side by side: a peer starts right after the previous peer's rows
 *    (its carried rows included), with no other range's row between them.
 *  Both are what the preview's shifts assume; the hook reports breaches in development only. */
export function contractProblems<K extends ReorderKey>(items: readonly ReorderItem<K>[]): string[] {
  const problems: string[] = []
  items.forEach((item, at) => {
    const carries = item.carries ?? []
    const after = items.slice(at + 1, at + 1 + carries.length).map((next) => String(next.id))
    if (carries.some((id, k) => after[k] !== String(id))) {
      problems.push(
        `${String(item.id)} carries ${carries.join(', ')}, but the rows right after it are ` +
          `${after.join(', ') || 'none'}. Carried rows must follow their carrier, in order.`,
      )
    }
  })
  const previous = new Map<string, { id: K; end: number }>()
  items.forEach((item, at) => {
    const range = rangeOf(item)
    const last = previous.get(range)
    if (last !== undefined && at !== last.end + 1) {
      const name = range === '' ? 'the default range' : `range "${range}"`
      problems.push(
        `${name} is not one block: ${String(item.id)} does not follow ${String(last.id)}'s rows. ` +
          `A range's rows must stand together.`,
      )
    }
    previous.set(range, { id: item.id, end: at + (item.carries?.length ?? 0) })
  })
  return problems
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

/** The lifted unit's landing slot: how many OTHER peers stay above it, judged by the unit's LEADING
 *  edge against each peer's original midpoint — the sortable-list rule. A peer below the start is
 *  passed once the unit's bottom edge reaches its midpoint; a peer above, once the unit's top edge
 *  rises strictly above its midpoint. Edges, not the centre: a tall unit clamped at the end of its
 *  range (its bottom on the last peer's bottom) must still pass a short last peer whose midpoint
 *  its centre could never reach (Settings › Accounts: a 401(k) and its three components over one
 *  IRA). Clamped at either end, a unit therefore lands at that end. Measured against where rows
 *  stood at lift, so heights may differ. */
export function slotFor(
  extents: readonly Extent[],
  from: number,
  liftedTop: number,
  liftedBottom: number,
): number {
  let slot = 0
  extents.forEach((extent, index) => {
    if (index === from) return
    const mid = extent.top + extent.height / 2
    if (index < from ? mid <= liftedTop : mid <= liftedBottom) slot += 1
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

/** The auto-scroll speed a range allows: none further down once the range's bottom already shows
 *  clear of the bottom edge zone, none further up once its top shows clear of the top zone. The held
 *  unit is clamped to its range, so scrolling on would only carry it out of view. List coordinates:
 *  `view` is what the scroller shows — its scroll offset and visible height. */
export function autoScrollWithin(
  speed: number,
  range: { top: number; bottom: number },
  view: { top: number; height: number },
): number {
  if (speed > 0 && range.bottom <= view.top + view.height - AUTO_SCROLL_EDGE) return 0
  if (speed < 0 && range.top >= view.top + AUTO_SCROLL_EDGE) return 0
  return speed
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
  /** Data landed (or the list turned busy) under a live lift: the rows have already re-rendered, so
   *  "back at position …" would describe a list that no longer exists (spec §2.3.7). */
  cancelChanged: () => 'Cancelled — the list changed.',
}

/** The grips' `aria-describedby` target (spec §8.2). */
export const REORDER_INSTRUCTIONS =
  'Press Space or Enter to pick up. Use the arrow keys to move, Home or End to jump, Space or Enter to drop, Escape to cancel.'
