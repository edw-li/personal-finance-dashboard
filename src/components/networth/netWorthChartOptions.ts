// Pure tooltip/CSV helpers for the net-worth stacked chart — no React, no fetching, no
// theme decisions of their own (historyChartOptions.ts posture). The option itself stays
// in NetWorthPage (it reads page state); only the parts worth unit-testing live here.
import type { EChartsOption } from '../../charts/echarts'
import { personSlot, slotColor } from '../../charts/entities'
import { BAR_MARKS, LINE, STACK_WASH, capLabel, cents, grid, moneyAxis, monthAxis, pctAxis } from '../../charts/grammar'
import { FOCUS, legendFor } from '../../charts/legend'
import { GROUP_COLORS, GROUP_LABELS, GROUP_ORDER, INK, MUTED, OTHER_SERIES_COLOR } from '../../charts/theme'
import { MARK_LINE_LABEL, MARK_LINE_STYLE, anchorMonthLabel } from '../../charts/markLine'
import { rangeZoom } from '../../charts/timeZoom'
import type { RangeState } from '../../charts/timeZoom'
import { axisTooltip, itemTooltip } from '../../charts/tooltip'
import type { AccountGroup, NetWorthTimeseries, PersonOut } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import { escapeHtml, formatCurrency, formatCurrencyCompact, formatMonth, formatPct } from '../../utils/format'
import { toneOf } from '../../utils/tone'
import type { Tone } from '../../utils/tone'

/** The wizard's snapshot notes, drawn as markers riding the net-worth line. One name so
 * the legend, the tooltip branch and the series stay in lockstep (moved verbatim from
 * NetWorthPage). */
export const NOTES_SERIES = 'Notes'

/** The net-worth line's series name. A constant because the drill has to RESERVE it (see
 * stackSeriesNames) — two spellings would let the reservation drift from the series. */
export const NET_WORTH_SERIES = 'Net worth'

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
    name: NET_WORTH_SERIES,
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

/**
 * Every series name the STACK above the drill can put on screen, in any mode: the seven
 * group labels, the net-worth line, the notes layer, and the owner columns (each person's
 * name, plus 'Joint' for the null-person row).
 *
 * Why the drill has to know them: both cards ride ONE echarts connect group
 * (`group="net-worth"`, so the zoom windows stay locked), and echarts 6 relays every
 * action across a connect group — `legendselectchanged` included. Series are matched BY
 * NAME, so a drill legend click on an account literally named "Cash" toggles the stack's
 * Cash series too. Per-chart legend maps on the page stop the page's own mirroring; they
 * cannot stop echarts' relay. Only distinct NAMES can.
 */
function stackSeriesNames(ts: Pick<NetWorthTimeseries, 'owner_series'>): Set<string> {
  return new Set<string>([
    ...GROUP_ORDER.map((g) => GROUP_LABELS[g]),
    NET_WORTH_SERIES,
    NOTES_SERIES,
    // `?? []` is stale-deploy armor, as everywhere owner_series is read; `?? 'Joint'`
    // matches the owner stack's own label for the null-person row.
    ...(ts.owner_series ?? []).map((s) => s.name ?? 'Joint'),
  ])
}

/** claimNodeName's pattern (charts/sankey.ts, where a colliding CATEGORY name would crash
 *  the sankey) with an account-shaped suffix: a picked account named "Cash" draws as
 *  "Cash (account)" so it can never share a name with a stack series — or with another
 *  pick, since `taken` grows as the drill is walked. */
function claimSeriesName(name: string, taken: Set<string>): string {
  let candidate = name
  if (taken.has(candidate)) candidate = `${name} (account)`
  let n = 2
  while (taken.has(candidate)) candidate = `${name} (account ${n++})`
  taken.add(candidate)
  return candidate
}

/** The drill's series names in pick order, claimed against the stack's (above). One helper
 *  so the chart's legend and the CSV's headers can never disagree about a name. */
