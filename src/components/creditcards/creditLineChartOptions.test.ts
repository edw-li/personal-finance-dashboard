import { describe, expect, it } from 'vitest'
import { GRID_VARIANTS } from '../../charts/grammar'
import { INK, OTHER_SERIES_COLOR, PALETTE } from '../../charts/theme'
import { tooltipRows } from '../../testing/tooltipRows'
import {
  creditLineChartOption,
  creditLineCsv,
  limitMonths,
  monthOf,
  resolvedLimits,
} from './creditLineChartOptions'
import type { LimitHistoryCard } from './creditLineChartOptions'

const VX = {
  id: 1,
  name: 'Venture X',
  events: [
    { effective_date: '2023-05-12', limit_amount: '20000.00' },
    { effective_date: '2024-08-01', limit_amount: '25000.00' },
  ],
}
const BILT = {
  id: 2,
  name: 'BILT',
  events: [{ effective_date: '2024-02-20', limit_amount: '12500.00' }],
}

describe('limitMonths', () => {
  it('spans earliest event month through the end month', () => {
    const months = limitMonths([VX, BILT], '2023-08-01')
    expect(months[0]).toBe('2023-05-01')
    expect(months[months.length - 1]).toBe('2023-08-01')
    expect(months).toHaveLength(4)
  })
  it('is empty with no events', () => {
    expect(limitMonths([{ name: 'X', events: [] }], '2026-08-01')).toEqual([])
  })
})

describe('resolvedLimits', () => {
  it('nulls before the first event, mid-month events land in their month, then carries', () => {
    const months = ['2023-04-01', '2023-05-01', '2024-07-01', '2024-08-01', '2024-09-01']
    expect(monthOf('2023-05-12')).toBe('2023-05-01')
    expect(resolvedLimits(VX, months)).toEqual([null, 20000, 20000, 25000, 25000])
  })
  it('sorts unordered events before resolving', () => {
    const reversed = { name: 'R', events: [...VX.events].reverse() }
    expect(resolvedLimits(reversed, ['2024-09-01'])).toEqual([25000])
  })
})

describe('creditLineChartOption', () => {
  const months = ['2024-01-01', '2024-02-01', '2024-09-01']
  it('draws one step series per card, total sums only existing cards', () => {
    const option = creditLineChartOption([VX, BILT], months, { includeTotal: true })
    const series = option.series as { name: string; step?: string; data: (number | null)[] }[]
    expect(series.map((s) => s.name)).toEqual(['Venture X', 'BILT', 'Total line'])
    expect(series.every((s) => s.step === 'end')).toBe(true)
    // Jan: VX only (20000); Feb: 20000+12500; Sep: 25000+12500.
    expect(series[2].data).toEqual([20000, 32500, 37500])
  })
  it('omits the total when not asked', () => {
    const option = creditLineChartOption([VX], months, { includeTotal: false })
    expect((option.series as unknown[]).length).toBe(1)
  })

  it('grammar: money grid, LINE posture on every step series, INK total, legend picks fed back', () => {
    const option = creditLineChartOption([VX, BILT], months, {
      includeTotal: true,
      selected: { BILT: false },
    }) as unknown as {
      grid: unknown
      legend: { type: string; selected: unknown }
      series: { color: string; symbol: string; step: string; emphasis: unknown; z?: number }[]
      tooltip: { formatter: (p: unknown) => string }
    }
    expect(option.grid).toEqual(GRID_VARIANTS.default)
    expect(option.legend).toMatchObject({ type: 'plain', selected: { BILT: false } })
    expect(option.series.map((s) => s.color)).toEqual([PALETTE[0], PALETTE[1], INK])
    expect(option.series[0]).toMatchObject({
      symbol: 'none',
      step: 'end',
      emphasis: { focus: 'series' },
    })
    expect(option.series[2].z).toBe(10)
    const rows = tooltipRows(
      option.tooltip.formatter([
        {
          seriesName: 'Venture X',
          seriesType: 'line',
          axisValueLabel: 'Feb 2024',
          value: 20000,
          color: PALETTE[0],
        },
        { seriesName: 'BILT', seriesType: 'line', value: 12500, color: PALETTE[1] },
        { seriesName: 'Total line', seriesType: 'line', value: 32500, color: INK },
      ]),
    )
    expect(rows.rows.map((r) => [r.label, r.value])).toEqual([
      ['Venture X', '$20,000.00'],
      ['BILT', '$12,500.00'],
      ['Total line', '$32,500.00'],
    ])
  })

  it('exports month × card + total, blanks before a card exists', () => {
    expect(creditLineCsv([VX, BILT], months)).toEqual({
      headers: ['Month', 'Venture X', 'BILT', 'Total'],
      rows: [
        ['2024-01-01', '20000.00', '', '20000.00'],
        ['2024-02-01', '20000.00', '12500.00', '32500.00'],
        ['2024-09-01', '25000.00', '12500.00', '37500.00'],
      ],
    })
  })
})

