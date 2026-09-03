import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { HoldingOut, LimitsOut, TaxBracketsOut, TaxInputsOut, TaxSummaryOut, WhatIfDelta } from '../../types/api'
import {
  COMPARE_ROWS,
  decodeTax,
  deltaValue,
  encodeTax,
  isEmptyTax,
  labelForTax,
  summaryValue,
  taxPresets,
  toWhatIfBody,
} from './taxScenario'

const fixture = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../backend/tests/fixtures/sandbox_entries.json'), 'utf8'),
) as { cases: { page: string; entries: string[] }[] }

function holding(id: number, ticker: string, shares: string, price: string | null, avgCost: string | null = '50.0000'): HoldingOut {
  return {
    security_id: id, ticker, name: ticker, industry: null, holding_type: 'etf', is_manual_priced: false, shares,
    avg_cost: avgCost, cost_basis: '5000.00', price, quoted_at: null, price_source: null, day_change_pct: null,
    day_change_amount: null, market_value: null, weight_pct: null, unrealized_gl: null, unrealized_gl_pct: null,
    realized_gl: '0.00', dividends_collected: '0.00', annual_dividend: null, annual_income: null, yield_pct: null,
    yoc_pct: null, xirr_pct: null, accounts: ['Taxable'], warnings: [],
  }
}

const income = { agi: '1.00', taxable_income: '2.00', tax: '3.00', effective_rate: '0.100000' }
const wage = { w2_income: '4.00', taxable_wages: '5.00', tax: '6.00', effective_rate: null }
const summary: TaxSummaryOut = {
  year: 2024,
  federal: { ...income, tax: '36764.79' },
  state: { ...income, tax: '14506.12' },
  medicare: { ...wage, tax: '3634.95' },
  social_security: { ...wage, tax: '10453.20' },
  disability: { ...wage, tax: '1950.00' },
  capital_gains: { taxable_income: '182176.20', gains_amount: '1989.28', tax: '26.87', effective_rate: null },
  niit: { taxable_income: '0.00', gains_amount: '1989.28', tax: '75.59', effective_rate: null },
  totals: { gross_income: '1.00', total_income: '2.00', total_tax: '72824.61', take_home: '150000.00', effective_rate: '0.246914' },
  warnings: [],
}
const delta: WhatIfDelta = {
  total_tax: '-5488.69', take_home: '5488.69', federal_tax: '-3000.00', state_tax: '-2413.10', medicare_tax: '0.00',
  social_security_tax: '0.00', disability_tax: '0.00', capital_gains_tax: '0.00', effective_rate: '-0.018600', niit_tax: '-75.59',
}

