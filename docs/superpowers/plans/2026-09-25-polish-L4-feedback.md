# Lane L4 — Feedback primitives + API clients (2026-09-25) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans. One implementer for this lane in its own worktree, TDD per task, one commit per task;
> the coordinator reviews and merges `--no-ff` to LOCAL main. Steps use `- [ ]` checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-25-polish-alignment-feedback-undo-design.md` — this lane implements §5.1, §6.2,
§6.3 and D2–D5 of §1. **Overview:** `docs/superpowers/plans/2026-09-25-polish-00-overview.md` — this lane writes contracts
**C2** and **C3** EXACTLY as written there; wave 2 (L5–L7) codes against them without reading this code first. Where the
two disagree, the overview's contract wins (spec §5.1's `useRowFlash()`/`flash(key)` is C3's `flashElement(el)`).

**Goal:** the frontend half of "feedback where you act, exact undo, one save/delete grammar": logged API clients that hand
back the change batch a write recorded, and the building blocks every wave-2 surface uses — an in-app confirm, a busy
button that keeps focus and width, a save state with its status line and button, a delete-with-Undo hook, and the reveal /
flash / Escape helpers — plus a test fence that keeps `window.confirm` out of the app.

**Architecture:**
- **C2 clients** (`src/api/*.ts`): one reader, `apiLogged` (client.ts), turns `apiWithHeaders`' answer into
  `{ data, batchId }`; `apiDeleteLogged` is its DELETE shape. Seventeen delete clients return `{ batchId }` through it, and
  six `…Logged` siblings return `Logged<Out>`; the originals of the siblings are untouched.
- **C3 blocks** (`src/components/feedback/`): pure-ish helpers (`reveal.ts`, `confirmPlacement.ts`), three components
  (`BusyButton`, `SaveStatus`, `SaveButton`), a provider (`confirm.tsx`, mounted once in `App.tsx` inside `ToastProvider`),
  two hooks (`useSaveState`, `useDeleteWithUndo`) and ONE stylesheet (`feedback.css`).
- **Fence:** `noNativeConfirm.test.ts` walks the TypeScript AST of every non-test source and compares the native-confirm
  calls against a counted allowlist that may only shrink.

**Tech stack:** React 19 + TypeScript 5.9 strict, Vite 6, Vitest 3 + @testing-library/react 16 (jsdom; **no** jest-dom
matchers and **no** user-event — assert with `getAttribute` / `textContent`, drive with `fireEvent`), the `typescript`
compiler API for the fence.

---

## Mechanics (read once)

- **Worktree:** `C:/Users/edyli/personal-finance-dashboard/.worktrees/polish-feedback`, branch `feat/polish-feedback`, cut
  from main @ `657e3d62`. Work ONLY inside it. `node_modules` is a PowerShell junction to the main checkout's — never
  delete through it.
- **Tests while developing:** `npx vitest run <files>` from the worktree root. Once at the end:
  `npx vitest run --maxWorkers=4` (memory is shared with other lanes).
- **Types:** `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.node.json --noEmit` — never `tsc -b` (the
  build info is shared through the junction). `tsconfig.app.json` includes test files, so a mock typed against a changed
  client is a type error too.
- **Lint:** `npx eslint .` — 0 errors and at most the baseline **26** warnings (measured at `657e3d62`: all
  `react-refresh/only-export-components`). `eslint-plugin-react-hooks` v7 runs the React Compiler rules (`react-hooks/refs`,
  `react-hooks/set-state-in-effect`, `react-hooks/immutability`, …) as errors: no `ref.current` read during render, no
  `setState` in an effect body, no mutation of props. The one sanctioned directive in this lane is on `useConfirm` (C3 puts
  a component and its hook in one module, ToastProvider's shape).
- **Scope fence:** create `src/components/feedback/**`, `src/api/loggedClients.test.ts`; edit `src/api/*.ts`,
  `src/api/client.test.ts`, `src/App.tsx`, `src/App.test.tsx`, and — type-only, forced by C2 — the fifteen
  `mockResolvedValue(undefined)` lines of Task 3 Step 6. Convert NO page or component to the new grammar (wave 2 does).
- **Box facts used below** (verified before writing this plan):
  - headless Edge 153: a transition from `block-size: auto` to `0` interpolates when `interpolate-size: allow-keywords`
    sits only in the after-change rule (40 → 24.2 → 0 px over the transition);
  - the busy hold: `.button` with a spinner, `min-width` = `max-width` = the idle width and `justify-content: center`
    holds the idle width to the pixel (59.31 px) with the spill split 6.36 / 6.36 px inside 14.4 px paddings;
  - jsdom here has no `scrollIntoView`, no `ResizeObserver`, no `matchMedia`; it does parse `scroll-margin-top`.
- **Commits:** one per task, conventional prefix, a body saying what and why. No push, no merge.

## Contracts this lane publishes (C2 / C3 — names and signatures exactly as the overview)

```ts
// src/api/client.ts
export interface Logged<T> { data: T; batchId: string | null }
export async function apiLogged<T>(path: string, options?: RequestInit): Promise<Logged<T>>
export async function apiDeleteLogged(path: string): Promise<{ batchId: string | null }>   // helper, additive

// delete clients → Promise<{ batchId: string | null }>
//   portfolio.ts deleteSecurity/deleteTransaction/deleteDividend · creditCards.ts deleteCreditCard/deleteCardCredit/
//   deleteLimitEvent/deleteRewardCategory · espp.ts deleteLot/deleteOffering/deletePeriod · paycheck.ts deleteProfile ·
//   comp.ts deleteEvent/deleteRsuGrant · calendar.ts deleteCustomEvent · netWorth.ts deleteAccount ·
//   spending.ts deleteCategory/deleteCategoryBudget
// siblings → Promise<Logged<Out>>, same arguments as their originals
//   updateCategoryLogged · updateAccountLogged · updateCreditCardLogged · updateRewardCategoryLogged ·
//   putCalendarOverrideLogged · putTaxInputsLogged

// src/components/feedback/confirm.tsx
export interface ConfirmOptions { anchor; title; body?; confirmLabel; cancelLabel?; tone?; typedArm? }
export function ConfirmProvider({ children }: { children: ReactNode })
export function useConfirm(): (options: ConfirmOptions) => Promise<boolean>
// src/components/feedback/BusyButton.tsx
export default function BusyButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { busy?; busyLabel?; inert?; ref? })
// src/components/feedback/useSaveState.ts · SaveStatus.tsx · SaveButton.tsx
export type SaveStatusKind = 'clean' | 'dirty' | 'saving' | 'saved' | 'error'
export interface SaveState { status; error; run; clearError }
export function useSaveState(options: { dirty: boolean }): SaveState
export function SaveStatus({ state }: { state: SaveState })
export function SaveButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { state: SaveState; ref? })
// src/components/feedback/useDeleteWithUndo.ts
export interface DeleteWithUndoOptions { name; row?; request; onDeleted?; focusAfter?; onRestored?; restoredRow? }
export function useDeleteWithUndo(): (options: DeleteWithUndoOptions) => Promise<boolean>
// src/components/feedback/reveal.ts
export function revealEditor(form: HTMLElement | null, focusSelector?: string): void
export function revealRow(row: HTMLElement | null): void
export function flashElement(el: HTMLElement | null): void
export function useEscapeCancel(ref: RefObject<HTMLElement | null>, onCancel: () => void, enabled?: boolean): void
```

**Refinements this plan makes (additive; each is recorded again in "As built"):**
1. `apiDeleteLogged(path)` — the one DELETE shape the seventeen clients share.
2. `BusyButton` also takes a `ref` (React 19 ref-as-prop) and honours a `disabled` prop as `aria-disabled` (never the
   native attribute). While busy it keeps its own face (`cursor: progress`, full opacity): busy is "working", not
   "unavailable" — only the quiet siblings wear the `:disabled` look.
3. `useSaveState`: `'saved'` shows only while the form is not dirty — an edit inside the 2.5 s window reads "Unsaved
   changes" at once; `run` is single-flight (a second call while saving returns `undefined` without saving); an
   `AbortError` from the save is not an error.
4. `SaveButton` is quiet ("No changes to save") for `'saved'` as well as `'clean'` — nothing differs from what is stored
   in either (spec D3).
5. `useDeleteWithUndo`: `restoredRow()` is focused itself when it takes focus, else the control at the same place in it
   as the one that asked for the delete (else its first control); a second press on a row already leaving is ignored
   (`false`); a rejected `onDeleted` / `onRestored` does not undo the toast (the caller's load shows its own failure).
6. `useConfirm()` outside a `ConfirmProvider` renders fine and throws only when asked.

---

## File map

| File | Responsibility |
|---|---|
| `src/api/client.ts` (modify) | `Logged<T>`, `apiLogged`, `apiDeleteLogged` |
| `src/api/client.test.ts` (modify) | their tests |
| `src/api/{portfolio,creditCards,espp,paycheck,comp,calendar,netWorth,spending,taxes}.ts` (modify) | the 17 deletes, the 6 siblings |
| `src/api/loggedClients.test.ts` (create) | every changed client through the real transport, fetch stubbed |
| 9 test files, 15 lines (modify, type-only) | `mockResolvedValue(undefined)` → `mockResolvedValue({ batchId: null })` |
| `src/components/feedback/feedback.css` (create) | danger button, quiet/busy button, spinner, confirm popover, `[data-leaving]`, `[data-flash]`, save status |
| `src/components/feedback/feedbackCss.test.ts` (create) | text pins on the sheet (and against panels.css / reorder.css / the z-stack) |
| `src/components/feedback/reveal.ts` (create) | `revealEditor`, `revealRow`, `flashElement`, `useEscapeCancel` |
| `src/components/feedback/reveal.test.tsx` (create) | their tests |
| `src/components/feedback/BusyButton.tsx` (create) | the busy/quiet button |
| `src/components/feedback/BusyButton.test.tsx` (create) | its tests |
| `src/components/feedback/useSaveState.ts` (create) | the save state machine |
| `src/components/feedback/SaveStatus.tsx` (create) | the status line |
| `src/components/feedback/SaveButton.tsx` (create) | the Save |
| `src/components/feedback/save.test.tsx` (create) | the three together |
| `src/components/feedback/confirmPlacement.ts` (create) | the popover's placement, pure |
| `src/components/feedback/confirmPlacement.test.ts` (create) | its tests |
| `src/components/feedback/confirm.tsx` (create) | `ConfirmProvider`, `useConfirm`, `ConfirmOptions` |
| `src/components/feedback/confirm.test.tsx` (create) | its tests |
| `src/App.tsx`, `src/App.test.tsx` (modify) | mount `ConfirmProvider` inside `ToastProvider`; prove it |
| `src/components/feedback/useDeleteWithUndo.ts` (create) | the delete grammar |
| `src/components/feedback/useDeleteWithUndo.test.tsx` (create) | its tests |
| `src/components/feedback/noNativeConfirm.test.ts` (create) | the `window.confirm` fence |

---

### Task 1: This plan

- [ ] **Step 1:** Save this file and commit it before any code.

```bash
git add docs/superpowers/plans/2026-09-25-polish-L4-feedback.md
git commit -m "docs(plan): polish L4 — feedback primitives + logged API clients (C2, C3)" -m "The lane plan: apiLogged and the batch-returning delete clients, the six …Logged siblings, feedback.css, reveal/flash/escape helpers, BusyButton, useSaveState + SaveStatus + SaveButton, the confirm popover, useDeleteWithUndo and the native-confirm fence, each TDD with complete code."
```

---

### Task 2: `apiLogged` — a logged write and the batch it recorded

**Files:** Modify `src/api/client.ts` (after `apiWithHeaders`), `src/api/client.test.ts`.

- [ ] **Step 1: Write the failing tests.** In `src/api/client.test.ts`, add `apiDeleteLogged` and `apiLogged` to the
  import from `./client` (alphabetical: `api, ApiError, apiDeleteLogged, apiLogged, apiReadOnly, apiWithHeaders, …`) and
  append:

```ts
describe('apiLogged — a logged write and the batch it recorded (2026-09-25 contract C2)', () => {
  beforeEach(() => clearSnapshots())

  /** fetch answers `status` with `body` and these response headers — a real Response, as a browser
   *  hands one back. */
  const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(status === 204 ? null : JSON.stringify(body), { status, headers }),
      ),
    )

  it('hands back the body and the batch the X-Change-Batch header names', async () => {
    respond(200, { id: 4, kind: 'transfer' }, { 'X-Change-Batch': 'b-1' })
    expect(await apiLogged('/spending/categories/4', { method: 'PATCH', body: '{}' })).toEqual({
      data: { id: 4, kind: 'transfer' },
      batchId: 'b-1',
    })
  })

  it('reads the header in any case, and answers null when it is absent or blank', async () => {
    respond(200, {}, { 'x-change-batch': 'b-2' })
    expect((await apiLogged('/spending/categories/4', { method: 'PATCH' })).batchId).toBe('b-2')
    respond(200, {})
    expect((await apiLogged('/spending/categories/4', { method: 'PATCH' })).batchId).toBeNull()
    respond(200, {}, { 'X-Change-Batch': ' ' })
    expect((await apiLogged('/spending/categories/4', { method: 'PATCH' })).batchId).toBeNull()
  })

  it('tolerates an old fetch stub with no headers at all: no batch, so no Undo', async () => {
    mockFetchOk({ ok: true })
    expect(await apiLogged('/things', { method: 'PUT' })).toEqual({ data: { ok: true }, batchId: null })
  })

  it("invalidates like api(): the families a mutation's path can have moved go, on a failure too", async () => {
    setSnapshot('portfolio:all', 1)
    setSnapshot('taxes:years', 1)
    respond(204, null, { 'X-Change-Batch': 'b-3' })
    await apiLogged('/portfolio/securities/3', { method: 'DELETE' })
    expect(getSnapshot('portfolio:all')).toBeUndefined()
    expect(getSnapshot('taxes:years')).toBe(1)
    setSnapshot('portfolio:all', 1)
    mockFetchFailure(500, { detail: 'boom' })
    await expect(apiLogged('/portfolio/securities/3', { method: 'DELETE' })).rejects.toBeInstanceOf(ApiError)
    expect(getSnapshot('portfolio:all')).toBeUndefined()
  })

  it('apiDeleteLogged DELETEs the path and answers the batch alone — a 204 has no body', async () => {
    respond(204, null, { 'X-Change-Batch': 'b-4' })
    expect(await apiDeleteLogged('/comp/events/3')).toEqual({ batchId: 'b-4' })
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/comp/events/3')
    expect(init.method).toBe('DELETE')
  })
})
```

- [ ] **Step 2: Run — FAIL.** `npx vitest run src/api/client.test.ts` → the new block fails (`apiLogged is not a
  function` / not exported).

- [ ] **Step 3: Implement.** In `src/api/client.ts`, directly after `apiWithHeaders`:

```ts
// The change batch a logged write recorded (2026-09-25 polish spec §6.1–6.2, contracts C1/C2): the
// backend names it in this header and leaves the header off when the write recorded nothing. Read
// lower-case — Headers are case-insensitive, and the house has always read it this way.
const CHANGE_BATCH_HEADER = 'x-change-batch'

/** A logged write's answer: its body and the change batch it recorded (null when nothing changed). */
export interface Logged<T> {
  data: T
  batchId: string | null
}

/** apiWithHeaders + the X-Change-Batch header, lower-cased read (contract C2) — the one reader every
 *  logged client goes through, so an absent or blank header can only ever mean "nothing to undo".
 *  Same invalidation as api(): any non-GET drops the families its path can have moved. */
export async function apiLogged<T>(path: string, options: RequestInit = {}): Promise<Logged<T>> {
  const { data, headers } = await apiWithHeaders<T>(path, options)
  const batch = headers.get(CHANGE_BATCH_HEADER)?.trim() ?? ''
  return { data, batchId: batch === '' ? null : batch }
}

/** A logged DELETE (contract C2). A 204 has no body, so the answer is the batch alone — the id the
 *  row's Undo toast hands to POST /activity/batches/{id}/undo, null when nothing was recorded. */
export async function apiDeleteLogged(path: string): Promise<{ batchId: string | null }> {
  const { batchId } = await apiLogged<void>(path, { method: 'DELETE' })
  return { batchId }
}
```

- [ ] **Step 4: Run — PASS.** `npx vitest run src/api/client.test.ts` → all pass (the old tests plus 5).
- [ ] **Step 5: Commit.**

```bash
git add src/api/client.ts src/api/client.test.ts
git commit -m "feat(api): apiLogged + apiDeleteLogged — a logged write answers with the change batch it recorded" -m "Contract C2: one reader turns apiWithHeaders' answer into { data, batchId }, reading X-Change-Batch lower-case and treating an absent or blank header as null (no Undo). Same invalidation as api(), success or failure."
```

---

### Task 3: The seventeen delete clients and the six `…Logged` siblings

**Files:** Modify the nine client modules; Create `src/api/loggedClients.test.ts`; type-only edits in nine test files.

- [ ] **Step 1: Write the failing test** — `src/api/loggedClients.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteCustomEvent, putCalendarOverride, putCalendarOverrideLogged } from './calendar'
import { deleteEvent, deleteRsuGrant } from './comp'
import {
  deleteCardCredit,
  deleteCreditCard,
  deleteLimitEvent,
  deleteRewardCategory,
  updateCreditCard,
  updateCreditCardLogged,
  updateRewardCategory,
  updateRewardCategoryLogged,
} from './creditCards'
import { deleteLot, deleteOffering, deletePeriod } from './espp'
import { deleteAccount, updateAccount, updateAccountLogged } from './netWorth'
import { deleteProfile } from './paycheck'
import { deleteDividend, deleteSecurity, deleteTransaction } from './portfolio'
import { deleteCategory, deleteCategoryBudget, updateCategory, updateCategoryLogged } from './spending'
import { putTaxInputs, putTaxInputsLogged } from './taxes'
import type { CreditCardIn } from '../types/api'

