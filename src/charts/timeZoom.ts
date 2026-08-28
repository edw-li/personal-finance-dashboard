// Preset time windows for the long category-axis charts (net worth, spending, portfolio
// performance). Pure string math over ISO dates — never `new Date(iso)` (format.ts's
// UTC-shift rule); zero-padded ISO strings compare correctly as strings, including months
// ('YYYY-MM-01') against full dates ('YYYY-MM-DD').

export type RangePreset = 'all' | '1y' | 'ytd'

/**
 * Index of the first point inside the preset's window. Windows are anchored on the LAST
 * data point, not on today: a hand-entered series can trail the calendar by weeks, and a
 * today-anchored 1Y over stale data would silently chop real months off the front while
 * showing dead space at the end.
 */
export function rangeStartIndex(dates: string[], preset: RangePreset): number {
  if (preset === 'all' || dates.length === 0) return 0
  const last = dates[dates.length - 1]
  const cutoff =
    preset === 'ytd'
      ? `${last.slice(0, 4)}-01-01`
      : // Same month/day, prior year. A Feb-29 anchor yields the non-date '…-02-29' in a
        // common year — harmless, because '>=' on ISO strings still cuts at March 1.
        `${Number(last.slice(0, 4)) - 1}${last.slice(4)}`
  const index = dates.findIndex((d) => d >= cutoff)
  return index === -1 ? 0 : index
}

export interface InsideZoomOption {
  type: 'inside'
  /** Index into the category axis — appended categories (the live ping) don't shift it. */
  startValue: number
  /** Present only when a page mirrors a manual window back in (rangeZoom below) —
   * presets deliberately omit it so every window runs to the newest point. */
  endValue?: number
  /** Bare wheel keeps scrolling the page; ctrl+wheel zooms (drag still pans when zoomed). */
  zoomOnMouseWheel: 'ctrl'
  moveOnMouseWheel: false
}

/**
 * The dataZoom config a preset resolves to. endValue is deliberately omitted: every
 * window runs to the newest point, and a fresh option identity (the chips hand back a new
 * `{preset}` object per click) resets any manual ctrl+wheel wandering.
 */
export function timeZoom(dates: string[], preset: RangePreset): InsideZoomOption[] {
  return [
    {
      type: 'inside',
      startValue: rangeStartIndex(dates, preset),
      zoomOnMouseWheel: 'ctrl',
      moveOnMouseWheel: false,
    },
  ]
}

export interface ZoomWindow {
  /** Category-axis indices, read back off the chart's option by EChart's datazoom
   * mirror — appended categories (the live ping) don't shift them. */
  startValue: number
  endValue: number
}

/**
 * A page's whole window state (2026-08-25 spec §2e): the chips' preset plus, transiently,
 * a manual ctrl+wheel wander. The chips hand back a fresh `{ preset }` carrying NO window
 * — overwriting this state is exactly their existing snap-back contract, now made
 * explicit in the type.
 */
export interface RangeState {
  preset: RangePreset
  window?: ZoomWindow
}

/**
 * timeZoom with any mirrored manual window layered over the preset, so option rebuilds
 * (refetches, notMerge) and same-axis sibling charts keep the window the user dragged
 * out instead of snapping back to the preset on every re-render.
 *
 * A window whose start falls off the END of a SHORTER axis is dropped rather than
 * applied: the series was replaced wholesale (a granularity flip, a re-import) and the
 * stale indices would pin the chart to a degenerate one-bar window nobody asked for.
 * Falling back to the preset is the honest reading — the axis the window described is
 * gone. Windows that merely overhang the end still apply: echarts clamps those itself.
 */
export function rangeZoom(dates: string[], range: RangeState): InsideZoomOption[] {
  const [zoom] = timeZoom(dates, range.preset)
  if (range.window === undefined || range.window.startValue >= dates.length) return [zoom]
  return [{ ...zoom, startValue: range.window.startValue, endValue: range.window.endValue }]
}

/**
 * The window a RangeState RESOLVES to, with endValue made explicit: option-side presets
 * deliberately omit it ("runs to the newest point"), but the animated dataZoom ACTION
 * path (EChart's zoomWindow fast path — spec Addendum §A2) needs the index. Layers the
 * mirrored manual window exactly like rangeZoom, including its stale-window drop.
 * `axisLength` covers axes that run PAST the dates array (Portfolio's appended live-ping
 * category): a preset must resolve to the real axis end, or the dispatch would clip the
 * ping that the option-side "no endValue" deliberately keeps in frame.
 */
export function resolvedWindow(
  dates: string[],
  range: RangeState,
  axisLength: number = dates.length,
): ZoomWindow {
  const [zoom] = rangeZoom(dates, range)
  return {
    startValue: zoom.startValue,
    endValue: zoom.endValue ?? Math.max(0, axisLength - 1),
  }
}
