import type { OwnerScope } from '../../api/netWorth'
import { getSnapshot } from '../../api/snapshotCache'
import type { HouseholdOut } from '../../types/api'
import { HOUSEHOLD_SNAPSHOT } from '../shell/ScopeBar'

/** The scope's name for a selection receipt — read off the household snapshot the ScopeBar
 *  already keeps, so no card fetches the household a second time to label a slice. Shared by
 *  AllocationPanel and HeatTreemapCard (one definition, two views). */
export function ownerScopeLabel(owner: OwnerScope): string {
  if (owner === null) return 'Household'
  if (owner === 'joint') return 'Joint'
  return getSnapshot<HouseholdOut>(HOUSEHOLD_SNAPSHOT)?.people.find((person) => person.id === owner)?.name ?? 'Selected owner'
}
