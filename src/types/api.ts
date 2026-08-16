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
