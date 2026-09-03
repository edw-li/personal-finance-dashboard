# Sandbox lane V — merge, verify, smoke, README, retire-at-end — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close `docs/superpowers/specs/2026-09-03-planning-sandboxes-design.md` §15 step 4 after lanes G, B, P, T, J and A have merged to local main: whole suites green on both sides, the write-purity conformance walk covering all three panels, the chart-dependent conditional tasks reconciled with the chart-grammar lanes, a real-browser smoke of each sandbox from a `whatif=` link in both themes, a "Sandboxes" section in the README, and the retire-at-end list (nothing is deleted in the lanes; this plan decides what may go, and even here deletions are proposed, not performed, until the owner's morning).

**Architecture:** Read-mostly. Every check is a command with an expected output; the only edits are the README section, a possible duplicate-`reference.ts` reconciliation and, if the chart lanes have merged since, running the two conditional tasks that the page lanes skipped (`2026-09-04-sandbox-taxes.md` Task 7; `2026-09-04-sandbox-projection.md` Task 2 Step 1's minimal module → replaced by C1's).

**Tech Stack:** pytest on `FINANCE_TEST_DB=finance_test_sandbox_v`; vitest, tsc, eslint, vite build; the dev stack (backend uvicorn on 127.0.0.1:8000, `npm run dev` proxied at `/api`) and a real browser for the smoke.

**Worktree / commands:** Runs on the MAIN checkout after the merges (`git status` clean; `git log --oneline -12` shows the six lane merges). Backend from `backend/`: `FINANCE_TEST_DB=finance_test_sandbox_v .venv/Scripts/python.exe -m pytest -q`. Frontend from the repo root.

**Prerequisites:** all six sandbox lanes merged into local main in this order: G and B (either order) → P, T, J, A (any order; each rebased on the G+B main) → this plan. Local commits only — nothing is pushed.

**Merge notes for the coordinator:** `src/types/api.ts` (B appends; P/T/J read — no conflict expected); `backend/tests/fixtures/sandbox_entries.json` (G creates; A reads; nobody edits); `src/charts/reference.ts` (J may create a minimal copy; chart-grammar C1 creates the real one — if both exist, take C1's); `src/components/projection/projectionChartOptions.ts` (J adds an argument; chart lane C5 migrates the builder — union merge, run the builder tests after); `src/pages/TaxesPage.test.tsx` / `PaycheckPage.test.tsx` / `ProjectionPage.test.tsx` (each edited by exactly one sandbox lane AND by the shell Plan 3 lane before it — the sandbox lanes were written against Plan 3's result).

---

### Task 1: Whole suites

- [x] **Step 1: Backend**

Run (from `backend/`): `FINANCE_TEST_DB=finance_test_sandbox_v .venv/Scripts/python.exe -m pytest -q && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format --check app tests`
Expected: all passed (1309 pre-batch + lane B's ~25 + lane A's ~8); ruff clean. Watch for `tests/test_sandbox_purity.py::test_every_sandbox_route_has_a_registered_body` — it fails only if a preview route was added without a body in `SANDBOX_BODIES`.

- [x] **Step 2: Frontend**

Run: `npx tsc -b && npx eslint . && npx vitest run && npm run build`
Expected: clean; all green (1450+ pre-batch plus ~130 from the lanes); the build emits `dist/` without warnings about unused CSS (vite does not warn on that — the retire list covers it).

- [x] **Step 3: The conformance walk names every panel**

Run: `npx vitest run src/sandbox/sandboxConformance.test.ts --reporter=verbose 2>&1 | grep -E "TryItPanel|WhatIfPanel|ScenarioPanel"`
Expected: three lines, each `✓ … imports no api() and spells no mutating method`. If a panel is missing, its lane did not create the file at the path the walk expects (`src/components/paycheck/TryItPanel.tsx`, `src/components/taxes/WhatIfPanel.tsx`, `src/components/projection/ScenarioPanel.tsx`).

