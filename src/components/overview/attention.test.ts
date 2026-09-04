import { describe, expect, it } from 'vitest'
import type {
  BackupStatus,
  CoverageOut,
  EsppLotOut,
  EsppLotsResponse,
  HoldingOut,
  HoldingsResponse,
  LastRefresh,
  SystemStatus,
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
    latest_quote_at: '2026-08-17T00:00:00Z', // attention never reads it; type-complete
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
  return { year, notes: null, input_count: inputCount, bracket_count: 42, filing_status: 'single' }
}

function lastRefreshOut(failed: Record<string, string> = {}): LastRefresh {
  return {
    at: '2026-08-18T20:11:00+00:00',
    trigger: 'scheduled',
    updated: 36,
    failed,
    skipped_manual: 1,
    history_appended: true,
  }
}

function pricesOut(last: LastRefresh | null = lastRefreshOut()): SystemStatus['prices'] {
  return { last, next_run_at: null, scheduler_running: false }
}

function backupOut(lastSuccessAt: string): BackupStatus {
  return {
    last_success_at: lastSuccessAt,
    object_key: 'backups/finance_2026-08-16.sql.gz',
    size: '1.2M',
  }
}

// environment 'dev' in the baseline: the backup nag is PROD-only (spec §3), so dev is
// the quiet default — exactly what the real dev box is.
function systemOut(over: Partial<SystemStatus> = {}): SystemStatus {
  return {
    prices: pricesOut(),
    database: { size_bytes: 123_456_789, alembic_head: 'e7c5a9f4b2d8' },
    backup: null,
    environment: 'dev',
    ...over,
  }
}

// The all-clear coverage: every month of the window entered on both feeds, nothing empty
// and nothing missing — the quiet default the other suites rely on.
function coverageOut(over: Partial<CoverageOut> = {}): CoverageOut {
  return {
    balances: ['2026-06-01', '2026-07-01', '2026-08-01'],
    spending: ['2026-06-01', '2026-07-01', '2026-08-01'],
    net_pay: ['2026-06-01', '2026-07-01', '2026-08-01'],
    spending_empty: [],
    spending_missing: [],
    net_pay_missing: [],
    latest: { balances: '2026-08-01', spending: '2026-08-01', net_pay: '2026-08-01' },
    ...over,
  }
}

