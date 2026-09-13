# Lane F2 — shell grammar and tokens (2026-09-13 polish) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> Opus implementer for this lane in its own worktree, TDD per task, then a spec-compliance review
> and a code-quality review, then a local merge to main — never pushed). Steps use `- [ ]`
> checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-13-surface-grammar-and-view-fit-polish-design.md` —
this lane implements **§2.1, §2.4, §2.5, §2.6, §3, §6, §7 (recipe + hook), §9 (skeleton parity),
§10 (StatTile badge), §11 (popover surface + dismiss hook), §12 (KPI rules)** plus the mechanical
`sections=` wiring of every tabbed page. Read §0, §1 and those sections before Task 1. Evidence:
`scratchpad/ux-audit-2026-09-13/reports/shell-and-panels.md` (A4–A7, C1–C4, D2, G3–G5) and
`projection-calendar-settings-themes.md` (S-2, S-7, L-1–L-3, W-6).

**Goal:** every new surface has motion, the tab strip lives in one sticky place on all ten tabbed
pages, the light theme gets real fill/hairline/scrim/shadow tokens, and the shared primitives the
page lanes build on (Disclosure, popover surface + dismissal, sticky row actions + scroll edges,
KPI row rules, StatTile badge, delta-less ghost tiles, Feed cascade) exist with tests.

**Architecture:** CSS-first. Three palette tokens join `tokens.ts` and both `index.css` blocks;
`panels.css` gains the shared keyframes, the hover list, the popover/sticky/KPI recipes;
`PageFrame` grows a `sections` slot inside its existing sticky element; `LocalSectionNav` gets a
measured sliding indicator, a `trailing` slot and history-neutral keyboard activation;
`LocalSectionPanel` cross-fades on activation through WAAPI; `useStagger` exports `tagStagger` so
`Feed` can cascade its own first payload inside the page's arrival window; new
`Disclosure`, `usePopoverDismiss`, `useScrollEdges` files carry the primitives. No backend, no DB.

**Tech stack:** React 19 + Vite 6 + TypeScript 5.9, vitest 3 + Testing Library (jsdom 26),
eslint 9 with `eslint-plugin-react-hooks` 7 (the React-Compiler rules — `purity`, `refs`,
`set-state-in-effect`, `set-state-in-render` — are ON as errors), lucide-react icons.

---

## Mechanics (read once)

- Worktree: `C:/Users/edyli/personal-finance-dashboard/.worktrees/polish-f2`, branch
  `polish/f2-shell`, cut from `main` (F1 has already merged at `c53a61e`; F2 merges next, the
  page lanes branch from the result). Create it with
  `git worktree add -b polish/f2-shell .worktrees/polish-f2 main` from the repo root, then work
  ONLY inside it (`cd .worktrees/polish-f2`). If `node_modules` is missing there, run `npm ci`.
- Every command below runs from the worktree root in Git Bash. `npx vitest run <paths>` is the
  test runner (no `globals: true`; tests import from `vitest`). `npx tsc -b` type-checks;
  `npx eslint src` lints; `npm run build` = `tsc -b && vite build`.
- Commit after every task with the prefix shown in its last step. Never push. Never touch
  `.worktrees/`, the DB or the dev servers.
- Files this lane may edit (spec §1): `src/components/shell/PageFrame.tsx` (+test),
  `LocalSections.tsx` (+test), `localSections.css`, `shell.css`, `src/components/panels.css`,
  `src/components/useStagger.ts` (+test), `src/components/shell/Feed.tsx` (+test),
  `src/components/PageSkeleton.tsx` (+test), `src/components/StatTile.tsx` (+test),
  `src/theme/tokens.ts` + `tokens.test.ts`, `src/index.css`, `src/charts/recolor.ts` (+test),
  new `src/components/Disclosure.tsx` + `disclosure.css` + test, new
  `src/components/usePopoverDismiss.ts` + test, new `src/components/useScrollEdges.ts` + test,
  new `src/components/surfaceGrammar.test.ts` (CSS pins), `src/components/skeletonMetrics.test.ts`
  (one pin moves), `src/pages/CalendarPage.css` (hairline colour ONLY), and the `<PageFrame>`
  call site of the ten tabbed pages (`NetWorthPage`, `PortfolioPage`, `SpendingPage`,
  `CreditCardsPage`, `PaycheckPage`, `CompPage`, `EsppPage`, `TaxesPage`, `ProjectionPage`,
  `SettingsPage`). Nothing else — a page-lane file you think needs a change goes in the hand-off
  list at the end, not in this branch.

## House rules this plan encodes (do not "improve" them away)

1. **Durations are tokens only.** `src/theme/motion.test.ts` scans every `.css` under `src/` and
   fails on any literal finite duration in an `animation`/`transition` layer. Write
   `var(--t-fast)`, `var(--t-xfade)`, `var(--t-page)`, `var(--t-nav)`; never `120ms`. No new
   duration tokens: `motion.ts` and the `:root` motion lines of `index.css` stay
   character-identical. JS timing reads `MOTION_MS`/`EASE_OUT` from `src/theme/motion.ts`.
2. **Palette tokens live in three places at once.** `tokens.test.ts` diffs every line
   `cssDeclarations()` emits against BOTH `index.css` blocks (`:root` and
   `[data-theme="light"]`), value for value. `charts/recolor.ts` lists token slots explicitly;
   a token it must not map is excluded with a comment (Task 1 does exactly that).
3. **Reduced motion** = token zeroing (index.css's reduce block) for CSS, plus
   `prefersReducedMotion()` from `src/components/useReducedMotion.ts` around every WAAPI call.
   Rules that only make sense as motion sit under `@media (prefers-reduced-motion: no-preference)`.
4. **Existing tests are updated, never deleted.** Two existing pins move on purpose and are
   named in their tasks (`skeletonMetrics.test.ts`'s `:empty` pin; nothing else).
5. **`Feed.test.tsx` pins the exact `.loading-dim` media block** in panels.css
   (`@media (prefers-reduced-motion: no-preference) { .loading-dim { transition: opacity var(--t-fast) ease; } }`).
   Do not add anything inside THAT block; the shared keyframes go in the "Motion grammar
   (2026-08-27 spec §4)" block that starts with `.button, .chip, …`.
6. **`PageSkeleton.test.tsx` pins** `'.page-skeleton, .loading-fallback { --m-stat-tile: 115px;'`
   as a prefix — new variables in that block go AFTER `--m-stat-tile`.
7. **React-hooks compiler rules.** `useRef(performance.now())` is a `react-hooks/purity` error
   (verified with eslint on this repo); `useState(() => performance.now())` is accepted. Never
   read `ref.current` during render; never call setState synchronously inside an effect body.
8. **Per-page stylesheets never depend on each other.** Everything shared goes in `panels.css`
   or the shell sheets; the one page sheet this lane touches (`CalendarPage.css`) changes hairline
   colours only.

## Contracts this lane publishes (F1's follow-up and the page lanes build against these verbatim)

```
tokens.ts   ThemeTokens += fill, scrim, shadow           → CSS --fill, --scrim, --shadow (both blocks)
                                                          --shadow is bare `r g b / a`: use rgb(var(--shadow))
