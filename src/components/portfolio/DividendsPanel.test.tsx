import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DividendOut, SecurityOut } from '../../types/api'
import DividendsPanel from './DividendsPanel'
import ToastProvider from '../ToastProvider'

vi.mock('../../api/portfolio', () => ({
  createDividend: vi.fn().mockResolvedValue({}),
  updateDividend: vi.fn().mockResolvedValue({}),
  deleteDividend: vi.fn().mockResolvedValue(undefined),
}))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law) — what the bars
// carry is pinned in dividendChartOptions.test.ts; this marker says whether one is up and,
// via the categories, which window fed it.
vi.mock('../EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ option }: { option: { xAxis?: { data?: unknown[] } } }) =>
      createElement('div', {
        'data-testid': 'echart',
        'data-categories': (option.xAxis?.data ?? []).join(','),
      }),
  }
})
import { createDividend, deleteDividend, updateDividend } from '../../api/portfolio'

const securities: SecurityOut[] = [{
  id: 1, ticker: 'NVDA', name: 'NVIDIA', industry: 'Semis', holding_type: 'stock',
  is_manual_priced: false, is_active: true, annual_dividend: '0.0400', ex_div_date: null,
}]

function dividend(over: Partial<DividendOut> = {}): DividendOut {
  return {
    id: 1, security_id: 1, account: 'RH Taxable', pay_date: '2025-12-15',
    amount: '100.00', source: 'manual', ex_date: null, per_share: null,
    shares_held: null, notes: null,
    ...over,
  }
}

// The refresh's own row: pay_date == ex_date, and the per-share × shares that produced it.
const AUTO = dividend({
  id: 2, pay_date: '2026-06-19', amount: '8.20', source: 'auto',
  ex_date: '2026-06-19', per_share: '0.820000', shares_held: '10.000000',
})

// The panel reads its own todayIso(), so the clock is pinned rather than derived —
// LOCAL noon (no trailing Z) so the calendar date is 2026-08-20 in every zone.
function pinToday(): void {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-20T12:00:00'))
}

// StatTile has no role of its own; read the value that sits beside a known label.
function tileValue(label: string): string {
  return screen.getByText(label).parentElement!.querySelector('.stat-value')!.textContent!
}

function renderPanel(dividends: DividendOut[], annualIncome: string | null = '432.10', onChanged = () => {}) {
  return render(
    <DividendsPanel
      securities={securities}
      dividends={dividends}
      annualIncome={annualIncome}
      onChanged={onChanged}
    />,
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('DividendsPanel ownership', () => {
  it('badges every row with its owner and spells out the resurrect rule', () => {
    renderPanel([dividend(), AUTO])
    // Scoped to the table: the hint's legend badge carries the same word, so an unscoped
    // getByText('auto') matches two nodes and throws.
    const table = within(screen.getByRole('table'))
    expect(table.getByText('auto')).toBeTruthy()
    expect(table.getByText('manual')).toBeTruthy()
    expect(screen.getByText(/deleting one brings it back next run/)).toBeTruthy()
    expect(screen.getByText(/recorded on the ex-date/)).toBeTruthy()
  })

  it("shows an auto row's per-share × shares and dashes a manual one", () => {
    renderPanel([dividend(), AUTO])
    const rows = within(screen.getByRole('table')).getAllByRole('row')
    // rows[0] is the header; the two data rows keep the caller's order.
    expect(within(rows[1]).getByText('—')).toBeTruthy() // manual: no event provenance
    expect(within(rows[2]).getByText('$0.82')).toBeTruthy()
    expect(within(rows[2]).getByText('× 10')).toBeTruthy()
  })
})

describe('DividendsPanel income analytics', () => {
  it('sums the trailing year and the calendar year, and takes the projection verbatim', () => {
    pinToday()
    renderPanel([dividend(), AUTO])
    // Dec 2025 (100.00) is inside the trailing 12 but outside 2026; June's 8.20 is in both.
    expect(tileValue('Trailing 12-mo income')).toBe('$108.20')
    expect(tileValue('YTD income')).toBe('$8.20')
    // The server's totals.annual_income, untouched.
    expect(tileValue('Projected annual income')).toBe('$432.10')
  })

  it('charts the trailing 24 months ending on the current one', () => {
    pinToday()
    renderPanel([AUTO])
    const categories = screen.getByTestId('echart').getAttribute('data-categories')!.split(',')
    expect(categories).toHaveLength(24)
    expect(categories[0]).toBe('Sep 2024')
    expect(categories[23]).toBe('Aug 2026')
  })

  it('dashes the projection tile when nothing is priced yet', () => {
    pinToday()
    renderPanel([AUTO], null)
    expect(tileValue('Projected annual income')).toBe('—')
  })

  it('draws no tiles and no chart on an empty log', () => {
    pinToday()
    renderPanel([])
    expect(screen.queryByText('Trailing 12-mo income')).toBeNull()
    expect(screen.queryByTestId('echart')).toBeNull()
    expect(screen.getByText('No dividends recorded.')).toBeTruthy()
  })
})

describe('DividendsPanel manual entry', () => {
  it('still posts a hand-entered dividend with the typed values', async () => {
    const onChanged = vi.fn()
    renderPanel([], '432.10', onChanged)
    // fireEvent, not user-event: @testing-library/user-event is not a devDependency here
    // (TransactionsPanel.test.tsx's sanctioned substitution).
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/account/i), { target: { value: 'Fidelity' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2026-08-03' } })
    // Exact label, not /amount/i: the panel title's ⓘ carries an aria-label ending
    // "…the per-share amount;…", and getByLabelText reads aria-label too, so the loose
    // regex now matches the hint button as well as this field. Same input, named exactly.
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '4.10' } })
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(vi.mocked(createDividend).mock.calls[0][0]).toMatchObject({
      security_id: 1, account: 'Fidelity', pay_date: '2026-08-03', amount: '4.10',
    })
  })

  it('canonicalizes a grouped amount at the wire boundary with no blur', async () => {
    const onChanged = vi.fn()
    renderPanel([], '432.10', onChanged)
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2026-08-03' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1,050' } })
    // Typed and clicked, never blurred — the belt in submit() is what strips the grouping
    // comma a Decimal column would reject.
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(vi.mocked(createDividend).mock.calls[0][0]).toMatchObject({ amount: '1050' })
  })

  it('refuses a whitespace-only amount client-side', () => {
    renderPanel([])
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2026-08-03' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '   ' } })
    // Spaces are not a number: the guard trims, matching TransactionsPanel's. Untrimmed it
    // would reach the API as "" and 422 as an opaque pydantic decimal-parse error.
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    expect(screen.getByText('Security, pay date and amount are required')).toBeTruthy()
    expect(createDividend).not.toHaveBeenCalled()
  })
})

