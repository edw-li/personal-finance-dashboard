# Lane G0 — Guide page shell, content model, fences (2026-09-14 guide) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> Opus implementer for this lane in its own worktree, TDD per task, then a spec-compliance review
> and a code-quality review, then a local merge to main — never pushed). Steps use `- [ ]`
> checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-14-onboarding-guide-design.md` — this lane implements
**§2 (navigation and route), §3 (page structure), §4 (content model), §8 (fence tests), §10 is
G5's**, and seeds the content files G1–G4 fill. Read §0, §1, §2, §3, §4 and §8 before Task 1.
Background: `docs/superpowers/specs/2026-09-14-onboarding-guide-research.md` §2 (the
engineering brief).

**Goal:** a **Guide** entry in the sidebar above Settings that opens `/guide`, a page with four
tabbed chapters rendering a typed content module into anchored cards, a seeded content module
with one finished exemplar card, fence tests that hold every guide link and bold label to the
real UI, and a palette entry builder the integration lane wires in. No content beyond the
exemplar — the content lanes own that.

**Architecture:** `src/components/navItems.ts` is the sidebar AND the route registry (title,
palette, landing picker follow it); `routeChunks.ts` + `App.tsx` add the lazy route;
`backend/app/services/prefs_registry.py` `NAV_PATHS` is a pinned twin. The page is
`PageFrame` (permanently ready, the `NotFoundPage` precedent) with `LocalSections` chapters
(`?section=`), a `resolveLegacy` that maps any `#id` to its chapter through an anchor index built
from `GUIDE`. Content is plain data (`src/guide/types.ts`) assembled in `src/guide/content.tsx`
from six per-chapter files; three small components render it; `renderSteps` turns
`**Label**` into `<b>`; the fences read page sources as text (the `paletteRegistry.test.ts`
technique).

**Tech stack:** React 19 + Vite 6 + TypeScript 5.9 (`strict`, `noUnusedLocals`,
`noUnusedParameters`, type-only imports must use `import type`), react-router-dom 7, vitest 3 +
Testing Library (jsdom 26; **no jest-dom matchers** — assert on attributes and `textContent`),
eslint 9 with `eslint-plugin-react-hooks` 7 (React-Compiler rules are errors: no `setState` in
effects/render, no ref reads in render), lucide-react 0.575. Backend twin check: Python venv at
`backend/.venv` (`ruff.exe`, `pytest.exe`).

---

## Mechanics (read once)

- Worktree: `C:/Users/edyli/personal-finance-dashboard/.worktrees/guide-g0`, branch
  `guide/g0-shell`, cut from `main`. From the repo root:
  `git worktree add -b guide/g0-shell .worktrees/guide-g0 main`, then work ONLY inside it
  (`cd .worktrees/guide-g0`). Node resolves the root's `node_modules` upward; if `npx vitest`
  cannot be found from the worktree, run `npm ci` there once.
- Every command below runs from the worktree root in Git Bash. `npx vitest run <paths>` is the
  test runner (tests import from `vitest`; no globals). `npx tsc -b` type-checks; `npx eslint src`
  lints; `npm run build` = `tsc -b && vite build`.
- Backend twin: `cd backend && ./.venv/Scripts/python.exe -m pytest tests/test_prefs_registry.py -q`
  and `./.venv/Scripts/ruff.exe check app/services/prefs_registry.py` (from `backend/`).
- Commit after every task with the prefix shown in its last step. Never push. Never touch
  `.worktrees/`, the DB or the dev servers.
- Files this lane may edit (spec §1): `src/components/navItems.ts`, `routeChunks.ts`,
  `App.tsx`, `App.test.tsx`, `Layout.test.tsx`, `Layout.tsx` (one comment),
  `backend/app/services/prefs_registry.py`; new `src/pages/GuidePage.tsx`, `GuidePage.css`,
  `GuidePage.test.tsx`; new `src/guide/types.ts`, `content.tsx`, `content/start.tsx`,
  `content/routines.tsx`, `content/pages-tracking.tsx`, `content/pages-income.tsx`,
  `content/pages-planning.tsx`, `content/reference.tsx`, `content/pending.ts`, `anchors.ts`,
  `renderSteps.tsx` (+test), `GuideTaskList.tsx`, `GuideCard.tsx` (+test),
  `GuidePageChips.tsx`, `palette.ts` (+test), `guideContent.test.ts`, `testing/fixtures.ts`
  (under `src/guide/testing/`). Nothing else — `paletteRegistry.ts`, `OverviewPage.tsx`,
  `MonthlyUpdatePage.tsx` and the probes belong to G5.

## House rules this plan encodes (do not "improve" them away)

1. **Durations are tokens only.** `src/theme/motion.test.ts` scans every `.css` under `src/`
   and fails on a literal finite duration. `GuidePage.css` states no `transition`/`animation`
   at all; if one is ever wanted it is `var(--t-fast)`.
2. **Colours are tokens only.** `var(--text)`, `var(--muted)`, `var(--accent)`, `var(--border)`,
   `var(--surface-2)`. No hex, no rgb.
3. **Per-page sheets are self-contained.** `GuidePage.css` never imports another page's sheet
   and never redefines `.card`, `.eyebrow`, `.chip`, `.drill-hint`, `.empty-note` (those live in
   `panels.css`).
4. **The page owns the heading outline.** `h1` is `PageFrame`'s; cards are `h2.eyebrow`;
   *Do this* / *Watch out* are `h3`; tasks are `h4`. Never render a heading from content strings.
5. **Existing tests are updated, never deleted.** Three enumerating tests move on purpose and are
   named in Task 2.
6. **`mounts.audit.test.ts`** walks every `.tsx` under `src/`: no `<EChart` outside `ChartCard`,
   no retired header classes (`.panel-title`, `.section-title`), no `empty-note` beside a
   `<ChartCard`. The guide has no charts; keep it that way.
7. **No personal data in content or fixtures**: no real names, tickers, amounts. Fixtures use
   `Example page`, `Do the thing`, `$X`.

## Contracts this lane publishes (G1–G5 build against these verbatim)

```ts
// src/guide/types.ts
export type GuideChapterId = 'start' | 'routines' | 'pages' | 'reference'
export interface GuideTask { id: string; title: string; where: string; steps: string[]; to?: string; watch?: string[]; keywords?: string[] }
export interface GuideCard { id: string; title: string; purpose: string; to?: string; views?: string[]; tasks: GuideTask[]; more?: GuideTask[]; watch?: string[]; body?: ReactNode; keywords?: string[] }
export interface GuideChapter { id: GuideChapterId; label: string; cards: GuideCard[] }

// src/guide/content.tsx
export const GUIDE: readonly GuideChapter[]        // [start, routines, pages, reference]; pages = tracking ++ income ++ planning

// src/guide/content/pending.ts
export const PENDING_PAGES: readonly string[]      // routes whose cards have not landed; lanes delete their routes; V deletes the file

// src/guide/anchors.ts
export function buildAnchorIndex(guide: readonly GuideChapter[]): Map<string, GuideChapterId>
export function chapterOf(id: string): GuideChapterId | undefined
export function allIds(): string[]

// src/guide/palette.ts
export interface GuidePaletteEntry { id: string; label: string; sub: string; keywords: string[]; to: string }
export function guideEntries(guide?: readonly GuideChapter[]): GuidePaletteEntry[]   // one per non-pointer task; id `guide:<taskId>`; to `/guide?section=<chapter>#<taskId>`

// URL grammar
/guide?section=<start|routines|pages|reference>#<cardId|taskId>   (bare /guide#<id> resolves to the owning chapter)
```

Content conventions (spec §5.3) the fences enforce: task/card ids kebab-case and unique; a task
id ending in `-pointer` carries exactly one step and points at the REAL destination
(`/settings?section=household#accounts`), never a `/guide` anchor (spec §5.1); `steps` ≤ 160 characters, labels as `**Label**`; page cards (a `to` that is a
sidebar route) show 3–8 visible tasks and carry `views` equal to that page's tab labels.

## File map

| File | Responsibility |
| --- | --- |
| `src/components/navItems.ts` | + Guide entry (utility tail, before Settings) |
| `src/components/routeChunks.ts` | + `/guide` chunk |
| `src/App.tsx` | + lazy import + `<Route path="/guide">` |
| `backend/app/services/prefs_registry.py` | + `"/guide"` in `NAV_PATHS` |
| `src/components/Layout.test.tsx`, `src/App.test.tsx`, `src/components/Layout.tsx` | enumerating pins + one comment |
| `src/guide/types.ts` | the content model |
| `src/guide/content/*.tsx`, `pending.ts` | per-chapter content (seeded), the pending escape hatch |
| `src/guide/content.tsx` | assembles `GUIDE` |
| `src/guide/anchors.ts` | id → chapter index |
| `src/guide/renderSteps.tsx` | `**Label**` → `<b>` |
| `src/guide/GuideTaskList.tsx`, `GuideCard.tsx`, `GuidePageChips.tsx` | renderer |
| `src/guide/palette.ts` | palette entry builder (wired by G5) |
| `src/guide/testing/fixtures.ts` | a small fake guide for component/page tests |
| `src/guide/guideContent.test.ts` | the fences (spec §8.1–8.3) |
| `src/pages/GuidePage.tsx`, `GuidePage.css`, `GuidePage.test.tsx` | the page |

---

## Task 1 — sidebar entry, route, chunk, backend twin (spec §2.1, §2.2)

