import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { guideEntries } from '../guide/palette'
import {
  SETTINGS_SECTIONS,
  buildEntries,
  groupMatches,
  matchEntries,
  type PaletteEntry,
} from './paletteRegistry'

const noop = () => {}

describe('paletteRegistry', () => {
  const entries = buildEntries({ run: { refreshPrices: noop, askAssistant: noop } })

  it('reaches a page through a keyword alias', () => {
    const hits = matchEntries('rsu', entries)
    expect(hits[0].kind).toBe('page')
    expect(hits[0].label).toBe('Comp')
  })

  // The noun and the verb collide: "Assistant" is a Settings card and "Ask assistant" is
  // the action that opens the drawer. Both score the same, so registry order decides — and
  // it puts actions first, because typing a thing's name means "do it", not "configure it".
  it('prefers the Ask assistant action over the Settings card of the same name', () => {
    expect(matchEntries('assistant', entries)[0].id).toBe('action:ask-assistant')
  })

  it('offers Settings sections as anchored destinations', () => {
    const hit = matchEntries('password', entries).find((e) => e.kind === 'section')
    expect(hit?.to).toBe('/settings#password')
    expect(matchEntries('backup', entries).some((e) => e.to === '/settings#system')).toBe(true)
    expect(matchEntries('limits', entries).some((e) => e.to === '/settings#limits')).toBe(true)
  })

  // The monthly update's entry names no month (2026-09-23 spec §M7): the part that is due is
  // rarely the calendar month's, so the palette opens /update, which lands on what is due.
  it("keeps the five actions, the update one leading to what's due", () => {
    const actions = entries.filter((e) => e.kind === 'action')
    expect(actions.map((e) => e.label)).toEqual([
      'Refresh prices',
      "Monthly update — what's due",
      'Add dividend',
      'Add custom event',
      'Ask assistant',
    ])
    expect(actions[1].to).toBe('/update')
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

  // Every lane that lands a Settings card lands its anchor with it. Without this the list
  // rots silently: a wrong id is not a type error, and the palette hit just scrolls nowhere.
  it('every anchored Settings section has a card wearing that id', () => {
    const dir = path.resolve(__dirname, 'settings')
    const sources = [
      readFileSync(path.resolve(__dirname, '../pages/SettingsPage.tsx'), 'utf8'),
      ...readdirSync(dir)
        .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
        .map((f) => readFileSync(path.join(dir, f), 'utf8')),
    ]
    const missing = SETTINGS_SECTIONS.filter(
      (section) => !sources.some((src) => src.includes(`id="${section.id}"`)),
    )
    expect(missing.map((section) => section.id)).toEqual([])
  })

  it('reaches the Calendar feed card as an anchored Settings section', () => {
    const hit = matchEntries('feed', entries)[0]
    expect(hit.id).toBe('section:calendar')
    expect(hit.to).toBe('/settings#calendar')
    // The page and the card are different destinations, and 'ics' belongs to the page:
    // typing a thing's name means "open it", not "configure its subscription".
    expect(matchEntries('ics', entries)[0].to).toBe('/calendar')
  })

  it('an empty query returns everything static, recents first', () => {
    const all = matchEntries('', entries, ['action:add-dividend'])
    expect(all[0].id).toBe('action:add-dividend')
    expect(all.length).toBe(entries.length)
  })

  it('anchors the two new Settings cards and retires app-settings (2026-09-06 spec §3.6)', () => {
    expect(SETTINGS_SECTIONS.some((s) => s.id === 'app-settings')).toBe(false)
    for (const [query, id] of [
      ['withdrawal rate', 'plan-assumptions'],
      ['espp discount', 'plan-assumptions'],
      ['employer match', 'plan-assumptions'],
      ['cron', 'price-refresh'],
      ['refresh prices', 'price-refresh'],
    ] as const) {
      expect(matchEntries(query, entries).some((e) => e.to === `/settings#${id}`), query).toBe(true)
    }
  })

  it('anchors the four data-lifecycle cards (2026-09-03 spec §3)', () => {
    for (const [query, id] of [
      ['snapshot now', 'backups'],
      ['roll back', 'restore'],
      ['undo', 'activity'],
      ['stale quotes', 'health'],
    ] as const) {
      expect(matchEntries(query, entries).some((e) => e.to === `/settings#${id}`), query).toBe(true)
    }
  })

  // The pin against the REAL guide (2026-09-14 guide spec §6). paletteRegistry no longer
  // imports the content module — CommandPalette appends guideEntries() on the first open —
  // so the composition is done here the way the component does it. "add a card" has no
  // destination that answers it: no page, section or action is called that, so the how-to
  // wins outright and lands on the task, not on the Credit cards page.
  it('answers "add a card" with the guide task that walks it', () => {
    const withGuide = [...entries, ...guideEntries().map((e) => ({ kind: 'guide' as const, ...e }))]
    const hits = matchEntries('add a card', withGuide)
    expect(hits[0].id).toBe('guide:cards-add')
    expect(hits[0].to).toBe('/guide?section=pages#cards-add')
    expect(groupMatches(hits).at(-1)?.title).toBe('Guide')
  })
})
