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
