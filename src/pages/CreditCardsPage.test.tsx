import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type {
  CreditCardOut,
  RewardCategoryOut,
  RewardRateOut,
  SpendingMatrix,
} from '../types/api'
import { ApiError, invalidateForMutation } from '../api/client'
import { clearSnapshots, getSnapshot, setSnapshot } from '../api/snapshotCache'
import CreditCardsPage from './CreditCardsPage'
import { INK, PALETTE } from '../charts/theme'
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
  // The two reorder PUTs (lane R1). Every reorder test answers them or leaves them pending.
  reorderCreditCards: vi.fn(),
  reorderRewardCategories: vi.fn(),
}))
vi.mock('../api/spending', () => ({ fetchCategories: vi.fn(), fetchMatrix: vi.fn() }))
vi.mock('../api/netWorth', () => ({
  fetchAccounts: vi.fn(),
  fetchSummary: vi.fn(),
  fetchMonthBalances: vi.fn(),
}))
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))
// ECharts never renders in jsdom (house law): the stub exposes the slices these tests
// pin — series names and colours for the two chart cards — via data-* attributes.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
      ariaLabel,
      animateEntrance = true,
    }: {
      option: { series?: { name?: string; color?: string }[] }
      ariaLabel?: string
      animateEntrance?: boolean
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'aria-label': ariaLabel,
        'data-series-names': (option.series ?? []).map((s) => s.name ?? '').join('|'),
        // The credit-line chart keys each colour to its card (2026-09-23 drag-to-reorder §7).
        'data-series-colors': (option.series ?? []).map((s) => s.color ?? '').join('|'),
        // A cached paint must render still (2026-08-27 spec §1).
        'data-animate': String(animateEntrance),
      }),
  }
})

import {
  createCardCredit,
  createCreditCard,
  createRewardCategory,
  deleteCreditCard,
  deleteRewardCategory,
  fetchCreditCards,
  fetchRewardCategories,
  fetchRewardRates,
  putRewardRates,
  reorderCreditCards,
  reorderRewardCategories,
  updateCardCredit,
  updateCreditCard,
  updateRewardCategory,
} from '../api/creditCards'
import { fetchHousehold } from '../api/household'
import { fetchAccounts, fetchMonthBalances, fetchSummary } from '../api/netWorth'
import { fetchCategories, fetchMatrix } from '../api/spending'
import ToastProvider from '../components/ToastProvider'
import CategoriesPanel from '../components/creditcards/CategoriesPanel'

// --- fixtures: the valuation-flip scenario straight from the spec -----------------------
// VX: 2x miles @1.7¢ on Groceries (3.4%) — beats Savor's 3x cash (3.0%).
// Dining: Savor 3x vs RH 3x — a true tie; VX's 1x portal cell loses.

