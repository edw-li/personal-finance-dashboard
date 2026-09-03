// THE tooltip contract (chart spec §7). axisTooltip() and itemTooltip() return complete
// `tooltip` components with one branded formatter each; conformance.ts refuses any option
// whose formatter is not branded here or in sankey.ts. Row order is the contract — see
// axisTooltip. Colors in the markup are CSS custom properties resolved from the series
// color, because recolor.ts cannot reach a formatter's output and `var(--chart-N)` follows
// the theme for free. Every series name is escaped unconditionally: category, account,
// grant and card names are user text, and the "own constants only" exemption ends here.
// Depends on: charts/theme.ts (the token hexes the swatch map keys on), utils/format.ts.
import { INK, MUTED, NEGATIVE, OTHER_SERIES_COLOR, PALETTE, POSITIVE } from './theme'
import { escapeHtml, formatCurrency, formatPct, formatShares } from '../utils/format'

export type TooltipUnit = 'money' | 'percent' | 'shares'

/** The echarts params subset the formatters read (the runtime object carries more). */
export interface AxisTooltipParam {
  seriesName?: string
  seriesType?: string
  marker?: string
  axisValueLabel?: string
  dataIndex?: number
  value?: unknown
  data?: unknown
  color?: unknown
}

export interface AxisTooltipOptions {
  /** Picks the value formatter: full currency (default), unsigned percent, shares. */
  unit?: TooltipUnit
  /** Stack members: sorted by value desc and totalled. */
  groups?: readonly string[]
  /** The Total row's label; `false` drops the row (a chart whose line IS the total). */
  totalLabel?: string | false
  /** Append "(xx.x%)" of the group total to every group row. */
  shareOf?: boolean
  /** Comparison series (budgets, sustainable spend, averages): listed after the total,
   *  muted, never summed. */
  references?: readonly string[]
  /** Marker series (Notes, Events) routed to `annotations` instead of a value row. */
  annotationSeries?: readonly string[]
  /** Returns ESCAPED lines for one annotation param (the caller escapes its own text). */
  annotations?: (param: AxisTooltipParam) => string[]
  /** Appended to a row's label (" (est.)"); escaped here. */
  rowSuffix?: (param: AxisTooltipParam) => string | null
  /** ESCAPED lines under everything, keyed by the hovered index (band ranges, a rate). */
  footer?: (dataIndex: number, params: AxisTooltipParam[]) => string[]
  /** Printed once when `groups` is set and no group row is finite (an absent month). */
  absentText?: string
  /** Bars pass 'shadow'; lines keep echarts' default rule (the key is omitted). */
  pointer?: 'line' | 'shadow'
}

// Branding is a WeakSet, not a property: a property would survive a `{ ...formatter }`
// copy that is no longer the function, and it would show up in JSON fingerprints.
const BRAND = new WeakSet<object>()

/** Marks a formatter as grammar-conformant (sankey.ts brands its own factory this way). */
export function brandTooltip<F extends (params: unknown) => string>(formatter: F): F {
  BRAND.add(formatter)
  return formatter
}

export function isGrammarTooltip(formatter: unknown): boolean {
  return typeof formatter === 'function' && BRAND.has(formatter)
}

// Token hex → CSS variable. Sequential/diverging steps have no variable and fall back to
// the hex (they stay dark under the light theme — a documented cost, spec §7).
const CSS_VARS: ReadonlyMap<string, string> = new Map<string, string>([
  ...PALETTE.map((hex, i) => [hex.toLowerCase(), `var(--chart-${i + 1})`] as [string, string]),
  [OTHER_SERIES_COLOR.toLowerCase(), 'var(--other-series)'],
  [INK.toLowerCase(), 'var(--text)'],
  [MUTED.toLowerCase(), 'var(--muted)'],
  [POSITIVE.toLowerCase(), 'var(--positive)'],
  [NEGATIVE.toLowerCase(), 'var(--negative)'],
])
const HEX6 = /^#[0-9a-f]{6}$/i

/** The swatch cell: `square` (8×8) for bars, areas and stack members, `line` (10×2) for
 *  data lines; `wash` paints it at fill strength (the projection's band rows). Anything
 *  that is not a token or a plain hex paints MUTED — a color string never reaches the
 *  style attribute unvalidated. */
export function swatch(
  color: unknown,
  { shape = 'square', wash = false }: { shape?: 'square' | 'line'; wash?: boolean } = {},
): string {
  const hex = typeof color === 'string' ? color : ''
  const paint = CSS_VARS.get(hex.toLowerCase()) ?? (HEX6.test(hex) ? hex : 'var(--muted)')
  const classes = ['chart-tip-swatch', shape === 'line' ? 'is-line' : '', wash ? 'is-wash' : '']
    .filter(Boolean)
    .join(' ')
  return `<i class="${classes}" style="background:${paint}"></i>`
}

export function formatUnit(unit: TooltipUnit, value: number): string {
  if (unit === 'percent') return formatPct(value, { signed: false })
  if (unit === 'shares') return formatShares(value)
  return formatCurrency(value)
}