**Files:**
- Modify: `src/components/navItems.ts:1-16` (import), `:128-133` (trailing section)
- Modify: `src/components/routeChunks.ts:10-24`
- Modify: `src/App.tsx:19-31`, `:46-66`
- Modify: `backend/app/services/prefs_registry.py:19-33`
- Create: `src/pages/GuidePage.tsx` (placeholder page so the route compiles — replaced in Task 8)
- Test: `src/components/routeChunks.test.ts` (unchanged, must pass), `backend/tests/test_prefs_registry.py`

- [x] **Step 1: Run the two lockstep tests to see them green before the change**

Run: `npx vitest run src/components/routeChunks.test.ts`
Expected: PASS (2 tests).

- [x] **Step 2: Add the nav entry**

In `src/components/navItems.ts`, add `BookOpen` to the lucide import (alphabetical: after
`Banknote`, before `Briefcase`):

```ts
import {
  Banknote,
  BookOpen,
  Briefcase,
  CalendarCheck,
  CalendarDays,
  CreditCard,
  LayoutDashboard,
  LineChart,
  PiggyBank,
  Receipt,
  Settings,
  Telescope,
  TrendingUp,
  Wallet,
} from 'lucide-react'
```

Change the `NavSection.heading` doc comment from
`/** null = ungrouped (the top pair, and Settings alone at the bottom). */` to
`/** null = ungrouped (the top pair, and the utility tail at the bottom: Guide, then Settings). */`.

Replace the trailing section:

```ts
  {
    heading: null,
    items: [
      // The guide sits with Settings in the utility tail (2026-09-14 guide spec §2.1): help
      // beside preferences is where readers look for it, and the top pair stays the two
      // destinations every visit starts from. BookOpen, not Info (already two meanings) and
      // not CircleHelp (reserved for the metric-inspector trigger).
      {
        to: '/guide',
        label: 'Guide',
        icon: BookOpen,
        keywords: ['help', 'how to', 'how do i', 'tutorial', 'manual', 'onboarding', 'docs', 'getting started', 'shortcuts', 'keyboard'],
      },
      { to: '/settings', label: 'Settings', icon: Settings, keywords: ['preferences', 'options'] },
    ],
  },
```

- [x] **Step 3: Run the lockstep test to see it fail (nav has a path with no chunk)**

Run: `npx vitest run src/components/routeChunks.test.ts`
Expected: FAIL — the "every nav destination has a chunk" assertion names `/guide`.

- [x] **Step 4: Add the chunk and the route**

`src/components/routeChunks.ts` — after the `/settings` line:

```ts
  '/settings': () => import('../pages/SettingsPage'),
  '/guide': () => import('../pages/GuidePage'),
```

`src/App.tsx` — after `const SettingsPage = lazy(ROUTE_CHUNKS['/settings'])`:

```ts
const GuidePage = lazy(ROUTE_CHUNKS['/guide'])
```

and after `<Route path="/settings" element={<SettingsPage />} />`:

```tsx
                  <Route path="/guide" element={<GuidePage />} />
```

Create a compiling placeholder `src/pages/GuidePage.tsx` (Task 8 replaces it wholesale):

```tsx
import PageFrame from '../components/shell/PageFrame'

export default function GuidePage() {
  return (
    <div className="page guide-page">
      <PageFrame title="Guide" resource={{ status: 'ready' }}>
        <p className="empty-note">The guide is being written.</p>
      </PageFrame>
    </div>
  )
}
```

- [x] **Step 5: Run the lockstep test and the type-check**

Run: `npx vitest run src/components/routeChunks.test.ts && npx tsc -b`
Expected: PASS; tsc silent.

- [x] **Step 6: Backend twin — see the pinned test fail, then fix it**

Run (from `backend/`): `./.venv/Scripts/python.exe -m pytest tests/test_prefs_registry.py -q`
Expected: FAIL — the set-equality assertion reports `/guide` present in `navItems.ts` and absent
from `NAV_PATHS`.

Edit `backend/app/services/prefs_registry.py` `NAV_PATHS` — append after `"/settings"`:

```python
    "/settings",
    "/guide",
)
```

Run again: `./.venv/Scripts/python.exe -m pytest tests/test_prefs_registry.py -q` → PASS.
Run: `./.venv/Scripts/ruff.exe check app/services/prefs_registry.py && ./.venv/Scripts/ruff.exe format --check app/services/prefs_registry.py` → clean.

- [x] **Step 7: Commit**

```bash
git add src/components/navItems.ts src/components/routeChunks.ts src/App.tsx src/pages/GuidePage.tsx backend/app/services/prefs_registry.py
git commit -m "feat(guide): Guide destination in the sidebar's utility tail, /guide route and chunk, NAV_PATHS twin (spec §2.1–2.2)"
```

---

## Task 2 — move the three enumerating pins (spec §2.3)

**Files:**
- Modify: `src/components/Layout.test.tsx:210-224`
- Modify: `src/App.test.tsx:21`
- Modify: `src/components/Layout.tsx:175` (comment)

- [x] **Step 1: Run the two suites to see the exact failures**

Run: `npx vitest run src/components/Layout.test.tsx src/App.test.tsx`
Expected: `Layout.test.tsx` FAILS on the nav-order `toEqual` (14 links rendered, 13 expected);
`App.test.tsx` may pass (its mock has no `/guide`, so `/guide` renders the 404 in that suite) —
it moves anyway so the mock stays the twin of the real map.

- [x] **Step 2: Update the nav-order pin**

In `src/components/Layout.test.tsx` replace the comment and array:

```ts
    // The full order IS the contract: ungrouped pair, three groups, then the utility tail —
    // Guide, then Settings last (2026-09-14 guide spec §2.1).
    expect(Array.from(nav.querySelectorAll('a')).map((a) => a.textContent)).toEqual([
      'Overview',
      'Monthly update',
      'Net worth',
      'Portfolio',
      'Spending',
      'Credit cards',
      'Paycheck',
      'Comp',
      'ESPP',
      'Taxes',
      'Projection',
      'Calendar',
      'Guide',
      'Settings',
    ])
```

- [x] **Step 3: Update the route mock**

In `src/App.test.tsx` line 21:

```ts
  const routes = ['/', '/update', '/net-worth', '/spending', '/portfolio', '/credit-cards', '/taxes', '/espp', '/paycheck', '/comp', '/calendar', '/projection', '/settings', '/guide']
```

- [x] **Step 4: Fix the stale comment**

In `src/components/Layout.tsx` line 175 change `12-link sidebar` to `14-link sidebar`.

- [x] **Step 5: Run the suites**

Run: `npx vitest run src/components/Layout.test.tsx src/App.test.tsx src/components/usePageTitle.test.tsx src/components/paletteRegistry.test.ts`
Expected: all PASS (the palette's page entries come from `NAV_ITEMS`, so `Guide` is already a
Pages entry; the five-action pin is untouched).

- [x] **Step 6: Commit**

```bash
git add src/components/Layout.test.tsx src/App.test.tsx src/components/Layout.tsx
git commit -m "test(shell): nav order and route mock carry Guide before Settings; skip-link comment counts 14 links"
```

---

## Task 3 — content model, seeds, assembler, anchor index (spec §4)

**Files:**
- Create: `src/guide/types.ts`, `src/guide/content/pending.ts`, `src/guide/content/start.tsx`,
  `src/guide/content/routines.tsx`, `src/guide/content/pages-tracking.tsx`,
  `src/guide/content/pages-income.tsx`, `src/guide/content/pages-planning.tsx`,
  `src/guide/content/reference.tsx`, `src/guide/content.tsx`, `src/guide/anchors.ts`
- Test: `src/guide/anchors.test.ts`

- [x] **Step 1: Write the failing anchor-index test**

`src/guide/anchors.test.ts`:

```ts
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
```

- [x] **Step 2: Run it to see it fail**

Run: `npx vitest run src/guide/anchors.test.ts`
Expected: FAIL — cannot resolve `./anchors` / `./types`.

- [x] **Step 3: Write the types**

`src/guide/types.ts`:

```ts
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
  /** Long tail behind the Disclosure. */
  more?: GuideTask[]
  /** Card-level traps. ≤ 5. */
  watch?: string[]
  /** Prose for Start here / Reference cards; may contain <Link>s. Not fenced. */
  body?: ReactNode
  /** Extra palette aliases applied to every task in this card ('credit card', 'rewards'). */
  keywords?: string[]
}

export interface GuideChapter {
  id: GuideChapterId
  label: string
  cards: GuideCard[]
}
```

- [x] **Step 4: Seed the content files**

`src/guide/content/pending.ts`:

```ts
// Routes whose guide cards have not landed yet (2026-09-14 guide spec §8.3). The completeness
// fence accepts a pending route in place of a card; each content lane deletes its routes as it
// lands them (G1: /update · G2: /, /net-worth, /portfolio, /spending, /credit-cards ·
// G3: /paycheck, /comp, /espp, /taxes · G4: /projection, /calendar, /settings). Lane V asserts
// the array is empty and deletes this file and its import.
export const PENDING_PAGES: readonly string[] = [
  '/',
  '/update',
  '/net-worth',
  '/portfolio',
  '/spending',
  '/credit-cards',
  '/paycheck',
  '/comp',
  '/espp',
  '/taxes',
  '/projection',
  '/calendar',
  '/settings',
]
```

`src/guide/content/start.tsx` — the exemplar card (G1 keeps or edits it; links only to routes
and views that exist today, so the link fence is green from this commit):

