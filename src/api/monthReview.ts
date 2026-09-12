import { api } from './client'
import type { MonthUpsert, MonthUpsertResult, SpendingMonthUpsert, SpendingUpsertResult } from '../types/api'
import type { MetricEvidence } from '../types/metrics'

export type ReviewState = 'not_started' | 'in_progress' | 'ready_to_review' | 'closed' | 'needs_review' | 'unreviewed_history'
export type ReviewedFeeds = { balances: boolean; spending: boolean; take_home: boolean }
export interface MonthReview {
  month: string
  state: ReviewState
  input_revision: string
  reviewed: ReviewedFeeds
  coverage: ReviewedFeeds & { spending_nonzero: boolean; missing_account_ids: number[]; missing_category_ids: number[] }
  can_close: boolean
  blockers: string[]
  eligible_spending: boolean
  eligible_savings: boolean
  legacy_eligible: boolean
  closed_at: string | null
  closed_by: string | null
  source_link: string
}
export interface MonthReviewList {
  adopted_on: string | null
  default_month: string | null
  months: MonthReview[]
}
export interface MonthSave {
  expected_revision: string
  request_id?: string
  balances?: MonthUpsert
  spending?: SpendingMonthUpsert
  reviewed: ReviewedFeeds
  close: boolean
}
export interface MonthSaveResult {
  month: string
  review: MonthReview
  balances: MonthUpsertResult | null
  spending: SpendingUpsertResult | null
  batch_id: string | null
}
export interface SpendingEvidence {
  month: string | null
  review: MonthReview | null
  metrics: MetricEvidence[]
  comparison: MetricEvidence
  rolling: MetricEvidence
}
export const REVIEW_LABELS: Record<ReviewState, string> = {
  not_started: 'Not started', in_progress: 'In progress', ready_to_review: 'Ready to review',
  closed: 'Closed', needs_review: 'Needs review', unreviewed_history: 'Unreviewed history',
}
export const fetchMonthReviews = () => api<MonthReviewList>('/month-review')
export const fetchMonthReview = (month: string) => api<MonthReview>(`/month-review/months/${month}`)
export const saveMonthReview = (month: string, body: MonthSave) => api<MonthSaveResult>(`/month-review/months/${month}`, { method: 'PUT', body: JSON.stringify(body) })
export const batchCloseMonths = (months: { month: string; expected_revision: string }[]) => api<{ months: MonthReview[]; batch_id: string | null }>('/month-review/batch-close', {
  method: 'POST', body: JSON.stringify({ months, reviewed: { balances: true, spending: true, take_home: true } }),
})
export const fetchSpendingEvidence = (month?: string) => api<SpendingEvidence>(`/metrics/spending${month ? `?month=${month}` : ''}`)
