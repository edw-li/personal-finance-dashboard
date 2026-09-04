# Motion & polish — Lane M2 (shell motion) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One continuous choreography from click to data. Every duration reads a token that a `prefers-reduced-motion: reduce` block zeroes; one `<Suspense>` outside an unkeyed `RouteBoundary` keeps the OLD page on screen until the next chunk resolves; the new page's body fades and rises over `--t-page` while its title and scope rows appear at once; the cards in the initial viewport cascade 40ms apart; everything below the fold rests at 0.62 brightness and brightens as it scrolls in, with no JS; and one accent bar slides down the sidebar to the page just opened.

**Architecture:** Tokens are the mechanism. `src/theme/motion.ts` is the source of truth in `tokens.ts`'s shape (`cssMotionDeclarations()`), `src/index.css` carries the CSS copies, and `motion.test.ts` fails on drift *and* sweeps every stylesheet for a literal duration, so a hard-coded `160ms` can never come back. Switchable motion lives in `@media (prefers-reduced-motion: no-preference)` blocks (the house precedent) or reads a token the reduce block sets to `0ms`. The reveal is pure CSS: four registered custom properties, one `@supports (animation-timeline: view())` block, and `opacity: calc(var(--reveal) * var(--enter))` so the entrance dial and the position dial multiply instead of fighting. The only JS is `useStagger()` — one layout effect tagging the groups already in the viewport — and the nav indicator's two `getBoundingClientRect()` reads.

**Tech Stack:** React 19, TypeScript 5.9, react-router-dom 7.13 (its `Router` already wraps navigation state in `React.startTransition`, which is what lets Suspense hold the old page), vitest 3 + @testing-library/react (jsdom).

**Worktree / commands:** `git worktree add .worktrees/motion-m2 -b motion-m2 main`, then inside it `cmd //c "mklink /J node_modules ..\..\node_modules"`. From the worktree root: `npx vitest run <files>`, `npx tsc -b`, `npx eslint <files>`. LF endings, one commit per task, local commits only — **never push**.

**Read first:** spec `docs/superpowers/specs/2026-09-05-motion-polish-design.md` §1–§5, §10, §11; `src/theme/tokens.ts` + `tokens.test.ts` (the mirror-and-pin idiom this lane copies); `src/components/shell/ShellErrorBoundary.tsx` (the `resetKey` idiom).

**House rules:** no `setState` in an effect body; ref writes only inside effects; tokens, never literal colours; comments say *why* (the ones in the snippets below are the minimum, not the ceiling); LF.

**Done when:** `npx tsc -b`, `npx eslint .` and `npx vitest run` are green from the worktree root.

## Coordination

- M2 merges first. M3/M4 read `var(--t-xfade, 180ms)`-style fallbacks so they build standalone.
- `panels.css`: M2's work is ONE block appended at the END. Two edits sit outside it and are unavoidable — `.loading-dim`'s `0.15s` (~:297) and the deletion of the `.page` entrance (~:530, task 2). Both are far from M4's infohint block; reformat nothing in between.
- **Never touch `src/components/shell/Feed.tsx` or `src/components/ChartCard.tsx`** — M3 owns both.
- `MonthlyUpdatePage.tsx` / `InputsForm.tsx`: exactly one literal changes per file (`700` → `MOTION_MS.flash`).

## File structure

| File | Responsibility |
|---|---|
| `src/theme/motion.ts` + `motion.test.ts` (create) | `MOTION_MS`, `EASE_OUT`, `REVEAL`, `STAGGER_CAP`, the two declaration lists; the `:root`/reduce pins and the literal-duration sweep |
| `src/index.css` (modify) | Seven `--t-*`, `--ease-out`, three `--reveal-*`; the `prefers-reduced-motion: reduce` block |
| `toast.css` · `CommandPalette.css` · `assistant/assistant.css` · `Layout.css` · `panels.css` · `taxes/taxes.css` · `pages/MonthlyUpdatePage.css` (modify) | Hard-coded durations onto tokens |
| `ProtectedRoute.css` · `pages/PortfolioPage.css` (modify) | One comment each: an `infinite` spinner's period is a rate, not a duration |
| `pages/MonthlyUpdatePage.tsx` · `components/taxes/InputsForm.tsx` (modify) | Flash timer reads `MOTION_MS.flash` |
| `components/RouteBoundary.tsx` + `.test.tsx` (modify) | `resetKey` prop replaces `key={pathname}` |
| `components/Layout.tsx` · `Layout.css` · `Layout.test.tsx` (modify) | Suspense outside the boundary; `.nav-indicator` + its measuring effect; fallback delay 300ms |
| `components/shell/PageFrame.tsx` + `.test.tsx` · `shell/shell.css` (modify) | `.page-frame-body` wrapper + `useStagger` ref; the body entrance over `--t-page` |
| `components/useStagger.ts` + `.test.tsx` (create) | Tags viewport groups with `data-stagger`, capped at `STAGGER_CAP` |
| `components/motionCss.test.ts` (create) | Text pins: `@property`, keyframes, `animation-timeline`, exemptions, print, reduced motion |