```tsx
import { Link } from 'react-router-dom'
import type { GuideCard } from '../types'

// Chapter: Start here (2026-09-14 guide spec §5.1). Card ids are fixed by the spec:
// start-what · start-organized · start-setup · start-next. G1 owns everything below the
// exemplar; the exemplar shows the voice (task-first, sentence case, the em-dash consequence
// clause, honest about what is not saved) and the shape (purpose + body, no tasks).
export const START_CARDS: GuideCard[] = [
  {
    id: 'start-what',
    title: 'What this dashboard does',
    purpose:
      'A self-hosted dashboard for one household\u2019s money: you enter balances, spending and take-home once a month, prices refresh on a schedule, and everything else is computed from those entries.',
    tasks: [],
    body: (
      <>
        <p className="guide-body">
          Nothing leaves your server except price lookups and, if you turn it on, the questions you ask
          the assistant. Two people can be tracked; most pages have a <b className="guide-label">Whose</b>{' '}
          chip in the sticky row under the title.
        </p>
        <p className="guide-body">
          Three rhythms: set it up once in <Link to="/settings?section=household">Settings</Link>, update it
          every month in <Link to="/update">Monthly update</Link>, and refresh tax tables and contribution
          limits once a year on <Link to="/taxes">Taxes</Link> and{' '}
          <Link to="/settings?section=planning">Settings → Planning</Link>.
        </p>
      </>
    ),
  },
]
```

`src/guide/content/routines.tsx`:

```tsx
import type { GuideCard } from '../types'

// Chapter: Routines (2026-09-14 guide spec §5.1) — routine-monthly (to: '/update'),
// routine-tax-season, routine-health. Filled by lane G1.
export const ROUTINE_CARDS: GuideCard[] = []
```

`src/guide/content/pages-tracking.tsx`:

```tsx
import type { GuideCard } from '../types'

// Chapter: Pages — Overview, Net worth, Portfolio, Spending, Credit cards, in sidebar order
// (2026-09-14 guide spec §5.1). Filled by lane G2.
export const TRACKING_CARDS: GuideCard[] = []
```

`src/guide/content/pages-income.tsx`:

```tsx
import type { GuideCard } from '../types'

// Chapter: Pages — Paycheck, Comp, ESPP, Taxes (2026-09-14 guide spec §5.1). Filled by lane G3.
export const INCOME_CARDS: GuideCard[] = []
```

`src/guide/content/pages-planning.tsx`:

```tsx
import type { GuideCard } from '../types'

// Chapter: Pages — Projection, Calendar, Settings (two cards) (2026-09-14 guide spec §5.1).
// Filled by lane G4.
export const PLANNING_CARDS: GuideCard[] = []
```

`src/guide/content/reference.tsx`:

```tsx
import type { GuideCard } from '../types'

// Chapter: Reference — ref-typing · ref-keyboard · ref-undo · ref-sandboxes · ref-links ·
// ref-assistant · ref-glossary · ref-settings-map (2026-09-14 guide spec §5.1). Filled by lane G4.
export const REFERENCE_CARDS: GuideCard[] = []
```

`src/guide/content.tsx`:

```tsx
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
```

`src/guide/anchors.ts`:

```ts
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
```

- [x] **Step 5: Run the test and the type-check**

Run: `npx vitest run src/guide/anchors.test.ts && npx tsc -b`
Expected: PASS; tsc silent (`noUnusedLocals` is satisfied — every import is used).

- [x] **Step 6: Commit**

```bash
git add src/guide
git commit -m "feat(guide): content model, per-lane content seeds with the Start-here exemplar, GUIDE assembler, anchor index (spec §4)"
```

---

## Task 4 — `renderSteps` (spec §3.2)

**Files:**
- Create: `src/guide/renderSteps.tsx`
- Test: `src/guide/renderSteps.test.tsx`

- [x] **Step 1: Write the failing test**

`src/guide/renderSteps.test.tsx`:

```tsx
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderSteps } from './renderSteps'

afterEach(cleanup)

describe('renderSteps', () => {
  it('turns **Label** spans into bold on-screen labels and leaves the rest as text', () => {
    const { container } = render(<p>{renderSteps('Open **Manage**, then press **Add card**.')}</p>)
    const labels = Array.from(container.querySelectorAll('b.guide-label')).map((b) => b.textContent)
    expect(labels).toEqual(['Manage', 'Add card'])
    expect(container.textContent).toBe('Open Manage, then press Add card.')
  })

  it('recognises no other markup — asterisks, backticks and brackets render literally', () => {
    const { container } = render(<p>{renderSteps('Type *5* for `5 %` and see [the chart](x).')}</p>)
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toBe('Type *5* for `5 %` and see [the chart](x).')
  })

  it('escapes angle brackets as text, never markup', () => {
    const { container } = render(<p>{renderSteps('Pick **Start <Month>** when it appears.')}</p>)
    expect(container.querySelector('b.guide-label')?.textContent).toBe('Start <Month>')
    expect(container.querySelector('month')).toBeNull()
  })
})
```

- [x] **Step 2: Run it to see it fail**

Run: `npx vitest run src/guide/renderSteps.test.tsx`
Expected: FAIL — cannot resolve `./renderSteps`.

- [x] **Step 3: Implement**

`src/guide/renderSteps.tsx`:

```tsx
import type { ReactNode } from 'react'

// The one piece of markup guide steps may carry: **Label** for an on-screen label, rendered
// bold so a reader can match it to the button in front of them. Nothing else is parsed — a
// step is a sentence, not a document (2026-09-14 guide spec §3.2). React escapes the text
// itself, so '<Month>' is a placeholder, not an element.
const LABEL = /\*\*(.+?)\*\*/g

export function renderSteps(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(LABEL)) {
    const start = match.index ?? 0
    if (start > last) nodes.push(text.slice(last, start))
    nodes.push(
      <b className="guide-label" key={`${start}-${match[1]}`}>
        {match[1]}
      </b>,
    )
    last = start + match[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}
```

- [x] **Step 4: Run the test**

Run: `npx vitest run src/guide/renderSteps.test.tsx`
Expected: PASS (3 tests).

- [x] **Step 5: Commit**

```bash
git add src/guide/renderSteps.tsx src/guide/renderSteps.test.tsx
git commit -m "feat(guide): renderSteps — **Label** becomes a bold on-screen label, nothing else is markup (spec §3.2)"
```

---

## Task 5 — fixtures, `GuideTaskList`, `GuideCard` (spec §3.2)

**Files:**
- Create: `src/guide/testing/fixtures.ts`, `src/guide/GuideTaskList.tsx`, `src/guide/GuideCard.tsx`
- Test: `src/guide/GuideCard.test.tsx`

- [x] **Step 1: Write the fixture**

`src/guide/testing/fixtures.ts` — a small fake guide with no real product words (used by the
component and page tests; the real content is fenced separately):

```ts
import type { GuideChapter } from '../types'

export const FIXTURE_GUIDE: readonly GuideChapter[] = [
  {
    id: 'start',
    label: 'Start here',
    cards: [{ id: 'start-what', title: 'What this fixture does', purpose: 'A fixture.', tasks: [] }],
  },
  {
    id: 'routines',
    label: 'Routines',
    cards: [
      {
        id: 'routine-monthly',
        title: 'The monthly fixture',
        purpose: 'Once a month.',
        to: '/update',
        tasks: [
          { id: 'update-close', title: 'Close the fixture', where: 'Review', steps: ['Press **Save and close month**.'], to: '/update?step=review' },
        ],
      },
    ],
  },
  {
    id: 'pages',
    label: 'Pages',
    cards: [
      {
        id: 'page-example',
        title: 'Example',
        purpose: 'An example page.',
        to: '/net-worth',
        views: ['Overview', 'Accounts'],
        tasks: [
          {
            id: 'example-add',
            title: 'Add an example',
            where: 'Accounts → Example roster',
            steps: ['Open **Accounts**.', 'Press **Add example**.'],
            to: '/net-worth?section=accounts',
            watch: ['Blank means not entered — it is never a zero.'],
          },
        ],
        more: [
          { id: 'example-export', title: 'Export the example', where: 'Any chart', steps: ['Press **Export**.'] },
          { id: 'example-table', title: 'Show the table', where: 'Any chart', steps: ['Press **Table**.'] },
        ],
        watch: ['The example is entered as a negative number — a positive one inflates the total.'],
      },
      {
        id: 'page-taxes',
        title: 'Taxes fixture',
        purpose: 'A second page card so the chip row has two links.',
        to: '/taxes',
        views: ['Summary', 'What-if', 'Inputs', 'Tax tables'],
        tasks: [{ id: 'taxes-fixture', title: 'Do a tax thing', where: 'Summary', steps: ['Read the totals.'] }],
      },
    ],
  },
  {
    id: 'reference',
    label: 'Reference',
    cards: [{ id: 'ref-glossary', title: 'Words', purpose: 'Definitions.', tasks: [] }],
  },
]
```

- [x] **Step 2: Write the failing component test**

