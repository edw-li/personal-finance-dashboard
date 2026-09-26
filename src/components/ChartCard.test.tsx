import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EChartsOption } from '../charts/echarts'
import { hintLabel } from './InfoHint'

// The engine never draws in jsdom: the page tests' mock shape, so this file pins the CARD.
vi.mock('./EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ ariaLabel, animateEntrance = true, group, height, onClick, onDataZoom, onWidth }: { ariaLabel?: string; animateEntrance?: boolean; group?: string; height?: number | 'fill'; onClick?: (params: { dataIndex: number; seriesIndex: number }) => void; onDataZoom?: (window: { startValue: number; endValue: number }) => void; onWidth?: (width: number) => void }) =>
      createElement('div', { 'data-testid': 'echart', 'aria-label': ariaLabel, 'data-animate': String(animateEntrance), 'data-group': group ?? '', 'data-height': String(height), style: { height }, onClick: () => onClick?.({ dataIndex: 1, seriesIndex: 0 }), onDoubleClick: () => onDataZoom?.({ startValue: 1, endValue: 2 }), onContextMenu: () => onWidth?.(640) }),
  }
})
vi.mock('../utils/download', () => ({ toCsv: vi.fn(() => 'CSV'), downloadDataUrl: vi.fn(), downloadText: vi.fn() }))
// The anchoring loop is holdPosition's own unit; here only WHAT the card asks it to hold matters.
// The reader's-input clock stays real: pressing things is how these tests say who changed what.
vi.mock('./shell/holdPosition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./shell/holdPosition')>()),
  holdPosition: vi.fn(() => () => {}),
}))