---

### Task 2: Reconcile with the chart-grammar lanes

- [x] **Step 1: Which chart plans have merged?**

Run: `ls src/components/ChartCard.tsx src/charts/reference.ts src/charts/tooltip.ts src/charts/scales.ts src/charts/grammar.ts 2>&1; git log --oneline -30 | grep -i "chart"`

- [x] **Step 2: `reference.ts`.** If `git log --oneline -- src/charts/reference.ts` shows two authoring commits (J's minimal module and C1's), confirm the file on disk is C1's (it exports `referenceLine` plus whatever else the chart spec §5 lists) and that `npx vitest run src/charts src/components/projection` is green. If only J's exists (C1 unmerged), leave it — C1 will overwrite it.

> **Outcome (2026-09-04):** both conditionals were already answered by the chart lanes.
> `git log -- src/charts/reference.ts` shows ONE authoring commit (8fda06b, chart lane C1),
> so J never landed a minimal copy and there was nothing to reconcile; `whatIfDeltaBarOption`
> is present in `taxChartOptions.ts` from chart lane C6 (main 2d02f47), so Task 7 was not
> re-run here.

- [x] **Step 3: Taxes Δ bar (conditional).** If `ChartCard.tsx`, `tooltip.ts` and `scales.ts` exist and `grep -n "whatIfDeltaBarOption" src/components/taxes/taxChartOptions.ts` finds nothing, run `2026-09-04-sandbox-taxes.md` Task 7 now, on main, as its own commit. Otherwise record "Δ bar deferred to the chart lane C6 (Taxes)" in the report.

---

### Task 3: Smoke — every sandbox from a `whatif=` link, both themes