function drillNames(
  ts: Pick<NetWorthTimeseries, 'accounts' | 'owner_series'>,
  drill: DrillPick[],
): string[] {
  const nameById = new Map(ts.accounts.map((a) => [a.id, a.name]))
  const taken = stackSeriesNames(ts)
  return drill.map((d) => claimSeriesName(nameById.get(d.accountId) ?? String(d.accountId), taken))
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
  const names = drillNames(ts, drill)
  return {
    dataZoom: rangeZoom(ts.months, range),
    grid: grid('endLabel'),
    legend: legendFor(drill.length, selected),
    tooltip: axisTooltip({ unit: 'money' }),
    xAxis: monthAxis(ts.months.map(formatMonth)),
    yAxis: moneyAxis(),
    series: drill.map(({ accountId, slot }, i) => ({
      ...LINE,
      name: names[i],
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

/** The drill-down as a table (F12): month rows × the picked accounts, verbatim strings.
 *  Headers carry the CLAIMED names (drillNames) so the export reads back exactly as the
 *  chart's legend does — including the ' (account)' suffix on a colliding name. */
export function netWorthDrillCsv(ts: NetWorthTimeseries, drill: DrillPick[]): ExportTable {
  const byId = new Map(ts.series.map((s) => [s.account_id, s.values]))
  return {
    headers: ['Month', ...drillNames(ts, drill)],
    rows: ts.months.map((month, i) => [month, ...drill.map((d) => byId.get(d.accountId)?.[i] ?? '')]),
  }
}


// ── "What moved": contribution bars (2026-09-06 spec §4) ────────────────────────────────
/** Which entity the bars measure. */
export type MoversMode = 'group' | 'account'
export const MOVERS_MODES: { value: MoversMode; label: string }[] = [{ value: 'group', label: 'Groups' }, { value: 'account', label: 'Accounts' }]

/** One bar: what moved, by how much, in whose colour. `groupLabel` is null only for the
 *  folded remainder; `share` is the bar's part of the month's net change, null when net
 *  worth did not move at all. */
export interface Mover { label: string; groupLabel: string | null; delta: number; color: string; share: number | null }

/** A missing column is zero, not NaN: an account that starts mid-history still moved the total. */
const num = (value: string | null | undefined): number => (value == null ? 0 : Number(value))
/** Accounts mode draws the ten largest movers and folds the rest into one row. */
const MAX_ACCOUNT_MOVERS = 10
/** The movers between index−1 and index, largest first. Empty when there is nothing to
 *  compare with and when nothing moved — both render the card's empty sentence. Ties keep
 *  source order: Array.prototype.sort is stable, so GROUP_ORDER breaks them. */
export function netWorthMovers(ts: NetWorthTimeseries, index: number, mode: MoversMode): Mover[] {
  if (index < 1 || index >= ts.months.length) return []
  const net = cents(num(ts.net_worth[index]) - num(ts.net_worth[index - 1]))
  const share = (delta: number) => (net === 0 ? null : delta / net)
  const rows: Mover[] =
    mode === 'group'
      ? GROUP_ORDER.flatMap((g) => {
          const delta = cents(num(ts.group_totals[g][index]) - num(ts.group_totals[g][index - 1]))
          // Liability deltas keep their stored sign: more debt is a NEGATIVE bar.
          return delta === 0
            ? []
            : [{ label: GROUP_LABELS[g], groupLabel: GROUP_LABELS[g], delta, color: GROUP_COLORS[g], share: share(delta) }]
        })
      : (() => {
          const byId = new Map(ts.series.map((s) => [s.account_id, s.values]))
          // Components are already folded into their parents by the timeseries (spec §4.1);
          // drawing them too would count the same money twice.
          return ts.accounts.flatMap((a) => {
            if (a.is_component) return []
            const values = byId.get(a.id) ?? []
            const delta = cents(num(values[index]) - num(values[index - 1]))
            return delta === 0
              ? []
              : [{ label: a.name, groupLabel: GROUP_LABELS[a.group], delta, color: GROUP_COLORS[a.group], share: share(delta) }]
          })
        })()
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  if (mode === 'group' || rows.length <= MAX_ACCOUNT_MOVERS) return rows
  const kept = rows.slice(0, MAX_ACCOUNT_MOVERS)
  const folded = cents(rows.slice(MAX_ACCOUNT_MOVERS).reduce((sum, r) => sum + r.delta, 0))
  // The remainder is a TAIL, not a mover: last even when its sum outweighs the tenth bar, and dropped when it cancels to zero.
  return folded === 0
    ? kept
    : [...kept, { label: 'Other accounts', groupLabel: null, delta: folded, color: OTHER_SERIES_COLOR, share: share(folded) }]
}

/** One 28px row each, floored so a lone mover is not a sliver and capped so a long Accounts
 *  list is not a page (spec §4.2). */
export function moversHeight(rows: number): number {
  return Math.min(420, Math.max(200, 60 + 28 * rows))
}
/** "+$1.2K" / "-$840" — on a contribution bar the sign is the whole point. */
const signedCompact = (value: number): string => (value > 0 ? `+${formatCurrencyCompact(value)}` : formatCurrencyCompact(value))
/** "83%" — ONE spelling of the share, for the tooltip and the table twin alike. */
const sharePct = (share: number | null): string | null => (share === null ? null : formatPct(share, { signed: false, decimals: 0 }))

/** "What moved — {month}": sorted contribution bars between two snapshots (spec §4.2).
 *  Null on the first month and on a month where nothing moved. */
export function netWorthMoversOption(ts: NetWorthTimeseries, index: number, mode: MoversMode): EChartsOption | null {
  const movers = netWorthMovers(ts, index, mode)
  if (movers.length === 0) return null
  return {
    grid: grid('horizontal'),
    tooltip: itemTooltip<{ dataIndex?: number }>({
      // Account names are user text — itemTooltip escapes every label and sub it renders.
      body: (p) => {
        const mover = movers[p.dataIndex ?? -1]
        if (mover === undefined) return null
        const pct = sharePct(mover.share)
        const sub = [pct === null ? null : `${pct} of the change`, mode === 'account' ? mover.groupLabel : null].filter((part): part is string => part !== null).join(' · ')
        return { value: mover.delta, label: mover.label, sub: sub === '' ? undefined : sub }
      },
    }),
    xAxis: moneyAxis(),
    yAxis: { type: 'category' as const, data: movers.map((m) => m.label), inverse: true, axisLabel: { width: 118, overflow: 'truncate' as const } },
    series: [
      { type: 'bar' as const, name: 'Change', ...BAR_MARKS, barMaxWidth: 24,
        // capLabel carries show/colour/size/formatter; each item overrides only the POSITION,
        // so the amount sits at the bar's outer end instead of over the axis (spec §4.2).
        label: capLabel((p) => signedCompact(movers[p.dataIndex]?.delta ?? 0)),
        data: movers.map((m) => ({ value: m.delta, itemStyle: { color: m.color }, label: { position: m.delta > 0 ? ('right' as const) : ('left' as const) } })) },
    ],
  }
}

/** The bars as a table (spec §4.2). `Change` is the plain number the bar drew; the share
 *  carries its % sign because that column is a ratio, not money. */
export function netWorthMoversCsv(ts: NetWorthTimeseries, index: number, mode: MoversMode): ExportTable {
  return {
    headers: ['Mover', 'Group', 'Change', 'Share of change'],
    rows: netWorthMovers(ts, index, mode).map((m) => [m.label, m.groupLabel ?? '', m.delta.toFixed(2), sharePct(m.share) ?? '']),
  }
}

/** "+$100.00" — the lede's move, signed like the bars' own labels. */
const signedCurrency = (value: number): string => (value > 0 ? `+${formatCurrency(value)}` : formatCurrency(value))
export interface MoversLede {
  fromLabel: string; fromValue: string; toLabel: string; toValue: string
  delta: string // the difference of the two SERVER totals, signed
  pct: string | null // the server's own mom_pct — null when it sent none for this month
  tone: Tone
}

/** The card's header strip (spec §4.2): from → to, then the move. Null on the first month.
 *  Every figure is the server's — the two totals and the percent are printed verbatim and
 *  the delta is the difference of those totals, never a client-recomputed percentage. */
export function netWorthMoversLede(ts: NetWorthTimeseries, index: number): MoversLede | null {
  if (index < 1 || index >= ts.months.length) return null
  const delta = cents(num(ts.net_worth[index]) - num(ts.net_worth[index - 1]))
  const pct = ts.mom_pct[index]
  return {
    fromLabel: formatMonth(ts.months[index - 1]), fromValue: formatCurrency(ts.net_worth[index - 1]),
    toLabel: formatMonth(ts.months[index]), toValue: formatCurrency(ts.net_worth[index]),
    delta: signedCurrency(delta), pct: pct == null ? null : formatPct(pct), tone: toneOf(delta),
  }
}
