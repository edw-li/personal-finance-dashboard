import { describe, expect, it } from 'vitest'
import { NAV_PATHS, isNavLink } from './navLink'

describe('isNavLink', () => {
  it('accepts a sandbox path, with or without a scenario query', () => {
    expect(isNavLink('/taxes')).toBe(true)
    expect(isNavLink('/taxes?year=2026&whatif=qualified_dividends%3A2500')).toBe(true)
    expect(isNavLink('/paycheck?whatif=trad_401k_pct%3A0.15')).toBe(true)
    expect(isNavLink('/projection?whatif=retire%3A2%3A2035-06')).toBe(true)
  })

  // Each of these also kills the mutation "accept any `/`-prefixed path": /settings and
  // /taxes/x both start with a slash and must still be refused, so the rule cannot be
  // weakened to a prefix test without a red test.
  it('refuses anything that is not one of the three sandboxes', () => {
    for (const refused of [
      '/settings', // a real page, but no tool's business to send anyone to
      '/', // ditto, and the one a prefix rule would wave straight through
      '/taxes/x', // a prefix of a sandbox is not a sandbox
      '/taxesx',
      '//evil.example', // protocol-relative: starts with a slash, leaves the origin
      '//evil.example/taxes',
      'https://evil.example/x',
      'javascript:alert(1)',
      'taxes',
      '',
    ]) {
      expect(isNavLink(refused), refused).toBe(false)
    }
  })

  // The set is filtered out of NAV_ITEMS, so a renamed route silently shrinks it. Pinning
  // the membership is what turns that into a failure here rather than a link that quietly
  // stops rendering in every what-if answer.
  it('is exactly the three sandbox routes, read from the app route registry', () => {
    expect([...NAV_PATHS].sort()).toEqual(['/paycheck', '/projection', '/taxes'])
  })
})
