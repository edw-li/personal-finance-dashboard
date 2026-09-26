import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CreditCardOut, RewardCategoryOut, RewardRateOut } from '../../types/api'
import RewardsMatrix from './RewardsMatrix'
import { ConfirmProvider } from '../feedback/confirm'
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

function editor(onSaveRates = vi.fn().mockResolvedValue(undefined)) {
  const weights = new Map<number, number | null>([[1, 4000]])
  render(<ConfirmProvider><RewardsMatrix cards={[CARD]} categories={[CATEGORY]} rates={[RATE]}
    result={optimize(toMathCards([CARD]), toMathCategories([CATEGORY], weights), toMathRates([RATE]))}
    weights={weights} ownerNames={new Map()} busy={false} onCardClick={vi.fn()} onSaveRates={onSaveRates} /></ConfirmProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Edit multipliers' }))
  const cell = screen.getByRole('button', { name: 'Edit Groceries on SavorOne' })
  fireEvent.click(cell)
  return { cell, onSaveRates }
}

describe('Polish L7 matrix editor', () => {
  it('focuses the picked multiplier, returns to the cell on Escape and confirms discard', async () => {
    const { cell } = editor()
    const input = screen.getByLabelText('Multiplier')
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: '4' } })
    expect(screen.getByText('1 cell changed')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(document.activeElement).toBe(cell)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    const question = screen.getByRole('alertdialog', { name: 'Discard 1 changed cell?' })
    fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }))
    expect((screen.getByLabelText('Multiplier') as HTMLInputElement).value).toBe('4')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard changes' }))
    await screen.findByRole('button', { name: 'Edit multipliers' })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit multipliers' })))
  })

  it('applies on Enter, keeps save failures in the bar and clears them on edit', async () => {
    const { cell, onSaveRates } = editor(vi.fn().mockRejectedValue(new Error('Could not save multipliers')))
    const input = screen.getByLabelText('Multiplier')
    fireEvent.change(input, { target: { value: '4' } })
    fireEvent.submit(input.closest('form')!)
    expect(document.activeElement).toBe(cell)
    fireEvent.click(screen.getByRole('button', { name: 'Save multipliers' }))
    const error = await screen.findByText('Could not save multipliers')
    expect(error.closest('.mx-editor-bar')).toBeTruthy()
    expect(onSaveRates).toHaveBeenCalledWith([{ card_id: 1, category_id: 1, multiplier: '4', note: null, monthly_cap: null }])
    fireEvent.change(input, { target: { value: '5' } })
    expect(screen.queryByText('Could not save multipliers')).toBeNull()
  })
})

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
