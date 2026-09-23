# Lane V — drag to reorder: the verification lane and the landing gates (2026-09-23) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> implementer for this lane in its own worktree; a spec-compliance and a code-quality review of the
> probe before the controller merges it into `feat/reorder-base` — never main, never pushed). Steps
> use `- [ ]` checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-23-drag-to-reorder-design.md` — this lane implements **§10
"V (verification lane)" and "Final"**, proves the **§9 edge cases** a browser can prove, and runs
the **§11 landing** gates. Read §0, §2 (the component's behaviour), §8 (every visible string), §9,
§10 and §11 before Task 0. Then read the six lane plans
(`docs/superpowers/plans/2026-09-23-reorder-{r0-component,r1-backend,r2-settings,r3-transactions,r4-overview,r5-cards}.md`)
— above all their "Controller amendments", their "Decisions", and their browser-check scripts,
whose selectors and drag shapes this plan reuses verbatim. The spec is authoritative where this plan
is silent.

**Goal:** one tracked browser probe, `tools/probes/reorder-v/smoke.mjs`, that drives a real Edge
with real pointer events through all six reorderable lists in both themes at 1600 and 1280 on the
lane's own stack and a private copy of the real book; the Guide probe's counts brought in line with
lane R5's new Guide task; and, once the quick-fixes batch has completely landed and main is merged
into the integration branch, the full landing gates — backend suite, ruff, a migration drill, the
frontend gates and the probes — with a Results section and a morning list the controller relays.

**Architecture:**
- **One theme per run.** The probe writes, and spec §10 rebuilds `finance_reorder_scratch` from the
  shared read-only `finance_realdata` before each theme. So `ONLY_THEME` is required, a gate refuses
  a copy an earlier pass already wrote to, and Task 1's recipe runs between the two passes.
- **Per width** (1600×1000, then 1280×800) one browser context walks Settings (categories, then
  accounts), Portfolio › Manage, Overview › Customize and Credit Cards (roster, then Categories &
  weights). At the last width it adds the Activity feed.
- **One instrument set for all six lists** (`mouseDrag`, `keyboardMove`, `reducedMotion`,
  `restingLook`, `autoScrollInBox`, `longDrag`). Each reads the `data-reorder*` attributes lane
  R0's hook writes. Every surface-specific step reuses its lane's selectors and flows.
- **A write fence** (one context route) lets the page write only the five reorder PUTs, the change
  log's Undo and the token renewal. `PATCH /prefs` passes with its `overview_layout` key alone,
  everything else is aborted and reported. The walk's own scratch rows are made and deleted over the
  API from node.
- **Its own record:** every logged reorder's `X-Change-Batch` and every Undo's new batch id, so the
  Activity step can prove "one entry per logged reorder" by id rather than by label.

**Tech stack:** node 18 (with the house's version spoof) + playwright-core 1.62.1 from the npx
cache + Edge; Postgres 16 in `finance-dashboard-db-1`; the backend's venv Python for alembic,
uvicorn, pytest and ruff; vitest, tsc, eslint and vite for the frontend gates.

---

## Mechanics (read once)

- **Lane worktree:** `C:/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v`, branch
  `feat/reorder-verify`, cut from `feat/reorder-base` **after lanes R0–R5 are merged into it**
  (spec §11 merge order R1 → R0 → R2 → R3 → R4 → main (with B2) → R5 → V).
  - The controller creates it and makes `node_modules` a **Windows junction** to the main
    checkout's. Never `ln -s` (Git Bash copies the tree), never `npm install`.
  - This plan file is committed to `feat/reorder-base` by the controller before the lane is cut.
    The lane edits only the files in the scope fence below, this plan's Results among them.
- **Two phases.**
  - **Phase A (Tasks 0–8)** builds and proves the probe on the R0–R5 merge. The controller then
    reviews it and merges `feat/reorder-verify` into `feat/reorder-base`.
  - **Phase B (Tasks 9–14)** starts only when the controller says the quick-fixes batch has
    **completely** landed on local main (all five lanes merged, its verification done, its worktrees
    gone) **and** main has been merged into `feat/reorder-base`. The V worktree fast-forwards to that
    tip and runs the landing gates there (spec §11 "Landing", steps 1–2). The controller does step 3
    (fast-forward local main) after reading the Results.
- **Another Claude job** (the quick-fixes batch) works in
  `.worktrees/{perf-first-four,backend-quick-fixes,frontend-quick-fixes,charts-spending-overview,charts-tax-portfolio}`
  and merges into main. Never touch main, the main checkout, its dev servers (8000/5173), those
  worktrees, or any other `.worktrees/reorder-*`.
- **Python:** `$PY` = `C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe`.
  It is notation: the tool shell keeps no variables and resets its cwd between calls, so every
  command below spells the path out or starts with `PY=…;`, and starts with an absolute `cd`.
- **Ports:** the lane's uvicorn on **8096**, its vite on **5196** (`localhost`, not `127.0.0.1` —
  vite listens on `[::1]` on this box). Never 8000/5173, and never the other lanes' 8091–8095 or
  5191–5195.
- **Long commands** (a probe pass takes about 30 minutes, the backend suite about 50) run with
  `run_in_background: true`. Wait for the completion notification. Never poll with `sleep`: the
  Bash tool's foreground limit is 10 minutes.
- **Databases:**
  - `finance_reorder_scratch` — the probe's private copy, **dropped and rebuilt from
    `finance_realdata` before each theme pass** (Task 1). Spec §10 requires the rebuild, and the
    copy is this lane's own. Together with the drill database below, it is the **only** database
    this lane ever drops.
  - `finance_test_reorder_v` — the backend suite's (conftest creates it).
  - `finance_test_reorder_v_mig` — the migration drill's (Task 11 rebuilds it the same way).
  - **Never write to** `finance`, `finance_realdata` (shared, read-only: `pg_dump` and SELECT only),
    `finance_test`, `finance_reorder_r2`…`r5`, or any other lane's database.
  - Every other deletion — these three included, after the landing — belongs to the morning list.
- **Commits:** small and conventional (`test(probes): …`, `docs(probes): …`, `fix(probes): …`,
  `docs(plan): …`). `git add` names its files, never `-A`. Never push. Never delete files or
  branches.
- **Scope fence** — this lane edits exactly:
  - `tools/probes/reorder-v/smoke.mjs` (create);
  - `tools/probes/README.md` (the reorder smoke's row and recipe section, plus one clause in the
    guide-v row);
  - `tools/probes/guide-v/smoke.mjs` (the derived counts, Task 5 — the user's "Guide probe count
    updates");
  - this plan's Results section.

  Everything the probes write (report.json, PNGs, token files) lands in the gitignored
  `scratchpad/reorder-v/` and is never committed.
- **A defect found in lane code is reported, never patched here.** Record it with the probe's
  report line and screenshot and hand it to the controller, who routes it to the owning lane
  (`src/components/reorder/**` → R0, `backend/**` and `src/api/**` → R1, and so on). A defect in
  the probe itself is fixed in the probe, with the spec sentence it answers to in the commit
  message. A check is never weakened to make it pass.
- **Known load flakes** (re-run alone before reporting):
  - vitest: `PaycheckPage … names the employer match under the waterfall` and
    `OverviewPage … mounts the three snapshot charts`;
  - pytest: `test_assistant_evidence.py::test_total_budget_includes_context_loading` (listed as
    flaky on this box before lane R1 began; it passed in R1's run).

### Controller prerequisites (before the implementer starts Phase A)

1. `feat/reorder-base` carries R1, R0, R2, R3, R4, the main merge that brought B2 (d7a16e6a) and
   R5, each merge reviewed and gated (spec §11).
2. The worktree and its junction:
   ```bash
   git -C /c/Users/edyli/personal-finance-dashboard worktree add .worktrees/reorder-v -b feat/reorder-verify feat/reorder-base
   ```
   ```powershell
   New-Item -ItemType Junction -Path C:\Users\edyli\personal-finance-dashboard\.worktrees\reorder-v\node_modules -Target C:\Users\edyli\personal-finance-dashboard\node_modules
   ```
3. Nothing listens on 8096 or 5196.

---

## What V proves, and what it leaves where it already is

| Spec | What | Where in V |
|---|---|---|
| §10 | A real mouse drag on each of the six lists: the lifted row follows the pointer, peers shift, it lands where the gap was, the order survives a reload | `mouseDrag` in every `*-drag` step; the reload in the same step |
| §10 | The toast and its Undo (not Overview: spec §6, no toast) | every `*-undo` step; Overview checks "no toast" and uses Reset to defaults |
| §10 | The keyboard path: Space, ↓ ×2, Space; focus kept on the grip | `keyboardMove` in every `*-keyboard` step |
| §10 | Auto-scroll inside the 420 px Settings box; on the page (the ledger at 1280×800) | `accounts-autoscroll` (+ `weights-autoscroll`, the 440 px box); `ledger-drag` at 1280 |
| §10 | Reduced-motion emulation: a drop line, no transform on peers | every `*-reduced-motion` step |
| §10 | The resting table look under `.reorder-table` matches `border-collapse: collapse`; hairlines travel with a lifted row | `restingLook` on the five tables; `mouseDrag`'s hairline check |
| §10 | Overview Customize: Escape mid-drag keeps the popover open | `customize-escape`, `customize-reduced-motion` |
| §10 | A clean console and CLS < 0.1 on each page | every page load (`visit`), every step (`drain`) |
| §10 | Writes only to `finance_reorder_scratch`, rebuilt before each theme | Task 1, the probe's gate and write fence |
| §10 Final | Full gates, the V probe, alembic upgrade → downgrade → upgrade on a scratch database | Tasks 10–13 |
| §9 | Two tabs → 409 → toast → reload | `categories-two-tab` (a real 409, no stub) |
| §9 | Undo after a later reorder (logged lists): the overlap refusal | `activity-overlap` |
| §9 | Cancelled drags make no request (Escape, a resize) | every `*-reduced-motion` Escape; `categories-resize-cancels`; `accounts-component-range` |
| §9 | Transactions: owner scope moves only visible rows among their slots; a hidden holding never moves; figures reported | `ledger-person-scope`, `ledger-figures` |
| §9 | Accounts: a parent carries its components; a component moves only among its siblings | `accounts-carry`, `accounts-component-range` |
| §7 | Credit-line colours hold through a reorder and across person scopes; matrix columns follow | `colours`, `roster-follows` |
| §8.4 | One Activity entry per logged reorder, with a working Undo | `activity-undo`, `activity-feed` |

**Left where it already is — not browser-probed, on purpose:**
- **The importer's identity rule** (spec §3.4: custom orders survive a re-import, moved sheet rows
  keep their identity, new sheet rows append) is backend territory. It is pinned by lane R1's
  `backend/tests/test_importer_apply.py` and runs in Task 10's suite.
- **The forced failure paths** (a stubbed 500 and 409 on every list) were proven by the lanes' own
  browser checks (R3 step g, R5 step k) and unit tests. V proves the 409 path once for real
  (`categories-two-tab`) instead of stubbing it again.
- **Data landing mid-drag, a scope switch mid-drag, window blur, and the detail-panel Escape** are
  proven by R0's hook tests and R3's scope test. A single mouse cannot switch a scope while its
  button holds a drag.
- **One-row and empty lists, and retired or archived rows.** The real book has none. They are
  pinned by R2, R3 and R5's unit tests. The probe does assert that no grip in the Accounts roster is
  disabled where its range has peers.
- **1920 px.** Spec §9 names it a supported width; spec §10 scopes V to 1280 and 1600.

---

## Decisions this plan takes where the spec is silent

1. **One theme per run, enforced.** Spec §10's "rebuilt from `finance_realdata` before each theme"
   means a fresh copy per pass. `ONLY_THEME` is required, and the probe's gate refuses a copy that
   already holds a reorder in its Activity, a `V scratch` ledger account or a `V two-tab` category.
   A pass that ran on a dirty copy would count the last pass's batches as its own.
2. **The rebuild is a drop and a `pg_dump | psql`** (never `CREATE DATABASE … TEMPLATE`), with
   uvicorn stopped first. The backend's pooled connections cache statements against the old schema,
   so an in-place restore under a running server would 500.
3. **The resting look is compared with an inline `border-collapse: collapse`, not by removing
   `.reorder-table`.** The class also carries the grip column's width and right padding
   (`.reorder-table .reorder-grip-cell`). Taking it off would widen the grip column, move every
   column after it, and compare nothing. The inline style switches exactly the border model spec §10
   names and nothing else.
4. **Pinned cells are judged apart from the rest of the table.** In the collapsed model the table
   paints the row lines, and a `position: sticky` cell — the pinned Actions column, a capped box's
   header — paints its opaque background over them. In the separate model each cell draws its own
   line. A difference inside a pinned cell is therefore expected, and it is a person's call
   (Task 7). Outside the pinned cells the look must match within a small budget: max(40 px, 0.1 %
   of the compared pixels), where a pixel differs when any channel differs by more than 24.
5. **"Hairlines travel with a lifted row"** is asserted from the lifted row itself:
   - the table computes `border-collapse: separate`;
   - every cell of the lifted row owns a 1 px solid bottom border, so the line is part of the
     translated row;
   - plus the mid-drag screenshot for the eye.

   A pixel sample at the lifted row's edge would sit at a fractional `translateY` and be
   anti-aliased across two rows, so it would prove nothing.
6. **CLS is judged at load** (the page's own shifts, the ESPP smoke's attributed meter, which
   discounts the shell's route-hold overlay) on every page load. The CLS when the walk leaves a page
   is recorded, not judged: a drop's DOM move follows the drop's own input and is outside the metric
   by definition.
7. **The Activity accounting is by batch id, the labels by shape.**
   - The probe records each logged reorder's `X-Change-Batch`: from the page's responses, and from
     its own API put-backs.
   - The feed's reorder-labelled entries must be exactly that set.
   - Labels are checked by shape per list, because R1's "minimal moved set" can name a peer. The
     first accounts move on this book reads "Reordered 3 accounts": storing the drawn order moves
     both parents after their components.
8. **A real two-tab 409 and a real resize cancel** (1600 only). They are cheap end-to-end proofs of
   §9 lines the lanes stubbed or unit-tested. The two-tab step also proves §3.3's append: a category
   created with no position lands last.
9. **The figure-changing trades are made over the API**, not through the ledger form, which is
   R3's subject. They are deleted in a `finally`. Their `V scratch` portfolio account stays (labels
   are never deleted) and serves as the freshness marker.
10. **Overview persistence goes through the real server.** The fence passes `PATCH /prefs` with its
    `overview_layout` key alone and stubs every other key, so a theme or a remembered scope never
    rewrites the account. Stored layouts are compared list by list (JSONB reorders keys — lane R4's
    finding).
11. **Width-independent checks run once, at 1600:** colours across scopes, the matrix columns, the
    person-scoped ledger, the sell above its buy, the two-tab 409, the resize and the component
    range. The Activity step runs at the last width, after every other logged reorder of the pass.
12. **The sticky header is judged, not asserted** (Task 7), with an explicit rule. The fix, if the
    judgement rejects the look, is on the **header**. The `z-index: 1`-on-the-row idea from R5's
    note cannot work (Notes for the controller, 1).
13. **The Guide probe's counts.** No pinned count in `guide-v` moves (Task 5 shows each one before
    and after). The counts that do move are only recorded. The probe gains two derived checks, so
    R5's new task is proven walked and no future task needs a hand edit.
14. **The migration drill runs on a prod-shaped copy** (`finance_realdata` restored into
    `finance_test_reorder_v_mig`). That is the exact path prod's boot takes: 26 imported trades
    backfilled, then downgrade, upgrade and `alembic check`.
15. **The probe mints its own token** from uvicorn 8096 (the dev seed credentials `finance_realdata`
    carries). It must refuse every stack but the lane's, so it takes no `TOKEN_FILE`.

---

## File map

| File | Change | Task |
|---|---|---|
| `tools/probes/reorder-v/smoke.mjs` | create — the probe | 3 |
| `tools/probes/README.md` | the reorder smoke's table row and recipe section; one clause in the guide-v row | 4, 5 |
| `tools/probes/guide-v/smoke.mjs` | the content-derived rail-row and card checks | 5 |
| this plan | Results; the morning list | 8, 14 |
| `scratchpad/reorder-v/**` (gitignored, never committed) | report.json, PNGs, token files | 6, 8, 13 |

---

## Phase A — the probe, on the R0–R5 merge

### Task 0: Preflight (no commit)

**Files:** none.

- [ ] **Step 1: The branch, and every lane on it**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && git branch --show-current && git status --short && git log --oneline --merges -12
```

Expected:
- `feat/reorder-verify`;
- nothing, or only `?? node_modules` (the junction — leave it untracked);
- a merge commit for each of lanes R1, R0, R2, R3, R4, the main merge that brought B2 (d7a16e6a),
  and R5.

Then:

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && grep -l "reorder-table" src/components/settings/CategoriesCard.tsx src/components/settings/AccountsCard.tsx src/components/portfolio/TransactionsPanel.tsx src/components/creditcards/CardsPanel.tsx src/components/creditcards/CategoriesPanel.tsx; grep -c "useReorder" src/components/overview/OverviewCustomize.tsx; grep -n "id: 'cards-reorder'" src/guide/content/pages-tracking.tsx; grep -n "rankIds" src/components/creditcards/creditLineChartOptions.ts | head -2; grep -rn "draggable" src/components/creditcards/ || echo "no draggable left"; ls backend/alembic/versions | grep f12026092301
```

Expected:
- the five paths;
- a count of 2 or more;
- one `cards-reorder` line;
- at least one `rankIds` line (R5 amendment A1: a card's colour is its rank among all cards);
- `no draggable left`;
- `20260923_0900_f12026092301_position_transactions_import_key.py`.

Anything missing: stop and report to the controller — this lane cannot start.

- [ ] **Step 2: The interpreter runs THIS worktree's backend, at one head**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v/backend && C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -c "import app; print(app.__file__)" && C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m alembic heads
```

Expected:
- `C:\Users\edyli\personal-finance-dashboard\.worktrees\reorder-v\backend\app\__init__.py`;
- `f12026092301 (head)`, alone.

Any other path, or two heads: stop.

- [ ] **Step 3: The tools**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && ls node_modules/.bin/vite && ls "C:/Users/edyli/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core/package.json" && ls "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" && node --version
```

Expected: the four paths exist, and node prints `v18.12.0` (the probes spoof 20 for
playwright-core).

- [ ] **Step 4: The ports are free**

```bash
netstat -ano | grep -E ':(8096|5196) +.*LISTENING' || echo "8096 and 5196 are free"
```

Expected: `8096 and 5196 are free`.

- [ ] **Step 5: The source is what the census says (SELECT only)**

```bash
docker exec finance-dashboard-db-1 psql -U finance -d finance_realdata -tAc "SELECT (SELECT count(*) FROM accounts), (SELECT count(*) FROM spending_categories), (SELECT count(*) FROM position_transactions), (SELECT count(*) FROM credit_cards), (SELECT count(*) FROM reward_categories), (SELECT version_num FROM alembic_version)"
docker exec finance-dashboard-db-1 psql -U finance -d finance_realdata -tAc "SELECT count(*) FROM user_preferences WHERE key = 'overview_layout'"
```

Expected: `29|19|39|7|19|f12026091203`, then `0` (no stored Overview layout: the Customize list
starts at the defaults). Planning read exactly these on 2026-09-23. Different numbers mean
`finance_realdata` was re-restored: record them in Results. The probe derives its expectations from
the API, so it still runs, but the census note in its report will differ.

---

### Task 1: The private database — the rebuild recipe

**Files:** none. This task is run now, and again before EVERY theme pass (Tasks 6 and 13).

- [ ] **Step 1: Stop the lane's uvicorn if it is running**

```bash
for pid in $(netstat -ano | grep -E '127\.0\.0\.1:8096 +.*LISTENING' | awk '{print $NF}' | sort -u); do taskkill //F //T //PID "$pid"; done; netstat -ano | grep -E ':8096 +.*LISTENING' || echo "8096 is free"
```

Expected: `8096 is free`. The uvicorn may instead have been started as a background task of this
session; stopping that task is equivalent. Never stop anything on 8000, 8091–8095, 5173 or
5191–5195.

- [ ] **Step 2: Drop and rebuild the copy (this lane's own database — the only one it drops)**

```bash
docker exec finance-dashboard-db-1 dropdb -U finance --if-exists finance_reorder_scratch
docker exec finance-dashboard-db-1 createdb -U finance finance_reorder_scratch
docker exec finance-dashboard-db-1 sh -c 'pg_dump -U finance --no-owner --no-privileges finance_realdata | psql -q -v ON_ERROR_STOP=1 -U finance -d finance_reorder_scratch'
```

Expected: no output, exit 0 from each.
- If `dropdb` says the database "is being accessed by other users", only the lane's own uvicorn
  can hold it. Repeat Step 1, and if a session still remains, use
  `docker exec finance-dashboard-db-1 dropdb -U finance --force finance_reorder_scratch` — and
  never `--force` any other name.
- `createdb` without `-T` copies `template1`, never `finance_realdata`. The spec's verification-data
  note: `TEMPLATE` from a database others hold open fails.

- [ ] **Step 3: Migrate it with this worktree's code**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v/backend && DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_reorder_scratch C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m alembic upgrade head
```

Expected, last line: `INFO  [alembic.runtime.migration] Running upgrade f12026091203 -> f12026092301, position_transactions.import_key — the importer's identity for sheet rows`.

- [ ] **Step 4: The copy's census**

```bash
docker exec finance-dashboard-db-1 psql -U finance -d finance_reorder_scratch -tAc "SELECT (SELECT count(*) FROM accounts), (SELECT count(*) FROM spending_categories), (SELECT count(*) FROM position_transactions), (SELECT count(*) FROM credit_cards), (SELECT count(*) FROM reward_categories), (SELECT version_num FROM alembic_version)"
docker exec finance-dashboard-db-1 psql -U finance -d finance_reorder_scratch -tAc "SELECT count(*) FILTER (WHERE source = 'import' AND import_key = sort_index), count(*) FILTER (WHERE source = 'ui' AND import_key IS NULL) FROM position_transactions"
```

Expected: `29|19|39|7|19|f12026092301`, then `26|13` (the backfill: every imported trade keyed by
its sheet key, every UI trade NULL).

- [ ] **Step 5: Start the lane's uvicorn (run_in_background: true)**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v/backend && DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_reorder_scratch SCHEDULER_ENABLED=0 C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8096
```

Then, in a separate call: `curl -s http://127.0.0.1:8096/api/v1/health` → `{"status":"ok"}`. It
runs without `--reload`, so a uvicorn left over from an older tip serves old code. Phase B restarts
it deliberately.

- [ ] **Step 6: The dev seed credentials work on the copy**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8096/api/v1/auth/login -H 'content-type: application/json' -d '{"email":"admin@example.com","password":"changeme123"}'
```

Expected: `200`. On a `401` only, reset the password on the PRIVATE copy (the rebuild restores
the source's hash, so this repeats after every rebuild):

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v/backend && HASH=$(C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -c "from app.security import hash_password; print(hash_password('changeme123'))") && docker exec finance-dashboard-db-1 psql -U finance -d finance_reorder_scratch -c "UPDATE users SET password_hash = '$HASH' WHERE email = 'admin@example.com'"
```

then repeat the curl (`200`).

---

### Task 2: The lane's vite

**Files:** none.

- [ ] **Step 1: Start vite against the lane's uvicorn (run_in_background: true)**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && VITE_API_PROXY=http://127.0.0.1:8096 npx vite --port 5196 --strictPort
```

`VITE_API_PROXY` has to be on this command line: vite reads it from the shell, never from an
`.env` file (`vite.config.ts`).

- [ ] **Step 2: It serves, and its `/api` reaches 8096 — not the shared 8000**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5196/
TOKEN=$(curl -s http://127.0.0.1:8096/api/v1/auth/login -H 'content-type: application/json' -d '{"email":"admin@example.com","password":"changeme123"}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token))"); curl -s http://localhost:5196/api/v1/system/status -H "authorization: Bearer $TOKEN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).database.alembic_head))"
```

Expected: `200`, then `f12026092301`. The shared backend on 8000 serves main, which is at
`f12026091203`. Seeing that head means the proxy is wrong: restart vite with the variable.

---

### Task 3: The probe — `tools/probes/reorder-v/smoke.mjs`

**Files:**
- Create: `tools/probes/reorder-v/smoke.mjs`

- [ ] **Step 1: Write the probe**

Create `tools/probes/reorder-v/smoke.mjs` with exactly this content:

```js
// tools/probes/reorder-v/smoke.mjs — the drag-to-reorder verification walk (lane V, 2026-09-23
// drag-to-reorder spec §9 and §10; plan docs/superpowers/plans/2026-09-23-reorder-v-verify.md).
// Recipe: tools/probes/README.md, "Running the reorder smoke".
//
// It WRITES, so it runs only against the lane's own pair of servers — vite on 5196 proxying to
// uvicorn on 8096, which serves the PRIVATE database finance_reorder_scratch — and only on a FRESH
// copy: the database is rebuilt from the shared read-only finance_realdata before each theme, one
// theme per run (ONLY_THEME=dark|light is required), and a gate refuses a copy an earlier pass
// already wrote to. The page may write only through a short allowlist — the five reorder PUTs, the
// change log's Undo and the token renewal; PATCH /prefs goes through with its overview_layout key
// alone (the Customize list's own save) — and anything else is aborted and reported. The walk's
// own scratch rows (two ledger trades, one spending category) are made and removed over the API.
//
// Per width (1600×1000, then 1280×800), in real Edge with real pointer events, on each of the six
// lists — Settings › Spending categories, Settings › Accounts, Portfolio › Manage › Transactions,
// Overview › Customize, Credit Cards › Card roster, Credit Cards › Categories & weights:
//   - the resting table against the collapsed border model it replaced, pixel for pixel;
//   - a real mouse drag: the lifted row follows the pointer, exactly the peers it passes make
//     room, its cells carry their own hairline, it lands where the gap was, the order survives a
//     reload;
//   - the toast and its Undo (Overview has no toast: Reset to defaults is its way back);
//   - the keyboard path — Space, ↓ ×2, Space — with focus kept on the grip;
//   - reduced-motion emulation: one accent drop line, no transform on a peer, Escape cancelling
//     with no request.
// Plus auto-scroll inside the 420px Settings box and the 440px Categories & weights box (the
// sticky header recorded while the row is held over it) and on the page (the ledger at 1280×800);
// the Accounts roster's groups, nesting and carried components, and a component held to its
// siblings; the ledger in a person scope and a sell dragged above its buy; the credit-line colours
// through a reorder and in every person scope, and the rewards matrix's columns; Escape inside the
// Customize popover; a real two-tab 409 and a resize that cancels; and, at the last width, the
// Activity feed — one entry per logged reorder, the card's Undo, the overlap refusal. Every page
// load must stay under CLS 0.1 and every step must keep the console clean.
//
// Not probed here, on purpose: the importer's identity rule (spec §3.4) — a workbook re-import is
// backend territory, pinned by backend/tests/test_importer_apply.py — and the failure paths the
// lanes forced with stubbed 500s and 409s (their own browser checks and unit tests own those).
//
// Env: ONLY_THEME (required), ONLY_WIDTH, ONLY_SURFACE (comma list of settings, portfolio,
// overview, cards, activity), APP_BASE, API_BASE, SMOKE_OUT, EXPECT_HEAD, EDGE_PATH,
// PLAYWRIGHT_CORE. Prints `REORDER SMOKE OK — …` or exits 1 listing every problem (2 when it
// refuses to start); report.json and the PNGs land in SMOKE_OUT (default
// scratchpad/reorder-v/<theme>).
//
// The first two lines spoof the node version: this box runs node 18 and playwright-core refuses
// anything under 20. playwright-core is resolved out of the npx cache because it is not a repo
// dependency (PLAYWRIGHT_CORE overrides the path).
Object.defineProperty(process, 'version', { value: 'v20.19.0' })
Object.defineProperty(process.versions, 'node', { value: '20.19.0' })
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_CORE ??
    'C:/Users/edyli/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core',
)

// ── configuration ────────────────────────────────────────────────────────────────────────────
const THEME = process.env.ONLY_THEME
if (THEME !== 'dark' && THEME !== 'light') {
  console.error(
    'ONLY_THEME=dark|light is required: finance_reorder_scratch is rebuilt before each theme, so one run is one theme (tools/probes/README.md).',
  )
  process.exit(2)
}
const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../..')
const OUT = process.env.SMOKE_OUT ?? path.join(repo, 'scratchpad', 'reorder-v', THEME)
mkdirSync(OUT, { recursive: true })
const APP = process.env.APP_BASE ?? 'http://localhost:5196'
const API = process.env.API_BASE ?? 'http://127.0.0.1:8096'
if (new URL(APP).port !== '5196' || new URL(API).port !== '8096') {
  console.error(
    `refusing to write through ${APP} / ${API}: lane V writes only through vite 5196 → uvicorn 8096 (finance_reorder_scratch)`,
  )
  process.exit(2)
}
const EDGE =
  process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const EXPECT_HEAD = process.env.EXPECT_HEAD ?? 'f12026092301'
const SIZES = [
  { width: 1600, height: 1000 },
  { width: 1280, height: 800 },
].filter((s) => !process.env.ONLY_WIDTH || String(s.width) === process.env.ONLY_WIDTH)
const SURFACES = (process.env.ONLY_SURFACE ?? 'settings,portfolio,overview,cards,activity')
  .split(',')
  .map((s) => s.trim())
const SETTLE = 1500
// MOTION_MS.fast (src/theme/motion.ts): a pointer drop eases into its gap this long, then commits.
const MOTION = 120
const NOISE =
  /favicon|DevTools|\[vite\]|@vite\/client|Download the React DevTools|React Router Future Flag/i

// The words the walk expects on screen — spec §8.1–§8.4, verbatim.
const CAT_NOTE =
  'The Monthly update lists categories in this order — a spreadsheet column pasted there fills them in this order too.'
const ACC_NOTE =
  'The Monthly update lists accounts in this order within each person and group — a spreadsheet column pasted there fills them in this order too.'
const LEDGER_HINT =
  "The list is the order trades are replayed to work out cost basis and gains — with no dates on the rows, it is the ledger's timeline. Drag a row to move a trade earlier or later."
const STALE_CATEGORIES =
  'The spending categories changed since this list was loaded — nothing was moved.'
const OVERLAP = 'Later changes touched these rows — undo those first'
const REORDER_LABEL = /^(Moved (account|category) .+|Reordered \d+ (accounts|categories))$/
const LABEL_OF = {
  categories: /^(Moved category .+|Reordered \d+ categories)$/,
  accounts: /^(Moved account .+|Reordered \d+ accounts)$/,
}
// The walk's own scratch rows, named so a left-over is unmistakable — and refused by the gate.
const SCRATCH_ACCOUNT = 'V scratch'
const SCRATCH_CATEGORY = 'V two-tab'

// src/charts/theme.ts — the roster's group order and headings (spec §4.2).
const GROUP_ORDER = ['cash', 'pre_tax', 'post_tax', 'taxable', 'equity', 'other', 'liability']
const GROUP_LABELS = {
  cash: 'Cash',
  pre_tax: 'Pre-tax',
  post_tax: 'Post-tax',
  taxable: 'Taxable',
  equity: 'Equity',
  other: 'Other',
  liability: 'Liabilities',
}
// src/prefs/overviewLayout.ts — DEFAULT_OVERVIEW_LAYOUT. finance_realdata stores no layout.
const DEFAULT_LAYOUT = {
  tiles: ['net_worth', 'portfolio', 'living_spending', 'tax'],
  cards: ['ytd', 'performance', 'spending', 'money_flow'],
}
const TILE_KEYS = [
  ['Net worth', 'net_worth'],
  ['Portfolio', 'portfolio'],
  ['Living spending', 'living_spending'],
  ['Estimated tax', 'tax'],
]

// Selectors — each the owning lane's own, as its browser check proved it.
const CATS = '#categories table.category-table' // R2
const CAT_ROWS = `${CATS} tbody tr[data-reorder-id]`
const CAT_BOX = '#categories .settings-scroll'
const ACCS = '#accounts table.accounts-table' // R2
const ACC_ROWS = `${ACCS} tbody tr[data-reorder-id]`
const ACC_BOX = '#accounts .settings-scroll:has(table.accounts-table)'
const LEDGER_PANEL = '#portfolio-records-transactions' // R3
const LEDGER = `${LEDGER_PANEL} table`
const TXN_ROWS = `${LEDGER} tbody tr[data-reorder-id]`
const DIALOG = '[role="dialog"][aria-label="Customize overview"]' // R4
const TILE_ROWS = `${DIALOG} fieldset:nth-of-type(1) .overview-customize-row[data-reorder-id]`
const ROSTER = '.roster-table' // R5
const CARD_ROWS = `${ROSTER} tbody tr[data-reorder-id]`
const WEIGHTS = '.categories-table' // R5
const WEIGHT_ROWS = `${WEIGHTS} tbody tr[data-reorder-id]`
const WEIGHT_BOX = '.categories-scroll'
// owner=all spelled out: with no owner param a page falls back to the account's remembered scope.
const HOUSEHOLD_LEDGER = '/portfolio?section=manage&owner=all'
const MANAGE = '/credit-cards?section=manage&owner=all'
const LINES = '/credit-cards?section=lines&owner=all'
const REWARDS = '/credit-cards?owner=all'

// The only writes the PAGE may make. PATCH /prefs has its own rule in fence().
const WRITE_ALLOW = [
  ['PUT', /^\/api\/v1\/spending\/categories\/order$/],
  ['PUT', /^\/api\/v1\/net-worth\/accounts\/order$/],
  ['PUT', /^\/api\/v1\/portfolio\/transactions\/order$/],
  ['PUT', /^\/api\/v1\/credit-cards\/order$/],
  ['PUT', /^\/api\/v1\/credit-cards\/categories\/order$/],
  ['POST', /^\/api\/v1\/activity\/batches\/[0-9a-f-]+\/undo$/],
  ['POST', /^\/api\/v1\/auth\/(login|renew)$/],
]
const LOGGED_ROUTE = /^\/api\/v1\/(net-worth\/accounts|spending\/categories)\/order$/
const UNDO_ROUTE = /^\/api\/v1\/activity\/batches\/([0-9a-f-]+)\/undo$/
const ORDER_ROUTE = {
  categories: '/spending/categories/order',
  accounts: '/net-worth/accounts/order',
  transactions: '/portfolio/transactions/order',
  cards: '/credit-cards/order',
  weights: '/credit-cards/categories/order',
}

// ── the record ───────────────────────────────────────────────────────────────────────────────
const report = {
  generatedAt: new Date().toISOString(),
  theme: THEME,
  app: APP,
  api: API,
  sizes: SIZES,
  surfaces: SURFACES,
  census: null,
  checks: [],
  writes: [],
  blockedWrites: [],
  prefsWrites: [],
  logged: [],
  undos: [],
  scratch: [],
  knownBenign: [],
  warnings: [],
  files: [],
  problems: [],
}
let tag = 'setup'
const where = { surface: 'setup', step: 'gate' }
let browser = null
let page = null
let size = SIZES[0]
let themedOnce = false
let current = null
let expecting = []
const errors = []

const problem = (message) => report.problems.push(message)
function check(name, ok, observed) {
  const pass = Boolean(ok)
  report.checks.push({
    tag,
    surface: where.surface,
    step: where.step,
    name,
    ok: pass,
    observed: observed ?? null,
  })
  if (!pass) {
    problem(
      `${tag} ${where.surface}:${where.step}: ${name} — observed ${JSON.stringify(observed ?? null).slice(0, 700)}`,
    )
  }
  return pass
}
const note = (name, observed) =>
  report.checks.push({
    tag,
    surface: where.surface,
    step: where.step,
    name,
    ok: null,
    observed: observed ?? null,
  })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// JSONB hands a stored layout back with its keys in its own order (lane R4's finding): compare
// the two lists, never the objects' JSON.
const sameLayout = (a, b) =>
  a !== null && b !== null && same(a.tiles, b.tiles) && same(a.cards, b.cards)
const moveTo = (ids, from, to) => {
  const next = [...ids]
  const [id] = next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(read, want, timeout = 8000) {
  const start = Date.now()
  let seen = await read()
  while (!same(seen, want) && Date.now() - start < timeout) {
    await sleep(150)
    seen = await read()
  }
  return seen
}

// ── the API, as the app's own user, straight to the lane's uvicorn ───────────────────────────
const login = await fetch(`${API}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@example.com', password: 'changeme123' }),
}).catch((error) => ({ ok: false, status: String(error) }))
if (!login.ok) {
  console.error(
    `login on ${API} failed (${login.status}) — is the lane's uvicorn up? A 401 on a fresh copy: the plan's Task 1 Step 6 resets the PRIVATE copy's password.`,
  )
  process.exit(2)
}
const TOKEN = (await login.json()).access_token
const apiRaw = (method, route, body) =>
  fetch(`${API}/api/v1${route}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
async function api(method, route, body) {
  const res = await apiRaw(method, route, body)
  if (!res.ok) {
    throw new Error(`${method} ${route} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  return res.status === 204 ? null : res.json()
}
const idsOf = (rows) => rows.map((row) => String(row.id))
/** The roster as Settings draws it (spec §4.2): group by group in GROUP_ORDER, API order inside a
 *  group, each component right after its parent when the parent sits in the same group. */
