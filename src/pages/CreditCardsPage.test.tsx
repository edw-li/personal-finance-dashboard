import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CreditCardOut,
  RewardCategoryOut,
  RewardRateOut,
  SpendingMatrix,
} from '../types/api'
import { clearSnapshots, setSnapshot } from '../api/snapshotCache'
import CreditCardsPage from './CreditCardsPage'
import { expectInDocumentOrder } from '../testing/domOrder'

vi.mock('../api/creditCards', () => ({
  fetchCreditCards: vi.fn(),
  fetchRewardCategories: vi.fn(),
  fetchRewardRates: vi.fn(),
  putRewardRates: vi.fn(),
  createCreditCard: vi.fn(),
  updateCreditCard: vi.fn(),
  deleteCreditCard: vi.fn(),
  createCardCredit: vi.fn(),
  updateCardCredit: vi.fn(),
  deleteCardCredit: vi.fn(),
  createLimitEvent: vi.fn(),
  deleteLimitEvent: vi.fn(),
  createRewardCategory: vi.fn(),
  updateRewardCategory: vi.fn(),
  deleteRewardCategory: vi.fn(),
}))
vi.mock('../api/spending', () => ({ fetchCategories: vi.fn(), fetchMatrix: vi.fn() }))
vi.mock('../api/netWorth', () => ({
  fetchAccounts: vi.fn(),
  fetchSummary: vi.fn(),
  fetchMonthBalances: vi.fn(),
}))
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))
// ECharts never renders in jsdom (house law): the stub exposes the slices these tests
// pin — series names for the two chart cards — via data-* attributes.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
      ariaLabel,
      animateEntrance = true,
    }: {
      option: { series?: { name?: string }[] }
      ariaLabel?: string
      animateEntrance?: boolean
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'aria-label': ariaLabel,
        'data-series-names': (option.series ?? []).map((s) => s.name ?? '').join('|'),
        // A cached paint must render still (2026-08-27 spec §1).
        'data-animate': String(animateEntrance),
      }),
  }
})

import {
  createCreditCard,
  deleteCreditCard,
  fetchCreditCards,
  fetchRewardCategories,
  fetchRewardRates,
  putRewardRates,
  updateCardCredit,
  updateCreditCard,
  updateRewardCategory,
} from '../api/creditCards'
import { fetchHousehold } from '../api/household'
import { fetchAccounts, fetchMonthBalances, fetchSummary } from '../api/netWorth'
import { fetchCategories, fetchMatrix } from '../api/spending'
import ToastProvider from '../components/ToastProvider'

// --- fixtures: the valuation-flip scenario straight from the spec -----------------------
// VX: 2x miles @1.7¢ on Groceries (3.4%) — beats Savor's 3x cash (3.0%).
// Dining: Savor 3x vs RH 3x — a true tie; VX's 1x portal cell loses.

function vx(over: Partial<CreditCardOut> = {}): CreditCardOut {
  return {
    id: 1, name: 'Venture X', slug: 'venture-x', annual_fee: '395.00',
    rewards_currency: 'miles', point_value_cents: '1.7000', primary_holder: 'Ed',
    authorized_users: 'P2', opened_on: '2023-05-12', is_active: true, account_id: null,
    person_id: 1, notes: null, sort_order: 0,
    credits: [{ id: 11, label: '$300 travel credit', annual_value: '300.00', counts: true }],
    current_limit: '30000.00',
    limit_events: [
      { id: 21, effective_date: '2023-05-12', limit_amount: '20000.00', note: 'opened' },
      { id: 22, effective_date: '2026-01-15', limit_amount: '30000.00', note: null },
    ],
    ...over,
  }
}

const SAVOR: CreditCardOut = {
  id: 2, name: 'SavorOne', slug: 'savorone', annual_fee: '0.00', rewards_currency: 'cash',
  point_value_cents: '1.0000', primary_holder: 'Ed', authorized_users: null, opened_on: null,
  is_active: true, account_id: null, person_id: 1, notes: null, sort_order: 1, credits: [],
  current_limit: '10000.00',
  limit_events: [{ id: 23, effective_date: '2024-02-01', limit_amount: '10000.00', note: null }],
}

