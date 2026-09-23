import { describe, expect, it } from 'vitest'
import type { DividendEventOut, DividendOut, PortfolioHistory, TransactionOut } from '../../types/api'
import { buildEventMarkers, buildPerformanceEvents } from './performanceEvents'
import type { PerformanceEvents } from './performanceEvents'

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


const NO_EVENTS: PerformanceEvents = { buys: [], sells: [], dividends: [], exDividends: [] }

// --- event markers (2026-08-25 spec §2c) --------------------------------------------

const TICKERS = new Map([
  [1, 'NVDA'],
  [2, 'VOO'],
])

function txn(over: Partial<TransactionOut> & Pick<TransactionOut, 'id' | 'type'>): TransactionOut {
  return {
    security_id: 1, account: 'Fidelity', txn_date: null, shares: '10', price: '100.00',
    fees: null, split_factor: null, sort_index: 0, source: 'ui', notes: null, ...over,
  }
}

function div(over: Partial<DividendOut> & Pick<DividendOut, 'id' | 'pay_date'>): DividendOut {
  return {
    security_id: 2, account: null, amount: '12.00', source: 'manual', ex_date: null,
    per_share: null, shares_held: null, notes: null, ...over,
  }
}

function exdiv(over: Partial<DividendEventOut> = {}): DividendEventOut {
  return { security_id: 2, ex_date: '2026-08-09', per_share: '1.710000', ...over }
}

