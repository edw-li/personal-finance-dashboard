import { api } from './client'
import type {
  AmountEntry,
  CategoryOut,
  SpendingMatrix,
  SpendingMonth,
  SpendingUpsertResult,
  SpendingYearly,
} from '../types/api'

export function fetchCategories(): Promise<CategoryOut[]> {
  return api<CategoryOut[]>('/spending/categories')
}

export function fetchMatrix(): Promise<SpendingMatrix> {
  return api<SpendingMatrix>('/spending/matrix')
}

export function fetchYearly(): Promise<SpendingYearly> {
  return api<SpendingYearly>('/spending/yearly')
}

export function fetchSpendingMonth(month: string): Promise<SpendingMonth> {
  return api<SpendingMonth>(`/spending/months/${month}`)
}

export function putSpendingMonth(
  month: string,
  // net_pay is tri-state: omitted leaves the saved value alone, a string upserts it, and
  // an explicit null CLEARS the month's cashflow row (mirrors the notes: null contract).
  body: { net_pay?: string | null; amounts: AmountEntry[] },
): Promise<SpendingUpsertResult> {
  return api<SpendingUpsertResult>(`/spending/months/${month}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
