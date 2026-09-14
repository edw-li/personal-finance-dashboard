# Lane V — verify the Guide polish on merged main (2026-09-15) — implementation plan

> **For agentic workers:** runs on `main` after L1 and L2 have merged. One Opus worker, task by
> task. No pushes. No deletion of worktrees or branches (the lead does that at the very end).

**Spec:** `docs/superpowers/specs/2026-09-15-guide-polish-master-detail-design.md` §7 (tests and
verification), §9 (acceptance).

**Goal:** prove the polish on merged main — gates green, the probe extended with the master–detail
and selector checks and passing in both themes against the running dev stack, screenshots
eyeballed, results and a morning list recorded.

**State to expect:** uvicorn 8000 (`SCHEDULER_ENABLED=0`) and vite 5173 are running from the main
checkout (vite serves whatever `main` holds through HMR; **restart uvicorn is not needed — no
backend change**); the Docker Postgres container `finance-dashboard-db-1` is up. A dev token
recipe is in `docs/superpowers/plans/2026-09-14-guide-v-verify.md` Task 4 Step 5
(`scratchpad/guide-v/token.txt` may still be valid — re-mint if a request returns 401).

---

## Task 1 — gates on merged main

- [x] `mkdir -p scratchpad/guide-polish-v/gates`, then `npx tsc -b`, `npx eslint .`,
  `npx vitest run 2>&1 | tee scratchpad/guide-polish-v/gates/vitest.log | tail -8`,
  `npm run build 2>&1 | tee scratchpad/guide-polish-v/gates/build.log | tail -4` — record counts,
  the `GuidePage-*.js`/`.css` and `content-*.js` chunk sizes (the CSS grew: rail, selector, grids).

## Task 2 — extend the probe (spec §7)

**File:** `tools/probes/guide-v/smoke.mjs`.

- [x] After the link walk, per theme, add a step `md`:
  1. `goto ${BASE}/guide?section=pages`; assert exactly one `.guide-card` in the visible panel and
     a `.guide-selector [role=tab][aria-selected=true]` whose `aria-controls` equals that card's id.
  2. Click the second selector chip; assert the hash changed to `#<secondCardId>`, exactly one
     `.guide-card` again and its id equals the chip's `aria-controls`.
  3. In that card, read `.guide-detail .guide-task-title` text, click the second `.guide-rail [role=tab]`,
     assert the detail title changed and the clicked row has `aria-selected="true"`.
  4. If the card has a `.guide-rail-more` button: click it, assert `.guide-rail-fold[data-open="true"]`.
  5. `goto ${BASE}/guide?section=start#setup-accounts` (a numbered rail row): assert the row is
     focused or in view and `aria-selected="true"`, and `.guide-rail-num` texts start `1`, `2`, ….
  6. Screenshot `${theme}-md-pages.png` (viewport 1440×900, not full page) and
     `${theme}-md-start.png`.
  Record each as `check(theme, 'md: …', ok, observed)`.
- [x] Keep the existing link walk unchanged (rows keep task ids; `focused || inView` still holds).
- [x] `node --check tools/probes/guide-v/smoke.mjs`; update the README row for `guide-v` (one
  clause: "master–detail and selector checks").
- [x] Commit: `git commit -am "probe(guide): master–detail, selector and numbered-rail checks (polish spec §7)"`.

## Task 3 — run the probe, eyeball, fix

- [x] Token: reuse `scratchpad/guide-v/token.txt` if `curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $(cat scratchpad/guide-v/token.txt)" http://127.0.0.1:8000/api/v1/prefs` is 200; else re-mint per the 2026-09-14 V plan.
- [x] `TOKEN_FILE=scratchpad/guide-v/token.txt SMOKE_OUT=scratchpad/guide-polish-v node tools/probes/guide-v/smoke.mjs 2>&1 | tail -20` → `GUIDE SMOKE OK`. A failure in the link walk is a content `to` that no longer lands (fix in the content file); a failure in `md` is a renderer bug (fix in `src/guide/*`, with a test).
- [x] Eyeball with the Read tool: `dark-md-pages.png`, `light-md-start.png`, and one 1920-wide
  screenshot of the Reference glossary (`page.setViewportSize` in a one-off, or the probe's chapter
  shots). Judge: the rail and detail share the width with no empty right half; the selector is
  sticky and legible; rows readable; the glossary grid aligned; nothing past 72ch in the detail.
  Fix only page-only CSS in `GuidePage.css`; record anything structural for the morning list.
