import { describe, expect, it } from 'vitest'
import { netWorthCsv } from './netWorthChartOptions'

describe('netWorthCsv', () => {
  it('lays out month rows × the seven group columns + net worth, verbatim strings', () => {
    const csv = netWorthCsv({
      months: ['2026-07-01', '2026-08-01'],
      group_totals: {
        cash: ['100.00', '110.00'], pre_tax: ['200.00', '210.00'],
        post_tax: ['300.00', '310.00'], taxable: ['400.00', '410.00'],
        equity: ['500.00', '510.00'], other: ['0.00', '0.00'],
        liability: ['-50.00', '-40.00'],
      },
      net_worth: ['1450.00', '1500.00'],
    })
    expect(csv.headers).toEqual([
      'Month', 'Cash', 'Pre-tax', 'Post-tax', 'Taxable', 'Equity', 'Other',
      'Liabilities', 'Net worth',
    ])
    expect(csv.rows).toEqual([
      ['2026-07-01', '100.00', '200.00', '300.00', '400.00', '500.00', '0.00', '-50.00', '1450.00'],
      ['2026-08-01', '110.00', '210.00', '310.00', '410.00', '510.00', '0.00', '-40.00', '1500.00'],
    ])
  })
})

import { marriageMarkLine } from './netWorthChartOptions'

describe('marriageMarkLine', () => {
  const MONTHS = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']

  it('anchors on the wedding MONTH, whatever day of it the wedding falls on', () => {
    const mark = marriageMarkLine(MONTHS, '2026-08-14')
    // The x-axis carries formatMonth labels, so the markLine has to speak the same words.
    expect(mark?.data).toEqual([{ xAxis: 'Aug 2026' }])
    expect(mark?.label.formatter).toBe('Married')
    expect(mark?.lineStyle.type).toBe('dashed')
    expect(mark?.silent).toBe(true)
  })

  it('falls forward to the first month on record when the wedding month has no snapshot', () => {
    expect(marriageMarkLine(['2026-06-01', '2026-09-01'], '2026-08-14')?.data).toEqual([
      { xAxis: 'Sep 2026' },
    ])
  })

  it('draws nothing it cannot honestly place', () => {
    expect(marriageMarkLine(MONTHS, null)).toBeUndefined()
    expect(marriageMarkLine(MONTHS, '')).toBeUndefined()
    expect(marriageMarkLine([], '2026-08-14')).toBeUndefined()
    // The wedding is after every snapshot: there is no month to mark YET, and clamping it
    // onto the last one would draw a line at a date that has not happened.
    expect(marriageMarkLine(MONTHS, '2027-01-02')).toBeUndefined()
  })
})

// ── The three builders lifted out of NetWorthPage (charts C2) ────────────────────────────
import { tooltipRows } from '../../testing/tooltipRows'
import { GRID_VARIANTS, compactMoney, percentLabel } from '../../charts/grammar'
import { GROUP_COLORS, INK, MUTED, PALETTE } from '../../charts/theme'
import type { AccountGroup, AccountOut, NetWorthTimeseries, PersonOut } from '../../types/api'
import { liabilitiesMaterial, netWorthStackOption } from './netWorthChartOptions'

const PEOPLE: PersonOut[] = [
  { id: 2, name: 'Sam', is_primary: false },
  { id: 1, name: 'Me', is_primary: true },
]

function ts(over: Partial<NetWorthTimeseries> = {}): NetWorthTimeseries {
  return {
    months: ['2026-06-01', '2026-07-01', '2026-08-01'],
    accounts: [],
    series: [],
    group_totals: {
      cash: ['100.00', '110.00', '120.00'],
      pre_tax: ['200.00', '210.00', '220.00'],
      post_tax: ['0.00', '0.00', '0.00'],
      taxable: ['300.00', '310.00', '320.00'],
      equity: ['0.00', '0.00', '0.00'],
      other: ['0.00', '0.00', '0.00'],
      liability: ['-50.00', '-40.00', '-30.00'],
    },
    net_worth: ['550.00', '590.00', '630.00'],
    mom_pct: [null, '0.072727', '0.067797'],
    notes: [null, 'sold <em>car</em>', null],
    owner_series: [
      { person_id: 1, name: 'Me', values: ['400.00', '430.00', '460.00'] },
      { person_id: 2, name: 'Sam', values: ['100.00', '110.00', '120.00'] },
      { person_id: null, name: null, values: ['50.00', '50.00', '50.00'] },
    ],
    ...over,
  }
}

