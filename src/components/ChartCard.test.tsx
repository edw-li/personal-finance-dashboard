import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EChartsOption } from '../charts/echarts'
import { hintLabel } from './InfoHint'

// The engine never draws in jsdom: the page tests' mock shape, so this file pins the CARD.
vi.mock('./EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ ariaLabel, animateEntrance = true, group, height }: { ariaLabel?: string; animateEntrance?: boolean; group?: string; height?: number }) =>
      createElement('div', { 'data-testid': 'echart', 'aria-label': ariaLabel, 'data-animate': String(animateEntrance), 'data-group': group ?? '', 'data-height': String(height), style: { height } }),
  }
})
vi.mock('../utils/download', () => ({ toCsv: vi.fn(() => 'CSV'), downloadDataUrl: vi.fn(), downloadText: vi.fn() }))

import ChartCard from './ChartCard'
import PageFrame from './shell/PageFrame'
import { CHART_CARD_ROWS } from './skeletonMetrics'

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

describe('ChartCard reserved rows (motion spec §7)', () => {
  const rows = () => Array.from(document.querySelectorAll('.chart-card-row')).map((r) => r.className)
  const full = { ...base, height: 280, zoomable: true, controls: <button>Monthly</button>, footer: <p className="drill-hint">Click a bar.</p> }
  // jsdom lays nothing out, so "did it move?" is asked of what the card DECLARES: an inline height,
  // or a --m-* row whose px value panels.css fixes (Task 1 pins the two together).
  const ROW_PX: Record<string, number> = { 'chart-card-row-export': CHART_CARD_ROWS.exportRow, 'chart-card-row-zoom': CHART_CARD_ROWS.zoom, 'chart-card-row-caption': CHART_CARD_ROWS.caption }
  const reserved = (el: Element): number =>
    parseFloat((el as HTMLElement).style.height || '0') ||
    Array.from(el.classList).map((cls) => ROW_PX[cls]).find((px) => px !== undefined) ||
    Array.from(el.children).reduce((sum, kid) => sum + reserved(kid), 0)
  it('declares the same rows AND the same total height with a skeleton up as loaded (CLS pin)', () => {
    const card = () => document.querySelector('section.chart-card') as HTMLElement
    const { rerender } = render(<ChartCard {...full} option={null} busy />)
    const loading = rows()
    expect(loading).toEqual(['chart-card-row chart-card-row-export', 'chart-card-row chart-card-row-zoom', 'chart-card-row chart-card-row-caption'])
    expect(document.querySelector('.chart-card-header .chart-card-controls')).toBeTruthy()
    expect((document.querySelector('.chart-card-skeleton') as HTMLElement).style.height).toBe('280px')
    expect(reserved(card())).toBe(280 + CHART_CARD_ROWS.exportRow + CHART_CARD_ROWS.zoom + CHART_CARD_ROWS.caption)
    rerender(<ChartCard {...full} option={OPTION} />)
    expect(rows()).toEqual(loading) // same rows, same order — only their CONTENTS arrive with the data
    expect(reserved(card())).toBe(280 + CHART_CARD_ROWS.exportRow + CHART_CARD_ROWS.zoom + CHART_CARD_ROWS.caption)
    expect(document.querySelector('.chart-card-row-export .chart-export')).toBeTruthy()
    expect(document.querySelector('.chart-card-row-zoom .chart-zoom-hint')).toBeTruthy()
  })
  it('reserves only the rows the card actually declares', () => {
    render(<ChartCard {...base} option={null} busy />) // no zoom, no footer
    expect(rows()).toEqual(['chart-card-row chart-card-row-export'])
  })
})
