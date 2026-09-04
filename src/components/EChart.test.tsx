import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EChartsOption } from '../charts/echarts'
import { DARK, LIGHT } from '../theme/tokens'

interface FakeChartLike {
  handlers: Record<string, (params?: unknown) => void>
  setOption: ReturnType<typeof vi.fn>
  getDataURL: ReturnType<typeof vi.fn>
  getOption: ReturnType<typeof vi.fn>
  dispatchAction: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  getWidth: ReturnType<typeof vi.fn>
  getHeight: ReturnType<typeof vi.fn>
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
    // jsdom's container is 0×0, so a fake answering 0 is a chart already at its element's size.
    getWidth = vi.fn(() => 0)
    getHeight = vi.fn(() => 0)
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

import EChart from './EChart'
import * as chartsModule from '../charts/echarts'
import ThemeProvider, { useTheme } from './shell/ThemeProvider'

const instances = (chartsModule as unknown as { __instances: FakeChartLike[] }).__instances

function lastChart(): FakeChartLike {
  return instances[instances.length - 1]
}

const OPTION = {} as EChartsOption

// The browser fires a ResizeObserver's callback the moment observe() is called; these are
// the captured callbacks, so a test can fire that notification itself.
let resizeNotify: (() => void)[] = []

beforeEach(() => {
  resizeNotify = []
  // jsdom has no ResizeObserver; the wrapper observes its container on mount.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) { resizeNotify.push(cb) }
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

  // The label is REQUIRED since the chart grammar (spec §14, F11): a nameless mount is a
  // compile error, not a review note, so `role="img"` no longer has to hedge against an
  // unnamed image. The @ts-expect-error IS the assertion — if the prop ever goes back to
  // optional, tsc fails on the now-unused directive; the runtime half pins the role as
  // unconditional (it was `undefined` while the prop was optional).
  it('requires the label at the compiler and paints role="img" unconditionally', () => {
    const { container } = render(
      // @ts-expect-error ariaLabel is required — every chart names what it shows.
      <EChart option={OPTION} />,
    )
    const div = container.firstElementChild as HTMLElement
    expect(div.getAttribute('role')).toBe('img')
  })
})

describe('EChart event mirrors', () => {
  it('hands legendselectchanged a COPY of the name→shown map', () => {
    const onLegendChange = vi.fn()
    render(<EChart ariaLabel="test chart" option={OPTION} onLegendChange={onLegendChange} />)
    const selected = { 'Net pay': false, '4% rule': true }
    lastChart().handlers['legendselectchanged']({ name: 'Net pay', selected })
    expect(onLegendChange).toHaveBeenCalledWith({ 'Net pay': false, '4% rule': true })
    // Copied, not aliased: echarts mutates its own map on the next toggle.
    expect(onLegendChange.mock.calls[0][0]).not.toBe(selected)
  })

  it('reads the resolved index window off the option on datazoom', () => {
    const onDataZoom = vi.fn()
    render(<EChart ariaLabel="test chart" option={OPTION} onDataZoom={onDataZoom} />)
    lastChart().handlers['datazoom']()
    expect(onDataZoom).toHaveBeenCalledWith({ startValue: 3, endValue: 9 })
  })

  it('stays silent when the option carries no numeric window', () => {
    const onDataZoom = vi.fn()
    render(<EChart ariaLabel="test chart" option={OPTION} onDataZoom={onDataZoom} />)
    lastChart().getOption.mockReturnValue({ dataZoom: [{}] })
    lastChart().handlers['datazoom']()
    expect(onDataZoom).not.toHaveBeenCalled()
  })

  it('always fires the LATEST handler without rebinding (the ref pattern)', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<EChart
      ariaLabel="test chart"
      option={OPTION}
      onLegendChange={first}
    />)
    rerender(<EChart ariaLabel="test chart" option={OPTION} onLegendChange={second} />)
    lastChart().handlers['legendselectchanged']({ selected: { A: false } })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith({ A: false })
  })
})

