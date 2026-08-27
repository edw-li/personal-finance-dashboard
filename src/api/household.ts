import { api } from './client'
import type { HouseholdOut, MarriageDateOut, PersonOut } from '../types/api'

// Path carries NO trailing slash: the router mounts GET at prefix "/household" with an
// empty route path, so "/household/" costs a 307 redirect (the /settings precedent).
export function fetchHousehold(): Promise<HouseholdOut> {
  return api<HouseholdOut>('/household')
}

export function createPerson(name: string): Promise<PersonOut> {
  return api<PersonOut>('/household/people', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

// Rename only — is_primary is not on the server's schema, so there is nothing else to send.
export function updatePerson(personId: number, name: string): Promise<PersonOut> {
  return api<PersonOut>(`/household/people/${personId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

// Explicitly null, never undefined: JSON.stringify DROPS an undefined value and the field
// defaults to None server-side, so "clear the date" and "I forgot to send it" would arrive
// as the same request (the espp_ticker lesson).
export function putMarriageDate(marriageDate: string | null): Promise<MarriageDateOut> {
  return api<MarriageDateOut>('/household/marriage-date', {
    method: 'PUT',
    body: JSON.stringify({ marriage_date: marriageDate }),
  })
}
