# Polish batch (items 4, 5, 11, 12, 13) — Implementation Plan: overview and shared contracts

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement the lane plans task by task. Steps in the lane plans use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** implement the design record
`docs/superpowers/specs/2026-09-25-polish-alignment-feedback-undo-design.md`. It covers:
- side-by-side layouts that end together (4);
- aligned tile rows (5);
- feedback where the user acted (11);
- exact undo and one save/delete grammar (12);
- a sidebar that fits (13).

**Architecture:** nine lanes in three waves, each in its own git worktree on its own branch, merged `--no-ff` to LOCAL
main after review.
- **Wave 1** builds everything that doesn't depend on another lane: layout, tiles, backend change-log coverage (two
  lanes) and the frontend feedback building blocks.
- **Wave 2** applies the grammar page by page on top of wave 1.
- **Wave 3** verifies in a real browser on a fresh production copy.

Every lane writes its own complete plan (this file's siblings) before coding, following superpowers:writing-plans.

**Tech stack:**
- Frontend: React 19 + TypeScript 5.9, Vite 6, Vitest 3 + Testing Library (jsdom), ECharts 6.1.
- Backend: FastAPI + SQLAlchemy 2 (async) + asyncpg, Postgres 16, pytest (+ xdist).
- Browser checks: headless Edge via playwright-core.

---

## Lanes

| Wave | Lane | Branch / worktree | Plan file | Spec |
|---|---|---|---|---|
| 1 | L1 Layout + sidebar | `feat/polish-layout` · `.worktrees/polish-layout` | `2026-09-25-polish-L1-layout.md` | §2, §3 (not §3.3), §5.5's chart "Table" line |
| 1 | L2 Tiles | `feat/polish-tiles` · `.worktrees/polish-tiles` | `2026-09-25-polish-L2-tiles.md` | §4 |
| 1 | L3a Backend A | `feat/polish-undo-a` · `.worktrees/polish-undo-a` | `2026-09-25-polish-L3a-backend.md` | §6.1: portfolio.py, calendar.py, the spending.py / net_worth.py completions |
| 1 | L3b Backend B | `feat/polish-undo-b` · `.worktrees/polish-undo-b` | `2026-09-25-polish-L3b-backend.md` | §6.1: credit_cards.py, espp.py, paycheck.py, comp.py |
| 1 | L4 Feedback primitives + API clients | `feat/polish-feedback` · `.worktrees/polish-feedback` | `2026-09-25-polish-L4-feedback.md` | §5.1, §6.2, §6.3 |
| 2 | L5 Settings | `feat/polish-settings` | `2026-09-25-polish-L5-settings.md` | §3.3 + §5 + §6.4 for `src/components/settings/*`, SettingsPage |
| 2 | L6 Portfolio · ESPP · Comp · Paycheck | `feat/polish-money-a` | `2026-09-25-polish-L6-money-a.md` | §5 + §6.4 for those pages |
| 2 | L7 Cards · Calendar · Budgets · Projection · Assistant | `feat/polish-money-b` | `2026-09-25-polish-L7-money-b.md` | §5 + §6.4 for those pages |
| 2 | L8 Taxes · Monthly update | `feat/polish-taxes-monthly` | `2026-09-25-polish-L8-taxes-monthly.md` | §5 + §6.4 for those pages |
| 1½ | L3c Undo engine follow-up (review findings of L3a/L3b) | `feat/polish-undo-engine` | `2026-09-25-polish-L3c-undo-engine.md` | §6.1 (`superseded` semantics, parent locks, batched re-inserts) |
| 3 | V Verification | `feat/polish-verify` | `2026-09-25-polish-V-verify.md` | §9 |

Wave 2 branches are cut from main AFTER every wave-1 frontend lane (L1, L2, L4) has merged; the backend lanes L3a/L3b are already
merged, and L3c merges when ready. Lane V is cut after wave 2 has merged. (L7 as first planned was split in two on 2026-09-25:
taxes and the Monthly update became L8.)

**Wave-2 stacks:**
- **Read-only:** each lane runs its own vite from its worktree (private cacheDir) against the shared read-only backend
  `http://127.0.0.1:8077`, restarted from merged main.
- **Write paths** (delete → Undo, saves), with ports:

| Lane | Backend port | Database | Vite port |
|---|---|---|---|
| L5 | 8085 | `finance_polish_w5` | 5275 |
| L6 | 8086 | `finance_polish_w6` | 5276 |
| L7 | 8087 | `finance_polish_w7` | 5277 |
| L8 | 8088 | `finance_polish_w8` | 5278 |

  Each writable backend runs merged main's code on its own copy of the production data. Use the harness with
  `{ writes: true }` only against your own backend.

**File ownership.** A lane edits only files its plan lists.
- **Wave-1 overlaps are in disjoint regions:**
  - `OverviewPage.tsx`: L1's primary band and Customize spans vs L2's tile deltas.
  - `SpendingPage.tsx`: L1's Trends region vs L2's KPI row.
  - `panels.css`: L1's card-grid / chart-card rules vs L2's `.kpi-row` / `.stat-*` section.
  - `test_changelog_pin.py`: L3a vs L3b, merged by union.
  - `src/api/*.ts` belongs to L4 only.
  - `App.tsx` belongs to L4 (it mounts `ConfirmProvider`).
  - `Layout.tsx` belongs to L1.
- **Wave-2 lanes own whole components.** Their plans list them.

---

## Shared contracts (every lane codes against these exact names)

### C1 — Backend: every logged write names its batch

- A route that records into a `ChangeBatch` returns the header `X-Change-Batch: <uuid>` when the batch recorded ≥ 1 row, and
  no header when it recorded nothing:
  - 204: `Response(status_code=204, headers=batch_header(batch.id if batch.rows else None))`;
  - 200/201: `response.headers.update(batch_header(await batch.commit()))`, or the equivalent after committing.
- Labels are human sentences in the Activity card's voice ("Deleted security VOO", "Edited 3 reward multipliers").
- Deletes record children first and the parent last, and delete/null them EXPLICITLY through the ORM, so every row that
  changes is imaged. `undo_batch` replays in reverse, so the parent comes back first.
- L3a/L3b also make these already-logged routes return the header: `create_account`, `update_account`, `create_category`,
  `update_category`, `put_category_budget`.
- **Exempt** (never logged, no header): `calendar.feed_ics`, `calendar.revoke_feed_token`.

### C2 — Frontend API clients (L4 writes these; wave 2 calls them)

In `src/api/client.ts`:
```ts
/** A logged write's answer: its body and the change batch it recorded (null when nothing changed). */
export interface Logged<T> {
  data: T
  batchId: string | null
}
/** apiWithHeaders + the X-Change-Batch header, lower-cased read. */
export async function apiLogged<T>(path: string, options: RequestInit = {}): Promise<Logged<T>>
```

**Delete clients** of logged routes change their return type to `Promise<{ batchId: string | null }>`. Awaiting callers that
ignore the value keep compiling:
- `portfolio.ts`: `deleteSecurity`, `deleteTransaction`, `deleteDividend`;
- `creditCards.ts`: `deleteCreditCard`, `deleteCardCredit`, `deleteLimitEvent`, `deleteRewardCategory`;
- `espp.ts`: `deleteLot`, `deleteOffering`, `deletePeriod`;
- `paycheck.ts`: `deleteProfile`;
- `comp.ts`: `deleteEvent`, `deleteRsuGrant`;
- `calendar.ts`: `deleteCustomEvent`;
- `netWorth.ts`: `deleteAccount`;
- `spending.ts`: `deleteCategory`, `deleteCategoryBudget`.

`revokeFeedToken` stays `Promise<void>`: exempt.

**New `…Logged` siblings** for the one-click toggles and the two tax applies. The originals are unchanged, for form saves.
Each returns `Promise<Logged<Out>>` with the same arguments as its original:
- `updateCategoryLogged` (spending.ts)
- `updateAccountLogged` (netWorth.ts)
- `updateCreditCardLogged` (creditCards.ts)
- `updateRewardCategoryLogged` (creditCards.ts)
- `putCalendarOverrideLogged` (calendar.ts)
- `putTaxInputsLogged` (taxes.ts)

`undoBatch(batchId)` in `lifecycle.ts` is unchanged.

### C3 — Feedback building blocks (L4 writes these in `src/components/feedback/`; wave 2 uses them)

```ts
// confirm.tsx — mounted once in App.tsx inside <ToastProvider>
export interface ConfirmOptions {
  anchor: HTMLElement                  // the control that asked; the popover sits beside it, focus returns to it
  title: string                        // "Delete tax year 2025?"
  body?: ReactNode                     // what will be lost / what happens
  confirmLabel: string                 // "Delete 2025"
  cancelLabel?: string                 // default "Cancel"
  tone?: 'danger' | 'default'          // default 'danger'
  typedArm?: { expected: string; prompt: string } // Restore only: confirm stays disabled until the text matches
}
export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element
export function useConfirm(): (options: ConfirmOptions) => Promise<boolean>
```
Behaviour:
- Portaled to `document.body` (`.page` is a containing block for `position: fixed`, so the popover must live outside it).
- `position: fixed` from the anchor's rect: below it, flipping above when there is no room; right-aligned to the anchor.
  Repositions on scroll and resize.
- `role="alertdialog"` with `aria-labelledby` / `aria-describedby`. Initial focus on Cancel; Tab cycles inside the popover.
- Esc or an outside pointerdown resolves `false`. Confirm resolves `true`. Only one popover at a time: a second call
  resolves the first `false`.
- On close, focus returns to the anchor if it is still connected.
- Motion uses the house `.popover-surface` pop-in; none under reduced motion.

```ts
// BusyButton.tsx
export default function BusyButton(props: ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean        // this button's own action is in flight: spinner + aria-busy
  busyLabel?: string    // optional label while busy (the width stays locked to the idle width)
  inert?: boolean       // another action is in flight: aria-disabled, label unchanged
}): JSX.Element
```
- Never sets the native `disabled` attribute. `busy`, `inert` or `aria-disabled` set `aria-disabled="true"`. Clicks and
  submits are ignored while `aria-disabled` (`preventDefault`).
- `min-width` is locked to the idle width (measured when not busy).
- Styling: `.button[aria-disabled="true"]` matches the existing `:disabled` look.

```ts
// useSaveState.ts / SaveStatus.tsx / SaveButton.tsx
export type SaveStatusKind = 'clean' | 'dirty' | 'saving' | 'saved' | 'error'
export interface SaveState {
  status: SaveStatusKind
  error: string | null
  /** Runs the save: 'saving', then 'saved' for 2.5 s (then clean/dirty per `dirty`), or 'error' with the message. */
  run: <T>(save: () => Promise<T>) => Promise<T | undefined>
  clearError: () => void
}
export function useSaveState(options: { dirty: boolean }): SaveState
export function SaveStatus({ state }: { state: SaveState }): JSX.Element | null
// "Unsaved changes" (muted) | "Saved ✓" (positive, role=status) | the error (role=alert); null when clean
export function SaveButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { state: SaveState }): JSX.Element
// BusyButton with busy = status==='saving'; aria-disabled + title "No changes to save" when status==='clean'
```

```ts
// useDeleteWithUndo.ts
export interface DeleteWithUndoOptions {
  name: string                                        // "security VOO" → toast "Deleted security VOO"
  row?: HTMLElement | null                            // takes data-leaving (fade/collapse) while the request runs
  request: () => Promise<{ batchId: string | null }>
  onDeleted?: () => void | Promise<void>              // reload the list; awaited before focus moves and the toast shows
  focusAfter?: () => HTMLElement | null               // e.g. the next row's same control; evaluated after onDeleted
  onRestored?: () => void | Promise<void>             // reload after a successful Undo
  restoredRow?: () => HTMLElement | null              // flashed + revealed + focused after onRestored
}
export function useDeleteWithUndo(): (options: DeleteWithUndoOptions) => Promise<boolean> // true when deleted
```
- **Failure:** `data-leaving` is removed and `toast.error(errorDetail(err))`.
- **Success:** `toast.success('Deleted ' + name, { action: { label: 'Undo', onAction } })`. The action calls
  `undoBatch(batchId)`, then `onRestored`, then `revealRow` + `flashElement` + focus of `restoredRow()`, then
  `toast.success('Restored ' + name)`.
- **Undo failure:** `toast.error(errorDetail(err))`, which carries the server's refusal sentence.
- **Null batch id** (nothing recorded): no Undo action.

```ts
// reveal.ts
export function revealEditor(form: HTMLElement | null, focusSelector?: string): void
export function revealRow(row: HTMLElement | null): void
export function flashElement(el: HTMLElement | null): void      // data-flash for MOTION_MS.flash
export function useEscapeCancel(ref: RefObject<HTMLElement | null>, onCancel: () => void, enabled?: boolean): void
```
- **`revealEditor`:** focus + `select()` the first `input, select, textarea` (or the selector) with `preventScroll`,
  then `scrollIntoView({ block: 'nearest', behavior: reduced ? 'instant' : 'smooth' })`. Integrated Edge verification
  found that focusing a native date input can cancel an already-started smooth scroll, even with `preventScroll`;
  the final order keeps the field below the sticky header (`b2b07a8e`).
- **`revealRow`:** a TableScroll box → `revealInBox`; `.settings-scroll` / `.categories-scroll` / any other scroll parent →
  `ensureVisible` (reorderDom.ts); else `scrollIntoView({ block: 'nearest' })`.

**CSS: `src/components/feedback/feedback.css`.** It holds:
- `.confirm-popover`
- the BusyButton spinner and `.button[aria-disabled="true"]`
- `[data-leaving]`
- `[data-flash]` (the same tint as reorder's saved flash)
- `.save-status` and its variants
- the ONE `.danger-button` rule; wave 2 deletes the copies in MonthlyUpdatePage.css and settings.css

Motion uses tokens only and is zeroed under reduced motion.

### C4 — StatTile (L2)
- Props are unchanged.
- Updated by the user's 2026-09-26 preview feedback: `.stat-tile` renders three children in order: `.stat-header`
  (title on the left, optional badge at the top right), `.stat-value`, `.stat-delta` (empty without a delta).
- The tile and its ghost use `grid-row: span 3; grid-template-rows: subgrid` of their `.kpi-row`. There is no separate
  badge track or empty badge placeholder; shared header/value/delta tracks retain row alignment.

### C5 — ChartCard (L1)
- New optional prop `fill?: boolean`, defaulting to `span === 6`. It grows the plot to the card's height inside a stretched
  grid row.
- The chart's "Table" twin reveals itself when opened.

---

## Box rules (Windows dev box)

**Worktrees:**
- A frontend worktree's `node_modules` is a PowerShell junction to the main checkout's; they already exist for L1, L2 and
  L4. Never delete through it.
- Type-check with `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.node.json --noEmit`, never `tsc -b`: the
  build info is shared through the junction.

**Tests:**
- Frontend: `npx vitest run <files>` while developing. Once at the end, the whole suite with `npx vitest run --maxWorkers=4`
  (memory is shared by several lanes).
- Backend lanes: no venv of their own. From the lane's `backend/` directory run
  `C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m pytest …` with
  `FINANCE_TEST_DB=finance_test_l3a` (or `_l3b`). Use `-n 4` for the full suite.
- The dev Postgres is `127.0.0.1:5433` (never `localhost`: a new connection to it stalls ~2 s on this box).

**Browser checks (L1, L2):**
- A shared read-only backend runs on `http://127.0.0.1:8077`, serving a copy of production's data (main's code). Don't
  stop it.
- Run your own vite FROM YOUR WORKTREE with a private dependency cache, via a wrapper config in the scratchpad:
  `export default { ...(await import('<worktree>/vite.config.ts')).default, cacheDir: '<scratch>/vite-cache-<lane>' }`.
  Run it as `VITE_API_PROXY=http://127.0.0.1:8077 npx vite --config <wrapper> --port <lane port> --strictPort`.
  Ports: L1 5271, L2 5272.
- The harness is `…/73b0666c-8786-4333-8c13-8279a288d0c8/scratchpad/audit-lib.mjs`: headless Edge with a write fence and a
  token. Set `APP_BASE`. Read its header comment.
- Close every browser; stop your vite when done.

**Gates at the end of every lane:**
- `tsc -p` app + node: clean.
- `npx eslint .`: 0 errors, and no more than the baseline 26 warnings.
- The full vitest suite: green.
- Backend lanes: the full `pytest -n 4`, green.
- Record the numbers in the lane plan's closing "As built" section.

**Commits:** one per task, conventional prefix (`feat(...)`, `fix(...)`, `test(...)`, `docs(plan): ...`), a body saying
what and why. No push. No merge: the coordinator merges.

## Coordinator recovery record — 2026-09-26

The interrupted Claude session left local main at `204ef73d`, with wave 1 and the undo-engine follow-up merged.
The four wave-2 branches had their assignments but no product implementation. At the user's request, implementation
resumed with parallel agents, preserving the original scope and local-main-only rollout.

All four implementation lanes have been independently reviewed and merged:

| Lane | Final lane commit | Local main merge |
|---|---|---|
| L5 Settings | `de839ed8` | `660d3f35` |
| L6 Portfolio, ESPP, Comp, Paycheck | `17556eb5` | `23b34ea3` |
| L7 Cards, Calendar, Budgets, Projection, Assistant | `23d929d1` | `1dd441b9` |
| L8 Taxes, Monthly update | `6d1cda1a` | `d075a9c8` |

Integration fixed an ESPP test that clicked Edit before the preceding reload finished (`350b91a8`), the real
native-date reveal issue above, and Monthly update announcing a deletion before retiring its controls (`c30c76bc`).
The Monthly correction also removes the obsolete empty-month repair action while refresh is pending. Four deferred
refresh regressions failed before that correction, then all 190 Monthly tests passed; independent review confirmed
focus and month-scope behavior.

Last wholly green full code gates at product commit `c30c76bcc7c8808f642788e7b5f41c8db8550bd3`:

- App and node `tsc -p --noEmit`: clean.
- ESLint: 0 errors, 26 existing warnings.
- Full Vitest: 324 files / 4,872 tests passed in 271.54 seconds.
- Production build: passed in 17.92 seconds, with the existing chunk-size advisory.
- Backend: 2,845 passed / 4 skipped in 90.14 seconds. Backend tree
  `9dcde78043e5d9dbb13e1ed53de82c1e601919c6` is unchanged by the frontend integration fixes.

Cold browser verification then found What-if initial layout shifts of 0.123 and 0.248. `0b3290c2` stabilizes its first
form/preview and keeps the controls in one full-width row. Four new regressions failed before the fix; all 64 affected
tests passed afterward. Twenty browser cases across all viewport/theme combinations passed 160 checks, maximum CLS
0.023983, and both themes' What-if Apply/dirty-draft Undo flows restored the exact original inputs.

At `0b3290c2`, app/node types, full lint (0 errors / 26 warnings) and build (18.56s) passed. The full frontend run had
4,875 passes and one async assertion race in TransactionsPanel (273.50s): the callback fired before React committed the
editor reset. `01b1aed3` waits for the visible Add button; its complete 73-test suite passed. The full run is retained as
a failed attempt, not relabelled green.

The user's live-preview amendments keep the complete email beside the 28px controls at the existing 210px sidebar
width, give Log out the red token, and place tile badges beside titles. The final footer passed 20 browser combinations
and 43 focused tests. Tiles and their ghosts share three tracks; narrow steady headers accommodate two title lines,
with no reserved badge row. The affected 50 tile/skeleton/CSS tests and app type check passed, as did targeted lint.
An earlier browser preparation passed 410 checks, including all 38 Net worth and 38 Spending months at both 1280 and
1440. Additional 1366/1536 checks caught an info icon wrapping alone and a header breakpoint ending too early.
The final refinement keeps each joining space and info button together and extends the narrow-header rule to 20rem.
All 60 old/current/provisional-month observations across five sizes and both themes then passed, with stable heights,
top-right badges, icons beside their last title word, unchanged source and clean post-close logs. Both fallback hints
also remained visible above the value and kept the header stable when evidence arrived. The final 50 component/CSS
tests, 23 focused page-label compatibility tests, app type check and targeted lint passed; the type check and 23 page
tests preceded only the additional inline wrapper. Independent static review found no remaining blocker.
Per the user's explicit request to avoid heavyweight reruns for these cosmetic changes, validation uses focused
checks plus the continuing full browser matrix; no new full-suite pass is claimed for the amended product.

The completed 500-case matrix on `2f23b8f5` found a late-loading owner group could wrap the Net worth scope row
after its content had painted (CLS 0.166327 at 1280 light). Combined ScopeBars now reserve the same 20rem owner slot
while the household is pending and after it loads. Standalone, cached and known-solo behavior is preserved. All 41
ScopeBar tests and app noEmit passed; targeted lint exited 0 with empty output (no lint log was created). A forced-delay
browser comparison in both themes reproduced the old 42.1875px body movement / CLS 0.166560, then measured zero body
movement / CLS 0.005675 with the fix. All four cases have clean post-close logs and unchanged source during the proof,
recorded in `scratchpad/codex-cosmetic-final/scope-owner-arrival/report.json`.

Screenshot review also identified ESPP's year-bearing limit title extending past its header by 25.19px at 1366 and
10.41px at 1440. A page-scoped wrapping rule keeps the text and info control inside the five-tile row. All ten final
viewport/theme measurements fit with clean logs; root visually reviewed the before/after 1366 light and final 1440
dark captures. Evidence is in `scratchpad/codex-cosmetic-final/espp-title-{bounds,final}/report.json`. The affected
Net worth, Portfolio and ESPP cold-load cases are being rerun; the original matrix remains a retained failed attempt.

Gate logs and interrupted/failed attempts are preserved in ignored `scratchpad/codex-takeover-*` files. Lane V's
fresh-copy browser acceptance and final report remain the last step; its plan records source provenance, measured
before/after results, corrected probe attempts, cleanup and the precise product commit for each run. Nothing has
been pushed or deployed.