const base = { people: PEOPLE, marriageDate: null, range: { preset: 'all' as const }, selected: {} }

interface SeriesLike {
  name?: string
  type?: string
  stack?: string
  color?: string
  z?: number
  lineStyle?: { width?: number }
  areaStyle?: { opacity?: number }
  emphasis?: { focus?: string }
  markLine?: unknown
  data?: unknown[]
}
const read = (option: unknown) =>
  option as {
    grid: unknown
    legend: { type: string; selected: Record<string, boolean>; data?: string[] }
    yAxis: { type: string; min?: (e: { min: number }) => number; axisLabel: { formatter: unknown } }
    xAxis: { data: string[]; boundaryGap?: boolean; axisLabel?: { interval?: number } }
    tooltip: { formatter: (p: unknown) => string; axisPointer?: unknown }
    series: SeriesLike[]
  }

describe('netWorthStackOption — By group', () => {
  it('lifts the page option: seven stacked/lined groups, the INK net-worth line, the notes layer', () => {
    const option = read(netWorthStackOption({ ts: ts(), mode: 'group', ...base }))
    expect(option.series.map((s) => s.name)).toEqual([
      'Cash', 'Pre-tax', 'Post-tax', 'Taxable', 'Equity', 'Other', 'Liabilities', 'Net worth', 'Notes',
    ])
    expect(option.series.slice(0, 6).every((s) => s.stack === 'assets')).toBe(true)
    expect(option.series[0].color).toBe(GROUP_COLORS.cash)
    expect(option.series[0].lineStyle).toEqual({ width: 1 })
    expect(option.series[0].areaStyle).toEqual({ opacity: 0.5 })
    expect(option.series[0].emphasis).toEqual({ focus: 'series' }) // §9
    expect(option.series[6].stack).toBeUndefined()
    expect(option.series[7]).toMatchObject({ color: INK, z: 10, lineStyle: { width: 2.5 } })
    expect(option.series[7].data).toEqual([550, 590, 630])
    expect(option.series[8]).toMatchObject({ type: 'scatter', color: MUTED, z: 11 })
    expect(option.grid).toEqual(GRID_VARIANTS.endLabel)
    expect(option.xAxis).toEqual({ type: 'category', data: ['Jun 2026', 'Jul 2026', 'Aug 2026'], boundaryGap: false, axisLabel: { interval: 0 } })
    expect(option.yAxis.axisLabel.formatter).toBe(compactMoney)
    // Nine named series (six groups + liabilities + net worth + notes) is past the §9
    // eight-entry ceiling, so the one legend rule pages rather than wraps.
    expect(option.legend.type).toBe('scroll')
    expect(option.legend.selected).toEqual({})
  })

  it('F2: the value axis floors at zero unless the data goes below it', () => {
    const option = read(netWorthStackOption({ ts: ts(), mode: 'group', ...base }))
    expect(option.yAxis.min?.({ min: 100 })).toBe(0)
    expect(option.yAxis.min?.({ min: -5 })).toBe(-5)
  })

  it('F2: material liabilities draw; immaterial ones leave the legend but keep a tooltip row', () => {
    // 30 against 660 of assets at the latest month = 4.5% → material (drawn, in the legend).
    expect(liabilitiesMaterial(ts())).toBe(true)
    const drawn = read(netWorthStackOption({ ts: ts(), mode: 'group', ...base }))
    expect(drawn.legend.data).toBeUndefined()
    expect(drawn.series[6].lineStyle).toEqual({ width: 1 })
    // 3 against 660 = 0.45% → immaterial: no legend entry, zero-width series, still a row.
    const thin = ts({ group_totals: { ...ts().group_totals, liability: ['-5.00', '-4.00', '-3.00'] } })
    expect(liabilitiesMaterial(thin)).toBe(false)
    const hidden = read(netWorthStackOption({ ts: thin, mode: 'group', ...base }))
    expect(hidden.legend.data).toEqual(['Cash', 'Pre-tax', 'Post-tax', 'Taxable', 'Equity', 'Other', 'Net worth', 'Notes'])
    expect(hidden.series[6]).toMatchObject({ name: 'Liabilities', lineStyle: { width: 0 }, areaStyle: { opacity: 0 } })
    const rows = tooltipRows(hidden.tooltip.formatter([
      { seriesName: 'Cash', seriesType: 'line', axisValueLabel: 'Aug 2026', value: 120, color: GROUP_COLORS.cash },
      { seriesName: 'Liabilities', seriesType: 'line', value: -3, color: GROUP_COLORS.liability },
    ]))
    expect(rows.rows.map((r) => r.label)).toEqual(['Cash', 'Assets', 'Liabilities'])
  })

  it('F7: tooltip rows — asset groups by value, an Assets total, then liabilities, net worth and the escaped note', () => {
    const option = read(netWorthStackOption({ ts: ts(), mode: 'group', ...base }))
    const html = option.tooltip.formatter([
      { seriesName: 'Cash', seriesType: 'line', axisValueLabel: 'Jul 2026', dataIndex: 1, value: 110, color: GROUP_COLORS.cash },
      { seriesName: 'Taxable', seriesType: 'line', value: 310, color: GROUP_COLORS.taxable },
      { seriesName: 'Liabilities', seriesType: 'line', value: -40, color: GROUP_COLORS.liability },
      { seriesName: 'Net worth', seriesType: 'line', value: 590, color: INK },
      { seriesName: 'Notes', seriesType: 'scatter', value: ['Jul 2026', 590], data: { note: 'sold <em>car</em>' } },
    ])
    const parsed = tooltipRows(html)
    expect(parsed.head).toBe('Jul 2026')
    expect(parsed.rows.map((r) => [r.kind, r.label, r.value])).toEqual([
      ['row', 'Taxable', '$310.00'],
      ['row', 'Cash', '$110.00'],
      ['total', 'Assets', '$420.00'],
      ['row', 'Liabilities', '-$40.00'],
      ['row', 'Net worth', '$590.00'],
    ])
    expect(parsed.notes).toEqual(['sold &lt;em&gt;car&lt;/em&gt;'])
    expect(option.tooltip.axisPointer).toBeUndefined() // lines keep the default rule
  })

  it('anchors the Married rule on the net-worth line', () => {
    const option = read(netWorthStackOption({ ts: ts(), mode: 'group', ...base, marriageDate: '2026-07-14' }))
    expect(option.series[7].markLine).toMatchObject({ data: [{ xAxis: 'Jul 2026' }] })
    expect(option.series.filter((s) => s.markLine !== undefined)).toHaveLength(1)
  })

  it('returns null with no months', () => {
    expect(netWorthStackOption({ ts: ts({ months: [], net_worth: [] }), mode: 'group', ...base })).toBeNull()
  })
})

