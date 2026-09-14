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

- [ ] `mkdir -p scratchpad/guide-polish-v/gates`, then `npx tsc -b`, `npx eslint .`,
  `npx vitest run 2>&1 | tee scratchpad/guide-polish-v/gates/vitest.log | tail -8`,
  `npm run build 2>&1 | tee scratchpad/guide-polish-v/gates/build.log | tail -4` — record counts,
  the `GuidePage-*.js`/`.css` and `content-*.js` chunk sizes (the CSS grew: rail, selector, grids).

## Task 2 — extend the probe (spec §7)

**File:** `tools/probes/guide-v/smoke.mjs`.

- [ ] After the link walk, per theme, add a step `md`:
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
- [ ] Keep the existing link walk unchanged (rows keep task ids; `focused || inView` still holds).
- [ ] `node --check tools/probes/guide-v/smoke.mjs`; update the README row for `guide-v` (one
  clause: "master–detail and selector checks").
- [ ] Commit: `git commit -am "probe(guide): master–detail, selector and numbered-rail checks (polish spec §7)"`.

## Task 3 — run the probe, eyeball, fix

- [ ] Token: reuse `scratchpad/guide-v/token.txt` if `curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $(cat scratchpad/guide-v/token.txt)" http://127.0.0.1:8000/api/v1/prefs` is 200; else re-mint per the 2026-09-14 V plan.
- [ ] `TOKEN_FILE=scratchpad/guide-v/token.txt SMOKE_OUT=scratchpad/guide-polish-v node tools/probes/guide-v/smoke.mjs 2>&1 | tail -20` → `GUIDE SMOKE OK`. A failure in the link walk is a content `to` that no longer lands (fix in the content file); a failure in `md` is a renderer bug (fix in `src/guide/*`, with a test).
- [ ] Eyeball with the Read tool: `dark-md-pages.png`, `light-md-start.png`, and one 1920-wide
  screenshot of the Reference glossary (`page.setViewportSize` in a one-off, or the probe's chapter
  shots). Judge: the rail and detail share the width with no empty right half; the selector is
  sticky and legible; rows readable; the glossary grid aligned; nothing past 72ch in the detail.
  Fix only page-only CSS in `GuidePage.css`; record anything structural for the morning list.
- [ ] Commit fixes: `git commit -am "fix(guide): <what the probe or the eyeball found> (polish V)"`.

## Task 4 — results

- [ ] Re-run Task 1's gates; append `## Results (lane V, <date>)` to this plan: gate table, probe
  outcome (link visits, md checks, writes blocked, console errors), screenshots list, fixes,
  deviations, **morning list** (delete `.worktrees/guide-l1`, `guide-l2` and branches `guide/l1-md`,
  `guide/l2-content` — the lead does it; push/deploy decision unchanged from the 2026-09-14 batch;
  Phase 2/3 pointers stand).
- [ ] Commit the plan documents: `git add docs/superpowers/plans/2026-09-15-guide-*.md && git commit -m "docs(plans): guide polish — lane results, gates and the morning list"`.

## Acceptance (spec §9) — tick with evidence

- [ ] Pages and Reference show one card at a time; selector sticky and keyboard-operable; hash carries the card.
- [ ] Every task card is master–detail with a scrollable rail, sticky detail, in-place fold, deep-link selection.
- [ ] Setup checklist and tax season are numbered rails; prose cards use fact grids; glossary is a grid; no empty right half at 1440.
- [ ] Interactions animate on tokens; `motion.test.ts` green.
- [ ] Gates green on local main; probe green; nothing pushed.

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
