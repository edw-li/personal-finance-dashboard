import { api, apiWithHeaders } from './client'
import type { OwnerScope } from './netWorth'

export type AllocationDimension = 'asset_class' | 'industry' | 'geography' | 'account' | 'type'
export const ALLOCATION_DIMENSIONS: { value: AllocationDimension; label: string }[] = [
  { value: 'asset_class', label: 'Asset class' }, { value: 'industry', label: 'Industry' },
  { value: 'geography', label: 'Geography' }, { value: 'account', label: 'Account' },
  { value: 'type', label: 'Holding type' },
]
export const UNKNOWN_CLASSIFICATION = '__unknown__'
export const ASSET_CLASSES: Record<string, string> = {
  equity: 'Equity', bonds: 'Bonds', cash: 'Cash / cash equivalents',
  real_assets: 'Real assets', mixed: 'Mixed', other: 'Other',
}
export const GEOGRAPHIES: Record<string, string> = {
  us: 'US', international: 'International', global: 'Global / mixed',
}

export interface SecurityClassification {
  security_id: number; ticker: string; name: string; holding_type: string
  asset_class: string | null; industry: string | null; geography: string | null
  source: string; note: string | null; reviewed_at: string | null; industry_available: boolean
}
export interface ClassificationInput {
  asset_class: string | null; industry: string | null; geography: string | null; note: string | null
}
export interface AllocationMember {
  security_id: number; ticker: string; name: string; account: string | null; shares: string
  market_value: string | null; quoted_at: string | null
  classification_source: string; classification_reviewed_at: string | null
}
export interface ExposureSlice {
  key: string; label: string; market_value: string; weight_pct: string; holdings: number
  is_unknown: boolean; members: AllocationMember[]
}
export interface AllocationTarget {
  key: string; target_pct: string; tolerance_pp: string
}
export interface AllocationTargetSet {
  id: number; scope_key: string; dimension: AllocationDimension; state: 'draft' | 'active'
  targets: AllocationTarget[]; updated_at: string
}
export interface AllocationDrift {
  key: string; label: string; market_value: string; weight_pct: string | null
  target_pct: string; tolerance_pp: string; drift_pp: string | null; drift_amount: string | null
  outside_tolerance: boolean | null; has_unpriced: boolean
}
export interface AllocationData {
  by: AllocationDimension; scope_key: string; total_market_value: string
  as_of: string | null; latest_quote_at: string | null; slices: ExposureSlice[]
  coverage: {
    holding_count: number; priced_count: number; unpriced_count: number; classified_count: number
    classified_market_value: string; unknown_market_value: string; classified_weight_pct: string | null
    unpriced_holdings: AllocationMember[]; warnings: string[]
  }
  target_set: AllocationTargetSet | null; draft_target_set: AllocationTargetSet | null
  drift: AllocationDrift[]; source_href: string
}
export interface EmployerExposure {
  ticker: string | null; scope_key: string; as_of: string; quoted_at: string | null
  held_shares: string; held_value: string | null; held_weight_pct: string | null
  priced_portfolio_value: string; unvested_shares: number; unvested_value: string | null
  unvested_scope: string; warnings: string[]
}

function query(by: AllocationDimension, owner: OwnerScope): string {
  const params = new URLSearchParams({ by })
  if (owner !== null) params.set('owner', String(owner))
  return params.toString()
}
export function fetchAllocationData(by: AllocationDimension, owner: OwnerScope): Promise<AllocationData> {
  return api(`/portfolio/allocation?${query(by, owner)}`)
}
export function fetchClassifications(): Promise<SecurityClassification[]> {
  return api('/portfolio/classifications')
}
export function saveClassification(id: number, body: ClassificationInput) {
  return apiWithHeaders<SecurityClassification>(`/portfolio/securities/${id}/classification`, {
    method: 'PATCH', body: JSON.stringify(body),
  })
}
export function saveAllocationTargets(
  by: AllocationDimension, owner: OwnerScope, state: 'draft' | 'active', targets: AllocationTarget[],
) {
  return apiWithHeaders<AllocationTargetSet>(`/portfolio/allocation/targets?${query(by, owner)}`, {
    method: 'PUT', body: JSON.stringify({ state, targets }),
  })
}
export function fetchEmployerExposure(owner: OwnerScope): Promise<EmployerExposure> {
  return api(`/portfolio/employer-exposure${owner === null ? '' : `?owner=${owner}`}`)
}

export function allocationLabel(key: string, dimension: AllocationDimension): string {
  if (key === UNKNOWN_CLASSIFICATION) return 'Unknown'
  const labels: Record<string, Record<string, string>> = {
    asset_class: ASSET_CLASSES, geography: GEOGRAPHIES,
    type: { stock: 'Stock', etf: 'ETF', mutual_fund: 'Mutual fund', private: 'Private' },
  }
  return labels[dimension]?.[key] ?? key
}
