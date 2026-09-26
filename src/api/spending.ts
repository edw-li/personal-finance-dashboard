import { api, apiDeleteLogged, apiLogged, apiWithHeaders } from './client'
import type { Logged } from './client'
import type {
  BudgetSeedOut,
  BudgetSuggestionsOut,
  CategoryBudgetEntry,
  CategoryCreate,
  CategoryOut,
  CategoryUpdate,
  SpendingMatrix,
  SpendingMonth,
  SpendingMonthUpsert,
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

/** updateCategory's twin for the one-click Kind and Retire / Restore (2026-09-25 polish spec §6.2):
 *  the same PATCH, answered with the change batch the toggle's Undo toast reverts. */
export function updateCategoryLogged(
  categoryId: number,
  body: CategoryUpdate,
): Promise<Logged<CategoryOut>> {
  return apiLogged<CategoryOut>(`/spending/categories/${categoryId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

// 409s once the category has monthly rows — the server's sentence names the count. Logged (spec
// §6.1): the undo brings back its budgets and re-points the reward categories mapped to it.
export function deleteCategory(categoryId: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/spending/categories/${categoryId}`)
}

/** Drag-to-reorder (2026-09-23 spec §3.2): `ids` is EVERY category, retired included, in its
 *  new order. `batchId` is the change batch the Undo toast reverts — null when the order was
 *  unchanged and nothing was logged. */
export async function reorderCategories(
  ids: number[],
): Promise<{ data: CategoryOut[]; batchId: string | null }> {
  const { data, headers } = await apiWithHeaders<CategoryOut[]>('/spending/categories/order', {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  })
  return { data, batchId: headers.get('x-change-batch') }
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
  body: SpendingMonthUpsert,
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

// Removes one history ROW (a mis-dated entry) — distinct from the null-amount marker. Logged.
export function deleteCategoryBudget(
  categoryId: number,
  effectiveMonth: string,
): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/spending/categories/${categoryId}/budget/${effectiveMonth}`)
}

// The Budget card's suggestion figures (spec §2): one GET, read-only.
export function fetchBudgetSuggestions(): Promise<BudgetSuggestionsOut> {
  return api<BudgetSuggestionsOut>('/spending/budgets/suggestions')
}

// The one-click seed (spec §2): every seedable category's suggestion becomes a dated budget
// row from `effectiveMonth` (YYYY-MM-01) in ONE change batch — the response's batch_id is
// the Undo.
export function seedBudgets(effectiveMonth: string): Promise<BudgetSeedOut> {
  return api<BudgetSeedOut>('/spending/budgets/seed', {
    method: 'POST',
    body: JSON.stringify({ effective_month: effectiveMonth }),
  })
}

// 404 when the month has neither spending rows nor a cashflow row — "already gone". The 204
// carries the change batch (spec §9). `source: 'repair'` is the Data-health card's zero-month
// fix: the server logs the batch as a repair (still undoable) instead of a UI delete.
export async function deleteSpendingMonth(
  month: string,
  options: { source?: 'repair' } = {},
): Promise<{ batchId: string | null }> {
  const { headers } = await apiWithHeaders<void>(`/spending/months/${month}`, {
    method: 'DELETE',
    ...(options.source === undefined ? {} : { headers: { 'X-Change-Source': options.source } }),
  })
  return { batchId: headers.get('x-change-batch') }
}
