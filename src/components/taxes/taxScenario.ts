// The tax sandbox's codec, compare-row map and presets (2026-09-03 planning-sandboxes spec
// §10). Pure — no React, no fetching. Legs and overrides are the SERVER'S wire vocabulary
// (SaleLegIn / EsppSaleIn / the PUT-inputs key map), so decode → request body is a copy.
import type { WhatIfBody } from '../../api/whatif'
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
  return (
    scenario.sales.length === 0 &&
    scenario.espp.length === 0 &&
    Object.keys(scenario.overrides).length === 0
  )
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
  return {
    year,
    sales,
    espp_sales,
    ...(keys.length === 0 ? {} : { overrides: { ...scenario.overrides } }),
  }
}

/** "Sell 40 VTI · ESPP lot 3" — the first two legs (spec §8.5). */
export function labelForTax(
  scenario: TaxScenario,
  tickerOf: (securityId: number) => string | null,
): string {
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
    for (const item of section.items)
      if (item.key === key && item.value !== null) total = addDecimals(total, item.value)
  return total
}

export function taxPresets(ctx: TaxPresetContext, apply: (patch: TaxPresetPatch) => void): Preset[] {
  const elective = limitValue(ctx.limits, 'limit_401k_elective')
  const employerHsa = householdValue(ctx.inputs, 'hsa_contributions_employer')
  const presets: Preset[] = [
    {
      id: 'max401k',
      label: 'Max 401(k)',
      disabled: elective === null,
      // No "loading" branch: the panel renders this row only once its three feeds have
      // landed together, and while they are in flight the CARD says so — a second sentence
      // on the chips would answer a question already answered above them.
      title: elective === null ? `Enter ${ctx.year}'s 401(k) limit ${LIMITS_HINT}` : undefined,
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
      title: limit === null ? `Enter ${ctx.year}'s HSA ${tier} limit ${LIMITS_HINT}` : undefined,
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
  const disabled = (title: string): Preset => ({
    id: 'realize15',
    label: 'Realize gains to the 15% ceiling',
    disabled: true,
    title,
    apply: () => {},
  })
  if (table === undefined || table.length < 2 || ctx.summary === null)
    return disabled(`Enter ${ctx.year}'s capital-gains brackets first`)
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
