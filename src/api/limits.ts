import { api } from './client'
import type { LimitsOut, LimitsUpdate } from '../types/api'

// Always all five definitions; values are null until entered for that year.
export function fetchLimits(year: number): Promise<LimitsOut> {
  return api<LimitsOut>(`/limits?year=${year}`)
}

// Partial bulk upsert: omit a key to leave it alone, send an explicit null to delete the
// year's row. A value <= 0 or over Numeric(14,2) is a 422 with the key in the sentence.
export function putLimits(year: number, body: LimitsUpdate): Promise<LimitsOut> {
  return api<LimitsOut>(`/limits/${year}`, { method: 'PUT', body: JSON.stringify(body) })
}

// Seeds an EMPTY year from another one: 404 when the source has none, 409 when the
// target already has some (clear it with a null PUT first — never a merge).
export function cloneLimits(year: number, sourceYear: number): Promise<LimitsOut> {
  return api<LimitsOut>(`/limits/${year}/clone-from/${sourceYear}`, { method: 'POST' })
}
