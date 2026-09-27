import { GUIDE } from './content'
import type { GuideChapter } from './types'
import { buildGuideIndex } from './search'

// The palette's view of the guide (2026-09-14 guide spec §6): one destination per task so
// "add a card" typed into Ctrl/⌘+K lands on the task, not the page. Shaped like a
// PaletteEntry minus `kind`; paletteRegistry.ts adds kind: 'guide' when it spreads these in
// (G5). Kept here, not in paletteRegistry, so the guide never imports the palette and no
// cycle forms. Pointer tasks are skipped — they would duplicate the canonical task's hit.
export interface GuidePaletteEntry {
  id: string
  label: string
  sub: string
  keywords: string[]
  to: string
}

export function guideEntries(guide: readonly GuideChapter[] = GUIDE): GuidePaletteEntry[] {
  return buildGuideIndex(guide).filter((entry) => !entry.id.endsWith('-pointer')).map((entry) => ({
    id: `guide:${entry.id}`, label: entry.title, sub: `Guide · ${entry.card}`,
    keywords: [...entry.keywords, 'how to', 'guide', entry.text], to: entry.to,
  }))
}