---

### Task 1: Motion tokens — `motion.ts`, the reduce block, every literal duration

Migration rule: **the duration of a finite `animation`/`transition` becomes a `var(--t-*)`.** An `infinite` spinner's period is a *rate*, not a grammar duration — zeroing it under reduce would freeze it mid-turn — so `assistant-spin 700ms`, `skeleton-pulse 1.4s`, `splash-spin 0.9s` and `spin 1s` keep their literals. A *delay* is a threshold and may stay literal.

- [ ] **Step 1: Write the failing test** — create `src/theme/motion.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { cssMotionDeclarations, reducedMotionDeclarations } from './motion'

const indexCss = readFileSync(path.join(__dirname, '../index.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

/** Declarations of the first block opened after `opener` — tokens.test.ts's idiom. */
function block(opener: string): string {
  const start = indexCss.indexOf(opener)
  if (start === -1) throw new Error(`no ${opener} in index.css`)
  const open = indexCss.indexOf('{', start)
  return indexCss.slice(open + 1, indexCss.indexOf('}', open))
}

it(':root carries every declaration motion.ts declares', () => {
  for (const d of cssMotionDeclarations()) expect(block(':root')).toContain(d)
})

// block() walks to the media query's `{` and the first `}`, which closes the nested :root.
it('reduce zeroes every duration and flattens the reveal', () => {
  const reduce = block('@media (prefers-reduced-motion: reduce)')
  for (const d of reducedMotionDeclarations()) expect(reduce).toContain(d)
})
```

- [ ] **Step 2: Run it — RED.** `npx vitest run src/theme/motion.test.ts` (cannot resolve `./motion`).

- [ ] **Step 3: Implement.** Create `src/theme/motion.ts`:

```ts
// THE motion source of truth (2026-09-05 spec §1), in tokens.ts's shape: index.css carries
// the CSS copies for first paint and motion.test.ts fails on any drift; JS timers that must
// outlast a CSS animation read these numbers instead of re-typing them. fast = hovers,
// toggles, dims, overlay entrances; page = route content (was 180ms); enter = card
// entrance; stagger = per-card offset; xfade = skeleton → content (lane M3); nav =
// indicator slide; flash = pasted cell — the CSS animation AND the timer that clears it.
export const MOTION_MS = {
  fast: 120, page: 240, enter: 240, stagger: 40, xfade: 180, nav: 200, flash: 700,
} as const

export const EASE_OUT = 'cubic-bezier(0.2, 0, 0, 1)'

/** Scroll-linked reveal (spec §4). Strings: these are CSS values, never arithmetic. */
export const REVEAL = { floor: '0.62', range: '35%', rise: '4px' } as const

/** Six groups, 0…5. Past that the cascade reads as lag, not choreography. */
export const STAGGER_CAP = 5

const DURATIONS = Object.keys(MOTION_MS) as (keyof typeof MOTION_MS)[]

/** The `:root` lines index.css must carry, character for character. */
export function cssMotionDeclarations(): string[] {
  return [
    ...DURATIONS.map((k) => `--t-${k}: ${MOTION_MS[k]}ms;`),
    `--ease-out: ${EASE_OUT};`,
    `--reveal-floor: ${REVEAL.floor};`,
    `--reveal-range: ${REVEAL.range};`,
    `--reveal-rise: ${REVEAL.rise};`,
  ]
}

/** What `reduce` overrides. --ease-out is untouched: a curve over 0ms is still 0ms, and one
 *  name means no rule needs a reduced-motion twin. */
export function reducedMotionDeclarations(): string[] {
  return [...DURATIONS.map((k) => `--t-${k}: 0ms;`), '--reveal-floor: 1;', '--reveal-rise: 0px;']
}
```

In `src/index.css`, replace the `--t-fast`/`--t-page` pair (~:40–43) with the first block below, and append the second to the foot of the file:

