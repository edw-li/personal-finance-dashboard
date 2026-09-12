import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
async function open() {
  const onChanged = vi.fn()
  render(<MemoryRouter><HistoricalReview onChanged={onChanged} /></MemoryRouter>)
  fireEvent.click(screen.getByText('Review historical months'))
  await screen.findByRole('button', { name: 'Refresh history' })
  return onChanged
}
it('requires a confirmation for the exact selected historical set and clears it when the selection changes', async () => {
  mocks.list.mockResolvedValue({ months: [review, { ...review, month: '2025-07-01' }] })
  const onChanged = await open()
  const boxes = screen.getAllByRole('checkbox')
  fireEvent.click(boxes[0])
  fireEvent.click(screen.getByLabelText(/I checked balances/))
  fireEvent.click(boxes[1])
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Close 2 reviewed months' }).disabled).toBe(true)
  fireEvent.click(screen.getByLabelText(/I checked balances/))
  fireEvent.click(screen.getByRole('button', { name: 'Close 2 reviewed months' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
  expect(mocks.close).toHaveBeenCalledWith([{ month: '2025-06-01', expected_revision: 'original' }, { month: '2025-07-01', expected_revision: 'original' }])
})
it('retains the selection on a conflict and offers refresh to obtain a new revision before reconfirming', async () => {
  mocks.close.mockRejectedValue(new ApiError('A selected month changed.', 409))
  await open()
  fireEvent.click(screen.getAllByRole('checkbox')[0])
  fireEvent.click(screen.getByLabelText(/I checked balances/))
  fireEvent.click(screen.getByRole('button', { name: 'Close 1 reviewed months' }))
  await screen.findByText(/A selected month changed/)
  expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true)
  mocks.list.mockResolvedValue({ months: [{ ...review, input_revision: 'changed' }] })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refresh history' })))
  expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(false)
  expect(screen.queryByLabelText(/I checked balances/)).toBeNull()
})
