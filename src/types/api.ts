export interface TokenResponse {
  access_token: string
  token_type: string
}

export interface MeResponse {
  email: string
}

export type AccountGroup =
  | 'cash'
  | 'pre_tax'
  | 'post_tax'
  | 'taxable'
  | 'equity'
  | 'other'
  | 'liability'

export interface AccountOut {
  id: number
  name: string
  slug: string
  group: AccountGroup
  sort_order: number
  is_active: boolean
  is_component: boolean
  parent_account_id: number | null
}

export interface AccountCreate {
  name: string
  group: AccountGroup
  sort_order?: number
  is_component?: boolean
}

export interface BalanceEntry {
  account_id: number
  balance: string
}

export interface NetWorthTimeseries {
  months: string[]
  accounts: AccountOut[]
  series: { account_id: number; values: (string | null)[] }[]
  group_totals: Record<AccountGroup, string[]>
  net_worth: string[]
  mom_pct: (string | null)[]
  /** Snapshot notes aligned with months — the chart's annotation layer (user text). */
  notes: (string | null)[]
}

export interface GroupSummary {
  group: AccountGroup
  total: string
  mom_delta: string | null
}

export interface NetWorthSummary {
  month: string | null
  net_worth: string | null
  mom_delta: string | null
  mom_pct: string | null
  groups: GroupSummary[]
}

export interface MonthBalances {
  month: string
  exists: boolean
  recorded_on: string | null
  notes: string | null
  balances: BalanceEntry[]
}

export interface MonthUpsertResult {
  month: string
  snapshot_created: boolean
  created: number
  updated: number
  unchanged: number
}

export interface CategoryOut {
  id: number
  name: string
  slug: string
  sort_order: number
  is_active: boolean
}

export interface AmountEntry {
  category_id: number
  amount: string
}

export interface SpendingMatrix {
  months: string[]
  categories: CategoryOut[]
  series: { category_id: number; values: (string | null)[] }[]
  totals: string[]
  net_pay: (string | null)[]
  savings_rate: (string | null)[]
  four_pct_rule: (string | null)[]
}

export interface SpendingMonth {
  month: string
  exists: boolean
  net_pay: string | null
  amounts: AmountEntry[]
}

export interface SpendingUpsertResult {
  month: string
  created: number
  updated: number
  unchanged: number
  net_pay_set: boolean
  /** An explicit `net_pay: null` deleted the month's cashflow row (the blank-clears rider). */
  net_pay_cleared: boolean
}

export interface YearRollup {
  year: number
  by_category: { category_id: number; total: string }[]
  total: string
  net_pay_total: string | null
  savings_rate: string | null
}

export interface SpendingYearly {
  years: YearRollup[]
}

export type HoldingType = 'etf' | 'mutual_fund' | 'stock' | 'private'
export type TransactionType = 'buy' | 'sell' | 'split'
export type TransactionSource = 'import' | 'ui'
export type AllocationDimension = 'industry' | 'type' | 'account'

export interface SecurityOut {
  id: number
  ticker: string
  name: string
  industry: string | null
  holding_type: HoldingType
  is_manual_priced: boolean
  is_active: boolean
  annual_dividend: string | null
  ex_div_date: string | null
}

export interface SecurityCreate {
  ticker: string
  name: string
  industry?: string | null
  holding_type: HoldingType
  is_manual_priced?: boolean
  annual_dividend?: string | null
  ex_div_date?: string | null
}

export type SecurityUpdate = Partial<Omit<SecurityCreate, 'ticker'>> & {
  is_active?: boolean
}

export interface TransactionOut {
  id: number
  security_id: number
  account: string
  type: TransactionType
  txn_date: string | null
  shares: string
  price: string
  fees: string | null
  split_factor: string | null
  sort_index: number
  source: TransactionSource
  notes: string | null
}

export interface TransactionCreate {
  security_id: number
  account: string
  type: TransactionType
  txn_date?: string | null
  shares?: string | null
  price?: string | null
  fees?: string | null
  split_factor?: string | null
  notes?: string | null
}

