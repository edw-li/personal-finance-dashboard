import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DividendOut, SecurityOut } from '../../types/api'
import DividendsPanel from './DividendsPanel'

vi.mock('../../api/portfolio', () => ({
  createDividend: vi.fn().mockResolvedValue({}),
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
import { createDividend } from '../../api/portfolio'

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
})