- [x] Commit fixes: `git commit -am "fix(guide): <what the probe or the eyeball found> (polish V)"`.

## Task 4 — results

- [x] Re-run Task 1's gates; append `## Results (lane V, <date>)` to this plan: gate table, probe
  outcome (link visits, md checks, writes blocked, console errors), screenshots list, fixes,
  deviations, **morning list** (delete `.worktrees/guide-l1`, `guide-l2` and branches `guide/l1-md`,
  `guide/l2-content` — the lead does it; push/deploy decision unchanged from the 2026-09-14 batch;
  Phase 2/3 pointers stand).
- [x] Commit the plan documents: `git add docs/superpowers/plans/2026-09-15-guide-*.md && git commit -m "docs(plans): guide polish — lane results, gates and the morning list"`.

## Acceptance (spec §9) — tick with evidence

- [x] Pages and Reference show one card at a time; selector sticky and keyboard-operable; hash carries the card.
- [x] Every task card is master–detail with a scrollable rail, sticky detail, in-place fold, deep-link selection.
- [x] Setup checklist and tax season are numbered rails; prose cards use fact grids; glossary is a grid; no empty right half at 1440.
- [x] Interactions animate on tokens; `motion.test.ts` green.
- [x] Gates green on local main; probe green; nothing pushed.

## Hand-offs collected by the lead (do these in Task 2 before running the probe)

From lane L1 (`guide/l1-md`), three probe fixes in `tools/probes/guide-v/smoke.mjs` — none are
lane bugs:

1. The "four chapter tabs" check must scope to `nav[aria-label="Guide chapters"] [role="tab"]`:
   selector chips and rail rows are `role="tab"` now, and the Start-here checklist renders rows
   in the first chapter.
2. `details.guide-more` matches nothing any more — the fold is `button.guide-rail-more`
   (click it; the fold is `.guide-rail-fold[data-open="true"]`).
3. A selector chapter renders ONE card and the detail shows ONE task's `Go →`, so the link walk
   cannot collect every link from the visible panel. Iterate: for each selector chip, click it,
   then for each rail row (open the fold first) click it and collect the detail's links plus the
   card's `Open … →`; for stacked chapters, walk each card's rows the same way. Alternatively read
   `GUIDE` through a small vitest-free helper — but the DOM walk is the one that proves the UI.
   Keep the collected-link count ≥ the previous run's 74 unique hrefs (more now, since the
   checklist and tax season became linked tasks).

Also from L1's Results: `selectedCardId` is exported from `CardSelector.tsx` (one sanctioned
react-refresh warning, 26 total now); the numbered fixture card is `routine-checklist`, not
`routine-monthly` — irrelevant to the probe (it walks real content).

---

## Results (lane V, 2026-09-14)

**Status: DONE.** Three commits on local `main`, cut from the merge of both lanes (`acf738b`).
Gates green, the probe green in both themes, screenshots eyeballed, one page-only CSS fix shipped.
Nothing pushed; no worktree, branch, container or database touched.

| Commit | What |
| --- | --- |
| `d869d44` | `probe(guide): master–detail, selector and numbered-rail checks (polish spec §7)` |
| `289d4c9` | `probe(guide): walk the addresses the selector chips select, and record the harvest inventory` |
| `f153ee0` | `fix(guide): cap the glossary term column so short terms are not half a screen from their definitions (polish V)` |

### Task 1 / Task 4 gates (run twice, before and after the fix; logs in `scratchpad/guide-polish-v/gates/`)

