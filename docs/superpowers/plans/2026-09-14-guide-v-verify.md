# Lane V — verify the Guide batch on merged main (2026-09-14 guide) — implementation plan

> **For agentic workers:** this lane runs on `main` after G0–G5 have merged. One Opus worker
> executes it task by task; the lead reviews the Results section. Steps use `- [ ]` checkboxes.
> No pushes. No deletions of worktrees, branches or databases — those are the morning's.

**Spec:** `docs/superpowers/specs/2026-09-14-onboarding-guide-design.md` §8.3 (retire
`PENDING_PAGES`), §9 (gates, the browser walk), §5.1 (the cross-link lane V owns), §13 (acceptance).

**Goal:** prove the batch on merged main — every fence live with the escape hatch gone, the
required-coverage assertion green, the cross-chapter links added, the renderer follow-ups the
content lanes reported applied, gates green, and either a real-browser walk of every guide link in
both themes or an explicit, reasoned skip if the dev stack cannot be brought up without a human.

**Architecture:** edits only to `src/guide/**` and the plan documents; the browser walk uses
`tools/probes/guide-v/smoke.mjs` (lane G5) against uvicorn 8000 + vite 5173 on the dev database
(Docker Postgres 5433). Everything is recorded in this plan's Results section.

**Tech stack:** as the other lanes; Docker Desktop, Microsoft Edge headless, playwright-core from
the npx cache, Node 18 spoofed to 20 by the probe.

---

## Mechanics (read once)

- Work on `main` in the main checkout (`C:/Users/edyli/personal-finance-dashboard`), not a worktree.
- Preconditions (verify, do not assume): `git log --oneline -12` shows the six lane merges;
  `git status` clean; `src/guide/content/pending.ts` exists and its array is **empty** (every
  content lane deleted its routes). If a route remains, that lane did not finish — stop and report.
- Commands in Git Bash from the repo root. Long outputs go to `scratchpad/guide-v/` (gitignored).

---

## Task 1 — gates on merged main (before touching anything)

- [ ] **Step 1:** `mkdir -p scratchpad/guide-v/gates && npx tsc -b 2>&1 | tee scratchpad/guide-v/gates/tsc.log | tail -3`
  → silent / exit 0.
- [ ] **Step 2:** `npx eslint . 2>&1 | tee scratchpad/guide-v/gates/eslint.log | tail -5` → only the
  sanctioned `useAuth` react-refresh warning.
- [ ] **Step 3:** `npx vitest run 2>&1 | tee scratchpad/guide-v/gates/vitest.log | tail -8` → all
  green; record files/tests/duration. The required-coverage test still shows as **skipped** here.
- [ ] **Step 4:** `npm run build 2>&1 | tee scratchpad/guide-v/gates/build.log | tail -3` → `✓ built`;
  record the `GuidePage-*.js` chunk size.
- [ ] **Step 5:** backend: `(cd backend && ./.venv/Scripts/ruff.exe check . && ./.venv/Scripts/ruff.exe format --check . && ./.venv/Scripts/python.exe -m pytest tests/test_prefs_registry.py -q) 2>&1 | tail -4` → clean, PASS.

---

## Task 2 — retire the escape hatch (spec §8.3)

**Files:** delete `src/guide/content/pending.ts`; modify `src/guide/guideContent.test.ts`.

