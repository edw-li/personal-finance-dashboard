import { api } from './client'
import type { EsppSaleIn, SaleLegIn, WhatIfOut } from '../types/api'

// The one call of the tax sandbox. NOTHING is stored: the endpoint loads the year's stored
// inputs and brackets, runs the engine twice (baseline and scenario) and answers with both
// plus their delta — so a run is safe to repeat and a failure leaves the year untouched.
//
// `overrides` mirrors WhatIfIn's third field (absolute replacements applied after the sale
// deltas; a null value zeroes the key). The panel has no UI for it in v1 — the inputs form
// already edits stored values — so it stays optional here rather than being invented on the
// wire.
export interface WhatIfBody {
  year: number
  sales: SaleLegIn[]
  espp_sales: EsppSaleIn[]
  overrides?: Record<string, string | null>
}

// 404 when the year has no stored row or a leg names an unknown security/lot, 409 for a lot
// that is already sold, 422 for an oversell, a non-positive figure or an unknown override
// key — all with the router's own sentences, which the panel renders verbatim.
export function runWhatIf(body: WhatIfBody): Promise<WhatIfOut> {
  return api<WhatIfOut>('/taxes/what-if', { method: 'POST', body: JSON.stringify(body) })
}
