import type { GuideChapter } from './types'
import { START_CARDS } from './content/start'
import { ROUTINE_CARDS } from './content/routines'
import { TRACKING_CARDS } from './content/pages-tracking'
import { INCOME_CARDS } from './content/pages-income'
import { PLANNING_CARDS } from './content/pages-planning'
import { REFERENCE_CARDS } from './content/reference'

// The whole guide, in reading order. Chapter ids and labels are the page's tab strip; the
// Pages chapter is the sidebar's order (tracking, income, planning). Six files, one per lane,
// so content lanes never edit the same file (2026-09-14 guide spec §1).
export const GUIDE: readonly GuideChapter[] = [
  { id: 'start', label: 'Start here', cards: START_CARDS },
  { id: 'routines', label: 'Routines', cards: ROUTINE_CARDS },
  { id: 'pages', label: 'Pages', cards: [...TRACKING_CARDS, ...INCOME_CARDS, ...PLANNING_CARDS] },
  { id: 'reference', label: 'Reference', cards: REFERENCE_CARDS },
]
