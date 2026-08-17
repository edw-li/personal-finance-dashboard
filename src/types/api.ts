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

export type AccountUpdate = Partial<
  Pick<AccountOut, 'name' | 'group' | 'sort_order' | 'is_active' | 'is_component'>
>

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
  notes: string | null
}

export interface DividendCreate {
  security_id: number
  account?: string | null
  pay_date: string
  amount: string
  notes?: string | null
}

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
  as_of: string | null
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
}

export interface PricePoint {
  d: string
  c: string
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
// round-tripped one is ignored, so an edited TaxBracketOut can be handed straight back.
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
  // The quote the whole table was priced against — null at every break in the link.
  espp_ticker: string | null
  current_price: string | null
  quoted_at: string | null
  lots: EsppLotOut[]
}

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

// The stored inputs are echoed so the modeler card renders without a second call.
export interface EsppModelerPeriod extends EsppPeriodOut {
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
  // A DIFFERENT union than HoldingOut's same-named field: "params" only when BOTH prices
  // came from the query string; any fallback to the ticker's latest quote is
  // "latest_price".
  price_source: 'params' | 'latest_price'
  // Provenance, not data: null whenever price_source is "params", because then no stored
  // quote is behind the numbers.
  quoted_at: string | null
  subscription_price: string
  purchase_fmv: string
  carry_forward: string
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
  // is missing.
  base_delta: string | null
  base_delta_pct: string | null
  unvested_equity: string | null
  equity_delta: string | null
  equity_delta_pct: string | null
  // Total comp proxy = base + unvested equity (+ the refresh grant, after). Never null:
  // current_base is NOT NULL and every missing side contributes 0.
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