function displayOf(accounts) {
  const rows = []
  for (const group of GROUP_ORDER) {
    const inGroup = accounts.filter((a) => a.group === group)
    const present = new Set(inGroup.map((a) => a.id))
    for (const account of inGroup) {
      if (account.parent_account_id !== null && present.has(account.parent_account_id)) continue
      rows.push({ id: String(account.id), group, parent: null })
      for (const child of inGroup.filter((c) => c.parent_account_id === account.id)) {
        rows.push({ id: String(child.id), group, parent: String(account.id) })
      }
    }
  }
  return rows
}
const read = {
  categories: async () => idsOf(await api('GET', '/spending/categories')),
  // The stored order (what a PUT wrote) and the drawn one (what Settings shows).
  accountsStored: async () => idsOf(await api('GET', '/net-worth/accounts')),
  accounts: async () => displayOf(await api('GET', '/net-worth/accounts')).map((row) => row.id),
  transactions: async (owner = null) =>
    idsOf(await api('GET', `/portfolio/transactions${owner === null ? '' : `?owner=${owner}`}`)),
  cards: async () => idsOf(await api('GET', '/credit-cards')),
  weights: async () => idsOf(await api('GET', '/credit-cards/categories')),
  layout: async () => (await api('GET', '/prefs')).prefs?.overview_layout?.value ?? null,
}
const activity = async (limit = 200) => (await api('GET', `/activity?limit=${limit}`)).entries
/** A reorder straight through the API — the walk's put-back. A logged list's batch is recorded:
 *  the Activity step counts every logged reorder of the pass, the walk's own included. */
async function putOrder(list, ids) {
  const res = await apiRaw('PUT', ORDER_ROUTE[list], { ids: ids.map(Number) })
  if (!res.ok) {
    throw new Error(
      `PUT ${ORDER_ROUTE[list]} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`,
    )
  }
  const batch = res.headers.get('x-change-batch')
  if (batch !== null) {
    report.logged.push({ id: batch, list, via: `api ${where.surface}:${where.step}` })
  }
  return res.json()
}

// ── the gate: the lane's stack, and a copy nothing has written to yet ────────────────────────
const status = await api('GET', '/system/status')
check(
  `the lane's backend is at the batch head (${EXPECT_HEAD})`,
  status.database?.alembic_head === EXPECT_HEAD,
  status.database ?? null,
)
const viaVite = await fetch(`${APP}/api/v1/system/status`, {
  headers: { authorization: `Bearer ${TOKEN}` },
})
  .then((res) => (res.ok ? res.json() : null))
  .catch(() => null)
check(
  'vite 5196 proxies to that backend (VITE_API_PROXY=http://127.0.0.1:8096)',
  viaVite?.database?.alembic_head === EXPECT_HEAD,
  viaVite?.database ?? null,
)
const staleReorders = (await activity()).filter(
  (entry) => entry.type === 'batch' && REORDER_LABEL.test(entry.label.replace(/^Undid: /, '')),
)
check(
  'the copy is fresh: its Activity holds no reorder yet',
  staleReorders.length === 0,
  staleReorders.slice(0, 3).map((entry) => entry.label),
)
const ledgerLabels = (await api('GET', '/portfolio/accounts')).map((account) => account.label)
check(
  `the copy is fresh: no '${SCRATCH_ACCOUNT}' ledger account`,
  !ledgerLabels.includes(SCRATCH_ACCOUNT),
  ledgerLabels,
)
const categoryNames = (await api('GET', '/spending/categories')).map((c) => c.name)
check(
  `the copy is fresh: no '${SCRATCH_CATEGORY}' category`,
  !categoryNames.includes(SCRATCH_CATEGORY),
  categoryNames.length,
)
if (report.problems.length > 0) {
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.error('REORDER SMOKE REFUSED — the lane stack or the copy is not what this walk needs:')
  for (const p of report.problems) console.error(`  - ${p}`)
  console.error('Rebuild finance_reorder_scratch and restart uvicorn (plan Task 1), then run again.')
  process.exit(2)
}
const ORIG = {
  categories: await read.categories(),
  accounts: await read.accounts(),
  ledger: await read.transactions(),
  cards: await read.cards(),
  weights: await read.weights(),
  layout: await read.layout(),
}
const PEOPLE = (await api('GET', '/household')).people
report.census = {
  categories: ORIG.categories.length,
  accounts: ORIG.accounts.length,
  trades: ORIG.ledger.length,
  cards: ORIG.cards.length,
  weights: ORIG.weights.length,
  layout: ORIG.layout,
  people: PEOPLE.map((person) => `${person.id}:${person.name}`),
}
note(
  'census (finance_realdata of 2026-09-23: 19 categories, 29 accounts, 39 trades, 7 cards, 19 reward categories, no stored layout)',
  report.census,
)

// ── the browser: one context per width, a write fence, a layout-shift meter ──────────────────
// Cumulative layout shift, the ESPP smoke's instrument: __clsPage counts only shifts whose source
// lies OUTSIDE the shell's route-hold cross-fade (.xfade/.xfade-veil/.loading-dim/
// .loading-fallback), which intermittently books ~0.13 on pages this batch never touched.
const INIT = `(() => {
  window.__cls = 0
  window.__clsPage = 0
  window.__clsShell = 0
  const SHELL = /(^|\\s)(xfade|xfade-veil|loading-dim|loading-fallback)(\\s|$|-)/
  const isShell = (n) => { for (let e = n; e && e.nodeType === 1; e = e.parentElement) { const c = e.getAttribute && e.getAttribute('class'); if (c && SHELL.test(c)) return true } return false }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue
        window.__cls += e.value
        const src = (e.sources || []).map((s) => s.node).filter(Boolean)
        if (src.length && src.every(isShell)) window.__clsShell += e.value
        else window.__clsPage += e.value
      }
    }).observe({ type: 'layout-shift', buffered: true })
  } catch {}
})()`

async function openContext() {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 })
  // Seeded before first paint: the app boots its token and theme out of localStorage, and the
  // "landed" flag keeps an account landing page from bouncing / elsewhere (lane R4's driver).
  await context.addInitScript(
    ([token, theme]) => {
      localStorage.setItem('finance_token', token)
      localStorage.setItem('finance.theme', theme)
      sessionStorage.setItem('finance.landed', '1')
    },
    [TOKEN, THEME],
  )
  await context.addInitScript(INIT)
  const stamp = new Date().toISOString()
  // ONE handler for every /api/v1 call, so the order of registration can never let a write past.
  await context.route('**/api/v1/**', (route) => fence(route, stamp))
  return context
}

async function fence(route, stamp) {
  const request = route.request()
  const method = request.method()
  const { pathname } = new URL(request.url())
  if (/^\/api\/v1\/prefs\b/.test(pathname)) {
    const theme = { value: THEME, updated_at: stamp }
    if (method === 'GET') {
      // The account owns the theme: this pass's theme is injected into the answer.
      let body = { prefs: {} }
      try {
        body = await (await route.fetch()).json()
      } catch (error) {
        problem(`${tag}: GET /prefs could not be read (${error.message})`)
      }
      body.prefs = { ...(body.prefs ?? {}), theme }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    }
    // Only the Customize list's own save reaches the server: overview_layout, and nothing else —
    // a theme or a remembered scope never rewrites the account.
    let sent = {}
    try {
      sent = JSON.parse(request.postData() ?? '{}')
    } catch {
      sent = {}
    }
    const others = Object.keys(sent).filter((key) => key !== 'overview_layout')
    if ('overview_layout' in sent) {
      report.prefsWrites.push({ tag, step: where.step, passed: 'overview_layout', stubbed: others })
      return route.continue({ postData: JSON.stringify({ overview_layout: sent.overview_layout }) })
    }
    report.prefsWrites.push({ tag, step: where.step, passed: null, stubbed: others })
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ prefs: { theme } }),
    })
  }
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue()
  if (WRITE_ALLOW.some(([allowed, re]) => allowed === method && re.test(pathname))) {
    report.writes.push({ tag, surface: where.surface, step: where.step, method, pathname })
    return route.continue()
  }
  report.blockedWrites.push({ tag, surface: where.surface, step: where.step, method, pathname })
  problem(
    `${tag} ${where.surface}:${where.step}: BLOCKED a write this walk must never make — ${method} ${pathname}`,
  )
  return route.abort()
}
/** Writes that reached the server from the page: the allowlist's, plus layout PATCHes. */
const writesNow = () =>
  report.writes.length + report.prefsWrites.filter((w) => w.passed !== null).length

function take(entry) {
  if (NOISE.test(entry.text) || NOISE.test(entry.url)) return
  const rule = expecting.find(
    (e) => e.re.test(entry.url) && (entry.kind !== 'http' || entry.text === `HTTP ${e.status}`),
  )
  if (rule !== undefined) {
    report.knownBenign.push({ tag, surface: where.surface, step: where.step, why: rule.why, ...entry })
    return
  }
  errors.push({ tag, surface: where.surface, step: where.step, ...entry })
}
function drain() {
  for (const e of errors.splice(0)) {
    problem(`${e.tag} ${e.surface}:${e.step}: ${e.kind} ${e.text}${e.url ? ` <${e.url}>` : ''}`)
  }
}
function step(name) {
  drain()
  where.step = name
}
async function onResponse(response) {
  const status = response.status()
  const request = response.request()
  let pathname = ''
  try {
    pathname = new URL(response.url()).pathname
  } catch {
    return
  }
  if (status >= 400) take({ kind: 'http', text: `HTTP ${status}`, url: response.url() })
  if (status !== 200) return
  try {
    if (request.method() === 'PUT' && LOGGED_ROUTE.test(pathname)) {
      const batch = await response.headerValue('x-change-batch')
      if (batch !== null) {
        report.logged.push({
          id: batch,
          list: pathname.includes('/net-worth/') ? 'accounts' : 'categories',
          via: `page ${where.surface}:${where.step}`,
        })
      }
    } else if (request.method() === 'POST' && UNDO_ROUTE.test(pathname)) {
      const body = await response.json()
      report.undos.push({
        id: body.batch_id,
        of: UNDO_ROUTE.exec(pathname)[1],
        label: body.label,
        via: `page ${where.surface}:${where.step}`,
      })
    }
  } catch (error) {
    report.warnings.push({ tag, text: `could not read ${request.method()} ${pathname}: ${error.message}` })
  }
}
function wire() {
  page.on('console', (message) => {
    const type = message.type()
    if (type === 'warning') {
      if (!NOISE.test(message.text())) {
        report.warnings.push({ tag, step: where.step, text: message.text().slice(0, 300) })
      }
      return
    }
    if (type !== 'error') return
    take({ kind: 'console', text: message.text().slice(0, 300), url: (message.location() || {}).url || '' })
  })
  page.on('pageerror', (error) =>
    take({ kind: 'pageerror', text: String(error.message).slice(0, 300), url: page.url() }),
  )
  page.on('requestfailed', (request) => {
    const failure = request.failure()
    if (failure && /ERR_ABORTED/.test(failure.errorText)) return
    take({ kind: 'requestfailed', text: failure ? failure.errorText : 'request failed', url: request.url() })
  })
  page.on('response', (response) => {
    void onResponse(response)
  })
}

// ── page plumbing ────────────────────────────────────────────────────────────────────────────
const file = (name) => {
  const target = path.join(OUT, `${size.width}-${name}.png`)
  report.files.push(path.basename(target))
  return target
}
const snap = (name) => page.screenshot({ path: file(name) })
const clsNow = () =>
  page.evaluate(() => ({
    total: +(window.__cls ?? 0).toFixed(3),
    page: +(window.__clsPage ?? 0).toFixed(3),
    shell: +(window.__clsShell ?? 0).toFixed(3),
  }))
async function leave() {
  if (current === null || page === null) return
  const cls = await clsNow().catch(() => null)
  note(`${current}: CLS when the walk left it (input-driven moves are outside the metric)`, cls)
  current = null
}
async function visit(route, ready) {
  await leave()
  try {
    await page.goto(APP + route, { waitUntil: 'networkidle', timeout: 45000 })
  } catch {
    await page.goto(APP + route, { waitUntil: 'load', timeout: 45000 })
  }
  if (/^\/login/.test(new URL(page.url()).pathname)) {
    throw new Error(`bounced to ${page.url()} — the seeded token did not authenticate`)
  }
  await page.locator(ready).first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(SETTLE)
  if (!themedOnce) {
    themedOnce = true
    const painted = await page.evaluate(() => document.documentElement.dataset.theme ?? null)
    check(`the app paints the ${THEME} theme`, painted === THEME, painted)
  }
  const cls = await clsNow()
  check(`${route} loads with CLS < 0.1 (the page's own shifts)`, cls.page < 0.1, cls)
  current = route
}
async function openSettings() {
  await visit('/settings', CAT_ROWS)
  await page.locator(ACC_ROWS).first().waitFor({ timeout: 20000 })
}
async function openOverview() {
  await visit('/', '.kpi-row .stat-label-text')
  await page.waitForFunction(
    () => document.querySelectorAll('.kpi-row .stat-label-text').length === 4,
    null,
    { timeout: 30000 },
  )
}
async function openManage() {
  await visit(MANAGE, WEIGHT_ROWS)
  await page.locator(CARD_ROWS).first().waitFor({ timeout: 20000 })
}
const dialog = () => page.locator(DIALOG)
async function openCustomize() {
  if ((await dialog().count()) === 0) {
    await page.getByRole('button', { name: 'Customize', exact: true }).click()
  }
  await dialog().waitFor({ state: 'visible', timeout: 10000 })
  await page.waitForTimeout(MOTION + 100) // the pop-in
}
async function tileOrder() {
  const labels = await page.locator('.kpi-row .stat-label-text').allTextContents()
  return labels.map(
    (text) =>
      TILE_KEYS.find(([prefix]) => text.trim().startsWith(prefix))?.[1] ?? `?${text.trim().slice(0, 40)}`,
  )
}
/** A Customize fieldset as the reader sees it (lane R4's reader): grip, box, label; the divider. */
const rowsOf = (legend) =>
  page
    .getByRole('group', { name: legend, exact: true })
    .locator('.overview-customize-row, .overview-customize-divider')
    .evaluateAll((els) =>
      els.map((el) =>
        el.classList.contains('overview-customize-divider')
          ? `— ${el.textContent.trim()} —`
          : `${el.querySelector('.reorder-grip') ? '⋮ ' : ''}${el.querySelector('input').checked ? '[x]' : '[ ]'} ${el.textContent.trim()}`,
      ),
    )