export type TransactionUpdate = Partial<Omit<TransactionCreate, 'security_id'>>

export interface DividendOut {
  id: number
  security_id: number
  account: string | null
  pay_date: string
  amount: string
  // Ownership: 'auto' rows belong to the refresh (rewritten every run inside its window,
  // and a delete comes back next run); 'manual' rows are the user's alone. The three
  // event fields are the auto path's provenance — always null on a manual row, and on
  // auto rows pay_date equals ex_date (Yahoo's chart feed carries no payment date).
  source: string
  ex_date: string | null
  per_share: string | null
  shares_held: string | null
  notes: string | null
}

export interface DividendCreate {
  security_id: number
  account?: string | null
  pay_date: string
  amount: string
  notes?: string | null
}

/**
 * The dividends PATCH body — createDividend's minus the immutable security_id, the same
 * formula TransactionUpdate applies above; `updateDividend` in src/api/portfolio.ts is
 * its consumer. (The server refuses an explicit null for amount/pay_date — 422 — so a
 * sparse caller may omit them but must not blank them.)
 */
export type DividendUpdate = Partial<Omit<DividendCreate, 'security_id'>>

export interface HoldingOut {
  security_id: number
  ticker: string
  name: string
  industry: string | null
  holding_type: HoldingType
  is_manual_priced: boolean
  shares: string
  avg_cost: string | null
  cost_basis: string
  price: string | null
  quoted_at: string | null
  price_source: 'yfinance' | 'manual' | null
  day_change_pct: string | null
  day_change_amount: string | null
  market_value: string | null
  weight_pct: string | null
  unrealized_gl: string | null
  unrealized_gl_pct: string | null
  realized_gl: string
  dividends_collected: string
  annual_dividend: string | null
  annual_income: string | null
  yield_pct: string | null
  yoc_pct: string | null
  xirr_pct: string | null
  accounts: string[]
  warnings: string[]
}

export interface HoldingsTotals {
  market_value: string
  cost_basis: string
  unrealized_gl: string
  unrealized_gl_pct: string | null
  day_change_amount: string | null
  day_change_pct: string | null
  realized_gl: string
  dividends_collected: string
  annual_income: string
  unpriced_count: number
}

export interface HoldingsResponse {
  /** OLDEST quote timestamp — the staleness clock ("Prices as of", attention strip). */
  as_of: string | null
  /** NEWEST quote timestamp — dates the performance chart's live ping. Never swap the
   * two: a stale manual quote in as_of would drag the ping behind the weekly series'
   * end and silently retire it. */
  latest_quote_at: string | null
  totals: HoldingsTotals
  holdings: HoldingOut[]
}

export interface AllocationSlice {
  key: string
  market_value: string
  weight_pct: string
  holdings: number
}

export interface AllocationResponse {
  by: AllocationDimension
  total_market_value: string
  slices: AllocationSlice[]
}

// GET /portfolio/history — parallel arrays (NetWorthTimeseries posture); index i across
// all five lists is one weekly imported point. sp500 is the sheet's baseline: the
// STARTING balance benchmarked into VOO shares. benchmark is the contribution-matched
// leg, derived server-side at read time — every inferred contribution buys VOO instead.
// Entries are Decimal strings wherever computable; all-null only when VOO has no bars.
export interface PortfolioHistory {
  dates: string[]
  market_value: string[]
  cost_basis: string[]
  sp500: string[]
  benchmark: (string | null)[]
}

export interface RealizedRow {
  security_id: number
  ticker: string
  name: string
  realized_gl: string
}

export interface RealizedResponse {
  total: string
  rows: RealizedRow[]
}

export interface RefreshResult {
  updated: string[]
  failed: Record<string, string>
  skipped_manual: string[]
  duration_ms: number
  dividends_ingested: number
}

// GET /prices/refresh-status — the persisted outcome of the most recent refresh run
// (manual or scheduled) plus the live scheduler's next fire.
export interface LastRefresh {
  at: string
  trigger: string
  updated: number
  failed: Record<string, string>
  skipped_manual: number
  history_appended: boolean
  // Optional, not required: a payload stored before the dividend feature shipped carries
  // none of these keys and the server echoes nulls for it (stale-deploy armor).
  dividends_ingested?: number | null
  dividends_removed?: number | null
  dividends_skipped_overlap?: number | null
}

