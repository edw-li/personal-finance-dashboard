import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EChartsOption } from '../charts/echarts'
import { SURFACE } from '../charts/theme'
import { DARK, LIGHT } from '../theme/tokens'

interface FakeChartLike {
  handlers: Record<string, (params?: unknown) => void>
  setOption: ReturnType<typeof vi.fn>
  getDataURL: ReturnType<typeof vi.fn>
  getOption: ReturnType<typeof vi.fn>
  dispatchAction: ReturnType<typeof vi.fn>
}

// House law keeps real echarts out of jsdom (no canvas). The engine is stubbed at the
// module boundary with exactly what EChart's effects call; handler capture lets the
// event-mirror tests fire chart events without a canvas.
vi.mock('../charts/echarts', () => {
  class FakeChart {
    handlers: Record<string, (params?: unknown) => void> = {}
    // echarts sets `group` on the instance; connect() then links every chart wearing it.
    group = ''
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
  // The real name scheme, duplicated here so the fake registrar answers like the module it
  // stands in for; a constant return would let a version-0 name reach init() under any
  // version and the assertions below could not tell them apart.
  const themeName = (v: number) => (v === 0 ? 'finance' : `finance-${v}`)
  return {
    echarts: {
      init: vi.fn(() => {
        const chart = new FakeChart()
        instances.push(chart)
        return chart
      }),
      connect: vi.fn(),
    },
    // The theme bridge: the real pair registers an echarts theme and hands back its name.
    // Registration itself is charts/theme.test.ts's subject; here the NAME is what EChart
    // consumes, so the fake derives it from the version exactly as the real one does and
    // the tests below assert the ARGUMENTS (which palette, which version) as well.
    registerThemeVersion: vi.fn((_resolved: 'dark' | 'light', version: number) =>
      themeName(version),
    ),
    themeName,
    __instances: instances,
  }
})
// Identity pass-through: quiesceRipples is reduced-motion armor, not this file's subject.
// MOTION comes through as the real block — charts/theme.ts spreads it into every built
// theme, so a mock that omitted it would spread `undefined` and break registration.
vi.mock('../charts/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../charts/motion')>()),
  quiesceRipples: (option: unknown) => option,
}))
vi.mock('../utils/download', () => ({
  toCsv: vi.fn(() => 'CSV-BODY'),
  downloadDataUrl: vi.fn(),
  downloadText: vi.fn(),
}))

import EChart from './EChart'
import * as chartsModule from '../charts/echarts'
import ThemeProvider, { useTheme } from './shell/ThemeProvider'
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
  // ThemeProvider seeds itself from localStorage — a light-theme case must not leak into
  // the file's other tests, which all assume the dark default.
  localStorage.clear()
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

  // The matte follows the RESOLVED theme: a light-theme chart exported on the dark card
  // color comes back as near-black paper with invisible axis labels.
  it('PNG mattes on the LIGHT card surface under the light theme', () => {
    localStorage.setItem('finance.theme', 'light')
    render(
      <ThemeProvider>
        <EChart option={OPTION} exportConfig={{ name: 'demo' }} />
      </ThemeProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'PNG' }))
    expect(lastChart().getDataURL).toHaveBeenCalledWith({
      pixelRatio: 2,
      backgroundColor: LIGHT.surface,
    })
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

// jsdom's matchMedia reports matches: false, so the REDUCED_MOTION path is idle here and
// the only thing that can force `animation: false` is the new prop.
describe('EChart animateEntrance (2026-08-27 spec §1)', () => {
  it('animateEntrance={false} suppresses the ENTRANCE only — update animation survives', () => {
    render(<EChart option={{ series: [] } as EChartsOption} animateEntrance={false} />)
    const chart = instances[0]
    const [option] = chart.setOption.mock.calls[0] as [Record<string, unknown>]
    expect(option.animationDuration).toBe(0)
    expect('animation' in option).toBe(false)
  })

  it('animateEntrance defaults on (no forced animation flag)', () => {
    render(<EChart option={{ series: [] } as EChartsOption} />)
    const chart = lastChart()
    const [option] = chart.setOption.mock.calls[0] as [Record<string, unknown>]
    expect('animation' in option).toBe(false)
  })
})

