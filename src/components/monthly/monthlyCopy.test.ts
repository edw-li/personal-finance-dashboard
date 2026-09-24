import { beforeEach, describe, expect, it } from 'vitest'
import { setServerToday } from '../../utils/productToday'
import {
  balancesLine,
  balancesPartName,
  beyondBanner,
  confirmBanner,
  dayOf,
  earlyBanner,
  flowsPartName,
  inProgressSentence,
  metaOf,
  monthNameOf,
  monthPhase,
  noBalancesBlocker,
  notBegunSentence,
  partialBanner,
  recordedEarly,
  reviewSaveNote,
  unsavedPartNote,
} from './monthlyCopy'

// The server's year decides when a label carries its year (utils/asOf.ts); setup forgets the day.
beforeEach(() => setServerToday('2026-10-03'))

const meta = (recorded_on: string | null, as_of: string | null, provisional: boolean) => ({
  exists: true,
  recorded_on,
  as_of,
  provisional,
})

describe('names (2026-09-23 spec §M1)', () => {
  it('names days and months, with the year only outside the server year', () => {
    expect(dayOf('2026-10-01')).toBe('Oct 1')
    expect(dayOf('2025-12-01')).toBe('Dec 1, 2025')
    expect(monthNameOf('2026-09-01')).toBe('September')
    expect(monthNameOf('2025-12-01')).toBe('December 2025')
    expect(balancesPartName('2026-10-01')).toBe('Oct 1 balances')
    expect(flowsPartName('2026-09-01')).toBe('September spending & take-home')
  })
})

describe('monthPhase (§M3)', () => {
  it('places a month against the server month', () => {
    expect(monthPhase('2026-09-01')).toBe('past')
    expect(monthPhase('2026-10-01')).toBe('current')
    expect(monthPhase('2026-11-01')).toBe('next')
    expect(monthPhase('2026-12-01')).toBe('beyond')
    expect(monthPhase('2027-01-01', '2026-12-01')).toBe('next')
  })
})

describe('metaOf / recordedEarly (§K2 fields as the wizard reads them)', () => {
  it('reads a pre-K payload as final and dated by its 1st', () => {
    expect(metaOf({ exists: true, recorded_on: '2026-08-05' })).toEqual({
      exists: true,
      recorded_on: '2026-08-05',
      as_of: null,
      provisional: false,
    })
  })

  it('is early only when recorded before its own 1st', () => {
    expect(recordedEarly('2026-10-01', meta('2026-09-22', '2026-09-22', true))).toBe(true)
    expect(recordedEarly('2026-10-01', meta('2026-10-01', '2026-10-01', false))).toBe(false)
    expect(recordedEarly('2026-10-01', meta(null, '2026-10-01', false))).toBe(false)
    expect(recordedEarly('2026-10-01', { ...meta('2026-09-22', null, true), exists: false })).toBe(false)
  })
})

describe('balancesLine (§M4)', () => {
  it('reads the four shapes', () => {
    expect(balancesLine('2026-10-01', meta('2026-10-01', '2026-10-01', false))).toBe(
      'Balances as of Oct 1 · recorded Oct 1',
    )
    expect(balancesLine('2026-10-01', meta('2026-09-22', '2026-09-22', true))).toBe(
      'Balances as of Sep 22 · provisional for Oct 1 — recorded early, on Sep 22',
    )
    expect(balancesLine('2026-10-01', meta(null, '2026-10-01', false))).toBe(
      'Balances as of Oct 1 · recorded date unknown',
    )
    expect(
      balancesLine('2026-11-01', { exists: false, recorded_on: null, as_of: null, provisional: false }),
    ).toBe('Balances as of Nov 1 · not recorded yet')
  })

  it('a snapshot recorded after its 1st stays "as of" its 1st and names the recorded day', () => {
    expect(balancesLine('2023-09-01', meta('2023-09-24', '2023-09-01', false))).toBe(
      'Balances as of Sep 1, 2023 · recorded Sep 24, 2023',
    )
  })

  it('early balances saved again before their date read as of that day', () => {
    expect(balancesLine('2026-11-01', meta('2026-10-25', '2026-10-25', true))).toBe(
      'Balances as of Oct 25 · provisional for Nov 1 — recorded early, on Oct 25',
    )
  })

  it('a month still ahead with no early date (API-made) is provisional without an as-of', () => {
    expect(balancesLine('2026-12-01', meta(null, null, true))).toBe(
      'Balances for Dec 1 · provisional — recorded date unknown',
    )
  })
})

describe('sentences', () => {
  it('uses the spec copy word for word', () => {
    expect(confirmBanner('2026-10-01', '2026-09-22')).toBe(
      'These Oct 1 balances were recorded early, on Sep 22. Update any account that changed and save — saving on or after Oct 1 makes them final.',
    )
    expect(earlyBanner('2026-11-01')).toBe(
      'These are Nov 1 balances recorded before Nov 1 — they stay provisional until you save them again on or after Nov 1.',
    )
    expect(beyondBanner('2026-12-01')).toBe('Dec 1 balances can be recorded from Nov 1 (early) or on Dec 1.')
    expect(notBegunSentence('2026-11-01')).toBe('November spending can be entered once November begins.')
    expect(inProgressSentence('2026-10-01')).toBe(
      'October is in progress — its spending and take-home are due once it ends. What you save now is kept as a partial month.',
    )
    expect(partialBanner('2026-09-01')).toBe(
      "September's spending was saved during September. Add anything that has posted since and save, or confirm it's complete.",
    )
    expect(noBalancesBlocker('2026-11-01')).toBe('Record Nov 1 balances before closing November.')
  })

  it("Review's pre-save note names what the save writes", () => {
    const note = (balances: boolean, spending: boolean, balancesExist = true) =>
      reviewSaveNote('2026-09-01', { balances, spending, balancesExist })
    expect(note(true, true)).toBe('This save writes Sep 1 balances and September spending.')
    expect(note(true, false)).toBe('This save writes Sep 1 balances — September spending is unchanged and is not sent.')
    expect(note(false, true)).toBe('This save writes September spending — Sep 1 balances are unchanged and are not sent.')
    expect(note(false, true, false)).toBe(
      'This save writes September spending — Sep 1 balances are not recorded yet; record them on the Balances step.',
    )
    expect(note(false, false)).toBe('Nothing has changed — saving records your confirmations only.')
  })

  it("the receipt names a part still unsaved after a save, and the step that saves it (review M2)", () => {
    expect(unsavedPartNote('flows', '2026-09-01')).toBe(
      'September spending & take-home still have unsaved changes — save them on the Spending step.',
    )
    expect(unsavedPartNote('balances', '2026-10-01')).toBe(
      'Oct 1 balances still have unsaved changes — save them on the Balances step.',
    )
  })
})
