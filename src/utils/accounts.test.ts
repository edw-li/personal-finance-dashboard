import { describe, expect, it } from 'vitest'
import { contractProblems } from '../components/reorder/reorderMath'
import type { AccountOut } from '../types/api'
import { nestComponents, rosterGroups, rosterItems } from './accounts'

function account(overrides: Partial<AccountOut> & Pick<AccountOut, 'id' | 'name'>): AccountOut {
  return {
    slug: overrides.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    group: 'pre_tax',
    sort_order: overrides.id,
    is_active: true,
    is_component: false,
    parent_account_id: null,
    person_id: null,
    ...overrides,
  }
}

describe('nestComponents', () => {
  it('moves components under their parent, preserving order among siblings', () => {
    // Sheet order: HYSA, then the three source buckets, then their aggregate.
    const input = [
      account({ id: 1, name: 'HYSA' }),
      account({ id: 2, name: 'Employer Match', is_component: true, parent_account_id: 5 }),
      account({ id: 3, name: 'Reverse Rollover', is_component: true, parent_account_id: 5 }),
      account({ id: 4, name: 'Traditional', is_component: true, parent_account_id: 5 }),
      account({ id: 5, name: 'Fidelity Traditional' }),
      account({ id: 6, name: 'Roth Basic', is_component: true, parent_account_id: 8 }),
      account({ id: 7, name: 'After-Tax', is_component: true, parent_account_id: 8 }),
      account({ id: 8, name: 'Fidelity Roth' }),
    ]
    expect(nestComponents(input).map((a) => a.id)).toEqual([1, 5, 2, 3, 4, 8, 6, 7])
  })

  it('leaves a component in place when its parent is not in the list', () => {
    const input = [
      account({ id: 1, name: 'HYSA' }),
      account({ id: 2, name: 'Orphan', is_component: true, parent_account_id: 99 }),
      account({ id: 3, name: 'Brokerage' }),
    ]
    expect(nestComponents(input).map((a) => a.id)).toEqual([1, 2, 3])
  })

  it('is the identity on lists without parent links', () => {
    const input = [account({ id: 1, name: 'A' }), account({ id: 2, name: 'B' })]
    expect(nestComponents(input)).toEqual(input)
  })
})

