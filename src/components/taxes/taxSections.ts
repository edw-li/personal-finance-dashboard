/**
 * The Taxes page's four views — the ids of TaxesPage's PAGE_SECTIONS, spelled once here so the
 * panels can take a `goTo(section)` door (2026-09-13 polish spec §14) without importing the page
 * that mounts them. A section added to the page is added here.
 */
export type TaxSection = 'summary' | 'whatif' | 'inputs' | 'tables'

/** A person-qualified cell; the page resolves single-column inputs to their unqualified ids. */
export interface TaxInputTarget { key: string; personId?: number | null; person?: 'partner' }
export type TaxNavigate = (section: TaxSection, target?: TaxInputTarget) => void
