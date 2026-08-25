import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpendingMatrix, SpendingYearly } from '../types/api'
import SpendingPage from './SpendingPage'

vi.mock('../api/spending', () => ({ fetchMatrix: vi.fn(), fetchYearly: vi.fn() }))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law) — what each
// chart draws is pinned in its option-builder tests; this marker says which charts are
// up and, via data-links, what the FLOW card drew. Clicking a marker stands in for a
// click on the chart's first month (dataIndex 0) — enough to walk the drill-in door.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
      onClick,
      ariaLabel,
    }: {
      option: {
        series?: { links?: { source?: string; target?: string; value?: number }[] }[]
      }
      onClick?: (params: { dataIndex?: number }) => void
      ariaLabel?: string
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'aria-label': ariaLabel,
        'data-links': (option.series?.[0]?.links ?? [])
          .map((l) => `${l.source}>${l.target}=${l.value}`)
          .join('|'),
        onClick: () => onClick?.({ dataIndex: 0 }),
      }),
  }
})
import { fetchMatrix, fetchYearly } from '../api/spending'

// --- fixtures ---------------------------------------------------------------------------
// Wire shapes of GET /spending/matrix and /spending/yearly — Decimal strings.

function matrixFixture(over: Partial<SpendingMatrix> = {}): SpendingMatrix {
  return {
    months: ['2026-06', '2026-07'],
    categories: [
      { id: 1, name: 'Rent', slug: 'rent', sort_order: 0, is_active: true },
      { id: 2, name: 'Groceries', slug: 'groceries', sort_order: 1, is_active: true },
      { id: 3, name: 'Fun', slug: 'fun', sort_order: 2, is_active: true },
    ],
    series: [
      { category_id: 1, values: ['2000.00', '2000.00'], budgets: [null, null] },
      { category_id: 2, values: ['600.00', '580.00'], budgets: [null, null] },
      { category_id: 3, values: ['150.00', '0.00'], budgets: [null, null] },
    ],
    totals: ['2750.00', '2580.00'],
    net_pay: ['6000.00', '6000.00'],
    savings_rate: ['0.541666667', '0.57'],
    four_pct_rule: [null, null],
    total_budget: [null, null],
    ...over,
  }
}

const YEARLY: SpendingYearly = {
  years: [
    {
      year: 2026,
      by_category: [
        { category_id: 1, total: '4000.00' },
        { category_id: 2, total: '1180.00' },
        { category_id: 3, total: '150.00' },
      ],
      total: '5330.00',
      net_pay_total: '12000.00',
      savings_rate: '0.555833333',
    },
  ],
}

// The flow marker is the one whose option carries sankey links.
const flowMarker = () =>
  screen.getAllByTestId('echart').find((el) => (el.getAttribute('data-links') ?? '') !== '')

function renderPage() {
  return render(
    <MemoryRouter>
      <SpendingPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(fetchMatrix).mockResolvedValue(matrixFixture())
  vi.mocked(fetchYearly).mockResolvedValue(YEARLY)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SpendingPage — the flow card', () => {
  it('draws the latest month by default: categories in stacked-chart order plus Saved', async () => {
    renderPage()
    expect(await screen.findByText('Where Jul 2026 went')).toBeTruthy()
    // All three categories are top-7 here; Fun is 0.00 in July, so it is omitted.
    expect(flowMarker()?.getAttribute('data-links')).toBe(
      'Net pay>Rent=2000|Net pay>Groceries=580|Net pay>Saved=3420',
    )
  })

  it('re-slices to the yearly rollup client-side on the Year toggle', async () => {
    renderPage()
    await screen.findByText('Where Jul 2026 went')

    fireEvent.click(screen.getByRole('button', { name: 'Year' }))

    expect(await screen.findByText('Where 2026 went')).toBeTruthy()
    expect(flowMarker()?.getAttribute('data-links')).toBe(
      'Net pay>Rent=4000|Net pay>Groceries=1180|Net pay>Fun=150|Net pay>Saved=6670',
    )
    // Both datasources were already on the page — the toggle never refetches.
    expect(vi.mocked(fetchMatrix)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchYearly)).toHaveBeenCalledTimes(1)
  })

  it('follows the drilled month (the pie month is the flow month)', async () => {
    renderPage()
    await screen.findByText('Where Jul 2026 went')

    // The FIRST marker is the top bars chart; a click drills into month index 0.
    fireEvent.click(screen.getAllByTestId('echart')[0])

    expect(await screen.findByText('Where Jun 2026 went')).toBeTruthy()
    expect(flowMarker()?.getAttribute('data-links')).toBe(
      'Net pay>Rent=2000|Net pay>Groceries=600|Net pay>Fun=150|Net pay>Saved=3250',
    )
  })

  it('asks for net pay instead of drawing a blank canvas', async () => {
    vi.mocked(fetchMatrix).mockResolvedValue(matrixFixture({ net_pay: [null, null] }))
    renderPage()

    expect(
      await screen.findByText('Enter net pay for Jul 2026 to see the flow.'),
    ).toBeTruthy()
    expect(flowMarker()).toBeUndefined()
  })
})

describe('SpendingPage — chart aria', () => {
  it('names the heatmap and the sankey for assistive tech', async () => {
    renderPage()
    await screen.findByText('Where Jul 2026 went')
    expect(
      document.querySelector(
        '[aria-label="Heatmap of spend per category per month — darker is more"]',
      ),
    ).not.toBeNull()
    expect(
      document.querySelector(
        '[aria-label="Sankey flow of where Jul 2026 went, from net pay into categories and savings"]',
      ),
    ).not.toBeNull()
  })
})
