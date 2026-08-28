import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { LimitsOut } from '../../types/api'
import ToastProvider from '../ToastProvider'
import LimitsCard from './LimitsCard'

vi.mock('../../api/limits', () => ({
  fetchLimits: vi.fn(),
  putLimits: vi.fn(),
  cloneLimits: vi.fn(),
}))
import { cloneLimits, fetchLimits, putLimits } from '../../api/limits'

const YEAR = new Date().getFullYear()

// A promise this file settles by hand — the only way to look at the card while a write is
// still in flight (TaxesPage.test.tsx's helper).
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const chip = (year: number) =>
  screen.getByRole('button', { name: String(year) }) as HTMLButtonElement

function payload(year: number, values: Record<string, string | null> = {}): LimitsOut {
  return {
    year,
    items: [
      { key: 'limit_401k_elective', label: '401(k) elective deferral', value: null },
      { key: 'limit_415c_total', label: '415(c) total additions', value: null },
      { key: 'limit_hsa_self', label: 'HSA — self-only', value: null },
      { key: 'limit_hsa_family', label: 'HSA — family', value: null },
      { key: 'limit_espp_423', label: 'ESPP §423 annual', value: null },
    ].map((item) => ({ ...item, value: values[item.key] ?? item.value })),
  }
}

beforeEach(() => {
  vi.mocked(fetchLimits).mockResolvedValue(payload(YEAR, { limit_401k_elective: '24500.00' }))
  vi.mocked(putLimits).mockResolvedValue(payload(YEAR, { limit_401k_elective: '24000.00' }))
  vi.mocked(cloneLimits).mockResolvedValue(payload(YEAR, { limit_hsa_self: '4400.00' }))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('opens on the current year and seeds the boxes from the response', async () => {
  render(<LimitsCard />)

  await waitFor(() => expect(vi.mocked(fetchLimits)).toHaveBeenCalledWith(YEAR))
  const box = (await screen.findByLabelText('401(k) elective deferral')) as HTMLInputElement
  // AmountInput's blurred money echo — the stored 24500.00 in the house's currency
  // grammar, the same box every other dollar field on the app uses.
  expect(box.value).toBe('$24,500.00')
  // An unentered cap is an EMPTY box, never a zero.
  expect((screen.getByLabelText('ESPP §423 annual') as HTMLInputElement).value).toBe('')
})

it('refetches when another year chip is pressed', async () => {
  render(<LimitsCard />)
  await screen.findByLabelText('401(k) elective deferral')

  fireEvent.click(screen.getByRole('button', { name: String(YEAR + 1) }))

  await waitFor(() => expect(vi.mocked(fetchLimits)).toHaveBeenCalledWith(YEAR + 1))
})

it('saves every box in one PUT, with blanks as explicit nulls', async () => {
  render(<LimitsCard />)
  await screen.findByLabelText('401(k) elective deferral')

  fireEvent.change(screen.getByLabelText('401(k) elective deferral'), {
    target: { value: '24000' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save limits' }))

  await waitFor(() => expect(vi.mocked(putLimits)).toHaveBeenCalledTimes(1))
  expect(vi.mocked(putLimits).mock.calls[0]).toEqual([
    YEAR,
    {
      values: {
        limit_401k_elective: '24000',
        limit_415c_total: null,
        limit_hsa_self: null,
        limit_hsa_family: null,
        limit_espp_423: null,
      },
    },
  ])
})

it('re-seeds the boxes from the PUT response, not from what was typed', async () => {
  // The response deliberately holds a DIFFERENT figure from the typed one. A server echo
  // of "24000.00" against a typed "24000" renders identically through AmountInput, so an
  // assertion on that number would pass just as happily on a card that never re-seeded.
  vi.mocked(putLimits).mockResolvedValue(payload(YEAR, { limit_401k_elective: '24111.00' }))
  render(<LimitsCard />)
  await screen.findByLabelText('401(k) elective deferral')

  fireEvent.change(screen.getByLabelText('401(k) elective deferral'), {
    target: { value: '24000' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save limits' }))

  await waitFor(() =>
    expect((screen.getByLabelText('401(k) elective deferral') as HTMLInputElement).value).toBe(
      '$24,111.00',
    ),
  )
  expect(screen.getByText('Saved.')).toBeTruthy()
})

it('freezes the year chips while a save is in flight', async () => {
  const put = deferred<LimitsOut>()
  vi.mocked(putLimits).mockReturnValue(put.promise)
  render(<LimitsCard />)
  await screen.findByLabelText('401(k) elective deferral')

  fireEvent.click(screen.getByRole('button', { name: 'Save limits' }))

  // A chip pressed here would refetch the new year AND then let the in-flight PUT's echo
  // re-seed on top of it — this year's numbers standing under next year's heading.
  await waitFor(() => expect(chip(YEAR + 1).disabled).toBe(true))
  expect(chip(YEAR - 1).disabled).toBe(true)
  expect(chip(YEAR).disabled).toBe(true)

  await act(async () => {
    put.resolve(payload(YEAR, { limit_401k_elective: '24000.00' }))
  })

  await waitFor(() => expect(chip(YEAR + 1).disabled).toBe(false))
  expect(chip(YEAR - 1).disabled).toBe(false)
  expect(chip(YEAR).disabled).toBe(false)
  expect(vi.mocked(fetchLimits)).toHaveBeenCalledTimes(1)
})

it('clones from the prior year and shows the cloned values', async () => {
  render(<LimitsCard />)
  await screen.findByLabelText('401(k) elective deferral')

  fireEvent.click(screen.getByRole('button', { name: `Clone from ${YEAR - 1}` }))

  await waitFor(() => expect(vi.mocked(cloneLimits)).toHaveBeenCalledWith(YEAR, YEAR - 1))
  await waitFor(() =>
    expect((screen.getByLabelText('HSA — self-only') as HTMLInputElement).value).toBe('$4,400.00'),
  )
})

it('surfaces a 409 clone as a toast and leaves the boxes alone', async () => {
  vi.mocked(cloneLimits).mockRejectedValue(
    new ApiError(`${YEAR} already has 2 contribution limits`, 409),
  )
  render(
    <ToastProvider>
      <LimitsCard />
    </ToastProvider>,
  )
  await screen.findByLabelText('401(k) elective deferral')

  fireEvent.click(screen.getByRole('button', { name: `Clone from ${YEAR - 1}` }))

  const toast = await screen.findByText(`${YEAR} already has 2 contribution limits`)
  expect(toast.className).toBe('toast-message')
  expect((screen.getByLabelText('401(k) elective deferral') as HTMLInputElement).value).toBe(
    '$24,500.00',
  )
})

it('banners a save 422 verbatim', async () => {
  vi.mocked(putLimits).mockRejectedValue(new ApiError('limit_hsa_self must be positive', 422))
  render(<LimitsCard />)
  await screen.findByLabelText('401(k) elective deferral')

  fireEvent.click(screen.getByRole('button', { name: 'Save limits' }))

  expect(await screen.findByText('limit_hsa_self must be positive')).toBeTruthy()
})

it('banners a failed load and refetches on Retry', async () => {
  vi.mocked(fetchLimits)
    .mockRejectedValueOnce(new ApiError('limits unavailable', 503))
    .mockResolvedValue(payload(YEAR))
  render(<LimitsCard />)

  expect(await screen.findByText('limits unavailable')).toBeTruthy()
  expect(screen.queryByLabelText('401(k) elective deferral')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByLabelText('401(k) elective deferral')).toBeTruthy()
  expect(vi.mocked(fetchLimits)).toHaveBeenCalledTimes(2)
})

it('says the app ships no values of its own', async () => {
  render(<LimitsCard />)
  const card = within(await screen.findByRole('region', { name: 'Contribution limits' }))
  expect(card.getByText(/publishes new figures every year/i)).toBeTruthy()
})