// The logged clients (2026-09-25 polish spec §6.2, contract C2) through the REAL transport: only fetch
// is stubbed (client.test.ts's posture), so each case pins the request its client builds AND the
// change batch read back off the response — the id a wave-2 Undo toast hands to
// POST /activity/batches/{id}/undo. The two tables ARE the contract's lists: a client that joins C2
// joins its table.

const fetchMock = vi.fn()

/** Every call answers `status` with `body`, naming `batch` in X-Change-Batch when one is given. A
 *  fresh Response per call: a body can be read only once. */
function answer(status: number, body: unknown, batch?: string): void {
  fetchMock.mockImplementation(
    async () =>
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: batch === undefined ? {} : { 'X-Change-Batch': batch },
      }),
  )
}

/** The first request the stub saw: its URL, verb and parsed body. */
function sent(): { url: string; method: string | undefined; body: unknown } {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return {
    url,
    method: init.method,
    body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
  }
}

beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

const DELETES: [string, () => Promise<{ batchId: string | null }>, string][] = [
  ['deleteSecurity', () => deleteSecurity(3), '/portfolio/securities/3'],
  ['deleteTransaction', () => deleteTransaction(4), '/portfolio/transactions/4'],
  ['deleteDividend', () => deleteDividend(5), '/portfolio/dividends/5'],
  ['deleteCreditCard', () => deleteCreditCard(6), '/credit-cards/6'],
  ['deleteCardCredit', () => deleteCardCredit(7), '/credit-cards/credits/7'],
  ['deleteLimitEvent', () => deleteLimitEvent(6, 8), '/credit-cards/6/limits/8'],
  ['deleteRewardCategory', () => deleteRewardCategory(9), '/credit-cards/categories/9'],
  ['deleteLot', () => deleteLot(10), '/espp/lots/10'],
  ['deleteOffering', () => deleteOffering(11), '/espp/offerings/11'],
  ['deletePeriod', () => deletePeriod(12), '/espp/periods/12'],
  ['deleteProfile', () => deleteProfile(13), '/paycheck/profiles/13'],
  ['deleteEvent', () => deleteEvent(14), '/comp/events/14'],
  ['deleteRsuGrant', () => deleteRsuGrant(15), '/comp/rsu-grants/15'],
  ['deleteCustomEvent', () => deleteCustomEvent(16), '/calendar/events/16'],
  ['deleteAccount', () => deleteAccount(17), '/net-worth/accounts/17'],
  ['deleteCategory', () => deleteCategory(18), '/spending/categories/18'],
  [
    'deleteCategoryBudget',
    () => deleteCategoryBudget(18, '2026-03-01'),
    '/spending/categories/18/budget/2026-03-01',
  ],
]

describe.each(DELETES)('%s', (_name, run, path) => {
  it('DELETEs its path and answers the batch the 204 names', async () => {
    answer(204, null, 'b-7')
    expect(await run()).toEqual({ batchId: 'b-7' })
    expect(sent()).toEqual({ url: `/api/v1${path}`, method: 'DELETE', body: undefined })
  })

  it('answers null when nothing was recorded — no Undo to offer', async () => {
    answer(204, null)
    expect(await run()).toEqual({ batchId: null })
  })
})

const CARD: CreditCardIn = {
  name: 'Venture X',
  annual_fee: '395.00',
  rewards_currency: 'miles',
  point_value_cents: '1.00',
  person_id: null,
  primary_holder: null,
  authorized_users: null,
  opened_on: null,
  is_active: false,
  account_id: null,
  notes: null,
}
const OVERRIDE = { done: true, hidden: false, note: null, amount: null }
const INPUTS = { values: { qualified_dividends: '100' } }

/** [name, the logged sibling, its unlogged original, verb, path, body] */
const SIBLINGS: [string, () => Promise<unknown>, () => Promise<unknown>, string, string, unknown][] = [
  [
    'updateCategoryLogged',
    () => updateCategoryLogged(4, { kind: 'transfer' }),
    () => updateCategory(4, { kind: 'transfer' }),
    'PATCH',
    '/spending/categories/4',
    { kind: 'transfer' },
  ],
  [
    'updateAccountLogged',
    () => updateAccountLogged(5, { is_active: false }),
    () => updateAccount(5, { is_active: false }),
    'PATCH',
    '/net-worth/accounts/5',
    { is_active: false },
  ],
  [
    'updateCreditCardLogged',
    () => updateCreditCardLogged(6, CARD),
    () => updateCreditCard(6, CARD),
    'PATCH',
    '/credit-cards/6',
    CARD,
  ],
  [
    'updateRewardCategoryLogged',
    () => updateRewardCategoryLogged(7, { is_active: false }),
    () => updateRewardCategory(7, { is_active: false }),
    'PATCH',
    '/credit-cards/categories/7',
    { is_active: false },
  ],
  [
    'putCalendarOverrideLogged',
    () => putCalendarOverrideLogged('payday:2026-09-15', OVERRIDE),
    () => putCalendarOverride('payday:2026-09-15', OVERRIDE),
    'PUT',
    '/calendar/overrides/payday%3A2026-09-15',
    OVERRIDE,
  ],
  [
    'putTaxInputsLogged',
    () => putTaxInputsLogged(2026, INPUTS),
    () => putTaxInputs(2026, INPUTS),
    'PUT',
    '/taxes/years/2026/inputs',
    INPUTS,
  ],
]

describe.each(SIBLINGS)('%s', (_name, logged, original, method, path, body) => {
  it('sends exactly what its unlogged original sends', async () => {
    answer(200, { echoed: true }, 'b-9')
    await original()
    const theirs = sent()
    fetchMock.mockClear()
    await logged()
    expect(sent()).toEqual(theirs)
    expect(theirs).toEqual({ url: `/api/v1${path}`, method, body })
  })

  it('answers the body with the batch the header names — null when the write changed nothing', async () => {
    answer(200, { echoed: true }, 'b-9')
    expect(await logged()).toEqual({ data: { echoed: true }, batchId: 'b-9' })
    answer(200, { echoed: true })
    expect(await logged()).toEqual({ data: { echoed: true }, batchId: null })
  })
})
```

- [ ] **Step 2: Run — FAIL.** `npx vitest run src/api/loggedClients.test.ts` → the six `…Logged` imports are undefined and
  every delete answers `undefined` instead of `{ batchId }`.

- [ ] **Step 3: Implement the deletes and siblings.** Replace each function body exactly as below (comments are the only
  prose each module gains).

`src/api/portfolio.ts` — import `{ api, apiDeleteLogged } from './client'`, and:

```ts
// Logged (2026-09-25 polish spec §6.1): the answer names the change batch whose undo brings the
// security back with its price history and dividend events — null when nothing was recorded.
export function deleteSecurity(id: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/portfolio/securities/${id}`)
}
```
```ts
// Logged: an Undo restores the row with its id and its place in the replay order.
export function deleteTransaction(id: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/portfolio/transactions/${id}`)
}
```
```ts
export function deleteDividend(id: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/portfolio/dividends/${id}`)
}
```

`src/api/creditCards.ts` — import `{ api, apiDeleteLogged, apiLogged } from './client'` and `type { Logged } from
'./client'`; after `updateCreditCard`:

```ts
/** updateCreditCard's twin for the one-click Archive / Unarchive (2026-09-25 polish spec §6.2): the
 *  same PATCH, answered with the change batch the toggle's Undo toast reverts. */
export function updateCreditCardLogged(id: number, body: CreditCardIn): Promise<Logged<CreditCardOut>> {
  return apiLogged<CreditCardOut>(`/credit-cards/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

// Logged (spec §6.1): the undo brings the card back with its credits, multipliers, limit history
// and the categories pinned to it — null when nothing was recorded.
export function deleteCreditCard(id: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/credit-cards/${id}`)
}
```
```ts
export function deleteCardCredit(creditId: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/credit-cards/credits/${creditId}`)
}
```
```ts
export function deleteLimitEvent(cardId: number, eventId: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/credit-cards/${cardId}/limits/${eventId}`)
}
```
after `updateRewardCategory`:
```ts
/** updateRewardCategory's twin for the one-click Hide / Show (spec §6.2): the same PATCH, answered
 *  with the change batch the toggle's Undo toast reverts. */
export function updateRewardCategoryLogged(
  id: number,
  body: RewardCategoryUpdate,
): Promise<Logged<RewardCategoryOut>> {
  return apiLogged<RewardCategoryOut>(`/credit-cards/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

// Logged (spec §6.1): the undo brings the category back with its multipliers.
export function deleteRewardCategory(id: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/credit-cards/categories/${id}`)
}
```

`src/api/espp.ts` — import `{ api, apiDeleteLogged } from './client'`:

```ts
// Logged (2026-09-25 polish spec §6.1): the answer names the batch an Undo reverts, null when
// nothing was recorded.
export function deleteLot(id: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/espp/lots/${id}`)
}
```
```ts
export function deleteOffering(id: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/espp/offerings/${id}`)
}
```
```ts
// A period's "Reset" (the row goes back to its derived values) — logged like the other deletes.
export function deletePeriod(id: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/espp/periods/${id}`)
}
```

`src/api/paycheck.ts` — import `{ api, apiDeleteLogged, apiReadOnly } from './client'`:

```ts
// Logged (2026-09-25 polish spec §6.1): the answer names the batch an Undo reverts.
export function deleteProfile(id: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/paycheck/profiles/${id}`)
}
```

`src/api/comp.ts` — import `{ api, apiDeleteLogged } from './client'`:

```ts
// Logged (2026-09-25 polish spec §6.1): the answer names the batch an Undo reverts.
export function deleteEvent(id: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/comp/events/${id}`)
}
```
```ts
export function deleteRsuGrant(id: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/comp/rsu-grants/${id}`)
}
```

`src/api/calendar.ts` — import `{ api, apiDeleteLogged, apiLogged } from './client'` and `type { Logged } from
'./client'`:

```ts
// Logged (2026-09-25 polish spec §6.1): the answer names the batch an Undo reverts.
export function deleteCustomEvent(id: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/calendar/events/${id}`)
}
```
after `putCalendarOverride`:
```ts
/** putCalendarOverride's twin for the one-click Hide / Mark done / Your figure (spec §6.2): the same
 *  PUT, answered with the change batch the toggle's Undo toast reverts. */