panels.css  @keyframes pop-in | panel-in | backdrop-in   (inside the no-preference block; F1's own sheets may reference them)
            .popover-surface                             absolute, z 20, --surface, 10px radius, rgb(var(--shadow)) shadow, pop-in
            .kpi-row > :last-child fills the row; .kpi-row-5; .kpi-row-dense; @container rules on .page
            .row-actions / .col-identity sticky cells (tables that carry td.row-actions), [data-scroll-more~=left|right] masks
            .stat-label-text (nowrap unit) / .stat-badge (pill)
            .skeleton-tile-bare + --m-stat-tile-bare: 93px
shell.css   .page-frame-scope > .page-frame-sections (first row) + .page-frame-scope-row (second row)
Disclosure  default export from src/components/Disclosure.tsx
            <Disclosure summary defaultOpen? open? onToggle?(open) onOpen? className? id? name?>children</Disclosure>
            renders <details class="disclosure"><summary>{chevron}{summary}</summary><div class="disclosure-body">…</div></details>
usePopoverDismiss(open, onClose, triggerRef, surfaceRef): void      src/components/usePopoverDismiss.ts
useScrollEdges(ref): void                                          src/components/useScrollEdges.ts
tagStagger(root, startIndex = 0): number; CASCADE_WINDOW_MS = 3000  src/components/useStagger.ts
usePageFrame() → { fromCache, mountedAt }                          mountedAt = performance.now() at the frame's first render
PageFrame   sections?: ReactNode  (rendered inside the sticky element, before scopeRow)
LocalSectionNav  trailing?: ReactNode; onChange?(section, options?: { replace?: boolean })
GhostTile   delta?: boolean (default true); PageSkeleton tiles?: number | { count: number; delta?: boolean }
StatTile    badge?: ReactNode
```

## File map

| File | Responsibility after this lane |
| --- | --- |
| `src/theme/tokens.ts` | the three new slots + their CSS declarations |
| `src/index.css` | static copies of the three tokens in both palette blocks |
| `src/charts/recolor.ts` | documents why fill/scrim/shadow are not in the recolor map |
| `src/components/panels.css` | tokens applied, shared keyframes + hover list, popover surface, sticky row actions, KPI grammar, stat badge, bare ghost tile |
| `src/components/shell/shell.css` | the two-row sticky block |
| `src/components/shell/localSections.css` | tab strip: indicator, trailing slot, `--fill` hover |
| `src/pages/CalendarPage.css` | six hairlines in `--border` |
| `src/components/shell/PageFrame.tsx` | `sections` slot, `mountedAt` in context |
| `src/components/shell/LocalSections.tsx` | indicator, `trailing`, keyboard `replace`, panel WAAPI fade |
| `src/components/useStagger.ts` | `tagStagger` + `[hidden]` skip + `CASCADE_WINDOW_MS` |
| `src/components/shell/Feed.tsx` | first-payload cascade inside the arrival window |
| `src/components/Disclosure.tsx` + `disclosure.css` | the disclosure primitive |
| `src/components/usePopoverDismiss.ts` | outside-pointerdown / Escape dismissal |
| `src/components/useScrollEdges.ts` | `data-scroll-more` edge tokens |
| `src/components/StatTile.tsx` | `badge`, nowrap label unit |
| `src/components/PageSkeleton.tsx` | delta-less ghost tiles |
| ten `src/pages/*Page.tsx` | `sections={<LocalSectionNav …/>}` |
| `src/components/surfaceGrammar.test.ts` | CSS text pins for everything above that jsdom cannot compute |

---

## Task 1 — tokens: `fill`, `scrim`, `shadow` (spec §6)

**Files:**
- Modify: `src/theme/tokens.ts`
- Modify: `src/theme/tokens.test.ts`
- Modify: `src/index.css` (both palette blocks)
- Modify: `src/charts/recolor.ts` (comment only), `src/charts/recolor.test.ts`

- [ ] **Step 1: Write the failing token tests**

In `src/theme/tokens.test.ts`, inside `describe('tokens', …)`, change the `others` set of the
diverging test to include the new hex token and add two tests. Replace the existing
`'%s: no diverging step equals another token hex or another step'` block with:

```ts
  it.each(surfaces)('%s: no diverging step equals another token hex or another step', (_name, t) => {
    const others = new Set(
      [
        t.bg, t.surface, t.surface2, t.border, t.fill, t.text, t.muted, t.accent, t.onAccent,
        t.positive, t.negative, t.warn, t.gridLine, t.axisLine, t.otherSeries,
        ...t.palette, ...t.sequential,
      ].map((h) => h.toLowerCase()),
    )
    for (const hex of t.diverging) expect(others.has(hex.toLowerCase()), hex).toBe(false)
    expect(new Set(t.diverging.map((h) => h.toLowerCase())).size).toBe(9)
  })

  // §6 fill: the pressed/hover/ghost surface has to be a visible step on the CARD in both themes.
  // --surface-2 sits between --bg and --surface in LIGHT (1.05:1 on white), which is why active
  // segments, tab hovers and skeleton ghosts vanished there (2026-09-13 audit L-1). 1.15:1 is the
  // acceptance floor (spec §15.7); the fill must also not just be surface-2 under another name.
  it.each(surfaces)('%s: the fill reads as a step against the card', (_name, t) => {
    expect(contrastRatio(t.fill, t.surface)).toBeGreaterThanOrEqual(1.15)
    expect(t.fill.toLowerCase()).not.toBe(t.surface2.toLowerCase())
  })

  // The two NON-hex tokens are pinned to the shapes their consumers read: --scrim is a whole
  // rgba() colour (a backdrop), --shadow is the component list inside rgb(var(--shadow)). Neither
  // may go through luminance(), which accepts only #rrggbb — hence a shape pin, not a contrast one.
  it.each(surfaces)('%s: scrim is an rgba() colour and shadow is bare r g b / a components', (_name, t) => {
    expect(t.scrim).toMatch(/^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, 0?\.\d+\)$/)
    expect(t.shadow).toMatch(/^\d{1,3} \d{1,3} \d{1,3} \/ 0?\.\d+$/)
  })
```

In `src/charts/recolor.test.ts`, append to the `describe('shared dark hexes', …)` block:

```ts
  // fill/scrim/shadow (2026-09-13 polish §6) stay OUT of the map: fill's dark hex is border's, so
  // listing it would only re-run the border/axisLine election with a third name — the light twin
  // of #262b36 is still LIGHT.border — and the two non-hex tokens have no key at all.
  it('leaves the UI-surface tokens out of the election', () => {
    expect(lightFromDark.get(DARK.border.toLowerCase())).toBe(LIGHT.border)
    expect(lightFromDark.has(DARK.scrim.toLowerCase())).toBe(false)
    expect(lightFromDark.has(DARK.shadow.toLowerCase())).toBe(false)
  })
```

- [ ] **Step 2: Run the two files to see them fail**

Run: `npx vitest run src/theme/tokens.test.ts src/charts/recolor.test.ts`
Expected: FAIL — TypeScript/vitest reports `Property 'fill' does not exist on type 'ThemeTokens'`
(and `scrim`, `shadow`); the index.css test does not yet see `--fill`.

- [ ] **Step 3: Add the slots to `tokens.ts`**

In `src/theme/tokens.ts`, inside `interface ThemeTokens`, insert after `border: string`:

```ts
  /** The pressed / hover / ghost fill (2026-09-13 polish §6): `.segmented button.active`, tab
   *  hover, `.skeleton`, the quiet `.button`, the chart pin strip, a Disclosure summary under the
   *  pointer. `surface2` sits BETWEEN `bg` and `surface` in LIGHT (1.05:1 on a white card), so it
   *  reads as neither a raised nor an inset fill there; this slot is a real step on the card in
   *  both themes — tokens.test.ts holds it to ≥ 1.15:1 against `surface`. */
  fill: string
  /** The one modal scrim (detail-panel backdrop, the chart Expand dialog's ::backdrop, the day
   *  drawer). An rgba() string, not a hex: translucent by definition, so it enters no contrast
   *  floor and no chart recolor map. */
  scrim: string
  /** Shadow ink as bare `r g b / a` components, read as `rgb(var(--shadow))` inside box-shadow
   *  values (launcher, popovers, drawers, the panel). Dark keeps black; light uses the page's own
   *  cool ink at 14%, so a white disc stops wearing a black smudge. Not a colour string — excluded
   *  from every parse/contrast test and from charts/recolor.ts. */
  shadow: string
```

In `DARK`, after `border: '#262b36',` add:

```ts
  fill: '#262b36',
  scrim: 'rgba(0, 0, 0, 0.55)',
  shadow: '0 0 0 / 0.45',
```

In `LIGHT`, after `border: '#e1e7ef',` add:

```ts
  fill: '#e6ebf2',
  scrim: 'rgba(20, 30, 50, 0.35)',
  shadow: '20 30 50 / 0.14',
```

In `cssDeclarations`, after the `--border` line add:

```ts
    `--fill: ${t.fill};`,
    `--scrim: ${t.scrim};`,
    `--shadow: ${t.shadow};`,
```

- [ ] **Step 4: Mirror them in both `index.css` blocks**

In `src/index.css`, inside `:root`, directly after `--border: #262b36;`:

```css
  /* Pressed/hover/ghost fill, the one modal scrim, and shadow ink (2026-09-13 polish §6).
     --shadow is bare `r g b / a` components: read it as rgb(var(--shadow)) inside box-shadow. */
  --fill: #262b36;
  --scrim: rgba(0, 0, 0, 0.55);
  --shadow: 0 0 0 / 0.45;
```

Inside `[data-theme="light"]`, directly after `--border: #e1e7ef;`:

```css
  --fill: #e6ebf2;
  --scrim: rgba(20, 30, 50, 0.35);
  --shadow: 20 30 50 / 0.14;
```

Touch nothing else in the file — the motion lines are pinned character for character.

- [ ] **Step 5: Document the exclusion in `recolor.ts`**

In `src/charts/recolor.ts`, replace the sentence at the top of the election comment
`// The dark set spends four hexes on TWO token names each, so a flat hex→hex map has to`
with these lines (keep the table under it unchanged):

```ts
// The dark set spends four hexes on TWO token names each, so a flat hex→hex map has to
// elect a winner wherever the light set SPLITS the pair. NOT listed below, on purpose
// (2026-09-13 polish §6): `fill`, `scrim` and `shadow` are UI-surface tokens that never reach a
// chart option. fill's dark hex IS border's (#262b36) — listing it would only re-run the
// border/axisLine election with a third name — and scrim (an rgba() string) and shadow (bare
// `r g b / a` components) are not hexes a builder could have typed into an option.
// recolor.test.ts pins that the border election is unchanged and that neither non-hex has a key.
```

(The original second line `// elect a winner wherever the light set SPLITS the pair. Last write
wins, and the order` continues as `// Last write wins, and the order` — keep the rest of the
paragraph intact.)

- [ ] **Step 6: Run the two files and the motion pin**

Run: `npx vitest run src/theme src/charts/recolor.test.ts`
Expected: PASS — `Test Files 3 passed` (tokens, motion, recolor), all tests green.

- [ ] **Step 7: Type-check and commit**

Run: `npx tsc -b`
Expected: no output (exit 0).

```bash
git add src/theme/tokens.ts src/theme/tokens.test.ts src/index.css src/charts/recolor.ts src/charts/recolor.test.ts
git commit -m "feat(tokens): add fill, scrim and shadow palette slots in both themes"
```


## Task 2 — apply the tokens: fills, hairlines, the disabled primary (spec §6)

**Files:**
- Modify: `src/components/panels.css` (`.data-table td`, `.button`, after `.button:disabled`, `.segmented button.active`, `.skeleton`, one new `.chart-card .chart-selection-summary` rule)
- Modify: `src/components/shell/shell.css` (`.segmented button.active`)
- Modify: `src/components/shell/localSections.css` (`[role=tab]:hover`)
- Modify: `src/pages/CalendarPage.css` (hairline colours only)
- Create: `src/components/surfaceGrammar.test.ts`

- [ ] **Step 1: Create the CSS-pin test file with its first describe**

jsdom computes no styles, so — like `Feed.test.tsx`, `PageSkeleton.test.tsx` and
`skeletonMetrics.test.ts` — this lane pins the stylesheet TEXT. One file holds every pin the
batch adds; later tasks append a `describe` each. Create `src/components/surfaceGrammar.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (skeletonMetrics.test.ts's idiom): a pin survives a
// re-indent and a comment moving, and fails only when a declaration actually changes.
const flat = (file: string) =>
  readFileSync(path.join(__dirname, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')

const PANELS = flat('panels.css')
const SHELL = flat('shell/shell.css')
const SECTIONS = flat('shell/localSections.css')
const CALENDAR = flat('../pages/CalendarPage.css')

describe('light tokens applied (2026-09-13 polish §6)', () => {
  it('points the pressed/hover/ghost surfaces at --fill', () => {
    expect(PANELS).toContain('.segmented button.active { background: var(--fill); color: var(--text); }')
    expect(SHELL).toContain('.segmented button.active { background: var(--fill); color: var(--text); }')
    expect(PANELS).toContain('.skeleton { background: var(--fill); border-radius: 6px; }')
    expect(PANELS).toMatch(/\.button \{[^}]*background: var\(--fill\);/)
    // chartInteractions.css (F1's sheet) is bundled AFTER panels.css and paints the pin strip
    // --surface-2 at one class of specificity; the two-class rule is what lets this sheet win.
    expect(PANELS).toContain('.chart-card .chart-selection-summary { background: var(--fill); }')
    expect(SECTIONS).toContain('.local-section-nav [role=tab]:hover { background: var(--fill); color: var(--text); }')
    // Bubbles and chips keep --surface-2: they carry a border, so the fill is not their edge.
    expect(PANELS).toMatch(/\.info-hint-bubble \{[^}]*background: var\(--surface-2\);/)
  })

  it('draws row hairlines in --border, never --surface-2', () => {
    expect(PANELS).toContain('.data-table td { padding: var(--density-cell-pad); border-bottom: 1px solid var(--border); }')
    expect(CALENDAR).toMatch(/\.cal-day \{[^}]*border: 1px solid var\(--border\);/)
    expect(CALENDAR).toMatch(/\.cal-gutter \{[^}]*border: 1px dashed var\(--border\);/)
    // No border of any width or style anywhere in the calendar sheet reads the invisible token.
    expect(CALENDAR).not.toMatch(/border(?:-bottom|-left|-top)?: \d+px (?:solid|dashed) var\(--surface-2\)/)
  })

  it('demotes a disabled primary to one step under the quiet button', () => {
    expect(PANELS).toContain(
      '.button-primary:disabled, .button-primary:disabled:hover { background: var(--surface-2); border-color: var(--border); color: var(--muted); opacity: 1; filter: none; }',
    )
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/surfaceGrammar.test.ts`
Expected: FAIL — three failing tests (`expected '…' to contain '…var(--fill)…'`, the
`--surface-2` hairline regex matching, the disabled-primary rule missing).

- [ ] **Step 3: panels.css — fills, hairline, disabled primary, pin strip**

In `src/components/panels.css`:

1. `.data-table td` — change `border-bottom: 1px solid var(--surface-2);` to
   `border-bottom: 1px solid var(--border);`.
2. `.button` — change `background: var(--surface-2);` to `background: var(--fill);`.
3. Directly after the existing `.button:disabled { opacity: 0.5; cursor: not-allowed; }` rule add:

```css
/* A disabled PRIMARY demotes to one step UNDER the quiet button (2026-09-13 polish §6, audit
   S-7): at 50% the accent pill still outranked the enabled Dry run beside it in light.
   --surface-2, not --fill, on purpose — a control that cannot be pressed sits a shade below the
   ones that can. Later than .button:disabled at the same specificity, so it wins the opacity. */
.button-primary:disabled,
.button-primary:disabled:hover {
  background: var(--surface-2);
  border-color: var(--border);
  color: var(--muted);
  opacity: 1;
  filter: none;
}
```

4. `.segmented button.active` (the panels.css copy, ~L266) — `background: var(--surface-2);` →
   `background: var(--fill);`.
5. `.skeleton` — `background: var(--surface-2);` → `background: var(--fill);`.
6. Directly after the `.chart-zoom-hint { … }` rule (end of the "Chart export menu" section) add:

```css
/* The pin strip wears the fill (2026-09-13 polish §6). Two classes on purpose: the strip's own
   rule lives in chartInteractions.css, which is bundled AFTER this sheet at one class of
   specificity, so a single-class override here would lose the cascade. */
.chart-card .chart-selection-summary { background: var(--fill); }
```

- [ ] **Step 4: shell.css, localSections.css, CalendarPage.css**

- `src/components/shell/shell.css` `.segmented button.active` — `background: var(--surface-2);`
  → `background: var(--fill);`.
- `src/components/shell/localSections.css` line 5 — replace the whole line with
  `.local-section-nav [role=tab]:hover { background: var(--fill); color: var(--text); }`.
- `src/pages/CalendarPage.css` — change `var(--surface-2)` to `var(--border)` in exactly these
  six border declarations (colour only; keep width and style): `.cal-day` (`border: 1px solid`),
  `.cal-list > li` (`border-bottom: 1px solid`), `.cal-list-expansion` (`border-left: 2px solid`),
  `.cal-gutter` (`border: 1px dashed`), `.cal-drawer-row` (`border-bottom: 1px solid`),
  `.cal-drawer-expansion` (`border-bottom: 1px solid`). The `background: var(--surface-2)` on
  `.cal-chip`, `.cal-popover` and `.cal-drawer-row:hover` stay as they are.

- [ ] **Step 5: Run the pins plus the suites that read these sheets**

Run: `npx vitest run src/components/surfaceGrammar.test.ts src/components/shell/Feed.test.tsx src/components/PageSkeleton.test.tsx src/components/skeletonMetrics.test.ts src/theme/motion.test.ts`
Expected: PASS — `Test Files 5 passed`.

- [ ] **Step 6: Commit**

```bash
git add src/components/panels.css src/components/shell/shell.css src/components/shell/localSections.css src/pages/CalendarPage.css src/components/surfaceGrammar.test.ts
git commit -m "feat(tokens): paint fills, hairlines and the disabled primary from the new tokens"
```

---

## Task 3 — shared keyframes, pop-in, the hover list (spec §2.1)

**Files:**
- Modify: `src/components/panels.css` (the "Motion grammar (2026-08-27 spec §4)" no-preference block, ~L665)
- Modify: `src/components/surfaceGrammar.test.ts`

- [ ] **Step 1: Append the failing pins**

Append to `src/components/surfaceGrammar.test.ts`:

```ts
describe('surfaces appear (2026-09-13 polish §2.1)', () => {
  const gate = PANELS.indexOf('@media (prefers-reduced-motion: no-preference) { .button, .chip')

  it('declares the three shared keyframes inside the motion-grammar block', () => {
    expect(gate).toBeGreaterThan(-1)
    for (const frames of [
      '@keyframes pop-in { from { opacity: 0; translate: 0 -4px; } }',
      '@keyframes panel-in { from { opacity: 0; translate: 0 6px; } }',
      '@keyframes backdrop-in { from { opacity: 0; } }',
    ]) {
      const at = PANELS.indexOf(frames)
      expect(at, frames).toBeGreaterThan(gate)
      // Same block: no other @media opens between the gate and the keyframe.
      expect(PANELS.slice(gate + 1, at)).not.toContain('@media')
    }
  })

  it('pops every bubble, popover, pin strip and disclosure body in over --t-fast', () => {
    expect(PANELS).toContain(
      '.info-hint-bubble, .chart-export-popover, .chart-selection-summary, .popover-surface, .disclosure[open] > .disclosure-body { animation: pop-in var(--t-fast) var(--ease-out) both; }',
    )
  })

  it('gives the new controls the house hover transition', () => {
    expect(PANELS).toContain(
      '.button, .chip, .row-toggle, .info-hint, .segmented button, .metric-info-button, .local-section-nav [role=tab], .assistant-icon-button, .detail-panel-resizer, .disclosure > summary { transition: background-color var(--t-fast) ease, border-color var(--t-fast) ease, color var(--t-fast) ease, filter var(--t-fast) ease; }',
    )
  })
})
```

- [ ] **Step 2: Run to see the three fail**

Run: `npx vitest run src/components/surfaceGrammar.test.ts`
Expected: FAIL — the three new tests fail (`toBeGreaterThan(-1)` / `toContain`).

- [ ] **Step 3: Edit the motion-grammar block**

In `src/components/panels.css`, replace the block that starts
`@media (prefers-reduced-motion: no-preference) {` followed by `.button,` (the one containing
`/* Press feedback: felt, barely seen. */`) with:

```css
@media (prefers-reduced-motion: no-preference) {
  .button,
  .chip,
  .row-toggle,
  .info-hint,
  .segmented button,
  .metric-info-button,
  .local-section-nav [role=tab],
  .assistant-icon-button,
  .detail-panel-resizer,
  .disclosure > summary {
    transition:
      background-color var(--t-fast) ease,
      border-color var(--t-fast) ease,
      color var(--t-fast) ease,
      filter var(--t-fast) ease;
  }

  /* Press feedback: felt, barely seen. */
  .button:active {
    transform: scale(0.985);
  }

  .row-click {
    transition: background-color var(--t-fast) ease;
  }

  /* "A surface appears" (2026-09-13 polish §2.1) — the rule the refactor had no rule for, so
     every popover shipped at 0ms. Small anchored things (bubbles, menus, the pin strip, a
     disclosure body) rise 4px into place over --t-fast; larger surfaces use panel-in (6px) and a
     backdrop simply fades — F1's panel and dialog sheets reference these names. Inside the gate,
     so a reduced-motion reader never has the keyframes at all; the durations are tokens, so they
     could not run anyway. `translate`, not `transform`: the bubbles are positioned with
     transforms of their own and the two properties compose. */
  .info-hint-bubble,
  .chart-export-popover,
  .chart-selection-summary,
  .popover-surface,
  .disclosure[open] > .disclosure-body {
    animation: pop-in var(--t-fast) var(--ease-out) both;
  }

  @keyframes pop-in { from { opacity: 0; translate: 0 -4px; } }
  @keyframes panel-in { from { opacity: 0; translate: 0 6px; } }
  @keyframes backdrop-in { from { opacity: 0; } }

  /* The whole-page entrance that used to live here is gone (2026-09-05 spec §2): it faded
     the title row too, it was justified by the key={pathname} Layout no longer passes, and
     two fade-rises on one navigation read as a stutter. shell.css animates
     .page-frame-body — the content region alone — instead. */
}
```

- [ ] **Step 4: Run the pins and the motion sweep**

Run: `npx vitest run src/components/surfaceGrammar.test.ts src/theme/motion.test.ts src/components/shell/Feed.test.tsx`
Expected: PASS — `Test Files 3 passed` (the literal-duration sweep stays green because every
layer's first slot is a `var(--t-*)`).

- [ ] **Step 5: Commit**

```bash
git add src/components/panels.css src/components/surfaceGrammar.test.ts
git commit -m "feat(motion): shared pop-in/panel-in/backdrop-in keyframes and the hover list for new controls"
```

---

## Task 4 — KPI row grammar (spec §12)

**Files:**
- Modify: `src/components/panels.css` (`.page`, the "Stat tiles" section)
- Modify: `src/components/surfaceGrammar.test.ts`

- [ ] **Step 1: Append the failing pins**

```ts
describe('KPI grammar (2026-09-13 polish §12)', () => {
  it('makes .page the query container and balances the rows', () => {
    expect(PANELS).toMatch(/\.page \{[^}]*container-type: inline-size;/)
    expect(PANELS).toContain('.kpi-row > :last-child { grid-column-end: -1; }')
    expect(PANELS).toContain('.kpi-row-5 { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }')
    expect(PANELS).toContain('.kpi-row-dense { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }')
    expect(PANELS).toContain('@container (min-width: 1000px) { .kpi-row-5 { grid-template-columns: repeat(5, minmax(0, 1fr)); } }')
    expect(PANELS).toContain('@container (max-width: 980px) { .kpi-row:not(.kpi-row-5) { grid-template-columns: repeat(2, minmax(0, 1fr)); } }')
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/components/surfaceGrammar.test.ts`
Expected: FAIL — `KPI grammar` test fails on the first `toMatch`.

- [ ] **Step 3: Add the rules**

In `src/components/panels.css`, change the `.page` rule to:

```css
.page {
  padding: 1.75rem 2rem 3rem;
  /* The container the KPI rows query (2026-09-13 polish §12): a dock beside the page narrows the
     CONTAINER, not the viewport, so tile columns must answer to this box. Layout containment makes
     .page the containing block for fixed descendants — none exist inside it (launcher and toasts
     are outside; panels and dialogs are portaled or in the top layer); Projection already did this
     on the same element. */
  container-type: inline-size;
}
```

Directly after the `.kpi-row-lone { max-width: 320px; }` rule add:

```css
/* Balanced rows (2026-09-13 polish §12). The last tile always reaches the row's last line, so a
   4+1 wrap fills the void instead of leaving one narrow orphan (in a full row it spans one track
   as before). A five-tile row — ESPP's strip, Projection's outcomes — is five columns wherever
   1000px of container allow it and auto-fits below; every other row goes 2×2 once a dock has
   narrowed the page under 980px, where four columns read as 3+1. .kpi-row-dense is Portfolio's
   five dense tiles (it replaces that page's private .tiles-row). Container queries, not media
   queries: the dock is the thing that changes the width. */
.kpi-row > :last-child { grid-column-end: -1; }

.kpi-row-5 { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }

.kpi-row-dense { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }

@container (min-width: 1000px) {
  .kpi-row-5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
}

@container (max-width: 980px) {
  .kpi-row:not(.kpi-row-5) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
```

- [ ] **Step 4: Run the pins**

Run: `npx vitest run src/components/surfaceGrammar.test.ts src/components/PageSkeleton.test.tsx`
Expected: PASS — `Test Files 2 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/components/panels.css src/components/surfaceGrammar.test.ts
git commit -m "feat(shell): KPI row grammar — container queries, five-column rows, last tile fills the row"
```

---

## Task 5 — sticky row actions and `useScrollEdges` (spec §7)

**Files:**
- Modify: `src/components/panels.css` (after `.data-table tr.component-row …`)
- Create: `src/components/useScrollEdges.ts`
- Create: `src/components/useScrollEdges.test.ts`
- Modify: `src/components/surfaceGrammar.test.ts`

- [ ] **Step 1: Write the failing hook test**

Create `src/components/useScrollEdges.test.ts` (a `.ts` file: the harness uses `createElement`,
no JSX, so the scoped test command can name it exactly):

```ts
import { cleanup, render } from '@testing-library/react'
import { createElement, useRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useScrollEdges } from './useScrollEdges'

afterEach(cleanup)

function Scroller() {
  const ref = useRef<HTMLDivElement>(null)
  useScrollEdges(ref)
  return createElement('div', { ref, 'data-testid': 'scroller' })
}

// jsdom lays nothing out: the scroller's box is faked as own properties (the Element.prototype
// getters are configurable, so an instance property shadows them), and scrollLeft is a real
// settable property there. The hook re-measures on `scroll`, so a fake box is applied and then
// announced through a scroll event.
function box(el: HTMLElement, scrollWidth: number, clientWidth: number): void {
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true })
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
}

describe('useScrollEdges', () => {
  it('names the hidden edge, follows the scroll position and clears at the far end', () => {
    const { getByTestId } = render(createElement(Scroller))
    const el = getByTestId('scroller')
    // A 0×0 box on mount is "fits": no attribute, so no mask.
    expect(el.hasAttribute('data-scroll-more')).toBe(false)
    box(el, 600, 300)
    el.dispatchEvent(new Event('scroll'))
    expect(el.getAttribute('data-scroll-more')).toBe('right')
    el.scrollLeft = 150
    el.dispatchEvent(new Event('scroll'))
    expect(el.getAttribute('data-scroll-more')).toBe('left right')
    el.scrollLeft = 300
    el.dispatchEvent(new Event('scroll'))
    expect(el.getAttribute('data-scroll-more')).toBe('left')
  })

  it('carries no attribute when the content fits, re-reads on window resize, and cleans up', () => {
    const view = render(createElement(Scroller))
    const el = view.getByTestId('scroller')
    box(el, 300, 300)
    el.dispatchEvent(new Event('scroll'))
    expect(el.hasAttribute('data-scroll-more')).toBe(false)
    box(el, 600, 300)
    window.dispatchEvent(new Event('resize'))
    expect(el.getAttribute('data-scroll-more')).toBe('right')
    view.unmount()
    expect(el.hasAttribute('data-scroll-more')).toBe(false)
  })
})
```

Append the CSS pins to `src/components/surfaceGrammar.test.ts`:

```ts
describe('sticky row actions (2026-09-13 polish §7)', () => {
  it('pins the actions column of a table that opted in, and the identity column on the left', () => {
    expect(PANELS).toContain(
      '.data-table:has(td.row-actions) th:last-child, .data-table td.row-actions, .port-table:has(td.row-actions) th:last-child, .port-table td.row-actions { position: sticky; right: 0; background: var(--surface); box-shadow: -1px 0 0 var(--border); }',
    )
    expect(PANELS).toContain(
      '.data-table th.col-identity, .data-table td.col-identity, .port-table th.col-identity, .port-table td.col-identity { position: sticky; left: 0; z-index: 1; background: var(--surface); box-shadow: 1px 0 0 var(--border); }',
    )
  })
  it('masks whichever edge still hides content', () => {
    expect(PANELS).toContain('[data-scroll-more~="right"] { mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent); }')
    expect(PANELS).toContain('[data-scroll-more~="left"] { mask-image: linear-gradient(to left, #000 calc(100% - 28px), transparent); }')
    expect(PANELS).toContain('[data-scroll-more~="left"][data-scroll-more~="right"] { mask-image: linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px), transparent); }')
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/useScrollEdges.test.ts src/components/surfaceGrammar.test.ts`
Expected: FAIL — `Cannot find module './useScrollEdges'` and the two sticky pins failing.

- [ ] **Step 3: Write the hook**

Create `src/components/useScrollEdges.ts`:

```ts
import { useEffect, type RefObject } from 'react'

// Which edges of a horizontal scroller still hide content (2026-09-13 polish §7). Written as a
// space-separated `data-scroll-more` token list ("left", "right", "left right") so panels.css can
// mask the hidden edge with [data-scroll-more~="…"]; removed outright when nothing is hidden, so
// a table that fits its card carries no attribute and no mask. Re-read on scroll, on the
// scroller's own resize (a dock opening narrows it with no window event) and on window resize.
// Page lanes attach it to their `*-scroll` wrappers alongside the `.row-actions` cells.
export function useScrollEdges(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const update = () => {
      const edges: string[] = []
      if (el.scrollLeft > 0) edges.push('left')
      // A 1px tolerance: fractional widths leave scrollLeft + clientWidth a hair short of
      // scrollWidth at the far right, which would pin a phantom "more" on a fully scrolled table.
      if (el.scrollLeft + el.clientWidth < el.scrollWidth - 1) edges.push('right')
      if (edges.length === 0) el.removeAttribute('data-scroll-more')
      else el.setAttribute('data-scroll-more', edges.join(' '))
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    // Guarded for jsdom and old browsers (PageFrame's idiom): without it the edges refresh on
    // the next scroll or window resize instead.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      observer?.disconnect()
      el.removeAttribute('data-scroll-more')
    }
  }, [ref])
}
```

- [ ] **Step 4: Add the CSS recipe**

In `src/components/panels.css`, directly after the `.data-table tr.component-row td:first-child { … }`
rule add:

```css
/* Row actions stay in view while a wide table scrolls sideways (2026-09-13 polish §7). Only a
   table that has OPTED IN — one with a `td.row-actions` column — pins its last header cell, so no
   other table grows a hairline on its last column. border-collapse loses a sticky cell's own
   border, so the hairline is redrawn as a box-shadow (CompPage.css's precedent). The identity
   column is the left-hand twin; z-index 1 keeps it over the cells it slides across. */
.data-table:has(td.row-actions) th:last-child,
.data-table td.row-actions,
.port-table:has(td.row-actions) th:last-child,
.port-table td.row-actions {
  position: sticky;
  right: 0;
  background: var(--surface);
  box-shadow: -1px 0 0 var(--border);
}

.data-table th.col-identity,
.data-table td.col-identity,
.port-table th.col-identity,
.port-table td.col-identity {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--surface);
  box-shadow: 1px 0 0 var(--border);
}

/* useScrollEdges writes which edges still hide content; the mask says so without a scrollbar.
   The two-token rule exists because mask-image does not add up: with both edges hidden, the
   later single-edge rule would otherwise win and the other edge would read as the table's end. */
[data-scroll-more~="right"] { mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent); }
[data-scroll-more~="left"] { mask-image: linear-gradient(to left, #000 calc(100% - 28px), transparent); }
[data-scroll-more~="left"][data-scroll-more~="right"] { mask-image: linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px), transparent); }
```

- [ ] **Step 5: Run both files**

Run: `npx vitest run src/components/useScrollEdges.test.ts src/components/surfaceGrammar.test.ts`
Expected: PASS — `Test Files 2 passed`.

- [ ] **Step 6: Lint and commit**

Run: `npx eslint src/components/useScrollEdges.ts src/components/useScrollEdges.test.ts`
Expected: no output.

```bash
git add src/components/panels.css src/components/useScrollEdges.ts src/components/useScrollEdges.test.ts src/components/surfaceGrammar.test.ts
git commit -m "feat(shell): sticky row-action and identity cells, scroll-edge masks and useScrollEdges"
```

---

## Task 6 — `.popover-surface` and `usePopoverDismiss` (spec §11)

**Files:**
- Modify: `src/components/panels.css` (new section after the chart export menu block)
- Create: `src/components/usePopoverDismiss.ts`
- Create: `src/components/usePopoverDismiss.test.ts`
- Modify: `src/components/surfaceGrammar.test.ts`

- [ ] **Step 1: Write the failing hook test**

Create `src/components/usePopoverDismiss.test.ts`:

```ts
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePopoverDismiss } from './usePopoverDismiss'

const onClose = vi.fn()
afterEach(() => { cleanup(); onClose.mockClear() })

// The shape every caller has: a trigger that toggles, a surface with controls, and page content
// beside them. jsdom has no PointerEvent, so fireEvent.pointerDown falls back to a plain Event
// named `pointerdown` — which is exactly what the document listener hears in a browser too.
function Harness({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  usePopoverDismiss(open, () => { onClose(); setOpen(false) }, triggerRef, surfaceRef)
  return createElement(
    'div',
    null,
    createElement('button', { ref: triggerRef, type: 'button', 'aria-expanded': open, onClick: () => setOpen((v) => !v) }, 'Customize'),
    open ? createElement('div', { ref: surfaceRef, role: 'dialog', 'aria-label': 'Customize overview' }, createElement('button', { type: 'button' }, 'Done')) : null,
    createElement('p', null, 'elsewhere'),
  )
}

describe('usePopoverDismiss', () => {
  it('closes on a pointerdown outside the surface and its trigger', () => {
    render(createElement(Harness))
    fireEvent.pointerDown(screen.getByText('elsewhere'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ignores pointerdowns inside the surface and on the trigger', () => {
    render(createElement(Harness))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Done' }))
    // The trigger runs its own toggle on click; a close here would make that click re-open.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Customize' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('closes on Escape, refocuses the trigger and marks the event handled', () => {
    render(createElement(Harness))
    const trigger = screen.getByRole('button', { name: 'Customize' })
    // fireEvent returns false when a listener called preventDefault — the signal
    // DetailPanelProvider's own Escape handler yields to.
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(trigger)
  })

  it('leaves an Escape a nearer handler already claimed alone', () => {
    render(createElement(Harness))
    window.addEventListener('keydown', (event) => event.preventDefault(), { capture: true, once: true })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('listens only while open', () => {
    render(createElement(Harness, { initiallyOpen: false }))
    fireEvent.pointerDown(screen.getByText('elsewhere'))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})
```

Append the CSS pin to `src/components/surfaceGrammar.test.ts`:

```ts
describe('popover surface (2026-09-13 polish §11)', () => {
  it('is the one anchored popover box, shadowed from --shadow', () => {
    expect(PANELS).toContain(
      '.popover-surface { position: absolute; z-index: 20; padding: 0.9rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 12px 36px rgb(var(--shadow)); }',
    )
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/usePopoverDismiss.test.ts src/components/surfaceGrammar.test.ts`
Expected: FAIL — `Cannot find module './usePopoverDismiss'`; the popover pin fails.

- [ ] **Step 3: Write the hook**

Create `src/components/usePopoverDismiss.ts`:

```ts
import { useEffect, type RefObject } from 'react'

// One dismissal contract for every anchored popover (2026-09-13 polish §11 — the pattern
// ChartExportMenu hand-rolled): a pointerdown outside BOTH the surface and its trigger closes,
// Escape closes and hands focus back to the trigger, and nothing is listening while the popover is
// shut. Escape is caught in the CAPTURE phase on document: DetailPanelProvider's own Escape handler
// is a bubble-phase document listener registered long before any page popover mounts, and it yields
// only to an event that is already defaultPrevented — capture is what puts this handler in front of
// it regardless of mount order. The trigger is exempt from "outside" so a click on it while open
// runs the caller's own toggle once, instead of a close here and a re-open there.
export function usePopoverDismiss(
  open: boolean,
  onClose: () => void,
  triggerRef: RefObject<HTMLElement | null>,
  surfaceRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: Event) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (surfaceRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      onClose()
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, onClose, triggerRef, surfaceRef])
}
```

- [ ] **Step 4: Add the surface class**

In `src/components/panels.css`, directly after the `.chart-card .chart-selection-summary { … }`
rule added in Task 2, add:

```css
/* ── Popover surface (2026-09-13 polish §11) ───────────────────────── */
/* The one anchored popover box (Overview's Customize, Taxes' new-year form, the wizard's month
   actions), positioned by its caller's `position: relative` wrapper. z 20: over the dock (16),
   under toasts (30). Shadow ink from --shadow, so light gets a cool 14% instead of a black smudge;
   the entrance is the shared pop-in in the motion-grammar block. Dismissal is
   usePopoverDismiss's job, not this rule's. */
.popover-surface {
  position: absolute;
  z-index: 20;
  padding: 0.9rem 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 12px 36px rgb(var(--shadow));
}
```

- [ ] **Step 5: Run both files**

Run: `npx vitest run src/components/usePopoverDismiss.test.ts src/components/surfaceGrammar.test.ts`
Expected: PASS — `Test Files 2 passed`, 5 + N tests.

- [ ] **Step 6: Lint and commit**

Run: `npx eslint src/components/usePopoverDismiss.ts src/components/usePopoverDismiss.test.ts`
Expected: no output.

```bash
git add src/components/panels.css src/components/usePopoverDismiss.ts src/components/usePopoverDismiss.test.ts src/components/surfaceGrammar.test.ts
git commit -m "feat(shell): popover-surface class and usePopoverDismiss (outside pointerdown, Escape with focus return)"
```

---

## Task 7 — the `Disclosure` primitive (spec §2.6, §11)

**Files:**
- Create: `src/components/Disclosure.tsx`
- Create: `src/components/disclosure.css`
- Create: `src/components/Disclosure.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/Disclosure.test.tsx`. jsdom toggles a `<details>` when its `<summary>` is
clicked and dispatches `toggle` as a queued task (verified against jsdom 26 in this repo), so the
tests wait one macrotask after each click before reading the reported state:

```tsx
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Disclosure from './Disclosure'

afterEach(cleanup)

// No cached `details()` helper on purpose: the element is re-rendered between assertions and a
// held reference is the classic stale-node bug — every test queries the element afresh.
/** The `toggle` event is a queued task in jsdom and in browsers alike; let it land. */
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

describe('Disclosure', () => {
  it('renders a closed <details> with a chevron summary and a body wrapper', () => {
    render(<Disclosure summary="Employer match (advanced)"><p>body</p></Disclosure>)
    const el = document.querySelector('details.disclosure') as HTMLDetailsElement
    expect(el.open).toBe(false)
    const summary = el.querySelector('summary') as HTMLElement
    expect(summary.textContent).toBe('Employer match (advanced)')
    expect(summary.querySelector('svg.disclosure-chevron')?.getAttribute('aria-hidden')).toBe('true')
    expect(el.querySelector(':scope > .disclosure-body')?.textContent).toBe('body')
  })

  it('opens and closes on the summary (uncontrolled), reporting each toggle once', async () => {
    const onToggle = vi.fn()
    render(<Disclosure summary="Table" onToggle={onToggle}><p>rows</p></Disclosure>)
    const el = document.querySelector('details.disclosure') as HTMLDetailsElement
    fireEvent.click(screen.getByText('Table'))
    await settle()
    expect(el.open).toBe(true)
    expect(onToggle).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByText('Table'))
    await settle()
    expect(el.open).toBe(false)
    expect(onToggle).toHaveBeenLastCalledWith(false)
    expect(onToggle).toHaveBeenCalledTimes(2)
  })

  it('fires onOpen exactly once, on the first open only', async () => {
    const onOpen = vi.fn()
    render(<Disclosure summary="Review historical months" onOpen={onOpen}><p>list</p></Disclosure>)
    expect(onOpen).not.toHaveBeenCalled()
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(screen.getByText('Review historical months'))
      await settle()
    }
    expect((document.querySelector('details.disclosure') as HTMLDetailsElement).open).toBe(true)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('starts open with defaultOpen, counts that as the first open, and reports no toggle for it', async () => {
    const onOpen = vi.fn()
    const onToggle = vi.fn()
    render(<Disclosure summary="Table" defaultOpen onOpen={onOpen} onToggle={onToggle}><p>rows</p></Disclosure>)
    expect((document.querySelector('details.disclosure') as HTMLDetailsElement).open).toBe(true)
    expect(onOpen).toHaveBeenCalledTimes(1)
    // The mount's own attribute write fires a toggle event; it is not a user toggle.
    await settle()
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('controlled: the parent owns open and the summary only asks', async () => {
    function Parent() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <Disclosure summary="Calculation" open={open} onToggle={setOpen}><p>math</p></Disclosure>
          <button type="button" onClick={() => setOpen(false)}>Force closed</button>
        </>
      )
    }
    render(<Parent />)
    const el = document.querySelector('details.disclosure') as HTMLDetailsElement
    expect(el.open).toBe(false)
    fireEvent.click(screen.getByText('Calculation'))
    await settle()
    expect(el.open).toBe(true)
    fireEvent.click(screen.getByText('Force closed'))
    await settle()
    expect(el.open).toBe(false)
  })

  it('controlled: a parent that refuses keeps the details shut', async () => {
    const onToggle = vi.fn()
    render(<Disclosure summary="Calculation" open={false} onToggle={onToggle}><p>math</p></Disclosure>)
    fireEvent.click(screen.getByText('Calculation'))
    await settle()
    expect(onToggle).toHaveBeenCalledWith(true)
    expect((document.querySelector('details.disclosure') as HTMLDetailsElement).open).toBe(false)
  })

  it('passes id, name and className through to the details element', () => {
    render(<Disclosure summary="x" id="notes" name="taxes-notes" className="wide"><p>y</p></Disclosure>)
    const el = document.querySelector('details.disclosure') as HTMLDetailsElement
    expect(el.id).toBe('notes')
    expect(el.getAttribute('name')).toBe('taxes-notes')
    expect(el.className).toBe('disclosure wide')
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/components/Disclosure.test.tsx`
Expected: FAIL — `Cannot find module './Disclosure'`.

- [ ] **Step 3: Write the component**

Create `src/components/Disclosure.tsx`:

```tsx
import { ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode, SyntheticEvent } from 'react'
// panels.css first (it owns the body's pop-in and the summary's hover transition), then the
// primitive's own sheet on top — Segmented pins its import order the same way.
import './panels.css'
import './disclosure.css'

// THE disclosure (2026-09-13 polish §2.6, §11): one <details> grammar for every "show me more"
// that is neither a form nor a menu — ChartTable, a selection's calculation, the assistant's
// reasoning blocks, Paycheck's employer match, Taxes' methodology notes. A rotating chevron
// replaces the UA triangle, the summary reads as an eyebrow row with the house focus ring, and
// the body pops in (panels.css). Uncontrolled by default: the browser owns `open` and this
// component only reports it. Pass `open` to control it — the summary's activation is then
// cancelled and the parent decides. `onOpen` fires ONCE, on the first open (the cue for a lazy
// load behind a summary, like the wizard's history list), including a mount that starts open.
export default function Disclosure({
  summary,
  children,
  defaultOpen = false,
  open,
  onToggle,
  onOpen,
  className,
  id,
  name,
}: {
  summary: ReactNode
  children: ReactNode
  /** Uncontrolled initial state. Ignored when `open` is given. */
  defaultOpen?: boolean
  /** Controlled state — the parent flips it from `onToggle`. */
  open?: boolean
  onToggle?: (open: boolean) => void
  /** Fires once, on the first open. */
  onOpen?: () => void
  className?: string
  id?: string
  /** Native exclusive accordion: <details> sharing a name close each other. */
  name?: string
}) {
  const controlled = open !== undefined
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const isOpen = controlled ? open : uncontrolledOpen
  const openedRef = useRef(false)
  useEffect(() => {
    if (!isOpen || openedRef.current) return
    openedRef.current = true
    onOpen?.()
  }, [isOpen, onOpen])
  // The browser's own toggle (uncontrolled): read the new state off the element and report it.
  // Any programmatic change to `open` fires `toggle` too — React's mount write included, which is
  // what the equality guard swallows — and the controlled branch ignores the event outright: the
  // parent made the change, it already knows.
  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (controlled) return
    const next = event.currentTarget.open
    if (next === uncontrolledOpen) return
    setUncontrolledOpen(next)
    onToggle?.(next)
  }
  // Controlled: cancelling the summary's activation keeps the DOM's `open` equal to the prop; the
  // parent hears the request and re-renders — or does not, and the details stays as it was.
  const handleSummaryClick = (event: MouseEvent<HTMLElement>) => {
    if (!controlled) return
    event.preventDefault()
    onToggle?.(!open)
  }
  return (
    <details
      id={id}
      name={name}
      className={`disclosure${className === undefined ? '' : ` ${className}`}`}
      open={isOpen}
      onToggle={handleToggle}
    >
      <summary onClick={handleSummaryClick}>
        <ChevronRight size={14} aria-hidden="true" className="disclosure-chevron" />
        <span className="disclosure-summary">{summary}</span>
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  )
}
```

- [ ] **Step 4: Write the stylesheet**

Create `src/components/disclosure.css`:

```css
/* The Disclosure primitive (2026-09-13 polish §2.6). Imported by Disclosure.tsx after panels.css,
   which owns the body's pop-in and the summary's hover transition; this sheet is the look. */

/* The summary is an eyebrow-weight row, not a sentence with a triangle. `list-style: none` drops
   the UA marker (the -webkit pseudo below is Safari's copy); the negative margin lets the hover
   wash sit flush with the text column while the row stays aligned with its neighbours. */
.disclosure > summary {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 -0.5rem;
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  list-style: none;
  cursor: pointer;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
  user-select: none;
}

.disclosure > summary::-webkit-details-marker {
  display: none;
}

.disclosure > summary:hover {
  background: var(--fill);
  color: var(--text);
}

.disclosure > summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.disclosure-chevron {
  flex: none;
}

.disclosure[open] > summary .disclosure-chevron {
  transform: rotate(90deg);
}

.disclosure-body {
  padding-top: 0.6rem;
}

@media (prefers-reduced-motion: no-preference) {
  .disclosure-chevron {
    transition: transform var(--t-fast) var(--ease-out);
  }
}

/* Where the browser can interpolate to `auto`, the body's height glides too; elsewhere the pop-in
   alone says "revealed". content-visibility is discrete, so it needs allow-discrete to stay
   visible for the length of the closing glide. Tokens only, so `reduce` zeroes both. */
@supports (interpolate-size: allow-keywords) {
  .disclosure {
    interpolate-size: allow-keywords;
  }

  .disclosure::details-content {
    block-size: 0;
    overflow: clip;
    transition:
      block-size var(--t-fast) var(--ease-out),
      content-visibility var(--t-fast) allow-discrete;
  }

  .disclosure[open]::details-content {
    block-size: auto;
  }
}
```

- [ ] **Step 5: Run the tests, the motion sweep and lint**

Run: `npx vitest run src/components/Disclosure.test.tsx src/theme/motion.test.ts src/components/surfaceGrammar.test.ts`
Expected: PASS — `Test Files 3 passed`; the Disclosure file reports 7 tests.

Run: `npx eslint src/components/Disclosure.tsx src/components/Disclosure.test.tsx && npx tsc -b`
Expected: no output. (If `tsc` rejects `name` on `<details>`, the installed `@types/react` lacks
the attribute: spread it instead — `{...{ name }}` — and note it in the commit body.)

- [ ] **Step 6: Commit**

```bash
git add src/components/Disclosure.tsx src/components/disclosure.css src/components/Disclosure.test.tsx
git commit -m "feat(shell): Disclosure primitive — chevron summary, pop-in body, controlled/uncontrolled open, onOpen once"
```

---

## Task 8 — `StatTile` badge and the unbreakable label unit (spec §10)

**Files:**
- Modify: `src/components/StatTile.tsx`
- Modify: `src/components/StatTile.test.tsx`
- Modify: `src/components/panels.css` (after `.stat-label`)

- [ ] **Step 1: Write the failing tests**

Add to the imports of `src/components/StatTile.test.tsx`:

```tsx
import { readFileSync } from 'node:fs'
import path from 'node:path'
```

Append to the file:

```tsx
// The badge (2026-09-13 polish §10) is how Overview's and Spending's review state moves off the
// orphan hint line and onto the tile it describes; the nowrap unit is why the (i) can no longer
// wrap onto a line of its own.
describe('StatTile badge and label unit', () => {
  it('renders the badge as a pill after the label and keeps the label text queryable', () => {
    render(<StatTile label="Living spending" value="$4,932.87" badge="Not yet reviewed" hint="Cash outflow this month." />)
    const badge = document.querySelector('.stat-label .stat-badge')
    expect(badge?.textContent).toBe('Not yet reviewed')
    // Every page test that finds a tile by its label keeps working: the text is one node.
    expect(screen.getByText('Living spending')).toBeTruthy()
    // Text and (i) share one nowrap span, so the icon can never wrap alone.
    const unit = document.querySelector('.stat-label-text') as HTMLElement
    expect(unit.textContent).toBe('Living spending')
    expect(unit.querySelector('button.info-hint')).toBeTruthy()
    expect(unit.nextElementSibling).toBe(badge)
  })

  it('renders no badge node without the prop', () => {
    render(<StatTile label="Net worth" value="$1.00" />)
    expect(document.querySelector('.stat-badge')).toBeNull()
    expect(document.querySelector('.stat-label')?.textContent).toBe('Net worth')
  })

  it('pins the CSS: the unit is nowrap and the pill wears --fill at .7rem in the caller’s casing', () => {
    const css = readFileSync(path.join(__dirname, 'panels.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
    expect(css).toContain('.stat-label-text { white-space: nowrap; }')
    expect(css).toMatch(/\.stat-badge \{[^}]*background: var\(--fill\);[^}]*font-size: 0\.7rem;[^}]*text-transform: none;/)
  })
})
```

- [ ] **Step 2: Run to see the three fail**

Run: `npx vitest run src/components/StatTile.test.tsx`
Expected: FAIL — `.stat-badge` null, `.stat-label-text` null (TypeError on `unit.textContent`), the
CSS pin missing. The existing tests stay green.

- [ ] **Step 3: Add the prop and the span**

In `src/components/StatTile.tsx`, add `badge` to the props (after `evidence?: MetricEvidence`):

```tsx
  /** A small status pill after the label ("Not yet reviewed") — the review state that used to
   *  float under the tile row as an orphan line (2026-09-13 polish §10). */
  badge?: ReactNode
```

Add `badge,` to the destructured parameter list (after `evidence,`) and
`import type { ReactNode } from 'react'` to the imports. Replace the `.stat-label` div with:

```tsx
      <div className="stat-label">
        {/* One nowrap unit for the words and their (i): an atomic inline may break before it,
            and the icon kept landing alone on a second line (audit P-11). The badge stays
            outside the unit so IT may wrap under the label when the tile is narrow. */}
        <span className="stat-label-text">
          {label}
          {hint !== undefined && evidence === undefined && <InfoHint text={hint} />}
          {evidence !== undefined && <MetricInfoButton evidence={evidence} />}
        </span>
        {badge !== undefined && <span className="stat-badge">{badge}</span>}
      </div>
```

- [ ] **Step 4: Add the CSS**

In `src/components/panels.css`, directly after the `.stat-label { … }` rule add:

```css
/* Label text and its (i) travel as one unbreakable unit (2026-09-13 polish §10). The one label
   known to overflow five 217px columns ("Reach FI target within N years") is shortened by lane P4;
   every other label fits its tile at the 220px floor. */
.stat-label-text {
  white-space: nowrap;
}

/* A small status pill after the label, in the caller's own casing — a state, not an eyebrow. */
.stat-badge {
  display: inline-block;
  margin-left: 0.5rem;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  background: var(--fill);
  color: var(--muted);
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: normal;
  text-transform: none;
  vertical-align: middle;
  white-space: nowrap;
}
```

- [ ] **Step 5: Run StatTile plus the page suites that read tile labels**

Run: `npx vitest run src/components/StatTile.test.tsx src/pages/OverviewPage.test.tsx src/pages/NetWorthPage.test.tsx src/pages/SpendingPage.test.tsx`
Expected: PASS — `Test Files 4 passed`. (A page assertion that reads `getByText(label).nextElementSibling`
expecting `.stat-value` would now see `null`; if one appears, change its selector to
`closest('.stat-tile')!.querySelector('.stat-value')` — update, never delete.)

- [ ] **Step 6: Commit**

```bash
git add src/components/StatTile.tsx src/components/StatTile.test.tsx src/components/panels.css
git commit -m "feat(shell): StatTile badge pill and a nowrap label unit so the (i) never wraps alone"
```

---

## Task 9 — delta-less ghost tiles (spec §9)

**Files:**
- Modify: `src/components/PageSkeleton.tsx`
- Modify: `src/components/PageSkeleton.test.tsx`
- Modify: `src/components/panels.css` (the `.page-skeleton, .loading-fallback` block and after `.skeleton-tile`)
- Modify: `src/components/shell/PageFrame.test.tsx` (one plumbing test)

- [ ] **Step 1: Write the failing tests**

Append to the `describe('ghost parity (motion spec §7)', …)` block in `src/components/PageSkeleton.test.tsx`:

```tsx
  it('draws a delta-less ghost on request, at the shorter box a delta-less tile occupies', () => {
    // Credit cards' and Portfolio's tiles carry no delta line (2026-09-13 polish §9): a
    // three-block ghost under them stood 22px taller than the row that replaced it.
    render(<GhostTile delta={false} />)
    const tile = document.querySelector('.stat-tile.skeleton-tile') as HTMLElement
    expect(tile.querySelectorAll('.skeleton').length).toBe(2) // label, value
    expect(tile.className).toContain('skeleton-tile-bare')
    const css = readFileSync(path.join(__dirname, 'panels.css'), 'utf8').replace(/\s+/g, ' ')
    expect(css).toContain('--m-stat-tile-bare: 93px;')
    expect(css).toContain('.skeleton-tile-bare { min-height: var(--m-stat-tile-bare); }')
  })

  it('accepts a tiles object so a page can ghost a delta-less row, and a count still draws the full tile', () => {
    render(<PageSkeleton tiles={{ count: 4, delta: false }} />)
    expect(document.querySelectorAll('.kpi-row .skeleton-tile-bare').length).toBe(4)
    expect(document.querySelectorAll('.skeleton-delta').length).toBe(0)
    cleanup()
    render(<PageSkeleton tiles={{ count: 2 }} />)
    expect(document.querySelectorAll('.skeleton-delta').length).toBe(2)
    expect(document.querySelector('.skeleton-tile-bare')).toBeNull()
    cleanup()
    render(<PageSkeleton tiles={3} />)
    expect(document.querySelectorAll('.skeleton-delta').length).toBe(3)
  })
```

Append to `describe('PageFrame', …)` in `src/components/shell/PageFrame.test.tsx`:

```tsx
  it('forwards a tiles object to the skeleton, so a page can reserve a delta-less row', () => {
    render(
      <PageFrame title="Credit cards" resource={{ status: 'loading' }} skeleton={{ tiles: { count: 4, delta: false } }}>
        <p>body</p>
      </PageFrame>,
    )
    expect(document.querySelectorAll('.stat-tile.skeleton-tile-bare')).toHaveLength(4)
    expect(document.querySelector('.skeleton-delta')).toBeNull()
  })
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/PageSkeleton.test.tsx src/components/shell/PageFrame.test.tsx`
Expected: FAIL — type errors on `delta`/the object form, `skeleton-tile-bare` missing.

- [ ] **Step 3: Implement**

In `src/components/PageSkeleton.tsx`, change the default export's signature and tile loop:

```tsx
export default function PageSkeleton({
  tiles = 0,
  cards = [],
  strip = false,
}: {
  /** Tile ghosts. A number draws the full tile (label, value, delta line); `{ count, delta: false }`
   *  draws the shorter delta-less tile for rows whose real tiles carry no delta. */
  tiles?: number | { count: number; delta?: boolean }
  cards?: { span: 4 | 6 | 8 | 12; height?: number }[]
  /** Net worth's per-owner strip under the tiles — ghosted, or the tiles jump when it lands. */
  strip?: boolean
}) {
  const tileSpec =
    typeof tiles === 'number' ? { count: tiles, delta: true } : { count: tiles.count, delta: tiles.delta ?? true }
  return (
    <div className="page-skeleton loading-fallback">
      <p className="visually-hidden" role="status">
        Loading…
      </p>
      {tileSpec.count > 0 && (
        <div className="kpi-row" aria-hidden="true">
          {Array.from({ length: tileSpec.count }, (_, i) => (
            <GhostTile key={i} delta={tileSpec.delta} />
          ))}
        </div>
      )}
```

(the `strip` and `cards` blocks below stay exactly as they are). Replace `GhostTile` with:

```tsx
export function GhostTile({ delta = true }: { delta?: boolean }) {
  return (
    // aria-hidden on the TILE, not only on the row above it: in a mixed row (the ESPP strip)
    // its neighbours are real tiles that must stay readable, so there is no hidden container.
    // `delta: false` is the delta-less tile's twin (2026-09-13 polish §9): two blocks, and the
    // shorter --m-stat-tile-bare box, so the row is the same height before and after data lands.
    <div className={`stat-tile skeleton-tile${delta ? '' : ' skeleton-tile-bare'}`} aria-hidden="true">
      <div className="skeleton skeleton-label" />
      <div className="skeleton skeleton-value" />
      {delta && <div className="skeleton skeleton-delta" />}
    </div>
  )
}
```

- [ ] **Step 4: The CSS twin**

In `src/components/panels.css`, change the `.page-skeleton, .loading-fallback` block to:

```css
.page-skeleton,
.loading-fallback {
  --m-stat-tile: 115px;
  /* The delta-less tile (2026-09-13 polish §9): 115 minus the .stat-delta line — 0.8rem type at
     the system-ui line height (≈17px) plus its 0.35rem top margin (5.6px) — rounded like every
     twin here. Lane V's CLS smoke on Credit cards and Portfolio is the check on the number. */
  --m-stat-tile-bare: 93px;
  --m-owner-strip: 41px;
}
```

and directly after `.skeleton-tile { min-height: var(--m-stat-tile); }` add:

```css
.skeleton-tile-bare {
  min-height: var(--m-stat-tile-bare);
}
```

- [ ] **Step 5: Run the affected suites**

Run: `npx vitest run src/components/PageSkeleton.test.tsx src/components/shell/PageFrame.test.tsx src/components/skeletonMetrics.test.ts`
Expected: PASS — `Test Files 3 passed` (the `--m-stat-tile: 115px;` prefix pin still matches
because the new variable comes after it).

- [ ] **Step 6: Commit**

```bash
git add src/components/PageSkeleton.tsx src/components/PageSkeleton.test.tsx src/components/panels.css src/components/shell/PageFrame.test.tsx
git commit -m "feat(shell): delta-less ghost tiles — GhostTile delta prop and PageSkeleton tiles as { count, delta }"
```

---

## Task 10 — `tagStagger`, the page's `mountedAt`, and the Feed cascade (spec §2.5)

**Files:**
- Modify: `src/components/useStagger.ts`, `src/components/useStagger.test.tsx`
- Modify: `src/components/shell/PageFrame.tsx`, `src/components/shell/PageFrame.test.tsx`
- Modify: `src/components/shell/Feed.tsx`, `src/components/shell/Feed.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/components/useStagger.test.tsx` (it already stubs `getBoundingClientRect` from
`data-top` and imports `useStagger`; add `tagStagger` to that import):

```tsx
it('exports the loop as tagStagger: starts at the given index, skips hidden groups, returns the next index', () => {
  render(
    <div data-testid="root">
      <div className="card" data-top="10" data-name="a" />
      <div hidden>
        <div className="card" data-top="0" data-name="hidden" />
      </div>
      <div className="card" data-top="20" data-name="b" />
      <div className="card" data-top="2000" data-name="below" />
    </div>,
  )
  // A hidden view's card measures 0×0 at the top of the viewport; tagging it would replay the
  // entrance the moment the view is shown (spec §2.4: no per-card cascade on a tab switch).
  const next = tagStagger(document.querySelector('[data-testid="root"]') as HTMLElement, 2)
  expect(tagged()).toEqual(['a:2', 'b:3'])
  expect(next).toBe(4)
})

it('the hook and the helper agree: a hidden wrapper at arrival is left untagged by useStagger too', () => {
  function Hidden() {
    const ref = useStagger<HTMLDivElement>(true)
    return (
      <div ref={ref}>
        <div className="card" data-top="0" data-name="shown" />
        <div hidden>
          <div className="card" data-top="0" data-name="hidden" />
        </div>
      </div>
    )
  }
  render(<Hidden />)
  expect(tagged()).toEqual(['shown:0'])
})
```

Change the `CacheProbe` in `src/components/shell/PageFrame.test.tsx` and add one test:

```tsx
function CacheProbe() {
  const { fromCache, mountedAt } = usePageFrame()
  return (
    <>
      <span data-testid="cache">{String(fromCache)}</span>
      <span data-testid="mounted">{String(mountedAt)}</span>
    </>
  )
}
```

```tsx
  it('records performance.now() at mount in its context; outside a frame it is -Infinity', () => {
    vi.spyOn(performance, 'now').mockReturnValue(4321)
    render(
      <PageFrame title="Comp" resource={{ status: 'ready' }}>
        <CacheProbe />
      </PageFrame>,
    )
    expect(screen.getByTestId('mounted').textContent).toBe('4321')
    cleanup()
    render(<CacheProbe />)
    expect(screen.getByTestId('mounted').textContent).toBe('-Infinity')
  })
```

Append to `src/components/shell/Feed.test.tsx` (add `import PageFrame from './PageFrame'` and
`import { CASCADE_WINDOW_MS } from '../useStagger'` to its imports):

```tsx
// The card cascade on feed-driven pages (2026-09-13 polish §2.5). PageFrame tags its body at
// `ready`, which on Comp/ESPP/Paycheck/Taxes is the MOUNT — before any feed has answered — so the
// only thing it ever tagged was the ghost. The first payload now tags its own cards, once, and
// only inside the page's arrival window.
describe('Feed card cascade (polish §2.5)', () => {
  const props = { busy: false, staleNoun: 'the table', skeleton: { height: 200, label: 'Loading rows…' } }
  const cards = () => (
    <div>
      <section className="card">a</section>
      <section className="card">b</section>
    </div>
  )
  const frame = (feed: React.ReactNode) => (
    <PageFrame title="Comp" resource={{ status: 'ready' }}>{feed}</PageFrame>
  )
  const staggers = () =>
    Array.from(document.querySelectorAll<HTMLElement>('.xfade .card')).map((el) => el.dataset.stagger)
  afterEach(() => { vi.restoreAllMocks() })

  it('tags the first payload’s cards when it lands inside the arrival window', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    const { rerender } = render(frame(<Feed {...props} data={null} busy>{cards}</Feed>))
    now.mockReturnValue(1000 + CASCADE_WINDOW_MS - 1)
    rerender(frame(<Feed {...props} data={{ n: 1 }}>{cards}</Feed>))
    expect(staggers()).toEqual(['0', '1'])
  })

  it('leaves a late payload untagged — a revisit or a refetch is not an entrance', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    const { rerender } = render(frame(<Feed {...props} data={null} busy>{cards}</Feed>))
    now.mockReturnValue(1000 + CASCADE_WINDOW_MS)
    rerender(frame(<Feed {...props} data={{ n: 1 }}>{cards}</Feed>))
    expect(staggers()).toEqual([undefined, undefined])
  })

  it('tags once per Feed: a second payload inside the window never re-runs the cascade', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    const { rerender } = render(frame(<Feed {...props} data={null} busy>{cards}</Feed>))
    rerender(frame(<Feed {...props} data={{ n: 1 }}>{cards}</Feed>))
    expect(staggers()).toEqual(['0', '1'])
    rerender(frame(<Feed {...props} data={null} busy>{cards}</Feed>)) // a scope change…
    rerender(frame(<Feed {...props} data={{ n: 2 }}>{cards}</Feed>)) // …and its fresh cards
    expect(staggers()).toEqual([undefined, undefined])
  })

  it('skips cards inside a hidden view, and never tags outside a PageFrame', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    const mixed = () => (
      <div>
        <section className="card">shown</section>
        <div hidden><section className="card">hidden</section></div>
      </div>
    )
    const { rerender } = render(frame(<Feed {...props} data={null} busy>{mixed}</Feed>))
    rerender(frame(<Feed {...props} data={{ n: 1 }}>{mixed}</Feed>))
    expect((document.querySelector('.xfade .card') as HTMLElement).dataset.stagger).toBe('0')
    expect(document.querySelector('.xfade [hidden] .card[data-stagger]')).toBeNull()
    cleanup()
    const bare = render(<Feed {...props} data={null} busy>{cards}</Feed>)
    bare.rerender(<Feed {...props} data={{ n: 1 }}>{cards}</Feed>)
    expect(document.querySelectorAll('.card[data-stagger]').length).toBe(0)
  })
})
```

(`React.ReactNode` needs `import type React from 'react'` — or type `feed` as `ReactNode` from
`'react'`; either is fine.)

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/useStagger.test.tsx src/components/shell/PageFrame.test.tsx src/components/shell/Feed.test.tsx`
Expected: FAIL — `tagStagger` is not exported, `mountedAt` is undefined, `CASCADE_WINDOW_MS` is
not exported, the cascade tests see no `data-stagger`.

- [ ] **Step 3: `useStagger.ts` — export the loop**

Replace the whole file with:

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

/** How long after a page mounts a Feed's first payload may still join the cascade (2026-09-13
 *  polish §2.5). A later landing — a revisit, a tab switch, a refetch — arrives on a page the
 *  reader is already reading, and a cascade there is a flicker, not an entrance. */
export const CASCADE_WINDOW_MS = 3000

/** Tags every top-level group under `root` that starts inside the viewport with its cascade
 *  index (from `startIndex`, clamped to STAGGER_CAP) and returns the next free index. Groups
 *  under a `[hidden]` ancestor — a lazily mounted view's panel, Paycheck's hidden view wrappers —
 *  are skipped: they measure 0×0 at the top of the viewport, and a tag there would replay the
 *  entrance the moment the view is shown (spec §2.4: no per-card cascade on a tab switch). */
export function tagStagger(root: HTMLElement, startIndex = 0): number {
  const groups = Array.from(root.querySelectorAll<HTMLElement>(GROUPS))
  let index = startIndex
  for (const el of groups) {
    if (groups.some((other) => other !== el && other.contains(el))) continue
    if (el.closest('[hidden]') !== null) continue
    // `>=`, so a card straddling the bottom edge still counts as visible: it rises in
    // with the cascade instead of snapping when the reveal picks it up.
    if (el.getBoundingClientRect().top >= window.innerHeight) continue
    el.dataset.stagger = String(Math.min(index, STAGGER_CAP))
    index += 1
  }
  return index
}

export function useStagger<T extends HTMLElement>(ready: boolean): RefObject<T | null> {
  const ref = useRef<T>(null)
  // One cascade per page mount: `ready` re-renders on every revalidation, and re-tagging
  // would restart the animation with the reader's eye already on the numbers.
  const taggedRef = useRef(false)
  useLayoutEffect(() => {
    const root = ref.current
    if (!ready || root === null || taggedRef.current) return
    taggedRef.current = true
    tagStagger(root)
  }, [ready])
  return ref
}
```

- [ ] **Step 4: `PageFrame.tsx` — `mountedAt` in the context**

In `src/components/shell/PageFrame.tsx`:

```ts
interface PageFrameContextValue {
  fromCache: boolean
  /** performance.now() at the frame's first render. Feed gates its card cascade on it (2026-09-13
   *  polish §2.5): a payload landing within CASCADE_WINDOW_MS of this is the page's arrival, a
   *  later one is a revisit. -Infinity outside a frame, so nothing ever cascades there. */
  mountedAt: number
}

const PageFrameContext = createContext<PageFrameContextValue>({
  fromCache: false,
  mountedAt: Number.NEGATIVE_INFINITY,
})
```

Inside the component, next to the other hooks (before `const context = useMemo(…)`):

```ts
  // Fixed at mount through a lazy initializer: a bare performance.now() in render is impure (the
  // react-hooks purity rule rejects it as a useRef argument), and a ref written from an effect
  // could not be read into the context value without a render-time ref read.
  const [mountedAt] = useState(() => performance.now())
```

and change the memo to:

```ts
  const context = useMemo(
    () => ({ fromCache: resource.fromCache === true, mountedAt }),
    [resource.fromCache, mountedAt],
  )
```

- [ ] **Step 5: `Feed.tsx` — tag the first payload**

In `src/components/shell/Feed.tsx`, change the imports:

```ts
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { SkeletonCard } from '../PageSkeleton'
import { XFADE_MS } from '../skeletonMetrics'
import { useReducedMotion } from '../useReducedMotion'
import { CASCADE_WINDOW_MS, tagStagger } from '../useStagger'
import { usePageFrame } from './PageFrame'
import '../panels.css'
```

Inside `Feed`, after the `fading` effect (`useEffect(() => { if (!fading) return … }, [fading])`), add:

```tsx
  // The card cascade for a feed-driven page (2026-09-13 polish §2.5). PageFrame tags its body at
  // `ready`, which on Comp/ESPP/Paycheck/Taxes is the mount — before any feed has answered — so
  // the only thing it ever tagged here was the ghost. The first payload tags its own cards
  // instead, once per Feed mount, and only inside the page's arrival window: a payload landing
  // later (a revisit, a tab switch, a refetch) joins a page the reader is already reading. A
  // LAYOUT effect, like useStagger: the tag has to be on the card before its first paint. The
  // root is the .xfade wrapper below, which exists exactly when there is content to tag.
  const { mountedAt } = usePageFrame()
  const rootRef = useRef<HTMLDivElement>(null)
  const taggedRef = useRef(false)
  useLayoutEffect(() => {
    if (data === null || taggedRef.current) return
    taggedRef.current = true
    const root = rootRef.current
    if (root === null || performance.now() - mountedAt >= CASCADE_WINDOW_MS) return
    tagStagger(root)
  }, [data, mountedAt])
```

and give the wrapper the ref:

```tsx
        <div ref={rootRef} className={`xfade${fading ? ' is-fading' : ''}`}>
```

- [ ] **Step 6: Run the three files, then lint**

Run: `npx vitest run src/components/useStagger.test.tsx src/components/shell/PageFrame.test.tsx src/components/shell/Feed.test.tsx`
Expected: PASS — `Test Files 3 passed`.

Run: `npx eslint src/components/useStagger.ts src/components/shell/Feed.tsx src/components/shell/PageFrame.tsx`
Expected: no errors (the pre-existing `react-refresh/only-export-components` warning on
PageFrame.tsx, which exports `usePageFrame` beside the component, is part of the 24-warning
baseline and stays).

- [ ] **Step 7: Commit**

```bash
git add src/components/useStagger.ts src/components/useStagger.test.tsx src/components/shell/PageFrame.tsx src/components/shell/PageFrame.test.tsx src/components/shell/Feed.tsx src/components/shell/Feed.test.tsx
git commit -m "feat(motion): tagStagger export, PageFrame mountedAt, Feed cascades its first payload inside the arrival window"
```

---

## Task 11 — `PageFrame` `sections` slot inside the sticky block (spec §3)

**Files:**
- Modify: `src/components/shell/PageFrame.tsx`
- Modify: `src/components/shell/PageFrame.test.tsx`
- Modify: `src/components/shell/shell.css` (the PageFrame section)
- Modify: `src/components/skeletonMetrics.test.ts` (the `:empty` pin moves — updated, not deleted)
- Modify: `src/components/surfaceGrammar.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `describe('PageFrame', …)` in `src/components/shell/PageFrame.test.tsx`:

```tsx
  // One sticky place for the view switcher (2026-09-13 polish §3): the strip renders INSIDE the
  // element the sentinel, the is-stuck hairline and the --sticky-inset measurement already
  // describe, as its first row, so every reveal timeline and InfoHint flip keeps working.
  it('renders the sections slot inside the sticky block, ahead of the scope row', () => {
    render(
      <PageFrame
        title="Net worth"
        sections={<nav aria-label="Net worth views">tabs</nav>}
        scopeRow={<span>scope</span>}
        resource={{ status: 'ready' }}
      >
        <p>body</p>
      </PageFrame>,
    )
    const block = document.querySelector('.page-frame-scope') as HTMLElement
    expect(block.children).toHaveLength(2)
    expect(block.children[0].className).toBe('page-frame-sections')
    expect(block.children[0].textContent).toBe('tabs')
    expect(block.children[1].className).toBe('page-frame-scope-row')
    expect(block.children[1].textContent).toBe('scope')
    expect(document.querySelector('.page-frame-sentinel')).toBeTruthy()
    // Still outside the animated content region.
    expect(document.querySelector('.page-frame-body .page-frame-scope')).toBeNull()
  })

  it('a page with only a sections strip still gets the sticky block, its sentinel and its inset', () => {
    let notify: (() => void) | null = null
    vi.stubGlobal(
      'ResizeObserver',
      vi.fn((cb: () => void) => ({ observe: () => { notify = cb }, disconnect: () => {}, unobserve: () => {} })),
    )
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('page-frame-scope') ? 43 : 0
    })
    render(
      <PageFrame title="Taxes" sections={<nav>tabs</nav>} resource={{ status: 'ready' }}>
        <p>body</p>
      </PageFrame>,
    )
    expect(document.querySelector('.page-frame-scope > .page-frame-sections')).toBeTruthy()
    expect(document.querySelector('.page-frame-scope-row')).toBeNull()
    expect(document.querySelector('.page-frame-sentinel')).toBeTruthy()
    expect(document.querySelector<HTMLElement>('.page-frame-body')?.style.getPropertyValue('--sticky-inset')).toBe('43px')
    expect(notify).not.toBeNull()
  })

  it('the sections strip is sticky-tracked like the scope row: is-stuck follows the sentinel', () => {
    render(
      <PageFrame title="Taxes" sections={<nav>tabs</nav>} resource={{ status: 'ready' }}>
        <p>body</p>
      </PageFrame>,
    )
    const block = document.querySelector('.page-frame-scope') as HTMLElement
    act(() => observers.forEach((cb) => cb([{ isIntersecting: false }])))
    expect(block.classList.contains('is-stuck')).toBe(true)
  })