describe('netWorthStackOption — By owner and Share %', () => {
  it('owner mode colours by HOUSEHOLD slot (primary 0, others by id, Joint last), stacked with strategy all', () => {
    const option = read(netWorthStackOption({ ts: ts(), mode: 'owner', ...base }))
    expect(option.series.map((s) => s.name)).toEqual(['Me', 'Sam', 'Joint', 'Net worth', 'Notes'])
    expect(option.series.slice(0, 3).map((s) => s.color)).toEqual([PALETTE[0], PALETTE[1], PALETTE[2]])
    expect(option.series[0]).toMatchObject({ stack: 'owner', stackStrategy: 'all' })
    // No Assets subtotal: owner columns already sum to the net-worth row.
    const rows = tooltipRows(option.tooltip.formatter([
      { seriesName: 'Me', seriesType: 'line', axisValueLabel: 'Aug 2026', value: 460, color: PALETTE[0] },
      { seriesName: 'Net worth', seriesType: 'line', value: 630, color: INK },
    ]))
    expect(rows.rows.map((r) => r.kind)).toEqual(['row', 'row'])
  })

  it('share mode stacks each asset group as its share of the month’s assets on a 0–100% axis', () => {
    const option = read(netWorthStackOption({ ts: ts(), mode: 'share', ...base }))
    expect(option.series.map((s) => s.name)).toEqual(['Cash', 'Pre-tax', 'Post-tax', 'Taxable', 'Equity', 'Other'])
    // Jun: cash 100 of 600 assets.
    expect((option.series[0].data as number[])[0]).toBeCloseTo(100 / 600, 6)
    expect(option.series[0].stack).toBe('share')
    expect(option.yAxis.axisLabel.formatter).toBe(percentLabel)
    expect(option.yAxis.min?.({ min: 0 })).toBe(0)
    const rows = tooltipRows(option.tooltip.formatter([
      { seriesName: 'Cash', seriesType: 'line', axisValueLabel: 'Jun 2026', value: 100 / 600, color: GROUP_COLORS.cash },
      { seriesName: 'Taxable', seriesType: 'line', value: 300 / 600, color: GROUP_COLORS.taxable },
    ]))
    expect(rows.rows.map((r) => [r.kind, r.label, r.value])).toEqual([
      ['row', 'Taxable', '50.0%'],
      ['row', 'Cash', '16.7%'],
    ])
  })
})

