// Routes whose guide cards have not landed yet (2026-09-14 guide spec §8.3). The completeness
// fence accepts a pending route in place of a card; each content lane deletes its routes as it
// lands them (G1: /update · G2: /, /net-worth, /portfolio, /spending, /credit-cards ·
// G3: /paycheck, /comp, /espp, /taxes · G4: /projection, /calendar, /settings). Lane V asserts
// the array is empty and deletes this file and its import.
export const PENDING_PAGES: readonly string[] = [
  '/calendar',
  '/projection',
  '/settings',
]
