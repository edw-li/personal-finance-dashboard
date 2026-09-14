# Lane L1 — Guide master–detail cards, card selector, motion (2026-09-15 guide polish) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> Opus implementer for this lane in its own worktree, TDD per task, then a spec-compliance review
> and a code-quality review, then a local merge to main — never pushed). Steps use `- [ ]`
> checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-15-guide-polish-master-detail-design.md` — this lane
implements **§2 (master–detail card), §3 (card selector), §4 (anchors), §6 (motion), §7 (tests
for the components and the page)**. Read §0–§4 and §6–§7 before Task 1. The predecessor spec
`2026-09-14-onboarding-guide-design.md` §3–§4 describes the page this lane changes.

**Goal:** every card with tasks becomes rail-left / detail-right (rail scrollable, folded tasks
expand in place, deep links select), the Pages and Reference chapters show one card at a time
behind a sticky chip selector carried by the URL hash, and each interaction animates on the house
tokens — with tests for all of it.

**Architecture:** `GuideCard` keeps its head, purpose, views and body, and replaces the task list
with a two-column `.guide-md` grid: `TaskRail` (a vertical `tablist` of `role="tab"` rows that keep
the task ids as anchors, one measured accent indicator, an in-place fold for `more`) and
`TaskDetail` (a `tabpanel` that crossfades on task change). `useTaskSelection` derives the
selected task from the URL hash on arrival and on hash change, otherwise the first visible task.
`CardSelector` is a `tablist` of chips whose selection IS the hash; `GuidePage` renders only the
selected card for chapters flagged `selector`. `anchors.ts` gains `cardOf`. No backend.

**Tech stack:** React 19 + TypeScript 5.9 (`strict`, `noUnusedLocals`, `import type`),
react-router-dom 7 (`useLocation`, `useNavigate`), vitest 3 + Testing Library (jsdom; no jest-dom
matchers; `Element.prototype.animate` is absent in jsdom — always guard `typeof el.animate === 'function'`),
eslint 9 with React-Compiler rules as errors (derived state via the conditional-setState-in-render
idiom `LocalSections.tsx:40` uses; never setState in an effect body), lucide-react.

---

## Mechanics (read once)

- Worktree: `C:/Users/edyli/personal-finance-dashboard/.worktrees/guide-l1`, branch `guide/l1-md`,
  cut from `main` at or after `954aac3` (the spec + `types.ts` fields commit). Created by the lead
  with `node_modules` installed; work ONLY inside it, Git Bash, absolute paths.
- Commands from the worktree root: `npx vitest run <paths>`, `npx tsc -b`, `npx eslint src/guide src/pages/GuidePage.tsx`,
  `npm run build`.
- Files this lane may edit (spec §8): `src/guide/GuideCard.tsx` (+test), new `src/guide/TaskRail.tsx`,
  `src/guide/TaskDetail.tsx`, `src/guide/useTaskSelection.ts`, `src/guide/CardSelector.tsx` (+test),
  `src/guide/anchors.ts` (+test), `src/guide/palette.ts` (+test), `src/guide/content.tsx`
  (`selector: true`), `src/guide/testing/fixtures.ts`, `src/pages/GuidePage.tsx` (+test),
  `src/pages/GuidePage.css`; delete `src/guide/GuideTaskList.tsx` and `src/guide/GuidePageChips.tsx`
  (`git rm`). Nothing in `src/guide/content/*.tsx` (lane L2 owns those) and nothing under
  `src/components/`.
- Commit after every task. Never push.

## House rules this plan encodes

1. **Durations are tokens only** — `var(--t-fast)`, `--t-xfade`, `--t-page`, `--t-enter`,
   `--t-stagger`, `--t-nav`; `motion.test.ts` scans every `.css` under `src/` and fails on a
   literal. JS timing reads `MOTION_MS`/`EASE_OUT`/`STAGGER_CAP` from `src/theme/motion.ts`.
2. **Reduced motion**: CSS animations use tokens the `reduce` block zeroes; motion-only rules sit
   under `@media (prefers-reduced-motion: no-preference)`; every WAAPI call gates on
   `prefersReducedMotion()` and on `typeof el.animate === 'function'`.
3. **Colours via tokens** (`--text`, `--muted`, `--accent`, `--border`, `--fill`, `--surface-2`, `--bg`).
4. **The page owns the heading outline**: `h2.eyebrow` card, `h3.guide-h3` "Do this"/"Watch out",
   `h4` task title (in the detail). Rows in the rail are buttons, not headings.
5. **Anchors are contracts**: a task's `id` stays on an element in the DOM (the rail row) and a
   card's `id` on its `<section>`; `LocalSections`' arrival effect focuses whatever element wears
   the hash id.
6. **Existing tests are updated, never deleted** — except tests of deleted components.

## Contracts this lane publishes (L2 and V build against these)

```ts
// src/guide/anchors.ts
export interface AnchorIndex { chapter: Map<string, GuideChapterId>; card: Map<string, string> }
export function buildAnchorIndex(guide: readonly GuideChapter[]): AnchorIndex
export function chapterOf(id: string): GuideChapterId | undefined   // unchanged
export function cardOf(id: string): string | undefined              // card id for a card id or a task id
export function allIds(): string[]                                  // unchanged

// CSS classes L2's content uses (declared in GuidePage.css by Task 6)
.guide-facts            // grid of .guide-fact tiles, two columns ≥ 1000px, one below
.guide-fact             // tile: h4 + p
.guide-glossary-grid    // on the <dl>: term | definition rows

// DOM contracts the probe (lane V) relies on
.guide-selector [role=tab][aria-selected=true]       // the selected chip; its aria-controls is the card id
.guide-card                                          // exactly one in a selector chapter's panel
.guide-rail [role=tab]#<taskId>                      // rows keep task ids; the selected one has aria-selected=true
.guide-detail .guide-task-title                      // the selected task's title
```

## File map

| File | Responsibility |
| --- | --- |
| `src/guide/anchors.ts` | chapter AND card index |
| `src/guide/useTaskSelection.ts` | selected task + fold state from the hash |
| `src/guide/TaskRail.tsx` | vertical tablist, numbers, fold, indicator, keyboard |
| `src/guide/TaskDetail.tsx` | tabpanel with crossfade |
| `src/guide/GuideCard.tsx` | head · purpose · views · body · `.guide-md` (rail | detail + watch) |
| `src/guide/CardSelector.tsx` | sticky chip tablist; selection = hash |
| `src/guide/palette.ts` | skip numbered (checklist) cards |
| `src/guide/content.tsx` | `selector: true` on pages and reference |
| `src/pages/GuidePage.tsx` | selector chapters render one card |
| `src/pages/GuidePage.css` | layout, rail, detail, selector, facts, glossary grid, motion |
| `src/guide/testing/fixtures.ts` | `selector` chapters, a `numbered` card |

---

## Task 1 — `cardOf` in the anchor index (spec §2.4, §4)

**Files:** Modify `src/guide/anchors.ts`, `src/guide/anchors.test.ts`.

- [ ] **Step 1: Extend the test**

Replace `src/guide/anchors.test.ts` with:

```ts
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
```

- [ ] **Step 2: Run to see it fail** — `npx vitest run src/guide/anchors.test.ts` → FAIL (`index.chapter` undefined).

- [ ] **Step 3: Implement**

`src/guide/anchors.ts`:

```ts
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
      if (!chapter.has(c.id)) { chapter.set(c.id, ch.id); card.set(c.id, c.id) }
      for (const task of [...c.tasks, ...(c.more ?? [])]) {
        if (!chapter.has(task.id)) { chapter.set(task.id, ch.id); card.set(task.id, c.id) }
      }
    }
  }
  return { chapter, card }
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
```

- [ ] **Step 4: Run** — `npx vitest run src/guide && npx tsc -b` → PASS (the fences still call `chapterOf`/`allIds`).

- [ ] **Step 5: Commit** — `git add src/guide/anchors.ts src/guide/anchors.test.ts && git commit -m "feat(guide): anchor index maps every id to its card as well as its chapter (polish spec §2.4)"`

---

## Task 2 — fixtures, palette skip for numbered cards (spec §2.2, §3)

**Files:** Modify `src/guide/testing/fixtures.ts`, `src/guide/palette.ts`, `src/guide/palette.test.ts`.

- [ ] **Step 1: Fixture** — in `src/guide/testing/fixtures.ts`: set `selector: true` on the `pages`
and `reference` chapters; add `numbered: true` to the `routine-monthly` fixture card and give it a
second task so numbering is visible:

```ts
      {
        id: 'routine-monthly',
        title: 'The monthly fixture',
        purpose: 'Once a month.',
        to: '/update',
        numbered: true,
        tasks: [
          { id: 'update-close', title: 'Close the fixture', where: 'Review', steps: ['Press **Save and close month**.'], to: '/update?step=review' },
          { id: 'update-after', title: 'Look afterwards', where: 'Overview', steps: ['Open **Overview**.'], to: '/' },
        ],
      },
```

- [ ] **Step 2: Palette test** — append to `src/guide/palette.test.ts`:

```ts
  it('skips the tasks of a numbered card — checklist steps are a sequence, not how-tos', () => {
    const entries = guideEntries(FIXTURE_GUIDE)
    expect(entries.some((e) => e.id === 'guide:update-close')).toBe(false)
    expect(entries.some((e) => e.id === 'guide:example-add')).toBe(true)
  })
```

and change the first test's expectation so it no longer requires `guide:update-close`.

- [ ] **Step 3: Run to see it fail** — `npx vitest run src/guide/palette.test.ts` → FAIL.

- [ ] **Step 4: Implement** — in `src/guide/palette.ts`, inside the card loop, before the task loop:

```ts
      // A numbered card is a checklist read in order (the setup steps, the tax season); its rows
      // would duplicate the page tasks they point at, so the palette lists those instead.
      if (card.numbered) continue
```

- [ ] **Step 5: Run** — `npx vitest run src/guide/palette.test.ts src/components/paletteRegistry.guide.test.ts` → PASS.

- [ ] **Step 6: Commit** — `git add src/guide/testing/fixtures.ts src/guide/palette.ts src/guide/palette.test.ts && git commit -m "test(guide): fixtures gain selector chapters and a numbered card; palette skips checklist rows"`

---

## Task 3 — `useTaskSelection` and `TaskDetail` (spec §2.3, §2.4)

**Files:** Create `src/guide/useTaskSelection.ts`, `src/guide/TaskDetail.tsx`. Tests land with
`GuideCard` in Task 5 (both are only used there).

- [ ] **Step 1: The hook**

`src/guide/useTaskSelection.ts`:

```ts
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { GuideCard } from './types'

export interface TaskSelection {
  selectedId: string
  foldOpen: boolean
  select: (id: string) => void
  toggleFold: () => void
}

/** The task a `#hash` names on this card, and whether it is folded — or null. */
export function taskFromHash(card: GuideCard, hash: string): { id: string; folded: boolean } | null {
  let target = hash.replace(/^#/, '')
  try { target = decodeURIComponent(target) } catch { /* a malformed hash names nothing */ }
  if (!target) return null
  if (card.tasks.some((task) => task.id === target)) return { id: target, folded: false }
  if ((card.more ?? []).some((task) => task.id === target)) return { id: target, folded: true }
  return null
}

// Which task the detail column shows (2026-09-15 polish spec §2.4). The hash wins on arrival and
// whenever it changes while the card is mounted (a palette hit, a pointer link); otherwise the
// first visible task. Clicking a row changes state only — a hash write would re-run the arrival
// scroll-and-focus on every click. Derived during render, the LocalSections idiom: compare the
// hash last honoured with the current one instead of a setState-in-effect.
export function useTaskSelection(card: GuideCard): TaskSelection {
  const { hash } = useLocation()
  const [state, setState] = useState(() => {
    const hit = taskFromHash(card, hash)
    return { selectedId: hit?.id ?? card.tasks[0]?.id ?? '', foldOpen: hit?.folded ?? false, hash }
  })
  if (state.hash !== hash) {
    const hit = taskFromHash(card, hash)
    setState({ selectedId: hit?.id ?? state.selectedId, foldOpen: hit?.folded ? true : state.foldOpen, hash })
  }
  return {
    selectedId: state.selectedId,
    foldOpen: state.foldOpen,
    select: (id) => setState((s) => ({ ...s, selectedId: id })),
    toggleFold: () => setState((s) => ({ ...s, foldOpen: !s.foldOpen })),
  }
}
```

- [ ] **Step 2: The detail panel**

`src/guide/TaskDetail.tsx`:

```tsx
import { useLayoutEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { prefersReducedMotion } from '../components/useReducedMotion'
import { EASE_OUT, MOTION_MS } from '../theme/motion'
import { renderSteps } from './renderSteps'
import type { GuideTask } from './types'

// The right column of a master–detail card (2026-09-15 polish spec §2.3): the selected task's
// title, path, steps, traps and Go link — the markup the old task list rendered, one task at a
// time. A tabpanel labelled by the rail row that selected it. On a task change it crossfades
// (the LocalSectionPanel idiom: WAAPI so a re-render restarts it; skipped on first mount, under
// reduced motion, and where animate() is missing — jsdom).
export default function TaskDetail({ task, id }: { task: GuideTask; id: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const firstRef = useRef(true)
  useLayoutEffect(() => {
    const first = firstRef.current
    firstRef.current = false
    if (first) return
    const el = ref.current
    if (el === null || prefersReducedMotion() || typeof el.animate !== 'function') return
    el.animate(
      [{ opacity: 0, translate: '0 6px' }, { opacity: 1, translate: 'none' }],
      { duration: MOTION_MS.xfade, easing: EASE_OUT, fill: 'backwards' },
    )
  }, [task.id])
  return (
    <div ref={ref} className="guide-detail" role="tabpanel" id={id} aria-labelledby={task.id}>
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
            <li key={line}>{renderSteps(line)}</li>
          ))}
        </ul>
      )}
      {task.to && (
        <Link className="guide-go" to={task.to}>
          Go →
        </Link>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Type-check and lint** — `npx tsc -b && npx eslint src/guide` → clean (the
conditional `setState` during render is the sanctioned derived-state idiom; if the compiler rule
flags it, mirror `LocalSections.tsx:40` exactly — a plain `if` at the top level of the hook body).

- [ ] **Step 4: Commit** — `git add src/guide/useTaskSelection.ts src/guide/TaskDetail.tsx && git commit -m "feat(guide): task selection from the hash, and a crossfading TaskDetail panel (polish spec §2.3–2.4)"`

---

## Task 4 — `TaskRail` (spec §2.2, §6)

**Files:** Create `src/guide/TaskRail.tsx`.

- [ ] **Step 1: Implement**

```tsx
import { useLayoutEffect, useRef } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { STAGGER_CAP } from '../theme/motion'
import type { GuideCard, GuideTask } from './types'

// The left column of a master–detail card (2026-09-15 polish spec §2.2): a vertical tablist whose
// rows KEEP the task ids — palette hits, pointer links and the probe target `#<taskId>` land on
// a row, and LocalSections' arrival effect focuses it (which scrolls the rail too). One measured
// accent indicator, the LocalSectionNav idiom turned vertical. Folded tasks sit under a "More
// tasks (N)" row that expands in place. Arrow keys move the selection like the tab strip's do.
export default function TaskRail({
  card,
  selectedId,
  onSelect,
  foldOpen,
  onToggleFold,
  detailId,
}: {
  card: GuideCard
  selectedId: string
  onSelect: (id: string) => void
  foldOpen: boolean
  onToggleFold: () => void
  detailId: string
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  // The FIRST placement is where the bar lives, not a move: data-placed goes on from the second.
  const placedRef = useRef(false)
  const visible = card.tasks
  const folded = card.more ?? []
  const foldId = `${card.id}-fold`

  useLayoutEffect(() => {
    const place = () => {
      const list = listRef.current
      const bar = indicatorRef.current
      if (list === null || bar === null) return
      const row = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      // A selected row inside a closed fold has no height to mark.
      if (row === null || (!foldOpen && row.closest('.guide-rail-fold') !== null)) {
        bar.style.height = '0px'
        return
      }
      if (placedRef.current) bar.dataset.placed = ''
      bar.style.height = `${row.offsetHeight}px`
      bar.style.transform = `translateY(${row.offsetTop}px)`
      placedRef.current = true
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => place())
    if (listRef.current !== null) observer?.observe(listRef.current)
    return () => observer?.disconnect()
  }, [selectedId, foldOpen, card])

  // Arrows walk the rows a reader can see: the visible ones, plus the folded ones once open.
  const reachable: GuideTask[] = foldOpen ? [...visible, ...folded] : visible
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, task: GuideTask) => {
    const index = reachable.findIndex((t) => t.id === task.id)
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    const nextIndex =
      event.key === 'Home' ? 0
      : event.key === 'End' ? reachable.length - 1
      : step ? (index + step + reachable.length) % reachable.length
      : null
    if (nextIndex === null) return
    event.preventDefault()
    const next = reachable[nextIndex]
    onSelect(next.id)
    document.getElementById(next.id)?.focus({ preventScroll: true })
  }

  const row = (task: GuideTask, index: number) => (
    <button
      key={task.id}
      type="button"
      role="tab"
      id={task.id}
      className="guide-rail-row"
      aria-selected={task.id === selectedId}
      aria-controls={detailId}
      tabIndex={task.id === selectedId ? 0 : -1}
      style={{ '--guide-i': Math.min(index, STAGGER_CAP) } as CSSProperties}
      onClick={() => onSelect(task.id)}
      onKeyDown={(event) => onKey(event, task)}
    >
      {card.numbered && <span className="guide-rail-num">{index + 1}</span>}
      <span className="guide-rail-text">
        <span className="guide-rail-title">{task.title}</span>
        <small className="guide-rail-where">{task.where}</small>
      </span>
    </button>
  )

  return (
    <div ref={listRef} className="guide-rail" role="tablist" aria-orientation="vertical" aria-label={`Tasks on ${card.title}`}>
      {/* Decorative: aria-selected already says which row is current. */}
      <span ref={indicatorRef} className="guide-rail-indicator" aria-hidden="true" />
      {visible.map((task, index) => row(task, index))}
      {folded.length > 0 && (
        <>
          <button type="button" className="guide-rail-more" aria-expanded={foldOpen} aria-controls={foldId} onClick={onToggleFold}>
            {foldOpen ? 'Fewer tasks' : `More tasks (${folded.length})`}
          </button>
          <div id={foldId} className="guide-rail-fold" data-open={foldOpen} aria-hidden={!foldOpen}>
            <div className="guide-rail-fold-inner">{folded.map((task, index) => row(task, visible.length + index))}</div>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check and lint** — `npx tsc -b && npx eslint src/guide` → clean.

- [ ] **Step 3: Commit** — `git add src/guide/TaskRail.tsx && git commit -m "feat(guide): TaskRail — vertical tablist with anchored rows, numbers, an in-place fold and a measured indicator (polish spec §2.2)"`

---

## Task 5 — `GuideCard` becomes master–detail (spec §2.1) — TDD

**Files:** Modify `src/guide/GuideCard.tsx`, rewrite `src/guide/GuideCard.test.tsx`; `git rm src/guide/GuideTaskList.tsx`.

- [ ] **Step 1: Rewrite the test**

`src/guide/GuideCard.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import GuideCard from './GuideCard'
import { FIXTURE_GUIDE } from './testing/fixtures'

afterEach(cleanup)

const pageCard = FIXTURE_GUIDE[2].cards[0]      // page-example: 1 visible task, 2 folded, 1 card watch
const numberedCard = FIXTURE_GUIDE[1].cards[0]  // routine-monthly: numbered, 2 tasks
const proseCard = FIXTURE_GUIDE[0].cards[0]     // start-what: no tasks

function renderCard(card = pageCard, entry = '/guide?section=pages') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <GuideCard card={card} />
    </MemoryRouter>,
  )
}

const rail = () => screen.getByRole('tablist', { name: 'Tasks on Example' })
const detail = () => document.querySelector('.guide-detail') as HTMLElement

describe('GuideCard (master–detail)', () => {
  it('renders head, purpose, views and Open link, then a rail beside a detail', () => {
    renderCard()
    const card = document.getElementById('page-example') as HTMLElement
    expect(within(card).getByRole('heading', { level: 2, name: 'Example' })).toBeTruthy()
    expect(within(card).getByText('An example page.')).toBeTruthy()
    expect(within(card).getByText('Views: Overview · Accounts')).toBeTruthy()
    expect(within(card).getByRole('link', { name: 'Open Example →' }).getAttribute('href')).toBe('/net-worth')
    expect(card.querySelector('.guide-md .guide-rail-col .guide-rail')).toBeTruthy()
    expect(card.querySelector('.guide-md .guide-detail-col .guide-detail')).toBeTruthy()
    expect(rail().getAttribute('aria-orientation')).toBe('vertical')
  })

  it('rows keep the task ids, the first visible task is selected, and the detail shows it', () => {
    renderCard()
    const row = document.getElementById('example-add') as HTMLElement
    expect(row.getAttribute('role')).toBe('tab')
    expect(row.getAttribute('aria-selected')).toBe('true')
    expect(row.textContent).toContain('Add an example')
    expect(row.textContent).toContain('Accounts → Example roster')
    expect(detail().getAttribute('role')).toBe('tabpanel')
    expect(detail().getAttribute('aria-labelledby')).toBe('example-add')
    expect(row.getAttribute('aria-controls')).toBe(detail().id)
    expect(within(detail()).getByRole('heading', { level: 4, name: 'Add an example' })).toBeTruthy()
    const steps = Array.from(detail().querySelectorAll('ol.guide-steps > li')).map((li) => li.textContent)
    expect(steps).toEqual(['Open Accounts.', 'Press Add example.'])
    expect(detail().querySelectorAll('b.guide-label')).toHaveLength(2)
    expect(within(detail()).getByText('Blank means not entered — it is never a zero.')).toBeTruthy()
    expect(within(detail()).getByRole('link', { name: 'Go →' }).getAttribute('href')).toBe('/net-worth?section=accounts')
  })

  it('renders the card-level Watch out in the detail column', () => {
    renderCard()
    const col = document.querySelector('.guide-detail-col') as HTMLElement
    expect(within(col).getByRole('heading', { level: 3, name: 'Watch out' })).toBeTruthy()
    expect(within(col).getByText('The example is entered as a negative number — a positive one inflates the total.')).toBeTruthy()
  })

  it('folds the long tail behind a More row that expands in place, and selecting a folded row shows it', () => {
    renderCard()
    const more = screen.getByRole('button', { name: 'More tasks (2)' })
    const fold = document.getElementById('page-example-fold') as HTMLElement
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(fold.getAttribute('data-open')).toBe('false')
    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(fold.getAttribute('data-open')).toBe('true')
    expect(screen.getByRole('button', { name: 'Fewer tasks' })).toBeTruthy()
    fireEvent.click(document.getElementById('example-export') as HTMLElement)
    expect(document.getElementById('example-export')?.getAttribute('aria-selected')).toBe('true')
    expect(within(detail()).getByRole('heading', { level: 4, name: 'Export the example' })).toBeTruthy()
  })

  it('a hash naming a folded task selects it and opens the fold on arrival', () => {
    renderCard(pageCard, '/guide?section=pages#example-table')
    expect(document.getElementById('page-example-fold')?.getAttribute('data-open')).toBe('true')
    expect(document.getElementById('example-table')?.getAttribute('aria-selected')).toBe('true')
    expect(within(detail()).getByRole('heading', { level: 4, name: 'Show the table' })).toBeTruthy()
  })

  it('arrow keys move the selection and Home/End jump', () => {
    renderCard(numberedCard, '/guide?section=routines')
    const first = document.getElementById('update-close') as HTMLElement
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.getElementById('update-after')?.getAttribute('aria-selected')).toBe('true')
    expect(within(detail()).getByRole('heading', { level: 4, name: 'Look afterwards' })).toBeTruthy()
    fireEvent.keyDown(document.getElementById('update-after') as HTMLElement, { key: 'Home' })
    expect(first.getAttribute('aria-selected')).toBe('true')
  })

  it('a numbered card shows 1-based numbers on its rows', () => {
    renderCard(numberedCard, '/guide?section=routines')
    expect(Array.from(document.querySelectorAll('.guide-rail-num')).map((n) => n.textContent)).toEqual(['1', '2'])
  })

  it('a prose card renders body and no rail, Open link or detail', () => {
    renderCard(proseCard, '/guide')
    const card = document.getElementById('start-what') as HTMLElement
    expect(card.querySelector('.guide-md')).toBeNull()
    expect(within(card).queryByRole('tablist')).toBeNull()
    expect(within(card).queryByRole('link')).toBeNull()
  })
})
```

The `numberedCard` selector `rail()` uses the Example card's name; the numbered tests query rows by id, so no rename is needed.

- [ ] **Step 2: Run to see it fail** — `npx vitest run src/guide/GuideCard.test.tsx` → FAIL (no tablist).

- [ ] **Step 3: Rewrite the card**

`src/guide/GuideCard.tsx`:

```tsx
import { Link } from 'react-router-dom'
import { renderSteps } from './renderSteps'
import TaskDetail from './TaskDetail'
import TaskRail from './TaskRail'
import type { GuideCard as GuideCardData } from './types'
import { useTaskSelection } from './useTaskSelection'

// The card grammar after the 2026-09-15 polish: Purpose · views · body, then a rail of tasks on
// the left and the selected task's detail on the right (spec §2.1). Still a .card so the shell's
// entrance, stagger and scroll reveal apply with no opt-in; the eyebrow h2 labels the section.
export default function GuideCard({ card }: { card: GuideCardData }) {
  const hasTasks = card.tasks.length > 0
  const watch = card.watch ?? []
  const selection = useTaskSelection(card)
  const all = [...card.tasks, ...(card.more ?? [])]
  const selected = all.find((task) => task.id === selection.selectedId) ?? card.tasks[0]
  const detailId = `${card.id}-detail`
  const watchBlock = watch.length > 0 && (
    <>
      <h3 className="guide-h3">Watch out</h3>
      <ul className="guide-watch">
        {watch.map((line) => (
          <li key={line}>{renderSteps(line)}</li>
        ))}
      </ul>
    </>
  )
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
      {hasTasks && selected ? (
        <div className="guide-md">
          <div className="guide-rail-col">
            <h3 className="guide-h3">Do this</h3>
            <TaskRail
              card={card}
              selectedId={selected.id}
              onSelect={selection.select}
              foldOpen={selection.foldOpen}
              onToggleFold={selection.toggleFold}
              detailId={detailId}
            />
          </div>
          <div className="guide-detail-col">
            <TaskDetail task={selected} id={detailId} />
            {watchBlock}
          </div>
        </div>
      ) : (
        watchBlock
      )}
    </section>
  )
}
```

Then `git rm src/guide/GuideTaskList.tsx` (its only consumer was this card).

- [ ] **Step 4: Run** — `npx vitest run src/guide && npx tsc -b && npx eslint src/guide` → PASS, clean.

- [ ] **Step 5: Commit** — `git add -A src/guide && git commit -m "feat(guide): GuideCard is master–detail — rail left, detail right, watch under the detail (polish spec §2.1)"`

---

## Task 6 — the stylesheet: layout, rail, detail, selector, facts, glossary grid, motion (spec §2.5, §3, §5, §6)

**Files:** Modify `src/pages/GuidePage.css`.

- [ ] **Step 1: Replace the header comment and the retired blocks**

Replace the file header with:

```css
/* GuidePage.css — page-scoped rules only (OverviewPage.css's charter): .page/.card/.card-grid/
   .eyebrow/.chip/.drill-hint/.empty-note live in panels.css and are never redefined here.
   Every duration is a var(--t-*) token (motion.test.ts) and every motion-only rule sits under
   prefers-reduced-motion: no-preference; the reduce block in index.css zeroes the tokens too
   (2026-09-15 polish spec §6). */
```

Delete the `.guide-tasks`, `.guide-more`, `.guide-chips`, `.guide-chips a.chip` blocks (their
components are gone). Keep everything else (`.guide-card-head`, measures, `.guide-h3`,
`.guide-task-title`, `.guide-where*`, `.guide-steps`, `.guide-label`, `.guide-watch`,
`.guide-task-watch`, `.guide-go/.guide-open`, focus ring, body lists, glossary dt/dd, map,
scroll-margin).

- [ ] **Step 2: Append the new blocks**

```css
/* ── Master–detail (polish spec §2.5) ─────────────────────────────────────────────────────── */

.guide-md {
  display: grid;
  grid-template-columns: minmax(240px, 34%) minmax(0, 1fr);
  gap: 1.25rem 1.75rem;
  align-items: start;
  margin-top: 0.25rem;
}

.guide-rail-col .guide-h3 {
  margin-top: 0.25rem;
}

/* The detail keeps reading while the rail scrolls. */
.guide-detail-col {
  position: sticky;
  top: calc(var(--sticky-inset, 0px) + 1rem);
  align-self: start;
  min-width: 0;
}

.guide-detail-col .guide-h3 {
  margin-top: 1.25rem;
}

/* The rail: every row reachable, none hidden — it scrolls inside the card past ~70vh. */
.guide-rail {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-height: min(70vh, 640px);
  overflow-y: auto;
  padding: 0 0.25rem 0 0.6rem;
  margin: 0 -0.25rem 0 -0.6rem;
}

.guide-rail-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.6rem;
  align-items: baseline;
  width: 100%;
  text-align: left;
  padding: 0.45rem 0.6rem;
  border: 1px solid transparent;
  border-radius: 7px;
  background: none;
  color: var(--text);
  font: inherit;
  cursor: pointer;
  scroll-margin: 0.5rem;
}

.guide-rail-row:hover {
  background: var(--fill);
}

.guide-rail-row[aria-selected='true'] {
  background: var(--surface-2);
  border-color: var(--border);
}

.guide-rail-row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.guide-rail-num {
  min-width: 1.4rem;
  height: 1.4rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  display: inline-grid;
  place-items: center;
  font-size: 0.7rem;
  color: var(--muted);
  align-self: center;
}

.guide-rail-row[aria-selected='true'] .guide-rail-num {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}

.guide-rail-text {
  display: grid;
  gap: 0.05rem;
  min-width: 0;
}

.guide-rail-title {
  font-weight: 600;
  font-size: 0.9rem;
}

.guide-rail-where {
  color: var(--muted);
  font-size: 0.75rem;
}

/* ONE accent bar for the rail, placed by TaskRail's measuring effect — the strip's indicator,
   vertical. Absolute inside the scroller, so it scrolls with its row. */
.guide-rail-indicator {
  position: absolute;
  left: 0;
  top: 0;
  width: 2px;
  height: 0;
  border-radius: 2px;
  background: var(--accent);
  pointer-events: none;
}

.guide-rail-more {
  align-self: flex-start;
  margin: 0.25rem 0 0;
  padding: 0.35rem 0.6rem;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  cursor: pointer;
}

.guide-rail-more:hover {
  background: var(--fill);
  color: var(--text);
}

.guide-rail-more:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

/* The fold: a grid-rows reveal, not a jump (spec §6). */
.guide-rail-fold {
  display: grid;
  grid-template-rows: 0fr;
  overflow: hidden;
}

.guide-rail-fold[data-open='true'] {
  grid-template-rows: 1fr;
}

.guide-rail-fold-inner {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.guide-detail {
  min-width: 0;
}

/* ── Card selector (spec §3): a sticky chip tablist; the hash is the selection ─────────── */

.guide-selector {
  position: sticky;
  top: var(--sticky-inset, 0px);
  z-index: 2;
  background: var(--bg);
  padding: 0.5rem 0 0.6rem;
  margin: 0 0 0.25rem;
}

.guide-selector [role='tablist'] {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.guide-selector .chip[aria-selected='true'] {
  color: var(--text);
  border-color: currentColor;
}

/* A selected card lands under the strip AND the selector. */
.guide-selector ~ .guide-card {
  scroll-margin-top: calc(var(--sticky-inset, 0px) + 3.5rem);
}

/* ── Fact grids and the glossary grid (spec §5, used by lane L2's content) ─────────────── */

.guide-facts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem 1.5rem;
  margin: 0.5rem 0 0.25rem;
}

.guide-fact {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.7rem 0.85rem;
  background: var(--surface-2);
  min-width: 0;
}

.guide-fact h4 {
  margin: 0 0 0.25rem;
  font-size: 0.9rem;
}

.guide-fact p {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
}

.guide-glossary-grid {
  display: grid;
  grid-template-columns: minmax(12rem, max-content) 1fr;
  gap: 0.35rem 1.25rem;
  max-width: none;
}

.guide-glossary-grid dt {
  margin: 0;
}

.guide-glossary-grid dd {
  margin: 0;
}

/* ── Motion (spec §6) — tokens only; the reduce block zeroes them ──────────────────────── */

.guide-rail-row,
.guide-rail-more,
.guide-selector .chip {
  transition:
    background-color var(--t-fast) var(--ease-out),
    border-color var(--t-fast) var(--ease-out),
    color var(--t-fast) var(--ease-out);
}

/* Only once placed at least once: the opening measurement lands instantly. */
.guide-rail-indicator[data-placed] {
  transition:
    transform var(--t-nav) var(--ease-out),
    height var(--t-nav) var(--ease-out);
}

.guide-rail-fold {
  transition: grid-template-rows var(--t-page) var(--ease-out);
}

@media (prefers-reduced-motion: no-preference) {
  @keyframes guide-row-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  /* Rows arrive in a short cascade behind the card; --guide-i is the row's index, capped. */
  .guide-rail-row {
    animation: guide-row-in var(--t-enter) var(--ease-out) both;
    animation-delay: calc(var(--guide-i, 0) * var(--t-stagger));
  }
}

/* ── Narrow: the columns stack, the detail follows the rail (spec §2.5) ───────────────── */

@media (max-width: 1000px) {
  .guide-md {
    grid-template-columns: 1fr;
  }

  .guide-detail-col {
    position: static;
  }

  .guide-facts {
    grid-template-columns: 1fr;
  }

  .guide-glossary-grid {
    grid-template-columns: 1fr;
  }
}
```

`--on-accent` exists in `tokens.ts` (`onAccent`). If `@keyframes` inside a media block trips the
motion scanner (it should not — the durations are tokens), move the keyframes to top level.

- [ ] **Step 3: Run the CSS gates** — `npx vitest run src/theme/motion.test.ts src/theme/tokens.test.ts` → PASS.

- [ ] **Step 4: Commit** — `git add src/pages/GuidePage.css && git commit -m "style(guide): master–detail grid, scrollable rail with indicator and fold, sticky selector, fact and glossary grids, token motion (polish spec §2.5, §3, §5, §6)"`

---

## Task 7 — `CardSelector` (spec §3) — TDD

**Files:** Create `src/guide/CardSelector.tsx`, `src/guide/CardSelector.test.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CardSelector, { selectedCardId } from './CardSelector'
import { FIXTURE_GUIDE } from './testing/fixtures'

vi.mock('./content', async () => {
  const { FIXTURE_GUIDE } = await import('./testing/fixtures')
  return { GUIDE: FIXTURE_GUIDE }
})

afterEach(cleanup)

const pages = FIXTURE_GUIDE[2]

function Probe() {
  const { hash } = useLocation()
  return <output data-testid="hash">{hash}</output>
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <CardSelector chapter={pages} selectedId={selectedCardId(pages, new URL(entry, 'http://x').hash)} />
      <Probe />
    </MemoryRouter>,
  )
}

describe('CardSelector', () => {
  it('renders one chip per card as a tablist, the first selected by default', () => {
    renderAt('/guide?section=pages')
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Example', 'Taxes fixture'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs[0].getAttribute('aria-controls')).toBe('page-example')
    expect(tabs[1].getAttribute('tabindex')).toBe('-1')
  })

  it('a hash naming a card selects it; a hash naming a task selects the task\u2019s card', () => {
    expect(selectedCardId(pages, '#page-taxes')).toBe('page-taxes')
    expect(selectedCardId(pages, '#taxes-fixture')).toBe('page-taxes')
    expect(selectedCardId(pages, '#example-export')).toBe('page-example')
    expect(selectedCardId(pages, '#update-close')).toBe('page-example') // another chapter's task → default
    expect(selectedCardId(pages, '')).toBe('page-example')
  })

  it('clicking a chip writes the card into the hash', () => {
    renderAt('/guide?section=pages')
    fireEvent.click(screen.getByRole('tab', { name: 'Taxes fixture' }))
    expect(screen.getByTestId('hash').textContent).toBe('#page-taxes')
  })

  it('ArrowRight and End move the selection through the hash', () => {
    renderAt('/guide?section=pages#page-example')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Example' }), { key: 'ArrowRight' })
    expect(screen.getByTestId('hash').textContent).toBe('#page-taxes')
  })
})
```

- [ ] **Step 2: Run to see it fail** — `npx vitest run src/guide/CardSelector.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

`src/guide/CardSelector.tsx`:

```tsx
import type { KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { cardOf } from './anchors'
import type { GuideChapter } from './types'

/** The card a chapter shows for a hash: the card it names, the card of the task it names, else
 *  the chapter's first card (2026-09-15 polish spec §3). */
export function selectedCardId(chapter: GuideChapter, hash: string): string {
  let target = hash.replace(/^#/, '')
  try { target = decodeURIComponent(target) } catch { target = '' }
  const card = target ? cardOf(target) : undefined
  return card !== undefined && chapter.cards.some((c) => c.id === card) ? card : chapter.cards[0]?.id ?? ''
}

// One card at a time for the Pages and Reference chapters: a sticky chip tablist whose selection
// IS the URL hash, so a deep link, a palette hit and a chip click all land the same way, and Back
// restores the card. Writes replace, not push (the strip's keyboard rule), and LocalSections'
// arrival effect then scrolls the card under the sticky block and focuses it.
export default function CardSelector({ chapter, selectedId }: { chapter: GuideChapter; selectedId: string }) {
  const location = useLocation()
  const navigate = useNavigate()
  const go = (id: string) =>
    navigate({ pathname: location.pathname, search: location.search, hash: `#${id}` }, { replace: true, preventScrollReset: true })
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = chapter.cards.length
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : step ? (index + step + count) % count : null
    if (nextIndex === null) return
    event.preventDefault()
    const next = chapter.cards[nextIndex].id
    go(next)
    document.getElementById(`${chapter.id}-chip-${next}`)?.focus({ preventScroll: true })
  }
  const label = `${chapter.label} in this guide`
  return (
    <nav className="guide-selector span-12" aria-label={label}>
      <div role="tablist" aria-label={label}>
        {chapter.cards.map((card, index) => (
          <button
            key={card.id}
            type="button"
            role="tab"
            id={`${chapter.id}-chip-${card.id}`}
            className="chip"
            aria-selected={card.id === selectedId}
            aria-controls={card.id}
            tabIndex={card.id === selectedId ? 0 : -1}
            onClick={() => go(card.id)}
            onKeyDown={(event) => onKey(event, index)}
          >
            {card.title}
          </button>
        ))}
      </div>
    </nav>
  )
}
```

- [ ] **Step 4: Run** — `npx vitest run src/guide/CardSelector.test.tsx && npx tsc -b && npx eslint src/guide` → PASS.

- [ ] **Step 5: Commit** — `git add src/guide/CardSelector.tsx src/guide/CardSelector.test.tsx && git commit -m "feat(guide): CardSelector — sticky chip tablist whose selection is the hash (polish spec §3)"`

---

## Task 8 — the page: selector chapters render one card (spec §3) — TDD

**Files:** Modify `src/guide/content.tsx`, `src/pages/GuidePage.tsx`, `src/pages/GuidePage.test.tsx`; `git rm src/guide/GuidePageChips.tsx`.

- [ ] **Step 1: Update the page test**

Replace the chip-row tests in `src/pages/GuidePage.test.tsx` (the ones titled "renders the Pages
chip row in card order, and a chip jumps to its card" and "renders no chip row when the Pages
chapter has no cards yet") with:

```tsx
  it('a selector chapter shows the chip tablist and exactly one card — the first by default', () => {
    renderAt('/guide?section=pages')
    const selector = screen.getByRole('navigation', { name: 'Pages in this guide' })
    expect(within(selector).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Example', 'Taxes fixture'])
    expect(document.querySelectorAll('.guide-card')).toHaveLength(1)
    expect(document.getElementById('page-example')).toBeTruthy()
    expect(document.getElementById('page-taxes')).toBeNull()
  })

  it('the hash picks the card: a card id, or a task id inside a card', async () => {
    renderAt('/guide?section=pages#taxes-fixture')
    expect(document.getElementById('page-taxes')).toBeTruthy()
    expect(document.getElementById('page-example')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Taxes fixture' }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => expect(document.activeElement?.id).toBe('taxes-fixture'))
    expect(document.getElementById('taxes-fixture')?.getAttribute('aria-selected')).toBe('true')
  })

  it('clicking a chip swaps the card and writes the hash', () => {
    renderAt('/guide?section=pages')
    fireEvent.click(screen.getByRole('tab', { name: 'Taxes fixture' }))
    expect(document.getElementById('page-taxes')).toBeTruthy()
    expect(document.getElementById('page-example')).toBeNull()
  })

  it('a stacked chapter renders every card; a task hash selects and focuses its rail row', async () => {
    renderAt('/guide#update-after')
    expect(screen.getByRole('tab', { name: 'Routines' }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => expect(document.activeElement?.id).toBe('update-after'))
    expect(document.getElementById('update-after')?.getAttribute('aria-selected')).toBe('true')
  })

  it('renders no selector when a selector chapter has no cards', async () => {
    vi.resetModules()
    vi.doMock('../guide/content', async () => {
      const { FIXTURE_GUIDE } = await import('../guide/testing/fixtures')
      return { GUIDE: FIXTURE_GUIDE.map((c) => (c.id === 'pages' ? { ...c, cards: [] } : c)) }
    })
    try {
      const { default: FreshGuidePage } = await import('./GuidePage')
      render(
        <MemoryRouter initialEntries={['/guide?section=pages']}>
          <Routes>
            <Route path="/guide" element={<FreshGuidePage />} />
          </Routes>
        </MemoryRouter>,
      )
      expect(screen.getByRole('tab', { name: 'Pages' }).getAttribute('aria-selected')).toBe('true')
      expect(screen.queryByRole('navigation', { name: 'Pages in this guide' })).toBeNull()
      expect(document.querySelector('.guide-card')).toBeNull()
    } finally {
      vi.doUnmock('../guide/content')
      vi.resetModules()
    }
  })
```

Keep the existing tests for the four tabs, `?section=pages#page-taxes` (it now asserts the Taxes
card is the one rendered and focused), the bare `#update-close` hash (Routines is stacked: the row
is focused and selected), and tab switching. Import `within` and `waitFor` if not already.

- [ ] **Step 2: Run to see it fail** — `npx vitest run src/pages/GuidePage.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

`src/guide/content.tsx` — flag the two chapters:

```ts
  { id: 'pages', label: 'Pages', selector: true, cards: [...TRACKING_CARDS, ...INCOME_CARDS, ...PLANNING_CARDS] },
  { id: 'reference', label: 'Reference', selector: true, cards: REFERENCE_CARDS },
```

`src/pages/GuidePage.tsx`:

```tsx
import { useLocation } from 'react-router-dom'
import PageFrame from '../components/shell/PageFrame'
import { LocalSectionNav, LocalSectionPanel, useLocalSections } from '../components/shell/LocalSections'
import { chapterOf } from '../guide/anchors'
import CardSelector, { selectedCardId } from '../guide/CardSelector'
import { GUIDE } from '../guide/content'
import GuideCard from '../guide/GuideCard'
import type { GuideChapter, GuideChapterId } from '../guide/types'
import '../components/panels.css'
import './GuidePage.css'

// Through PageFrame like every other page (2026-09-03 shell spec §5), permanently ready: the
// guide has nothing to load. Chapters are the house tab strip (?section=), and a bare #id —
// a card or a task — resolves to its chapter through the anchor index, so a palette hit or a
// pointer task can address any anchor without naming the chapter (2026-09-14 guide spec §3.1).
// A selector chapter (Pages, Reference) shows one card at a time, the hash carrying the card
// (2026-09-15 polish spec §3).
const CHAPTERS: readonly { id: GuideChapterId; label: string }[] = GUIDE.map((chapter) => ({
  id: chapter.id,
  label: chapter.label,
}))

function SelectorChapter({ chapter }: { chapter: GuideChapter }) {
  const { hash } = useLocation()
  if (chapter.cards.length === 0) return null
  const id = selectedCardId(chapter, hash)
  const card = chapter.cards.find((c) => c.id === id) ?? chapter.cards[0]
  return (
    <>
      <CardSelector chapter={chapter} selectedId={card.id} />
      <GuideCard key={card.id} card={card} />
    </>
  )
}

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
            {chapter.selector ? (
              <SelectorChapter chapter={chapter} />
            ) : (
              chapter.cards.map((card) => <GuideCard key={card.id} card={card} />)
            )}
          </LocalSectionPanel>
        ))}
      </PageFrame>
    </div>
  )
}
```

Then `git rm src/guide/GuidePageChips.tsx`.

- [ ] **Step 4: Run** — `npx vitest run src/pages/GuidePage.test.tsx src/guide && npx tsc -b && npx eslint src/guide src/pages/GuidePage.tsx` → PASS, clean. If the focus assertions time out, the arrival effect runs inside `requestAnimationFrame` — keep `waitFor`, and check that the row element with the hash id exists in the DOM at arrival (a selected folded task's row is inside the fold and still in the DOM).

- [ ] **Step 5: Commit** — `git add -A src/guide src/pages/GuidePage.tsx src/pages/GuidePage.test.tsx && git commit -m "feat(guide): Pages and Reference show one card at a time behind the selector (polish spec §3)"`

---

## Task 9 — gates and hand-off

- [ ] **Step 1: Full gates** — `npx tsc -b && npx eslint . && npx vitest run && npm run build`.
  Expected: green (the fences run on the real content, which L2 is restructuring in parallel —
  they pass on the content as it stands on your branch). `mounts.audit.test.ts` walks every `.tsx`:
  no `<EChart`, no retired classes — unaffected.
- [ ] **Step 2: Results** — append `## Results (implementer, <date>)` to this plan: commits, gate
  counts, deviations (e.g. keyframes placement, any React-Compiler rule workaround), hand-offs to V
  (probe checks in spec §7) and to L2 (the class names in the Contracts block are what L2 uses).

## Self-review (done while writing)

- Spec §2.1 → Task 5; §2.2 → Task 4 (+ Task 6 CSS); §2.3–2.4 → Task 3; §2.5 → Task 6; §3 → Tasks
  7–8 (+ Task 6 CSS); §4 → Task 1; §5's class names → Task 6; §6 → Task 6 + WAAPI in Task 3; §7 →
  Tasks 5, 7, 8; palette skip → Task 2.
- Types: `TaskRail` props `{ card, selectedId, onSelect, foldOpen, onToggleFold, detailId }` match
  Task 5's call; `TaskDetail({ task, id })` matches; `selectedCardId(chapter, hash)` used by Task 8;
  `AnchorIndex` shape consistent between Task 1's code and test; fixture ids (`example-add`,
  `example-export`, `example-table`, `taxes-fixture`, `update-close`, `update-after`) consistent
  across Tasks 2, 5, 7, 8.

---

## Results (implementer, 2026-09-14)

**Status: DONE.** Eight task commits on `guide/l1-md`, cut from `d574b52`:

| Commit | Task |
| --- | --- |
| `f28e67d` | 1 — anchor index maps every id to its card as well as its chapter |
| `69652a5` | 2 — fixtures gain selector chapters and a numbered card; palette skips checklist rows |
| `0da2536` | 3 — `useTaskSelection` + crossfading `TaskDetail` |
| `5041644` | 4 — `TaskRail` |
| `c05cde0` | 5 — `GuideCard` is master–detail (`GuideTaskList.tsx` deleted) |
| `56accd7` | 6 — the stylesheet |
| `1c45672` | 7 — `CardSelector` |
| `fd28644` | 8 — Pages and Reference show one card at a time (`GuidePageChips.tsx` deleted) |

**Gates (Task 9, all from the worktree root):** `npx tsc -b` clean · `npx eslint .` **0 errors**, 26
warnings (25 pre-existing `react-refresh/only-export-components` + the one in D3 below; `lint` is a
bare `eslint .`, no `--max-warnings`) · `npx vitest run` **233 files / 3121 tests passed** ·
`npm run build` built in 12.96s. Scoped suites were run red-then-green per task; `motion.test.ts`
and `tokens.test.ts` passed on the stylesheet as written — the `@keyframes` stayed inside the
`prefers-reduced-motion: no-preference` block, so the fallback the plan offered was not needed.

### Deviations

- **D1 (Task 2) — the numbered fixture card is a NEW card, not `routine-monthly`.** The plan set
  `numbered: true` on `routine-monthly` and added `update-after` to it. That breaks
  `src/components/paletteRegistry.guide.test.ts:20`, which pins `guide:update-close` in the
  fixture-derived palette — and `src/components/` is outside this lane. The fixture instead gains
  a second Routines card, `routine-checklist` (`numbered: true`, tasks `checklist-open` and
  `checklist-after`), and `routine-monthly` is untouched. Same intent (a numbered card whose rows
  the palette skips), no collateral. Knock-ons: `palette.test.ts`'s first test keeps its
  `guide:update-close` expectation (the plan's "change the first test" step was unnecessary);
  `GuideCard.test.tsx`'s `numberedCard` is `FIXTURE_GUIDE[1].cards[1]` and its keyboard/number
  tests use the `checklist-*` ids; `GuidePage.test.tsx`'s stacked-chapter test uses
  `#checklist-after` and now also asserts BOTH Routines cards render and that no selector appears.
- **D2 (Task 4) — a folded row is not focusable while the fold is shut.** The plan's row set
  `tabIndex={task.id === selectedId ? 0 : -1}` unconditionally. Select a folded row, then press
  "Fewer tasks", and that `tabIndex=0` button sits inside a block the same plan marks
  `aria-hidden` — a focusable element inside `aria-hidden`. `row()` takes a third argument
  (`focusable`, default `true`) and the folded rows pass `foldOpen`. The indicator effect already
  anticipated this state ("a selected row inside a closed fold has no height to mark").
- **D3 (Task 7) — `selectedCardId` stays exported from `CardSelector.tsx`.** eslint warns
  (`react-refresh/only-export-components`) because the file then exports a non-component. Kept:
  the plan's published contract and `GuidePage.tsx` both import it from there, the rule is a
  warning not an error, and 25 identical warnings already ship in `src/`.
- **D4 (Task 5) — one extra assertion.** The keyboard test also presses `End`, which the plan's
  rail implements but its test only mentioned in the title.

### Hand-off to lane V

The probe `tools/probes/guide-v/smoke.mjs` needs three fixes before it can pass — none are bugs in
this lane, they are the probe reading the old DOM:

1. **`[role="tab"]` is no longer only the chapter strip.** Line 78's "four chapter tabs" check
   collects every `[role=tab]` on the page; selector chips and rail rows are tabs now, and the real
   `start-setup` card renders rail rows in the chapter that loads first. Scope it to
   `nav[aria-label="Guide chapters"] [role="tab"]`.
2. **Line 80's `details.guide-more` matches nothing.** The `<details>` fold is gone; open the tail
   by clicking every `button.guide-rail-more` instead.
3. **The link harvest now sees one card and one task at a time.** A selector chapter renders a
   single `.guide-card`, and `.guide-detail` shows a single task's `Go →`. To keep walking every
   `to` in the guide, iterate the selector chips and then the rail rows (or read the destinations
   from `GUIDE` directly) rather than scraping one rendered panel.

New checks the spec asks for (§7) map onto these DOM contracts, all verified green in jsdom:
`.guide-selector [role=tab][aria-selected=true]` (its `aria-controls` is the card id), exactly one
`.guide-card` inside a selector chapter's panel, `.guide-rail [role=tab]#<taskId>` with
`aria-selected` on the current row, `.guide-detail .guide-task-title` for the selected task.

### Hand-off to lane L2

- `.guide-facts`, `.guide-fact` (an `h4` + `p` tile) and `.guide-glossary-grid` (put it on the
  `<dl>`) are live in `GuidePage.css`, two columns above 1000px and one below.
- A card's `body` still renders in full width above the rail, so prose and fact grids are unchanged
  in placement.
- **`numbered: true` removes that card's tasks from the command palette** (`palette.ts`, spec
  §2.2): once `start-setup` and `routine-tax-season` are numbered, their steps stop appearing in
  Ctrl/⌘+K by design. `guideContent.test.ts`'s required-coverage fence checks task *ids*, not
  palette entries, so it is unaffected.
- `src/guide/content.tsx` (this lane) now carries `selector: true` on `pages` and `reference`; L2
  owns only `src/guide/content/*.tsx`, so the merge is disjoint.
