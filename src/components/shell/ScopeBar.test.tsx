import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/household', () => ({ fetchHousehold: vi.fn() }))
vi.mock('../../api/coverage', () => ({ fetchCoverage: vi.fn() }))
import { fetchCoverage } from '../../api/coverage'
import { fetchHousehold } from '../../api/household'
import { clearSnapshots } from '../../api/snapshotCache'
import ScopeBar from './ScopeBar'

function Url() {
  const l = useLocation()
  return <span data-testid="url">{l.pathname + l.search}</span>
}

function mount(props: Parameters<typeof ScopeBar>[0], entry = '/net-worth') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="*" element={<><ScopeBar {...props} /><Url /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  clearSnapshots()
  vi.mocked(fetchHousehold).mockResolvedValue({
    people: [{ id: 1, name: 'Edward', is_primary: true }, { id: 2, name: 'Grace', is_primary: false }],
    marriage_date: null,
  })
  vi.mocked(fetchCoverage).mockResolvedValue({
    balances: ['2026-07-01', '2026-08-01', '2026-09-01'],
    spending: ['2026-07-01'],
    net_pay: ['2026-07-01'],
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ScopeBar', () => {
  it('renders the owner chips only for a multi-person household, with Joint', async () => {
    mount({ owner: true })
    expect(await screen.findByRole('button', { name: 'Grace' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Joint' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Grace' }))
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/net-worth?owner=2'))
  })

  it('hides Joint when asked, and the whole owner control for one person', async () => {
    mount({ owner: { joint: false } })
    await screen.findByRole('button', { name: 'Grace' })
    expect(screen.queryByRole('button', { name: 'Joint' })).toBeNull()
    cleanup()
    vi.mocked(fetchHousehold).mockResolvedValue({ people: [{ id: 1, name: 'Edward', is_primary: true }], marriage_date: null })
    mount({ owner: true })
    await waitFor(() => expect(vi.mocked(fetchHousehold)).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('group', { name: 'Whose' })).toBeNull()
  })

  it('hides All when asked and shows a null scope as the primary person', async () => {
    mount({ owner: { joint: false, all: false } })
    await screen.findByRole('button', { name: 'Grace' })
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Joint' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edward' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Grace' }))
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/net-worth?owner=2'))
  })

  it('range chips write the URL and default to 1Y', () => {
    mount({ range: true })
    expect(screen.getByRole('button', { name: '1Y' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'YTD' }))
    expect(screen.getByTestId('url').textContent).toBe('/net-worth?range=ytd')
    expect(fetchHousehold).not.toHaveBeenCalled()
    expect(fetchCoverage).not.toHaveBeenCalled()
  })

  it('month (view): the ribbon selects into ?month= and Back to latest clears it', async () => {
    mount({ month: { mode: 'view', anchor: '2026-09-01', editHref: (m) => `/update?month=${m}` } })
    const july = await screen.findByRole('button', { name: /^Jul 2026 — balances and spending entered/ })
    fireEvent.click(july)
    expect(screen.getByTestId('url').textContent).toBe('/net-worth?month=2026-07')
    fireEvent.click(await screen.findByRole('button', { name: 'Back to latest' }))
    expect(screen.getByTestId('url').textContent).toBe('/net-worth')
  })

  it('month (edit): the ribbon navigates to the wizard', async () => {
    mount({ month: { mode: 'edit', anchor: '2026-09-01' } }, '/spending')
    fireEvent.click(await screen.findByRole('button', { name: /^Aug 2026/ }))
    expect(screen.getByTestId('url').textContent).toBe('/update?month=2026-08-01')
  })

  it('month (edit) with a page-owned handler: the wizard keeps the click and the selection', async () => {
    const onSelect = vi.fn()
    mount(
      { month: { mode: 'edit', anchor: '2026-09-01', selected: '2026-09-01', onSelect } },
      '/update?month=2026-09-01',
    )
    const aug = await screen.findByRole('button', { name: /^Aug 2026/ })
    expect(screen.getByRole('button', { name: /^Sep 2026/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(aug)
    expect(onSelect).toHaveBeenCalledWith('2026-08-01')
    expect(screen.getByTestId('url').textContent).toBe('/update?month=2026-09-01')
  })

  it('renders nothing at all when no control is declared', () => {
    const { container } = mount({})
    expect(container.querySelector('.scope-bar')).toBeNull()
  })
})