import ChartCard from './ChartCard'
import PageFrame from './shell/PageFrame'
import { CHART_CARD_ROWS } from './skeletonMetrics'
import DetailPanelProvider, { useDetailPanel } from './details/DetailPanelProvider'
import type { ChartSelection } from '../types/metrics'
import { holdPosition } from './shell/holdPosition'
import { LocalSectionVisibility } from './shell/localSectionContext'

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
  it('renders an optional lede under the header, above the export row and the plot', () => {
    render(<ChartCard {...base} option={OPTION} lede={<>Jul 2026 <b>$170.00</b> → Aug 2026 <b>$230.00</b></>} />)
    const lede = document.querySelector('.chart-lede') as HTMLElement
    expect(lede.textContent).toBe('Jul 2026 $170.00 → Aug 2026 $230.00')
    expect(lede.previousElementSibling?.className).toBe('chart-card-header')
    expect(document.querySelector('.chart-lede + .chart-card-row-export')).toBeTruthy()
  })
  it('renders an aside beside the plot in a two-column body wrapper, and no wrapper at all without one', () => {
    render(<ChartCard {...base} option={OPTION} aside={<ul className="legend-list"><li>Cash</li></ul>} />)
    const section = document.querySelector('section.chart-card') as HTMLElement
    expect(section.classList.contains('chart-card-has-aside')).toBe(true) // the container-query root
    const wrapper = section.querySelector('.chart-card-body.chart-card-with-aside') as HTMLElement
    expect(wrapper).toBeTruthy()
    expect(wrapper.children[0].className).toBe('chart-card-plot')
    expect(wrapper.children[0].querySelector('[data-testid="echart"]')).toBeTruthy()
    expect(wrapper.children[1].className).toBe('chart-card-aside')
    expect(wrapper.children[1].textContent).toBe('Cash')
    // The wrapper sits where the bare plot did: after the export row, before the zoom/table/footer rows.
    expect(wrapper.previousElementSibling?.className).toBe('chart-card-row chart-card-row-export')
    cleanup()
    render(<ChartCard {...base} option={OPTION} />)
    expect(document.querySelector('.chart-card-body')).toBeNull()
    expect(document.querySelector('.chart-card-has-aside')).toBeNull()
  })
  it('draws no lede element at all for the cards that pass none', () => {
    render(<ChartCard {...base} option={OPTION} />)
    expect(document.querySelector('.chart-lede')).toBeNull()
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

describe('ChartCard persistent interactions', () => {
  const history = { xAxis: { type: 'category', data: ['Jul', 'Aug', 'Sep'] }, series: [{ type: 'line', name: 'Net worth', data: [100, 200, 300] }], dataZoom: [{ type: 'inside', startValue: 0 }] } as EChartsOption
  const selection: ChartSelection = { kind: 'period', id: 'aug', period: '2026-08-01', label: 'August', values: [{ label: 'Net worth', value: 200, unit: 'USD' }], source: { href: '/net-worth?month=2026-08', label: 'Open August records' } }
  it('pins a source-backed selection and expands the same live canvas and connection group', () => {
    render(<DetailPanelProvider><ChartCard {...base} option={history} group="wealth" selectionAdapter={() => selection} /></DetailPanelProvider>)
    const canvas = screen.getByTestId('echart')
    fireEvent.click(canvas)
    expect(screen.getByText('Pinned: August')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open August records' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Net worth' }))
    expect(screen.getByTestId('echart')).toBe(canvas)
    expect(document.querySelector('.detail-panel')).toBeNull()
    expect(canvas.getAttribute('data-group')).toBe('wealth')
    fireEvent.click(screen.getByRole('button', { name: 'Close expanded Net worth' }))
    expect(screen.getByTestId('echart')).toBe(canvas)
    expect(screen.getByText('Pinned: August')).toBeTruthy()
    expect(document.querySelector('.detail-panel')).toBeTruthy()
  })
  // 2026-09-23 spec §C10: a drill docks the detail panel and the page narrows around the chart —
  // the card names ITSELF as the element to hold in place while that happens. Review round 1: only
  // for a selection that changes UNDER a chart already on screen. On arrival — a new page, Back,
  // a section coming into view — the page's own scroll restore must win, so nothing is held.
  describe('holding the drilled chart (2026-09-23 spec §C10)', () => {
    const card = () => document.querySelector('section.chart-card') as HTMLElement
    // jsdom lays nothing out; the card sits where each test says.
    const place = (top: number, bottom: number) =>
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return (this.matches('section.chart-card') ? { top, bottom } : { top: 0, bottom: 0 }) as DOMRect
      })
    let width = 0
    beforeEach(() => {
      width = window.innerWidth
      Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true }) // wide enough to dock
      vi.mocked(holdPosition).mockClear()
    })
    afterEach(() => {
      Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
      vi.restoreAllMocks()
    })

    it('holds its own card when the reader drills into the chart', () => {
      place(120, 560)
      render(<DetailPanelProvider><ChartCard {...base} option={history} selectionAdapter={() => selection} /></DetailPanelProvider>)
      fireEvent.click(screen.getByTestId('echart'))
      expect(holdPosition).toHaveBeenCalledWith(card())
    })

    it('opens a selection it arrived with without holding the page', () => {
      place(120, 560)
      render(<DetailPanelProvider><ChartCard {...base} option={history} selection={selection} /></DetailPanelProvider>)
      expect(document.querySelector('.detail-panel')).toBeTruthy()
      expect(holdPosition).not.toHaveBeenCalled()
    })

    it('holds the card when the reader changes its selection after it drew — a month-ribbon pick', () => {
      place(120, 560)
      const { rerender } = render(<DetailPanelProvider><ChartCard {...base} option={history} selection={null} /></DetailPanelProvider>)
      fireEvent.pointerDown(document.body) // the ribbon chip, pressed
      rerender(<DetailPanelProvider><ChartCard {...base} option={history} selection={selection} /></DetailPanelProvider>)
      expect(holdPosition).toHaveBeenCalledWith(card())
    })

    it('holds nothing for a selection the page lands on its own after the chart drew — Back, a link', () => {
      // /spending?month=… : the chart draws, then the month's figures land, with no input between.
      place(120, 560)
      const { rerender } = render(<DetailPanelProvider><ChartCard {...base} option={history} selection={null} /></DetailPanelProvider>)
      rerender(<DetailPanelProvider><ChartCard {...base} option={history} selection={selection} /></DetailPanelProvider>)
      expect(document.querySelector('.detail-panel')).toBeTruthy()
      expect(holdPosition).not.toHaveBeenCalled()
    })

    it('holds nothing for a selection that arrives with the chart’s first drawing', () => {
      place(120, 560)
      const { rerender } = render(<DetailPanelProvider><ChartCard {...base} option={null} busy selection={null} /></DetailPanelProvider>)
      rerender(<DetailPanelProvider><ChartCard {...base} option={history} selection={selection} /></DetailPanelProvider>)
      expect(document.querySelector('.detail-panel')).toBeTruthy()
      expect(holdPosition).not.toHaveBeenCalled()
    })

    it('holds nothing for a chart scrolled out of view', () => {
      place(-900, -40)
      const { rerender } = render(<DetailPanelProvider><ChartCard {...base} option={history} selection={null} /></DetailPanelProvider>)
      fireEvent.pointerDown(document.body)
      rerender(<DetailPanelProvider><ChartCard {...base} option={history} selection={selection} /></DetailPanelProvider>)
      expect(document.querySelector('.detail-panel')).toBeTruthy()
      expect(holdPosition).not.toHaveBeenCalled()
    })

    // Code review: Expand moves the card into the modal dialog, which closes the docked panel — and
    // the page behind the dialog cannot bring a top-layer card back (1200 → 739, 35 corrections).
    it('holds nothing while the card is expanded — it sits in the modal dialog', () => {
      place(120, 560)
      render(<DetailPanelProvider><ChartCard {...base} option={history} selectionAdapter={() => selection} /></DetailPanelProvider>)
      fireEvent.click(screen.getByTestId('echart'))
      expect(holdPosition).toHaveBeenCalledTimes(1) // the drill itself
      vi.mocked(holdPosition).mockClear()
      fireEvent.click(screen.getByRole('button', { name: 'Expand Net worth' }))
      expect(document.querySelector('.detail-panel')).toBeNull() // the dock let go…
      expect(holdPosition).not.toHaveBeenCalled() // …and nothing was held for it
    })

    it('holds nothing when its section comes into view with a selection', () => {
      place(120, 560)
      const view = (visible: boolean) => (
        <DetailPanelProvider>
          <LocalSectionVisibility.Provider value={visible}>
            <ChartCard {...base} option={history} selection={selection} />
          </LocalSectionVisibility.Provider>
        </DetailPanelProvider>
      )
      const { rerender } = render(view(false))
      fireEvent.pointerDown(document.body) // the section's tab, pressed
      rerender(view(true))
      expect(document.querySelector('.detail-panel')).toBeTruthy()
      expect(holdPosition).not.toHaveBeenCalled()
    })
  })
  // Code review 5: a card whose option depends on its width hears the chart's measurement.
  it("passes the chart's measured width through", () => {
    const onWidth = vi.fn()
    render(<ChartCard {...base} option={OPTION} onWidth={onWidth} />)
    fireEvent.contextMenu(screen.getByTestId('echart'))
    expect(onWidth).toHaveBeenCalledWith(640)
  })
  it('expanded → the chart fills the dialog; collapsed → the card height comes back', () => {
    render(<ChartCard {...base} option={OPTION} height={320} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand Net worth' }))
    // No `innerHeight - 280` arithmetic (audit A3's 88px void): the dialog's flex column sizes it.
    expect(screen.getByTestId('echart').getAttribute('data-height')).toBe('fill')
    fireEvent.click(screen.getByRole('button', { name: 'Close expanded Net worth' }))
    expect(screen.getByTestId('echart').getAttribute('data-height')).toBe('320')
  })
  it('names the panel after the selection, keeps the chart title as its subtitle, and the pin strip announces only its text', () => {
    render(<DetailPanelProvider><ChartCard {...base} option={history} selectionAdapter={() => selection} /></DetailPanelProvider>)
    fireEvent.click(screen.getByTestId('echart'))
    expect(screen.getByRole('dialog', { name: 'August' })).toBeTruthy()
    expect(document.querySelector('.detail-panel-heading p')?.textContent).toBe('Net worth')
    // role="status" on the text span only (audit D3): a re-pin never re-announces the buttons.
    const strip = document.querySelector('.chart-selection-summary') as HTMLElement
    expect(strip.getAttribute('role')).toBeNull()
    expect(strip.querySelector('[role="status"]')?.textContent).toBe('Pinned: August')
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }))
    expect(screen.getByRole('dialog', { name: 'August' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Details' })).toBeNull()
  })
  it('keeps legacy click handlers until a page supplies its typed selection adapter', () => {
    const legacy = vi.fn()
    render(<ChartCard {...base} option={history} onClick={legacy} />)
    fireEvent.click(screen.getByTestId('echart'))
    expect(legacy).toHaveBeenCalledWith({ dataIndex: 1, seriesIndex: 0 })
    expect(screen.queryByText('Pinned: Aug')).toBeNull()
  })
  it('keeps a dismissed custom selection closed across panel-context updates', () => {
    let renders = 0
    function PageWithDetails() {
      const details = useDetailPanel()
      if (++renders > 12) throw new Error('Selection caused a panel render loop')
      return <><span>{details?.activeId ?? 'No open details'}</span><ChartCard {...base} option={history} selectionAdapter={() => selection} renderSelection={(selected) => <p>Details for {selected.label}</p>} /></>
    }
    render(<DetailPanelProvider><PageWithDetails /></DetailPanelProvider>)
    fireEvent.click(screen.getByTestId('echart'))
    expect(screen.getByText('Details for August')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(screen.queryByRole('dialog', { name: 'August' })).toBeNull()
    expect(screen.getByText('Pinned: August')).toBeTruthy()
    expect(screen.getByText('No open details')).toBeTruthy()
  })
  it('shows one chart detail at a time and restores its live content with Back', () => {
    render(<DetailPanelProvider>
      <ChartCard {...base} option={history} selectionAdapter={() => selection} renderSelection={() => <p>First chart details</p>} />
      <ChartCard {...base} title="Second chart" exportName="second-chart" option={history} selectionAdapter={() => selection} renderSelection={() => <p>Second chart details</p>} />
    </DetailPanelProvider>)
    const charts = screen.getAllByTestId('echart')
    fireEvent.click(charts[0])
    expect(screen.getByText('First chart details')).toBeTruthy()
    fireEvent.click(charts[1])
    expect(screen.queryByText('First chart details')).toBeNull()
    expect(screen.getByText('Second chart details')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to August' }))
    expect(screen.getByText('First chart details')).toBeTruthy()
    expect(screen.queryByText('Second chart details')).toBeNull()
  })
  it('resets a manually narrowed window to the initial range', () => {
    const changed = vi.fn()
    render(<ChartCard {...base} option={history} zoomable onDataZoom={changed} />)
    expect(screen.queryByRole('button', { name: 'Reset zoom' })).toBeNull()
    fireEvent.doubleClick(screen.getByTestId('echart'))
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }))
    expect(changed).toHaveBeenLastCalledWith({ startValue: 0, endValue: 2 })
    expect(screen.queryByRole('button', { name: 'Reset zoom' })).toBeNull()
  })
  it('offers the same source action from keyboard-reachable table inspection', () => {
    render(<ChartCard {...base} option={history} csv={() => ({ headers: ['Month', 'Net worth'], rows: [['August', 200]] })} rowSelection={() => selection} />)
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    fireEvent.click(screen.getByRole('button', { name: 'Inspect August' }))
    expect(screen.getByText('Pinned: August')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Open August records' })).toHaveLength(2)
  })
  it('immediately removes a stale owner selection and its panel on scope change', () => {
    const changed = vi.fn()
    const { rerender } = render(<DetailPanelProvider><ChartCard {...base} option={history} selection={selection} onSelectionChange={changed} selectionScopeKey="owner:1" /></DetailPanelProvider>)
    expect(screen.getByText('Pinned: August')).toBeTruthy()
    rerender(<DetailPanelProvider><ChartCard {...base} option={history} selection={selection} onSelectionChange={changed} selectionScopeKey="owner:2" /></DetailPanelProvider>)
    expect(screen.queryByText('Pinned: August')).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'August' })).toBeNull()
    expect(changed).toHaveBeenCalledWith(null)
  })
})

