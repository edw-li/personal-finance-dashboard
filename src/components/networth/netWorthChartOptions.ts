// Pure tooltip/CSV helpers for the net-worth stacked chart — no React, no fetching, no
// theme decisions of their own (historyChartOptions.ts posture). The option itself stays
// in NetWorthPage (it reads page state); only the parts worth unit-testing live here.
import type { EChartsOption } from '../../charts/echarts'
import { personSlot, slotColor } from '../../charts/entities'
import { LINE, STACK_WASH, cents, grid, moneyAxis, monthAxis, pctAxis, stagger } from '../../charts/grammar'
import { FOCUS, legendFor } from '../../charts/legend'
import { GROUP_COLORS, GROUP_LABELS, GROUP_ORDER, INK, MUTED, OTHER_SERIES_COLOR } from '../../charts/theme'
import { MARK_LINE_LABEL, MARK_LINE_STYLE, anchorMonthLabel } from '../../charts/markLine'
import { rangeZoom } from '../../charts/timeZoom'
import type { RangeState } from '../../charts/timeZoom'
import { axisTooltip } from '../../charts/tooltip'
import { waterfallCsv, waterfallSeries, waterfallSteps, waterfallTooltip } from '../../charts/waterfall'
import type { AccountGroup, NetWorthTimeseries, PersonOut } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import { escapeHtml, formatCurrency, formatCurrencyCompact, formatMonth } from '../../utils/format'

/** The wizard's snapshot notes, drawn as markers riding the net-worth line. One name so
 * the legend, the tooltip branch and the series stay in lockstep (moved verbatim from
 * NetWorthPage). */
export const NOTES_SERIES = 'Notes'

interface AxisTooltipParam {
  seriesName?: string
  marker?: string
  axisValueLabel?: string
  value?: unknown
  data?: unknown
}

/**
 * The stacked chart's axis tooltip: asset-group rows, then their SUBTOTAL (2026-08-25
 * spec §2b — liabilities and the net-worth line already render as their own rows), then
 * the rest in series order. A full formatter, not valueFormatter: the Notes series
 * carries TEXT — and note text is USER TEXT, so escapeHtml is mandatory (SpendingPage's
 * rule). Money rows keep the currency treatment; a padded null still reads as a dash.
 */
export function netWorthStackedTooltipFormatter(
  assetNames: string[],
): (params: unknown) => string {
  const assets = new Set(assetNames)
  return (params: unknown) => {
    const list = (Array.isArray(params) ? params : [params]) as AxisTooltipParam[]
    if (list.length === 0) return ''
    const head = `<strong>${list[0].axisValueLabel ?? ''}</strong>`
    const assetLines: string[] = []
    const otherLines: string[] = []
    let assetTotal = 0
    for (const p of list) {
      if (p.seriesName === NOTES_SERIES) {
        const note = (p.data as { note?: string } | undefined)?.note ?? ''
        otherLines.push(`${p.marker ?? ''}${escapeHtml(note)}`)
        continue
      }
      const raw = Array.isArray(p.value) ? p.value[1] : p.value
      const finite = typeof raw === 'number' && Number.isFinite(raw)
      const line = `${p.marker ?? ''}${p.seriesName ?? ''}: ${finite ? formatCurrency(raw) : '—'}`
      if (assets.has(p.seriesName ?? '')) {
        assetLines.push(line)
        if (finite) assetTotal += raw
      } else {
        otherLines.push(line)
      }
    }
    return [
      head,
      ...assetLines,
      // Only when an asset row actually printed — a hover with the stack legend-hidden
      // has nothing to subtotal.
      ...(assetLines.length > 0
        ? [`<strong>Assets: ${formatCurrency(assetTotal)}</strong>`]
        : []),
      ...otherLines,
    ].join('<br/>')
  }
}

/** The stacked chart as a table (2026-08-25 spec §2a): month rows × the seven fixed
 * groups + net worth, verbatim server strings in the palette's own group order. */
export function netWorthCsv(
  ts: Pick<NetWorthTimeseries, 'months' | 'group_totals' | 'net_worth'>,
): ExportTable {
  return {
    headers: ['Month', ...GROUP_ORDER.map((g) => GROUP_LABELS[g]), 'Net worth'],
    rows: ts.months.map((month, i) => [
      month,
      ...GROUP_ORDER.map((g) => ts.group_totals[g][i] ?? ''),
      ts.net_worth[i],
    ]),
  }
}

/** The wedding annotation's shape — narrow on purpose, so the test can read it without
 *  echarts' `any`-ish option types. */
