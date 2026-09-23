import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BudgetPanel from './BudgetPanel'

vi.mock('../../api/spending', () => ({
  putCategoryBudget: vi.fn(),
  deleteCategoryBudget: vi.fn(),
  fetchBudgetSuggestions: vi.fn(),
  seedBudgets: vi.fn(),
}))
vi.mock('../../api/lifecycle', () => ({ undoBatch: vi.fn() }))
const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() }
vi.mock('../ToastProvider', () => ({ useToast: () => toast }))

import { undoBatch } from '../../api/lifecycle'
import {
  deleteCategoryBudget,
  fetchBudgetSuggestions,
  putCategoryBudget,
  seedBudgets,
} from '../../api/spending'
import type {
  BudgetSeedOut,
  BudgetSuggestion,
  BudgetSuggestionsOut,
  SpendingMatrix,
} from '../../types/api'

const matrix: SpendingMatrix = {
  months: ['2026-01-01', '2026-02-01'],
  categories: [
    { id: 1, name: 'Food', slug: 'food', sort_order: 1, is_active: true, kind: 'living' },
    { id: 2, name: 'Rent', slug: 'rent', sort_order: 2, is_active: true, kind: 'living' },
    { id: 3, name: 'Old', slug: 'old', sort_order: 3, is_active: false, kind: 'living' },
  ],
  series: [
    { category_id: 1, values: ['300.00', '450.00'], budgets: ['400.00', '400.00'] },
    { category_id: 2, values: ['2000.00', '2000.00'], budgets: [null, null] },
    { category_id: 3, values: [null, null], budgets: [null, null] },
  ],
  totals: ['2300.00', '2450.00'],
  net_pay: [null, null],
  savings_rate: [null, null],
  four_pct_rule: [null, null],
  total_budget: ['400.00', '400.00'],
}

// The same book with nothing budgeted: the card's empty state.
const blank: SpendingMatrix = {
  ...matrix,
  series: matrix.series.map((s) => ({ ...s, budgets: s.budgets.map(() => null) })),
  total_budget: [null, null],
}

const suggestions: BudgetSuggestionsOut = {
  window: { from: '2025-02-01', to: '2026-01-01', months: 12 },
  suggestions: [
    {
      category_id: 1,
      profile: 'variable',
      months: 12,
      mean: '412.35',
      median: '390.00',
      latest: '450.00',
      latest_month: '2026-01-01',
      cv: '0.2100',
      seed: '413.00',
      skip_reason: null,
    },
    {
      category_id: 2,
      profile: 'fixed',
      months: 12,
      mean: '1995.00',
      median: '2000.00',
      latest: '2000.00',
      latest_month: '2026-01-01',
      cv: '0.0100',
      seed: '2000.00',
      skip_reason: null,
    },
  ],
}

const seeded: BudgetSeedOut = {
  effective_month: '2026-01-01',
  window: suggestions.window,
  written: [
    { category_id: 1, amount: '413.00' },
    { category_id: 2, amount: '2000.00' },
  ],
  skipped: [{ category_id: 3, reason: 'dormant' }],
  batch_id: 'b-1',
}

const onBudgetsChanged = vi.fn()

