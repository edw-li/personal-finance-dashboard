import { describe, expect, it } from 'vitest'
import type { PortfolioHistory } from '../../types/api'
import { benchmarkLede, benchmarkLedeText, performanceLede } from './benchmarkLede'

// Wire shape of GET /portfolio/history — Decimal strings, parallel arrays.
function history(over: Partial<PortfolioHistory> = {}): PortfolioHistory {
  return {
    dates: ['2026-07-27', '2026-08-03', '2026-08-10'],
    market_value: ['700000.00', '710000.50', '718422.07'],
    cost_basis: ['395000.00', '399542.36', '400243.74'],
    sp500: ['96000.00', '97000.00', '98636.70'],
    benchmark: ['96000.00', '97250.00', '99001.13'],
    ...over,
  }
}

const EMPTY: PortfolioHistory = {
  dates: [],
  market_value: [],
  cost_basis: [],
  sp500: [],
  benchmark: [],
}

describe('the benchmark lede (2026-09-23 spec §C8, review round 1)', () => {
  // Three checkpoints where every leg is easy to follow. The starting-balance leg S0 takes no
  // deposits, so its ratio is VOO's own growth: ×1.1 to June, ×1.2 from June to January. The VOO
  // leg B starts level with the portfolio and takes the same $10 deposit in the second stretch:
  // 120 × 1.2 + 10 = 154. The portfolio V does exactly as well from June on: 150 × 1.2 + 10 = 190.
  const legs = (over: Partial<PortfolioHistory> = {}) =>
    history({
      dates: ['2025-01-06', '2025-06-02', '2026-01-05'],
      market_value: ['100.00', '150.00', '190.00'],
      cost_basis: ['100.00', '100.00', '110.00'],
      sp500: ['100.00', '110.00', '132.00'],
      benchmark: ['100.00', '120.00', '154.00'],
      ...over,
    })

  it('over a range, compares the same money: the opening lead grows at VOO’s rate before the gap is taken', () => {
    // Already $30 ahead in June and matching VOO since: $0 of outperformance over the range. The
    // change in the lead ((190 − 150) − (154 − 120) = $6) would have credited VOO's own growth on
    // the $30 lead to the portfolio.
    expect(benchmarkLede(legs(), 1, 2)).toEqual({ direction: 'level', amount: 0 })
    // $10 short of that: behind by $10.
    expect(benchmarkLede(legs({ market_value: ['100.00', '150.00', '180.00'] }), 1, 2)).toEqual({
      direction: 'behind',
      amount: 10,
    })
    // …and $5 better: ahead by $5.
    expect(benchmarkLede(legs({ market_value: ['100.00', '150.00', '195.00'] }), 1, 2)).toEqual({
      direction: 'ahead',
      amount: 5,
    })
  })

  it('over the whole history, is the gap to the same deposits in VOO — both legs start level', () => {
    // finance_realdata, Oct 23, 2023 → Sep 21, 2026: 53,619.00 → 848,870.10, against the same
    // deposits in VOO 53,619.00 → 585,187.87 — the household is $263,682.23 ahead.
    const real = history({
      dates: ['2023-10-23', '2026-09-21'],
      market_value: ['53619.00', '848870.10'],
      cost_basis: ['53619.00', '512413.42'],
      sp500: ['53619.00', '98583.76'],
      benchmark: ['53619.00', '585187.87'],
    })
    expect(benchmarkLede(real)).toEqual({ direction: 'ahead', amount: 263682.23 })
    expect(benchmarkLedeText(benchmarkLede(real)!)).toEqual({
      text: 'Ahead of the same deposits in VOO by',
      amount: '$263.7K',
    })
    // A zero opening lead has nothing to rebase: the sentence stands without VOO's ratio.
    expect(benchmarkLede(legs({ sp500: ['0.00', '0.00', '0.00'] }))).toEqual({
      direction: 'ahead',
      amount: 36,
    })
  })

  it('says nothing when VOO’s growth cannot be formed for a lead that needs it — absent is not zero', () => {
    expect(benchmarkLede(legs({ sp500: ['100.00', '110.00'] }), 1, 2)).toBeNull()
    expect(benchmarkLede(legs({ sp500: ['100.00', '0.00', '132.00'] }), 1, 2)).toBeNull()
    expect(benchmarkLede(legs({ sp500: ['100.00', '110.00', 'x'] }), 1, 2)).toBeNull()
    expect(benchmarkLede(history({ benchmark: [null, '1.00', '2.00'] }))).toBeNull()
    expect(benchmarkLede(history({ benchmark: ['1.00', '2.00', null] }))).toBeNull()
    expect(
      benchmarkLede({ ...history(), benchmark: undefined } as unknown as PortfolioHistory),
    ).toBeNull()
    expect(benchmarkLede(history(), 2, 2)).toBeNull()
    expect(benchmarkLede(EMPTY)).toBeNull()
  })

  it('is exact to the cent: integer cents, the rebased lead rounded half away from zero', () => {
    // 1,000.30 − 1,000.10 in floats is 0.1999999999999318.
    expect(
      benchmarkLede(legs({ market_value: ['100.00', '100.00', '1000.30'], benchmark: ['100.00', '100.00', '1000.10'] }), 1, 2),
    ).toEqual({ direction: 'ahead', amount: 0.2 })
    // A one-cent deficit grown ×2.5 is −2.5¢, which rounds to −3¢ (Math.round would say −2¢).
    expect(
      benchmarkLede(
        legs({
          market_value: ['100.00', '99.99', '250.00'],
          benchmark: ['100.00', '100.00', '250.00'],
          sp500: ['100.00', '2.00', '5.00'],
        }),
        1,
        2,
      ),
    ).toEqual({ direction: 'ahead', amount: 0.03 })
  })

  it('words the whole history against the same deposits and a range against the same money', () => {
    expect(benchmarkLedeText({ direction: 'ahead', amount: 263682.23 })).toEqual({
      text: 'Ahead of the same deposits in VOO by',
      amount: '$263.7K',
    })
    expect(benchmarkLedeText({ direction: 'ahead', amount: 37160.45 }, 'Over 1Y')).toEqual({
      text: 'Over 1Y: ahead of the same money in VOO by',
      amount: '$37.2K',
    })
    expect(benchmarkLedeText({ direction: 'behind', amount: 30 }, 'Year to date')).toEqual({
      text: 'Year to date: behind the same money in VOO by',
      amount: '$30',
    })
    expect(benchmarkLedeText({ direction: 'level', amount: 0 })).toEqual({
      text: 'Level with the same deposits in VOO',
      amount: null,
    })
    expect(benchmarkLedeText({ direction: 'level', amount: 0 }, 'Over 1Y')).toEqual({
      text: 'Over 1Y: level with the same money in VOO',
      amount: null,
    })
  })

  // Three weeks from Jul 27, 2026 whose legs start level, as the server's always do.
  const weeks = () =>
    history({
      market_value: ['96000.00', '97500.00', '99500.00'],
      benchmark: ['96000.00', '97250.00', '99001.13'],
    })

  it("names the chip's window, or the one the reader dragged out", () => {
    // Twenty months of history: both chips' windows open on the January checkpoint, inside it.
    const long = legs({
      dates: ['2025-01-06', '2026-01-05', '2026-09-07'],
      market_value: ['100.00', '150.00', '195.00'],
    })
    expect(performanceLede(long, { preset: 'all' })?.text).toMatch(/^Ahead of the same deposits/)
    expect(performanceLede(long, { preset: '1y' })?.text).toMatch(/^Over 1Y: ahead of the same money/)
    expect(performanceLede(long, { preset: 'ytd' })?.text).toMatch(/^Year to date: ahead of the same money/)
    const h = weeks()
    // The chart echoes a chip's own window back through datazoom (and the live ping's category
    // sits one past the dates): still the chip's words.
    expect(
      performanceLede(h, { preset: 'all', window: { startValue: 0, endValue: 3 } })?.text,
    ).toMatch(/^Ahead of/)
    expect(
      performanceLede(h, { preset: 'all', window: { startValue: 1, endValue: 2 } })?.text,
    ).toMatch(/^Aug 3, 2026 – Aug 10, 2026: ahead of the same money/)
    expect(
      performanceLede(h, { preset: 'all', window: { startValue: 0, endValue: 1 } })?.text,
    ).toMatch(/^Jul 27, 2026 – Aug 3, 2026: ahead of/)
    expect(performanceLede(history({ benchmark: [null, null, null] }), { preset: 'all' })).toBeNull()
  })

  it('says since when the history is shorter than the chip’s range', () => {
    // Three weeks: neither a year nor the year to date.
    const h = weeks()
    expect(performanceLede(h, { preset: '1y' })?.text).toMatch(/^Since Jul 27, 2026: ahead of the same money/)
    expect(performanceLede(h, { preset: 'ytd' })?.text).toMatch(/^Since Jul 27, 2026: ahead of/)
    // A history that starts exactly on the chip's cutoff covers the whole range.
    const exact = history({ dates: ['2025-08-10', '2026-02-02', '2026-08-10'] })
    expect(performanceLede(exact, { preset: '1y' })?.text).toMatch(/^Over 1Y:/)
  })
})