export interface RefreshStatus {
  /** null before the first recorded run. */
  last: LastRefresh | null
  /** null when no scheduler is running (SCHEDULER_ENABLED=0). */
  next_run_at: string | null
}

export interface PricePoint {
  d: string
  c: string
}

// GET /prices/history/{ticker}?days= — daily closes, oldest first (the holding drill-in's
// chart feed; the sparklines endpoint is the weekly-downsampled cousin).
export interface PriceHistoryResponse {
  ticker: string
  points: PricePoint[]
}

// Partial: a held security with no bars is ABSENT (not []) — consumers must `?? []`
// (Task 12 review M1).
export type SparklinesResponse = Partial<Record<string, PricePoint[]>>

export interface LatestPriceOut {
  security_id: number
  price: string
  quoted_at: string
  source: 'yfinance' | 'manual'
}

// --- taxes ---
// Money, rates and effective rates are pydantic Decimals on the wire — JSON strings, at
// the quantum the router picked: inputs 4dp, bracket rates 4dp, thresholds 2dp, summary
// money 2dp, effective rates 6dp.

export interface TaxYearOut {
  year: number
  notes: string | null
  input_count: number
  bracket_count: number
}

export interface TaxInputItemOut {
  key: string
  label: string
  sort_order: number
  is_derived: boolean
  value: string | null
  // The sheet's gray-cell formula for this key, when it has one. Advisory: the UI offers
  // a chip, nothing is ever applied server-side. Present-ness (not is_derived) is what a
  // chip renders on.
  suggested: string | null
}

export interface TaxInputSectionOut {
  section: string
  items: TaxInputItemOut[]
}

export interface TaxInputsOut {
  year: number
  sections: TaxInputSectionOut[]
}

// PUT body — keys unknown to the definition table are a 422, and a null VALUE unsets
// (deletes) that stored input rather than storing a 0.
export interface TaxInputsUpdate {
  values: Record<string, string | null>
}

export interface TaxBracketOut {
  bracket_index: number
  rate: string
  threshold: string
}

// The PUT element. `bracket_index` is renumbered server-side on every replace and a
// round-tripped one is ignored, so an edited TaxBracketOut VARIABLE can be handed straight
// back (a fresh object literal carrying bracket_index trips excess-property checking).
export interface TaxBracketIn {
  rate: string
  threshold: string
}

// A Record, not a fixed key set: the six known jurisdictions are always present, and an
// importer-written extra one survives a read. Drive render order from `JURISDICTIONS`
// (src/api/taxes.ts) and append whatever else came back.
export interface TaxBracketsOut {
  year: number
  jurisdictions: Record<string, TaxBracketOut[]>
}

// Per-jurisdiction FULL REPLACE: a jurisdiction absent from the body is untouched, and
// an empty array deletes its table. Unknown jurisdiction names are a 422.
export interface TaxBracketsUpdate {
  jurisdictions: Record<string, TaxBracketIn[]>
}

export interface IncomeTaxOut {
  agi: string
  taxable_income: string
  tax: string
  effective_rate: string | null
}

export interface WageTaxOut {
  w2_income: string
  taxable_wages: string
  tax: string
  effective_rate: string | null
}

export interface CapitalGainsTaxOut {
  taxable_income: string // the ordinary income the gains stack on top of
  gains_amount: string
  tax: string
  effective_rate: string | null // null when there are no gains (the sheet's #DIV/0!)
}

export interface TaxTotalsOut {
  gross_income: string
  total_income: string
  total_tax: string
  take_home: string
  effective_rate: string | null
}

export interface TaxSummaryOut {
  year: number
  federal: IncomeTaxOut
  state: IncomeTaxOut
  medicare: WageTaxOut
  social_security: WageTaxOut
  disability: WageTaxOut
  capital_gains: CapitalGainsTaxOut
  totals: TaxTotalsOut
  warnings: string[]
}