`src/guide/GuideCard.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import GuideCard from './GuideCard'
import { FIXTURE_GUIDE } from './testing/fixtures'

afterEach(cleanup)

const pageCard = FIXTURE_GUIDE[2].cards[0]

function renderCard(card = pageCard) {
  return render(
    <MemoryRouter initialEntries={['/guide?section=pages']}>
      <GuideCard card={card} />
    </MemoryRouter>,
  )
}

describe('GuideCard', () => {
  it('renders the four-part grammar: purpose, views, Do this, Watch out, and an Open link', () => {
    renderCard()
    const card = document.getElementById('page-example') as HTMLElement
    expect(card.tagName).toBe('SECTION')
    expect(card.className).toContain('card')
    expect(within(card).getByRole('heading', { level: 2, name: 'Example' })).toBeTruthy()
    expect(within(card).getByText('An example page.')).toBeTruthy()
    expect(within(card).getByText('Views: Overview · Accounts')).toBeTruthy()
    expect(within(card).getByRole('link', { name: 'Open Example →' }).getAttribute('href')).toBe('/net-worth')
    expect(within(card).getByRole('heading', { level: 3, name: 'Do this' })).toBeTruthy()
    expect(within(card).getByRole('heading', { level: 3, name: 'Watch out' })).toBeTruthy()
    expect(within(card).getByText('The example is entered as a negative number — a positive one inflates the total.')).toBeTruthy()
  })

  it('renders each task with its own anchor, title, where, bold-label steps, task traps and a Go link', () => {
    renderCard()
    const task = document.getElementById('example-add') as HTMLElement
    expect(task.tagName).toBe('LI')
    expect(within(task).getByRole('heading', { level: 4, name: 'Add an example' })).toBeTruthy()
    expect(within(task).getByText('Accounts → Example roster')).toBeTruthy()
    const steps = within(task).getAllByRole('listitem').filter((li) => li.closest('ol.guide-steps'))
    expect(steps.map((li) => li.textContent)).toEqual(['Open Accounts.', 'Press Add example.'])
    expect(task.querySelectorAll('ol.guide-steps b.guide-label')).toHaveLength(2)
    expect(within(task).getByText('Blank means not entered — it is never a zero.')).toBeTruthy()
    expect(within(task).getByRole('link', { name: 'Go →' }).getAttribute('href')).toBe('/net-worth?section=accounts')
  })

  it('folds the long tail behind a Disclosure that names its count and mounts on open', () => {
    renderCard()
    const details = document.querySelector('details.guide-more') as HTMLDetailsElement
    expect(details.open).toBe(false)
    const summary = screen.getByText('More tasks (2)')
    fireEvent.click(summary)
    expect(details.open).toBe(true)
    expect(document.getElementById('example-export')).toBeTruthy()
    expect(document.getElementById('example-table')).toBeTruthy()
  })

  it('omits Open, views, Do this, Watch out and More when a card has none of them', () => {
    renderCard(FIXTURE_GUIDE[0].cards[0])
    const card = document.getElementById('start-what') as HTMLElement
    expect(within(card).queryByRole('link')).toBeNull()
    expect(within(card).queryByText(/^Views:/)).toBeNull()
    expect(within(card).queryByRole('heading', { level: 3 })).toBeNull()
    expect(card.querySelector('details')).toBeNull()
  })
})
```

- [x] **Step 3: Run it to see it fail**

Run: `npx vitest run src/guide/GuideCard.test.tsx`
Expected: FAIL — cannot resolve `./GuideCard`.

- [x] **Step 4: Implement the task list and the card**

`src/guide/GuideTaskList.tsx`:

```tsx
import { Link } from 'react-router-dom'
import { renderSteps } from './renderSteps'
import type { GuideTask } from './types'

// One task = one <li> with its own id (an anchor the palette and pointer tasks target), a
// verb-first h4, the on-screen path, numbered steps, its own traps, and the Go link. The
// list is an <ol> because the tasks on a card are in the order a reader does them.
export default function GuideTaskList({ tasks }: { tasks: GuideTask[] }) {
  return (
    <ol className="guide-tasks">
      {tasks.map((task) => (
        <li key={task.id} id={task.id} className="guide-task">
          <h4 className="guide-task-title">{task.title}</h4>
          <p className="guide-where">
            <span className="guide-where-label">Where:</span> {task.where}
          </p>
          <ol className="guide-steps">
            {task.steps.map((step, index) => (
              <li key={index}>{renderSteps(step)}</li>
            ))}
          </ol>
          {task.watch && task.watch.length > 0 && (
            <ul className="guide-task-watch">
              {task.watch.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {task.to && (
            <Link className="guide-go" to={task.to}>
              Go →
            </Link>
          )}
        </li>
      ))}
    </ol>
  )
}
```

`src/guide/GuideCard.tsx`:

```tsx
import { Link } from 'react-router-dom'
import Disclosure from '../components/Disclosure'
import GuideTaskList from './GuideTaskList'
import type { GuideCard as GuideCardData } from './types'

// The four-part card grammar (2026-09-14 guide spec §3.2): Purpose · Do this · Watch out ·
// More. A .card so the shell's entrance, stagger and scroll reveal apply with no opt-in; the
// eyebrow h2 carries the card's id as its anchor target's label.
export default function GuideCard({ card }: { card: GuideCardData }) {
  const hasTasks = card.tasks.length > 0
  const hasWatch = (card.watch?.length ?? 0) > 0
  const more = card.more ?? []
  return (
    <section className="card span-12 guide-card" id={card.id} aria-labelledby={`${card.id}-title`}>
      <div className="guide-card-head">
        <h2 className="eyebrow" id={`${card.id}-title`}>
          {card.title}
        </h2>
        {card.to && (
          <Link className="guide-open" to={card.to}>
            Open {card.title} →
          </Link>
        )}
      </div>
      <p className="guide-purpose">{card.purpose}</p>
      {card.views && card.views.length > 0 && <p className="drill-hint">Views: {card.views.join(' · ')}</p>}
      {card.body}
      {hasTasks && (
        <>
          <h3 className="guide-h3">Do this</h3>
          <GuideTaskList tasks={card.tasks} />
        </>
      )}
      {hasWatch && (
        <>
          <h3 className="guide-h3">Watch out</h3>
          <ul className="guide-watch">
            {card.watch!.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
      {more.length > 0 && (
        <Disclosure summary={`More tasks (${more.length})`} className="guide-more">
          <GuideTaskList tasks={more} />
        </Disclosure>
      )}
    </section>
  )
}
```

(`card.watch!` is safe behind `hasWatch`; if eslint's `no-non-null-assertion` is on in this
repo, write `{(card.watch ?? []).map(...)}` instead.)

- [x] **Step 5: Run the test, then lint**

Run: `npx vitest run src/guide/GuideCard.test.tsx && npx eslint src/guide`
Expected: PASS (4 tests); eslint clean.

- [x] **Step 6: Commit**

```bash
git add src/guide/testing/fixtures.ts src/guide/GuideTaskList.tsx src/guide/GuideCard.tsx src/guide/GuideCard.test.tsx
git commit -m "feat(guide): GuideCard and GuideTaskList — Purpose · Do this · Watch out · More, anchored tasks, Go and Open links (spec §3.2)"
```

---

## Task 6 — `GuidePageChips` (spec §3.1)

**Files:**
- Create: `src/guide/GuidePageChips.tsx`
- Test: covered by `GuidePage.test.tsx` in Task 8 (the component is three lines of JSX; its
  behaviour — a Link navigation that the section hook turns into scroll + focus — is a page
  concern)

- [x] **Step 1: Implement**

`src/guide/GuidePageChips.tsx`:

```tsx
import { Link } from 'react-router-dom'
import type { GuideChapter } from './types'

// One chip per page card, sidebar order, at the top of the Pages chapter. A <Link> to
// ?section=pages#<cardId>: the navigation pushes a location key, and useLocalSections'
// arrival effect scrolls the card in and focuses it (2026-09-14 guide spec §3.1). Not a
// Segmented: nothing is "selected" — these are jumps, not a state.
export default function GuidePageChips({ chapter }: { chapter: GuideChapter }) {
  return (
    <nav className="guide-chips span-12" aria-label="Pages in this guide">
      {chapter.cards.map((card) => (
        <Link key={card.id} className="chip" to={{ search: '?section=pages', hash: `#${card.id}` }}>
          {card.title}
        </Link>
      ))}
    </nav>
  )
}
```

- [x] **Step 2: Type-check and commit**

Run: `npx tsc -b`
Expected: silent.

```bash
git add src/guide/GuidePageChips.tsx
git commit -m "feat(guide): GuidePageChips — one jump chip per page card (spec §3.1)"
```

---

## Task 7 — the stylesheet (spec §3.3)

**Files:**
- Create: `src/pages/GuidePage.css`

- [x] **Step 1: Write the sheet**

```css
/* GuidePage.css — page-scoped rules only (OverviewPage.css's charter): .page/.card/.card-grid/
   .eyebrow/.chip/.drill-hint/.empty-note live in panels.css and are never redefined here.
   No transition or animation in this file — the shell's card entrance, stagger and reveal
   already apply to every .card (2026-09-05 motion spec); a duration here would have to be a
   var(--t-*) token anyway (motion.test.ts). */

.guide-card-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
}

.guide-card-head .eyebrow {
  margin-bottom: 0.5rem;
}

/* Reading measure: the detail panel's reading mode caps prose at 72ch (details.css); the
   guide's prose does the same so a 1920px viewport never stretches a sentence across it. */
.guide-purpose,
.guide-body,
.guide-steps,
.guide-watch,
.guide-task-watch {
  max-width: 72ch;
}

.guide-purpose {
  margin: 0 0 0.5rem;
}

.guide-body {
  margin: 0.4rem 0;
  font-size: 0.95rem;
}

