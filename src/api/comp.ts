import { api, apiDeleteLogged } from './client'
import type {
  CompEventCreate,
  CompEventOut,
  CompEventUpdate,
  RsuGrantCreate,
  RsuGrantOut,
  RsuGrantUpdate,
  VestingScheduleOut,
} from '../types/api'

// Ascending by focal_year — the page reads as a trajectory.
export function fetchEvents(): Promise<CompEventOut[]> {
  return api<CompEventOut[]>('/comp/events')
}

// focal_year is the natural key: a duplicate is a 409.
export function createEvent(body: CompEventCreate): Promise<CompEventOut> {
  return api<CompEventOut>('/comp/events', { method: 'POST', body: JSON.stringify(body) })
}

// Explicit nulls CLEAR the nullable columns here (see CompEventUpdate).
export function updateEvent(id: number, body: CompEventUpdate): Promise<CompEventOut> {
  return api<CompEventOut>(`/comp/events/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

// Logged (2026-09-25 polish spec §6.1): the answer names the batch an Undo reverts.
export function deleteEvent(id: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/comp/events/${id}`)
}

// --- RSU grants + the vesting schedule ---

// The whole Comp card set in one read-only payload: grants, every vest, the tiles, the
// seed prefills and both warning lists. No domain 4xx — the price chain degrades to nulls
// plus warnings rather than raising (a network or auth failure still rejects, like any other
// call here) — so reload this after ANY grant write rather than patching state locally.
export function fetchVestingSchedule(): Promise<VestingScheduleOut> {
  return api<VestingScheduleOut>('/comp/vesting-schedule')
}

// label is the natural key here (not focal_year): a duplicate — after trimming — is a 409.
export function createRsuGrant(body: RsuGrantCreate): Promise<RsuGrantOut> {
  return api<RsuGrantOut>('/comp/rsu-grants', { method: 'POST', body: JSON.stringify(body) })
}

// The null semantics travel with the type (see RsuGrantUpdate).
export function updateRsuGrant(id: number, body: RsuGrantUpdate): Promise<RsuGrantOut> {
  return api<RsuGrantOut>(`/comp/rsu-grants/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function deleteRsuGrant(id: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/comp/rsu-grants/${id}`)
}