const RH: CreditCardOut = {
  id: 3, name: 'RH Gold', slug: 'rh-gold', annual_fee: '0.00', rewards_currency: 'cash',
  point_value_cents: '1.0000', primary_holder: 'Ed', authorized_users: null, opened_on: null,
  is_active: true, account_id: null, person_id: 2, notes: null, sort_order: 2, credits: [],
  current_limit: null, limit_events: [],
}

const CATEGORIES: RewardCategoryOut[] = [
  { id: 10, name: 'Groceries', slug: 'groceries', sort_order: 0, is_active: true,
    annual_spend: '7800.00', spending_category_id: null, pinned_card_id: null },
  { id: 11, name: 'Dining', slug: 'dining', sort_order: 1, is_active: true,
    annual_spend: '6000.00', spending_category_id: null, pinned_card_id: null },
  { id: 12, name: 'Rent', slug: 'rent', sort_order: 2, is_active: true,
    annual_spend: null, spending_category_id: null, pinned_card_id: null },
]

const RATES: RewardRateOut[] = [
  { id: 31, card_id: 1, category_id: 10, multiplier: '2.00', note: null, monthly_cap: null },
  { id: 32, card_id: 2, category_id: 10, multiplier: '3.00', note: null, monthly_cap: null },
  { id: 33, card_id: 2, category_id: 11, multiplier: '3.00', note: null, monthly_cap: null },
  { id: 34, card_id: 3, category_id: 11, multiplier: '3.00', note: null, monthly_cap: null },
  { id: 35, card_id: 1, category_id: 11, multiplier: '1.00', note: 'portal', monthly_cap: null },
]

const EMPTY_MATRIX = {
  months: [], categories: [], series: [], totals: [], net_pay: [], savings_rate: [],
  four_pct_rule: [], total_budget: [],
} as unknown as SpendingMatrix

const PEOPLE = [
  { id: 1, name: 'Ed', is_primary: true },
  { id: 2, name: 'Sam', is_primary: false },
]

function seedHappyPath() {
  vi.mocked(fetchCreditCards).mockResolvedValue([vx(), SAVOR, RH])
  vi.mocked(fetchRewardCategories).mockResolvedValue(CATEGORIES)
  vi.mocked(fetchRewardRates).mockResolvedValue(RATES)
  vi.mocked(fetchCategories).mockResolvedValue([])
  vi.mocked(fetchMatrix).mockResolvedValue(EMPTY_MATRIX)
  vi.mocked(fetchAccounts).mockResolvedValue([])
  vi.mocked(fetchHousehold).mockResolvedValue({ people: PEOPLE, marriage_date: null })
  vi.mocked(fetchSummary).mockResolvedValue({
    month: null, net_worth: null, mom_delta: null, mom_pct: null, groups: [], owner_totals: [],
  })
  vi.mocked(fetchMonthBalances).mockResolvedValue({
    month: '2026-08-01', exists: false, recorded_on: null, notes: null, balances: [],
  })
}

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>
}

function renderPage(entry = '/credit-cards') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <CreditCardsPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

/** The matrix row <tr> whose first cell starts with the category name. */
function matrixRow(name: string): HTMLElement {
  const cell = screen
    .getAllByRole('cell')
    .find((td) => td.textContent?.startsWith(name) && td.closest('.rewards-matrix'))
  if (!cell) throw new Error(`no matrix row for ${name}`)
  return cell.closest('tr') as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  clearSnapshots()
  seedHappyPath()
})

/** The six-fetch payload the page stores under its snapshot key. */
function snapshotFixture(cards: CreditCardOut[] = [vx(), SAVOR, RH]) {
  return {
    cards,
    categories: CATEGORIES,
    rates: RATES,
    spendingCategories: [],
    matrix: EMPTY_MATRIX,
    accounts: [],
  }
}
afterEach(cleanup)