```css
  /* Motion tokens (2026-09-05 spec §1; mirrored in src/theme/motion.ts, which
     motion.test.ts pins). Unlike the 2026-08-27 pair these are also read OUTSIDE
     no-preference blocks: the reduce block below zeroes every one, so a rule states its
     duration once and is still instant for a reader who asked for that. */
  --t-fast: 120ms; --t-page: 240ms; --t-enter: 240ms; --t-stagger: 40ms;
  --t-xfade: 180ms; --t-nav: 200ms; --t-flash: 700ms;
  --ease-out: cubic-bezier(0.2, 0, 0, 1);
  --reveal-floor: 0.62; --reveal-range: 35%; --reveal-rise: 4px;
}

/* One switch for the whole grammar. Rules gated by `no-preference` never see these values;
   rules that read a token unconditionally — the nav indicator, the paste flash,
   .loading-dim, the delayed fallbacks — become instant here instead of each carrying a
   reduced-motion twin. The reveal's dials flatten with them, which is what makes the
   scroll-linked animation a no-op even where it still runs. */
@media (prefers-reduced-motion: reduce) {
  :root {
    --t-fast: 0ms; --t-page: 0ms; --t-enter: 0ms; --t-stagger: 0ms;
    --t-xfade: 0ms; --t-nav: 0ms; --t-flash: 0ms;
    --reveal-floor: 1; --reveal-rise: 0px;
  }
}
```

Then the literals, one per site:

- `toast.css:106` → `toast-in var(--t-fast) ease-out`; `:110` → `toast-out var(--t-fast) ease-in forwards`
- `CommandPalette.css:105` → `palette-overlay-in var(--t-fast) ease-out`; `:109` → `palette-in var(--t-fast) ease-out`; `assistant.css:363` → `assistant-drawer-in var(--t-fast) ease-out`
- `Layout.css:134` and `panels.css:465` → `<name> var(--t-page) ease 300ms forwards`, rewording the comment above each to spec §2's threshold: the fallback is reached only when a chunk truly takes more than 300ms
- `panels.css:297` → `transition: opacity var(--t-fast) ease;` + `/* Token, not a literal: the reduce block zeroes --t-fast, so the dim is instant for a reader who asked for that (spec §7). */`
- `taxes/taxes.css:141` and `pages/MonthlyUpdatePage.css:66` → `pasted-flash var(--t-flash) ease-out`
- `ProtectedRoute.css:26`, `PortfolioPage.css:55` — no code change, one comment each: an infinite spinner's period is a RATE, not a grammar duration; reading `--t-*` would freeze it mid-turn under reduce, which is why the sweep exempts `infinite`
- `MonthlyUpdatePage.tsx` (~:573) and `taxes/InputsForm.tsx` (~:213) — import `MOTION_MS` (`'../theme/motion'`, `'../../theme/motion'`) and change the one line to `const timer = setTimeout(() => setFlashIds(new Set()), MOTION_MS.flash)`

- [ ] **Step 4: Run it — GREEN.** `npx vitest run src/theme/ src/pages/MonthlyUpdatePage.test.tsx src/components/taxes/`, then `npx tsc -b` and `npx eslint src/theme/motion.ts src/theme/motion.test.ts src/pages/MonthlyUpdatePage.tsx src/components/taxes/InputsForm.tsx`.

- [ ] **Step 5: Mutation check.** `page: 180` in `MOTION_MS` → the `:root` test fails. Restore. Drop `--t-nav: 0ms;` from the reduce block → the reduce test fails. Restore. Put `160ms` back in `toast.css:106` → the sweep names that file and declaration. Restore.

- [ ] **Step 6: Commit** `feat(motion): one token scale for every duration, zeroed under reduced motion`.

---

### Task 2: Route transition — one Suspense outside an unkeyed boundary, and `.page-frame-body`

`key={pathname}` makes every navigation a MOUNT of the Suspense subtree, and React shows a fallback for a mount even inside a transition — that blank frame is the bug. Unkeyed it is an UPDATE, which react-router-dom 7 already wraps in `startTransition`, so React holds the old page until the new chunk resolves. Retry survives without the key: `React.lazy` memoises a rejected import, so returning to the route that threw rethrows and the alert comes straight back.

- [ ] **Step 1: Write the failing tests.** In `RouteBoundary.test.tsx`, rewrite the `remounted under a new key` test as `clears the failed state when resetKey changes, without a remount`: same body, but both elements carry `resetKey="/spending"` / `resetKey="/taxes"` instead of `key=`, and the comment above it names the reason — keying remounted the Suspense subtree above the boundary.

In `Layout.test.tsx`, add `lazy` and `type ReactElement` to the React imports and append:

```tsx
// A chunk this test decides when to resolve — the only way to observe the frame between
// the click and the payload, which is where the blank used to be.
let resolveSpending: ((m: { default: () => ReactElement }) => void) | null = null
const LazySpending = lazy(
  () => new Promise<{ default: () => ReactElement }>((r) => { resolveSpending = r }),
)

it('holds the old page while the next chunk is pending, then swaps', async () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>home body</div>} />
          <Route path="/spending" element={<LazySpending />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
  await act(async () => { fireEvent.click(screen.getByRole('link', { name: 'Spending' })) })
  // Suspense sits OUTSIDE an unkeyed boundary, so this is an update: React keeps the
  // committed tree, #main never empties and the fallback is never reached.
  expect(screen.getByText('home body')).toBeTruthy()
  expect(screen.queryByText('Loading…')).toBeNull()
  await act(async () => { resolveSpending?.({ default: () => <div>spending body</div> }) })
  expect(await screen.findByText('spending body')).toBeTruthy()
})
```

In `PageFrame.test.tsx`, add to the existing `renders the title row … when ready` test — the wrapper must hold the body and nothing above it:

```tsx
    const body = document.querySelector('.page-frame-body')
    expect(body?.textContent).toContain('body')
    expect(document.querySelector('.page-frame-body .page-frame-header')).toBeNull()
```

- [ ] **Step 2: Run them — RED.** `npx vitest run src/components/RouteBoundary.test.tsx src/components/Layout.test.tsx src/components/shell/PageFrame.test.tsx`.

- [ ] **Step 3: Implement.** In `RouteBoundary.tsx`, add `resetKey?: string` to `Props` — doc-commented as Layout's `pathname`, a PROP and not a `key` because keying made every navigation a mount of the Suspense subtree above it — and add, above `render()`:

```tsx
  // ShellErrorBoundary's idiom. A navigation is a fresh attempt: the route that threw is
  // gone, so holding the fallback up strands the reader on a page they already left.
  componentDidUpdate(prev: Props) {
    if (this.state.failed && this.props.resetKey !== prev.resetKey) this.setState({ failed: false })
  }
```

In `Layout.tsx`, replace the `key={pathname}` comment block and its two elements with:

```tsx
          {/* ONE Suspense, OUTSIDE the boundary, which now carries resetKey instead of key
              (2026-09-05 spec §2). Keyed, the subtree was a fresh MOUNT on every navigation
              and React shows a fallback for a mount even inside a transition: #main blanked
              for a frame on every click. Unkeyed it is an UPDATE — react-router-dom 7 wraps
              its state in startTransition — so the old page stays committed until the new
              chunk resolves. .route-fallback, not panels.css's .empty-note: panels.css
              reaches the entry chunk only INCIDENTALLY (the drawer imports it). */}
          <Suspense fallback={<p className="route-fallback" role="status">Loading…</p>}>
            <RouteBoundary resetKey={pathname}>
              <Outlet />
            </RouteBoundary>
          </Suspense>
```

In `PageFrame.tsx`, wrap the three lifecycle branches (skeleton, error-only, ready) — and nothing above them — in `<div className="page-frame-body">…</div>`, commented as the content region and the only part of the page that animates in: one wrapper around all three branches, so the entrance runs once per page mount instead of replaying when the skeleton gives way to the payload. The branches themselves are unchanged.

Append to `src/components/shell/shell.css`:

```css
/* The page's entrance (2026-09-05 spec §2). The title row and the scope row appear at
   once — identical on every page, and the eye is already on them — and only the content
   region fades and rises. `both` fill lands on the `to` keyframe, which is the element's
   own `transform: none`, so a finished body is not a containing block for the wizard's
   viewport-sticky entry footer. */
@media (prefers-reduced-motion: no-preference) {
  .page-frame-body {
    animation: page-body-in var(--t-page) var(--ease-out) both;
  }

  @keyframes page-body-in {
    from { opacity: 0; transform: translateY(8px); }
  }
}
```

Delete the `.page { animation: page-enter … }` rule and its `@keyframes page-enter` from `panels.css` (~:530–543): it faded the WHOLE page including the title row, its comment cites the `key={pathname}` that no longer exists, and two fade-rises on one navigation read as a stutter.

- [ ] **Step 4: Run them — GREEN.** The three test files above, then `npx tsc -b` and `npx eslint src/components/RouteBoundary.tsx src/components/Layout.tsx src/components/shell/PageFrame.tsx`.

- [ ] **Step 5: Mutation check.** Put `key={pathname}` back → the hold-the-old-page test fails on `Loading…`. Restore. Delete `componentDidUpdate` → the resetKey test fails. Restore. Move the `hasData` branch outside `.page-frame-body` → the survives-the-swap test fails.

- [ ] **Step 6: Commit** `feat(motion): hold the old page until the next chunk lands; animate only the page body`.

