import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { INK, OTHER_SERIES_COLOR, PALETTE, SURFACE } from '../../charts/theme'
import type { RsuGrantOut, VestOut } from '../../types/api'
import {
  OTHER_GRANT_LABEL,
  vestingChartOption,
  vestingTooltipFormatter,
} from './vestingChartOptions'

// --- the golden schedule ----------------------------------------------------------------
// Wire shape of GET /comp/vesting-schedule's `grants` / `vests` halves. Two grants, four
// tranches: two already vested and priced at their own stored closes, two still ahead and
// valued only by the latest quote. The prices are the ones the rest of the comp fixtures
// carry (112.0750 / 129.5651 / 183.2508), so the two files describe one company.

function grant(over: Partial<RsuGrantOut> & Pick<RsuGrantOut, 'id' | 'label'>): RsuGrantOut {
  return {
    kind: 'refresh',
    focal_year: null,
    shares: 100,
    grant_price: '129.5651',
    first_vest_date: '2024-11-20',
    cliff_pct: '0.0625',
    notes: null,
    vest_count: 16,
    vested_shares: 0,
    unvested_shares: 100,
    ...over,
  }
}

function vest(over: Partial<VestOut> & Pick<VestOut, 'vest_date' | 'grant_id' | 'label'>): VestOut {
  return { shares: 0, fmv: null, value: null, is_past: false, ...over }
}

const NEW_HIRE = grant({ id: 1, label: 'FY24 new hire', kind: 'new_hire', cliff_pct: '0.25' })
const REFRESH = grant({ id: 2, label: 'FY26 refresh', focal_year: 2026 })

// Two past tranches of the new-hire grant, then a day both grants vest on.
const PAST_2024 = vest({
  vest_date: '2024-11-20', grant_id: 1, label: 'FY24 new hire',
  shares: 100, fmv: '112.0750', value: '11207.50', is_past: true,
})
const PAST_2025 = vest({
  vest_date: '2025-02-19', grant_id: 1, label: 'FY24 new hire',
  shares: 25, fmv: '129.5651', value: '3239.13', is_past: true,
})
const FUTURE_NEW_HIRE = vest({
  vest_date: '2026-11-18', grant_id: 1, label: 'FY24 new hire', shares: 25,
})
const FUTURE_REFRESH = vest({
  vest_date: '2026-11-18', grant_id: 2, label: 'FY26 refresh', shares: 38,
})

const GOLDEN_VESTS = [PAST_2024, PAST_2025, FUTURE_NEW_HIRE, FUTURE_REFRESH]
const GOLDEN_GRANTS = [NEW_HIRE, REFRESH]
const QUOTE = '183.2508'

// --- option readers ---------------------------------------------------------------------
// EChartsOption is a wide union; these narrow it once so the assertions stay about the
// numbers (compChartOptions.test.ts's posture).
interface SeriesLike {
  name?: string
  type?: string
  stack?: string
  color?: string
  barMaxWidth?: number
  itemStyle?: { borderColor?: string; borderWidth?: number }
  data?: unknown[]
}

function seriesOf(option: EChartsOption | null): SeriesLike[] {
  expect(option).not.toBeNull()
  return (option as unknown as { series: SeriesLike[] }).series
}

function categoriesOf(option: EChartsOption | null): string[] {
  return (option as unknown as { xAxis: { data: string[] } }).xAxis.data
}

function tooltipFormatterOf(option: EChartsOption | null): (params: unknown) => string {
  return (option as unknown as { tooltip: { formatter: (params: unknown) => string } }).tooltip
    .formatter
}

function moneyAxisLabelOf(option: EChartsOption | null): (value: number) => string {
  return (option as unknown as { yAxis: { axisLabel: { formatter: (v: number) => string } } })
    .yAxis.axisLabel.formatter
}

/** Nine grants, each vesting on the same two days — the fold's whole subject. */
function manyGrants(count: number): { grants: RsuGrantOut[]; vests: VestOut[] } {
  const grants: RsuGrantOut[] = []
  const vests: VestOut[] = []
  for (let i = 1; i <= count; i += 1) {
    const label = `Grant ${i}`
    grants.push(grant({ id: i, label }))
    vests.push(
      vest({ vest_date: '2026-02-18', grant_id: i, label, shares: 10, fmv: '100.0000',
        value: `${i * 100}.00`, is_past: true }),
      vest({ vest_date: '2026-05-20', grant_id: i, label, shares: 10, fmv: '100.0000',
        value: `${i * 10}.00`, is_past: true }),
    )
  }
  return { grants, vests }
}

