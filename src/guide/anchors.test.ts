import { describe, expect, it } from 'vitest'
import { buildAnchorIndex } from './anchors'
import type { GuideChapter } from './types'

const guide: GuideChapter[] = [
  {
    id: 'start',
    label: 'Start here',
    cards: [{ id: 'start-what', title: 'What', purpose: 'p', tasks: [] }],
  },
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
  it('maps card ids, visible task ids and folded task ids to their chapter', () => {
    const index = buildAnchorIndex(guide)
    expect(index.get('start-what')).toBe('start')
    expect(index.get('page-example')).toBe('pages')
    expect(index.get('example-do')).toBe('pages')
    expect(index.get('example-more')).toBe('pages')
    expect(index.get('nope')).toBeUndefined()
  })
})