describe('CreditCardsPage', () => {
  it('defaults to the multiplier view with green driven by effective return', async () => {
    renderPage()
    await screen.findByText('Rewards matrix — best card per category')
    const groceries = matrixRow('Groceries')
    const cells = Array.from(groceries.querySelectorAll('td[data-best]'))
    // Multiplier view shows "2x"/"3x"; green sits on VX's 2x (3.4%), NOT Savor's 3x.
    expect(cells).toHaveLength(1)
    expect(cells[0].textContent).toContain('2x')
    expect(groceries.textContent).toContain('3x')
    // No jest-dom in this repo — assert attributes directly.
    expect(screen.getByRole('button', { name: 'Multiplier' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('the toggle switches every cell to effective % and back', async () => {
    renderPage()
    await screen.findByText('Rewards matrix — best card per category')
    fireEvent.click(screen.getByRole('button', { name: 'Effective %' }))
    const groceries = matrixRow('Groceries')
    // formatPct defaults to ONE decimal: '3.4%', never '3.40%'.
    expect(groceries.textContent).toContain('3.4%')
    expect(groceries.textContent).toContain('3.0%')
    fireEvent.click(screen.getByRole('button', { name: 'Multiplier' }))
    expect(matrixRow('Groceries').textContent).not.toContain('3.4%')
  })

  it('ties mark every co-best cell and badge them', async () => {
    renderPage()
    await screen.findByText('Rewards matrix — best card per category')
    const dining = matrixRow('Dining')
    expect(dining.querySelectorAll('td[data-best]')).toHaveLength(2)
    expect(dining.querySelectorAll('td[data-tie]')).toHaveLength(2)
    expect(dining.textContent).toContain('tie')
  })

  it('condition notes render the ⁺ marker with the note as its label', async () => {
    renderPage()
    await screen.findByText('Rewards matrix — best card per category')
    expect(screen.getByLabelText('portal')).toBeTruthy()
  })

  it('the footer allocates estimated $/yr and dashes unweighted categories out', async () => {
    renderPage()
    await screen.findByText('Est. $/yr won')
    // Groceries 7800×3.4% = 265.20 to VX; Dining 6000×3% = 180 to the tie winner
    // (equal $0 fees → wins 0=0 → name: 'RH Gold' < 'SavorOne'). Rent is unweighted.
    const footer = screen.getByText('Est. $/yr won').closest('tr') as HTMLElement
    expect(footer.textContent).toContain('$265.20')
    expect(footer.textContent).toContain('$180.00')
    const rent = matrixRow('Rent')
    expect(rent.textContent).toContain('no weight')
  })

  it('KPIs: total line, optimal, net after fees, count', async () => {
    renderPage()
    await screen.findByText('Total credit line')
    expect(screen.getByText('$40,000.00')).toBeTruthy() // 30k + 10k, RH has none
    expect(screen.getByText('$445.20/yr')).toBeTruthy() // 265.20 + 180
    expect(screen.getByText('$350.20/yr')).toBeTruthy() // 445.20 + 300 − 395
    expect(screen.getByText('Active cards')).toBeTruthy()
  })

  it('estimates are labeled as estimates', async () => {
    renderPage()
    await screen.findByText('Optimal rewards (est.)')
    expect(screen.getByText('Net after fees (est.)')).toBeTruthy()
    expect(screen.getByText('Is each card worth keeping? (est.)')).toBeTruthy()
  })

  it('names the unweighted rows the droppable verdict leaves out', async () => {
    renderPage()
    // RH Gold only ties Dining → $0 marginal → droppable; Rent has no weight.
    const note = await screen.findByText(/Droppable on these numbers/)
    expect(note.textContent).toContain('RH Gold')
    expect(note.textContent).toContain('Excludes 1 unweighted category')
  })

  it('with no weighted categories the page explains setup instead of declaring cards droppable', async () => {
    // Production on 2026-09-03: every reward category unmapped and unweighted, so the
    // optimizer valued every card at $0 and called five of six "droppable".
    vi.mocked(fetchRewardCategories).mockResolvedValue(
      CATEGORIES.map((c) => ({ ...c, annual_spend: null, spending_category_id: null })),
    )
    renderPage()
    await screen.findByText('Est. $/yr won')

    expect(screen.queryByText(/Droppable on these numbers/)).toBeNull()
    const setup = screen.getByText(/No spend weights yet/)
    expect(setup.textContent).toContain('Categories & weights')
    // The two $ tiles have nothing honest to say: a dash, not "$0.00/yr".
    const optimal = screen.getByText('Optimal rewards (est.)').closest('.stat-tile') as HTMLElement
    expect(optimal.querySelector('.stat-value')?.textContent).toBe('—')
    const net = screen.getByText('Net after fees (est.)').closest('.stat-tile') as HTMLElement
    expect(net.querySelector('.stat-value')?.textContent).toBe('—')
    // The matrix itself still renders — the green set needs no weights.
    expect(matrixRow('Groceries').textContent).toContain('no weight')
  })

  it('clicking a card column opens the drill-in and writes ?card=', async () => {
    renderPage()
    await screen.findByText('Rewards matrix — best card per category')
    fireEvent.click(screen.getByRole('button', { name: 'Open Venture X details' }))
    expect(screen.getByTestId('location').textContent).toBe('/credit-cards?card=venture-x')
    await screen.findByText('Worth keeping? (est.)')
    expect(screen.getByText('AF $395.00')).toBeTruthy()
    // Matrix is gone while drilled.
    expect(screen.queryByText('Est. $/yr won')).toBeNull()
  })

  it('?card= deep-link arrives drilled; closing returns and clears the URL', async () => {
    renderPage('/credit-cards?card=venture-x')
    await screen.findByText('Worth keeping? (est.)')
    fireEvent.click(screen.getByRole('button', { name: 'Back to the matrix' }))
    await screen.findByText('Rewards matrix — best card per category')
    expect(screen.getByTestId('location').textContent).toBe('/credit-cards')
  })

  it('a garbled ?card= slug falls back to the matrix view', async () => {
    renderPage('/credit-cards?card=nope')
    await screen.findByText('Rewards matrix — best card per category')
  })

  it('the drill-in spells the marginal breakdown', async () => {
    renderPage('/credit-cards?card=venture-x')
    await screen.findByText('Worth keeping? (est.)')
    // VX marginal: Groceries falls back to Savor 3% → 265.20−234 = 31.20; Dining
    // unchanged. Net = 31.20 + 300 − 395 = −63.80 → droppable phrasing shows.
    expect(screen.getByText(/\$31\.20 marginal/)).toBeTruthy()
    expect(screen.getByText(/droppable/)).toBeTruthy()
  })

  it('saving edited multipliers PUTs only changed cells and re-renders from the echo', async () => {
    vi.mocked(putRewardRates).mockResolvedValue([
      ...RATES.filter((r) => r.id !== 31),
      { id: 31, card_id: 1, category_id: 10, multiplier: '5.00', note: null, monthly_cap: null },
    ])
    renderPage()
    await screen.findByText('Rewards matrix — best card per category')
    fireEvent.click(screen.getByRole('button', { name: 'Edit multipliers' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Groceries on Venture X' }))
    const box = screen.getByLabelText('Multiplier') as HTMLInputElement
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: '5' } })
    fireEvent.blur(box)
    fireEvent.click(screen.getByRole('button', { name: 'Save multipliers' }))
    await waitFor(() => expect(putRewardRates).toHaveBeenCalledTimes(1))
    expect(vi.mocked(putRewardRates).mock.calls[0][0]).toEqual([
      { card_id: 1, category_id: 10, multiplier: '5', note: null, monthly_cap: null },
    ])
    await screen.findByText('5x')
  })

  it('roster edit preserves is_active and sort_order on the full-replace PATCH', async () => {
    // The full-replace risk (final review M1): an edit must never silently unarchive
    // a card or reset its ordering — those fields have no form boxes.
    vi.mocked(updateCreditCard).mockResolvedValue(vx())
    vi.mocked(fetchCreditCards).mockResolvedValue([
      vx({ is_active: false, sort_order: 7 }),
      SAVOR,
      RH,
    ])
    renderPage()
    await screen.findByText('Card roster')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Venture X' }))
    fireEvent.change(screen.getByLabelText('Card name'), { target: { value: 'Venture X Prime' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save card' }))
    await waitFor(() => expect(updateCreditCard).toHaveBeenCalledTimes(1))
    expect(vi.mocked(updateCreditCard).mock.calls[0]).toEqual([
      1,
      expect.objectContaining({ name: 'Venture X Prime', is_active: false, sort_order: 7 }),
    ])
  })

  it('roster add flow POSTs the full card body with defaults filled', async () => {
    vi.mocked(createCreditCard).mockResolvedValue(vx())
    renderPage()
    await screen.findByText('Card roster')
    fireEvent.change(screen.getByLabelText('Card name'), { target: { value: 'BILT' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add card' }))
    await waitFor(() => expect(createCreditCard).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createCreditCard).mock.calls[0][0]).toMatchObject({
      name: 'BILT',
      annual_fee: '0',
      rewards_currency: 'cash',
      point_value_cents: '1',
      is_active: true,
      sort_order: 0,
    })
  })

  it('toggling a credit\'s "counts" PATCHes the full credit body', async () => {
    vi.mocked(updateCardCredit).mockResolvedValue({
      id: 11, label: '$300 travel credit', annual_value: '300.00', counts: false,
    })
    renderPage('/credit-cards?card=venture-x')
    await screen.findByText('Worth keeping? (est.)')
    fireEvent.click(
      screen.getByRole('button', { name: '$300 travel credit counts toward the math' }),
    )
    await waitFor(() =>
      expect(updateCardCredit).toHaveBeenCalledWith(11, {
        label: '$300 travel credit',
        annual_value: '300.00',
        counts: false,
      }),
    )
  })

  it('reordering a category is optimistic and PATCHes only the rows that moved', async () => {
    vi.mocked(updateRewardCategory).mockResolvedValue(CATEGORIES[0])
    renderPage()
    await screen.findByText('Categories & weights')
    // Groceries (index 0) moves down one via the keyboard path of the drag handle.
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Reorder Groceries — drag, or arrow keys' }),
      { key: 'ArrowDown' },
    )
    // Optimistic: the list re-renders in the new order before any refetch lands.
    const handles = screen
      .getAllByRole('button', { name: /^Reorder / })
      .map((b) => b.getAttribute('aria-label'))
    expect(handles[0]).toBe('Reorder Dining — drag, or arrow keys')
    expect(handles[1]).toBe('Reorder Groceries — drag, or arrow keys')
    // Persistence: sort_order = index, and ONLY the two moved rows go on the wire
    // (Rent keeps sort_order 2 and is skipped).
    await waitFor(() => expect(updateRewardCategory).toHaveBeenCalledTimes(2))
    expect(vi.mocked(updateRewardCategory).mock.calls).toEqual([
      [11, { sort_order: 0 }],
      [10, { sort_order: 1 }],
    ])
    // Regression (live-check find): a SECOND move before any refetch must diff against
    // the just-persisted sort_orders, not the stale wire values — moving back writes
    // both rows again rather than silently no-oping.
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Reorder Groceries — drag, or arrow keys' }),
      { key: 'ArrowUp' },
    )
    await waitFor(() => expect(updateRewardCategory).toHaveBeenCalledTimes(4))
    expect(vi.mocked(updateRewardCategory).mock.calls.slice(2)).toEqual([
      [10, { sort_order: 0 }],
      [11, { sort_order: 1 }],
    ])
  })

  it('empty state: no categories → the seed button renders', async () => {
    vi.mocked(fetchCreditCards).mockResolvedValue([])
    vi.mocked(fetchRewardCategories).mockResolvedValue([])
    vi.mocked(fetchRewardRates).mockResolvedValue([])
    renderPage()
    await screen.findByText("Start with the spreadsheet's categories")
    expect(screen.getByText(/No cards yet/)).toBeTruthy()
  })

  it('credit line history draws per-card steps plus the total', async () => {
    renderPage()
    await screen.findByText('Credit line history')
    const charts = screen.getAllByTestId('echart')
    const line = charts.find((el) =>
      (el.getAttribute('data-series-names') ?? '').includes('Total line'),
    )
    expect(line).toBeTruthy()
    expect(line!.getAttribute('data-series-names')).toBe('Venture X|SavorOne|Total line')
  })

  it('inactive cards leave the matrix and the math', async () => {
    vi.mocked(fetchCreditCards).mockResolvedValue([vx({ is_active: false }), SAVOR, RH])
    renderPage()
    await screen.findByText('Rewards matrix — best card per category')
    expect(screen.queryByRole('button', { name: 'Open Venture X details' })).toBeNull()
    // With VX gone, Savor's 3x owns Groceries.
    const groceries = matrixRow('Groceries')
    expect(groceries.querySelectorAll('td[data-best]')).toHaveLength(1)
  })

  it('surfaces a load failure with Retry', async () => {
    vi.mocked(fetchCreditCards).mockRejectedValue(new Error('boom'))
    renderPage()
    await screen.findByRole('alert')
    expect(screen.getByText('Failed to load credit cards')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

describe('CreditCardsPage — snapshot cache (2026-08-27 spec §1)', () => {
  it('paints instantly from a seeded snapshot and still revalidates', () => {
    setSnapshot('credit-cards', snapshotFixture())
    // Never-resolving fetches: whatever is on screen came from the seed alone.
    vi.mocked(fetchCreditCards).mockReturnValue(new Promise(() => {}))
    vi.mocked(fetchRewardCategories).mockReturnValue(new Promise(() => {}))
    vi.mocked(fetchRewardRates).mockReturnValue(new Promise(() => {}))
    const { container } = renderPage()
    expect(screen.getByText('Rewards matrix — best card per category')).toBeTruthy()
    expect(matrixRow('Groceries')).toBeTruthy()
    expect(screen.queryByText(/Loading/)).toBeNull()
    // Revalidating under the house dim, and the request really went out.
    expect(container.querySelector('.loading-dim.is-loading')).not.toBeNull()
    expect(vi.mocked(fetchCreditCards)).toHaveBeenCalledTimes(1)
    // A cached paint renders its charts still.
    expect(
      screen.getAllByTestId('echart').every((el) => el.getAttribute('data-animate') === 'false'),
    ).toBe(true)
  })

  it('a changed revalidation payload updates the page and re-arms the charts', async () => {
    setSnapshot('credit-cards', snapshotFixture())
    vi.mocked(fetchCreditCards).mockResolvedValue([
      vx({ name: 'Venture X (renamed)' }),
      SAVOR,
      RH,
    ])
    const { container } = renderPage()
    expect(screen.getAllByText('Venture X').length).toBeGreaterThan(0)
    expect(await screen.findAllByText('Venture X (renamed)')).toBeTruthy()
    await waitFor(() =>
      expect(container.querySelector('.loading-dim.is-loading')).toBeNull(),
    )
    expect(
      screen.getAllByTestId('echart').every((el) => el.getAttribute('data-animate') === 'true'),
    ).toBe(true)
  })

  it('leaves the charts still when the revalidation payload is identical', async () => {
    setSnapshot('credit-cards', snapshotFixture())
    const { container } = renderPage()
    // The dim lifting is the revalidation landing — .finally runs on every resolution.
    await waitFor(() => expect(container.querySelector('.loading-dim.is-loading')).toBeNull())
    expect(
      screen.getAllByTestId('echart').every((el) => el.getAttribute('data-animate') === 'false'),
    ).toBe(true)
  })
})

describe('CreditCardsPage — card ownership', () => {
  it('shows the owner per row and defaults a NEW card to the primary person', async () => {
    renderPage()
    await screen.findByText('Card roster')
    const roster = document.querySelector('.roster-table') as HTMLElement
    const owners = Array.from(roster.querySelectorAll('tbody tr')).map(
      (tr) => tr.querySelectorAll('td')[1].textContent,
    )
    expect(owners).toEqual(['Ed', 'Ed', 'Sam'])
    // The fresh form follows the roster once /household lands — Joint must be a CHOICE.
    // `selector` disambiguates from the chips group, which is also labelled Owner.
    const select = screen.getByLabelText('Owner', { selector: 'select' }) as HTMLSelectElement
    expect(select.value).toBe('1')
  })

  it('sends person_id on create and leaves primary_holder alone', async () => {
    vi.mocked(createCreditCard).mockResolvedValue(vx())
    renderPage()
    await screen.findByText('Card roster')
    fireEvent.change(screen.getByLabelText('Card name'), { target: { value: 'Blue Cash' } })
    fireEvent.change(screen.getByLabelText('Owner', { selector: 'select' }), {
      target: { value: '2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add card' }))
    await waitFor(() => expect(createCreditCard).toHaveBeenCalled())
    const body = vi.mocked(createCreditCard).mock.calls[0][0]
    expect(body.person_id).toBe(2)
    // The form has no holder box any more; a new card simply has no embossed name yet.
    expect(body.primary_holder).toBeNull()
  })

  it('ARCHIVE rebuilds the whole card verbatim — person_id must survive', async () => {
    vi.mocked(updateCreditCard).mockResolvedValue(RH)
    renderPage()
    await screen.findByText('Card roster')
    fireEvent.click(screen.getByRole('button', { name: 'Archive RH Gold' }))
    await waitFor(() => expect(updateCreditCard).toHaveBeenCalled())
    const [id, body] = vi.mocked(updateCreditCard).mock.calls[0]
    expect(id).toBe(3)
    expect(body.is_active).toBe(false)
    // The audit's §3.6 hazard, pinned: a column missing from this rebuild silently CLEARS
    // — and a cleared person_id reads as "joint", which is a different card.
    expect(body.person_id).toBe(2)
    expect(body.primary_holder).toBe('Ed')
  })

  it('UNDO after delete re-POSTs the card verbatim — person_id must survive', async () => {
    vi.mocked(deleteCreditCard).mockResolvedValue(undefined)
    vi.mocked(createCreditCard).mockResolvedValue(RH)
    render(
      <MemoryRouter initialEntries={['/credit-cards']}>
        <ToastProvider>
          <CreditCardsPage />
        </ToastProvider>
      </MemoryRouter>,
    )
    await screen.findByText('Card roster')
    fireEvent.click(screen.getByRole('button', { name: 'Delete RH Gold' }))
    const undo = await screen.findByRole('button', { name: 'Undo' })
    fireEvent.click(undo)
    await waitFor(() => expect(createCreditCard).toHaveBeenCalled())
    expect(vi.mocked(createCreditCard).mock.calls[0][0].person_id).toBe(2)
  })
})

describe('CreditCardsPage — owner chips and the household advantage', () => {
  it('scopes the matrix, the KPIs and the credit line to the chosen owner — never the roster', async () => {
    renderPage()
    await screen.findByText('Rewards matrix — best card per category')
    // All: three cards in the matrix header, and the KPI count agrees.
    expect(screen.getByRole('button', { name: 'Open RH Gold details' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Sam' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Open SavorOne details' })).toBeNull(),
    )
    // Sam's scope = Sam's cards ∪ the joint ones. Nothing here is joint, so only RH Gold.
    expect(screen.getByRole('button', { name: 'Open RH Gold details' })).toBeTruthy()
    const activeTile = screen
      .getAllByText('Active cards')[0]
      .closest('.stat-tile') as HTMLElement
    expect(activeTile.querySelector('.stat-value')?.textContent).toBe('1')
    // The credit-line chart only has series for cards in scope (RH Gold has no events at
    // all, so the card falls back to its empty note).
    expect(screen.getByText(/No limit history yet/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Joint' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Open RH Gold details' })).toBeNull(),
    )
  })

  it('hides the chips entirely for a one-person household', async () => {
    vi.mocked(fetchHousehold).mockResolvedValue({
      people: [{ id: 1, name: 'Ed', is_primary: true }],
      marriage_date: null,
    })
    renderPage()
    await screen.findByText('Card roster')
    expect(screen.queryByRole('group', { name: 'Owner' })).toBeNull()
  })

  it('badges each matrix column with its owner', async () => {
    renderPage()
    const header = await screen.findByRole('button', { name: 'Open RH Gold details' })
    expect(header.textContent).toContain('Sam')
    const joint = await screen.findByRole('button', { name: 'Open Venture X details' })
    expect(joint.textContent).toContain('Ed')
  })

  it('shows the advantage tile only when merging genuinely wins', async () => {
    renderPage()
    await screen.findByText('Card roster')
    // The fixture: Ed holds VX + SavorOne, Sam holds RH Gold (3x Dining, no fee). Ed alone
    // already wins Dining with SavorOne's 3x, so RH Gold adds nothing — no tile.
    expect(screen.queryByText('Household wallet advantage')).toBeNull()

    cleanup()
    // Give Sam a card that wins a category nobody else can: 5x Groceries at 1¢ = 5%.
    const winner: CreditCardOut = { ...RH, id: 4, name: 'Sam Grocery', slug: 'sam-grocery' }
    vi.mocked(fetchCreditCards).mockResolvedValue([vx(), SAVOR, winner])
    vi.mocked(fetchRewardRates).mockResolvedValue([
      ...RATES,
      { id: 36, card_id: 4, category_id: 10, multiplier: '5.00', note: null, monthly_cap: null },
    ])
    renderPage()
    await screen.findByText('Card roster')
    const tile = (await screen.findByText('Household wallet advantage')).closest(
      '.stat-tile',
    ) as HTMLElement
    // Hand-checked against the fixture. Groceries weighs 7,800 and Dining 6,000; VX is
    // 2x @1.7¢ (3.4%) with a $300 counted credit and a $395 fee, SavorOne 3x @1¢, Sam
    // Grocery 5x @1¢. RATES' card_id 3 cell is inert here — RH Gold is not in this lineup.
    //   household {VX, Savor, Sam}: 390 (Sam wins Groceries) + 180 (Savor wins Dining)
    //                               = 570, +300 credit −395 fee = 475
    //   Ed's wallet {VX, Savor}:     265.20 + 180 = 445.20, +300 −395 = 350.20
    //   Sam's wallet {Sam Grocery}:  390 + 0 = 390, no credit, no fee = 390
    // The BEST single wallet is SAM's, not Ed's — a fee-free card that wins outright beats
    // a wallet whose $395 fee eats its lead. So the merge is worth 475 − 390 = $85.00/yr.
    expect(tile.querySelector('.stat-value')?.textContent).toBe('$85.00/yr')
    expect(tile.textContent).toContain('beats the best single wallet')
  })
})

describe('CreditCardsPage — section order (2026-08-31 audit)', () => {
  it('consult before manage: matrix, worth-keeping, line history, then the CRUD panels', async () => {
    seedHappyPath()
    renderPage()
    const matrix = await screen.findByRole('heading', { name: /Rewards matrix/ })
    const value = screen.getByRole('heading', { name: /worth keeping/i })
    const line = screen.getByRole('heading', { name: /Credit line history/ })
    const roster = screen.getByRole('heading', { name: /Card roster/ })
    const categories = screen.getByRole('heading', { name: /Categories & weights/ })
    expectInDocumentOrder(matrix, value, line, roster, categories)
  })
})
