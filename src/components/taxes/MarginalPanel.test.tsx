import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaxBracketsOut, TaxSummaryOut } from '../../types/api'
import MarginalPanel from './MarginalPanel'

// echarts needs a real canvas and is NEVER rendered in jsdom (house law): what the ladder
// DRAWS is pinned in taxChartOptions.test.ts; this file only asks whether it is on screen.
vi.mock('../EChart', async () => {
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
        'data-series': (option.series ?? []).map((s) => s.name ?? '').join('|'),
      }),
  }
})

function bracketsFixture(
  over: Partial<TaxBracketsOut['jurisdictions']> = {},
): TaxBracketsOut {
  return {
    year: 2026,
    filing_status: 'single',
    statuses_with_rows: ['single'],
    jurisdictions: {
      federal: [
        { bracket_index: 1, rate: '0.1000', threshold: '0.00' },
        { bracket_index: 2, rate: '0.1200', threshold: '11600.00' },
        { bracket_index: 3, rate: '0.2200', threshold: '47150.00' },
        { bracket_index: 4, rate: '0.2400', threshold: '100525.00' },
      ],
      state: [
        { bracket_index: 1, rate: '0.0100', threshold: '0.00' },
        { bracket_index: 2, rate: '0.0930', threshold: '10000.00' },
      ],
      medicare: [
        { bracket_index: 1, rate: '0.014500', threshold: '0.00' },
        { bracket_index: 2, rate: '0.023500', threshold: '200000.00' },
      ],
      social_security: [],
      disability: [],
      capital_gains: [],
      ...over,
    },
  }
}

// Taxable incomes chosen against the tables above so every figure is hand-derivable:
// federal 50000 → next $1,000 at 22% = $220; state 60000 → 9.3% = $93; combined wages
// 250000 sit above the 200k Medicare tier → (2.35% − 1.45%) × 1000 = $9.
function summaryFixture(over: Partial<TaxSummaryOut> = {}): TaxSummaryOut {
  const wage = {
    w2_income: '260000.00',
    taxable_wages: '250000.00',
    tax: '0.00',
    effective_rate: null,
  }
  return {
    year: 2026,
    federal: {
      agi: '65000.00', taxable_income: '50000.00', tax: '6053.00', effective_rate: '0.093123',
    },
    state: {
      agi: '65000.00', taxable_income: '60000.00', tax: '4750.00', effective_rate: '0.073077',
    },
    medicare: wage,
    social_security: wage,
    disability: wage,
    capital_gains: {
      taxable_income: '50000.00', gains_amount: '0.00', tax: '0.00', effective_rate: null,
    },
    totals: {
      gross_income: '65000.00', total_income: '65000.00', total_tax: '10803.00',
      take_home: '54197.00', effective_rate: '0.166200',
    },
    warnings: [],
    ...over,
  }
}

afterEach(cleanup)

describe('MarginalPanel', () => {
  it('prices the next $1,000 per jurisdiction, with the Medicare tier clause', () => {
    render(<MarginalPanel summary={summaryFixture()} brackets={bracketsFixture()} />)
    expect(
      screen.getByText(
        'Your next $1,000 of ordinary income costs $220.00 federal + $93.00 state + $9.00 additional Medicare (combined wages sit above the top Medicare tier).',
      ),
    ).toBeTruthy()
    // Drawable tables → the ladder is on screen, marker series and all.
    expect(screen.getByTestId('echart').getAttribute('data-series')).toContain('Taxable income')
    // Mounted through ChartCard, naming what it draws (F11).
    expect(screen.getByLabelText(/Bracket ladder per jurisdiction/)).toBeTruthy()
  })

  it('drops the Medicare clause when combined wages sit below the tier', () => {
    const summary = summaryFixture()
    summary.medicare = { ...summary.medicare, taxable_wages: '150000.00' }
    render(<MarginalPanel summary={summary} brackets={bracketsFixture()} />)
    expect(
      screen.getByText('Your next $1,000 of ordinary income costs $220.00 federal + $93.00 state.'),
    ).toBeTruthy()
  })

  it('names only the jurisdictions that HAVE a table — no $0.00 for a missing one', () => {
    render(<MarginalPanel summary={summaryFixture()} brackets={bracketsFixture({ state: [] })} />)
    expect(
      screen.getByText(
        'Your next $1,000 of ordinary income costs $220.00 federal + $9.00 additional Medicare (combined wages sit above the top Medicare tier).',
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/state/)).toBeNull()
  })

  it('offers the empty note when neither ordinary table exists', () => {
    render(
      <MarginalPanel
        summary={summaryFixture()}
        brackets={bracketsFixture({ federal: [], state: [] })}
      />,
    )
    expect(screen.getByText(/the ladder has nothing to walk/i)).toBeTruthy()
    expect(screen.queryByTestId('echart')).toBeNull()
  })

  it('renders nothing at all on a refusal year', () => {
    // The router's refusal payload carries NO sections (they are null on the wire); the
    // summary card above owns that call to action, and a second card would be noise.
    const refused = {
      year: 2026,
      brackets_missing_for_status: ['federal'],
      warnings: [],
    } as unknown as TaxSummaryOut
    const { container } = render(<MarginalPanel summary={refused} brackets={bracketsFixture()} />)
    expect(container.firstChild).toBeNull()
  })

  it('keeps the sentence but skips the chart when the ladder is undrawable', () => {
    // One bracket at $0 on a zero-income year: the cap computes to 0 and there is no bar
    // to draw — but the next $1,000 still has a price, and the sentence carries it.
    const summary = summaryFixture()
    summary.federal = { ...summary.federal, taxable_income: '0.00' }
    summary.medicare = { ...summary.medicare, taxable_wages: '0.00' }
    render(
      <MarginalPanel
        summary={summary}
        brackets={bracketsFixture({
          federal: [{ bracket_index: 1, rate: '0.1000', threshold: '0.00' }],
          state: [],
        })}
      />,
    )
    expect(
      screen.getByText('Your next $1,000 of ordinary income costs $100.00 federal.'),
    ).toBeTruthy()
    expect(screen.queryByTestId('echart')).toBeNull()
  })
})
