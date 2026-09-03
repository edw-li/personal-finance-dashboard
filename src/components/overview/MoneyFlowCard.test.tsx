import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { MoneyFlowOut } from '../../types/api'

// echarts needs a real canvas and is never rendered in jsdom (house law); what the chart
// DRAWS is pinned in moneyFlowOptions.test.ts.
vi.mock('../EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ ariaLabel }: { ariaLabel?: string }) =>
      // ChartCard hands every mount its house sentence (F11) — the card test reads it.
      createElement('div', { 'data-testid': 'echart', 'aria-label': ariaLabel }),
  }
})

import MoneyFlowCard from './MoneyFlowCard'

function flowOut(over: Partial<MoneyFlowOut> = {}): MoneyFlowOut {
  return {
    year: 2026,
    available_years: [2024, 2025, 2026],
    renderable: true,
    reason: null,
    warnings: ['net pay entered 7/12 months'],
    sources: {
      salary_and_bonus: '220000.00',
      rsu_vests: '80000.00',
      espp: '4000.00',
      investment_income: '2500.00',
      other_income: '1000.00',
      salary_people: [],
    },
    gross_income: '307500.00',
    taxes: {
      total: '67016.05',
      federal: '26520.00',
      state: '14225.00',
      medicare: '4345.65',
      social_security: '18581.40',
      disability: '3344.00',
      capital_gains: '0.00',
    },
    pre_tax_savings: '27300.00',
    take_home_cash: '120000.00',
    retained_equity: '93183.95',
    categories: [
      { name: 'Rent', amount: '24000.00' },
      { name: 'Food', amount: '6000.00' },
    ],
    other_spend: null,
    total_spend: '30000.00',
    saved: '90000.00',
    ...over,
  }
}

const onRetry = vi.fn()
const onYearChange = vi.fn()

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderCard(flow: MoneyFlowOut | null, failed = false) {
  return render(
    <MoneyFlowCard flow={flow} failed={failed} onRetry={onRetry} onYearChange={onYearChange} />,
  )
}

it('renders the chart, the year chips with the active year, and the warnings line', () => {
  renderCard(flowOut())
  expect(screen.getByText('Money flow — 2026')).toBeDefined()
  expect(screen.getByTestId('echart')).toBeDefined()
  const chips = screen.getByRole('group', { name: 'Money-flow year' })
  const buttons = Array.from(chips.querySelectorAll('button'))
  expect(buttons.map((b) => b.textContent)).toEqual(['2024', '2025', '2026'])
  expect(buttons[2].getAttribute('aria-pressed')).toBe('true')
  expect(buttons[0].getAttribute('aria-pressed')).toBe('false')
  // Server warning sentences render verbatim, muted, under the chart.
  expect(screen.getByText('net pay entered 7/12 months')).toBeDefined()
  // The card's chrome is ChartCard's now: an export row and the house aria sentence.
  expect(screen.getByRole('group', { name: /Export money-flow/ })).toBeDefined()
  expect(screen.getByLabelText(/Sankey diagram of 2026 money flow/)).toBeDefined()
  // The InfoHint explains the residual and the sources (spec §5's card copy).
  expect(screen.getByLabelText(/vest shares kept \+ ESPP contributions \+ timing/)).toBeDefined()
})

it('hands a chip press to onYearChange', () => {
  renderCard(flowOut())
  fireEvent.click(screen.getByRole('button', { name: '2024' }))
  expect(onYearChange).toHaveBeenCalledWith(2024)
})

it('renders the refusal reason verbatim instead of a chart — chips stay for the escape', () => {
  renderCard(
    flowOut({
      renderable: false,
      reason:
        'No tax inputs are stored for 2031 — enter the year on the Taxes page to draw its money flow.',
      warnings: ['no tax inputs stored for 2031'],
    }),
  )
  expect(screen.queryByTestId('echart')).toBeNull()
  expect(
    screen.getByText(
      'No tax inputs are stored for 2031 — enter the year on the Taxes page to draw its money flow.',
    ),
  ).toBeDefined()
  // The chip row survives a refusal: available_years is how the user gets OUT of an
  // empty year.
  expect(screen.getByRole('group', { name: 'Money-flow year' })).toBeDefined()
  expect(screen.getByText('no tax inputs stored for 2031')).toBeDefined()
})

it('joins multiple warnings with the house dot separator', () => {
  renderCard(flowOut({ warnings: ['net pay entered 7/12 months', 'spending entered 5/12 months'] }))
  expect(
    screen.getByText('net pay entered 7/12 months · spending entered 5/12 months'),
  ).toBeDefined()
})

it('a failed fetch renders the inline error with a working Retry', () => {
  renderCard(null, true)
  expect(screen.getByText("Couldn't load the money flow.")).toBeDefined()
  expect(screen.queryByTestId('echart')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading the money flow' }))
  expect(onRetry).toHaveBeenCalledTimes(1)
})

it('renders only the header while the first fetch is in flight', () => {
  renderCard(null, false)
  expect(screen.getByText('Money flow')).toBeDefined()
  expect(screen.queryByTestId('echart')).toBeNull()
  expect(screen.queryByRole('group', { name: 'Money-flow year' })).toBeNull()
})

it('skeletons while the first fetch is in flight', () => {
  renderCard(null, false)
  // Nothing to hold under a dim on a first paint, so the card shows its own skeleton.
  expect(document.querySelector('.chart-card-skeleton')).toBeTruthy()
})