export interface TaxSummariesOut {
  years: TaxSummaryOut[]
}

// --- taxes: what-if ---
// POST /taxes/what-if — a scenario run against a STORED year; nothing is written. The
// request halves mirror backend/app/schemas/taxes.py's WhatIfIn field-for-field (an
// omitted `price`/`sale_price` means "use the latest quote", and an omitted `term` means
// "long", with a warning when the lot's acquisition dates are unknown). Money and rates
// arrive as Decimal strings at the summary's own quanta — money 2dp, effective rates 6dp
// — and are rendered verbatim, never re-derived from the two summaries.

export interface SaleLegIn {
  security_id: number
  shares: string
  price?: string
  term?: 'long' | 'short'
}

export interface EsppSaleIn {
  lot_id: number
  sale_price?: string
}

export interface WhatIfDelta {
  total_tax: string
  take_home: string
  federal_tax: string
  state_tax: string
  medicare_tax: string
  social_security_tax: string
  disability_tax: string
  capital_gains_tax: string
  // A fraction delta (scenario − baseline); null when either side has no rate at all.
  effective_rate: string | null
}

export interface ChangedInput {
  key: string
  label: string
  before: string // "0.00" when the key had no stored row (2dp, _money-rendered)
  after: string
}

export interface SaleDetailOut {
  security_id: number
  ticker: string
  shares: string
  price: string
  proceeds: string
  cost_basis: string
  gain: string
  term: string
  warnings: string[]
}

export interface EsppSaleDetailOut {
  lot_id: number
  purchase_date: string
  shares: string
  sale_price: string
  proceeds: string
  ordinary_income: string
  capital_gain: string
  term: string
  disposition: string
  warnings: string[]
}

export interface WhatIfOut {
  year: number
  baseline: TaxSummaryOut
  scenario: TaxSummaryOut
  delta: WhatIfDelta
  changed_inputs: ChangedInput[]
  sale_details: SaleDetailOut[]
  espp_sale_details: EsppSaleDetailOut[]
  warnings: string[]
}

// --- taxes: the "Will I owe?" tracker ---
// GET /taxes/years/{year}/withholding — the CURRENT year only (any other year is a 422,
// even a stored one) and computed end to end at read time from paycheck profiles, RSU
// grants, employer prices and the bracket tables; nothing in it is persisted. Money is 2dp
// Decimal strings. Every input is a soft link that can break — a missing ticker, no bar
// behind a past vest, no current quote, an unschedulable grant, an unusable profile — and
// each break EXCLUDES that piece from the estimate and names itself in `warnings` rather
// than failing the read, so the warnings are part of the number, not decoration.

/** Withholding received so far vs the full-year estimate — the shape both legs below wear. */
export interface WithholdingLegOut {
  ytd: string
  projected: string
}

export interface WithholdingOut {
  year: number
  // The engine's liability for the year — the same figure TaxSummaryOut.totals.total_tax
  // carries, verbatim.
  liability_total: string
  // The salary leg is all-in: the user's withholding_pct already carries its FICA, so no
  // salary-side FICA is added anywhere.
  salary: WithholdingLegOut
  vest: {
    // The vest BASE (fmv x shares) the two tax legs below were computed on — reported so
    // the card can show its own inputs.
    income_ytd: string
    income_projected: string
    supplemental_ytd: string
    supplemental_projected: string
    fica_ytd: string
    fica_projected: string
  }
  total: WithholdingLegOut
  // liability_total - total.projected: POSITIVE means "will owe", negative is a refund.
  balance_projected: string
  // Paychecks received / expected this year — the progress denominator for the salary leg.
  checks_elapsed: number
  checks_total: number
  // Null in two different silences. A MISSING prior year says nothing at all — a first year
  // on the app has no comparison to make and no warning to raise. A prior year that EXISTS
  // but computes a total tax <= 0 does warn, because a threshold anything clears would make
  // a met=true badge a false all-clear.
  safe_harbor: {
    prior_year: number
    prior_total_tax: string
    threshold: string // prior_total_tax x 1.10
    met: boolean // total.projected >= threshold
  } | null
  warnings: string[]
}