describe('tax scenario codec', () => {
  it('round-trips sales · ESPP · overrides in canonical order and accepts the parity fixture unchanged', () => {
    const taxes = fixture.cases.find((c) => c.page === 'taxes' && c.entries.length > 0)!
    const scenario = decodeTax(taxes.entries)
    expect(scenario.sales).toEqual([
      { security_id: 7, shares: '40', term: 'long' },
      { security_id: 9, shares: '10', price: '62.50', term: 'short' },
      { security_id: 11, shares: '5', term: 'short' },
    ])
    expect(scenario.espp).toEqual([{ lot_id: 3 }, { lot_id: 4, sale_price: '150.0000' }])
    expect(scenario.overrides).toEqual({ qualified_dividends: null, trad_401k_contributions: '23500' })
    expect(encodeTax(scenario)).toEqual(taxes.entries)
  })

  it('drops garbage and legacy tickers, keeps the last leg per security / lot / key', () => {
    expect(
      decodeTax(['NVDA', 'sale:x:1', 'sale:7:40', 'sale:7:50', 'espp:3', 'espp:3:99', 'bad key:1', 'ltcg_total:abc', 'ltcg_total:1', 'ltcg_total:2']),
    ).toEqual({
      sales: [{ security_id: 7, shares: '50', term: 'long' }],
      espp: [{ lot_id: 3, sale_price: '99' }],
      overrides: { ltcg_total: '2' },
    })
    expect(isEmptyTax({ sales: [], espp: [], overrides: {} })).toBe(true)
    expect(isEmptyTax({ sales: [], espp: [], overrides: { x: null } })).toBe(false)
  })

  it('copies the scenario into the what-if body, omitting overrides when there are none', () => {
    const body = toWhatIfBody(2024, decodeTax(['sale:7:40::S', 'espp:3']))
    expect(body).toEqual({ year: 2024, sales: [{ security_id: 7, shares: '40', term: 'short' }], espp_sales: [{ lot_id: 3 }] })
    expect('overrides' in body).toBe(false)
    expect('price' in body.sales[0]).toBe(false)
    expect(toWhatIfBody(2024, decodeTax(['annual_salary:210000', 'interest_total:null'])).overrides).toEqual({
      annual_salary: '210000',
      interest_total: null,
    })
  })

  it('labels a pin by its first two legs, naming tickers when it can', () => {
    const tickers = { 7: 'VTI' }
    expect(labelForTax(decodeTax(['sale:7:40', 'espp:3', 'ltcg_total:1']), (id) => tickers[id as 7] ?? null)).toBe('Sell 40 VTI · ESPP lot 3')
    expect(labelForTax(decodeTax(['trad_401k_contributions:23500']), () => null)).toBe('trad_401k_contributions 23500')
  })

  it('maps the ten compare rows onto the summaries and the delta, NIIT included', () => {
    expect(COMPARE_ROWS.map((r) => r.key)).toEqual([
      'federal', 'state', 'niit', 'medicare', 'social_security', 'disability', 'capital_gains', 'total_tax', 'take_home', 'effective_rate',
    ])
    expect(summaryValue(summary, 'niit')).toBe('75.59')
    expect(summaryValue(summary, 'take_home')).toBe('150000.00')
    expect(summaryValue(summary, 'effective_rate')).toBe('0.246914')
    expect(summaryValue({ ...summary, niit: undefined }, 'niit')).toBeNull()
    expect(deltaValue(delta, 'niit')).toBe('-75.59')
    expect(deltaValue({ ...delta, niit_tax: undefined }, 'niit')).toBeNull()
    expect(deltaValue(delta, 'state')).toBe('-2413.10')
    expect(COMPARE_ROWS.find((r) => r.key === 'take_home')?.invert).toBeUndefined()
    expect(COMPARE_ROWS.find((r) => r.key === 'total_tax')?.invert).toBe(true)
  })

  describe('presets', () => {
    const limits: LimitsOut = {
      year: 2024,
      items: [
        { key: 'limit_401k_elective', label: '401(k) elective deferral', value: '23500.00' },
        { key: 'limit_hsa_self', label: 'HSA — self-only', value: '4300.00' },
        { key: 'limit_hsa_family', label: 'HSA — family', value: null },
      ],
    }
    const inputs: TaxInputsOut = {
      year: 2024,
      filing_status: 'married_joint',
      people: [{ id: 1, name: 'Me' }, { id: 2, name: 'Partner' }],
      sections: [
        {
          section: 'deductions',
          items: [
            { key: 'hsa_contributions_employer', label: 'HSA Contributions (Employer)', sort_order: 30, is_derived: false, is_per_person: true, person_id: 1, value: '1000.00', suggested: null },
            { key: 'hsa_contributions_employer', label: 'HSA Contributions (Employer)', sort_order: 30, is_derived: false, is_per_person: true, person_id: 2, value: '500.50', suggested: null },
          ],
        },
      ],
    }
    const brackets: TaxBracketsOut = {
      year: 2024,
      filing_status: 'single',
      statuses_with_rows: ['single'],
      jurisdictions: {
        capital_gains: [
          { bracket_index: 1, rate: '0.0000', threshold: '0.00' },
          { bracket_index: 2, rate: '0.1500', threshold: '47025.00' },
          { bracket_index: 3, rate: '0.2000', threshold: '518900.00' },
        ],
      },
    }
    const holdings = [holding(7, 'VTI', '100.0000', '62.50'), holding(9, 'QQQ', '10.0000', null), holding(11, 'BND', '50.0000', '40.00', '45.0000')]
    const lowSummary: TaxSummaryOut = { ...summary, capital_gains: { taxable_income: '30000.00', gains_amount: '2000.00', tax: '0.00', effective_rate: null } }

    it('builds every family and sizes them from data on the page', () => {
      const apply = vi.fn()
      const presets = taxPresets({ year: 2024, limits, inputs, holdings, brackets, summary: lowSummary }, apply)
      expect(presets.map((p) => p.id)).toEqual(['max401k', 'maxhsa-self', 'maxhsa-family', 'sell-7', 'sell-9', 'sell-11', 'realize15'])
      presets[0].apply()
      expect(apply).toHaveBeenLastCalledWith({ overrides: { trad_401k_contributions: '23500.00' } })
      presets[1].apply()
      // 4300 − (1000 + 500.50), exact — trailing zeros trimmed, which is decimal.ts's canonical spelling.
      expect(apply).toHaveBeenLastCalledWith({ overrides: { hsa_contributions: '2799.5' } })
      expect(presets[2].disabled).toBe(true)
      expect(presets[2].title).toBe("Enter 2024's HSA family limit in Settings › Limits")
      presets[3].apply()
      expect(apply).toHaveBeenLastCalledWith({ sale: { security_id: 7, shares: '100.0000', term: 'long' } })
      expect(presets[4].disabled).toBe(true)
      expect(presets[4].title).toBe('No quote for QQQ — enter a price in Portfolio')
      // Headroom to the 15 % floor: 47025 − (30000 + 2000) = 15025; VTI gains 12.50/share → 1202 shares, capped at the 100 held.
      presets[6].apply()
      expect(apply).toHaveBeenLastCalledWith({ sale: { security_id: 7, shares: '100.0000', term: 'long' } })
    })

    it('sizes the 15 % leg below the position when the headroom is small, and disables it without headroom, a table or a gainer', () => {
      const apply = vi.fn()
      const tight: TaxSummaryOut = { ...summary, capital_gains: { taxable_income: '46000.00', gains_amount: '900.00', tax: '0.00', effective_rate: null } }
      taxPresets({ year: 2024, limits, inputs, holdings, brackets, summary: tight }, apply).at(-1)!.apply()
      expect(apply).toHaveBeenLastCalledWith({ sale: { security_id: 7, shares: '10.0000', term: 'long' } }) // 125 / 12.50
      const none = taxPresets({ year: 2024, limits, inputs, holdings, brackets, summary }, apply).at(-1)!
      expect(none.disabled).toBe(true)
      expect(none.title).toBe('No 0% capital-gains headroom left in 2024')
      const noTable = taxPresets({ year: 2024, limits, inputs, holdings, brackets: { ...brackets, jurisdictions: {} }, summary: lowSummary }, apply).at(-1)!
      expect(noTable.title).toBe("Enter 2024's capital-gains brackets first")
      const noGainer = taxPresets({ year: 2024, limits, inputs, holdings: [holdings[2]], brackets, summary: lowSummary }, apply).at(-1)!
      expect(noGainer.title).toBe('No held position with an unrealized gain to realize')
    })

    it('disables what the page has not loaded yet, in the SAME words as a missing value', () => {
      const presets = taxPresets({ year: 2024, limits: null, inputs: null, holdings: null, brackets: null, summary: null }, vi.fn())
      expect(presets.map((p) => p.id)).toEqual(['max401k', 'maxhsa-self', 'maxhsa-family', 'realize15'])
      // No "loading" register on the chips: the panel renders this row only once its three
      // feeds have landed together, so a null payload here can only mean the value is
      // missing — and while they ARE in flight the card says so above the chips.
      expect(presets[0].title).toBe("Enter 2024's 401(k) limit in Settings › Limits")
      expect(presets[1].title).toBe("Enter 2024's HSA self limit in Settings › Limits")
      expect(presets[3].title).toBe("Enter 2024's capital-gains brackets first")
      const noLimit = taxPresets({ year: 2024, limits: { year: 2024, items: [] }, inputs, holdings, brackets, summary }, vi.fn())
      expect(noLimit[0].title).toBe("Enter 2024's 401(k) limit in Settings › Limits")
    })

    it('caps Sell all at six chips', () => {
      const many = Array.from({ length: 8 }, (_, i) => holding(20 + i, `T${i}`, '1', '10'))
      const presets = taxPresets({ year: 2024, limits, inputs, holdings: many, brackets, summary }, vi.fn())
      expect(presets.filter((p) => p.id.startsWith('sell-'))).toHaveLength(6)
    })
  })
})
