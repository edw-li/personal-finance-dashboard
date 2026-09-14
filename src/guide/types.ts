import type { ReactNode } from 'react'

// The guide is data, not prose in components (2026-09-14 guide spec §4): the page renders it,
// the command palette indexes it, and the fences in guideContent.test.ts hold every link and
// bold label to the real UI. Keep strings plain — the only markup `steps` may carry is
// **Label** for an on-screen label (renderSteps.tsx).
export type GuideChapterId = 'start' | 'routines' | 'pages' | 'reference'

export interface GuideTask {
  /** Stable anchor; kebab-case; unique across the whole guide. `-pointer` suffix = a one-step task
   *  that points at the real place (its `to` is never a guide anchor) — spec §5.1. */
  id: string
  /** Verb first: 'Add a card', 'Close the month'. */
  title: string
  /** UI path in on-screen labels: 'Manage → Card roster' or 'Settings → Household → Accounts'. */
  where: string
  /** 1–6 plain sentences, ≤ 15 words each; on-screen labels wrapped in **double asterisks**. */
  steps: string[]
  /** Deep link to the exact page/view/anchor. Optional only for tasks that are pure reading. */
  to?: string
  /** Traps specific to this task, one rule per line. */
  watch?: string[]
  /** Palette aliases beyond the words in `title`. */
  keywords?: string[]
}

export interface GuideCard {
  id: string
  title: string
  /** One sentence: what the page (or routine) is for. */
  purpose: string
  /** The page route for page cards ('/credit-cards'); drives "Open … →" and the completeness fence. */
  to?: string
  /** The page's views in strip order, on-screen labels — fenced against the page's PAGE_SECTIONS. */
  views?: string[]
  /** Core tasks, visible. 3–8 for page cards. */
  tasks: GuideTask[]
  /** Long tail under the rail's "More tasks" fold. */
  more?: GuideTask[]
  /** Card-level traps. ≤ 5. */
  watch?: string[]
  /** Prose for Start here / Reference cards; may contain <Link>s. Not fenced. */
  body?: ReactNode
  /** Extra palette aliases applied to every task in this card ('credit card', 'rewards'). */
  keywords?: string[]
  /** Rail rows show their 1-based number — a checklist read in order (2026-09-15 polish spec §2.2). */
  numbered?: boolean
}

export interface GuideChapter {
  id: GuideChapterId
  label: string
  cards: GuideCard[]
  /** One card at a time behind a sticky chip selector, the hash carrying the card (2026-09-15 polish spec §3). */
  selector?: boolean
}