---

### Task 3: Card entrance, stagger and scroll-linked reveal

§3 and §4 are one CSS block: an element cannot carry two `animation-name` declarations, so the `@supports` rule restates the entrance as the first entry of every comma list and adds the two reveal animations after it. jsdom runs neither, so the CSS is pinned as text.

- [ ] **Step 1: Write the failing tests** — create `src/components/useStagger.test.tsx`:

```tsx
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { STAGGER_CAP } from '../theme/motion'
import { useStagger } from './useStagger'

// jsdom reports a zero rect for everything, which would call the whole document visible.
// One prototype stub answers with the top each fixture declares (innerHeight is 768).
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return { top: Number(this.dataset.top ?? 0) } as DOMRect
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** A tile row, then one card per top, each holding a nested card. */
function Harness({ ready, tops }: { ready: boolean; tops: number[] }) {
  const ref = useStagger<HTMLDivElement>(ready)
  return (
    <div ref={ref}>
      <div className="kpi-row" data-top="0" data-name="tiles" />
      {tops.map((top, i) => (
        <div className="card" data-top={top} data-name={`card${i}`} key={i}>
          <div className="card" data-top={top} data-name={`nested${i}`} />
        </div>
      ))}
    </div>
  )
}
const tagged = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-stagger]')).map(
    (el) => `${el.dataset.name}:${el.dataset.stagger}`,
  )

it('tags viewport groups in document order; a nested card rides its parent', () => {
  render(<Harness ready tops={[100, 300, 500]} />)
  expect(tagged()).toEqual(['tiles:0', 'card0:1', 'card1:2', 'card2:3'])
})

it('leaves everything below the fold untagged — no entrance; the reveal has it', () => {
  render(<Harness ready tops={[100, 900, 1600]} />)
  expect(tagged()).toEqual(['tiles:0', 'card0:1'])
})

it('waits for the payload, tags once, and caps the cascade at six groups', () => {
  const { rerender } = render(<Harness ready={false} tops={[1, 2, 3, 4, 5, 6, 7]} />)
  expect(tagged()).toEqual([])
  rerender(<Harness ready tops={[1, 2, 3, 4, 5, 6, 7]} />)
  expect(tagged().map((t) => t.split(':')[1])).toEqual(['0', '1', '2', '3', '4', '5', '5', '5'])
  expect(STAGGER_CAP).toBe(5)
  // A revalidation re-renders with the same status; re-tagging would replay the cascade.
  rerender(<Harness ready tops={[900, 900, 900, 900, 900, 900, 900]} />)
  expect(tagged()).toHaveLength(8)
})
```

Create `src/components/motionCss.test.ts` — whitespace-flattened, so re-indenting a rule can never fail a pin, and each string carries its enclosing at-rule so containment is pinned too:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

