import { GUIDE } from './content'
import type { GuideChapter, GuideChapterId } from './types'

/** Every card id and task id (visible and folded) → the chapter that renders it. First wins;
 *  the uniqueness fence in guideContent.test.ts is what forbids a second. */
export function buildAnchorIndex(guide: readonly GuideChapter[]): Map<string, GuideChapterId> {
  const index = new Map<string, GuideChapterId>()
  for (const chapter of guide) {
    for (const card of chapter.cards) {
      if (!index.has(card.id)) index.set(card.id, chapter.id)
      for (const task of [...card.tasks, ...(card.more ?? [])]) {
        if (!index.has(task.id)) index.set(task.id, chapter.id)
      }
    }
  }
  return index
}

const INDEX = buildAnchorIndex(GUIDE)

/** The chapter a `#id` belongs to — how a bare /guide#accounts-add opens the right tab. */
export function chapterOf(id: string): GuideChapterId | undefined {
  return INDEX.get(id)
}

export function allIds(): string[] {
  return Array.from(INDEX.keys())
}