// Contract C5 (2026-09-25 polish spec §3.1): a half-width card always has a partner in its row, so it
// grows its PLOT to the row's height — the configured height is the floor. jsdom lays nothing out;
// what the card declares is what can be pinned here, and chartFillCss.test.ts pins the CSS.
describe('ChartCard fill (spec §3.1, contract C5)', () => {
  const chart = () => screen.getByTestId('echart')
  const card = () => document.querySelector('section.chart-card') as HTMLElement

  it('fills by default at span 6: the chart takes the plot box and the configured height is its floor', () => {
    render(<ChartCard {...base} option={OPTION} span={6} height={260} />)
    expect(chart().getAttribute('data-height')).toBe('fill')
    expect(card().classList.contains('chart-card-fill')).toBe(true)
    expect(card().style.getPropertyValue('--chart-h')).toBe('260px')
  })

  it('keeps a fixed plot at span 12 unless asked, and takes `fill` when it is', () => {
    render(<ChartCard {...base} option={OPTION} height={220} />)
    expect(chart().getAttribute('data-height')).toBe('220')
    expect(card().classList.contains('chart-card-fill')).toBe(false)
    // The configured height is on every card: the Allocation aside caps itself at it (§3.6).
    expect(card().style.getPropertyValue('--chart-h')).toBe('220px')
    cleanup()
    render(<ChartCard {...base} option={OPTION} height={220} fill />)
    expect(chart().getAttribute('data-height')).toBe('fill')
    expect(card().classList.contains('chart-card-fill')).toBe(true)
  })

  it('lets a half-width card opt out', () => {
    render(<ChartCard {...base} option={OPTION} span={6} height={300} fill={false} />)
    expect(chart().getAttribute('data-height')).toBe('300')
    expect(card().classList.contains('chart-card-fill')).toBe(false)
  })

  it('never fills a card with an aside — its plot sits inside the aside wrapper, which does not grow', () => {
    render(<ChartCard {...base} option={OPTION} span={6} height={240} aside={<p>Legend</p>} />)
    expect(chart().getAttribute('data-height')).toBe('240')
    expect(card().classList.contains('chart-card-fill')).toBe(false)
  })

  it('keeps the skeleton at the configured height while the data is out — the CSS grows it with the row', () => {
    render(<ChartCard {...base} option={null} busy span={6} height={300} />)
    expect((document.querySelector('.chart-card-skeleton') as HTMLElement).style.height).toBe('300px')
    expect(card().classList.contains('chart-card-fill')).toBe(true)
  })
})

