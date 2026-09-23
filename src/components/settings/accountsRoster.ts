import { GROUP_ORDER } from '../../charts/theme'
import type { AccountGroup, AccountOut } from '../../types/api'
import { nestComponents } from '../../utils/accounts'
import type { ReorderItem } from '../reorder/reorderMath'

// The Settings Accounts roster's shape (2026-09-23 reorder spec §4.2), beside the card that draws
// it: it needs the chart grammar's GROUP_ORDER and the reorder hook's item type, and utils/ never
// reaches up to either (src/utils/layering.test.ts). nestComponents itself stays in utils.

/** One drag unit of the Settings roster: a top-level account and the components nested under it,
 *  which travel with it and move only among themselves. */
export interface RosterUnit {
  account: AccountOut
  components: AccountOut[]
  /** nestComponents could not place it — its parent is itself nested (a chain) or the link
   *  loops back (a cycle). Kept at the END of its group with a grip that has nowhere to go:
   *  the roster is where that link gets fixed, and the order PUT must name every account. */
  unplaced: boolean
}

export interface RosterGroup {
  group: AccountGroup
  units: RosterUnit[]
}

/**
 * The roster the way the Monthly update walks it (spec §4.2): one block per non-empty group in
 * GROUP_ORDER, API order inside it, components nested under their parent by nestComponents run
 * PER GROUP — so a component whose parent sits in another group stays top-level in its own
 * (nestComponents' contract for an absent parent), and one whose parent is retired stays
 * nested, because a retired parent is still listed there.
 */
export function rosterGroups(accounts: AccountOut[]): RosterGroup[] {
  return GROUP_ORDER.flatMap((group) => {
    const members = accounts.filter((account) => account.group === group)
    if (members.length === 0) return []
    const present = new Set(members.map((account) => account.id))
    const units: RosterUnit[] = []
    for (const account of nestComponents(members)) {
      // nestComponents emits each parent followed by its nested components, so a nested row
      // always belongs to the unit opened just before it.
      const nested = account.parent_account_id !== null && present.has(account.parent_account_id)
      const carrier = units.at(-1)
      if (nested && carrier !== undefined) carrier.components.push(account)
      else units.push({ account, components: [], unplaced: false })
    }
    const placed = new Set(
      units.flatMap((unit) => [unit.account.id, ...unit.components.map((c) => c.id)]),
    )
    for (const account of members) {
      if (!placed.has(account.id)) units.push({ account, components: [], unplaced: true })
    }
    return [{ group, units }]
  })
}

/**
 * The reorder hook's items for a grouped roster, in DISPLAY order (reorder spec §2.2): a top-level
 * account ranges over its group and carries its components; a component ranges over its siblings
 * only (`parent:<id>`); an unplaced row has a range of its own, so its grip has nowhere to go.
 * Derived from the rows being drawn every time, so `carries` can never go stale against them.
 */
export function rosterItems(groups: readonly RosterGroup[]): ReorderItem<number>[] {
  return groups.flatMap(({ group, units }) =>
    units.flatMap(({ account, components, unplaced }) => [
      {
        id: account.id,
        range: unplaced ? `unplaced:${account.id}` : group,
        carries: components.map((component) => component.id),
      },
      ...components.map((component) => ({ id: component.id, range: `parent:${account.id}` })),
    ]),
  )
}