```

In `src/components/skeletonMetrics.test.ts`, replace the line
`expect(flat(SHELL)).toContain('.page-frame-scope:empty { display: none; }')` with:

```ts
    // The row is wrapped now (2026-09-13 polish §3: the sections strip shares the sticky block),
    // so `:empty` is tested on the row and the block hides when no child has anything in it.
    expect(flat(SHELL)).toContain('.page-frame-scope-row:empty { display: none; }')
    expect(flat(SHELL)).toContain('.page-frame-scope:not(:has(> :not(:empty))) { display: none; }')
```

Append to `src/components/surfaceGrammar.test.ts`:

```ts
describe('sticky sections block (2026-09-13 polish §3)', () => {
  it('stacks the strip over the scope row and gives the strip the row’s old rule', () => {
    expect(SHELL).toMatch(/\.page-frame-scope \{[^}]*flex-direction: column;/)
    expect(SHELL).toContain('.page-frame-sections { border-bottom: 1px solid var(--border); }')
    expect(SHELL).toContain('.page-frame-sections .local-section-nav { margin: 0; border-bottom: 0; }')
    expect(SHELL).toContain(
      '.page-frame-scope-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem 1.25rem; padding: 0.6rem 0; }',
    )
    // A strip-only block would otherwise draw two hairlines 1px apart once stuck.
    expect(SHELL).toContain('.page-frame-scope.is-stuck:has(> .page-frame-sections:last-child) { border-bottom-color: transparent; }')
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/shell/PageFrame.test.tsx src/components/skeletonMetrics.test.ts src/components/surfaceGrammar.test.ts`
Expected: FAIL — `sections` is not a prop (TS), the `.page-frame-sections` selectors are missing,
the two moved pins fail.

- [ ] **Step 3: `PageFrame.tsx` — the slot**

Add the prop (after `scopeRow?: ReactNode`):

```ts
  /** The page's view switcher (a LocalSectionNav), rendered INSIDE the sticky block as its first
   *  row — strip first (which view), scope row second (for which period/owner). One placement
   *  for all ten tabbed pages (2026-09-13 polish §3). */
  sections?: ReactNode
```

Add `sections,` to the destructured parameters. Replace
`const hasScopeRow = scopeRow !== undefined` and its comment with:

```ts
  // Inline JSX is a new object on every parent render; keying the effects on mere presence
  // avoids a disconnect/observe cycle per render. Either slot makes the sticky block exist.
  const hasScopeBlock = sections !== undefined || scopeRow !== undefined
```

Replace every `hasScopeRow` with `hasScopeBlock` (the IntersectionObserver effect's guard and
dependency list, and the `--sticky-inset` effect's dependency list). Replace the sticky block
markup with:

```tsx
      {hasScopeBlock && (
        <>
          <div ref={sentinelRef} className="page-frame-sentinel" aria-hidden="true" />
          {/* The sentinel, the is-stuck hairline and the --sticky-inset measurement all describe
              THIS element, so the strip lives inside it (2026-09-13 polish §3) and every reveal
              timeline, scrim and InfoHint flip keeps measuring the right box. */}
          <div ref={scopeRef} className={`page-frame-scope${stuck ? ' is-stuck' : ''}`}>
            {sections !== undefined && <div className="page-frame-sections">{sections}</div>}
            {scopeRow !== undefined && <div className="page-frame-scope-row">{scopeRow}</div>}
          </div>
        </>
      )}
```

Update the header comment's last line (`// The scope row is sticky; …`) to:
`// The sticky block (view strip over the scope row) pins; the hairline appears only while it is stuck.`

- [ ] **Step 4: `shell.css` — the two-row block**

Replace the `.page-frame-scope { … }`, `.page-frame-scope:empty { … }` and
`.page-frame-scope.is-stuck { … }` rules (and the long `:empty` comment above them) with:

```css
.page-frame-scope {
  position: sticky;
  top: 0;
  z-index: 8;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  margin: 0 0 1rem;
  background: var(--bg);
  border-bottom: 1px solid transparent;
}

/* Row one: the view strip (2026-09-13 polish §3). It spans the content width — Settings' strip
   was 423px wide because the nav's own border ended with its tabs — and the divider is the row's,
   not the nav's, so the nav drops its margin and border inside here. */
.page-frame-sections {
  border-bottom: 1px solid var(--border);
}

.page-frame-sections .local-section-nav {
  margin: 0;
  border-bottom: 0;
}

/* Row two: the scope controls, laid out exactly as the block itself used to be. */
.page-frame-scope-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1.25rem;
  padding: 0.6rem 0;
}

/* A declared scope row can still render nothing (a one-person household hides the owner control
   and the page declared no other control): an empty sticky row must not take space or draw its
   hairline. `:empty` matches because ScopeBar returns null, leaving no DOM nodes in the row.
   While the household is still UNKNOWN the row is NOT empty — ScopeBar stands a ghost of the
   row's own height in it (panels.css, --m-scope-row) — so this only ever hides a row with
   nothing coming. The block follows: with no strip and an empty row, the whole thing goes, so a
   page with nothing to pin reserves no 1rem margin. No min-height anywhere: the reservation
   belongs to the ghost, or every page that declares a scope row would stand 50px empty. */
.page-frame-scope-row:empty {
  display: none;
}

.page-frame-scope:not(:has(> :not(:empty))) {
  display: none;
}

.page-frame-scope.is-stuck {
  border-bottom-color: var(--border);
}

/* A strip-only block (Taxes, Comp, ESPP, Projection) already ends in the strip's own hairline;
   the stuck hairline directly under it would read as a 2px rule. */
.page-frame-scope.is-stuck:has(> .page-frame-sections:last-child) {
  border-bottom-color: transparent;
}
```

Keep `.page-frame-scope .eyebrow { margin: 0; }` as it is (a descendant rule; it still reaches
eyebrows inside the row).

- [ ] **Step 5: Run the shell, calendar and wizard suites that touch the block**

Run: `npx vitest run src/components/shell src/components/skeletonMetrics.test.ts src/components/surfaceGrammar.test.ts src/components/InfoHint.test.tsx src/pages/MonthlyUpdatePage.test.tsx src/pages/CalendarPage.test.tsx src/pages/SettingsPage.test.tsx src/pages/CreditCardsPage.test.tsx`
Expected: PASS. (`MonthlyUpdatePage.test.tsx` queries `.page-frame-scope .ribbon` and
`SettingsPage.test.tsx` queries `within(.page-frame-scope)` for the tablist — both are descendant
lookups and keep passing; `CalendarPage.css`'s `.page-frame-scope .cal-controls { flex: 1 }` still
lands inside the flex row.)

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/PageFrame.tsx src/components/shell/PageFrame.test.tsx src/components/shell/shell.css src/components/skeletonMetrics.test.ts src/components/surfaceGrammar.test.ts
git commit -m "feat(shell): PageFrame sections slot — the view strip rides inside the sticky block above the scope row"
```

---

## Task 12 — `LocalSectionNav`: sliding indicator, `trailing`, keyboard `replace` (spec §2.4, §3)

**Files:**
- Modify: `src/components/shell/LocalSections.tsx` (the `LocalSectionNav` function only)
- Modify: `src/components/shell/localSections.css`
- Modify: `src/components/shell/LocalSections.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/components/shell/LocalSections.test.tsx` (add `act` and `vi` to the existing
Testing Library / vitest imports, and `Segmented from './Segmented'` is NOT needed — a plain
element stands in for the trailing control):

```tsx
describe('LocalSectionNav indicator, trailing slot and history (2026-09-13 polish §2.4, §3)', () => {
  // jsdom lays nothing out: each tab reports its index × 100 as offsetLeft and 80 as offsetWidth,
  // so the indicator's travel is a number the test can predict.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('role') !== 'tab') return 0
      return Array.from(this.parentElement?.querySelectorAll('[role="tab"]') ?? []).indexOf(this) * 100
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'tab' ? 80 : 0
    })
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('places the indicator under the selected tab instantly, then transitions later moves', () => {
    render(<MemoryRouter><Harness /></MemoryRouter>)
    const bar = document.querySelector('.local-section-nav [role="tablist"] > .local-section-indicator') as HTMLElement
    expect(bar.getAttribute('aria-hidden')).toBe('true')
    expect(bar.style.width).toBe('80px')
    expect(bar.style.transform).toBe('translate(0px, 0px)')
    // First placement is where the bar LIVES, not a move: no transition attribute yet.
    expect(bar.hasAttribute('data-placed')).toBe(false)
    fireEvent.click(screen.getByRole('tab', { name: 'Inputs' }))
    expect(bar.style.transform).toBe('translate(100px, 0px)')
    expect(bar.hasAttribute('data-placed')).toBe(true)
  })

  it('renders a trailing control on the strip’s own line, only when one is given', () => {
    const { rerender } = render(<MemoryRouter><Trailing trailing={<button type="button">Quarterly</button>} /></MemoryRouter>)
    const nav = screen.getByRole('navigation', { name: 'Page views' })
    expect(nav.querySelector(':scope > .local-section-trailing')?.textContent).toBe('Quarterly')
    expect(nav.children[0].getAttribute('role')).toBe('tablist')
    rerender(<MemoryRouter><Trailing /></MemoryRouter>)
    expect(document.querySelector('.local-section-trailing')).toBeNull()
  })

  it('keyboard activation replaces the history entry; a click pushes one', async () => {
    render(<MemoryRouter initialEntries={['/elsewhere', '/taxes']} initialIndex={1}><Harness /></MemoryRouter>)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Summary' }), { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Inputs' }).getAttribute('aria-selected')).toBe('true')
    // Back leaves /taxes entirely: the arrow sweep left no entry of its own.
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    await waitFor(() => expect(screen.getByTestId('pathname').textContent).toBe('/elsewhere'))
    cleanup()
    render(<MemoryRouter initialEntries={['/elsewhere', '/taxes']} initialIndex={1}><Harness /></MemoryRouter>)
    fireEvent.click(screen.getByRole('tab', { name: 'Inputs' }))
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    // Back returns to /taxes on Summary: the click was its own entry.
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Summary' }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByTestId('pathname').textContent).toBe('/taxes')
  })

  it('hands onChange the activation options, so a page can add its own params', () => {
    const onChange = vi.fn()
    render(<MemoryRouter><Trailing onChange={onChange} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('tab', { name: 'Inputs' }))
    expect(onChange).toHaveBeenLastCalledWith('inputs', undefined)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Summary' }), { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith('inputs', { replace: true })
  })
})
```

Add a `data-testid="pathname"` output and a second harness. In `Harness`, change the
`<output>{location.search}</output>` line to
`<output>{location.search}</output><span data-testid="pathname">{location.pathname}</span>` and add
below `Harness`:

```tsx
function Trailing({ trailing, onChange }: { trailing?: React.ReactNode; onChange?: (section: 'summary' | 'inputs', options?: { replace?: boolean }) => void }) {
  const state = useLocalSections(SECTIONS, 'summary')
  return <LocalSectionNav state={state} label="Page views" trailing={trailing} onChange={onChange} />
}
```

(with `import type React from 'react'` — or import `ReactNode` and use it.)

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/shell/LocalSections.test.tsx`
Expected: FAIL — `trailing` is not a prop, no `.local-section-indicator`, `onChange` receives one
argument, the keyboard path pushes (Back lands on `/taxes`).