| Gate | Before | After |
| --- | --- | --- |
| `npx tsc -b` | clean | clean |
| `npx eslint .` | 0 errors, 26 warnings | 0 errors, 26 warnings |
| `npx vitest run` | 233 files / 3126 tests passed | 233 files / 3126 tests passed |
| `npm run build` | built in 9.48 s | built in 8.33 s |

The 26 eslint warnings are all `react-refresh/only-export-components`: 25 pre-existing plus L1's
sanctioned `selectedCardId` export (its D3). `lint` is a bare `eslint .`, so warnings do not fail.

Chunk sizes after the fix: `GuidePage-*.css` **5.25 kB** (gzip 1.56) — the rail, the selector, the
fact and glossary grids and the motion block; `GuidePage-*.js` **7.69 kB** (gzip 3.02);
`content-*.js` **111.24 kB** (gzip 32.95). The page CSS is the only chunk that moved materially;
the content chunk absorbed the 26 new tasks without growing, because the two numbered cards dropped
their `body` prose in exchange.

**One flake, not a regression:** the first post-fix full run had
`SettingsPage.test.tsx > warms a task's data on tab hover or focus, once` fail on
`expected "spy" to be called 1 times, but got 0 times`. That file alone passed (47/47) and the next
full run passed 3126/3126. It touches nothing in this batch; recorded on the morning list.

### Task 2 — the probe (`tools/probes/guide-v/smoke.mjs`)

The three hand-offs applied, plus the `md` step:

1. The "four chapter tabs" check is scoped to `nav[aria-label="Guide chapters"] [role="tab"]`.
2. `details.guide-more` is gone; the harvest clicks `button.guide-rail-more` and waits for
   `.guide-rail-fold[data-open="true"]`.
3. The link walk **drives the UI** instead of scraping one panel: per chapter it clicks every
   selector chip, and inside every card opens the fold and clicks every rail row (`#<taskId>`,
   waiting for `.guide-detail[aria-labelledby="<taskId>"]`), collecting the detail's links and the
   card's `Open … →` at each step. `PANEL` is now `.guide-page .local-section-panel:not([hidden])`,
   not `[role="tabpanel"]:not([hidden])` — since the polish, `.guide-detail` is a tabpanel too and
   an inactive chapter stays mounted behind `hidden`, so the old selector reached into both.
4. New `md` step per theme (spec §7), all five green in both themes: one card in Pages named by the
   selected chip · the second chip swaps the card and writes `#page-net-worth` · the second rail row
   swaps `.guide-task-title` and takes `aria-selected` · `More tasks` opens the fold (3 folded rows)
   · `?section=start#setup-accounts` lands focused, `aria-selected="true"`, with `.guide-rail-num`
   reading `1…18` in order.
5. Screenshots added: `${theme}-md-pages.png`, `${theme}-md-start.png` (1440×900 viewport, not full
   page) and `${theme}-md-glossary.png` (1920×1080) — the glossary is Reference's **last** card, so
   no chapter shot ever reached it.
6. `node --check` clean; the `guide-v` row in `tools/probes/README.md` restated.

**Deviation D1 — the "at least 74 unique hrefs" floor needed a different mechanism, not a lower
number.** The UI walk harvested **62**. That is not a gap in the harvest: a static sweep of every
`to:` and `to="` in `src/guide/content/*` yields exactly the same 62, and the diff against the
2026-09-14 run's 74 is exactly the twelve `?section=pages#page-*` addresses — the deleted
`GuidePageChips` row, which linked them as `<a href>`s and is now a tablist of `<button>`s with no
href to scrape. Lowering the floor would have quietly stopped proving those twelve land, so instead
the harvest adds `/guide?section=<chapter>#<chip aria-controls>` for every chip. That restores the
twelve, adds Reference's eight (which never had a chip row), and keeps `MIN_LINKS = 74` meaningful:
**81 distinct destinations, all walked, all green.** The report now also carries
`destinations.<theme> = { cards, rows, chips, hrefs }`, so a harvest that silently stops walking
shows up in the record instead of passing as a count.

