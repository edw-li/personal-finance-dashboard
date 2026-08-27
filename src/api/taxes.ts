import { api } from './client'
import type {
  FilingStatus,
  TaxBracketsCloneOut,
  TaxBracketsOut,
  TaxBracketsUpdate,
  TaxInputsOut,
  TaxInputsUpdate,
  TaxSummariesOut,
  TaxSummaryOut,
  TaxYearOut,
  TaxYearUpdate,
  WithholdingOut,
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

// The human name of a jurisdiction, kept HERE rather than in the editor that used to own it:
// the summary panel's missing-tables call-to-action names the same tables, and two copies
// could drift into telling the user to open a card that is headed something else.
export const JURISDICTION_LABELS: Record<string, string> = {
  federal: 'Federal',
  state: 'State',
  medicare: 'Medicare',
  social_security: 'Social Security',
  disability: 'Disability',
  capital_gains: 'Capital gains',
}

// An importer-written jurisdiction has no label of ours: it comes back verbatim rather than
// being humanized into something the database does not call it.
export function jurisdictionLabel(name: string): string {
  return JURISDICTION_LABELS[name] ?? name
}

// Tab and selector order. 'single' leads because it is the column's NOT NULL default, the
// only status the importer writes, and the source every clone copies FROM.
export const FILING_STATUSES = ['single', 'married_joint', 'married_separate'] as const

export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  single: 'Single',
  married_joint: 'Married filing jointly',
  married_separate: 'Married filing separately',
}

export function fetchTaxYears(): Promise<TaxYearOut[]> {
  return api<TaxYearOut[]>('/taxes/years')
}

// The year row's one mutable field. Everything the engine reads moves with it — bracket
// tables are stored per (jurisdiction, status), the inputs grow a second person column, and
// the summary is computed against the status-selected tables — so the caller reloads all
// three of the year's payloads once this resolves. PATCH, and no auto-create: a status is a
// statement ABOUT a year that must already exist (404 otherwise).
export function patchTaxYear(year: number, body: TaxYearUpdate): Promise<TaxYearOut> {
  return api<TaxYearOut>(`/taxes/years/${year}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
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

// The tables of ONE filing status. The status is REQUIRED because the server's own default
// is 'single' rather than the year's status (get_brackets: "the answer must depend on the
// request, not on a setting the user is mid-way through changing") — so a caller that left
// it off would read a single filer's tables under a married year and never be told.
export function fetchTaxBrackets(
  year: number,
  filingStatus: FilingStatus,
): Promise<TaxBracketsOut> {
  return api<TaxBracketsOut>(`/taxes/years/${year}/brackets?filing_status=${filingStatus}`)
}

// Full replace per jurisdiction present in the body; the server renumbers bracket_index.
export function putTaxBrackets(year: number, body: TaxBracketsUpdate): Promise<TaxBracketsOut> {
  return api<TaxBracketsOut>(`/taxes/years/${year}/brackets`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

// Seeds an EMPTY (year, status) from an existing year's SINGLE tables: 404 when the source
// has none, 409 when the target already has some (clear it with an empty PUT first — never
// a merge). Two callers: the new-year form, which names no status and gets the server's
// 'single' default — the query is omitted entirely so that wire is byte-identical to what it
// was before statuses existed — and the brackets editor's empty-tab button, which seeds a
// married status from the SAME year's single tables (source year === target year).
export function cloneBrackets(
  year: number,
  sourceYear: number,
  targetStatus?: FilingStatus,
): Promise<TaxBracketsCloneOut> {
  const query = targetStatus === undefined ? '' : `?target_status=${targetStatus}`
  return api<TaxBracketsCloneOut>(
    `/taxes/years/${year}/clone-brackets-from/${sourceYear}${query}`,
    { method: 'POST' },
  )
}

export function fetchTaxSummary(year: number): Promise<TaxSummaryOut> {
  return api<TaxSummaryOut>(`/taxes/years/${year}/summary`)
}

// The trend feed: one summary per year that has at least one stored input.
export function fetchAllTaxSummaries(): Promise<TaxSummariesOut> {
  return api<TaxSummariesOut>('/taxes/summary')
}

// The "Will I owe?" tracker: the year's liability against an estimate of what will actually
// be withheld. CURRENT YEAR ONLY — any other year is a 422 (a settled year may well be
// stored and summarizable, and this card still cannot be drawn for it) — and a 404 when the
// current year has no stored row at all.
export function fetchWithholding(year: number): Promise<WithholdingOut> {
  return api<WithholdingOut>(`/taxes/years/${year}/withholding`)
}

// 204, and the year's inputs + brackets go with it (both child FKs cascade).
export function deleteTaxYear(year: number): Promise<void> {
  return api<void>(`/taxes/years/${year}`, { method: 'DELETE' })
}