- [ ] **Step 3: Rewrite `LocalSectionNav`**

In `src/components/shell/LocalSections.tsx`, change the React import to
`import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'` and
replace the whole `LocalSectionNav` function with:

```tsx
/** What the strip tells `onChange` about HOW a view was picked: a keyboard sweep replaces the
 *  history entry, a click pushes one (2026-09-13 polish §2.4 — five arrow presses used to leave
 *  five entries). Pages that add their own params spread it into `setSection`'s options. */
export type LocalSectionChangeOptions = { replace?: boolean }

export function LocalSectionNav<T extends string>({ state, label, onChange, trailing }: {
  state: LocalSectionState<T>
  label: string
  onChange?: (section: T, options?: LocalSectionChangeOptions) => void
  /** Right-aligned on the strip's own line (Net worth's Monthly/Quarterly Segmented). */
  trailing?: ReactNode
}) {
  const change = onChange ?? state.setSection
  const listRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  // Whether a measurement has been committed. The FIRST placement is where the bar LIVES, not a
  // move (Layout.tsx's nav-indicator idiom): data-placed goes on from the second placement, and
  // localSections.css hangs the transition on that attribute.
  const placedRef = useRef(false)
  useLayoutEffect(() => {
    const place = () => {
      const list = listRef.current
      const bar = indicatorRef.current
      if (list === null || bar === null) return
      const tab = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      if (tab === null) { bar.style.width = '0px'; return }
      if (placedRef.current) bar.dataset.placed = ''
      bar.style.width = `${tab.offsetWidth}px`
      // The y term is 0 on a one-row strip; when the tabs wrap it lifts the bar to the selected
      // tab's own row instead of leaving it under the last one.
      bar.style.transform = `translate(${tab.offsetLeft}px, ${tab.offsetTop + tab.offsetHeight - list.offsetHeight}px)`
      placedRef.current = true
    }
    place()
    // Tabs move without the section changing — a wrap, the density toggle, a badge landing.
    // Guarded for jsdom and old browsers: without it the bar waits for the next activation.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => place())
    if (listRef.current !== null) observer?.observe(listRef.current)
    return () => observer?.disconnect()
  }, [state.section, state.sections])
  return <nav className="local-section-nav" aria-label={label}>
    <div ref={listRef} role="tablist" aria-label={label}>
      {/* Decorative: aria-selected already says which tab is current. */}
      <span ref={indicatorRef} className="local-section-indicator" aria-hidden="true" />
      {state.sections.map((item, index) => <button key={item.id} type="button" role="tab" id={state.tabId(item.id)} aria-controls={state.panelId(item.id)} aria-selected={item.id === state.section} tabIndex={item.id === state.section ? 0 : -1} onClick={() => change(item.id)} onKeyDown={(event) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
        const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? state.sections.length - 1 : step ? (index + step + state.sections.length) % state.sections.length : null
        if (nextIndex === null) return
        event.preventDefault()
        const next = state.sections[nextIndex].id
        change(next, { replace: true })
        document.getElementById(state.tabId(next))?.focus({ preventScroll: true })
      }}>{item.label}{item.badge !== undefined && <span>{item.badge}</span>}</button>)}
    </div>
    {trailing !== undefined && <div className="local-section-trailing">{trailing}</div>}
  </nav>
}
```