// --- espp ---
// espp_lots prices are 5dp (the one place in the app that is not 4dp), shares 4dp,
// period money 2dp, contribution_pct 9dp ("0.130000000"), modeler money 2dp and
// gain_pct 6dp. Modeler share COUNTS are Decimals too, so they arrive as strings ("78")
// even though the chain's INT() keeps them whole.

export interface EsppLotOut {
  id: number
  purchase_date: string
  qualifying_date: string
  shares: string
  subscription_price: string
  purchase_fmv: string
  purchase_price: string
  sold_date: string | null
  sold_price: string | null
  notes: string | null
  // --- computed (espp_calc.lot_metrics); the market fields are null when the
  // espp_ticker soft link dangles, or when a sold row is missing its price.
  // days_until_qualified is null for sold lots.
  cost_basis: string
  market_value: string | null
  gain_amount: string | null
  gain_pct: string | null
  qualified: boolean
  days_until_qualified: number | null
  is_sold: boolean
}

export interface EsppLotCreate {
  purchase_date: string
  qualifying_date: string
  shares: string
  subscription_price: string
  purchase_fmv: string
  // Omitted (or null) means "use the 85% default" — the server derives
  // 0.85 x min(subscription_price, purchase_fmv) at 5dp.
  purchase_price?: string | null
  // The disposition pair must be set (or cleared) together.
  sold_date?: string | null
  sold_price?: string | null
  notes?: string | null
}

// PATCH: the NOT NULL columns take a value or are omitted — an explicit null on one of
// them is a server-side no-op, so it is not in the type. `purchase_price: null` is the
// exception that DOES mean something: re-derive the 85% default from the merged row.
// The sold pair and notes are nullable columns, where null really clears.
export type EsppLotUpdate = Partial<EsppLotCreate>

export interface EsppLotsResponse {
  // The quote the whole table was priced against. current_price/quoted_at are null at
  // every break in the soft link; espp_ticker itself is null only when the SETTING is
  // missing (a configured ticker echoes even if no security/price row exists).
  espp_ticker: string | null
  current_price: string | null
  quoted_at: string | null
  lots: EsppLotOut[]
}

export interface EsppOfferingOut {
  id: number
  offering_start: string
  // Numeric(14,5) — render verbatim (kind="plain" column), never formatCurrency's 2dp.
  subscription_price: string
  notes: string | null
}

export interface EsppOfferingCreate {
  offering_start: string
  subscription_price: string
  notes?: string | null
}

// offering_start / subscription_price are NOT NULL (value or omit); notes: null clears.
export type EsppOfferingUpdate = Partial<EsppOfferingCreate>

export interface EsppPeriodOut {
  id: number
  label: string
  period_start: string
  period_end: string
  semi_annual_base: string
  additional_payments: string
  contribution_pct: string // 9dp
}

export interface EsppPeriodCreate {
  label: string
  period_start: string
  period_end: string
  semi_annual_base: string
  additional_payments?: string
  contribution_pct: string
}

// Every stored column here is NOT NULL, so a field is either sent with a value or left
// out — an explicit null is a server-side no-op and has no place in the type.
export type EsppPeriodUpdate = Partial<EsppPeriodCreate>

// One modeled row — a stored espp_periods row verbatim, or a derived slot-filler
// (stored=false, id=null) that materializes only when saved via POST /espp/periods.
export interface EsppModelerPeriod {
  id: number | null
  stored: boolean
  label: string
  period_start: string
  period_end: string
  semi_annual_base: string
  additional_payments: string
  contribution_pct: string // 9dp fraction
  // The price this row was chained at + provenance (offering_start null = quote/override).
  subscription_price: string
  offering_start: string | null
  // --- computed chain (espp_calc.run_modeler)
  eligible_earnings: string
  contribution: string
  available: string
  purchase_price: string
  shares_before_limit: string
  unused_25k: string // remaining limit at the START of this period
  max_shares_25k: string
  over_limit: boolean
  shares: string
  cost: string
  carry_forward_out: string
  refund: string
  value_25k: string
}

