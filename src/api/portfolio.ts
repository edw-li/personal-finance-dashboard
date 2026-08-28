import { api } from './client'
import type { OwnerScope } from './netWorth'
import type {
  AllocationDimension,
  AllocationResponse,
  DividendCreate,
  DividendOut,
  DividendUpdate,
  HoldingsResponse,
  PortfolioAccountOut,
  PortfolioAccountUpdate,
  PortfolioHistory,
  RealizedResponse,
  SecurityCreate,
  SecurityOut,
  SecurityUpdate,
  TransactionCreate,
  TransactionOut,
  TransactionUpdate,
} from '../types/api'

// ONE ownership vocabulary across the app (spec §4.1: "net-worth grammar"). Re-exported so
// a caller that only talks to the portfolio endpoints imports the type from the module it
// is calling; `import type` is erased at build time, so this is not a runtime edge between
// the two clients.
export type { OwnerScope }

// The `?`-vs-`&` decision, made once: /holdings, /transactions, /dividends and /realized
// carry no other param, /allocation always carries by=. null builds the EMPTY string — the
// household request has to stay byte-identical to the pre-ownership one.
function ownerQuery(owner: OwnerScope, prefix: '?' | '&'): string {
  return owner === null ? '' : `${prefix}owner=${owner}`
}

export function fetchSecurities(): Promise<SecurityOut[]> {
  return api<SecurityOut[]>('/portfolio/securities')
}

export function createSecurity(body: SecurityCreate): Promise<SecurityOut> {
  return api<SecurityOut>('/portfolio/securities', { method: 'POST', body: JSON.stringify(body) })
}

export function updateSecurity(id: number, body: SecurityUpdate): Promise<SecurityOut> {
  return api<SecurityOut>(`/portfolio/securities/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteSecurity(id: number): Promise<void> {
  return api<void>(`/portfolio/securities/${id}`, { method: 'DELETE' })
}

export function fetchTransactions(owner: OwnerScope = null): Promise<TransactionOut[]> {
  return api<TransactionOut[]>(`/portfolio/transactions${ownerQuery(owner, '?')}`)
}

export function createTransaction(body: TransactionCreate): Promise<TransactionOut> {
  return api<TransactionOut>('/portfolio/transactions', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateTransaction(id: number, body: TransactionUpdate): Promise<TransactionOut> {
  return api<TransactionOut>(`/portfolio/transactions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteTransaction(id: number): Promise<void> {
  return api<void>(`/portfolio/transactions/${id}`, { method: 'DELETE' })
}

export function fetchDividends(owner: OwnerScope = null): Promise<DividendOut[]> {
  return api<DividendOut[]>(`/portfolio/dividends${ownerQuery(owner, '?')}`)
}

export function createDividend(body: DividendCreate): Promise<DividendOut> {
  return api<DividendOut>('/portfolio/dividends', { method: 'POST', body: JSON.stringify(body) })
}

/**
 * The dividend PATCH shipped server-side unwired; this is its first caller. The body is
 * `DividendUpdate` — createDividend's minus the immutable security_id, derived in
 * types/api.ts by the same formula as TransactionUpdate, so the two can never drift
 * apart. (The server refuses an explicit null for amount/pay_date — 422, "cannot be
 * null" — so a sparse caller may omit them but must not blank them.)
 */
export function updateDividend(id: number, body: DividendUpdate): Promise<DividendOut> {
  return api<DividendOut>(`/portfolio/dividends/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteDividend(id: number): Promise<void> {
  return api<void>(`/portfolio/dividends/${id}`, { method: 'DELETE' })
}

export function fetchHoldings(owner: OwnerScope = null): Promise<HoldingsResponse> {
  return api<HoldingsResponse>(`/portfolio/holdings${ownerQuery(owner, '?')}`)
}

export function fetchAllocation(
  by: AllocationDimension,
  owner: OwnerScope = null,
): Promise<AllocationResponse> {
  return api<AllocationResponse>(`/portfolio/allocation?by=${by}${ownerQuery(owner, '&')}`)
}

// Household-wide by design (spec §2 decision log): one row per Monday, so a per-owner
// series would have nothing honest to say. No owner param here, ever.
export function fetchHistory(): Promise<PortfolioHistory> {
  return api<PortfolioHistory>('/portfolio/history')
}

export function fetchRealized(owner: OwnerScope = null): Promise<RealizedResponse> {
  return api<RealizedResponse>(`/portfolio/realized${ownerQuery(owner, '?')}`)
}

// The label roster — small, unparameterised, and the ONLY place portfolio ownership is
// read for editing (Settings' Portfolio accounts table).
export function fetchPortfolioAccounts(): Promise<PortfolioAccountOut[]> {
  return api<PortfolioAccountOut[]>('/portfolio/accounts')
}

export function patchPortfolioAccount(
  id: number,
  body: PortfolioAccountUpdate,
): Promise<PortfolioAccountOut> {
  return api<PortfolioAccountOut>(`/portfolio/accounts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}