export function putCalendarOverrideLogged(
  key: string,
  body: CalendarOverrideBody,
): Promise<Logged<CalendarOverrideOut>> {
  return apiLogged<CalendarOverrideOut>(`/calendar/overrides/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
```

`src/api/netWorth.ts` — import `{ api, apiDeleteLogged, apiLogged, apiWithHeaders } from './client'` and
`type { Logged } from './client'`; after `updateAccount`:

```ts
/** updateAccount's twin for the one-click Retire / Restore (2026-09-25 polish spec §6.2): the same
 *  partial PATCH, answered with the change batch the toggle's Undo toast reverts. */
export function updateAccountLogged(accountId: number, body: AccountUpdate): Promise<Logged<AccountOut>> {
  return apiLogged<AccountOut>(`/net-worth/accounts/${accountId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

// 409s while the account has balance rows — the server's sentence names the count. Logged (spec
// §6.1): the undo re-links its components and cards.
export function deleteAccount(accountId: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/net-worth/accounts/${accountId}`)
}
```

`src/api/spending.ts` — import `{ api, apiDeleteLogged, apiLogged, apiWithHeaders } from './client'` and
`type { Logged } from './client'`; after `updateCategory`:

```ts
/** updateCategory's twin for the one-click Kind and Retire / Restore (2026-09-25 polish spec §6.2):
 *  the same PATCH, answered with the change batch the toggle's Undo toast reverts. */
export function updateCategoryLogged(
  categoryId: number,
  body: CategoryUpdate,
): Promise<Logged<CategoryOut>> {
  return apiLogged<CategoryOut>(`/spending/categories/${categoryId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

// 409s once the category has monthly rows — the server's sentence names the count. Logged (spec
// §6.1): the undo brings back its budgets and re-points the reward categories mapped to it.
export function deleteCategory(categoryId: number): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/spending/categories/${categoryId}`)
}
```
```ts
// Removes one history ROW (a mis-dated entry) — distinct from the null-amount marker. Logged.
export function deleteCategoryBudget(
  categoryId: number,
  effectiveMonth: string,
): Promise<{ batchId: string | null }> {
  return apiDeleteLogged(`/spending/categories/${categoryId}/budget/${effectiveMonth}`)
}
```

`src/api/taxes.ts` — import `{ api, apiLogged, apiWithHeaders } from './client'` and `type { Logged } from './client'`;
after `putTaxInputs`:

```ts
/** putTaxInputs' twin for the two applies — What-if "Apply N overrides" and Vest "Apply" (2026-09-25
 *  polish spec §6.2): the same PUT, answered with the change batch their Undo toast reverts. The
 *  Inputs form keeps the original: a form save is reachable from Activity. */
export function putTaxInputsLogged(year: number, body: TaxInputsUpdate): Promise<Logged<TaxInputsOut>> {
  return apiLogged<TaxInputsOut>(`/taxes/years/${year}/inputs`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
```

- [ ] **Step 4: Run — PASS.** `npx vitest run src/api` → all API tests pass (loggedClients: 17 × 2 + 6 × 2 = 46 cases).

- [ ] **Step 5: Type-check — expect exactly the fifteen C2-forced errors.** `npx tsc -p tsconfig.app.json --noEmit` →
  `TS2345: Argument of type 'undefined' is not assignable to parameter of type '{ batchId: string | null; }'` at:
  `TransactionsPanel.test.tsx:1103`, `AccountsCard.test.tsx:202`, `CategoriesCard.test.tsx:95`, `BudgetPanel.test.tsx:105`,
  `CalendarPage.test.tsx:483,518`, `CompPage.test.tsx:308,312`, `CreditCardsPage.test.tsx:985,1486,1966`,
  `EsppPage.test.tsx:339,342,345`, `PaycheckPage.test.tsx:327`. No production file errors: every production caller
  awaits with `.then(() => …)` and ignores the value.

- [ ] **Step 6: Fix them, type-only.** The mocks answer the new shape; the components ignore it either way.

```bash
sed -i -E 's/vi\.mocked\((delete[A-Za-z]+)\)\.mockResolvedValue\(undefined\)/vi.mocked(\1).mockResolvedValue({ batchId: null })/' \
  src/components/portfolio/TransactionsPanel.test.tsx src/components/settings/AccountsCard.test.tsx \
  src/components/settings/CategoriesCard.test.tsx src/components/spending/BudgetPanel.test.tsx \
  src/pages/CalendarPage.test.tsx src/pages/CompPage.test.tsx src/pages/CreditCardsPage.test.tsx \
  src/pages/EsppPage.test.tsx src/pages/PaycheckPage.test.tsx
npx tsc -p tsconfig.app.json --noEmit && echo TSC-OK
npx vitest run src/components/portfolio/TransactionsPanel.test.tsx src/components/settings/AccountsCard.test.tsx src/components/settings/CategoriesCard.test.tsx src/components/spending/BudgetPanel.test.tsx src/pages/CalendarPage.test.tsx src/pages/CompPage.test.tsx src/pages/CreditCardsPage.test.tsx src/pages/EsppPage.test.tsx src/pages/PaycheckPage.test.tsx
```
Expected: `TSC-OK`; the nine files pass unchanged in count.

- [ ] **Step 7: Commit.**

```bash
git add src/api src/components/portfolio/TransactionsPanel.test.tsx src/components/settings/AccountsCard.test.tsx src/components/settings/CategoriesCard.test.tsx src/components/spending/BudgetPanel.test.tsx src/pages/CalendarPage.test.tsx src/pages/CompPage.test.tsx src/pages/CreditCardsPage.test.tsx src/pages/EsppPage.test.tsx src/pages/PaycheckPage.test.tsx
git commit -m "feat(api): the logged clients — seventeen deletes answer { batchId }, six …Logged siblings answer { data, batchId }" -m "Contract C2: every delete client of a logged route returns the change batch its 204 names (null = nothing recorded, so no Undo), through apiDeleteLogged; updateCategory/updateAccount/updateCreditCard/updateRewardCategory/putCalendarOverride/putTaxInputs gain …Logged twins for the one-click toggles and the two tax applies, the originals untouched for form saves. loggedClients.test.ts drives each through the real transport. Fifteen test mocks typed against the old void answer now resolve { batchId: null } (type-only; the components ignore the value)."
```

---

### Task 4: `feedback.css` — the one sheet

**Files:** Create `src/components/feedback/feedback.css`, `src/components/feedback/feedbackCss.test.ts`.

- [ ] **Step 1: Write the failing test** — `src/components/feedback/feedbackCss.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** Comments first, over the WHOLE file (reorderCss.test.ts's rule). */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every declaration of `selector`, concatenated across blocks, whitespace collapsed; the selector may
 *  stand anywhere in a selector list (reorderCss.test.ts's helper). */
function declarationsFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blocks = [
    ...stripComments(css).matchAll(
      new RegExp(`(^|[,{}])\\s*${escaped}\\s*(?:,[^{}]*)?\\{([^}]*)(?=\\})`, 'g'),
    ),
  ]
  if (blocks.length === 0) throw new Error(`no ${selector} block`)
  return blocks.map((match) => match[2].replace(/\s+/g, ' ')).join(' ')
}

/** The text between `opener`'s own `{` and the `}` that closes it (motionCss.test.ts's helper). */
function inside(css: string, opener: string): string {
  const start = css.indexOf(opener)
  expect(start, opener).toBeGreaterThan(-1)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}' && (depth -= 1) === 0) return css.slice(open + 1, i)
  }
  throw new Error(`unclosed ${opener}`)
}

const flat = (css: string) => stripComments(css).replace(/\s+/g, ' ')
const declarationSet = (declarations: string) =>
  new Set(declarations.split(';').map((d) => d.trim()).filter((d) => d !== ''))
const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), 'utf8')

const feedback = read('feedback.css')
const panels = read('../panels.css')
const reorder = read('../reorder/reorder.css')

describe('feedback.css', () => {
  it("wears .button:disabled's look on an aria-disabled button — the quiet state that keeps focus", () => {
    expect(declarationSet(declarationsFor(feedback, ".button[aria-disabled='true']"))).toEqual(
      declarationSet(declarationsFor(panels, '.button:disabled')),
    )
    expect(declarationSet(declarationsFor(feedback, ".button-primary[aria-disabled='true']"))).toEqual(
      declarationSet(declarationsFor(panels, '.button-primary:disabled')),
    )
    // A disabled button never goes :active; a quiet one must not answer the press either.
    expect(declarationsFor(feedback, ".button[aria-disabled='true']:active")).toContain('transform: none;')
  })

  it('keeps a busy button its own face — working, not unavailable — winning the quiet rules by order', () => {
    const busy = declarationsFor(feedback, ".button[aria-busy='true']")
    expect(busy).toContain('opacity: 1;')
    expect(busy).toContain('cursor: progress;')
    expect(declarationsFor(feedback, ".button-primary[aria-busy='true']")).toContain('background: var(--accent);')
    const text = stripComments(feedback)
    expect(text.indexOf(".button[aria-busy='true']")).toBeGreaterThan(text.indexOf(".button[aria-disabled='true']"))
    expect(declarationsFor(feedback, ".busy-button[aria-busy='true']")).toContain('justify-content: center;')
    expect(declarationsFor(feedback, '.busy-button-label')).toContain('white-space: nowrap;')
  })

  it('spins the spinner only where motion is welcome, at a rate rather than a token', () => {
    const css = flat(feedback)
    const motion = inside(css, '@media (prefers-reduced-motion: no-preference) {')
    expect(motion).toContain('.busy-spinner { animation: busy-spin 0.8s linear infinite; }')
    // The keyframes' NAME, not the class that shares its first letters.
    expect(css.slice(0, css.indexOf('@media (prefers-reduced-motion: no-preference)'))).not.toMatch(
      /busy-spin(?![\w-])/,
    )
  })

  it('fades a leaving row and takes it out of reach, on the fast token — whatever its own rules say', () => {
    const leaving = declarationsFor(feedback, '[data-leaving]')
    expect(leaving).toContain('opacity: 0 !important;')
    expect(leaving).toContain('pointer-events: none !important;')
    expect(leaving).toContain('transition: opacity var(--t-fast) var(--ease-out);')
  })

  it('folds a non-table row away where the browser can interpolate to auto — never a table row', () => {
    const supports = inside(flat(feedback), '@supports (interpolate-size: allow-keywords) {')
    const fold = declarationsFor(supports, ':not(tr)[data-leaving]')
    expect(fold).toContain('interpolate-size: allow-keywords;')
    // Important: a row's own box rules (a more specific padding, an inline style) must not leave a
    // sliver standing — measured in Edge, a 10px inline padding kept a folded row 21px tall.
    for (const declaration of ['block-size', 'min-block-size', 'padding-block', 'margin-block', 'border-block-width'])
      expect(fold).toContain(`${declaration}: 0 !important;`)
    expect(fold).toContain('block-size var(--t-fast) var(--ease-out)')
  })

  it("flashes a changed row with reorder's saved wash, over --t-flash", () => {
    const keyframes = (css: string, name: string) => inside(flat(css), `@keyframes ${name} {`).trim()
    expect(keyframes(feedback, 'flash-wash')).toBe(keyframes(reorder, 'reorder-saved'))
    expect(keyframes(feedback, 'flash-wash-pinned')).toBe(keyframes(reorder, 'reorder-saved-pinned'))
    const wash = 'animation: flash-wash var(--t-flash) var(--ease-out);'
    expect(declarationsFor(feedback, 'tr[data-flash] > td')).toContain(wash)
    expect(declarationsFor(feedback, ':not(tr)[data-flash]')).toContain(wash)
    for (const cell of ['row-actions', 'col-identity']) {
      expect(declarationsFor(feedback, `tr[data-flash] > td.${cell}`)).toContain(
        'animation: flash-wash-pinned var(--t-flash) var(--ease-out);',
      )
    }
  })

  it('holds THE danger button — negative ink, quiet while it cannot be pressed', () => {
    const danger = declarationsFor(feedback, ".danger-button:not(:disabled):not([aria-disabled='true'])")
    expect(danger).toContain('border-color: var(--negative);')
    expect(danger).toContain('color: var(--negative);')
  })

  it('stands the confirm popover fixed, over the detail panel and the palette, under the toasts', () => {
    const popover = declarationsFor(feedback, '.popover-surface.confirm-popover')
    expect(popover).toContain('position: fixed;')
    const z = (css: string, selector: string) =>
      Number(/z-index:\s*(\d+)/.exec(declarationsFor(css, selector))?.[1])
    const confirmZ = z(feedback, '.popover-surface.confirm-popover')
    expect(confirmZ).toBeGreaterThan(z(read('../details/details.css'), '.detail-panel-layer'))
    expect(confirmZ).toBeGreaterThan(z(read('../CommandPalette.css'), '.palette-overlay'))
    expect(confirmZ).toBeLessThan(z(read('../toast.css'), '.toast-region'))
  })

  it('colours the save status by its meaning', () => {
    expect(declarationsFor(feedback, '.save-status-dirty')).toContain('color: var(--muted);')
    expect(declarationsFor(feedback, '.save-status-saved')).toContain('color: var(--positive);')
    expect(declarationsFor(feedback, '.save-status-error')).toContain('color: var(--negative);')
  })
})
```

- [ ] **Step 2: Run — FAIL.** `npx vitest run src/components/feedback/feedbackCss.test.ts` → ENOENT on `feedback.css`.

- [ ] **Step 3: Implement** — `src/components/feedback/feedback.css`:

```css
/* Feedback where the user acted (2026-09-25 polish spec §5, §6.3; contract C3) — ONE sheet for the
   building blocks in this folder: the shared danger button, the quiet (aria-disabled) and busy button
   states, the confirm popover, a row leaving and a row flashing, and the save status. Tokens only:
   every duration is a --t-* (index.css zeroes them under reduced motion) and every colour a theme
   token, so both themes follow. */

/* ── The danger button ─────────────────────────────────────────────── */
/* THE rule. MonthlyUpdatePage.css and settings.css still carry the copies it replaces; wave 2
   deletes them. Quiet like any other control while it cannot be pressed. */
.danger-button:not(:disabled):not([aria-disabled='true']) {
  border-color: var(--negative);
  color: var(--negative);
}

/* ── Quiet: aria-disabled wears the :disabled look ─────────────────── */
/* BusyButton never sets `disabled` — a disabled button drops the focus it holds (spec D3) — so its
   quiet state wears panels.css's `.button:disabled` and `.button-primary:disabled` itself;
   feedbackCss.test.ts holds each pair equal. */
.button[aria-disabled='true'] {
  opacity: 0.5;
  cursor: not-allowed;
}

.button-primary[aria-disabled='true'],
.button-primary[aria-disabled='true']:hover {
  background: var(--surface-2);
  border-color: var(--border);
  color: var(--muted);
  opacity: 1;
  filter: none;
}

/* A disabled button never goes :active, so the press feedback (panels.css's motion grammar) must not
   answer a quiet one either. */
.button[aria-disabled='true']:active {
  transform: none;
}

/* ── Busy ──────────────────────────────────────────────────────────── */
/* Busy is not unavailable: the pressed button keeps its own face and says "working" with a spinner,
   while its siblings go quiet around it (spec §6.3). Later than the quiet rules at the same
   specificity, so these win them. */
.button[aria-busy='true'] {
  opacity: 1;
  cursor: progress;
}

.button-primary[aria-busy='true'],
.button-primary[aria-busy='true']:hover {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}

/* The label never wraps (a wrapped "Save name" grew its row — audit SGS), and keeps .button's own gap
   between an icon and its words. */
.busy-button-label {
  display: inline-flex;
  align-items: center;
  gap: inherit;
  white-space: nowrap;
}

/* Centred, so content the idle button did not have — the spinner — spills evenly into both paddings
   while BusyButton holds the idle width (its max-width lock). */
.busy-button[aria-busy='true'] {
  justify-content: center;
}

/* Drawn in the button's own ink, so it reads on a quiet, a primary and a danger button in either
   theme: a faint ring with one bright quarter. */
.busy-spinner {
  display: inline-block;
  flex: none;
  box-sizing: border-box;
  width: 0.8em;
  height: 0.8em;
  vertical-align: -0.1em;
  border-radius: 50%;
  border: 2px solid var(--border);
  border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
  border-top-color: currentColor;
}

/* A button without .button's flex gap still leaves room after the spinner. */
.busy-button:not(.button) > .busy-spinner {
  margin-inline-end: 0.4em;
}

/* ── The confirm popover (useConfirm) ──────────────────────────────── */
/* Portaled to <body> and fixed: .page is a containing block for fixed descendants and a stacking
   context (panels.css's .page note), so a popover inside it could neither stand where its anchor is
   nor clear the chrome. z 25: over the detail panel layer (16) — a question can be asked from the
   assistant — and the palette (20); under the toasts (30), whose Undo must never be buried.
   confirmPlacement.ts writes top/left; the entrance is .popover-surface's pop-in. */
.popover-surface.confirm-popover {
  position: fixed;
  z-index: 25;
  width: max-content;
  max-width: min(22rem, calc(100vw - 16px));
}

.confirm-popover-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
}

.confirm-popover-body {
  margin-top: 0.4rem;
  color: var(--muted);
  font-size: 0.82rem;
  line-height: 1.45;
}

.confirm-popover-body > :first-child {
  margin-top: 0;
}

.confirm-popover-body > :last-child {
  margin-bottom: 0;
}

.confirm-popover-arm {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-top: 0.75rem;
  color: var(--muted);
  font-size: 0.78rem;
}

/* .field-input right-aligns figures; a typed date reads left to right, like the prompt above it. */
.confirm-popover-arm .field-input {
  text-align: left;
}

.confirm-popover-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.85rem;
}

/* ── A row leaving (useDeleteWithUndo) ─────────────────────────────── */
/* The row fades while its delete runs, and cannot be pressed again; it leaves the tree when the list
   reloads. A refused delete simply takes the attribute away — no transition back: the row is just
   there again. `!important` because a transient state must win over whatever the row's own rules (or
   an inline style) say about its opacity and box; the fade still runs — a transition outranks
   important declarations in the cascade. */
[data-leaving] {
  opacity: 0 !important;
  pointer-events: none !important;
  transition: opacity var(--t-fast) var(--ease-out);
}

/* A table row cannot be given a height, so it fades in place; any other row also folds its height
   away where the browser can interpolate to `auto` — declared in the same rule that sets the 0
   (measured in Edge: the after-change style's interpolate-size is the one the transition reads).
   Elsewhere it fades only. The box goes to 0 whatever set it: measured in Edge, a row whose padding
   out-ranked this rule folded to a 21px sliver. */
@supports (interpolate-size: allow-keywords) {
  :not(tr)[data-leaving] {
    interpolate-size: allow-keywords;
    block-size: 0 !important;
    min-block-size: 0 !important;
    padding-block: 0 !important;
    margin-block: 0 !important;
    border-block-width: 0 !important;
    overflow: clip;
    transition:
      opacity var(--t-fast) var(--ease-out),
      block-size var(--t-fast) var(--ease-out),
      padding-block var(--t-fast) var(--ease-out),
      margin-block var(--t-fast) var(--ease-out),
      border-block-width var(--t-fast) var(--ease-out);
  }
}

/* ── A row flashing (flashElement) ─────────────────────────────────── */
/* The one "this changed" cue, generalized from reorder's saved flash (reorder.css, which keeps its own
   attribute): the same accent wash fading out over --t-flash — the timer that clears the attribute
   reads the same token. A table row washes its cells (a row's own background shows through none of
   them); an opaque pinned cell washes over, and ends on, its own --surface. Not for an element that
   runs an entrance of its own (a .card): taking the attribute away would replay that entrance. */
@keyframes flash-wash {
  from {
    background-color: var(--surface-2);
    background-color: color-mix(in srgb, var(--accent) 22%, transparent);
  }
  to {
    background-color: transparent;
  }
}

@keyframes flash-wash-pinned {
  from {
    background-color: var(--surface-2);
    background-color: color-mix(in srgb, var(--accent) 22%, var(--surface));
  }
  to {
    background-color: var(--surface);
  }
}

tr[data-flash] > td,
:not(tr)[data-flash] {
  animation: flash-wash var(--t-flash) var(--ease-out);
}

tr[data-flash] > td.row-actions,
tr[data-flash] > td.col-identity {
  animation: flash-wash-pinned var(--t-flash) var(--ease-out);
}

/* ── Save status (SaveStatus) ──────────────────────────────────────── */
.save-status {
  font-size: 0.8rem;
  line-height: 1.3;
}

.save-status-dirty {
  color: var(--muted);
}

.save-status-saved {
  color: var(--positive);
}

.save-status-error {
  color: var(--negative);
}

/* ── Motion ────────────────────────────────────────────────────────── */
/* Gated like panels.css's motion grammar: under reduced motion none of this exists — the spinner sits
   still (its ring still says "working"), the popover and the saved line simply appear. */
@media (prefers-reduced-motion: no-preference) {
  /* Literal, not a token: an INFINITE spinner's period is a rate, not a grammar duration — a --t-*
     would freeze it mid-turn under reduce (the house spinners' rule; motion.test.ts exempts
     `infinite`). */
  .busy-spinner {
    animation: busy-spin 0.8s linear infinite;
  }

  @keyframes busy-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Opened above its anchor, the popover rises into place instead of dropping onto it. */
  .popover-surface.confirm-popover[data-placement='above'] {
    animation-name: confirm-pop-up;
  }

  @keyframes confirm-pop-up {
    from {
      opacity: 0;
      translate: 0 4px;
    }
  }

  .save-status-saved {
    animation: save-status-in var(--t-fast) var(--ease-out);
  }

  @keyframes save-status-in {
    from {
      opacity: 0;
    }
  }
}
```

- [ ] **Step 4: Run — PASS.** `npx vitest run src/components/feedback/feedbackCss.test.ts src/theme/motion.test.ts
  src/components/reorder/reorderCss.test.ts` → all pass (the motion sweep sees no literal finite duration).
- [ ] **Step 5: Commit.**

```bash
git add src/components/feedback/feedback.css src/components/feedback/feedbackCss.test.ts
git commit -m "feat(feedback): feedback.css — quiet and busy buttons, the confirm popover, leaving and flashing rows, save status, THE danger button" -m "Contract C3's sheet. aria-disabled wears panels.css's :disabled look (pinned equal by test); a busy button keeps its own face with a currentColor spinner; the confirm popover is fixed at z 25 (over the detail panel and palette, under the toasts); [data-leaving] fades (and folds non-table rows via interpolate-size, verified in Edge 153); [data-flash] reuses reorder's saved wash on --t-flash; one shared .danger-button. Tokens only; the motion block is gated on no-preference."
```

---

### Task 5: `reveal.ts` — edits come to the user

**Files:** Create `src/components/feedback/reveal.ts`, `src/components/feedback/reveal.test.tsx`.

- [ ] **Step 1: Write the failing test** — `src/components/feedback/reveal.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MOTION_MS } from '../../theme/motion'
import { flashElement, revealEditor, revealRow, useEscapeCancel } from './reveal'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

function rect(top: number, height: number): DOMRect {
  return { top, height, bottom: top + height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

/** jsdom lays nothing out: a box's scroll geometry is written on it by hand (reorderDom.test.ts's setBox). */
function setBox(element: HTMLElement, box: { scrollHeight?: number; clientHeight?: number; scrollTop?: number }) {
  for (const [key, value] of Object.entries(box)) {
    Object.defineProperty(element, key, { value, writable: true, configurable: true })
  }
}

function Editor({ margin }: { margin?: string }) {
  return (
    <form data-testid="form" style={margin === undefined ? undefined : { scrollMarginTop: margin }}>
      <input type="hidden" name="id" defaultValue="7" />
      <input aria-label="Name" defaultValue="Housing" />
      <select aria-label="Kind" defaultValue="living">
        <option value="living">living</option>
      </select>
    </form>
  )
}

describe('revealEditor', () => {
  it('scrolls the form to its nearest edge, smoothly, then focuses and selects its first field', () => {
    render(<Editor />)
    const form = screen.getByTestId('form')
    const scroll = vi.fn()
    form.scrollIntoView = scroll
    const name = screen.getByLabelText('Name') as HTMLInputElement
    const focus = vi.spyOn(name, 'focus')
    const select = vi.spyOn(name, 'select')
    revealEditor(form)
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })
    // The hidden id input is skipped, and the caret lands without a second scroll.
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(select).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(name)
  })

  it('scrolls at once under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    render(<Editor />)
    const form = screen.getByTestId('form')
    const scroll = vi.fn()
    form.scrollIntoView = scroll
    revealEditor(form)
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'instant' })
  })

  it('focuses the named field instead; a select takes the focus with nothing to select', () => {
    render(<Editor />)
    const form = screen.getByTestId('form')
    form.scrollIntoView = vi.fn()
    revealEditor(form, 'select')
    expect(document.activeElement).toBe(screen.getByLabelText('Kind'))
  })

  it('lends a margin-less form the sticky-row band for the one scroll, then hands it back', () => {
    render(<Editor />)
    const form = screen.getByTestId('form')
    let during = ''
    form.scrollIntoView = vi.fn(() => {
      during = form.style.scrollMarginTop
    })
    revealEditor(form)
    expect(during).toBe('calc(var(--sticky-inset, 0px) + 0.75rem)')
    expect(form.style.scrollMarginTop).toBe('')
  })

  it("keeps a form's own scroll margin", () => {
    render(<Editor margin="40px" />)
    const form = screen.getByTestId('form')
    let during = ''
    form.scrollIntoView = vi.fn(() => {
      during = form.style.scrollMarginTop
    })
    revealEditor(form)
    expect(during).toBe('40px')
  })

  it('asks nothing of a missing form, or of one with no field', () => {
    expect(() => revealEditor(null)).not.toThrow()
    render(<div data-testid="empty" />)
    const empty = screen.getByTestId('empty')
    empty.scrollIntoView = vi.fn()
    expect(() => revealEditor(empty)).not.toThrow()
  })
})

describe('revealRow', () => {
  it('scrolls a row with no scrolling ancestor to the nearest edge of the page', () => {
    document.body.innerHTML = '<ul><li id="row">x</li></ul>'
    const row = document.getElementById('row') as HTMLElement
    row.scrollIntoView = vi.fn()
    revealRow(row)
    expect(row.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('scrolls a capped TableScroll box — never the page — to show the row under its pinned header', () => {
    document.body.innerHTML =
      '<div id="box" class="table-scroll" style="overflow-y: auto"><table><thead><tr><th>Name</th></tr></thead>' +
      '<tbody><tr id="row"><td>x</td></tr></tbody></table></div>'
    const box = document.getElementById('box') as HTMLElement
    const row = document.getElementById('row') as HTMLElement
    box.style.setProperty('--table-head-h', '30px')
    setBox(box, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 })
    box.getBoundingClientRect = () => rect(100, 300)
    row.getBoundingClientRect = () => rect(450, 30) // 80px past the box's foot at 400
    row.scrollIntoView = vi.fn()
    revealRow(row)
    expect(box.scrollTop).toBe(80)
    expect(row.scrollIntoView).not.toHaveBeenCalled()
  })

  it('scrolls an older cap (.settings-scroll) just clear of its edge', () => {
    document.body.innerHTML =
      '<div id="box" class="settings-scroll" style="overflow-y: auto"><table><tbody><tr id="row"><td>x</td></tr></tbody></table></div>'
    const box = document.getElementById('box') as HTMLElement
    const row = document.getElementById('row') as HTMLElement
    setBox(box, { scrollHeight: 900, clientHeight: 400, scrollTop: 0 })
    box.getBoundingClientRect = () => rect(100, 400)
    row.getBoundingClientRect = () => rect(560, 30) // list y 460..490, past 400 − the 4px margin
    revealRow(row)
    expect(box.scrollTop).toBe(94)
  })

  it('leaves alone a row that has left the tree, and a missing one', () => {
    const row = document.createElement('li')
    row.scrollIntoView = vi.fn()
    revealRow(row)
    revealRow(null)
    expect(row.scrollIntoView).not.toHaveBeenCalled()
  })
})

describe('flashElement', () => {
  it('marks the element for MOTION_MS.flash — the wash and its timer read one token', () => {
    vi.useFakeTimers()
    const el = document.createElement('tr')
    flashElement(el)
    expect(el.hasAttribute('data-flash')).toBe(true)
    vi.advanceTimersByTime(MOTION_MS.flash - 1)
    expect(el.hasAttribute('data-flash')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(el.hasAttribute('data-flash')).toBe(false)
  })

  it('restarts on a second flash rather than ending with the first', () => {
    vi.useFakeTimers()
    const el = document.createElement('li')
    flashElement(el)
    vi.advanceTimersByTime(MOTION_MS.flash - 100)
    flashElement(el)
    vi.advanceTimersByTime(100)
    expect(el.hasAttribute('data-flash')).toBe(true) // the first timer no longer ends it
    vi.advanceTimersByTime(MOTION_MS.flash - 100)
    expect(el.hasAttribute('data-flash')).toBe(false)
  })

  it('ignores a missing element', () => {
    expect(() => flashElement(null)).not.toThrow()
  })
})

describe('useEscapeCancel', () => {
  function Form({ onCancel, enabled }: { onCancel: () => void; enabled?: boolean }) {
    const ref = useRef<HTMLFormElement>(null)
    useEscapeCancel(ref, onCancel, enabled)
    return (
      <>
        <form ref={ref}>
          <input aria-label="Amount" />
        </form>
        <input aria-label="Elsewhere" />
      </>
    )
  }

  it('cancels on an Escape inside the form, and claims the key', () => {
    const onCancel = vi.fn()
    render(<Form onCancel={onCancel} />)
    // fireEvent answers false when a listener called preventDefault — what the detail panel's own
    // Escape handler yields to.
    expect(fireEvent.keyDown(screen.getByLabelText('Amount'), { key: 'Escape' })).toBe(false)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('leaves an Escape outside the form alone, and every other key', () => {
    const onCancel = vi.fn()
    render(<Form onCancel={onCancel} />)
    fireEvent.keyDown(screen.getByLabelText('Elsewhere'), { key: 'Escape' })
    fireEvent.keyDown(screen.getByLabelText('Amount'), { key: 'Enter' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('yields to an inner popover that already claimed the Escape', () => {
    const onCancel = vi.fn()
    render(<Form onCancel={onCancel} />)
    // usePopoverDismiss's capture-phase listener, as a popover open inside the form registers it.
    document.addEventListener('keydown', (event) => event.preventDefault(), { capture: true, once: true })
    fireEvent.keyDown(screen.getByLabelText('Amount'), { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('stays quiet while disabled, and while an IME composes', () => {
    const onCancel = vi.fn()
    const { rerender } = render(<Form onCancel={onCancel} enabled={false} />)
    fireEvent.keyDown(screen.getByLabelText('Amount'), { key: 'Escape' })
    rerender(<Form onCancel={onCancel} />)
    fireEvent.keyDown(screen.getByLabelText('Amount'), { key: 'Escape', isComposing: true })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('calls the latest onCancel, not the one it first saw', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Form onCancel={first} />)
    rerender(<Form onCancel={second} />)
    fireEvent.keyDown(screen.getByLabelText('Amount'), { key: 'Escape' })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run — FAIL.** `npx vitest run src/components/feedback/reveal.test.tsx` → cannot resolve `./reveal`.

- [ ] **Step 3: Implement** — `src/components/feedback/reveal.ts`:

```ts
import { useEffect } from 'react'
import type { RefObject } from 'react'
import { MOTION_MS } from '../../theme/motion'
import { ensureVisible, scrollParentOf, stickyHeaderOf, unitExtent } from '../reorder/reorderDom'
import { useLatest } from '../reorder/useLatest'
import { revealInBox } from '../tableScrollDom'
import { prefersReducedMotion } from '../useReducedMotion'
import './feedback.css'

// Edits come to the user (2026-09-25 polish spec §5.1, D5; contract C3): the helpers that put the
// thing a save, a create, a delete or an Undo touched where the user is looking, and let Escape leave
// an editor.

/** An editor's fields — never a hidden input or a disabled one. */
const FIELDS = 'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)'

/** The band a form that states no scroll margin of its own borrows for its reveal: clear of the sticky
 *  scope row (PageFrame measures it into --sticky-inset), as LocalSections and the Settings cards
 *  already keep theirs. */
const FALLBACK_MARGIN_TOP = 'calc(var(--sticky-inset, 0px) + 0.75rem)'
const FALLBACK_MARGIN_BOTTOM = '0.75rem'

/** A row revealed inside its own scroll box stands this far clear of the box's edge (tableScroll.css's
 *  4px row margins). */
const ROW_MARGIN_PX = 4

const unset = (margin: string | undefined) => margin === undefined || margin === '' || margin === '0px'

/**
 * Bring an editor to the user: scroll `form` into view by the least travel (`block: 'nearest'`;
 * smooth, or instant under reduced motion), then focus its first field — or the `focusSelector`
 * match — with `preventScroll`, so the focus never fights the scroll, and select its text. A form that
 * states no scroll margin borrows the sticky-row band for the one call, so its top never lands under
 * the scope row.
 */
export function revealEditor(form: HTMLElement | null, focusSelector?: string): void {
  if (form === null) return
  const computed = getComputedStyle(form)
  const own = { top: form.style.scrollMarginTop, bottom: form.style.scrollMarginBottom }
  if (unset(computed.scrollMarginTop)) form.style.scrollMarginTop = FALLBACK_MARGIN_TOP
  if (unset(computed.scrollMarginBottom)) form.style.scrollMarginBottom = FALLBACK_MARGIN_BOTTOM
  // Optional call, the house idiom: jsdom has no scrollIntoView. The target is fixed at the call, so
  // the borrowed margin can go straight back.
  form.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'instant' : 'smooth' })
  form.style.scrollMarginTop = own.top
  form.style.scrollMarginBottom = own.bottom
  const field = form.querySelector<HTMLElement>(focusSelector ?? FIELDS)
  if (field === null) return
  field.focus({ preventScroll: true })
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.select()
}

/**
 * Show `row` within its own list, scrolling only what has to move: a capped TableScroll box scrolls
 * itself (revealInBox — clear of its pinned header and footer); the older caps (`.settings-scroll`,
 * `.categories-scroll`) and any other scrolling ancestor scroll just clear of their edge and sticky
 * header (ensureVisible); only a row with no scrolling ancestor moves the page. So a repeat-entry
 * form above a capped list keeps its caret on screen (spec §5.3).
 */
export function revealRow(row: HTMLElement | null): void {
  if (row === null || !row.isConnected) return
  const scroller = scrollParentOf(row)
  if (scroller === null) {
    row.scrollIntoView?.({ block: 'nearest' })
    return
  }
  if (scroller.classList.contains('table-scroll')) {
    revealInBox(scroller, row)
    return
  }
  const { top, height } = unitExtent([row], scroller)
  ensureVisible(scroller, top, height, stickyHeaderOf(row, scroller), ROW_MARGIN_PX)
}

/** The live flash timers: a second flash of one element restarts it. */
const flashes = new WeakMap<HTMLElement, number>()

/** The one "this changed" cue (spec §5.1): `data-flash` for MOTION_MS.flash — feedback.css's wash
 *  runs on --t-flash, the same number, so the attribute leaves as the wash ends. */
export function flashElement(el: HTMLElement | null): void {
  if (el === null) return
  const running = flashes.get(el)
  if (running !== undefined) {
    window.clearTimeout(running)
    el.removeAttribute('data-flash')
    // A style flush between the two writes, or the browser would see no change and not restart it.
    el.getBoundingClientRect()
  }
  el.setAttribute('data-flash', '')
  flashes.set(
    el,
    window.setTimeout(() => {
      el.removeAttribute('data-flash')
      flashes.delete(el)
    }, MOTION_MS.flash),
  )
}

/**
 * Escape inside `ref` leaves the editor (spec D5): `onCancel` runs and the key is claimed, so the
 * detail panel's own Escape (a document listener that yields to a claimed key) stays shut. An Escape
 * an inner popover already claimed — usePopoverDismiss listens in the capture phase, ahead of this —
 * or one that ends an IME composition is left alone. Keyed on `enabled`: pass the editing flag, so the
 * listener binds when the editor mounts.
 */
export function useEscapeCancel(
  ref: RefObject<HTMLElement | null>,
  onCancel: () => void,
  enabled = true,
): void {
  const cancel = useLatest(onCancel)
  useEffect(() => {
    const el = ref.current
    if (!enabled || el === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      event.preventDefault()
      cancel.current()
    }
    el.addEventListener('keydown', onKeyDown)
    return () => el.removeEventListener('keydown', onKeyDown)
  }, [ref, enabled, cancel])
}
```

- [ ] **Step 4: Run — PASS.** `npx vitest run src/components/feedback/reveal.test.tsx` → 18 passed.
- [ ] **Step 5: Lint the file.** `npx eslint src/components/feedback` → 0 problems.
- [ ] **Step 6: Commit.**

```bash
git add src/components/feedback/reveal.ts src/components/feedback/reveal.test.tsx
git commit -m "feat(feedback): revealEditor, revealRow, flashElement, useEscapeCancel — edits come to the user" -m "Contract C3 / spec §5.1: an editor scrolls into view by the least travel (instant under reduced motion) and its first field takes focus with preventScroll and is selected — a margin-less form borrows the sticky-row band for that one scroll; a row is revealed inside its own box (revealInBox for TableScroll, ensureVisible for the older caps) and only moves the page when nothing else scrolls; data-flash lasts MOTION_MS.flash and restarts; Escape inside an editor cancels unless an inner popover claimed it."
```

---

### Task 6: `BusyButton`

**Files:** Create `src/components/feedback/BusyButton.tsx`, `src/components/feedback/BusyButton.test.tsx`.

- [ ] **Step 1: Write the failing test** — `src/components/feedback/BusyButton.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import type { FormEvent } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BusyButton from './BusyButton'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** jsdom lays nothing out: the button stands `idle` px wide at rest and `busy` px wide with its spinner in. */
function widths(idle: number, busy: number): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const width = this.getAttribute('aria-busy') === 'true' ? busy : idle
    return { width, height: 32, top: 0, bottom: 32, left: 0, right: width, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
}

/** .button's 0.9rem sides, as jsdom hands inline longhands back through getComputedStyle. */
const PADDING = { paddingLeft: '14px', paddingRight: '14px' }

describe('BusyButton', () => {
  it('never sets the native disabled attribute — busy, inert, aria-disabled and disabled all go quiet instead', () => {
    for (const props of [{ busy: true }, { inert: true }, { 'aria-disabled': true }, { disabled: true }]) {
      const { unmount } = render(<BusyButton {...props}>Save</BusyButton>)
      const button = screen.getByRole('button', { name: 'Save' })
      expect(button.hasAttribute('disabled')).toBe(false)
      expect(button.getAttribute('aria-disabled')).toBe('true')
      unmount()
    }
  })

  it('is plain when nothing is in flight: no aria-disabled, no aria-busy, no spinner', () => {
    render(<BusyButton className="button">Save</BusyButton>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.hasAttribute('aria-disabled')).toBe(false)
    expect(button.hasAttribute('aria-busy')).toBe(false)
    expect(button.querySelector('.busy-spinner')).toBeNull()
    expect(button.className).toBe('button busy-button')
  })

  it('busy: a spinner before the unchanged label, aria-busy, and the busy label when one is given', () => {
    const { rerender } = render(<BusyButton busy>Save</BusyButton>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.getAttribute('aria-busy')).toBe('true')
    const spinner = button.firstElementChild as HTMLElement
    expect(spinner.className).toBe('busy-spinner')
    expect(spinner.getAttribute('aria-hidden')).toBe('true')
    rerender(
      <BusyButton busy busyLabel="Saving…">
        Save
      </BusyButton>,
    )
    expect(button.textContent).toBe('Saving…')
    rerender(<BusyButton busyLabel="Saving…">Save</BusyButton>)
    expect(button.textContent).toBe('Save')
  })

  it('inert: quiet with its label unchanged — and never the HTML inert attribute, which would drop focus', () => {
    render(<BusyButton inert>Delete</BusyButton>)
    const button = screen.getByRole('button', { name: 'Delete' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.hasAttribute('aria-busy')).toBe(false)
    expect(button.hasAttribute('inert')).toBe(false)
    expect(button.textContent).toBe('Delete')
  })

  it('swallows a click while quiet: no handler, no default action, no bubbling to a clickable row', () => {
    const onClick = vi.fn()
    const onRow = vi.fn()
    render(
      <div onClick={onRow}>
        <BusyButton busy onClick={onClick}>
          Save
        </BusyButton>
      </div>,
    )
    expect(fireEvent.click(screen.getByRole('button', { name: 'Save' }))).toBe(false)
    expect(onClick).not.toHaveBeenCalled()
    expect(onRow).not.toHaveBeenCalled()
  })

  it('swallows a submit while quiet, and submits once it is not', () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault())
    const { rerender } = render(
      <form onSubmit={onSubmit}>
        <BusyButton type="submit" inert>
          Save
        </BusyButton>
      </form>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).not.toHaveBeenCalled()
    rerender(
      <form onSubmit={onSubmit}>
        <BusyButton type="submit">Save</BusyButton>
      </form>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('passes a click through when it is not quiet', () => {
    const onClick = vi.fn()
    render(<BusyButton onClick={onClick}>Save</BusyButton>)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('keeps the focus through a busy cycle — it is never disabled out from under the caret', () => {
    const { rerender } = render(<BusyButton>Save</BusyButton>)
    const button = screen.getByRole('button', { name: 'Save' })
    button.focus()
    rerender(
      <BusyButton busy busyLabel="Saving…">
        Save
      </BusyButton>,
    )
    expect(document.activeElement).toBe(button)
    rerender(<BusyButton>Save</BusyButton>)
    expect(document.activeElement).toBe(button)
  })

  it('locks min-width to the idle width while busy, and lets go after', () => {
    widths(88, 88)
    const { rerender } = render(<BusyButton>Save progress</BusyButton>)
    const button = screen.getByRole('button', { name: 'Save progress' })
    expect(button.style.minWidth).toBe('')
    rerender(
      <BusyButton busy busyLabel="Saving…">
        Save progress
      </BusyButton>,
    )
    expect(button.style.minWidth).toBe('88px')
    rerender(<BusyButton>Save progress</BusyButton>)
    expect(button.style.minWidth).toBe('')
  })

  it("holds the idle width to the pixel when the spinner fits the button's padding", () => {
    widths(59, 76) // the spinner and its gap add 17px: 8.5px a side, inside 14px paddings
    const { rerender } = render(<BusyButton style={PADDING}>Save</BusyButton>)
    const button = screen.getByRole('button', { name: 'Save' })
    rerender(
      <BusyButton style={PADDING} busy>
        Save
      </BusyButton>,
    )
    expect(button.style.minWidth).toBe('59px')
    expect(button.style.maxWidth).toBe('59px')
    rerender(<BusyButton style={PADDING}>Save</BusyButton>)
    expect(button.style.maxWidth).toBe('')
  })

  it('grows rather than clip when the busy content will not fit the padding', () => {
    widths(59, 100) // a longer busy label: 20.5px a side
    const { rerender } = render(<BusyButton style={PADDING}>Save</BusyButton>)
    const button = screen.getByRole('button', { name: 'Save' })
    rerender(
      <BusyButton style={PADDING} busy busyLabel="Saving changes…">
        Save
      </BusyButton>,
    )
    expect(button.style.minWidth).toBe('59px')
    expect(button.style.maxWidth).toBe('')
  })

  it("hands a caller's own min-width back when the lock lets go", () => {
    widths(88, 88)
    const { rerender } = render(<BusyButton style={{ minWidth: '6rem' }}>Save</BusyButton>)
    const button = screen.getByRole('button', { name: 'Save' })
    rerender(
      <BusyButton style={{ minWidth: '6rem' }} busy>
        Save
      </BusyButton>,
    )
    expect(button.style.minWidth).toBe('88px')
    rerender(<BusyButton style={{ minWidth: '6rem' }}>Save</BusyButton>)
    expect(button.style.minWidth).toBe('6rem')
  })

  it('hands its button to a ref', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<BusyButton ref={ref}>Save</BusyButton>)
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Save' }))
  })
})
```

- [ ] **Step 2: Run — FAIL.** `npx vitest run src/components/feedback/BusyButton.test.tsx` → cannot resolve `./BusyButton`.

- [ ] **Step 3: Implement** — `src/components/feedback/BusyButton.tsx`:

```tsx
import { useImperativeHandle, useLayoutEffect, useRef } from 'react'
import type { ButtonHTMLAttributes, MouseEvent, Ref } from 'react'
import '../panels.css'
import './feedback.css'

export type BusyButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** This button's own action is in flight: a spinner, aria-busy, and quiet. */
  busy?: boolean
  /** The label while busy (the width stays locked to the idle width — see the lock below). */
  busyLabel?: string
  /** Another action is in flight: quiet, label unchanged. NOT the HTML `inert` attribute — that would
   *  take the button out of the focus order, the one thing this component exists to prevent. */
  inert?: boolean
  /** React 19 ref-as-prop, for a caller that hands focus back to this button. */
  ref?: Ref<HTMLButtonElement>
}

/** The least padding left on each side when busy content spills into it. */
const SPILL_FLOOR_PX = 2

/**
 * The house button for anything that runs a request (2026-09-25 polish spec D3, §6.3; contract C3).
 * It never sets the native `disabled` attribute: a disabled button drops the focus it holds, and focus
 * must never fall to <body> mid-save. It goes quiet instead — `aria-disabled="true"` while busy, inert
 * or asked to (`aria-disabled`, or a `disabled` prop, honoured the same way) — and a click or a form
 * submit is swallowed while quiet. Busy draws a spinner before the label and holds the idle width.
 */
export default function BusyButton({
  busy = false,
  busyLabel,
  inert = false,
  disabled = false,
  className,
  children,
  onClick,
  ref,
  ...rest
}: BusyButtonProps) {
  const own = useRef<HTMLButtonElement>(null)
  // The width the button stands at when nothing is in flight — read by the lock below.
  const idleWidth = useRef(0)
  useImperativeHandle(ref, () => own.current as HTMLButtonElement, [])

  const asked = rest['aria-disabled']
  const quiet = busy || inert || disabled || asked === true || asked === 'true'

  // The idle width, measured at mount and whenever the idle button resizes (a label change, a density
  // switch, a late font). The observer's border box is the laid-out width, which the press transform
  // (.button:active's scale) never touches; without ResizeObserver (jsdom) the mount measure stands.
  useLayoutEffect(() => {
    const el = own.current
    if (el === null) return
    if (el.getAttribute('aria-busy') !== 'true') idleWidth.current = el.getBoundingClientRect().width
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (el.getAttribute('aria-busy') === 'true') return
      idleWidth.current = entry?.borderBoxSize?.[0]?.inlineSize ?? el.getBoundingClientRect().width
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // While busy, hold the idle width: min-width always (a shorter busy label never shrinks the button),
  // and the max-width too wherever the button's own padding can take the extra content — the spinner —
  // the row being centred (feedback.css) so it spills evenly into both sides. A busy label too long for
  // that grows the button rather than clip. What was there before comes back when the work ends.
  useLayoutEffect(() => {
    const el = own.current
    const width = idleWidth.current
    if (!busy || el === null || width <= 0) return
    const before = { min: el.style.minWidth, max: el.style.maxWidth }
    el.style.minWidth = `${width}px`
    const spill = (el.getBoundingClientRect().width - width) / 2
    if (spill > 0) {
      const style = getComputedStyle(el)
      const room = Math.min(parseFloat(style.paddingLeft) || 0, parseFloat(style.paddingRight) || 0)
      if (spill <= room - SPILL_FLOOR_PX) el.style.maxWidth = `${width}px`
    }
    return () => {
      el.style.minWidth = before.min
      el.style.maxWidth = before.max
    }
  }, [busy, busyLabel])

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (quiet) {
      // Swallowed the way a disabled button swallows it: no default action (a submit button's form
      // never submits) and no bubbling to a clickable row around it.
      event.preventDefault()
      event.stopPropagation()
      return
    }
    onClick?.(event)
  }

  return (
    <button
      {...rest}
      ref={own}
      className={className === undefined ? 'busy-button' : `${className} busy-button`}
      aria-busy={busy ? true : undefined}
      aria-disabled={quiet ? true : undefined}
      onClick={handleClick}
    >
      {busy && <span className="busy-spinner" aria-hidden="true" />}
      <span className="busy-button-label">{busy && busyLabel !== undefined ? busyLabel : children}</span>
    </button>
  )
}
```

- [ ] **Step 4: Run — PASS.** `npx vitest run src/components/feedback/BusyButton.test.tsx` → 13 passed.
- [ ] **Step 5: Lint.** `npx eslint src/components/feedback` → 0 problems.
- [ ] **Step 6: Commit.**

```bash
git add src/components/feedback/BusyButton.tsx src/components/feedback/BusyButton.test.tsx
git commit -m "feat(feedback): BusyButton — busy on the pressed button, quiet siblings, focus kept, idle width held" -m "Contract C3: never the native disabled attribute (a disabled button drops focus); busy, inert, aria-disabled and a disabled prop all set aria-disabled and swallow clicks and submits. Busy shows a spinner before the unchanged label (or the busy label) and holds the idle width — min-width always, max-width too when the spinner fits the padding (centred spill, measured in Edge: 59.31px held, 6.36px each side). Takes a ref (React 19)."
```

---

### Task 7: `useSaveState`, `SaveStatus`, `SaveButton`

**Files:** Create `src/components/feedback/useSaveState.ts`, `SaveStatus.tsx`, `SaveButton.tsx`, `save.test.tsx`.

- [ ] **Step 1: Write the failing test** — `src/components/feedback/save.test.tsx`:

```tsx
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import { SaveButton } from './SaveButton'
import { SaveStatus } from './SaveStatus'
import { SAVED_MS, useSaveState } from './useSaveState'
import type { SaveState, SaveStatusKind } from './useSaveState'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const hook = (dirty: boolean) =>
  renderHook(({ dirty: d }) => useSaveState({ dirty: d }), { initialProps: { dirty } })

describe('useSaveState', () => {
  it('reads clean and dirty off the form', () => {
    const { result, rerender } = hook(false)
    expect(result.current.status).toBe('clean')
    expect(result.current.error).toBeNull()
    rerender({ dirty: true })
    expect(result.current.status).toBe('dirty')
  })

  it("runs a save: saving, then saved for 2.5 s, then clean — and answers the save's result", async () => {
    const { result, rerender } = hook(true)
    const save = deferred<string>()
    let answer!: Promise<string | undefined>
    act(() => {
      answer = result.current.run(() => save.promise)
    })
    expect(result.current.status).toBe('saving')
    await act(async () => {
      save.resolve('stored')
      await answer
    })
    rerender({ dirty: false }) // the form now matches what is stored
    expect(result.current.status).toBe('saved')
    expect(await answer).toBe('stored')
    act(() => {
      vi.advanceTimersByTime(SAVED_MS - 1)
    })
    expect(result.current.status).toBe('saved')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.status).toBe('clean')
  })

  it('reads "Unsaved changes" at once when the form is edited inside the saved window', async () => {
    const { result, rerender } = hook(false)
    await act(async () => {
      await result.current.run(async () => 'stored')
    })
    expect(result.current.status).toBe('saved')
    rerender({ dirty: true })
    expect(result.current.status).toBe('dirty')
    act(() => {
      vi.advanceTimersByTime(SAVED_MS)
    })
    expect(result.current.status).toBe('dirty')
  })

  it('keeps the error until clearError, and answers undefined', async () => {
    const { result } = hook(true)
    let answer: unknown = 'unset'
    await act(async () => {
      answer = await result.current.run(() =>
        Promise.reject(new ApiError('Budget must be a non-negative amount', 422)),
      )
    })
    expect(answer).toBeUndefined()
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('Budget must be a non-negative amount')
    act(() => {
      vi.advanceTimersByTime(SAVED_MS * 4)
    })
    expect(result.current.status).toBe('error')
    act(() => {
      result.current.clearError()
    })
    expect(result.current.status).toBe('dirty')
    expect(result.current.error).toBeNull()
  })

  it('clears the error when the next run starts', async () => {
    const { result } = hook(true)
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error('nope')))
    })
    const save = deferred<void>()
    act(() => {
      void result.current.run(() => save.promise)
    })
    expect(result.current.status).toBe('saving')
    expect(result.current.error).toBeNull()
    await act(async () => save.resolve())
  })

  it('runs one save at a time — a second run while saving saves nothing', async () => {
    const { result } = hook(true)
    const first = deferred<string>()
    const second = vi.fn(async () => 'twice')
    let answer: unknown = 'unset'
    act(() => {
      void result.current.run(() => first.promise)
    })
    await act(async () => {
      answer = await result.current.run(second)
    })
    expect(second).not.toHaveBeenCalled()
    expect(answer).toBeUndefined()
    await act(async () => first.resolve('once'))
  })

  it('takes an aborted save as no save at all, not an error', async () => {
    const { result } = hook(true)
    await act(async () => {
      await result.current.run(() => Promise.reject(new DOMException('Aborted', 'AbortError')))
    })
    expect(result.current.status).toBe('dirty')
    expect(result.current.error).toBeNull()
  })

  it('arms no timer for a form that has gone', async () => {
    const { result, unmount } = hook(false)
    const save = deferred<void>()
    act(() => {
      void result.current.run(() => save.promise)
    })
    unmount()
    await act(async () => save.resolve())
    expect(vi.getTimerCount()).toBe(0)
  })
})