/** The credit-line chart's series off echarts' applied option. The echarts handle is imported
 *  only after the card painted (tools/probes/espp-v: an import at page-init makes the dev server
 *  transform the chart graph mid-load and books a layout shift the product does not have). */
async function lineSeries() {
  await page
    .locator('section.chart-card', { has: page.locator('h2', { hasText: 'Credit line history' }) })
    .scrollIntoViewIfNeeded()
  await page.evaluate(async () => {
    try {
      const m = await import('/src/charts/echarts.ts')
      window.__echarts = m.echarts
    } catch (error) {
      window.__hookError = String(error)
    }
  })
  const start = Date.now()
  while (Date.now() - start < 10000) {
    const seen = await page.evaluate(() => {
      const card = [...document.querySelectorAll('section.chart-card')].find((c) =>
        /Credit line history/.test(c.querySelector('h2')?.textContent ?? ''),
      )
      const host = card?.querySelector('[_echarts_instance_]')
      const inst = host && window.__echarts ? window.__echarts.getInstanceByDom(host) : null
      const series = inst?.getOption()?.series
      return Array.isArray(series) && series.length > 0
        ? series.map((s) => ({ name: s.name, color: s.color }))
        : null
    })
    if (seen !== null) return seen
    await page.waitForTimeout(250)
  }
  return null
}
const activityRows = () =>
  page.$$eval('#activity .activity-row', (els) =>
    els.map((el) => ({
      label: (el.querySelector('.activity-label')?.textContent ?? '').trim(),
      source: (el.querySelector('.activity-source')?.textContent ?? '').trim(),
      undone: [...el.querySelectorAll('.settings-note')].some((n) => n.textContent.trim() === 'undone'),
    })),
  )

// ── list plumbing (rows are anything that carries data-reorder-id) ───────────────────────────
const order = (rows) => page.$$eval(rows, (els) => els.map((el) => el.getAttribute('data-reorder-id')))
const rowSel = (rows, id) => `${rows}[data-reorder-id="${id}"]`
const gripSel = (rows, id) => `${rowSel(rows, id)} .reorder-grip`
const mids = (rows) =>
  page.$$eval(rows, (els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect()
      return box.top + box.height / 2
    }),
  )
const grabbing = () => page.evaluate(() => document.documentElement.classList.contains('reorder-active'))
const live = (scope) =>
  page.$eval(`${scope} .visually-hidden[aria-live="assertive"]`, (el) => (el.textContent ?? '').trim())
/** A page-scrolled row stands at `fraction` of the window: under the sticky chrome, clear of the
 *  toasts and of both 40px auto-scroll zones. */
const standAt = (selector, fraction = 0.45) =>
  page.evaluate(
    ([sel, f]) => {
      const el = document.querySelector(sel)
      window.scrollBy(0, el.getBoundingClientRect().top - window.innerHeight * f)
    },
    [selector, fraction],
  )
/** A capped box centred in the window and scrolled to its top. */
const boxTop = (box) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    el.scrollIntoView({ block: 'center' })
    el.scrollTop = 0
  }, box)
/** A capped box centred in the window, a row of it `offset` px below its top edge. */
const boxTo = (box, selector, offset) =>
  page.evaluate(
    ([b, sel, off]) => {
      const el = document.querySelector(b)
      el.scrollIntoView({ block: 'center' })
      const row = document.querySelector(sel)
      el.scrollTop += row.getBoundingClientRect().top - (el.getBoundingClientRect().top + off)
    },
    [box, selector, offset],
  )
const scrollTopOf = (box) => page.evaluate((sel) => document.querySelector(sel).scrollTop, box)
const visibleBand = (box) =>
  page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect()
    const top = Math.max(r.top, 0)
    const bottom = Math.min(r.bottom, window.innerHeight)
    const left = Math.max(0, r.left)
    return {
      top,
      bottom,
      clip: {
        x: Math.floor(left),
        y: Math.floor(top),
        width: Math.floor(Math.min(r.right, window.innerWidth) - left),
        height: Math.floor(bottom - top),
      },
    }
  }, box)
/** Who wins the sticky header's first labelled cell: the header, or a lifted row over it. */
const headerCover = (box) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    const th = [...el.querySelectorAll('thead th')].find((cell) => cell.textContent.trim() !== '')
    const r = th.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + Math.min(24, r.width / 2), r.top + r.height / 2)
    const lifted = el.querySelector('[data-reorder="lifted"]')
    const l = lifted === null ? null : lifted.getBoundingClientRect()
    return {
      header: th.textContent.trim(),
      headerOnTop: hit !== null && th.contains(hit),
      liftedOver: lifted !== null && hit !== null && lifted.contains(hit),
      headerBox: [Math.round(r.top), Math.round(r.bottom)],
      liftedBox: l === null ? null : [Math.round(l.top), Math.round(l.bottom)],
      overlapPx:
        l === null ? 0 : Math.max(0, Math.round(Math.min(r.bottom, l.bottom) - Math.max(r.top, l.top))),
      zIndex: {
        header: getComputedStyle(th).zIndex,
        lifted: lifted === null ? null : getComputedStyle(lifted).zIndex,
      },
    }
  }, box)

// ── toasts ───────────────────────────────────────────────────────────────────────────────────
const toastsWith = (text) => page.locator('.toast:not(.toast-leaving)').filter({ hasText: text })
async function toastText(text) {
  const message = page.locator('.toast:not(.toast-leaving) .toast-message').filter({ hasText: text }).last()
  await message.waitFor({ timeout: 10000 })
  return ((await message.textContent()) ?? '').trim()
}
async function toastSays(name, text, want) {
  const said = await toastText(text).catch((error) => `(no toast: ${error.message.split('\n')[0]})`)
  return check(name, said === want, said)
}
async function clearToasts() {
  for (const close of await page.locator('.toast-close').all()) await close.click().catch(() => {})
  await page.waitForTimeout(250)
}
async function clickUndo(text, which = 'last') {
  const toasts = toastsWith(text)
  await (which === 'first' ? toasts.first() : toasts.last())
    .getByRole('button', { name: 'Undo', exact: true })
    .click()
}
async function orderRestored() {
  await page
    .locator('.toast-message')
    .filter({ hasText: /^Order restored$/ })
    .last()
    .waitFor({ timeout: 10000 })
}
/** The list's save is back: no grip in `scope` is parked any more (R0: aria-disabled while busy). */
const waitIdle = (scope) =>
  page.waitForFunction(
    (sel) => document.querySelector(`${sel} .reorder-grip[aria-disabled="true"]`) === null,
    scope,
    { timeout: 15000 },
  )

// ── the drag instruments ─────────────────────────────────────────────────────────────────────
/** What lane R0's hook has written onto the rows right now; null when nothing is lifted. */
const liftState = (rows) =>
  page.evaluate((sel) => {
    const els = [...document.querySelectorAll(sel)]
    const lifted = els.filter((el) => el.getAttribute('data-reorder') === 'lifted')
    if (lifted.length === 0) return null
    const first = lifted[0]
    const isRow = first.tagName === 'TR'
    const table = isRow ? first.closest('table') : null
    const cells = isRow ? [...first.children] : []
    const actions = isRow ? first.querySelector('td.row-actions') : null
    return {
      table: isRow,
      liftedIds: lifted.map((el) => el.getAttribute('data-reorder-id')),
      offset: Number(/translateY\((-?[\d.]+)px\)/.exec(first.style.transform)?.[1] ?? NaN),
      transforms: lifted.map((el) => el.style.transform),
      displaced: els.filter(
        (el) => el.getAttribute('data-reorder') === 'shifting' && el.style.transform !== '',
      ).length,
      shifting: els.filter((el) => el.getAttribute('data-reorder') === 'shifting').length,
      peerTransforms: els.filter(
        (el) => el.getAttribute('data-reorder') !== 'lifted' && el.style.transform !== '',
      ).length,
      drop: els
        .filter((el) => el.hasAttribute('data-reorder-drop'))
        .map((el) => [el.getAttribute('data-reorder-id'), el.getAttribute('data-reorder-drop')]),
      grabbing: document.documentElement.classList.contains('reorder-active'),
      separate: table === null ? null : getComputedStyle(table).borderCollapse === 'separate',
      hairlines: isRow
        ? cells.every((td) => {
            const s = getComputedStyle(td)
            return (
              s.borderBottomStyle === 'solid' &&
              parseFloat(s.borderBottomWidth) >= 1 &&
              s.borderBottomColor !== 'rgba(0, 0, 0, 0)'
            )
          })
        : null,
      cellBackground: isRow && cells[1] ? getComputedStyle(cells[1]).backgroundColor : null,
      actionsBackground: actions === null ? null : getComputedStyle(actions).backgroundColor,
      shadow: getComputedStyle(first).boxShadow,
    }
  }, rows)
/** The pointer's travel that puts the lifted centre 40% of the way past the k-th peer's midpoint
 *  toward the next one: past exactly |k| peers (lane R0's slot rule) whatever the rows' heights. */
function aim(m, from, k) {
  const to = from + k
  const s = Math.sign(k)
  const beyond = m[to + s] ?? m[to] + s * Math.abs(m[to] - m[to - s])
  return m[to] + 0.4 * (beyond - m[to]) - m[from]
}
/** Press a grip, pass the 4px lift threshold, travel `dy` in steps — the button stays down. */
async function press(rows, id, dy, sign) {
  const g = await page.locator(gripSel(rows, id)).boundingBox()
  if (g === null) throw new Error(`no grip on screen for row ${id}`)
  const x = g.x + g.width / 2
  const y0 = g.y + g.height / 2
  await page.mouse.move(x, y0)
  await page.mouse.down()
  await page.mouse.move(x, y0 + sign * 6, { steps: 2 })
  await page.mouse.move(x, y0 + dy, { steps: 12 })
  await page.waitForTimeout(250)
  return { x, y0 }
}
/** A real mouse drag of `id` by k peers (k < 0 is up), every row a unit of one. The caller puts
 *  the rows on screen, clear of the auto-scroll zones. */
async function mouseDrag({ rows, id, k, shot = null }) {
  await clearToasts()
  const before = await order(rows)
  const from = before.indexOf(String(id))
  const to = from + k
  const dy = aim(await mids(rows), from, k)
  await press(rows, id, dy, Math.sign(k))
  const mid = await liftState(rows)
  if (shot !== null) await snap(shot)
  await page.mouse.up()
  await page.waitForTimeout(MOTION + 700)
  if (check('a row lifts under the pointer', mid !== null, mid)) {
    check('the lifted row follows the pointer (±2px)', Math.abs(mid.offset - dy) <= 2, {
      offset: mid.offset,
      dy,
    })
    check(`exactly the ${Math.abs(k)} row(s) it passes make room`, mid.displaced === Math.abs(k), mid.displaced)
    check('the page says grabbing mid-drag', mid.grabbing, mid.grabbing)
    if (mid.table) {
      check(
        "the lifted row's cells draw their own hairline (separate borders: the line travels with it)",
        mid.separate === true && mid.hairlines === true,
        { separate: mid.separate, hairlines: mid.hairlines },
      )
      if (mid.actionsBackground !== null) {
        check('the pinned actions cell rides on the lifted surface', mid.actionsBackground === mid.cellBackground, {
          cell: mid.cellBackground,
          actions: mid.actionsBackground,
        })
      }
    } else {
      check('the lifted row is raised — a shadow under it', mid.shadow !== 'none', mid.shadow)
    }
  }
  const expected = moveTo(before, from, to)
  const after = await order(rows)
  check('it lands where the gap was', same(after, expected), { from, to, after })
  return expected
}
/** Focus the grip, Space, the keys, Space — no judgement. */
async function keyboardPress(rows, id, keys) {
  await clearToasts()
  const grip = page.locator(gripSel(rows, id))
  const name = await grip.getAttribute('aria-label')
  await grip.focus()
  await page.keyboard.press('Space')
  await page.waitForTimeout(80)
  const lifted = await page
    .$eval(rowSel(rows, id), (el) => ({
      state: el.getAttribute('data-reorder'),
      mode: el.getAttribute('data-reorder-mode'),
    }))
    .catch(() => null)
  for (const key of keys) {
    await page.keyboard.press(key)
    await page.waitForTimeout(60)
  }
  await page.keyboard.press('Space')
  await page.waitForTimeout(400)
  return { name, lifted }
}
/** The keyboard path (spec §2.4): lifted from the keyboard, moved, focus kept on the grip. */
async function keyboardMove({ rows, id, keys }) {
  const before = await order(rows)
  const { name, lifted } = await keyboardPress(rows, id, keys)
  const from = before.indexOf(String(id))
  const places =
    keys.filter((key) => key === 'ArrowDown').length - keys.filter((key) => key === 'ArrowUp').length
  const expected = moveTo(before, from, from + places)
  const arrows = keys.map((key) => (key === 'ArrowDown' ? '↓' : '↑')).join(' ')
  check('Space lifts the row from the keyboard', lifted?.state === 'lifted' && lifted?.mode === 'keyboard', lifted)
  const after = await order(rows)
  check(`Space, ${arrows}, Space moves it ${Math.abs(places)} place(s)`, same(after, expected), { before, after })
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null)
  check('focus stays on the moved grip', focused === name, { focused, name })
  return expected
}
/** Reduced motion (spec §2.5): the lifted row still follows the pointer, peers stay put, one
 *  accent drop line marks the landing edge; Escape then cancels with no request. */
async function reducedMotion({ rows, id, k, popover = false }) {
  await clearToasts()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(250)
  try {
    const writes = writesNow()
    const before = await order(rows)
    const from = before.indexOf(String(id))
    const to = from + k
    const dy = aim(await mids(rows), from, k)
    await press(rows, id, dy, Math.sign(k))
    const mid = await liftState(rows)
    await snap(`${where.step}-held`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
    const after = await liftState(rows)
    const residue = await page.$$eval(
      rows,
      (els) =>
        els.filter(
          (el) =>
            el.hasAttribute('data-reorder') ||
            el.hasAttribute('data-reorder-drop') ||
            el.style.transform !== '',
        ).length,
    )
    const cursor = await grabbing()
    const open = popover ? await dialog().isVisible() : null
    await page.mouse.up()
    await page.waitForTimeout(MOTION + 300)
    if (check('reduced motion: a row lifts under the pointer', mid !== null, mid)) {
      check('reduced motion: it still follows the pointer (direct manipulation)', Math.abs(mid.offset - dy) <= 2, {
        offset: mid.offset,
        dy,
      })
      check('reduced motion: no peer shifts — no shifting row, no transform on a peer', mid.shifting === 0 && mid.peerTransforms === 0, mid)
      check('reduced motion: one accent drop line marks the landing edge', same(mid.drop, [[before[to], k > 0 ? 'after' : 'before']]), mid.drop)
    }
    check('Escape cancels at once: nothing lifted, no line, no transform, no grabbing cursor', after === null && residue === 0 && !cursor, {
      after,
      residue,
      cursor,
    })
    check('…with no request, and the order unchanged', writesNow() === writes && same(await order(rows), before), {
      writes: writesNow() - writes,
    })
    if (popover) check('Escape mid-drag leaves the Customize popover open', open === true, open)
  } finally {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.waitForTimeout(150)
  }
}
/** The ledger at 1280×800 is taller than the window: a pointer parked in the bottom 40px zone
 *  scrolls the page under the lifted row (spec §2.3.5, §10). Lane R3's long drag. */
async function longDrag(rows, id) {
  await clearToasts()
  const before = await order(rows)
  const from = before.indexOf(String(id))
  await standAt(rowSel(rows, id), 0.35)
  await page.waitForTimeout(250)
  const scrollBefore = await page.evaluate(() => window.scrollY)
  const g = await page.locator(gripSel(rows, id)).boundingBox()
  const x = g.x + g.width / 2
  const y0 = g.y + g.height / 2
  await page.mouse.move(x, y0)
  await page.mouse.down()
  await page.mouse.move(x, y0 + 6, { steps: 2 })
  await page.mouse.move(x, size.height - 12, { steps: 20 })
  await page.waitForTimeout(1200)
  const mid = await liftState(rows)
  const scrolled = (await page.evaluate(() => window.scrollY)) - scrollBefore
  await snap('ledger-auto-scroll')
  await page.mouse.move(x, size.height / 2, { steps: 10 })
  await page.waitForTimeout(250)
  await page.mouse.up()
  await page.waitForTimeout(MOTION + 700)
  const after = await order(rows)
  const to = after.indexOf(String(id))
  check('a row lifts and the page says grabbing', mid !== null && mid.grabbing, mid)
  check('the page auto-scrolls under a pointer held in the bottom 40px zone', scrolled > 200, { scrolled })
  check('the row travels with the scroll', to - from >= 8, { from, to })
  check('nothing else moved', same(after, moveTo(before, from, to)), after)
  return after
}
/** Inside a capped box: the LAST of `ids` dragged to the box's top edge — the box scrolls up under
 *  the held pointer and the row lands first (spec §10); the sticky header is read at rest, while the
 *  row is held over it (a judgement — plan Task 7), and once the drag ends. Then Undo. */
async function autoScrollInBox({ box, rows, ids, scope, label, shot }) {
  await clearToasts()
  const last = ids[ids.length - 1]
  await page.evaluate(
    ([b, sel]) => {
      const el = document.querySelector(b)
      el.scrollIntoView({ block: 'center' })
      const row = document.querySelector(sel)
      el.scrollTop += row.getBoundingClientRect().bottom - (el.getBoundingClientRect().bottom - 60)
    },
    [box, rowSel(rows, last)],
  )
  await page.waitForTimeout(250)
  const s0 = await scrollTopOf(box)
  const rest = await headerCover(box)
  const band = await visibleBand(box)
  const g = await page.locator(gripSel(rows, last)).boundingBox()
  const x = g.x + g.width / 2
  const y0 = g.y + g.height / 2
  await page.mouse.move(x, y0)
  await page.mouse.down()
  await page.mouse.move(x, y0 - 8, { steps: 2 })
  await page.mouse.move(x, band.top + 12, { steps: 14 })
  await page.waitForTimeout(1200)
  const s1 = await scrollTopOf(box)
  const held = await headerCover(box)
  await page.screenshot({ path: file(`${shot}-held`), clip: band.clip })
  await page.mouse.up()
  await page.waitForTimeout(MOTION + 700)
  check('at rest the sticky header is on top of its box', rest.headerOnTop, rest)
  check('holding the pointer in the top edge zone scrolls the box up', s0 > 20 && s1 < s0 - 20, { s0, s1 })
  note('JUDGE (plan Task 7): the row in hand over the sticky header, pointer held in the top zone', held)
  await toastSays('the toast names the row', /^Moved /, `Moved ${label}`)
  await waitIdle(scope)
  const now = (await order(rows)).filter((rowId) => ids.includes(rowId))
  check('the last row lands first', same(now, [last, ...ids.slice(0, -1)]), now)
  const after = await headerCover(box)
  check('once the drag ends the sticky header is on top again', after.headerOnTop, after)
  await clickUndo(`Moved ${label}`)
  await orderRestored()
  const back = await waitFor(async () => (await order(rows)).filter((rowId) => ids.includes(rowId)), ids)
  check('Undo puts the order back', same(back, ids), back)
}
/** Two PNGs of one clip compared pixel by pixel inside the page (no PNG library in the repo).
 *  `zones` are the pinned (position: sticky) cells, judged apart. A channel delta over 24 counts
 *  as a difference; a diff image marks every such pixel in magenta. */
function comparePngs(a, b, zones) {
  return page.evaluate(
    async ([a64, b64, rects]) => {
      const decode = async (data) => {
        const bin = atob(data)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(bitmap, 0, 0)
        return { w: bitmap.width, h: bitmap.height, px: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data }
      }
      const [A, B] = await Promise.all([decode(a64), decode(b64)])
      const w = Math.min(A.w, B.w)
      const h = Math.min(A.h, B.h)
      const mask = new Uint8Array(w * h)
      for (const r of rects) {
        for (let y = Math.max(0, r.y); y < Math.min(h, r.y + r.h); y += 1) {
          for (let x = Math.max(0, r.x); x < Math.min(w, r.x + r.w); x += 1) mask[y * w + x] = 1
        }
      }
      const out = new OffscreenCanvas(w, h)
      const octx = out.getContext('2d')
      const img = octx.createImageData(w, h)
      let outside = 0
      let inside = 0
      let outsidePixels = 0
      let insidePixels = 0
      let maxDelta = 0
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const i = (y * A.w + x) * 4
          const j = (y * B.w + x) * 4
          const k = (y * w + x) * 4
          const d = Math.max(
            Math.abs(A.px[i] - B.px[j]),
            Math.abs(A.px[i + 1] - B.px[j + 1]),
            Math.abs(A.px[i + 2] - B.px[j + 2]),
          )
          const pinned = mask[y * w + x] === 1
          if (pinned) insidePixels += 1
          else outsidePixels += 1
          if (d > maxDelta) maxDelta = d
          const differs = d > 24
          if (differs && pinned) inside += 1
          if (differs && !pinned) outside += 1
          img.data[k] = differs ? 255 : A.px[i]
          img.data[k + 1] = differs ? 0 : A.px[i + 1]
          img.data[k + 2] = differs ? 255 : A.px[i + 2]
          img.data[k + 3] = differs ? 255 : 72
        }
      }
      let png = null
      if (outside + inside > 0) {
        octx.putImageData(img, 0, 0)
        const bytes = new Uint8Array(await (await out.convertToBlob({ type: 'image/png' })).arrayBuffer())
        let s = ''
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        png = btoa(s)
      }
      return { sizes: [A.w, A.h, B.w, B.h], outside, outsidePixels, inside, insidePixels, maxDelta, png }
    },
    [a.toString('base64'), b.toString('base64'), zones],
  )
}
/** The resting look (spec §2.5, §10): the table as drawn — `.reorder-table`'s separate borders —
 *  against the same table switched back to `border-collapse: collapse` by an inline style. The
 *  class itself stays on: it also carries the grip column's width, and taking it off would move
 *  every column and compare nothing. Pinned (sticky) cells are judged apart: the collapsed model
 *  paints row lines on the table, UNDER a pinned cell's opaque background; the separate model has
 *  each cell draw its own, so a difference there is expected and is a person's call (Task 7). */