// Drag to reorder (2026-09-23 spec §7): the card list's order is the user's, so it sets the
// series order — and with it the legend's and the tooltip's — but never a card's colour. The
// colour is the card's rank BY ID among every card the page knows (`rankIds`), or among the
// cards drawn when no rank source is handed in.
describe('creditLineChartOption — a card keeps its colour wherever it stands', () => {
  const months = ['2024-01-01', '2024-02-01', '2024-09-01']
  const drawn = (cards: LimitHistoryCard[], includeTotal = true, rankIds?: readonly number[]) => {
    const option = creditLineChartOption(cards, months, { includeTotal, rankIds })
    return {
      legend: option.legend,
      series: (option.series as { name: string; color: string }[]).map((s) => [s.name, s.color]),
    }
  }

  it('keeps every colour through a reorder; the series (so the legend and tooltip) follow the list', () => {
    expect(drawn([VX, BILT]).series).toEqual([
      ['Venture X', PALETTE[0]],
      ['BILT', PALETTE[1]],
      ['Total line', INK],
    ])
    // BILT dragged above Venture X: the order moves, no card is repainted.
    const moved = drawn([BILT, VX])
    expect(moved.series).toEqual([
      ['BILT', PALETTE[1]],
      ['Venture X', PALETTE[0]],
      ['Total line', INK],
    ])
    // No legend `data`: echarts lists the legend in series order, so it follows the list too.
    expect(moved.legend).not.toHaveProperty('data')
  })

  it('ranks the ids, not their values — gaps and large ids still take the first slots', () => {
    expect(drawn([{ ...VX, id: 40 }, { ...BILT, id: 7 }]).series).toEqual([
      ['Venture X', PALETTE[1]],
      ['BILT', PALETTE[0]],
      ['Total line', INK],
    ])
  })

  it('folds the ninth id and later into the Other gray, wherever those cards stand', () => {
    // Listed highest id first: id 9 leads the list and still takes the ninth rank.
    const cards = Array.from({ length: 9 }, (_, i) => ({
      id: 9 - i,
      name: `Card ${9 - i}`,
      events: [{ effective_date: '2024-01-01', limit_amount: '1000.00' }],
    }))
    const { series } = drawn(cards, false)
    expect(series.map(([name]) => name)).toEqual(cards.map((card) => card.name))
    expect(series[0][1]).toBe(OTHER_SERIES_COLOR)
    expect(series.slice(1).map(([, color]) => color)).toEqual([...PALETTE].reverse())
  })

  it('keeps the array position when a card is drawn without an id (one card on its own)', () => {
    expect(drawn([{ name: 'Solo', events: VX.events }], false).series).toEqual([
      ['Solo', PALETTE[0]],
    ])
  })

  // Amendment A1 (spec §7 as amended 2026-09-23): a person scope draws fewer cards, and ranked
  // among those alone the joint card would change colour between Grace's view and the
  // household's. Ranked among every card the page knows — archived ones included — it wears
  // one colour in every scope ("one colour per money entity").
  it('ranks among rankIds: the same card wears the same colour in a one-card scope and in the household draw', () => {
    // Seven cards known, as in the census; the joint Apple Card is id 6.
    const known = [1, 2, 3, 4, 5, 6, 7]
    const APPLE = {
      id: 6,
      name: 'Apple Card',
      events: [{ effective_date: '2024-01-05', limit_amount: '5000.00' }],
    }
    expect(drawn([VX, BILT, APPLE], true, known).series).toEqual([
      ['Venture X', PALETTE[0]],
      ['BILT', PALETTE[1]],
      ['Apple Card', PALETTE[5]],
      ['Total line', INK],
    ])
    expect(drawn([APPLE], false, known).series).toEqual([['Apple Card', PALETTE[5]]])
    // Without the page's rank source the lone card would take the first slot.
    expect(drawn([APPLE], false).series).toEqual([['Apple Card', PALETTE[0]]])
  })

  it('applies the 8-slot cap to the rank among rankIds: a ninth-ranked card is the Other gray even drawn alone', () => {
    const ninth = {
      id: 90,
      name: 'Card 90',
      events: [{ effective_date: '2024-01-01', limit_amount: '1000.00' }],
    }
    expect(drawn([ninth], false, [10, 20, 30, 40, 50, 60, 70, 80, 90]).series).toEqual([
      ['Card 90', OTHER_SERIES_COLOR],
    ])
  })

  it('still ranks a drawn card the rank source leaves out — among the rest, never an empty colour', () => {
    expect(drawn([BILT, VX], true, [2]).series).toEqual([
      ['BILT', PALETTE[1]],
      ['Venture X', PALETTE[0]],
      ['Total line', INK],
    ])
  })
})