const state = (status: SaveStatusKind, error: string | null = null): SaveState => ({
  status,
  error,
  run: async () => undefined,
  clearError: () => {},
})

describe('SaveStatus', () => {
  it('says nothing while the form is clean', () => {
    const { container } = render(<SaveStatus state={state('clean')} />)
    expect(container.innerHTML).toBe('')
  })

  it('says "Unsaved changes", muted and unannounced, while dirty', () => {
    render(<SaveStatus state={state('dirty')} />)
    const line = screen.getByText('Unsaved changes')
    expect(line.className).toBe('save-status save-status-dirty')
    expect(line.hasAttribute('role')).toBe(false)
  })

  it('keeps one status region standing through the save, so "Saved ✓" is announced into it', () => {
    const { rerender } = render(<SaveStatus state={state('saving')} />)
    const region = screen.getByRole('status')
    expect(region.textContent).toBe('Saving…')
    rerender(<SaveStatus state={state('saved')} />)
    // The same node: a live region must exist before its news arrives.
    expect(screen.getByRole('status')).toBe(region)
    expect(region.textContent).toBe('Saved ✓')
    expect(region.className).toBe('save-status save-status-saved')
  })

  it('puts a failure in an alert, the message verbatim', () => {
    render(<SaveStatus state={state('error', 'Budget must be a non-negative amount')} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Budget must be a non-negative amount')
    expect(alert.className).toBe('save-status save-status-error')
  })
})

describe('SaveButton', () => {
  it('is quiet with nothing to save — clean, or just saved — and says why', () => {
    const onClick = vi.fn()
    for (const status of ['clean', 'saved'] as const) {
      const { unmount } = render(
        <SaveButton state={state(status)} onClick={onClick}>
          Save
        </SaveButton>,
      )
      const button = screen.getByRole('button', { name: 'Save' })
      expect(button.getAttribute('aria-disabled')).toBe('true')
      expect(button.getAttribute('title')).toBe('No changes to save')
      fireEvent.click(button)
      unmount()
    }
    expect(onClick).not.toHaveBeenCalled()
  })

  it('saves when dirty, and after a failure (the form still differs)', () => {
    const onClick = vi.fn()
    for (const status of ['dirty', 'error'] as const) {
      const { unmount } = render(
        <SaveButton state={state(status, status === 'error' ? 'nope' : null)} onClick={onClick} title="Save the budget">
          Save
        </SaveButton>,
      )
      const button = screen.getByRole('button', { name: 'Save' })
      expect(button.hasAttribute('aria-disabled')).toBe(false)
      expect(button.getAttribute('title')).toBe('Save the budget')
      fireEvent.click(button)
      unmount()
    }
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('is busy while saving: a spinner, aria-busy, quiet', () => {
    render(<SaveButton state={state('saving')}>Save</SaveButton>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.querySelector('.busy-spinner')).not.toBeNull()
  })

  it("keeps a caller's aria-disabled while there is something to save (an invalid form)", () => {
    render(
      <SaveButton state={state('dirty')} aria-disabled>
        Save
      </SaveButton>,
    )
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true')
  })
})

describe('the three together', () => {
  /** A budget editor, the way wave 2 wires one: the stored figure moves inside the save. */
  function BudgetForm({ save }: { save: (amount: string) => Promise<void> }) {
    const [stored, setStored] = useState('80')
    const [amount, setAmount] = useState('80')
    const saveState = useSaveState({ dirty: amount !== stored })
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void saveState.run(async () => {
            await save(amount)
            setStored(amount)
          })
        }}
      >
        <input
          aria-label="Budget"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value)
            saveState.clearError()
          }}
        />
        <SaveButton type="submit" className="button button-primary" state={saveState}>
          Save
        </SaveButton>
        <SaveStatus state={saveState} />
      </form>
    )
  }

  it('quiet, then live with "Unsaved changes", then busy, then quiet with "Saved ✓", then clean', async () => {
    const pending = deferred<void>()
    render(<BudgetForm save={() => pending.promise} />)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.change(screen.getByLabelText('Budget'), { target: { value: '95' } })
    expect(button.hasAttribute('aria-disabled')).toBe(false)
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    fireEvent.click(button)
    expect(button.getAttribute('aria-busy')).toBe('true')
    await act(async () => pending.resolve())
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.getAttribute('title')).toBe('No changes to save')
    expect(screen.getByRole('status').textContent).toBe('Saved ✓')
    act(() => {
      vi.advanceTimersByTime(SAVED_MS)
    })
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })
})
```

- [ ] **Step 2: Run — FAIL.** `npx vitest run src/components/feedback/save.test.tsx` → cannot resolve the three modules.

- [ ] **Step 3: Implement** — `src/components/feedback/useSaveState.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { errorDetail } from '../../api/client'

