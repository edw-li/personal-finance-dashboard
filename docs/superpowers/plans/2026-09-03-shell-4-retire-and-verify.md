# Shell 4 — Retire the old controls and verify the shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With every page migrated (Plans 2 and 3), delete the components and CSS the shell replaced, prove nothing still references them, bring the spec and README in line with what shipped, and run the full suites plus a two-theme visual smoke — per `docs/superpowers/specs/2026-09-03-shell-grammar-design.md` §5 success criteria and §16 phase 4.

**Architecture:** Deletions are guarded by grep: a file or rule is removed only after the search for its importers/selectors comes back empty. File deletions are `git rm`; CSS rule deletions are edits. This plan runs LAST in the overnight batch because deletions are the one class of change a human may want to see coming.

**Tech Stack:** git, ripgrep/grep, vitest, tsc, eslint, vite build, pytest; the audit's headless Edge walk (`playwright-core` from the npx cache with the Node-20 version spoof) for the smoke.

**Prerequisites:** Plans 1a, 1b, 1c, 2, 3 merged into `main`; dev stack runnable (backend on 8000 with the token_version migration applied to the dev DB, frontend on 5173).

**Overnight sequencing (2026-09-03 mandate):** Tasks 3–5 (grep sweep, spec/README follow-through, verification + smoke) run right after Plan 3. Tasks 1–2 are deletions and run at the VERY END of the night, after the chart-grammar, sandboxes, calendar and data-lifecycle work — together with the other cleanup (scratch test databases, merged worktrees and branches).

---

### Task 1: Delete the replaced components

**Files:**
- Delete: `src/components/MonthRibbon.tsx`, `src/components/MonthRibbon.test.tsx`, `src/components/RangeChips.tsx` (+ `RangeChips.test.tsx` if present), `src/pages/PlaceholderPage.tsx` (+ test if present)

- [x] **Step 1: Prove they are unreferenced**

```bash
grep -rn "components/MonthRibbon'\|from './MonthRibbon'\|components/RangeChips'\|from './RangeChips'\|PlaceholderPage" src --include=*.ts --include=*.tsx | grep -v "^src/components/MonthRibbon\|^src/components/RangeChips\|^src/pages/PlaceholderPage"
```

