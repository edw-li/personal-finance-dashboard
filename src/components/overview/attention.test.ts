import { describe, expect, it } from 'vitest'
import type {
  EsppLotOut,
  EsppLotsResponse,
  HoldingOut,
  HoldingsResponse,
  TaxYearOut,
} from '../../types/api'
import { attentionItems } from './attention'
import type { AttentionInputs } from './attention'

// The clock is INJECTED (todayIso param), so unlike the page tests nothing here depends
// on the run's real date. Aug 18: past the day-7 nudge, current month '2026-08-01'.
const TODAY = '2026-08-18'

function holding(over: Partial<HoldingOut> = {}): HoldingOut {
  return {
    security_id: 1, ticker: 'AAA', name: 'AAA Inc', industry: 'Tech',
    holding_type: 'stock', is_manual_priced: false, shares: '10', avg_cost: '100.0000',
    cost_basis: '1000.00', price: '110.0000', quoted_at: '2026-08-17T00:00:00Z',
    price_source: 'yfinance', day_change_pct: null, day_change_amount: null,
    market_value: '1100.00', weight_pct: '1.000000', unrealized_gl: '100.00',
    unrealized_gl_pct: '0.100000', realized_gl: '0.00', dividends_collected: '0.00',
    annual_dividend: null, annual_income: null, yield_pct: null, yoc_pct: null,
    xirr_pct: null, accounts: ['Acct'], warnings: [],
    ...over,
  }
}

function holdingsOut(over: Partial<HoldingsResponse> = {}): HoldingsResponse {
  return {
    as_of: '2026-08-17T00:00:00Z', // one day back — fresh
    totals: {
      market_value: '1100.00', cost_basis: '1000.00', unrealized_gl: '100.00',
      unrealized_gl_pct: '0.100000', day_change_amount: null, day_change_pct: null,
      realized_gl: '0.00', dividends_collected: '0.00', annual_income: '0.00',
      unpriced_count: 0,
    },
    holdings: [holding()],
    ...over,
  }
}

function lot(days: number | null, over: Partial<EsppLotOut> = {}): EsppLotOut {
  return {
    id: 1, purchase_date: '2026-02-27', qualifying_date: '2026-09-01', shares: '10.0000',
    subscription_price: '100.00000', purchase_fmv: '120.00000', purchase_price: '85.00000',
    sold_date: null, sold_price: null, notes: null, cost_basis: '850.00',
    market_value: null, gain_amount: null, gain_pct: null,
    qualified: false, days_until_qualified: days, is_sold: false,
    ...over,
  }
}

function lotsOut(lots: EsppLotOut[]): EsppLotsResponse {
  return { espp_ticker: 'NVDA', current_price: null, quoted_at: null, lots }
}

function taxYear(year: number, inputCount = 21): TaxYearOut {
  return { year, notes: null, input_count: inputCount, bracket_count: 42 }
}

// The all-clear baseline: current month entered, quotes fresh, everything priced, no
// qualifying window open, the year's inputs filled.
function inputs(over: Partial<AttentionInputs> = {}): AttentionInputs {
  return {
    months: ['2026-06-01', '2026-07-01', '2026-08-01'],
    holdings: holdingsOut(),
    lots: lotsOut([]),
    taxYears: [taxYear(2026)],
    ...over,
  }
}

function keys(data: AttentionInputs, today = TODAY): string[] {
  return attentionItems(data, today).map((i) => i.key)
}

describe('attentionItems — quiet when nothing needs doing', () => {
  it('answers empty on the all-clear baseline', () => {
    expect(attentionItems(inputs(), TODAY)).toEqual([])
  })
})

describe('attentionItems — the monthly update', () => {
  it('nudges once the month is a week old and its update is missing', () => {
    const data = inputs({ months: ['2026-06-01', '2026-07-01'] })
    const [item] = attentionItems(data, TODAY)
    expect(item.key).toBe('update-due')
    expect(item.text).toBe("Aug 2026's monthly update hasn't been entered yet")
    expect(item.to).toBe('/update')
  })

  it('holds the nudge in the month first days — the ritual has not slipped yet', () => {
    expect(keys(inputs({ months: ['2026-06-01', '2026-07-01'] }), '2026-08-06')).toEqual([])
  })

  it('calls BOTH months out when the previous one is missing too, on any day', () => {
    const [item] = attentionItems(inputs({ months: ['2026-05-01', '2026-06-01'] }), '2026-08-02')
    expect(item.key).toBe('update-overdue')
    expect(item.text).toContain('Jul 2026 and Aug 2026')
  })

  it('stays silent on a fresh database — the empty states already say "enter a month"', () => {
    expect(keys(inputs({ months: [] }))).toEqual([])
  })

  it('treats a mid-history hole as repair work, not a ritual reminder', () => {
    // June missing but July and August entered: the ritual is current.
    expect(keys(inputs({ months: ['2026-05-01', '2026-07-01', '2026-08-01'] }))).toEqual([])
  })
})