export type SaveStatusKind = 'clean' | 'dirty' | 'saving' | 'saved' | 'error'

export interface SaveState {
  status: SaveStatusKind
  error: string | null
  /** Runs the save: 'saving', then 'saved' for 2.5 s (then clean/dirty per `dirty`), or 'error' with the message. */
  run: <T>(save: () => Promise<T>) => Promise<T | undefined>
  clearError: () => void
}

/** How long "Saved ✓" stays (spec D3: ~2.5 s). */
export const SAVED_MS = 2500

type Phase = 'idle' | 'saving' | 'saved' | 'error'

/**
 * One form's save, told where the user acted (2026-09-25 polish spec D3; contract C3). `dirty` is the
 * form's own comparison with what is stored — update what it compares against INSIDE `save`, so the
 * status goes straight from saving to saved. "Saved ✓" shows only while the form still matches what
 * was saved: an edit inside its 2.5 s reads "Unsaved changes" at once. One save at a time — a run
 * while one is in flight saves nothing and answers undefined — and an aborted save is no save, not an
 * error. A failure keeps its message (errorDetail: the server's own sentence) until clearError or the
 * next run.
 */
export function useSaveState({ dirty }: { dirty: boolean }): SaveState {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  // One stable record for what the async path needs after the render that started it.
  const life = useRef({
    alive: true,
    saving: false,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  })

  useEffect(() => {
    const own = life.current
    own.alive = true
    return () => {
      own.alive = false
      clearTimeout(own.timer)
    }
  }, [])

  const run = useCallback(async <T>(save: () => Promise<T>): Promise<T | undefined> => {
    const own = life.current
    if (own.saving) return undefined
    own.saving = true
    clearTimeout(own.timer)
    setError(null)
    setPhase('saving')
    try {
      const result = await save()
      if (own.alive) {
        setPhase('saved')
        own.timer = setTimeout(() => setPhase('idle'), SAVED_MS)
      }
      return result
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setPhase('idle')
      } else {
        setError(errorDetail(err))
        setPhase('error')
      }
      return undefined
    } finally {
      own.saving = false
    }
  }, [])

  const clearError = useCallback(() => {
    setError(null)
    setPhase((current) => (current === 'error' ? 'idle' : current))
  }, [])

  const status: SaveStatusKind =
    phase === 'saving' || phase === 'error'
      ? phase
      : phase === 'saved' && !dirty
        ? 'saved'
        : dirty
          ? 'dirty'
          : 'clean'

  return useMemo(() => ({ status, error, run, clearError }), [status, error, run, clearError])
}
```

`src/components/feedback/SaveStatus.tsx`:

```tsx
import type { SaveState } from './useSaveState'
import '../panels.css'
import './feedback.css'