describe('zoomWindow fast path', () => {
  const series = [{ type: 'line', data: [1, 2, 3] }]

  it('a zoom-only option change dispatches an animated dataZoom instead of rebuilding', () => {
    const { rerender } = render(
      <EChart
        option={{ series, dataZoom: [{ type: 'inside', startValue: 3 }] } as EChartsOption}
        zoomWindow={{ startValue: 3, endValue: 9 }}
      />,
    )
    const chart = instances[0]
    expect(chart.setOption).toHaveBeenCalledTimes(1)
    rerender(
      <EChart
        option={{ series, dataZoom: [{ type: 'inside', startValue: 5 }] } as EChartsOption}
        zoomWindow={{ startValue: 5, endValue: 9 }}
      />,
    )
    expect(chart.setOption).toHaveBeenCalledTimes(1) // never rebuilt
    expect(chart.dispatchAction).toHaveBeenCalledWith({
      type: 'dataZoom',
      startValue: 5,
      endValue: 9,
    })
  })

  it('an echoed window equal to the chart state settles as a no-op (ctrl+wheel mirror)', () => {
    const { rerender } = render(
      <EChart
        option={{ series, dataZoom: [{ type: 'inside', startValue: 3 }] } as EChartsOption}
        zoomWindow={{ startValue: 3, endValue: 9 }}
      />,
    )
    const chart = instances[0]
    rerender(
      <EChart
        option={
          { series, dataZoom: [{ type: 'inside', startValue: 3, endValue: 9 }] } as EChartsOption
        }
        zoomWindow={{ startValue: 3, endValue: 9 }}
      />,
    )
    expect(chart.setOption).toHaveBeenCalledTimes(1)
    expect(chart.dispatchAction).not.toHaveBeenCalled()
  })

  it('a data change takes the full notMerge path even with zoomWindow set', () => {
    const { rerender } = render(
      <EChart
        option={
          {
            series: [{ type: 'line', data: [1] }],
            dataZoom: [{ type: 'inside', startValue: 0 }],
          } as EChartsOption
        }
        zoomWindow={{ startValue: 0, endValue: 9 }}
      />,
    )
    const chart = instances[0]
    rerender(
      <EChart
        option={
          {
            series: [{ type: 'line', data: [1, 2] }],
            dataZoom: [{ type: 'inside', startValue: 0 }],
          } as EChartsOption
        }
        zoomWindow={{ startValue: 0, endValue: 9 }}
      />,
    )
    expect(chart.setOption).toHaveBeenCalledTimes(2)
    expect(chart.dispatchAction).not.toHaveBeenCalled()
  })

  it('without zoomWindow, a zoom-only change still rebuilds (opt-in contract)', () => {
    const { rerender } = render(
      <EChart
        option={{ series, dataZoom: [{ type: 'inside', startValue: 3 }] } as EChartsOption}
      />,
    )
    const chart = instances[0]
    rerender(
      <EChart
        option={{ series, dataZoom: [{ type: 'inside', startValue: 5 }] } as EChartsOption}
      />,
    )
    expect(chart.setOption).toHaveBeenCalledTimes(2)
    expect(chart.dispatchAction).not.toHaveBeenCalled()
  })
})

