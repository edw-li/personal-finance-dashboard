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
import { attentionItems, reviewAttentionItems } from './attention'
import type { AttentionInputs, AttentionItem } from './attention'
import type { ReviewState } from '../../api/monthReview'
import type { TimeStatusOut } from '../../types/api'
import {
  OCT1_EARLY,
  balancesPart,
  copyInOctober,
  copyOnSep23,
  earlySnapshot,
  flowsPart,
  snapshotStateOut,
  timeStatus,
} from '../../testing/timeFixtures'
import { setServerToday } from '../../utils/productToday'

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

describe('attentionItems — the monthly update, two parts (2026-09-23 spec §T3)', () => {
  // The ritual's lines only: the rest of the baseline is dated Aug 18 and would add a stale-quote
  // line on these autumn days.
  const ritual = (time: TimeStatusOut | null): AttentionItem[] => {
    if (time !== null) setServerToday(time.today)
    return attentionItems(inputs({ coverage: coverageOut({ time }) }), time?.today ?? TODAY).filter((item) =>
      item.key.startsWith('update-'),
    )
  }

  it('asks for nothing on Sep 23 — Oct 1 recorded early, September still running', () => {
    expect(ritual(copyOnSep23())).toEqual([])
  })

  it('on Oct 3 asks for the two parts, each as a to-do linked to its step', () => {
    expect(ritual(copyInOctober())).toEqual([
      {
        key: 'update-balances',
        text: 'Update Oct 1 balances — recorded early, on Sep 22',
        to: '/update?month=2026-10-01&step=balances',
        tone: 'todo',
      },
      {
        key: 'update-flows',
        text: 'Finish September spending and enter take-home',
        to: '/update?month=2026-09-01&step=spending',
        tone: 'todo',
      },
    ])
  })

  it('keeps September partial after a take-home save alone (spec §K3)', () => {
    const [, flows] = ritual(copyInOctober('2026-10-03', { take_home_entered: true }))
    expect(flows.text).toBe('Finish September spending — entered during September; add what has posted since')
  })

  it('asks only for the take-home once spending is saved after the month, and nothing once it is in', () => {
    const [, flows] = ritual(copyInOctober('2026-10-03', { spending: 'entered', spending_entered: true }))
    expect(flows.text).toBe('Enter September take-home')
    const done = { ...copyInOctober(), flows_due: [] }
    expect(ritual(done).map((item) => item.key)).toEqual(['update-balances'])
  })

  it('warns once the balances are overdue — the 7th by default', () => {
    const [balances] = ritual(copyInOctober('2026-10-07'))
    expect(balances).toMatchObject({ text: 'Oct 1 balances are still provisional (recorded Sep 22)', tone: 'warn' })
  })

  it('asks to record balances that do not exist yet, and warns once they are late', () => {
    const missing = timeStatus('2026-10-03', { balances: balancesPart('2026-10-01', null) })
    expect(ritual(missing)[0]).toMatchObject({
      key: 'update-balances',
      text: 'Record Oct 1 balances',
      to: '/update?month=2026-10-01&step=balances',
      tone: 'todo',
    })
    const late = timeStatus('2026-10-08', { balances: balancesPart('2026-10-01', null, true) })
    expect(ritual(late)[0]).toMatchObject({ text: 'Oct 1 balances are overdue — due Oct 1', tone: 'warn' })
  })

  it('warns from the 16th with the due date the partial month missed', () => {
    const [, flows] = ritual(copyInOctober('2026-10-16'))
    expect(flows).toMatchObject({
      text: 'September spending is still partial and its take-home is missing — was due Oct 15',
      tone: 'warn',
    })
    const [, withPay] = ritual(copyInOctober('2026-10-16', { take_home_entered: true }))
    expect(withPay.text).toBe('September spending is still partial — was due Oct 15')
  })

  it('names what a month with no spending lacks, due and overdue', () => {
    const month = (over: Parameters<typeof flowsPart>[1]) =>
      ritual(timeStatus('2026-10-03', { flows_due: [flowsPart('2026-09-01', over)] }))[0]
    expect(month({})).toMatchObject({ text: 'Enter September spending & take-home', tone: 'todo' })
    expect(month({ take_home_entered: true }).text).toBe('Enter September spending')
    expect(month({ overdue: true })).toMatchObject({ text: 'September spending & take-home are overdue', tone: 'warn' })
    expect(month({ overdue: true, take_home_entered: true }).text).toBe('September spending is overdue')
    expect(month({ overdue: true, spending: 'entered', spending_entered: true }).text).toBe(
      'September take-home is overdue',
    )
  })

  it('folds a backlog into one line naming the newest month, warning when an older one is late', () => {
    const backlog = timeStatus('2027-01-05', {
      flows_due: [
        flowsPart('2026-12-01'),
        flowsPart('2026-11-01', { overdue: true }),
        flowsPart('2026-10-01', { overdue: true }),
      ],
    })
    const [flows] = ritual(backlog)
    expect(flows).toMatchObject({
      text: 'Enter December 2026 spending & take-home (+2 earlier months)',
      to: '/update?month=2026-12-01&step=spending',
      tone: 'warn',
    })
    const quiet = timeStatus('2026-10-03', { flows_due: [flowsPart('2026-09-01'), flowsPart('2026-08-01')] })
    expect(ritual(quiet)[0]).toMatchObject({ text: 'Enter September spending & take-home (+1 earlier month)', tone: 'todo' })
  })

  it('names an earlier snapshot that stayed provisional, newest first', () => {
    const nov5 = timeStatus('2026-11-05', { provisional_past: [OCT1_EARLY] })
    expect(ritual(nov5)).toEqual([
      {
        key: 'update-provisional',
        text: 'Oct 1 balances are still provisional (recorded Sep 22) — confirm or update them',
        to: '/update?month=2026-10-01&step=balances',
        tone: 'warn',
      },
    ])
    const two = timeStatus('2026-11-05', {
      provisional_past: [OCT1_EARLY, earlySnapshot('2026-09-01', '2026-08-30')],
    })
    expect(ritual(two)[0].text).toBe(
      'Oct 1 balances are still provisional (recorded Sep 22) — confirm or update them (+1 earlier)',
    )
  })

  it('never raises the old premature nudges', () => {
    // A book whose current month has no snapshot and whose coverage names a missing month, on a
    // backend with no `time`: nothing — what is due is `time`'s to say.
    const items = attentionItems(
      inputs({ months: ['2026-06-01', '2026-07-01'], coverage: coverageOut({ spending_missing: ['2026-07-01'] }) }),
      TODAY,
    )
    expect(items.map((item) => item.key)).toEqual([])
  })

  it('stays silent on an empty book — the Overview’s Start here card says what to do', () => {
    expect(ritual(null)).toEqual([])
    expect(keys(inputs({ months: [] }))).toEqual([])
  })

  it('says nothing while the current balances are final and nothing has ended unentered', () => {
    const sep = timeStatus('2026-09-02', { current_snapshot: snapshotStateOut('2026-09-01') })
    expect(ritual(sep)).toEqual([])
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
    setServerToday(TODAY)
    const noisy = inputs({
      // Aug 18 with no Aug 1 balances: late (the 7th has passed).
      coverage: coverageOut({ time: timeStatus(TODAY, { balances: balancesPart('2026-08-01', null, true) }) }),
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
      'update-balances',
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
  it('names a month somebody saved with nothing in it', () => {
    const [item] = attentionItems(
      inputs({ coverage: coverageOut({ spending_empty: ['2026-08-01'] }) }),
      TODAY,
    )
    expect(item.key).toBe('spending-empty')
    expect(item.text).toBe('Aug 2026 was saved with no spending')
    expect(item.to).toBe('/update?month=2026-08-01&step=spending')
  })

  it('leads with the newest empty month and counts the rest — one line', () => {
    const items = attentionItems(
      inputs({ coverage: coverageOut({ spending_empty: ['2026-06-01', '2026-08-01'] }) }),
      TODAY,
    )
    expect(items.map((i) => i.text)).toEqual(['Aug 2026 was saved with no spending (+1 earlier month)'])
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

  it('sits with the other data-entry lines, ahead of the price items', () => {
    setServerToday(TODAY)
    const data = inputs({
      coverage: coverageOut({
        spending_empty: ['2026-08-01'],
        time: timeStatus(TODAY, { flows_due: [flowsPart('2026-07-01', { overdue: true })] }),
      }),
      holdings: holdingsOut({ as_of: null }),
    })
    expect(keys(data)).toEqual(['update-flows', 'spending-empty', 'prices-never'])
  })
})

describe('reviewAttentionItems — past months as actions (2026-09-13 polish §14, 2026-09-23 spec §T3)', () => {
  const review = (month: string, state: ReviewState) => ({ month, state })

  it('turns open past months into to-dos, newest first, two at most', () => {
    const items = reviewAttentionItems(
      [review('2026-04-01', 'closed'), review('2026-05-01', 'ready_to_review'), review('2026-06-01', 'needs_review'), review('2026-07-01', 'in_progress')],
      TODAY,
    )
    expect(items.map((i) => i.text)).toEqual(["Finish Jul 2026's update", 'Jun 2026 changed since review — reopen'])
    expect(items[0]).toMatchObject({ key: 'review-2026-07-01', to: '/update?month=2026-07-01&step=review' })
    expect(reviewAttentionItems([review('2026-05-01', 'ready_to_review')], TODAY)[0].text).toBe('May 2026 is ready to close')
  })

  it('never lists the current month, on any day of it', () => {
    for (const day of ['2026-08-01', '2026-08-07', '2026-08-18', '2026-08-31']) {
      expect(reviewAttentionItems([review('2026-08-01', 'in_progress')], day)).toEqual([])
    }
    expect(reviewAttentionItems([review('2026-09-01', 'in_progress')], TODAY)).toEqual([])
  })

  it('leaves a month to the flows line while it is listed there — ready to close once it is not', () => {
    const september = [review('2026-09-01', 'ready_to_review')]
    expect(
      reviewAttentionItems(september, '2026-10-03', [flowsPart('2026-09-01', { spending: 'partial' })]),
    ).toEqual([])
    expect(reviewAttentionItems(september, '2026-10-03', [])[0].text).toBe('Sep 2026 is ready to close')
  })

  it('never lists closed, unreviewed-history or not-started months, and tolerates no coverage', () => {
    expect(reviewAttentionItems([review('2026-06-01', 'closed'), review('2026-05-01', 'unreviewed_history'), review('2026-04-01', 'not_started')], TODAY)).toEqual([])
    expect(reviewAttentionItems(undefined, TODAY)).toEqual([])
  })
})
