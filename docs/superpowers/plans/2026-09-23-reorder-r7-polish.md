# Lane R7 — two polish fixes to the shared drag-to-reorder component (2026-09-23) — plan and results

**Branch:** `feat/reorder-polish` (worktree `.worktrees/reorder-r7`), cut from local `main` @0dadccc4.
Not pushed. **Spec:** `docs/superpowers/specs/2026-09-23-drag-to-reorder-design.md` §2.3.5 and §2.5,
both amended by this lane. **Why:** lane V's findings 1 and 2 (the morning list of
`2026-09-23-reorder-v-verify.md`; its evidence is in `.worktrees/reorder-v/scratchpad/reorder-v/`).

## What

### Fix 1 — under reduced motion the drop line never hides under the row in hand (moderate, a11y)

**Before.** The landing edge was an inset box-shadow in the target peer's cells. The lifted row follows
the pointer at `z-index: 2` and covered it for 44–53% of each slot's travel (lane V's sweep).

**Now.**
- The line is ONE `<div class="reorder-drop-line" aria-hidden="true">` on `<body>`. The drag makes it
  lazily at its first landing slot, and never with motion allowed.
- It is `position: fixed`, 2px, and centred on the target edge: the first row's top for a move up,
  the last row's bottom for a move down (`reorderDom.ts`: `createDropLine`, `placeDropLine`).
- Its left and width come from the target row's rect, clipped by any ancestor that actually scrolls
  sideways and by the window (`visibleSpan`). Those ancestors are resolved once, at lift
  (`sideClipsOf`, review 7).
- It is hidden while the edge is outside the scroller's visible band (`visibleBounds`, which now
  starts below a sticky header), and when the drag is back home.
- It is re-placed on every paint. The keyboard path now paints after its keep-in-view scroll, so the
  line is measured where the rows then stand.