- [ ] **Step 4: Rewrite `localSections.css`**

Replace the file with (the two `.local-section-toolbar` lines stay until Task 14 removes the last
call site):

```css
.local-section-nav { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; margin: 0 0 1.1rem; padding: 0; border-bottom: 1px solid var(--border); }
/* position: relative — the indicator's offsets are measured against the tablist. */
.local-section-nav [role=tablist] { position: relative; display: flex; gap: .2rem; flex-wrap: wrap; flex: 1 1 auto; min-width: 0; }
.local-section-nav [role=tab] { display: inline-flex; align-items: center; gap: .5rem; padding: .65rem .9rem; background: none; color: var(--muted); font-size: .85rem; border: 0; border-bottom: 2px solid transparent; cursor: pointer; }
/* The accent is the shared indicator's now (2026-09-13 polish §2.4); the tab keeps its transparent 2px so its box is unchanged. */
.local-section-nav [role=tab][aria-selected=true] { color: var(--text); }
.local-section-nav [role=tab]:hover { background: var(--fill); color: var(--text); }
.local-section-nav [role=tab]:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; border-radius: 4px; }
.local-section-nav [role=tab] > span { padding: .05rem .35rem; border-radius: 8px; background: var(--surface-2); font-size: .7rem; }
/* ONE accent bar for the strip, placed by LocalSectionNav's measuring effect — the sidebar's .nav-indicator, horizontal. Sits over the strip's hairline. */
.local-section-indicator { position: absolute; left: 0; bottom: -1px; width: 0; height: 2px; background: var(--accent); border-radius: 2px 2px 0 0; pointer-events: none; }
/* Only once placed at least once: the opening measurement lands instantly. Tokens read unconditionally — the reduce block zeroes --t-nav. */
.local-section-indicator[data-placed] { transition: transform var(--t-nav) var(--ease-out), width var(--t-nav) var(--ease-out); }
/* A control on the tab baseline (Net worth's Monthly/Quarterly). */
.local-section-trailing { display: flex; align-items: center; flex: none; padding-bottom: .3rem; }
.local-section-panel { min-width: 0; }
.local-section-panel[hidden] { display: none !important; }
.local-section-panel [id] { scroll-margin-top: 7rem; }
.local-section-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.local-section-toolbar > .local-section-nav { flex: 1; }
```

