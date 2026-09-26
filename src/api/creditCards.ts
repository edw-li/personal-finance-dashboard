import { api, apiDeleteLogged, apiLogged } from './client'
import type { Logged } from './client'
import type {
  CardCreditIn,
  CardCreditOut,
  CreditCardIn,
  CreditCardOut,
  CreditLimitEventIn,
  CreditLimitEventOut,
  RewardCategoryCreate,
  RewardCategoryOut,
  RewardCategoryUpdate,
  RewardRateOut,
  RewardRatePut,
} from '../types/api'

export function fetchCreditCards(): Promise<CreditCardOut[]> {
  return api<CreditCardOut[]>('/credit-cards')
}

export function createCreditCard(body: CreditCardIn): Promise<CreditCardOut> {
  return api<CreditCardOut>('/credit-cards', { method: 'POST', body: JSON.stringify(body) })
}

// Full-object PATCH (the router validates the whole card), house style.
export function updateCreditCard(id: number, body: CreditCardIn): Promise<CreditCardOut> {
  return api<CreditCardOut>(`/credit-cards/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

/** updateCreditCard's twin for the one-click Archive / Unarchive (2026-09-25 polish spec §6.2): the
 *  same PATCH, answered with the change batch the toggle's Undo toast reverts. */
export function updateCreditCardLogged(id: number, body: CreditCardIn): Promise<Logged<CreditCardOut>> {
  return apiLogged<CreditCardOut>(`/credit-cards/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

// Logged (spec §6.1): the undo brings the card back with its credits, multipliers, limit history
// and the categories pinned to it — null when nothing was recorded.
export function deleteCreditCard(id: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/credit-cards/${id}`)
}

/** Drag-to-reorder the card list (2026-09-23 spec §3.2): `ids` is every card, active and
 *  inactive, in its new order; the answer is the list exactly as fetchCreditCards returns it.
 *  Unlogged server-side — the caller's Undo re-sends the previous order. */
export function reorderCreditCards(ids: number[]): Promise<CreditCardOut[]> {
  return api<CreditCardOut[]>('/credit-cards/order', {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  })
}

export function createCardCredit(cardId: number, body: CardCreditIn): Promise<CardCreditOut> {
  return api<CardCreditOut>(`/credit-cards/${cardId}/credits`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateCardCredit(creditId: number, body: CardCreditIn): Promise<CardCreditOut> {
  return api<CardCreditOut>(`/credit-cards/credits/${creditId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteCardCredit(creditId: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/credit-cards/credits/${creditId}`)
}

// Response is the card's FULL limit history, ascending — the editor renders it
// without a second fetch (the budgets-PUT precedent).
export function createLimitEvent(
  cardId: number,
  body: CreditLimitEventIn,
): Promise<CreditLimitEventOut[]> {
  return api<CreditLimitEventOut[]>(`/credit-cards/${cardId}/limits`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function deleteLimitEvent(cardId: number, eventId: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/credit-cards/${cardId}/limits/${eventId}`)
}

export function fetchRewardCategories(): Promise<RewardCategoryOut[]> {
  return api<RewardCategoryOut[]>('/credit-cards/categories')
}

export function createRewardCategory(body: RewardCategoryCreate): Promise<RewardCategoryOut> {
  return api<RewardCategoryOut>('/credit-cards/categories', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateRewardCategory(
  id: number,
  body: RewardCategoryUpdate,
): Promise<RewardCategoryOut> {
  return api<RewardCategoryOut>(`/credit-cards/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

/** updateRewardCategory's twin for the one-click Hide / Show (spec §6.2): the same PATCH, answered
 *  with the change batch the toggle's Undo toast reverts. */
export function updateRewardCategoryLogged(
  id: number,
  body: RewardCategoryUpdate,
): Promise<Logged<RewardCategoryOut>> {
  return apiLogged<RewardCategoryOut>(`/credit-cards/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

// Logged (spec §6.1): the undo brings the category back with its multipliers.
export function deleteRewardCategory(id: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/credit-cards/categories/${id}`)
}

/** One PUT for the whole Categories & weights order (2026-09-23 spec §3.2) — it replaces the
 *  per-row PATCH chain. `ids` is every reward category in its new order. Unlogged server-side;
 *  the caller's Undo re-sends the previous order. */
export function reorderRewardCategories(ids: number[]): Promise<RewardCategoryOut[]> {
  return api<RewardCategoryOut[]>('/credit-cards/categories/order', {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  })
}

export function fetchRewardRates(): Promise<RewardRateOut[]> {
  return api<RewardRateOut[]>('/credit-cards/rates')
}

// Bulk upsert; multiplier null deletes a cell. Returns the full post-save list.
export function putRewardRates(body: RewardRatePut[]): Promise<RewardRateOut[]> {
  return api<RewardRateOut[]>('/credit-cards/rates', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