describe('EChart — theme bridge', () => {
  const init = vi.mocked(chartsModule.echarts.init)
  const registerThemeVersion = vi.mocked(chartsModule.registerThemeVersion)
  // ONE object across every render on purpose. A fresh literal per render would re-run the
  // option effect on identity alone, and the "was the rebuilt chart repainted?" assertion
  // below would pass even with the theme deps dropped — pages useMemo their options, so
  // stable identity across a palette switch is the real-world case.
  const THEMED: EChartsOption = {
    series: [{ type: 'bar', itemStyle: { color: DARK.positive } }],
  }

  it('re-initializes on a palette change: versioned name, one repaint, handlers rebound', async () => {
    localStorage.clear()
    init.mockClear()
    const onClick = vi.fn()
    function Harness() {
      const { setTheme } = useTheme()
      return (
        <>
          <button onClick={() => setTheme('light')}>go light</button>
          <EChart option={THEMED} onClick={onClick} />
        </>
      )
    }
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    )
    expect(init).toHaveBeenCalledTimes(1)
    expect(init.mock.calls[0][1]).toBe('finance')
    expect(registerThemeVersion).toHaveBeenCalledWith('dark', 0)
    const first = lastChart()

    act(() => screen.getByText('go light').click())
    await waitFor(() => expect(init).toHaveBeenCalledTimes(2))
    // Palette AND version, not just the resulting name: registering DARK under
    // 'finance-1' would hand the light card dark axis lines and init() would not notice.
    expect(registerThemeVersion).toHaveBeenCalledWith('light', 1)
    expect(init.mock.calls[1][1]).toBe('finance-1')

    const second = lastChart()
    expect(second).not.toBe(first)
    // A fresh echarts instance holds NO option, so the rebuilt chart must be repainted in
    // the same commit — this is what fails if `resolved`/`themeVersion` leave the option
    // effect's deps (count 0: blank canvas after every theme switch).
    expect(second.setOption).toHaveBeenCalledTimes(1)
    const applied = second.setOption.mock.calls[0][0] as {
      series: { itemStyle: { color: string } }[]
    }
    expect(applied.series[0].itemStyle.color).toBe(LIGHT.positive)
    // Listeners live on the disposed instance, so the new one binds its own full set...
    expect(Object.keys(second.handlers).sort()).toEqual([
      'click',
      'datazoom',
      'globalout',
      'legendselectchanged',
      'mouseout',
      'mouseover',
    ])
    // ...and they reach the current props, not a closure captured before the rebuild.
    second.handlers['click']({ name: 'Cash' })
    expect(onClick).toHaveBeenCalledWith({ name: 'Cash' })
  })

  // Registration is unconditional, so version 0 registers too — and under a persisted light
  // theme it must register LIGHT. Painting that user dark axis lines and near-white legend
  // text on a white card is the bug this case exists to prevent.
  it('registers the resolved palette at version 0 when that palette is light', () => {
    localStorage.setItem('finance.theme', 'light')
    render(
      <ThemeProvider>
        <EChart option={{ series: [] }} />
      </ThemeProvider>,
    )
    expect(registerThemeVersion).toHaveBeenCalledWith('light', 0)
  })

  it('recolors dark token hexes in the option under the light theme', async () => {
    localStorage.setItem('finance.theme', 'light')
    render(
      <ThemeProvider>
        <EChart option={{ series: [{ type: 'bar', itemStyle: { color: DARK.positive } }] }} />
      </ThemeProvider>,
    )
    const instance = lastChart()
    await waitFor(() => expect(instance.setOption).toHaveBeenCalled())
    const applied = instance.setOption.mock.calls.at(-1)?.[0] as {
      series: { itemStyle: { color: string } }[]
    }
    expect(applied.series[0].itemStyle.color).toBe(LIGHT.positive)
  })

  it('leaves the option untouched under the dark theme (dark is the identity)', () => {
    render(
      <ThemeProvider>
        <EChart option={{ series: [{ type: 'bar', itemStyle: { color: DARK.positive } }] }} />
      </ThemeProvider>,
    )
    const applied = lastChart().setOption.mock.calls.at(-1)?.[0] as {
      series: { itemStyle: { color: string } }[]
    }
    expect(applied.series[0].itemStyle.color).toBe(DARK.positive)
  })
})

describe('EChart — group, decals, live reduced motion (chart grammar)', () => {
  const connect = () => vi.mocked((chartsModule.echarts as unknown as { connect: (g: string) => void }).connect)

  it('sets chart.group and connects on every init — the theme re-init included', async () => {
    function Harness() {
      const { setTheme } = useTheme()
      return (
        <>
          <button onClick={() => setTheme('light')}>go light</button>
          <EChart option={OPTION} group="net-worth" />
        </>
      )
    }
    render(<ThemeProvider><Harness /></ThemeProvider>)
    expect((lastChart() as unknown as { group: string }).group).toBe('net-worth')
    expect(connect()).toHaveBeenCalledWith('net-worth')
    act(() => screen.getByText('go light').click())
    await waitFor(() => expect(connect()).toHaveBeenCalledTimes(2))
    expect((lastChart() as unknown as { group: string }).group).toBe('net-worth')
  })

  it('does not connect a chart without a group', () => {
    render(<EChart option={OPTION} />)
    expect(connect()).not.toHaveBeenCalled()
  })

  it('merges the aria decal when Chart patterns is on, with echarts’ own label generation OFF', () => {
    localStorage.setItem('finance.chartDecals', 'on')
    render(<EChart option={{ series: [] } as EChartsOption} ariaLabel="Test" />)
    const [applied] = lastChart().setOption.mock.calls[0] as [Record<string, unknown>]
    expect(applied.aria).toEqual({ enabled: true, label: { enabled: false }, decal: { show: true } })
    localStorage.clear()
    cleanup()
    render(<EChart option={{ series: [] } as EChartsOption} />)
    expect('aria' in (lastChart().setOption.mock.calls[0] as [Record<string, unknown>])[0]).toBe(false)
  })

  it('re-applies animation: false when the OS preference flips while mounted', () => {
    let listeners: (() => void)[] = []
    const media = {
      matches: false,
      addEventListener: (_: string, cb: () => void) => { listeners.push(cb) },
      removeEventListener: (_: string, cb: () => void) => { listeners = listeners.filter((l) => l !== cb) },
    }
    vi.stubGlobal('matchMedia', () => media)
    render(<EChart option={{ series: [] } as EChartsOption} />)
    const chart = lastChart()
    expect('animation' in (chart.setOption.mock.calls[0] as [Record<string, unknown>])[0]).toBe(false)
    act(() => { media.matches = true; listeners.forEach((l) => l()) })
    const last = chart.setOption.mock.calls.at(-1) as [Record<string, unknown>]
    expect(last[0].animation).toBe(false)
  })
})
