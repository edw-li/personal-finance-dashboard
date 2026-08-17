import { api } from './client'
import type { CompEventCreate, CompEventOut, CompEventUpdate } from '../types/api'

// Ascending by focal_year — the page reads as a trajectory.
export function getEvents(): Promise<CompEventOut[]> {
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

export function deleteEvent(id: number): Promise<void> {
  return api<void>(`/comp/events/${id}`, { method: 'DELETE' })
}