### Task 3 — the run

`TOKEN_FILE=scratchpad/guide-v/token.txt SMOKE_OUT=scratchpad/guide-polish-v node tools/probes/guide-v/smoke.mjs`
→ **`GUIDE SMOKE OK — 162 link visits, 20 checks, 8 writes blocked`**. The 2026-09-14 token was
still valid (`/api/v1/prefs` → 200); no re-mint.

| | dark | light |
| --- | --- | --- |
| cards driven | 28 | 28 |
| rail rows clicked | 195 | 195 |
| selector chips clicked | 21 | 21 |
| distinct destinations | 81 | 81 |
| link visits, all ok | 81 | 81 |
| checks, all ok | 10 | 10 |

28 cards is every card in the guide (4 + 3 + 13 + 8), so the walk left nothing unopened.
**Console errors: 0.** **Writes blocked: 8** — four per theme, all `POST /api/v1/paycheck/preview`
and `POST /api/v1/taxes/what-if`, the two pages the walk visits that compute a preview on arrival.
Nothing persisted, nothing to sweep.

Screenshots (22, in `scratchpad/guide-polish-v/`):
`{dark,light}-{start,routines,pages,reference}-{1440,1920}.png` (full page, pristine chapter —
first card, first task, folds shut) plus `{dark,light}-md-{pages,start,glossary}.png`.

#### Eyeball

- **`dark-md-pages.png` / `light-md-pages.png` (1440):** the rail and the detail share the width —
  rail about 391 px, the detail fills the rest, `Watch out` under the steps; no empty right half.
  The chips wrap to two rows and stay legible in both themes; the selected chip carries
  `border-color: currentColor` and reads clearly in light. The accent indicator marks the selected
  row; the fold reads `FEWER TASKS` once open.
- **`light-md-start.png` / `light-start-1440.png`:** the 18-row checklist rail is numbered `1…18`
  with the selected row's pill in `--accent`, and `?section=start#setup-accounts` lands on row 4,
  focused. The eight `start-organized` fact tiles and the four `start-next` tiles sit two-up and
  aligned.
- **`{dark,light}-md-glossary.png` (1920):** term | definition rows across the full width, every row
  aligned — after the fix below.
- **`dark-reference-1440.png`, `dark-routines-1440.png`, `dark-pages-1920.png`:** balanced columns
  everywhere; at 1920 the steps stop at the 72ch measure (about 1470 px of 1880 available), so
  nothing stretches.

#### The one fix

**`.guide-glossary-grid` term column: `minmax(12rem, max-content)` → `fit-content(24rem)`.**
Measured in the browser: the ONE longest term (the six review states) set the column to **658 px**
at 1920, so every short term — "Living spending", "Retired", "Focal year" — sat about 570 px from
its own definition. `fit-content(24rem)` caps it at **384 px**; the one over-long term wraps to two
lines instead of pushing all eighteen definitions to the right. Page-only CSS in `GuidePage.css`,
exactly the L2 hand-off's "the glossary's longest term sets the width of the term column". No test:
the change is presentational, the DOM and the classes are untouched, and the repo's CSS gates
(`motion.test.ts`, `tokens.test.ts`) assert durations and tokens, not grid templates.

#### One diagnosis that turned out to be a screenshot artifact — read this before the next eyeball

The setup rail shows 11 of its 18 rows (`clientHeight` 630 against `scrollHeight` 1025), and in
every screenshot the eleventh row ends on a clean edge with nothing to say seven more exist — it
reads as a list that simply stops at 11. I wrote a `scrollbar-width: thin` + `scrollbar-color` fix
for it, then measured instead of trusting the image: **headless Chromium draws no scrollbar at all**
(a probe div with `overflow-y: scroll` reports a 0 px gutter headless, 15 px headed). Headed Edge
gives the rail a 15 px laid-out scrollbar — the affordance is already there and always was. The fix
was reverted; only the comment on `.guide-rail` survives, warning the next reader that this rail
cannot be judged from a headless shot. **Nothing to do here.**