/**
 * What the Save beside it would do, said where the user is looking (2026-09-25 polish spec D3;
 * contract C3): nothing while clean, "Unsaved changes" (muted) while dirty, "Saved ✓" for its 2.5 s,
 * the failure's own sentence in an alert. The status region is already standing while the save runs
 * (with a hidden "Saving…"), because a live region has to exist before its news, or a screen reader
 * misses "Saved".
 */
export function SaveStatus({ state }: { state: SaveState }) {
  switch (state.status) {
    case 'clean':
      return null
    case 'dirty':
      return <span className="save-status save-status-dirty">Unsaved changes</span>
    case 'saving':
      return (
        <span className="save-status save-status-saving" role="status">
          <span className="visually-hidden">Saving…</span>
        </span>
      )
    case 'saved':
      return (
        <span className="save-status save-status-saved" role="status">
          Saved <span aria-hidden="true">✓</span>
        </span>
      )
    case 'error':
      // Keyed apart from the status line: an alert is announced when it is inserted.
      return (
        <span key="error" className="save-status save-status-error" role="alert">
          {state.error}
        </span>
      )
  }
}
```

`src/components/feedback/SaveButton.tsx`:

```tsx
import type { ButtonHTMLAttributes, Ref } from 'react'
import BusyButton from './BusyButton'
import type { SaveState } from './useSaveState'

export type SaveButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  state: SaveState
  /** React 19 ref-as-prop, passed through to the BusyButton. */
  ref?: Ref<HTMLButtonElement>
}

/**
 * A form's primary Save (2026-09-25 polish spec D3; contract C3): a BusyButton that is busy while its
 * state saves, and quiet — aria-disabled, titled "No changes to save" — while there is nothing to save:
 * the form is clean, or was just saved and not touched since. A caller's own aria-disabled (an invalid
 * form) still stands while there is something to save.
 */
export function SaveButton({ state, title, ...rest }: SaveButtonProps) {
  const nothingToSave = state.status === 'clean' || state.status === 'saved'
  return (
    <BusyButton
      {...rest}
      busy={state.status === 'saving'}
      aria-disabled={nothingToSave ? true : rest['aria-disabled']}
      title={nothingToSave ? 'No changes to save' : title}
    />
  )
}
```

- [ ] **Step 4: Run — PASS.** `npx vitest run src/components/feedback/save.test.tsx` → 17 passed.
- [ ] **Step 5: Lint.** `npx eslint src/components/feedback` → 0 problems.
- [ ] **Step 6: Commit.**

```bash
git add src/components/feedback/useSaveState.ts src/components/feedback/SaveStatus.tsx src/components/feedback/SaveButton.tsx src/components/feedback/save.test.tsx
git commit -m "feat(feedback): useSaveState + SaveStatus + SaveButton — quiet until dirty, Saved ✓ beside the button, errors beside it" -m "Contract C3 / spec D3: status clean|dirty|saving|saved|error; run() is single-flight, shows 'saved' for 2.5 s while the form still matches (an edit reads 'Unsaved changes' at once), keeps an error (errorDetail) until clearError or the next run, and treats an AbortError as no save. SaveStatus keeps one role=status region through saving→saved so 'Saved ✓' is announced; failures go in role=alert. SaveButton is a BusyButton, busy while saving, quiet with 'No changes to save' while clean or just saved."
```

---

### Task 8: The confirm popover — `confirmPlacement.ts` + `confirm.tsx`

**Files:** Create `src/components/feedback/confirmPlacement.ts`, `confirmPlacement.test.ts`, `confirm.tsx`,
`confirm.test.tsx`.

- [ ] **Step 1: Write the failing placement test** — `src/components/feedback/confirmPlacement.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CONFIRM_GAP_PX, CONFIRM_MARGIN_PX, placeConfirm } from './confirmPlacement'

const anchor = (top: number, right: number, height = 32) => ({ top, bottom: top + height, right })
const VIEW = { width: 1440, height: 900 }
const SIZE = { width: 300, height: 140 }

describe('placeConfirm', () => {
  it('opens below its anchor, right edges aligned', () => {
    expect(placeConfirm(anchor(200, 1000), SIZE, VIEW)).toEqual({
      top: 232 + CONFIRM_GAP_PX,
      left: 700,
      placement: 'below',
    })
  })

  it('flips above when there is no room below and more above', () => {
    // Below: 900 − 8 − (832 + 6) = 54px for a 140px popover; above: 800 − 6 − 8 = 786px.
    expect(placeConfirm(anchor(800, 1000), SIZE, VIEW)).toEqual({
      top: 800 - CONFIRM_GAP_PX - 140,
      left: 700,
      placement: 'above',
    })
  })

  it('stays below when it fits there, however much room there is above', () => {
    expect(placeConfirm(anchor(700, 1000), SIZE, VIEW).placement).toBe('below') // 900 − 8 − 738 = 154 ≥ 140
  })

  it('takes the roomier side when neither fits', () => {
    const short = { width: 1440, height: 200 }
    expect(placeConfirm(anchor(60, 1000), SIZE, short).placement).toBe('below') // 94 below, 46 above
    expect(placeConfirm(anchor(110, 1000), SIZE, short).placement).toBe('above') // 44 below, 96 above
  })

  it('keeps inside the window sideways', () => {
    expect(placeConfirm(anchor(200, 120), SIZE, VIEW).left).toBe(CONFIRM_MARGIN_PX)
    expect(placeConfirm(anchor(200, 1500), SIZE, VIEW).left).toBe(1440 - CONFIRM_MARGIN_PX - 300)
  })
})
```

- [ ] **Step 2: Write the failing provider test** — `src/components/feedback/confirm.test.tsx`:

```tsx
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmProvider, useConfirm } from './confirm'
import type { ConfirmOptions } from './confirm'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** The answers the harness's questions got, in asking order. */
let answers: Promise<boolean>[] = []

/** A page with two controls that ask, inside the `.page` box the popover must escape. */
function Page({ options, showAnchor = true }: { options?: Partial<ConfirmOptions>; showAnchor?: boolean }) {
  const confirm = useConfirm()
  const ask = (anchor: HTMLElement, title: string) => {
    answers.push(confirm({ anchor, title, confirmLabel: 'Delete 2025', ...options }))
  }
  return (
    <div className="page">
      {showAnchor && (
        <button type="button" onClick={(event) => ask(event.currentTarget, 'Delete tax year 2025?')}>
          Delete 2025…
        </button>
      )}
      <button type="button" onClick={(event) => ask(event.currentTarget, 'Delete tax year 2024?')}>
        Delete 2024…
      </button>
      <p>Elsewhere</p>
    </div>
  )
}

function renderPage(props: { options?: Partial<ConfirmOptions>; showAnchor?: boolean } = {}) {
  answers = []
  return render(
    <ConfirmProvider>
      <Page {...props} />
    </ConfirmProvider>,
  )
}

const open = (name = 'Delete 2025…') => fireEvent.click(screen.getByRole('button', { name }))