import { netWorthDrillCsv, netWorthDrillOption } from './netWorthChartOptions'

const DRILL_TS = ts({
  accounts: [
    { id: 10, name: 'Checking', slug: 'checking', group: 'cash', is_active: true, is_component: false } as never,
    { id: 11, name: '401(k) <b>', slug: 'k401', group: 'pre_tax', is_active: true, is_component: false } as never,
  ],
  series: [
    { account_id: 10, values: ['100.00', '110.00', '120.00'] },
    { account_id: 11, values: ['200.00', null, '220.00'] },
  ],
})

describe('netWorthDrillOption', () => {
  it('one line per picked account on its slot colour, gaps kept, aligned on the end-label grid', () => {
    const option = read(netWorthDrillOption({ ts: DRILL_TS, drill: [{ accountId: 11, slot: 2 }, { accountId: 10, slot: 0 }], range: { preset: 'all' }, selected: { Checking: false } }))
    expect(option.series.map((s) => s.name)).toEqual(['401(k) <b>', 'Checking'])
    expect(option.series.map((s) => s.color)).toEqual([PALETTE[2], PALETTE[0]])
    expect(option.series[0]).toMatchObject({ type: 'line', symbol: 'circle', symbolSize: 8, showSymbol: false, connectNulls: false, lineStyle: { width: 2 }, emphasis: { focus: 'series' } })
    expect(option.series[0].data).toEqual([200, null, 220])
    expect(option.grid).toEqual(GRID_VARIANTS.endLabel) // F8: aligned with the stack
    expect(option.legend.selected).toEqual({ Checking: false })
    const rows = tooltipRows(option.tooltip.formatter([
      { seriesName: '401(k) <b>', seriesType: 'line', axisValueLabel: 'Jul 2026', value: null, color: PALETTE[2] },
      { seriesName: 'Checking', seriesType: 'line', value: 110, color: PALETTE[0] },
    ]))
    expect(rows.rows.map((r) => [r.label, r.value])).toEqual([['Checking', '$110.00']]) // the null row is dropped
  })
  it('returns null with nothing picked', () => {
    expect(netWorthDrillOption({ ts: DRILL_TS, drill: [], range: { preset: 'all' }, selected: {} })).toBeNull()
  })
  it('exports the picked accounts month by month, blanks for gaps', () => {
    expect(netWorthDrillCsv(DRILL_TS, [{ accountId: 10, slot: 0 }, { accountId: 11, slot: 1 }])).toEqual({
      headers: ['Month', 'Checking', '401(k) <b>'],
      rows: [
        ['2026-06-01', '100.00', '200.00'],
        ['2026-07-01', '110.00', ''],
        ['2026-08-01', '120.00', '220.00'],
      ],
    })
  })

  // 2026-08-31 tier-1 A2, re-closed: the stack and the drill share ONE echarts connect
  // group (group="net-worth", so their zoom windows stay locked), and echarts 6 relays
  // every action across a connect group — legendselectchanged included, matched BY
  // SERIES NAME. Per-chart legend maps on the page stop the page's mirroring; they cannot
  // stop the relay. Distinct names can, so a colliding account wears a visible suffix.
  const account = (id: number, name: string) =>
    ({ id, name, slug: `a${id}`, group: 'cash', is_active: true, is_component: false }) as never
  const COLLIDING_IDS = [20, 21, 22, 23, 24, 25, 26]
  const COLLIDING = ts({
    accounts: [
      account(20, 'Cash'), // a group label
      account(21, 'Cash'), // ...and a second one, so the numbering branch runs too
      account(22, 'Net worth'), // the INK line
      account(23, 'Sam'), // an owner column (people.name)
      account(24, 'Joint'), // the null-person owner column's label
      account(25, 'Notes'), // the annotation layer
      account(26, 'Brokerage'), // collides with nothing
    ],
    series: COLLIDING_IDS.map((id) => ({ account_id: id, values: ['1.00', '2.00', '3.00'] })),
  })
  const COLLIDING_DRILL = COLLIDING_IDS.map((accountId, slot) => ({ accountId, slot }))
  const CLAIMED = [
    'Cash (account)',
    'Cash (account 2)',
    'Net worth (account)',
    'Sam (account)',
    'Joint (account)',
    'Notes (account)',
    'Brokerage', // untouched: claiming only fires on a real collision
  ]

  it('claims a drill name that a stack series already owns, in EITHER stack mode', () => {
    const option = read(netWorthDrillOption({ ts: COLLIDING, drill: COLLIDING_DRILL, range: { preset: 'all' }, selected: {} }))
    expect(option.series.map((s) => s.name)).toEqual(CLAIMED)
    // The whole point: nothing the drill draws answers to a name the stack draws under.
    const stackNames = new Set(
      ['group', 'owner', 'share'].flatMap((mode) =>
        read(netWorthStackOption({ ts: COLLIDING, mode: mode as 'group', ...base })).series.map((s) => s.name),
      ),
    )
    expect(option.series.map((s) => s.name).filter((n) => stackNames.has(n as string))).toEqual([])
  })

  it('exports the CSV under the same claimed headers the legend shows', () => {
    expect(netWorthDrillCsv(COLLIDING, COLLIDING_DRILL).headers).toEqual(['Month', ...CLAIMED])
    // And the untouched case stays byte-identical — see the export test above.
    expect(netWorthDrillCsv(DRILL_TS, [{ accountId: 10, slot: 0 }]).headers).toEqual(['Month', 'Checking'])
  })
})

