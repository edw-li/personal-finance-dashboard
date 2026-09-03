// Entity → colour (chart spec §12): PALETTE slots are assigned by WHO or WHAT a series is,
// never by its rank in a response, and never past eight — the tail folds into the Other
// gray. Account groups already have fixed slots (GROUP_COLORS, re-exported); people take the
// household order (primary first, then by id, Joint last — lifted from NetWorthPage so the
// stack, the money-flow salary tints and any future per-person chart agree).
// Depends on: charts/theme.ts.
import { GROUP_COLORS, OTHER_SERIES_COLOR, PALETTE } from './theme'

export { GROUP_COLORS }

/** Primary first, then everyone else by id — the server's own owner_series order. */
export function orderedPeople<P extends { id: number; is_primary: boolean }>(people: readonly P[]): P[] {
  return [...people].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.id - b.id)
}

/** A person's palette slot; `null` (Joint) sits after every person; an unknown id takes the
 *  primary's slot rather than -1 (the page's own `Math.max(findIndex, 0)`). */
export function personSlot(
  people: readonly { id: number; is_primary: boolean }[],
  personId: number | null,
): number {
  const ordered = orderedPeople(people)
  if (personId === null) return ordered.length
  return Math.max(ordered.findIndex((p) => p.id === personId), 0)
}

/** The colour for a slot: the eight validated hues, then the fold gray — never a wrap. */
export function slotColor(slot: number): string {
  return slot < PALETTE.length ? PALETTE[slot] : OTHER_SERIES_COLOR
}

/** The gray every folded tail wears (Other categories, the ninth grant, the fourth donut slice). */
export const foldColor = OTHER_SERIES_COLOR

/** Drill/trend picks take the lowest free slot so removing one never repaints the survivors. */
export function lowestFreeSlot(used: Iterable<number>, max: number = PALETTE.length): number | null {
  const taken = new Set(used)
  for (let slot = 0; slot < max; slot += 1) if (!taken.has(slot)) return slot
  return null
}