describe('ConfirmProvider', () => {
  it('portals the question out of the page, labelled by its title and described by its body', () => {
    renderPage({ options: { body: 'Its inputs and brackets go with it.' } })
    open()
    const dialog = screen.getByRole('alertdialog', { name: 'Delete tax year 2025?' })
    // .page is a containing block for fixed descendants: the popover has to live outside it.
    expect(dialog.closest('.page')).toBeNull()
    expect(dialog.parentElement).toBe(document.body)
    const body = document.getElementById(dialog.getAttribute('aria-describedby') ?? '')
    expect(body?.textContent).toBe('Its inputs and brackets go with it.')
    expect(dialog.className).toBe('popover-surface confirm-popover') // the house pop-in
  })

  it('puts the caret on Cancel first', () => {
    renderPage()
    open()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('wraps Tab inside the popover, both ways', () => {
    renderPage()
    open()
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Delete 2025' })
    confirm.focus()
    expect(fireEvent.keyDown(confirm, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(cancel)
    expect(fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(document.activeElement).toBe(confirm)
  })

  it('answers yes on Confirm, and hands the focus back to the control that asked', async () => {
    renderPage()
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2025' }))
    await expect(answers[0]).resolves.toBe(true)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete 2025…' }))
  })

  it('answers no on Cancel, on Escape and on a pointerdown outside — focus back on the asker each time', async () => {
    renderPage()
    const asker = screen.getByRole('button', { name: 'Delete 2025…' })
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(document.activeElement).toBe(asker)
    open()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(document.activeElement).toBe(asker)
    open()
    fireEvent.pointerDown(screen.getByText('Elsewhere'))
    expect(document.activeElement).toBe(asker)
    expect(await Promise.all(answers)).toEqual([false, false, false])
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('asks one question at a time: a second one answers the first "no"', async () => {
    renderPage()
    open('Delete 2025…')
    open('Delete 2024…')
    await expect(answers[0]).resolves.toBe(false)
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
    expect(screen.getByRole('alertdialog', { name: 'Delete tax year 2024?' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('leaves the focus alone when the control that asked has gone', async () => {
    const view = renderPage()
    open()
    view.rerender(
      <ConfirmProvider>
        <Page showAnchor={false} />
      </ConfirmProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await expect(answers[0]).resolves.toBe(false)
    expect(document.activeElement).toBe(document.body)
  })

  it('keeps Confirm quiet until the typed arm matches (Restore)', async () => {
    renderPage({ options: { typedArm: { expected: '2026-09-04', prompt: "Type the snapshot's date to confirm" } } })
    open()
    const confirm = screen.getByRole('button', { name: 'Delete 2025' })
    expect(confirm.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(confirm) // swallowed: still open, still unanswered
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    const typed = screen.getByLabelText("Type the snapshot's date to confirm")
    fireEvent.change(typed, { target: { value: '2026-09-0' } })
    expect(confirm.getAttribute('aria-disabled')).toBe('true')
    fireEvent.change(typed, { target: { value: ' 2026-09-04 ' } })
    expect(confirm.hasAttribute('aria-disabled')).toBe(false)
    fireEvent.click(confirm)
    await expect(answers[0]).resolves.toBe(true)
  })

  it('confirms from the typed arm with Enter once it matches, and not before', async () => {
    renderPage({ options: { typedArm: { expected: '2026-09-04', prompt: 'Type the date' } } })
    open()
    const typed = screen.getByLabelText('Type the date')
    fireEvent.keyDown(typed, { key: 'Enter' })
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    fireEvent.change(typed, { target: { value: '2026-09-04' } })
    fireEvent.keyDown(typed, { key: 'Enter' })
    await expect(answers[0]).resolves.toBe(true)
  })

  it('draws a danger Confirm by default, a primary one on request, and a custom Cancel', () => {
    renderPage()
    open()
    expect(screen.getByRole('button', { name: 'Delete 2025' }).className).toBe('button danger-button busy-button')
    cleanup()
    renderPage({ options: { tone: 'default', confirmLabel: 'Apply 3 overrides', cancelLabel: 'Keep editing' } })
    open()
    expect(screen.getByRole('button', { name: 'Apply 3 overrides' }).className).toBe('button button-primary busy-button')
    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeTruthy()
  })

  it('stands beside its anchor, follows it on scroll and resize, and lets go of an anchor that left', async () => {
    const view = renderPage()
    const anchor = screen.getByRole('button', { name: 'Delete 2025…' })
    let top = 200
    anchor.getBoundingClientRect = () =>
      ({ top, bottom: top + 32, left: 600, right: 700, width: 100, height: 32, x: 600, y: top, toJSON: () => ({}) }) as DOMRect
    open()
    const dialog = screen.getByRole('alertdialog')
    // jsdom sizes the popover 0 × 0: below the anchor by the gap, right edges aligned.
    expect(dialog.style.top).toBe('238px')
    expect(dialog.style.left).toBe('700px')
    expect(dialog.getAttribute('data-placement')).toBe('below')
    top = 120
    fireEvent.scroll(window)
    expect(dialog.style.top).toBe('158px')
    top = 150
    fireEvent(window, new Event('resize'))
    expect(dialog.style.top).toBe('188px')
    view.rerender(
      <ConfirmProvider>
        <Page showAnchor={false} />
      </ConfirmProvider>,
    )
    fireEvent.scroll(window)
    await expect(answers[0]).resolves.toBe(false)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('answers "no" to a question it can no longer show (the provider unmounted)', async () => {
    const view = renderPage()
    open()
    view.unmount()
    await expect(answers[0]).resolves.toBe(false)
  })
})

describe('useConfirm', () => {
  it('renders without a provider, and throws only when asked — a question nobody can see must not answer', () => {
    const { result } = renderHook(() => useConfirm())
    const anchor = document.createElement('button')
    expect(() => result.current({ anchor, title: 'Delete?', confirmLabel: 'Delete' })).toThrow(/ConfirmProvider/)
  })
})
```

- [ ] **Step 3: Run — FAIL.** `npx vitest run src/components/feedback/confirmPlacement.test.ts src/components/feedback/confirm.test.tsx`
  → cannot resolve `./confirmPlacement` / `./confirm`.

- [ ] **Step 4: Implement** — `src/components/feedback/confirmPlacement.ts`:

```ts
/** Viewport px between the popover and its anchor, and the least room kept to the window's edges. */
export const CONFIRM_GAP_PX = 6
export const CONFIRM_MARGIN_PX = 8

export interface ConfirmSpot {
  top: number
  left: number
  placement: 'below' | 'above'
}

/**
 * Where the confirm popover stands (2026-09-25 polish spec §6.3; contract C3), in viewport px for
 * `position: fixed`: below its anchor with the right edges aligned — it opens toward the page, as a
 * control at the page's right edge must (panels.css's popover note) — flipped above when it would
 * cross the window's foot and there is more room above, and kept inside the window sideways. Pure, so
 * the rule is tested without a layout engine.
 */
export function placeConfirm(
  anchor: Pick<DOMRect, 'top' | 'bottom' | 'right'>,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): ConfirmSpot {
  const roomBelow = viewport.height - CONFIRM_MARGIN_PX - (anchor.bottom + CONFIRM_GAP_PX)
  const roomAbove = anchor.top - CONFIRM_GAP_PX - CONFIRM_MARGIN_PX
  const placement = size.height <= roomBelow || roomBelow >= roomAbove ? 'below' : 'above'
  const top = placement === 'below' ? anchor.bottom + CONFIRM_GAP_PX : anchor.top - CONFIRM_GAP_PX - size.height
  const left = Math.max(
    CONFIRM_MARGIN_PX,
    Math.min(anchor.right - size.width, viewport.width - CONFIRM_MARGIN_PX - size.width),
  )
  return { top, left, placement }
}
```

`src/components/feedback/confirm.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverDismiss } from '../usePopoverDismiss'
import BusyButton from './BusyButton'
import { placeConfirm } from './confirmPlacement'
import '../panels.css'
import './feedback.css'

export interface ConfirmOptions {
  /** The control that asked: the popover sits beside it, and focus returns to it. */
  anchor: HTMLElement
  /** "Delete tax year 2025?" */
  title: string
  /** What will be lost, or what happens. */
  body?: ReactNode
  /** "Delete 2025" */
  confirmLabel: string
  /** Default "Cancel". */
  cancelLabel?: string
  /** Default 'danger'. */
  tone?: 'danger' | 'default'
  /** Restore only: Confirm stays quiet until the typed text matches `expected`. */
  typedArm?: { expected: string; prompt: string }
}

type Ask = (options: ConfirmOptions) => Promise<boolean>

interface Question {
  id: number
  options: ConfirmOptions
  answer: (yes: boolean) => void
}

const ConfirmContext = createContext<Ask | null>(null)

/**
 * The one in-app confirm (2026-09-25 polish spec D2, §6.3; contract C3), mounted once in App.tsx inside
 * the ToastProvider. `useConfirm()(options)` opens a popover beside `options.anchor` and resolves true
 * (Confirm) or false (Cancel, Escape, a pointerdown outside, or a newer question). It replaces
 * `window.confirm`, which left the app — noNativeConfirm.test.ts fences that out.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [question, setQuestion] = useState<Question | null>(null)
  // The live question, for the async paths (a second ask, a settle) that must not trust the closure of
  // the render that made them.
  const live = useRef<Question | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const nextId = useRef(1)

  const ask = useCallback<Ask>(
    (options) =>
      new Promise<boolean>((resolve) => {
        const previous = live.current
        const next: Question = { id: nextId.current, options, answer: resolve }
        nextId.current += 1
        live.current = next
        anchorRef.current = options.anchor
        setQuestion(next)
        // One question at a time: a newer one answers the older "no". Its popover is replaced, and the
        // focus goes to the new one's Cancel rather than back to the old anchor.
        previous?.answer(false)
      }),
    [],
  )

  const settle = useCallback((settled: Question, yes: boolean) => {
    if (live.current !== settled) return
    live.current = null
    setQuestion(null)
    // Back to the control that asked, if it is still there to take it — before the answer, so whatever
    // the caller does next starts from there.
    if (settled.options.anchor.isConnected) settled.options.anchor.focus()
    settled.answer(yes)
  }, [])

  // A question the provider can no longer show (it unmounted: a logout) answers "no" — a promise left
  // pending would hold its caller forever. Answering twice is harmless: a promise settles once.
  useEffect(() => {
    if (question === null) return
    return () => question.answer(false)
  }, [question])

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {question !== null &&
        createPortal(
          <ConfirmPopover key={question.id} question={question} anchorRef={anchorRef} onSettle={settle} />,
          document.body,
        )}
    </ConfirmContext.Provider>
  )
}

const unprovided: Ask = () => {
  throw new Error('useConfirm() asked outside a <ConfirmProvider> — App.tsx mounts one; a test renders its own')
}

/** The ask. Outside a ConfirmProvider (a test rendering its host bare) it still renders, and throws
 *  only when asked: a question nobody can see must never quietly answer "no". */
// eslint-disable-next-line react-refresh/only-export-components -- C3 names ONE module for the provider and its hook (ToastProvider's shape); a hot edit here reloads the page instead
export function useConfirm(): Ask {
  return useContext(ConfirmContext) ?? unprovided
}

function ConfirmPopover({
  question,
  anchorRef,
  onSettle,
}: {
  question: Question
  anchorRef: RefObject<HTMLElement | null>
  onSettle: (question: Question, yes: boolean) => void
}) {
  const { options } = question
  const { anchor, typedArm } = options
  const tone = options.tone ?? 'danger'
  const surfaceRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const bodyId = useId()
  const [typed, setTyped] = useState('')
  const armed = typedArm === undefined || typed.trim() === typedArm.expected
  const cancel = useCallback(() => onSettle(question, false), [onSettle, question])
  const confirm = () => {
    if (armed) onSettle(question, true)
  }

  // Escape (caught in the capture phase, ahead of the detail panel's own) and a pointerdown outside
  // both the popover and its anchor answer "no" — the house dismissal contract.
  usePopoverDismiss(true, cancel, anchorRef, surfaceRef)

  // Beside the anchor before the first paint, and after it on every scroll (capture: scroll events do
  // not bubble) and resize. An anchor that has left the page takes its question with it.
  useLayoutEffect(() => {
    const surface = surfaceRef.current
    if (surface === null) return
    const place = () => {
      if (!anchor.isConnected) {
        cancel()
        return
      }
      const spot = placeConfirm(
        anchor.getBoundingClientRect(),
        { width: surface.offsetWidth, height: surface.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      )
      surface.style.top = `${spot.top}px`
      surface.style.left = `${spot.left}px`
      surface.dataset.placement = spot.placement
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchor, cancel])

  // Cancel first (spec D2): the safe answer is the one under the caret.
  useLayoutEffect(() => {
    cancelRef.current?.focus({ preventScroll: true })
  }, [])

  // Tab walks the popover's own controls and wraps at both ends.
  const trapTab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const stops = Array.from(surfaceRef.current?.querySelectorAll<HTMLElement>('input, button') ?? [])
    const first = stops[0]
    const last = stops[stops.length - 1]
    if (first === undefined || last === undefined) return
    const edge = event.shiftKey ? first : last
    if (document.activeElement !== edge) return
    event.preventDefault()
    const wrapTo = event.shiftKey ? last : first
    wrapTo.focus()
  }

  return (
    <div
      ref={surfaceRef}
      className="popover-surface confirm-popover"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={options.body === undefined ? undefined : bodyId}
      data-tone={tone}
      onKeyDown={trapTab}
    >
      <p id={titleId} className="confirm-popover-title">
        {options.title}
      </p>
      {options.body !== undefined && (
        <div id={bodyId} className="confirm-popover-body">
          {options.body}
        </div>
      )}
      {typedArm !== undefined && (
        <label className="confirm-popover-arm">
          {typedArm.prompt}
          <input
            className="field-input"
            value={typed}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              confirm()
            }}
          />
        </label>
      )}
      <div className="confirm-popover-actions">
        <button ref={cancelRef} type="button" className="button" onClick={cancel}>
          {options.cancelLabel ?? 'Cancel'}
        </button>
        <BusyButton
          type="button"
          className={tone === 'danger' ? 'button danger-button' : 'button button-primary'}
          aria-disabled={!armed}
          onClick={confirm}
        >
          {options.confirmLabel}
        </BusyButton>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run — PASS.** `npx vitest run src/components/feedback/confirmPlacement.test.ts src/components/feedback/confirm.test.tsx`
  → 5 + 13 passed.
- [ ] **Step 6: Lint.** `npx eslint src/components/feedback` → 0 problems (the one directive is on `useConfirm`).
- [ ] **Step 7: Commit.**

```bash
git add src/components/feedback/confirmPlacement.ts src/components/feedback/confirmPlacement.test.ts src/components/feedback/confirm.tsx src/components/feedback/confirm.test.tsx
git commit -m "feat(feedback): ConfirmProvider + useConfirm — the one in-app confirm, anchored to the control that asked" -m "Contract C3 / spec D2: portaled to <body> (.page contains fixed descendants), fixed beside the anchor via the pure placeConfirm (below, right-aligned, flips above when there is no room, kept inside the window), re-placed on any scroll and resize; role=alertdialog labelled/described; Cancel takes the caret, Tab wraps; Escape and an outside pointerdown answer false through usePopoverDismiss, Confirm true; a second question answers the first false; focus returns to a still-connected anchor; the typed arm keeps Confirm aria-disabled until it matches; an unmounted provider answers false."
```

---

### Task 9: Mount `ConfirmProvider` in `App.tsx`

**Files:** Modify `src/App.tsx`, `src/App.test.tsx`.

- [ ] **Step 1: Write the failing test.** In `src/App.test.tsx`'s `vi.mock('./components/Layout', …)` factory, add
  `const { useConfirm } = await import('./components/feedback/confirm')` after the MetricInspector import, and inside the
  mocked `Layout` function add `const confirm = useConfirm()` and, after the "Open financial question" button:

```tsx
      <button onClick={(event) => {
        void confirm({ anchor: event.currentTarget, title: 'Leave the page?', confirmLabel: 'Leave' })
      }}>Ask a question</button>
```

  Then append:

```tsx
describe('the in-app confirm (2026-09-25 polish spec §6.3)', () => {
  it('is mounted once for the whole signed-in app, its popover outside every page', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Page /' })
    fireEvent.click(screen.getByRole('button', { name: 'Ask a question' }))
    const popover = screen.getByRole('alertdialog', { name: 'Leave the page?' })
    expect(popover.parentElement).toBe(document.body)
  })
})
```

- [ ] **Step 2: Run — FAIL.** `npx vitest run src/App.test.tsx` → the new test throws "useConfirm() asked outside a
  <ConfirmProvider>".

- [ ] **Step 3: Implement.** In `src/App.tsx`, import `{ ConfirmProvider } from './components/feedback/confirm'` (after
  the `ToastProvider` import) and wrap the router:

```tsx
        <ToastProvider>
          {/* The one in-app confirm (2026-09-25 polish spec §6.3): inside the toasts, so a question and
              the Undo that may follow it share one layer; outside the router, which it never needs. */}
          <ConfirmProvider>
            <BrowserRouter>
              …unchanged…
            </BrowserRouter>
          </ConfirmProvider>
        </ToastProvider>
```

- [ ] **Step 4: Run — PASS.** `npx vitest run src/App.test.tsx` → all pass.
- [ ] **Step 5: Commit.**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat(app): mount ConfirmProvider inside ToastProvider" -m "One in-app confirm for the whole app (contract C3), above the router so every route and the detail panel can ask; App.test proves a page's question lands on <body>."
```

---

### Task 10: `useDeleteWithUndo`

**Files:** Create `src/components/feedback/useDeleteWithUndo.ts`, `src/components/feedback/useDeleteWithUndo.test.tsx`.

- [ ] **Step 1: Write the failing test** — `src/components/feedback/useDeleteWithUndo.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import ToastProvider from '../ToastProvider'
import type { ActivityBatch } from '../../types/api'
import { useDeleteWithUndo } from './useDeleteWithUndo'

vi.mock('../../api/lifecycle', () => ({ undoBatch: vi.fn() }))
import { undoBatch } from '../../api/lifecycle'

interface Security {
  id: number
  ticker: string
}
const ALL: Security[] = [
  { id: 1, ticker: 'VOO' },
  { id: 2, ticker: 'VTI' },
  { id: 3, ticker: 'BND' },
]
const BATCH: ActivityBatch = {
  type: 'batch',
  batch_id: 'b-1',
  at: '2026-09-25T12:00:00Z',
  source: 'undo',
  actor: null,
  label: 'Undid: Deleted security VOO',
  month: null,
  rows: 3,
  undoable: false,
  undone_by: null,
}

/** What the "server" holds; the list reloads from it. */
let stored: Security[] = []
/** The hook's answers, in pressing order. */
let results: Promise<boolean>[] = []
const request = vi.fn<() => Promise<{ batchId: string | null }>>()
/** Every reload passes through here, so a test can hold one open (onDeleted / onRestored are awaited). */
const reloadGate = vi.fn<() => Promise<void>>()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

/** The server side of a delete: the row leaves the store and the batch is named. */
const deletes = (id: number, batchId: string | null = 'b-1') => async () => {
  stored = stored.filter((row) => row.id !== id)
  return { batchId }
}

/** A list the way a wave-2 panel is one: rows keyed by id, each with Edit and Delete, reloading from `stored`. */
function List({ keepRows = false }: { keepRows?: boolean }) {
  const [rows, setRows] = useState<Security[]>(stored)
  const remove = useDeleteWithUndo()
  const reload = async () => {
    await reloadGate()
    if (!keepRows) setRows([...stored])
  }
  return (
    <ul>
      {rows.map((row, index) => {
        const next = rows[index + 1] ?? rows[index - 1]
        return (
          <li key={row.id} data-row={row.id}>
            {row.ticker}
            <button type="button">Edit {row.ticker}</button>
            <button
              type="button"
              onClick={(event) => {
                results.push(
                  remove({
                    name: `security ${row.ticker}`,
                    row: event.currentTarget.closest('li'),
                    request,
                    onDeleted: reload,
                    focusAfter: () => document.querySelector<HTMLElement>(`[data-row="${next?.id}"] button:last-of-type`),
                    onRestored: reload,
                    restoredRow: () => document.querySelector<HTMLElement>(`[data-row="${row.id}"]`),
                  }),
                )
              }}
            >
              Delete {row.ticker}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

const renderList = (keepRows = false) =>
  render(
    <ToastProvider>
      <List keepRows={keepRows} />
    </ToastProvider>,
  )
const polite = () => document.querySelector('.toast-region:not(.toast-region-alert)')?.textContent ?? ''
const alerts = () => document.querySelector('.toast-region-alert')?.textContent ?? ''
const row = (id: number) => document.querySelector<HTMLElement>(`[data-row="${id}"]`)

beforeEach(() => {
  stored = [...ALL]
  results = []
  request.mockReset()
  reloadGate.mockReset()
  reloadGate.mockResolvedValue(undefined)
  vi.mocked(undoBatch).mockReset()
  // jsdom has no scrollIntoView; revealRow reaches for it on a row with no scrolling ancestor.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

describe('useDeleteWithUndo', () => {
  it('fades the row while the delete runs, then reloads, moves the focus on and offers Undo', async () => {
    const answer = deferred<{ batchId: string | null }>()
    request.mockReturnValueOnce(answer.promise)
    renderList()
    const del = screen.getByRole('button', { name: 'Delete VOO' })
    del.focus()
    fireEvent.click(del)
    expect(row(1)?.hasAttribute('data-leaving')).toBe(true)
    expect(polite()).toBe('')
    stored = stored.filter((s) => s.id !== 1)
    answer.resolve({ batchId: 'b-1' })
    await waitFor(() => expect(polite()).toContain('Deleted security VOO'))
    expect(row(1)).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete VTI' }))
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
    await expect(results[0]).resolves.toBe(true)
  })

  it('waits for onDeleted before it moves the focus or says anything', async () => {
    const reload = deferred<void>()
    reloadGate.mockReturnValueOnce(reload.promise)
    request.mockImplementationOnce(deletes(1))
    renderList()
    const del = screen.getByRole('button', { name: 'Delete VOO' })
    del.focus()
    fireEvent.click(del)
    await waitFor(() => expect(reloadGate).toHaveBeenCalledTimes(1))
    expect(polite()).toBe('')
    expect(document.activeElement).toBe(del)
    reload.resolve()
    await waitFor(() => expect(polite()).toContain('Deleted security VOO'))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete VTI' }))
  })

  it('Undo restores the exact batch, reloads, then reveals, flashes and focuses the row it brought back', async () => {
    request.mockImplementationOnce(deletes(1))
    vi.mocked(undoBatch).mockImplementationOnce(async () => {
      stored = [...ALL]
      return BATCH
    })
    renderList()
    const del = screen.getByRole('button', { name: 'Delete VOO' })
    del.focus()
    fireEvent.click(del)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(polite()).toContain('Restored security VOO'))
    expect(undoBatch).toHaveBeenCalledWith('b-1')
    const back = row(1) as HTMLElement
    expect(back.hasAttribute('data-flash')).toBe(true)
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts).toContain(back)
    // The same control the delete was pressed on, in the row that came back.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete VOO' }))
  })

  it("puts the row back and says the server's sentence when the delete is refused", async () => {
    request.mockRejectedValueOnce(new ApiError('VOO has 12 transactions — delete them first', 409))
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Delete VOO' }))
    await waitFor(() => expect(alerts()).toContain('VOO has 12 transactions — delete them first'))
    expect(row(1)?.hasAttribute('data-leaving')).toBe(false)
    expect(reloadGate).not.toHaveBeenCalled()
    expect(polite()).toBe('')
    await expect(results[0]).resolves.toBe(false)
  })

  it('says the refusal when the Undo is refused, and leaves the row deleted', async () => {
    request.mockImplementationOnce(deletes(1))
    vi.mocked(undoBatch).mockRejectedValueOnce(new ApiError('Later changes touched these rows — undo those first', 409))
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Delete VOO' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(alerts()).toContain('Later changes touched these rows — undo those first'))
    expect(row(1)).toBeNull()
    expect(reloadGate).toHaveBeenCalledTimes(1) // onDeleted only; onRestored never ran
    expect(polite()).not.toContain('Restored')
  })

  it('offers no Undo when nothing was recorded', async () => {
    request.mockImplementationOnce(deletes(1, null))
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Delete VOO' }))
    await waitFor(() => expect(polite()).toContain('Deleted security VOO'))
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('takes a second press on a leaving row as the same delete, not a second one', async () => {
    const answer = deferred<{ batchId: string | null }>()
    request.mockReturnValueOnce(answer.promise)
    renderList()
    const del = screen.getByRole('button', { name: 'Delete VOO' })
    fireEvent.click(del)
    fireEvent.click(del)
    expect(request).toHaveBeenCalledTimes(1)
    await expect(results[1]).resolves.toBe(false)
    stored = stored.filter((s) => s.id !== 1)
    answer.resolve({ batchId: 'b-1' })
    await waitFor(() => expect(polite()).toContain('Deleted security VOO'))
  })

  it('does not leave faded a row the reload kept', async () => {
    request.mockImplementationOnce(async () => ({ batchId: 'b-1' }))
    renderList(true)
    fireEvent.click(screen.getByRole('button', { name: 'Delete VOO' }))
    await waitFor(() => expect(polite()).toContain('Deleted security VOO'))
    expect(row(1)?.hasAttribute('data-leaving')).toBe(false)
  })

  it('still restores, and says so, when the list has gone by the time Undo is pressed', async () => {
    request.mockImplementationOnce(deletes(1))
    vi.mocked(undoBatch).mockResolvedValueOnce(BATCH)
    const view = renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Delete VOO' }))
    const undo = await screen.findByRole('button', { name: 'Undo' })
    view.rerender(<ToastProvider>{null}</ToastProvider>)
    fireEvent.click(undo)
    await waitFor(() => expect(polite()).toContain('Restored security VOO'))
    expect(undoBatch).toHaveBeenCalledWith('b-1')
  })
})
```

- [ ] **Step 2: Run — FAIL.** `npx vitest run src/components/feedback/useDeleteWithUndo.test.tsx` → cannot resolve
  `./useDeleteWithUndo`.

- [ ] **Step 3: Implement** — `src/components/feedback/useDeleteWithUndo.ts`:

```ts
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { errorDetail } from '../../api/client'
import { undoBatch } from '../../api/lifecycle'
import { useToast } from '../ToastProvider'
import { flashElement, revealRow } from './reveal'
import './feedback.css'

export interface DeleteWithUndoOptions {
  /** "security VOO" → toast "Deleted security VOO" */
  name: string
  /** Takes data-leaving (fade/collapse) while the request runs. */
  row?: HTMLElement | null
  request: () => Promise<{ batchId: string | null }>
  /** Reload the list; awaited before focus moves and the toast shows. */
  onDeleted?: () => void | Promise<void>
  /** E.g. the next row's same control; evaluated after onDeleted. */
  focusAfter?: () => HTMLElement | null
  /** Reload after a successful Undo. */
  onRestored?: () => void | Promise<void>
  /** Flashed + revealed + focused after onRestored. */
  restoredRow?: () => HTMLElement | null
}

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** Rows whose delete is in flight: a second press on a leaving row is not a second delete. */
const leaving = new WeakSet<HTMLElement>()

const controlsOf = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))

/** Focus the row an Undo brought back where the delete was pressed: the row itself when it takes focus,
 *  else the control at the same place in it as the one that asked (its Delete), else its first. */
function focusRestored(row: HTMLElement, asked: number): void {
  if (row.matches(FOCUSABLE)) {
    row.focus()
    return
  }
  const controls = controlsOf(row)
  const target = controls[asked] ?? controls[0]
  target?.focus()
}

/** A reload the caller runs after a write. Its failure is the caller's to show (its load path's
 *  banner): the delete, or the undo, already happened — and its toast still has to say so. */
async function quietly(reload: (() => void | Promise<void>) | undefined): Promise<void> {
  try {
    await reload?.()
  } catch {
    // Reported by the caller's own load path (above).
  }
}

/**
 * A promise for "React has committed everything scheduled so far" — the reload onDeleted or onRestored
 * set in motion included. A state tick scheduled after those updates lands in the same render (one
 * lane, one batch), and its layout effect runs once that render is in the DOM, so focusAfter and
 * restoredRow read the list as it now stands. An owner that has unmounted (an Undo pressed after the
 * page was left) resolves at once: nothing will commit for it again.
 */
function useAfterCommit(): () => Promise<void> {
  const [tick, setTick] = useState(0)
  const waiting = useRef<(() => void)[]>([])
  const mounted = useRef(false)

  useLayoutEffect(() => {
    for (const release of waiting.current.splice(0)) release()
  }, [tick])

  useEffect(() => {
    mounted.current = true
    const queue = waiting.current
    return () => {
      mounted.current = false
      for (const release of queue.splice(0)) release()
    }
  }, [])

  return useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (!mounted.current) {
          resolve()
          return
        }
        waiting.current.push(resolve)
        setTick((n) => n + 1)
      }),
    [],
  )
}

/**
 * The delete grammar (2026-09-25 polish spec D2, §6.3; contract C3): instant, then Undo. The row fades
 * (data-leaving) while the request runs; the list reloads (onDeleted); focus moves on (focusAfter); and
 * "Deleted {name}" offers Undo — the change batch's exact undo, which brings the row back with its id,
 * its place and its dependants — then reloads (onRestored) and reveals, flashes and focuses the row
 * (restoredRow). A refused delete puts the row back and toasts the server's sentence; so does a refused
 * Undo. A null batch (nothing recorded) offers no Undo. Resolves true when the row was deleted.
 *
 * Tests: drive it with a click and wait with findBy / waitFor. Awaiting the returned promise INSIDE
 * act(async …) deadlocks: it waits for a React commit that act holds back until its callback settles.
 */
export function useDeleteWithUndo(): (options: DeleteWithUndoOptions) => Promise<boolean> {
  const toast = useToast()
  const afterCommit = useAfterCommit()

  return useCallback(
    async (options: DeleteWithUndoOptions): Promise<boolean> => {
      const { name, request } = options
      const row = options.row ?? null
      if (row !== null && leaving.has(row)) return false
      // Which of the row's controls asked, so an Undo can hand the focus back to the same one.
      const active = document.activeElement
      const asked =
        row !== null && active instanceof HTMLElement && row.contains(active)
          ? controlsOf(row).indexOf(active)
          : -1
      if (row !== null) {
        leaving.add(row)
        row.setAttribute('data-leaving', '')
      }
      let batchId: string | null
      try {
        batchId = (await request()).batchId
      } catch (err) {
        if (row !== null) {
          leaving.delete(row)
          row.removeAttribute('data-leaving')
        }
        toast.error(errorDetail(err))
        return false
      }
      await quietly(options.onDeleted)
      await afterCommit()
      if (row !== null) {
        leaving.delete(row)
        // Still in the tree after the reload: an element the list reused, or a list that kept the row.
        // Either way it must not stay faded.
        if (row.isConnected) row.removeAttribute('data-leaving')
      }
      options.focusAfter?.()?.focus()
      if (batchId === null) {
        toast.success(`Deleted ${name}`)
        return true
      }
      const batch = batchId
      const undo = async () => {
        try {
          await undoBatch(batch)
        } catch (err) {
          toast.error(errorDetail(err))
          return
        }
        await quietly(options.onRestored)
        await afterCommit()
        const restored = options.restoredRow?.() ?? null
        if (restored !== null) {
          revealRow(restored)
          flashElement(restored)
          focusRestored(restored, asked)
        }
        toast.success(`Restored ${name}`)
      }
      toast.success(`Deleted ${name}`, { action: { label: 'Undo', onAction: () => void undo() } })
      return true
    },
    [toast, afterCommit],
  )
}
```

- [ ] **Step 4: Run — PASS.** `npx vitest run src/components/feedback/useDeleteWithUndo.test.tsx` → 9 passed.
- [ ] **Step 5: Lint.** `npx eslint src/components/feedback` → 0 problems.
- [ ] **Step 6: Commit.**

```bash
git add src/components/feedback/useDeleteWithUndo.ts src/components/feedback/useDeleteWithUndo.test.tsx
git commit -m "feat(feedback): useDeleteWithUndo — instant delete, exact batch Undo, focus that never falls to <body>" -m "Contract C3 / spec D2 §6.3: the row takes data-leaving while the request runs; onDeleted is awaited and React's commit of it too (a same-lane state tick), then focusAfter() takes focus and 'Deleted {name}' offers Undo (none for a null batch). Undo = undoBatch(batchId) → onRestored → revealRow + flashElement + focus of restoredRow() (the same control that asked) → 'Restored {name}'. A refused delete removes data-leaving and toasts errorDetail; a refused Undo toasts the server's refusal. A second press on a leaving row is ignored; a kept row is un-faded; an unmounted owner still restores."
```

---

### Task 11: The native-confirm fence

**Files:** Create `src/components/feedback/noNativeConfirm.test.ts`.

- [ ] **Step 1: Write the fence** (a test is the deliverable; its matcher test is the red/green part):

```ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// The native confirm leaves the app (2026-09-25 polish spec D2, §6.3). `window.confirm` halts the page
// on a grey OS dialog that cannot say what an action will cost, cannot offer Undo and ignores the
// theme; the app asks through useConfirm() (feedback/confirm.tsx) instead — or, for anything the change
// log can reverse, does not ask at all (useDeleteWithUndo). Enforced over the source tree rather than
// by review, by walking the TypeScript AST (clockFence.test.ts's matcher, so comments and strings never
// count): `window.confirm` / `globalThis.confirm` / `self.confirm` in any form, and a bare
// `confirm(…)` call in a file that binds no `confirm` of its own — `const confirm = useConfirm()` is the
// house hook, not the browser's.
//
// HOW THE LIST SHRINKS. ALLOWLIST holds the calls that stood when lane L4 landed, counted per file. The
// wave-2 lane that converts a call lowers its file's count — or deletes the entry — in the SAME commit;
// the exact-count test fails until it does, and no file may join or grow (ALLOWLIST_AT_LANDING is the
// ceiling). Lane V, once wave 2 has merged, adds the test that pins the list empty, as
// clockFence.test.ts did when its list emptied:
//   it('the allowlist is empty — wave 2 converted every native confirm', () => expect(ALLOWLIST).toEqual({}))

const SRC = path.resolve(__dirname, '../..')

/** Native confirms still standing, counted per file, with the lane that converts each (spec §6.4). */
const ALLOWLIST: Record<string, number> = {
  'components/portfolio/SecuritiesPanel.tsx': 1, // L6: security delete → instant + Undo
  'components/settings/RestoreCard.tsx': 1, // L5: Restore → the popover, its typed date arm inside
  'components/taxes/BracketsEditor.tsx': 2, // L7: the status tab's discard guard; emptying a table
  'components/taxes/WithholdingPanel.tsx': 1, // L7: Vest Apply over dirty Inputs
  'pages/CompPage.tsx': 1, // L6: comp event delete → instant + Undo
  'pages/EsppPage.tsx': 3, // L6: lot and offering deletes, a period's Reset → instant + Undo
  'pages/PaycheckPage.tsx': 1, // L6: profile delete → instant + Undo
  'pages/SettingsPage.tsx': 1, // L5: Apply import
  'pages/TaxesPage.tsx': 3, // L7: the year-switch and status-Undo discard guards; what-if Apply
}
/** The list when lane L4 landed (2026-09-25): 14 calls in 9 files. The allowlist may only shrink. */
const ALLOWLIST_AT_LANDING: Record<string, number> = {
  'components/portfolio/SecuritiesPanel.tsx': 1,
  'components/settings/RestoreCard.tsx': 1,
  'components/taxes/BracketsEditor.tsx': 2,
  'components/taxes/WithholdingPanel.tsx': 1,
  'pages/CompPage.tsx': 1,
  'pages/EsppPage.tsx': 3,
  'pages/PaycheckPage.tsx': 1,
  'pages/SettingsPage.tsx': 1,
  'pages/TaxesPage.tsx': 3,
}

const GLOBALS = new Set(['window', 'globalThis', 'self'])
const isGlobal = (node: ts.Expression) => ts.isIdentifier(node) && GLOBALS.has(node.text)

/** A declaration that binds the name `confirm` in this file: a variable, a parameter, a function, a
 *  destructured binding, an import. */
function declaresConfirm(node: ts.Node): boolean {
  const binds =
    ts.isVariableDeclaration(node) ||
    ts.isParameter(node) ||
    ts.isBindingElement(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isImportSpecifier(node) ||
    ts.isImportClause(node) ||
    ts.isNamespaceImport(node)
  if (!binds) return false
  const name = (node as ts.NamedDeclaration).name
  return name !== undefined && ts.isIdentifier(name) && name.text === 'confirm'
}

/** Every native confirm in `text`, from its AST: a read of `confirm` off a global (called or not), and a
 *  bare `confirm(…)` call where the file declares no `confirm` of its own. */
function nativeConfirms(fileName: string, text: string): number {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, kind)
  let reads = 0
  let bareCalls = 0
  let bindsConfirm = false
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'confirm' && isGlobal(node.expression)) {
      reads += 1
    } else if (
      ts.isElementAccessExpression(node) &&
      isGlobal(node.expression) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'confirm'
    ) {
      reads += 1
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'confirm') {
      bareCalls += 1
    }
    if (declaresConfirm(node)) bindsConfirm = true
    ts.forEachChild(node, visit)
  }
  visit(source)
  return reads + (bindsConfirm ? 0 : bareCalls)
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    // src/testing holds test infrastructure (fixtures, setup), not product code.
    if (statSync(full).isDirectory()) return entry === 'testing' ? [] : sources(full)
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : []
  })
}

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join('/')
const confirmsIn = (file: string) => {
  const text = readFileSync(path.join(SRC, file), 'utf8')
  // Every match names `confirm`: a file without the word never reaches the parser.
  return /\bconfirm\b/.test(text) ? nativeConfirms(file, text) : 0
}

describe('the native-confirm fence (2026-09-25 polish spec D2, §6.3)', () => {
  it('no source outside the allowlist calls the browser confirm', () => {
    const offenders = sources(SRC)
      .map(rel)
      .filter((file) => ALLOWLIST[file] === undefined)
      .flatMap((file) => {
        const count = confirmsIn(file)
        return count === 0 ? [] : [`${file}: ${count}`]
      })
    expect(offenders).toEqual([])
  }, 30_000)

  it('each allowlisted file holds exactly its counted calls — a new one cannot hide, a converted one must be struck off', () => {
    const actual = Object.fromEntries(Object.keys(ALLOWLIST).map((file) => [file, confirmsIn(file)]))
    expect(actual).toEqual(ALLOWLIST)
  })

  it('the allowlist may only shrink', () => {
    for (const [file, count] of Object.entries(ALLOWLIST)) {
      expect(count, file).toBeGreaterThan(0) // a converted file is deleted, not kept at 0
      expect(count, file).toBeLessThanOrEqual(ALLOWLIST_AT_LANDING[file] ?? 0)
    }
  })

  it('the allowlisted files are real (a rename must move its entry)', () => {
    expect(Object.keys(ALLOWLIST).filter((file) => !existsSync(path.join(SRC, file)))).toEqual([])
  })

  it('the matcher counts the browser confirm — code, not comments or strings, never the house hook', () => {
    const count = (source: string, name = 'probe.ts') => nativeConfirms(name, source)
    for (const hit of [
      "window.confirm('Delete?')",
      'if (!window.confirm(`Delete ${ticker}?`)) return',
      "const ok = globalThis.confirm('x')",
      "self.confirm('x')",
      "window['confirm']('x')",
      'const ask = window.confirm', // a read is a use
      "confirm('Delete?')", // the bare global
    ])
      expect(count(hit), hit).toBe(1)
    for (const miss of [
      "// window.confirm('x')",
      "/* confirm('x') */ const a = 1",
      'const words = "window.confirm(x)"',
      "const confirm = useConfirm(); await confirm({ title: 'x' })",
      'function f({ confirm }: { confirm: () => void }) { confirm() }',
      "import { confirm } from './x'; confirm()",
      'dialog.confirm()',
      'const t = { confirm: 1 }',
    ])
      expect(count(miss), miss).toBe(0)
    expect(count("window.confirm('a'); window.confirm('b')")).toBe(2)
    expect(count("const el = <button onClick={() => window.confirm('x')} />", 'probe.tsx')).toBe(1)
  })
})
```

- [ ] **Step 2: Prove it bites.** Temporarily add `window.confirm('x')` to `src/components/feedback/reveal.ts` (bottom),
  run `npx vitest run src/components/feedback/noNativeConfirm.test.ts` → FAIL
  (`offenders: ['components/feedback/reveal.ts: 1']`); remove the line (`git checkout src/components/feedback/reveal.ts`).
- [ ] **Step 3: Run — PASS.** `npx vitest run src/components/feedback/noNativeConfirm.test.ts` → 5 passed.
- [ ] **Step 4: Commit.**

```bash
git add src/components/feedback/noNativeConfirm.test.ts
git commit -m "test(feedback): the native-confirm fence — window.confirm is counted out of src/ and may only shrink" -m "Spec D2 §6.3: an AST walk over every non-test source (clockFence's matcher: comments and strings never count; a bare confirm() counts only where the file binds no confirm of its own, so useConfirm() stays legal). The 14 calls standing at L4's landing are allowlisted per file (9 files), exact-counted, and may only shrink; wave-2 lanes strike entries as they convert; lane V pins the list empty."
```

---

### Task 12: Gates and "As built"

- [ ] **Step 1: Gates.**

```bash
npx tsc -p tsconfig.app.json --noEmit && echo APP-TSC-OK
npx tsc -p tsconfig.node.json --noEmit && echo NODE-TSC-OK
npx eslint .
npx vitest run --maxWorkers=4
```
Expected: both `…-TSC-OK`; eslint `0 errors`, `26 warnings` (the baseline; the `useConfirm` directive keeps C3's two-export
module from adding a 27th); vitest all green.

- [ ] **Step 2: Append "As built"** to this file — final exported API, test counts, gate numbers, every deviation from this
  plan, the call sites touched — and commit.

```bash
git add docs/superpowers/plans/2026-09-25-polish-L4-feedback.md
git commit -m "docs(plan): polish L4 — as built (gates, counts, refinements)"
```

---

## Self-review (spec coverage)

| Requirement | Task |
|---|---|
| C2 `Logged<T>`, `apiLogged` (apiWithHeaders + lower-case header, null when absent, same invalidation) | 2 |
| C2 seventeen delete clients → `{ batchId }`; existing callers compile; typed callbacks adjusted | 3 |
| C2 six `…Logged` siblings, same arguments; originals unchanged; `revokeFeedToken` untouched | 3 |
| C3 confirm: portal, fixed placement below/right-aligned/flip above, reposition on scroll+resize, alertdialog labelled/described, Cancel first, Tab cycle, Esc/outside → false, Confirm → true, one at a time, focus return if connected, pop-in, typed arm | 8 (placement pure: 8 Step 1) |
| C3 mounted once in App.tsx inside ToastProvider | 9 |
| C3 BusyButton: no native disabled, aria-disabled for busy/inert/aria-disabled, clicks and submits ignored, focus kept, min-width idle lock | 6 |
| C3 `.button[aria-disabled="true"]` = `:disabled` look | 4 |
| C3 useSaveState / SaveStatus / SaveButton | 7 |
| C3 useDeleteWithUndo (success order, Undo chain, failures, null batch) | 10 |
| C3 reveal.ts (revealEditor, revealRow, flashElement, useEscapeCancel) | 5 |
| feedback.css: popover, spinner, aria-disabled, `[data-leaving]`, `[data-flash]`, `.save-status`, ONE `.danger-button` | 4 |
| Native-confirm fence with a counted, shrinking allowlist; lane V pins it empty | 11 |
| Motion via tokens, zero under reduced motion; colours via tokens | 4 (+ motion.test.ts's sweep) |
| Gates recorded | 12 |

The overview says "today's 15 sites"; the AST count at `657e3d62` is **14 calls in 9 files** (the two other `confirm(` text
matches are comments in DividendsPanel.tsx and TransactionsPanel.tsx). The allowlist records 14.