import { netWorthBridgeCsv, netWorthBridgeOption } from './netWorthChartOptions'
import { OTHER_SERIES_COLOR } from '../../charts/theme'

describe('netWorthBridgeOption', () => {
  it('walks from the prior month to the viewed month, one step per group that moved, landing on the month’s net worth', () => {
    const option = netWorthBridgeOption(ts(), 2) as unknown as {
      xAxis: { data: string[] }
      series: { data: unknown[] }[]
      tooltip: { formatter: (p: unknown) => string }
    }
    // Jul → Aug: cash +10, pre-tax +10, taxable +10, liabilities +10 (−40 → −30); the three
    // zero groups are omitted — a $0 step is a label with no bar.
    expect(option.xAxis.data).toEqual(['Jul 2026', 'Cash', 'Pre-tax', 'Taxable', 'Liabilities', 'Aug 2026'])
    const [placeholder, amount] = option.series
    expect(placeholder.data).toEqual([0, 590, 600, 610, 620, 0])
    expect((amount.data as { value: number; itemStyle: { color: string } }[]).map((d) => d.value)).toEqual([590, 10, 10, 10, 10, 630])
    expect((amount.data as { itemStyle: { color: string } }[])[1].itemStyle.color).toBe(GROUP_COLORS.cash)
    expect((amount.data as { itemStyle: { color: string } }[])[0].itemStyle.color).toBe(OTHER_SERIES_COLOR)
    const parsed = tooltipRows(option.tooltip.formatter({ dataIndex: 1 }))
    expect([parsed.lead, parsed.label, parsed.sub]).toEqual(['$10.00', 'Cash', 'Left: $600.00'])
  })
  it('draws a fall as a step down', () => {
    const down = ts({ group_totals: { ...ts().group_totals, taxable: ['300.00', '310.00', '250.00'] }, net_worth: ['550.00', '590.00', '560.00'] })
    const [placeholder, amount] = (netWorthBridgeOption(down, 2) as unknown as { series: { data: unknown[] }[] }).series
    // Taxable −60: the segment spans [560+…]: base is the LOWER remainder.
    expect(placeholder.data).toEqual([0, 590, 600, 550, 550, 0])
    expect((amount.data as { value: number }[]).map((d) => d.value)).toEqual([590, 10, 10, 60, 10, 560])
  })
  it('is null for the first month (nothing to bridge from) and exports the steps', () => {
    expect(netWorthBridgeOption(ts(), 0)).toBeNull()
    expect(netWorthBridgeOption(ts(), -1)).toBeNull()
    expect(netWorthBridgeCsv(ts(), 2).rows[1]).toEqual(['Cash', '10.00', '600.00'])
    expect(netWorthBridgeCsv(ts(), 0).rows).toEqual([])
  })
})

