// Motion rules that a global flag cannot express, plus the house clock every chart
// inherits. Lives beside echarts.ts rather than in EChart.tsx because the wrapper is a
// component module (a value export there trips react-refresh/only-export-components).
import type { EChartsOption } from './echarts'

/** The house motion clock (chart spec §11). buildTheme() spreads it into every registered
 *  theme, so no builder names a duration; grammar.ts's `stagger()` layers a per-series
 *  delay on stacks. Reduced motion still wins: EChart forces `animation: false` after
 *  the option spread, and `quiesceRipples` below covers the one animator that ignores it. */
export const MOTION = {
  animationDuration: 450,
  animationEasing: 'cubicOut' as const,
  animationDurationUpdate: 300,
  animationEasingUpdate: 'cubicInOut' as const,
}

// `animation: false` does NOT reach an effectScatter's ripple: EffectSymbol starts a
// looping zrender animator per ripple unconditionally (nothing in that module consults
// the global animation flag), so a live ping would pulse forever against the OS
// preference. Setting rippleEffect.number to 0 makes that loop body never run — the
// point still renders, only the motion is gone. Swapping the series to type 'scatter' is
// NOT the fix either: ScatterChart IS registered (the net-worth note markers), but a
// still dot loses the live ping's one meaning — "this reading is now" — which the ripple
// carries and a plain marker does not.
/** Restates a motion rule on EVERY series, overwriting whatever the series already carries.
 *
 *  Required, not belt-and-braces: `SeriesModel.mergeDefaultAndTheme` merges `theme[seriesType]`
 *  (buildTheme's per-type blocks) and the series' own keys (SANKEY_MARKS' MOTION spread) INTO
 *  the series option, and `Model.getShallow` only falls back to the root option when the series
 *  itself lacks the key. So a root-only `animationDuration: 0` — the cached-paint rule — is
 *  invisible to line/pie/sankey/treemap, which would replay their 450ms entrance on every
 *  revalidation, scope change and theme swap. Same for `animation: false` under reduce, where
 *  treemap's own `defaultOption.animation` would otherwise win. Proven against the real engine
 *  in motion.ssr.test.ts. */
export function pinSeriesMotion(
  option: EChartsOption,
  motion: Record<string, unknown>,
): EChartsOption {
  const series = (option as { series?: unknown }).series
  if (series === undefined) return option
  // Spread LAST: the series' own 450 has to lose, which is the whole point.
  const pin = (one: unknown): unknown =>
    one !== null && typeof one === 'object' ? { ...one, ...motion } : one
  return { ...option, series: Array.isArray(series) ? series.map(pin) : pin(series) } as EChartsOption
}

const isSankey = (one: unknown): boolean =>
  one !== null && typeof one === 'object' && (one as { type?: unknown }).type === 'sankey'

/** Whether the option draws a sankey — EChart's test for "this paint creates the sankey's view". */
export function hasSankey(option: EChartsOption | null): boolean {
  const series = (option as { series?: unknown } | null)?.series
  return Array.isArray(series) ? series.some(isSankey) : isSankey(series)
}

/** Paints every sankey series with `animation: false` — for the paint that CREATES a sankey's view
 *  when that paint is still (a cached revisit's animateEntrance={false}, the re-init a theme swap
 *  forces). echarts 6.1.0's SankeyView wipes its first render in behind a clip rect sized to the
 *  nodes and removes the clip in the wipe's done callback; with a 0ms entrance, initProps runs that
 *  callback synchronously INSIDE createGridClipShape, before setClipPath attaches the rect, so the
 *  clip stays for the instance's life — the right-hand labels cut off at the last column, and the
 *  clip keeping its first width while the chart resizes wider (2026-09-24 report). The view adds
 *  no clip at all when animation is off. Only that one paint: every later one keeps the update
 *  animation. Proven against the real engine in motion.ssr.test.ts. */
export function unclipSankeyEntrance(option: EChartsOption): EChartsOption {
  const series = (option as { series?: unknown }).series
  if (series === undefined) return option
  const still = (one: unknown): unknown => (isSankey(one) ? { ...(one as object), animation: false } : one)
  return { ...option, series: Array.isArray(series) ? series.map(still) : still(series) } as EChartsOption
}

/** ECharts gives every series a 'pointer' cursor whether or not a click does anything, so a
 *  chart with no `onClick` promises a drill-in it lacks. An explicit cursor is left alone. */
export function defaultCursor(option: EChartsOption): EChartsOption {
  const series = (option as { series?: unknown }).series
  if (series === undefined) return option
  const blunt = (one: unknown): unknown => {
    const s = one as { cursor?: string } | null
    return s !== null && typeof s === 'object' && s.cursor === undefined ? { ...s, cursor: 'default' } : one
  }
  return { ...option, series: Array.isArray(series) ? series.map(blunt) : blunt(series) } as EChartsOption
}

export function quiesceRipples(option: EChartsOption): EChartsOption {
  const series = (option as { series?: unknown }).series
  if (series === undefined) return option
  const quiet = (one: unknown): unknown => {
    const s = one as { type?: string; rippleEffect?: object } | null
    return s?.type === 'effectScatter'
      ? { ...s, rippleEffect: { ...s.rippleEffect, number: 0 } }
      : one
  }
  return {
    ...option,
    series: Array.isArray(series) ? series.map(quiet) : quiet(series),
  } as EChartsOption
}