Append to `src/components/surfaceGrammar.test.ts`:

```ts
describe('tab strip indicator (2026-09-13 polish §2.4)', () => {
  it('draws one accent bar that transitions only once placed, over token durations', () => {
    expect(SECTIONS).toContain('.local-section-indicator { position: absolute; left: 0; bottom: -1px; width: 0; height: 2px; background: var(--accent); border-radius: 2px 2px 0 0; pointer-events: none; }')
    expect(SECTIONS).toContain('.local-section-indicator[data-placed] { transition: transform var(--t-nav) var(--ease-out), width var(--t-nav) var(--ease-out); }')
    expect(SECTIONS).toContain('.local-section-nav [role=tab][aria-selected=true] { color: var(--text); }')
    expect(SECTIONS).toContain('.local-section-nav [role=tablist] { position: relative;')
  })
})
```

- [ ] **Step 5: Run the strip, the pins and the motion sweep; then the Credit cards page**

Run: `npx vitest run src/components/shell/LocalSections.test.tsx src/components/surfaceGrammar.test.ts src/theme/motion.test.ts src/pages/CreditCardsPage.test.tsx`
Expected: PASS — `Test Files 4 passed`. (Credit cards still compiles: its `onChange={(section) =>
…}` ignores the new second argument until Task 14 spreads it.)

