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
