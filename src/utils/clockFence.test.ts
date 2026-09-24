import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// One "today" (2026-09-23 spec §K1), enforced over the source tree rather than by review: a rule
// that asks "has the 1st arrived / has the month ended / which year is it" reads the SERVER's day
// through utils/months.ts (todayIso, currentMonthIso, currentYear), never the browser's clock. So
// no non-test source calls `new Date()` — the browser's now — or grows a private `todayIso`,
// outside the two files that own the day and the exceptions utils/productToday.ts documents. The
// matchers are held to synthetic sources at the bottom: a fence whose pattern quietly stopped
// matching would pass forever while proving nothing (mounts.audit.test.ts's rule).
//
// Adding a browser-clock read that is NOT a product rule (an instant, a TTL)? `Date.now()` is not
// fenced; a `new Date()` needs an entry in EXCEPTIONS with its reason in utils/productToday.ts.

const SRC = path.resolve(__dirname, '..')

/** The two files that own the day. */
const OWNERS = ['utils/months.ts', 'utils/productToday.ts']
/** Browser-clock reads that are not a product rule (utils/productToday.ts says why). */
const EXCEPTIONS = ['utils/staleness.ts', 'components/details/explainSelection.ts', 'sandbox/pins.ts']
/** Reads another lane fixes (spec §K1). The lane that fixes a read deletes its entry in the same
 *  change — the "still needed" test fails until it does. Empty once W and M have landed. */
const ALLOWLIST: Record<string, string> = {
  'pages/TaxesPage.tsx': 'W11 — the Will I owe? mount and the new-year default',
  'pages/OverviewPage.tsx': 'W11 — the tax year read',
}

/** A no-argument `new Date()`: the browser's now (`new Date(y, m, d)` and `new Date(iso)` are not). */
const BROWSER_NOW = /\bnew Date\(\s*\)/
/** A private `todayIso` — a function or a binding declared under that name. */
const PRIVATE_TODAY = /\bfunction\s+todayIso\s*\(|\b(?:const|let|var)\s+todayIso\s*=/

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    // src/testing holds test infrastructure (fixtures, setup), not product code.
    if (statSync(full).isDirectory()) return entry === 'testing' ? [] : sources(full)
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : []
  })
}

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join('/')

function clockReads(text: string): string[] {
  return [
    ...(BROWSER_NOW.test(text) ? ['new Date()'] : []),
    ...(PRIVATE_TODAY.test(text) ? ['a private todayIso'] : []),
  ]
}

describe('the clock fence (2026-09-23 spec §K1)', () => {
  it('no source outside the owners and the documented exceptions reads the browser clock', () => {
    const exempt = new Set([...OWNERS, ...EXCEPTIONS, ...Object.keys(ALLOWLIST)])
    const offenders = sources(SRC)
      .filter((file) => !exempt.has(rel(file)))
      .flatMap((file) => clockReads(readFileSync(file, 'utf8')).map((what) => `${rel(file)}: ${what}`))
    expect(offenders).toEqual([])
  })

  it('every allowlisted file still needs its entry — delete it in the change that fixes the read', () => {
    const fixed = Object.keys(ALLOWLIST).filter(
      (file) => clockReads(readFileSync(path.join(SRC, file), 'utf8')).length === 0,
    )
    expect(fixed).toEqual([])
  })

  it('the owners and exceptions are real files (a rename must move them)', () => {
    expect([...OWNERS, ...EXCEPTIONS].filter((file) => !existsSync(path.join(SRC, file)))).toEqual([])
  })

  it("the matchers catch the browser's now and a private todayIso, and nothing else", () => {
    for (const hit of ['new Date().getFullYear()', 'const now = new Date()', 'new Date( )'])
      expect(BROWSER_NOW.test(hit)).toBe(true)
    for (const miss of ['new Date(iso)', 'new Date(y, m - 1, d)', 'new Date(Date.UTC(y, m, 0))', 'Date.now()'])
      expect(BROWSER_NOW.test(miss)).toBe(false)
    for (const hit of ['function todayIso(): string {', 'const todayIso = () => x', 'let todayIso = f'])
      expect(PRIVATE_TODAY.test(hit)).toBe(true)
    for (const miss of ['{ todayIso = null }: Options', 'todayIso: string', 'todayIso()', 'partialNote(m, todayIso)'])
      expect(PRIVATE_TODAY.test(miss)).toBe(false)
  })
})
