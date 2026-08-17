import { api } from './client'
import type {
  EsppLotCreate,
  EsppLotOut,
  EsppLotsResponse,
  EsppLotUpdate,
  EsppModelerOut,
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

// --- periods ---

// Periods arrive ordered by (period_end, id) — the modeler chains them in this order.
export function fetchPeriods(): Promise<EsppPeriodOut[]> {
  return api<EsppPeriodOut[]>('/espp/periods')
}

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

// Nothing here is stored: the prices and the seed carry-forward are knobs. Leave them
// out and the model runs off the espp ticker's latest quote (price_source
// "latest_price"); "params" needs BOTH prices. `year` selects the calendar year by
// period_end and defaults to the latest one that has periods.
export interface ModelerParams {
  subscriptionPrice?: string
  purchaseFmv?: string
  carryForward?: string
  year?: number
}

// 404 when the (selected) year has no periods; 422 when neither prices-as-params nor a
// live quote for the espp ticker exists (a clean seed's natural state).
export function fetchModeler(params: ModelerParams = {}): Promise<EsppModelerOut> {
  const query = new URLSearchParams()
  // A blanked controlled input arrives as '' — treat it as absent, or the server 422s
  // on Decimal('') instead of falling back to the latest quote.
  if (params.subscriptionPrice) query.set('subscription_price', params.subscriptionPrice)
  if (params.purchaseFmv) query.set('purchase_fmv', params.purchaseFmv)
  if (params.carryForward) query.set('carry_forward', params.carryForward)
  if (params.year !== undefined) query.set('year', String(params.year))
  const qs = query.toString()
  return api<EsppModelerOut>(`/espp/modeler${qs ? `?${qs}` : ''}`)
}