// The all-clear baseline: current month entered, quotes fresh, everything priced, no
// qualifying window open, the year's inputs filled, the last refresh clean.
function inputs(over: Partial<AttentionInputs> = {}): AttentionInputs {
  return {
    months: ['2026-06-01', '2026-07-01', '2026-08-01'],
    holdings: holdingsOut(),
    lots: lotsOut([]),
    taxYears: [taxYear(2026)],
    system: systemOut(),
    coverage: coverageOut(),
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

describe('attentionItems — the last refresh run', () => {
  it('stays quiet with no recorded run and with a clean one', () => {
    expect(keys(inputs({ system: systemOut({ prices: pricesOut(null) }) }))).toEqual([])
    expect(keys(inputs({ system: systemOut() }))).toEqual([])
  })

  it('names the failed tickers, capped at three', () => {
    const [one] = attentionItems(
      inputs({ system: systemOut({ prices: pricesOut(lastRefreshOut({ ZI: 'delisted' })) }) }),
      TODAY,
    )
    expect(one.key).toBe('refresh-failed')
    expect(one.text).toBe('1 ticker failed the last price refresh (ZI)')
    expect(one.to).toBe('/portfolio')

    const [many] = attentionItems(
      inputs({
        system: systemOut({
          prices: pricesOut(lastRefreshOut({ A: 'x', B: 'x', C: 'x', D: 'x', E: 'x' })),
        }),
      }),
      TODAY,
    )
    expect(many.text).toBe('5 tickers failed the last price refresh (A, B, C, +2 more)')
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

describe('attentionItems — the nightly backup (prod only)', () => {
  // TODAY's midnight UTC is the strip's clock (the prices-stale pattern): 2026-08-18
  // 00:00Z, so exactly-48h-ago is 2026-08-16T00:00:00Z.
  const prod = (backup: BackupStatus | null) =>
    inputs({ system: systemOut({ environment: 'prod', backup }) })

  it('nags when prod has no marker at all', () => {
    const [item] = attentionItems(prod(null), TODAY)
    expect(item.key).toBe('backup-stale')
    expect(item.text).toBe("Nightly backup hasn't run recently")
    expect(item.to).toBe('/settings#backups')
  })

  it('nags past 48 hours and stays quiet through the 48th exactly', () => {
    expect(keys(prod(backupOut('2026-08-15T23:00:00Z')))).toEqual(['backup-stale'])
    expect(keys(prod(backupOut('2026-08-16T00:00:00Z')))).toEqual([])
    expect(keys(prod(backupOut('2026-08-17T09:00:00Z')))).toEqual([])
  })

  // The verify phase (2026-09-03 data-lifecycle spec §8): a dump that uploaded but did not
  // restore is worth a line even when it is fresh.
  it('appends the verify verdict to a stale nag, and nags alone when fresh but unverified', () => {
    const stale = { ...backupOut('2026-08-15T23:00:00Z'), verified: false, verify_error: 'createdb failed' }
    const [item] = attentionItems(prod(stale), TODAY)
    expect(item.key).toBe('backup-stale')
    expect(item.text).toBe("Nightly backup hasn't run recently and last night's was not verified")
    const fresh = { ...backupOut('2026-08-17T09:00:00Z'), verified: false, verify_error: 'createdb failed' }
    const [only] = attentionItems(prod(fresh), TODAY)
    expect(only.key).toBe('backup-unverified')
    expect(only.text).toBe("Last night's backup was not verified")
    expect(only.to).toBe('/settings#backups')
    // Verified, fresh: nothing. Unknown (an older marker): nothing either — absence is not failure.
    expect(keys(prod({ ...backupOut('2026-08-17T09:00:00Z'), verified: true }))).toEqual([])
    expect(keys(prod(backupOut('2026-08-17T09:00:00Z')))).toEqual([])
  })

  it('is suppressed off prod — dev boxes never back up and must not nag', () => {
    expect(keys(inputs({ system: systemOut({ backup: null }) }))).toEqual([])
    expect(
      keys(inputs({ system: systemOut({ backup: backupOut('2026-08-01T00:00:00Z') }) })),
    ).toEqual([])
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
      system: systemOut({
        prices: pricesOut(lastRefreshOut({ ZI: 'delisted' })),
        environment: 'prod', // backup stays null -> the nag joins the parade
      }),
    })
    expect(keys(noisy)).toEqual([
      'update-due',
      'prices-stale',
      'unpriced',
      'holding-warnings',
      'refresh-failed',
      'backup-stale',
      'espp-qualifying',
      'tax-year-missing',
    ])
  })
})

describe('attentionItems — coverage honesty (honest-numbers spec §3)', () => {
  it('turns a month the window never got into a wizard job for that month', () => {
    const [item] = attentionItems(
      inputs({ coverage: coverageOut({ spending_missing: ['2026-07-01'] }) }),
      TODAY,
    )
    expect(item.key).toBe('spending-missing')
    expect(item.text).toBe('Jul 2026 spending was never entered')
    // Straight to the step that fixes it — the wizard reads both params.
    expect(item.to).toBe('/update?month=2026-07-01&step=spending')
  })

  it('names a month somebody saved with nothing in it', () => {
    const [item] = attentionItems(
      inputs({ coverage: coverageOut({ spending_empty: ['2026-08-01'] }) }),
      TODAY,
    )
    expect(item.key).toBe('spending-empty')
    expect(item.text).toBe('Aug 2026 was saved with no spending')
    expect(item.to).toBe('/update?month=2026-08-01&step=spending')
  })

  it('leads with the newest month of each class and counts the rest — one line per class', () => {
    const items = attentionItems(
      inputs({
        coverage: coverageOut({
          spending_missing: ['2026-04-01', '2026-05-01', '2026-07-01'],
          spending_empty: ['2026-06-01', '2026-08-01'],
        }),
      }),
      TODAY,
    )
    expect(items.map((i) => i.text)).toEqual([
      'Jul 2026 spending was never entered (+2 earlier months)',
      'Aug 2026 was saved with no spending (+1 earlier month)',
    ])
    expect(items.map((i) => i.to)).toEqual([
      '/update?month=2026-07-01&step=spending',
      '/update?month=2026-08-01&step=spending',
    ])
  })

  it('ignores an empty month past the end of the balances window', () => {
    // Same rule as the footer's parenthetical: the server lists every zero-filled month on
    // file, and one saved beyond the last snapshot was never part of the book.
    expect(keys(inputs({ coverage: coverageOut({ spending_empty: ['2026-09-01'] }) }))).toEqual([])
    // …while one INSIDE the window is still a job.
    expect(
      keys(inputs({ coverage: coverageOut({ spending_empty: ['2026-08-01'] }) })),
    ).toEqual(['spending-empty'])
  })

  it('says nothing on a backend older than the coverage extension', () => {
    const older: CoverageOut = {
      balances: ['2026-08-01'],
      spending: ['2026-08-01'],
      net_pay: ['2026-08-01'],
    }
    expect(keys(inputs({ coverage: older }))).toEqual([])
  })

  it('sits with the other data-entry nudges, ahead of the price items', () => {
    const data = inputs({
      months: ['2026-06-01', '2026-07-01'], // Aug's update is late — the existing nudge
      coverage: coverageOut({ spending_missing: ['2026-07-01'] }),
      holdings: holdingsOut({ as_of: null }),
    })
    expect(keys(data)).toEqual(['update-due', 'spending-missing', 'prices-never'])
  })
})
