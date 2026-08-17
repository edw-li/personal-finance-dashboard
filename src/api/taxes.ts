import { api } from './client'
import type {
  TaxBracketsOut,
  TaxBracketsUpdate,
  TaxInputsOut,
  TaxInputsUpdate,
  TaxSummariesOut,
  TaxSummaryOut,
  TaxYearOut,
} from '../types/api'

// Render order for the brackets editor, mirroring backend `app/tax_keys.py`. The GET
// returns a Record rather than these six fixed keys — an importer-written extra
// jurisdiction survives a read — so a consumer renders these in order and appends
// whatever else came back rather than indexing blindly. (Note: filtering the extras via
// JURISDICTIONS.includes(k) needs a cast for a plain-string k — the readonly tuple's
// includes() takes the literal union; see MonthlyUpdatePage for the house cast.)
export const JURISDICTIONS = [
  'federal',
  'state',
  'medicare',
  'social_security',
  'disability',
  'capital_gains',
] as const

export type Jurisdiction = (typeof JURISDICTIONS)[number]

export function fetchTaxYears(): Promise<TaxYearOut[]> {
  return api<TaxYearOut[]>('/taxes/years')
}

export function fetchTaxInputs(year: number): Promise<TaxInputsOut> {
  return api<TaxInputsOut>(`/taxes/years/${year}/inputs`)
}

// Bulk upsert of the keys in the body only; keys left out are untouched, a null value
// unsets that input. Echoes the whole year back (with fresh suggestions). Both PUTs
// auto-create the tax_years row (1900..2100) — that IS the "new year" affordance.
export function putTaxInputs(year: number, body: TaxInputsUpdate): Promise<TaxInputsOut> {
  return api<TaxInputsOut>(`/taxes/years/${year}/inputs`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function fetchTaxBrackets(year: number): Promise<TaxBracketsOut> {
  return api<TaxBracketsOut>(`/taxes/years/${year}/brackets`)
}

// Full replace per jurisdiction present in the body; the server renumbers bracket_index.
export function putTaxBrackets(year: number, body: TaxBracketsUpdate): Promise<TaxBracketsOut> {
  return api<TaxBracketsOut>(`/taxes/years/${year}/brackets`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

// Seeds an EMPTY year from an existing one: 404 when the source has no brackets, 409
// when the target already has some (clear it with an empty PUT first — never a merge).
export function cloneBrackets(year: number, sourceYear: number): Promise<TaxBracketsOut> {
  return api<TaxBracketsOut>(`/taxes/years/${year}/clone-brackets-from/${sourceYear}`, {
    method: 'POST',
  })
}

export function fetchTaxSummary(year: number): Promise<TaxSummaryOut> {
  return api<TaxSummaryOut>(`/taxes/years/${year}/summary`)
}

// The trend feed: one summary per year that has at least one stored input.
export function fetchAllTaxSummaries(): Promise<TaxSummariesOut> {
  return api<TaxSummariesOut>('/taxes/summary')
}

// 204, and the year's inputs + brackets go with it (both child FKs cascade).
export function deleteTaxYear(year: number): Promise<void> {
  return api<void>(`/taxes/years/${year}`, { method: 'DELETE' })
}
