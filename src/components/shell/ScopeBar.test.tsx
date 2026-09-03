import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/household', () => ({ fetchHousehold: vi.fn() }))
vi.mock('../../api/coverage', () => ({ fetchCoverage: vi.fn() }))
import { fetchCoverage } from '../../api/coverage'
import { fetchHousehold } from '../../api/household'
import { clearSnapshots, getSnapshot, setSnapshot } from '../../api/snapshotCache'
import ScopeBar, { HOUSEHOLD_SNAPSHOT } from './ScopeBar'

function Url() {
  const l = useLocation()
  return <span data-testid="url">{l.pathname + l.search}</span>
}

function tree(props: Parameters<typeof ScopeBar>[0], entry: string) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="*" element={<><ScopeBar {...props} /><Url /></>} />
      </Routes>
    </MemoryRouter>
  )
}

function mount(props: Parameters<typeof ScopeBar>[0], entry = '/net-worth') {
  const result = render(tree(props, entry))
  return {
    ...result,
    /** Re-render the same page with new ScopeBar props (the wizard bumping `revalidate`). */
    rescope: (next: Parameters<typeof ScopeBar>[0]) => result.rerender(tree(next, entry)),
  }
}

// The primary is deliberately the HIGHER id, so a household that comes back in id order still
// has to be re-sorted primary-first for the chips to read Edward, Grace.
const HOUSEHOLD = {
  people: [{ id: 1, name: 'Grace', is_primary: false }, { id: 2, name: 'Edward', is_primary: true }],
  marriage_date: null,
}

const ALONE = { people: [{ id: 2, name: 'Edward', is_primary: true }], marriage_date: null }

// A page's own sentence about what "whose" means there — the bar prints it, it does not own it.
const OWNER_HINT = "A person's view is their own accounts plus the joint ones."

beforeEach(() => {
  localStorage.clear()
  clearSnapshots()
  vi.mocked(fetchHousehold).mockResolvedValue(HOUSEHOLD)
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
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/net-worth?owner=1'))
  })

  it('hides Joint when asked', async () => {
    mount({ owner: { joint: false } })
    await screen.findByRole('button', { name: 'Grace' })
    expect(screen.queryByRole('button', { name: 'Joint' })).toBeNull()
  })

  it('paints the seeded household, then swaps in the revalidated one and writes it back', async () => {
    setSnapshot(HOUSEHOLD_SNAPSHOT, HOUSEHOLD)
    const alone = { people: [{ id: 2, name: 'Edward', is_primary: true }], marriage_date: null }
    vi.mocked(fetchHousehold).mockResolvedValue(alone)
    mount({ owner: true })
    // Seeded: the chips are there in the first paint, before any fetch resolves.
    expect(screen.getByRole('group', { name: 'Whose' })).toBeTruthy()
    // Revalidated: one person is no choice at all, so the whole control goes away...
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Whose' })).toBeNull())
    // ...and the fresh payload is written back, so the next page seeds from the truth.
    expect(getSnapshot(HOUSEHOLD_SNAPSHOT)).toEqual(alone)
  })

  it('keeps the seeded chips when the household fetch fails', async () => {
    setSnapshot(HOUSEHOLD_SNAPSHOT, HOUSEHOLD)
    vi.mocked(fetchHousehold).mockRejectedValue(new Error('offline'))
    mount({ owner: true })
    await waitFor(() => expect(fetchHousehold).toHaveBeenCalled())
    expect(screen.getByRole('group', { name: 'Whose' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Grace' })).toBeTruthy()
  })

  it('re-runs both fetches when the revalidate key changes', async () => {
    const props = (revalidate: number) => ({
      owner: true,
      month: { mode: 'view' as const, anchor: '2026-09-01' },
      revalidate,
    })
    const view = mount(props(0))
    await waitFor(() => expect(fetchHousehold).toHaveBeenCalledTimes(1))
    expect(fetchCoverage).toHaveBeenCalledTimes(1)
    view.rescope(props(1))
    await waitFor(() => expect(fetchCoverage).toHaveBeenCalledTimes(2))
    expect(fetchHousehold).toHaveBeenCalledTimes(2)
  })

  it('hides All when asked and shows a null scope as the primary person', async () => {
    mount({ owner: { joint: false, all: false } })
    await screen.findByRole('button', { name: 'Grace' })
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Joint' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edward' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Grace' }))
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/net-worth?owner=1'))
  })

  it('presses the first chip for an owner this page offers no chip for', async () => {
    // ?owner=joint on a page whose owner set has no Joint chip: without the fallback the group
    // would render with nothing pressed at all.
    mount({ owner: { joint: false } }, '/net-worth?owner=joint')
    await screen.findByRole('button', { name: 'Grace' })
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
  })

  it("prints the page's owner hint beside the chips, and only when the page sends one", async () => {
    const { container, rescope } = mount({ owner: true, ownerHint: OWNER_HINT })
    await screen.findByRole('button', { name: 'Grace' })
    // Beside the chips, not loose in the bar: the sentence explains THAT control.
    const hint = container.querySelector('.scope-bar-group button.info-hint')
    expect(hint).toBeTruthy()
    expect(hint?.getAttribute('aria-label')).toBe(OWNER_HINT)
    // Same chips, no sentence: pages that have nothing extra to say get no dangling glyph.
    rescope({ owner: true })
    expect(screen.getByRole('group', { name: 'Whose' })).toBeTruthy()
    expect(container.querySelector('button.info-hint')).toBeNull()
  })

  it('drops the owner hint with the chips for a one-person household', async () => {
    setSnapshot(HOUSEHOLD_SNAPSHOT, ALONE)
    vi.mocked(fetchHousehold).mockResolvedValue(ALONE)
    const { container } = mount({ owner: true, ownerHint: OWNER_HINT })
    await waitFor(() => expect(fetchHousehold).toHaveBeenCalled())
    // Nobody is asked whose view this is, so nobody is told what the answer would mean.
    expect(container.querySelector('.scope-bar')).toBeNull()
    expect(container.querySelector('button.info-hint')).toBeNull()
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

  it('month (view): no Back to latest without a month, nor on the latest covered one', async () => {
    mount({ month: { mode: 'view', anchor: '2026-09-01' } })
    // Sep has balances but no spending in the fixture; waiting on that label proves coverage landed.
    const sep = await screen.findByRole('button', { name: /^Sep 2026 — balances entered, spending missing/ })
    expect(screen.queryByRole('button', { name: 'Back to latest' })).toBeNull()
    fireEvent.click(sep)
    expect(screen.getByTestId('url').textContent).toBe('/net-worth?month=2026-09')
    expect(screen.queryByRole('button', { name: 'Back to latest' })).toBeNull()
  })

  it('month (view): the page\'s figures and Edit link reach the ribbon', async () => {
    mount(
      {
        month: {
          mode: 'view',
          anchor: '2026-09-01',
          editHref: (m) => `/update?month=${m}`,
          figures: { '2026-07-01': '$1.2M' },
        },
      },
      '/net-worth?month=2026-07',
    )
    const edit = await screen.findByRole('link', { name: /Edit Jul 2026/ })
    expect(edit.getAttribute('href')).toBe('/update?month=2026-07-01')
    expect(screen.getByRole('button', { name: /^Jul 2026 — \$1\.2M — / })).toBeTruthy()
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