import { moversHeight, netWorthMovers, netWorthMoversOption } from './netWorthChartOptions'

// Jul → Aug, four groups moving unequally: taxable +100, liability −40 (more debt is a LOSS bar), cash +30, pre-tax +10 → net +100.
const MOVED = ts({
  group_totals: { ...ts().group_totals, cash: ['100.00', '110.00', '140.00'], taxable: ['300.00', '310.00', '410.00'], liability: ['-50.00', '-40.00', '-80.00'] },
  net_worth: ['550.00', '590.00', '690.00'],
})
type MoversRead = { yAxis: { data: string[]; inverse: boolean }; tooltip: { formatter: (p: unknown) => string }
  series: { name: string; barMaxWidth: number; label: { formatter: (p: { dataIndex: number }) => string }
    data: { value: number; itemStyle: { color: string }; label: { position: string } }[] }[] }
const movers = (option: unknown) => option as MoversRead

describe('netWorthMoversOption — Groups', () => {
  it('draws one bar per group that moved, largest first, signed at its outer end', () => {
    const option = movers(netWorthMoversOption(MOVED, 2, 'group'))
    // Four rows, not seven: a group that did not move is a label with no bar.
    expect(option.yAxis.data).toEqual(['Taxable', 'Liabilities', 'Cash', 'Pre-tax'])
    expect(option.yAxis.inverse).toBe(true) // the largest mover on TOP
    const [bars] = option.series
    expect([bars.name, bars.barMaxWidth]).toEqual(['Change', 24])
    expect(bars.data.map((d) => d.value)).toEqual([100, -40, 30, 10])
    expect(bars.data.map((d) => d.itemStyle.color)).toEqual([GROUP_COLORS.taxable, GROUP_COLORS.liability, GROUP_COLORS.cash, GROUP_COLORS.pre_tax])
    expect(bars.data.map((d) => d.label.position)).toEqual(['right', 'left', 'right', 'right'])
    expect([0, 1].map((i) => bars.label.formatter({ dataIndex: i }))).toEqual(['+$100', '-$40'])
  })
  it('tells each bar its share of the move, and refuses the months it cannot compare', () => {
    const option = movers(netWorthMoversOption(MOVED, 2, 'group'))
    const gain = tooltipRows(option.tooltip.formatter({ dataIndex: 0 }))
    expect([gain.lead, gain.label, gain.sub]).toEqual(['$100.00', 'Taxable', '100% of the change'])
    const loss = tooltipRows(option.tooltip.formatter({ dataIndex: 1 }))
    expect([loss.lead, loss.label, loss.sub]).toEqual(['-$40.00', 'Liabilities', '-40% of the change'])
    // Nothing to compare WITH, and nothing that moved: both are the card's empty sentence.
    expect([netWorthMoversOption(MOVED, 0, 'group'), netWorthMoversOption(MOVED, -1, 'group'), netWorthMoversOption(ts(), 2, 'account')]).toEqual([null, null, null])
    expect([moversHeight(1), moversHeight(6), moversHeight(20)]).toEqual([200, 228, 420])
  })
})

const acc = (id: number, name: string, group: AccountGroup, is_component = false): AccountOut => ({
  id, name, slug: `a${id}`, group, sort_order: id, is_active: true, is_component, parent_account_id: null, person_id: null,
})
// MOVED's deltas on accounts, plus a component (already folded into its parent by the server) and an account that did not move.
const ACCOUNTS = ts({
  accounts: [acc(1, 'Checking', 'cash'), acc(2, 'Brokerage', 'taxable'), acc(3, 'Card', 'liability'), acc(4, 'Vanguard sleeve', 'taxable', true), acc(5, 'Sock drawer', 'cash')],
  series: [
    { account_id: 1, values: ['100.00', '110.00', '140.00'] }, { account_id: 2, values: ['300.00', '310.00', '410.00'] },
    { account_id: 3, values: ['-50.00', '-40.00', '-80.00'] }, { account_id: 4, values: ['10.00', '10.00', '99.00'] },
    { account_id: 5, values: ['5.00', '5.00', '5.00'] },
  ],
  net_worth: ['550.00', '590.00', '690.00'],
})
// Twelve cash accounts moving +12 … +1: ten bars and one folded remainder of +3.
const MANY = ts({
  accounts: Array.from({ length: 12 }, (_, i) => acc(i + 1, `A${i + 1}`, 'cash')),
  series: Array.from({ length: 12 }, (_, i) => ({ account_id: i + 1, values: ['0.00', '0.00', `${12 - i}.00`] })),
  net_worth: ['0.00', '0.00', '78.00'],
})