// jsdom's matchMedia reports matches: false, so the REDUCED_MOTION path is idle here and
// the only thing that can force `animation: false` is the new prop.
describe('EChart animateEntrance (2026-08-27 spec §1)', () => {
  it('animateEntrance={false} suppresses the ENTRANCE only — update animation survives', () => {
    render(<EChart
      ariaLabel="test chart"
      option={{ series: [] } as EChartsOption}
      animateEntrance={false}
    />)
    const chart = instances[0]
    const [option] = chart.setOption.mock.calls[0] as [Record<string, unknown>]
    expect(option.animationDuration).toBe(0)
    expect('animation' in option).toBe(false)
  })

  it('animateEntrance defaults on (no forced animation flag)', () => {
    render(<EChart ariaLabel="test chart" option={{ series: [] } as EChartsOption} />)
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
        ariaLabel="test chart"
        option={{ series, dataZoom: [{ type: 'inside', startValue: 3 }] } as EChartsOption}
        zoomWindow={{ startValue: 3, endValue: 9 }}
      />,
    )
    const chart = instances[0]
    expect(chart.setOption).toHaveBeenCalledTimes(1)
    rerender(
      <EChart
        ariaLabel="test chart"
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
        ariaLabel="test chart"
        option={{ series, dataZoom: [{ type: 'inside', startValue: 3 }] } as EChartsOption}
        zoomWindow={{ startValue: 3, endValue: 9 }}
      />,
    )
    const chart = instances[0]
    rerender(
      <EChart
        ariaLabel="test chart"
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
        ariaLabel="test chart"
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
        ariaLabel="test chart"
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

  // The fingerprint carries `__reduced` for exactly this: under reduce the applied option
  // holds `animation: false`, and the fast path is gated on `!reducedMotion`. A live
  // reduce → no-preference flip therefore ARRIVES at a re-enabled fast path with an
  // otherwise-unchanged option — without `__reduced` it would settle as a no-op (the chart
  // already sits at the window) and the animation-less option would stay painted.
  it('a live reduce → no-preference flip rebuilds instead of riding the zoom fast path', () => {
    let listeners: (() => void)[] = []
    const media = {
      matches: true,
      addEventListener: (_: string, cb: () => void) => { listeners.push(cb) },
      removeEventListener: (_: string, cb: () => void) => { listeners = listeners.filter((l) => l !== cb) },
    }
    vi.stubGlobal('matchMedia', () => media)
    const option = { series, dataZoom: [{ type: 'inside', startValue: 3 }] } as EChartsOption
    render(<EChart
      ariaLabel="test chart"
      option={option}
      zoomWindow={{ startValue: 3, endValue: 9 }}
    />)
    const chart = instances[0]
    expect((chart.setOption.mock.calls[0] as [Record<string, unknown>])[0].animation).toBe(false)
    // Same option object, same window — only the OS preference moves.
    act(() => { media.matches = false; listeners.forEach((l) => l()) })
    expect(chart.setOption).toHaveBeenCalledTimes(2)
    expect('animation' in (chart.setOption.mock.calls[1] as [Record<string, unknown>])[0]).toBe(false)
    expect(chart.dispatchAction).not.toHaveBeenCalled()
  })

  it('without zoomWindow, a zoom-only change still rebuilds (opt-in contract)', () => {
    const { rerender } = render(
      <EChart
        ariaLabel="test chart"
        option={{ series, dataZoom: [{ type: 'inside', startValue: 3 }] } as EChartsOption}
      />,
    )
    const chart = instances[0]
    rerender(
      <EChart
        ariaLabel="test chart"
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
          <EChart ariaLabel="test chart" option={THEMED} onClick={onClick} />
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
        <EChart ariaLabel="test chart" option={{ series: [] }} />
      </ThemeProvider>,
    )
    expect(registerThemeVersion).toHaveBeenCalledWith('light', 0)
  })

  it('recolors dark token hexes in the option under the light theme', async () => {
    localStorage.setItem('finance.theme', 'light')
    render(
      <ThemeProvider>
        <EChart
          ariaLabel="test chart"
          option={{ series: [{ type: 'bar', itemStyle: { color: DARK.positive } }] }}
        />
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
        <EChart
          ariaLabel="test chart"
          option={{ series: [{ type: 'bar', itemStyle: { color: DARK.positive } }] }}
        />
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
          <EChart ariaLabel="test chart" option={OPTION} group="net-worth" />
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

  it('a group change re-points the LIVE instance instead of re-initializing it', () => {
    const init = vi.mocked(chartsModule.echarts.init)
    const { rerender } = render(<EChart ariaLabel="test chart" option={OPTION} group="spending" />)
    const chart = lastChart()
    const inits = init.mock.calls.length
    // Spending's drill (SpendingPage:497) and its trend compare toggle (:664) both flip the
    // group; disposing there throws away the canvas the bar → pie universalTransition needs.
    rerender(<EChart ariaLabel="test chart" option={OPTION} />)
    expect(chart.dispose).not.toHaveBeenCalled()
    expect(init.mock.calls.length).toBe(inits)
    expect((chart as unknown as { group: string }).group).toBe('')
    rerender(<EChart ariaLabel="test chart" option={OPTION} group="spending" />)
    expect(lastChart()).toBe(chart)
    expect((chart as unknown as { group: string }).group).toBe('spending')
  })

  it('does not connect a chart without a group', () => {
    render(<EChart ariaLabel="test chart" option={OPTION} />)
    expect(connect()).not.toHaveBeenCalled()
  })

  it('merges the aria decal when Chart patterns is on, with echarts’ own label generation OFF', () => {
    localStorage.setItem('finance.chartDecals', 'on')
    render(<EChart option={{ series: [] } as EChartsOption} ariaLabel="Test" />)
    const [applied] = lastChart().setOption.mock.calls[0] as [Record<string, unknown>]
    expect(applied.aria).toEqual({ enabled: true, label: { enabled: false }, decal: { show: true } })
    localStorage.clear()
    cleanup()
    render(<EChart ariaLabel="test chart" option={{ series: [] } as EChartsOption} />)
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
    render(<EChart ariaLabel="test chart" option={{ series: [] } as EChartsOption} />)
    const chart = lastChart()
    expect('animation' in (chart.setOption.mock.calls[0] as [Record<string, unknown>])[0]).toBe(false)
    act(() => { media.matches = true; listeners.forEach((l) => l()) })
    const last = chart.setOption.mock.calls.at(-1) as [Record<string, unknown>]
    expect(last[0].animation).toBe(false)
  })
})

describe('EChart resize guard (spec §6)', () => {
  it('ignores the notification that only echoes the size the engine already holds', () => {
    render(<EChart ariaLabel="test chart" option={OPTION} />)
    resizeNotify.forEach((fire) => fire())
    // resize() mid-entrance restarts every animator from frame 0 — why entrances have never been seen.
    expect(lastChart().resize).not.toHaveBeenCalled()
  })
  it('resizes when the element and the engine disagree', () => {
    render(<EChart ariaLabel="test chart" option={OPTION} />)
    const chart = lastChart()
    chart.getWidth.mockReturnValue(800) // the element is still jsdom's 0-wide
    resizeNotify.forEach((fire) => fire())
    expect(chart.resize).toHaveBeenCalledTimes(1)
  })
})

describe('EChart first paint waits for visibility (spec §6)', () => {
  type IOEntry = { isIntersecting: boolean; intersectionRatio: number }
  let notify: ((entries: IOEntry[]) => void)[] = []
  let disconnects: ReturnType<typeof vi.fn>[] = []
  // jsdom has no IntersectionObserver, so only this describe has one — every other case in
  // the file keeps painting synchronously, which is the no-observer contract below.
  beforeEach(() => {
    notify = []
    disconnects = []
    vi.stubGlobal('IntersectionObserver', vi.fn((cb: (entries: IOEntry[]) => void) => {
      const disconnect = vi.fn()
      disconnects.push(disconnect)
      return { observe: () => notify.push(cb), disconnect, unobserve: () => {} }
    }))
  })
  it('holds the first animated paint until 20% of the canvas is on screen, once', () => {
    render(<EChart ariaLabel="test chart" option={{ series: [] } as EChartsOption} />)
    const chart = lastChart()
    expect(chart.setOption).not.toHaveBeenCalled()
    // isIntersecting alone is not the gate: a 5%-visible chart is reported as intersecting.
    notify.forEach((fire) => fire([{ isIntersecting: true, intersectionRatio: 0.05 }]))
    expect(chart.setOption).not.toHaveBeenCalled()
    notify.forEach((fire) => fire([{ isIntersecting: true, intersectionRatio: 0.6 }]))
    expect(chart.setOption).toHaveBeenCalledTimes(1)
    const [first] = chart.setOption.mock.calls[0] as [Record<string, unknown>]
    expect('animationDuration' in first).toBe(false)
    expect(disconnects[0]).toHaveBeenCalled() // one-shot: scrolling away never re-arms it
  })
  it('a cached paint never waits — it has no entrance to protect', () => {
    render(<EChart ariaLabel="test chart" option={{ series: [] } as EChartsOption} animateEntrance={false} />)
    const [only] = lastChart().setOption.mock.calls[0] as [Record<string, unknown>]
    expect(only.animationDuration).toBe(0)
  })
  it('the entrance is the mount’s only one — the next paint is already-drawn', () => {
    const bars = (v: number) => ({ series: [{ type: 'bar', data: [v] }] }) as EChartsOption
    const { rerender } = render(<EChart ariaLabel="test chart" option={bars(1)} />)
    const chart = lastChart()
    notify.forEach((fire) => fire([{ isIntersecting: true, intersectionRatio: 1 }]))
    rerender(<EChart ariaLabel="test chart" option={bars(2)} />)
    const last = chart.setOption.mock.calls.at(-1) as [Record<string, unknown>]
    expect(last[0].animationDuration).toBe(0)
  })
  it('with no observer nothing waits, and a theme re-init repaints already-drawn', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    function Harness() {
      const { setTheme } = useTheme()
      return (<><button onClick={() => setTheme('light')}>go light</button><EChart ariaLabel="test chart" option={OPTION} /></>)
    }
    render(<ThemeProvider><Harness /></ThemeProvider>)
    const [first] = lastChart().setOption.mock.calls[0] as [Record<string, unknown>]
    expect('animationDuration' in first).toBe(false)
    act(() => screen.getByText('go light').click())
    await waitFor(() => expect(instances.length).toBe(2))
    const [after] = lastChart().setOption.mock.calls[0] as [Record<string, unknown>]
    expect(after.animationDuration).toBe(0)
  })
})

describe('EChart cursor and tooltip motion (spec §6)', () => {
  const bar = { series: [{ type: 'bar' }], tooltip: { formatter: () => 'x' } } as EChartsOption
  const applied = () => lastChart().setOption.mock.calls[0][0] as
    { series: { cursor?: string }[]; tooltip: { transitionDuration?: number; formatter?: unknown } }
  it('a chart with no onClick paints series that do not pretend to be clickable', () => {
    render(<EChart ariaLabel="test chart" option={bar} />)
    expect(applied().series[0].cursor).toBe('default')
  })
  it('an onClick leaves the pointer alone', () => {
    render(<EChart ariaLabel="test chart" option={bar} onClick={vi.fn()} />)
    expect(applied().series[0].cursor).toBeUndefined()
  })
  it('under reduce the tooltip snaps, keeping the page’s own formatter', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    render(<EChart ariaLabel="test chart" option={bar} />)
    // notMerge: a bare `tooltip: { transitionDuration: 0 }` would drop the formatter with it.
    expect(applied().tooltip.transitionDuration).toBe(0)
    expect(typeof applied().tooltip.formatter).toBe('function')
  })
})
