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

export function getLots(): Promise<EsppLotsResponse> {
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

export function getPeriods(): Promise<EsppPeriodOut[]> {
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

export function getModeler(params: ModelerParams = {}): Promise<EsppModelerOut> {
  const query = new URLSearchParams()
  if (params.subscriptionPrice !== undefined) {
    query.set('subscription_price', params.subscriptionPrice)
  }
  if (params.purchaseFmv !== undefined) query.set('purchase_fmv', params.purchaseFmv)
  if (params.carryForward !== undefined) query.set('carry_forward', params.carryForward)
  if (params.year !== undefined) query.set('year', String(params.year))
  const qs = query.toString()
  return api<EsppModelerOut>(`/espp/modeler${qs ? `?${qs}` : ''}`)
}