function vx(over: Partial<CreditCardOut> = {}): CreditCardOut {
  return {
    id: 1, name: 'Venture X', slug: 'venture-x', annual_fee: '395.00',
    rewards_currency: 'miles', point_value_cents: '1.7000', primary_holder: 'Ed',
    authorized_users: 'P2', opened_on: '2023-05-12', is_active: true, account_id: null,
    person_id: 1, notes: null, sort_order: 0,
    credits: [
      { id: 11, label: '$300 travel credit', annual_value: '300.00', counts: true,
        reset_cadence: 'calendar' },
    ],
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

/** The drill-in's verdict: a labelled region (the tile, the reason and the closing line). */
const verdictRegion = () => screen.getByRole('region', { name: 'Verdict' })
/** Its "what closing would change" sentence. */
const closingLine = () => within(verdictRegion()).getByText(/^Closing it/)

/** The Categories & weights row for one category name (not the matrix's own table). */
function categoriesRow(name: string): HTMLElement {
  const row = Array.from(document.querySelectorAll('.categories-table tbody tr')).find((tr) =>
    Array.from(tr.querySelectorAll('td')).some((td) => td.textContent === name),
  )
  if (!row) throw new Error(`no categories row for ${name}`)
  return row as HTMLElement
}

/** The matrix row <tr> whose first cell starts with the category name. */
function matrixRow(name: string): HTMLElement {
  const cell = screen
    .getAllByRole('cell')
    .find((td) => td.textContent?.startsWith(name) && td.closest('.rewards-matrix'))
  if (!cell) throw new Error(`no matrix row for ${name}`)
  return cell.closest('tr') as HTMLElement
}

// ── Drag-to-reorder helpers (2026-09-23 drag-to-reorder spec §7) ─────────────────────────────

// Lane R1's stale-list sentence for the reward categories (spec §8.3).
const STALE_CATEGORIES =
  'The reward categories changed since this list was loaded — nothing was moved.'

/** The page inside a ToastProvider, on Manage — the reorder toasts and their Undo live there. */
function renderManage() {
  return render(
    <MemoryRouter initialEntries={['/credit-cards?section=manage']}>
      <ToastProvider>
        <CreditCardsPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

/** A row's grip, by the name it is announced with ("Reorder Venture X"). */
const grip = (name: string) => screen.getByRole('button', { name: `Reorder ${name}` })

/** The keyboard path (spec §2.4): focus the grip, Space lifts, `key` moves one place, Space
 *  drops. */
function keyboardMove(name: string, key: 'ArrowUp' | 'ArrowDown'): void {
  grip(name).focus()
  fireEvent.keyDown(grip(name), { key: ' ' })
  fireEvent.keyDown(grip(name), { key })
  fireEvent.keyDown(grip(name), { key: ' ' })
}

/** Unhandled rejections raised during the test, collected rather than failing the run: vitest
 *  steps aside when another listener exists. A throw in a save's success path must surface as
 *  one of these — a bug, loud on the console — never as a failed-save toast (lane R3 review). */
function collectRejections(): unknown[] {
  const reasons: unknown[] = []
  const listener = (reason: unknown) => {
    reasons.push(reason)
  }
  process.on('unhandledRejection', listener)
  onTestFinished(() => {
    process.off('unhandledRejection', listener)
  })
  return reasons
}

/** CategoriesPanel on its own, so a test can hand it a new onChanged between renders — the
 *  page's own `load` never changes, so only a direct render shows which one a late answer calls.
 *  Returns the rerender. */
function renderCategoriesPanel(onChanged: () => void): (next: () => void) => void {
  const panel = (callback: () => void) => (
    <ToastProvider>
      <CategoriesPanel
        categories={CATEGORIES}
        cards={[vx(), SAVOR, RH]}
        spendingCategories={[]}
        suggested={new Map()}
        enteredMonths={new Map()}
        onChanged={callback}
      />
    </ToastProvider>
  )
  const view = render(panel(onChanged))
  return (next) => view.rerender(panel(next))
}

/** A table's row ids, top to bottom, as rendered. */
const rowIds = (table: '.roster-table' | '.categories-table') =>
  [...document.querySelectorAll(`${table} tbody tr`)].map((row) => row.getAttribute('data-reorder-id'))

/** A tiny server for the reward categories: the GET answers the stored order; the reorder PUT
 *  stores the order it is sent — renumbered 0…n−1, as lane R1's route does — and answers with it.
 *  Every GET answers fresh rows, as a parsed response does: the page's state (and a panel's
 *  saved order, which retires on new props) must never ride on a reused array. */
function serveCategories(initial: RewardCategoryOut[] = CATEGORIES): void {
  let stored = initial
  vi.mocked(fetchRewardCategories).mockImplementation(async () =>
    stored.map((category) => ({ ...category })),
  )
  vi.mocked(reorderRewardCategories).mockImplementation(async (ids) => {
    const byId = new Map(stored.map((category) => [category.id, category]))
    stored = ids.flatMap((id, index) => {
      const category = byId.get(id)
      return category === undefined ? [] : [{ ...category, sort_order: index }]
    })
    return stored
  })
}

/** A tiny server for the card list: the GET answers the stored order (fresh rows every time,
 *  as serveCategories'); the reorder PUT stores the order it is sent — renumbered 0…n−1, as lane
 *  R1's route does — and answers with it. */
function serveCards(initial: CreditCardOut[] = [vx(), SAVOR, RH]): void {
  let stored = initial
  vi.mocked(fetchCreditCards).mockImplementation(async () => stored.map((card) => ({ ...card })))
  vi.mocked(reorderCreditCards).mockImplementation(async (ids) => {
    const byId = new Map(stored.map((card) => [card.id, card]))
    stored = ids.flatMap((id, index) => {
      const card = byId.get(id)
      return card === undefined ? [] : [{ ...card, sort_order: index }]
    })
    return stored
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  clearSnapshots()
  // The shared scope remembers a deliberate owner pick in localStorage, and jsdom keeps it
  // alive across tests in this file — without this, one test's chip click would filter the
  // next test's page before it has rendered a single chip.
  localStorage.clear()
  seedHappyPath()
  // jsdom has no layout: a keyboard lift measures every row at y=0, so lane R0's hook asks the
  // page to scroll the landing slot clear of the top edge — and jsdom implements no scrollBy.
  window.scrollBy = vi.fn()
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

  // 2026-09-23 spec §B6: "droppable" named every card with a net of $0 or less — no-fee cards
  // that only TIE another card's rate included. Three verdicts replace it.
  it('sorts the lineup into three verdicts, naming ties and the unweighted rows left out', async () => {
    renderPage()
    const summary = await screen.findByRole('list', { name: 'Card verdicts' })
    const group = (label: string) =>
      within(summary)
        .getAllByRole('listitem')
        .find((item) => item.textContent?.startsWith(label)) as HTMLElement
    // VX: $31.20 marginal + $300 credits − $395 fee = −$63.80 → its fee outweighs what it adds.
    expect(group('Costs you money').textContent).toContain('Venture X (−$63.80/yr)')
    // SavorOne and RH Gold each only tie the other on Dining: $0 marginal, no fee.
    const free = group('Free to keep — no extra rewards').textContent
    expect(free).toContain('SavorOne (ties RH Gold on Dining)')
    expect(free).toContain('RH Gold (ties SavorOne on Dining)')
    expect(within(summary).queryByText(/^Earns its keep/)).toBeNull()
    expect(summary.parentElement?.textContent).toContain('Excludes 1 unweighted category')
    expect(screen.queryByText(/Droppable|droppable/)).toBeNull()
  })

  // Review of spec §B6: ties are the reason for a FEE card's $0 marginal too.
  it('names the tie for fee cards as well — two fee cards that tie each other each name the other', async () => {
    const feeCard = (id: number, name: string, slug: string): CreditCardOut => ({
      ...SAVOR, id, name, slug, annual_fee: '95.00',
    })
    vi.mocked(fetchCreditCards).mockResolvedValue([feeCard(8, 'Card A', 'card-a'), feeCard(9, 'Card B', 'card-b')])
    vi.mocked(fetchRewardCategories).mockResolvedValue([CATEGORIES[0]])
    vi.mocked(fetchRewardRates).mockResolvedValue([
      { id: 41, card_id: 8, category_id: 10, multiplier: '3.00', note: null, monthly_cap: null },
      { id: 42, card_id: 9, category_id: 10, multiplier: '3.00', note: null, monthly_cap: null },
    ])
    renderPage()
    const summary = await screen.findByRole('list', { name: 'Card verdicts' })
    const costs = within(summary)
      .getAllByRole('listitem')
      .find((item) => item.textContent?.startsWith('Costs you money')) as HTMLElement
    expect(costs.textContent).toContain('Card A (−$95.00/yr; ties Card B on Groceries)')
    expect(costs.textContent).toContain('Card B (−$95.00/yr; ties Card A on Groceries)')
    cleanup()
    renderPage('/credit-cards?card=card-a')
    await screen.findByText('Worth keeping? (est.)')
    expect(verdictRegion().textContent).toContain(
      'its $95.00 fee buys no extra rewards — it ties Card B on Groceries',
    )
  })

  it('with no weighted categories the page explains setup instead of declaring cards droppable', async () => {
    // Production on 2026-09-03: every reward category unmapped and unweighted, so the
    // optimizer valued every card at $0 and called five of six "droppable".
    vi.mocked(fetchRewardCategories).mockResolvedValue(
      CATEGORIES.map((c) => ({ ...c, annual_spend: null, spending_category_id: null })),
    )
    renderPage()
    await screen.findByText('Est. $/yr won')

    expect(screen.queryByRole('list', { name: 'Card verdicts' })).toBeNull()
    expect(screen.queryByText(/Costs you money|Free to keep/)).toBeNull()
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
    // `owner=all` is the shared scope's arrival normalization — every view is shareable.
    expect(screen.getByTestId('location').textContent).toBe(
      '/credit-cards?owner=all&card=venture-x',
    )
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
    // The drill param is gone; the scope param the frame normalized in stays.
    expect(screen.getByTestId('location').textContent).toBe('/credit-cards?owner=all')
  })

  it('a garbled ?card= slug falls back to the matrix view', async () => {
    renderPage('/credit-cards?card=nope')
    await screen.findByText('Rewards matrix — best card per category')
  })

  it('the drill-in spells the marginal breakdown and the verdict it adds up to', async () => {
    renderPage('/credit-cards?card=venture-x')
    await screen.findByText('Worth keeping? (est.)')
    // VX marginal: Groceries falls back to Savor 3% → 265.20−234 = 31.20; Dining
    // unchanged. Net = 31.20 + 300 − 395 = −63.80 → it costs money.
    expect(screen.getByText(/\$31\.20 marginal/)).toBeTruthy()
    const verdict = verdictRegion()
    expect(verdict.textContent).toContain('Costs you money')
    expect(verdict.textContent).toContain(
      'its $395.00 fee is more than the $31.20 of rewards and $300.00 of credits it brings',
    )
    expect(screen.queryByText(/droppable/)).toBeNull()
    // What closing would change: the whole lineup's line, VX's $30,000 out of $40,000. The
    // summary has no snapshot month, so no utilization is claimed.
    const closing = closingLine()
    expect(closing.textContent).toContain('total credit line $40,000.00 → $10,000.00')
    expect(closing.textContent).not.toContain('utilization')
  })

  it('a free card says it costs nothing, names the card it ties, and what closing gives up', async () => {
    renderPage('/credit-cards?card=savorone')
    await screen.findByText('Worth keeping? (est.)')
    const verdict = verdictRegion()
    expect(verdict.textContent).toContain('Free to keep — no extra rewards')
    expect(verdict.textContent).toContain('ties RH Gold on Dining')
    expect(verdict.textContent).toContain('no annual fee')
    expect(closingLine().textContent).toContain(
      'total credit line $40,000.00 → $30,000.00',
    )
    // The tile's second line IS the verdict, in its tone: neutral, not the red of a card to drop.
    const tile = screen.getByText('Net value per year').closest('.stat-tile') as HTMLElement
    const delta = tile.querySelector('.stat-delta') as HTMLElement
    expect(delta.textContent).toBe('Free to keep — no extra rewards')
    expect(delta.className).toContain('stat-delta-neutral')
  })

  it('prices household utilization before and after when every card’s balance is known', async () => {
    vi.mocked(fetchCreditCards).mockResolvedValue([
      vx({ account_id: 7 }),
      { ...SAVOR, account_id: 8 },
      RH,
    ])
    vi.mocked(fetchSummary).mockResolvedValue({
      month: '2026-08-01', net_worth: null, mom_delta: null, mom_pct: null, groups: [], owner_totals: [],
    })
    vi.mocked(fetchMonthBalances).mockResolvedValue({
      month: '2026-08-01', exists: true, recorded_on: null, notes: null,
      balances: [
        { account_id: 7, balance: '-1200.00' },
        { account_id: 8, balance: '-400.00' },
      ],
    })
    renderPage('/credit-cards?card=venture-x')
    await screen.findByText('Worth keeping? (est.)')
    // $1,600 owed over $40,000 = 4.0%; the same $1,600 over the $10,000 left = 16.0%.
    await waitFor(() =>
      expect(closingLine().textContent).toContain(
        'household utilization 4.0% → 16.0% with the same balances (as of Aug 2026)',
      ),
    )
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
    renderPage('/credit-cards?section=manage')
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
    renderPage('/credit-cards?section=manage')
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
      reset_cadence: 'calendar',
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
        reset_cadence: 'calendar',
      }),
    )
  })

  it('flips a credit\'s reset cadence with a full-body PATCH', async () => {
    vi.mocked(updateCardCredit).mockResolvedValue({
      id: 11, label: '$300 travel credit', annual_value: '300.00', counts: true,
      reset_cadence: 'anniversary',
    })
    renderPage('/credit-cards?card=venture-x')
    fireEvent.click(
      await screen.findByRole('button', {
        name: '$300 travel credit resets on the card anniversary',
      }),
    )
    await waitFor(() =>
      expect(updateCardCredit).toHaveBeenCalledWith(11, {
        label: '$300 travel credit',
        annual_value: '300.00',
        counts: true,
        reset_cadence: 'anniversary',
      }),
    )
  })

  it('adding a credit sends the calendar cadence by default', async () => {
    vi.mocked(createCardCredit).mockResolvedValue({
      id: 12, label: 'Lounge', annual_value: '100.00', counts: true, reset_cadence: 'calendar',
    })
    renderPage('/credit-cards?card=venture-x')
    fireEvent.change(await screen.findByLabelText('Credit label'), {
      target: { value: 'Lounge' },
    })
    fireEvent.change(screen.getByLabelText('Credit annual value'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add credit' }))
    await waitFor(() =>
      expect(createCardCredit).toHaveBeenCalledWith(1, {
        label: 'Lounge',
        annual_value: '100',
        counts: true,
        reset_cadence: 'calendar',
      }),
    )
  })

  it('the roster nudges for active cards without an opened date', async () => {
    renderPage('/credit-cards?section=manage')
    await screen.findByText('Card roster')
    // SavorOne and RH Gold both carry opened_on: null in the fixtures; Venture X is dated.
    expect(screen.getByText(/2 active cards have no opened date/)).toBeTruthy()
    expect(
      screen.getByText(/fees, anniversaries and credit resets reach the calendar/),
    ).toBeTruthy()
  })

  it('an auto weight names the ENTERED months behind it (2026-09-09 audit item 6)', async () => {
    // Three columns, February never entered. The weight is the TWO-month annualization
    // ($300 × 12 / 2), and the caption says so — an unentered month is not a $0 month.
    vi.mocked(fetchRewardCategories).mockResolvedValue([
      { ...CATEGORIES[0], annual_spend: null, spending_category_id: 7 },
      { ...CATEGORIES[1], annual_spend: null, spending_category_id: 7 },
    ])
    vi.mocked(fetchCategories).mockResolvedValue([
      { id: 7, name: 'Food', slug: 'food', sort_order: 0, is_active: true, kind: 'spending' },
    ] as never)
    vi.mocked(fetchMatrix).mockResolvedValue({
      months: ['2026-01-01', '2026-02-01', '2026-03-01'],
      categories: [],
      series: [
        { category_id: 7, values: ['100.00', null, '200.00'], budgets: [null, null, null] },
      ],
      totals: [], net_pay: [], savings_rate: [], four_pct_rule: [], total_budget: [],
    } as unknown as SpendingMatrix)
    renderPage('/credit-cards?section=manage')
    await screen.findByText('Categories & weights')
    // Two rows share the one pool of Food dollars, so each carries half of it — and the
    // caption keeps the share and the denominator as separate clauses.
    const shared = categoriesRow('Groceries').textContent
    expect(shared).toContain('$900.00')
    expect(shared).toContain('auto · 1/2 share · from 2 entered months')
    vi.mocked(fetchRewardCategories).mockResolvedValue([
      { ...CATEGORIES[0], annual_spend: null, spending_category_id: 7 },
    ])
    cleanup()
    // A DIFFERENT book below (one reward category, not two), so it must not inherit the last
    // one's snapshot: the page seeds its state from the module-level cache (CreditCardsPage.tsx's
    // `getSnapshot(SNAPSHOT_KEY)`), which beforeEach clears between TESTS but not between two
    // renders inside one. Without this the second render painted the first's "$900.00 · 1/2
    // share" row, 'Categories & weights' resolved off that stale paint, and the assertion below
    // raced the new fetch — losing whenever full-suite scheduling delayed it.
    clearSnapshots()
    renderPage('/credit-cards?section=manage')
    await screen.findByText('Categories & weights')
    // findBy/waitFor, not a bare read: the row is what the fetch answers, so it is awaited.
    await waitFor(() => expect(categoriesRow('Groceries').textContent).toContain('$1,800.00'))
    expect(categoriesRow('Groceries').textContent).toContain('auto · from 2 entered months')
  })

  it('reordering a category is one PUT of the whole new order, and a second move before the refetch diffs against the optimistic order', async () => {
    serveCategories()
    renderPage('/credit-cards?section=manage')
    await screen.findByText('Categories & weights')
    // The page's reload never lands in this test: every move below has only the rows on screen
    // to go by, never the props the page loaded with.
    vi.mocked(fetchRewardCategories).mockReturnValue(new Promise<never>(() => {}))
    // Lift-and-drop from the keyboard (2026-09-23 drag-to-reorder spec §2.4): Space lifts
    // Groceries, ↓ moves it one place, Space drops it.
    keyboardMove('Groceries', 'ArrowDown')
    // ONE PUT, carrying every reward category in the new order (spec §7).
    expect(reorderRewardCategories).toHaveBeenCalledTimes(1)
    expect(reorderRewardCategories).toHaveBeenLastCalledWith([11, 10, 12])
    // Optimistic: the list re-renders in the new order before any refetch lands.
    expect(rowIds('.categories-table')).toEqual(['11', '10', '12'])
    // The grips wake when the PUT answers.
    await waitFor(() => expect(grip('Groceries').getAttribute('aria-disabled')).toBeNull())
    // Regression (the live-check find this test was first written for): a SECOND move before
    // the refetch lands must diff against the optimistic order, not the loaded one — moving
    // Groceries back up is a real move, never a silent no-op.
    keyboardMove('Groceries', 'ArrowUp')
    expect(reorderRewardCategories).toHaveBeenCalledTimes(2)
    expect(reorderRewardCategories).toHaveBeenLastCalledWith([10, 11, 12])
    // The per-row PATCH chain is gone: a reorder never PATCHes a row.
    expect(updateRewardCategory).not.toHaveBeenCalled()
  })

  it('empty state: no categories → the seed button renders', async () => {
    vi.mocked(fetchCreditCards).mockResolvedValue([])
    vi.mocked(fetchRewardCategories).mockResolvedValue([])
    vi.mocked(fetchRewardRates).mockResolvedValue([])
    renderPage('/credit-cards?section=manage')
    await screen.findByText("Start with the spreadsheet's categories")
    expect(screen.getByText(/No cards yet/)).toBeTruthy()
  })

  it('credit line history draws per-card steps plus the total', async () => {
    renderPage('/credit-cards?section=lines')
    await screen.findByText('Credit line history')
    // The selected task carries its own chart description and export controls.
    expect(screen.queryByLabelText(/Horizontal bars of each card/)).toBeNull()
    expect(screen.getByLabelText(/Step chart of credit limits/)).toBeTruthy()
    expect(screen.getAllByRole('group', { name: /Export/ })).toHaveLength(1)
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
    expect(screen.getByText("Couldn't load credit cards — boom")).toBeTruthy()
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
  // The bar answers "Whose" itself now, so the page's cards-specific sentence has to be the
  // bar's ownerHint: standing beside it as a second InfoHint put two ⓘ in one row, each
  // giving a different answer to the same question.
  it('answers Whose exactly once, in the words the cards need', async () => {
    const { container } = renderPage()
    await screen.findByRole('group', { name: 'Whose' })
    const scopeRow = container.querySelector('.page-frame-scope') as HTMLElement
    expect(scopeRow.querySelectorAll('.info-hint').length).toBe(1)
    // The button is named by its first four words now (motion spec §8), and the shell's
    // default answer opens with the very same four — so the cards words only show in the bubble.
    fireEvent.click(scopeRow.querySelector('button.info-hint') as HTMLElement)
    const sentence = screen.getByRole('tooltip').textContent ?? ''
    expect(sentence).toContain("A person's view is their own cards plus the joint ones")
    // ...and not the shell's generic default, which says "accounts".
    expect(sentence).not.toContain('their own accounts plus the joint ones')
  })

  it('shows the owner per row and defaults a NEW card to the primary person', async () => {
    renderPage('/credit-cards?section=manage')
    await screen.findByText('Card roster')
    const roster = document.querySelector('.roster-table') as HTMLElement
    // The grip column comes first (2026-09-23 drag-to-reorder spec §7): Owner is the third cell.
    const owners = Array.from(roster.querySelectorAll('tbody tr')).map(
      (tr) => tr.querySelectorAll('td')[2].textContent,
    )
    expect(owners).toEqual(['Ed', 'Ed', 'Sam'])
    // The fresh form follows the roster once /household lands — Joint must be a CHOICE.
    // `selector` keeps this on the form's own select — the shared scope row's chips are
    // labelled "Whose", but the selector is the durable way to name this box.
    const select = screen.getByLabelText('Owner', { selector: 'select' }) as HTMLSelectElement
    expect(select.value).toBe('1')
  })

  it('sends person_id on create and leaves primary_holder alone', async () => {
    vi.mocked(createCreditCard).mockResolvedValue(vx())
    renderPage('/credit-cards?section=manage')
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
    renderPage('/credit-cards?section=manage')
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
      <MemoryRouter initialEntries={['/credit-cards?section=manage']}>
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
    fireEvent.click(screen.getByRole('tab', { name: 'Credit lines' }))
    expect(screen.getByText(/No limit history yet/)).toBeTruthy()
    expect(screen.getByTestId('location').textContent).toContain('owner=2')
    fireEvent.click(screen.getByRole('tab', { name: 'Manage' }))
    expect(screen.getByRole('button', { name: 'Edit SavorOne' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Rewards' }))

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
    await screen.findByRole('heading', { name: /Rewards matrix/ })
    expect(screen.queryByRole('group', { name: 'Whose' })).toBeNull()
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
    await screen.findByRole('heading', { name: /Rewards matrix/ })
    // The fixture: Ed holds VX + SavorOne, Sam holds RH Gold (3x Dining, no fee). Ed alone
    // already wins Dining with SavorOne's 3x, so RH Gold adds nothing — no tile.
    expect(screen.queryByText('Household wallet advantage')).toBeNull()

    cleanup()
    // Another new book, same reason as above: the page would otherwise paint the previous
    // lineup's snapshot before this one's cards land.
    clearSnapshots()
    // Give Sam a card that wins a category nobody else can: 5x Groceries at 1¢ = 5%.
    const winner: CreditCardOut = { ...RH, id: 4, name: 'Sam Grocery', slug: 'sam-grocery' }
    vi.mocked(fetchCreditCards).mockResolvedValue([vx(), SAVOR, winner])
    vi.mocked(fetchRewardRates).mockResolvedValue([
      ...RATES,
      { id: 36, card_id: 4, category_id: 10, multiplier: '5.00', note: null, monthly_cap: null },
    ])
    renderPage()
    await screen.findByRole('heading', { name: /Rewards matrix/ })
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

describe('CreditCardsPage — task views', () => {
  it('opens rewards first and makes line history and management reachable', async () => {
    seedHappyPath()
    renderPage()
    const matrix = await screen.findByRole('heading', { name: /Rewards matrix/ })
    const value = screen.getByRole('heading', { name: /worth keeping/i })
    expectInDocumentOrder(matrix, value)
    expect(screen.queryByRole('heading', { name: /Card roster/ })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Credit lines' }))
    expect(screen.getByRole('heading', { name: /Credit line history/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /Rewards matrix/ })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Manage' }))
    const roster = screen.getByRole('heading', { name: /Card roster/ })
    const categories = screen.getByRole('heading', { name: /Categories & weights/ })
    expectInDocumentOrder(roster, categories)
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  })

  it('retains an unfinished card edit across tasks and Add card opens management', async () => {
    renderPage()
    await screen.findByRole('heading', { name: /Rewards matrix/ })
    fireEvent.click(screen.getByRole('button', { name: '+ Add card' }))
    const name = await screen.findByLabelText('Card name')
    fireEvent.change(name, { target: { value: 'Travel card draft' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Rewards' }))
    expect(screen.queryByRole('heading', { name: /Card roster/ })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Manage' }))
    expect((screen.getByLabelText('Card name') as HTMLInputElement).value).toBe('Travel card draft')
    expect(createCreditCard).not.toHaveBeenCalled()
  })
})

describe('CreditCardsPage — shell scope (2026-09-03 spec §5–§6)', () => {
  it('filters by the URL owner without refetching', async () => {
    renderPage('/credit-cards?owner=2')
    await screen.findByText('Credit cards')
    await waitFor(() => expect(screen.getByRole('group', { name: 'Whose' })).toBeTruthy())
    // Sam owns RH Gold alone — the URL alone put the page in that scope.
    expect(screen.queryByRole('button', { name: 'Open SavorOne details' })).toBeNull()
    const calls = vi.mocked(fetchCreditCards).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Joint' }))
    expect(screen.getByTestId('location').textContent).toContain('owner=joint')
    // The data invariant (spec §6): owner is a CLIENT-side filter here, never a refetch.
    expect(vi.mocked(fetchCreditCards).mock.calls.length).toBe(calls)
    // The page's own chip row is gone — the shared scope row is the only owner control.
    expect(document.querySelector('.cards-owner-row')).toBeNull()
  })

  it('renders through PageFrame with the add action in the title row', async () => {
    renderPage('/credit-cards')
    await screen.findByText('Credit cards')
    expect(
      screen.getByRole('button', { name: '+ Add card' }).closest('.page-frame-actions'),
    ).toBeTruthy()
    expect(document.querySelector('.page-header')).toBeNull()
  })
})

// ── Tiles per view + ghost parity (2026-09-13 polish §9, §12 — S5/S7) ────────────────────
describe('CreditCardsPage — tiles per view', () => {
  it('shows the tiles on Rewards and Credit lines but not on Manage', async () => {
    seedHappyPath()
    renderPage()
    await screen.findByText('Total credit line')
    fireEvent.click(screen.getByRole('tab', { name: 'Credit lines' }))
    expect(screen.getByText('Total credit line')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Manage' }))
    expect(screen.queryByText('Total credit line')).toBeNull()
    expect(document.querySelector('.loading-dim > .kpi-row')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Rewards' }))
    expect(screen.getByText('Total credit line')).toBeTruthy()
  })

  it('ghosts four tiles without a delta line while the first payload is in flight', () => {
    seedHappyPath()
    vi.mocked(fetchCreditCards).mockReturnValue(new Promise(() => {}))
    const { container } = renderPage()
    expect(container.querySelectorAll('.page-skeleton .skeleton-tile')).toHaveLength(4)
    expect(container.querySelector('.page-skeleton .skeleton-delta')).toBeNull()
  })
})

// ── Drag to reorder (2026-09-23 drag-to-reorder spec §7) ──────────────────────────────────────

describe('CreditCardsPage — the credit-line colours follow the card, not its place', () => {
  it('keys each line to its card id: a card moved up the list keeps its colour', async () => {
    // SavorOne stands first — as it would after a drag — and still wears slot 1 (id 2), while
    // Venture X keeps slot 0 (id 1). The series order is the list's.
    vi.mocked(fetchCreditCards).mockResolvedValue([SAVOR, vx(), RH])
    renderPage('/credit-cards?section=lines')
    await screen.findByText('Credit line history')
    const line = screen
      .getAllByTestId('echart')
      .find((el) => (el.getAttribute('data-series-names') ?? '').includes('Total line'))
    expect(line?.getAttribute('data-series-names')).toBe('SavorOne|Venture X|Total line')
    expect(line?.getAttribute('data-series-colors')).toBe(`${PALETTE[1]}|${PALETTE[0]}|${INK}`)
  })

  // Amendment A1 (spec §7 as amended 2026-09-23): the rank counts every card the page loaded,
  // so a person scope that draws fewer cards repaints none of them.
  it('keeps a card in one colour across person scopes — archived cards hold their rank too', async () => {
    const rhWithLine: CreditCardOut = {
      ...RH,
      current_limit: '5000.00',
      limit_events: [{ id: 24, effective_date: '2025-03-01', limit_amount: '5000.00', note: null }],
    }
    // Venture X (id 1) is archived: it draws no line, and still takes the first rank.
    vi.mocked(fetchCreditCards).mockResolvedValue([vx({ is_active: false }), SAVOR, rhWithLine])
    renderPage('/credit-cards?section=lines')
    await screen.findByText('Credit line history')
    const line = () => screen.getByLabelText(/Step chart of credit limits/)
    await waitFor(() =>
      expect(line().getAttribute('data-series-names')).toBe('SavorOne|RH Gold|Total line'),
    )
    expect(line().getAttribute('data-series-colors')).toBe(`${PALETTE[1]}|${PALETTE[2]}|${INK}`)
    // Sam's scope draws RH Gold alone — in the colour the household view gave it.
    fireEvent.click(await screen.findByRole('button', { name: 'Sam' }))
    await waitFor(() => expect(line().getAttribute('data-series-names')).toBe('RH Gold'))
    expect(line().getAttribute('data-series-colors')).toBe(PALETTE[2])
  })
})

describe('CreditCardsPage — reorder Categories & weights (2026-09-23 drag-to-reorder spec §7)', () => {
  beforeEach(() => {
    vi.mocked(reorderRewardCategories).mockReset()
  })

  it('puts a grip first on every row — hidden ones too — on a reorderable table', async () => {
    // One range, no carried rows: lane R0's development-only contract check stays silent.
    const errors = vi.spyOn(console, 'error')
    onTestFinished(() => errors.mockRestore())
    serveCategories([CATEGORIES[0], CATEGORIES[1], { ...CATEGORIES[2], is_active: false }])
    renderManage()
    await screen.findByText('Categories & weights')
    const table = document.querySelector('.categories-table') as HTMLTableElement
    expect(table.className).toBe('data-table categories-table reorder-table')
    const head = table.querySelector('thead tr')?.firstElementChild
    expect(head?.className).toBe('reorder-grip-cell')
    expect(head?.getAttribute('aria-hidden')).toBe('true')
    for (const row of table.querySelectorAll('tbody tr')) {
      expect(row.firstElementChild?.className).toBe('reorder-grip-cell')
    }
    expect(
      [...table.querySelectorAll('tbody .reorder-grip')].map((button) =>
        button.getAttribute('aria-label'),
      ),
    ).toEqual(['Reorder Groceries', 'Reorder Dining', 'Reorder Rent'])
    // A hidden row keeps its place and moves like any other (spec §9).
    expect((grip('Rent') as HTMLButtonElement).disabled).toBe(false)
    // The native drag is gone: no row can be picked up by the browser itself.
    expect(table.querySelectorAll('[draggable]')).toHaveLength(0)
    // One description for the list's grips, outside the capped scroller's table.
    const instructions = document.getElementById(
      grip('Groceries').getAttribute('aria-describedby') ?? '',
    )
    expect(instructions?.textContent).toBe(
      'Press Space or Enter to pick up. Use the arrow keys to move, Home or End to jump, Space or Enter to drop, Escape to cancel.',
    )
    expect(table.contains(instructions)).toBe(false)
    expect(errors.mock.calls.filter(([first]) => String(first).startsWith('useReorder:'))).toEqual([])
  })

  it('keeps the grips focusable but inert while any request of the panel is in flight', async () => {
    serveCategories()
    // A hide that never settles: the panel stays busy for the rest of the test.
    vi.mocked(updateRewardCategory).mockReturnValueOnce(new Promise<never>(() => {}))
    renderManage()
    await screen.findByText('Categories & weights')
    fireEvent.click(screen.getByRole('button', { name: 'Hide Rent' }))
    const handle = grip('Dining') as HTMLButtonElement
    expect(handle.getAttribute('aria-disabled')).toBe('true')
    expect(handle.disabled).toBe(false)
    handle.focus()
    fireEvent.keyDown(handle, { key: ' ' })
    expect(handle.getAttribute('aria-pressed')).toBeNull()
    expect(reorderRewardCategories).not.toHaveBeenCalled()
  })

  it('flashes the moved row, says "Moved Dining", and the page reloads the list', async () => {
    serveCategories()
    renderManage()
    await screen.findByText('Categories & weights')
    keyboardMove('Dining', 'ArrowUp')
    expect(await screen.findByText('Moved Dining')).toBeTruthy()
    expect(reorderRewardCategories).toHaveBeenCalledWith([11, 10, 12])
    expect(
      document
        .querySelector('.categories-table tr[data-reorder-id="11"]')
        ?.hasAttribute('data-reorder-saved'),
    ).toBe(true)
    // The mount's fetch, then the reload the save asked for.
    expect(fetchRewardCategories).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(grip('Rent').getAttribute('aria-disabled')).toBeNull())
    expect(rowIds('.categories-table')).toEqual(['11', '10', '12'])
    // Focus stays on the moved grip through the save (lane R0 restores it after the drop).
    expect(document.activeElement).toBe(grip('Dining'))
  })
})

describe('Credit cards — the native drag is gone (2026-09-23 drag-to-reorder spec §7 acceptance)', () => {
  const folder = path.resolve(__dirname, '../components/creditcards')

  it('no source under src/components/creditcards sets draggable or handles an HTML5 drag event', () => {
    const offenders = readdirSync(folder)
      .filter((name) => /\.tsx?$/.test(name))
      .filter((name) =>
        /\bdraggable\b|\bonDrag\w*|\bonDrop\b|dataTransfer/.test(
          readFileSync(path.join(folder, name), 'utf8'),
        ),
      )
    expect(offenders).toEqual([])
  })

  it('categories.css keeps no rule of the retired drag', () => {
    const css = readFileSync(path.join(folder, 'categories.css'), 'utf8')
    expect(css).not.toMatch(/\.drag-handle|\.drag-over|\.drag-cell|\.is-dragging/)
  })
})

describe('CreditCardsPage — Categories & weights: Undo, and a save that fails (spec §7, §8.1, §8.3)', () => {
  beforeEach(() => {
    vi.mocked(reorderRewardCategories).mockReset()
  })

  it('Undo re-sends the order that stood before the drop, shows it and says so', async () => {
    serveCategories()
    renderManage()
    await screen.findByText('Categories & weights')
    keyboardMove('Dining', 'ArrowUp')
    await screen.findByText('Moved Dining')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Order restored')).toBeTruthy()
    expect(vi.mocked(reorderRewardCategories).mock.calls).toEqual([[[11, 10, 12]], [[10, 11, 12]]])
    // The server's answer shows at once, and the page reloads behind it.
    expect(rowIds('.categories-table')).toEqual(['10', '11', '12'])
    expect(fetchRewardCategories).toHaveBeenCalledTimes(3)
  })

  // Lane R3's real-browser find, applied here: after a quick Undo the page can hand the panel
  // nothing new. Here the drop's reload never lands and the Undo's returns exactly what the page
  // first loaded, which CreditCardsPage.load skips as already shown. The panel shows the order
  // the Undo restored — the server's own answer — and the next drag saves the order on screen.
  it('drop → Undo → drag again saves the order the user sees, even when the page skips an identical reload', async () => {
    serveCategories()
    renderManage()
    await screen.findByText('Categories & weights')
    const firstLoad = getSnapshot('credit-cards')
    // The drop's reload never lands …
    vi.mocked(fetchRewardCategories).mockReturnValueOnce(new Promise<never>(() => {}))
    keyboardMove('Dining', 'ArrowUp')
    await screen.findByText('Moved Dining')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await screen.findByText('Order restored')
    // … and the Undo's lands with the rows of the first load, so the page keeps its props.
    await waitFor(() => expect(getSnapshot('credit-cards')).not.toBe(firstLoad))
    expect(JSON.stringify(getSnapshot('credit-cards'))).toBe(JSON.stringify(firstLoad))
    await waitFor(() => expect(grip('Rent').getAttribute('aria-disabled')).toBeNull())
    expect(rowIds('.categories-table')).toEqual(['10', '11', '12'])
    keyboardMove('Rent', 'ArrowUp')
    expect(reorderRewardCategories).toHaveBeenLastCalledWith([10, 12, 11])
  })

  // …and no saved order outlives a reload that returns rows identical to the first load. In
  // the app every reorder PUT goes through api(), which drops the page's 'credit-cards'
  // snapshot (client.ts MUTATION_FAMILIES), so the next reload always hands the panel fresh
  // rows. Here the PUT does the same, and another tab puts the old order back before this
  // tab's reload reads the list.
  it("retires the saved order on the next reload even when it returns the first load's rows (another tab put them back)", async () => {
    let stored = CATEGORIES
    vi.mocked(fetchRewardCategories).mockImplementation(async () =>
      stored.map((category) => ({ ...category })),
    )
    vi.mocked(reorderRewardCategories).mockImplementation(async (ids) => {
      const byId = new Map(stored.map((category) => [category.id, category]))
      const answer = ids.flatMap((id, index) => {
        const category = byId.get(id)
        return category === undefined ? [] : [{ ...category, sort_order: index }]
      })
      stored = CATEGORIES // the other tab's order, back where it was
      invalidateForMutation('/credit-cards/categories/order')
      return answer
    })
    renderManage()
    await screen.findByText('Categories & weights')
    keyboardMove('Dining', 'ArrowUp')
    await screen.findByText('Moved Dining')
    await waitFor(() => expect(rowIds('.categories-table')).toEqual(['10', '11', '12']))
    await waitFor(() => expect(grip('Rent').getAttribute('aria-disabled')).toBeNull())
    keyboardMove('Rent', 'ArrowUp')
    expect(reorderRewardCategories).toHaveBeenLastCalledWith([10, 12, 11])
  })

  it.each([
    { status: 500, detail: 'Internal Server Error', reason: 'the server had a problem (HTTP 500)' },
    // A server sentence that brings its own stop: ours closes it, once.
    { status: 422, detail: 'ids lists 12 more than once.', reason: 'ids lists 12 more than once' },
  ])('puts the rows back, keeps the grip focused and says why ($status)', async ({ status, detail, reason }) => {
    serveCategories()
    vi.mocked(reorderRewardCategories).mockRejectedValueOnce(new ApiError(detail, status))
    renderManage()
    await screen.findByText('Categories & weights')
    keyboardMove('Rent', 'ArrowUp')
    expect(
      await screen.findByText(
        `Couldn't save the new order — ${reason}. The list is back to how it was.`,
      ),
    ).toBeTruthy()
    expect(rowIds('.categories-table')).toEqual(['10', '11', '12'])
    expect(document.activeElement).toBe(grip('Rent'))
    expect(fetchRewardCategories).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it("shows a stale list's server sentence, puts the rows back and reloads (409)", async () => {
    serveCategories()
    vi.mocked(reorderRewardCategories).mockRejectedValueOnce(new ApiError(STALE_CATEGORIES, 409))
    renderManage()
    await screen.findByText('Categories & weights')
    keyboardMove('Groceries', 'ArrowDown')
    expect(await screen.findByText(STALE_CATEGORIES)).toBeTruthy()
    expect(rowIds('.categories-table')).toEqual(['10', '11', '12'])
    expect(fetchRewardCategories).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/Couldn't save the new order/)).toBeNull()
  })

  it.each([
    {
      status: 500,
      detail: 'Internal Server Error',
      text: "Couldn't restore the order — the server had a problem (HTTP 500).",
      fetches: 2,
    },
    { status: 409, detail: STALE_CATEGORIES, text: STALE_CATEGORIES, fetches: 3 },
  ])('says why an Undo was refused ($status), reloading a stale list', async ({ status, detail, text, fetches }) => {
    serveCategories()
    renderManage()
    await screen.findByText('Categories & weights')
    keyboardMove('Groceries', 'ArrowDown')
    await screen.findByText('Moved Groceries')
    vi.mocked(reorderRewardCategories).mockRejectedValueOnce(new ApiError(detail, status))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText(text)).toBeTruthy()
    expect(fetchRewardCategories).toHaveBeenCalledTimes(fetches)
  })
})

// Lane R3's code-quality review, applied to the same save/Undo shape (coordinator, 2026-09-23):
// a late answer reloads through the page as it is now; requests are counted, not flagged; and
// a throw in a success path is never reported as a failed request.
describe('CreditCardsPage — Categories & weights: late answers and overlapping requests (lane R3 review)', () => {
  /** The reward categories in `ids` order, renumbered as lane R1's route answers them. */
  const categoriesIn = (ids: number[]): RewardCategoryOut[] =>
    ids.flatMap((id, index) =>
      CATEGORIES.filter((category) => category.id === id).map((category) => ({
        ...category,
        sort_order: index,
      })),
    )

  beforeEach(() => {
    vi.mocked(reorderRewardCategories).mockReset()
  })

  it("reloads through the latest render's onChanged — a save, its Undo and a delete's Undo that answer late", async () => {
    const onChanged = [vi.fn(), vi.fn(), vi.fn(), vi.fn()]
    let answer: (rows: RewardCategoryOut[]) => void = () => {}
    vi.mocked(reorderRewardCategories)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve
          }),
      )
      .mockImplementationOnce(async (ids) => categoriesIn(ids))
    vi.mocked(deleteRewardCategory).mockResolvedValue(undefined)
    vi.mocked(createRewardCategory).mockResolvedValue(CATEGORIES[2])
    const rerenderWith = renderCategoriesPanel(onChanged[0])
    keyboardMove('Dining', 'ArrowUp')
    // The page renders again while the PUT is out, handing down a new onChanged.
    rerenderWith(onChanged[1])
    await act(async () => answer(categoriesIn([11, 10, 12])))
    // The toast's Undo is clicked after yet another render.
    rerenderWith(onChanged[2])
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await screen.findByText('Order restored')
    // A delete (reloading through the render it was clicked in), then its Undo after another.
    fireEvent.click(screen.getByRole('button', { name: 'Delete Rent' }))
    const deleted = (await screen.findByText('Deleted Rent and its multipliers')).closest(
      '.toast',
    ) as HTMLElement
    rerenderWith(onChanged[3])
    fireEvent.click(within(deleted).getByRole('button', { name: 'Undo' }))
    await screen.findByText('Restored Rent — multipliers were not restored')
    expect(onChanged.map((callback) => callback.mock.calls.length)).toEqual([0, 1, 2, 1])
  })

  it("keeps the grips parked until every request is back — a drop's Undo clicked while a later drop's save is out", async () => {
    serveCategories()
    renderManage()
    await screen.findByText('Categories & weights')
    keyboardMove('Dining', 'ArrowUp') // drop A, answered at once
    await screen.findByText('Moved Dining')
    await waitFor(() => expect(grip('Rent').getAttribute('aria-disabled')).toBeNull())
    let answerDrop: (rows: RewardCategoryOut[]) => void = () => {}
    let answerUndo: (rows: RewardCategoryOut[]) => void = () => {}
    vi.mocked(reorderRewardCategories)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerDrop = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerUndo = resolve
          }),
      )
    keyboardMove('Rent', 'ArrowUp') // drop B, left out
    fireEvent.click(screen.getByRole('button', { name: 'Undo' })) // A's Undo, left out too
    expect(vi.mocked(reorderRewardCategories).mock.calls.slice(1)).toEqual([
      [[11, 12, 10]],
      [[10, 11, 12]],
    ])
    await act(async () => answerDrop(categoriesIn([11, 12, 10])))
    // B is back and A's Undo is not: the grips stay parked.
    expect(grip('Rent').getAttribute('aria-disabled')).toBe('true')
    await act(async () => answerUndo(categoriesIn([10, 11, 12])))
    await waitFor(() => expect(grip('Rent').getAttribute('aria-disabled')).toBeNull())
    expect(rowIds('.categories-table')).toEqual(['10', '11', '12'])
  })

  it("a throw in the save's success path is a bug on the console, never 'The list is back to how it was.'", async () => {
    const rejections = collectRejections()
    serveCategories()
    renderManage()
    await screen.findByText('Categories & weights')
    // The page's reload throws before it returns a promise: a synchronous throw inside the
    // success handler, with the saved order already on screen.
    vi.mocked(fetchRewardCategories).mockImplementationOnce(() => {
      throw new Error('the reload threw')
    })
    keyboardMove('Dining', 'ArrowUp')
    await waitFor(() => expect(rejections).toHaveLength(1))
    expect(rejections[0]).toEqual(new Error('the reload threw'))
    expect(rowIds('.categories-table')).toEqual(['11', '10', '12'])
    expect(screen.queryByText(/Couldn't save the new order/)).toBeNull()
    // The request is back whatever its success path did: the grips wake.
    await waitFor(() => expect(grip('Rent').getAttribute('aria-disabled')).toBeNull())
  })

  it("a throw in the Undo's success path is a bug on the console, never \"Couldn't restore the order\"", async () => {
    const rejections = collectRejections()
    serveCategories()
    renderManage()
    await screen.findByText('Categories & weights')
    keyboardMove('Dining', 'ArrowUp')
    await screen.findByText('Moved Dining')
    vi.mocked(fetchRewardCategories).mockImplementationOnce(() => {
      throw new Error('the reload threw')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(rejections).toHaveLength(1))
    expect(rowIds('.categories-table')).toEqual(['10', '11', '12'])
    expect(screen.queryByText(/Couldn't restore the order/)).toBeNull()
  })
})

describe('CreditCardsPage — Categories & weights: the rows and the form around a drag', () => {
  beforeEach(() => {
    vi.mocked(reorderRewardCategories).mockReset()
  })

  it("shuts the rows' own buttons while a row is lifted; Escape opens them again and saves nothing", async () => {
    serveCategories()
    renderManage()
    await screen.findByText('Categories & weights')
    const rowButtons = () =>
      CATEGORIES.flatMap(({ name }) =>
        [`Edit ${name}`, `Hide ${name}`, `Delete ${name}`].map(
          (label) => screen.getByRole('button', { name: label }) as HTMLButtonElement,
        ),
      )
    grip('Dining').focus()
    fireEvent.keyDown(grip('Dining'), { key: ' ' })
    expect(rowButtons().every((button) => button.disabled)).toBe(true)
    fireEvent.keyDown(grip('Dining'), { key: 'Escape' })
    expect(rowButtons().every((button) => !button.disabled)).toBe(true)
    expect(reorderRewardCategories).not.toHaveBeenCalled()
  })

  it('a new category names no position — the server appends it after the last row', async () => {
    serveCategories()
    vi.mocked(createRewardCategory).mockResolvedValue({
      ...CATEGORIES[2],
      id: 13,
      name: 'Gas',
      slug: 'gas',
      sort_order: 3,
    })
    renderManage()
    await screen.findByText('Categories & weights')
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Gas' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }))
    await waitFor(() => expect(createRewardCategory).toHaveBeenCalledTimes(1))
    // Exactly the four columns the form owns — no sort_order (2026-09-23 reorder spec §3.3).
    expect(vi.mocked(createRewardCategory).mock.calls[0][0]).toStrictEqual({
      name: 'Gas',
      annual_spend: null,
      spending_category_id: null,
      pinned_card_id: null,
    })
  })
})

describe('CreditCardsPage — reorder the card roster (2026-09-23 drag-to-reorder spec §7)', () => {
  beforeEach(() => {
    vi.mocked(reorderCreditCards).mockReset()
  })

  it('puts a grip first on every card row — archived ones too — on a reorderable table', async () => {
    // One range, no carried rows: lane R0's development-only contract check stays silent.
    const errors = vi.spyOn(console, 'error')
    onTestFinished(() => errors.mockRestore())
    serveCards([vx({ is_active: false }), SAVOR, RH])
    renderManage()
    await screen.findByText('Card roster')
    const table = document.querySelector('.roster-table') as HTMLTableElement
    expect(table.className).toBe('data-table roster-table reorder-table')
    const head = table.querySelector('thead tr')?.firstElementChild
    expect(head?.className).toBe('reorder-grip-cell')
    expect(head?.getAttribute('aria-hidden')).toBe('true')
    for (const row of table.querySelectorAll('tbody tr')) {
      expect(row.firstElementChild?.className).toBe('reorder-grip-cell')
    }
    expect(
      [...table.querySelectorAll('tbody .reorder-grip')].map((button) =>
        button.getAttribute('aria-label'),
      ),
    ).toEqual(['Reorder Venture X', 'Reorder SavorOne', 'Reorder RH Gold'])
    // An archived card keeps its place and moves like any other (spec §9).
    expect((grip('Venture X') as HTMLButtonElement).disabled).toBe(false)
    // One description for the list's grips, outside the table (lane R0 consumer rule 6).
    const instructions = document.getElementById(
      grip('Venture X').getAttribute('aria-describedby') ?? '',
    )
    expect(instructions?.textContent).toBe(
      'Press Space or Enter to pick up. Use the arrow keys to move, Home or End to jump, Space or Enter to drop, Escape to cancel.',
    )
    expect(table.contains(instructions)).toBe(false)
    expect(errors.mock.calls.filter(([first]) => String(first).startsWith('useReorder:'))).toEqual([])
  })

  it('gives a lone card a disabled grip, and an empty roster no table at all (spec §9)', async () => {
    serveCards([vx()])
    renderManage()
    await screen.findByText('Card roster')
    expect((grip('Venture X') as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    clearSnapshots()
    serveCards([])
    renderManage()
    await screen.findByText(/No cards yet/)
    expect(document.querySelector('.roster-table')).toBeNull()
  })

  it('saves one drop as one PUT of every card id, shows it at once, and parks the grips until it answers', async () => {
    serveCards()
    vi.mocked(reorderCreditCards).mockReturnValue(new Promise<never>(() => {}))
    renderManage()
    await screen.findByText('Card roster')
    keyboardMove('Venture X', 'ArrowDown')
    expect(reorderCreditCards).toHaveBeenCalledTimes(1)
    expect(reorderCreditCards).toHaveBeenCalledWith([2, 1, 3])
    // Optimistic: the dropped order is on screen before the server answers (spec §7).
    expect(rowIds('.roster-table')).toEqual(['2', '1', '3'])
    // Inert until it answers, so a second drop cannot race the first (spec §9) — but still
    // focusable: the keyboard drop left focus on the moved grip.
    expect(grip('RH Gold').getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(grip('Venture X'))
  })

  it('flashes the moved row, says "Moved Venture X", and the page reloads — the matrix follows', async () => {
    serveCards()
    renderManage()
    await screen.findByText('Card roster')
    keyboardMove('Venture X', 'ArrowDown')
    expect(await screen.findByText('Moved Venture X')).toBeTruthy()
    expect(
      document.querySelector('.roster-table tr[data-reorder-id="1"]')?.hasAttribute('data-reorder-saved'),
    ).toBe(true)
    // The mount's fetch, then the reload the save asked for.
    expect(fetchCreditCards).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(grip('RH Gold').getAttribute('aria-disabled')).toBeNull())
    expect(rowIds('.roster-table')).toEqual(['2', '1', '3'])
    // The matrix reads the page's list, so its columns follow the new order by construction.
    fireEvent.click(screen.getByRole('tab', { name: 'Rewards' }))
    expect([...document.querySelectorAll('[id^="card-col-"]')].map((button) => button.id)).toEqual(
      ['card-col-2', 'card-col-1', 'card-col-3'],
    )
  })

  it('keeps the grips focusable but inert while any request of the roster is in flight', async () => {
    serveCards()
    // An archive that never settles: the roster stays busy for the rest of the test.
    vi.mocked(updateCreditCard).mockReturnValueOnce(new Promise<never>(() => {}))
    renderManage()
    await screen.findByText('Card roster')
    fireEvent.click(screen.getByRole('button', { name: 'Archive RH Gold' }))
    const handle = grip('SavorOne') as HTMLButtonElement
    expect(handle.getAttribute('aria-disabled')).toBe('true')
    expect(handle.disabled).toBe(false)
    handle.focus()
    fireEvent.keyDown(handle, { key: ' ' })
    expect(handle.getAttribute('aria-pressed')).toBeNull()
    expect(reorderCreditCards).not.toHaveBeenCalled()
  })

  it('never lets a reload that lands mid-save show the old order over the dropped one', async () => {
    serveCards()
    let answer: (cards: CreditCardOut[]) => void = () => {}
    vi.mocked(reorderCreditCards).mockReturnValueOnce(
      new Promise<CreditCardOut[]>((resolve) => {
        answer = resolve
      }),
    )
    const hidden = { ...CATEGORIES[2], is_active: false }
    vi.mocked(updateRewardCategory).mockResolvedValue(hidden)
    renderManage()
    await screen.findByText('Card roster')
    keyboardMove('Venture X', 'ArrowDown')
    // Another panel's save reloads the page mid-flight: a fresh card list, still in the old
    // order (the server has not moved it yet), beside the change that panel made.
    vi.mocked(fetchCreditCards).mockResolvedValue([vx(), SAVOR, RH])
    vi.mocked(fetchRewardCategories).mockResolvedValue([CATEGORIES[0], CATEGORIES[1], hidden])
    fireEvent.click(screen.getByRole('button', { name: 'Hide Rent' }))
    await screen.findByRole('button', { name: 'Show Rent' })
    expect(rowIds('.roster-table')).toEqual(['2', '1', '3'])
    // The PUT answers: the server's order stands until the page's next fetch.
    await act(async () => {
      answer([{ ...SAVOR, sort_order: 0 }, { ...vx(), sort_order: 1 }, { ...RH, sort_order: 2 }])
    })
    expect(rowIds('.roster-table')).toEqual(['2', '1', '3'])
  })
})
