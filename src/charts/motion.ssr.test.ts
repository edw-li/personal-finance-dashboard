// @vitest-environment node
// The ONE place real echarts runs in this suite. House law keeps the engine out of jsdom
// because it needs a canvas; SSR mode needs none — it builds its real models (theme merge
// included) and draws to a string — so this is where the engine can be ASKED what it will
// animate, instead of the test restating what we hope it does.
import { describe, expect, it } from 'vitest'
// The app ships canvas-only (charts/echarts.ts); the SVG renderer is registered here and
// nowhere else, because ssr: true has to draw into a string rather than a <canvas>.
import { SVGRenderer } from 'echarts/renderers'
import { echarts } from './echarts'
import type { EChartsOption } from './echarts'
import { pinSeriesMotion, unclipSankeyEntrance } from './motion'
import { SANKEY_MARKS } from './sankey'

echarts.use([SVGRenderer])

// One series of each type whose own defaults out-rank a root-level animation key: the three
// buildTheme now writes a per-type block for, plus the sankey as both builders emit it
// (SANKEY_MARKS spreads MOTION straight onto the series).
const OPTION = {
  xAxis: { type: 'category', data: ['a', 'b'] },
  yAxis: { type: 'value' },
  series: [
    { type: 'line', data: [1, 2] },
    { type: 'pie', data: [{ name: 'a', value: 1 }] },
    { type: 'treemap', data: [{ name: 'a', value: 1 }] },
    {
      ...SANKEY_MARKS,
      data: [{ name: 'a' }, { name: 'b' }],
      links: [{ source: 'a', target: 'b', value: 1 }],
    },
  ],
} as unknown as EChartsOption

/** What the ENGINE will read per series when it decides how to animate: `getShallow` is the
 *  accessor echarts itself uses, and it falls back to the root option only when the series
 *  carries no key of its own. Registered theme 'finance' — the real one. */
function perSeries(option: EChartsOption, key: string): Record<string, unknown> {
  const chart = echarts.init(null, 'finance', {
    ssr: true,
    renderer: 'svg',
    width: 400,
    height: 300,
  })
  chart.setOption(option, { notMerge: true })
  const model = (
    chart as unknown as {
      getModel(): { getSeries(): { subType: string; getShallow(k: string): unknown }[] }
    }
  ).getModel()
  const out = Object.fromEntries(model.getSeries().map((s) => [s.subType, s.getShallow(key)]))
  chart.dispose()
  return out
}

describe('the cached-paint rule against the real engine', () => {
  // This is the trap pinSeriesMotion exists for, stated as a fact about echarts 6.1.0:
  // theme[seriesType] and the series' own keys are merged INTO the series before it is read.
  it('a ROOT-ONLY animationDuration: 0 never reaches these four', () => {
    expect(perSeries({ ...OPTION, animationDuration: 0 } as EChartsOption, 'animationDuration'))
      .toEqual({ line: 450, pie: 450, treemap: 450, sankey: 450 })
  })

  it('a ROOT-ONLY animation: false loses to treemap’s own default', () => {
    expect(perSeries({ ...OPTION, animation: false } as EChartsOption, 'animation'))
      .toEqual({ line: false, pie: false, treemap: true, sankey: false })
  })

  it('pinSeriesMotion reaches every one of them — cached paints truly snap', () => {
    const cached = pinSeriesMotion({ ...OPTION, animationDuration: 0 } as EChartsOption, {
      animationDuration: 0,
    })
    expect(perSeries(cached, 'animationDuration')).toEqual({
      line: 0, pie: 0, treemap: 0, sankey: 0,
    })
    // The update clock is NOT touched: a cached paint still morphs on the next data change.
    expect(perSeries(cached, 'animationDurationUpdate')).toEqual({
      line: 300, pie: 300, treemap: 300, sankey: 300,
    })
  })

  it('pinSeriesMotion carries reduced motion past the treemap default too', () => {
    const still = pinSeriesMotion({ ...OPTION, animation: false } as EChartsOption, {
      animation: false,
    })
    expect(perSeries(still, 'animation')).toEqual({
      line: false, pie: false, treemap: false, sankey: false,
    })
  })
})

// The cut-off sankey (2026-09-24 report: the right side cut off after navigating away and back,
// more of it the wider the window). SankeyView's FIRST render wipes the series in behind a clip
// rect sized to its nodes, and removes the clip in the wipe's done callback. With a 0ms entrance
// initProps runs that callback synchronously INSIDE createGridClipShape, before setClipPath has
// attached the rect, so the clip stays for the instance's life: the right-hand labels end at the
// nodes, and the clip keeps its first width while the chart resizes wider. A cached paint (the
// revisit's animateEntrance={false}, a theme swap's re-init) is exactly that 0ms first render.
describe('the sankey entrance clip against the real engine', () => {
  const FLOW = {
    series: [{
      ...SANKEY_MARKS,
      data: [{ name: 'Net pay' }, { name: 'Housing' }, { name: 'Savings' }],
      links: [{ source: 'Net pay', target: 'Housing', value: 3 }, { source: 'Net pay', target: 'Savings', value: 1 }],
    }],
  } as unknown as EChartsOption
  const clipsAfterFirstRender = (option: EChartsOption): number => {
    const chart = echarts.init(null, 'finance', { ssr: true, renderer: 'svg', width: 400, height: 300 })
    chart.setOption(option, { notMerge: true })
    const shown = (chart.getZr() as unknown as { storage: { getDisplayList(update: boolean): { __clipPaths?: unknown[] }[] } })
      .storage.getDisplayList(true)
    const clipped = shown.filter((el) => (el.__clipPaths?.length ?? 0) > 0).length
    chart.dispose()
    return clipped
  }

  it('a 0ms first render leaves the entrance clip on for good — the engine trap', () => {
    expect(clipsAfterFirstRender(pinSeriesMotion(FLOW, { animationDuration: 0 }))).toBeGreaterThan(0)
  })

  it('unclipSankeyEntrance paints that first render with no clip at all', () => {
    expect(clipsAfterFirstRender(unclipSankeyEntrance(pinSeriesMotion(FLOW, { animationDuration: 0 })))).toBe(0)
  })
})