- Every scroll re-places it through one window capture listener (replacing the scroller's own), and
  the listener acts only for the live drag (review 2). A pointer drag re-tracks on every scroll —
  since review 6 that includes the page scrolling under a Settings box — and a keyboard lift
  re-places its line.
- Under forced colors (Windows High Contrast) it takes `Highlight` (review 8).
- `releaseDrag` removes it, and every way out passes through there: drop, cancel, hard reset, unmount.
- `data-reorder-drop` stays on the target's edge row; it is the tested contract and the probe reads
  it. Nothing styles it any more: the box-shadow rules, pinned-cell variants included, are deleted.
  The Settings and ledger pins on those rules now say the line runs over the pinned cell.
- **Its layer** (`dropLineLayer`): one above its own list. That is the highest z-index among the
  row's positioned ancestors, and never below the row in hand's (`LIFTED_LAYER` = 2). So it is 3 in
  the page (over the lifted row and the sticky headers' 1) and 21 inside the Customize popover (20).
  See decision 1.

### Fix 2 — the auto-scroll zone starts below a sticky header (minor)

**Before.** `visibleBounds` measured from the scroller box's top. The `.settings-scroll` and
`.categories-scroll` tables pin their `thead th` cells (30–46px), so the stop left the range's first
row, or the Accounts group heading, under the header. At 1280, Categories & weights stopped 5px short.

**Now.**
- `stickyHeaderOf(row, scroller)` resolves, once at lift, what sticks of the lifted row's own table
  header inside the scroller: the thead, or its cells (reviews 4 and 7). `headerBottom` measures it
  where it stands now.
- `visibleBounds`' top is `max(box top, header bottom)`, clipped to the window. So the zone, the
  range-end stop and the drop line's band all count from where the rows show.
- `ensureVisible` keeps the keyboard's landing slot the edge margin clear below the header too
  (`stickyInset`).

## Decisions and deviations from the brief

1. **No fixed z-index.** The brief asked for one z-index above every page layer. `panels.css` says
   `.page`'s container query makes it a stacking context, so the first cut used z-14. Edge disagrees:
   `container-type` applies no layout containment there, so the Customize popover's z-20 is a root
   layer.
   - Measured with a read-only hit test over the open popover: a fixed bar on `<body>` loses to the
     popover's fieldset at z 1–19 and wins from 20 up.
   - The probe's first Overview trial saw the z-14 line covered in 24 of 24 held samples, with 5%
     accent pixels in the held shot.
   - One number above 20 would lift every other list's line over the sticky scope row (8), the
     assistant drawer (15) and the dock (16). The assistant overlays a live page (it is non-modal).
   - So the line takes one layer above its own list instead.
   - The `panels.css` comment is left as it was (not this lane's file) and is flagged below.
2. **The header is measured on the sticky cells, not `thead.getBoundingClientRect()`.** When only
   the cells stick, the row group's own box never moves. The probe recorded the thead's box at
   −605/−505 while the cells' bottom stood at 236/336 (Accounts, 1280/1600). The brief's formula
   would have added no inset once the box scrolled.
3. **`keepOnScreen` gets no inset.** The header rides in the box and a page scroll moves both
   alike, so the slot stays the margin clear of it that `ensureVisible` left.
4. **Added:** the sideways clip (`visibleSpan`) and the window capture scroll listener. A fixed
   overlay must follow any scroll, and must not spill past a sideways-scrolling box.
5. **The probe re-check ran the whole dark walk**, all six lists at both widths, rather than only
   the four parts asked for. This covers the asked parts and every other list's reduced-motion step.

## Evidence

**Unit** (jsdom, mocked rects and computed styles):
- `reorderDom.test.ts`:
  - the header band: cells, a sticking thead, no sticky header, partly off-window;
  - `stickyInset`, and `ensureVisible` under a header;
  - `visibleSpan`, `createDropLine`, `placeDropLine` (before and after, and hidden under a header or
    past the window);
  - `dropLineLayer`.
- `useReorder.test.tsx`:
  - the overlay's top, left and width for before and after; it moves with the slot and hides back
    home;
  - measured after the keyboard's keep-in-view scroll, and re-placed on a later scroll;
  - hidden under a sticky header while the attribute still marks the slot;
  - its layer: 3 in the page, 21 in a z-20 box;
  - gone after a drop, a cancel, a hard reset and an unmount, plus an `afterEach` guard that no test
    leaves one;
  - never created with motion allowed (a MutationObserver);
  - auto-scroll under a 60px header stops at 360, not at 404, where the row sat 4px under it.
- Each fix's tests were checked against a mutation of the code: no header inset; paint before the
  scroll; no re-place on scroll; the line outliving its drag. Every mutation turned tests red.

**Browser** — `tools/probes/reorder-v/smoke.mjs`, dark, 1600 and 1280, a fresh `finance_reorder_scratch`:
- **Result:** `REORDER SMOKE OK — dark: 632 checks`, with 0 failed and 86 noted.
  - 632 = lane V's 604, plus 24 sweep checks (6 lists × 2 widths × 2), plus 4 stop checks.
  - Page writes 72, blocked 0. 24 logged reorders and 14 Undos.
  - 51 page loads, page CLS ≤ 0.002, 0 console warnings, the same two expected 409s as lane V.
  - Artifacts are in `scratchpad/reorder-r7/dark/` (gitignored).
- **Drop line:** visible in **395 of 395** held samples that had a landing slot (100%), over all six
  lists at both widths.
  - In 144 of them the row in hand spanned the line's y. That is where the old in-cell line hid.
  - Customize: 24/24 at each width, 10 of them under the row in hand.
  - Categories: 33/33 at each width, 12 under the row in hand.
  - Every held shot has a pixel row in the accent across the whole line (100%).
  - Escape leaves no line behind.
- **Auto-scroll stops:**

  | Box | Width | scrollTop | Where the row in hand rests |
  |---|---|---|---|
  | Categories & weights | 1280 | 510 → **0** (the box's own top) | flush under the 46px header (291–337 / 337–384); lane V stopped at 5, 5px under it |
  | Categories & weights | 1600 | 407 → 0 | flush under the header (491–522 / 522–565) |
  | Settings › Accounts | 1280 | 841 → **711** | 41px below the header; the Taxable heading in full at 240–277 under the header's 236 |
  | Settings › Accounts | 1600 | 841 → 711 | 41px below the header; Taxable at 340–377 under 336 |

  The header is on top, and the overlap is 0 at every stop.

## Gates (the tip, run in order, nothing else running)

- `npx vitest run --maxWorkers=2`: **267 files / 3889 tests passed**, exit 0, in 291s. Lane V's tip
  had 3869.
- `npx tsc -b` exit 0. The no-cache `tsc -p tsconfig.app.json` and `tsc -p tsconfig.node.json` also
  exit 0. (`node_modules` is a junction, so `-b`'s build info is shared with the main checkout.)
- `npx eslint .`: 0 errors, the base's 26 `react-refresh/only-export-components` warnings, none new.
- `npm run build` exit 0. It prints only the chunk-size advisory lane V recorded as finding 4: the
  lazy echarts chunk at 763.29 kB against the 760 kB limit, byte-identical to the tip before this lane.

## Commits

- `ed03cd8d` fix(reorder): the auto-scroll zone and the keyboard's keep-in-view start below a
  box's sticky header
- `1236468c` fix(reorder): reduced motion draws its drop line as one overlay the row in hand can
  never cover
- `6d42589b` fix(reorder): the drop line takes one layer above its own list — .page is not a
  stacking context
- `01565ae2` test(probes): reorder-v — the drop line swept and hit-tested in every held sample; the
  stop judged below the sticky header
- `093d57da` docs(spec): §2.3.5 and §2.5 amended
- `a88467d2` this note
- the review round, in order:
  - `bcd8e858` (2)
  - `28eb55f8` (6)
  - `5b9f7fe3` (7)
  - `c0bb3586` (4)
  - `95f54a5c` (3)
  - `4c1fca9f` (1)
  - `d60061ac` (8)
  - `23213da4` (5)
  - `8437e8e0` (9)
  - and this update.

## For the controller

1. **`panels.css` `.page` comment (pre-existing, not this batch):** it says the container query makes
   `.page` a stacking context, so "no z-index on any descendant can lift it over the dock (16), the
   palette (20) or toasts (30)". In Edge it is not one. `.popover-surface` (20) competes in the root
   with the drawer (15) and the dock (16), and outranks both. That was measured on the Customize
   popover; the month-actions popover shares the class, so it is inferred there. That comment and
   `OverviewPage.css`'s note that leans on it deserve a correction.
   - **Do NOT "fix" this by making `.page` a stacking context** (`isolation: isolate`, `contain`, …)
     on its own. The whole page, PageFrame's sticky scope row included, would then paint as one root
     layer beneath the drop line on `<body>`. The line at 3 or 21 would cover the scope row and the
     bubbles, and from 21 up the drawer and the dock.
   - Such a change must move the line inside `.page` with it. `dropLineLayer` assumes `.page` is not
     a stacking context and cannot see one made without a z-index; its comment and `reorder.css` say
     so (R7 review 1).
2. **Residual (pre-existing):** a page-scrolled list (the ledger, the card roster, Customize) has no
   sticky header in its band. The page's own sticky scope row is not counted: the page's auto-scroll
   zone and the keyboard's keep-in-view measure from the window's top, and the row can come to rest
   under the scope row. The drop line for such a list sits at layer 3, under the scope row (8), so it
   is covered there as the row is, and never drawn over the chrome. `--sticky-inset` (PageFrame's
   published scope-row height) is the hook for a later fix.
3. **Not covered:** a list inside a modal `<dialog>` (the top layer) would need the line appended to
   that dialog. There is none today; spec §2.5 records it as a limit (review 5).

## Review round (R7 review: approve after fixes)

One commit per item, tests first where behaviour changed. Each red-first test was run failing before
its fix.

| # | Item | Commit | What changed |
|---|---|---|---|
| 1 | Plan note: `isolation: isolate` | `4c1fca9f` | The note now warns against making `.page` a stacking context unless the line moves inside it. The assumption is stated in `dropLineLayer`'s comment and in `reorder.css`. |
| 2 | Scroll-listener guard | `bcd8e858` | `onScroll` acts only when `machine.current.drag === drag`. Test: with the window keeping every scroll listener (as if detach never ran), a scroll after a reduced-motion drop, and after a cancel, leaves no line and no transform. Red before: the kept listener re-made the line. |
| 3 | `dropLineLayer` comment | `95f54a5c` | Corrects the flex/grid statement and names the heuristic's limits: a flex or grid item's z-index, and contexts made by opacity, transform, filter, isolation, containment or a mask. |
| 4 | Header from the row's own table | `c0bb3586` | `stickyHeaderOf(row, scroller)` uses `row.closest('table').tHead`, only when it is inside the scroller. Tests: two tables in a box (red before); a scrolling tbody under its header. |
| 5 | Spec | `23213da4` | §2.3.5: the group heading clears the header only because the 40px margin exceeds its ~37px. §2.5: forced colors, a modal `<dialog>`, and the `.page` reliance. |
| 6 | Pointer re-tracks on every scroll | `28eb55f8` | Fixes the older drift when the page scrolls under a Settings box. Test: the box rises 30px under a still pointer and the row follows, 50 → 80px. Red before: it stayed at 50. |
| 7 | Resolve once at lift | `5b9f7fe3` | `stickyHeaderOf` and `sideClipsOf` run in `lift`; the drag carries `header` and `clips` (a `ListFrame`). Frames and moves read rects alone. Test: after lift, five moves and half a second of auto-scroll read 0 computed styles (98 before). |
| 8 | Forced colors | `d60061ac` | `@media (forced-colors: active) { .reorder-drop-line { background: Highlight } }`, pinned. Measured first in Edge's emulation: the accent line painted as the canvas colour (white on white), while `Highlight` is kept (rgb(55, 0, 110) computed and painted). `forced-color-adjust: none` is not needed. |
| 9 | Test gaps (optional) | `8437e8e0` | A two-row sticky header ends at its lower row. Reduced motion under StrictMode draws one line per drag, keyboard and pointer. |

**No browser re-run of the probe.** None of the fixes moves the line in any probed layout:
- 4 and 7 compute the same inputs for every real list (one table per box, the same sticky cells, the
  same clips), are unit-tested, and read rects live as before;
- 6 changes only a pointer drag under a page scroll with an element scroller, which the probe never
  does;
- 2 and 3 do not touch placement;
- 8 applies only under forced colors, and was checked directly in Edge.

**Gates after the review** (the tip; the targeted suites first, then one full run, nothing else running):
- Targeted suites: 14 files / 406 tests. That is the reorder folder, the Settings, ledger and
  Customize consumers, the credit-card page and the CSS pins.
- `npx vitest run --maxWorkers=2`: **267 files / 3899 tests passed**, exit 0, in 283s. The first
  round had 3889; the review adds 10.
- `npx tsc -b` exit 0.
- `npx eslint .`: 0 errors, the base's 26 `react-refresh/only-export-components` warnings, none new.
