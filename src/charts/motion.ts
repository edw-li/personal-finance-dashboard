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