// Line rows carry plain numbers (null on a padded category); scatter markers carry a
// [category, y] pair. Non-finite → the row is dropped (§7: never dashed).
function finiteValue(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[1] : value
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

const BLANK_SWATCH = '<i class="chart-tip-swatch is-blank"></i>'

function row(label: string, value: string, sw: string, kind = ''): string {
  return (
    `<div class="chart-tip-row${kind}">${sw}` +
    `<span class="chart-tip-label">${label}</span>` +
    `<span class="chart-tip-value">${value}</span></div>`
  )
}

interface Valued {
  p: AxisTooltipParam
  v: number
}

/** A complete axis tooltip: header → groups (valueDesc) → Total → other data (series
 *  order) → references → annotations → footer. */
export function axisTooltip(options: AxisTooltipOptions = {}) {
  const {
    unit = 'money',
    groups = [],
    totalLabel = 'Total',
    shareOf = false,
    references = [],
    annotationSeries = [],
    annotations,
    rowSuffix,
    footer,
    absentText,
    pointer = 'line',
  } = options
  const groupSet = new Set(groups)
  const refSet = new Set(references)
  const noteSet = new Set(annotationSeries)
  const nameOf = (p: AxisTooltipParam) => p.seriesName ?? ''
  const valued = (p: AxisTooltipParam): Valued[] => {
    const v = finiteValue(p.value)
    return v === null ? [] : [{ p, v }]
  }

  const formatter = brandTooltip((params: unknown): string => {
    const list = (Array.isArray(params) ? params : [params]).filter(Boolean) as AxisTooltipParam[]
    if (list.length === 0) return ''
    const head = list.find((p) => p.axisValueLabel)?.axisValueLabel ?? ''
    const groupRows = list.filter((p) => groupSet.has(nameOf(p))).flatMap(valued)
    groupRows.sort((a, b) => b.v - a.v)
    const total = groupRows.reduce((sum, r) => sum + r.v, 0)
    const dataRows = list
      .filter((p) => !groupSet.has(nameOf(p)) && !refSet.has(nameOf(p)) && !noteSet.has(nameOf(p)))
      .flatMap(valued)
    const refRows = list.filter((p) => refSet.has(nameOf(p))).flatMap(valued)
    const noteLines = annotations ? list.filter((p) => noteSet.has(nameOf(p))).flatMap(annotations) : []
    const index = list.find((p) => typeof p.dataIndex === 'number')?.dataIndex
    const footLines = footer !== undefined && typeof index === 'number' ? footer(index, list) : []
    const absent = groups.length > 0 && groupRows.length === 0 && absentText !== undefined
    if (
      groupRows.length + dataRows.length + refRows.length + noteLines.length + footLines.length === 0 &&
      !absent
    ) {
      return ''
    }

    const label = (p: AxisTooltipParam) => {
      const suffix = rowSuffix?.(p)
      return escapeHtml(nameOf(p)) + (suffix ? ` ${escapeHtml(suffix)}` : '')
    }
    const cell = (v: number, share: boolean) =>
      formatUnit(unit, v) + (share && shareOf && total > 0 ? ` (${((v / total) * 100).toFixed(1)}%)` : '')
    const sw = (p: AxisTooltipParam) =>
      swatch(p.color, { shape: p.seriesType === 'line' && !groupSet.has(nameOf(p)) ? 'line' : 'square' })

    const parts = [`<div class="chart-tip-head">${escapeHtml(head)}</div>`]
    for (const { p, v } of groupRows) parts.push(row(label(p), cell(v, true), sw(p)))
    if (groupRows.length > 0 && totalLabel !== false) {
      parts.push(row(escapeHtml(totalLabel), formatUnit(unit, total), BLANK_SWATCH, ' chart-tip-total'))
    }
    if (absent) parts.push(`<div class="chart-tip-note">${escapeHtml(absentText)}</div>`)
    for (const { p, v } of dataRows) parts.push(row(label(p), cell(v, false), sw(p)))
    for (const { p, v } of refRows) parts.push(row(label(p), cell(v, false), sw(p), ' chart-tip-ref'))
    for (const line of noteLines) parts.push(`<div class="chart-tip-note">${line}</div>`)
    for (const line of footLines) parts.push(`<div class="chart-tip-foot">${line}</div>`)
    return parts.join('')
  })

  return {
    trigger: 'axis' as const,
    className: 'chart-tip',
    ...(pointer === 'shadow' ? { axisPointer: { type: 'shadow' as const } } : {}),
    formatter,
  }
}

export interface ItemTooltipBody {
  /** A number is formatted by `unit`; a string is a pre-formatted lead ("56.0% of tax"). */
  value: number | string
  label: string
  sub?: string
}

/** Pies, treemaps, heatmaps, waterfalls, ladders: value first, then the label, then a
 *  sub-line. `body` returns null for hovers that are not data (a treemap's root). */
export function itemTooltip<P = unknown>({
  unit = 'money',
  body,
}: {
  unit?: TooltipUnit
  body: (param: P) => ItemTooltipBody | null
}) {
  const formatter = brandTooltip((params: unknown): string => {
    const p = (Array.isArray(params) ? params[0] : params) as P | null | undefined
    if (p === null || p === undefined) return ''
    const b = body(p)
    if (b === null) return ''
    const lead = typeof b.value === 'number' ? formatUnit(unit, b.value) : escapeHtml(b.value)
    return (
      `<div class="chart-tip-lead">${lead}</div>` +
      `<div class="chart-tip-label">${escapeHtml(b.label)}</div>` +
      (b.sub !== undefined ? `<div class="chart-tip-sub">${escapeHtml(b.sub)}</div>` : '')
    )
  })
  return { trigger: 'item' as const, className: 'chart-tip', formatter }
}
