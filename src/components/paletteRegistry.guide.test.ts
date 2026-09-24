import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { guideEntries } from '../guide/palette'
import { FIXTURE_GUIDE } from '../guide/testing/fixtures'
import { buildEntries, groupMatches, matchEntries, type PaletteEntry } from './paletteRegistry'

// The registry no longer imports the guide (CommandPalette pulls src/guide/palette in on the
// first open, so the content module stays out of the shell's bundle), so this suite composes
// the two halves the way the component does — over the FIXTURE, which keeps it independent of
// the content the lanes are still writing.
const noop = () => {}
const statics = buildEntries({ run: { refreshPrices: noop, askAssistant: noop } })
const guide: PaletteEntry[] = guideEntries(FIXTURE_GUIDE).map((e) => ({ kind: 'guide' as const, ...e }))
const entries = [...statics, ...guide]

describe('paletteRegistry — Guide group (2026-09-14 guide spec §6)', () => {
  it('registers one entry per task with the guide anchor as destination', () => {
    expect(guide.map((e) => e.id)).toEqual(
      expect.arrayContaining(['guide:update-close', 'guide:example-add', 'guide:example-export']),
    )
    const add = guide.find((e) => e.id === 'guide:example-add')!
    expect(add.label).toBe('Add an example')
    expect(add.sub).toBe('Guide · Example')
    expect(add.to).toBe('/guide?section=pages#example-add')
    expect(guide.every((e) => e.to?.startsWith('/guide?section='))).toBe(true)
  })

  it('keeps the five actions exactly as they were', () => {
    expect(statics.filter((e) => e.kind === 'action')).toHaveLength(5)
  })

  // The bundle fence, read as TEXT (the technique paletteRegistry.test.ts:66-78 uses on the
  // Settings sources): a static `import ... from '../guide/...'` here would pull the whole guide
  // content module back into the shell's chunk, and nothing about the entries this module returns
  // would change — so only the source can say it. CommandPalette imports it dynamically instead.
  it('never imports the guide: the content module stays out of the shell bundle', () => {
    const source = readFileSync(path.resolve(__dirname, 'paletteRegistry.ts'), 'utf8')
    expect(source).not.toContain("from '../guide")
    expect(statics.some((e) => e.kind === 'guide')).toBe(false)
  })

  it('a task title typed into the palette lands on the guide task, under a Guide group', () => {
    const hits = matchEntries('add an example', entries)
    expect(hits[0].id).toBe('guide:example-add')
    const grouped = groupMatches(hits)
    expect(grouped.some((g) => g.title === 'Guide')).toBe(true)
  })

  it('the Guide group sorts after every other group', () => {
    const synthetic: PaletteEntry[] = [
      { kind: 'guide', id: 'guide:x', label: 'X', keywords: [], to: '/guide?section=pages#x' },
      { kind: 'entity', id: 'card:y', label: 'Y', keywords: [], to: '/credit-cards?card=y', group: 'Cards' },
      { kind: 'page', id: 'nav:/', label: 'Overview', keywords: [], to: '/' },
    ]
    expect(groupMatches(synthetic).map((g) => g.title)).toEqual(['Pages', 'Cards', 'Guide'])
  })
})

// A how-to is a place to READ about the thing, never the thing itself. scoreEntry drops the
// label bonus for kind 'guide', so a guide title ties — rather than beats — the destination
// whose alias answers the same words, and registry order (guide last) hands the tie to the
// destination.
describe('paletteRegistry — a destination outranks the how-to that explains it (§6 review round)', () => {
  it('ranks the page above the guide task when both answer the query', () => {
    const synthetic: PaletteEntry[] = [
      { kind: 'page', id: 'nav:/comp', label: 'Comp', keywords: ['rsu'], to: '/comp' },
      {
        kind: 'guide',
        id: 'guide:comp-rsu-add',
        label: 'Add an RSU grant',
        sub: 'Guide · Comp',
        keywords: [],
        to: '/guide?section=pages#comp-rsu-add',
      },
    ]
    const hits = matchEntries('rsu', synthetic)
    expect(hits[0].kind).toBe('page')
    expect(hits[0].id).toBe('nav:/comp')
  })

  it('keeps every Settings section above the first guide hit for "settings"', () => {
    const withGuide: PaletteEntry[] = [
      ...statics,
      {
        kind: 'guide',
        id: 'guide:settings-change',
        label: 'Change a setting in Settings',
        sub: 'Guide · Settings',
        keywords: [],
        to: '/guide?section=pages#settings-change',
      },
    ]
    const hits = matchEntries('settings', withGuide)
    const firstGuide = hits.findIndex((e) => e.kind === 'guide')
    expect(firstGuide).toBeGreaterThan(-1)
    expect(hits.filter((e) => e.kind === 'section')).not.toHaveLength(0)
    expect(hits.every((e, i) => e.kind !== 'section' || i < firstGuide)).toBe(true)
  })

  it('still answers a query no destination matches with the task itself', () => {
    const hits = matchEntries('add an example', entries)
    expect(hits[0].kind).toBe('guide')
    expect(hits[0].id).toBe('guide:example-add')
  })
})