export interface MarriageMarkLine {
  silent: true
  symbol: 'none'
  lineStyle: { color: string; width: number; type: 'dashed' }
  label: { show: true; formatter: string; position: 'insideEndTop'; color: string; fontSize: number }
  data: { xAxis: string }[]
}

/**
 * A dashed vertical rule on the trend at the marriage month (household spec §6). The step
 * at that boundary is REAL — partner history starts fresh there, by decision — so it has to
 * read as intentional rather than as a data glitch.
 *
 * The anchor rule lives in charts/markLine.ts (shared with the projection's retirement
 * rules): a formatMonth LABEL rather than an ISO date, falling forward through a gap, and
 * undefined for a wedding later than every snapshot.
 */
export function marriageMarkLine(
  months: string[],
  marriageDate: string | null | undefined,
): MarriageMarkLine | undefined {
  const anchor = anchorMonthLabel(months, marriageDate)
  if (anchor === undefined) return undefined
  return {
    silent: true,
    symbol: 'none',
    lineStyle: { ...MARK_LINE_STYLE },
    label: { ...MARK_LINE_LABEL, formatter: 'Married' },
    data: [{ xAxis: anchor }],
  }
}

// ── The stack, lifted out of NetWorthPage onto the grammar (charts C2) ───────────────────

export type StackMode = 'group' | 'owner' | 'share'

/** The Stack-by control's options, in the order the card shows them. */
export const STACK_MODES: { value: StackMode; label: string }[] = [
  { value: 'group', label: 'By group' },
  { value: 'owner', label: 'By owner' },
  { value: 'share', label: 'Share %' },
]

const ASSET_GROUPS = GROUP_ORDER.filter((g): g is AccountGroup => g !== 'liability')
const ASSET_LABELS = ASSET_GROUPS.map((g) => GROUP_LABELS[g])

/** F2: liabilities are DRAWN only when they are at least 1% of assets at the latest month —
 *  a −$300 balance under $600K of assets is a hairline nobody can read, and its legend entry
 *  costs a row. The series still rides the option (zero-width) so the tooltip keeps its row. */
export function liabilitiesMaterial(ts: Pick<NetWorthTimeseries, 'months' | 'group_totals'>): boolean {
  const last = ts.months.length - 1
  if (last < 0) return false
  const assets = ASSET_GROUPS.reduce((sum, g) => sum + Number(ts.group_totals[g][last] ?? 0), 0)
  const liabilities = Math.abs(Number(ts.group_totals.liability[last] ?? 0))
  return assets <= 0 ? liabilities > 0 : liabilities >= assets * 0.01
}

export interface NetWorthStackInput {
  ts: NetWorthTimeseries
  mode: StackMode
  /** The household roster (any order) — colours follow the HOUSEHOLD slot, not the response. */
  people: readonly PersonOut[]
  marriageDate: string | null
  range: RangeState
  /** The page's mirrored legend picks (legendselectchanged → state → here). */
  selected: Record<string, boolean>
}

/**
 * The page's first chart: asset groups stacked to their total with liabilities and net worth
 * as their own lines (By group), the same total split per owner (By owner), or each group's
 * share of that month's assets on a 0–100% axis (Share %). Lifted from NetWorthPage's
 * `stackedOption` memo; F2/F7/§8/§9 name every byte that differs from that memo.
 */
