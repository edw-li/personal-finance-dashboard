import { api } from './client'
import type {
  AccountCreate,
  AccountOut,
  AccountUpdate,
  BalanceEntry,
  MonthBalances,
  MonthUpsertResult,
  NetWorthSummary,
  NetWorthTimeseries,
  SuggestionsOut,
} from '../types/api'

export function fetchAccounts(): Promise<AccountOut[]> {
  return api<AccountOut[]>('/net-worth/accounts')
}

export function createAccount(body: AccountCreate): Promise<AccountOut> {
  return api<AccountOut>('/net-worth/accounts', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateAccount(id: number, body: AccountUpdate): Promise<AccountOut> {
  return api<AccountOut>(`/net-worth/accounts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function fetchTimeseries(
  granularity: 'monthly' | 'quarterly' = 'monthly',
): Promise<NetWorthTimeseries> {
  return api<NetWorthTimeseries>(`/net-worth/timeseries?granularity=${granularity}`)
}

export function fetchSummary(): Promise<NetWorthSummary> {
  return api<NetWorthSummary>('/net-worth/summary')
}

// Advisory "now" values for accounts mapped via suggest_source (spec §5.2) — read-only,
// takes no month: the figures are today's, which is why the wizard only offers them on the
// anchor month.
export function fetchSuggestions(): Promise<SuggestionsOut> {
  return api<SuggestionsOut>('/net-worth/suggestions')
}

export function fetchMonthBalances(month: string): Promise<MonthBalances> {
  return api<MonthBalances>(`/net-worth/months/${month}`)
}

export function putMonthBalances(
  month: string,
  // notes: null CLEARS a saved note server-side; undefined leaves it untouched.
  body: { recorded_on?: string; notes?: string | null; balances: BalanceEntry[] },
): Promise<MonthUpsertResult> {
  return api<MonthUpsertResult>(`/net-worth/months/${month}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
