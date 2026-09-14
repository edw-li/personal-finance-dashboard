import { describe, expect, it } from 'vitest'
import { buildAnchorIndex } from './anchors'
import type { GuideChapter } from './types'

const guide: GuideChapter[] = [
  { id: 'start', label: 'Start here', cards: [{ id: 'start-what', title: 'What', purpose: 'p', tasks: [] }] },
  {
    id: 'pages',
    label: 'Pages',
    cards: [
      {
        id: 'page-example',
        title: 'Example',
        purpose: 'p',
        to: '/example',
        tasks: [{ id: 'example-do', title: 'Do', where: 'Here', steps: ['One.'] }],
        more: [{ id: 'example-more', title: 'More', where: 'Here', steps: ['Two.'] }],
      },
    ],
  },
]

describe('buildAnchorIndex', () => {
  const index = buildAnchorIndex(guide)

  it('maps card ids, visible task ids and folded task ids to their chapter', () => {
    expect(index.chapter.get('start-what')).toBe('start')
    expect(index.chapter.get('page-example')).toBe('pages')
    expect(index.chapter.get('example-do')).toBe('pages')
    expect(index.chapter.get('example-more')).toBe('pages')
    expect(index.chapter.get('nope')).toBeUndefined()
  })

  it('maps a card id to itself and every task id to its card', () => {
    expect(index.card.get('page-example')).toBe('page-example')
    expect(index.card.get('example-do')).toBe('page-example')
    expect(index.card.get('example-more')).toBe('page-example')
    expect(index.card.get('start-what')).toBe('start-what')
    expect(index.card.get('nope')).toBeUndefined()
  })
})
