import { useEffect, useRef } from 'react'
import { echarts, registerThemeVersion } from '../charts/echarts'
import type { EChartsOption } from '../charts/echarts'
import { quiesceRipples } from '../charts/motion'
import { lightFromDark, recolorOption } from '../charts/recolor'
import type { ZoomWindow } from '../charts/timeZoom'
import { useChartDecals } from './useChartDecals'
import { useReducedMotion } from './useReducedMotion'
import { useTheme } from './shell/ThemeProvider'

export type EChartsInstance = ReturnType<typeof echarts.init>

// The subset of echarts event params the pages consume; the runtime object carries more.
export interface EChartEventParams {
  seriesName?: string
  seriesType?: string
  name?: string
  dataIndex?: number
  value?: unknown
}

export default function EChart({
  option,
  height = 320,
  ariaLabel,
  onClick,
  onHover,
  onHoverEnd,
  instanceRef,
  onLegendChange,
  onDataZoom,
  animateEntrance = true,
  zoomWindow,
  group,
}: {
  option: EChartsOption
  height?: number
  // A one-sentence description of what the chart SHOWS (deliberate house wording — ECharts'
  // generated aria is switched off in the decal merge below). REQUIRED since the chart
  // grammar (2026-09-04, spec §14): ChartCard forwards its own required prop, so a nameless
  // mount is a compile error, not a review note.
  ariaLabel: string
  onClick?: (params: EChartEventParams) => void
  onHover?: (params: EChartEventParams) => void
  onHoverEnd?: () => void
  // Escape hatch for cross-chart coordination (dispatchAction from a sibling chart's
  // handlers). Must be a STABLE ref (useRef) — a fresh object every render would
  // re-init the chart via the effect dep below.
  instanceRef?: { current: EChartsInstance | null }
  /** Mirrors legend toggles into page state (2026-08-25 spec §2e) with echarts' full
   *  name→shown map, COPIED — fed back via legend.selected so notMerge rebuilds keep
   *  the picks. */
  onLegendChange?: (selected: Record<string, boolean>) => void
  /** Mirrors a ctrl+wheel/drag-pan window into page state, as category-axis indices. */
  onDataZoom?: (window: { startValue: number; endValue: number }) => void
  /** false = paint the option already-drawn (cached revisits must not replay the
   *  entrance dance — 2026-08-27 spec §1). Default true. Merged after the page's
   *  option, exactly like the reduced-motion force. */
  animateEntrance?: boolean
  /** The resolved target window for the option's dataZoom (timeZoom's resolvedWindow).
   *  When set, an option change that differs ONLY in its dataZoom is applied as an
   *  animated dataZoom ACTION on the live instance instead of a notMerge rebuild —
   *  the range chips morph instead of snapping (spec Addendum §A2). Pass a
   *  useMemo'd value: the fingerprint compare below runs per effect firing.
   *  CONTRACT: the fingerprint is JSON — it carries the option, the resolved theme,
   *  `__decals` and `__reduced`, and function-valued props (tooltip/axisLabel formatters,
   *  grammar.ts's `stagger` delay) are invisible to it. A formatter closure may only
   *  capture state that ALSO surfaces in serializable option parts (series names/ids/data),
   *  or a formatter-only change would ride the fast path and never reach the chart. All
   *  six wired options hold this today (verified 2026-08-27). */
  zoomWindow?: ZoomWindow
  /** echarts.connect group (chart spec §8): same-axis siblings share axisPointer and zoom.
   *  Set on the instance and connected in the init effect so a theme re-init re-connects. */
  group?: string
}) {
  const { resolved, version: themeVersion } = useTheme()
  // Live (spec §11): a change of the OS preference while mounted re-runs the option effect
  // below and re-applies `animation: false` — the module-scope read it replaces froze the
  // answer at first import.
  const reducedMotion = useReducedMotion()
  // Appearance › Chart patterns (spec §14).
  const decals = useChartDecals()
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsInstance | null>(null)
  // Fingerprint of the last APPLIED option minus its dataZoom (the zoom fast path's
  // "nothing else changed" proof). Reset whenever the chart itself is rebuilt — a fresh
  // instance has no applied option to be equal to.
  const lastStrippedRef = useRef<string | null>(null)
  const onClickRef = useRef(onClick)
  const onHoverRef = useRef(onHover)
  const onHoverEndRef = useRef(onHoverEnd)
  const onLegendChangeRef = useRef(onLegendChange)
  const onDataZoomRef = useRef(onDataZoom)

  // Latest-handler refs, refreshed after each render so the chart's listeners never
  // have to be rebound. Assigning during render trips react-hooks/refs ("Cannot update
  // ref during render"); an unkeyed effect is the sanctioned form. Safe on mount:
  // useRef seeds the first handlers, and events can only arrive after effects have run.
  useEffect(() => {
    onClickRef.current = onClick
    onHoverRef.current = onHover
    onHoverEndRef.current = onHoverEnd
    onLegendChangeRef.current = onLegendChange
    onDataZoomRef.current = onDataZoom
  })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    // Chrome (axes, legend, tooltip) comes from the REGISTERED theme, so a palette change
    // has to re-init. Register unconditionally rather than trusting that version 0 still
    // means the dark 'finance' theme echarts.ts registered at import: registration is one
    // map write, and doing it here makes every init self-contained — the name handed to
    // init() always holds the palette this render resolved, with no cross-module invariant
    // to keep. Series colors are handled by recolorOption in the effect below, not here.
    const name = registerThemeVersion(resolved, themeVersion)
    const chart = echarts.init(el, name)
    if (group !== undefined) {
      // A disposed instance leaves its group by itself, and every init (theme re-inits
      // included) reconnects — so dispose below deliberately does NOT call disconnect(),
      // which would unlink the surviving siblings too.
      chart.group = group
      echarts.connect(group)
    }
    chart.on('click', (params) => onClickRef.current?.(params as EChartEventParams))
    chart.on('mouseover', (params) => onHoverRef.current?.(params as EChartEventParams))
    // mouseout fires per-item; globalout covers fast exits that skip it — without it a
    // cross-chart highlight would stick after the cursor leaves the canvas.
    chart.on('mouseout', () => onHoverEndRef.current?.())
    chart.on('globalout', () => onHoverEndRef.current?.())
    chart.on('legendselectchanged', (params) => {
      // Copied, not aliased: echarts mutates its own map on the next toggle.
      onLegendChangeRef.current?.({
        ...(params as { selected: Record<string, boolean> }).selected,
      })
    })
    chart.on('datazoom', () => {
      // The event's own payload is percent-based (and batch-shaped from inside zooms);
      // the RESOLVED category-axis indices live on the option — read them back instead.
      const zoom = (
        chart.getOption() as { dataZoom?: { startValue?: unknown; endValue?: unknown }[] }
      ).dataZoom?.[0]
      if (zoom && typeof zoom.startValue === 'number' && typeof zoom.endValue === 'number') {
        onDataZoomRef.current?.({ startValue: zoom.startValue, endValue: zoom.endValue })
      }
    })
    chartRef.current = chart
    lastStrippedRef.current = null
    if (instanceRef) instanceRef.current = chart
    // The browser fires this the moment observe() is called, carrying the size the chart was
    // just init'ed at; resize() there restarts every animator, killing the entrance (spec §6).
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== chart.getWidth() || el.clientHeight !== chart.getHeight()) {
        chart.resize()
      }
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
      lastStrippedRef.current = null
      if (instanceRef) instanceRef.current = null
    }
  }, [instanceRef, resolved, themeVersion, group])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    // The theme rides in the fingerprint so a palette change is never mistaken for a
    // zoom-only change (which would skip the rebuild and leave the old colors painted).
    // Second line of defence only: the init effect's lastStrippedRef reset already denies
    // the fast path its "equal to the last applied option" precondition after a rebuild.
    // `__reduced` is load-bearing in its own right: the applied option carries
    // `animation: false` under reduce, so a LIVE reduce → no-preference flip has to rebuild
    // to lift it. Without it the flip would find an unchanged fingerprint, take the fast
    // path (which the same flip has just re-enabled) and settle as a no-op — leaving the
    // chart animation-less until some unrelated data change repainted it.
    const stripped = JSON.stringify({
      ...option,
      dataZoom: undefined,
      __theme: resolved,
      __decals: decals,
      __reduced: reducedMotion,
    })
    // Zoom-only fast path (spec Addendum §A2): same option apart from the window → an
    // animated dataZoom ACTION morphs the series on the live instance; the notMerge
    // rebuild below is what used to make the chips snap. Skipped under reduced motion
    // (the rebuild with animation:false snaps, byte-identical to before) and settled
    // as a no-op when the chart already sits at the target (the ctrl+wheel mirror's
    // echo: datazoom event → page state → option rebuild → same window).
    if (
      !reducedMotion &&
      zoomWindow !== undefined &&
      lastStrippedRef.current !== null &&
      lastStrippedRef.current === stripped
    ) {
      const current = (
        chart.getOption() as { dataZoom?: { startValue?: unknown; endValue?: unknown }[] }
      ).dataZoom?.[0]
      if (
        current === undefined ||
        current.startValue !== zoomWindow.startValue ||
        current.endValue !== zoomWindow.endValue
      ) {
        chart.dispatchAction({
          type: 'dataZoom',
          startValue: zoomWindow.startValue,
          endValue: zoomWindow.endValue,
        })
      }
      return
    }
    // notMerge: pages always send complete options; merging stale series causes ghosts.
    // Reduced-motion is forced AFTER the spread — a page option must never re-enable
    // animation against the user's OS preference (Global rules a11y promise). The flag
    // alone is not enough: ripple animators ignore it, so quiesceRipples covers the gap.
    // animateEntrance suppresses the ENTRANCE only (animationDuration: 0) — update
    // animation must survive a cached paint, or the zoom morphs above and Projection's
    // trend-span toggles would snap until the first changed revalidation (Addendum §A2).
    // Light theme: swap every dark token hex in the finished option for its light twin.
    // Builders stay theme-blind (charts/recolor.ts). Dark is the identity.
    const themed =
      resolved === 'light' ? (recolorOption(option, lightFromDark) as EChartsOption) : option
    const base = reducedMotion ? quiesceRipples(themed) : themed
    chart.setOption(
      {
        ...base,
        // Decals ride echarts' aria component; its own label generation is OFF because it
        // would overwrite the container's house aria-label with a generated sentence.
        ...(decals ? { aria: { enabled: true, label: { enabled: false }, decal: { show: true } } } : {}),
        ...(reducedMotion
          ? { animation: false }
          : !animateEntrance
            ? { animationDuration: 0 }
            : {}),
      },
      { notMerge: true },
    )
    lastStrippedRef.current = stripped
    // `resolved` and `themeVersion` mirror the init effect's theme deps: that effect
    // disposes and rebuilds the instance on a palette change, and a rebuilt chart holds NO
    // option, so this effect must re-run in the same commit (effects fire in declaration
    // order) to repaint it. Dropping either dep leaves a blank canvas whenever the option
    // object itself is stable across the switch — which is the normal case, since pages
    // useMemo their options. `themeVersion` cannot move without `resolved` today
    // (ThemeProvider bumps it only when the palette changes); it is listed because the
    // init effect keys on it, and the two must not drift.
  }, [option, animateEntrance, zoomWindow, resolved, themeVersion, reducedMotion, decals])

  return (
    <div
      ref={containerRef}
      // Unconditional: `ariaLabel` is required, so the role can never name an unlabelled
      // image (the hedge it replaced only existed while the prop was optional).
      role="img"
      aria-label={ariaLabel}
      style={{ height, width: '100%' }}
    />
  )
}
