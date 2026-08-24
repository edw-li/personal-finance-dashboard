import { api } from './client'
import type {
  EsppLotCreate,
  EsppLotOut,
  EsppLotsResponse,
  EsppLotUpdate,
  EsppModelerOut,
  EsppOfferingCreate,
  EsppOfferingOut,
  EsppOfferingUpdate,
  EsppPeriodCreate,
  EsppPeriodOut,
  EsppPeriodUpdate,
} from '../types/api'

// --- lots ---

// Lots arrive ordered by (purchase_date, id).
export function fetchLots(): Promise<EsppLotsResponse> {
  return api<EsppLotsResponse>('/espp/lots')
}

// purchase_date is the natural key: a duplicate is a 409.
export function createLot(body: EsppLotCreate): Promise<EsppLotOut> {
  return api<EsppLotOut>('/espp/lots', { method: 'POST', body: JSON.stringify(body) })
}

// `purchase_price: null` re-derives the 85% default; every other null is a no-op except
// the sold pair and notes, which clear (see EsppLotUpdate).
export function updateLot(id: number, body: EsppLotUpdate): Promise<EsppLotOut> {
  return api<EsppLotOut>(`/espp/lots/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function deleteLot(id: number): Promise<void> {
  return api<void>(`/espp/lots/${id}`, { method: 'DELETE' })
}

// --- offerings ---

// Offerings arrive ascending by offering_start — the resolution order.
export function fetchOfferings(): Promise<EsppOfferingOut[]> {
  return api<EsppOfferingOut[]>('/espp/offerings')
}

// offering_start is the natural key: a duplicate is a 409.
export function createOffering(body: EsppOfferingCreate): Promise<EsppOfferingOut> {
  return api<EsppOfferingOut>('/espp/offerings', { method: 'POST', body: JSON.stringify(body) })
}

export function updateOffering(id: number, body: EsppOfferingUpdate): Promise<EsppOfferingOut> {
  return api<EsppOfferingOut>(`/espp/offerings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteOffering(id: number): Promise<void> {
  return api<void>(`/espp/offerings/${id}`, { method: 'DELETE' })
}

// --- periods ---
// There is no list endpoint on the client any more: the modeler payload IS the period
// list (stored rows and derived slot-fillers together), and these three verbs are the
// modeler table's save path.

// label is the natural key: a duplicate is a 409.
export function createPeriod(body: EsppPeriodCreate): Promise<EsppPeriodOut> {
  return api<EsppPeriodOut>('/espp/periods', { method: 'POST', body: JSON.stringify(body) })
}

export function updatePeriod(id: number, body: EsppPeriodUpdate): Promise<EsppPeriodOut> {
  return api<EsppPeriodOut>(`/espp/periods/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function deletePeriod(id: number): Promise<void> {
  return api<void>(`/espp/periods/${id}`, { method: 'DELETE' })
}

// --- modeler ---

// The knobs are OVERRIDES, and blank is the smart default: leave subscription_price out
// and every row is priced from the offering covering it (falling back to the ticker's
// latest quote where none does), leave purchase_fmv out and the FMV is that latest quote.
// `year` selects the calendar year by period_end and defaults to the current one — an
// empty year is a full derived plan, never a 404.
export interface ModelerParams {
  subscriptionPrice?: string
  purchaseFmv?: string
  carryForward?: string
  year?: number
}

// 422 when neither an override nor a live quote for the espp ticker can price a row (a
// clean seed with no offerings and no quote).
export function fetchModeler(params: ModelerParams = {}): Promise<EsppModelerOut> {
  const query = new URLSearchParams()
  // A blanked controlled input arrives as '' — treat it as absent, or the server 422s
  // on Decimal('') instead of resolving the blank knob's smart default.
  if (params.subscriptionPrice) query.set('subscription_price', params.subscriptionPrice)
  if (params.purchaseFmv) query.set('purchase_fmv', params.purchaseFmv)
  if (params.carryForward) query.set('carry_forward', params.carryForward)
  if (params.year !== undefined) query.set('year', String(params.year))
  const qs = query.toString()
  return api<EsppModelerOut>(`/espp/modeler${qs ? `?${qs}` : ''}`)
}
