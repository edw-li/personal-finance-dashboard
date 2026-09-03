import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LEGACY_LOT_PARAM,
  WHATIF_PARAM,
  formatEntry,
  formatEspp,
  formatOverride,
  formatRetire,
  formatSale,
  isWireDecimal,
  lastWins,
  legacyLotId,
  legacyTicker,
  parseEntry,
  parseEspp,
  parseKnob,
  parseOverride,
  parseRetire,
  parseSale,
  readEntries,
  toWireDecimal,
  withEntries,
} from './scenarioUrl'

const fixture = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../backend/tests/fixtures/sandbox_entries.json'), 'utf8'),
) as { cases: { page: string; entries: string[]; url: string }[] }

describe('parseEntry / formatEntry', () => {
  it('splits on the first colon and keeps empty fields', () => {
    expect(parseEntry('sale:7:40::S')).toEqual({ key: 'sale', fields: ['7', '40', '', 'S'] })
    expect(parseEntry('trad_401k_pct:0.15')).toEqual({ key: 'trad_401k_pct', fields: ['0.15'] })
    expect(formatEntry('sale', '7', '40', '', 'S')).toBe('sale:7:40::S')
  })

  it('returns null for a value with no colon (a legacy ticker) or an empty key', () => {
    expect(parseEntry('NVDA')).toBeNull()
    expect(parseEntry(':7')).toBeNull()
    expect(parseEntry('')).toBeNull()
  })
})

describe('wire tokens', () => {
  it('accepts canonical decimals only', () => {
    for (const ok of ['0', '0.15', '250', '250.00', '-0.5', '23500']) expect(isWireDecimal(ok)).toBe(true)
    for (const bad of ['', '.', '5.', '.5', '+5', '1e3', '$5', '1,000', ' 5']) expect(isWireDecimal(bad)).toBe(false)
  })

  // The three spellings canonicalAmount hands back VERBATIM. Unnormalized, "+15" reaches
  // decimal.ts, whose PLAIN pattern has no "+", and THROWS inside the box's own range check.
  it('normalizes the tolerant spellings a box can produce, and refuses the rest', () => {
    expect(toWireDecimal('+15')).toBe('15')
    expect(toWireDecimal('200000.')).toBe('200000')
    expect(toWireDecimal('+0.15')).toBe('0.15')
    expect(toWireDecimal('.5')).toBe('0.5')
    expect(toWireDecimal('-.5')).toBe('-0.5')
    expect(toWireDecimal('+.5')).toBe('0.5')
    expect(toWireDecimal(' 250.00 ')).toBe('250.00')
    // Already canonical: verbatim, so canonicalizing a server figure is a no-op.
    for (const ok of ['0', '0.15', '-0.5', '23500']) expect(toWireDecimal(ok)).toBe(ok)
    for (const bad of ['', '.', '+', '-', '1e3', '$5', '1,000', 'abc', '1.2.3', '5-']) {
      expect(toWireDecimal(bad)).toBeNull()
    }
  })
})