beforeEach(() => {
  vi.mocked(putCategoryBudget).mockResolvedValue([
    { effective_month: '2026-03-01', amount: '425.00' },
    { effective_month: '2026-09-01', amount: null },
  ])
  vi.mocked(deleteCategoryBudget).mockResolvedValue(undefined)
  vi.mocked(fetchBudgetSuggestions).mockResolvedValue(suggestions)
  vi.mocked(seedBudgets).mockResolvedValue(seeded)
  vi.mocked(undoBatch).mockResolvedValue({} as never)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPanel(monthIndex: number) {
  return render(
    <BudgetPanel matrix={matrix} monthIndex={monthIndex} onBudgetsChanged={onBudgetsChanged} />,
  )
}

function foodRow(): HTMLElement {
  return screen.getByText('Food').closest('.budget-row') as HTMLElement
}

it('meters a within-budget month: proportional fill, no tick, calm summary', () => {
  renderPanel(0)
  const meter = screen.getByRole('meter', { name: 'Food spend vs budget' })
  expect(meter.getAttribute('aria-valuenow')).toBe('75') // 300 / 400
  expect(meter.getAttribute('aria-valuetext')).toBe('$300.00 of $400.00')
  expect(meter.querySelector('.budget-overflow-tick')).toBeNull()
  expect(within(foodRow()).getByText('$300.00 / $400.00')).toBeDefined()
  expect(screen.getByText('0 of 1 budgeted categories over in Jan 2026')).toBeDefined()
})

it('meters an over month: clamped fill, overflow tick, toned figures, summary counts it', () => {
  renderPanel(1)
  const meter = screen.getByRole('meter', { name: 'Food spend vs budget' })
  expect(meter.getAttribute('aria-valuenow')).toBe('100') // clamp: 450 / 400
  expect(meter.querySelector('.budget-overflow-tick')).not.toBeNull()
  expect(within(foodRow()).getByText('$450.00 / $400.00').className).toContain('delta-negative')
  expect(screen.getByText('1 of 1 budgeted categories over in Feb 2026')).toBeDefined()
})

it('lists unbudgeted ACTIVE categories under "No budget yet", collapsed while budgets exist, without meters or inactive ones', () => {
  renderPanel(0)
  const section = screen.getByText('No budget yet (1)').closest('details') as HTMLElement
  expect(section).not.toBeNull()
  expect(section.hasAttribute('open')).toBe(false)
  expect(within(section).getByText('Rent')).toBeDefined()
  expect(within(section).getByRole('button', { name: 'Set Rent budget' })).toBeDefined()
  expect(within(section).queryByText('Old')).toBeNull()
  expect(screen.queryByRole('meter', { name: 'Rent spend vs budget' })).toBeNull()
  // A1: no accordion inside the accordion — the editor opens from the row's button.
  expect(document.querySelectorAll('details.budget-editor')).toHaveLength(0)
})

it('saves through the PUT (editor defaults to the FOCUSED month) and renders the returned history', async () => {
  renderPanel(0)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Food budget' }))
  // A5: the default is the month the meters read — matrix.months[monthIndex] — so a first
  // budget saved with the default visibly lands on the meters. (Fixture-dated, so this
  // test no longer depends on the day the suite runs.)
  const monthBox = screen.getByLabelText('Food budget effective from') as HTMLInputElement
  expect(monthBox.value).toBe('2026-01')
  // The amount box prefills with the month's resolved budget.
  const amountBox = screen.getByLabelText('Food budget amount') as HTMLInputElement
  expect(amountBox.value).toBe('$400.00') // AmountInput's blurred echo of '400.00'
  fireEvent.change(amountBox, { target: { value: '425.00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Food budget' }))
  await waitFor(() =>
    expect(putCategoryBudget).toHaveBeenCalledWith(1, {
      amount: '425.00',
      effective_month: '2026-01-01',
    }),
  )
  // The response's history renders, null amount reading as the end marker.
  expect(await screen.findByText('Mar 2026 — $425.00')).toBeDefined()
  expect(screen.getByText('Sep 2026 — budget ends')).toBeDefined()
  expect(onBudgetsChanged).toHaveBeenCalled()
  // The re-dating hint is the editor's contract with history (spec §4.2) — since A5 it
  // rides IN the editor's control row, one line, naming the new default.
  expect(screen.getAllByText(/re-writes what that era/).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/Defaults to Jan 2026/).length).toBeGreaterThan(0)
})

it('follows the focused month when the page drills elsewhere', () => {
  renderPanel(1)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Food budget' }))
  const monthBox = screen.getByLabelText('Food budget effective from') as HTMLInputElement
  expect(monthBox.value).toBe('2026-02')
  expect(screen.getAllByText(/Defaults to Feb 2026/).length).toBeGreaterThan(0)
})

it('a blank amount saves the null end-marker', async () => {
  renderPanel(0)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Food budget' }))
  fireEvent.change(screen.getByLabelText('Food budget amount'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Food budget' }))
  await waitFor(() =>
    expect(putCategoryBudget).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ amount: null }),
    ),
  )
})

it('deletes a history row through the DELETE and drops it from the list', async () => {
  renderPanel(0)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Food budget' }))
  fireEvent.change(screen.getByLabelText('Food budget amount'), { target: { value: '425.00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Food budget' }))
  await screen.findByText('Mar 2026 — $425.00')
  fireEvent.click(
    screen.getByRole('button', { name: 'Delete the Mar 2026 budget row for Food' }),
  )
  await waitFor(() => expect(deleteCategoryBudget).toHaveBeenCalledWith(1, '2026-03-01'))
  await waitFor(() => expect(screen.queryByText('Mar 2026 — $425.00')).toBeNull())
})

