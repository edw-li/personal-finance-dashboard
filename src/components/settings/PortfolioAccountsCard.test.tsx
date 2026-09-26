import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { fetchPortfolioAccounts, patchPortfolioAccount } from '../../api/portfolio'
import PortfolioAccountsCard from './PortfolioAccountsCard'

vi.mock('../../api/portfolio', () => ({ fetchPortfolioAccounts: vi.fn(), patchPortfolioAccount: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('owns an independent portfolio feed and sends an explicit null for joint', async () => {
  vi.mocked(fetchPortfolioAccounts).mockResolvedValue([{ id: 7, label: 'Brokerage', person_id: 1 }])
  vi.mocked(patchPortfolioAccount).mockResolvedValue({ id: 7, label: 'Brokerage', person_id: null })
  render(<PortfolioAccountsCard people={[{ id: 1, name: 'Me', is_primary: true }]} />)
  const owner = await screen.findByLabelText('Owner for Brokerage')
  expect(owner.closest('section')?.classList.contains('span-8')).toBe(true)
  fireEvent.change(owner, { target: { value: '' } })
  await waitFor(() => expect(patchPortfolioAccount).toHaveBeenCalledWith(7, { person_id: null }))
})
