import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpendingMatrix, SpendingYearly } from '../types/api'
import SpendingPage from './SpendingPage'

vi.mock('../api/spending', () => ({ fetchMatrix: vi.fn(), fetchYearly: vi.fn() }))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law) — what each
// chart draws is pinned in its option-builder tests; this marker says which charts are
// up and, via data-* attributes, the option/prop slices these page tests pin: sankey
// links (the flow card), legend.selected (persistence), the first dataZoom entry
// (window persistence), a sampled valueFormatter (the unsigned savings rate) and the
// export name. Clicking a marker stands in for a click on the chart's first month
// (dataIndex 0); mouseEnter/mouseLeave stand in for the legendselectchanged/datazoom
// chart events jsdom cannot raise.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
      onClick,
      onLegendChange,
      onDataZoom,
      exportConfig,
    }: {
      option: {
        series?: { links?: { source?: string; target?: string; value?: number }[] }[]
        legend?: { selected?: Record<string, boolean> }
        dataZoom?: { startValue?: number; endValue?: number }[]
        tooltip?: { valueFormatter?: (value: unknown) => string }
      }
      onClick?: (params: { dataIndex?: number }) => void
      onLegendChange?: (selected: Record<string, boolean>) => void
      onDataZoom?: (window: { startValue: number; endValue: number }) => void
      exportConfig?: { name: string }
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'data-links': (option.series?.[0]?.links ?? [])
          .map((l) => `${l.source}>${l.target}=${l.value}`)
          .join('|'),
        'data-legend-selected': JSON.stringify(option.legend?.selected ?? null),
        'data-zoom': JSON.stringify(option.dataZoom?.[0] ?? null),
        'data-pct-sample': option.tooltip?.valueFormatter?.(0.35) ?? '',
        'data-export-name': exportConfig?.name ?? '',
        onClick: () => onClick?.({ dataIndex: 0 }),
        onMouseEnter: () => onLegendChange?.({ 'Net pay': false, '4% rule': true }),
        onMouseLeave: () => onDataZoom?.({ startValue: 1, endValue: 1 }),
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

// The URL as the router holds it — the deep-link tests pin both directions of the
// drill↔URL sync.
function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>
}

function renderPage(entry = '/spending') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SpendingPage />
      <LocationProbe />
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

describe('SpendingPage — tooltip fixes', () => {
  it('prints the savings-rate tooltip unsigned — a rate is a level, not a movement', async () => {
    renderPage()
    await screen.findByText('Where Jul 2026 went')
    const samples = screen
      .getAllByTestId('echart')
      .map((el) => el.getAttribute('data-pct-sample'))
    expect(samples).toContain('35.0%') // the savings chart's valueFormatter, sampled at 0.35
    expect(samples).not.toContain('+35.0%')
  })

  it('opts the bars chart into the export menu as "spending"', async () => {
    renderPage()
    await screen.findByText('Where Jul 2026 went')
    expect(screen.getAllByTestId('echart')[0].getAttribute('data-export-name')).toBe('spending')
  })
})

describe('SpendingPage — ?month= deep link (2026-08-25 spec §2d)', () => {
  it('opens the month drill-in straight from the URL', async () => {
    renderPage('/spending?month=2026-06')
    expect(await screen.findByText('Spending breakdown — Jun 2026')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'All months' })).toBeTruthy()
  })

  it('ignores a month the matrix does not carry — no drill, no crash', async () => {
    renderPage('/spending?month=banana')
    expect(await screen.findByText(/Monthly spend vs net pay/)).toBeTruthy()
    expect(screen.queryByText(/Spending breakdown/)).toBeNull()
  })

  it('mirrors a bar-click drill into the URL and clears it on the way back', async () => {
    renderPage()
    await screen.findByText('Where Jul 2026 went')
    fireEvent.click(screen.getAllByTestId('echart')[0]) // the bars chart, dataIndex 0
    expect(await screen.findByText('Spending breakdown — Jun 2026')).toBeTruthy()
    // The fixture months carry no '-01' suffix; the contract is string equality with
    // matrix.months entries, which in production are the wizard's YYYY-MM-01 grammar.
    expect(screen.getByTestId('location').textContent).toBe('/spending?month=2026-06')
    fireEvent.click(screen.getByRole('button', { name: 'All months' }))
    await screen.findByText(/Monthly spend vs net pay/)
    expect(screen.getByTestId('location').textContent).toBe('/spending')
  })
})

describe('SpendingPage — legend + zoom persistence (2026-08-25 spec §2e)', () => {
  it('keeps legend toggles across an option rebuild — the budget-line reset bug dies', async () => {
    renderPage()
    await screen.findByText('Where Jul 2026 went')
    const bars = screen.getAllByTestId('echart')[0]
    // Before any toggle: only the shipped default rides legend.selected.
    expect(bars.getAttribute('data-legend-selected')).toBe(
      JSON.stringify({ 'Total budget': false }),
    )
    fireEvent.mouseEnter(bars) // stands in for legendselectchanged {'Net pay': false, '4% rule': true}
    // Rebuild the options with a fresh identity — the active chip re-press class of event.
    fireEvent.click(screen.getByRole('button', { name: '1Y' }))
    expect(
      JSON.parse(
        screen.getAllByTestId('echart')[0].getAttribute('data-legend-selected') ?? '{}',
      ),
    ).toEqual({ 'Total budget': false, 'Net pay': false, '4% rule': true })
  })

  it('mirrors a manual window into every sibling time chart and snaps back on a chip', async () => {
    renderPage()
    await screen.findByText('Where Jul 2026 went')
    fireEvent.mouseLeave(screen.getAllByTestId('echart')[0]) // datazoom {startValue:1, endValue:1}
    const zoomed = screen
      .getAllByTestId('echart')
      .filter((el) => (el.getAttribute('data-zoom') ?? 'null') !== 'null')
    // bars + savings rate + category trends share the window; the heatmap (whole by
    // design) and the flow sankey never zoom.
    expect(zoomed).toHaveLength(3)
    for (const el of zoomed) {
      const zoom = JSON.parse(el.getAttribute('data-zoom') ?? '{}') as {
        startValue?: number
        endValue?: number
      }
      expect(zoom.startValue).toBe(1)
      expect(zoom.endValue).toBe(1)
    }
    // Chips overwrite the shared state — fresh {preset}, no window (snap-back contract).
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    const snapped = JSON.parse(
      screen.getAllByTestId('echart')[0].getAttribute('data-zoom') ?? '{}',
    ) as { startValue?: number; endValue?: number }
    expect(snapped.startValue).toBe(0)
    expect(snapped.endValue).toBeUndefined()
  })
})