async function restingLook(table, clipOf, name) {
  await clearToasts()
  await page.mouse.move(2, 2) // off every row: no hover state in either shot
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await page.waitForTimeout(300)
  const geo = await page.evaluate(
    ([t, c]) => {
      const el = document.querySelector(t)
      const r = document.querySelector(c).getBoundingClientRect()
      const x = Math.max(0, Math.floor(r.left))
      const y = Math.max(0, Math.floor(r.top))
      const right = Math.min(window.innerWidth, Math.ceil(r.right))
      const bottom = Math.min(window.innerHeight, Math.ceil(r.bottom))
      const pinned = [...el.querySelectorAll('th, td')]
        .filter((cell) => getComputedStyle(cell).position === 'sticky')
        .map((cell) => {
          const b = cell.getBoundingClientRect()
          return { x: Math.floor(b.left) - x - 1, y: Math.floor(b.top) - y - 1, w: Math.ceil(b.width) + 3, h: Math.ceil(b.height) + 3 }
        })
      return { clip: { x, y, width: right - x, height: bottom - y }, pinned, model: getComputedStyle(el).borderCollapse }
    },
    [table, clipOf],
  )
  const drawn = await page.screenshot({ clip: geo.clip })
  await page.$eval(table, (el) => {
    el.style.borderCollapse = 'collapse'
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const collapsed = await page.screenshot({ clip: geo.clip })
  await page.$eval(table, (el) => {
    el.style.borderCollapse = ''
  })
  const diff = await comparePngs(drawn, collapsed, geo.pinned)
  writeFileSync(file(`${name}-separate`), drawn)
  writeFileSync(file(`${name}-collapse`), collapsed)
  if (diff.png !== null) writeFileSync(file(`${name}-diff`), Buffer.from(diff.png, 'base64'))
  const budget = Math.max(40, Math.round(diff.outsidePixels * 0.001))
  const { png, ...stats } = diff
  check(
    `the resting table matches the collapsed border model outside its pinned cells (≤ ${budget} px differ)`,
    geo.model === 'separate' && diff.outside <= budget,
    { model: geo.model, clip: geo.clip, budget, ...stats },
  )
  note('JUDGE (plan Task 7): pixels that differ INSIDE the pinned (sticky) cells', {
    inside: diff.inside,
    insidePixels: diff.insidePixels,
    diff: png === null ? null : `${size.width}-${name}-diff.png`,
  })
}

// ── Settings › Spending categories and Accounts (lane R2) ────────────────────────────────────
async function settingsWalk() {
  const categories = await api('GET', '/spending/categories')
  const catName = new Map(categories.map((c) => [String(c.id), c.name]))
  const accounts = await api('GET', '/net-worth/accounts')
  const accName = new Map(accounts.map((a) => [String(a.id), a.name]))
  const display = displayOf(accounts)
  const C0 = ORIG.categories

  step('open')
  await openSettings()

  step('categories-rest')
  const cat = await page.evaluate(
    ([t, card]) => {
      const table = document.querySelector(t)
      const head = table.querySelector('thead th')
      return {
        className: table.className,
        collapse: getComputedStyle(table).borderCollapse,
        gripHead: [head?.className ?? null, head?.getAttribute('aria-hidden') ?? null],
        heads: [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
        text: (document.querySelector(card)?.textContent ?? '').replace(/\s+/g, ' '),
      }
    },
    [CATS, '#categories'],
  )
  check('the table is reorderable, with separate borders', cat.className.split(' ').includes('reorder-table') && cat.collapse === 'separate', {
    className: cat.className,
    collapse: cat.collapse,
  })
  check('the grip column comes first and the Sort column is gone', same(cat.gripHead, ['reorder-grip-cell', 'true']) && same(cat.heads, ['', 'Category', 'Kind', 'Status', '']), {
    gripHead: cat.gripHead,
    heads: cat.heads,
  })
  check('the order note sits under the table (spec §8.1)', cat.text.includes(CAT_NOTE), null)
  check('the rows are the server order', same(await order(CAT_ROWS), C0), await order(CAT_ROWS))
  await boxTop(CAT_BOX)
  await restingLook(CATS, CAT_BOX, 'categories-rest')

  step('categories-drag')
  await boxTop(CAT_BOX)
  const cDrag = await mouseDrag({ rows: CAT_ROWS, id: C0[0], k: 3, shot: 'categories-mid-drag' })
  await toastSays('the toast names the category', /^Moved /, `Moved ${catName.get(C0[0])}`)
  await waitIdle('#categories')
  check('the server holds the new order', same(await read.categories(), cDrag), await read.categories())
  await openSettings()
  check('the order survives a reload', same(await order(CAT_ROWS), cDrag), await order(CAT_ROWS))
  await putOrder('categories', C0)
  await openSettings()
  check('put back through the API', same(await order(CAT_ROWS), C0), await order(CAT_ROWS))

  step('categories-undo')
  await boxTop(CAT_BOX)
  await mouseDrag({ rows: CAT_ROWS, id: C0[0], k: 3 })
  await toastText(`Moved ${catName.get(C0[0])}`)
  await waitIdle('#categories')
  await clickUndo(`Moved ${catName.get(C0[0])}`)
  await orderRestored()
  check("the toast's Undo restores the server order", same(await waitFor(read.categories, C0), C0), await read.categories())
  check('…and the table shows it', same(await waitFor(() => order(CAT_ROWS), C0), C0), await order(CAT_ROWS))

  step('categories-keyboard')
  await boxTop(CAT_BOX)
  const cKeys = await keyboardMove({ rows: CAT_ROWS, id: C0[1], keys: ['ArrowDown', 'ArrowDown'] })
  await toastSays('the toast names the category', /^Moved /, `Moved ${catName.get(C0[1])}`)
  await waitIdle('#categories')
  check('the server holds it', same(await read.categories(), cKeys), await read.categories())
  await clickUndo(`Moved ${catName.get(C0[1])}`)
  await orderRestored()
  check('Undo restores it', same(await waitFor(read.categories, C0), C0), await read.categories())

  step('categories-reduced-motion')
  await boxTop(CAT_BOX)
  await reducedMotion({ rows: CAT_ROWS, id: C0[0], k: 2 })

  if (size.width === 1600) {
    // A real two-tab 409 (spec §9): the list gains a row behind this page's back, over the API.
    step('categories-two-tab')
    await boxTop(CAT_BOX)
    const top = Math.max(...(await api('GET', '/spending/categories')).map((c) => c.sort_order))
    const created = await api('POST', '/spending/categories', { name: SCRATCH_CATEGORY })
    report.scratch.push({ kind: 'category', id: created.id })
    check('a category created with no position appends after the last one (spec §3.3)', created.sort_order > top, {
      created: created.sort_order,
      top,
    })
    expecting = [
      {
        re: /\/api\/v1\/spending\/categories\/order$/,
        status: 409,
        why: 'two-tab: this page still lists the categories as they were before the API added one',
      },
    ]
    const reload = page.waitForRequest(
      (r) => r.method() === 'GET' && /\/api\/v1\/spending\/categories(\?|$)/.test(r.url()),
      { timeout: 10000 },
    )
    await keyboardPress(CAT_ROWS, C0[0], ['ArrowDown'])
    await toastSays("the stale list shows the server's sentence (spec §8.3)", STALE_CATEGORIES, STALE_CATEGORIES)
    check('…and the card reloads the list', await reload.then(() => true, () => false), null)
    await waitIdle('#categories')
    const withNew = [...C0, String(created.id)]
    const seen = await waitFor(() => order(CAT_ROWS), withNew)
    check('nothing moved, and the new category is listed last', same(seen, withNew) && same(await read.categories(), withNew), seen)
    expecting = []
    await api('DELETE', `/spending/categories/${created.id}`)
    await openSettings()
    check('the scratch category is gone and the table reads as it did', same(await order(CAT_ROWS), C0), await order(CAT_ROWS))

    // A resize cancels a live drag (spec §2.3.7, §9) — easing home, no request.
    step('categories-resize-cancels')
    await boxTop(CAT_BOX)
    await clearToasts()
    const writes = writesNow()
    await press(CAT_ROWS, C0[0], aim(await mids(CAT_ROWS), 0, 2), 1)
    const lifted = await liftState(CAT_ROWS)
    await page.setViewportSize({ width: size.width - 40, height: size.height })
    await page.waitForTimeout(MOTION + 300)
    const after = await liftState(CAT_ROWS)
    const cursor = await grabbing()
    await page.mouse.up()
    await page.setViewportSize(size)
    await page.waitForTimeout(500)
    check('a resize mid-drag cancels the lift', lifted !== null && after === null && !cursor, {
      lifted: lifted?.liftedIds ?? null,
      after,
      cursor,
    })
    check('…with no request, and nothing moved', writesNow() === writes && same(await order(CAT_ROWS), C0), {
      writes: writesNow() - writes,
    })
  }

  step('accounts-rest')
  const roster = await page.evaluate(
    ([t, card]) => {
      const table = document.querySelector(t)
      const head = table.querySelector('thead th')
      const seq = [...table.querySelectorAll('tbody tr')].map((row) => {
        if (row.classList.contains('accounts-group-row')) {
          const th = row.querySelector('th')
          return { heading: row.textContent.trim(), scope: th?.getAttribute('scope') ?? null, span: th?.colSpan ?? null }
        }
        const cell = row.querySelector('.accounts-name-cell')
        return {
          id: row.getAttribute('data-reorder-id'),
          nested: row.classList.contains('component-row'),
          indent: cell === null ? null : parseFloat(getComputedStyle(cell).paddingLeft),
          disabled: row.querySelector('.reorder-grip')?.disabled ?? null,
        }
      })
      return {
        className: table.className,
        collapse: getComputedStyle(table).borderCollapse,
        gripHead: [head?.className ?? null, head?.getAttribute('aria-hidden') ?? null],
        heads: [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
        seq,
        text: (document.querySelector(card)?.textContent ?? '').replace(/\s+/g, ' '),
      }
    },
    [ACCS, '#accounts'],
  )
  const expectSeq = []
  for (const group of GROUP_ORDER) {
    const inGroup = display.filter((row) => row.group === group)
    if (inGroup.length === 0) continue
    expectSeq.push(`# ${GROUP_LABELS[group]}`, ...inGroup.map((row) => (row.parent === null ? row.id : `  ${row.id}`)))
  }
  const seenSeq = roster.seq.map((row) =>
    row.heading !== undefined ? `# ${row.heading}` : row.nested ? `  ${row.id}` : row.id,
  )
  const headings = roster.seq.filter((row) => row.heading !== undefined)
  check('the roster is reorderable, with separate borders', roster.className.split(' ').includes('reorder-table') && roster.collapse === 'separate', {
    className: roster.className,
    collapse: roster.collapse,
  })
  check('columns: grip · Account · Owner · Roll-up · Status · actions — no Group, no Sort', same(roster.gripHead, ['reorder-grip-cell', 'true']) && same(roster.heads, ['', 'Account', 'Owner', 'Roll-up', 'Status', '']), roster.heads)
  check(
    'one colgroup heading per non-empty group in GROUP_ORDER, each account under its group, each component right after its parent',
    same(seenSeq, expectSeq) && headings.every((row) => row.scope === 'colgroup' && row.span === 6),
    { seenSeq, expectSeq },
  )
  const nestedIndent = roster.seq.filter((row) => row.nested).map((row) => row.indent)
  const topIndent = roster.seq.filter((row) => row.id !== undefined && !row.nested).map((row) => row.indent)
  check('a component is indented in its Account cell', nestedIndent.length > 0 && Math.min(...nestedIndent) > Math.max(...topIndent), {
    nested: [...new Set(nestedIndent)],
    top: [...new Set(topIndent)],
  })
  const rangeOf = (row) => (row.parent === null ? row.group : `parent:${row.parent}`)
  const rangeSize = new Map()
  for (const row of display) rangeSize.set(rangeOf(row), (rangeSize.get(rangeOf(row)) ?? 0) + 1)
  const wantDisabled = display.filter((row) => rangeSize.get(rangeOf(row)) < 2).map((row) => row.id)
  const seenDisabled = roster.seq.filter((row) => row.disabled === true).map((row) => row.id)
  check('a grip is disabled exactly where its range holds nothing else (spec §9)', same(seenDisabled, wantDisabled), {
    seenDisabled,
    wantDisabled,
  })
  check('the order note sits under the roster (spec §8.1)', roster.text.includes(ACC_NOTE), null)
  await boxTop(ACC_BOX)
  await restingLook(ACCS, ACC_BOX, 'accounts-rest')

  // The longest group with no components (Liabilities in this book): single-row units, flat moves.
  const flatGroup = GROUP_ORDER.map((group) => display.filter((row) => row.group === group))
    .filter((rows) => rows.length >= 5 && rows.every((row) => row.parent === null))
    .reduce((a, b) => (b.length > a.length ? b : a), [])
  if (flatGroup.length < 5) throw new Error('no group of five or more accounts without components to drag in')
  const lg = flatGroup.map((row) => row.id)
  note('the group the flat account drags use', { group: flatGroup[0].group, accounts: lg.map((id) => accName.get(id)) })
  const A0 = await order(ACC_ROWS)

  step('accounts-drag')
  await boxTo(ACC_BOX, rowSel(ACC_ROWS, lg[0]), 80)
  const aDrag = await mouseDrag({ rows: ACC_ROWS, id: lg[0], k: 3, shot: 'accounts-mid-drag' })
  await toastSays('the toast names the account', /^Moved /, `Moved ${accName.get(lg[0])}`)
  await waitIdle('#accounts')
  check(
    'the server holds the whole roster in the new order — group by group, each parent before its components',
    same(await read.accountsStored(), aDrag),
    await read.accountsStored(),
  )
  await openSettings()
  check('the order survives a reload', same(await order(ACC_ROWS), aDrag), await order(ACC_ROWS))
  await putOrder('accounts', A0)
  await openSettings()
  check('put back through the API', same(await order(ACC_ROWS), A0), await order(ACC_ROWS))

  step('accounts-undo')
  await boxTo(ACC_BOX, rowSel(ACC_ROWS, lg[0]), 80)
  await mouseDrag({ rows: ACC_ROWS, id: lg[0], k: 3 })
  await toastText(`Moved ${accName.get(lg[0])}`)
  await waitIdle('#accounts')
  await clickUndo(`Moved ${accName.get(lg[0])}`)
  await orderRestored()
  check("the toast's Undo restores the roster on the server", same(await waitFor(read.accounts, ORIG.accounts), ORIG.accounts), await read.accounts())
  check('…and the table shows it', same(await waitFor(() => order(ACC_ROWS), A0), A0), await order(ACC_ROWS))

  step('accounts-keyboard')
  await boxTo(ACC_BOX, rowSel(ACC_ROWS, lg[1]), 80)
  const aKeys = await keyboardMove({ rows: ACC_ROWS, id: lg[1], keys: ['ArrowDown', 'ArrowDown'] })
  await toastSays('the toast names the account', /^Moved /, `Moved ${accName.get(lg[1])}`)
  await waitIdle('#accounts')
  check('the server holds it', same(await read.accountsStored(), aKeys), await read.accountsStored())
  await clickUndo(`Moved ${accName.get(lg[1])}`)
  await orderRestored()
  check('Undo restores it', same(await waitFor(read.accounts, ORIG.accounts), ORIG.accounts), await read.accounts())

  // A parent with components that has a sibling below it (Fidelity Traditional 401(k) here).
  let carrier = null
  for (const group of GROUP_ORDER) {
    const units = display.filter((row) => row.group === group && row.parent === null)
    for (let i = 0; carrier === null && i + 1 < units.length; i += 1) {
      const kids = display.filter((row) => row.parent === units[i].id).map((row) => row.id)
      if (kids.length > 0) {
        const sibling = units[i + 1].id
        carrier = {
          parent: units[i].id,
          kids,
          sibling: [sibling, ...display.filter((row) => row.parent === sibling).map((row) => row.id)],
        }
      }
    }
    if (carrier !== null) break
  }

  step('accounts-carry')
  if (carrier === null) {
    note('no parent with components has a sibling below it in this book — skipped', null)
  } else {
    const unit = [carrier.parent, ...carrier.kids]
    await boxTo(ACC_BOX, rowSel(ACC_ROWS, carrier.parent), 80)
    await clearToasts()
    const before = await order(ACC_ROWS)
    const centre = (list) =>
      page.evaluate(
        ([sel, ids]) => {
          const boxes = ids.map((id) => document.querySelector(`${sel}[data-reorder-id="${id}"]`).getBoundingClientRect())
          return (Math.min(...boxes.map((b) => b.top)) + Math.max(...boxes.map((b) => b.bottom))) / 2
        },
        [ACC_ROWS, list],
      )
    const dy = (await centre(carrier.sibling)) - (await centre(unit)) + 4
    await press(ACC_ROWS, carrier.parent, dy, 1)
    const mid = await liftState(ACC_ROWS)
    await snap('accounts-carry-mid-drag')
    await page.mouse.up()
    await page.waitForTimeout(MOTION + 700)
    check(
      'the parent lifts with its components as one unit — one transform on every row',
      mid !== null && same(mid.liftedIds, unit) && mid.transforms.every((t) => t !== '' && t === mid.transforms[0]),
      mid === null ? null : { lifted: mid.liftedIds, transforms: mid.transforms },
    )
    check('exactly the sibling it passes makes room', mid !== null && mid.displaced === carrier.sibling.length, mid?.displaced ?? null)
    await toastSays('the toast names the parent', /^Moved /, `Moved ${accName.get(carrier.parent)}`)
    await waitIdle('#accounts')
    const rest = before.filter((id) => !unit.includes(id))
    const at = rest.indexOf(carrier.sibling[carrier.sibling.length - 1]) + 1
    const expected = [...rest.slice(0, at), ...unit, ...rest.slice(at)]
    const nested = await page.$$eval(ACC_ROWS, (els) =>
      els.filter((el) => el.classList.contains('component-row')).map((el) => el.getAttribute('data-reorder-id')),
    )
    check(
      'it lands below its sibling, its components still nested right after it',
      same(await order(ACC_ROWS), expected) && carrier.kids.every((id) => nested.includes(id)),
      { expected, nested },
    )
    await clickUndo(`Moved ${accName.get(carrier.parent)}`)
    await orderRestored()
    check('Undo puts the group back', same(await waitFor(() => order(ACC_ROWS), before), before), await order(ACC_ROWS))
  }

  if (size.width === 1600 && carrier !== null) {
    // A component moves only among its siblings, and says where it is (spec §2.2, §8.2).
    step('accounts-component-range')
    const kid = carrier.kids[0]
    const n = carrier.kids.length
    const kidName = accName.get(kid)
    await boxTo(ACC_BOX, rowSel(ACC_ROWS, carrier.parent), 80)
    await clearToasts()
    const before = await order(ACC_ROWS)
    const writes = writesNow()
    await page.locator(gripSel(ACC_ROWS, kid)).focus()
    await page.keyboard.press('Space')
    await page.waitForTimeout(150)
    const liftedSaid = await live('#accounts')
    await page.keyboard.press('End')
    await page.waitForTimeout(300)
    const endSaid = await live('#accounts')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(MOTION + 300)
    const cancelSaid = await live('#accounts')
    check(
      "a component picks up within its parent's components",
      liftedSaid === `Picked up ${kidName}. Position 1 of ${n} in ${accName.get(carrier.parent)}'s components.`,
      liftedSaid,
    )
    check('End takes it to its last sibling and no further', endSaid === `${kidName}, position ${n} of ${n}.`, endSaid)
    check(
      'Escape puts it back, with no request',
      cancelSaid === `Cancelled. ${kidName} is back at position 1 of ${n}.` &&
        writesNow() === writes &&
        same(await order(ACC_ROWS), before),
      { cancelSaid, writes: writesNow() - writes },
    )
  }

  step('accounts-autoscroll')
  await autoScrollInBox({
    box: ACC_BOX,
    rows: ACC_ROWS,
    ids: lg,
    scope: '#accounts',
    label: accName.get(lg[lg.length - 1]),
    shot: 'accounts-autoscroll',
  })

  step('accounts-reduced-motion')
  await boxTo(ACC_BOX, rowSel(ACC_ROWS, lg[0]), 80)
  await reducedMotion({ rows: ACC_ROWS, id: lg[0], k: 2 })
}

// ── Portfolio › Manage › Transactions (lane R3) ──────────────────────────────────────────────
async function portfolioWalk() {
  const trades = await api('GET', '/portfolio/transactions')
  const securities = await api('GET', '/portfolio/securities')
  const ticker = new Map(securities.map((s) => [s.id, s.ticker]))
  const trade = new Map(trades.map((t) => [String(t.id), t]))
  // Every real-data move below passes rows of OTHER holdings only — the one holding with two rows,
  // NVDA · Schwab ESPP, holds two buys — so no figure moves (lane R3's census).
  const quiet = (id) =>
    `Moved the ${ticker.get(trade.get(id).security_id)} ${trade.get(id).type}. No holding's figures changed.`
  const L0 = ORIG.ledger

  step('open')
  await visit(HOUSEHOLD_LEDGER, TXN_ROWS)

  step('ledger-rest')
  const rest = await page.evaluate(
    ([t, panel]) => {
      const table = document.querySelector(t)
      const head = table.querySelector('thead th')
      return {
        className: table.className,
        collapse: getComputedStyle(table).borderCollapse,
        gripHead: [head?.className ?? null, head?.getAttribute('aria-hidden') ?? null],
        hint: (document.querySelector(`${panel} p.hint`)?.textContent ?? '').replace(/\s+/g, ' '),
      }
    },
    [LEDGER, LEDGER_PANEL],
  )
  check('the ledger is reorderable, with separate borders', rest.className.split(' ').includes('reorder-table') && rest.collapse === 'separate', {
    className: rest.className,
    collapse: rest.collapse,
  })
  check('the grip column comes first', same(rest.gripHead, ['reorder-grip-cell', 'true']), rest.gripHead)
  check('the hint says the list is the replay order (spec §8.1)', rest.hint.includes(LEDGER_HINT), rest.hint)
  check('the rows are the server order', same(await order(TXN_ROWS), L0), await order(TXN_ROWS))
  await standAt(`${LEDGER} thead`, 0.2)
  await restingLook(LEDGER, LEDGER, 'ledger-rest')

  step('ledger-drag')
  const movedFirst = size.width === 1280 ? L0[0] : L0[1]
  let bOrder
  if (size.width === 1280) {
    bOrder = await longDrag(TXN_ROWS, L0[0])
  } else {
    await standAt(rowSel(TXN_ROWS, L0[1]))
    await page.waitForTimeout(250)
    bOrder = await mouseDrag({ rows: TXN_ROWS, id: L0[1], k: 3, shot: 'ledger-mid-drag' })
  }
  await toastSays('the toast names the trade and says no figure moved', /^Moved the /, quiet(movedFirst))
  await waitIdle(LEDGER_PANEL)
  check('the server holds the new order', same(await read.transactions(), bOrder), await read.transactions())
  await visit(HOUSEHOLD_LEDGER, TXN_ROWS)
  check('the order survives a reload', same(await order(TXN_ROWS), bOrder), await order(TXN_ROWS))
  await putOrder('transactions', L0)
  await visit(HOUSEHOLD_LEDGER, TXN_ROWS)
  check('put back through the API', same(await order(TXN_ROWS), L0), await order(TXN_ROWS))

  step('ledger-undo')
  await standAt(rowSel(TXN_ROWS, L0[1]))
  await page.waitForTimeout(250)
  await mouseDrag({ rows: TXN_ROWS, id: L0[1], k: 3 })
  await toastText(/^Moved the /)
  await waitIdle(LEDGER_PANEL)
  await clickUndo(/^Moved the /)
  await orderRestored()
  await page.waitForTimeout(SETTLE) // the page's reload lands (R3: Undo is not optimistic)
  check("the toast's Undo restores the server order", same(await read.transactions(), L0), await read.transactions())
  check('…and the ledger shows it', same(await waitFor(() => order(TXN_ROWS), L0), L0), await order(TXN_ROWS))

  step('ledger-keyboard')
  await standAt(rowSel(TXN_ROWS, L0[0]))
  const dOrder = await keyboardMove({ rows: TXN_ROWS, id: L0[0], keys: ['ArrowDown', 'ArrowDown'] })
  await toastSays('the toast names the trade', /^Moved the /, quiet(L0[0]))
  await waitIdle(LEDGER_PANEL)
  check('the server holds it', same(await read.transactions(), dOrder), await read.transactions())
  await clickUndo(/^Moved the /)
  await orderRestored()
  check('Undo restores it', same(await waitFor(read.transactions, L0), L0), await read.transactions())

  if (size.width === 1600) {
    // A person scope that hides rows (Grace's: her own accounts plus the joint one).
    step('ledger-person-scope')
    let person = null
    for (const candidate of PEOPLE) {
      const ids = await read.transactions(candidate.id)
      if (ids.length >= 3 && ids.length < L0.length) {
        person = candidate.id
        break
      }
    }
    if (person === null) {
      note('no person scope hides a row in this book — skipped', null)
    } else {
      const scoped = await read.transactions(person)
      await visit(`/portfolio?section=manage&owner=${person}`, TXN_ROWS)
      check('the scope lists exactly its own rows', same(await order(TXN_ROWS), scoped), await order(TXN_ROWS))
      await standAt(rowSel(TXN_ROWS, scoped[0]))
      await page.waitForTimeout(250)
      const put = page.waitForRequest(
        (r) => r.method() === 'PUT' && r.url().includes('/portfolio/transactions/order'),
        { timeout: 10000 },
      )
      const eOrder = await mouseDrag({ rows: TXN_ROWS, id: scoped[0], k: 2 })
      const request = await put
      const sent = (request.postDataJSON()?.ids ?? []).map(String)
      check(
        'the PUT names the scope and carries the visible ids in their new order',
        new URL(request.url()).searchParams.get('owner') === String(person) && same(sent, eOrder),
        { url: request.url(), sent },
      )
      await toastText(/^Moved the /)
      await waitIdle(LEDGER_PANEL)
      const household = await read.transactions()
      const visible = new Set(scoped)
      check(
        "every hidden row keeps its slot in the household order (its holding's rows never move)",
        L0.every((id, index) => visible.has(id) || household[index] === id),
        household,
      )
      check('the visible rows moved among their own slots', same(household.filter((id) => visible.has(id)), eOrder), household)
      await clickUndo(/^Moved the /)
      await orderRestored()
      check('Undo restores the household order', same(await waitFor(read.transactions, L0), L0), await read.transactions())
    }

    // A move that re-times a trade: a sell dragged above its buy (spec §5, §8.1).
    step('ledger-figures')
    const voo = securities.find((s) => s.ticker === 'VOO') ?? securities[0]
    const buy = await api('POST', '/portfolio/transactions', {
      security_id: voo.id,
      account: SCRATCH_ACCOUNT,
      type: 'buy',
      shares: '10',
      price: '100',
    })
    report.scratch.push({ kind: 'trade', id: buy.id })
    const sell = await api('POST', '/portfolio/transactions', {
      security_id: voo.id,
      account: SCRATCH_ACCOUNT,
      type: 'sell',
      shares: '4',
      price: '150',
    })
    report.scratch.push({ kind: 'trade', id: sell.id })
    try {
      await visit(HOUSEHOLD_LEDGER, TXN_ROWS)
      check(
        'trades added with no position land last in the ledger',
        same((await order(TXN_ROWS)).slice(-2), [String(buy.id), String(sell.id)]),
        (await order(TXN_ROWS)).slice(-3),
      )
      await standAt(rowSel(TXN_ROWS, sell.id))
      await page.waitForTimeout(250)
      await mouseDrag({ rows: TXN_ROWS, id: sell.id, k: -1, shot: 'ledger-figures-mid-drag' })
      // Buy 10 @ 100 then sell 4 @ 150 realizes $200; the sell replayed first finds no shares
      // (average cost 0) and realizes $600 — the fold's arithmetic, read off the server's answer.
      await toastSays(
        'the toast names the realized-gain change the move made',
        /^Moved the /,
        `Moved the ${voo.ticker} sell. ${voo.ticker} at ${SCRATCH_ACCOUNT}: realized gain $200.00 → $600.00.`,
      )
      await waitIdle(LEDGER_PANEL)
    } finally {
      for (const id of [sell.id, buy.id]) {
        await api('DELETE', `/portfolio/transactions/${id}`).catch((error) =>
          problem(`${tag} portfolio: scratch trade ${id} was not deleted — ${error.message}`),
        )
      }
    }
    await visit(HOUSEHOLD_LEDGER, TXN_ROWS)
    check(
      'the scratch trades are gone and the ledger reads as it did',
      same(await order(TXN_ROWS), L0) && same(await read.transactions(), L0),
      await order(TXN_ROWS),
    )
  }

  step('ledger-reduced-motion')
  await standAt(rowSel(TXN_ROWS, L0[2]))
  await page.waitForTimeout(250)
  await reducedMotion({ rows: TXN_ROWS, id: L0[2], k: 2 })
}

// ── Overview › Customize (lane R4) ───────────────────────────────────────────────────────────
async function overviewWalk() {
  step('open')
  await openOverview()
  check(
    'the tiles start in the stored order (the defaults: finance_realdata stores no layout)',
    same(await tileOrder(), DEFAULT_LAYOUT.tiles),
    await tileOrder(),
  )

  step('customize-rest')
  await openCustomize()
  const tiles = await rowsOf('Summary tiles')
  check(
    'Summary tiles lists the stored order with a grip on every row, nothing hidden',
    same(tiles, ['⋮ [x] Net worth', '⋮ [x] Portfolio', '⋮ [x] Living spending', '⋮ [x] Estimated tax']),
    tiles,
  )
  const cards = await rowsOf('Deeper views')
  check(
    'Deeper views lists the stored order with a grip on every row, nothing hidden',
    same(cards, ['⋮ [x] Year to date', '⋮ [x] Portfolio performance', '⋮ [x] Recent spending', '⋮ [x] Money flow']),
    cards,
  )
  const shape = await page.$$eval(`${DIALOG} .overview-customize-row`, (els) => ({
    heights: els.map((el) => Math.round(el.getBoundingClientRect().height)),
    lefts: els.map((el) => Math.round(el.querySelector('input').getBoundingClientRect().left)),
  }))
  check('every row is one height and every box stands in one column', new Set(shape.heights).size === 1 && new Set(shape.lefts).size === 1, shape)
  await snap('customize-rest')

  step('customize-drag')
  const moved = await mouseDrag({ rows: TILE_ROWS, id: 'net_worth', k: 2, shot: 'customize-mid-drag' })
  await page.waitForTimeout(600)
  check('the tiles behind the popover take the new order', same(await tileOrder(), moved), await tileOrder())
  check('the drop leaves the popover open', await dialog().isVisible(), null)
  check('no toast — a layout preference applies at once (spec §6)', (await page.locator('.toast').count()) === 0, await page.locator('.toast-message').allTextContents())
  const want = { tiles: moved, cards: DEFAULT_LAYOUT.cards }
  let stored = null
  for (let attempt = 0; attempt < 20 && !sameLayout(stored, want); attempt += 1) {
    stored = await read.layout()
    if (!sameLayout(stored, want)) await sleep(250)
  }
  check('the server holds the new layout (the pref sync)', sameLayout(stored, want), stored)
  await openOverview()
  check('the order survives a reload', same(await tileOrder(), moved), await tileOrder())
  await api('PATCH', '/prefs', { overview_layout: DEFAULT_LAYOUT })
  await openOverview()
  check('put back through the API', same(await tileOrder(), DEFAULT_LAYOUT.tiles), await tileOrder())

  step('customize-keyboard')
  await openCustomize()
  const typed = await keyboardMove({ rows: TILE_ROWS, id: 'portfolio', keys: ['ArrowDown', 'ArrowDown'] })
  await page.waitForTimeout(400)
  check('the tiles behind take it', same(await tileOrder(), typed), await tileOrder())
  const said = await live(`${DIALOG} fieldset:nth-of-type(1)`)
  check('the list says where it landed (spec §8.2)', said === 'Dropped Portfolio at position 4 of 4.', said)
  await dialog().getByRole('button', { name: 'Reset to defaults', exact: true }).click()
  await page.waitForTimeout(600)
  check('Reset to defaults puts the tiles back', same(await tileOrder(), DEFAULT_LAYOUT.tiles), await tileOrder())
  let reset = null
  for (let attempt = 0; attempt < 20 && !sameLayout(reset, DEFAULT_LAYOUT); attempt += 1) {
    reset = await read.layout()
    if (!sameLayout(reset, DEFAULT_LAYOUT)) await sleep(250)
  }
  check('…and the server holds the defaults', sameLayout(reset, DEFAULT_LAYOUT), reset)

  step('customize-escape')
  const writes = writesNow()
  const grip = await page.locator(gripSel(TILE_ROWS, 'portfolio')).boundingBox()
  const x = grip.x + grip.width / 2
  const y = grip.y + grip.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 40, { steps: 5 })
  await page.waitForTimeout(150)
  const up = await liftState(TILE_ROWS)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(MOTION + 200)
  const gone = await liftState(TILE_ROWS)
  const open = await dialog().isVisible()
  await page.mouse.up()
  await page.waitForTimeout(MOTION + 300)
  check('a row was up when Escape landed', up !== null && same(up.liftedIds, ['portfolio']), up)
  check('Escape mid-drag cancels the drag only — the popover stays open (spec §6, §9)', gone === null && open, { gone, open })
  check(
    'the cancelled drag moved and saved nothing',
    same(await tileOrder(), DEFAULT_LAYOUT.tiles) && writesNow() === writes,
    { tiles: await tileOrder(), writes: writesNow() - writes },
  )
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? null)
  check(
    'with nothing lifted, Escape closes the popover and hands focus back to Customize',
    (await dialog().count()) === 0 && focused === 'Customize',
    { focused },
  )

  step('customize-reduced-motion')
  await openCustomize()
  await reducedMotion({ rows: TILE_ROWS, id: 'net_worth', k: 2, popover: true })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
}

// ── Credit Cards › Card roster and Categories & weights (lane R5) ────────────────────────────
async function cardsWalk() {
  const cards = await api('GET', '/credit-cards')
  const weights = await api('GET', '/credit-cards/categories')
  const cardName = new Map(cards.map((c) => [String(c.id), c.name]))
  const weightName = new Map(weights.map((c) => [String(c.id), c.name]))
  const drawnCard = (c) => c.is_active && c.limit_events.length > 0
  const drawn = new Set(cards.filter(drawnCard).map((c) => String(c.id)))
  const active = new Set(cards.filter((c) => c.is_active).map((c) => String(c.id)))
  /** The chart's expected legend: the list order, drawn cards only, then the total. */
  const legendFor = (ids) => {
    const names = ids.filter((id) => drawn.has(id)).map((id) => cardName.get(id))
    return names.length > 1 ? [...names, 'Total line'] : names
  }
  // A person's view is their own cards plus the joint ones (CreditCardsPage's ownerMatches).
  const drawnIn = (scope) =>
    cards.filter(
      (c) => drawnCard(c) && (scope === 'joint' ? c.person_id === null : c.person_id === scope || c.person_id === null),
    ).length
  const K0 = ORIG.cards
  const W0 = ORIG.weights

  step('open')
  await openManage()

  step('rest')
  for (const [table, clipOf, name] of [
    [ROSTER, ROSTER, 'roster-rest'],
    [WEIGHTS, WEIGHT_BOX, 'weights-rest'],
  ]) {
    const rest = await page.evaluate((sel) => {
      const t = document.querySelector(sel)
      const head = t.querySelector('thead th')
      const cells = [...t.querySelectorAll('tbody tr:nth-child(-n+3) > td')]
      return {
        className: t.className,
        collapse: getComputedStyle(t).borderCollapse,
        gripHead: [head?.className ?? null, head?.getAttribute('aria-hidden') ?? null],
        hairlines: cells.every((td) => getComputedStyle(td).borderBottomWidth === '1px'),
      }
    }, table)
    check(`${table} is reorderable, with separate borders`, rest.className.split(' ').includes('reorder-table') && rest.collapse === 'separate', rest)
    check(`${table} puts the grip column first`, same(rest.gripHead, ['reorder-grip-cell', 'true']), rest.gripHead)
    check(`every ${table} cell keeps its hairline`, rest.hairlines, rest)
    if (table === ROSTER) await standAt(`${ROSTER} thead`, 0.25)
    else await boxTop(WEIGHT_BOX)
    await restingLook(table, clipOf, name)
  }
  check('the roster is the server order', same(await order(CARD_ROWS), K0), await order(CARD_ROWS))
  check('Categories & weights are the server order', same(await order(WEIGHT_ROWS), W0), await order(WEIGHT_ROWS))

  let colourOf = null
  if (size.width === 1600) {
    // Spec §7 as amended: a card's colour is its rank by id among ALL the cards the page knows.
    step('colours')
    await visit(LINES, 'section.chart-card')
    const before = await lineSeries()
    check(
      'the credit-line chart painted, a colour on every series',
      before !== null && before.every((s) => typeof s.color === 'string' && s.color !== ''),
      before,
    )
    check('its legend is the list order', same(before?.map((s) => s.name) ?? null, legendFor(K0)), before)
    colourOf = new Map((before ?? []).map((s) => [s.name, s.color]))
    for (const scope of [...PEOPLE.map((person) => person.id), 'joint']) {
      await visit(`/credit-cards?section=lines&owner=${scope}`, 'section.chart-card')
      if (drawnIn(scope) === 0) {
        note(`owner=${scope} draws no card`, null)
        continue
      }
      const seen = ((await lineSeries()) ?? []).filter((s) => s.name !== 'Total line')
      check(
        `owner=${scope}: every card drawn wears its household colour`,
        seen.length > 0 && seen.every((s) => colourOf.get(s.name) === s.color),
        seen,
      )
    }
  }

  step('roster-drag')
  await openManage()
  await standAt(rowSel(CARD_ROWS, K0[0]))
  await page.waitForTimeout(250)
  const cOrder = await mouseDrag({ rows: CARD_ROWS, id: K0[0], k: 3, shot: 'roster-mid-drag' })
  await toastSays('the toast names the card', /^Moved /, `Moved ${cardName.get(K0[0])}`)
  await waitIdle(ROSTER)
  check('the server holds the new order', same(await read.cards(), cOrder), await read.cards())
  await openManage()
  check('the order survives a reload', same(await order(CARD_ROWS), cOrder), await order(CARD_ROWS))

  if (size.width === 1600) {
    step('roster-follows')
    await visit(REWARDS, '[id^="card-col-"]')
    const columns = await page.$$eval('[id^="card-col-"]', (els) => els.map((el) => el.id.slice('card-col-'.length)))
    check("the rewards matrix's columns follow the new order", same(columns, cOrder.filter((id) => active.has(id))), columns)
    await visit(LINES, 'section.chart-card')
    const after = await lineSeries()
    check('the legend follows the new order', same(after?.map((s) => s.name) ?? null, legendFor(cOrder)), after)
    check('the move changed the drawn order (so the colour check means something)', !same(legendFor(cOrder), legendFor(K0)), legendFor(cOrder))
    check(
      'every card keeps its colour through the reorder',
      (after ?? []).length > 0 && (after ?? []).every((s) => colourOf.get(s.name) === s.color),
      after,
    )
    await page
      .locator('section.chart-card', { has: page.locator('h2', { hasText: 'Credit line history' }) })
      .screenshot({ path: file('credit-lines-after-reorder') })
    const narrow = PEOPLE.map((person) => person.id)
      .filter((id) => drawnIn(id) > 0)
      .sort((a, b) => drawnIn(a) - drawnIn(b))[0]
    if (narrow === undefined) {
      note('no person scope draws a card — the scoped colour check after the reorder is skipped', null)
    } else {
      await visit(`/credit-cards?section=lines&owner=${narrow}`, 'section.chart-card')
      const scoped = ((await lineSeries()) ?? []).filter((s) => s.name !== 'Total line')
      check(
        `owner=${narrow} after the reorder: each card still wears its household colour`,
        scoped.length > 0 && scoped.every((s) => colourOf.get(s.name) === s.color),
        scoped,
      )
    }
  }

  step('roster-put-back')
  await putOrder('cards', K0)
  await openManage()
  check('put back through the API', same(await order(CARD_ROWS), K0), await order(CARD_ROWS))

  step('roster-undo')
  await standAt(rowSel(CARD_ROWS, K0[0]))
  await page.waitForTimeout(250)
  await mouseDrag({ rows: CARD_ROWS, id: K0[0], k: 3 })
  await toastText(`Moved ${cardName.get(K0[0])}`)
  await waitIdle(ROSTER)
  await clickUndo(`Moved ${cardName.get(K0[0])}`)
  await orderRestored()
  await page.waitForTimeout(SETTLE)
  check("the toast's Undo restores the server order", same(await read.cards(), K0), await read.cards())
  check('…and the roster shows it', same(await waitFor(() => order(CARD_ROWS), K0), K0), await order(CARD_ROWS))

  step('roster-keyboard')
  await standAt(rowSel(CARD_ROWS, K0[1]))
  const gOrder = await keyboardMove({ rows: CARD_ROWS, id: K0[1], keys: ['ArrowDown', 'ArrowDown'] })
  await toastSays('the toast names the card', /^Moved /, `Moved ${cardName.get(K0[1])}`)
  await waitIdle(ROSTER)
  check('the server holds it', same(await read.cards(), gOrder), await read.cards())
  await clickUndo(`Moved ${cardName.get(K0[1])}`)
  await orderRestored()
  check('Undo restores it', same(await waitFor(read.cards, K0), K0), await read.cards())

  step('roster-reduced-motion')
  await standAt(rowSel(CARD_ROWS, K0[0]))
  await page.waitForTimeout(250)
  await reducedMotion({ rows: CARD_ROWS, id: K0[0], k: 2 })

  step('weights-drag')
  await boxTop(WEIGHT_BOX)
  const hOrder = await mouseDrag({ rows: WEIGHT_ROWS, id: W0[0], k: 3, shot: 'weights-mid-drag' })
  await toastSays('the toast names the category', /^Moved /, `Moved ${weightName.get(W0[0])}`)
  await waitIdle(WEIGHTS)
  check('the server holds the new order', same(await read.weights(), hOrder), await read.weights())
  await openManage()
  check('the order survives a reload', same(await order(WEIGHT_ROWS), hOrder), await order(WEIGHT_ROWS))
  await putOrder('weights', W0)
  await openManage()
  check('put back through the API', same(await order(WEIGHT_ROWS), W0), await order(WEIGHT_ROWS))

  step('weights-undo')
  await boxTop(WEIGHT_BOX)
  await mouseDrag({ rows: WEIGHT_ROWS, id: W0[0], k: 3 })
  await toastText(`Moved ${weightName.get(W0[0])}`)
  await waitIdle(WEIGHTS)
  await clickUndo(`Moved ${weightName.get(W0[0])}`)
  await orderRestored()
  await page.waitForTimeout(SETTLE)
  check("the toast's Undo restores the server order", same(await read.weights(), W0), await read.weights())
  check('…and the list shows it', same(await waitFor(() => order(WEIGHT_ROWS), W0), W0), await order(WEIGHT_ROWS))

  step('weights-autoscroll')
  await autoScrollInBox({
    box: WEIGHT_BOX,
    rows: WEIGHT_ROWS,
    ids: W0,
    scope: WEIGHTS,
    label: weightName.get(W0[W0.length - 1]),
    shot: 'weights-autoscroll',
  })

  step('weights-keyboard')
  await boxTop(WEIGHT_BOX)
  const jOrder = await keyboardMove({ rows: WEIGHT_ROWS, id: W0[1], keys: ['ArrowDown', 'ArrowDown'] })
  await toastSays('the toast names the category', /^Moved /, `Moved ${weightName.get(W0[1])}`)
  await waitIdle(WEIGHTS)
  check('the server holds it', same(await read.weights(), jOrder), await read.weights())
  await clickUndo(`Moved ${weightName.get(W0[1])}`)
  await orderRestored()
  check('Undo restores it', same(await waitFor(read.weights, W0), W0), await read.weights())

  step('weights-reduced-motion')
  await boxTop(WEIGHT_BOX)
  await reducedMotion({ rows: WEIGHT_ROWS, id: W0[0], k: 2 })
}

// ── Activity: the logged lists' Undo, and one entry per logged reorder (spec §3.2, §8.4, §9) ──
async function activityWalk() {
  const catName = new Map((await api('GET', '/spending/categories')).map((c) => [String(c.id), c.name]))

  step('activity-undo')
  await openSettings()
  await boxTop(CAT_BOX)
  const y0 = await order(CAT_ROWS)
  await keyboardMove({ rows: CAT_ROWS, id: y0[2], keys: ['ArrowDown'] })
  await toastText(`Moved ${catName.get(y0[2])}`)
  await waitIdle('#categories')
  await clearToasts()
  const fresh = report.logged[report.logged.length - 1] ?? null
  await visit('/settings?section=data', '#activity .activity-row')
  const top = page.locator('#activity .activity-row').first()
  const label = ((await top.locator('.activity-label').textContent()) ?? '').trim()
  const newest = (await activity(1))[0] ?? null
  check(
    'the newest Activity entry is that reorder, labelled by its list (spec §8.4)',
    newest?.type === 'batch' && newest.batch_id === fresh?.id && newest.label === label && LABEL_OF.categories.test(label),
    { label, newest, fresh },
  )
  await top.getByRole('button', { name: 'Undo', exact: true }).click()
  check('the first click arms it', (await top.getByRole('button', { name: 'Undo?', exact: true }).count()) === 1, null)
  await top.getByRole('button', { name: 'Undo?', exact: true }).click()
  await toastText(`Undone — ${label}`)
  check("the card's Undo restores the order", same(await waitFor(read.categories, y0), y0), await read.categories())
  const wantRows = [
    [`Undid: ${label}`, false],
    [label, true],
  ]
  const rows = await waitFor(async () => (await activityRows()).slice(0, 2).map((row) => [row.label, row.undone]), wantRows)
  check('the feed puts the undo on top and marks the entry undone', same(rows, wantRows), rows)

  step('activity-overlap')
  await openSettings()
  await boxTop(CAT_BOX)
  const z0 = await order(CAT_ROWS)
  const a = z0[3]
  const aName = catName.get(a)
  await keyboardMove({ rows: CAT_ROWS, id: a, keys: ['ArrowDown'] })
  await toastText(`Moved ${aName}`)
  await waitIdle('#categories')
  // Both toasts must stay on screen for the two Undos: the pointer rests on the first one, which
  // pauses the toast clock (ToastProvider's hover latch). Focus stays on the moved grip.
  await toastsWith(`Moved ${aName}`).first().hover()
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Space')
  await page.waitForTimeout(400)
  await waitIdle('#categories')
  const zA = moveTo(z0, 3, 4)
  const zB = moveTo(zA, 4, 5)
  check('a second move of the same row saves on top of the first', same(await read.categories(), zB), await read.categories())
  expecting = [
    {
      re: /\/api\/v1\/activity\/batches\/[0-9a-f-]+\/undo$/,
      status: 409,
      why: "overlap step: the first move's Undo is refused because the second move touched its rows",
    },
  ]
  await clickUndo(`Moved ${aName}`, 'first')
  const refused = await toastText(OVERLAP).catch(() => null)
  check("the first move's Undo is refused with the overlap sentence (spec §9)", refused === OVERLAP, refused)
  check('…and nothing changed', same(await read.categories(), zB), await read.categories())
  expecting = []
  await clickUndo(`Moved ${aName}`, 'last')
  await orderRestored()
  check("the second move's Undo still works: the rows read as after the first", same(await waitFor(read.categories, zA), zA), await read.categories())
  await putOrder('categories', z0)
  await openSettings()
  check('put back through the API', same(await order(CAT_ROWS), z0), await order(CAT_ROWS))

  step('activity-feed')
  const batches = (await activity(200)).filter((entry) => entry.type === 'batch')
  const byId = new Map(batches.map((b) => [b.batch_id, b]))
  const missing = report.logged.filter((b) => !byId.has(b.id))
  const mislabelled = report.logged.filter((b) => byId.has(b.id) && !LABEL_OF[b.list].test(byId.get(b.id).label))
  check(
    'every logged reorder of this pass is in Activity, labelled by its list (spec §8.4)',
    report.logged.length > 0 && missing.length === 0 && mislabelled.length === 0,
    { logged: report.logged.length, missing, mislabelled },
  )
  const entries = batches.filter((b) => REORDER_LABEL.test(b.label))
  check(
    'one Activity entry per logged reorder — none twice, none from a cancelled drag or a refused save',
    entries.length === report.logged.length && new Set(report.logged.map((b) => b.id)).size === report.logged.length,
    { entries: entries.length, logged: report.logged.length },
  )
  const badUndos = report.undos.filter((u) => byId.get(u.id)?.label !== `Undid: ${byId.get(u.of)?.label}`)
  check('every Undo is its own entry, "Undid: {label}"', report.undos.length > 0 && badUndos.length === 0, {
    undos: report.undos.length,
    badUndos,
  })
  await visit('/settings?section=data', '#activity .activity-row')
  const card = (await activityRows()).filter((row) => row.source !== 'run').map((row) => row.label)
  const firstPage = (await activity(50)).filter((entry) => entry.type === 'batch').map((entry) => entry.label)
  check('the Activity card lists the feed exactly as the API pages it', same(card, firstPage), {
    card: card.slice(0, 8),
    api: firstPage.slice(0, 8),
  })
  await snap('activity')
}

// ── put-backs: a stopped walk must not leave the private copy moved ──────────────────────────
async function restoreSettings() {
  for (const c of (await api('GET', '/spending/categories')).filter((row) => row.name === SCRATCH_CATEGORY)) {
    await api('DELETE', `/spending/categories/${c.id}`)
    problem(`${tag} settings: the scratch category ${c.id} was still there — deleted through the API`)
  }
  if (!same(await read.categories(), ORIG.categories)) {
    problem(`${tag} settings: the categories were not in their starting order — put back through the API`)
    await putOrder('categories', ORIG.categories)
  }
  if (!same(await read.accounts(), ORIG.accounts)) {
    problem(`${tag} settings: the accounts were not in their starting order — put back through the API`)
    await putOrder('accounts', ORIG.accounts)
  }
}
async function restorePortfolio() {
  for (const t of (await api('GET', '/portfolio/transactions')).filter((row) => row.account === SCRATCH_ACCOUNT)) {
    await api('DELETE', `/portfolio/transactions/${t.id}`)
    problem(`${tag} portfolio: scratch trade ${t.id} was still there — deleted through the API`)
  }
  if (!same(await read.transactions(), ORIG.ledger)) {
    problem(`${tag} portfolio: the ledger was not in its starting order — put back through the API`)
    await putOrder('transactions', ORIG.ledger)
  }
}
async function restoreOverview() {
  const layout = await read.layout()
  if (layout !== null && !sameLayout(layout, DEFAULT_LAYOUT)) {
    problem(`${tag} overview: the layout was not back at the defaults — put back through the API`)
    await api('PATCH', '/prefs', { overview_layout: DEFAULT_LAYOUT })
  }
}
async function restoreCards() {
  if (!same(await read.cards(), ORIG.cards)) {
    problem(`${tag} cards: the roster was not in its starting order — put back through the API`)
    await putOrder('cards', ORIG.cards)
  }
  if (!same(await read.weights(), ORIG.weights)) {
    problem(`${tag} cards: the reward categories were not in their starting order — put back through the API`)
    await putOrder('weights', ORIG.weights)
  }
}
async function surface(name, walk, restore) {
  where.surface = name
  where.step = 'start'
  try {
    await walk()
  } catch (error) {
    problem(`${tag} ${name}:${where.step}: the walk stopped — ${error instanceof Error ? error.message : String(error)}`)
    await page.screenshot({ path: file(`${name}-stopped`), fullPage: true }).catch(() => {})
  } finally {
    expecting = []
    await page.mouse.up().catch(() => {})
    await page.emulateMedia({ reducedMotion: 'no-preference' }).catch(() => {})
    await restore().catch((error) => problem(`${tag} ${name}: the put-back failed — ${error.message}`))
    drain()
  }
}

// ── the run ──────────────────────────────────────────────────────────────────────────────────
browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'],
})
try {
  for (const sz of SIZES) {
    size = sz
    tag = `${THEME}-${sz.width}`
    themedOnce = false
    current = null
    const context = await openContext()
    page = await context.newPage()
    wire()
    try {
      if (SURFACES.includes('settings')) await surface('settings', settingsWalk, restoreSettings)
      if (SURFACES.includes('portfolio')) await surface('portfolio', portfolioWalk, restorePortfolio)
      if (SURFACES.includes('overview')) await surface('overview', overviewWalk, restoreOverview)
      if (SURFACES.includes('cards')) await surface('cards', cardsWalk, restoreCards)
      if (sz === SIZES[SIZES.length - 1] && SURFACES.includes('activity')) {
        await surface('activity', activityWalk, restoreSettings)
      }
      await leave()
      drain()
    } finally {
      await context.close()
      page = null
    }
  }
} finally {
  await browser.close()
}