describe('sale / espp / retire / override / knob round trips', () => {
  it('sale: id and shares, optional price, S for short, long omitted', () => {
    expect(parseSale(['7', '40'])).toEqual({ security_id: 7, shares: '40', term: 'long' })
    expect(parseSale(['9', '10', '62.50', 'S'])).toEqual({ security_id: 9, shares: '10', price: '62.50', term: 'short' })
    expect(parseSale(['11', '5', '', 'S'])).toEqual({ security_id: 11, shares: '5', term: 'short' })
    expect(parseSale(['11', '5', '', 'L'])).toEqual({ security_id: 11, shares: '5', term: 'long' })
    for (const sale of [
      { security_id: 7, shares: '40', term: 'long' as const },
      { security_id: 9, shares: '10', price: '62.50', term: 'short' as const },
      { security_id: 11, shares: '5', term: 'short' as const },
    ]) {
      const text = formatSale(sale)
      expect(parseSale(parseEntry(text)!.fields)).toEqual(sale)
    }
    expect(formatSale({ security_id: 11, shares: '5', term: 'short' })).toBe('sale:11:5::S')
    expect(formatSale({ security_id: 7, shares: '40', term: 'long' })).toBe('sale:7:40')
  })

  it('sale: garbage is null — bad id, zero shares, bad price, unknown term', () => {
    expect(parseSale(['0', '40'])).toBeNull()
    expect(parseSale(['7', '0'])).toBeNull()
    expect(parseSale(['7', '-1'])).toBeNull()
    expect(parseSale(['7', '40', 'abc'])).toBeNull()
    expect(parseSale(['7', '40', '62.50', 'X'])).toBeNull()
    expect(parseSale(['7'])).toBeNull()
  })

  it('espp: lot id and optional price', () => {
    expect(parseEspp(['3'])).toEqual({ lot_id: 3 })
    expect(parseEspp(['4', '150.0000'])).toEqual({ lot_id: 4, sale_price: '150.0000' })
    expect(parseEspp(['x'])).toBeNull()
    expect(parseEspp(['4', '-1'])).toBeNull()
    expect(formatEspp({ lot_id: 4, sale_price: '150.0000' })).toBe('espp:4:150.0000')
    expect(formatEspp({ lot_id: 3 })).toBe('espp:3')
  })

  it('retire: person id and YYYY-MM', () => {
    expect(parseRetire(['2', '2035-06'])).toEqual({ person_id: 2, month: '2035-06' })
    expect(parseRetire(['2', '2035-13'])).toBeNull()
    expect(parseRetire(['2', '2035-06-01'])).toBeNull()
    expect(formatRetire({ person_id: 2, month: '2035-06' })).toBe('retire:2:2035-06')
  })

  it('override: <key>:<decimal|null> in the input-definition vocabulary', () => {
    expect(parseOverride(parseEntry('trad_401k_contributions:23500')!)).toEqual({
      key: 'trad_401k_contributions',
      value: '23500',
    })
    expect(parseOverride(parseEntry('qualified_dividends:null')!)).toEqual({
      key: 'qualified_dividends',
      value: null,
    })
    expect(parseOverride(parseEntry('qualified_dividends:abc')!)).toBeNull()
    expect(parseOverride(parseEntry('qualified_dividends:1:2')!)).toBeNull()
    expect(formatOverride('qualified_dividends', null)).toBe('qualified_dividends:null')
    expect(formatOverride('trad_401k_contributions', '23500')).toBe('trad_401k_contributions:23500')
  })

  it('knob: an allow-listed key with an accepted value', () => {
    const keys = ['trad_401k_pct', 'hsa_coverage'] as const
    const accept = (key: string, value: string) =>
      key === 'hsa_coverage' ? ['none', 'self', 'family'].includes(value) : isWireDecimal(value)
    expect(parseKnob(parseEntry('trad_401k_pct:0.15')!, keys, accept)).toEqual({ key: 'trad_401k_pct', value: '0.15' })
    expect(parseKnob(parseEntry('hsa_coverage:family')!, keys, accept)).toEqual({ key: 'hsa_coverage', value: 'family' })
    expect(parseKnob(parseEntry('hsa_coverage:spouse')!, keys, accept)).toBeNull()
    expect(parseKnob(parseEntry('bonus_pct:0.1')!, keys, accept)).toBeNull()
    expect(parseKnob(parseEntry('trad_401k_pct:0.1:0.2')!, keys, accept)).toBeNull()
  })
})

describe('URL helpers', () => {
  it('reads every whatif value, rewrites only the whatif family (plus asked-for keys), and never touches other params', () => {
    const params = new URLSearchParams('year=2026&whatif=sale%3A7%3A40&owner=2&whatif=espp%3A3&whatif-lot=9')
    expect(readEntries(params)).toEqual(['sale:7:40', 'espp:3'])
    const next = withEntries(params, ['trad_401k_contributions:23500'], [LEGACY_LOT_PARAM])
    expect(next.toString()).toBe('year=2026&owner=2&whatif=trad_401k_contributions%3A23500')
    expect(params.toString()).toBe('year=2026&whatif=sale%3A7%3A40&owner=2&whatif=espp%3A3&whatif-lot=9') // input untouched
    expect(withEntries(params, []).getAll(WHATIF_PARAM)).toEqual([])
  })

  it('recognizes the legacy aliases: a colon-less whatif value is a ticker, whatif-lot an integer', () => {
    expect(legacyTicker(new URLSearchParams('whatif=NVDA'))).toBe('NVDA')
    expect(legacyTicker(new URLSearchParams('whatif=BRK.B%2BX'))).toBe('BRK.B+X')
    expect(legacyTicker(new URLSearchParams('whatif=sale%3A7%3A40'))).toBeNull()
    expect(legacyTicker(new URLSearchParams('whatif='))).toBeNull()
    expect(legacyLotId(new URLSearchParams('whatif-lot=4'))).toBe(4)
    expect(legacyLotId(new URLSearchParams('whatif-lot=0'))).toBeNull()
    expect(legacyLotId(new URLSearchParams('whatif-lot=abc'))).toBeNull()
    expect(legacyLotId(new URLSearchParams(''))).toBeNull()
  })

  it('lastWins keeps the LAST entry per identity, in first-seen order', () => {
    const entries = ['a:1', 'b:2', 'a:3'].map((e) => parseEntry(e)!)
    expect(lastWins(entries, (e) => e.key).map((e) => formatEntry(e.key, ...e.fields))).toEqual(['a:3', 'b:2'])
  })
})

describe('parity fixture', () => {
  it('builds every fixture URL byte for byte from its entries, and every entry parses', () => {
    for (const c of fixture.cases) {
      const qs = withEntries(new URLSearchParams(), c.entries).toString()
      expect(`/${c.page}${qs === '' ? '' : `?${qs}`}`).toBe(c.url)
      for (const entry of c.entries) expect(parseEntry(entry)).not.toBeNull()
    }
  })
})