// Spec §5.1: the log was append-and-delete only — a typo'd amount cost a delete and a
// retype. The form-swap edit is TransactionsPanel's, mirrored.
describe('DividendsPanel editing', () => {
  it('round-trips a row through PATCH with the exact body', async () => {
    const onChanged = vi.fn()
    renderPanel([dividend()], '432.10', onChanged)
    fireEvent.click(screen.getByRole('button', { name: 'Edit this dividend' }))
    // Seeded from the SERVER strings, verbatim (the plain text boxes show them as stored).
    expect((screen.getByLabelText(/account/i) as HTMLInputElement).value).toBe('RH Taxable')
    expect((screen.getByLabelText(/pay date/i) as HTMLInputElement).value).toBe('2025-12-15')
    // The security is frozen: DividendUpdate carries no security_id, so a row cannot be
    // moved between tickers by an edit (TransactionsPanel's rule).
    expect((screen.getByLabelText(/security/i) as HTMLSelectElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '125.50' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    // Exact, not toMatchObject — and NOT because the server would refuse a leaked
    // security_id: DividendUpdate is a plain BaseModel, so pydantic's default config
    // IGNORES extra keys and one would travel entirely unnoticed. That silence is the
    // reason the body is pinned whole: a stray key costs nothing today and quietly starts
    // being honoured the day the schema grows a field by that name.
    expect(updateDividend).toHaveBeenCalledWith(1, {
      account: 'RH Taxable', pay_date: '2025-12-15', amount: '125.50', notes: null,
    })
    expect(createDividend).not.toHaveBeenCalled()
    // An edit is a one-off correction: the form resets whole, and the security is free again.
    expect((screen.getByLabelText(/account/i) as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: /add dividend/i })).toBeTruthy()
  })

  it('Cancel abandons the edit and re-arms the create form', () => {
    renderPanel([dividend()])
    fireEvent.click(screen.getByRole('button', { name: 'Edit this dividend' }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect((screen.getByLabelText(/account/i) as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull()
    expect((screen.getByLabelText(/security/i) as HTMLSelectElement).disabled).toBe(false)
  })

  it('deleting the row being edited resets the form — on success only', async () => {
    const onChanged = vi.fn()
    renderPanel([dividend()], '432.10', onChanged)
    fireEvent.click(screen.getByRole('button', { name: 'Edit this dividend' }))
    // A FAILED delete leaves the row standing, so the edit session must survive it.
    vi.mocked(deleteDividend).mockRejectedValueOnce(new Error('network'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete this dividend' }))
    await waitFor(() => expect(screen.getByText('Delete failed')).toBeTruthy())
    expect(screen.getByRole('button', { name: /save changes/i })).toBeTruthy()
    expect(onChanged).not.toHaveBeenCalled()
    // The successful one takes the row away — a stale editingId would PATCH a 404 next save.
    fireEvent.click(screen.getByRole('button', { name: 'Delete this dividend' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /add dividend/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull()
  })

  it('deletes instantly and Undo re-creates the payment through the POST', async () => {
    const onChanged = vi.fn()
    render(
      <ToastProvider>
        <DividendsPanel
          securities={securities}
          dividends={[dividend()]}
          annualIncome="432.10"
          onChanged={onChanged}
        />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete this dividend' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Deleted the NVDA dividend paid Dec 15, 2025')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    // DividendCreate's shape exactly — no id, no provenance fields (an undone auto row
    // comes back as manual, which is honest: the refresh re-writes auto rows anyway).
    await waitFor(() =>
      expect(vi.mocked(createDividend)).toHaveBeenCalledWith({
        security_id: 1,
        account: 'RH Taxable',
        pay_date: '2025-12-15',
        amount: '100.00',
        notes: null,
      }),
    )
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2))
  })

  it('offers NO Undo on an auto row — an undo would double-count the next refresh', async () => {
    const onChanged = vi.fn()
    render(
      <ToastProvider>
        <DividendsPanel
          securities={securities}
          dividends={[AUTO]}
          annualIncome="432.10"
          onChanged={onChanged}
        />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete this dividend' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    // The receipt still lands — only the offer is withheld: an undone auto row re-enters
    // as 'manual' and the next refresh re-adds its auto twin on top (double-counted
    // income). The ingest self-heals, so the row comes back on its own next run.
    expect(screen.getByText('Deleted the NVDA dividend paid Jun 19, 2026')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(createDividend).not.toHaveBeenCalled()
  })
})

describe('DividendsPanel entry session', () => {
  it('keeps security/account/pay date after an add, clears the payment, focuses amount', async () => {
    const onChanged = vi.fn()
    renderPanel([], '432.10', onChanged)
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/account/i), { target: { value: 'Fidelity' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2026-08-03' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '4.10' } })
    fireEvent.change(screen.getByLabelText(/notes/i), { target: { value: 'Q3' } })
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect((screen.getByLabelText(/security/i) as HTMLSelectElement).value).toBe('1')
    expect((screen.getByLabelText(/account/i) as HTMLInputElement).value).toBe('Fidelity')
    expect((screen.getByLabelText(/pay date/i) as HTMLInputElement).value).toBe('2026-08-03')
    const amount = screen.getByLabelText('Amount') as HTMLInputElement
    expect(amount.value).toBe('')
    expect((screen.getByLabelText(/notes/i) as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(amount)
    expect(screen.getByRole('button', { name: /add another/i })).toBeTruthy()
    expect(screen.getByText(/security, account and date kept/i)).toBeTruthy()
  })

  it('never resurrects the pre-reset amount when the caret was still in the money box', async () => {
    const onChanged = vi.fn()
    renderPanel([], '432.10', onChanged)
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2026-08-03' } })
    // A REAL focus, not fireEvent.focus: only this moves jsdom's activeElement. The form
    // carries no data-entry-scope, so Enter is the browser's implicit submit and leaves the
    // caret in this box — and jsdom's click does not move focus either, so the click below
    // models that Enter faithfully.
    const amount = screen.getByLabelText('Amount') as HTMLInputElement
    act(() => amount.focus())
    fireEvent.change(amount, { target: { value: '$1,050' } })
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    // Here the focus target IS the box the caret is in, so today's transfer fires no blur
    // at all and there is nothing to resurrect. The pin is the guard on that coincidence:
    // it holds the panel to 998f05c's ordering the day this form grows a second committing
    // box (a per-share entry, say) or moves the focus target off the amount.
    expect(amount.value).toBe('')
    expect(document.activeElement).toBe(amount)
  })

  it('gates the row actions while a save is in flight', () => {
    // A create that never settles: busy stays true for the rest of the test.
    vi.mocked(createDividend).mockReturnValueOnce(new Promise<never>(() => {}))
    renderPanel([dividend()])
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2026-08-03' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '4.10' } })
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    // The in-flight save's .then closes over editingId as it was at SUBMIT time, so a
    // mid-flight Edit would have its seed wiped by the reset that lands afterwards — the
    // row buttons are simply shut for the duration (TransactionsPanel's rule).
    fireEvent.click(screen.getByRole('button', { name: 'Edit this dividend' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete this dividend' }))
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull()
    // Still the typed row, not the ledger row's 2025-12-15 seed.
    expect((screen.getByLabelText(/pay date/i) as HTMLInputElement).value).toBe('2026-08-03')
    expect(
      (screen.getByRole('button', { name: 'Edit this dividend' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Delete this dividend' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('drops the kept cue when the security changes', async () => {
    const onChanged = vi.fn()
    renderPanel([], '432.10', onChanged)
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2026-08-03' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '4.10' } })
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(screen.getByText(/security, account and date kept/i)).toBeTruthy()
    // The cue names the security as kept; the moment it is changed the sentence is a lie.
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '' } })
    expect(screen.queryByText(/kept/i)).toBeNull()
    expect(screen.getByRole('button', { name: /add dividend/i })).toBeTruthy()
  })
})
