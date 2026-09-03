import { describe, expect, it } from 'vitest'
import { buildEntries, groupMatches, matchEntries, type PaletteEntry } from './paletteRegistry'

const noop = () => {}

describe('paletteRegistry', () => {
  const entries = buildEntries({ month: '2026-09-01', run: { refreshPrices: noop, askAssistant: noop } })

  it('reaches a page through a keyword alias', () => {
    const hits = matchEntries('rsu', entries)
    expect(hits[0].kind).toBe('page')
    expect(hits[0].label).toBe('Comp')
  })

  it('offers Settings sections as anchored destinations', () => {
    const hit = matchEntries('password', entries).find((e) => e.kind === 'section')
    expect(hit?.to).toBe('/settings#password')
    expect(matchEntries('backup', entries).some((e) => e.to === '/settings#system')).toBe(true)
    expect(matchEntries('limits', entries).some((e) => e.to === '/settings#limits')).toBe(true)
  })

  it('keeps the five actions, with the update month spelled out', () => {
    const actions = entries.filter((e) => e.kind === 'action').map((e) => e.label)
    expect(actions).toEqual([
      'Refresh prices',
      'Enter Sep 2026 update',
      'Add dividend',
      'Add custom event',
      'Ask assistant',
    ])
  })

  it('groups matches by kind in the house order and caps each group at six', () => {
    const many: PaletteEntry[] = Array.from({ length: 9 }, (_, i) => ({
      kind: 'entity',
      id: `t${i}`,
      label: `T${i}`,
      sub: 'Holding',
      keywords: [],
      to: `/portfolio?ticker=T${i}`,
      group: 'Holdings',
    }))
    const grouped = groupMatches(matchEntries('t', [...entries, ...many]))
    const holdings = grouped.find((g) => g.title === 'Holdings')
    expect(holdings?.items).toHaveLength(6)
    expect(grouped.map((g) => g.title).indexOf('Actions')).toBeLessThan(grouped.map((g) => g.title).indexOf('Pages'))
  })

  it('an empty query returns everything static, recents first', () => {
    const all = matchEntries('', entries, ['action:add-dividend'])
    expect(all[0].id).toBe('action:add-dividend')
    expect(all.length).toBe(entries.length)
  })
})
