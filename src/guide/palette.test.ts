import { describe, expect, it } from 'vitest'
import { guideEntries } from './palette'
import { FIXTURE_GUIDE } from './testing/fixtures'
import type { GuideChapter } from './types'

describe('guideEntries', () => {
  it('builds one entry per task, visible and folded, with the guide anchor as destination', () => {
    const entries = guideEntries(FIXTURE_GUIDE)
    const ids = entries.map((e) => e.id)
    expect(ids).toContain('guide:update-close')
    expect(ids).toContain('guide:example-add')
    expect(ids).toContain('guide:example-export')
    const add = entries.find((e) => e.id === 'guide:example-add')!
    expect(add.label).toBe('Add an example')
    expect(add.sub).toBe('Guide · Example')
    expect(add.to).toBe('/guide?section=pages#example-add')
    expect(add.keywords).toEqual(expect.arrayContaining(['how to', 'guide']))
  })

  it('merges task and card keywords and skips pointer tasks', () => {
    const guide: GuideChapter[] = [
      {
        id: 'pages',
        label: 'Pages',
        cards: [
          {
            id: 'page-x',
            title: 'X',
            purpose: 'p',
            to: '/taxes',
            keywords: ['card word'],
            tasks: [
              { id: 'x-do', title: 'Do X', where: 'W', steps: ['S.'], keywords: ['task word'] },
              { id: 'x-pointer', title: 'X is elsewhere', where: 'W', steps: ['S.'], to: '/guide?section=pages#x-do' },
            ],
          },
        ],
      },
    ]
    const entries = guideEntries(guide)
    expect(entries.map((e) => e.id)).toEqual(['guide:x-do'])
    expect(entries[0].keywords).toEqual(['task word', 'card word', 'how to', 'guide'])
  })
})