/* One level under the eyebrow — the same small caps, an h3 so the outline stays honest. */
.guide-h3 {
  margin: 1rem 0 0.4rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
}

.guide-tasks {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.9rem;
}

.guide-task-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
}

.guide-where {
  margin: 0.1rem 0 0.3rem;
  color: var(--muted);
  font-size: 0.85rem;
}

.guide-where-label {
  font-weight: 600;
}

.guide-steps {
  margin: 0 0 0.3rem 1.2rem;
  padding: 0;
}

.guide-steps li {
  margin: 0.15rem 0;
}

.guide-label {
  font-weight: 600;
  color: var(--text);
}

.guide-watch,
.guide-task-watch {
  margin: 0 0 0 1.1rem;
  padding: 0;
  color: var(--muted);
  font-size: 0.85rem;
}

.guide-watch li,
.guide-task-watch li {
  margin: 0.15rem 0;
}

.guide-go,
.guide-open {
  font-size: 0.85rem;
}

.guide-more {
  margin-top: 0.75rem;
}

/* panels.css has no generic a:focus-visible; the guide's links get the house ring. */
.guide-page a:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px;
}

.guide-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0 0 0.25rem;
}

.guide-chips a.chip {
  text-decoration: none;
}

/* Anchors clear the sticky title/strip block by the measured inset (SettingsPage's form). */
.guide-page [id] {
  scroll-margin-top: calc(var(--sticky-inset, 0px) + 0.75rem);
}
```

- [x] **Step 2: Run the CSS gates**

Run: `npx vitest run src/theme/motion.test.ts src/theme/tokens.test.ts`
Expected: PASS (no literal durations; no palette drift).

- [x] **Step 3: Commit**

```bash
git add src/pages/GuidePage.css
git commit -m "style(guide): GuidePage.css — card grammar, 72ch measure, house focus ring, measured scroll margin (spec §3.3)"
```

---

## Task 8 — the page (spec §3.1)

**Files:**
- Replace: `src/pages/GuidePage.tsx`
- Test: `src/pages/GuidePage.test.tsx`

- [x] **Step 1: Write the failing page test**

`src/pages/GuidePage.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GuidePage from './GuidePage'
import { FIXTURE_GUIDE } from '../guide/testing/fixtures'

// The page renders whatever GUIDE holds; the fixture keeps this suite independent of the
// content lanes (the real content is fenced in src/guide/guideContent.test.ts).
vi.mock('../guide/content', () => ({ GUIDE: FIXTURE_GUIDE }))

afterEach(cleanup)

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/guide" element={<GuidePage />} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

function panelFor(tabName: string): HTMLElement {
  const tab = screen.getByRole('tab', { name: tabName })
  return document.getElementById(tab.getAttribute('aria-controls') ?? '') as HTMLElement
}

describe('GuidePage', () => {
  it('renders through the frame with four chapter tabs and opens Start here by default', () => {
    renderAt('/guide')
    expect(screen.getByRole('heading', { level: 1, name: 'Guide' })).toBeTruthy()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Start here', 'Routines', 'Pages', 'Reference'])
    expect(screen.getByRole('tab', { name: 'Start here' }).getAttribute('aria-selected')).toBe('true')
    expect(panelFor('Start here').hasAttribute('hidden')).toBe(false)
    expect(document.getElementById('start-what')).toBeTruthy()
  })

  it('opens the chapter named by ?section= and focuses the card named by the hash', async () => {
    renderAt('/guide?section=pages#page-taxes')
    expect(screen.getByRole('tab', { name: 'Pages' }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => expect(document.activeElement?.id).toBe('page-taxes'))
    expect(document.getElementById('page-taxes')?.getAttribute('tabindex')).toBe('-1')
  })

  it('resolves a bare hash to the owning chapter — a task id, not only a card id', async () => {
    renderAt('/guide#update-close')
    expect(screen.getByRole('tab', { name: 'Routines' }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => expect(document.activeElement?.id).toBe('update-close'))
  })

  it('renders the Pages chip row in card order, and a chip jumps to its card', async () => {
    renderAt('/guide?section=pages')
    const nav = screen.getByRole('navigation', { name: 'Pages in this guide' })
    const chips = Array.from(nav.querySelectorAll('a.chip'))
    expect(chips.map((a) => a.textContent)).toEqual(['Example', 'Taxes fixture'])
    expect(chips[1].getAttribute('href')).toBe('/guide?section=pages#page-taxes')
    fireEvent.click(chips[1])
    await waitFor(() => expect(document.activeElement?.id).toBe('page-taxes'))
  })

  it('switching tabs shows that chapter and hides the others', () => {
    renderAt('/guide')
    fireEvent.click(screen.getByRole('tab', { name: 'Reference' }))
    expect(screen.getByRole('tab', { name: 'Reference' }).getAttribute('aria-selected')).toBe('true')
    expect(panelFor('Reference').hasAttribute('hidden')).toBe(false)
    expect(panelFor('Start here').hasAttribute('hidden')).toBe(true)
    expect(document.getElementById('ref-glossary')).toBeTruthy()
  })

  it('a chapter with no cards renders its panel without cards and no chip row', () => {
    renderAt('/guide?section=routines')
    expect(screen.queryByRole('navigation', { name: 'Pages in this guide' })).toBeNull()
  })
})
```

- [x] **Step 2: Run it to see it fail**

Run: `npx vitest run src/pages/GuidePage.test.tsx`
Expected: FAIL — no tabs (the placeholder page has no strip).

- [x] **Step 3: Replace the page**

`src/pages/GuidePage.tsx`:

```tsx
import PageFrame from '../components/shell/PageFrame'
import { LocalSectionNav, LocalSectionPanel, useLocalSections } from '../components/shell/LocalSections'
import { chapterOf } from '../guide/anchors'
import { GUIDE } from '../guide/content'
import GuideCard from '../guide/GuideCard'
import GuidePageChips from '../guide/GuidePageChips'
import type { GuideChapterId } from '../guide/types'
import '../components/panels.css'
import './GuidePage.css'

// Through PageFrame like every other page (2026-09-03 shell spec §5), permanently ready: the
// guide has nothing to load. Chapters are the house tab strip (?section=), and a bare #id —
// a card or a task — resolves to its chapter through the anchor index, so a palette hit or a
// pointer task can address any anchor without naming the chapter (2026-09-14 guide spec §3.1).
const CHAPTERS = GUIDE.map((chapter) => ({ id: chapter.id, label: chapter.label }))

export default function GuidePage() {
  const views = useLocalSections<GuideChapterId>(CHAPTERS, 'start', {
    resolveLegacy: ({ hash }) => {
      const target = hash.slice(1)
      if (!target) return null
      const chapter = chapterOf(target)
      return chapter ? { section: chapter, targetId: target } : null
    },
  })
  return (
    <div className="page guide-page">
      <PageFrame
        title="Guide"
        sections={<LocalSectionNav state={views} label="Guide chapters" />}
        resource={{ status: 'ready' }}
      >
        {GUIDE.map((chapter) => (
          <LocalSectionPanel key={chapter.id} state={views} section={chapter.id} className="card-grid">
            {chapter.id === 'pages' && chapter.cards.length > 0 && <GuidePageChips chapter={chapter} />}
            {chapter.cards.map((card) => (
              <GuideCard key={card.id} card={card} />
            ))}
          </LocalSectionPanel>
        ))}
      </PageFrame>
    </div>
  )
}
```

If `useLocalSections`'s generic cannot infer from `CHAPTERS` (a `{ id: GuideChapterId; label: string }[]`),
type the constant explicitly: `const CHAPTERS: readonly { id: GuideChapterId; label: string }[] = …`.

- [x] **Step 4: Run the page test; then the neighbours that render tabbed pages**

Run: `npx vitest run src/pages/GuidePage.test.tsx src/pages/NotFoundPage.test.tsx src/components/shell/LocalSections.test.tsx`
Expected: PASS. If the two focus assertions time out under jsdom, the arrival effect runs
inside `requestAnimationFrame`; wrap the render in `act` and keep `waitFor` (default 1 s) —
the `SettingsPage.test.tsx` anchor tests use the same hook, so a real failure is in this
page, not the hook.

- [x] **Step 5: Lint, type-check, the mounts audit**

Run: `npx eslint src/pages/GuidePage.tsx src/guide && npx tsc -b && npx vitest run src/charts/mounts.audit.test.ts`
Expected: clean; PASS.

- [x] **Step 6: Commit**

```bash
git add src/pages/GuidePage.tsx src/pages/GuidePage.test.tsx
git commit -m "feat(guide): /guide page — four tabbed chapters, hash-to-chapter resolution, page chip row (spec §3.1)"
```

---

## Task 9 — palette entry builder (spec §6, the builder half)

**Files:**
- Create: `src/guide/palette.ts`
- Test: `src/guide/palette.test.ts`

- [x] **Step 1: Write the failing test**

`src/guide/palette.test.ts`:

```ts
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
              { id: 'x-pointer', title: 'X is elsewhere', where: 'W', steps: ['S.'], to: '/settings?section=household#accounts' },
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
```

- [x] **Step 2: Run it to see it fail**

Run: `npx vitest run src/guide/palette.test.ts`
Expected: FAIL — cannot resolve `./palette`.

- [x] **Step 3: Implement**

`src/guide/palette.ts`:

```ts
import { GUIDE } from './content'
import type { GuideChapter } from './types'

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
  const entries: GuidePaletteEntry[] = []
  for (const chapter of guide) {
    for (const card of chapter.cards) {
      for (const task of [...card.tasks, ...(card.more ?? [])]) {
        if (task.id.endsWith('-pointer')) continue
        entries.push({
          id: `guide:${task.id}`,
          label: task.title,
          sub: `Guide · ${card.title}`,
          keywords: [...(task.keywords ?? []), ...(card.keywords ?? []), 'how to', 'guide'],
          to: `/guide?section=${chapter.id}#${task.id}`,
        })
      }
    }
  }
  return entries
}
```

- [x] **Step 4: Run the test**

Run: `npx vitest run src/guide/palette.test.ts`
Expected: PASS (2 tests).

- [x] **Step 5: Commit**

```bash
git add src/guide/palette.ts src/guide/palette.test.ts
git commit -m "feat(guide): guideEntries — one palette destination per guide task (spec §6 builder; G5 wires it)"
```

---

## Task 10 — the fences (spec §8.1–8.3, §5.4)

**Files:**
- Test: `src/guide/guideContent.test.ts`

These tests read the real `GUIDE` and the real page sources. They must be green at this commit
(one exemplar card, thirteen pending routes) and stay green as content lands.

- [x] **Step 1: Write the fences**

`src/guide/guideContent.test.ts`:

```ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { NAV_ITEMS } from '../components/navItems'
import { SETTINGS_SECTIONS } from '../components/paletteRegistry'
import { allIds, chapterOf } from './anchors'
import { GUIDE } from './content'
import { PENDING_PAGES } from './content/pending'
import type { GuideCard, GuideTask } from './types'

// The guide rots the moment a route, view, anchor or button label changes and nobody edits
// src/guide/content. These fences make that a failing test instead of a stranded reader
// (2026-09-14 guide spec §8). They read page sources as text — the paletteRegistry.test.ts
// technique — because view ids and card anchors are literals, not exports.

const SRC = path.resolve(__dirname, '..')
const ROUTES = new Set(NAV_ITEMS.map((item) => item.to))
const NAV_LABELS = new Set(NAV_ITEMS.map((item) => item.label))
const QUERY_ALLOW = new Set(['section', 'month', 'owner', 'range', 'step', 'view', 'add', 'date', 'tab', 'ticker', 'drill', 'trend', 'card', 'year', 'comp', 'lot', 'grant', 'profile', 'whatif'])

/** route → page component file, read off routeChunks.ts so the two cannot drift. */
function pageFiles(): Map<string, string> {
  const text = readFileSync(path.join(SRC, 'components/routeChunks.ts'), 'utf8')
  const map = new Map<string, string>()
  for (const match of text.matchAll(/'([^']+)': \(\) => import\('\.\.\/pages\/(\w+)'\)/g)) {
    map.set(match[1], path.join(SRC, 'pages', `${match[2]}.tsx`))
  }
  return map
}
const PAGE_FILES = pageFiles()

