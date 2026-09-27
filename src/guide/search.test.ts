import { describe, expect, it } from 'vitest'
import { chapterOf, cardOf } from './anchors'
import { GUIDE } from './content'
import { buildGuideIndex, searchGuide } from './search'

const entries = buildGuideIndex()
describe('Guide search coverage and destinations', () => {
  it('indexes every task, including setup, pointers and the long tail', () => {
    const tasks = GUIDE.flatMap((chapter) => chapter.cards.flatMap((card) => [...card.tasks, ...(card.more ?? [])]))
    expect(entries.filter((entry) => entry.kind === 'Task').map((entry) => entry.id)).toEqual(tasks.map((task) => task.id))
    expect(searchGuide('Pick a theme and a landing page', entries)[0].id).toBe('setup-appearance')
  })
  it('finds prose, custom reference tables and individually addressable glossary terms', () => {
    expect(searchGuide('relevant financial records', entries).some((entry) => entry.id === 'start-what')).toBe(true)
    expect(searchGuide('bank accounts', entries).some((entry) => entry.id === 'ref-data-sources')).toBe(true)
    expect(searchGuide('database size', entries).length).toBeGreaterThan(0)
    const term = searchGuide('provisional balances', entries)[0]
    expect(term.id).toBe('term-provisional-balances')
    expect(chapterOf(term.id)).toBe('reference')
    expect(cardOf(term.id)).toBe('ref-glossary')
    expect(term.to).toBe('/guide?section=reference#term-provisional-balances')
  })
  it('matches words across title and body and rejects an empty or unrelated query', () => {
    expect(searchGuide('workbook CSV', entries).some((entry) => entry.id === 'prepare-workbook')).toBe(true)
    expect(searchGuide('   ', entries)).toEqual([])
    expect(searchGuide('impossible-flux-capacitor', entries)).toEqual([])
  })
})