export interface EsppModelerTotals {
  total_25k_value: string
  out_of_pocket_cost: string
  fmv_of_shares: string
  remaining_25k: string // 25000 - total_25k_value, for the gauge
}

export interface EsppModelerOut {
  year: number
  espp_ticker: string | null
  // LEGACY (stale-tab armor): "params" iff both prices overridden. New UI reads the two
  // source fields below.
  price_source: 'params' | 'latest_price'
  subscription_source: 'override' | 'offering' | 'latest_price' | 'mixed'
  fmv_source: 'override' | 'latest_price'
  // Provenance, not data: null whenever no stored quote is behind the numbers.
  quoted_at: string | null
  // The override echo — null when offerings/quote drive per-period (blank knob = smart
  // default; the box is never seeded from this).
  subscription_price: string | null
  purchase_fmv: string
  carry_forward: string
  // Server-owned year-chip list (stored ∪ offering-covered ∪ {now, now+1}), sorted.
  available_years: number[]
  warnings: string[]
  periods: EsppModelerPeriod[]
  totals: EsppModelerTotals
}

// --- paycheck ---

export interface PaycheckProfileOut {
  id: number
  effective_date: string
  annual_salary: string
  pay_periods_per_year: number
  // The five pcts are Numeric(10,9) — 9dp strings, e.g. "0.130000000".
  trad_401k_pct: string
  roth_401k_pct: string
  after_tax_401k_pct: string
  espp_pct: string
  withholding_pct: string
  dental_vision_per_check: string
  hsa_per_check: string
  notes: string | null
}

export interface PaycheckProfileCreate {
  effective_date: string
  annual_salary: string
  pay_periods_per_year?: number // the sheet's 24 (semi-monthly) is the default
  trad_401k_pct?: string
  roth_401k_pct?: string
  after_tax_401k_pct?: string
  espp_pct?: string
  withholding_pct?: string
  dental_vision_per_check?: string
  hsa_per_check?: string
  notes?: string | null
}

// PATCH: every stored column except `notes` is NOT NULL, so those are sent with a value
// or omitted (an explicit null would be a server-side no-op). Only `notes: null` clears.
export type PaycheckProfileUpdate = Partial<PaycheckProfileCreate>

// One check in the sheet's waterfall order, plus the monthly roll-up. Every line is a
// 2dp display value of a full-precision chain, so the lines may not reconcile to
// `net_pay` by a cent — `net_pay` is the authoritative one, and none of these are ever
// re-derived on the client.
export interface PaycheckBreakdownOut {
  profile: PaycheckProfileOut
  gross: string
  trad_401k: string
  dental_vision: string
  hsa: string
  taxable: string
  withholding: string
  post_tax: string
  roth_401k: string
  after_tax_401k: string
  espp: string
  net_pay: string
  monthly_net: string
  warnings: string[]
}

// --- comp ---

export interface CompEventOut {
  id: number
  focal_year: number
  current_base: string
  new_base: string | null
  unvested_rsus: string | null
  unvested_price: string | null
  refresh_rsus: string | null
  grant_price: string | null
  notes: string | null
  // --- computed (comp_calc.metrics): 2dp money, 6dp percentages, null wherever an input
  // is missing — and equity_delta_pct is also null on a zero denominator (rsus 0 is a
  // legal write) or a ratio past 1e12.
  base_delta: string | null
  base_delta_pct: string | null
  unvested_equity: string | null
  equity_delta: string | null
  equity_delta_pct: string | null
  // Total comp proxy = base + unvested equity (+ the refresh grant, after). The "after"
  // base is (new_base ?? current_base) — chart math deriving equity as tc_after - base
  // must use that same selection or a raise silently folds into the equity stack.
  // Never null: current_base is NOT NULL and every missing side contributes 0.
  tc_before: string
  tc_after: string
}

export interface CompEventCreate {
  focal_year: number
  current_base: string
  new_base?: string | null
  unvested_rsus?: string | null
  unvested_price?: string | null
  refresh_rsus?: string | null
  grant_price?: string | null
  notes?: string | null
}

