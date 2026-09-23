import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { restoreHref, restorePointInstant, restorePointLabel } from './restorePoints'

// The label reads the LOCAL clock (formatDateTime), so the expectation needs a pinned zone.
beforeAll(() => vi.stubEnv('TZ', 'America/Los_Angeles'))
afterAll(() => vi.unstubAllEnvs())

const POINT = 'pre-restore-20260904-161500-123456.zip'

it("reads the server's restore-point grammar as the UTC instant it encodes", () => {
  expect(restorePointInstant(POINT)).toBe('2026-09-04T16:15:00.123Z')
  expect(restorePointInstant('finance-export-20260904-233000.zip')).toBeNull()
  expect(restorePointInstant('pre-restore-20260904-161500.zip')).toBeNull()
})

it('names a restore point on the local clock, and falls back to the name itself', () => {
  expect(restorePointLabel(POINT)).toBe('Sep 4, 2026, 9:15 AM')
  expect(restorePointLabel('finance-export-20260904-233000.zip')).toBe(
    'finance-export-20260904-233000.zip',
  )
  // The grammar's digits, but no such day: the name, never "—".
  expect(restorePointLabel('pre-restore-20261399-161500-123456.zip')).toBe(
    'pre-restore-20261399-161500-123456.zip',
  )
})

it("builds the Restore card's arrival link, anchor included", () => {
  expect(restoreHref(POINT)).toBe(`/settings?restore=${POINT}#restore`)
  expect(restoreHref('a b.zip')).toBe('/settings?restore=a%20b.zip#restore')
})