#### Acceptance (spec §9)

- **Pages and Reference show one card at a time; selector sticky and keyboard-operable; the hash
  carries the card** — probe `md` checks 1 and 2, both themes; the keyboard is L1's
  `CardSelector.test.tsx` (manual activation after its review round).
- **Every task card is master–detail with a scrollable rail, sticky detail, in-place fold, deep-link
  selection** — probe `md` checks 3, 4 and 5; 195 rail rows across 28 cards driven per theme, each
  swapping `.guide-detail[aria-labelledby]`; the rail measured at a 630 px scrollport over 1025 px
  of rows.
- **The setup checklist and tax season are numbered rails; prose cards use fact grids; the glossary
  is a grid; no empty right half at 1440** — `md` check 5 reads `1…18` in order;
  `dark-routines-1440.png` shows tax season `1…8`; the fact grids and the glossary grid are
  eyeballed above. Two cards do leave the right side of one band empty by design, noted below.
- **Interactions animate on tokens; `motion.test.ts` green** — inside the 3126.
- **Gates green on local main; probe green; nothing pushed** — above.

### Deviations

- **D1** — the destination floor, above: `MIN_LINKS` stays 74 and the chips' addresses are walked
  explicitly, rather than the floor being lowered to 62.
- **D2** — the `md` screenshots are taken in the plan's order (after the fold opens), and one extra
  shot, `${theme}-md-glossary.png`, was added: Task 3's eyeball asks for "one 1920-wide screenshot
  of the Reference glossary", and no chapter shot reaches it now that Reference shows one card.
- **D3** — the chapter screenshots are now taken *before* the harvest drives the chapter, so they
  photograph the page a reader meets (first card, first task, folds shut). The 2026-09-14 probe
  opened the `<details>` folds first; with the fold inside the rail that is no longer the state
  worth photographing.

### Morning list

1. **Lead's cleanup (not done here, by instruction):** delete `.worktrees/guide-l1`,
   `.worktrees/guide-l2` and the branches `guide/l1-md`, `guide/l2-content`.
2. **Push/deploy decision unchanged** from the 2026-09-14 batch: local `main` is ahead and nothing
   has been pushed. This batch is frontend-only — no migration, no backend change, no API change —
   so a deploy is a build and a static swap.
3. **Eyeball in a HEADED browser, not from the shots:** `/guide?section=start` — the setup rail's
   scrollbar and its seven hidden rows. Everything else is faithful in the screenshots.
4. **Two cards keep an empty right half by design, if that still grates:** `start-what` (spec §5.3
   deliberately keeps its two paragraphs instead of a fact grid) and any card whose `body` prose
   sits above the rail at the 72ch measure (`routine-health`, `ref-links`). Both are content
   decisions in `src/guide/content/*`, not CSS.
5. **The sticky detail leaves the right column empty below itself** when a long rail meets a short
   task (`start-setup`: an 18-row rail beside a 114 px detail). Inherent to spec §2.3's sticky
   detail; a "Next step →" affordance under the detail would fill it and help a first-time reader
   walk the checklist. Product decision, Phase 2 material.
6. **Flake to watch:** `SettingsPage.test.tsx > warms a task's data on tab hover or focus, once`
   failed once in about 470 test-file runs today and passed alone and on re-run. Unrelated to the
   Guide.
7. **Phase 2/3 pointers stand** (predecessor spec): per-page "Guide" links in title rows, and
   assistant how-to context.
8. Dev servers left running, as the house convention asks: uvicorn 8000 (`SCHEDULER_ENABLED=0`),
   vite 5173, Docker Postgres `finance-dashboard-db-1`. `scratchpad/guide-v/token.txt` is still
   valid. Probe output and gate logs are in `scratchpad/guide-polish-v/` (gitignored).
