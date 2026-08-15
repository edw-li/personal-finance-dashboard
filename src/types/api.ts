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
