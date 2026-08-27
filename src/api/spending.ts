import { api } from './client'
import type {
  AmountEntry,
  CategoryBudgetEntry,
  CategoryCreate,
  CategoryOut,
  CategoryUpdate,
  SpendingMatrix,
  SpendingMonth,
  SpendingUpsertResult,
  SpendingYearly,
} from '../types/api'

export function fetchCategories(): Promise<CategoryOut[]> {
  return api<CategoryOut[]>('/spending/categories')
}

export function createCategory(body: CategoryCreate): Promise<CategoryOut> {
  return api<CategoryOut>('/spending/categories', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateCategory(categoryId: number, body: CategoryUpdate): Promise<CategoryOut> {
  return api<CategoryOut>(`/spending/categories/${categoryId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

// 409s once the category has monthly rows — the server's sentence names the count.
export function deleteCategory(categoryId: number): Promise<void> {
  return api<void>(`/spending/categories/${categoryId}`, { method: 'DELETE' })
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

// The response is the category's FULL budget history, ascending by month — the editor
// renders it without a second fetch (spec §3).
export function putCategoryBudget(
  categoryId: number,
  // amount null = "no budget from this month on" (a stored, dated end-marker).
  body: { amount: string | null; effective_month: string },
): Promise<CategoryBudgetEntry[]> {
  return api<CategoryBudgetEntry[]>(`/spending/categories/${categoryId}/budget`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

// Removes one history ROW (a mis-dated entry) — distinct from the null-amount marker.
export function deleteCategoryBudget(categoryId: number, effectiveMonth: string): Promise<void> {
  return api<void>(`/spending/categories/${categoryId}/budget/${effectiveMonth}`, {
    method: 'DELETE',
  })
}
