import { api } from './client'
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

export function deleteCreditCard(id: number): Promise<void> {
  return api<void>(`/credit-cards/${id}`, { method: 'DELETE' })
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

export function deleteCardCredit(creditId: number): Promise<void> {
  return api<void>(`/credit-cards/credits/${creditId}`, { method: 'DELETE' })
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

export function deleteLimitEvent(cardId: number, eventId: number): Promise<void> {
  return api<void>(`/credit-cards/${cardId}/limits/${eventId}`, { method: 'DELETE' })
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

export function deleteRewardCategory(id: number): Promise<void> {
  return api<void>(`/credit-cards/categories/${id}`, { method: 'DELETE' })
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