// Comments out first, then whitespace flattened: a pin that names an at-rule and the rule
// inside it must not break because a comment sits between them, and re-indenting a rule
// must never fail a pin either.
const read = (p: string) =>
  readFileSync(path.join(__dirname, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
const panels = read('panels.css')

it('registers the four dials and multiplies them into one opacity', () => {
  const dials = [
    ['--enter', '<number>', '1'], ['--enter-y', '<length>', '0px'],
    ['--reveal', '<number>', '1'], ['--rise', '<length>', '0px'],
  ]
  for (const [name, syntax, initial] of dials) {
    expect(panels).toContain(
      `@property ${name} { syntax: '${syntax}'; inherits: false; initial-value: ${initial}; }`,
    )
  }
  expect(panels).toContain('opacity: calc(var(--reveal) * var(--enter));')
  expect(panels).toContain('transform: translateY(calc(var(--rise) + var(--enter-y)));')
  expect(read('shell/shell.css')).toContain(
    'animation: page-body-in var(--t-page) var(--ease-out) both;',
  )
})

// Each string carries its enclosing at-rule, so containment is pinned with the content.
it('runs the entrance under no-preference only, on tagged groups only, capped at six', () => {
  expect(panels).toContain('no-preference) { .page-frame-body .card:not(:has(.entry-footer)),')
  expect(panels).toContain('animation-duration: var(--enter-dur);')
  expect(panels).toContain('animation-delay: calc(var(--stagger-i, 0) * var(--t-stagger));')
  expect(panels).toContain('[data-stagger] { --enter-dur: var(--t-enter); }')
  expect(panels).toContain(`[data-stagger='5'] { --stagger-i: 5; }`)
  expect(panels).not.toContain(`[data-stagger='6']`)
  expect(panels).toContain('@keyframes card-enter { from { --enter: 0; --enter-y: 8px; }')
})

it('drives the reveal off a view() timeline, and turns it off for print', () => {
  expect(panels).toContain('@supports (animation-timeline: view()) { .page-frame-body')
  expect(panels).toContain('animation-name: card-enter, reveal-in, reveal-out;')
  expect(panels).toContain('animation-timeline: auto, view(), view();')
  expect(panels).toContain('animation-range: normal, entry 0% entry var(--reveal-range), exit calc(100% - var(--reveal-range)) exit 100%;')
  // reveal-out fills `none`: with `both` its own `from` would apply before its range and
  // cancel reveal-in everywhere else. A card inside a card would square the floor.
  expect(panels).toContain('animation-fill-mode: both, both, none;')
  expect(panels).toContain('.page-frame-body .card .card { animation-name: none; }')
  expect(panels).toContain('@keyframes reveal-in { from { --reveal: var(--reveal-floor);')
  expect(panels).toContain('@media print { .page-frame-body .card, .page-frame-body .kpi-row {')
})
```

- [ ] **Step 2: Run them — RED.** `npx vitest run src/components/useStagger.test.tsx src/components/motionCss.test.ts`.

- [ ] **Step 3: Implement.** Create `src/components/useStagger.ts`:

```ts
import { useLayoutEffect, useRef, type RefObject } from 'react'
import { STAGGER_CAP } from '../theme/motion'

// The one piece of JS in the entrance (2026-09-05 spec §3): CSS cannot ask whether an
// element started inside the viewport, so this tags the ones that did with the index their
// delay is computed from, and everything else keeps --enter: 1 and never animates. A
// LAYOUT effect: the tag must be on the element before the browser paints it, or the
// cascade starts a frame late and the first card visibly jumps.

/** Tile rows are one group; a .card inside a .card rides its parent's index. */
const GROUPS = '.kpi-row, .card'

export function useStagger<T extends HTMLElement>(ready: boolean): RefObject<T | null> {
  const ref = useRef<T>(null)
  // One cascade per page mount: `ready` re-renders on every revalidation, and re-tagging
  // would restart the animation with the reader's eye already on the numbers.
  const taggedRef = useRef(false)
  useLayoutEffect(() => {
    const root = ref.current
    if (!ready || root === null || taggedRef.current) return
    taggedRef.current = true
    const groups = Array.from(root.querySelectorAll<HTMLElement>(GROUPS))
    let index = 0
    for (const el of groups) {
      if (groups.some((other) => other !== el && other.contains(el))) continue
      // `>=`, so a card straddling the bottom edge still counts as visible: it rises in
      // with the cascade instead of snapping when the reveal picks it up.
      if (el.getBoundingClientRect().top >= window.innerHeight) continue
      el.dataset.stagger = String(Math.min(index, STAGGER_CAP))
      index += 1
    }
  }, [ready])
  return ref
}
```

In `PageFrame.tsx`, add `const bodyRef = useStagger<HTMLDivElement>(hasData)` beside the other hooks and hang it on the wrapper: `<div className="page-frame-body" ref={bodyRef}>`.

Append to `src/components/panels.css`, as a new block at the very END of the file:

```css
/* ── Motion: entrance, stagger, scroll-linked reveal (2026-09-05 spec §3/§4) ───────── */

/* Registered so they can be ANIMATED: an unregistered custom property has no type, so a
   keyframe on it would jump between its values instead of interpolating. Each initial
   value is the "nothing is moving" state — what a browser with no view() timeline, print,
   and a reduced-motion reader all render. */
@property --enter { syntax: '<number>'; inherits: false; initial-value: 1; }
@property --enter-y { syntax: '<length>'; inherits: false; initial-value: 0px; }
@property --reveal { syntax: '<number>'; inherits: false; initial-value: 1; }
@property --rise { syntax: '<length>'; inherits: false; initial-value: 0px; }

/* Inherited default: a group useStagger never tagged runs a 0s entrance, which is no
   entrance. The tagged rule sets it ON the element, and an own declaration beats an
   inherited one — no specificity race with the surface rule below. */
.page-frame-body { --enter-dur: 0s; }

/* THE motion surface. Exempt by construction: header, scope row, toasts, palette and
   drawers all live outside .page-frame-body. Exempt by selector: the wizard's entry cards,
   whose .entry-footer rides the viewport bottom — a transformed ancestor becomes its
   containing block and strands it mid-page. Brightness is the PRODUCT of the two dials, so
   a card entering while it straddles the bottom edge settles with no snap. */
.page-frame-body .card:not(:has(.entry-footer)),
.page-frame-body .kpi-row {
  opacity: calc(var(--reveal) * var(--enter));
  transform: translateY(calc(var(--rise) + var(--enter-y)));
}

@media (prefers-reduced-motion: no-preference) {
  .page-frame-body .card:not(:has(.entry-footer)),
  .page-frame-body .kpi-row {
    animation-name: card-enter;
    animation-duration: var(--enter-dur);
    animation-timing-function: var(--ease-out);
    animation-fill-mode: both;
    animation-delay: calc(var(--stagger-i, 0) * var(--t-stagger));
  }

  /* attr() still cannot be read as a <number>, so six groups are six rules — and six is
     the cap: STAGGER_CAP is 5 and useStagger clamps every later group to it. */
  .page-frame-body [data-stagger] { --enter-dur: var(--t-enter); }
  .page-frame-body [data-stagger='0'] { --stagger-i: 0; }
  .page-frame-body [data-stagger='1'] { --stagger-i: 1; }
  .page-frame-body [data-stagger='2'] { --stagger-i: 2; }
  .page-frame-body [data-stagger='3'] { --stagger-i: 3; }
  .page-frame-body [data-stagger='4'] { --stagger-i: 4; }
  .page-frame-body [data-stagger='5'] { --stagger-i: 5; }

  @keyframes card-enter { from { --enter: 0; --enter-y: 8px; } to { --enter: 1; --enter-y: 0px; } }

  /* Scroll-linked reveal, no JS: below-the-fold content rests at --reveal-floor and
     brightens as it enters. Nested inside the no-preference gate (so `reduce` never
     reaches it) and inside @supports (so a browser without view() timelines shows full
     brightness). The entrance is repeated as the FIRST animation of every comma list:
     one element cannot carry two animation-name declarations, and this rule would
     replace the entrance rather than join it. */
  @supports (animation-timeline: view()) {
    .page-frame-body .card:not(:has(.entry-footer)) {
      animation-name: card-enter, reveal-in, reveal-out;
      animation-duration: var(--enter-dur), auto, auto;
      animation-timing-function: var(--ease-out), linear, linear;
      /* reveal-out fills `none`: with `both` its own `from` (--reveal: 1) would apply
         through the before-phase and, being later in the list, cancel reveal-in's dimming
         on every card that has not reached the top edge yet. */
      animation-fill-mode: both, both, none;
      animation-delay: calc(var(--stagger-i, 0) * var(--t-stagger)), 0s, 0s;
      animation-timeline: auto, view(), view();
      animation-range: normal, entry 0% entry var(--reveal-range), exit calc(100% - var(--reveal-range)) exit 100%;
    }

    /* A card inside a card would square the floor (0.62 × 0.62 = 0.38). */
    .page-frame-body .card .card { animation-name: none; }

    @keyframes reveal-in {
      from { --reveal: var(--reveal-floor); --rise: var(--reveal-rise); }
      to { --reveal: 1; --rise: 0px; }
    }

    @keyframes reveal-out {
      from { --reveal: 1; --rise: 0px; }
      to { --reveal: var(--reveal-floor); --rise: calc(-1 * var(--reveal-rise)); }
    }
  }
}

/* Ink on paper never dims, and print has no scroller for a view() timeline to read. */
@media print {
  .page-frame-body .card,
  .page-frame-body .kpi-row { opacity: 1; transform: none; animation: none; }
}
```

- [ ] **Step 4: Run them — GREEN.** The two new files plus `src/components/shell/PageFrame.test.tsx` and `src/theme/motion.test.ts`, then `npx tsc -b` and `npx eslint src/components/useStagger.ts src/components/useStagger.test.tsx src/components/motionCss.test.ts src/components/shell/PageFrame.tsx`.

- [ ] **Step 5: Mutation check.** Drop the `Math.min` clamp → the cap test fails. Drop the `contains` filter → the nested card takes an index. Set a fixture top to exactly 768 → the below-the-fold test fails until `>=` is restored. Change `animation-fill-mode` to `both, both, both`, and delete `card-enter` from `animation-name` → the reveal pins fail. Restore each.

- [ ] **Step 6: Commit** `feat(motion): staggered card entrance and a scroll-linked reveal below the fold`.

---

### Task 4: Sliding nav indicator

- [ ] **Step 1: Write the failing test** — append to `src/components/Layout.test.tsx`:

```tsx
describe('Layout — nav indicator', () => {
  // jsdom does no layout: one stub gives the nav a zero origin and each link a `row`-tall
  // slot, so the bar's transform is arithmetic a test can state.
  let row = 40
  beforeEach(() => {
    row = 40
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.tagName === 'NAV') return { top: 0, height: 520 } as DOMRect
      const nav = this.tagName === 'A' ? this.closest('nav') : null
      if (nav === null) return { top: 0, height: 0 } as DOMRect
      const links = Array.from(nav.querySelectorAll('a'))
      return { top: links.indexOf(this as HTMLAnchorElement) * row, height: 36 } as DOMRect
    })
  })

  it('parks one accent bar on the active link and slides it on a route change', () => {
    renderShell()
    const bar = document.querySelector<HTMLElement>('.nav-indicator')
    // Overview is the first link, so the bar starts at the nav's own top.
    expect(bar?.style.transform).toBe('translateY(0px)')
    expect(bar?.style.height).toBe('36px')
    expect(bar?.style.opacity).toBe('1')
    fireEvent.click(screen.getByRole('link', { name: 'Spending' })) // the fifth link
    expect(bar?.style.transform).toBe('translateY(160px)')
  })

  it('re-measures on resize — nav rows move when the window does', () => {
    renderShell('/spending')
    row = 50
    fireEvent(window, new Event('resize'))
    const bar = document.querySelector<HTMLElement>('.nav-indicator')
    expect(bar?.style.transform).toBe('translateY(200px)')
  })
})
```

- [ ] **Step 2: Run it — RED.** `npx vitest run src/components/Layout.test.tsx`.

- [ ] **Step 3: Implement.** In `Layout.tsx`, beside the other navigation effects:

```tsx
  // ONE accent bar for the whole nav (2026-09-05 spec §5), measured rather than assumed:
  // rows are not a fixed height (section headings, the compact density, a label that
  // wraps), so a CSS-only bar would hard-code a rhythm and drift the day a destination is
  // added. Reads only — no state, so a measurement can never cost a render — and the
  // writes are ref writes inside an effect, which is where they belong.
  const navRef = useRef<HTMLElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const place = () => {
      const nav = navRef.current
      const bar = indicatorRef.current
      if (nav === null || bar === null) return
      const active = nav.querySelector<HTMLElement>('a.active')
      if (active === null) {
        // A route no nav entry owns (the 404, a deep link): a bar left where it was would
        // claim the reader is on a page they are not.
        bar.style.opacity = '0'
        return
      }
      const box = active.getBoundingClientRect()
      bar.style.opacity = '1'
      bar.style.height = `${box.height}px`
      bar.style.transform = `translateY(${box.top - nav.getBoundingClientRect().top}px)`
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [pathname])
```

and open the nav with it:

```tsx
          <nav aria-label="Primary" ref={navRef}>
            {/* Decorative: aria-current already announces the current page, and a second
                announcement would read the same fact twice. */}
            <div className="nav-indicator" ref={indicatorRef} aria-hidden="true" />
