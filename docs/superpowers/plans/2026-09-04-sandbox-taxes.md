# Sandbox lane T — Taxes what-if 2.0 (`WhatIfPanel` on `useSandbox`, compare, presets, pins, aliases, Apply) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the shipped tax what-if card on the sandbox grammar per `docs/superpowers/specs/2026-09-03-planning-sandboxes-design.md` §10: legs and overrides live in the URL (`whatif=sale:…`, `espp:…`, `<input_key>:<decimal|null>`), the Run button is retired in favour of a live 400 ms preview, a ten-row side-by-side (federal, state, NIIT, Medicare, Social Security, disability, capital gains, total tax, take-home, effective rate) with server deltas, four preset families (Max 401(k), Max HSA self/family, Sell all {ticker}, Realize gains to the 15 % ceiling), up to three pins re-run on the year switch, the legacy `?whatif=TICKER` / `?whatif-lot=` links normalized into the new entries, the Portfolio and ESPP drill-ins emitting the new form, and an Apply for overrides only that confirms before → after and PUTs through the page's existing inputs client, remounting the form.

**Architecture:** `taxScenario.ts` is the pure codec + row map + presets: `decodeTax`/`encodeTax` over lane G's typed parsers (canonical order: sales · ESPP · overrides sorted by key — the parity fixture's order), `toWhatIfBody` as a straight copy into `WhatIfBody`, `summaryValue`/`deltaValue` mapping the ten compare rows onto `TaxSummaryOut`/`WhatIfDelta` (NIIT from `niit_tax`, lane B), and `taxPresets` reading data already on the page (limits, inputs, holdings, the CG table, the summary). `WhatIfPanel` keeps its leg forms and visible strings and swaps only the state-and-run layer: `useSandbox` (`baselineOf: (r) => r`, `debounceMs: 400`, `enabled: open`) owns the scenario; text boxes hold a control-local draft while focused (AmountInput's own posture) and commit valid text to `set()` — debounced on keystrokes, immediate on blur/Enter, add/remove/select/term; invalid text raises the panel's existing sentence and withholds the request. Legacy aliases are captured at mount, resolved in the feeds' promise callback and written as entries in one `replace` that also drops `whatif-lot`. Apply is the PAGE's: the panel hands `(overrides, changed_inputs)` up; `TaxesPage` confirms and calls `putTaxInputs`, then the same `onVestApplied` landing chain the withholding card uses.

**Tech Stack:** React 19, react-router 7, TypeScript, vitest + Testing Library; lane G's `src/sandbox/*`; lane B's `niit_tax`; optionally the chart grammar's `ChartCard`/`itemTooltip`/`divergingVisualMap` (Task 7, conditional).

**Worktree / commands:** Branch `sandbox-taxes`, worktree `.worktrees/sandbox-taxes`, `cmd /c mklink /J node_modules ..\..\node_modules`. `npx vitest run <file>`, `npx tsc -b`, `npx eslint src/components/taxes src/pages/TaxesPage.tsx src/components/portfolio/HoldingDetailPanel.tsx src/pages/EsppPage.tsx`. Any backend test this lane needs runs on `FINANCE_TEST_DB=finance_test_sandbox_t` (none is planned).

**Prerequisites on main:** lanes G and B merged; shell Plan 3 Task 5 (Taxes through `PageFrame`, year detail through `Feed`) merged. Verify: `ls src/sandbox/useSandbox.ts && grep -n "niit_tax" src/types/api.ts && grep -n "<Feed" src/pages/TaxesPage.tsx`.

**Shared-file hotspots:** `src/pages/TaxesPage.tsx` + `.test.tsx` (this lane only); `src/components/taxes/WhatIfPanel.tsx` + `.test.tsx` (this lane only — lane G's conformance walk reads the panel: import nothing named `api` from the client, spell no mutating `method:`; `putTaxInputs` is called from the PAGE, never the panel); `src/components/portfolio/HoldingDetailPanel.tsx` + test and `src/pages/EsppPage.tsx` + test (one `Link` each — no other lane edits them; the chart lanes C4/C5 may touch these pages later, so keep the edit to the one line). `src/components/taxes/taxChartOptions.ts` (Task 7 only).

**Overnight rule:** no file deletions. `initialTicker`/`initialLotId` props are removed from the panel's signature (an edit); nothing on disk is deleted.

---

## File structure

| File | Responsibility |
|---|---|
| `src/components/taxes/taxScenario.ts` (new) | `TaxScenario`, `decodeTax`/`encodeTax`/`isEmptyTax`, `toWhatIfBody`, `labelForTax`, `COMPARE_ROWS`, `summaryValue`/`deltaValue`, `taxPresets` |
| `src/components/taxes/taxScenario.test.ts` (new) | round trips (incl. the parity fixture's taxes case), last-wins, body copy, row maps incl. NIIT, presets (values, disabled titles, the 15 % sizing) |
| `src/components/taxes/WhatIfPanel.tsx` (modify) | rewired onto `useSandbox`; drafts; aliases; compare; presets; pins; Apply slot |
| `src/components/taxes/WhatIfPanel.test.tsx` (modify) | the `describe` block re-pointed from Run to live; aliases → entries; compare incl. NIIT; Apply hands up |
| `src/pages/TaxesPage.tsx` (modify) | new panel props; `applyOverrides` (confirm → `putTaxInputs` → `onVestApplied`); drop the alias reads |
| `src/pages/TaxesPage.test.tsx` (modify) | panel mock props; Apply confirms, PUTs once, remounts the form |
| `src/components/portfolio/HoldingDetailPanel.tsx` + `.test.tsx` (modify) | "Model selling … in Taxes →" emits `whatif=sale:<id>:<shares>` |
| `src/pages/EsppPage.tsx` + `.test.tsx` (modify) | "Model sale →" emits `whatif=espp:<lot id>` |
| `src/components/taxes/taxChartOptions.ts` + test (modify, conditional) | `whatIfDeltaBarOption` — the per-jurisdiction Δ bar through the chart grammar |

---

### Task 1: `taxScenario.ts` — codec, row maps, presets

**Files:**
- Create: `src/components/taxes/taxScenario.ts`
- Test: `src/components/taxes/taxScenario.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/taxes/taxScenario.test.ts
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
      expect(apply).toHaveBeenLastCalledWith({ overrides: { hsa_contributions: '2799.50' } }) // 4300 − (1000 + 500.50), exact
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

    it('disables what the page has not loaded yet, in words', () => {
      const presets = taxPresets({ year: 2024, limits: null, inputs: null, holdings: null, brackets: null, summary: null }, vi.fn())
      expect(presets.map((p) => p.id)).toEqual(['max401k', 'maxhsa-self', 'maxhsa-family', 'realize15'])
      expect(presets[0].title).toBe("Loading 2024's limits…")
      expect(presets[1].title).toBe("Loading 2024's limits…")
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/taxes/taxScenario.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// src/components/taxes/taxScenario.ts
// The tax sandbox's codec, compare-row map and presets (2026-09-03 planning-sandboxes spec
// §10). Pure — no React, no fetching. Legs and overrides are the SERVER'S wire vocabulary
// (SaleLegIn / EsppSaleIn / the PUT-inputs key map), so decode → request body is a copy.
import type { CompareRow } from '../../sandbox/CompareTable'
import { compareDecimals, subtractDecimals } from '../../sandbox/decimal'
import type { Preset } from '../../sandbox/PresetRow'
import {
  formatEspp,
  formatOverride,
  formatSale,
  lastWins,
  parseEntry,
  parseEspp,
  parseOverride,
  parseSale,
  type EsppEntry,
  type SaleEntry,
} from '../../sandbox/scenarioUrl'
import type { WhatIfBody } from '../../api/whatif'
import type {
  EsppSaleIn,
  HoldingOut,
  LimitsOut,
  SaleLegIn,
  TaxBracketsOut,
  TaxInputsOut,
  TaxSummaryOut,
  WhatIfDelta,
} from '../../types/api'
import { toBrackets } from './marginal'

export interface TaxScenario {
  sales: SaleEntry[]
  espp: EsppEntry[]
  overrides: Record<string, string | null>
}

export const EMPTY_TAX_SCENARIO: TaxScenario = { sales: [], espp: [], overrides: {} }

// An input-definition key's shape (backend/app/tax_keys.py); the YEAR decides whether the key
// exists, and an unknown one earns the server's own 422 sentence rather than a silent drop.
const INPUT_KEY = /^[a-z][a-z0-9_]*$/

export function decodeTax(entries: string[]): TaxScenario {
  const sales: SaleEntry[] = []
  const espp: EsppEntry[] = []
  const overrides: { key: string; value: string | null }[] = []
  for (const raw of entries) {
    const entry = parseEntry(raw)
    if (entry === null) continue // a legacy ticker, resolved by the panel against the feed
    if (entry.key === 'sale') {
      const sale = parseSale(entry.fields)
      if (sale !== null) sales.push(sale)
    } else if (entry.key === 'espp') {
      const lot = parseEspp(entry.fields)
      if (lot !== null) espp.push(lot)
    } else if (INPUT_KEY.test(entry.key)) {
      const override = parseOverride(entry)
      if (override !== null) overrides.push(override)
    }
  }
  const scenario: TaxScenario = {
    sales: lastWins(sales, (s) => String(s.security_id)),
    espp: lastWins(espp, (e) => String(e.lot_id)),
    overrides: {},
  }
  for (const o of lastWins(overrides, (o) => o.key).sort((a, b) => a.key.localeCompare(b.key))) {
    scenario.overrides[o.key] = o.value
  }
  return scenario
}

/** Canonical order — sales · ESPP · overrides by key — the parity fixture's own. */
export function encodeTax(scenario: TaxScenario): string[] {
  return [
    ...scenario.sales.map(formatSale),
    ...scenario.espp.map(formatEspp),
    ...Object.keys(scenario.overrides)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => formatOverride(key, scenario.overrides[key])),
  ]
}

export function isEmptyTax(scenario: TaxScenario): boolean {
  return scenario.sales.length === 0 && scenario.espp.length === 0 && Object.keys(scenario.overrides).length === 0
}

/** A straight copy into WhatIfIn's shape. `overrides` is OMITTED with no rows so the
 *  pre-override wire stays byte-identical (the exact-body pins depend on it). */
export function toWhatIfBody(year: number, scenario: TaxScenario): WhatIfBody {
  const sales: SaleLegIn[] = scenario.sales.map((s) => ({
    security_id: s.security_id,
    shares: s.shares,
    term: s.term,
    ...(s.price === undefined ? {} : { price: s.price }),
  }))
  const espp_sales: EsppSaleIn[] = scenario.espp.map((e) => ({
    lot_id: e.lot_id,
    ...(e.sale_price === undefined ? {} : { sale_price: e.sale_price }),
  }))
  const keys = Object.keys(scenario.overrides)
  return { year, sales, espp_sales, ...(keys.length === 0 ? {} : { overrides: { ...scenario.overrides } }) }
}

/** "Sell 40 VTI · ESPP lot 3" — the first two legs (spec §8.5). */
export function labelForTax(scenario: TaxScenario, tickerOf: (securityId: number) => string | null): string {
  const parts: string[] = []
  for (const s of scenario.sales) parts.push(`Sell ${s.shares} ${tickerOf(s.security_id) ?? `#${s.security_id}`}`)
  for (const e of scenario.espp) parts.push(`ESPP lot ${e.lot_id}`)
  for (const [key, value] of Object.entries(scenario.overrides)) parts.push(`${key} ${value ?? 'cleared'}`)
  return parts.slice(0, 2).join(' · ')
}

// ── Compare rows ────────────────────────────────────────────────────────────────────────

/** Every tax line is a COST (a rise reads red); take-home is the one gain; the rate is a level. */
export const COMPARE_ROWS: CompareRow[] = [
  { key: 'federal', label: 'Federal', kind: 'money', invert: true },
  { key: 'state', label: 'State', kind: 'money', invert: true },
  { key: 'niit', label: 'NIIT', kind: 'money', invert: true },
  { key: 'medicare', label: 'Medicare', kind: 'money', invert: true },
  { key: 'social_security', label: 'Social Security', kind: 'money', invert: true },
  { key: 'disability', label: 'Disability', kind: 'money', invert: true },
  { key: 'capital_gains', label: 'Capital gains', kind: 'money', invert: true },
  { key: 'total_tax', label: 'Total tax', kind: 'money', invert: true },
  { key: 'take_home', label: 'Take-home', kind: 'money' },
  { key: 'effective_rate', label: 'Effective rate', kind: 'percent', invert: true },
]

export function summaryValue(summary: TaxSummaryOut, key: string): string | null {
  switch (key) {
    case 'federal':
      return summary.federal.tax
    case 'state':
      return summary.state.tax
    case 'niit':
      return summary.niit?.tax ?? null
    case 'medicare':
      return summary.medicare.tax
    case 'social_security':
      return summary.social_security.tax
    case 'disability':
      return summary.disability.tax
    case 'capital_gains':
      return summary.capital_gains.tax
    case 'total_tax':
      return summary.totals.total_tax
    case 'take_home':
      return summary.totals.take_home
    case 'effective_rate':
      return summary.totals.effective_rate
    default:
      return null
  }
}

export function deltaValue(delta: WhatIfDelta, key: string): string | null {
  switch (key) {
    case 'federal':
      return delta.federal_tax
    case 'state':
      return delta.state_tax
    case 'niit':
      return delta.niit_tax ?? null
    case 'medicare':
      return delta.medicare_tax
    case 'social_security':
      return delta.social_security_tax
    case 'disability':
      return delta.disability_tax
    case 'capital_gains':
      return delta.capital_gains_tax
    case 'total_tax':
      return delta.total_tax
    case 'take_home':
      return delta.take_home
    case 'effective_rate':
      return delta.effective_rate
    default:
      return null
  }
}

// ── Presets ─────────────────────────────────────────────────────────────────────────────

export interface TaxPresetContext {
  year: number
  /** null while the panel's lazy feed is in flight. */
  limits: LimitsOut | null
  inputs: TaxInputsOut | null
  holdings: HoldingOut[] | null
  brackets: TaxBracketsOut | null
  summary: TaxSummaryOut | null
}

/** What a preset asks the panel to do: merge overrides, or add/replace one sale leg. */
export type TaxPresetPatch = { overrides: Record<string, string | null> } | { sale: SaleEntry }

const MAX_SELL_CHIPS = 6
const LIMITS_HINT = 'in Settings › Limits'

function addDecimals(a: string, b: string): string {
  // Exact: a + b = a − (−b), with the sign flipped by hand — decimal.ts owns the arithmetic.
  return subtractDecimals(a, b.startsWith('-') ? b.slice(1) : `-${b}`)
}

function limitValue(limits: LimitsOut | null, key: string): string | null {
  return limits?.items.find((item) => item.key === key)?.value ?? null
}

/** The household's stored value of a key: per-person keys appear once per column, and an
 *  override addresses the HOUSEHOLD key map (the endpoint sums before it applies). Exact
 *  string addition — an input we are about to construct, never a displayed figure. */
function householdValue(inputs: TaxInputsOut | null, key: string): string {
  let total = '0'
  for (const section of inputs?.sections ?? [])
    for (const item of section.items) if (item.key === key && item.value !== null) total = addDecimals(total, item.value)
  return total
}

export function taxPresets(ctx: TaxPresetContext, apply: (patch: TaxPresetPatch) => void): Preset[] {
  const loading = ctx.limits === null
  const elective = limitValue(ctx.limits, 'limit_401k_elective')
  const employerHsa = householdValue(ctx.inputs, 'hsa_contributions_employer')
  const presets: Preset[] = [
    {
      id: 'max401k',
      label: 'Max 401(k)',
      disabled: elective === null,
      title: loading
        ? `Loading ${ctx.year}'s limits…`
        : elective === null
          ? `Enter ${ctx.year}'s 401(k) limit ${LIMITS_HINT}`
          : undefined,
      apply: () => {
        if (elective !== null) apply({ overrides: { trad_401k_contributions: elective } })
      },
    },
  ]
  for (const tier of ['self', 'family'] as const) {
    const limit = limitValue(ctx.limits, `limit_hsa_${tier}`)
    presets.push({
      id: `maxhsa-${tier}`,
      label: `Max HSA — ${tier}`,
      disabled: limit === null,
      title: loading
        ? `Loading ${ctx.year}'s limits…`
        : limit === null
          ? `Enter ${ctx.year}'s HSA ${tier} limit ${LIMITS_HINT}`
          : undefined,
      apply: () => {
        if (limit !== null) apply({ overrides: { hsa_contributions: subtractDecimals(limit, employerHsa) } })
      },
    })
  }
  for (const h of (ctx.holdings ?? []).slice(0, MAX_SELL_CHIPS)) {
    presets.push({
      id: `sell-${h.security_id}`,
      label: `Sell all ${h.ticker}`,
      disabled: h.price === null,
      title: h.price === null ? `No quote for ${h.ticker} — enter a price in Portfolio` : undefined,
      apply: () => apply({ sale: { security_id: h.security_id, shares: h.shares, term: 'long' } }),
    })
  }
  presets.push(realizeToFifteen(ctx, apply))
  return presets
}

