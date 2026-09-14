import { describe, expect, it, vi } from 'vitest'
import { buildEntries, groupMatches, matchEntries, type PaletteEntry } from './paletteRegistry'

// The real GUIDE is content the lanes are still writing; the fixture keeps this suite
// deterministic. The factory imports the fixture itself — vi.mock is hoisted above the imports,
// so a top-level binding would not exist yet when anchors.ts pulls GUIDE in at module init
// (GuidePage.test.tsx mocks the same module the same way).
vi.mock('../guide/content', async () => {
  const { FIXTURE_GUIDE } = await import('../guide/testing/fixtures')
  return { GUIDE: FIXTURE_GUIDE }
})

const noop = () => {}
const entries = buildEntries({ month: '2026-09-01', run: { refreshPrices: noop, askAssistant: noop } })

describe('paletteRegistry — Guide group (2026-09-14 guide spec §6)', () => {
  it('registers one guide entry per task with the guide anchor as destination', () => {
    const guide = entries.filter((e) => e.kind === 'guide')
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
    expect(entries.filter((e) => e.kind === 'action')).toHaveLength(5)
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