describe('attentionItems — prices', () => {
  it('flags a stale oldest quote by DATE, with the bar date named', () => {
    const data = inputs({ holdings: holdingsOut({ as_of: '2026-08-10T00:00:00Z' }) })
    const [item] = attentionItems(data, TODAY)
    expect(item.key).toBe('prices-stale')
    expect(item.text).toBe('Quotes are stale — the oldest is from Aug 10, 2026')
    expect(item.to).toBe('/portfolio')
    // Four days back is the threshold's fresh side (staleness.ts pins the boundary).
    expect(keys(inputs({ holdings: holdingsOut({ as_of: '2026-08-14T00:00:00Z' }) }))).toEqual([])
  })

  it('says never-refreshed only when there are holdings to price', () => {
    expect(
      keys(inputs({ holdings: holdingsOut({ as_of: null }) })),
    ).toEqual(['prices-never'])
    expect(keys(inputs({ holdings: holdingsOut({ as_of: null, holdings: [] }) }))).toEqual([])
  })

  it('counts unpriced holdings and warned rows, singular and plural', () => {
    const totals = { ...holdingsOut().totals, unpriced_count: 1 }
    expect(attentionItems(inputs({ holdings: holdingsOut({ totals }) }), TODAY)[0].text).toBe(
      '1 holding has no price yet',
    )
    const warned = holdingsOut({
      holdings: [holding(), holding({ security_id: 2, ticker: 'BBB', warnings: ['sell with no held shares'] })],
    })
    expect(attentionItems(inputs({ holdings: warned }), TODAY)[0].text).toBe(
      '1 holding carries data warnings',
    )
  })
})

describe('attentionItems — ESPP qualifying window', () => {
  it('counts down the soonest unsold lot inside 30 days', () => {
    const [item] = attentionItems(inputs({ lots: lotsOut([lot(5)]) }), TODAY)
    expect(item.key).toBe('espp-qualifying')
    expect(item.text).toBe('An ESPP lot qualifies in 5 days (Sep 1, 2026)')
    expect(item.to).toBe('/espp')
  })

  it('says today and tomorrow instead of counting to zero', () => {
    expect(attentionItems(inputs({ lots: lotsOut([lot(0)]) }), TODAY)[0].text).toContain(
      'qualifies today',
    )
    expect(attentionItems(inputs({ lots: lotsOut([lot(1)]) }), TODAY)[0].text).toContain(
      'qualifies tomorrow',
    )
  })

  it('folds multiple lots into one line led by the soonest', () => {
    const [item] = attentionItems(
      inputs({ lots: lotsOut([lot(12, { id: 2 }), lot(3)]) }),
      TODAY,
    )
    expect(item.text).toBe('2 ESPP lots qualify within 30 days — next in 3 days')
  })

  it('ignores sold, already-qualified and far-off lots', () => {
    const quiet = [
      lot(5, { id: 1, is_sold: true, days_until_qualified: null }),
      lot(0, { id: 2, qualified: true }),
      lot(31, { id: 3 }),
    ]
    expect(keys(inputs({ lots: lotsOut(quiet) }))).toEqual([])
  })
})

describe('attentionItems — taxes', () => {
  it('asks for the current year when it does not exist yet', () => {
    const [item] = attentionItems(inputs({ taxYears: [taxYear(2025)] }), TODAY)
    expect(item.text).toBe('No 2026 tax year set up yet')
    expect(item.to).toBe('/taxes')
  })

  it('flags an existing year whose inputs are still empty', () => {
    const [item] = attentionItems(inputs({ taxYears: [taxYear(2026, 0)] }), TODAY)
    expect(item.text).toBe("2026's tax inputs are empty")
  })
})

describe('attentionItems — ordering', () => {
  it('lists the ritual first, then prices, then the module reminders', () => {
    const noisy = inputs({
      months: ['2026-06-01', '2026-07-01'],
      holdings: holdingsOut({
        as_of: '2026-08-01T00:00:00Z',
        totals: { ...holdingsOut().totals, unpriced_count: 2 },
        holdings: [holding({ warnings: ['oversold'] })],
      }),
      lots: lotsOut([lot(9)]),
      taxYears: [],
    })
    expect(keys(noisy)).toEqual([
      'update-due',
      'prices-stale',
      'unpriced',
      'holding-warnings',
      'espp-qualifying',
      'tax-year-missing',
    ])
  })
})