/** A long-term leg sized so `ltcg_total` lands on the 0 %/15 % threshold: headroom is read
 *  from data already on the page (the CG table's first non-zero floor minus the ordinary
 *  income the gains stack on minus the gains already there), then divided by the first
 *  priced holding's per-share gain. Float here is INPUT sizing to four decimal places — the
 *  server prices the leg exactly and its figures are the ones shown. */
function realizeToFifteen(ctx: TaxPresetContext, apply: (patch: TaxPresetPatch) => void): Preset {
  const table = ctx.brackets?.jurisdictions.capital_gains
  const disabled = (title: string): Preset => ({ id: 'realize15', label: 'Realize gains to the 15% ceiling', disabled: true, title, apply: () => {} })
  if (table === undefined || table.length < 2 || ctx.summary === null) return disabled(`Enter ${ctx.year}'s capital-gains brackets first`)
  const floor15 = toBrackets(table).find((b) => b.rate > 0)?.floor
  if (floor15 === undefined) return disabled(`Enter ${ctx.year}'s capital-gains brackets first`)
  const stackTop = Number(ctx.summary.capital_gains.taxable_income) + Number(ctx.summary.capital_gains.gains_amount)
  const headroom = floor15 - stackTop
  if (headroom <= 0) return disabled(`No 0% capital-gains headroom left in ${ctx.year}`)
  const gainer = (ctx.holdings ?? []).find(
    (h) => h.price !== null && h.avg_cost !== null && compareDecimals(h.price, h.avg_cost) > 0,
  )
  if (gainer === undefined) return disabled('No held position with an unrealized gain to realize')
  const perShare = Number(gainer.price) - Number(gainer.avg_cost as string)
  const wanted = Math.floor((headroom / perShare) * 1e4) / 1e4
  const shares = wanted >= Number(gainer.shares) ? gainer.shares : wanted.toFixed(4)
  return {
    id: 'realize15',
    label: 'Realize gains to the 15% ceiling',
    apply: () => apply({ sale: { security_id: gainer.security_id, shares, term: 'long' } }),
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/taxes/taxScenario.test.ts`
Expected: PASS (10 tests). The fixture case round-trips byte for byte because lane G wrote it in this codec's canonical order (sales · ESPP · overrides sorted by key — `qualified_dividends` before `trad_401k_contributions`). If it does not, the codec drifted from the fixture: fix `encodeTax`, never the fixture (lane A's parity test reads the same file).

- [ ] **Step 5: Commit**

```bash
git add src/components/taxes/taxScenario.ts src/components/taxes/taxScenario.test.ts
git commit -m "feat(taxes): sandbox codec (sales/ESPP/overrides), compare-row map with NIIT, presets sized from page data"
```

---

### Task 2: `WhatIfPanel` on `useSandbox` — the new test file

**Files:**
- Modify: `src/components/taxes/WhatIfPanel.test.tsx` (keep lines 1–220's fixtures and helpers; replace the `describe('WhatIfPanel', …)` block; add the mocks and helpers below)

- [ ] **Step 1: Write the failing tests**

Add after the existing `vi.mock` lines:

```tsx
vi.mock('../../api/limits', () => ({ fetchLimits: vi.fn() }))
import { fetchLimits } from '../../api/limits'
const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() }
vi.mock('../ToastProvider', () => ({ useToast: () => toast }))
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { LimitsOut } from '../../types/api'
```

Replace `openButton` and `runButton` and the `openPanel` helper with:

```tsx
// Anchored: "Open what-if" / "Close what-if" — the Run button is gone (spec §10: live).
const openButton = () => screen.getByRole('button', { name: /^(Open|Close) what-if$/ }) as HTMLButtonElement
const addSale = () => screen.getByRole('button', { name: 'Add sale' }) as HTMLButtonElement
const addEsppSale = () => screen.getByRole('button', { name: 'Add ESPP sale' }) as HTMLButtonElement
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement

function Url() {
  const l = useLocation()
  return <span data-testid="url">{l.pathname + l.search}</span>
}
const url = () => screen.getByTestId('url').textContent

function limitsFixture(): LimitsOut {
  return {
    year: 2024,
    items: [
      { key: 'limit_401k_elective', label: '401(k) elective deferral', value: '23500.00' },
      { key: 'limit_415c_total', label: '415(c) total additions', value: null },
      { key: 'limit_hsa_self', label: 'HSA — self-only', value: '4300.00' },
      { key: 'limit_hsa_family', label: 'HSA — family', value: null },
      { key: 'limit_espp_423', label: 'ESPP §423 annual', value: '25000.00' },
    ],
  }
}

function mount(entry = '/taxes', props: Partial<Parameters<typeof WhatIfPanel>[0]> = {}) {
  const onApplyOverrides = vi.fn()
  const view = render(
    <MemoryRouter initialEntries={[entry]}>
      <WhatIfPanel year={2024} onApplyOverrides={onApplyOverrides} {...props} />
      <Url />
    </MemoryRouter>,
  )
  return { ...view, onApplyOverrides }
}

async function openPanel() {
  fireEvent.click(openButton())
  await waitFor(() => expect(addSale()).toBeTruthy())
}

// The last body runWhatIf was asked for.
const lastBody = () => vi.mocked(runWhatIf).mock.calls.at(-1)?.[0]
```

Add `vi.mocked(fetchLimits).mockResolvedValue(limitsFixture())` to `beforeEach`, and `localStorage.clear()`.

Then the new `describe` block:

```tsx
describe('WhatIfPanel', () => {
  it('mounts CLOSED and spends no request until it is opened', () => {
    mount()
    expect(openButton().textContent).toBe('Open what-if')
    expect(openButton().getAttribute('aria-expanded')).toBe('false')
    expect(vi.mocked(fetchHoldings)).not.toHaveBeenCalled()
    expect(vi.mocked(fetchLots)).not.toHaveBeenCalled()
    expect(vi.mocked(fetchLimits)).not.toHaveBeenCalled()
    expect(vi.mocked(runWhatIf)).not.toHaveBeenCalled()
  })

  it('loads the three feeds on first open (once across a close/reopen) and runs the empty scenario for the baseline', async () => {
    mount()
    await openPanel()
    expect(vi.mocked(fetchHoldings)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchLots)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchLimits)).toHaveBeenCalledWith(2024)
    await waitFor(() => expect(vi.mocked(runWhatIf)).toHaveBeenCalledWith({ year: 2024, sales: [], espp_sales: [] }))
    fireEvent.click(openButton())
    fireEvent.click(openButton())
    await waitFor(() => expect(addSale()).toBeTruthy())
    expect(vi.mocked(fetchHoldings)).toHaveBeenCalledTimes(1)
  })

  it('Add sale prefills the first held security at its quote, writes the URL and runs at once; the second row moves on', async () => {
    mount()
    await openPanel()
    fireEvent.click(addSale())
    expect(url()).toBe('/taxes?whatif=sale%3A7%3A100.0000%3A62.50')
    await waitFor(() =>
      expect(lastBody()).toEqual({ year: 2024, sales: [{ security_id: 7, shares: '100.0000', price: '62.50', term: 'long' }], espp_sales: [] }),
    )
    expect((screen.getByLabelText('Sell') as HTMLSelectElement).value).toBe('7')
    expect(field('Sale 1 shares').value).toBe('100.0000')
    fireEvent.click(addSale())
    // QQQ is unpriced: no price field, the omit case.
    expect(url()).toBe('/taxes?whatif=sale%3A7%3A100.0000%3A62.50&whatif=sale%3A9%3A10.0000')
    expect(addSale().disabled).toBe(true)
  })

  it('typing shares debounces (400 ms) and a blank price is OMITTED; blur commits immediately', async () => {
    vi.useFakeTimers()
    try {
      mount('/taxes?whatif=sale%3A7%3A100.0000%3A62.50')
      await act(async () => {})
      fireEvent.change(field('Sale 1 shares'), { target: { value: '40' } })
      expect(url()).toBe('/taxes?whatif=sale%3A7%3A100.0000%3A62.50')
      await act(async () => { vi.advanceTimersByTime(400) })
      expect(url()).toBe('/taxes?whatif=sale%3A7%3A40%3A62.50')
      fireEvent.change(field('Sale 1 price'), { target: { value: '' } })
      fireEvent.blur(field('Sale 1 price'))
      expect(url()).toBe('/taxes?whatif=sale%3A7%3A40')
      await act(async () => {})
      const body = lastBody()!
      expect(body.sales).toEqual([{ security_id: 7, shares: '40', term: 'long' }])
      expect('price' in body.sales[0]).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a term click is immediate and spells S in the URL', async () => {
    mount('/taxes?whatif=sale%3A7%3A40')
    await waitFor(() => expect(screen.getByRole('group', { name: 'Sale 1 term' })).toBeTruthy())
    fireEvent.click(within(screen.getByRole('group', { name: 'Sale 1 term' })).getByRole('button', { name: 'Short' }))
    expect(url()).toBe('/taxes?whatif=sale%3A7%3A40%3A%3AS')
    await waitFor(() => expect(lastBody()?.sales[0].term).toBe('short'))
  })

  it('refuses an oversell / zero / bad price in the box’s words, spending no request and leaving the URL alone', async () => {
    mount('/taxes?whatif=sale%3A7%3A40')
    await waitFor(() => expect(vi.mocked(runWhatIf)).toHaveBeenCalledTimes(1))
    fireEvent.change(field('Sale 1 shares'), { target: { value: '200' } })
    fireEvent.blur(field('Sale 1 shares'))
    expect(screen.getByRole('alert').textContent).toContain('selling 200 VTI — only 100.0000 held')
    expect(url()).toBe('/taxes?whatif=sale%3A7%3A40')
    fireEvent.change(field('Sale 1 shares'), { target: { value: '0' } })
    fireEvent.blur(field('Sale 1 shares'))
    expect(screen.getByRole('alert').textContent).toContain('VTI: shares must be a number greater than 0')
    fireEvent.change(field('Sale 1 price'), { target: { value: '-5' } })
    fireEvent.blur(field('Sale 1 price'))
    expect(screen.getByRole('alert').textContent).toContain('VTI: price must be a number greater than 0, or blank')
    expect(vi.mocked(runWhatIf)).toHaveBeenCalledTimes(1)
  })

  it('prefills an ESPP leg from the first unsold lot at the lots quote and runs', async () => {
    mount()
    await openPanel()
    fireEvent.click(addEsppSale())
    expect(url()).toBe('/taxes?whatif=espp%3A3%3A150.00000')
    const select = screen.getByLabelText('ESPP lot') as HTMLSelectElement
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Feb 28, 2026 — 30 sh'])
    await waitFor(() => expect(lastBody()).toEqual({ year: 2024, sales: [], espp_sales: [{ lot_id: 3, sale_price: '150.00000' }] }))
  })

  it('renders the two Δ tiles, the ten compare rows (NIIT from niit_tax) and the changed inputs as they arrived', async () => {
    vi.mocked(runWhatIf).mockResolvedValue(
      resultFixture({
        baseline: { ...summaryFixture(2024, '376543.22', '0.246914'), niit: { taxable_income: '0.00', gains_amount: '1989.28', tax: '75.59', effective_rate: null } },
        scenario: { ...summaryFixture(2024, '372222.22', '0.281234'), niit: { taxable_income: '0.00', gains_amount: '1989.28', tax: '0.00', effective_rate: null } },
        delta: { ...resultFixture().delta, niit_tax: '-75.59' },
      }),
    )
    mount('/taxes?whatif=sale%3A7%3A100.0000%3A62.50')
    await screen.findByText('Δ total tax')
    expect(tile('Δ total tax').querySelector('.stat-value')?.textContent).toBe('$4,321.00')
    expect(tile('Δ total tax').querySelector('.stat-delta')?.className).toContain('stat-delta-negative')
    expect(tile('Effective rate').querySelector('.stat-value')?.textContent).toBe('24.7% → 28.1%')
    const niit = screen.getByText('NIIT').closest('tr') as HTMLElement
    expect(within(niit).getAllByRole('cell').map((c) => c.textContent)).toEqual(['NIIT', '$75.59', '$0.00', '-$75.59'])
    expect(within(niit).getByText('-$75.59').className).toContain('delta-chip-positive') // less NIIT reads green
    const takeHome = screen.getByText('Take-home').closest('tr') as HTMLElement
    expect(within(takeHome).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Take-home', '$376,543.22', '$372,222.22', '-$4,321.00'])
    expect(screen.getByText('LTCG: Brokerage Gain/Loss — $12,000.00 → $30,500.00')).toBeTruthy()
    expect(screen.getByText('$1,250.00')).toBeTruthy()
  })

  it('an absent NIIT block prints the em dash', async () => {
    mount('/taxes?whatif=sale%3A7%3A100.0000%3A62.50')
    const niit = (await screen.findByText('NIIT')).closest('tr') as HTMLElement
    expect(within(niit).getAllByRole('cell').map((c) => c.textContent)).toEqual(['NIIT', '—', '—', '—'])
  })

  it('keeps the last result under the stale line when a run fails, in the server’s words', async () => {
    mount('/taxes?whatif=sale%3A7%3A100.0000%3A62.50')
    await screen.findByText('Δ total tax')
    vi.mocked(runWhatIf).mockRejectedValueOnce(new ApiError('unknown input key: nope', 422))
    fireEvent.click(within(screen.getByRole('group', { name: 'Sale 1 term' })).getByRole('button', { name: 'Short' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('unknown input key: nope — this scenario may be showing earlier data.')
    expect(screen.getByText('Δ total tax')).toBeTruthy()
  })

  it('renders scenario warnings in the advisory register, never as an error', async () => {
    vi.mocked(runWhatIf).mockResolvedValue(resultFixture({ warnings: ['VTI: acquisition dates unknown — treated as long-term'] }))
    mount('/taxes?whatif=sale%3A7%3A100.0000%3A62.50')
    const warning = await screen.findByText('VTI: acquisition dates unknown — treated as long-term')
    expect(warning.closest('.tax-warnings')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('lets only the NEWEST of two overlapping runs land', async () => {
    const slow = deferred<WhatIfOut>()
    const fast = deferred<WhatIfOut>()
    mount()
    await openPanel()
    await waitFor(() => expect(vi.mocked(runWhatIf)).toHaveBeenCalledTimes(1))
    vi.mocked(runWhatIf).mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)
    fireEvent.click(addSale())
    fireEvent.click(addEsppSale())
    await act(async () => { fast.resolve(resultFixture({ delta: { ...resultFixture().delta, total_tax: '2222.22' } })) })
    expect(tile('Δ total tax').querySelector('.stat-value')?.textContent).toBe('$2,222.22')
    await act(async () => { slow.resolve(resultFixture({ delta: { ...resultFixture().delta, total_tax: '1111.11' } })) })
    expect(tile('Δ total tax').querySelector('.stat-value')?.textContent).toBe('$2,222.22')
  })

  it('surfaces a feed failure without pretending the book is empty, and retries it', async () => {
    vi.mocked(fetchHoldings).mockRejectedValueOnce(new ApiError('Network error', 0))
    mount()
    fireEvent.click(openButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Network error')
    expect(screen.queryByRole('button', { name: 'Add sale' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(addSale()).toBeTruthy())
    expect(vi.mocked(fetchHoldings)).toHaveBeenCalledTimes(2)
  })

  it('re-runs the URL’s scenario against the new year when the page remounts it', async () => {
    const { rerender } = mount('/taxes?whatif=sale%3A7%3A40')
    await waitFor(() => expect(lastBody()?.year).toBe(2024))
    rerender(
      <MemoryRouter initialEntries={['/taxes?whatif=sale%3A7%3A40']}>
        <WhatIfPanel key="whatif-2025" year={2025} />
        <Url />
      </MemoryRouter>,
    )
    await waitFor(() => expect(lastBody()).toEqual({ year: 2025, sales: [{ security_id: 7, shares: '40', term: 'long' }], espp_sales: [] }))
    expect(screen.getByRole('heading', { name: /What if — 2025/ })).toBeTruthy()
  })

  // --- legacy aliases (spec §6) -----------------------------------------------------------

  it('normalizes ?whatif=TICKER into a sale entry once the holdings land, in one replace', async () => {
    mount('/taxes?whatif=qqq&year=2024')
    expect(openButton().getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => expect(url()).toBe('/taxes?year=2024&whatif=sale%3A9%3A10.0000'))
    await waitFor(() => expect(lastBody()?.sales).toEqual([{ security_id: 9, shares: '10.0000', term: 'long' }]))
    expect(vi.mocked(fetchHoldings)).toHaveBeenCalledTimes(1)
  })

  it('normalizes ?whatif-lot=<id> into an espp entry at the lots quote, and drops a sold lot silently', async () => {
    mount('/taxes?whatif-lot=3')
    await waitFor(() => expect(url()).toBe('/taxes?whatif=espp%3A3%3A150.00000'))
    cleanup()
    vi.mocked(fetchHoldings).mockResolvedValue(holdingsFixture())
    vi.mocked(fetchLots).mockResolvedValue(lotsFixture())
    mount('/taxes?whatif-lot=4')
    await waitFor(() => expect(addEsppSale()).toBeTruthy())
    expect(url()).toBe('/taxes')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // --- input overrides (D1, design 2026-08-31) ---------------------------------------------

  const DEFS = [
    { key: 'annual_salary', label: 'Annual Salary' },
    { key: 'itemized_deduction', label: 'Itemized Deduction' },
  ]
  const addOverride = () => screen.getByRole('button', { name: 'Add override' }) as HTMLButtonElement

  it('adds an override row on the first unused key as a null entry, and posts canonical values on commit', async () => {
    mount('/taxes', { definitions: DEFS })
    await openPanel()
    fireEvent.click(addOverride())
    expect(url()).toBe('/taxes?whatif=annual_salary%3Anull')
    await waitFor(() => expect(lastBody()).toEqual({ year: 2024, sales: [], espp_sales: [], overrides: { annual_salary: null } }))
    const select = screen.getByLabelText('Override') as HTMLSelectElement
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Annual Salary (annual_salary)',
      'Itemized Deduction (itemized_deduction)',
    ])
    fireEvent.focus(field('Override 1 value'))
    fireEvent.change(field('Override 1 value'), { target: { value: '$210,000' } })
    fireEvent.blur(field('Override 1 value'))
    expect(url()).toBe('/taxes?whatif=annual_salary%3A210000')
    await waitFor(() => expect(lastBody()?.overrides).toEqual({ annual_salary: '210000' }))
  })

  it('refuses a duplicated key and a garbled value in the box’s words, spending no request', async () => {
    mount('/taxes?whatif=annual_salary%3Anull&whatif=itemized_deduction%3Anull', { definitions: DEFS })
    await waitFor(() => expect(vi.mocked(runWhatIf)).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getAllByLabelText('Override')[1], { target: { value: 'annual_salary' } })
    expect(screen.getByRole('alert').textContent).toContain('Annual Salary is overridden twice — one row per key')
    fireEvent.focus(field('Override 1 value'))
    fireEvent.change(field('Override 1 value'), { target: { value: '12..3' } })
    fireEvent.blur(field('Override 1 value'))
    expect(screen.getByRole('alert').textContent).toContain('Annual Salary: enter a number, or leave the value blank to clear it')
    expect(vi.mocked(runWhatIf)).toHaveBeenCalledTimes(1)
  })

  it('keeps Add override shut once every key is taken, and with no definitions at all', async () => {
    mount('/taxes', { definitions: DEFS })
    await openPanel()
    fireEvent.click(addOverride())
    fireEvent.click(addOverride())
    expect(addOverride().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Remove override 2' }))
    expect(addOverride().disabled).toBe(false)
    cleanup()
    vi.mocked(fetchHoldings).mockResolvedValue(holdingsFixture())
    vi.mocked(fetchLots).mockResolvedValue(lotsFixture())
    mount()
    await openPanel()
    expect(addOverride().disabled).toBe(true)
  })

  // --- presets, pins, Apply ----------------------------------------------------------------

  it('presets write knobs immediately; missing data disables a chip with its sentence', async () => {
    mount('/taxes', { definitions: DEFS })
    await openPanel()
    await waitFor(() => expect(vi.mocked(fetchLimits)).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('button', { name: 'Max 401(k)' }))
    expect(url()).toBe('/taxes?whatif=trad_401k_contributions%3A23500.00')
    fireEvent.click(screen.getByRole('button', { name: 'Sell all VTI' }))
    expect(url()).toBe('/taxes?whatif=sale%3A7%3A100.0000&whatif=trad_401k_contributions%3A23500.00')
    const qqq = screen.getByRole('button', { name: 'Sell all QQQ' }) as HTMLButtonElement
    expect(qqq.disabled).toBe(true)
    expect(qqq.title).toBe('No quote for QQQ — enter a price in Portfolio')
    const family = screen.getByRole('button', { name: 'Max HSA — family' }) as HTMLButtonElement
    expect(family.disabled).toBe(true)
    expect(family.title).toBe("Enter 2024's HSA family limit in Settings › Limits")
    expect((screen.getByRole('button', { name: 'Realize gains to the 15% ceiling' }) as HTMLButtonElement).title).toBe(
      "Enter 2024's capital-gains brackets first",
    )
  })

  it('pins the live scenario and shows it as a compare column; Reset empties the URL', async () => {
    mount('/taxes?whatif=sale%3A7%3A100.0000%3A62.50')
    await screen.findByText('Δ total tax')
    fireEvent.click(screen.getByRole('button', { name: 'Pin this scenario' }))
    expect(screen.getByRole('button', { name: 'Unpin Sell 100.0000 VTI' })).toBeTruthy()
    await waitFor(() => expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain('Sell 100.0000 VTIUnpin'))
    expect(JSON.parse(localStorage.getItem('finance.sandbox.taxes') ?? '{}').pins[0].entries).toEqual(['sale:7:100.0000:62.50'])
    fireEvent.click(screen.getByRole('button', { name: 'Reset to actual' }))
    expect(url()).toBe('/taxes')
    await waitFor(() => expect(lastBody()).toEqual({ year: 2024, sales: [], espp_sales: [] }))
  })

  it('Apply hands the overrides and the changed inputs up, and renders only with overrides present', async () => {
    const { onApplyOverrides } = mount('/taxes?whatif=sale%3A7%3A40', { definitions: DEFS })
    await screen.findByText('Δ total tax')
    expect(screen.queryByRole('button', { name: /^Apply \d+ override/ })).toBeNull()
    fireEvent.click(addOverride())
    fireEvent.focus(field('Override 1 value'))
    fireEvent.change(field('Override 1 value'), { target: { value: '210000' } })
    fireEvent.blur(field('Override 1 value'))
    await waitFor(() => expect(lastBody()?.overrides).toEqual({ annual_salary: '210000' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Apply 1 override to 2024' }))
    expect(onApplyOverrides).toHaveBeenCalledWith({ annual_salary: '210000' }, resultFixture().changed_inputs)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/taxes/WhatIfPanel.test.tsx`
Expected: FAIL — the panel still takes `initialTicker`/`initialLotId`, renders a Run button and has no URL state.

---

### Task 3: `WhatIfPanel` rewired

**Files:**
- Modify: `src/components/taxes/WhatIfPanel.tsx`

- [ ] **Step 1: Rewrite the panel.** Keep `saleLegFor`/`esppLegFor`'s intent (they now return `SaleEntry`/`EsppEntry`), `inverted`/`directionOf` (import `inverted` from `../../sandbox/DeltaChip` instead of the local copy), `OverrideDefinition`, `MAX_LEGS`, every visible sentence, the legs' markup and the result tables. The full module:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { fetchLots } from '../../api/espp'
import { fetchLimits } from '../../api/limits'
import { fetchHoldings } from '../../api/portfolio'
import { runWhatIf } from '../../api/whatif'
import CompareTable from '../../sandbox/CompareTable'
import { inverted } from '../../sandbox/DeltaChip'
import PresetRow from '../../sandbox/PresetRow'
import SandboxPanel from '../../sandbox/SandboxPanel'
import { legacyLotId, legacyTicker, readEntries, type EsppEntry, type SaleEntry } from '../../sandbox/scenarioUrl'
import { useSandbox, type PinResult, type SandboxSpec } from '../../sandbox/useSandbox'
import type {
  ChangedInput,
  EsppLotOut,
  EsppLotsResponse,
  HoldingOut,
  HoldingsResponse,
  LimitsOut,
  TaxBracketsOut,
  TaxInputsOut,
  TaxSummaryOut,
  WhatIfOut,
} from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency, formatDate, formatPct, formatShares } from '../../utils/format'
import { isPlainDecimal } from '../../utils/percent'
import { toneOf } from '../../utils/tone'
import type { Tone } from '../../utils/tone'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import { FeedBanner } from '../shell/Feed'
import StatTile from '../StatTile'
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
  type TaxPresetPatch,
  type TaxScenario,
} from './taxScenario'
import './taxes.css'

// The API's own ceiling (schemas/taxes.py: WhatIfIn.sales / .espp_sales max_length=20).
const MAX_LEGS = 20
// The endpoint folds the portfolio on every call (spec §10).
const DEBOUNCE_MS = 400

export interface OverrideDefinition {
  key: string
  label: string
}

// The whole position at the latest quote: the common question is "what if I sold this",
// and every figure is the holdings feed's own text, never re-derived. An unpriced holding
// carries NO price, which is the omit case — and the server then 422s by ticker.
function saleLegFor(holding: HoldingOut): SaleEntry {
  return {
    security_id: holding.security_id,
    shares: holding.shares,
    term: 'long',
    ...(holding.price === null ? {} : { price: holding.price }),
  }
}

// The lot's whole share count is implied (the API sells the lot, not a slice of it), so the
// only knob is the price — prefilled from the quote the lots table itself was priced at.
function esppLegFor(lot: EsppLotOut, quote: string | null): EsppEntry {
  return { lot_id: lot.id, ...(quote === null ? {} : { sale_price: quote }) }
}

function directionOf(tone: Tone): 'up' | 'down' | undefined {
  return tone === 'positive' ? 'up' : tone === 'negative' ? 'down' : undefined
}

/**
 * The tax sandbox (2026-09-03 planning-sandboxes spec §10): prospective brokerage sales, ESPP
 * lot sales and input overrides run LIVE against the stored year — baseline vs. scenario vs.
 * delta, compared side by side with up to three pins. The scenario lives in the URL
 * (`whatif=sale:…`, `espp:…`, `<input_key>:…`); the text boxes hold a draft only while
 * focused. NOTHING is stored: the endpoint reads the year's inputs and brackets, runs the
 * engine twice and answers. Apply (overrides only) is the PAGE's write, handed up.
 *
 * Own feeds, own failure surface (SummaryPanel's posture), all three LAZY: the page is
 * already long and these are three GETs for a card the user may never open.
 */
export default function WhatIfPanel({
  year,
  definitions = [],
  inputs = null,
  brackets = null,
  summary = null,
  onApplyOverrides,
}: {
  year: number
  /** The year payload's input definitions (deduped by key, payload order) — the override
   *  rows' key select. Optional so fetch-free mounts need no list; with none, Add override
   *  stays shut. */
  definitions?: OverrideDefinition[]
  /** The year's payloads, for the presets (employer HSA, the CG table, the gains stack). */
  inputs?: TaxInputsOut | null
  brackets?: TaxBracketsOut | null
  summary?: TaxSummaryOut | null
  /** The page's write door: confirm before → after, PUT the inputs, remount the form. Absent
   *  → no Apply slot. */
  onApplyOverrides?: (overrides: Record<string, string | null>, changed: ChangedInput[]) => void
}) {
  const [params] = useSearchParams()
  // The legacy deep links (`?whatif=TICKER`, `?whatif-lot=<id>`), pinned at MOUNT — the hook's
  // arrival normalization drops the colon-less value on its first effect, so it is read here,
  // in the initializer, before that runs. A ticker or lot id only means something against a
  // feed, so the rewrite rides the feeds' promise callback.
  const [legacy] = useState(() => ({ ticker: legacyTicker(params), lotId: legacyLotId(params) }))
  const [open, setOpen] = useState(
    () => readEntries(params).length > 0 || legacy.ticker !== null || legacy.lotId !== null,
  )
  const [holdings, setHoldings] = useState<HoldingsResponse | null>(null)
  const [lots, setLots] = useState<EsppLotsResponse | null>(null)
  const [limits, setLimits] = useState<LimitsOut | null>(null)
  const [feedError, setFeedError] = useState<string | null>(null)
  // The box's own refusal (an oversell, a garbled value): the request is WITHHELD and the URL
  // keeps the last valid scenario, so `stale` stays false (spec §10).
  const [formError, setFormError] = useState<string | null>(null)
  const feedsRef = useRef(false)

  const held = holdings?.holdings ?? []
  const tickerOf = (securityId: number) => held.find((h) => h.security_id === securityId)?.ticker ?? null

  const spec = useMemo<SandboxSpec<TaxScenario, WhatIfOut>>(
    () => ({
      page: 'taxes',
      decode: decodeTax,
      encode: encodeTax,
      isEmpty: isEmptyTax,
      preview: (scenario) => runWhatIf(toWhatIfBody(year, scenario)),
      baselineOf: (result) => result,
      dataKey: String(year),
      debounceMs: DEBOUNCE_MS,
      enabled: open,
      labelFor: (scenario) => labelForTax(scenario, tickerOf),
    }),
    // tickerOf reads `held`, which lands once per mount — a re-created spec is cheap.
    [year, open, holdings],
  )
  const sandbox = useSandbox(spec)
  const { scenario, result } = sandbox

  const patch = (change: (current: TaxScenario) => TaxScenario, immediate: boolean) => {
    setFormError(null) // the sentence described the legs as they WERE
    sandbox.set(change, { immediate })
  }

  const loadFeeds = () => {
    if (feedsRef.current) return
    feedsRef.current = true
    Promise.all([fetchHoldings(), fetchLots(), fetchLimits(year)])
      .then(([heldRes, lotsRes, limitsRes]) => {
        setHoldings(heldRes)
        setLots(lotsRes)
        setLimits(limitsRes)
        // Alias normalization (spec §6): resolve the legacy ticker / lot against the feed and
        // rewrite the URL to the new entries in ONE replace that also drops `whatif-lot`. A
        // name that matches nothing (sold since the link was made) seeds nothing — the open
        // card with its empty legs is the honest answer, not an error.
        const additions: { sale?: SaleEntry; espp?: EsppEntry } = {}
        if (legacy.ticker !== null) {
          const ticker = legacy.ticker.toUpperCase()
          const match = heldRes.holdings.find((h) => h.ticker.toUpperCase() === ticker)
          if (match !== undefined) additions.sale = saleLegFor(match)
        }
        if (legacy.lotId !== null) {
          const lot = lotsRes.lots.find((row) => row.id === legacy.lotId && !row.is_sold)
          if (lot !== undefined) additions.espp = esppLegFor(lot, lotsRes.current_price)
        }
        if (legacy.ticker !== null || legacy.lotId !== null) {
          sandbox.set(
            (current) => ({
              ...current,
              sales: additions.sale ? [...current.sales.filter((s) => s.security_id !== additions.sale!.security_id), additions.sale] : current.sales,
              espp: additions.espp ? [...current.espp.filter((e) => e.lot_id !== additions.espp!.lot_id), additions.espp] : current.espp,
            }),
            { immediate: true, drop: ['whatif-lot'] },
          )
        }
      })
      .catch((err: unknown) => {
        setFeedError(err instanceof ApiError ? err.message : 'Failed to load holdings, ESPP lots and limits')
      })
  }

  useEffect(() => {
    // The OPEN-ON-ARRIVAL mount only (entries or an alias in the URL); every other open goes
    // through the toggle. loadFeeds reads no reactive value beyond its setters and refs.
    if (open) loadFeeds()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design (PortfolioPage's `load`)
  }, [])

  const unsoldLots = lots?.lots.filter((lot) => !lot.is_sold) ?? []
  const holdingFor = (securityId: number) => held.find((h) => h.security_id === securityId)
  const legCount = scenario.sales.length + scenario.espp.length

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) loadFeeds()
  }

  const retryFeeds = () => {
    feedsRef.current = false
    setFeedError(null)
    loadFeeds()
  }

  // The first held security not already in a leg: two rows for one ticker are almost always
  // a mis-click, and the server classifies each leg against the FULL position.
  const nextHolding = () => held.find((h) => !scenario.sales.some((s) => s.security_id === h.security_id))
  const nextLot = () => unsoldLots.find((lot) => !scenario.espp.some((e) => e.lot_id === lot.id))
  const nextDefinition = () => definitions.find((d) => !(d.key in scenario.overrides))

  const addSale = () => {
    const holding = nextHolding()
    if (holding !== undefined) patch((s) => ({ ...s, sales: [...s.sales, saleLegFor(holding)] }), true)
  }
  const addEsppSale = () => {
    const lot = nextLot()
    if (lot !== undefined) patch((s) => ({ ...s, espp: [...s.espp, esppLegFor(lot, lots?.current_price ?? null)] }), true)
  }
  const addOverride = () => {
    const definition = nextDefinition()
    if (definition !== undefined) patch((s) => ({ ...s, overrides: { ...s.overrides, [definition.key]: null } }), true)
  }

  const setSale = (index: number, change: Partial<SaleEntry>, immediate: boolean) =>
    patch((s) => ({ ...s, sales: s.sales.map((leg, i) => (i === index ? { ...leg, ...change } : leg)) }), immediate)
  // Switching the ticker re-prefills the amounts with it: the old row's share count belongs
  // to the old position, and leaving it there is an oversell one keystroke from happening.
  const setSaleSecurity = (index: number, securityId: number) => {
    const holding = holdingFor(securityId)
    if (holding === undefined) return
    patch((s) => ({ ...s, sales: s.sales.map((leg, i) => (i === index ? { ...saleLegFor(holding), term: leg.term } : leg)) }), true)
  }
  const removeSale = (index: number) => patch((s) => ({ ...s, sales: s.sales.filter((_, i) => i !== index) }), true)
  const setEspp = (index: number, change: Partial<EsppEntry>, immediate: boolean) =>
    patch((s) => ({ ...s, espp: s.espp.map((leg, i) => (i === index ? { ...leg, ...change } : leg)) }), immediate)
  const removeEspp = (index: number) => patch((s) => ({ ...s, espp: s.espp.filter((_, i) => i !== index) }), true)
  const overrideKeys = Object.keys(scenario.overrides)
  const setOverrideKey = (from: string, to: string) => {
    if (to in scenario.overrides) {
      // Last-write-wins on a dict would silently drop the earlier row — refuse instead.
      const label = definitions.find((d) => d.key === to)?.label ?? to
      setFormError(`${label} is overridden twice — one row per key`)
      return
    }
    patch((s) => {
      const overrides: Record<string, string | null> = {}
      for (const [key, value] of Object.entries(s.overrides)) overrides[key === from ? to : key] = value
      return { ...s, overrides }
    }, true)
  }
  const setOverrideValue = (key: string, value: string | null, immediate: boolean) =>
    patch((s) => ({ ...s, overrides: { ...s.overrides, [key]: value } }), immediate)
  const removeOverride = (key: string) =>
    patch((s) => {
      const overrides = { ...s.overrides }
      delete overrides[key]
      return { ...s, overrides }
    }, true)

  const applyPreset = (change: TaxPresetPatch) => {
    if ('overrides' in change) patch((s) => ({ ...s, overrides: { ...s.overrides, ...change.overrides } }), true)
    else patch((s) => ({ ...s, sales: [...s.sales.filter((leg) => leg.security_id !== change.sale.security_id), change.sale] }), true)
  }
  const presets = taxPresets({ year, limits, inputs, holdings: holdings === null ? null : held, brackets, summary }, applyPreset)

  const taxTone = result === null ? 'neutral' : toneOf(result.delta.total_tax)
  const takeHomeTone = result === null ? 'neutral' : toneOf(result.delta.take_home)
  const pinSide = (r: PinResult<WhatIfOut>): PinResult<TaxSummaryOut> => (r === 'pending' || 'error' in r ? r : r.scenario)
  const overrideCount = overrideKeys.length

  return (
    <SandboxPanel
      eyebrow={`What if — ${year}`}
      hint="Model prospective sales or input changes against this year's stored return — nothing is saved."
      open={open}
      onToggle={toggle}
      toggleLabels={{ open: 'Open what-if', close: 'Close what-if' }}
      sandbox={sandbox}
      closedHint={
        <p className="drill-hint">
          Model prospective share sales against {year}&apos;s stored inputs — nothing is saved, and the
          stored year is never touched.
        </p>
      }
      presets={holdings === null ? null : <PresetRow presets={presets} />}
      staleNoun="this scenario"
      skeletonHeight={220}
      compare={
        result === null ? null : (
          <div className="whatif-result">
            {/* Every figure is the server's, rendered as it arrived (global rule 9). */}
            <div className="kpi-row">
              <StatTile
                label="Δ total tax"
                value={formatCurrency(result.delta.total_tax)}
                delta={taxTone === 'neutral' ? 'no change' : `${taxTone === 'positive' ? 'more' : 'less'} tax than ${year} as stored`}
                tone={inverted(taxTone)}
                direction={directionOf(taxTone)}
                hint="Scenario total tax minus baseline — positive means the scenario owes more."
              />
              <StatTile
                label="Δ take-home"
                value={formatCurrency(result.delta.take_home)}
                delta={`${formatCurrency(result.baseline.totals.take_home)} → ${formatCurrency(result.scenario.totals.take_home)}`}
                tone={takeHomeTone}
                hint="Scenario take-home minus baseline."
              />
              <StatTile
                label="Effective rate"
                value={`${formatPct(result.baseline.totals.effective_rate, { signed: false })} → ${formatPct(result.scenario.totals.effective_rate, { signed: false })}`}
                hint="Overall effective rate, baseline → scenario."
              />
            </div>
            <CompareTable<TaxSummaryOut>
              rows={COMPARE_ROWS}
              baseline={result.baseline}
              scenario={result.scenario}
              valueOf={summaryValue}
              delta={(key) => deltaValue(result.delta, key)}
              pins={sandbox.pins.map((pin) => ({ id: pin.id, label: pin.label, result: pinSide(sandbox.pinResults[pin.id]) }))}
              onUnpin={sandbox.unpin}
            />
            {result.warnings.length > 0 && (
              <div className="tax-warnings">
                {result.warnings.map((warning, i) => (
                  <p key={i}>{warning}</p>
                ))}
              </div>
            )}
            {result.sale_details.length > 0 && (
              <div className="tax-section">
                <h3 className="eyebrow">Sale legs</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Ticker</th><th className="num">Shares</th><th className="num">Price</th><th className="num">Proceeds</th>
                      <th className="num">Cost basis</th><th className="num">Gain</th><th>Term</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.sale_details.map((detail, i) => (
                      <tr key={i}>
                        <td>{detail.ticker}</td><td className="num">{formatShares(detail.shares)}</td>
                        <td className="num">{formatCurrency(detail.price)}</td><td className="num">{formatCurrency(detail.proceeds)}</td>
                        <td className="num">{formatCurrency(detail.cost_basis)}</td><td className="num">{formatCurrency(detail.gain)}</td>
                        <td>{detail.term}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.espp_sale_details.length > 0 && (
              <div className="tax-section">
                <h3 className="eyebrow">ESPP legs</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Lot</th><th className="num">Shares</th><th className="num">Sale price</th><th className="num">Proceeds</th>
                      <th className="num">Ordinary income</th><th className="num">Capital gain</th><th>Term</th><th>Disposition</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.espp_sale_details.map((detail, i) => (
                      <tr key={i}>
                        <td>{formatDate(detail.purchase_date)}</td><td className="num">{formatShares(detail.shares)}</td>
                        <td className="num">{formatCurrency(detail.sale_price)}</td><td className="num">{formatCurrency(detail.proceeds)}</td>
                        <td className="num">{formatCurrency(detail.ordinary_income)}</td><td className="num">{formatCurrency(detail.capital_gain)}</td>
                        <td>{detail.term}</td><td>{detail.disposition}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="tax-section">
              <h3 className="eyebrow">Inputs this scenario moved</h3>
              {result.changed_inputs.length === 0 ? (
                <p className="empty-note">Nothing moved — this scenario computes to the stored year.</p>
              ) : (
                <ul className="whatif-changed">
                  {result.changed_inputs.map((changed) => (
                    <li key={changed.key}>
                      {changed.label} — {formatCurrency(changed.before)} → {formatCurrency(changed.after)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )
      }
      apply={
        onApplyOverrides !== undefined && overrideCount > 0 ? (
          <>
            <button
              type="button"
              className="button button-primary"
              onClick={() => onApplyOverrides({ ...scenario.overrides }, result?.changed_inputs ?? [])}
            >
              Apply {overrideCount} override{overrideCount === 1 ? '' : 's'} to {year}
            </button>
            <span className="drill-hint">Overrides only — sale and ESPP legs are hypothetical and are never applied.</span>
          </>
        ) : undefined
      }
    >
      <p className="drill-hint">
        Sales are classified at average cost, the app&apos;s only basis method, and ESPP ordinary income
        lands in Other W2 Income — which raises the engine&apos;s Medicare/Social Security/SDI wage bases,
        exactly as the sheet does it. Real ESPP ordinary income is FICA-exempt; this sandbox inherits the
        sheet&apos;s structure. Long/short is your call: imported transactions carry no dates, so the app
        cannot verify a holding period. Nothing here is stored.
      </p>
      <FeedBanner error={feedError} retry={retryFeeds} />
      {holdings === null && feedError === null && <p className="empty-note">Loading holdings, ESPP lots and limits…</p>}
      {holdings !== null && (
        <>
          <div className="whatif-legs">
            {scenario.sales.map((leg, index) => {
              const holding = holdingFor(leg.security_id)
              const ticker = holding?.ticker ?? `#${leg.security_id}`
              return (
                <div key={index} className="whatif-form">
                  <label htmlFor={`whatif-sale-security-${index}`}>Sell</label>
                  <select
                    id={`whatif-sale-security-${index}`}
                    className="field-input whatif-select"
                    value={String(leg.security_id)}
                    onChange={(e) => setSaleSecurity(index, Number(e.target.value))}
                  >
                    {holding === undefined && <option value={String(leg.security_id)}>{ticker} (not held)</option>}
                    {held.map((h) => (
                      <option key={h.security_id} value={String(h.security_id)}>{h.ticker}</option>
                    ))}
                  </select>
                  <DraftInput
                    ariaLabel={`Sale ${index + 1} shares`}
                    value={leg.shares}
                    validate={(text) => {
                      const shares = text.trim()
                      if (shares === '' || !isPlainDecimal(shares) || !(Number(shares) > 0)) return `${ticker}: shares must be a number greater than 0`
                      if (holding !== undefined && Number(shares) > Number(holding.shares)) return `selling ${shares} ${ticker} — only ${holding.shares} held`
                      return null
                    }}
                    onCommit={(text, immediate) => setSale(index, { shares: text.trim() }, immediate)}
                    onInvalid={setFormError}
                  />
                  <DraftInput
                    ariaLabel={`Sale ${index + 1} price`}
                    placeholder="latest"
                    value={leg.price ?? ''}
                    validate={(text) => {
                      const price = text.trim()
                      return price !== '' && (!isPlainDecimal(price) || !(Number(price) > 0)) ? `${ticker}: price must be a number greater than 0, or blank` : null
                    }}
                    onCommit={(text, immediate) => {
                      const price = text.trim()
                      patch((s) => ({
                        ...s,
                        sales: s.sales.map((row, i) => {
                          if (i !== index) return row
                          const next = { ...row }
                          if (price === '') delete next.price // the omit case: the latest quote
                          else next.price = price
                          return next
                        }),
                      }), immediate)
                    }}
                    onInvalid={setFormError}
                  />
                  <div className="segmented" role="group" aria-label={`Sale ${index + 1} term`}>
                    <button type="button" className={leg.term === 'long' ? 'active' : ''} aria-pressed={leg.term === 'long'} onClick={() => setSale(index, { term: 'long' }, true)}>Long</button>
                    <button type="button" className={leg.term === 'short' ? 'active' : ''} aria-pressed={leg.term === 'short'} onClick={() => setSale(index, { term: 'short' }, true)}>Short</button>
                  </div>
                  <span className="drill-hint">{formatShares(holding?.shares)} held</span>
                  <button type="button" className="button" aria-label={`Remove sale ${index + 1}`} onClick={() => removeSale(index)}>Remove</button>
                </div>
              )
            })}
            {scenario.espp.map((leg, index) => {
              const lot = unsoldLots.find((row) => row.id === leg.lot_id)
              return (
                <div key={index} className="whatif-form">
                  <label htmlFor={`whatif-espp-lot-${index}`}>ESPP lot</label>
                  <select
                    id={`whatif-espp-lot-${index}`}
                    className="field-input whatif-select"
                    value={String(leg.lot_id)}
                    onChange={(e) => setEspp(index, { lot_id: Number(e.target.value) }, true)}
                  >
                    {lot === undefined && <option value={String(leg.lot_id)}>Lot {leg.lot_id} (not available)</option>}
                    {unsoldLots.map((row) => (
                      <option key={row.id} value={String(row.id)}>{formatDate(row.purchase_date)} — {formatShares(row.shares)} sh</option>
                    ))}
                  </select>
                  <DraftInput
                    ariaLabel={`ESPP sale ${index + 1} price`}
                    placeholder="latest"
                    value={leg.sale_price ?? ''}
                    validate={(text) => {
                      const price = text.trim()
                      return price !== '' && (!isPlainDecimal(price) || !(Number(price) > 0))
                        ? `Lot ${lot === undefined ? leg.lot_id : formatDate(lot.purchase_date)}: sale price must be a number greater than 0, or blank`
                        : null
                    }}
                    onCommit={(text, immediate) => {
                      const price = text.trim()
                      patch((s) => ({
                        ...s,
                        espp: s.espp.map((row, i) => {
                          if (i !== index) return row
                          const next = { ...row }
                          if (price === '') delete next.sale_price
                          else next.sale_price = price
                          return next
                        }),
                      }), immediate)
                    }}
                    onInvalid={setFormError}
                  />
                  <button type="button" className="button" aria-label={`Remove ESPP sale ${index + 1}`} onClick={() => removeEspp(index)}>Remove</button>
                </div>
              )
            })}
          </div>

          {overrideKeys.length > 0 && (
            <div className="tax-section whatif-overrides">
              <h3 className="eyebrow">
                Input overrides
                <InfoHint text="Absolute replacements applied AFTER the sale legs. An override addresses the household key map — on a married year a per-person line is replaced as one combined figure, the same aggregation the engine applies." />
              </h3>
              <p className="drill-hint">
                Overrides set a key&apos;s household value for this scenario only. A blank value clears the
                input (the scenario computes it as 0).
              </p>
              <div className="whatif-legs">
                {overrideKeys.map((key, index) => {
                  const label = definitions.find((d) => d.key === key)?.label ?? key
                  return (
                    <div key={key} className="whatif-form">
                      <label htmlFor={`whatif-override-key-${index}`}>Override</label>
                      <select
                        id={`whatif-override-key-${index}`}
                        className="field-input whatif-select"
                        value={key}
                        onChange={(e) => setOverrideKey(key, e.target.value)}
                      >
                        {!definitions.some((d) => d.key === key) && <option value={key}>{key}</option>}
                        {definitions.map((d) => (
                          <option key={d.key} value={d.key}>{d.label} ({d.key})</option>
                        ))}
                      </select>
                      <DraftAmount
                        ariaLabel={`Override ${index + 1} value`}
                        value={scenario.overrides[key] ?? ''}
                        onCommit={(canonical, immediate) => setOverrideValue(key, canonical, immediate)}
                        onInvalid={() => setFormError(`${label}: enter a number, or leave the value blank to clear it`)}
                      />
                      <button type="button" className="button" aria-label={`Remove override ${index + 1}`} onClick={() => removeOverride(key)}>Remove</button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {sandbox.empty && (
            <p className="empty-note">
              No legs yet — add a sale or an input override to model it against {year}&apos;s stored inputs.
            </p>
          )}

          <div className="whatif-actions">
            <button type="button" className="button" disabled={legCount >= MAX_LEGS || nextHolding() === undefined} onClick={addSale}>Add sale</button>
            <button type="button" className="button" disabled={legCount >= MAX_LEGS || nextLot() === undefined} onClick={addEsppSale}>Add ESPP sale</button>
            <button type="button" className="button" disabled={nextDefinition() === undefined} onClick={addOverride}>Add override</button>
            <span className="drill-hint">A blank price uses the latest quote. At most {MAX_LEGS} legs. Edits run as you type.</span>
          </div>
          <FeedBanner error={formError} />
        </>
      )}
    </SandboxPanel>
  )
}

/** A leg text box: the typed text is control-local while focused (AmountInput's posture); a
 *  keystroke commits valid text debounced, blur/Enter commit at once, invalid text raises the
 *  panel's sentence and commits nothing — the URL keeps the last valid scenario. */
function DraftInput({
  ariaLabel,
  placeholder,
  value,
  validate,
  onCommit,
  onInvalid,
}: {
  ariaLabel: string
  placeholder?: string
  value: string
  validate: (text: string) => string | null
  onCommit: (text: string, immediate: boolean) => void
  onInvalid: (sentence: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const push = (text: string, immediate: boolean) => {
    const problem = validate(text)
    if (problem !== null) {
      onInvalid(problem)
      return
    }
    onCommit(text, immediate)
  }
  const settle = () => {
    if (draft === null) return
    push(draft, true)
    setDraft(null)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      settle()
    }
  }
  return (
    <input
      aria-label={ariaLabel}
      className="field-input"
      inputMode="decimal"
      placeholder={placeholder}
      value={draft ?? value}
      onChange={(e) => {
        setDraft(e.target.value)
        push(e.target.value, false)
      }}
      onBlur={settle}
      onKeyDown={onKeyDown}
    />
  )
}

/** The override value box: AmountInput's tolerant grammar ("$1,600") canonicalized at commit
 *  (InputsForm's boundary); a blank is the explicit null — the endpoint's "clear this input". */
function DraftAmount({
  ariaLabel,
  value,
  onCommit,
  onInvalid,
}: {
  ariaLabel: string
  value: string
  onCommit: (canonical: string | null, immediate: boolean) => void
  onInvalid: () => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const draftRef = useRef<string | null>(null)
  const settle = () => {
    const text = draftRef.current
    if (text === null) return
    draftRef.current = null
    setDraft(null)
    const trimmed = text.trim()
    if (trimmed === '') {
      onCommit(null, true)
      return
    }
    if (!isAmount(trimmed)) {
      onInvalid()
      return
    }
    onCommit(canonicalAmount(trimmed), true)
  }
  return (
    <span
      onBlur={settle}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          settle()
        }
      }}
    >
      <AmountInput
        aria-label={ariaLabel}
        value={draft ?? value}
        placeholder="blank clears"
        onValueChange={(next) => {
          draftRef.current = next
          setDraft(next)
        }}
      />
    </span>
  )
}
```

- [ ] **Step 2: Run the panel tests and the conformance walk**

Run: `npx vitest run src/components/taxes/WhatIfPanel.test.tsx src/sandbox/sandboxConformance.test.ts`
Expected: PASS (24 panel tests; the walk now covers `WhatIfPanel.tsx`). Two traps: (1) the alias test expects `year=2024` BEFORE the entry — `withEntries` appends whatif after the untouched keys; (2) the "typing shares debounces" test needs `vi.useFakeTimers()` before mount and real timers restored in `finally` — the hook's timer is created in a handler, so fake timers own it.

- [ ] **Step 3: Lint and commit**

Run: `npx eslint src/components/taxes && npx tsc -b`

```bash
git add src/components/taxes/WhatIfPanel.tsx src/components/taxes/WhatIfPanel.test.tsx
git commit -m "feat(taxes): WhatIfPanel on useSandbox — URL legs, live preview, side-by-side compare with NIIT, presets, pins, alias normalization, Apply slot"
```

---

### Task 4: `TaxesPage` — new panel props, `applyOverrides`

**Files:**
- Modify: `src/pages/TaxesPage.tsx`, `src/pages/TaxesPage.test.tsx`

- [ ] **Step 1: Write the failing test** — in `src/pages/TaxesPage.test.tsx`, replace the `vi.mock('../components/taxes/WhatIfPanel', …)` factory with one that reports the new props and exposes the Apply door:

```tsx
vi.mock('../components/taxes/WhatIfPanel', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      year,
      definitions,
      onApplyOverrides,
    }: {
      year: number
      definitions?: { key: string; label: string }[]
      onApplyOverrides?: (overrides: Record<string, string | null>, changed: { key: string; label: string; before: string; after: string }[]) => void
    }) =>
      createElement(
        'div',
        { 'data-testid': 'whatif-panel', 'data-year': String(year), 'data-defs': (definitions ?? []).map((d) => d.key).join(',') },
        createElement(
          'button',
          {
            type: 'button',
            onClick: () =>
              onApplyOverrides?.({ annual_salary: '210000' }, [
                { key: 'annual_salary', label: 'Annual Salary', before: '188930.00', after: '210000.00' },
              ]),
          },
          'Apply 1 override to 2024',
        ),
      ),
  }
})
```

Search the file for `data-ticker`, `data-lot` and `whatif` and delete the assertions about the alias seeds (the panel reads the URL itself now; `WhatIfPanel.test.tsx` pins it); keep the `data-year` / `data-defs` assertions. Then append:

```tsx
  it('Apply from the what-if confirms before → after, PUTs the overrides once and remounts the inputs form', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    await screen.findByTestId('whatif-panel')
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 override to 2024' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][0]).toBe(
      "This writes 1 input to 2024's stored return and reloads the form below. Continue?\nAnnual Salary: $188,930.00 → $210,000.00",
    )
    await waitFor(() => expect(vi.mocked(putTaxInputs)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(2024, { values: { annual_salary: '210000' } })
    confirm.mockRestore()
  })

  it('a declined confirm writes nothing', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()
    await screen.findByTestId('whatif-panel')
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 override to 2024' }))
    expect(vi.mocked(putTaxInputs)).not.toHaveBeenCalled()
    confirm.mockRestore()
  })
```

(`renderPage` and `putTaxInputs` already exist in the file; if the render helper has another name, use it.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/pages/TaxesPage.test.tsx`
Expected: the two new tests FAIL (no `onApplyOverrides` wiring); older tests pass or fail only on the removed seed assertions.

- [ ] **Step 3: Implement** — in `src/pages/TaxesPage.tsx`:

Remove the `useSearchParams` import and the `whatIfTicker` / `lotParam` / `whatIfLotId` lines with their comment (the panel owns the aliases now). Add `import { formatCurrency } from '../utils/format'` and `import type { ChangedInput } from '../types/api'` (extend the existing type import).

After `onVestApplied`, add:

```tsx
  // The what-if's Apply (2026-09-03 planning-sandboxes spec §8.6, §10): overrides ONLY, one
  // house-register confirmation listing before → after from the scenario's own changed_inputs,
  // then the EXISTING inputs PUT and the same landing chain the withholding card's Apply uses
  // (adopt the echo, remount the form, refresh the totals). The unsaved-edits check rides the
  // same sentence. Never a new write path.
  const applyOverrides = (overrides: Record<string, string | null>, changed: ChangedInput[]) => {
    if (selectedYear === null) return
    const year = selectedYear
    const keys = Object.keys(overrides)
    const lines = changed
      .filter((row) => keys.includes(row.key))
      .map((row) => `${row.label}: ${formatCurrency(row.before)} → ${formatCurrency(row.after)}`)
    const sentence = `This writes ${keys.length} input${keys.length === 1 ? '' : 's'} to ${year}'s stored return and reloads the form below${
      inputsDirty ? ', discarding its unsaved edits' : ''
    }. Continue?`
    if (!window.confirm([sentence, ...lines].join('\n'))) return
    setError(null)
    putTaxInputs(year, { values: overrides })
      .then((echo) => onVestApplied(echo))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : `Failed to apply the overrides to ${year}`)
      })
  }
```

Change the panel mount to:

```tsx
          <WhatIfPanel
            key={`whatif-${d.summary.year}`}
            year={d.summary.year}
            definitions={overrideDefinitions(d.inputs)}
            inputs={d.inputs}
            brackets={d.brackets}
            summary={d.summary}
            onApplyOverrides={applyOverrides}
          />
```

(`d` is the Feed render prop's detail after shell Plan 3; if the page still names it `detail`, use that.) Update the comment above it: the seeds are gone — "the panel reads the URL's `whatif` family itself and re-runs it against the year now on screen".

- [ ] **Step 4: Run**

Run: `npx tsc -b && npx vitest run src/pages/TaxesPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/TaxesPage.tsx src/pages/TaxesPage.test.tsx
git commit -m "feat(taxes): Apply what-if overrides through the existing inputs PUT after a before → after confirmation"
```

---

### Task 5: Drill-in links emit the new form

**Files:**
- Modify: `src/components/portfolio/HoldingDetailPanel.tsx`, `src/components/portfolio/HoldingDetailPanel.test.tsx`, `src/pages/EsppPage.tsx`, `src/pages/EsppPage.test.tsx`

- [ ] **Step 1: Update the tests first**

`HoldingDetailPanel.test.tsx` — the two href assertions (currently `'/taxes?whatif=AAA'` and `'/taxes?whatif=BRK.B%2BX'`) become, using the fixture object each test renders with (`holding` below is that object's variable name in the test):

```tsx
    expect(link.getAttribute('href')).toBe(`/taxes?whatif=${encodeURIComponent(`sale:${holding.security_id}:${holding.shares}`)}`)
```

`EsppPage.test.tsx` lines ≈ 341–342: `'/taxes?whatif-lot=1'` → `'/taxes?whatif=espp%3A1'`, `'/taxes?whatif-lot=4'` → `'/taxes?whatif=espp%3A4'`.

Run: `npx vitest run src/components/portfolio/HoldingDetailPanel.test.tsx src/pages/EsppPage.test.tsx` → FAIL on the hrefs.

- [ ] **Step 2: Implement**

`HoldingDetailPanel.tsx` ≈ line 218:

```tsx
        {/* The new sandbox grammar (2026-09-03 planning-sandboxes spec §6): the whole
            position as a sale leg — id and shares in the server's own vocabulary, the price
            left to the latest quote. The old `?whatif=TICKER` still works as an alias. */}
        <Link to={`/taxes?whatif=${encodeURIComponent(`sale:${holding.security_id}:${holding.shares}`)}`}>
```

`EsppPage.tsx` ≈ line 500:

```tsx
                      <Link className="button" to={`/taxes?whatif=${encodeURIComponent(`espp:${lot.id}`)}`}>
```

- [ ] **Step 3: Run and commit**

Run: `npx vitest run src/components/portfolio/HoldingDetailPanel.test.tsx src/pages/EsppPage.test.tsx`
Expected: PASS.

```bash
git add src/components/portfolio/HoldingDetailPanel.tsx src/components/portfolio/HoldingDetailPanel.test.tsx src/pages/EsppPage.tsx src/pages/EsppPage.test.tsx
git commit -m "feat(taxes): Portfolio and ESPP drill-ins deep-link into the what-if with sale:/espp: entries"
```

---

### Task 6: Type-check, lint, suites

- [ ] **Step 1: Run**

`npx tsc -b && npx eslint src/components/taxes src/pages/TaxesPage.tsx src/components/portfolio/HoldingDetailPanel.tsx src/pages/EsppPage.tsx && npx vitest run src/components/taxes src/pages/TaxesPage.test.tsx src/pages/EsppPage.test.tsx src/components/portfolio src/sandbox`
Expected: clean, green.

- [ ] **Step 2: Commit anything lint moved**, then report — name the new panel props for the verify lane, and whether Task 7 ran.

---

### Task 7 (conditional): the per-jurisdiction Δ bar through the chart grammar

**Precondition check:** `ls src/components/ChartCard.tsx src/charts/tooltip.ts src/charts/scales.ts`. If any is missing (chart-grammar plan C1 not yet merged), SKIP this task, say so in the lane report, and the verify plan re-checks. Do not build a fallback mount — the chart spec forbids `<EChart` outside `ChartCard`.

**Files:**
- Modify: `src/components/taxes/taxChartOptions.ts`, `src/components/taxes/taxChartOptions.test.ts`, `src/components/taxes/WhatIfPanel.tsx`

- [ ] **Step 1: Failing test** — append to `taxChartOptions.test.ts`:

```ts
import { whatIfDeltaBarOption } from './taxChartOptions'

describe('whatIfDeltaBarOption', () => {
  it('draws one bar per jurisdiction delta, diverging around zero, through the grammar tooltip', () => {
    const option = whatIfDeltaBarOption({
      total_tax: '-5488.69', take_home: '5488.69', federal_tax: '-3000.00', state_tax: '-2413.10', medicare_tax: '0.00',
      social_security_tax: '0.00', disability_tax: '0.00', capital_gains_tax: '0.00', effective_rate: null, niit_tax: '-75.59',
    })!
    const series = (option.series as { data: number[] }[])[0]
    expect((option.yAxis as { data: string[] }).data).toEqual(['Federal', 'State', 'NIIT', 'Medicare', 'Social Security', 'Disability', 'Capital gains'])
    expect(series.data).toEqual([-3000, -2413.1, -75.59, 0, 0, 0, 0])
    expect(option.visualMap).toBeDefined()
    expect(typeof (option.tooltip as { formatter?: unknown }).formatter).toBe('function')
  })

  it('returns null when every delta is zero', () => {
    expect(whatIfDeltaBarOption({ total_tax: '0.00', take_home: '0.00', federal_tax: '0.00', state_tax: '0.00', medicare_tax: '0.00', social_security_tax: '0.00', disability_tax: '0.00', capital_gains_tax: '0.00', effective_rate: null })).toBeNull()
  })
})
```

- [ ] **Step 2: Builder** — append to `taxChartOptions.ts` (import `itemTooltip` from `'../../charts/tooltip'`, `divergingVisualMap` from `'../../charts/scales'`, `MONEY_GRID` from `'../../charts/grammar'`, `formatCurrency` from utils, `WhatIfDelta` from types):

```ts
/** The what-if's Δ by jurisdiction (2026-09-03 planning-sandboxes spec §10): a horizontal bar
 *  per tax line, diverging around zero — less tax to the left. Null when nothing moved. */
export function whatIfDeltaBarOption(delta: WhatIfDelta): EChartsOption | null {
  const rows: [string, string | null][] = [
    ['Federal', delta.federal_tax],
    ['State', delta.state_tax],
    ['NIIT', delta.niit_tax ?? null],
    ['Medicare', delta.medicare_tax],
    ['Social Security', delta.social_security_tax],
    ['Disability', delta.disability_tax],
    ['Capital gains', delta.capital_gains_tax],
  ]
  const values = rows.map(([, v]) => (v === null ? 0 : Number(v)))
  if (values.every((v) => v === 0)) return null
  const span = Math.max(...values.map(Math.abs))
  return {
    grid: MONEY_GRID.horizontal,
    tooltip: itemTooltip({ unit: 'money', body: (p) => ({ value: formatCurrency(p.value as number), label: String(p.name) }) }),
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatCurrency(v) } },
    yAxis: { type: 'category', data: rows.map(([label]) => label), inverse: true },
    visualMap: divergingVisualMap({ span, center: 0, formatter: (v: number) => formatCurrency(v) }),
    series: [{ type: 'bar', data: values, barMaxWidth: 24 }],
  }
}
```

(Adjust the exact `itemTooltip`/`divergingVisualMap`/`MONEY_GRID` signatures to what C1 shipped — read those three modules first; the names are the chart spec's.)

- [ ] **Step 3: Mount** — in `WhatIfPanel.tsx`'s compare region, after the `kpi-row`:

```tsx
            <ChartCard
              title="Δ by jurisdiction"
              hint="Each tax line's scenario minus baseline — bars to the left are less tax."
              ariaLabel="Change in tax by jurisdiction, scenario minus baseline"
              option={whatIfDeltaBarOption(result.delta)}
              empty="Nothing moved — every jurisdiction computes to the stored year."
              exportName="whatif-delta"
              height={220}
            />
```

with `import ChartCard from '../ChartCard'` and `import { whatIfDeltaBarOption } from './taxChartOptions'`. Add a `ChartCard` mock to `WhatIfPanel.test.tsx` mirroring how `TaxesPage.test.tsx` mocks `EChart` (a marker div carrying `aria-label`), and one assertion in the compare test: `expect(screen.getByLabelText('Change in tax by jurisdiction, scenario minus baseline')).toBeTruthy()`.

- [ ] **Step 4: Run, lint, commit**

`npx vitest run src/components/taxes && npx eslint src/components/taxes`

```bash
git add src/components/taxes/taxChartOptions.ts src/components/taxes/taxChartOptions.test.ts src/components/taxes/WhatIfPanel.tsx src/components/taxes/WhatIfPanel.test.tsx
git commit -m "feat(taxes): what-if Δ-by-jurisdiction bar through ChartCard with a diverging scale"
```

---

## Self-review

**Spec coverage:** §10 live (400 ms, Run retired, pre-validation withholds the request with `stale` false) → Tasks 2–3; side-by-side ten rows incl. NIIT from `niit_tax`, the two Δ tiles kept → Tasks 1, 3; presets (Max 401(k) from the year's elective limit; Max HSA = limit − employer, per tier; Sell all {ticker} ≤ six chips; Realize gains to the 15 % ceiling from the CG table + summary, disabled without a table or a gain) → Tasks 1, 3; pins up to three, re-run on year switch (remount → `dataKey`/mount) → Task 3; URL family with `sale:`/`espp:`/`<key>:` and legacy aliases normalized in one replace dropping `whatif-lot`, `?year=` untouched → Tasks 1, 3; Apply overrides only after a before → after confirmation via the existing PUT with the form remount and the unsaved-edits sentence → Task 4; drill-ins emit the new form → Task 5; §10's Δ bar `ChartCard` + `itemTooltip` + `divergingVisualMap` → Task 7 (conditional on C1). §17 "keeps the leg forms and every visible string": kept, except `Sale N: choose a security you hold` (unreachable — a URL leg always names an id; a sold-since id renders "(not held)" and the server's 404 sentence). **Placeholders:** none; Task 7's "adjust signatures" is bounded to three named imports read before use. **Type consistency:** `WhatIfPanel({ year, definitions?, inputs?, brackets?, summary?, onApplyOverrides?(overrides, changed) })` matches the page mount and the test mock; `TaxScenario`/`decodeTax`/`encodeTax`/`toWhatIfBody`/`taxPresets(ctx, apply: (TaxPresetPatch) => void)`/`COMPARE_ROWS`/`summaryValue`/`deltaValue` names match between Tasks 1 and 3; lane G's `SandboxPanel`/`CompareTable<TaxSummaryOut>`/`PresetRow`/`useSandbox` props as defined there; `WhatIfBody` from `src/api/whatif.ts` unchanged.