// The Settings roster (2026-09-23 reorder spec §4.2): the Monthly update's walk — GROUP_ORDER,
// API order inside a group, nestComponents run PER GROUP — plus the rows it cannot place.
describe('rosterGroups', () => {
  const ids = (groups: ReturnType<typeof rosterGroups>) =>
    groups.map(({ group, units }) => ({
      group,
      units: units.map((unit) => ({
        id: unit.account.id,
        components: unit.components.map((component) => component.id),
        unplaced: unit.unplaced,
      })),
    }))

  it('walks the groups in GROUP_ORDER and API order inside each — an empty group is left out', () => {
    const input = [
      account({ id: 1, name: 'Brokerage', group: 'taxable' }),
      account({ id: 2, name: 'HSA', group: 'pre_tax' }),
      account({ id: 3, name: 'Checking', group: 'cash' }),
      account({ id: 4, name: 'Traditional IRA', group: 'pre_tax' }),
    ]
    expect(ids(rosterGroups(input))).toEqual([
      { group: 'cash', units: [{ id: 3, components: [], unplaced: false }] },
      {
        group: 'pre_tax',
        units: [
          { id: 2, components: [], unplaced: false },
          { id: 4, components: [], unplaced: false },
        ],
      },
      { group: 'taxable', units: [{ id: 1, components: [], unplaced: false }] },
    ])
  })

  it('nests the components under their parent, in API order — the sheet lists them first', () => {
    const input = [
      account({ id: 2, name: 'Employer Match', is_component: true, parent_account_id: 5 }),
      account({ id: 3, name: 'Traditional', is_component: true, parent_account_id: 5 }),
      account({ id: 5, name: 'Fidelity Traditional' }),
      account({ id: 6, name: 'HSA' }),
    ]
    expect(ids(rosterGroups(input))).toEqual([
      {
        group: 'pre_tax',
        units: [
          { id: 5, components: [2, 3], unplaced: false },
          { id: 6, components: [], unplaced: false },
        ],
      },
    ])
  })

  it('keeps a component whose parent sits in another group top-level in its own group (spec §9)', () => {
    const input = [
      account({ id: 1, name: 'Fidelity Traditional', group: 'pre_tax' }),
      account({ id: 2, name: 'Sweep', group: 'taxable', is_component: true, parent_account_id: 1 }),
    ]
    expect(ids(rosterGroups(input))).toEqual([
      { group: 'pre_tax', units: [{ id: 1, components: [], unplaced: false }] },
      { group: 'taxable', units: [{ id: 2, components: [], unplaced: false }] },
    ])
  })

  it('keeps a retired parent’s components nested — the parent is still listed (spec §9)', () => {
    const input = [
      account({ id: 1, name: 'Closed 401(k)', is_active: false }),
      account({ id: 2, name: 'Closed slice', is_component: true, parent_account_id: 1 }),
    ]
    expect(ids(rosterGroups(input))).toEqual([
      { group: 'pre_tax', units: [{ id: 1, components: [2], unplaced: false }] },
    ])
  })

  it('closes a group with the rows nestComponents cannot place — a component of a component, a parent loop', () => {
    const input = [
      account({ id: 1, name: 'Parent' }),
      account({ id: 2, name: 'Component', is_component: true, parent_account_id: 1 }),
      account({ id: 3, name: 'Slice of a slice', is_component: true, parent_account_id: 2 }),
      account({ id: 4, name: 'Loop A', is_component: true, parent_account_id: 5 }),
      account({ id: 5, name: 'Loop B', is_component: true, parent_account_id: 4 }),
      account({ id: 6, name: 'HSA' }),
    ]
    expect(ids(rosterGroups(input))).toEqual([
      {
        group: 'pre_tax',
        units: [
          { id: 1, components: [2], unplaced: false },
          { id: 6, components: [], unplaced: false },
          { id: 3, components: [], unplaced: true },
          { id: 4, components: [], unplaced: true },
          { id: 5, components: [], unplaced: true },
        ],
      },
    ])
  })
})

// The reorder hook's items for that roster (reorder spec §2.2): what can move, among whom, and
// what travels with it.
describe('rosterItems', () => {
  const book = [
    account({ id: 10, name: 'Checking', group: 'cash' }),
    account({ id: 2, name: 'Employer Match', is_component: true, parent_account_id: 5 }),
    account({ id: 3, name: 'Traditional', is_component: true, parent_account_id: 5 }),
    account({ id: 5, name: 'Fidelity Traditional' }),
    account({ id: 6, name: 'HSA' }),
    account({ id: 7, name: 'Slice of a slice', is_component: true, parent_account_id: 2 }),
    account({ id: 20, name: 'Sweep', group: 'taxable', is_component: true, parent_account_id: 5 }),
    account({ id: 21, name: 'Brokerage', group: 'taxable' }),
  ]

  it('ranges an account over its group carrying its components, a component over its siblings, an unplaced row over itself', () => {
    expect(rosterItems(rosterGroups(book))).toEqual([
      { id: 10, range: 'cash', carries: [] },
      { id: 5, range: 'pre_tax', carries: [2, 3] },
      { id: 2, range: 'parent:5' },
      { id: 3, range: 'parent:5' },
      { id: 6, range: 'pre_tax', carries: [] },
      { id: 7, range: 'unplaced:7', carries: [] },
      { id: 20, range: 'taxable', carries: [] },
      { id: 21, range: 'taxable', carries: [] },
    ])
  })

  it('names every account exactly once, in the order the table draws them — the order PUT sends them all', () => {
    const items = rosterItems(rosterGroups(book))
    expect(items.map((item) => item.id).sort((a, b) => a - b)).toEqual(
      book.map((a) => a.id).sort((a, b) => a - b),
    )
  })

  it('keeps the hook’s contract: carried rows follow their carrier, each range stands together', () => {
    expect(contractProblems(rosterItems(rosterGroups(book)))).toEqual([])
    // …in any API order the sheet or a drag leaves behind.
    expect(contractProblems(rosterItems(rosterGroups([...book].reverse())))).toEqual([])
  })
})
