# Guide page polish — master–detail cards, one-card chapters, motion — design

Date: 2026-09-15 · Status: **approved by the user 2026-09-15** ("looks good, go ahead"), after two
browser mockup rounds (`.superpowers/brainstorm/763-1789412708/content/`: `pages-card-layout.html`
→ A master–detail; `start-here-layout.html` → B rail + detail, "make the checklist scrollable so
each step is easy to see"). Implemented in parallel worktree lanes; local merges only, no push.

Predecessor: `docs/superpowers/specs/2026-09-14-onboarding-guide-design.md` (the Guide page as
shipped overnight 2026-09-14/15). This spec changes presentation and interaction only; the content
model, the fences, the palette and the entry points stay.

## 0. What the user saw and asked for

Screenshots of the shipped page (`scratchpad/guide-v/eyeball/`): every card renders every task
fully expanded, so the Pages chapter is a scroll of thirteen cards of numbered steps; prose is
capped at a 72-character measure inside a full-width card, so the right half of every card is
empty; the only animated interaction is the chapter tab switch. The user asked to subdivide, hide
until clicked, reveal tasks per section on click, balance the left/right split, and animate the
interactions.

## 1. Scope and non-goals

In scope:

1. **Master–detail cards.** Every card with tasks lays out as a task rail on the left and the
   selected task's detail on the right (§2). The rail scrolls inside the card when tall; folded
   tasks live under a "More tasks (N)" row that expands in place; deep links select tasks.
2. **One card at a time** in the Pages and Reference chapters, picked by a sticky chip selector
   whose state is the URL hash (§3). Start here and Routines stay stacked.
3. **Content restructuring** (§5): the setup checklist and the tax-season sequence become
   numbered task rails; the prose cards use two-column fact grids; the glossary becomes a
   two-column definition grid.
4. **Motion** on the existing tokens, off under reduced motion (§6).
5. Tests, fences and the guide probe updated (§7); no backend, API or schema change.

Out of scope: per-page "Guide" links in title rows and assistant how-to context (Phase 2/3 of the
predecessor spec), mobile layouts beyond the existing 1000 px stack, rewriting task copy beyond
the restructuring in §5, changes to the palette or fresh-database entry points.

## 2. Master–detail card (lane L1)

### 2.1 Structure

```tsx
<section className="card span-12 guide-card" id={card.id} aria-labelledby={`${card.id}-title`}>
  <div className="guide-card-head"><h2 className="eyebrow" id=…>{title}</h2>{to && <Link className="guide-open">Open … →</Link>}</div>
  <p className="guide-purpose">{purpose}</p>
  {views && <p className="drill-hint">Views: …</p>}
  {body}
  {hasTasks && (
    <div className="guide-md">
      <div className="guide-rail-col">
        <h3 className="guide-h3" id={`${card.id}-tasks`}>Do this</h3>
        <TaskRail card={card} selectedId={…} onSelect={…} foldOpen={…} onToggleFold={…} />
      </div>
      <div className="guide-detail-col">
        <TaskDetail task={selected} labelledBy={selected.id} />
        {watch.length > 0 && (<><h3 className="guide-h3">Watch out</h3><ul className="guide-watch">…</ul></>)}
      </div>
    </div>
  )}
  {!hasTasks && watch.length > 0 && (<><h3 className="guide-h3">Watch out</h3><ul className="guide-watch">…</ul></>)}
</section>
```

The `Disclosure`-based "More tasks" block and `GuideTaskList` are retired from the card;
`GuideTaskList.tsx` is deleted (its only consumer was `GuideCard`).

> **Amendment 2026-09-15 (user request after seeing the build):** the "More tasks (N)" fold is
> retired. Every task — `card.tasks` first, a hairline `.guide-rail-divider`, then `card.more` —
> is a row in the rail, and the rail scrolls (`max-height: min(70vh, 640px)`), so page cards
> behave exactly like the setup checklist. `useTaskSelection` carries no fold state; a hash naming
> any task selects it. The `more` split stays in the content model as the authors' "core first"
> order and for the palette; the fold-specific paragraphs below are superseded.

### 2.2 `TaskRail`

- `<div className="guide-rail" role="tablist" aria-orientation="vertical" aria-label={`Tasks on ${card.title}`}>`
  containing, in order: one row per `card.tasks`, then, when `card.more` is non-empty, a
  `<button type="button" className="guide-rail-more" aria-expanded={open} aria-controls={foldId}>`
  reading `More tasks (N)` / `Fewer tasks`, then `<div id={foldId} className="guide-rail-fold" data-open={open}>`
  holding one row per `card.more`.
- A row is `<button type="button" role="tab" id={task.id} className="guide-rail-row" aria-selected aria-controls={detailId} tabIndex={selected ? 0 : -1}>`
  with `<span className="guide-rail-num">{n}</span>` when `card.numbered` (1-based, folded rows
  continue the count), `<span className="guide-rail-title">{task.title}</span>` and
  `<small className="guide-rail-where">{task.where}</small>`. **The row keeps the task's `id`**:
  palette hits, pointer links and the probe target `#<taskId>` land on the row, and
  `LocalSections`' arrival effect focuses it (which also scrolls the rail).
- One measured accent indicator `<span className="guide-rail-indicator" aria-hidden="true">`,
  placed by a layout effect exactly as `LocalSectionNav` does (offsetTop/offsetHeight of the
  selected row; `data-placed` from the second placement; `ResizeObserver` re-measure), vertical.
- Keyboard: ArrowDown/ArrowUp move selection (wrapping), Home/End jump; moving selects (the
  strip's behaviour). Click selects. Selection does **not** write the URL (a hash write would
  re-trigger the arrival scroll-and-focus on every click).
- Rows carry `style={{ '--guide-i': Math.min(index, STAGGER_CAP) }}` for the arrival stagger (§6).
- `.guide-rail { max-height: min(70vh, 640px); overflow-y: auto }` — the user's "make the checklist
  scrollable so each step is easy to see": every row is reachable, none is hidden.

### 2.3 `TaskDetail`

`<div className="guide-detail" role="tabpanel" id={detailId} aria-labelledby={task.id}>` with
`<h4 className="guide-task-title">`, `<p className="guide-where">`, `<ol className="guide-steps">`
(steps through `renderSteps`), `<ul className="guide-task-watch">` and the `Go →` link — the same
markup `GuideTaskList` rendered, minus the outer list. `detailId = \`${card.id}-detail\``.

On a task change the panel crossfades: a layout effect keyed on `task.id` runs
`el.animate([{ opacity: 0, translate: '0 6px' }, { opacity: 1, translate: 'none' }], { duration: MOTION_MS.xfade, easing: EASE_OUT, fill: 'backwards' })`,
skipped on first mount, under `prefersReducedMotion()` and when `el.animate` is missing (jsdom) —
the `LocalSectionPanel` idiom.

The detail column is sticky while the rail scrolls: `.guide-detail-col { position: sticky; top: calc(var(--sticky-inset, 0px) + 1rem); align-self: start }`.

### 2.4 Selection and deep links

`useTaskSelection(card)` (inside `GuideCard`) holds `{ selectedId, foldOpen }`:

- Initial: if `location.hash` names a task of this card → that task, and `foldOpen = true` when it
  is folded; else the first visible task.
- Effect on `location.hash`: same rule, applied when the hash changes (a palette hit while the
  page is open, a pointer link from another chapter).
- `card.tasks.length === 0` → no rail, no detail (prose cards).

`src/guide/anchors.ts` gains `cardOf(id: string): string | undefined` (a card id maps to itself;
a task id to its card) built in `buildAnchorIndex` alongside `chapterOf`.

### 2.5 Layout

- `.guide-md { display: grid; grid-template-columns: minmax(240px, 34%) minmax(0, 1fr); gap: 1.25rem 1.75rem; align-items: start }`.
- `@media (max-width: 1000px) { .guide-md { grid-template-columns: 1fr } .guide-detail-col { position: static } }`
  — the detail follows the rail in DOM order (a simplification of the mockup's "under the selected
  row": the rows are one line each, so the detail is never far).
- The 72ch measure stays on `.guide-steps`, `.guide-watch`, `.guide-task-watch`, `.guide-purpose`,
  `.guide-body` — now inside the detail column, beside the rail, so the card's width is used.

## 3. One card at a time: `CardSelector` (lane L1)

- `GuideChapter.selector?: boolean` — set `true` on `pages` and `reference` in `src/guide/content.tsx`.
- `GuidePage` renders, for a selector chapter, `<CardSelector chapter selectedId onSelect />` and
  **only the selected card** (`<GuideCard key={card.id} card={card} />`); for other chapters, every
  card stacked as today. `GuidePageChips.tsx` is deleted.
- `CardSelector`: `<nav className="guide-selector" aria-label={`${chapter.label} in this guide`}>`
  → `<div role="tablist" aria-label=…>` of `<button type="button" role="tab" className="chip" aria-selected tabIndex>`
  in chapter order; ←/→/Home/End move (and select, `replace`), click selects (`replace`).
- **Selection is the URL hash**: `selectedId = cardOf(hash) ?? chapter.cards[0].id`. Selecting
  navigates to `{ search: location.search, hash: `#${card.id}` }` with `{ replace: true, preventScrollReset: true }`;
  `LocalSections`' arrival effect then scrolls the card under the sticky block and focuses it — the
  behaviour a deep link already has. A hash naming a task selects that task's card (and the card
  selects the task, §2.4).
- Sticky: `.guide-selector { position: sticky; top: var(--sticky-inset, 0px); z-index: 2; background: var(--bg); padding: 0.5rem 0 0.6rem; margin: 0 0 0.25rem }`
  so the chips stay reachable while a tall card scrolls; the card's `scroll-margin-top` accounts
  for the selector's height: `.guide-selector ~ .guide-card { scroll-margin-top: calc(var(--sticky-inset, 0px) + 3.5rem) }`.
- Card swap motion: the newly mounted card gets the house `.card` entrance from `panels.css` for
  free (a mount inside `.page-frame-body`); no extra animation.
- `.chip[aria-selected="true"]` reuses `.chip.active`'s look (text colour, `border-color: currentColor`) —
  `GuidePage.css` states it once for the selector's buttons.

## 4. Anchors, hashes and the palette (unchanged contracts)

`/guide?section=<chapter>#<cardId|taskId>` still addresses everything. The chapter resolves
through `chapterOf` (existing); the card through `cardOf` (new); the task through §2.4. Palette
entries (`/guide?section=<chapter>#<taskId>`) therefore open the chapter, select the card in a
selector chapter, select the task in its rail and focus the row. Pointer tasks and the probe are
unaffected in shape.

## 5. Content restructuring (lane L2)

All in `src/guide/content/*.tsx`; ids stay unique and kebab-case; every new `where` segment and
`**Label**` must pass the fences (they now also cover the checklist, which was unfenced prose).

1. **`start-setup` → 18 numbered tasks.** `numbered: true`; each task: verb-first `title`
   ("Pick a theme and a landing page", "Change the password", "Add the household", "Add the
   accounts", "Add spending categories and their kinds", "Import the workbook", "Enter the first
   month", "Set the price refresh", "Fill the portfolio", "Enter limits and plan assumptions",
   "Create the tax year", "Add paycheck profiles", "Add grants and ESPP offerings", "Add the
   credit cards", "Set the calendar feed", "Take a snapshot", "Seed budgets", "Turn on the
   assistant"); `where` = the on-screen path (e.g. `Settings → Account → Appearance`); 1–3 `steps`
   carrying today's explanation; a `watch` line `Depends on: <n> · <title>` where the order
   matters (people before accounts, kinds before months, import before UI tax edits, three months
   before budgets); `to` = today's link. The card keeps its `purpose`; `body` is dropped.
2. **`routine-tax-season` → 8 numbered tasks** from its ordered list (`numbered: true`), `where`
   the Taxes/Settings path, `to` the page/view link; the three `watch` lines stay on the card.
3. **Fact grids** for prose: `start-organized` (eight facts: sidebar groups; views; the scope row;
   Ctrl K; ⓘ and About this number; the assistant; toasts and Undo; the footer), `start-next`
   (four rhythms), `ref-undo` (five layers), `ref-sandboxes` (five facts), `ref-links` (four) —
   each `body` becomes `<div className="guide-facts">{facts.map(<div className="guide-fact"><h4>…</h4><p>…</p></div>)}</div>`.
   `start-what` keeps its two paragraphs.
4. **Glossary** — the `<dl>` gains `guide-glossary-grid`: term | definition rows across the width.
5. `ref-settings-map` and the Settings-data card keep the table.

## 6. Motion (lane L1, tokens only, all zero under `prefers-reduced-motion: reduce`)

| Interaction | Mechanism | Token |
| --- | --- | --- |
| Chip pick swaps the card | house `.card` entrance on mount (no code) | `--t-enter` |
| Task pick | rail indicator `transition: transform var(--t-nav), height var(--t-nav)` once `data-placed`; detail WAAPI crossfade | `--t-nav`, `MOTION_MS.xfade` |
| Rail arrival | `.guide-rail-row { animation: guide-row-in var(--t-enter) var(--ease-out) both; animation-delay: calc(var(--guide-i, 0) * var(--t-stagger)) }` inside `@media (prefers-reduced-motion: no-preference)`; keyframes `guide-row-in` (opacity 0 → 1, translateY 6px → 0) declared in `GuidePage.css` | `--t-enter`, `--t-stagger` |
| More tasks | `.guide-rail-fold { display: grid; grid-template-rows: 0fr; overflow: hidden; transition: grid-template-rows var(--t-page) var(--ease-out) } .guide-rail-fold[data-open="true"] { grid-template-rows: 1fr }` with an inner wrapper `min-height: 0` | `--t-page` |
| Hover on rows and chips | `transition: background-color var(--t-fast), color var(--t-fast), border-color var(--t-fast)` | `--t-fast` |
| Focus | house ring `outline: 2px solid var(--accent)`; rows `outline-offset: -2px` | — |

`motion.test.ts` forbids literal durations, so every duration above is a token; the reduce block
in `index.css` zeroes them. WAAPI paths gate on `prefersReducedMotion()`.

## 7. Tests and verification

- `GuideCard.test.tsx` (rewrite): rail rows for every visible task with the task's id, first
  selected, detail shows its steps and Go link; clicking a row selects it (aria-selected, detail
  title); ArrowDown/Home/End move selection; `More tasks (N)` toggles `data-open` and the folded
  rows; a `MemoryRouter` entry with `#<foldedTaskId>` selects it and opens the fold; card `watch`
  renders in the detail column; a numbered card shows `1`…; a prose card renders body and no rail;
  the detail's `role="tabpanel"` is labelled by the selected row.
- `CardSelector.test.tsx`: chips as tabs in order; default first; `#page-taxes` selects the Taxes
  chip; `#taxes-fixture` (a task) selects its card; click writes the hash with replace and shows
  that card only; ArrowRight moves.
- `GuidePage.test.tsx` (update): Pages shows one card and the selector; `?section=pages#page-taxes`
  selects Taxes; `#update-close` (Routines, stacked) selects and focuses the rail row; Reference
  uses the selector; the selector is absent when the chapter has no cards; tabs unchanged.
- `guideContent.test.ts`: unchanged rules; the checklist tasks are now inside the fences.
  `anchors.test.ts`: `cardOf`.
- CSS gates: `motion.test.ts`, `tokens.test.ts`, `mounts.audit.test.ts`.
- Probe `tools/probes/guide-v/smoke.mjs` (lane V): unchanged link walk (targets are focused or in
  view — a rail row is focused); add: the Pages chapter renders exactly one `.guide-card`;
  clicking the second chip swaps the card and updates the hash; clicking the second rail row swaps
  the detail title; screenshots per chapter both themes.

## 8. Lanes

| Lane | Branch / worktree | Owns |
| --- | --- | --- |
| L1 components + motion | `guide/l1-md` · `.worktrees/guide-l1` | `src/guide/GuideCard.tsx` (+test), new `TaskRail.tsx`, `TaskDetail.tsx`, `useTaskSelection.ts`, `CardSelector.tsx` (+test), `anchors.ts` (+test), `content.tsx` (`selector: true` on pages/reference), `src/pages/GuidePage.tsx` (+test), `GuidePage.css`, `src/guide/testing/fixtures.ts` (a folded task and a numbered card), delete `GuideTaskList.tsx`, `GuidePageChips.tsx` |
| L2 content restructure | `guide/l2-content` · `.worktrees/guide-l2` | `src/guide/content/start.tsx`, `routines.tsx`, `reference.tsx` |
| V verify | on `main` | gates, probe update + run, screenshots, plan results |

Both lanes branch from main after the lead's pre-commit that adds `GuideCard.numbered?: boolean`
and `GuideChapter.selector?: boolean` to `src/guide/types.ts` (so L2's `numbered: true` compiles
before L1 merges and L1's `selector: true` needs no content-file edit). L1 and L2 touch disjoint
files; merges are conflict-free. Implementers `model: opus`; one reviewer per lane (spec then
quality); local merges; no push; worktree/branch removal at the very end.

## 9. Acceptance

- Pages and Reference show one card at a time; the chip selector is sticky and keyboard-operable;
  the hash carries the card and Back/Forward restore it.
- Every card with tasks is master–detail: rail left (scrollable, numbered where a checklist), detail
  right, sticky while the rail scrolls; folded tasks expand in place; a deep link to any task
  selects it, opens its fold if needed, and focuses its row.
- The setup checklist and tax-season sequence are numbered rails; prose cards use fact grids; the
  glossary is a two-column grid; no card leaves its right half empty at 1440 px.
- Every interaction in §6 animates on tokens and is still under reduced motion; no literal
  duration in any stylesheet.
- All gates green on local main; the probe walk passes with the new checks; nothing pushed.
