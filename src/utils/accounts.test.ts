import { describe, expect, it } from 'vitest'
import type { AccountOut } from '../types/api'
import { nestComponents } from './accounts'

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