/** A page's tab strip as { id, label }[]: the constant its useLocalSections() call names
 *  (PAGE_SECTIONS on eight pages, SECTIONS on Spending and Projection), read as a literal in
 *  either quoting style. [] when the page has no strip (Overview, Monthly update, Calendar). */
function pageSections(route: string): { id: string; label: string }[] {
  const file = PAGE_FILES.get(route)
  if (!file || !existsSync(file)) return []
  const text = readFileSync(file, 'utf8')
  const name = text.match(/useLocalSections(?:<[^>]+>)?\(\s*([A-Za-z_]+)\s*,/)?.[1]
  if (!name) return []
  const literal = text.match(new RegExp(`const ${name}(?::[^=]+)? = (\\[[\\s\\S]*?\\]) as const`))?.[1]
  if (!literal) return []
  return Array.from(literal.matchAll(/["']?id["']?:\s*["']([a-z-]+)["'],\s*["']?label["']?:\s*["']([^"']+)["']/g)).map((m) => ({ id: m[1], label: m[2] }))
}

const AREA_DIRS: Record<string, string> = {
  '/': 'overview', '/update': 'monthly', '/net-worth': 'networth', '/portfolio': 'portfolio', '/spending': 'spending',
  '/credit-cards': 'creditcards', '/paycheck': 'paycheck', '/comp': 'comp', '/espp': 'espp', '/taxes': 'taxes',
  '/projection': 'projection', '/calendar': 'calendar', '/settings': 'settings',
}

/** Non-test .tsx AND .ts sources: preset chip labels (taxScenario.ts, paycheckScenario.ts),
 *  assistant starters (samples.ts) and palette labels (paletteRegistry.ts) are UI text too. */
function tsxUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...tsxUnder(full))
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

/** Sources that may carry `id="<anchor>"` for a page: the page file plus its component area. */
function anchorSources(route: string): string {
  const files = [PAGE_FILES.get(route), ...tsxUnder(path.join(SRC, 'components', AREA_DIRS[route] ?? '__none__'))].filter((f): f is string => !!f && existsSync(f))
  return files.map((f) => readFileSync(f, 'utf8')).join('\n')
}

/** Every non-test .tsx under src/ except the guide itself — the label fence's haystack. */
const UI_TEXT = tsxUnder(SRC)
  .filter((f) => !f.includes(`${path.sep}guide${path.sep}`))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')
const VIEW_LABELS = new Set(Array.from(PAGE_FILES.keys()).flatMap((route) => pageSections(route).map((s) => s.label)))

const allCards: { card: GuideCard; chapter: string }[] = GUIDE.flatMap((chapter) => chapter.cards.map((card) => ({ card, chapter: chapter.id })))
const allTasks: { task: GuideTask; card: GuideCard }[] = allCards.flatMap(({ card }) => [...card.tasks, ...(card.more ?? [])].map((task) => ({ task, card })))
const allLinks: { to: string; owner: string }[] = [
  ...allCards.filter(({ card }) => card.to).map(({ card }) => ({ to: card.to!, owner: card.id })),
  ...allTasks.filter(({ task }) => task.to).map(({ task }) => ({ to: task.to!, owner: task.id })),
]
const guideIds = new Set(allIds())

function parse(to: string): { pathname: string; params: URLSearchParams; hash: string } {
  const url = new URL(to, 'http://x')
  return { pathname: url.pathname, params: url.searchParams, hash: url.hash.slice(1) }
}

describe('guide content — link fence (spec §8.1)', () => {
  it('every link is a sidebar route or the guide itself', () => {
    const bad = allLinks.filter(({ to }) => !ROUTES.has(parse(to).pathname))
    expect(bad).toEqual([])
  })

  it('every ?section= names a view the target page really has', () => {
    const bad = allLinks.filter(({ to }) => {
      const { pathname, params } = parse(to)
      const section = params.get('section')
      if (!section) return false
      const ids = pathname === '/guide' ? GUIDE.map((c) => c.id) : pageSections(pathname).map((s) => s.id)
      return !ids.includes(section)
    })
    expect(bad).toEqual([])
  })

  it('every #hash exists: a guide id, a Settings card id, or an id="…" in the target page or its components', () => {
    const settingsIds = new Set([...SETTINGS_SECTIONS.map((s) => s.id), 'sec-household', 'sec-planning', 'sec-account', 'sec-integrations', 'sec-data'])
    const bad = allLinks.filter(({ to }) => {
      const { pathname, hash } = parse(to)
      if (!hash) return false
      if (pathname === '/guide') return !guideIds.has(hash)
      if (pathname === '/settings') return !settingsIds.has(hash)
      return !anchorSources(pathname).includes(`id="${hash}"`)
    })
    expect(bad).toEqual([])
  })

  it('uses only the arrival parameters the app consumes', () => {
    const bad = allLinks.filter(({ to }) => Array.from(parse(to).params.keys()).some((key) => !QUERY_ALLOW.has(key)))
    expect(bad).toEqual([])
  })

  it('a pointer task has exactly one step and a real destination outside the guide', () => {
    // Content lanes run in parallel and merge one at a time, so a pointer that named another
    // chapter's anchor would fail this fence on whichever lane merged first (spec §5.1).
    const pointers = allTasks.filter(({ task }) => task.id.endsWith('-pointer'))
    const bad = pointers.filter(({ task }) => task.steps.length !== 1 || !task.to || task.to.startsWith('/guide'))
    expect(bad.map(({ task }) => task.id)).toEqual([])
  })
})