export function netWorthStackOption({
  ts,
  mode,
  people,
  marriageDate,
  range,
  selected,
}: NetWorthStackInput): EChartsOption | null {
  if (ts.months.length === 0) return null
  const labels = ts.months.map(formatMonth)
  // The annotation layer: one marker per NOTED month, sitting on the net-worth line at that
  // month's value. `(ts.notes ?? [])` is stale-deploy armor, as on the page it came from.
  const noted = ts.months
    .map((_, i) => ({ label: labels[i], value: Number(ts.net_worth[i]), note: (ts.notes ?? [])[i] }))
    .filter((p): p is { label: string; value: number; note: string } => !!p.note)
  const marriageMark = marriageMarkLine(ts.months, marriageDate)
  const material = liabilitiesMaterial(ts)

  const stackMember = (name: string, stack: string, color: string, data: (number | null)[]) => ({
    name,
    type: 'line' as const,
    stack,
    symbol: 'none' as const,
    ...STACK_WASH,
    ...FOCUS,
    color,
    data,
  })

  const netWorthLine = {
    ...LINE,
    name: 'Net worth',
    lineStyle: { width: 2.5 },
    color: INK,
    z: 10,
    endLabel: {
      show: true,
      color: INK,
      fontWeight: 600,
      formatter: (params: { value?: unknown }) => formatCurrencyCompact(params.value as number),
    },
    // The wedding rule rides the net-worth line: one annotation, on the series present in
    // both money modes.
    ...(marriageMark ? { markLine: marriageMark } : {}),
    data: ts.net_worth.map(Number),
  }

  const notesSeries =
    noted.length > 0
      ? [
          {
            name: NOTES_SERIES,
            // Plain scatter, not effectScatter: a note is history; the ripple is the live
            // ping's reserved signal. Diamond + MUTED = identity by SHAPE, an annotation
            // layer rather than a fourth data hue.
            type: 'scatter' as const,
            symbol: 'diamond' as const,
            symbolSize: 9,
            color: MUTED,
            itemStyle: { borderColor: INK, borderWidth: 1 },
            emphasis: { itemStyle: { borderColor: INK } },
            z: 11,
            data: noted.map((p) => ({ value: [p.label, p.value], note: p.note })),
          },
        ]
      : []

  const noteLines = (p: { data?: unknown }) => [
    escapeHtml((p.data as { note?: string } | undefined)?.note ?? ''),
  ]

  if (mode === 'share') {
    const assetsPerMonth = ts.months.map((_, i) =>
      ASSET_GROUPS.reduce((sum, g) => sum + Number(ts.group_totals[g][i] ?? 0), 0),
    )
    const series = ASSET_GROUPS.map((g) =>
      stackMember(
        GROUP_LABELS[g],
        'share',
        GROUP_COLORS[g],
        ts.group_totals[g].map((v, i) => (assetsPerMonth[i] > 0 ? Number(v) / assetsPerMonth[i] : null)),
      ),
    )
    return {
      dataZoom: rangeZoom(ts.months, range),
      grid: grid('endLabel'),
      legend: legendFor(series.length, selected),
      tooltip: axisTooltip({ unit: 'percent', groups: ASSET_LABELS, totalLabel: false }),
      xAxis: monthAxis(labels),
      yAxis: pctAxis({ floor: 0, ceiling: 1 }),
      series,
    }
  }

  const stacked =
    mode === 'owner'
      ? (ts.owner_series ?? []).map((s) => ({
          ...stackMember(
            s.name ?? 'Joint',
            'owner',
            slotColor(personSlot(people, s.person_id)),
            s.values.map(Number),
          ),
          // Owner columns are NET and one can go negative; 'samesign' would park it on the
          // baseline and the stack would stop meeting the net-worth line.
          stackStrategy: 'all' as const,
        }))
      : [
          ...ASSET_GROUPS.map((g) =>
            stackMember(GROUP_LABELS[g], 'assets', GROUP_COLORS[g], ts.group_totals[g].map(Number)),
          ),
          {
            ...stackMember(GROUP_LABELS.liability, '', GROUP_COLORS.liability, ts.group_totals.liability.map(Number)),
            stack: undefined,
            ...(material ? {} : { lineStyle: { width: 0 }, areaStyle: { opacity: 0 }, showSymbol: false }),
          },
        ]
  const series = [...stacked, netWorthLine, ...notesSeries]
  const shown = series.map((s) => s.name)
  return {
    // Windowed, not sliced: dataZoom keeps the whole series loaded so a chip flip never
    // refetches, and the y-axis re-scales to the visible window.
    dataZoom: rangeZoom(ts.months, range),
    grid: grid('endLabel'),
    legend: {
      ...legendFor(series.length, selected),
      // Immaterial liabilities leave the legend (F2) but not the option — see above.
      ...(mode === 'group' && !material ? { data: shown.filter((n) => n !== GROUP_LABELS.liability) } : {}),
    },
    tooltip: axisTooltip({
      unit: 'money',
      // Owner columns sum to the net-worth row, so an Assets subtotal would print the same
      // number twice: no groups (and no total) in owner mode.
      groups: mode === 'group' ? ASSET_LABELS : [],
      totalLabel: 'Assets',
      annotationSeries: [NOTES_SERIES],
      annotations: noteLines,
    }),
    xAxis: monthAxis(labels),
    // F2: the floor is zero unless the data goes below it — a stack whose axis starts at a
    // six-figure minimum makes a dip read as a collapse.
    yAxis: { ...moneyAxis(), min: (extent: { min: number }) => Math.min(0, extent.min) },
    series,
  }
}

