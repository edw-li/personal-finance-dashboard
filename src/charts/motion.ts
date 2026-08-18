// Reduced-motion enforcement that a global flag cannot express. Lives beside echarts.ts
// rather than in EChart.tsx because the wrapper is a component module (a value export
// there trips react-refresh/only-export-components).
import type { EChartsOption } from './echarts'

// `animation: false` does NOT reach an effectScatter's ripple: EffectSymbol starts a
// looping zrender animator per ripple unconditionally (nothing in that module consults
// the global animation flag), so a live ping would pulse forever against the OS
// preference. Setting rippleEffect.number to 0 makes that loop body never run — the
// point still renders, only the motion is gone. Swapping to type 'scatter' is NOT an
// option: ScatterChart is not registered in echarts.ts and would render nothing.
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