it('rejects a negative amount client-side without calling the API', () => {
  renderPanel(0)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Food budget' }))
  fireEvent.change(screen.getByLabelText('Food budget amount'), { target: { value: '-5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Food budget' }))
  expect(putCategoryBudget).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toMatch(/non-negative/)
})

// --- seeded from averages (2026-09-07 spec §3) ---

it('offers Start from my averages in the empty state, seeds the FOCUSED month, refetches and toasts with Undo', async () => {
  render(<BudgetPanel matrix={blank} monthIndex={0} onBudgetsChanged={onBudgetsChanged} />)
  const button = (await screen.findByRole('button', {
    name: 'Start from my averages',
  })) as HTMLButtonElement
  await waitFor(() => expect(button.disabled).toBe(false))
  const hint = screen.getByText(/Writes a budget for 2 living categories/).textContent ?? ''
  expect(hint).toMatch(/effective from Jan 2026/)
  expect(hint).toMatch(/Feb 2025–Jan 2026/)
  fireEvent.click(button)
  await waitFor(() => expect(seedBudgets).toHaveBeenCalledWith('2026-01-01'))
  await waitFor(() => expect(onBudgetsChanged).toHaveBeenCalledTimes(1))
  expect(toast.success).toHaveBeenCalledWith(
    'Seeded 2 budgets from averages, from Jan 2026',
    expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }),
  )
  expect(screen.getByText('skipped 1 — 1 never spent')).toBeDefined()
  // Undo replays the batch, clears the status line and refetches.
  const options = vi.mocked(toast.success).mock.calls[0][1] as { action: { onAction: () => void } }
  options.action.onAction()
  await waitFor(() => expect(undoBatch).toHaveBeenCalledWith('b-1'))
  await waitFor(() => expect(onBudgetsChanged).toHaveBeenCalledTimes(2))
  expect(screen.queryByText('skipped 1 — 1 never spent')).toBeNull()
})

it('a seed that changed nothing offers no Undo', async () => {
  vi.mocked(seedBudgets).mockResolvedValue({ ...seeded, written: [], batch_id: null })
  render(<BudgetPanel matrix={blank} monthIndex={0} onBudgetsChanged={onBudgetsChanged} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Start from my averages' }))
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      'Seeded 0 budgets from averages, from Jan 2026',
      undefined,
    ),
  )
})

