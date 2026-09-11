import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaxSummaryOut } from '../../types/api'
import SummaryPanel from './SummaryPanel'

// echarts needs a real canvas and is NEVER rendered in jsdom (house law): what the waterfall
// DRAWS is pinned in taxChartOptions.test.ts; this file only asks what the table says.
vi.mock('../EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ ariaLabel }: { ariaLabel?: string }) =>
      createElement('div', { 'data-testid': 'echart', 'aria-label': ariaLabel }),
  }
})

// A single-earner year, and every figure hand-derivable from it: Medicare 1.45% of 420,000,
// Social Security 6.2% of a 304,500 capped base, SDI 1.3% of 420,000 — the shapes the
// sections carry, not the point of any test below.
function summaryFixture(over: Partial<TaxSummaryOut> = {}): TaxSummaryOut {
  const income = {
    agi: '420000.00', taxable_income: '400000.00', tax: '100000.00', effective_rate: '0.238095',
  }
  return {
    year: 2026,
    federal: income,
    state: income,
    medicare: {
      w2_income: '420000.00', taxable_wages: '420000.00', tax: '6090.00',
      effective_rate: '0.014500',
    },
    social_security: {
      w2_income: '420000.00', taxable_wages: '304500.00', tax: '18879.00',
      effective_rate: '0.044950',
    },
    disability: {
      w2_income: '420000.00', taxable_wages: '420000.00', tax: '5460.00',
      effective_rate: '0.013000',
    },
    capital_gains: {
      taxable_income: '400000.00', gains_amount: '0.00', tax: '0.00', effective_rate: null,
    },
    totals: {
      gross_income: '420000.00', total_income: '420000.00', total_tax: '130429.00',
      take_home: '289571.00', effective_rate: '0.310545',
    },
    warnings: [],
    ...over,
  }
}

// The married-joint version of the same year: Alex earns over the Social Security wage base
// and sits on an employer's voluntary Disability plan; Sam is under the base and on the
// state's default table. Every figure is the rate times the base beside it.
function twoEarnerSummary(): TaxSummaryOut {
  return summaryFixture({
    social_security: {
      w2_income: '420000.00', taxable_wages: '304500.00', tax: '18879.00',
      effective_rate: '0.044950',
      per_person: [
        {
          person_id: 1, name: 'Alex', w2_income: '300000.00', taxable_wages: '184500.00',
          tax: '11439.00', effective_rate: '0.038130', table: 'default',
        },
        {
          person_id: 4, name: 'Sam', w2_income: '120000.00', taxable_wages: '120000.00',
          tax: '7440.00', effective_rate: '0.062000', table: 'default',
        },
      ],
    },
    disability: {
      w2_income: '420000.00', taxable_wages: '420000.00', tax: '4560.00',
      effective_rate: '0.010857',
      per_person: [
        {
          person_id: 1, name: 'Alex', w2_income: '300000.00', taxable_wages: '300000.00',
          tax: '3000.00', effective_rate: '0.010000', table: 'own',
        },
        {
          person_id: 4, name: 'Sam', w2_income: '120000.00', taxable_wages: '120000.00',
          tax: '1560.00', effective_rate: '0.013000', table: 'default',
        },
      ],
    },
  })
}

const subRows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('tr.tax-person-row')) as HTMLElement[]

afterEach(cleanup)