// PATCH, and the one place the house null convention splits: focal_year / current_base
// are NOT NULL (send a value or omit — a null there is a no-op), while an explicit null
// on any other field really CLEARS that column (a raise that never happened, a grant
// that was withdrawn). That is the deliberate difference from EsppLotUpdate.
export type CompEventUpdate = Partial<CompEventCreate>

// --- comp: RSU grants + the vesting schedule ---
// Grants store PARAMETERS only: vest rows are never persisted, so every read recomputes the
// schedule (a cliff, then 6.25% quarterly steps) and the vested split moves on its own
// between reads. Prices and percentages are 4dp Decimal strings — grant_price Numeric(14,4),
// cliff_pct Numeric(7,4) in (0, 1] — while `shares` here is a whole-share INT, not a string,
// because the column is one (the seed candidates below are the exception).

export interface RsuGrantOut {
  id: number
  // Router-validated membership, exactly as AccountGroup/HoldingType narrow their own plain
  // String columns; anything else is a 422 on the way in.
  kind: 'new_hire' | 'refresh'
  label: string // unique, <= 60 chars after trim — a duplicate is a 409
  focal_year: number | null
  shares: number
  grant_price: string
  first_vest_date: string
  cliff_pct: string
  // Shares-per-vest rounding (spec §8.2): each vest floors the cumulative entitlement to a
  // multiple of this, the final vest trues up. 1 = single shares (the refreshes); the real
  // offer grant vests in tens — both broker-verified.
  vest_quantum: number
  notes: string | null
  // --- computed (rsu_vesting), judged against the SERVER's day: never re-derive these on
  // the client, and never carry them across an edit — re-read the row instead.
  vest_count: number
  vested_shares: number
  unvested_shares: number
}

// POST, and PATCH takes a Partial of it. The null split lands differently from CompEventCreate
// above: only focal_year and notes are nullable columns, so only their explicit null CLEARS —
// on every other field a null is a server-side no-op (send a value or leave it out).
export interface RsuGrantCreate {
  kind: 'new_hire' | 'refresh'
  label: string
  focal_year?: number | null
  shares: number
  grant_price: string
  first_vest_date: string
  cliff_pct: string
  // Optional so pre-§8.2 callers keep working: the server defaults an omitted value to 1.
  vest_quantum?: number
  notes?: string | null
}

// PATCH, and the split is RsuGrantCreate's own (NOT CompEventUpdate's): kind, label, shares,
// grant_price, first_vest_date and cliff_pct are NOT NULL — send a value or omit, because an
// explicit null on one of them is a server-side no-op. Only focal_year and notes are nullable
// columns, where a null really CLEARS. The merged row is re-validated, so a PATCH gets a
// POST's rules and a delta body must still satisfy them.
export type RsuGrantUpdate = Partial<RsuGrantCreate>

// One tranche of one grant. A past vest is priced at the stored close ON OR BEFORE its date
// (what the stock was worth THEN); a future one is left unpriced here and valued at the
// latest quote by the tiles only. Both money fields are null when no such bar exists, and a
// zero-share tranche is a real event that stays in the list.
export interface VestOut {
  vest_date: string
  grant_id: number
  label: string
  shares: number
  fmv: string | null
  value: string | null // fmv x shares, 2dp
  is_past: boolean
}

// One vest DATE across every grant — the table's summary row (2026-08-21 revision). Every
// past tranche on a day priced at the SAME close, so `fmv` is that one close (never an
// average) and `value` is close x summed shares — which can differ from the sum of the
// individually rounded tranche values by up to half a cent per tranche. Future days carry
// the latest quote x summed shares — an estimate, and `value_is_estimate` is how the row
// says so. Unpriced either way is null. The per-grant breakdown for a date is its `vests`
// entries.
export interface VestDayOut {
  vest_date: string
  is_past: boolean
  tranche_count: number
  shares: number
  fmv: string | null
  value: string | null
  value_is_estimate: boolean
}

