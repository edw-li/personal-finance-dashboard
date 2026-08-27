import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CreditCardOut,
  RewardCategoryOut,
  RewardRateOut,
  SpendingMatrix,
} from '../types/api'
import CreditCardsPage from './CreditCardsPage'

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
// ECharts never renders in jsdom (house law): the stub exposes the slices these tests
// pin — series names for the two chart cards — via data-* attributes.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
      ariaLabel,
    }: {
      option: { series?: { name?: string }[] }
      ariaLabel?: string
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'aria-label': ariaLabel,
        'data-series-names': (option.series ?? []).map((s) => s.name ?? '').join('|'),
      }),
  }
})

import {
  createCreditCard,
  fetchCreditCards,
  fetchRewardCategories,
  fetchRewardRates,
  putRewardRates,
  updateCardCredit,
  updateCreditCard,
  updateRewardCategory,
} from '../api/creditCards'
import { fetchAccounts, fetchMonthBalances, fetchSummary } from '../api/netWorth'
import { fetchCategories, fetchMatrix } from '../api/spending'

// --- fixtures: the valuation-flip scenario straight from the spec -----------------------
// VX: 2x miles @1.7¢ on Groceries (3.4%) — beats Savor's 3x cash (3.0%).
// Dining: Savor 3x vs RH 3x — a true tie; VX's 1x portal cell loses.

function vx(over: Partial<CreditCardOut> = {}): CreditCardOut {
  return {
    id: 1, name: 'Venture X', slug: 'venture-x', annual_fee: '395.00',
    rewards_currency: 'miles', point_value_cents: '1.7000', primary_holder: 'Ed',
    authorized_users: 'P2', opened_on: '2023-05-12', is_active: true, account_id: null,
    notes: null, sort_order: 0,
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
  is_active: true, account_id: null, notes: null, sort_order: 1, credits: [],
  current_limit: '10000.00',
  limit_events: [{ id: 23, effective_date: '2024-02-01', limit_amount: '10000.00', note: null }],
}

const RH: CreditCardOut = {
  id: 3, name: 'RH Gold', slug: 'rh-gold', annual_fee: '0.00', rewards_currency: 'cash',
  point_value_cents: '1.0000', primary_holder: 'Ed', authorized_users: null, opened_on: null,
  is_active: true, account_id: null, notes: null, sort_order: 2, credits: [],
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

function seedHappyPath() {
  vi.mocked(fetchCreditCards).mockResolvedValue([vx(), SAVOR, RH])
  vi.mocked(fetchRewardCategories).mockResolvedValue(CATEGORIES)
  vi.mocked(fetchRewardRates).mockResolvedValue(RATES)
  vi.mocked(fetchCategories).mockResolvedValue([])
  vi.mocked(fetchMatrix).mockResolvedValue(EMPTY_MATRIX)
  vi.mocked(fetchAccounts).mockResolvedValue([])
  vi.mocked(fetchSummary).mockResolvedValue({
    month: null, net_worth: null, mom_delta: null, mom_pct: null, groups: [],
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
  seedHappyPath()
})
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