There is no headless walk script in the repo (the audit's walks were driven ad hoc), so this is a driven checklist. Start the dev stack the way the project normally does (backend `uvicorn app.main:app --reload` from `backend/` with the dev `.env`; `npm run dev` at the root — vite proxies `/api` to 127.0.0.1:8000); log in. Screenshots go to `C:\Users\edyli\AppData\Local\Temp\claude\C--Users-edyli-personal-finance-dashboard\<session>\scratchpad\sandbox-smoke\`. The browser console must stay free of errors for every step (a red line fails the smoke).

- [x] **Step 1: Paycheck.** Open `/paycheck?whatif=trad_401k_pct%3A0.15&whatif=hsa_per_check%3A250`. Expect: the Try it card OPEN, a preview already run (the compare table shows Baseline · Scenario · Δ and the pace strip below it), `+2.0 pp` (or the real distance) on the 401(k) knob. Drag the 401(k) slider: the address bar changes only on release; the table dims and refreshes. Click Max 401(k): the URL's `trad_401k_pct` becomes the limit ÷ salary and the pace row for the elective limit reads on pace/near the cap. Pin, reload: the pinned column re-runs (shows `…` then values). Click "Save as profile effective …": the profile form below is pre-filled and the date box is focused; do NOT click Add profile. Screenshot dark; toggle the theme in Settings › Appearance; screenshot light.

- [x] **Step 2: Taxes.** Open `/taxes?whatif=NVDA` (a held ticker in the dev book) — expect the URL to rewrite itself to `/taxes?whatif=sale%3A<id>%3A<shares>%3A<price>` with the card open and the ten-row compare showing. Type a share count, blur; the Δ tiles and the table update without a Run button. Add an override, choose `trad_401k_contributions`, click Max 401(k): the row value fills from Settings › Limits (if the year's limit is entered; otherwise the chip is disabled with its sentence — check the title). Click "Apply 1 override to {year}": the confirm lists before → after; cancel it (nothing writes). Pin; switch year with the chips; the pinned column re-runs against the new year. Open `/taxes?whatif-lot=<an unsold lot id>` — the URL rewrites to `espp:<id>:<price>`. Both themes screenshotted.

- [x] **Step 3: Projection.** Open `/projection?whatif=annual_return%3A0.06&whatif=retire%3A2%3A2035-06` (person 2 must exist; otherwise drop the retire entry). Expect: the Scenario card open, seven knobs badged "derived", the return knob showing its delta against the echo, the tiles and the fan drawn for the scenario. Pin; a dashed line end-labelled with the pin's name joins the investable chart and a column joins the compare table. Reset to derived: the URL empties, the chart returns to the default run. Both themes.

- [x] **Step 4: Assistant.** Open the drawer on `/taxes`, ask "what if I realized $2,500 of qualified dividends this year?" with a tools-capable model; when `run_tax_whatif` runs, its chip carries "Open in What-if →"; click it — the Taxes page lands with the override in the URL and the card open. (Skip with a note if no NVIDIA key is configured on this box.)

- [x] **Step 5: Record** the screenshot paths and any console line in the report.

> **Smoke outcome (2026-09-04):** driven by `tools/probes/sandbox-v/smoke.mjs` (committed),
> 110 checks green in BOTH themes, 20 screenshots + `report.json`, no console error, no
> pageerror, no unexpected failed request, zero writes attempted (the driver aborts any
> mutating request outside the four pure preview routes) and both Apply confirms cancelled.
> Three of the plan's expectations read differently against the real app and the real book:
>
> - **The drag.** "The address bar changes only on release" is not the contract. A knob's
>   non-committing `set` DEBOUNCES (400 ms) and writes `replace`-style, so a slow drag does
>   rewrite the address bar mid-gesture — what must not happen is a HISTORY entry per frame.
>   The smoke asserts `history.length` is unchanged across the whole gesture, which is the
>   promise the README actually makes (the back button leaves the page).
> - **Max 401(k).** This book stores no contribution limits for any year, so both chips render
>   DISABLED; the walk reads their titles instead ("Enter 2026's 401(k) limit in Settings ›
>   Limits"). The enabled branch is walked by the unit tests, not here.
> - **`retire:2:2035-06`.** Person 2 exists but holds no paycheck profile, so the server 422s
>   the entry ("Partner has no paycheck profile in force — nothing to drop"). The page keeps
>   the derived run's figures under the refusal rather than blanking, which is what the smoke
>   asserts; the frame's Retry-means-reset branch needs `data === null` (no baseline either),
>   which no link reaches on a healthy book, so `ProjectionPage.test.tsx` keeps that one.
>
> One trap cost an hour and is now in `tools/probes/README.md`: the dev backend runs WITHOUT
> `--reload`, and the process on this box had been started nine minutes before lane A merged.
> Its `tool_result` events carried no `link`, so the assistant chip rendered with no
> "Open in What-if →" and nothing on the page said why. Restarting uvicorn fixed it; the chip
> then navigated end to end in both themes.

---

### Task 4: README — the Sandboxes section

**Files:**
- Modify: `README.md`

- [x] **Step 1: Add** a section immediately before `## Troubleshooting` (the README is deployment-shaped and has no frontend section yet; this is the first product-facing paragraph, so it carries its own heading):

```markdown
## Sandboxes (planning what-ifs)

Three pages carry a sandbox — Paycheck's **Try it**, Taxes' **What if**, Projection's **Scenario**.
A sandbox's live scenario lives in the page URL as a repeated `whatif=` query parameter, one entry
per knob or leg in the server's own wire vocabulary: `whatif=trad_401k_pct:0.15`,
`whatif=sale:7:40:62.50:S` (security 7, 40 shares, $62.50, short-term), `whatif=espp:3`,
`whatif=qualified_dividends:null`, `whatif=annual_return:0.06`, `whatif=retire:2:2035-06`. The
URL is the state: copy it and the recipient sees the same scenario; the back button leaves the
page rather than replaying slider positions. Unknown entries are dropped on arrival and the URL
rewritten without them; the older `?whatif=TICKER` and `?whatif-lot=` links still work and are
normalized into the new form.

**Nothing in a sandbox writes to the database.** Previews go to pure endpoints —
`POST /paycheck/preview`, `POST /taxes/what-if`, `GET /projection` — through the read-only client
path, so they never invalidate the page cache; a test (`backend/tests/test_sandbox_purity.py`)
walks every such route under a flush guard and asserts every table's row count is unchanged, and a
frontend conformance test asserts no sandbox module imports the mutating client. The only writes
are the explicit **Apply** actions, which reuse the page's existing forms and endpoints after a
confirmation: Paycheck pre-fills the profile form (you click its own Add profile), Taxes writes
input overrides through the inputs editor's PUT, Projection has no Apply. Up to three scenarios
per page can be pinned in the browser (`localStorage`, knobs only — pins re-run against live data
on every visit and are never part of a link).
```

- [x] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): Sandboxes — the whatif URL grammar and the no-write rule"
```

---

### Task 5: Retire-at-end list (proposed, not performed)

Nothing below is deleted by any sandbox plan, this one included. Each line was CHECKED on
2026-09-04 against the merged tree and now records what is actually true rather than what the
plan expected — only the `ProjectionPage.css` row is a real deletion candidate:

| Candidate | Why it is unused now | Confirm before deleting |
|---|---|---|
| `TaxesPage.tsx`'s alias comment block (≈ old lines 116–127) | ALREADY GONE 2026-09-04 — `grep -n "whatif-lot" src/pages/TaxesPage.tsx` finds nothing. No action | — |
| `PaycheckPage.tsx` `ProfileFormState`-only helpers duplicated by `ApplySeed` | `ApplySeed` is structurally identical | keep both — different modules, no import cycle; note only |
| `WhatIfPanel.tsx`'s "Sale N: choose a security you hold" sentence | ALREADY GONE 2026-09-04 — `grep -rn "choose a security you hold" src` finds nothing. No action | — |
| `src/pages/ProjectionPage.css` lines 20/27/35/62 — `.projection-form`, `.projection-form label`, `.projection-actions`, `.projection-form .projection-derived` | CONFIRMED DEAD 2026-09-04: no `.projection-form` or `.projection-actions` element survives in any TSX; `.projection-derived` survives only inside `ScenarioPanel`, which the file's own line 73 already re-homes under `.sandbox-controls .projection-derived` | `grep -rn "projection-form\|projection-actions" src --include=*.tsx` → nothing |
| `src/components/taxes/taxes.css` `.whatif-actions` | NOT DEAD — `WhatIfPanel.tsx:808` still renders the class and there is no Run-specific sub-rule to remove. No action | — |
| `src/charts/reference.ts` (lane J's minimal copy) | never existed: `git log -- src/charts/reference.ts` has ONE authoring commit, 8fda06b (chart lane C1). No action | — |

Also note for the Data lifecycle spec: `finance.sandbox.<page>` joins `finance.scope` in the localStorage keys that migrate to the preferences endpoint.

---

### Task 6: Report

- [ ] Summarize: suite counts (pytest/vitest), tsc/lint/build status, the conformance walk's three panels, the chart-reconciliation outcome (Δ bar run or deferred; which `reference.ts` won), smoke screenshots + console status per page and theme, the README commit hash, and the retire-at-end table. State plainly that everything is on LOCAL main and nothing was pushed.

---

## Self-review

**Spec coverage:** §15 step 4 — full pytest and vitest, tsc, lint, build → Task 1; the smoke walk opening each sandbox from a `whatif=` link, dragging, pinning, reloading, both themes, console errors failing the run → Task 3; the README "Sandboxes" paragraph naming the URL grammar and the no-write rule → Task 4. The chart-grammar coupling the spec cites (§10's `ChartCard` Δ bar, §11's `referenceLine()`) is reconciled in Task 2 rather than assumed. The overnight rule's retire-at-end list → Task 5. **Placeholders:** none — the README text is given in full, every check has its command and expected output. **Type consistency:** n/a (no code written here beyond the README).
