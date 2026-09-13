import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MonthReview } from '../../api/monthReview'
import { ApiError } from '../../api/client'
import HistoricalReview from './HistoricalReview'

const mocks = vi.hoisted(() => ({ list: vi.fn(), close: vi.fn() }))
vi.mock('../../api/monthReview', async original => ({ ...(await original<typeof import('../../api/monthReview')>()), fetchMonthReviews: mocks.list, batchCloseMonths: mocks.close }))
const review: MonthReview = { month: '2025-06-01', state: 'unreviewed_history', input_revision: 'original', reviewed: { balances: false, spending: false, take_home: false }, coverage: { balances: true, spending: true, take_home: true, spending_nonzero: true, missing_account_ids: [], missing_category_ids: [] }, can_close: false, blockers: [], eligible_spending: true, eligible_savings: true, legacy_eligible: true, closed_at: null, closed_by: null, source_link: '/update?month=2025-06-01' }
beforeEach(() => { mocks.list.mockResolvedValue({ months: [review] }); mocks.close.mockResolvedValue({ months: [{ ...review, state: 'closed' }] }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })
function renderCard(coverage?: Parameters<typeof HistoricalReview>[0]['coverage']) {
  const onChanged = vi.fn()
  render(<MemoryRouter><HistoricalReview onChanged={onChanged} coverage={coverage} /></MemoryRouter>)
  return onChanged
}
async function open(coverage?: Parameters<typeof HistoricalReview>[0]['coverage']) {
  const onChanged = renderCard(coverage)
  fireEvent.click(screen.getByRole('button', { name: 'Load history' }))
  await screen.findByRole('button', { name: 'Refresh history' })
  return onChanged
}
it('is a card with an eyebrow and a summary drawn from coverage before anything is loaded', () => {
  renderCard({ balances: [], spending: [], net_pay: [], review_months: [review, { ...review, month: '2025-07-01' }, { ...review, month: '2025-08-01', state: 'in_progress' }, { ...review, month: '2025-05-01', state: 'closed' }] })
  const card = screen.getByRole('heading', { name: 'Review historical months' }).closest('.card') as HTMLElement
  expect(card).not.toBeNull()
  expect(card.classList.contains('panel')).toBe(false)
  expect(within(card).getByText('2 months entered before month review existed · 1 month not yet closed.')).toBeTruthy()
  expect(mocks.list).not.toHaveBeenCalled()
  expect(within(card).getByRole('button', { name: 'Close selected months' })).toBeTruthy()
})
it('groups the loaded months by year, selects a year’s eligible rows at once, and names a disabled row’s missing feed', async () => {
  mocks.list.mockResolvedValue({ months: [
    { ...review, month: '2024-11-01' },
    { ...review, month: '2025-06-01' },
    { ...review, month: '2025-07-01', coverage: { ...review.coverage, take_home: false } },
  ] })
  await open()
  expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['2025', '2024'])
  const year2025 = screen.getByRole('heading', { name: '2025' }).closest('.history-review-year') as HTMLElement
  expect(within(year2025).getByText(/missing take-home/)).toBeTruthy()
  expect((within(year2025).getAllByRole('checkbox')[1] as HTMLInputElement).disabled).toBe(true)
  fireEvent.click(within(year2025).getByRole('button', { name: 'Select all eligible' }))
  expect((within(year2025).getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true)
  expect((within(year2025).getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(false)
  expect(screen.getByRole('button', { name: 'Close selected months (1)' })).toBeTruthy()
})
it('requires a confirmation for the exact selected historical set and clears it when the selection changes', async () => {
  mocks.list.mockResolvedValue({ months: [review, { ...review, month: '2025-07-01' }] })
  const onChanged = await open()
  const boxes = screen.getAllByRole('checkbox')
  fireEvent.click(boxes[0])
  fireEvent.click(screen.getByLabelText(/I checked balances/))
  fireEvent.click(boxes[1])
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Close selected months (2)' }).disabled).toBe(true)
  fireEvent.click(screen.getByLabelText(/I checked balances/))
  fireEvent.click(screen.getByRole('button', { name: 'Close selected months (2)' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
  expect(mocks.close).toHaveBeenCalledWith([{ month: '2025-06-01', expected_revision: 'original' }, { month: '2025-07-01', expected_revision: 'original' }])
})
it('retains the selection on a conflict and offers refresh to obtain a new revision before reconfirming', async () => {
  mocks.close.mockRejectedValue(new ApiError('A selected month changed.', 409))
  await open()
  fireEvent.click(screen.getAllByRole('checkbox')[0])
  fireEvent.click(screen.getByLabelText(/I checked balances/))
  fireEvent.click(screen.getByRole('button', { name: 'Close selected months (1)' }))
  await screen.findByText(/A selected month changed/)
  expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true)
  mocks.list.mockResolvedValue({ months: [{ ...review, input_revision: 'changed' }] })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refresh history' })))
  expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(false)
  expect(screen.queryByLabelText(/I checked balances/)).toBeNull()
})
