import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EChartsOption } from '../charts/echarts'
import { SURFACE } from '../charts/theme'

interface FakeChartLike {
  handlers: Record<string, (params?: unknown) => void>
  setOption: ReturnType<typeof vi.fn>
  getDataURL: ReturnType<typeof vi.fn>
  getOption: ReturnType<typeof vi.fn>
}

// House law keeps real echarts out of jsdom (no canvas). The engine is stubbed at the
// module boundary with exactly what EChart's effects call; handler capture lets the
// event-mirror tests fire chart events without a canvas.
vi.mock('../charts/echarts', () => {
  class FakeChart {
    handlers: Record<string, (params?: unknown) => void> = {}
    setOption = vi.fn()
    dispose = vi.fn()
    resize = vi.fn()
    dispatchAction = vi.fn()
    getDataURL = vi.fn(() => 'data:image/png;base64,PNG')
    getOption = vi.fn(() => ({ dataZoom: [{ startValue: 3, endValue: 9 }] }))
    on(event: string, handler: (params?: unknown) => void) {
      this.handlers[event] = handler
    }
  }
  const instances: FakeChart[] = []
  return {
    echarts: {
      init: () => {
        const chart = new FakeChart()
        instances.push(chart)
        return chart
      },
    },
    __instances: instances,
  }
})
// Identity pass-through: quiesceRipples is reduced-motion armor, not this file's subject.
vi.mock('../charts/motion', () => ({ quiesceRipples: (option: unknown) => option }))
vi.mock('../utils/download', () => ({
  toCsv: vi.fn(() => 'CSV-BODY'),
  downloadDataUrl: vi.fn(),
  downloadText: vi.fn(),
}))

import EChart from './EChart'
import * as chartsModule from '../charts/echarts'
import { downloadDataUrl, downloadText, toCsv } from '../utils/download'

const instances = (chartsModule as unknown as { __instances: FakeChartLike[] }).__instances

function lastChart(): FakeChartLike {
  return instances[instances.length - 1]
}

const OPTION = {} as EChartsOption

beforeEach(() => {
  // jsdom has no ResizeObserver; the wrapper observes its container on mount.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  instances.length = 0
})

describe('EChart aria facade', () => {
  it('renders role="img" + the label when ariaLabel is given', () => {
    const { container } = render(
      <EChart option={OPTION} ariaLabel="Line chart of net worth at every monthly snapshot" />,
    )
    const div = container.firstElementChild as HTMLElement
    expect(div.getAttribute('role')).toBe('img')
    expect(div.getAttribute('aria-label')).toBe(
      'Line chart of net worth at every monthly snapshot',
    )
  })

  it('renders NO role and no label when the prop is absent', () => {
    const { container } = render(<EChart option={OPTION} />)
    const div = container.firstElementChild as HTMLElement
    expect(div.getAttribute('role')).toBeNull()
    expect(div.getAttribute('aria-label')).toBeNull()
  })
})

describe('EChart export menu', () => {
  it('renders no menu without exportConfig', () => {
    render(<EChart option={OPTION} />)
    expect(screen.queryByRole('group', { name: /Export/ })).toBeNull()
  })

  it('offers PNG always and CSV only when a csv fn is supplied', () => {
    const { unmount } = render(<EChart option={OPTION} exportConfig={{ name: 'demo' }} />)
    expect(screen.getByRole('group', { name: 'Export demo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'PNG' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'CSV' })).toBeNull()
    unmount()
    render(
      <EChart
        option={OPTION}
        exportConfig={{ name: 'demo', csv: () => ({ headers: [], rows: [] }) }}
      />,
    )
    expect(screen.getByRole('button', { name: 'CSV' })).toBeTruthy()
  })

  it('PNG snapshots at 2x on the card surface and downloads {name}.png', () => {
    render(<EChart option={OPTION} exportConfig={{ name: 'demo' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'PNG' }))
    expect(lastChart().getDataURL).toHaveBeenCalledWith({
      pixelRatio: 2,
      backgroundColor: SURFACE,
    })
    expect(downloadDataUrl).toHaveBeenCalledWith('data:image/png;base64,PNG', 'demo.png')
  })

  it('CSV serializes the caller rows and downloads {name}.csv as UTF-8 text/csv', () => {
    const csv = vi.fn(() => ({ headers: ['Month', 'Total'], rows: [['2026-06-01', 1]] }))
    render(<EChart option={OPTION} exportConfig={{ name: 'demo', csv }} />)
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }))
    expect(csv).toHaveBeenCalledTimes(1) // lazy: rows built on click, never on render
    expect(toCsv).toHaveBeenCalledWith(['Month', 'Total'], [['2026-06-01', 1]])
    expect(downloadText).toHaveBeenCalledWith('CSV-BODY', 'demo.csv', 'text/csv;charset=utf-8')
  })
})

describe('EChart event mirrors', () => {
  it('hands legendselectchanged a COPY of the name→shown map', () => {
    const onLegendChange = vi.fn()
    render(<EChart option={OPTION} onLegendChange={onLegendChange} />)
    const selected = { 'Net pay': false, '4% rule': true }
    lastChart().handlers['legendselectchanged']({ name: 'Net pay', selected })
    expect(onLegendChange).toHaveBeenCalledWith({ 'Net pay': false, '4% rule': true })
    // Copied, not aliased: echarts mutates its own map on the next toggle.
    expect(onLegendChange.mock.calls[0][0]).not.toBe(selected)
  })

  it('reads the resolved index window off the option on datazoom', () => {
    const onDataZoom = vi.fn()
    render(<EChart option={OPTION} onDataZoom={onDataZoom} />)
    lastChart().handlers['datazoom']()
    expect(onDataZoom).toHaveBeenCalledWith({ startValue: 3, endValue: 9 })
  })

  it('stays silent when the option carries no numeric window', () => {
    const onDataZoom = vi.fn()
    render(<EChart option={OPTION} onDataZoom={onDataZoom} />)
    lastChart().getOption.mockReturnValue({ dataZoom: [{}] })
    lastChart().handlers['datazoom']()
    expect(onDataZoom).not.toHaveBeenCalled()
  })

  it('always fires the LATEST handler without rebinding (the ref pattern)', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<EChart option={OPTION} onLegendChange={first} />)
    rerender(<EChart option={OPTION} onLegendChange={second} />)
    lastChart().handlers['legendselectchanged']({ selected: { A: false } })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith({ A: false })
  })
})