// Spending › Trends (spec §3.1): the card without controls reserves the controls row, so its plot
// starts on the same line as its partner's, whose header carries a Segmented.
describe('ChartCard reserveControls (spec §3.1)', () => {
  it('reserves an empty controls row in a header with nothing to put there', () => {
    render(<ChartCard {...base} option={OPTION} reserveControls />)
    const controls = document.querySelector('.chart-card-header .chart-card-controls') as HTMLElement
    expect(controls).toBeTruthy()
    expect(controls.childElementCount).toBe(0)
  })

  it('draws no controls row by default', () => {
    render(<ChartCard {...base} option={OPTION} />)
    expect(document.querySelector('.chart-card-controls')).toBeNull()
  })
})

// 2026-09-25 polish spec §5.5 (MOTION-11): "Table" opened the twin below the fold — 21px of it on
// Net worth, none on Taxes — and the click looked like it did nothing. jsdom has no scrollIntoView,
// so the prototype is stubbed (GuideCard.test's idiom).
describe('ChartCard Table reveal (spec §5.5)', () => {
  const csv = () => ({ headers: ['Month', 'Net worth'], rows: [['2026-08-01', '1500.00']] })
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
  let scrollIntoView: ReturnType<typeof vi.fn>
  beforeEach(() => {
    scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original)
    else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  })

  it('brings the opened twin into view — nearest, smoothly — and does nothing on close', () => {
    render(<ChartCard {...base} option={OPTION} csv={csv} />)
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })
    expect(scrollIntoView.mock.instances[0]).toBe(document.querySelector('.chart-table'))
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('lands at once for a reader who asked for less motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    render(<ChartCard {...base} option={OPTION} csv={csv} />)
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'instant' })
  })

  it('does not scroll again when the card re-renders with the twin open', () => {
    const { rerender } = render(<ChartCard {...base} option={OPTION} csv={csv} />)
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    rerender(<ChartCard {...base} option={{ series: [] } as EChartsOption} csv={csv} />)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })
})
