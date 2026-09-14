import { GUIDE } from './content'
import type { GuideChapter, GuideChapterId } from './types'

export interface AnchorIndex {
  /** Every card id and task id (visible and folded) → the chapter that renders it. */
  chapter: Map<string, GuideChapterId>
  /** Every card id → itself, every task id → its card (2026-09-15 polish spec §2.4). */
  card: Map<string, string>
}

/** First wins; the uniqueness fence in guideContent.test.ts is what forbids a second. */
export function buildAnchorIndex(guide: readonly GuideChapter[]): AnchorIndex {
  const chapter = new Map<string, GuideChapterId>()
  const card = new Map<string, string>()
  for (const ch of guide) {
    for (const c of ch.cards) {
      if (!chapter.has(c.id)) {
        chapter.set(c.id, ch.id)
        card.set(c.id, c.id)
      }
      for (const task of [...c.tasks, ...(c.more ?? [])]) {
        if (!chapter.has(task.id)) {
          chapter.set(task.id, ch.id)
          card.set(task.id, c.id)
        }
      }
    }
  }
  return { chapter, card }
}

/** The bare id a `#hash` names, decoded. '' when the hash is empty or malformed — one rule for
 *  every reader of the hash, so a half-decoded target can never select one thing and address
 *  another (2026-09-15 polish spec §4). */
export function hashTarget(hash: string): string {
  try {
    return decodeURIComponent(hash.replace(/^#/, ''))
  } catch {
    return ''
  }
}

const INDEX = buildAnchorIndex(GUIDE)

/** The chapter a `#id` belongs to — how a bare /guide#accounts-add opens the right tab. */
export function chapterOf(id: string): GuideChapterId | undefined {
  return INDEX.chapter.get(id)
}

/** The card a `#id` belongs to — how a selector chapter picks the card and a card picks the task. */
export function cardOf(id: string): string | undefined {
  return INDEX.card.get(id)
}

export function allIds(): string[] {
  return Array.from(INDEX.chapter.keys())
}
