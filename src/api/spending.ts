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
  body: { net_pay?: string; amounts: AmountEntry[] },
): Promise<SpendingUpsertResult> {
  return api<SpendingUpsertResult>(`/spending/months/${month}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