Run: `npx tsc -b && npx eslint src/components/shell/LocalSections.tsx`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/LocalSections.tsx src/components/shell/LocalSections.test.tsx src/components/shell/localSections.css src/components/surfaceGrammar.test.ts
git commit -m "feat(shell): tab strip — sliding accent indicator, trailing slot, keyboard activation replaces history"
```

---

## Task 13 — `LocalSectionPanel` cross-fade on activation (spec §2.4)

**Files:**
- Modify: `src/components/shell/LocalSections.tsx` (the `LocalSectionPanel` function)
- Modify: `src/components/shell/LocalSections.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/components/shell/LocalSections.test.tsx` (add
`import { EASE_OUT, MOTION_MS } from '../../theme/motion'`):

```tsx
describe('LocalSectionPanel fade (2026-09-13 polish §2.4)', () => {
  // jsdom has no Element.animate; the component guards on its presence, so the tests install one.
  const animate = vi.fn()
  beforeEach(() => { Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true, writable: true }) })
  afterEach(() => { Reflect.deleteProperty(HTMLElement.prototype, 'animate'); animate.mockClear(); vi.unstubAllGlobals() })

  it('does not animate the section the page arrived on, fades every later activation and revisit', () => {
    render(<MemoryRouter><Harness /></MemoryRouter>)
    expect(animate).not.toHaveBeenCalled() // the page body's own entrance covers arrival
    fireEvent.click(screen.getByRole('tab', { name: 'Inputs' }))
    expect(animate).toHaveBeenCalledTimes(1)
    const [frames, options] = animate.mock.calls[0] as [Keyframe[], KeyframeAnimationOptions]
    expect(frames).toEqual([{ opacity: 0, translate: '0 6px' }, { opacity: 1, translate: 'none' }])
    expect(options).toEqual({ duration: MOTION_MS.xfade, easing: EASE_OUT, fill: 'backwards' })
    // The panel that animated is the one that just became visible.
    expect((animate.mock.contexts[0] as HTMLElement).id).toBe(screen.getByRole('tabpanel').id)
    fireEvent.click(screen.getByRole('tab', { name: 'Summary' })) // a kept-mounted revisit fades too
    expect(animate).toHaveBeenCalledTimes(2)
  })

  it('is skipped under prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    render(<MemoryRouter><Harness /></MemoryRouter>)
    fireEvent.click(screen.getByRole('tab', { name: 'Inputs' }))
    expect(animate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/shell/LocalSections.test.tsx`
Expected: FAIL — `expected "spy" to be called 1 times, but got 0 times`.

- [ ] **Step 3: Implement the fade**

In `src/components/shell/LocalSections.tsx`, add the imports
`import { EASE_OUT, MOTION_MS } from '../../theme/motion'` and
`import { prefersReducedMotion } from '../useReducedMotion'`, then replace `LocalSectionPanel`:

```tsx
/** Unopened views mount lazily. Visited editors stay mounted by default so their local
 * validation, draft and preview state survive switching to Summary and back. */
export function LocalSectionPanel<T extends string>({ state, section, children, keepMounted = true, className }: {
  state: LocalSectionState<T>
  section: T
  children: ReactNode
  keepMounted?: boolean
  className?: string
}) {
  const active = state.section === section
  const [visited, setVisited] = useState(active)
  if (active && !visited) setVisited(true)
  const ref = useRef<HTMLElement>(null)
  // The view swap is one panel-level fade, not a second card cascade (2026-09-13 polish §2.4).
  // WAAPI rather than a CSS animation because a kept-mounted panel only toggles `hidden`, and a
  // CSS animation would not restart. A LAYOUT effect: it runs in the commit that cleared
  // `hidden`, so the first frame the panel is visible is already the fade's first frame. The
  // component instance exists from page arrival (an inactive panel renders null, not nothing),
  // so the first effect run IS the arrival — the initially active section does not animate; the
  // page body's own entrance already covers it — and every later activation, first visit or
  // revisit, does.
  const arrivalRef = useRef(true)
  useLayoutEffect(() => {
    const arrival = arrivalRef.current
    arrivalRef.current = false
    if (!active || arrival) return
    const el = ref.current
    if (el === null || prefersReducedMotion() || typeof el.animate !== 'function') return
    el.animate(
      [{ opacity: 0, translate: '0 6px' }, { opacity: 1, translate: 'none' }],
      { duration: MOTION_MS.xfade, easing: EASE_OUT, fill: 'backwards' },
    )
  }, [active])
  if (!active && (!keepMounted || !visited)) return null
  return <LocalSectionVisibility.Provider value={active}><section ref={ref} id={state.panelId(section)} role="tabpanel" aria-labelledby={state.tabId(section)} hidden={!active} className={`local-section-panel${className ? ` ${className}` : ''}`}>{children}</section></LocalSectionVisibility.Provider>
}
```

- [ ] **Step 4: Run the file and lint**

Run: `npx vitest run src/components/shell/LocalSections.test.tsx && npx eslint src/components/shell/LocalSections.tsx`
Expected: PASS (all describes); eslint prints nothing new (the pre-existing
`react-refresh/only-export-components` warning for this file is in the baseline).

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/LocalSections.tsx src/components/shell/LocalSections.test.tsx
git commit -m "feat(motion): LocalSectionPanel cross-fades on activation through WAAPI, skipping arrival and reduced motion"
```

---

## Task 14 — wire all ten tabbed pages to `sections=` and delete `.local-section-toolbar` (spec §3)

**Files:**
- Modify: `src/pages/NetWorthPage.tsx` (~L573–609), `PortfolioPage.tsx` (~L579), `SpendingPage.tsx` (~L464),
  `CreditCardsPage.tsx` (~L360), `PaycheckPage.tsx` (~L1437), `CompPage.tsx` (~L589–590),
  `EsppPage.tsx` (~L1447–1448), `TaxesPage.tsx` (~L755), `ProjectionPage.tsx` (~L88–95),
  `SettingsPage.tsx` (~L233–241)
- Modify: `src/components/shell/localSections.css` (delete the two `.local-section-toolbar` lines)

No new unit test file: the ten page suites are the tests, and Task 11's PageFrame tests already
cover the slot. Each page's move is mechanical; do them in this order and run the page's suite
after each.

- [ ] **Step 1: Net worth — strip + Monthly/Quarterly into `sections`, toolbar gone**

In `src/pages/NetWorthPage.tsx`, delete the `<div className="local-section-toolbar">…</div>`
block that opens the frame's children (it wraps `<LocalSectionNav state={views} label="Net worth
views" />` and the granularity `<Segmented …/>`, ending at the `/></div>` line just above the
`FeedBanner` comment). Add to the `<PageFrame` props, directly after `title="Net worth"`:

```tsx
        sections={
          <LocalSectionNav
            state={views}
            label="Net worth views"
            trailing={
              <Segmented
                variant="toggle"
                size="sm"
                ariaLabel="Granularity"
                options={[
                  { value: 'monthly', label: 'Monthly' },
                  { value: 'quarterly', label: 'Quarterly' },
                ]}
                value={granularity}
                onChange={(g) => {
                  // A press on the ACTIVE chip is a no-op, not a refetch: setGranularity
                  // would bail out and leave the dim raised with nothing coming to lower it.
                  if (g === granularity) return
                  setLoading(true)
                  setError(null)
                  setSummaryError(null)
                  // Same handler-side seed as the owner adoption above: a warm grain paints
                  // instantly, and the rendered-state guard in load() stays truthful. The
                  // ref write is fine HERE — an event handler, never a render.
                  // The TARGET grain's key, so the month is snapped the way that
                  // grain will read it — a quarterly peek must not look up a monthly one.
                  const peeked = getSnapshot<NetWorthSnapshot>(
                    netWorthKey(
                      g,
                      owner,
                      g === 'quarterly' ? quarterEndOnOrBefore(scope.month) : scope.month,
                    ),
                  )
                  if (peeked !== undefined) {
                    shown.current = peeked
                    setFromCache(true)
                    setData(peeked.ts)
                    setSummary(peeked.summary)
                  }
                  setGranularity(g)
                }}
              />
            }
          />
        }
```

The `onChange` body is the existing one moved verbatim — compare against the deleted block before
committing; nothing inside it changes.

Run: `npx vitest run src/pages/NetWorthPage.test.tsx`
Expected: PASS.

- [ ] **Step 2: Portfolio, Paycheck, Comp, ESPP, Taxes — move the strip from children to the prop**

In each file, delete the `<LocalSectionNav … />` line that is the first child of `<PageFrame>` and
add the same element as a `sections=` prop:

- `PortfolioPage.tsx`: `sections={<LocalSectionNav state={views} label="Portfolio views" />}`
- `PaycheckPage.tsx`: `sections={<LocalSectionNav state={views} label="Paycheck views" />}`
  (place it after `title="Paycheck"`, before the `scopeRow` comment)
- `CompPage.tsx`: the frame becomes
  `<PageFrame title="Comp" sections={<LocalSectionNav state={views} label="Comp views" />} resource={{ status: 'ready', fromCache }}>`
- `EsppPage.tsx`: `<PageFrame title="ESPP" sections={<LocalSectionNav state={views} label="ESPP views" />} resource={{ status: 'ready' }}>`
- `TaxesPage.tsx`: `sections={<LocalSectionNav state={views} label="Taxes views" />}` after `title="Taxes"`

Run: `npx vitest run src/pages/PortfolioPage.test.tsx src/pages/PaycheckPage.test.tsx src/pages/CompPage.test.tsx src/pages/EsppPage.test.tsx src/pages/TaxesPage.test.tsx`
Expected: PASS. (The strip now renders in the loading and error states too — it is URL-driven and
harmless there; a page test that asserted "only the alert renders on a failed first load" by
counting `role="tab"` would need `queryAllByRole('tab')` excluded from its count — none was found
in the suite as of this plan, but update rather than delete if one appears.)

- [ ] **Step 3: Spending (from `subheader`) and Settings (from `scopeRow`)**

- `SpendingPage.tsx`: change `subheader={<LocalSectionNav state={views} label="Spending views" />}`
  to `sections={<LocalSectionNav state={views} label="Spending views" />}`. The page has no other
  subheader content, so no `subheader` prop remains.
- `SettingsPage.tsx`: replace the whole `scopeRow={ … <LocalSectionNav state={views} label="Settings views" /> }`
  prop (with its four-line comment about the rail) with
  `sections={<LocalSectionNav state={views} label="Settings views" />}`. The comment described the
  deleted rail's arrival ring; it goes with the prop.

Run: `npx vitest run src/pages/SpendingPage.test.tsx src/pages/SettingsPage.test.tsx`
Expected: PASS — `SettingsPage.test.tsx`'s "mounts accessible task navigation in the sticky scope
row" still finds the tablist inside `.page-frame-scope` (the strip is its first row now); rename
that test's title to `… in the sticky block` if you touch it, leave its assertions.

- [ ] **Step 4: Credit cards (spread the options) and Projection (keep the missing-book guard)**

- `CreditCardsPage.tsx`: delete the child
  `<LocalSectionNav state={views} label="CreditCards views" onChange={(section) => views.setSection(section, { removeParams: ['card'] })} />`
  and add the prop
  `sections={<LocalSectionNav state={views} label="CreditCards views" onChange={(section, options) => views.setSection(section, { ...options, removeParams: ['card'] })} />}`
  so a keyboard sweep still replaces the entry AND still drops `card`.
- `ProjectionPage.tsx`: delete `<LocalSectionNav state={sections} label="Projection views" />`
  from inside the `data !== null && display !== null && receipts !== null && <>` branch and add
  `sections={missing ? undefined : <LocalSectionNav state={sections} label="Projection views" />}`
  to the `<PageFrame` props (after `title="Projection"`). A book with no projection (`missing`)
  shows the empty-note card and no strip, as before; while loading, the strip is already in the
  sticky block, so it no longer pops in with the data. (`sections` is also the page's local
  variable for the view state — `sections={<LocalSectionNav state={sections} …/>}` is the
  intended, if homophonous, line.)

Run: `npx vitest run src/pages/CreditCardsPage.test.tsx src/pages/ProjectionPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Delete the toolbar rules and confirm nothing references them**

Remove the last two lines of `src/components/shell/localSections.css`
(`.local-section-toolbar { … }` and `.local-section-toolbar > .local-section-nav { flex: 1; }`).

Run: `grep -rn "local-section-toolbar" src` 
Expected: no output.

Run: `grep -rn "<LocalSectionNav" src/pages | grep -v "sections={" | grep -v "sections=$"`
Expected: no output — every remaining `<LocalSectionNav` sits inside a `sections=` prop. (A
multi-line `sections={` on the line above, as in Net worth, is fine: check by eye that the only
hits are inside the ten `sections=` props.)

- [ ] **Step 6: The whole page suite, then commit**

Run: `npx vitest run src/pages`
Expected: PASS — every page file green.

```bash
git add src/pages/NetWorthPage.tsx src/pages/PortfolioPage.tsx src/pages/SpendingPage.tsx src/pages/CreditCardsPage.tsx src/pages/PaycheckPage.tsx src/pages/CompPage.tsx src/pages/EsppPage.tsx src/pages/TaxesPage.tsx src/pages/ProjectionPage.tsx src/pages/SettingsPage.tsx src/components/shell/localSections.css
git commit -m "feat(shell): every tabbed page hands its view strip to PageFrame sections; .local-section-toolbar retired"
```

---

## Task 15 — gates and hand-off

- [ ] **Step 1: Type-check**

Run: `npx tsc -b`
Expected: exit 0, no output.

- [ ] **Step 2: Lint**

Run: `npx eslint src`
Expected: 0 errors. Warnings ≤ the 24-warning baseline (spec §15.9); this lane adds none — the
`react-refresh/only-export-components` warnings on `PageFrame.tsx` and `LocalSections.tsx` predate
it. If a NEW warning appears, fix it rather than documenting it.

- [ ] **Step 3: Scoped tests**

Run: `npx vitest run src/components/shell src/components/Disclosure.test.tsx src/components/useScrollEdges.test.ts src/components/usePopoverDismiss.test.ts src/components/useStagger.test.tsx src/components/surfaceGrammar.test.ts src/theme src/charts/recolor.test.ts src/components/PageSkeleton.test.tsx src/components/StatTile.test.tsx src/components/skeletonMetrics.test.ts`
Expected: PASS — every file green.

- [ ] **Step 4: Full suite**

Run: `npx vitest run`
Expected: PASS — `Test Files N passed`, 0 failed (main was 2753 tests at the 09-12 hand-off;
this lane adds roughly 45). A failure in a page suite you did not touch is a selector that read
the old DOM (`.stat-label` children, the strip's position): update the selector, never the
assertion's intent.

- [ ] **Step 5: Production build**

Run: `npm run build`
Expected: `tsc -b` silent, then `vite build` ends with `✓ built in …` and no chunk-size warning
beyond the documented echarts advisory.

- [ ] **Step 6: Final commit of anything the gates changed, and the hand-off note**

```bash
git status --short   # expect: clean, or only files the gates made you touch
git add -A src && git commit -m "chore(shell): gate fixes for lane F2" || true
git log --oneline main..HEAD
```

Report to the lead: the commit list, the vitest totals, and the hand-off items below.

### Hand-offs (not done in this lane — files other lanes own)

- **F1 (`chartInteractions.css`, `details.css`, `assistant.css`):** `.chart-selection-summary`'s own
  `background: var(--surface-2)` is now overridden by panels.css's `.chart-card
  .chart-selection-summary { background: var(--fill) }` — drop the F1 declaration or switch it to
  `--fill` at the next touch. `.metric-receipt-list > div` already uses `var(--border)` (spec §6
  lists it; nothing to do). `.detail-panel-backdrop`, `.chart-expanded-dialog::backdrop` and the
  DayDrawer backdrop take `var(--scrim)`; launcher/drawer/panel shadows take
  `rgb(var(--shadow))` — both tokens exist in both themes after Task 1. `panel-in` and
  `backdrop-in` keyframes are defined in panels.css's no-preference block for F1's sheets to
  reference by name. `SelectionDetail`, `ChartTable` and the assistant blocks adopt
  `Disclosure` (default export, `src/components/Disclosure.tsx`).
- **P1 (Overview, Update, Spending):** `usePopoverDismiss(open, onClose, triggerRef, surfaceRef)` +
  `.popover-surface` for Customize and Month actions; `StatTile badge` for the review state;
  `PageSkeleton` `tiles` object if a delta-less row is ghosted.
- **P2 (Net worth, Portfolio, Cards):** Portfolio `.tiles-row` → `kpi-row kpi-row-dense`, skeleton
  `tiles: 5`; Credit cards skeleton `tiles: { count: 4, delta: false }` (spec §9); `useScrollEdges`
  + `.row-actions`/`.col-identity` on `.holdings-scroll` if it overflows under a dock.
- **P3 (Paycheck, Comp, ESPP, Taxes):** `useScrollEdges` + `.row-actions` on `.paycheck-scroll`,
  `.comp-scroll`, `.espp-scroll`; ESPP strip `kpi-row kpi-row-5`; `Disclosure` for Employer match
  and the Will-I-owe methodology; Taxes' new-year `popover-surface`; Paycheck's
  `<div hidden={…}>` view wrappers may become `LocalSectionPanel`s to get the §2.4 fade.
- **P4 (Projection, Calendar, Settings):** Projection `.projection-outcomes` → add `kpi-row-5`
  and drop its own five-column rule; the "Reach FI target within N years" label shortening (P-11);
  Settings `h2.settings-section` → `visually-hidden`, `GhostCard`s, `.settings-scroll` edges;
  `.cal-popover`'s `rgba(0, 0, 0, 0.4)` shadow → `rgb(var(--shadow))` (this lane changed
  CalendarPage.css hairlines ONLY).
- **Lane V:** measure `.local-section-indicator` transition and `.popover-surface` animation
  under no-preference (non-zero) and reduce (0s); confirm `nav.local-section-nav` lies inside
  `.page-frame-scope` on all ten pages and survives a 700px scroll; check the delta-less ghost's
  93px against the real Credit-cards tile and adjust `--m-stat-tile-bare` if the CLS smoke says so.

---

## Self-review (done while writing; the implementer re-runs the gates, not this)

**Spec coverage.** §2.1 → Task 3 (keyframes, pop-in list, hover list). §2.4 → Tasks 12–13
(indicator, tab colour via the shared hover list, WAAPI panel fade, keyboard replace + `onChange`
options). §2.5 → Task 10 (`tagStagger`, `mountedAt`, Feed gate, `[hidden]` skip). §2.6 → Task 7.
§3 → Tasks 11 + 14 (slot inside the sticky element, `--sticky-inset`/sentinel/`is-stuck`
untouched, `:empty` hiding preserved through the row + `:has()` block rule, `trailing`, toolbar
deleted, all ten pages). §6 → Tasks 1–2 (three tokens in `tokens.ts` + both `index.css` blocks +
recolor exclusion; `--fill` on the six sites; hairlines; disabled primary). §7 → Task 5 (recipe +
hook). §9 → Task 9. §10 → Task 8. §11 → Task 6 (+ Task 7 for the Disclosure half). §12 → Task 4.
§15.7's 1.15:1 floor is pinned at the token level (Task 1). §16's F2 risks: merge order noted in
Mechanics; `container-type` on `.page` documented in Task 4.

**Placeholder scan.** No TBD/TODO; every code step carries the code; every run step names the
command and its expected result. One implementer judgement call is called out explicitly (the
`name` attribute on `<details>` if `@types/react` lacks it, Task 7 Step 5).

**Type consistency.** `usePopoverDismiss(open, onClose, triggerRef, surfaceRef)` (Task 6 and the
contracts table); `useScrollEdges(ref)`; `tagStagger(root, startIndex = 0): number` and
`CASCADE_WINDOW_MS` (Task 10, imported by Feed under those names); `usePageFrame()` returns
`{ fromCache, mountedAt }` (Task 10, read by Feed and the PageFrame test); `LocalSectionNav`
props `{ state, label, onChange?(section, options?: LocalSectionChangeOptions), trailing? }`
(Task 12, used by Task 14's Credit cards line); `GhostTile({ delta })` / `tiles: number | { count,
delta? }` (Task 9, used by the PageFrame plumbing test); `StatTile badge` (Task 8).

**Ambiguities resolved (and how).**
1. `.metric-receipt-list > div` (spec §6 hairline list) already reads `var(--border)` in
   `details.css` — no change; recorded in the F1 hand-off.
2. `.chart-selection-summary` `--fill` (spec §6) lives in F1's `chartInteractions.css`, which is
   bundled after panels.css — done from panels.css with the two-class selector
   `.chart-card .chart-selection-summary` (the strip always renders inside `section.card.chart-card`),
   so the token lands without editing F1's file.
3. The sticky row-action recipe's `th:last-child` is scoped with `:has(td.row-actions)` so tables
   that never opted in do not grow a hairline on their last header cell; a third mask rule covers
   "both edges hidden", where the two single-edge rules would otherwise cancel.
4. `fill`'s dark hex is `border`'s: adding it to `recolor.ts`'s SCALARS would re-run the election,
   so all three new tokens are excluded with a comment and a test pins that the border election is
   unchanged (spec §6 allows "documents their exclusion").
5. `mountedAt` is a `useState(() => performance.now())` initializer, not `useRef(performance.now())`,
   because the repo's `react-hooks/purity` rule rejects the latter (verified with eslint before
   writing this plan); it is a number in context, not a module global, per the lead's brief.
6. The `--sticky-inset`/`:empty` behaviour: the row is wrapped, so `.page-frame-scope:empty` can
   no longer match — replaced by `.page-frame-scope-row:empty` plus
   `.page-frame-scope:not(:has(> :not(:empty)))`, and the `skeletonMetrics.test.ts` pin moves with it.
7. The indicator's transform is `translate(x, y)` rather than the spec's `translateX`: `y` is 0 on a
   one-row strip and lifts the bar to the selected tab's row when the tabs wrap (Settings' five
   tabs beside a dock); the test asserts `translate(100px, 0px)`.
8. `.button-primary:disabled` keeps the spec's literal `var(--surface-2)` (one step under the
   `--fill` quiet button), with the reasoning in the CSS comment.
9. A delta-less ghost tile needs a shorter box or the row shifts when data lands: `--m-stat-tile-bare: 93px`
   (115 minus the delta line's ≈17px type + 5.6px margin), flagged for lane V's CLS smoke.
10. `Disclosure` is uncontrolled by default and intercepts the summary click only when `open` is
    passed, so the DOM can never drift from a controlling parent; `onOpen` also fires for a mount
    that starts open (a lazy load behind `defaultOpen` still has to load).
11. Projection keeps its `missing` guard on the strip (`sections={missing ? undefined : …}`) — a
    book with no projection has no views to switch — while the strip now shows during loading.

---

## Results (implementer, 2026-09-13)

**Status: DONE.** All 15 tasks executed in order, TDD per task (failing test → run → minimal
implementation → run → commit). 15 commits on `polish/f2-shell`, none pushed. Working tree clean.

### Commits

| Task | SHA | Message |
| --- | --- | --- |
| 1 | `8b2830f` | feat(tokens): add fill, scrim and shadow palette slots in both themes |
| 2 | `eb0c1af` | feat(tokens): paint fills, hairlines and the disabled primary from the new tokens |
| 3 | `6edfaf6` | feat(motion): shared pop-in/panel-in/backdrop-in keyframes and the hover list for new controls |
| 4 | `a1bc6fd` | feat(shell): KPI row grammar — container queries, five-column rows, last tile fills the row |
| 5 | `065eaa1` | feat(shell): sticky row-action and identity cells, scroll-edge masks and useScrollEdges |
| 6 | `809ce9b` | feat(shell): popover-surface class and usePopoverDismiss (outside pointerdown, Escape with focus return) |
| 7 | `b290f27` | feat(shell): Disclosure primitive — chevron summary, pop-in body, controlled/uncontrolled open, onOpen once |
| 8 | `e08f228` | feat(shell): StatTile badge pill and a nowrap label unit so the (i) never wraps alone |
| 9 | `7db962b` | feat(shell): delta-less ghost tiles — GhostTile delta prop and PageSkeleton tiles as { count, delta } |
| 10 | `23cebe6` | feat(motion): tagStagger export, PageFrame mountedAt, Feed cascades its first payload inside the arrival window |
| 11 | `1ab5a13` | feat(shell): PageFrame sections slot — the view strip rides inside the sticky block above the scope row |
| 12 | `0b76128` | feat(shell): tab strip — sliding accent indicator, trailing slot, keyboard activation replaces history |
| 13 | `6530e80` | feat(motion): LocalSectionPanel cross-fades on activation through WAAPI, skipping arrival and reduced motion |
| 14 | `c3d9483` | feat(shell): every tabbed page hands its view strip to PageFrame sections; .local-section-toolbar retired |
| 15 | `cfcb22a` | chore(shell): gate fixes for lane F2 — DividendsPanel tile lookup reads from the tile, not the label's parent |

### Gates (Task 15)

- `npx tsc -b` — exit 0, no output.
- `npx eslint src` — **0 errors, 25 warnings**, equal to the post-F1 baseline of 25 (the plan's
  text says 24; the merged F1 branch left 25, all `react-refresh/only-export-components`). This
  lane adds none: `PageFrame.tsx` and `LocalSections.tsx` already carried theirs.
- Scoped set (Task 15 Step 3) — **23 files / 245 tests passed**.
- `npx vitest run` — **214 files / 2930 tests passed, 0 failed** (main was 2753 at the 09-12
  hand-off; F1 and this lane account for the rest — F2 adds ~52).
- `npm run build` — `tsc -b` silent, `vite build ✓ built in 9.26s`, no chunk-size warning.
  `dist/assets/index-*.js` 352.34 kB (gzip 111.91 kB), `index-*.css` 45.01 kB,
  `tooltip-*.js` 758.10 kB (the echarts chunk, unchanged), `LocalSections-*.css` 1.36 kB.

### Deviations (all recorded, none silent)

1. **`react-hooks/refs` in the two `.ts` hook harnesses.** `createElement('div', { ref, … })` is
   flagged by the React-Compiler `refs` rule ("Passing a ref to a function may read its value
   during render"); the JSX form the rule allows is unavailable in a `.ts` file, and the plan
   fixed those two test files as `.ts` on purpose (Task 15 Step 3 names them). Each call carries a
   one-line `// eslint-disable-next-line react-hooks/refs` with the reason. No production code
   is disabled, and the repo's warning count is unchanged.
2. **`Feed.test.tsx`'s `staggers()` selector** reads `.xfade .loading-dim .card`, not
   `.xfade .card`. During the cross-fade the outgoing ghost veil renders a `SkeletonCard`, which
   is a third `.card` inside `.xfade`, so the plan's literal selector returns three entries in
   every case and can never equal a two-entry array. The `.loading-dim` wrapper is the payload's
   half of the fade. The implementation is exactly as planned (root = the `.xfade` wrapper); the
   veil's ghost is tagged too, which is invisible because panels.css already pins
   `.xfade-veil .loading-fallback { animation: none }`.
3. **`LocalSectionNav`'s click path calls `change(item.id, undefined)`.** The plan's Task 12 test
   asserts `toHaveBeenLastCalledWith('inputs', undefined)`, and vitest counts arity, so a
   one-argument call fails it; the plan's own Step 2 predicted the pre-fix failure as "`onChange`
   receives one argument". Semantically identical — a click carries no options and therefore
   pushes.
4. **`SettingsPage.test.tsx`'s ResizeObserver count 2 → 3** (updated in place, assertions intact):
   `LocalSectionNav` now observes its tablist to re-place the sliding indicator. The comment above
   the assertion names the third observer.
5. **`DividendsPanel.test.tsx`'s `tileValue` helper** now reads
   `getByText(label).closest('.stat-tile')` instead of `.parentElement` — the exact repair Task 8
   Step 5 authorised, needed because the label text and its (i) share a `.stat-label-text` span.
   It was the only such selector in the suite.
6. **eslint baseline is 25, not the plan's 24** (see Gates). No new warning was introduced.

### Notes for lane V

- One cross-file flake observed once and not reproducible: `src/components/settings/RestoreCard.test.tsx`
  "leaves focus on the report after a restore is applied, never on the body" failed in one full-suite
  run and passed both in isolation and in the next full run of the same tree. Not touched by this
  lane (no focus, portal or settings code changed).
- `--m-stat-tile-bare: 93px` is a computed estimate (115 − ≈17px delta line − 5.6px margin); the
  CLS smoke on Credit cards and Portfolio is the check on it.
- `.local-section-indicator` transition should measure non-zero under no-preference and 0s under
  `reduce` (it reads `--t-nav`, which the reduce block zeroes); `.popover-surface` likewise on
  `--t-fast` through `pop-in`.
- `nav.local-section-nav` now lies inside `.page-frame-scope` on all ten tabbed pages; Projection
  hides it only when the book has no projection (`missing`).

### Hand-offs

The plan's hand-off list (F1 follow-up, P1–P4, lane V) stands unchanged — every contract it names
shipped under the exact names in the "Contracts this lane publishes" table, verified after Task 15:
`Disclosure` (default export), `usePopoverDismiss(open, onClose, triggerRef, surfaceRef)`,
`useScrollEdges(ref)`, `tagStagger(root, startIndex)`, `CASCADE_WINDOW_MS`, `usePageFrame() →
{ fromCache, mountedAt }`, `PageFrame sections`, `LocalSectionNav { trailing, onChange(section,
options) }`, `GhostTile delta`, `PageSkeleton tiles: number | { count, delta }`, `StatTile badge`,
`.popover-surface`, `.row-actions` / `.col-identity`, `.kpi-row-5` / `.kpi-row-dense`,
`--fill` / `--scrim` / `--shadow`.

One addition for **P2**: `PortfolioPage.tsx` still renders `.tiles-row`; this lane published
`.kpi-row-dense` but did not convert the page (out of scope — Task 14 was the `sections=` wiring
only).

### Review round (2026-09-13, commit `7f631e8`)

Six reviewer findings, all verified in a headless browser before they were written up, all applied
as given. One commit; the gates below are the post-fix numbers.

1. **CRITICAL — `.kpi-row > :last-child { grid-column-end: -1 }` did not do what the plan claimed
   and has been deleted.** The rule sets only the END line; the start line stays `auto`, and the
   pair resolves to a **one-track** item placed in the **last** column. A 4+1 wrap therefore became
   a right-hand orphan with a hole to its left — strictly worse than the left-hand orphan the rule
   was written to cure. There is no CSS-only fix in that band: a span needs a known start line, and
   `repeat(auto-fit, …)` does not settle its column count until layout, so a real fill would be JS
   measuring the row. The comment above the row now says exactly that, so nobody re-derives the
   same wrong rule. The span moved to the one band where the arithmetic IS known — inside
   `@container page (max-width: 980px)`, where the row is exactly two columns:
   `.kpi-row:not(.kpi-row-5) > :last-child:nth-child(odd) { grid-column: 1 / -1; }`.
   **Consequence for other lanes:** the contract row in `2026-09-13-polish-p1-overview.md` and
   check 4e in `2026-09-13-polish-v-verify.md` both name the deleted rule. Above 980px of page
   width a 4+1 wrap now leaves a **normal-width** last tile on its own line (auto-fit's own
   behaviour, the pre-lane look); balanced filling is guaranteed only in the two-column band.
   Lane V should assert that, not "no lone last tile" at every width.
2. **The horizontal scroll masks were fading the sticky cells they share an edge with.** A
   `mask-image` composites the whole element, and `position: sticky` does not exempt a child from
   it, so a table with pinned `.row-actions` dissolved its own Actions buttons at the right edge
   (and `.col-identity` at the left) — read as a rendering fault, not a hint. Each mask now skips
   the edge a pinned column already holds:
   `[data-scroll-more~="right"]:not(:has(.row-actions))`,
   `[data-scroll-more~="left"]:not(:has(.col-identity))`, and the two-token rule excludes both.
   Where a column is pinned, the pinned column IS the "there is more" signal.
3. **`useScrollEdges` never re-armed.** The effect read `ref.current`, returned on null and listed
   only `[ref]`, which is not a reactive value — so a hook placed above a scroller that renders
   only once rows arrive attached on WARM renders and never on a first load, and that table was
   unmasked for its whole life. The published signature is now
   `useScrollEdges(ref, active = true)` — backward compatible, no caller changes (the page lanes
   have not adopted it yet). `active` is in the deps, so flipping it re-runs the attach; flipping
   it false detaches and clears the attribute. The JSDoc names the two correct call shapes: pass
   `active={rows.length > 0}` for a conditional scroller, or call the hook inside the component
   that renders the scroller unconditionally. New test: null ref at mount → rerender with the
   scroller present and `active` true → the attribute appears.
4. **`.page`'s containment makes it a stacking context, and two comments said otherwise.**
   `container-type: inline-size` applies layout containment, so everything inside `.page` paints as
   one layer: no z-index on a descendant can reach over the dock (16), the palette (20) or toasts
   (30). `.popover-surface`'s "z 20: over the dock (16), under toasts (30)" was simply false — the
   comment now states that 20 orders it among page content only and that a popover near the page's
   right edge should open leftward rather than trust the number; `.page`'s own comment gained the
   stacking-context sentence. The container is also **named** now — `container: page / inline-size`
   — and both KPI rules ask for it by name (`@container page (…)`), so a `.kpi-row` nested inside a
   nearer container (a chart card's aside, the allocation workspace) still measures the page
   instead of that little box. `ProjectionPage.css`'s `.projection-page { container-type }` sits on
   the same element and declares no name, so the name survives the cascade; its own unnamed
   `@container` query is unaffected (an unnamed query matches any container).
5. **Double hairline with a strip and an EMPTY scope row.** The suppression tested
   `:has(> .page-frame-sections:last-child)`, but a page that declares a scope row keeps the row
   ELEMENT even when `ScopeBar` renders nothing (a one-person household), so the strip was not the
   last child and both hairlines drew 1px apart. The test is now "nothing renders below the strip":
   `.page-frame-scope.is-stuck:not(:has(> .page-frame-scope-row:not(:empty)))`, the same
   `:not(:empty)` the row's own `display: none` rule uses, which is what keeps the two in agreement.
6. **`--shadow` adoption in `chartInteractions.css`** (F1 is merged, so no other lane owns the
   sheet): `.chart-export-popover`'s `box-shadow: 0 6px 20px #0003` → `rgb(var(--shadow))`. The
   token is a bare `r g b / a` triplet that already carries its alpha (`0 0 0 / 0.45` dark,
   `20 30 50 / 0.14` light), so it is read whole exactly as `.popover-surface` reads it — no
   `/ 0.2` suffix, which would have overridden the light theme's cool 14%. `tokens.test.ts` and
   `motion.test.ts` are untouched and green.

**Pins.** `surfaceGrammar.test.ts` gained a `CHART` source const and now pins: the absence of the
deleted KPI rule, the named container, the odd-last-child rule **inside** the two-column block (as
one string, so the nesting is part of the pin), the three `:has()`-excluded masks, the new stuck
selector and the export popover's shadow. A comment on the KPI block records what these pins are
worth: a text pin proves a rule is PRESENT and spelled as intended, never that it lays out — the
deleted rule read perfectly and placed the tile in the wrong column. Lane V's browser check is the
gate on the geometry.

**Gates (post-fix).**

- `npx tsc -b` — exit 0, no output.
- `npx eslint src/components src/theme` — **0 errors, 18 warnings**, all pre-existing
  `react-refresh/only-export-components` (the full-`src` baseline of 25 is unchanged; no warning is
  in a file this round touched).
- Scoped set (`src/components/shell`, `surfaceGrammar.test.ts`, `useScrollEdges.test.ts`,
  `PageSkeleton.test.tsx`, `src/theme`) — **17 files / 204 tests passed**.
- `npx vitest run` — **214 files / 2936 tests passed, 0 failed**. The Task 15 number, 2930, was measured on a tree without F1b; this round adds the two tests named above.