describe('buildEventMarkers', () => {
  it('snaps each dated event to the NEAREST weekly bar, riding the value line', () => {
    const points = buildEventMarkers(
      history(), // dates 07-27 / 08-03 / 08-10
      [txn({ id: 1, type: 'buy', txn_date: '2026-08-04' })], // 1 day to 08-03, 6 to 08-10
      [],
      TICKERS,
    )
    expect(points).toEqual([
      {
        value: ['Aug 3, 2026', 710000.5],
        symbol: 'triangle',
        symbolRotate: 0,
        events: [{ text: 'Buy NVDA — 10 sh · Aug 4, 2026' }],
      },
    ])
  })

  it('rotates a sell 180° and circles a dividend, each with its TRUE date in the text', () => {
    const points = buildEventMarkers(
      history(),
      [txn({ id: 1, type: 'sell', txn_date: '2026-07-28', shares: '3' })], // -> bar 0
      [div({ id: 9, pay_date: '2026-08-09' })], // 1 day to 08-10 vs 6 to 08-03 -> bar 2
      TICKERS,
    )
    expect(points).toHaveLength(2)
    expect(points[0]).toEqual({
      value: ['Jul 27, 2026', 700000],
      symbol: 'triangle',
      symbolRotate: 180,
      events: [{ text: 'Sell NVDA — 3 sh · Jul 28, 2026' }],
    })
    expect(points[1]).toEqual({
      value: ['Aug 10, 2026', 718422.07],
      symbol: 'circle',
      symbolRotate: 0,
      events: [{ text: 'Dividend VOO — $12.00 · Aug 9, 2026' }],
    })
  })

  it('clusters same-bar events into ONE marker; a mixed cluster wears the diamond', () => {
    const points = buildEventMarkers(
      history(),
      [txn({ id: 1, type: 'buy', txn_date: '2026-08-04' })],
      [div({ id: 9, pay_date: '2026-08-05' })], // 2 days to 08-03, 5 to 08-10 -> same bar
      TICKERS,
    )
    expect(points).toHaveLength(1)
    expect(points[0].symbol).toBe('diamond') // no single kind may over-claim the cluster
    expect(points[0].events).toEqual([
      { text: 'Buy NVDA — 10 sh · Aug 4, 2026' },
      { text: 'Dividend VOO — $12.00 · Aug 5, 2026' },
    ])
  })

  it('circles a provider ex-dividend event with a trimmed per-share text, never a total', () => {
    const points = buildEventMarkers(
      history(),
      [],
      [],
      TICKERS,
      // 1.710000 -> $1.71/sh, 0.104500 -> $0.1045/sh: display-trimmed, never re-scaled.
      [exdiv(), exdiv({ security_id: 1, ex_date: '2026-07-28', per_share: '0.104500' })],
    )
    expect(points).toEqual([
      {
        value: ['Jul 27, 2026', 700000],
        symbol: 'circle',
        symbolRotate: 0,
        events: [{ text: 'Ex-dividend NVDA — $0.1045/sh · Jul 28, 2026' }],
      },
      {
        value: ['Aug 10, 2026', 718422.07], // 08-09 is 1 day to 08-10 vs 6 to 08-03
        symbol: 'circle',
        symbolRotate: 0,
        events: [{ text: 'Ex-dividend VOO — $1.71/sh · Aug 9, 2026' }],
      },
    ])
  })

  it('suppresses an annotation within 14 days of a MANUAL row for the same security', () => {
    // Manual rows never carry an ex_date (the create/update schemas have no such field),
    // so the exact-key dedupe can't see them — the ±14-day window mirrors the ingest's
    // own manual-overlap rule instead. Different security or >14 days: annotation stays.
    const points = buildEventMarkers(
      history(),
      [],
      [div({ id: 9, pay_date: '2026-08-05' })], // manual (source default), security 2
      TICKERS,
      [
        exdiv({ ex_date: '2026-08-09' }), // security 2, 4 days from the manual row: OUT
        exdiv({ security_id: 1, ex_date: '2026-08-09', per_share: '0.010000' }), // kept
      ],
    )
    const texts = points.flatMap((p) => p.events.map((e) => e.text))
    expect(texts).toEqual([
      'Dividend VOO — $12.00 · Aug 5, 2026',
      'Ex-dividend NVDA — $0.01/sh · Aug 9, 2026',
    ])
    const farAway = buildEventMarkers(
      history(),
      [],
      [div({ id: 9, pay_date: '2026-07-25' })], // 15 days before the ex-date: kept
      TICKERS,
      [exdiv({ ex_date: '2026-08-09' })],
    )
    expect(farAway.flatMap((p) => p.events.map((e) => e.text))).toContain(
      'Ex-dividend VOO — $1.71/sh · Aug 9, 2026',
    )
  })

  it('drops an ex-dividend event the ledger already carries for that security and ex-date', () => {
    const points = buildEventMarkers(
      history(),
      [],
      [div({ id: 9, pay_date: '2026-08-09', ex_date: '2026-08-09', source: 'auto' })],
      TICKERS,
      [exdiv({ ex_date: '2026-08-09' })], // same security 2, same ex_date -> ledger wins
    )
    expect(points).toHaveLength(1)
    expect(points[0].events).toEqual([{ text: 'Dividend VOO — $12.00 · Aug 9, 2026' }])
  })

  it('skips dateless transactions, splits, and events off the axis ends', () => {
    expect(
      buildEventMarkers(
        history(),
        [
          txn({ id: 1, type: 'buy' }), // txn_date null: imported, nothing to snap to
          txn({ id: 2, type: 'split', txn_date: '2026-08-04', split_factor: '10' }),
          txn({ id: 3, type: 'buy', txn_date: '2026-07-01' }), // before the first bar
        ],
        [div({ id: 9, pay_date: '2026-08-20' })], // after the last bar
        TICKERS,
      ),
    ).toEqual([])
    expect(buildEventMarkers({ ...history(), dates: [], market_value: [] }, [], [], TICKERS))
      .toEqual([])
  })
})

// --- performance events: the line and the rug (2026-09-23 spec §C8) ------------------

