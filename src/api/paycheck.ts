import { api } from './client'
import type {
  PaycheckBreakdownOut,
  PaycheckProfileCreate,
  PaycheckProfileOut,
  PaycheckProfileUpdate,
} from '../types/api'

// Newest effective_date first — the page opens on the profile in force.
export function getProfiles(): Promise<PaycheckProfileOut[]> {
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
// back to the earliest future one); 404 when there are no profiles at all.
export function getBreakdown(profileId?: number): Promise<PaycheckBreakdownOut> {
  const qs = profileId === undefined ? '' : `?profile_id=${profileId}`
  return api<PaycheckBreakdownOut>(`/paycheck/breakdown${qs}`)
}
