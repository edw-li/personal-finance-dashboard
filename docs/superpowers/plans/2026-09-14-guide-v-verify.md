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
