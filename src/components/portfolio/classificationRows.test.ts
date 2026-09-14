import { describe, expect, it } from 'vitest'
import type { SecurityClassification } from '../../api/allocation'
import { coverageSentence, defaultClassificationFilter, emptyFilterSentence, filterClassificationRows } from './classificationRows'

const row = (over: Partial<SecurityClassification>): SecurityClassification => ({
  security_id: 1, ticker: 'VOO', name: 'Vanguard S&P 500 ETF', holding_type: 'etf', asset_class: null, industry: null,
  geography: null, source: 'Existing security records', note: null, reviewed_at: null, industry_available: false, ...over,
})
const fund = row({ security_id: 2, ticker: 'VFFSX', name: 'Vanguard 500 Index' })
const stock = row({ security_id: 3, ticker: 'NVDA', name: 'NVIDIA', holding_type: 'stock', asset_class: 'equity', geography: 'us',
  industry: 'Semis', reviewed_at: '2026-09-01T00:00:00Z', industry_available: true })
const seenFund = row({ security_id: 4, ticker: 'BND', name: 'Total Bond', asset_class: null, reviewed_at: '2026-08-01T00:00:00Z' })

describe('coverageSentence', () => {
  it('counts the gap and the unreviewed separately', () => {
    expect(coverageSentence([fund, stock, seenFund])).toBe('2 of 3 securities have no asset class · 1 not yet reviewed')
    expect(coverageSentence([fund, stock])).toBe('1 of 2 securities has no asset class · 1 not yet reviewed')
  })
  it('says the work is done when it is', () => {
    expect(coverageSentence([stock])).toBe('The security has an asset class · all reviewed')
    expect(coverageSentence([stock, { ...stock, security_id: 9, ticker: 'AMD' }])).toBe('All 2 securities have an asset class · all reviewed')
    expect(coverageSentence([])).toBe('No securities yet — they appear here once transactions are recorded.')
  })
})

describe('filters', () => {
  it('opens on Unclassified only while there is something to classify', () => {
    expect(defaultClassificationFilter([fund, stock])).toBe('unclassified')
    expect(defaultClassificationFilter([stock])).toBe('all')
    expect(defaultClassificationFilter([])).toBe('all')
  })
  it('chips and search compose', () => {
    expect(filterClassificationRows([fund, stock, seenFund], 'unclassified', '').map((r) => r.ticker)).toEqual(['VFFSX', 'BND'])
    expect(filterClassificationRows([fund, stock, seenFund], 'unreviewed', '').map((r) => r.ticker)).toEqual(['VFFSX'])
    expect(filterClassificationRows([fund, stock, seenFund], 'all', 'nvid').map((r) => r.ticker)).toEqual(['NVDA'])
    expect(filterClassificationRows([fund, stock, seenFund], 'unclassified', 'bond').map((r) => r.ticker)).toEqual(['BND'])
  })
  it('names why a filtered table is empty', () => {
    expect(emptyFilterSentence('unclassified', '')).toBe('All securities have an asset class.')
    expect(emptyFilterSentence('unreviewed', '')).toBe('Every security has been reviewed.')
    expect(emptyFilterSentence('all', 'zzz')).toBe('No securities match “zzz”.')
  })
})
