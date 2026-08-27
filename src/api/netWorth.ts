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

// PARTIAL patch by design: person_id/parent_account_id are the two nullable columns, so an
// explicit null RETAGS or UNLINKS while an omitted key leaves the column alone. Sending
// only the fields a control owns (e.g. { is_active }) is what keeps a stale render from
// overwriting a concurrent edit.
export function updateAccount(accountId: number, body: AccountUpdate): Promise<AccountOut> {
  return api<AccountOut>(`/net-worth/accounts/${accountId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

// 409s while the account has balance rows — the server's sentence names the count.
export function deleteAccount(accountId: number): Promise<void> {
  return api<void>(`/net-worth/accounts/${accountId}`, { method: 'DELETE' })
}

export function fetchTimeseries(
  granularity: 'monthly' | 'quarterly' = 'monthly',
): Promise<NetWorthTimeseries> {
  return api<NetWorthTimeseries>(`/net-worth/timeseries?granularity=${granularity}`)
}

export function fetchSummary(): Promise<NetWorthSummary> {
  return api<NetWorthSummary>('/net-worth/summary')
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