describe('buildPerformanceEvents (2026-09-23 spec §C8)', () => {
  const HELD = new Set([2]) // VOO is held today; NVDA (1) is not

  it('keeps dated buys and sells on the value line, one list per kind', () => {
    const events = buildPerformanceEvents(
      history(),
      [
        txn({ id: 1, type: 'buy', txn_date: '2026-08-04' }),
        txn({ id: 2, type: 'sell', txn_date: '2026-07-28', shares: '3' }),
      ],
      [],
      TICKERS,
      [],
      HELD,
    )
    expect(events.buys).toEqual([
      {
        value: ['Aug 3, 2026', 710000.5],
        symbol: 'triangle',
        symbolRotate: 0,
        events: [{ text: 'Buy NVDA — 10 sh · Aug 4, 2026' }],
      },
    ])
    expect(events.sells).toEqual([
      {
        value: ['Jul 27, 2026', 700000],
        symbol: 'triangle',
        symbolRotate: 180,
        events: [{ text: 'Sell NVDA — 3 sh · Jul 28, 2026' }],
      },
    ])
    expect(events.dividends).toEqual([])
    expect(events.exDividends).toEqual([])
  })

  it('moves ledger dividends and ex-dividend notices to the floor, one tick per bar per kind', () => {
    const events = buildPerformanceEvents(
      history(),
      [],
      [div({ id: 9, pay_date: '2026-08-09', ex_date: '2026-08-09', source: 'auto' })],
      TICKERS,
      [exdiv({ ex_date: '2026-07-28' }), exdiv({ ex_date: '2026-07-29', per_share: '0.500000' })],
      HELD,
    )
    expect(events.dividends).toEqual([
      { value: ['Aug 10, 2026', 0], events: [{ text: 'Dividend VOO — $12.00 · Aug 9, 2026' }] },
    ])
    // Two notices in one week are ONE tick that lists both, by date.
    expect(events.exDividends).toEqual([
      {
        value: ['Jul 27, 2026', 0],
        events: [
          { text: 'Ex-dividend VOO — $1.71/sh · Jul 28, 2026' },
          { text: 'Ex-dividend VOO — $0.5/sh · Jul 29, 2026' },
        ],
      },
    ])
    expect(events.buys).toEqual([])
  })

  it('keeps an ex-dividend notice only for a security held on its ex-date or held today', () => {
    // The provider lists every security the book ever named — watch-list tickers included.
    const notices = [
      exdiv({ security_id: 1, ex_date: '2026-07-28' }),
      exdiv({ security_id: 1, ex_date: '2026-08-09' }),
    ]
    const texts = (events: ReturnType<typeof buildPerformanceEvents>) =>
      events.exDividends.flatMap((point) => point.events.map((e) => e.text))
    // NVDA never held: both notices go.
    expect(texts(buildPerformanceEvents(history(), [], [], TICKERS, notices, HELD))).toEqual([])
    // Held today: both stay, whatever the ledger says.
    expect(texts(buildPerformanceEvents(history(), [], [], TICKERS, notices, new Set([1])))).toHaveLength(2)
    // Bought Aug 1 (and sold since, so not held today): only the notice AFTER the buy.
    expect(
      texts(buildPerformanceEvents(history(), [txn({ id: 1, type: 'buy', txn_date: '2026-08-01' })], [], TICKERS, notices, HELD)),
    ).toEqual(['Ex-dividend NVDA — $1.71/sh · Aug 9, 2026'])
    // An imported (undated) opening lot sold out on Aug 5: held before, not after.
    expect(
      texts(
        buildPerformanceEvents(
          history(),
          [txn({ id: 1, type: 'buy' }), txn({ id: 2, type: 'sell', txn_date: '2026-08-05' })],
          [],
          TICKERS,
          notices,
          HELD,
        ),
      ),
    ).toEqual(['Ex-dividend NVDA — $1.71/sh · Jul 28, 2026'])
    // A 2-for-1 split doubles what is held; a sell of the old count leaves half still held.
    expect(
      texts(
        buildPerformanceEvents(
          history(),
          [
            txn({ id: 1, type: 'buy' }),
            txn({ id: 2, type: 'split', txn_date: '2026-07-20', split_factor: '2' }),
            txn({ id: 3, type: 'sell', txn_date: '2026-08-05' }),
          ],
          [],
          TICKERS,
          notices,
          HELD,
        ),
      ),
    ).toHaveLength(2)
  })

  it('leaves the ledger winning a collision, exactly as the markers always did', () => {
    // Same security and ex-date as a ledger row: the notice is the ledger's, drawn once.
    const events = buildPerformanceEvents(
      history(),
      [],
      [div({ id: 9, pay_date: '2026-08-09', ex_date: '2026-08-09', source: 'auto' })],
      TICKERS,
      [exdiv({ ex_date: '2026-08-09' })],
      HELD,
    )
    expect(events.exDividends).toEqual([])
    expect(events.dividends).toHaveLength(1)
  })

  it('returns no events on an empty history', () => {
    expect(
      buildPerformanceEvents({ ...history(), dates: [], market_value: [] }, [], [div({ id: 9, pay_date: '2026-08-09' })], TICKERS, [], HELD),
    ).toEqual(NO_EVENTS)
  })
})