export interface DrillPick {
  accountId: number
  /** The palette slot assigned when the account was picked — colour follows the entity. */
  slot: number
}

export interface NetWorthDrillInput {
  ts: NetWorthTimeseries
  drill: DrillPick[]
  range: RangeState
  selected: Record<string, boolean>
}

/** Individual account balances over time — up to eight picks on their own slots. Aligned
 *  with the stack above it (F8: same `endLabel` grid, same month axis, one `group`). */
export function netWorthDrillOption({ ts, drill, range, selected }: NetWorthDrillInput): EChartsOption | null {
  if (drill.length === 0 || ts.months.length === 0) return null
  const byId = new Map(ts.series.map((s) => [s.account_id, s.values]))
  const nameById = new Map(ts.accounts.map((a) => [a.id, a.name]))
  return {
    dataZoom: rangeZoom(ts.months, range),
    grid: grid('endLabel'),
    legend: legendFor(drill.length, selected),
    tooltip: axisTooltip({ unit: 'money' }),
    xAxis: monthAxis(ts.months.map(formatMonth)),
    yAxis: moneyAxis(),
    series: drill.map(({ accountId, slot }) => ({
      ...LINE,
      name: nameById.get(accountId) ?? String(accountId),
      // Circles on hover only: the line is the data, the dots are the hover affordance.
      symbol: 'circle' as const,
      symbolSize: 8,
      showSymbol: false,
      color: slotColor(slot),
      connectNulls: false,
      data: (byId.get(accountId) ?? []).map((v) => (v === null ? null : Number(v))),
    })),
  }
}

/** The drill-down as a table (F12): month rows × the picked accounts, verbatim strings. */
export function netWorthDrillCsv(ts: NetWorthTimeseries, drill: DrillPick[]): ExportTable {
  const byId = new Map(ts.series.map((s) => [s.account_id, s.values]))
  const nameById = new Map(ts.accounts.map((a) => [a.id, a.name]))
  return {
    headers: ['Month', ...drill.map((d) => nameById.get(d.accountId) ?? String(d.accountId))],
    rows: ts.months.map((month, i) => [month, ...drill.map((d) => byId.get(d.accountId)?.[i] ?? '')]),
  }
}

/** The bridge's steps: prior net worth → each group's month-over-month change → this month's
 *  net worth. Groups that did not move are omitted (a $0 step is a label without a bar). */
function bridgeSteps(ts: Pick<NetWorthTimeseries, 'months' | 'group_totals' | 'net_worth'>, index: number) {
  if (index < 1 || index >= ts.months.length) return null
  const items = GROUP_ORDER.flatMap((g) => {
    const delta = cents(Number(ts.group_totals[g][index]) - Number(ts.group_totals[g][index - 1]))
    return delta === 0 ? [] : [{ label: GROUP_LABELS[g], amount: delta, delta, color: GROUP_COLORS[g] }]
  })
  return waterfallSteps(
    { label: formatMonth(ts.months[index - 1]), amount: Number(ts.net_worth[index - 1]), color: OTHER_SERIES_COLOR },
    items,
    { label: formatMonth(ts.months[index]), amount: Number(ts.net_worth[index]), color: OTHER_SERIES_COLOR },
  )
}

/** "What moved — {month}": a waterfall by group between two snapshots (F2). Null on the first
 *  month or an out-of-range index. */
export function netWorthBridgeOption(
  ts: Pick<NetWorthTimeseries, 'months' | 'group_totals' | 'net_worth'>,
  index: number,
): EChartsOption | null {
  const steps = bridgeSteps(ts, index)
  if (steps === null) return null
  const [placeholder, amount] = waterfallSeries(steps)
  return {
    grid: grid(),
    tooltip: waterfallTooltip(steps),
    xAxis: monthAxis(steps.map((s) => s.label), { gap: true }),
    yAxis: moneyAxis(),
    // The stagger is added HERE rather than inside charts/waterfall.ts (C1 is read-only for
    // this lane): §11 asks every stacked bar to enter on the 12ms cascade, and conformance
    // enforces it. C7 should fold it into waterfallSeries so the tax waterfall gets it too.
    series: [placeholder, { ...amount, ...stagger(1) }],
  }
}

export function netWorthBridgeCsv(
  ts: Pick<NetWorthTimeseries, 'months' | 'group_totals' | 'net_worth'>,
  index: number,
): ExportTable {
  const steps = bridgeSteps(ts, index)
  return steps === null ? { headers: ['Step', 'Amount', 'Remaining'], rows: [] } : waterfallCsv(steps)
}
