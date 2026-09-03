import { api, apiReadOnly } from './client'
import type {
  PaycheckBreakdownOut,
  PaycheckPreviewIn,
  PaycheckPreviewOut,
  PaycheckProfileCreate,
  PaycheckProfileOut,
  PaycheckProfileUpdate,
} from '../types/api'

// Newest effective_date first — the page opens on the profile in force.
export function fetchProfiles(): Promise<PaycheckProfileOut[]> {
  return api<PaycheckProfileOut[]>('/paycheck/profiles')
}

// effective_date is the natural key: a duplicate is a 409.
export function createProfile(body: PaycheckProfileCreate): Promise<PaycheckProfileOut> {
  return api<PaycheckProfileOut>('/paycheck/profiles', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateProfile(
  id: number,
  body: PaycheckProfileUpdate,
): Promise<PaycheckProfileOut> {
  return api<PaycheckProfileOut>(`/paycheck/profiles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteProfile(id: number): Promise<void> {
  return api<void>(`/paycheck/profiles/${id}`, { method: 'DELETE' })
}

// No id = the profile in force today (the latest one effective now or earlier, falling
// back to the earliest future one); 404 when there are no profiles at all. `personId`
// absent = the PRIMARY person (spec §4.1) — the params are built by presence, never as
// empty strings, so a single-earner request carries no query string at all and stays the
// exact request the server has always answered.
export function fetchBreakdown(
  profileId?: number,
  personId?: number,
): Promise<PaycheckBreakdownOut> {
  const params: string[] = []
  if (profileId !== undefined) params.push(`profile_id=${profileId}`)
  if (personId !== undefined) params.push(`person_id=${personId}`)
  const qs = params.length === 0 ? '' : `?${params.join('&')}`
  return api<PaycheckBreakdownOut>(`/paycheck/breakdown${qs}`)
}

// The "Try it" sandbox's one request (2026-09-03 planning-sandboxes spec §13): the profile
// GET /breakdown would show, against the same profile with `overrides` applied. Pure —
// SELECTs only server-side — so it rides apiReadOnly and never touches the snapshot cache.
// 404 "no paycheck profiles" / "paycheck profile not found" / "person not found" and 422s
// in the profile writers' own words, rendered verbatim by the panel.
export function previewPaycheck(body: PaycheckPreviewIn): Promise<PaycheckPreviewOut> {
  return apiReadOnly<PaycheckPreviewOut>('/paycheck/preview', body)
}
