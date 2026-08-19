import { api } from './client'
import type { ProjectionOut } from '../types/api'

export interface ProjectionParams {
  annualReturn?: string
  monthlyContribution?: string
  annualSpend?: string
  swr?: string
  years?: string
}

// Blank knobs are OMITTED (the espp client's rule): a blanked box means "derive it
// server-side", and an empty string would 422 as Decimal('').
export function fetchProjection(params: ProjectionParams = {}): Promise<ProjectionOut> {
  const query = new URLSearchParams()
  if (params.annualReturn) query.set('annual_return', params.annualReturn)
  if (params.monthlyContribution) query.set('monthly_contribution', params.monthlyContribution)
  if (params.annualSpend) query.set('annual_spend', params.annualSpend)
  if (params.swr) query.set('swr', params.swr)
  if (params.years) query.set('years', params.years)
  const qs = query.toString()
  return api<ProjectionOut>(`/projection${qs ? `?${qs}` : ''}`)
}
