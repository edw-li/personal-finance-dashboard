import { describe, expect, it } from 'vitest'
import type { CoverageOut } from '../../types/api'
import { freshnessClauses, spendingGaps } from './freshness'

// Production's own shape on 2026-09-04 (spec §0): balances through September, spending
// entered through July, August never entered, September saved as nineteen rows of $0.00.
function coverageOut(over: Partial<CoverageOut> = {}): CoverageOut {
  return {
    balances: ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'],
    spending: ['2026-06-01', '2026-07-01'],
    net_pay: ['2026-06-01', '2026-07-01'],
    spending_empty: ['2026-09-01'],
    spending_missing: ['2026-08-01'],
    net_pay_missing: ['2026-08-01', '2026-09-01'],
    latest: { balances: '2026-09-01', spending: '2026-07-01', net_pay: '2026-07-01' },
    ...over,
  }
}

const texts = (coverage: CoverageOut): string[] =>
  freshnessClauses(coverage).map((clause) => clause.text)
const amber = (coverage: CoverageOut): string[] =>
  freshnessClauses(coverage)
    .filter((clause) => clause.lagging)
    .map((clause) => clause.key)

describe('freshnessClauses — the footer sentence', () => {
  it('names each feed month and what the window is still waiting for', () => {
    expect(texts(coverageOut())).toEqual([
      'Balances through Sep 2026',
      'Spending through Jul 2026 (Aug missing, Sep empty)',
      'Net pay through Jul 2026',
    ])
  })

  it('ambers exactly the feeds a month or more behind the balances', () => {
    expect(amber(coverageOut())).toEqual(['spending', 'net_pay'])
  })

  it('ambers a feed exactly ONE month behind — the spec’s threshold, not two', () => {
    // The default fixture lags by two, so it cannot tell ≥ 1 from ≥ 2 apart; this one can.
    const oneBehind = coverageOut({
      spending: ['2026-06-01', '2026-07-01', '2026-08-01'],
      net_pay: ['2026-06-01', '2026-07-01', '2026-08-01'],
      spending_empty: [],
      spending_missing: [],
      net_pay_missing: ['2026-09-01'],
      latest: { balances: '2026-09-01', spending: '2026-08-01', net_pay: '2026-08-01' },
    })
    expect(amber(oneBehind)).toEqual(['spending', 'net_pay'])
  })

  it('stays quiet when every feed stands on the same month', () => {
    const level = coverageOut({
      spending: ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'],
      net_pay: ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'],
      spending_empty: [],
      spending_missing: [],
      net_pay_missing: [],
      latest: { balances: '2026-09-01', spending: '2026-09-01', net_pay: '2026-09-01' },
    })
    expect(texts(level)).toEqual([
      'Balances through Sep 2026',
      'Spending through Sep 2026',
      'Net pay through Sep 2026',
    ])
    expect(amber(level)).toEqual([])
  })

  it('says a feed never started rather than calling a fresh database late', () => {
    const fresh = coverageOut({
      balances: [],
      spending: [],
      net_pay: [],
      spending_empty: [],
      spending_missing: [],
      net_pay_missing: [],
      latest: { balances: null, spending: null, net_pay: null },
    })
    expect(texts(fresh)).toEqual([
      'Balances — no months',
      'Spending — no months',
      'Net pay — no months',
    ])
    expect(amber(fresh)).toEqual([])
  })

  it('reads the ascending arrays when the server is older than `latest`', () => {
    const older: CoverageOut = {
      balances: ['2026-08-01', '2026-09-01'],
      spending: ['2026-07-01'],
      net_pay: ['2026-07-01'],
    }
    expect(texts(older)).toEqual([
      'Balances through Sep 2026',
      'Spending through Jul 2026',
      'Net pay through Jul 2026',
    ])
    expect(amber(older)).toEqual(['spending', 'net_pay'])
  })
})

describe('spendingGaps — only what comes AFTER the last entered month', () => {
  it('labels missing and empty months in calendar order', () => {
    expect(spendingGaps(coverageOut())).toBe('Aug missing, Sep empty')
  })

  it('ignores an older hole — that is the strip and the Health card job', () => {
    expect(spendingGaps(coverageOut({ spending_missing: ['2026-03-01', '2026-08-01'] }))).toBe(
      'Aug missing, Sep empty',
    )
  })

  it('carries the year on a gap outside the clause own year', () => {
    const turn = coverageOut({
      balances: ['2025-12-01', '2026-01-01'],
      spending: ['2025-12-01'],
      spending_empty: [],
      spending_missing: ['2026-01-01'],
      latest: { balances: '2026-01-01', spending: '2025-12-01', net_pay: '2025-12-01' },
    })
    expect(spendingGaps(turn)).toBe('Jan 2026 missing')
  })

  it('folds past three named months', () => {
    const many = coverageOut({
      spending: ['2026-01-01'],
      spending_missing: ['2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01'],
      spending_empty: ['2026-09-01'],
      latest: { balances: '2026-09-01', spending: '2026-01-01', net_pay: '2026-07-01' },
    })
    expect(spendingGaps(many)).toBe('Feb missing, Mar missing, Apr missing, +2 more')
  })

  it('drops an empty month the balances window never reached', () => {
    // The server does NOT window `spending_empty` (services/coverage.py): a month saved as
    // all $0.00 after the last snapshot is still on file, but it was never part of the book,
    // so the footer must not report the window as waiting for it.
    const beyond = coverageOut({
      balances: ['2026-06-01', '2026-07-01', '2026-08-01'],
      spending_empty: ['2026-09-01', '2026-10-01'],
      spending_missing: ['2026-08-01'],
      latest: { balances: '2026-08-01', spending: '2026-07-01', net_pay: '2026-07-01' },
    })
    expect(spendingGaps(beyond)).toBe('Aug missing')
  })

  it('is empty on a fully entered window', () => {
    expect(spendingGaps(coverageOut({ spending_empty: [], spending_missing: [] }))).toBe('')
  })
})