describe('guide content — label fence (spec §8.2)', () => {
  // Placeholders (<Month>, <person>), figures ($X, 15 %) and generic locations ("Any chart",
  // "Every headline tile") are prose, not labels — the reviewer judges those.
  const exempt = (label: string) => /[<>]/.test(label) || /^[\d$]/.test(label) || /^(Any|Every|The) /.test(label)

  it('every **Label** in a step is text that exists somewhere in the UI', () => {
    const missing: string[] = []
    for (const { task } of allTasks) {
      for (const step of task.steps) {
        for (const match of step.matchAll(/\*\*(.+?)\*\*/g)) {
          const label = match[1]
          if (!exempt(label) && !UI_TEXT.includes(label)) missing.push(`${task.id}: ${label}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('every segment of a Where path is a page, a view, or text that exists in the UI', () => {
    const missing: string[] = []
    for (const { task } of allTasks) {
      // ' → ' walks into a place; ' · ' lists alternatives ('Overview · Spending · Net worth').
      for (const segment of task.where.split(/ → | · /).map((s) => s.trim())) {
        if (!segment || exempt(segment)) continue
        if (NAV_LABELS.has(segment) || VIEW_LABELS.has(segment) || UI_TEXT.includes(segment)) continue
        missing.push(`${task.id}: ${segment}`)
      }
    }
    expect(missing).toEqual([])
  })
})

describe('guide content — completeness, shape and uniqueness (spec §8.3)', () => {
  it('every sidebar page has a card somewhere in the guide, unless the lane that owns it is still pending', () => {
    const covered = new Set(allCards.map(({ card }) => card.to).filter(Boolean))
    const missing = NAV_ITEMS.map((item) => item.to).filter((route) => route !== '/guide' && !covered.has(route) && !PENDING_PAGES.includes(route))
    expect(missing).toEqual([])
  })

  it('a pending route has no card yet — the escape hatch is not a second way to list a page', () => {
    const covered = new Set(allCards.map(({ card }) => card.to).filter(Boolean))
    expect(PENDING_PAGES.filter((route) => covered.has(route))).toEqual([])
  })

  it('card and task ids are unique, kebab-case, and every id resolves to its chapter', () => {
    const ids = [...allCards.map(({ card }) => card.id), ...allTasks.map(({ task }) => task.id)]
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
    expect(dupes).toEqual([])
    expect(ids.filter((id) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id))).toEqual([])
    expect(ids.filter((id) => chapterOf(id) === undefined)).toEqual([])
  })

  it('every task has a title, a where and at least one step of at most 160 characters', () => {
    const bad = allTasks.filter(({ task }) => !task.title || !task.where || task.steps.length === 0 || task.steps.some((s) => s.length > 160))
    expect(bad.map(({ task }) => task.id)).toEqual([])
  })

  it('page cards show 3–8 tasks, carry at most 5 card-level traps, and name the page\u2019s views exactly', () => {
    const bad: string[] = []
    for (const { card } of allCards) {
      if (!card.to || card.to.startsWith('/guide') || !ROUTES.has(card.to)) continue
      if (card.tasks.length < 3 || card.tasks.length > 8) bad.push(`${card.id}: ${card.tasks.length} visible tasks`)
      if ((card.watch?.length ?? 0) > 5) bad.push(`${card.id}: ${card.watch!.length} watch lines`)
      const expected = pageSections(card.to).map((s) => s.label)
      if (expected.length > 0 && JSON.stringify(card.views ?? []) !== JSON.stringify(expected)) bad.push(`${card.id}: views ${JSON.stringify(card.views)} ≠ ${JSON.stringify(expected)}`)
      if (expected.length === 0 && card.views) bad.push(`${card.id}: views given for a page without a tab strip`)
    }
    expect(bad).toEqual([])
  })

  it('the Pages chapter is in sidebar order', () => {
    const pages = GUIDE.find((c) => c.id === 'pages')!.cards.map((card) => card.to).filter((to): to is string => !!to)
    const order = NAV_ITEMS.map((item) => item.to)
    const sorted = [...pages].sort((a, b) => order.indexOf(a) - order.indexOf(b))
    expect(pages).toEqual(sorted)
  })
})

// The user's coverage list (spec §5.4). Skipped until every content lane has landed — lane V
// deletes PENDING_PAGES and this guard becomes a plain `it`.
describe('guide content — required coverage (spec §5.4)', () => {
  const REQUIRED = [
    'accounts-add', 'accounts-owner', 'cards-owner', 'paycheck-person', 'update-balances', 'update-spending', 'update-close',
    'portfolio-transaction', 'portfolio-security', 'portfolio-classify', 'cards-add', 'cards-multipliers', 'cards-credit-add',
    'paycheck-profile-add', 'paycheck-try-it', 'comp-grant-add', 'comp-focal-add', 'espp-offering-add', 'espp-lot-add',
    'espp-lot-sold', 'taxes-year-create', 'taxes-tables', 'taxes-inputs', 'taxes-will-i-owe', 'taxes-whatif-sale',
    'projection-assumptions', 'projection-retire-month', 'calendar-add-event', 'calendar-subscribe', 'assistant-ask', 'assistant-key',
  ]
  it.skipIf(PENDING_PAGES.length > 0)('every task the owner asked for exists', () => {
    expect(REQUIRED.filter((id) => !guideIds.has(id))).toEqual([])
  })
})
```

- [x] **Step 2: Run the fences against the seeded content**

Run: `npx vitest run src/guide/guideContent.test.ts`
Expected: PASS — the exemplar links (`/settings?section=household`, `/update`, `/taxes`,
`/settings?section=planning`) resolve; thirteen routes are pending; the coverage test is
skipped. If `pageSections('/settings')` returns `[]`, the regex did not match the page's
literal — check the exact spelling in `SettingsPage.tsx:34` (`{"id":"household","label":"Household"}`)
and adjust the `"id":\s*"…",\s*"label":\s*"…"` pattern until it captures five sections; do
not loosen it into matching anything else in the file.

- [x] **Step 3: Prove the fences bite (temporary, not committed)**

Temporarily change the exemplar's `/settings?section=planning` to `/settings?section=plannin`
and run the fences → the `?section=` test FAILS naming `start-what`. Revert. Temporarily add a
task with `steps: ['Press **Frobnicate**.']` → the label fence FAILS naming it. Revert.
`git diff --stat` must be empty before Step 4.

- [x] **Step 4: Commit**

```bash
git add src/guide/guideContent.test.ts
git commit -m "test(guide): fences — links resolve to real routes/views/anchors, bold labels exist in the UI, completeness with a pending escape hatch, shape and uniqueness (spec §8)"
```

---

## Task 11 — gates and hand-off

- [x] **Step 1: Full frontend gates**

Run: `npx tsc -b && npx eslint . && npx vitest run && npm run build`
Expected: tsc silent; eslint clean (the pre-existing `useAuth` react-refresh warning is
sanctioned); vitest all green (the suite count grows by the new files); build succeeds with a
new `GuidePage-*.js` chunk in `dist/assets/`.

- [x] **Step 2: Backend gates**

Run (from `backend/`): `./.venv/Scripts/ruff.exe check . && ./.venv/Scripts/ruff.exe format --check . && ./.venv/Scripts/python.exe -m pytest tests/test_prefs_registry.py -q`
Expected: clean; PASS.

- [x] **Step 3: Record results in this plan**

Append a `## Results (implementer, <date>)` section: commits (hash + subject), gate outputs
(test counts), deviations (none silent), and the hand-offs below.

### Hand-offs (not done in this lane — files other lanes own)

- **G1–G4:** fill `src/guide/content/*.tsx`; delete your routes from `PENDING_PAGES`; keep the
  fences green; do not edit `src/guide/*.tsx` renderers — report a needed renderer change here.
- **G5:** wire `guideEntries()` into `paletteRegistry.buildEntries` with `kind: 'guide'` and a
  `'Guide'` group last in `GROUP_ORDER` (spec §6); Overview *Start here* card and wizard
  zero-accounts note (spec §7); `tools/probes/motion-v/smoke.mjs` nav list (spec §10); the two
  copy rewrites (spec §11).
- **V:** delete `src/guide/content/pending.ts` and its import in `guideContent.test.ts`; turn
  `it.skipIf(...)` into `it(...)`.

## Self-review (done while writing; the implementer re-runs the gates, not this)

- Spec §2.1–2.4 → Tasks 1–2. §3.1 → Tasks 6, 8. §3.2 → Tasks 4, 5. §3.3 → Task 7. §3.4 →
  inherited (cards, Disclosure, LocalSections gating). §4 → Task 3. §6 (builder) → Task 9. §8.1–8.3
  and §5.4 → Task 10. §8.4 → Tasks 5, 8, 4.
- No placeholders: every file has its full content; the one `if …` in Task 8 Step 3 is a typed
  fallback with the exact code to write.
- Types: `GuideTask`/`GuideCard`/`GuideChapter` used identically in fixtures, components, page,
  palette and fences; `chapterOf`/`allIds`/`buildAnchorIndex` named the same everywhere;
  `PENDING_PAGES` spelled identically in `pending.ts` and the fences; the palette entry shape in
  Task 9 matches spec §6 (`id`, `label`, `sub`, `keywords`, `to`; G5 adds `kind`).

---

## Results (implementer, 2026-09-14)

Lane G0 is complete on `guide/g0-shell` (worktree `.worktrees/guide-g0`), ten commits on top of
`6a0e835`, nothing pushed. TDD per task: every test below was seen red for the stated reason
before the code that turns it green was written.

### Commits

| Hash | Subject |
| --- | --- |
| `e31217b` | feat(guide): Guide destination in the sidebar's utility tail, /guide route and chunk, NAV_PATHS twin (spec §2.1–2.2) |
| `71be2a6` | test(shell): nav order and route mock carry Guide before Settings; skip-link comment counts 14 links |
| `2a0dc76` | feat(guide): content model, per-lane content seeds with the Start-here exemplar, GUIDE assembler, anchor index (spec §4) |
| `65982cc` | feat(guide): renderSteps — **Label** becomes a bold on-screen label, nothing else is markup (spec §3.2) |
| `c445b1a` | feat(guide): GuideCard and GuideTaskList — Purpose · Do this · Watch out · More, anchored tasks, Go and Open links (spec §3.2) |
| `cc9b915` | feat(guide): GuidePageChips — one jump chip per page card (spec §3.1) |
| `4c21d8f` | style(guide): GuidePage.css — card grammar, 72ch measure, house focus ring, measured scroll margin (spec §3.3) |
| `1ca8e8d` | feat(guide): /guide page — four tabbed chapters, hash-to-chapter resolution, page chip row (spec §3.1) |
| `28edfde` | feat(guide): guideEntries — one palette destination per guide task (spec §6 builder; G5 wires it) |
| `582dd79` | test(guide): fences — links resolve to real routes/views/anchors, bold labels exist in the UI, completeness with a pending escape hatch, shape and uniqueness (spec §8) |

### Gates (Task 11)

- `npx tsc -b` — silent.
- `npx eslint .` — **0 errors**, 25 warnings, all pre-existing `react-refresh/only-export-components`
  in sixteen files this lane never touched (`AuthContext`, `ThemeProvider`, `PageFrame`,
  `LocalSections`, …). No warning in `src/guide/**` or `src/pages/GuidePage.tsx`.
- `npx vitest run` — **231 files, 3093 passed, 1 skipped** (the skip is this lane's own §5.4
  coverage guard, `it.skipIf(PENDING_PAGES.length > 0)`). New tests: 1 anchors · 3 renderSteps ·
  4 GuideCard · 6 GuidePage · 2 palette · 14 fences (13 + the skip).
- `npm run build` — built in 12.6 s; new chunks `dist/assets/GuidePage-JM6JtX0Q.js` and
  `GuidePage-C6q_Tohl.css`. No chunk-size warning.
- Backend: `ruff check .` → All checks passed; `ruff format --check .` → 318 files already
  formatted; `python -m pytest tests/test_prefs_registry.py -q` → **11 passed**.
- Scoped runs at the tasks: `routeChunks.test.ts` 7 ✓ · `Layout`/`App`/`usePageTitle`/
  `paletteRegistry` 41 ✓ · `motion`/`tokens` 20 ✓ · `GuidePage`/`NotFoundPage`/`LocalSections`
  17 ✓ · `mounts.audit` 15 ✓.

### Deviations from the plan (all deliberate, none silent)

1. **The plan was not in the worktree.** The branch was cut at `c9c03b7`, before the plans were
   committed. The lead landed them on main as `6a0e835`; the worktree was fast-forwarded to it
   (`git merge --ff-only main`) before Task 1. No code effect — only this file and its siblings
   arrived.
2. **Task 1 Step 1 — test count.** `src/components/routeChunks.test.ts` holds **7** tests, not 2
   (the lockstep pair plus five prefetch/warm tests). Red and green were exactly as described:
   `missing chunk for /guide: expected undefined to be defined`.
3. **Task 5 Step 4 — no non-null assertion in `GuideCard`.** Written as `const watch = card.watch ?? []`
   with `watch.length > 0` instead of `hasWatch` + `card.watch!` (the plan's own parenthetical
   alternative). `@typescript-eslint/no-non-null-assertion` is *not* enabled here (the config
   extends `recommended`, not `strict`), so this is style, not necessity: the nullish default
   needs no assertion at all and `more` is already written that way.
4. **Task 8 Step 1 — the mock factory had to import the fixture itself.** The plan's
   `vi.mock('../guide/content', () => ({ GUIDE: FIXTURE_GUIDE }))` cannot work: `vi.mock` is
   hoisted above the imports, and `GuidePage → anchors.ts → ./content` evaluates the mocked module
   during the page's own module init, so the factory threw
   `ReferenceError: Cannot access '__vi_import_4__' before initialization`. Replaced with the
   repo's existing pattern (`src/App.test.tsx` mocks `routeChunks` this way): an `async` factory
   that `await import('../guide/testing/fixtures')` itself, with the top-level fixture import
   dropped (`noUnusedLocals`). The six assertions are unchanged and all pass.
5. **Task 8 Step 3 — the typed `CHAPTERS` fallback was taken**, and the panel's class is
   `card-grid`. `const CHAPTERS: readonly { id: GuideChapterId; label: string }[] = GUIDE.map(...)`
   documents the shape the hook needs. Spec §3.1's snippet writes `className="span-12 card-grid"`;
   `.page-frame-body` is not a grid, so `span-12` would be inert here — `CreditCardsPage` needs it
   only because it nests its panels inside an outer `.card-grid`. The plan's `card-grid` is what
   shipped.
6. **Task 10 Step 3 — the plan's bite-proof recipe does not bite, a different one was used.**
   The exemplar's `/settings?section=planning` lives in the card's `body` JSX, and `body` is
   explicitly *not* fenced (§4's own doc comment); the fences walk `card.to` and `task.to` only,
   so mangling that link changes nothing. Proved the fences bite by temporarily giving the
   exemplar `to: '/settings?section=plannin'` and a task
   `{ id: 'bite-task', where: 'Nowhere land', steps: ['Press **Frobnicate**.'] }` — three fences
   failed, naming `start-what`, `bite-task: Frobnicate` and `bite-task: Nowhere land`. A positive
   control (`?section=planning`, `**Add card**`, `Where: Settings → Planning`) then turned all
   three green, which is also the proof the plan asked for that `pageSections('/settings')` really
   reads the five sections out of `SettingsPage.tsx` (an empty read would have failed `planning`
   too). Reverted with `git checkout --`; `git diff --stat` was empty before the commit.
7. **Backend venv lives in the main checkout only.** `backend/.venv` is untracked, so the worktree
   has none. The backend gates ran with the main checkout's `python.exe`/`ruff.exe` from the
   *worktree's* `backend/` as cwd — `test_prefs_registry.py` resolves `navItems.ts` through
   `Path(__file__).resolve().parents[2]`, i.e. the worktree's copy, which is what made it go red
   (`Extra items in the left set: '/guide'`) before the `NAV_PATHS` edit and green after.
8. **"eslint clean" is 0 errors, not 0 warnings.** The plan sanctions "the pre-existing `useAuth`
   react-refresh warning"; the real baseline is 25 such warnings across sixteen files. None are
   new.

### Findings for the lanes that follow

- **A page card's `to` must be the bare route** (`/credit-cards`, `/settings`), never a route with
  a query. The completeness fence compares `card.to` to `NAV_ITEMS` routes as exact strings, so
  `to: '/settings?section=planning'` satisfies nothing and trips nothing — the page would read as
  still missing. Deep links with `?section=`/`#` belong on **tasks**.
- The `views` fence is exact (`JSON.stringify` equality against the page's `PAGE_SECTIONS`
  labels, in strip order), and it reads the literal out of the page source: a page whose strip
  constant is not a `[...] as const` literal named in its `useLocalSections(...)` call returns
  `[]`, which the fence reads as "no tab strip" and then forbids `views` on that card.
- `GuidePage.test.tsx` mocks `../guide/content`, so it never sees real content: content lanes do
  not need to touch it, and a broken card shows up in `guideContent.test.ts`, not there.

### Hand-offs (not done in this lane — files other lanes own)

- **G1–G4:** fill `src/guide/content/*.tsx`; delete your routes from `PENDING_PAGES`; keep the
  fences green; do not edit `src/guide/*.tsx` renderers — report a needed renderer change here.
  The exemplar `start-what` card is G1's to keep or rewrite.
- **G5:** wire `guideEntries()` into `paletteRegistry.buildEntries` with `kind: 'guide'` and a
  `'Guide'` group last in `GROUP_ORDER` (spec §6); Overview *Start here* card and wizard
  zero-accounts note (spec §7); `tools/probes/motion-v/smoke.mjs` nav list (spec §10); the two
  copy rewrites (spec §11).
- **V:** delete `src/guide/content/pending.ts` and its import in `guideContent.test.ts`; turn
  `it.skipIf(...)` into `it(...)`. Nothing else in this lane is temporary.

### Review round (2026-09-14, one commit)

Stage 1 compliant / Stage 2 approved, with four items fixed in place:

1. *(Important)* `GuideTask.id`'s doc comment claimed `-pointer` "links into the guide" — the
   opposite of spec §5.1 and of this lane's own fence. Reworded in `src/guide/types.ts`, in the
   Contracts block above and in the plan's embedded types snippet; `palette.test.ts`'s
   `x-pointer` fixture now carries a real destination (`/settings?section=household#accounts`)
   and is still expected to be skipped by the builder. (Spec §8.3's last clause carries the same
   stale sentence — the spec is not this lane's file; flagged for V.)
2. `.guide-page a:focus-visible` beat `.chip:focus-visible` on specificity and flattened the
   chip's 999px pill to 4px; the selector is now `…a:focus-visible:not(.chip)`.
3. The label fence's `^(Any|Every|The) ` exemption applied to `**Label**` steps as well as `where`
   segments, so "Every headline tile" would have passed as a control name. Split into
   `placeholder` (steps: only `<>`, a leading digit or `$`) and `exemptSegment` (where: plus the
   generic locations).
4. "a chapter with no cards renders no chip row" passed only because the Pages panel was hidden.
   It now mounts a second module registry (`vi.resetModules` + `vi.doMock`, unwound in a
   `finally`) holding a GUIDE whose Pages chapter is empty, selects the Pages tab and asserts the
   `<nav>` is absent — verified to bite: deleting `chapter.cards.length > 0` from `GuidePage.tsx`
   fails that test and only that test.

Gates after the round: `npx vitest run src/guide src/pages/GuidePage.test.tsx` → **29 passed,
1 skipped** (6 files); `npx tsc -b` silent; `npx eslint src/guide src/pages/GuidePage.tsx` clean;
`motion`/`tokens` 20 ✓.