describe('netWorthMoversOption — Accounts', () => {
  it('bars every non-component account that moved, coloured by its group and named in the tooltip', () => {
    const rows = netWorthMovers(ACCOUNTS, 2, 'account')
    expect(rows.map((m) => [m.label, m.groupLabel, m.color])).toEqual([['Brokerage', 'Taxable', GROUP_COLORS.taxable], ['Card', 'Liabilities', GROUP_COLORS.liability], ['Checking', 'Cash', GROUP_COLORS.cash]])
    const option = movers(netWorthMoversOption(ACCOUNTS, 2, 'account'))
    const first = tooltipRows(option.tooltip.formatter({ dataIndex: 0 }))
    expect([first.lead, first.label, first.sub]).toEqual(['$100.00', 'Brokerage', '100% of the change · Taxable'])
  })
  it('keeps the ten largest and folds the rest into one grey remainder — unless it cancels', () => {
    const rows = netWorthMovers(MANY, 2, 'account')
    expect(rows.map((m) => m.label)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'Other accounts'])
    expect(rows[10]).toMatchObject({ delta: 3, color: OTHER_SERIES_COLOR, groupLabel: null })
    expect(moversHeight(rows.length)).toBe(368)
    // A remainder that nets to zero is no bar at all (the rule every other row follows).
    const cancels = { ...MANY, series: MANY.series.map((s, i) => (i === 11 ? { ...s, values: ['0.00', '0.00', '-2.00'] } : s)) }
    expect(netWorthMovers(cancels, 2, 'account')).toHaveLength(10)
  })
})

import { netWorthMoversCsv, netWorthMoversLede } from './netWorthChartOptions'

// Cash +10 against taxable −10: the month's NET change is zero, so no bar has a share OF
// it — an "∞% of the change" would be a lie.
const FLAT = ts({
  group_totals: { ...ts().group_totals, pre_tax: ['200.00', '210.00', '210.00'], taxable: ['300.00', '310.00', '300.00'], liability: ['-50.00', '-40.00', '-40.00'] },
  net_worth: ['550.00', '590.00', '590.00'],
})

describe('netWorthMoversCsv', () => {
  it('exports the drawn rows under the four spec columns', () => {
    const csv = netWorthMoversCsv(MOVED, 2, 'group')
    expect(csv.headers).toEqual(['Mover', 'Group', 'Change', 'Share of change'])
    expect(csv.rows).toEqual([['Taxable', 'Taxable', '100.00', '100%'], ['Liabilities', 'Liabilities', '-40.00', '-40%'],
      ['Cash', 'Cash', '30.00', '30%'], ['Pre-tax', 'Pre-tax', '10.00', '10%']])
    expect(netWorthMoversCsv(MOVED, 0, 'group').rows).toEqual([])
  })
  it('leaves the group blank for the folded remainder, and the share blank on a flat month', () => {
    expect(netWorthMoversCsv(MANY, 2, 'account').rows.at(-1)).toEqual(['Other accounts', '', '3.00', '4%'])
    expect(netWorthMoversCsv(FLAT, 2, 'group').rows).toEqual([['Cash', 'Cash', '10.00', ''], ['Taxable', 'Taxable', '-10.00', '']])
    expect(tooltipRows(movers(netWorthMoversOption(FLAT, 2, 'group')).tooltip.formatter({ dataIndex: 0 })).sub).toBeUndefined()
  })
})

describe('netWorthMoversLede', () => {
  it('reads the two totals and the percent off the payload, and tones the move', () => {
    expect(netWorthMoversLede(MOVED, 2)).toEqual({
      fromLabel: 'Jul 2026', fromValue: '$590.00', toLabel: 'Aug 2026', toValue: '$690.00',
      // The SERVER's mom_pct — deliberately NOT 100/590, what re-deriving it here would print.
      delta: '+$100.00', pct: '+6.8%', tone: 'positive',
    })
    expect(netWorthMoversLede(MOVED, 0)).toBeNull()
    expect(netWorthMoversLede(ts({ mom_pct: [null, null, null] }), 2)?.pct).toBeNull()
    expect(netWorthMoversLede(FLAT, 2)?.tone).toBe('neutral')
  })
})
