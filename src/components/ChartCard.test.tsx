import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EChartsOption } from '../charts/echarts'
import { hintLabel } from './InfoHint'

// The engine never draws in jsdom: the page tests' mock shape, so this file pins the CARD.
vi.mock('./EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ ariaLabel, animateEntrance = true, group, height }: { ariaLabel?: string; animateEntrance?: boolean; group?: string; height?: number }) =>
      createElement('div', { 'data-testid': 'echart', 'aria-label': ariaLabel, 'data-animate': String(animateEntrance), 'data-group': group ?? '', 'data-height': String(height) }),
  }
})
vi.mock('../utils/download', () => ({ toCsv: vi.fn(() => 'CSV'), downloadDataUrl: vi.fn(), downloadText: vi.fn() }))

import ChartCard from './ChartCard'
import PageFrame from './shell/PageFrame'

const OPTION = { series: [] } as EChartsOption
const base = { title: 'Net worth', hint: 'What it shows.', ariaLabel: 'Line chart of net worth', empty: 'No snapshots yet.', exportName: 'net-worth' }
afterEach(cleanup)

describe('ChartCard states', () => {
  it('null + busy → a skeleton block of the card height, and a status line for AT', () => {
    render(<ChartCard {...base} option={null} busy height={280} />)
    const skeleton = document.querySelector('.chart-card-skeleton') as HTMLElement
    expect(skeleton.style.height).toBe('280px')
    expect(screen.getByRole('status').textContent).toBe('Loading…')
    expect(screen.queryByText('No snapshots yet.')).toBeNull()
    expect(screen.queryByRole('group', { name: /Export/ })).toBeNull()
  })
  it('null + error → the error sentence as the empty note', () => {
    render(<ChartCard {...base} option={null} error="Failed to load price history" />)
    expect(screen.getByText('Failed to load price history').className).toBe('empty-note')
  })
  it('null → the required empty sentence, no default prose', () => {
    render(<ChartCard {...base} option={null} />)
    expect(screen.getByText('No snapshots yet.').className).toBe('empty-note')
  })
  it('option → the chart with the house label, the export row, and a dim (not a skeleton) while busy', () => {
    const { rerender } = render(<ChartCard {...base} option={OPTION} height={320} />)
    expect(screen.getByTestId('echart').getAttribute('aria-label')).toBe('Line chart of net worth')
    expect(screen.getByTestId('echart').getAttribute('data-height')).toBe('320')
    expect(screen.getByRole('group', { name: 'Export net-worth' })).toBeTruthy()
    expect(document.querySelector('.loading-dim.is-loading')).toBeNull()
    rerender(<ChartCard {...base} option={OPTION} busy />)
    expect(document.querySelector('.loading-dim.is-loading')).toBeTruthy()
    expect(screen.getByTestId('echart')).toBeTruthy() // the previous render holds
    expect(document.querySelector('.chart-card-skeleton')).toBeNull()
  })
  it('option + error → a card-local advisory above the chart, never the page banner', () => {
    render(<ChartCard {...base} option={OPTION} error="Refetch failed — showing the previous window" />)
    expect(screen.getByRole('status').textContent).toContain('Refetch failed')
    expect(screen.getByTestId('echart')).toBeTruthy()
  })
})

describe('ChartCard chrome', () => {
  it('renders the eyebrow with its hint, controls then actions on the right, zoom hint and footer', () => {
    render(
      <ChartCard {...base} option={OPTION} zoomable span={6}
        controls={<button>Monthly</button>} actions={<button>All months</button>} footer={<p className="drill-hint">Click a bar.</p>} />,
    )
    const section = document.querySelector('section.card.chart-card.span-6') as HTMLElement
    expect(section).toBeTruthy()
    expect(section.querySelector('h2.eyebrow')?.textContent).toBe('Net worth')
    expect(section.querySelector('h2.eyebrow button.info-hint')?.getAttribute('aria-label')).toBe(hintLabel('What it shows.'))
    const controls = section.querySelector('.chart-card-controls') as HTMLElement
    expect(controls.textContent).toBe('MonthlyAll months')
    expect(screen.getByText('ctrl+scroll to zoom · drag to pan')).toBeTruthy()
    expect(screen.getByText('Click a bar.')).toBeTruthy()
  })
  it('reads fromCache from the PageFrame context: cached → no entrance, bare → entrance', () => {
    render(
      <PageFrame title="P" resource={{ status: 'ready', fromCache: true }}>
        <ChartCard {...base} option={OPTION} />
      </PageFrame>,
    )
    expect(screen.getByTestId('echart').getAttribute('data-animate')).toBe('false')
    cleanup()
    render(<ChartCard {...base} option={OPTION} />)
    expect(screen.getByTestId('echart').getAttribute('data-animate')).toBe('true')
  })
  it('passes the group through and offers Table only with a csv, toggling the twin', () => {
    const csv = vi.fn(() => ({ headers: ['Month', 'Net worth'], rows: [['2026-08-01', '1500.00']] }))
    const { rerender } = render(<ChartCard {...base} option={OPTION} group="net-worth" />)
    expect(screen.getByTestId('echart').getAttribute('data-group')).toBe('net-worth')
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull()
    rerender(<ChartCard {...base} option={OPTION} csv={csv} />)
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Net worth' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: '1500.00' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Table' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(screen.queryByRole('table')).toBeNull()
  })
})