describe('SummaryPanel — per-earner payroll rows', () => {
  it('renders one sub-row per earner under Social Security and Disability on a two-earner year', () => {
    const { container } = render(
      <SummaryPanel summary={twoEarnerSummary()} filingStatus="married_joint" />,
    )
    // Two per-worker jurisdictions, two earners: four lines, in the engine's column order
    // under the row each belongs to.
    const [alexSS, samSS, alexSDI, samSDI] = subRows(container)

    // Alex's Social Security: their OWN wage base and their own cap — the household row
    // above cannot say either, because it is the sum of two different bases.
    expect(within(alexSS).getByText('Alex')).toBeTruthy()
    expect(alexSS.textContent).toContain('$300,000.00')
    expect(alexSS.textContent).toContain('$184,500.00')
    expect(alexSS.textContent).toContain('$11,439.00')
    expect(alexSS.textContent).toContain('3.8%')
    expect(within(alexSS).getByText('capped at $184,500.00')).toBeTruthy()
    expect(within(alexSS).getByText('default')).toBeTruthy()

    // Sam is under the base: nothing was capped, so nothing says so.
    expect(within(samSS).getByText('Sam')).toBeTruthy()
    expect(samSS.textContent).toContain('$7,440.00')
    expect(samSS.textContent).toContain('6.2%')
    expect(samSS.textContent).not.toContain('capped at')

    // Disability: Alex walks a table of their own at 1%, Sam the year's default at 1.3% —
    // which is the whole reason the two rows cannot be one.
    expect(within(alexSDI).getByText('Alex')).toBeTruthy()
    expect(within(alexSDI).getByText('own table')).toBeTruthy()
    expect(alexSDI.textContent).toContain('$3,000.00')
    expect(alexSDI.textContent).toContain('1.0%')
    expect(within(samSDI).getByText('default')).toBeTruthy()
    expect(samSDI.textContent).toContain('1.3%')
    // The cap sentence belongs to Social Security alone: an SDI base that differs from W-2
    // wages is not a statutory wage base, and calling it one would be a guess.
    expect(alexSDI.textContent).not.toContain('capped at')
  })

  it('renders a sub-row for a single earner who uses their own table', () => {
    const { container } = render(
      <SummaryPanel
        summary={summaryFixture({
          disability: {
            w2_income: '420000.00', taxable_wages: '420000.00', tax: '4200.00',
            effective_rate: '0.010000',
            per_person: [
              {
                person_id: 1, name: 'Edward', w2_income: '420000.00',
                taxable_wages: '420000.00', tax: '4200.00', effective_rate: '0.010000',
                table: 'own',
              },
            ],
          },
        })}
        filingStatus="single"
      />,
    )
    // One earner, but the figure is NOT the year's default table: the line says whose rates
    // produced it, which is the only place that fact appears.
    const rows = subRows(container)
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByText('Edward')).toBeTruthy()
    expect(within(rows[0]).getByText('own table')).toBeTruthy()
  })

  it('says nothing about a cap for an earner whose own table taxes nothing', () => {
    const { container } = render(
      <SummaryPanel
        summary={summaryFixture({
          social_security: {
            w2_income: '420000.00', taxable_wages: '0.00', tax: '0.00',
            effective_rate: '0.000000',
            per_person: [
              {
                person_id: 1, name: 'Edward', w2_income: '420000.00',
                taxable_wages: '0.00', tax: '0.00', effective_rate: '0.000000',
                table: 'own',
              },
            ],
          },
        })}
        filingStatus="single"
      />,
    )
    // An all-zero table is the SS-EXEMPT job (spec §2.2): it taxes nothing and reports no
    // taxable wages at all. A base of 0 is below the earner's wages, but it is not a wage
    // base the walk stopped at — "capped at $0.00" would name a cap that does not exist.
    const rows = subRows(container)
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByText('Edward')).toBeTruthy()
    expect(within(rows[0]).getByText('own table')).toBeTruthy()
    expect(rows[0].textContent).not.toContain('capped at')
  })

  it('renders no sub-rows for a single earner on the default table', () => {
    const { container } = render(
      <SummaryPanel
        summary={summaryFixture({
          social_security: {
            w2_income: '420000.00', taxable_wages: '304500.00', tax: '18879.00',
            effective_rate: '0.044950',
            per_person: [
              {
                person_id: 1, name: 'Edward', w2_income: '420000.00',
                taxable_wages: '304500.00', tax: '18879.00', effective_rate: '0.044950',
                table: 'default',
              },
            ],
          },
        })}
        filingStatus="single"
      />,
    )
    // A sub-row is an EXPLANATION, and one earner on the year's own table has nothing to
    // explain: that year reads exactly as it did before per-person tables existed.
    expect(subRows(container)).toHaveLength(0)
    expect(screen.getByText('Social Security')).toBeTruthy()
    expect(screen.queryByText('Edward')).toBeNull()
  })

  it('renders no sub-rows for a stored payload that predates per_person', () => {
    // The pinned golden shape: the sections carry no list at all, and the table is the six
    // household rows it has always been.
    const { container } = render(
      <SummaryPanel summary={summaryFixture()} filingStatus="single" />,
    )
    expect(subRows(container)).toHaveLength(0)
    expect(screen.getByText('Social Security')).toBeTruthy()
    expect(screen.getByText('Disability')).toBeTruthy()
  })
})