// A prefill for a focal year that has refresh RSUs on its comp event but no grant yet — the
// chips above the grants form, never a row the server wrote. `shares` is comp_events.refresh_rsus
// verbatim at its 4dp scale (a string, unlike the whole-share ints above); the grant writer is
// what enforces whole shares, so the chip's prefill has to land an integer in the box.
export interface SeedCandidateOut {
  focal_year: number
  shares: string
  grant_price: string
  suggested_first_vest_date: string
  suggested_label: string
}

// GET /comp/vesting-schedule — the whole Comp card set in one read-only payload, computed
// end to end. The ticker -> security -> quote/history chain is a soft link that breaks at any
// hop, so every price-dependent field is nullable and `warnings` names each break; a grant
// too broken to schedule is dropped from BOTH lists with a warning naming it.
export interface VestingScheduleOut {
  ticker: string | null
  latest_price: string | null
  quoted_at: string | null
  grants: RsuGrantOut[]
  vests: VestOut[] // chronological across grants, past and future together
  vest_days: VestDayOut[] // `vests` grouped by date — the table's rows (2026-08-21 revision)
  tiles: {
    next_vest: { vest_date: string; shares: number; est_value: string | null } | null
    unvested_shares: number
    unvested_value: string | null
    vested_this_year_shares: number
    // The PRICED SUBSET ONLY — a vest whose date has no stored close is in the share count
    // above and not in this figure. Null (not "0.00") when nothing vested this year could be
    // priced at all: those vests happened and their value is unknown, and a confident zero
    // would be a different claim.
    vested_this_year_income: string | null
  }
  seed_candidates: SeedCandidateOut[]
  // Informational only: focal history and a grant disagreeing is a hint, never an error —
  // the grant is the vesting truth. Kept apart from `warnings` so the UI can tone them apart.
  drift_warnings: string[]
  warnings: string[]
}

// --- projection ---
// GET /projection — the FIRE modeler (the ESPP modeler's shape: knobs as query params,
// the echo is what the page's form seeds from). Money 2dp; rates 6dp when a param was
// quantized, verbatim seeds otherwise ("0.05" / "0.04").

export interface ProjectionOut {
  starting_balance: string
  /** The snapshot month the starting balance came from. */
  base_month: string
  /** The projection's t0 — the current calendar month. */
  start_month: string
  annual_return: string
  monthly_contribution: string
  annual_spend: string | null
  swr_pct: string
  years: number
  fi_target: string | null
  fi_ratio: string | null
  fi_month: string | null
  coast_fi_month: string | null
  // Parallel arrays: index i across all three is one month.
  months: string[]
  projected: string[]
  coast: string[]
  warnings: string[]
  // Monte Carlo. The three assumption echoes name what the run actually used, and a live
  // server always sends them (absent knobs default server-side) — they stay NULLABLE for
  // a stale backend, which the page reads as "no placeholder". `bands` and the probability
  // block are null whenever volatility was an explicit 0 (the fan's off switch).
  volatility: string | null
  inflation: string | null
  contribution_growth: string | null
  /** Keys "p10"/"p25"/"p50"/"p75"/"p90"; each list is parallel to `months`. */
  bands: Record<string, string[]> | null
  fi_probability: string | null
  fi_month_p10: string | null
  fi_month_p50: string | null
  fi_month_p90: string | null
}

// --- import (mirrors backend/app/importer/report.py) ---

export interface ImportEntityCounts {
  creates: number
  updates: number
  skips: number
  deletes: number
}

export interface ImportSheetReport {
  entities: Record<string, ImportEntityCounts>
  warnings: string[]
  errors: string[]
  samples: string[]
  samples_truncated: number
}

// sheets always carries all nine keys (report.SHEET_KEYS), even when a sheet is clean.
export interface ImportReport {
  dry_run: boolean
  applied: boolean
  sheets: Record<string, ImportSheetReport>
}

// --- app settings ---

export interface AppSettingsOut {
  swr_pct: string
  espp_ticker: string | null
  price_refresh_cron: string
}

// PUT is full-form (the paycheck/espp whole-form law): all three settings every time.
export type AppSettingsUpdate = AppSettingsOut