describe('vestingChartOption', () => {
  it('stacks one bar series per grant, in the feed’s order, on the validated slots', () => {
    const option = vestingChartOption(GOLDEN_VESTS, GOLDEN_GRANTS, QUOTE)
    const series = seriesOf(option)

    expect(series).toHaveLength(2)
    expect(series.map((s) => s.name)).toEqual(['FY24 new hire', 'FY26 refresh'])
    // "Index IS the slot" (theme.ts): the fixed order is the CVD-safety mechanism, so the
    // first grant takes the first validated hue and no hue is invented here.
    expect(series.map((s) => s.color)).toEqual([PALETTE[0], PALETTE[1]])
    expect(series.every((s) => s.type === 'bar')).toBe(true)
    expect(series[0].stack).toBe(series[1].stack)
    // Stack-gap law: a hairline of the card surface between adjacent segments.
    expect(series[0].itemStyle).toEqual({ borderColor: SURFACE, borderWidth: 1 })
    expect(series[0].barMaxWidth).toBe(22)
    expect(series[1].barMaxWidth).toBe(22)
    // Hover borrows the ink the rest of the app's stacks use.
    expect((series[0] as { emphasis?: unknown }).emphasis).toEqual({
      itemStyle: { borderColor: INK },
    })
  })

  it('gives each distinct vest date one column, however many grants land on it', () => {
    const option = vestingChartOption(GOLDEN_VESTS, GOLDEN_GRANTS, QUOTE)
    // Three columns for four tranches: the last two share a day, and a shared day is one
    // bar with two segments — that IS the question the chart answers.
    expect(categoriesOf(option)).toEqual(['Nov 20, 2024', 'Feb 19, 2025', 'Nov 18, 2026'])
    const [newHire, refresh] = seriesOf(option)
    // A grant with nothing on a column contributes a real 0, so the stack stays aligned.
    expect(refresh.data).toEqual([0, 0, 6963.53])
    expect(newHire.data?.length).toBe(3)
  })

  it('values a past vest at its stored close and a future one at the latest quote', () => {
    const [newHire] = seriesOf(vestingChartOption(GOLDEN_VESTS, GOLDEN_GRANTS, QUOTE))
    // The first two are the server's own `value` (fmv x shares at the time), verbatim.
    // The third is 25 x 183.2508 = 4581.27 — the only figure this file computes, and it is
    // chart geometry, not a reported number.
    expect(newHire.data).toEqual([11207.5, 3239.13, 4581.27])
  })

  it('rounds a future bar back to cents rather than shipping float dust', () => {
    // 38 x 183.2508 is 6963.530399999999 in binary; an axis label must not carry it.
    const [, refresh] = seriesOf(vestingChartOption(GOLDEN_VESTS, GOLDEN_GRANTS, QUOTE))
    expect(String((refresh.data ?? [])[2])).toBe('6963.53')
  })

  it('omits the FUTURE columns entirely when there is no quote to value them at', () => {
    const option = vestingChartOption(GOLDEN_VESTS, GOLDEN_GRANTS, null)
    // A zero-height bar over Nov 2026 would say "this vest is worth nothing", which is a
    // different claim from "we do not know what it is worth" — so the day is not drawn.
    expect(categoriesOf(option)).toEqual(['Nov 20, 2024', 'Feb 19, 2025'])
    const [newHire, refresh] = seriesOf(option)
    expect(newHire.data).toEqual([11207.5, 3239.13])
    // The refresh grant is entirely in the future, so it keeps its legend slot and draws
    // nothing — its colour must not shift onto a grant that IS drawn.
    expect(refresh.color).toBe(PALETTE[1])
    expect(refresh.data).toEqual([0, 0])
  })

  it('contributes nothing for a past vest with no stored close behind it', () => {
    // A vest that happened on a day the price history has no bar for: it is real, its value
    // is unknown, and the payload's `warnings` is where that is said. Here it is a 0.
    const unpriced = vest({
      vest_date: '2025-05-21', grant_id: 1, label: 'FY24 new hire', shares: 25, is_past: true,
    })
    const [newHire] = seriesOf(
      vestingChartOption([PAST_2024, PAST_2025, unpriced], [NEW_HIRE], QUOTE),
    )
    expect(newHire.data).toEqual([11207.5, 3239.13, 0])
  })

  it('keeps a zero-share tranche as a real, zero-height column', () => {
    const empty = vest({
      vest_date: '2025-05-21', grant_id: 1, label: 'FY24 new hire', shares: 0,
      fmv: '150.0000', value: '0.00', is_past: true,
    })
    const option = vestingChartOption([PAST_2024, PAST_2025, empty], [NEW_HIRE], QUOTE)
    expect(categoriesOf(option)).toEqual(['Nov 20, 2024', 'Feb 19, 2025', 'May 21, 2025'])
    expect(seriesOf(option)[0].data).toEqual([11207.5, 3239.13, 0])
  })

  it('returns null when every past tranche is unpriced and nothing else draws', () => {
    // Two vests that happened, neither with a bar behind it: both contribute 0, so the chart
    // would be an axis of flat zeros — and a flat zero says "worth nothing", which is not what
    // "no stored close" means. The caller's empty note (with the payload's warnings beside it)
    // is the honest answer instead.
    const first = vest({
      vest_date: '2025-02-19', grant_id: 1, label: 'FY24 new hire', shares: 25, is_past: true,
    })
    const second = vest({
      vest_date: '2025-05-21', grant_id: 1, label: 'FY24 new hire', shares: 25, is_past: true,
    })
    expect(vestingChartOption([first, second], [NEW_HIRE], QUOTE)).toBeNull()

    // One PRICED zero among them is a figure the server actually computed, so the chart is
    // drawn — the zero-share-tranche rule above, seen from the other side.
    const priced = vest({
      vest_date: '2025-08-20', grant_id: 1, label: 'FY24 new hire', shares: 0,
      fmv: '150.0000', value: '0.00', is_past: true,
    })
    const option = vestingChartOption([first, second, priced], [NEW_HIRE], QUOTE)
    expect(categoriesOf(option)).toEqual(['Feb 19, 2025', 'May 21, 2025', 'Aug 20, 2025'])
    expect(seriesOf(option)[0].data).toEqual([0, 0, 0])
  })

  it('folds the ninth grant and beyond into one Other series', () => {
    const { grants, vests } = manyGrants(9)
    const series = seriesOf(vestingChartOption(vests, grants, QUOTE))

    // Eight validated slots and never a ninth: the palette's order is the CVD mechanism and
    // cycling back to slot 1 would put two grants in one hue.
    expect(series).toHaveLength(9)
    expect(series.map((s) => s.color)).toEqual([...PALETTE, OTHER_SERIES_COLOR])
    expect(series[8].name).toBe(OTHER_GRANT_LABEL)
    expect(series[7].name).toBe('Grant 8')
    // The fold is a SUM, not a truncation — grant 9's 900/90 is all that is in it here.
    expect(series[8].data).toEqual([900, 90])
    expect(series[0].data).toEqual([100, 10])
  })

  it('sums every folded grant into the one Other stack', () => {
    const { grants, vests } = manyGrants(10)
    const series = seriesOf(vestingChartOption(vests, grants, QUOTE))
    expect(series).toHaveLength(9)
    // Grants 9 and 10: 900 + 1000, then 90 + 100.
    expect(series[8].data).toEqual([1900, 190])
  })

  it('does not fold at exactly eight grants — every slot is still its own', () => {
    const { grants, vests } = manyGrants(8)
    const series = seriesOf(vestingChartOption(vests, grants, QUOTE))
    expect(series).toHaveLength(8)
    expect(series.map((s) => s.name)).toEqual(grants.map((g) => g.label))
    expect(series.map((s) => s.color)).toEqual([...PALETTE])
  })

  it('returns null under two vests so the caller can render an empty note', () => {
    expect(vestingChartOption([], [], QUOTE)).toBeNull()
    expect(vestingChartOption([PAST_2024], [NEW_HIRE], QUOTE)).toBeNull()
  })

  it('returns null when the quote leaves nothing at all to draw', () => {
    // Every tranche still ahead and no price to value them at: two vests on the wire, zero
    // columns after the omission — an axis with no categories is not a chart.
    expect(vestingChartOption([FUTURE_NEW_HIRE, FUTURE_REFRESH], GOLDEN_GRANTS, null)).toBeNull()
  })

  it('ignores a vest whose grant is not in the echo', () => {
    // The router drops an unschedulable grant from BOTH lists, so this is a torn feed only —
    // but a series-less vest must not open a column no bar can reach.
    const orphan = vest({ vest_date: '2027-02-17', grant_id: 99, label: 'gone', shares: 10 })
    const option = vestingChartOption([...GOLDEN_VESTS, orphan], GOLDEN_GRANTS, QUOTE)
    expect(categoriesOf(option)).toEqual(['Nov 20, 2024', 'Feb 19, 2025', 'Nov 18, 2026'])
  })

  it('formats the axis and wires the total-carrying tooltip formatter', () => {
    const option = vestingChartOption(GOLDEN_VESTS, GOLDEN_GRANTS, QUOTE)
    expect(moneyAxisLabelOf(option)(11207.5)).toBe('$11.2K')
    // The exported formatter itself, not a per-value one: the hover's last row is the
    // stack's TOTAL (2026-08-21 user request), which needs the whole params list.
    expect(tooltipFormatterOf(option)).toBe(vestingTooltipFormatter)
  })

  it('totals the hovered bar and escapes user-text grant labels', () => {
    const html = vestingTooltipFormatter([
      {
        seriesName: '<b>Offer</b> letter',
        marker: '<span class="m"></span>',
        axisValueLabel: 'Nov 18, 2026',
        value: 100.5,
      },
      { seriesName: 'Refresh', marker: '', value: 49.5 },
    ])
    expect(html).toContain('<strong>Nov 18, 2026</strong>')
    // A grant label is user text: it must arrive entity-encoded, never as live markup.
    expect(html).toContain('&lt;b&gt;Offer&lt;/b&gt; letter: $100.50')
    expect(html).not.toContain('<b>Offer</b>')
    expect(html).toContain('Refresh: $49.50')
    expect(html).toContain('<strong>Total: $150.00</strong>')
    // Nothing finite under the pointer (echarts can hand an empty hover) -> no tooltip.
    expect(vestingTooltipFormatter([{ value: undefined }])).toBe('')
  })
})