- [ ] **Step 1:** Confirm the array is empty: `grep -c "'/" src/guide/content/pending.ts` → `0`.
- [ ] **Step 2:** In `guideContent.test.ts`: remove the `PENDING_PAGES` import; in the completeness
  test drop `&& !PENDING_PAGES.includes(route)`; delete the test titled "a pending route has no
  card yet…"; change `it.skipIf(PENDING_PAGES.length > 0)(` to `it(` in the required-coverage
  describe; update the comment above it ("Skipped until every content lane has landed" → "Live
  since lane V retired the pending list").
- [ ] **Step 3:** `git rm src/guide/content/pending.ts` (a tracked-file removal inside the repo,
  committed — not a filesystem cleanup).
- [ ] **Step 4:** `npx vitest run src/guide` → PASS with the required-coverage test **running and
  green**. If an id is missing, the content lane that owns it (spec §5.1 table) shipped a different
  id — fix the id in that content file (not the list), re-run.
- [ ] **Step 5:** Commit: `git commit -am "test(guide): retire the pending escape hatch — completeness and required-coverage fences are live (spec §8.3)"`.

---

## Task 3 — cross-chapter links and renderer follow-ups (spec §5.1, lane hand-offs)

- [ ] **Step 1: The one cross-link.** In `src/guide/content/start.tsx`, `start-next`'s "Whenever"
  bullet: replace the three sandbox page links' lead-in "A question about the future: the sandboxes
  on …" with "A question about the future: <Link to="/guide?section=reference#ref-sandboxes">the
  sandboxes</Link> on …" (keep the three page links). Add any other cross-chapter anchor a lane's
  Results section explicitly requested, one per line, only where the target id exists.
- [ ] **Step 2: Renderer/CSS follow-ups.** Read the Results → Hand-offs of the five lane plans
  (`2026-09-14-guide-g1…g5`). Apply the CSS requests that are page-only and token-clean to
  `src/pages/GuidePage.css` (expected: `.guide-glossary dt { font-weight: 600; margin-top: 0.5rem }`,
  `.guide-glossary dd { margin: 0 0 0.25rem 0 }`, `.guide-map td { vertical-align: top }`,
  `ol.guide-body li, ul.guide-body li { margin: 0.2rem 0 }`); defer anything structural to the
  morning list.
- [ ] **Step 3:** `npx vitest run src/guide src/pages/GuidePage.test.tsx src/theme/motion.test.ts && npx tsc -b && npx eslint src/guide src/pages/GuidePage.css` → PASS.
- [ ] **Step 4:** Commit: `git commit -am "content(guide): cross-chapter link to the sandboxes card; glossary and map spacing from the lane hand-offs"`.

---

## Task 4 — the browser walk (spec §9 step 3), or its reasoned skip

The dev stack is Docker Postgres on 5433 (`backend/docker-compose.yml`, service `db`), uvicorn on
8000 (`SCHEDULER_ENABLED=0`), vite on 5173. Docker Desktop was **not running** when this plan was
written. Try to bring it up without a human; if it will not come up in ten minutes, skip with a
record — the fences, the page tests and the palette tests are the acceptance the spec names first.

- [ ] **Step 1: Is Docker up?** `docker ps >/dev/null 2>&1 && echo up || echo down`.
- [ ] **Step 2: If down, start Docker Desktop and wait** (no admin prompt is expected for a user
  already in the docker-users group; if a UAC or licence dialog appears, this step cannot proceed
  unattended — go to Step 8):

```bash
powershell -NoProfile -Command "Start-Process -FilePath 'C:\Program Files\Docker\Docker\Docker Desktop.exe'" 2>/dev/null
for i in $(seq 1 60); do docker ps >/dev/null 2>&1 && break; sleep 10; done; docker ps >/dev/null 2>&1 && echo up || echo still-down
```

- [ ] **Step 3: Postgres** — `docker compose -f backend/docker-compose.yml up -d db && for i in $(seq 1 30); do docker compose -f backend/docker-compose.yml ps --format '{{.Health}}' db | grep -q healthy && break; sleep 2; done`
  → `healthy`. (The dev book lives in the `pgdata` volume; nothing is created or dropped.)
- [ ] **Step 4: Backend + frontend** (background, logs in scratchpad):

```bash
(cd backend && SCHEDULER_ENABLED=0 ./.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000 > ../scratchpad/guide-v/uvicorn.log 2>&1 &)
npm run dev -- --port 5173 --strictPort > scratchpad/guide-v/vite.log 2>&1 &
for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:8000/api/v1/system/status && break; sleep 2; done
curl -s -o /dev/null -w 'vite %{http_code}\n' http://localhost:5173/
```

  If `alembic` is behind (the log says a migration is pending), run
  `(cd backend && ./.venv/Scripts/python.exe -m alembic upgrade head)` — this batch adds no
  migration, so this is not expected.

- [ ] **Step 5: Token** (dev seed credentials, dev database only):

```bash
curl -s http://127.0.0.1:8000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"changeme123"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token))" > scratchpad/guide-v/token.txt
wc -c scratchpad/guide-v/token.txt   # ~129 bytes, never 0
```

- [ ] **Step 6: Run the walk** — `TOKEN_FILE=scratchpad/guide-v/token.txt SMOKE_OUT=scratchpad/guide-v node tools/probes/guide-v/smoke.mjs 2>&1 | tail -20`
  → `GUIDE SMOKE OK`. On failure, read `scratchpad/guide-v/report.json`: a link problem is a
  content bug (fix the `to` in the content file, re-run the fences, re-run the probe); a console
  error on `/guide` is a renderer bug (fix, test, re-run). Record every fix.
- [ ] **Step 7: Eyeball the screenshots** — open `scratchpad/guide-v/dark-pages-1440.png` and
  `light-start-1920.png` (the Read tool renders PNGs): eyebrows, task titles, steps and Go links
  legible in both themes; the chip row wraps sanely; no card stretches text past ~72ch. Note anything
  off in Results; fix only page-only CSS.
- [ ] **Step 8: If Docker never came up** — write in Results: "Browser walk skipped: Docker Desktop
  not running and could not be started unattended (observed: <error>). Acceptance rests on the
  fences (§8), `GuidePage.test.tsx`, `paletteRegistry.guide.test.ts`, the Overview and wizard tests.
  Morning: start Docker Desktop, then run Task 4 Steps 3–7." Leave the servers as they are.

Leave uvicorn and vite running at the end (the owner's convention: dev servers stay up for the
morning eyeball).

---

## Task 5 — final gates and the record

- [ ] **Step 1:** Re-run Task 1's four frontend gates (tsc, eslint, vitest, build) and record counts.
- [ ] **Step 2:** Append `## Results (lane V, <date>)` to this plan: preconditions observed; gate
  table (tsc, eslint, vitest files/tests, build + Guide chunk size, pytest); the pending retirement
  commit; cross-links and CSS follow-ups applied; browser walk outcome (link count, checks, writes
  blocked = all, console errors = 0, screenshot list) or the skip record; deviations; **morning
  list** — worktrees and branches to delete (`.worktrees/guide-g0…g5`, `guide/*`), the browser
  walk if skipped, Phase 2/3 pointers (spec §12), and the push/deploy decision (prod is at
  `c4a7e2b9d13f`, before the tabbed views the guide describes — deploy the guide with or after those).
- [ ] **Step 3:** Commit the plan documents: `git add docs/superpowers/plans/2026-09-14-guide-*.md && git commit -m "docs(plans): guide batch — lane results, gates and the morning list"`.
- [ ] **Step 4:** Do **not** delete worktrees, branches, containers or databases. Do not push.

## Acceptance (spec §13) — tick each with evidence in Results

- [ ] Sidebar shows **Guide** above **Settings**; palette lists it under Pages and lists guide tasks under **Guide**.
- [ ] `/guide` renders four chapters; every §5.1 card exists with its required tasks; the fences are green with the escape hatch retired.
- [ ] Every guide deep link lands (probe + fence); every bold label exists (fence).
- [ ] An empty Overview shows *Start here*; a zero-account wizard shows the pointer; both absent with data (tests).
- [ ] Gates green on local main; nothing pushed; no database or API behaviour changed beyond `NAV_PATHS`.

## Hand-offs collected by the lead during the night (do these in Task 3)

- **Renderer (from G3):** `GuideCard.tsx` and `GuideTaskList.tsx` render `watch` lines as plain
  text; route them through `renderSteps` so `**Label**` in a watch line renders bold like a step,
  and extend the label fence in `guideContent.test.ts` to cover `watch` lines (card-level and
  task-level) with the same `placeholder` exemption as steps. Add one assertion to
  `GuideCard.test.tsx` (a fixture watch line with `**Example**` renders `b.guide-label`).
- **Product note (from G3), morning list only:** the Paycheck pace row's "enter this year's limit"
  link goes to bare `/settings` (lands on Household) — it should deep-link
  `/settings?section=planning#limits`. Not this batch's file; record for the morning.
- **From G5:** `paletteRegistry.test.ts` now ranks against the real GUIDE; if a pin flips after the
  content merges, apply the ranking rule the G5 review settles on (destination before how-to),
  not a test rewrite. The guide content is statically imported by `paletteRegistry.ts` — the G5
  review's recommendation on lazy loading applies here if it was deferred.

---

## Results (lane V, 2026-09-14)

**Status: DONE.** Three commits on `main` in the main checkout; nothing pushed, no worktree,
branch, container or database touched. The browser walk ran — Docker Desktop and the dev
Postgres were already up — and passed on the first attempt, so no content `to` and no renderer
bug needed fixing.

### Preconditions observed (before Task 1)

- `git log --oneline` showed the six lane merges; HEAD `fb75334`; `git status` clean.
- `src/guide/content/pending.ts` existed with an **empty** array (`grep -c "'/"` → `0`), so every
  content lane had deleted its routes. The §5.4 required-coverage assertion was therefore already
  *running* (`skipIf(false)`), not skipped — the plan's Task 1 note that it would still show as
  skipped was written before the last lane landed.
- Docker Desktop up, `finance-dashboard-db-1` healthy on 5433; ports 8000 and 5173 free.
- Guide content on merged main: **4 chapters · 28 cards · 169 tasks** (6 of them pointers).

### Commits

| SHA | Task | Message |
| --- | --- | --- |
| `9777d83` | 2 | `test(guide): retire the pending escape hatch — completeness and required-coverage fences are live (spec §8.3)` |
| `53d31dc` | 3 | `content(guide): cross-chapter links, watch lines through renderSteps, and the lane hand-offs (spec §5.1, §8.2)` |
| this file | 5 | `docs(plans): guide batch — lane results, gates and the morning list` |

### Gate table

| Gate | Task 1 (merged main, `fb75334`) | Task 5 (final, `53d31dc`) |
| --- | --- | --- |
| `npx tsc -b` | silent, exit 0 | silent, exit 0 |
| `npx eslint .` | 0 errors, 25 warnings (the pre-existing `react-refresh/only-export-components` baseline) | 0 errors, 25 warnings — same files |
| `npx vitest run` | **232 files / 3108 tests passed**, 0 skipped, 112.60 s | **232 files / 3108 tests passed**, 0 skipped, 112.55 s |
| `npm run build` | `built in 8.86s`; `GuidePage` chunk **3.08 kB js + 1.30 kB css** | `built in 8.57s`; `GuidePage` chunk **3.08 kB js + 1.57 kB css** (the four CSS blocks) |
| backend `ruff check` / `ruff format --check` / `pytest tests/test_prefs_registry.py -q` | clean · 318 files formatted · **11 passed** | not re-run — no backend file was touched by this lane |

The test total is unchanged across the lane by arithmetic, not by accident: Task 2 deleted one
test (*a pending route has no card yet*) and Task 3 added one (the real-content palette pin).
Scoped: `npx vitest run src/guide` → 5 files, **23 passed**, the required-coverage assertion
running and green.

### Task 2 — the escape hatch is gone

`src/guide/content/pending.ts` removed with `git rm` (the one deletion this lane was allowed).
`guideContent.test.ts` lost the import, the `!PENDING_PAGES.includes(route)` clause and the
*a pending route has no card yet* test; the completeness test is now titled plainly, and
`it.skipIf(PENDING_PAGES.length > 0)` is a plain `it` with the comment rewritten to say the
fence is live. No id had to be fixed: all 31 required ids were already on main.

### Task 3 — cross-links, renderer, CSS, palette, comment

1. **Cross-chapter links (2).** `start-next`'s "Whenever" bullet now reads "A question about the
   future: *the sandboxes* on Paycheck, Taxes and Projection", with *the sandboxes* linking
   `/guide?section=reference#ref-sandboxes` (G1's hand-off); the three page links are unchanged.
   `ref-sandboxes`' first bullet gained "— the *Projection card* in this guide walks the third",
   linking `/guide?section=pages#page-projection` (G4 hand-off item 4).
2. **Renderer (G3's hand-off).** `GuideCard.tsx` and `GuideTaskList.tsx` render `watch` lines
   through `renderSteps`, so a trap may name a control in bold exactly like a step. The label
   fence in `guideContent.test.ts` now walks steps **and** watch lines, card-level and
   task-level, with the same `placeholder` exemption; `GuideCard.test.tsx` pins the rendered
   `ul.guide-watch b.guide-label`, fed by one new fixture watch line carrying a `**Example**`
   label. The three real labelled watch lines (`No direction`, `Unhide`, `Roll-up` — G4) pass the
   extended fence and now print bold instead of literal asterisks.
3. **CSS (`src/pages/GuidePage.css`), four blocks, tokens only, no durations.**
   `ol.guide-body, ul.guide-body { padding-left: 1.2rem }` and `… li { margin: 0.2rem 0 }` (the
   UA's 40 px was deeper than `.guide-watch`'s 1.1 rem); `.guide-glossary dt { font-weight: 600;
   margin-top: 0.5rem }` and `.guide-glossary dd { margin: 0 0 0.25rem 1rem; color: var(--muted) }`;
   `.guide-map { max-width: 72ch }` and `.guide-map td { vertical-align: top }`.
   `src/theme/motion.test.ts`'s literal-duration sweep and `tokens.test.ts` stay green.
4. **Palette pin (G5's hand-off).** `paletteRegistry.test.ts` gained the real-content pin:
   `matchEntries('add a card', [...buildEntries(…), ...guideEntries().map(e => ({ kind: 'guide', ...e }))])`
   → `guide:cards-add` at rank 0, `to` `/guide?section=pages#cards-add`, and **Guide** is the
   last group. No destination answers "add a card", so the how-to wins outright — the ranking
   rule from the G5 review round is untouched, and `paletteRegistry.ts` still never imports the
   guide (its own bundle-fence test still passes).
5. **Stale comment.** `src/pages/OverviewPage.tsx`'s *Needs attention* comment claimed the card is
   "Absent when nothing needs doing". It is not: the card always renders and prints
   "No outstanding data checks." (or names the feeds that have not answered). Comment rewritten.

### Task 4 — the browser walk (spec §9 step 3)

Dev stack: Docker Postgres 5433 (already healthy, untouched), `uvicorn app.main:app --port 8000`
with `SCHEDULER_ENABLED=0`, `vite --port 5173 --strictPort`. Token from the dev seed login
(129 bytes). Command:
`TOKEN_FILE=scratchpad/guide-v/token.txt SMOKE_OUT=scratchpad/guide-v node tools/probes/guide-v/smoke.mjs`

> `GUIDE SMOKE OK — 148 link visits, 10 checks, 8 writes blocked; report: scratchpad\guide-v\report.json`

- **Link visits: 148** — 74 unique hrefs walked in each theme, **all ok**: same pathname, the
  `?section` tab actually selected (114 of the visits carry one), `#id` target present, and
  **66 of 66 hash links received focus** (none needed the in-view fallback). `#main` non-empty
  everywhere.
- **Checks: 10/10** (5 per theme): sidebar has 14 links with Guide before Settings; theme stamped;
  four chapter tabs *Start here · Routines · Pages · Reference*; the guide renders links; the
  palette answers "add a card" with a **Guide** group.
- **Console errors: 0.** **Writes blocked: 8** — all of them the two sandboxes' read-model POSTs
  (`/api/v1/paycheck/preview` ×4, `/api/v1/taxes/what-if` ×4); nothing persisted.
- **Screenshots: 16** in `scratchpad/guide-v/` —
  `{dark,light}-{start,routines,pages,reference}-{1440,1920}.png`.
- **Content or renderer fixes the probe forced: none.** It passed on the first run.

**Eyeball (Step 7).** The full-page shots are up to 28 168 px tall, so five viewport crops were
taken alongside them (`scratchpad/guide-v/eyeball/`) and read. Dark *pages* at 1440: eyebrow,
purpose, *Do this*, task titles, `Where:` lines, numbered steps with bold labels, task traps,
`Go →`, *Watch out* and the `MORE TASKS (3)` disclosure are all legible; the chip row wraps onto
two lines with no orphan; no prose runs past the 72 ch measure even though the card box is full
width (the house `.card span-12` grammar). Light *start* at 1920: the eighteen-step checklist
reads cleanly at the new 1.2 rem indent and 0.2 rem item spacing; links and bold labels both hold
against the light surface. Light and dark *reference*: the glossary `<dl>` now shows bold terms
with muted, one-step-indented definitions, and the Settings map sits inside 72 ch with top-aligned
cells. Nothing off; no further CSS needed.

Both servers were **left running** (uvicorn 8000, vite 5173) for the morning eyeball.

### Deviations

1. **Three of G4's four cross-chapter anchors are not implementable as asked**, and were not
   forced. `calendar-feed-pointer → #calendar-subscribe`, `calendar-reminder-pointer →
   #calendar-reminder-day` and `assistant-key-pointer → #assistant-key` are *pointer tasks*: their
   only text is a `steps: string[]` entry, which `renderSteps` renders as text and bold labels
   only (no links), and the §8.1 pointer fence requires `to` to be a real destination outside the
   guide. Adding the anchor would mean either putting JSX in a step or pointing a pointer at the
   guide — both against the spec. The three steps already name the card in prose ("the Calendar
   card in this guide walks it"). If Phase 2 wants real cross-links here, the seam is a new
   optional `see?: string` field on `GuideTask`, rendered next to `Go →`.
2. **Task 1's expectation that the coverage test would show as skipped was already stale** — see
   Preconditions. No action; the fence was simply green earlier than the plan assumed.
3. **Task 4 Steps 1–3 were skipped** (Docker and Postgres already up, per the lead's brief);
   ports were checked with `netstat` before starting anything.
4. **The completeness test's title changed** ("…, unless the lane that owns it is still pending" →
   "every sidebar page has a card somewhere in the guide"). Not named in the plan, but the old
   title described a clause that no longer exists.

### Acceptance (spec §13) — evidence

- **Sidebar shows Guide above Settings; palette lists it under Pages and guide tasks under Guide.**
  Probe check *sidebar has 14 links with Guide before Settings* in both themes; probe check
  *palette shows a Guide group for "add a card"*; `paletteRegistry.guide.test.ts` (8 tests) and the
  new real-content pin in `paletteRegistry.test.ts`.
- **`/guide` renders four chapters; every §5.1 card exists with its required tasks; the fences are
  green with the escape hatch retired.** Probe check *four chapter tabs*; `guideContent.test.ts`
  13 tests including the now-live required-coverage assertion over all 31 ids; `pending.ts` gone.
- **Every guide deep link lands; every bold label exists.** 148/148 link visits ok (74 unique,
  both themes); the extended label fence over steps *and* watch lines.
- **Empty Overview shows *Start here*; a zero-account wizard shows the pointer; both absent with
  data.** `OverviewPage.test.tsx` → `describe('OverviewPage Start here (2026-09-14 guide spec §7.1)')`;
  `MonthlyUpdatePage.test.tsx` → `describe('zero accounts (2026-09-14 guide spec §7.2)')`.
- **Gates green on local main; nothing pushed; no database or API behaviour changed beyond
  `NAV_PATHS`.** Gate table above; `main` is 68 commits ahead of `origin/main` (`bc79545`) and was
  never pushed; the only backend file the batch touched is
  `backend/app/services/prefs_registry.py`'s `NAV_PATHS` twin (G0), and its 11 tests pass.

### Morning list

1. **Clean up the batch's scaffolding** (this lane was forbidden to delete anything but
   `pending.ts`): six worktrees `.worktrees/guide-g0 … guide-g5` and the six branches
   `guide/g0-shell`, `guide/g1-start`, `guide/g2-tracking`, `guide/g3-income`,
   `guide/g4-planning`, `guide/g5-integration` — all merged into `main`, so
   `git worktree remove` + `git branch -d` is enough.
2. **Push / deploy decision.** `main` is **68 ahead of `origin/main` (`bc79545`) and not pushed**.
   Prod is at alembic `c4a7e2b9d13f` and, more to the point, is behind the tabbed views and the
   per-page sections this guide describes — **deploy the guide with, or after, those**, or the
   Pages chapter will describe a UI prod does not have. This batch adds **no migration**: it is
   frontend-only apart from the `NAV_PATHS` twin (`/guide` added to the landing-page allow-list),
   so the deploy is a rebuild, not a data step.
3. **Product note carried from G3 (not this batch's file).** The Paycheck pace row's
   "enter this year's limit" link goes to bare `/settings`, which lands on Household; it should
   deep-link `/settings?section=planning#limits`. One `to` in the paycheck pace component.
4. **Phase 2 (spec §12).** `PageFrame` gains an optional `guide?: string` prop → a muted
   `BookOpen` 14 px "Guide" link at the right of the title row, to
   `/guide?section=pages#page-<id>`; thirteen call sites. Also: glossary links from
   `MetricInspector` definitions to `/guide?section=reference#ref-glossary`. And, if cross-links
   from pointer tasks are still wanted, the optional `see?: string` field from Deviation 1.
5. **Phase 3 (spec §12).** The assistant drawer attaches the top-three `fuzzyScore` matches from
   `GUIDE` as client context, with one system-prompt sentence permitting procedural answers from
   those excerpts and their `to` routed through `navLink.ts`.
6. **Eyeball at leisure.** uvicorn 8000 and vite 5173 are running; open `/guide` in both themes.
   G4 flagged two blocks worth a human look: the Projection card's four watch lines, and that
   `settingsMap.tsx` renders **twice** on `/guide` by design (as `page-settings-data`'s body and
   as `ref-settings-map`). If that reads heavy, the Reference copy is the one to keep.
7. **Scratch artefacts** (gitignored, delete whenever): `scratchpad/guide-v/` — gate logs,
   `report.json`, `token.txt`, 16 full-page screenshots and 5 eyeball crops.
