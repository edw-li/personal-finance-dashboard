import { Children, isValidElement } from 'react'
import type { ReactNode } from 'react'
import { GUIDE } from './content'
import type { GuideChapter } from './types'

export interface GuideSearchEntry {
  id: string
  title: string
  card: string
  chapter: string
  kind: 'Task' | 'Reference' | 'Overview'
  text: string
  keywords: string[]
  to: string
}
export function guideText(node: ReactNode): string {
  return Children.toArray(node).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child)
    return isValidElement<{ children?: ReactNode }>(child) ? guideText(child.props.children) : ''
  }).join(' ').replace(/\s+/g, ' ').trim()
}
const plain = (text: string) => text.replace(/\*\*|`/g, '')
export function buildGuideIndex(guide: readonly GuideChapter[] = GUIDE): GuideSearchEntry[] {
  return guide.flatMap((chapter) => chapter.cards.flatMap((card) => {
    const entry = (id: string, title: string, text: string, kind: GuideSearchEntry['kind'], keywords: string[] = []): GuideSearchEntry => ({
      id, title, card: card.title, chapter: chapter.label, kind, text: plain(text),
      keywords: [...keywords, ...(card.keywords ?? [])], to: `/guide?section=${chapter.id}#${id}`,
    })
    return [
      entry(card.id, card.title, [card.purpose, guideText(card.body), card.searchText, ...(card.watch ?? [])].filter(Boolean).join(' '), 'Overview'),
      ...[...card.tasks, ...(card.more ?? [])].map((task) => entry(task.id, task.title,
        [task.where, ...task.steps, ...(task.watch ?? []), ...(card.watch ?? []), task.example?.value, task.example?.note].filter(Boolean).join(' '), 'Task', task.keywords)),
      ...(card.definitions ?? []).map((definition) => entry(definition.id, definition.title, definition.text, 'Reference')),
    ]
  }))
}
export function searchGuide(query: string, entries: GuideSearchEntry[]): GuideSearchEntry[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return entries.map((entry) => {
    const title = entry.title.toLocaleLowerCase()
    const aliases = entry.keywords.join(' ').toLocaleLowerCase()
    const body = `${entry.chapter} ${entry.card} ${entry.text}`.toLocaleLowerCase()
    const score = terms.every((term) => `${title} ${aliases} ${body}`.includes(term))
      ? terms.reduce((sum, term) => sum + (title.includes(term) ? 12 : aliases.includes(term) ? 5 : 1), 0) + (title === query.trim().toLocaleLowerCase() ? 30 : 0)
      : 0
    return { entry, score }
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).map(({ entry }) => entry)
}
export function searchExcerpt(text: string, query: string): string {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const hits = terms.map((term) => text.toLocaleLowerCase().indexOf(term)).filter((index) => index >= 0)
  const start = Math.max(0, (hits.length ? Math.min(...hits) : 0) - 45)
  return `${start ? '…' : ''}${text.slice(start, start + 200)}${text.length > start + 200 ? '…' : ''}`
}