```

In `Layout.css`, add `position: relative;` to the existing `.sidebar nav` rule (the bar's positioning context), delete `box-shadow: inset 3px 0 0 var(--accent);` from `.nav-link.active` — rewording its comment, since the accent is now one shared bar rather than a per-link inset — and add:

```css
/* ONE accent bar for the whole nav, placed by Layout's measuring effect (spec §5).
   Transparent until that effect runs, and on a route no destination owns, so it never
   flashes at the top of the sidebar before its first measurement; opacity is deliberately
   not transitioned, because appearing is not moving. The durations are read
   unconditionally: index.css's reduce block zeroes --t-nav, which places the bar instantly
   for a reader who asked for less motion. */
.nav-indicator {
  position: absolute;
  left: 0;
  top: 0;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--accent);
  opacity: 0;
  pointer-events: none;
  transition: transform var(--t-nav) var(--ease-out), height var(--t-nav) var(--ease-out);
}
```

- [ ] **Step 4: Run it — GREEN.** `npx vitest run src/components/Layout.test.tsx`, then the whole lane: `npx vitest run`, `npx tsc -b`, `npx eslint .`.

- [ ] **Step 5: Mutation check.** Drop `pathname` from the effect's dependency array → the slide test fails on the old transform. Remove the `resize` listener → the resize test fails. Return early instead of setting `opacity: '0'` when there is no active link → the bar lies on `/nothing`. Restore each.

- [ ] **Step 6: Commit** `feat(motion): one sliding accent bar replaces the per-link inset shadow`.

---

## Hand-off

Report in the merge note: `--t-xfade`/`--t-fast` exist for M3, `--t-enter`/`--ease-out` are the house entrance for M1's chart `MOTION`, and `.page-frame-body` is the wrapper M3's cross-fade lives inside. A later lane that needs a new duration adds it to `motion.ts` AND to both `index.css` blocks in the same commit, or `motion.test.ts` fails.