it('disables the seed with the reason under three complete months', async () => {
  vi.mocked(fetchBudgetSuggestions).mockResolvedValue({
    ...suggestions,
    window: { from: '2025-12-01', to: '2026-01-01', months: 2 },
  })
  render(<BudgetPanel matrix={blank} monthIndex={0} onBudgetsChanged={onBudgetsChanged} />)
  await screen.findByText(/needs at least three complete months of spending \(2 so far\)/)
  const button = screen.getByRole('button', { name: 'Start from my averages' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
})

it('degrades when the suggestions cannot load: seed disabled with the reason, editor intact, no chips', async () => {
  vi.mocked(fetchBudgetSuggestions).mockRejectedValue(new Error('boom'))
  render(<BudgetPanel matrix={blank} monthIndex={0} onBudgetsChanged={onBudgetsChanged} />)
  await screen.findByText(/couldn't load the suggestions/)
  expect(
    (screen.getByRole('button', { name: 'Start from my averages' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Set Food budget' }))
  expect(screen.getByLabelText('Food budget amount')).toBeDefined()
  expect(screen.queryByRole('button', { name: /^Use Food/ })).toBeNull()
})

it('the editor shows suggestion chips, a chip fills the amount box, and opening another row closes the first', async () => {
  renderPanel(0)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Food budget' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Use Food median $390.00' }))
  expect((screen.getByLabelText('Food budget amount') as HTMLInputElement).value).toBe('$390.00')
  fireEvent.click(screen.getByRole('button', { name: 'Use Food suggested $413.00' }))
  expect((screen.getByLabelText('Food budget amount') as HTMLInputElement).value).toBe('$413.00')
  // One editor at a time (spec §16): Rent's opens, Food's closes.
  fireEvent.click(screen.getByRole('button', { name: 'Set Rent budget' }))
  expect(screen.queryByLabelText('Food budget amount')).toBeNull()
  expect(screen.getByRole('button', { name: 'Use Rent last month $2,000.00' })).toBeDefined()
  expect(screen.getByText(/^Steady — within 10% every month/)).toBeDefined()
  // Reopening Food brings back what was typed — the draft lives in `editors`, not in the DOM.
  fireEvent.click(screen.getByRole('button', { name: 'Edit Food budget' }))
  expect((screen.getByLabelText('Food budget amount') as HTMLInputElement).value).toBe('$413.00')
  expect(screen.queryByLabelText('Rent budget amount')).toBeNull()
})

it('re-seeding asks first, counting the budgets it rewrites, and only POSTs on Confirm', async () => {
  renderPanel(0) // Food budgeted at 400 (seed 413 → a rewrite); Rent unbudgeted (seed 2000 → new)
  fireEvent.click(await screen.findByRole('button', { name: 'Re-seed from averages' }))
  expect(seedBudgets).not.toHaveBeenCalled()
  expect(screen.getByText(/Rewrites 1 existing budget and sets 1 new one from Jan 2026\./)).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByText(/Rewrites 1 existing/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Re-seed from averages' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() => expect(seedBudgets).toHaveBeenCalledWith('2026-01-01'))
  // The question is answered: the confirm line goes away with the POST, not with the response.
  await waitFor(() => expect(screen.queryByText(/Rewrites 1 existing/)).toBeNull())
})

it('a failed seed lands in the banner and refetches nothing', async () => {
  vi.mocked(seedBudgets).mockRejectedValue(new Error('down'))
  render(<BudgetPanel matrix={blank} monthIndex={0} onBudgetsChanged={onBudgetsChanged} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Start from my averages' }))
  expect((await screen.findByRole('alert')).textContent).toMatch(/Failed to seed the budgets/)
  expect(onBudgetsChanged).not.toHaveBeenCalled()
})

it('hides Re-seed when every seed already stands', async () => {
  // Both seeds equal the resolved budgets -> the server would skip both as unchanged, so
  // there is nothing left to re-seed and the card does not offer it.
  const settled: SpendingMatrix = {
    ...matrix,
    series: [
      { category_id: 1, values: ['300.00', '450.00'], budgets: ['413.00', '413.00'] },
      { category_id: 2, values: ['2000.00', '2000.00'], budgets: ['2000.00', '2000.00'] },
      { category_id: 3, values: [null, null], budgets: [null, null] },
    ],
    total_budget: ['2413.00', '2413.00'],
  }
  render(<BudgetPanel matrix={settled} monthIndex={0} onBudgetsChanged={onBudgetsChanged} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Food budget' }))
  await screen.findByRole('button', { name: 'Use Food median $390.00' }) // suggestions arrived
  expect(screen.queryByRole('button', { name: 'Re-seed from averages' })).toBeNull()
})

it('says Nothing to seed when every category is dormant', async () => {
  vi.mocked(fetchBudgetSuggestions).mockResolvedValue({
    ...suggestions,
    suggestions: suggestions.suggestions.map(
      (s): BudgetSuggestion => ({ ...s, seed: null, profile: 'dormant', skip_reason: 'dormant' }),
    ),
  })
  render(<BudgetPanel matrix={blank} monthIndex={0} onBudgetsChanged={onBudgetsChanged} />)
  await screen.findByText(/Nothing to seed — every category is dormant/)
  expect(
    (screen.getByRole('button', { name: 'Start from my averages' }) as HTMLButtonElement).disabled,
  ).toBe(true)
})

// --- 2026-09-23 spec §B5: the card opens where the budgets are -----------------------------

describe('the month the card reads (spec §B5)', () => {
  // The production shape that made the bug: budgets set from Sep 2026, the page's own focus
  // month still Aug 2026, today Sep 23 — the card said "No budgets yet" and offered to seed
  // a second, Aug-dated set.
  const SEP_BOOK: SpendingMatrix = {
    months: ['2026-07-01', '2026-08-01', '2026-09-01'],
    categories: matrix.categories,
    series: [
      { category_id: 1, values: ['300.00', '410.00', '0.00'], budgets: [null, null, '501.00'] },
      { category_id: 2, values: ['2072.23', '2072.23', '2072.23'], budgets: [null, null, '2164.00'] },
      { category_id: 3, values: [null, null, null], budgets: [null, null, null] },
    ],
    totals: ['2372.23', '2482.23', '2072.23'],
    net_pay: [null, null, null],
    savings_rate: [null, null, null],
    four_pct_rule: [null, null, null],
    total_budget: [null, null, '2665.00'],
  }
  const BLANK_BOOK: SpendingMatrix = {
    ...SEP_BOOK,
    series: SEP_BOOK.series.map((s) => ({ ...s, budgets: [null, null, null] })),
    total_budget: [null, null, null],
  }
  const onViewMonth = vi.fn()

  function pinToday(iso: string) {
    // Date only: Testing Library's waitFor still needs real timers.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${iso}T12:00:00`))
  }

  function renderBook(book: SpendingMatrix, monthIndex: number | null, defaultIndex = 1) {
    return render(
      <BudgetPanel
        matrix={book}
        monthIndex={monthIndex}
        defaultIndex={defaultIndex}
        onViewMonth={onViewMonth}
        onBudgetsChanged={onBudgetsChanged}
      />,
    )
  }

  const heading = () => screen.getByRole('heading', { level: 2 })

  beforeEach(() => pinToday('2026-09-23'))
  afterEach(() => vi.useRealTimers())

  it("with no month in the URL, opens on today's month when budgets are in force there", () => {
    renderBook(SEP_BOOK, null)
    expect(heading().textContent).toContain('Budgets — Sep 2026')
    expect(screen.getByRole('meter', { name: 'Food spend vs budget' })).toBeDefined()
    expect(screen.getByRole('meter', { name: 'Rent spend vs budget' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Start from my averages' })).toBeNull()
  })

  it("falls back to the latest earlier budgeted month when today's month is not entered yet", () => {
    pinToday('2026-10-05')
    renderBook(SEP_BOOK, null)
    expect(heading().textContent).toContain('Budgets — Sep 2026')
  })

  it("opens on the page's own month, with the seed, when no month has a budget", async () => {
    renderBook(BLANK_BOOK, null)
    expect(heading().textContent).toContain('Budgets — Aug 2026')
    const seed = (await screen.findByRole('button', {
      name: 'Start from my averages',
    })) as HTMLButtonElement
    await waitFor(() => expect(seed.disabled).toBe(false))
    fireEvent.click(seed)
    await waitFor(() => expect(seedBudgets).toHaveBeenCalledWith('2026-08-01'))
  })

  it('an explicit month always wins — and says where the budgets are instead of offering to seed', async () => {
    renderBook(SEP_BOOK, 1)
    expect(heading().textContent).toContain('Budgets — Aug 2026')
    expect(
      screen.getByText('No budgets in force for Aug 2026 — your 2 budgets start Sep 2026.'),
    ).toBeDefined()
    // The suggestions land, and still no seed: the book HAS budget rows, just not this month.
    await waitFor(() => expect(fetchBudgetSuggestions).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Start from my averages' })).toBeNull()
    expect(screen.queryByText('No budgets yet.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View Sep 2026' }))
    expect(onViewMonth).toHaveBeenCalledWith('2026-09-01')
    // The button that was pressed goes away with the month; the reader is handed the heading.
    await waitFor(() => expect(document.activeElement).toBe(heading()))
  })

  it('names budgets that ended, and budgets that resume, in their own words', () => {
    const ended: SpendingMatrix = {
      ...SEP_BOOK,
      series: [
        { ...SEP_BOOK.series[0], budgets: ['400.00', null, null] },
        { ...SEP_BOOK.series[1], budgets: [null, null, null] },
        SEP_BOOK.series[2],
      ],
    }
    renderBook(ended, 2)
    expect(
      screen.getByText('No budgets in force for Sep 2026 — your budgets were last in force in Jul 2026.'),
    ).toBeDefined()
    expect(screen.getByRole('button', { name: 'View Jul 2026' })).toBeDefined()
    cleanup()
    const gap: SpendingMatrix = {
      ...ended,
      series: [{ ...SEP_BOOK.series[0], budgets: ['400.00', null, '400.00'] }, ...ended.series.slice(1)],
    }
    renderBook(gap, 1)
    expect(
      screen.getByText('No budgets in force for Aug 2026 — your budgets resume Sep 2026.'),
    ).toBeDefined()
  })

  it('does not call a partial set "your N budgets"', () => {
    const staggered: SpendingMatrix = {
      ...SEP_BOOK,
      series: [
        { ...SEP_BOOK.series[0], budgets: [null, '400.00', '400.00'] },
        SEP_BOOK.series[1],
        SEP_BOOK.series[2],
      ],
    }
    renderBook(staggered, 0)
    expect(
      screen.getByText('No budgets in force for Jul 2026 — your budgets start Aug 2026.'),
    ).toBeDefined()
  })

  it('each budgeted row says since when its budget has been in force', () => {
    const changed: SpendingMatrix = {
      ...SEP_BOOK,
      series: [
        { ...SEP_BOOK.series[0], budgets: ['450.00', '501.00', '501.00'] },
        SEP_BOOK.series[1],
        SEP_BOOK.series[2],
      ],
    }
    renderBook(changed, null)
    const row = (name: string) => screen.getByText(name).closest('.budget-row') as HTMLElement
    expect(within(row('Food')).getByText('since Aug 2026')).toBeDefined()
    expect(within(row('Rent')).getByText('since Sep 2026')).toBeDefined()
  })

  it('marks the month in progress as month to date, and a finished month not at all', () => {
    renderBook(SEP_BOOK, null)
    expect(within(heading()).getByText('Month to date')).toBeDefined()
    expect(screen.getByText('0 of 2 budgeted categories over so far in Sep 2026')).toBeDefined()
    cleanup()
    pinToday('2026-10-05')
    renderBook(SEP_BOOK, 2)
    expect(screen.queryByText('Month to date')).toBeNull()
    expect(screen.getByText('0 of 2 budgeted categories over in Sep 2026')).toBeDefined()
  })

  it('a seed made from the default view keeps the card on the month it seeded', async () => {
    const view = renderBook(BLANK_BOOK, null)
    const seed = (await screen.findByRole('button', {
      name: 'Start from my averages',
    })) as HTMLButtonElement
    await waitFor(() => expect(seed.disabled).toBe(false))
    fireEvent.click(seed)
    await waitFor(() => expect(onBudgetsChanged).toHaveBeenCalledTimes(1))
    // The page refetches: budgets now resolve from Aug on — which also makes Sep (today's
    // month) budgeted. The card must not jump away from the month the reader just seeded.
    const seededBook: SpendingMatrix = {
      ...SEP_BOOK,
      series: SEP_BOOK.series.map((s, i) =>
        i < 2 ? { ...s, budgets: [null, i === 0 ? '413.00' : '2000.00', i === 0 ? '413.00' : '2000.00'] } : s,
      ),
    }
    const props = { defaultIndex: 1, onViewMonth, onBudgetsChanged }
    view.rerender(<BudgetPanel matrix={seededBook} monthIndex={null} {...props} />)
    expect(heading().textContent).toContain('Budgets — Aug 2026')
    // A month picked in the ribbon wins, and dropping it lands on the budgets' own month.
    view.rerender(<BudgetPanel matrix={seededBook} monthIndex={2} {...props} />)
    expect(heading().textContent).toContain('Budgets — Sep 2026')
    view.rerender(<BudgetPanel matrix={seededBook} monthIndex={null} {...props} />)
    expect(heading().textContent).toContain('Budgets — Sep 2026')
  })

  it('asks for a month when neither the URL, the budgets nor the page name one', () => {
    renderBook(BLANK_BOOK, null, -1)
    expect(screen.getByText('Select an entered month in the ribbon to review its budgets.')).toBeDefined()
    expect(screen.queryByRole('meter')).toBeNull()
  })
})

// A1/W6 (2026-09-13 audit): with no budgets the whole job of the card is to get one set, so the
// list is open and plain, and the seed sentence sits beside its button.
it('shows the unbudgeted list as an open plain section when the book has no budgets, with the seed sentence and button on one row', async () => {
  render(<BudgetPanel matrix={blank} monthIndex={0} onBudgetsChanged={onBudgetsChanged} />)
  expect(screen.getByRole('heading', { name: 'No budget yet (2)' })).toBeDefined()
  expect(document.querySelector('.budget-unbudgeted')?.tagName).toBe('SECTION')
  expect(screen.getByRole('button', { name: 'Set Food budget' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Set Rent budget' })).toBeDefined()
  const row = screen.getByText('No budgets yet.').closest('.budget-seed-row') as HTMLElement
  expect(within(row).getByRole('button', { name: 'Start from my averages' })).toBeDefined()
  await screen.findByText(/Writes a budget for 2 living categories/)
})
