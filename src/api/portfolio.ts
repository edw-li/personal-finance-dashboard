import { api } from './client'
import type {
  AllocationDimension,
  AllocationResponse,
  DividendCreate,
  DividendOut,
  DividendUpdate,
  HoldingsResponse,
  PortfolioHistory,
  RealizedResponse,
  SecurityCreate,
  SecurityOut,
  SecurityUpdate,
  TransactionCreate,
  TransactionOut,
  TransactionUpdate,
} from '../types/api'

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

export function fetchTransactions(): Promise<TransactionOut[]> {
  return api<TransactionOut[]>('/portfolio/transactions')
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

export function fetchDividends(): Promise<DividendOut[]> {
  return api<DividendOut[]>('/portfolio/dividends')
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

export function fetchHoldings(): Promise<HoldingsResponse> {
  return api<HoldingsResponse>('/portfolio/holdings')
}

export function fetchAllocation(by: AllocationDimension): Promise<AllocationResponse> {
  return api<AllocationResponse>(`/portfolio/allocation?by=${by}`)
}

export function fetchHistory(): Promise<PortfolioHistory> {
  return api<PortfolioHistory>('/portfolio/history')
}

export function fetchRealized(): Promise<RealizedResponse> {
  return api<RealizedResponse>('/portfolio/realized')
}