tag = THEME
where.surface = 'end'
where.step = 'as-found'
check('the categories end in the order they started in', same(await read.categories(), ORIG.categories), await read.categories())
check('the accounts end in the order they started in', same(await read.accounts(), ORIG.accounts), await read.accounts())
check('the ledger ends in the order it started in', same(await read.transactions(), ORIG.ledger), await read.transactions())
check('the card roster ends in the order it started in', same(await read.cards(), ORIG.cards), await read.cards())
check('the reward categories end in the order they started in', same(await read.weights(), ORIG.weights), await read.weights())
const layoutAtEnd = await read.layout()
check('the Overview layout ends at the defaults', layoutAtEnd === null || sameLayout(layoutAtEnd, DEFAULT_LAYOUT), layoutAtEnd)
const leftovers = {
  trades: (await api('GET', '/portfolio/transactions')).filter((t) => t.account === SCRATCH_ACCOUNT).length,
  categories: (await api('GET', '/spending/categories')).filter((c) => c.name === SCRATCH_CATEGORY).length,
}
check('no scratch trade and no scratch category remain', leftovers.trades === 0 && leftovers.categories === 0, leftovers)

writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
const passed = report.checks.filter((c) => c.ok === true).length
const failed = report.checks.filter((c) => c.ok === false).length
const noted = report.checks.filter((c) => c.ok === null).length
console.log(
  `checks: ${passed} ok, ${failed} failed, ${noted} noted; page writes ${report.writes.length} (blocked ${report.blockedWrites.length}); logged reorders ${report.logged.length}, undos ${report.undos.length}; ${report.files.length} files in ${OUT}`,
)
for (const judge of report.checks.filter((c) => c.ok === null && /^JUDGE/.test(c.name))) {
  console.log(`JUDGE ${judge.tag} ${judge.surface}:${judge.step} — ${JSON.stringify(judge.observed)}`)
}
if (report.problems.length > 0) {
  console.error(`REORDER SMOKE FAILED — ${report.problems.length} problem(s):`)
  for (const p of report.problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`REORDER SMOKE OK — ${THEME}: ${passed} checks`)
```

What each step proves, and how many checks it adds on a passing run (a mouse drag on a table
counts 7 checks, on the Customize boxes 6; a keyboard move 3; a reduced-motion step 6, or 7 in the
popover; a resting-look comparison 1, plus a JUDGE note; every page load 1 — CLS — and the first
load of a width 1 more, for the painted theme):

| Surface | Step | Proves | Checks |
|---|---|---|---|
| gate | — | the backend is at `f12026092301`; vite 5196 proxies to it; the copy is fresh (no reorder in Activity, no `V scratch` account, no `V two-tab` category) | 5 |
| Settings | open | the theme painted; CLS at load | 2 |
| | categories-rest | `.reorder-table` + separate borders; grip first, no Sort column; the §8.1 note; the server order; the resting look | 5 |
| | categories-drag | a mouse drag across three rows; the toast "Moved {name}"; the server order; it survives a reload; put back | 13 |
| | categories-undo | the same drag; the toast's Undo restores server and table | 9 |
| | categories-keyboard | Space ↓ ↓ Space, focus kept; the toast; the server; Undo | 6 |
| | categories-reduced-motion | the lifted row follows, no peer moves, one drop line; Escape cancels with no request | 6 |
| | categories-two-tab (1600) | a created category appends; the stale drop gets §8.3's sentence and a reload; nothing moved; cleaned up | 6 |
| | categories-resize-cancels (1600) | a resize mid-drag cancels, with no request | 2 |
| | accounts-rest | separate borders; the columns without Group and Sort; one colgroup heading per group in `GROUP_ORDER`, components right after their parent; the component indent; no grip disabled where a range has peers; the note; the resting look | 7 |
| | accounts-drag | a drag across three accounts of the flat group (Liabilities); the whole roster stored in the drawn order; reload; put back | 13 |
| | accounts-undo | the same drag, the change log's Undo | 9 |
| | accounts-keyboard | Space ↓ ↓ Space inside the group; Undo | 6 |
| | accounts-carry | a parent lifts with its components as one unit, the sibling alone makes room, it lands with its components nested; Undo | 5 |
| | accounts-component-range (1600) | a component picks up "in {parent}'s components", End stops at its last sibling, Escape puts it back with no request | 3 |
| | accounts-autoscroll | the 420 px box scrolls up under the held pointer, the last account lands first; the sticky header on top at rest and after (JUDGE while held); Undo | 6 |
| | accounts-reduced-motion | as for categories | 6 |
| Portfolio | open | CLS | 1 |
| | ledger-rest | separate borders; grip first; the replay-order hint; the server order; the resting look | 5 |
| | ledger-drag | 1600: a mouse drag across three trades; 1280: a long drag that auto-scrolls the page; the quiet toast; the server; reload; put back | 13 / 10 |
| | ledger-undo | the same drag; the re-sent order restores server and ledger | 9 |
| | ledger-keyboard | Space ↓ ↓ Space; the toast; Undo | 6 |
| | ledger-person-scope (1600) | the scope lists its rows; the PUT carries `owner` and the visible ids; hidden rows keep their slots; Undo | 13 |
| | ledger-figures (1600) | two API-made trades land last; the sell dragged above its buy; the toast says "realized gain $200.00 → $600.00"; cleaned up | 12 |
| | ledger-reduced-motion | as above | 6 |
| Overview | open | CLS; the default tile order | 2 |
| | customize-rest | both lists in stored order with grips; one row height, one box column | 3 |
| | customize-drag | a drag across two tiles; the tiles behind follow; the popover stays; no toast; the server's layout; reload; put back | 14 |
| | customize-keyboard | Space ↓ ↓ Space; the tiles follow; the live region; Reset to defaults, on screen and on the server | 7 |
| | customize-escape | Escape mid-drag keeps the popover and saves nothing; the next Escape closes it, focus back on Customize | 4 |
| | customize-reduced-motion | as above, plus the popover stays open | 7 |
| Credit Cards | open | CLS | 1 |
| | rest | both tables: separate borders, grip first, every cell's hairline, the resting look; both server orders | 10 |
| | colours (1600) | the chart painted with a colour per series, legend in list order; every person scope and joint draw each card in its household colour | 9 |
| | roster-drag | a drag across three cards; the toast; the server; reload | 12 |
| | roster-follows (1600) | the matrix columns follow; the legend follows; every colour holds; the narrowest person scope still matches | 8 |
| | roster-put-back | put back | 2 |
| | roster-undo | the same drag; Undo | 9 |
| | roster-keyboard | Space ↓ ↓ Space; Undo | 6 |
| | roster-reduced-motion | as above | 6 |
| | weights-drag | a drag across three reward categories inside the 440 px box; toast; server; reload; put back | 13 |
| | weights-undo | the same drag; Undo | 9 |
| | weights-autoscroll | the box scrolls up, the last category lands first; the sticky header (JUDGE while held); Undo | 6 |
| | weights-keyboard | Space ↓ ↓ Space; Undo | 6 |
| | weights-reduced-motion | as above | 6 |
| Activity (last width) | activity-undo | the newest entry is that reorder, labelled by its list; the card's Undo arms then restores; the feed shows the undo on top and the entry undone | 9 |
| | activity-overlap | a second move of the same row; the first Undo is refused with "Later changes touched these rows — undo those first" and changes nothing; the second Undo works; put back | 10 |
| | activity-feed | every logged reorder is in the feed, labelled by its list; exactly one entry each; every Undo is "Undid: {label}"; the card lists the feed as the API pages it | 5 |
| end | as-found | all five orders and the layout back where they started; no scratch row left | 7 |

Per pass on a passing run: **598 checks** — gate 5; at 1600, Settings 104 + Portfolio 65 +
Overview 37 + Credit Cards 103 = 309; at 1280, 93 + 37 + 37 + 86 = 253; Activity 24; end 7. Plus
14 `JUDGE` notes: the pinned-cell pixels of 5 tables × 2 widths, and the sticky header of 2 boxes ×
2 widths. `report.json`'s `checks` list is the authority. A check skipped because an earlier one
failed makes the count smaller, never larger.

- [ ] **Step 2: It parses**

Run: `cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && node --check tools/probes/reorder-v/smoke.mjs`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && git add tools/probes/reorder-v/smoke.mjs && git commit -m "test(probes): reorder-v — the drag-to-reorder walk on all six lists, one theme per rebuilt scratch copy (2026-09-23 spec §9, §10)"
```

---

### Task 4: The probes README — the reorder smoke's row and its recipe

**Files:**
- Modify: `tools/probes/README.md` (the table, right after the `guide-v/smoke.mjs` row; a new
  section at the end of the file)

- [ ] **Step 1: The table row**

In `tools/probes/README.md`, replace:

```
checklist and glossary shots. READ-ONLY BY CONSTRUCTION — a write fence, not a sweep | needs the dev stack — see below |
```

with (the same line, then one new row):

```
checklist and glossary shots. READ-ONLY BY CONSTRUCTION — a write fence, not a sweep | needs the dev stack — see below |
| `reorder-v/smoke.mjs` | Drag to reorder (2026-09-23) on all six lists — Settings › Spending categories and Accounts (grouped, components nested), Portfolio › Manage › Transactions, Overview › Customize, Credit Cards › Card roster and Categories & weights — one theme per run at 1600×1000 and 1280×800: a real mouse drag (the row follows the pointer, exactly the peers it passes make room, it lands in the gap, the order survives a reload), the toast and its Undo, Space ↓↓ Space with focus kept, reduced motion's drop line and an Escape that sends nothing, auto-scroll in the 420px Settings box, the 440px Categories & weights box and the page, the resting table pixel-compared with the collapsed border model, a parent carrying its components, the ledger in a person scope and a sell dragged above its buy, credit-line colours through a reorder and across person scopes, Escape inside the Customize popover, a real two-tab 409, and the Activity feed (one entry per logged reorder, a working Undo, the overlap refusal); CLS < 0.1 and a clean console. WRITES — only to its private `finance_reorder_scratch`, rebuilt from `finance_realdata` before each theme, through a write fence | needs a lane stack on 8096/5196 — see below |
```

- [ ] **Step 2: The recipe section**

Append at the end of `tools/probes/README.md` (after the pace smoke's last line, one blank line
first):

````markdown

## Running the reorder smoke (a lane stack with a database of its own)

The one smoke that needs its own database. It WRITES — reorders, Undos, two scratch trades and
one scratch category, every one put back — so it refuses any stack but a lane pair on **uvicorn
8096 / vite 5196** whose uvicorn serves **`finance_reorder_scratch`**: a `pg_dump | psql` copy of
the shared, read-only `finance_realdata` (never `CREATE DATABASE … TEMPLATE`, which fails while
other sessions hold the source), rebuilt before EACH theme. A gate refuses a copy an earlier pass
already wrote to, so one run is one theme.

```bash
PY=/c/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe
# 1. (re)build the private copy — uvicorn on 8096 must be stopped first
docker exec finance-dashboard-db-1 dropdb -U finance --if-exists finance_reorder_scratch
docker exec finance-dashboard-db-1 createdb -U finance finance_reorder_scratch
docker exec finance-dashboard-db-1 sh -c 'pg_dump -U finance --no-owner --no-privileges finance_realdata | psql -q -v ON_ERROR_STOP=1 -U finance -d finance_reorder_scratch'
(cd backend && DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_reorder_scratch $PY -m alembic upgrade head)
# 2. the lane pair, each in its own terminal (or run_in_background)
(cd backend && DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_reorder_scratch SCHEDULER_ENABLED=0 $PY -m uvicorn app.main:app --host 127.0.0.1 --port 8096)
VITE_API_PROXY=http://127.0.0.1:8096 npx vite --port 5196 --strictPort
# 3. one theme per fresh copy (about 30 minutes each)
ONLY_THEME=dark node tools/probes/reorder-v/smoke.mjs
#    stop uvicorn, repeat step 1, start uvicorn again, then
ONLY_THEME=light node tools/probes/reorder-v/smoke.mjs
```

Prints `REORDER SMOKE OK — <theme>: N checks`, exits 1 listing every problem, or exits 2 when it
refuses to start (wrong ports, the migration missing, a copy that is not fresh). Env:
`ONLY_THEME` (required), `ONLY_WIDTH` (1600|1280), `ONLY_SURFACE` (a comma list of settings,
portfolio, overview, cards, activity), `APP_BASE`, `API_BASE`, `SMOKE_OUT` (default
`scratchpad/reorder-v/<theme>`), `EXPECT_HEAD`, `EDGE_PATH`, `PLAYWRIGHT_CORE`. It mints its own
token with the dev seed credentials, which `finance_realdata` carries (on a 401, reset the private
copy's password — the plan's Task 1 Step 6).

Lines starting `JUDGE` are observations a person rules on, not failures: the row in hand drawn over
a capped box's sticky header during an upward auto-scroll, and any pixel that differs INSIDE a
pinned (sticky) cell when the resting table is compared with the collapsed border model it
replaced. The rule for both is in `docs/superpowers/plans/2026-09-23-reorder-v-verify.md`, Task 7.
Not probed, on purpose: the importer's identity rule (backend tests own it) and the forced 500/409
failure paths (the lanes' own checks and unit tests own them).
````

- [ ] **Step 3: Commit**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && git add tools/probes/README.md && git commit -m "docs(probes): the reorder smoke's row and its recipe — a lane stack on 8096/5196, one theme per rebuilt copy"
```

---

### Task 5: The Guide probe's counts (lane R5's `cards-reorder` task)

**Files:**
- Modify: `tools/probes/guide-v/smoke.mjs` (the header comment, the imports, after
  `const MIN_LINKS = 74`, after the destinations check)
- Modify: `tools/probes/README.md` (one clause in the `guide-v/smoke.mjs` row)

**What moves, read from the probe** (`feat/reorder-base` @8fb67038 before, R0–R5 merged after;
content counted from `src/guide/content/*.tsx`):

| Count in `guide-v/smoke.mjs` | How it is pinned | Before | After R5 | Moves? |
|---|---|---|---|---|
| sidebar links, Guide before Settings | `navLabels.length === 14`, `[12] === 'Guide'`, `[13] === 'Settings'` | 14 | 14 | no — no sidebar link in this batch |
| chapter tabs | exactly `['Start here', 'Routines', 'Pages', 'Reference']` | 4 | 4 | no |
| distinct destinations | a floor: `links.size >= MIN_LINKS` (74) | 81 walked (2026-09-15 run) | 81 | no — `cards-reorder`'s `to` is `/credit-cards?section=manage`, already the `to` of `cards-add` and six other Credit cards tasks |
| numbered setup rail | `nums.length === 18`, `1…18` | 18 | 18 | no — the new task is in Pages › Credit cards |
| the second chip's rail | a floor: `railShape.rows >= 3` (Net worth) | ≥ 3 | ≥ 3 | no |
| rail rows clicked (`destinations.<theme>.rows`) | **recorded only** | 195 | **196** | +1 |
| cards driven (`…cards`) | recorded only | 28 | 28 | no |
| selector chips (`…chips`) | recorded only | 21 | 21 | no |

So **no pinned number has to change**. The R5 plan's "the Guide probes' counts move by one" is about
the recorded rail-row count. This task turns the two recorded counts into checks that derive their
expectation from the content itself:
- the walk must click one rail row per task;
- it must drive every card.

That proves R5's task is actually walked, and the next task anyone adds moves both sides of the
check by itself. The probe's output goes from `… 20 checks …` to `… 24 checks …` (12 per theme).
The link visits stay at 162 (81 × 2) unless the guide's links changed after 2026-09-15.

- [ ] **Step 1: The header comment**

In `tools/probes/guide-v/smoke.mjs`, replace:

```js
// 1920×1080 plus the master–detail, checklist and glossary shots.
// Env: SMOKE_OUT, TOKEN_FILE, APP_BASE, EDGE_PATH, PLAYWRIGHT_CORE, ONLY_THEME, MAX_LINKS.
```

with:

```js
// 1920×1080 plus the master–detail, checklist and glossary shots. Since 2026-09-23 (the drag-to-
// reorder batch's lane V) the walk must also click one rail row per task and drive every card, both
// counted from src/guide/content/*.tsx rather than typed here, so a new task moves both sides.
// Env: SMOKE_OUT, TOKEN_FILE, APP_BASE, EDGE_PATH, PLAYWRIGHT_CORE, ONLY_THEME, MAX_LINKS.
```

- [ ] **Step 2: The imports**

Replace:

```js
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
```

with:

```js
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
```

- [ ] **Step 3: The content counts**

Replace:

```js
const MIN_LINKS = 74
```

with:

```js
const MIN_LINKS = 74
// What the guide holds, counted from its source rather than typed here (2026-09-23, drag-to-reorder
// lane V): every task carries exactly one `where:` and every card exactly one `purpose:`
// (src/guide/types.ts), so the walk must click one rail row per `where:` and drive one card per
// `purpose:`. 195 tasks in 28 cards on 2026-09-15; 196 once lane R5's `cards-reorder` landed. A
// harvest that silently stops walking can no longer pass as a smaller number.
const CONTENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/guide/content')
const contentCount = (pattern) =>
  readdirSync(CONTENT_DIR)
    .filter((name) => name.endsWith('.tsx'))
    .reduce((sum, name) => sum + (readFileSync(path.join(CONTENT_DIR, name), 'utf8').match(pattern) ?? []).length, 0)
const CONTENT_TASKS = contentCount(/^\s*where:/gm)
const CONTENT_CARDS = contentCount(/^\s*purpose:/gm)
```

- [ ] **Step 4: The two checks**

Replace:

```js
    check(theme, `the guide renders at least ${MIN_LINKS} distinct destinations`, links.size >= MIN_LINKS, { destinations: links.size, ...seen })
```

with:

```js
    check(theme, `the guide renders at least ${MIN_LINKS} distinct destinations`, links.size >= MIN_LINKS, { destinations: links.size, ...seen })
    check(theme, 'the walk clicks one rail row per task in the guide content', seen.rows === CONTENT_TASKS, { rows: seen.rows, tasks: CONTENT_TASKS })
    check(theme, 'the walk drives every card in the guide content', seen.cards === CONTENT_CARDS, { cards: seen.cards, contentCards: CONTENT_CARDS })
```

- [ ] **Step 5: It parses, and the source counts are the expected ones**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && node --check tools/probes/guide-v/smoke.mjs && node -e "const fs=require('fs'),p=require('path'),d='src/guide/content',n=(re)=>fs.readdirSync(d).filter(f=>f.endsWith('.tsx')).reduce((s,f)=>s+(fs.readFileSync(p.join(d,f),'utf8').match(re)??[]).length,0);console.log('tasks',n(/^\s*where:/gm),'cards',n(/^\s*purpose:/gm))"
```

Expected: `tasks 196 cards 28` (planning read `tasks 195 cards 28` on the base before R5; a larger
number means a later lane added a task too — record it, the check follows it).

- [ ] **Step 6: The README clause**

In `tools/probes/README.md`, replace:

```
plus the master–detail, checklist and glossary shots. READ-ONLY BY CONSTRUCTION — a write fence, not a sweep | needs the dev stack — see below |
```

with:

```
plus the master–detail, checklist and glossary shots; and (since 2026-09-23) one rail row clicked per task and every card driven, both counted from `src/guide/content/*.tsx` rather than typed in the probe. READ-ONLY BY CONSTRUCTION — a write fence, not a sweep | needs the dev stack — see below |
```

- [ ] **Step 7: Commit**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && git add tools/probes/guide-v/smoke.mjs tools/probes/README.md && git commit -m "test(probes): guide-v clicks one rail row per task and drives every card, counted from the guide content (lane R5's cards-reorder: 196 rows)"
```

---

### Task 6: Run the reorder smoke — dark, then light

**Files:** none (output in `scratchpad/reorder-v/{dark,light}/`, gitignored).

- [ ] **Step 1: A fresh copy for the dark pass**

Run Task 1 Steps 1–6 (stop uvicorn, rebuild, migrate, census, start uvicorn, login). Vite from
Task 2 keeps running: it holds no database connection.

- [ ] **Step 2: The dark pass (run_in_background: true; about 30 minutes)**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && ONLY_THEME=dark node tools/probes/reorder-v/smoke.mjs
```

Expected on completion, exit 0:

```
checks: 598 ok, 0 failed, … noted; page writes … (blocked 0); logged reorders 24, undos 14; … files in C:\Users\edyli\personal-finance-dashboard\.worktrees\reorder-v\scratchpad\reorder-v\dark
JUDGE dark-1600 settings:categories-rest — {…}
… (14 JUDGE lines in all)
REORDER SMOKE OK — dark: 598 checks
```

- The 24 logged reorders are 10 per width plus 4 in the Activity step:
  - per width, categories 4 (drag, put-back, undo's drag, keyboard);
  - per width, accounts 6 (drag, put-back, undo's drag, keyboard, carry, auto-scroll);
  - Activity: 1 for the card's Undo, 3 for the overlap step.
- The 14 Undos are 6 per width plus 2 in the Activity step.
- `blocked 0` is part of the expectation: any blocked write is itself a problem line.

- [ ] **Step 3: A fresh copy for the light pass**

Run Task 1 Steps 1–6 again. The gate refuses the dark pass's copy by design: exit 2 with
`REORDER SMOKE REFUSED`.

- [ ] **Step 4: The light pass (run_in_background: true)**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && ONLY_THEME=light node tools/probes/reorder-v/smoke.mjs
```

Expected: the same shape, `REORDER SMOKE OK — light: 598 checks`, exit 0.

- [ ] **Step 5: If a pass fails — triage**

Read `scratchpad/reorder-v/<theme>/report.json` → `problems`, each with its `tag surface:step`,
and the step's PNGs. Use superpowers:systematic-debugging. Then, by cause:
- **The probe's own driving** — a selector, a wait, a wrong expectation. Fix
  `tools/probes/reorder-v/smoke.mjs`, citing in the commit the spec line or lane contract the
  corrected expectation stands on (`fix(probes): reorder-v — …`). Then run Task 1 again and re-run
  that theme, narrowed with `ONLY_WIDTH`/`ONLY_SURFACE` while iterating, and in full at the end.
- **A lane defect** — the app contradicts spec §2–§9 or a lane's published contract. Do not patch
  it. Record the problem line, the PNG and the owning lane in Results under "Findings for the
  controller", finish the other theme, and report. The run stays red until the controller routes a
  fix and V re-runs.
- **The environment** — a server from an older tip, a proxy on 8000, a stale copy. Fix it, run
  Task 1, re-run.
- **A console error unrelated to reordering** — it names another card or feed. Record its text and
  URL, and hand it to the controller with the step it appeared in. If the controller rules it a
  known non-defect of this book, add a `knownBenign`-style rule in the probe that records it
  instead of failing (the sandbox smoke's `BENIGN` pattern), with the ruling in the commit message.

---

### Task 7: The screenshots, and the two judgements

**Files:** none (the verdicts go into Results).

- [ ] **Step 1: Look at the drags (both themes)**

In `scratchpad/reorder-v/{dark,light}/`, confirm:
- `1600-categories-mid-drag.png`, `1600-accounts-mid-drag.png`, `1600-ledger-mid-drag.png`,
  `1600-roster-mid-drag.png`, `1600-weights-mid-drag.png`, `1600-customize-mid-drag.png`
  (and the 1280 twins where taken): the lifted row is raised on `--surface-2` with its hairlines,
  its pinned Actions cell on the same surface, and the rows it passed have made room.
- `*-reduced-motion-held.png`: nothing moved but the row in hand; one accent line marks the
  landing edge.
- `1600-accounts-carry-mid-drag.png`: the parent and its three components move as one block.
- `1280-ledger-auto-scroll.png`: the lifted trade near the window's foot after the page scrolled.
- `1600-credit-lines-after-reorder.png`: the legend in the new order, each line in the colour the
  `colours` step recorded.

Note anything off in Results.

- [ ] **Step 2: Judgement 1 — the row in hand over a capped box's sticky header (lane R5, note 2)**

Look at `{1600,1280}-accounts-autoscroll-held.png` and `{1600,1280}-weights-autoscroll-held.png`
in both themes (8 images), next to their `JUDGE … autoscroll` lines. Each line records:
- `headerOnTop` / `liftedOver`, the result of a hit test at the header's first label while the
  pointer is held in the top zone;
- both boxes and their overlap in px;
- both z-indexes (header 1, lifted row 2).

**The rule — ACCEPT when all of these hold:**
- the header is on top at rest and again once the drag ends (both are hard checks in the probe, so
  a red there is a failure, not a judgement);
- in the held shots the lifted row is fully legible, drawn raised (`--surface-2`, its own
  hairlines), and sits under the pointer;
- it covers the header only while the pointer is in the top 40 px zone of a live drag — it reads
  as "in hand", the way a lifted card rides above everything.

**REJECT when any of these holds:**
- the header's labels show through or over the lifted row;
- the row looks cut or clipped by the header;
- anything of the lift remains over the header after the drop.

On REJECT this is a controller follow-up in lane R0's file, not a V edit.
- Do NOT use `z-index: 1` on the lifted row (Notes for the controller, 1).
- The fix keeps the header above the row in hand. Add it to `src/components/reorder/reorder.css`:

```css
/* A capped box's sticky header stays above the row in hand (reorder-v judgement, 2026-09-23).
   z-index has no effect on a header that is not positioned, so only sticky headers change. */
table.reorder-table > thead th {
  z-index: 3;
}
```

- Pin it in `src/components/reorder/reorderCss.test.ts`:

```ts
  it('keeps a capped box’s sticky header above the row in hand', () => {
    expect(declarationsFor(css, 'table.reorder-table > thead th')).toContain('z-index: 3;')
  })
```

Then re-run the two `*-autoscroll` steps (`ONLY_SURFACE=settings` and `…=cards` on a fresh copy).
The held `JUDGE` line must now read `headerOnTop: true`.

- [ ] **Step 3: Judgement 2 — pixels inside the pinned cells**

Read the ten `JUDGE … INSIDE the pinned (sticky) cells` lines per theme and open each named
`*-diff.png` (magenta = a pixel that differs), beside its `*-separate.png` and `*-collapse.png`.
The hard check next to each line already holds everything outside the pinned cells to the budget.

**The rule — ACCEPT when** the magenta inside a pinned cell is only horizontal row lines:
- lines that now continue through the pinned Actions column, and/or
- the sticky header's bottom line inside a capped box.

That is the separate model drawing, in each cell, the line the collapsed model painted under the
pinned cell's opaque background. It reads as a continuous table and is spec §2.5's own model
("each cell then owns its border-bottom"). Record it for the morning list as an intended change of
look.

**REJECT when** a pinned cell shows anything else:
- a moved button;
- a lost left hairline — the `-1px 0 0 var(--border)` box-shadow must stay (spec §2.5);
- a shifted label.

On REJECT: a controller follow-up to lane R0, with the diff PNG. If the controller instead wants
the old look back exactly, the candidate is one rule in `reorder.css`:
`table.reorder-table td.row-actions { border-bottom-color: transparent; }`. It must be proven by
re-running `restingLook` until `inside` reads 0.

---

### Task 8: The Guide probe on the lane stack; the Phase A results

**Files:**
- Modify: this plan, "Results" → "Phase A"

- [ ] **Step 1: The Guide walk (read-only; run_in_background: true)**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && mkdir -p scratchpad/reorder-v/guide && curl -s http://127.0.0.1:8096/api/v1/auth/login -H 'content-type: application/json' -d '{"email":"admin@example.com","password":"changeme123"}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token))" > scratchpad/reorder-v/guide/token.txt && TOKEN_FILE=scratchpad/reorder-v/guide/token.txt SMOKE_OUT=scratchpad/reorder-v/guide APP_BASE=http://localhost:5196 node tools/probes/guide-v/smoke.mjs
```

Expected: `GUIDE SMOKE OK — 162 link visits, 24 checks, … writes blocked; report: …`, exit 0.
`report.json` → `destinations.dark.rows` and `destinations.light.rows` are 196 (the content count),
`…cards` 28. The copy the light pass left is fine for this walk: it writes nothing (its fence
answers every non-GET from memory).

- [ ] **Step 2: Fill in "Results → Phase A"**

Record:
- the preflight;
- both passes' summary lines, exit codes and durations;
- any probe fix, with its reason;
- the findings for the controller;
- both judgements, with the reason;
- the Guide walk's line and counts.

- [ ] **Step 3: Commit, and hand over for review and the merge**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && git add docs/superpowers/plans/2026-09-23-reorder-v-verify.md && git commit -m "docs(plan): lane V — Phase A results: the reorder smoke in both themes, the two judgements, the Guide walk"
```

Report to the controller:
- the branch tip;
- both passes' lines;
- the judgements;
- every finding.

Leave uvicorn and vite running only if Phase B follows at once; otherwise stop both by port (Task
14 Step 3).

---

## Phase B — the landing gates, on the integration tip

Start only when the controller confirms three things:
- the quick-fixes batch has completely landed on local main (P, B1, B2, CS, CT merged, its
  verification done, its worktrees gone);
- `feat/reorder-verify` has been merged into `feat/reorder-base`;
- main has been merged into `feat/reorder-base` after that (spec §11 "Landing", step 1).

### Task 9: Landing preflight (no commit)

**Files:** none.

- [ ] **Step 1: Fast-forward to the integration tip**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && git merge --ff-only feat/reorder-base && git log --oneline -1 && (git merge-base --is-ancestor main HEAD && echo "main is inside the tip") && git worktree list
```

Expected:
- a fast-forward;
- the tip's hash (record it);
- `main is inside the tip`;
- a worktree list with none of `perf-first-four`, `backend-quick-fixes`, `frontend-quick-fixes`,
  `charts-spending-overview` or `charts-tax-portfolio`.

If `--ff-only` refuses, `feat/reorder-verify` holds a commit the base lacks (Phase A's results came
after the merge): stop and ask the controller to merge it first. If a quick-fixes worktree is still
listed, stop: spec §11 lands only after that batch has completely landed.

- [ ] **Step 2: One migration head**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v/backend && C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m alembic heads
```

Expected: `f12026092301 (head)`, alone (spec §3.5: the quick-fixes batch adds no migration). Two
heads: stop and report — a merge revision is the controller's call, never V's.

- [ ] **Step 3: Restart both servers from the tip**

uvicorn runs without `--reload` and vite stamps its build hash at start, so both must restart.
- Stop both by port: Task 14 Step 3's command.
- Run Task 1 Steps 1–6: the rebuild migrates with the tip's code.
- Run Task 2.

---

### Task 10: Backend gates

**Files:** none.

- [ ] **Step 1: ruff**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v/backend && C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m ruff check app tests alembic/versions/20260923_0900_f12026092301_position_transactions_import_key.py && C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m ruff format --check app tests alembic/versions/20260923_0900_f12026092301_position_transactions_import_key.py
```

Expected: `All checks passed!`, then `… files already formatted`, exit 0.

- [ ] **Step 2: The full suite (run_in_background: true; about 50 minutes)**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v/backend && FINANCE_TEST_DB=finance_test_reorder_v C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m pytest -q
```

Expected: `N passed, 1 skipped in …`, exit 0. For scale, lane R1 saw `2118 passed, 1 skipped` on
its branch; the tip also carries the quick-fixes batch's tests. Record N.
- A failure outside the reorder files: re-run that test alone (`… -m pytest tests/<file>.py::<test> -q`).
  If it passes alone it is a load flake: record both runs. If not, stop and report it.
- Do not start the frontend gates or a probe while this runs: the load makes both flake.

---

### Task 11: The migration drill — upgrade, downgrade, upgrade on a prod-shaped copy

**Files:** none. `finance_test_reorder_v_mig` is this lane's drill database, rebuilt here on every
run.

- [ ] **Step 1: A copy of the real book, at prod's head**

```bash
docker exec finance-dashboard-db-1 dropdb -U finance --if-exists finance_test_reorder_v_mig
docker exec finance-dashboard-db-1 createdb -U finance finance_test_reorder_v_mig
docker exec finance-dashboard-db-1 sh -c 'pg_dump -U finance --no-owner --no-privileges finance_realdata | psql -q -v ON_ERROR_STOP=1 -U finance -d finance_test_reorder_v_mig'
docker exec finance-dashboard-db-1 psql -U finance -d finance_test_reorder_v_mig -tAc "SELECT version_num FROM alembic_version"
```

Expected: no output from the first three; then `f12026091203`.

- [ ] **Step 2: Upgrade — what prod's boot will do**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v/backend && DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_test_reorder_v_mig C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m alembic upgrade head
docker exec finance-dashboard-db-1 psql -U finance -d finance_test_reorder_v_mig -tAc "SELECT count(*) FILTER (WHERE source = 'import' AND import_key = sort_index), count(*) FILTER (WHERE source = 'import'), count(*) FILTER (WHERE source = 'ui' AND import_key IS NULL), count(*) FILTER (WHERE source = 'ui') FROM position_transactions"
docker exec finance-dashboard-db-1 psql -U finance -d finance_test_reorder_v_mig -tAc "SELECT indexdef FROM pg_indexes WHERE indexname = 'ux_position_txn_import_key'"
```

Expected:
- `Running upgrade f12026091203 -> f12026092301, position_transactions.import_key — the importer's identity for sheet rows`;
- `26|26|13|13`;
- `CREATE UNIQUE INDEX ux_position_txn_import_key ON public.position_transactions USING btree (import_key) WHERE ((source)::text = 'import'::text)`.

- [ ] **Step 3: The index refuses a second row with an import row's key**

```bash
docker exec finance-dashboard-db-1 psql -U finance -d finance_test_reorder_v_mig -v ON_ERROR_STOP=1 -c "INSERT INTO position_transactions (security_id, portfolio_account_id, type, shares, price, sort_index, source, import_key) SELECT security_id, portfolio_account_id, type, shares, price, 99999, 'import', import_key FROM position_transactions WHERE source = 'import' ORDER BY id LIMIT 1"
```

Expected: `ERROR:  duplicate key value violates unique constraint "ux_position_txn_import_key"`, and
a non-zero exit. That is the pass condition. Nothing was inserted.

- [ ] **Step 4: Downgrade, then upgrade again, then `alembic check`**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v/backend && DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_test_reorder_v_mig C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m alembic downgrade -1
docker exec finance-dashboard-db-1 psql -U finance -d finance_test_reorder_v_mig -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name = 'position_transactions' AND column_name = 'import_key'"
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v/backend && DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_test_reorder_v_mig C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m alembic upgrade head
docker exec finance-dashboard-db-1 psql -U finance -d finance_test_reorder_v_mig -tAc "SELECT count(*) FILTER (WHERE source = 'import' AND import_key = sort_index), count(*) FILTER (WHERE source = 'import'), count(*) FILTER (WHERE source = 'ui' AND import_key IS NULL), count(*) FILTER (WHERE source = 'ui') FROM position_transactions"
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v/backend && DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_test_reorder_v_mig C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m alembic check
```

Expected, in order:
- `Running downgrade f12026092301 -> f12026091203, …`;
- `0` (the column is gone);
- `Running upgrade f12026091203 -> f12026092301, …`;
- `26|26|13|13` again;
- `No new upgrade operations detected.` (INFO lines about sequences before it are normal).

Leave `finance_test_reorder_v_mig` in place for the morning list.

---

### Task 12: Frontend gates

**Files:** none.

- [ ] **Step 1: The full vitest suite (run_in_background: true)**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && npx vitest run
```

Expected: exit 0. Record the file and test counts. On a failure, re-run it alone:
- a known flake:
  - `npx vitest run src/pages/PaycheckPage.test.tsx -t "names the employer match under the waterfall"`;
  - `npx vitest run src/pages/OverviewPage.test.tsx -t "mounts the three snapshot charts"`;
- anything else, re-run its file alone. Passing alone = a load flake (record both runs). Failing
  alone = stop and report it with the owning lane.

- [ ] **Step 2: Types — the build graph, and once more without the shared cache**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && npx tsc -b && npx tsc -p tsconfig.app.json --noEmit --incremental false && npx tsc -p tsconfig.node.json --noEmit --incremental false
```

Expected: exit 0 from each. The no-cache pair matters because `tsc -b`'s buildinfo lives in the
shared `node_modules` junction (lane R4's finding), so a stale cache could pass a broken tree.

- [ ] **Step 3: Lint and build**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && npx eslint . && npm run build
```

Expected:
- both exit 0;
- `eslint .` reports 0 errors, and only the base's `react-refresh/only-export-components` warnings
  (26 before this batch; R5's `SEED_CATEGORIES` is one of them) — record the count;
- the build prints no new chunk-size warning.

---

### Task 13: The probes on the landing tip

**Files:** none (output in `scratchpad/reorder-v/`).

- [ ] **Step 1: The reorder smoke, dark (fresh copy, run_in_background: true)**

Run Task 1 Steps 1–6, then:

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && SMOKE_OUT=scratchpad/reorder-v/landing-dark ONLY_THEME=dark node tools/probes/reorder-v/smoke.mjs
```

Expected: `REORDER SMOKE OK — dark: 598 checks`, exit 0.

- [ ] **Step 2: The reorder smoke, light**

Run Task 1 Steps 1–6 again, then:

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && SMOKE_OUT=scratchpad/reorder-v/landing-light ONLY_THEME=light node tools/probes/reorder-v/smoke.mjs
```

Expected: `REORDER SMOKE OK — light: 598 checks`, exit 0. Triage as in Task 6 Step 5. The
landing needs both green.

- [ ] **Step 3: The Guide walk (required)**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && mkdir -p scratchpad/reorder-v/landing-guide && curl -s http://127.0.0.1:8096/api/v1/auth/login -H 'content-type: application/json' -d '{"email":"admin@example.com","password":"changeme123"}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token))" > scratchpad/reorder-v/landing-guide/token.txt && TOKEN_FILE=scratchpad/reorder-v/landing-guide/token.txt SMOKE_OUT=scratchpad/reorder-v/landing-guide APP_BASE=http://localhost:5196 node tools/probes/guide-v/smoke.mjs
```

Expected: `GUIDE SMOKE OK — … link visits, 24 checks, …`, exit 0, rows 196 per
theme (or the content count, if a quick-fixes lane added Guide tasks).

- [ ] **Step 4: The cheap extras on the changed pages (read-only; informational)**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && TOKEN_FILE=scratchpad/reorder-v/landing-guide/token.txt SMOKE_OUT=scratchpad/reorder-v/landing-pace APP_BASE=http://localhost:5196 API_BASE=http://127.0.0.1:8096 node tools/probes/pace-v/smoke.mjs
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && TOKEN_FILE=scratchpad/reorder-v/landing-guide/token.txt SMOKE_OUT=scratchpad/reorder-v/landing-charts APP_BASE=http://localhost:5196 ONLY_ROUTE=credit-cards SKIP_DETAILS=1 node tools/probes/charts-c7/smoke.mjs
```

Expected: `PACE SMOKE OK` (Settings' sections and rows after R2's card changes) and
`CHARTS SMOKE OK` (the credit-line chart after R5's colours). The pace smoke fences every write;
the charts smoke stubs `PATCH /prefs` and makes no write of its own. Both run against the scratch
copy, never a shared database.
- A failure that names a reorder surface is a finding, triaged as in Task 6 Step 5.
- Any other failure is recorded for the morning list and does not block the landing: these two
  were written against the dev book, and this copy is prod-shaped.

---

### Task 14: Results, the morning list, and stopping the servers

**Files:**
- Modify: this plan, "Results → Phase B" and "Morning list"

- [ ] **Step 1: Fill in "Results → Phase B"**

Record every command's outcome from Tasks 9–13.

- [ ] **Step 2: Fill in the morning list**

Fill in the brackets in "Morning list", below.

- [ ] **Step 3: Stop the lane's servers — only 8096 and 5196**

```bash
for pid in $(netstat -ano | grep -E '(127\.0\.0\.1:8096|\[::1\]:5196|127\.0\.0\.1:5196|0\.0\.0\.0:5196) +.*LISTENING' | awk '{print $NF}' | sort -u); do taskkill //F //T //PID "$pid"; done; netstat -ano | grep -E ':(8096|5196) +.*LISTENING' || echo "8096 and 5196 are free"
```

Expected: `8096 and 5196 are free`. Vite's node child can outlive its shell. `//T` takes the tree.
Never touch any other port.

- [ ] **Step 4: Commit and report**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-v && git add docs/superpowers/plans/2026-09-23-reorder-v-verify.md && git commit -m "docs(plan): lane V — the landing gates on the integration tip, and the morning list"
```

Report to the controller:
- the tip;
- every gate's line;
- the verdicts;
- the morning list's location.

The controller merges this commit into `feat/reorder-base` and fast-forwards local main (spec §11
step 3). No push, no deploy.

---

## Results (filled in by the implementer)

### Phase A — on the R0–R6 merge (`feat/reorder-verify`, cut @58f048c4, base merged again @1af542a3)

The lane was cut after R6 (not only R0–R5) and after main's completed quick-fixes batch
(5a701d9d, main @923a633e) — so Phase A already ran on the landing content, less R6's cleanup
round, which was merged in (base @adabce05 → 1af542a3) before Task 6's passes.

- **Preflight (Task 0)** — all as expected:
  - merges on the branch: R0 0d805010 (+ 11a4cda0, round 4 d5efe2d9 → e453a8c1), R4 cca4d9cf,
    R1 dd62aa6c, main with B2 d7a16e6a, R3 c877cd7d, R2 e4064947 (+ 9b458bd6), main with B1/CS/CT
    54f535be, R5 665a8d7c, main complete 5a701d9d, R6 58f048c4;
  - greps: the five `reorder-table` paths; `useReorder` ×4; `cards-reorder` (line 717); `rankIds`
    (lines 91, 98); `no draggable left`; the `f12026092301` migration;
  - the interpreter imports this worktree's backend; `alembic heads` = `f12026092301 (head)` alone;
  - vite, playwright-core and Edge present, node `v18.12.0`; 8096 and 5196 free;
  - `finance_realdata` census `29|19|39|7|19|f12026091203` and `0` stored layouts (= planning);
    every rebuilt copy read `29|19|39|7|19|f12026092301` and backfill `26|13`.
- **Probe commits (Tasks 3–5)**: 5af157eb (the probe), d48594ec (README row + recipe), 1987caf0
  (guide-v derived counts + README clause); `node --check` clean for both; source counts
  `tasks 196 cards 28`.
- **Reorder smoke, dark (Task 6)**, final run on a fresh copy (tip dd7c65ab):
  `checks: 602 ok, 0 failed, 69 noted; page writes 72 (blocked 0); logged reorders 24, undos 14`
  — `REORDER SMOKE OK — dark: 602 checks`, exit 0, 7m18s. 602 = the plan's 598 + the four
  range-end stop checks (2 boxes × 2 widths). 50 page loads, page CLS ≤ 0.002 (total ≤ 0.097);
  0 warnings; the only benign entries are the two expected 409s (two-tab, overlap); the fence
  passed exactly 6 `PATCH /prefs` (overview_layout alone, nothing stubbed).
  - The first full dark run (kept as `scratchpad/reorder-v/dark-run1/`) was red — 553 ok,
    10 failed — on three probe-driving faults, fixed in dd7c65ab (below); a narrowed re-check
    (portfolio + activity, `trial-2`) went 140/0 before the full re-run.
  - This green run used the probe as of dd7c65ab — before the drill-in check (7f966c97) and the
    corrected resting-look rule (59620fc1). Both themes run the final probe in Phase B (Task 13).
- **Reorder smoke, light** (Task 6 Steps 3–4), fresh copy, final probe @59620fc1:
  `checks: 604 ok, 0 failed, 70 noted; page writes 72 (blocked 0); logged reorders 24, undos 14`
  — `REORDER SMOKE OK — light: 604 checks`, exit 0, 7m24s (= 602 + the drill-in check and its
  page's CLS). 51 page loads, page CLS ≤ 0.002; 0 warnings; benign = the two expected 409s; the
  fence passed 6 `PATCH /prefs`, overview_layout only. Resting look, all 10 green: 0 judged px
  outside the pinned cells (weights 1600: 165 of 435); every checked boundary one hairline in both
  models (7–18 per table; 1px apart on 7/8 categories, 5/9 accounts, 4/9 weights-1600 rows); no
  cell with a top border; judged `inside` = the gained pinned edge only (28–44px header segment;
  the ledger 728/577px, its whole edge).
  - The first light run (`scratchpad/reorder-v/light-run1/`, probe @7f966c97) was 599 ok /
    5 failed — the resting-look rule of fix 2, corrected in fix 5.
  - Task 6 Step 3's refusal, shown on the light copy afterwards: `REORDER SMOKE REFUSED` (exit 2)
    naming the reorders already in Activity and the `V scratch` ledger account.
- **Fixes to the probe during the runs** (each commit cites what it answers to):
  1. *5af157eb, written against the final lane code rather than the plan's text:*
     - `aim()` lands the lifted row's LEADING edge on the k-th peer's far edge — R0 round 4's
       leading-edge slot rule (spec §2.3.4 as amended); the plan's centre-rule aim sat 0.1 row
       from the next slot;
     - accounts-carry travels the sibling unit's height — under the leading-edge rule the plan's
       centre-rule travel is clamped and also passes the HSA (R2's round-2 finding);
     - accounts-rest expects one `<tbody>` per group with `scope="rowgroup"` headings (spec §4.2's
       correction, R2's final DOM), not `colgroup`;
     - accounts-autoscroll drags in the longest flat group with rows below it (Taxable), not
       Liabilities: R0's range-end stop (§2.3.5 as amended) means the roster's last group can
       never scroll (its first row already shows ~119px down at full depth — R2's round-2 case a);
     - `autoScrollInBox` starts with the range's first row hidden, captures the row in hand over
       the sticky header MID-scroll (pointer 28px in; at the stop it sits clamped below the header
       — R5's observation) and adds a range-end stop check.
  2. *26f38264 — the resting look*: the first real trial failed 3 of 5 tables (6,895–11,593 px vs
     budgets of 212–435) while every differing pixel vanished under a 1px vertical shift and no
     hairline pixel differed. Measured in the live DOM: under `border-collapse: collapse` each
     cell's text sits exactly 0.5 CSS px lower (0.25 on the first row) and every row bottom is
     identical — CSS 2.1 §17.6.2 puts half of each shared border inside the cell, so the collapsed
     model offsets CONTENT, not lines, and no separate-border table can match it pixel for pixel.
     The check now judges each row's hairline band (bottom edge ±1px) exactly and elsewhere counts
     a pixel only when no pixel one row above or below matches it (spec §10: "within a pixel-diff
     tolerance"); the plan's as-drawn statistic stays in the record; the diff marks judged pixels
     magenta and offset-explained ones yellow. A doubled, missing or moved hairline, a changed
     background or a horizontal shift still fails.
  3. *dd7c65ab — three driving fixes from the first full run:*
     - every drag instrument (and the three ad-hoc drags) waits for live grips (`ready()`): R3's
       `reloading` prop keeps the ledger's grips inert through the Portfolio page's reload after a
       save or an Undo (R3 amendment 4), longer than the plan's fixed 1.5s settle on the real book —
       so Space lifted nothing at `ledger-keyboard`, by design, at both widths;
     - the stop check follows §2.3.5's letter (stops at the box's own top, or with the clamped slot
       ≥ 40px into the visible band); whether that slot clears a sticky header is measured in the
       JUDGE record instead (finding 2 below);
     - `activity-undo` reads the top BATCH rows: every change-log Undo also records a run of kind
       `undo` (house behaviour since 65ea44f6, 2026-09-03), drawn as its own "Undo" row above
       "Undid: …" — the plan's activity-feed step already set runs aside.
  4. *7f966c97 — one added check*: a card's drill-in draws its line in its household colour (spec
     §7 as amended at R5's review: rank among the household's ACTIVE cards). Apple Card (rank 5)
     discriminates — a lone series used to take slot 0. Added after the dark run; in the light run
     and both Phase B runs.
  5. *59620fc1 — the resting look, corrected*: the first light run failed five resting-look checks
     that dark had passed. Fix 2's "hairlines exact" band was wrong: at a low threshold dark shows
     the same thing — the collapsed model draws each row's LINE half a pixel lower too (a shared
     border is centred on the grid line), so about half the lines land one device pixel apart; dark's
     hairline contrast (~21) sat under the plan's 24 threshold, light's (~30) did not. Since a plain
     1px tolerance would also accept a doubled or a missing hairline, the rule is now three-part —
     pixels within a one-row vertical offset; at every DOM row boundary as many hairline rows in both
     shots, at most 1px apart (a ghost-free median-contrast detector that finds the ledger's faint
     `--surface-2` lines too); and no cell with a top border. Validated offline on all 20 saved
     pairs (equal line counts, 0 mismatches) before the light re-run.
- **The lanes' later changes, and where each is proven:**
  - R0 leading-edge slot rule, range-end auto-scroll stop, one hairline inside a lifted unit —
    browser-proven here (every drag lands its computed slot; both boxes stop at the range end;
    the carry frame's single hairlines). "Cancelled — the list changed." and the drop committed on
    unmount during the 120ms settle need data landing mid-drag or a popover closing mid-settle —
    left to R0's and R4's hook tests.
  - R2 one `<tbody>` per group with `scope="rowgroup"` headings — checked in accounts-rest; grips
    parked until reloads land — every step waits them out (`waitIdle`, `ready`).
  - R3 `reloading` — what made `ready()` necessary (fix 3); the owner-scope-tagged layers — the
    person-scope PUT carries `?owner=2` and the hidden rows keep their slots; a scope SWITCH under a
    save is R3's unit tests.
  - R5 colours among ACTIVE cards and the drill-in — the drill-in check (fix 4); all seven cards on
    this book are active, so "active" vs "all" cannot be told apart here (R5's unit tests); the page
    load-sequence guard is a race, likewise unit-tested.
  - R6 one Undo-failure sentence, 4xx verbatim — the overlap refusal shows the change log's own
    sentence verbatim (activity-overlap); the non-4xx "Couldn't undo the move — {reason}." wording
    needs a forced 5xx — R6's 503 tests.
- **Findings for the controller** (none blocks the landing — every hard check is green):
  1. **R0 — moderate (reduced motion only): the drop line hides under the row in hand.** Under
     reduced motion peers never move, so the lifted row (opaque `--surface-2`, `z-index: 2`)
     overlaps its target peer, and the accent line — an inset box-shadow inside the TARGET's cells
     — is painted beneath it. Measured with a read-only sweep (2px pointer steps, hit test inside
     the line): covered in 24 of 54 samples on Settings › Spending categories (44%) and 10 of 19
     in Overview › Customize (53%); every `*-reduced-motion-held.png` shows no line (zooms:
     `scratchpad/reorder-v/dropline/zoom-*.png`, numbers in `dropline.json`). For about half of
     each slot's travel a reduced-motion reader loses the one landing cue that replaces the
     shifting peers (spec §2.5). The probe's check reads `data-reorder-drop` and stays green.
     *Minimal fix (reorder.css):* draw the line above the lifted unit — a `::after` bar on the
     target's edge cells (`position: absolute; left: 0; right: 0; height: 2px; background:
     var(--accent); z-index: 3; pointer-events: none`, `top: 0` for `before`, `bottom: 0` for
     `after`; the cells `position: relative` except the already-positioned pinned ones) in place
     of the inset box-shadows, pinned in `reorderCss.test.ts`. (A pinned sticky cell is its own
     stacking context, so the bar stays under the lifted row in the Actions column only.)
  2. **R0 / spec §2.3.5 — minor, cosmetic: the auto-scroll zone ignores a sticky header.** The top
     zone and the range-end stop are measured from the scroller's top edge. Categories & weights at
     1280 has a two-line 46px header, so an upward auto-scroll stops at scrollTop 5: the row in
     hand overlaps the header's bottom by 5px, and after the drop the first row rests 5px under the
     header (`1280-weights-autoscroll-held.png`, both themes). In the Settings roster (~30px header)
     the group's heading row sits under the header at the stop (R2's round-2 note; "TAXABLE" is
     half-hidden in `1600-accounts-autoscroll-held.png`). *Minimal fix (reorderDom.ts):* start
     `visibleBounds(scroller).top` below the scroller's sticky `thead` (its height when its cells
     compute `position: sticky`), so the zone and the stop both count from the header's bottom.
  3. **Not a lane defect — for the record:** the resting tables are not pixel-identical to the
     collapsed model: each row's content AND hairline sit half a CSS pixel higher (fixes 2 and 5) —
     0 or 1 device pixel per row. Row boxes, backgrounds and the one-line-per-boundary structure are
     identical. Imperceptible; a separate-border table cannot reproduce a centred shared border.
  4. **Pre-existing — minor (not this batch):** under `border-collapse: collapse`, Edge/Chrome skip
     the pinned Actions column's left hairline (`box-shadow: -1px 0 0 var(--border)`, panels.css,
     2026-09-13 polish §7) on the pinned HEADER cell of every table, and on the BODY cells of the
     tables inside HoldingsScroll. Measured: the reorderable ledger's edge paints in full under
     `separate` and not at all under `collapse` (header and every row); Portfolio › Manage ›
     Securities — a house table that stays `collapse` — computes the same shadow and paints nothing
     (read-only sample: dark 38,43,54 vs 23,26,33; light 225,231,239 vs white); on the Settings
     tables, the roster and Categories & weights only the header cell's segment differs. So the five
     reorderable tables now draw that edge in full, as designed (Judgement 2), while the other
     pinned-column tables keep the gaps (in full on Securities, measured — likely on the other
     HoldingsScroll tables too; the header cell on the rest, by the pattern above). *Fix, outside this batch:* draw that edge in a way both models paint (a 1px
     `background-image` gradient on the pinned cell), or accept the difference.
  5. **House behaviour, noted:** every change-log Undo shows two Activity rows — the run
     ("Undo", with View report) and the batch ("Undid: …") (since 2026-09-03; not this batch).
- **Judgement 1, the row in hand over a sticky header** (2 boxes × 2 widths × 2 themes): **ACCEPT.**
  - Mid-scroll (`*-autoscroll-scrolling.png`, the range's first row still hidden): the row in hand
    covers the header — hit test `liftedOver: true`, overlap 21px (38px under the 46px weights
    header at 1280) — fully legible, raised on `--surface-2` with its hairlines, under the pointer;
    no header label shows through it; nothing is clipped by the header.
  - At the stop (`*-autoscroll-held.png`): the header is on top again (`headerOnTop: true`), the row
    clamped at its range's first slot below it (accounts 10px below, weights 1600 flush) — except
    weights at 1280, 5px over the header's bottom (finding 2).
  - After every drop the header is on top (a hard check, green in every box, width and theme).
  - It reads as the row in hand riding above everything while the pointer holds the top zone of a
    live drag, and only then. The `z-index` fix from Task 7 is not needed.
- **Judgement 2, pixels inside pinned cells**: **ACCEPT.**
  - What differs inside the pinned cells, both themes: (a) the Actions buttons' labels, the row
    lines and the header cells, moved by the half-pixel row offset (yellow — explained); (b) ONE
    vertical line, the pinned column's left hairline, which the separate model paints where the
    collapsed model skipped it (finding 4): the header cell's segment on every table, the whole edge
    on the ledger. Dark: judged `inside` 0 — that line's contrast (21) is under the probe's 24
    threshold; light: the line's pixels ARE the judged `inside` count (the light line above).
  - No button moved, no label shifted, the `-1px` edge is not lost — it is gained: the hairline
    panels.css was written to draw ("border-collapse loses a sticky cell's own border, so the
    hairline is redrawn as a box-shadow") and spec §2.5 names ("the sticky last column's box-shadow
    hairline stays"). It separates the pinned column the way it was designed to.
  - The plan's anticipated "row lines now continue through the pinned Actions column" does not
    happen — the row lines already ran through it under `collapse` — so the morning list gets the
    real change instead: the pinned column's left edge now shows on the five reorderable tables.
- **Task 7 Step 1 (the drags, eyeballed in both themes)**: the lifted row raised on `--surface-2`
  with its hairlines and its pinned Actions cell on the same surface; exactly the passed rows moved
  (categories, accounts, ledger, roster, weights, Customize with its shadow); the carry frame moves
  the 401(k) and its three components as one block with one hairline between rows, only the IRA
  making room; the 1280 ledger frame shows the lifted trade at the window's foot after the page
  scrolled; `1600-credit-lines-after-reorder.png` shows the legend in the new order (Savor, Robinhood
  Gold, Active Cash, Venture X, Autograph, Apple Card, Total) and every line in its recorded colour.
  The reduced-motion frames show the vacated slot and the row in hand, but no drop line (finding 1).
- **Guide walk (Task 8)**, on the light pass's copy (read-only): `GUIDE SMOKE OK — 162 link visits,
  24 checks, 8 writes blocked` — exit 0; rows dark 196 / light 196 (content 196); cards 28 / 28
  (content 28); chips 21; 81 destinations per theme; 162/162 links landed; 0 console errors. Both
  new derived checks green. The 8 blocked writes are the pages' compute-only `POST
  /paycheck/preview` and `POST /taxes/what-if`, answered from memory by the probe's fence (by
  design; nothing persisted).

### Phase B — on the landing tip (`feat/reorder-verify` @3d44ae65, which contains `feat/reorder-base` @adabce05 and main @923a633e)

- Preflight (Task 9): no fast-forward — per the controller, main's completed quick-fixes batch was
  already merged into the base (5a701d9d) before the lane was cut, and `git merge feat/reorder-base`
  brought R6's cleanup round (adabce05 → 1af542a3) before Task 6; checked again before the gates:
  `main` = 923a633e (unchanged), an ancestor of the tip ("main is inside the tip"), the base
  (adabce05) inside the tip too; none of the five quick-fixes worktrees listed; `alembic heads` =
  `f12026092301 (head)` alone.
- Backend (Task 10), servers stopped for the run: ruff `All checks passed!` and `287 files already
  formatted` (exit 0); pytest on `finance_test_reorder_v`: `2327 passed, 4 skipped, 1 warning in
  1334.77s (0:22:14)` — exit 0; no failure, so no flake to re-run (the known
  `test_assistant_evidence.py` timing tests passed). The 4 skips are Windows platform limits, named
  by a `-rs` re-run of their files (56 passed, 4 skipped): `test_restore_points.py:128` and
  `test_snapshot_store.py:160` (no symlink privilege), `test_restore_points.py:144` (FIFOs are
  POSIX-only), `test_restore_points.py:188` (cannot unlink an open file). The warning is a
  pre-existing `SyntaxWarning` (an unescaped `\d` in a docstring, `test_restore_points.py:531`).
  For scale: R1 saw 2118 passed, 1 skipped; the tip adds R2–R6 and the quick-fixes batch.
- Migration drill (Task 11) on `finance_test_reorder_v_mig` (a `pg_dump | psql` copy of
  `finance_realdata`, head `f12026091203`): `Running upgrade f12026091203 -> f12026092301`; backfill
  `26|26|13|13`; `CREATE UNIQUE INDEX ux_position_txn_import_key ON public.position_transactions
  USING btree (import_key) WHERE ((source)::text = 'import'::text)`; the duplicate refused
  (`duplicate key value violates unique constraint "ux_position_txn_import_key"`, exit 1, still 39
  rows); `Running downgrade f12026092301 -> f12026091203` with the column gone (`0`); upgrade again,
  backfill `26|26|13|13`; `alembic check` — `No new upgrade operations detected.` (exit 0). The
  database is left for the morning list.
- Frontend (Task 12), sequential, nothing else running: `npx vitest run --maxWorkers=2` —
  **267 files / 3869 tests passed**, exit 0 (289s); no failure, so no flake to re-run (neither
  known flake nor the `TransactionsPanel entry session` test tripped). `tsc -b` exit 0; no-cache
  `tsc -p tsconfig.app.json` 0 / `tsc -p tsconfig.node.json` 0. `eslint .` exit 0 — 0 errors,
  26 warnings, all `react-refresh/only-export-components`, exactly the plan's baseline of 26
  (`CategoriesPanel.tsx`'s `SEED_CATEGORIES` among them); no new one. `npm run build` exit 0; it
  prints the chunk-size advisory for the lazy echarts chunk (`tooltip-*.js` 763.29 kB against the
  760 kB `chunkSizeWarningLimit`) — NOT new: main @923a633e prints the same (763.30 kB, measured by
  building main's frontend from `git archive main` in this lane's gitignored scratchpad). The
  quick-fixes batch crossed the limit; this batch adds nothing to that chunk.
- Probes (Task 13), servers restarted from the tip (uvicorn and vite; proxy head `f12026092301`),
  a fresh copy per theme:
  - reorder dark: `checks: 604 ok, 0 failed, 70 noted; page writes 72 (blocked 0); logged reorders
    24, undos 14` — `REORDER SMOKE OK — dark: 604 checks`, exit 0, 6m53s; reorder light: the same
    shape — `REORDER SMOKE OK — light: 604 checks`, exit 0, 7m24s. Both identical in every figure to
    the Phase A light run (resting looks, JUDGE geometry, the drill-in colour: dark #008300, light
    #1f7a1f); 51 page loads each, page CLS ≤ 0.002.
  - guide: `GUIDE SMOKE OK — 162 link visits, 24 checks, 8 writes blocked`, exit 0; rows 196 / 196
    (content 196), cards 28 / 28, 162/162 links, 0 console errors.
  - pace (informational): exit 1 — its `settings`, `rows` and `rail` steps are stale, not this batch:
    they expect the 2026-09-06 Settings (all five sections on one page, a chip rail in the scope
    row), which the 2026-09-12 local-sections redesign replaced with one section per tab; the section
    navigation is identical on main (the tip's only SettingsPage change is R2's skeleton heights).
    Run step by step: `anchors`, `pace`, `movers` → `PACE SMOKE OK`; `settings` 6 checks red on the
    missing one-page headings and rail; `rows`/`rail` time out on `.page-frame-scope .segmented`.
  - charts (credit-cards, informational): `CHARTS SMOKE OK`, exit 0 — but hollow: `/credit-cards`
    now opens the Rewards view, which drew 0 charts on this copy, and the probe's route list has no
    `section=lines` entry, so it no longer reaches the credit-line chart. The reorder smoke's
    colours, roster-follows and drill-in checks cover that chart in both themes.
- Deviations from this plan, each with its reason:
  1. No `--ff-only` fast-forward in Task 9: the controller had already merged main into the base
     and asked for `git merge feat/reorder-base` (before Task 6 and again before the gates) plus an
     ancestry check instead; both merges and the check are recorded above.
  2. The probe departs from the plan's text in six recorded places (Phase A, fixes 1–5, and the
     drill-in check), each against the final lane code or the spec line it answers to; no check was
     removed; the resting-look check was made more precise, not looser (hairline structure is now
     judged explicitly, where the plan's threshold could not see dark hairlines at all).
  3. Two extra read-only instruments, kept in the session scratchpad (not committed): the
     reduced-motion drop-line sweep and the pinned-edge sample (finding 1 and 4's evidence).
  4. Phase A's dark pass ran the probe before its last two changes (7f966c97, 59620fc1); the landing
     runs above ran the final probe in both themes.
  5. vitest ran with `--maxWorkers=2` (the controller's memory note) instead of the plan's bare
     `npx vitest run`.
  6. Main's frontend was built once from `git archive main` in this lane's gitignored scratchpad
     (`scratchpad/main-build*`) to show the chunk-size advisory predates the batch.

---

## Morning list (filled by lane V; the controller adds main's hash after the fast-forward and relays it)

**What shipped** — local main @ [the controller's fast-forward], **NOT pushed**: the V tip is 191
commits beyond main/origin main @923a633e (plus the controller's merge). Drag to reorder on six
lists:
- **Settings › Spending categories** — a grip column; the Sort order box and column are gone; new
  categories append.
- **Settings › Accounts** — grouped by type (one heading per group) with component accounts nested
  under their parent, and a parent drags with its components.
- **Portfolio › Manage › Transactions** — the list IS the cost-basis replay order. A drag re-times
  a trade, and the toast says what the move did to the holding's figures.
- **Overview › Customize** — drag the tiles and deeper views; hidden items sit under "Hidden".
- **Credit Cards › Card roster** — each card keeps its credit-line colour whatever the order, the
  person scope or its own drill-in.
- **Credit Cards › Categories & weights** — one save per drop, with Undo.

Every drop saves the whole order at once with a toast and an Undo (Overview: Reset to defaults),
works from the keyboard (Space, arrows, Space), and respects reduced motion. Behind them:
- a workbook re-import no longer reverts a custom order;
- trades are matched to sheet rows by a new key, so a moved trade keeps its identity;
- new sheet trades land at the end of the ledger.

**Proof** (all on the landing tip, `feat/reorder-verify` @3d44ae65 plus this results commit, which contains main @923a633e):
- backend 2327 passed, 4 skipped (Windows-only platform skips), 1 pre-existing warning; ruff clean;
- vitest 267 files / 3869 tests;
- tsc (build graph and both no-cache configs), eslint and build clean (eslint: 0 errors and the base's 26 react-refresh warnings; build: the pre-existing echarts chunk advisory, finding 4);
- the migration drill green on a copy of the real book (26 imported trades keyed; the index refuses
  a duplicate key; downgrade and upgrade clean; `alembic check` clean);
- the reorder smoke, a real mouse in Edge on all six lists at 1600 and 1280: dark 604 / light
  604 checks, 0 failed, 0 blocked writes;
- the Guide walk: 196 rail rows (= every task) and 28 cards per theme, 162 links.

**Rollout — the user's steps:**
1. `git push` from the main checkout.
2. On prod: `cd ~/personal-finance-dashboard && git pull && docker compose -f docker-compose.prod.yml up -d --build`
   (README §4.1). Both images rebuild. The backend runs `alembic upgrade head` as it starts: revision
   `f12026092301` adds `position_transactions.import_key`, backfills it from `sort_index` for the
   imported trades, and builds a partial unique index. A failure stops the deploy loudly (the
   healthcheck gates nginx).
3. **At once:** Settings → Data → Backups & snapshots → **Snapshot now**. Every snapshot taken
   before this deploy can no longer be restored: a restore needs the snapshot's migration head to
   equal the server's (spec §3.5).
4. Check: `/api/v1/system/status` → `database.alembic_head` is `f12026092301`, and Settings ›
   Spending categories shows grips.

**What the user will notice:**
- **The Monthly update follows these orders.** Its paste-a-column fills rows in the new order, so
  a pasted spreadsheet column must match it.
- **The first accounts move on prod is logged in Activity as "Reordered N accounts"** (3 for most
  first moves on this book), not "Moved account …". Saving the drawn order puts the two 401(k)
  parents after their components for the first time. Later moves name one account.
- **In a person's view each card now wears its household colour.** The joint Apple Card, for
  one, changes colour once in Grace's view. The household view does not change, and colours now
  hold through any reorder, any person scope and the card's own drill-in.
- **The pinned Actions column's left edge now shows** on the five reorderable tables — the hairline
  the 2026-09-13 polish designed; Edge/Chrome had skipped it under the old border model (in full on
  the ledger, the header cell elsewhere). (Judgement 2, accepted. The plan's "row lines now continue
  through the pinned column" does not apply: they already did.)
- **While dragging near the top of a capped list, the row in hand rides over the column headers**
  until the list stops scrolling; the headers are back on top the moment it stops or drops
  (Judgement 1, accepted).
- **Activity shows two rows per Undo** — "Undo" (a run, with View report) above "Undid: …" — as it
  has since 2026-09-03; it is simply more visible now that reorders are undone there.

**Findings to eyeball** (none blocks the landing; PNGs in `.worktrees/reorder-v/scratchpad/reorder-v/`):
1. **R0 — moderate, reduced motion only: the drop line hides under the row in hand** for about half
   of every slot's travel (measured 44% / 53%) — `dropline/zoom-*.png`, `dropline/dropline.json`,
   any `*-reduced-motion-held.png`. Minimal fix in `reorder.css`: draw the line as a `::after` bar
   above the lifted unit (`z-index: 3`) instead of an inset box-shadow inside the target's cells.
2. **R0 — minor, cosmetic: the auto-scroll zone ignores a sticky header.** Categories & weights at
   1280 (a 46px two-line header) stops 5px short of its top, so the first row rests 5px under the
   header; the Settings roster's group heading hides under the header at the stop —
   `{dark,light}/1280-weights-autoscroll-held.png`, `{dark,light}/1600-accounts-autoscroll-held.png`.
   Minimal fix in `reorderDom.ts`: start `visibleBounds`'s top below the scroller's sticky `thead`.
3. **Pre-existing, outside this batch — minor:** the pinned Actions column's left hairline is skipped
   under `border-collapse: collapse` (in full on the HoldingsScroll tables such as Securities, the
   header cell elsewhere) — decide whether to draw it with a 1px background gradient app-wide.
4. **Pre-existing, from the quick-fixes batch — note:** `npm run build` prints the chunk-size
   advisory: the lazy echarts chunk is 763.30 kB on main (763.29 on the tip) against the 760 kB
   `chunkSizeWarningLimit` in `vite.config.ts`, whose comment asks for the limit to be raised
   deliberately, with its history, when a chart change pulls in more echarts.
5. **Pre-existing — two older probes predate the 2026-09-12 local sections:** `pace-v`'s
   `settings`/`rows`/`rail` steps expect all five Settings sections on one page and a chip rail in
   the scope row (its `anchors`/`pace`/`movers` steps pass), and `charts-c7`'s `/credit-cards` route
   now lands on the Rewards view, never the credit-line chart. Worth a refresh when next touched.

**Cleanup — ask before deleting; nothing was deleted by the batch:**
1. **Worktrees** `.worktrees/reorder-base`, `reorder-r0`, `reorder-r1`, `reorder-r2`,
   `reorder-r3`, `reorder-r4`, `reorder-r5`, `reorder-r6`, `reorder-v`.
   - **Junction-safe:** all nine `node_modules` are junctions to the main checkout's (checked
     2026-09-23 with PowerShell: `(Get-Item .worktrees\<name>\node_modules -Force).LinkType` →
     `Junction`; the plan's `cmd //c dir /AL` line prints nothing useful from Git Bash). Remove the
     link alone with `cmd //c rmdir .worktrees\<name>\node_modules`, which never touches the target.
   - Then run `git -C /c/Users/edyli/personal-finance-dashboard worktree remove --force .worktrees/<name>`.
   - Never `rm -rf` through a junction: it empties the main checkout's `node_modules`.
2. **Branches**, once local main contains them (`git branch --merged main`), with `git branch -d`
   (never `-D`): `feat/reorder-base`, `feat/reorder-component`, `feat/reorder-backend`,
   `feat/reorder-settings`, `feat/reorder-transactions`, `feat/reorder-overview`,
   `feat/reorder-cards`, `feat/reorder-consolidate` (R6), `feat/reorder-verify`.
3. **Databases.** List them first:
   `docker exec finance-dashboard-db-1 psql -U finance -d postgres -tAc "SELECT datname FROM pg_database WHERE datname LIKE 'finance\_reorder\_%' OR datname LIKE 'finance\_test\_reorder\_%' ORDER BY 1"`.
   - On 2026-09-23 that listed `finance_reorder_r2`, `…_r3`, `…_r4`, `…_r5`,
     `finance_reorder_scratch` (this lane's), `finance_test_reorder_base`, `finance_test_reorder_r1`,
     `…_r1_mig`, `…_r1cq` and `…_r1rev`; this lane adds `finance_test_reorder_v` and
     `finance_test_reorder_v_mig`.
   - Drop each by name with `docker exec finance-dashboard-db-1 dropdb -U finance <name>`.
   - Never `finance`, `finance_realdata` or `finance_test`.
4. `scratchpad/reorder-*` go with their worktrees (V's holds the run artifacts, including
   `dark-run1` and `light-run1`, the red first runs). The main checkout's `scratchpad/` is untouched.

---

## Notes for the controller

1. **The sticky-header fix is on the header, not the row.** R5's note 2 suggests `z-index: 1` for a
   lifted row inside a sticky-header box. That cannot work:
   - The sticky `thead th` already has `z-index: 1` and precedes the rows in the document. Two
     positioned boxes at one z-index paint in tree order, so a lifted row at 1 still paints over
     the header.
   - Taking the row to `z-index: 0`/`auto` lets a later shifting peer paint over the row in hand
     (their transforms make them stacking contexts in the same layer).
   - If Judgement 1 rejects, the fix is the header at `z-index: 3`, above the lifted row's 2 —
     Task 7 Step 2 has the rule and its pin.
   - The recommendation, though, is to ACCEPT: the row in hand riding over everything is what a
     drag looks like, it happens only while the pointer sits in the 40 px zone, and the probe proves
     the header is back on top the moment the drag ends.
2. **Worktree removal must not follow a junction.** See the cleanup list. The lanes' plans
   variously said `ln -s` (which Git Bash turns into a copy) and "junction": check each worktree's
   `node_modules` before removing it.
3. **Phase B needs `feat/reorder-verify` inside `feat/reorder-base` first.** Task 9 fast-forwards
   and refuses anything else.
4. **Two expected oddities on prod, worth a line to the user:**
   - the first accounts move logs "Reordered N accounts" (morning list);
   - R1's minimal-moved-set labels can name a peer rather than the row dragged. A parent dragged
     below its sibling can log "Moved account {sibling}", while the toast names the parent. Both are
     true, per spec §3.1 ("moved X is then true of either").
5. **Not covered by any browser check:** 1920 px (§9 lists it; §10 scopes V to 1280/1600), and
   the forced-failure paths V deliberately did not repeat. The lanes own the latter.

---

## Self-review — spec §9 and §10 mapped to probe checks and tasks

| Spec | Requirement | Where |
|---|---|---|
| §10 V | `tools/probes/reorder-v/smoke.mjs` (playwright-core + Edge, the sandbox-v pattern) plus a README row | Tasks 3, 4 |
| §10 V | writes only to `finance_reorder_scratch`, rebuilt from `finance_realdata` before each theme | Task 1 recipe; Tasks 6 and 13 run it per theme; the probe's gate (5 checks) and write fence |
| §10 V | each of the six surfaces, both themes (one per run), 1280 and 1600 | `SIZES` × `ONLY_THEME`; one `surface()` walk per list |
| §10 V | a real mouse drag: the lifted row follows the pointer; peers shift; it lands where the gap was | `mouseDrag` (lift, ±2 px, exactly \|k\| displaced, grabbing, lands) in every `*-drag` / `*-undo` step; `accounts-carry` for a unit with carried rows |
| §10 V | the order survives a reload | "the order survives a reload" in categories-, accounts-, ledger-, roster-, weights-, customize-drag |
| §10 V | the toast appears and Undo restores the previous order | the toast checks in every `*-drag`/`*-keyboard`; every `*-undo`; carry and auto-scroll Undos; Overview: "no toast" + Reset to defaults (spec §6) |
| §10 V | the keyboard path: Space, ↓ ×2, Space | `keyboardMove` (lifted from the keyboard, moved, focus kept) in six `*-keyboard` steps |
| §10 V | auto-scroll inside the 420 px Settings box (last account of a long group to its top) | `accounts-autoscroll` (`autoScrollInBox`), both widths; also `weights-autoscroll` (440 px) |
| §10 V | auto-scroll on the page (the ledger at 1280×800) | `ledger-drag` at 1280 (`longDrag`: scrolled > 200 px, the row travels ≥ 8, nothing else moved) |
| §10 V | reduced-motion emulation: a drop line and no transform on peers | `reducedMotion` in six `*-reduced-motion` steps |
| §10 V | the resting table look under `.reorder-table` matches `border-collapse: collapse` within a tolerance | `restingLook` on five tables × two widths (hard outside pinned cells; JUDGE inside — Task 7 Step 3) |
| §10 V | hairlines travel with a lifted row | `mouseDrag`'s "the lifted row's cells draw their own hairline"; Task 7 Step 1's shots |
| §10 V | Overview Customize: Escape mid-drag keeps the popover open | `customize-escape`; `customize-reduced-motion` |
| §10 V | a clean console and CLS < 0.1 on each page | `visit()` on every page load; `drain()` on every step |
| §10 Final | full gates on the integration branch after merging main | Tasks 9, 10, 12 |
| §10 Final | the V probe | Task 13 (both themes) |
| §10 Final | alembic upgrade → downgrade → upgrade on a scratch database | Task 11 (prod-shaped copy, backfill, duplicate refused, `alembic check`) |
| §9 | lists with nothing to move: a one-row list or single-account group has a disabled grip; an empty list shows no grips | `accounts-rest` "a grip is disabled exactly where its range holds nothing else" (none in this book); one-row and empty lists: R2/R3/R5 unit tests |
| §9 | retired and inactive rows keep their positions and are draggable; the PUT sends every row | the PUT's full list: "the server holds the whole roster in the new order"; retired/archived rows: R2/R5 unit tests (the book has none) |
| §9 | two tabs: 409 → toast → reload; nothing half-applied | `categories-two-tab` (real); R3 g and R5 k (stubbed) |
| §9 | a second drop cannot start before the first save returns | `waitIdle` waits out the parked grips on every save; R2/R3/R5 unit tests |
| §9 | Undo after a later reorder — logged lists refuse with the overlap sentence | `activity-overlap` |
| §9 | Undo after a later reorder — client-Undo lists re-send the captured order | R3 Task 4, R5 Tasks 4 and 7 (unit) |
| §9 | cancelled drags make no request: data landing, a scope switch, a resize, window blur, Escape | Escape: six `*-reduced-motion`, `accounts-component-range`, `customize-escape`; resize: `categories-resize-cancels`; data landing, scope switch, blur: R0 hook tests, R3 Task 1 |
| §9 | popover Escape cancels the drag only | `customize-escape`, `customize-reduced-motion` |
| §9 | detail-panel Escape cancels the drag only | R0 hook test (not probed) |
| §9 | transactions: owner scope reorders only the visible rows among their slots; a hidden holding never moves | `ledger-person-scope` |
| §9 | transactions: figures reported for every changed position | `ledger-figures` (the moved holding's realized gain); R1 Task 8 tests |
| §9 | import after reorder: custom orders survive, moved sheet rows keep identity, new rows append | NOT browser-probed — R1 Task 7 tests, in Task 10's suite |
| §9 | accounts: retired parent keeps its components nested; a parent in another group leaves them top-level; a group change via Edit appends | R2 Task 5 and R1 Task 5 tests; `accounts-rest` checks the per-group nesting rule on the real book |
| §9 | Edge at 1280/1600/1920, both themes | 1280 and 1600 in both themes; 1920 not probed (§10's scope) |
| §8.1–§8.4 | the notes, hint, toasts, stale sentence, overlap sentence, announcements, Activity labels | `CAT_NOTE`, `ACC_NOTE`, `LEDGER_HINT`, the toast checks, `STALE_CATEGORIES`, `OVERLAP`, the component-range live-region checks, `LABEL_OF` |
| §7 | colours by rank among all cards: unchanged by a reorder and across person scopes; the matrix columns follow | `colours`, `roster-follows` |
| §11 | V on `feat/reorder-verify` from the base with R0–R5; owns `tools/probes/reorder-v/**`, the README row, the results | Mechanics, Task 0, the file map |
| §11 | landing: after the quick-fixes batch completely lands, merge main, re-run the gates and the probe | Tasks 9–13 |
| §11 | hand-over: push; `git pull` + README 4.1 rebuild; a snapshot at once | the morning list |
| user | the Guide probe's counts after R5's `cards-reorder` | Task 5 (before/after table; derived checks) |
| user | the sticky-header judgement with a rule and the R0 fix | Task 7 Step 2; Notes 1 |
| user | the cleanup list (worktrees, branches, databases) | the morning list |