Expected: no output. (The shell's ribbon is `src/components/shell/MonthRibbon.tsx` — the path filter above excludes only the OLD files; a hit on `shell/MonthRibbon` is fine and must NOT be deleted.) If anything still imports an old file, stop and migrate that importer first (it is a Plan 3 miss).

- [x] **Step 2: Delete**

```bash
git rm src/components/MonthRibbon.tsx src/components/MonthRibbon.test.tsx src/components/RangeChips.tsx src/pages/PlaceholderPage.tsx
# plus RangeChips.test.tsx / PlaceholderPage.test.tsx if they exist
```

- [x] **Step 3: Check** `npx tsc -b && npx vitest run src/components` → green.

- [x] **Step 4: Commit** `git commit -m "chore(shell): retire the old MonthRibbon, RangeChips and PlaceholderPage"`

---

### Task 2: Delete the replaced CSS

**Files:**
- Modify: `src/components/panels.css`, `src/pages/NetWorthPage.css`, `src/pages/PaycheckPage.css`, `src/pages/PortfolioPage.css`, `src/pages/CreditCardsPage.css`, `src/pages/SpendingPage.css` (whichever still carry the rules below)

- [x] **Step 1: For each selector, grep for users before deleting**

| Selector(s) | Grep | Delete when |
|---|---|---|
| `.page-header`, `.page-header h1`, `.page-header .spacer` (panels.css) | `grep -rn 'page-header\|className="spacer"' src --include=*.tsx` | no hits outside `shell/` (PageFrame uses `.page-frame-*`) |
| `.month-ribbon`, `.month-chip*` old ribbon rules (panels.css) | `grep -rn 'month-ribbon\|month-chip' src --include=*.tsx` | the only hits are in `shell/MonthRibbon.tsx`, and those classes are styled in `shell.css` — if `shell/MonthRibbon.tsx` reuses the `.month-ribbon`/`.month-chip` names from panels.css, MOVE the rules into `shell.css` instead of deleting |
| `.segmented`, `.segmented button*` (panels.css) | `grep -rn 'className="segmented\|className={`segmented' src --include=*.tsx` | no hits outside `shell/Segmented.tsx`; same move-not-delete rule if the shell component reuses the class names |
| `.range-chips*` | `grep -rn 'range-chips' src` | no hits |
| `.networth-owner-row*`, `.paycheck-person-row*`, `.portfolio-owner-row*`, the Credit-cards owner row class | `grep -rn '<name>' src --include=*.tsx` | no hits |
| `.header-actions` (Portfolio) | `grep -rn 'header-actions' src --include=*.tsx` | no hits |
| `.loading-fallback` (Calendar) | `grep -rn 'loading-fallback' src` | no hits |

- [x] **Step 2: Delete the dead rules**; leave anything still referenced.

- [x] **Step 3: Check** `npx vitest run && npx tsc -b && npm run build` → green; the build's CSS size should drop a little.

- [x] **Step 4: Commit** — only the pre-shell `.month-ribbon`/`.month-chip` rules turned out to be
  dead, so what shipped is `105d380 chore(shell): remove the pre-shell month-ribbon CSS from
  panels.css`. The `.page-header`/`.spacer` and `.segmented*` rules were KEPT (live users, see
  the note below); `.range-chips*`, the per-page owner-row classes and `.header-actions` had no
  rule left to remove.

---


> **Deletion pass 2026-09-03 (branch `retire-pass`).** Every grep re-run on the merged tree
> before deleting. Task 1: all four files deleted (no importer; `shell/MonthRibbon.tsx` is a
> different file and stays). Task 2: only the old `.month-ribbon`/`.month-chip` rules were
> dead. KEPT, because a grep found a live user — `.page-header` / `h1` / `.spacer`
> (`creditcards/CardDetail.tsx:258,266`, mounted by `CreditCardsPage.tsx:350`); `.segmented*`
> (seven non-shell call sites render the bare class, and `shell/Segmented.tsx:3` documents the
> panels-then-shell layering on purpose); `.loading-fallback` (`PageSkeleton.tsx:18,59`).
> `.range-chips*`, the per-page owner-row classes and `.header-actions` had no rule left in any
> stylesheet. Tasks 3-5 remain UNDONE.

### Task 3: Success-criteria sweep (spec §5)

- [x] Run and expect NO output from each:

```bash
grep -rn 'className="page-header"\|className="header-actions"' src/pages
grep -rn "from '../components/PageSkeleton'" src/pages
grep -rn 'className="error-banner"' src --include=*.tsx | grep -v 'src/components/shell/'
grep -rn '>Loading…<\|Loading…</p>' src/pages
grep -rn 'SkeletonCard' src/pages
```

- [x] `src/components/PageSkeleton.tsx`: if `SkeletonCard` is now used only by `shell/Feed.tsx` and `PageSkeleton` only by `shell/PageFrame.tsx`, leave the module where it is (two importers, both shell) — do not move files in this plan. If it exports anything with zero importers (e.g. a `SkeletonTiles` variant), remove that export and its test case.

- [x] Commit any trims: NONE TO MAKE — the module has exactly two exports and the
  leave-it-alone branch is the one that holds. `PageSkeleton` (default) has one importer,
  `shell/PageFrame.tsx:3`; `SkeletonCard` has one, `shell/Feed.tsx:2`. There is no
  `SkeletonTiles` or any other zero-importer export to trim, so no commit was made.

> **Sweep 2026-09-03 (main @a0ed859).** All five greps returned nothing. Note that four of
> them can only pass now because the classes are gone from the MARKUP — `.page-header` and
> `.loading-fallback` still have live rules in `panels.css` (Task 2's note says who uses
> them), which is why this sweep greps `.tsx` and Task 2 grepped `.css`.

---

### Task 4: Spec and README follow-through

**Files:**
- Modify: `docs/superpowers/specs/2026-09-03-shell-grammar-design.md` §11 (light token values and acceptance), §5 (the `scope` prop became `scopeRow`), §6 (`owner: { joint, all }`)
- Modify: `README.md` frontend section

- [x] **Step 1: Spec §11** — replace the "starting light values" hexes with the shipped ones from `src/theme/tokens.ts` (read the file; do not type from memory), state that acceptance is ≥ 4.5:1 on BOTH `--bg` and `--surface` for text/muted/positive/negative/warn/accent, ≥ 3:1 for the eight slots and `--other-series`, and that `--warn` equals `--chart-4` in both themes; mention `--on-accent`. **§5** — note that PageFrame takes `scopeRow?: ReactNode` and pages compose `<ScopeBar …/>` into it (the `scope` declaration object in the original API was folded into ScopeBar's props). **§6** — add `owner: { joint: false, all: false }` (Paycheck) and the legacy `month=YYYY-MM-DD` acceptance.

- [x] **Step 2: README** — in the frontend section, add a short "Shell primitives" paragraph: `PageFrame` (title row, actions, subheader, sticky scope row, five states), `ScopeBar` + `useScope` (URL grammar `owner=all|<id>|joint`, `range=all|1y|ytd`, `month=YYYY-MM`, remembered owner/range in `finance.scope`), `MonthRibbon` 2.0 (two-tone coverage, `GET /coverage`), `Segmented` (toggle/tabs/steps/chips), `Feed`/`FeedBanner`, `ThemeProvider` (`finance.theme`, `finance.density`; charts re-theme via versioned ECharts themes + option recolor), the command palette registry, session renewal (`POST /auth/renew`, `token_version`), and the `ShellErrorBoundary`. Keep it to one screen; link the spec.

- [x] **Step 3: Commit** — done as `a42d5c8`. Re-verified against the merged tree on
  2026-09-03: every §11 hex matches `src/theme/tokens.ts` value-for-value (the 14 named
  tokens and chart slots 1–8 of `LIGHT`, plus dark's raised `--other-series` `#6b7382`);
  the acceptance paragraph matches what `tokens.test.ts` actually asserts (4.5:1 on BOTH
  `--bg` and `--surface` for text/muted/positive/negative/warn/accent, 3:1 for the eight
  slots and `--other-series`, 4.5:1 for `--on-accent` on `--accent`, and `warn === palette[3]`
  in both palettes); §5 carries the `scopeRow?: ReactNode` "As shipped" note and §6 both the
  Paycheck `{ joint: false, all: false }` line and the legacy `YYYY-MM-DD` rewrite. The
  README's "Shell primitives" section covers all nine primitives this step asked for and its
  claims check out in code (`finance.scope` in `prefs/prefsStore.ts:37`, `RENEW_WITHIN_MS`
  = six hours in `shell/session.ts:5`, four `Segmented` variants, `GET /coverage`). No drift
  to fix.

---

### Task 5: Full verification

- [ ] **Frontend:** `npx tsc -b && npx eslint . && npx vitest run && npm run build` — all green (a lone `waitFor` timeout under load is a known flake: re-run that file alone once).
- [ ] **Backend:** from `backend/`, `.venv/Scripts/python.exe -m pytest -q` with `FINANCE_TEST_DB=finance_test_shell4` — all green; `alembic heads` shows exactly one head (`b8e4d17c2a90`).
- [ ] **Dev DB:** `alembic upgrade head` against the dev database (adds `users.token_version`); log in once to confirm the new `ver` claim is issued and `POST /auth/renew` returns 200.
- [ ] **Smoke, both themes:** with backend + frontend running, run the headless walk over all routes — `/`, `/?owner=2`, `/net-worth`, `/net-worth?month=<an entered month>&range=ytd`, `/spending`, `/spending?month=<month>`, `/portfolio?owner=joint`, `/credit-cards`, `/paycheck?owner=2`, `/update`, `/comp`, `/espp`, `/taxes`, `/projection`, `/calendar`, `/settings#appearance`, `/nope` — first with `localStorage.finance.theme='dark'`, then `'light'`, then once with `finance.density='compact'`. For each: no console errors, a `.page-frame-header h1`, the sticky row present where the spec says (`.page-frame-scope` on Net worth, Spending, Portfolio, Credit cards, Monthly update, Overview), `is-stuck` after `window.scrollTo(0, 1200)` on Net worth, ECharts canvases painted (non-blank pixels) under both themes, palette (Ctrl+K) opens and finds "Appearance", and the sidebar footer shows the build hash and health. Save screenshots to the session scratchpad under `shell-smoke/<theme>/<route>.png`.
- [ ] **Record** the results (counts, any flake, any visual nit) in the memory note for the batch.

---

## Self-review

**Spec coverage:** §16 phase 4 (remove PlaceholderPage, old palette list — already replaced by 1c's registry, so only verify no dead file remains — unused PageSkeleton variants, control CSS; full suites; two-theme smoke; README) → Tasks 1–5; §5 success criteria grep → Task 3. **Placeholders:** none — every deletion has its grep and its condition. **Type consistency:** n/a (no new code).
