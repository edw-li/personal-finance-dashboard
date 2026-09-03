// The grammar enforced structurally (chart spec §17). Pure: option in, a list of violations
// out — an empty list is conformance. Rules are additive so a lane can land before a rule
// tightens; fixtures declare exemptions for exotic forms (pie/treemap/sankey have no grid).
import { DARK } from '../theme/tokens'
import type { ChartFixture } from './fixtures/_types'
import { compactMoney, isGridVariant, percentLabel } from './grammar'
import { MUTED, SURFACE } from './theme'
import { isGrammarTooltip } from './tooltip'

// Every hex a builder may emit: the DARK tokens, scalars and ramps alike (builders never
// branch on theme — recolor.ts maps these under light).
const TOKEN_HEXES = new Set(
  Object.values(DARK)
    .flatMap((value) => (typeof value === 'string' ? [value] : Array.isArray(value) ? [...value] : []))
    .map((hex) => hex.toLowerCase()),
)
const ALLOWED_WORDS = new Set(['transparent', 'source', 'inherit'])
const COLOR_KEYS = new Set(['color', 'borderColor', 'backgroundColor', 'pageIconColor', 'shadowColor'])

interface SeriesLike {
  type?: string
  name?: string
  stack?: string
  silent?: boolean
  barMaxWidth?: number
  itemStyle?: { borderColor?: string }
  lineStyle?: { type?: string; width?: number }
  color?: string
  z?: number
  tooltip?: { show?: boolean }
  animationDelay?: unknown
}
interface AxisLike {
  type?: string
  axisLabel?: { formatter?: unknown }
}

const asList = <T,>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : value === undefined || value === null ? [] : [value as T]

function walkColors(value: unknown, path: string, report: (color: string, path: string) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkColors(item, `${path}[${i}]`, report))
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const here = `${path}.${key}`
    if (COLOR_KEYS.has(key)) {
      for (const color of asList<unknown>(item)) if (typeof color === 'string') report(color, here)
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) walkColors(item, here, report) // gradient literals
      continue
    }
    walkColors(item, here, report)
  }
}

/** A grammar reference line (charts/reference.ts) — dashed by definition. */
const isReference = (s: SeriesLike) =>
  s.lineStyle?.type === 'dashed' && s.lineStyle.width === 2 && s.color === MUTED && s.z === 9

export function checkConformance(option: unknown, fixture: ChartFixture): string[] {
  const problems: string[] = []
  const o = (option ?? {}) as Record<string, unknown>
  const exempt = new Set(fixture.exempt ?? [])
  const series = asList<SeriesLike>(o.series)

  // 1. Colours: token hexes, 'transparent', 'source' — nothing invented, nothing rgba().
  walkColors(o, 'option', (color, path) => {
    if (!TOKEN_HEXES.has(color.toLowerCase()) && !ALLOWED_WORDS.has(color)) problems.push(`${path}: color ${color} is not a token`)
  })

  // 2. Value/log axes label through the grammar's formatters, by identity.
  if (!exempt.has('axis')) {
    for (const [name, axes] of [['xAxis', asList<AxisLike>(o.xAxis)], ['yAxis', asList<AxisLike>(o.yAxis)]] as const) {
      axes.forEach((axis, i) => {
        if (axis.type !== 'value' && axis.type !== 'log') return
        const f = axis.axisLabel?.formatter
        if (f !== compactMoney && f !== percentLabel) problems.push(`${name}[${i}]: value-axis formatter is not the grammar's (compactMoney/percentLabel)`)
      })
    }
  }

  // 3. Grid is a named variant on cartesian and heatmap forms.
  if (!exempt.has('grid') && (fixture.kind === 'cartesian' || fixture.kind === 'heatmap') && !isGridVariant(o.grid)) {
    problems.push('grid is not a named variant (grammar.ts GRID_VARIANTS)')
  }

  // 4. The tooltip formatter is branded by tooltip.ts or sankey.ts.
  const tooltip = o.tooltip as { formatter?: unknown } | undefined
  if (tooltip === undefined || !isGrammarTooltip(tooltip.formatter)) problems.push('tooltip formatter is not branded by tooltip.ts or sankey.ts')

  for (const s of series) {
    const label = s.name ?? s.type ?? 'series'
    // 5. Bars: capped at 24px, the SURFACE hairline. Silent placeholders (the waterfall floor) are exempt.
    if (s.type === 'bar' && s.silent !== true) {
      if (!(typeof s.barMaxWidth === 'number' && s.barMaxWidth <= 24)) problems.push(`${label}: barMaxWidth must be ≤ 24`)
      if (s.itemStyle?.borderColor !== SURFACE) problems.push(`${label}: bars carry the SURFACE border`)
      // 8. Stacked bars stagger in (a function delay — invisible to the fingerprint).
      if (s.stack !== undefined && typeof s.animationDelay !== 'function') problems.push(`${label}: stacked bars carry a stagger`)
    }
    // 7. Dashed only on references (the grammar's own or the fixture's declared annotations).
    if (s.lineStyle?.type === 'dashed' && !isReference(s) && !(fixture.dashed ?? []).includes(s.name ?? '')) {
      problems.push(`${label}: dashed lineStyle only on reference/annotation series`)
    }
  }

  // 6. Legends past eight entries scroll.
  const legend = o.legend as { type?: string; data?: unknown[] } | undefined
  if (!exempt.has('legend') && legend !== undefined) {
    const count = legend.data?.length ?? series.filter((s) => s.name !== undefined && s.tooltip?.show !== false).length
    if (count > 8 && legend.type !== 'scroll') problems.push(`legend has ${count} entries and must scroll`)
  }

  // 9. The mount's sentence exists.
  if (fixture.ariaLabel.trim() === '') problems.push('fixture needs an ariaLabel')
  return problems
}
