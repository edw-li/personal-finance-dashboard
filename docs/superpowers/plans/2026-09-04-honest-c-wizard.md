# Honest numbers — Lane C (wizard: per-step saves, empty-month repair, derived parents) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the monthly-update wizard from writing implicit zeros: the Balances step PUTs balances only, the Spending step PUTs spending only when the month actually has something to record (a non-zero amount, a take-home figure, an already-entered month being edited, or the new "Record this month as $0" checkbox), the Review step prints a receipt of what each leg wrote ("Balances: 26 rows. Spending: skipped — nothing entered."), an empty month gets a repair banner with a one-click delete, and a parent account with components renders as a read-only derived row instead of a second number typed by hand.

**Architecture:** One page owns all of it. `MonthlyUpdatePage.tsx` replaces its two save-related states (`saved` string + `balancesLeg`) with ONE `legs: SaveLegs | null` — the visit's receipt AND the retry memory in the same value, so the green card and the "Retry spending" primary can never disagree. `save()` becomes two independent legs: balances always writes (it is the ritual's anchor), spending writes only when `writeSpending` is true and otherwise records `{ status: 'skipped', reason: 'nothing entered.' }`. Derived parents are computed by a pure module function `deriveParents(componentsOf(accounts), record)` that rewrites every parent's entry in the balances record itself, so the live subtotals, the live net worth, the preview and the draft snapshot keep reading one plain `Record<number, string>` and need no change at all; the parent's cell renders a muted read-only value instead of an `AmountInput`, and the parent is filtered out of the range-paste row list, the autofocus target and the PUT payload. The empty-month repair rides `FeedBanner`, which gains one additive `action` prop (a labelled button beside the message — "Retry" is the wrong word for a delete).

**Tech Stack:** React 19 + TypeScript 5.9, react-router-dom 7, vitest 3 + @testing-library/react (jsdom), the repo's own `api/*` fetch wrappers. No new dependencies.

**Depends on:** lane A merged to `main` (spec §8 merge order) and lane B's server behaviour (`SpendingMonthUpsert.confirm_zero`, parent derivation in `PUT /net-worth/months/{m}`, `MonthUpsertResult.derived`). Lane C ships the TypeScript mirrors of B's wire changes; nothing in lane C reads a lane-A field, so C only needs A merged for a clean base.

**Worktree / commands:**

```bash
cd /c/Users/edyli/personal-finance-dashboard
git worktree add .worktrees/honest-c -b honest-c main
cd .worktrees/honest-c
cmd //c "mklink /J node_modules ..\..\node_modules"
```

Per-task verification runs from `/c/Users/edyli/personal-finance-dashboard/.worktrees/honest-c`:
`npx vitest run src/pages/MonthlyUpdatePage.test.tsx`, `npx tsc -b`, `npx eslint <files>`.
Local commits only — **never push**, never merge from inside this plan.

**Done when:** `npx vitest run src/pages/MonthlyUpdatePage.test.tsx src/api/spending.test.ts src/api/netWorth.test.ts src/components/shell/Feed.test.tsx` is green, `npx tsc -b` is clean, `npx eslint` is clean on every touched file, and the full `npx vitest run` shows no new failures.

**House rules (every task):** no `setState` in a `useEffect` synchronous body (promise continuations and event handlers are where state moves; a guarded adjust-during-render is allowed); ref writes only in handlers, continuations or effects; colours come from CSS custom properties, never literals; comments say WHY, not WHAT; every task ends with a mutation check proving the new test fails when the behaviour is reverted; files stay LF; one commit per task.

---

## File structure

| File | Responsibility |
|---|---|
| `src/types/api.ts` (modify) | + `SpendingMonthUpsert` (with `confirm_zero`), `MonthUpsert`; `MonthUpsertResult.derived?: BalanceEntry[]` — the TS mirrors of lane B's wire |
| `src/api/spending.ts` (modify) | `putSpendingMonth` takes `SpendingMonthUpsert` instead of its inline body type |
| `src/api/spending.test.ts` (modify) | Pins that `confirm_zero` rides the body verbatim and is absent unless set |
| `src/api/netWorth.ts` (modify) | `putMonthBalances` takes `MonthUpsert`; the result's `derived` echo is readable |
| `src/api/netWorth.test.ts` (modify) | Pins the PUT body and the `derived` echo |
| `src/components/shell/Feed.tsx` (modify) | `FeedBanner` gains an optional `action: { label, onAction, disabled? }` — a labelled button beside the message (additive; every existing caller is untouched) |
| `src/components/shell/Feed.test.tsx` (modify) | Pins the new action button and that Retry still works |
| `src/pages/MonthlyUpdatePage.tsx` (modify) | The whole lane: `SaveLegs` receipt state, the spending gate, the `$0` checkbox, the empty-month banner + repair delete, `deriveParents` and the read-only parent row |
| `src/pages/MonthlyUpdatePage.test.tsx` (modify) | New tests per task + the mechanical updates to the existing tests that used to reach a save without entering spending |
| `src/pages/MonthlyUpdatePage.css` (modify) | `.entry-derived` (the read-only parent row) and `.entry-zero-confirm` (the checkbox row) — next to the existing `.entry-component` rule |

**CSS location note (correction to the brief):** `.entry-component` lives in `src/pages/MonthlyUpdatePage.css:77`, NOT in `src/components/panels.css` (panels.css owns the shared `.badge`, `.error-banner`, `.delta-*` rules). The new `.entry-derived` twin therefore goes in `MonthlyUpdatePage.css` beside its sibling; `panels.css` is not touched by this lane.

---

## Design decisions (decided here so no task has to invent them)

**1. "What was saved this visit" — the exact state shape.** One state replaces both `saved: string | null` and `balancesLeg`:

```ts
interface SaveLegs {
  month: string
  balances: { payload: string; result: MonthUpsertResult } | null
  spending:
    | { status: 'saved'; result: SpendingUpsertResult }
    | { status: 'skipped'; reason: string }
    | null
}
```

- `legs === null` — nothing landed this visit; the primary reads "Save month" and no receipt card renders.
- `legs.balances !== null` with `legs.spending === null` — the balances PUT committed and the spending leg is outstanding (it failed): the red banner speaks, the primary reads "Retry spending", no green card.
- `legs.spending !== null` — the attempt finished: the green card prints one sentence per leg.

**2. The retry idiom, and why only the balances leg carries a `payload`.** The A8 pattern is unchanged in spirit — remember what landed, re-send only what did not — and it now governs both legs. Only the balances leg needs a serialized payload signature, because it is the only leg that can commit while its sibling fails (the order is balances then spending). A signature on the spending leg would be a field no code could ever read, so it is not stored. The skip fires only for a genuine retry:

```ts
// A retry of a PARTIAL failure is the only attempt that may skip a PUT: the balances leg
// landed and its spending sibling never did. A fresh Save re-sends both, exactly as before.
const retryOf =
  legs !== null && legs.month === month && legs.spending === null ? legs.balances : null
```

At the start of every attempt `legs` is reset to `retryOf === null ? null : { month, balances: retryOf, spending: null }` — which drops the previous attempt's green card the moment a new attempt begins (one attempt, one verdict) while keeping the retry memory alive.

**3. The spending gate.** `writeSpending = hadSpending || anyAmount || canonNetPay !== '' || recordZero`, where:
- `hadSpending` (new state, seeded from the GET payload) — the month already carries ENTERED spending on the server: at least one non-zero amount or a `net_pay` row. Editing such a month always writes, so a correction that zeroes a category lands instead of being silently skipped, and the tri-state net-pay clear keeps working (`hadNetPay` implies `hadSpending`).
- `anyAmount` — any canonical category amount is non-zero this visit.
- `canonNetPay !== ''` — a take-home figure was entered (net pay alone saves the cashflow row and blank categories go as `$0.00`, exactly as today).
- `recordZero` — the "Record this month as $0" checkbox, and the ONLY thing that puts `confirm_zero: true` on the wire.

**4. Blank-vs-zero inside a saved step is unchanged:** a step that writes sends `$0.00` for every blank cell, as today. The gate decides whether the leg runs, never what it contains.

**5. `confirm_zero` and lane B's 422.** The wizard never guesses consent: if a save would empty a month (all zeros, take-home cleared) with the box unticked, lane B answers 422 and its sentence appears in the wizard's banner verbatim — the honest outcome, since ticking the box under the grid is one click away. Task 3 pins that path.

**6. Derived parents are state, not a render-time overlay.** `deriveParents(componentsOf(accounts), record)` rewrites every parent-with-active-components entry in the balances record from its components' cents. It runs (a) on the seed inside the load continuation — BEFORE the baseline snapshot is taken, or the draft machinery would file a phantom draft for untouched work — and (b) inside every balances write (cell change, flip sign, paste). Because the parent's entry in the record is always correct, the live subtotals, the live net worth and the preview memo are untouched, exactly as spec §5 promises. A parent whose only components are INACTIVE keeps its normal input box: the wizard derives from the components it renders, and the server-side drift check owns the rest.

**7. Existing tests this lane must change (all in `src/pages/MonthlyUpdatePage.test.tsx`).** Six of them reach a save without entering any spending, which used to write 19 rows of `$0.00`; under the gate that leg is skipped, so their `putSpendingMonth` mocks never run. Task 2 updates them through one new helper (`enterSpending()`), and rewrites `never sends net_pay for a month that had none and stays blank` into the new behaviour. Nothing else in the file changes.

---

### Task 1: The TypeScript mirrors of lane B's wire

**Files:**
- Modify: `src/types/api.ts:119-127` (`MonthUpsertResult`), `src/types/api.ts:182-192` (after `SpendingUpsertResult`)
- Modify: `src/api/netWorth.ts:66-77` (`putMonthBalances`), `src/api/spending.ts:48-60` (`putSpendingMonth`)
- Test: `src/api/netWorth.test.ts`, `src/api/spending.test.ts`

Lane B adds `confirm_zero` to the spending upsert body, derives parent balances in the balances PUT and echoes them back as `derived`. Today both request bodies are inline object types written at the call site, so nothing in the frontend can name them. This task gives them names and adds the two new fields; Tasks 3 and 5 spend them.

- [ ] **Step 1: Write the failing tests**

Append to `src/api/spending.test.ts` (the file already stubs `./client`; add `putSpendingMonth` to the import on line 2 so it reads `import { deleteSpendingMonth, putSpendingMonth } from './spending'`, and add `api` to the client import on line 10 so it reads `import { api, apiWithHeaders } from './client'`):

```ts
// 2026-09-04 honest-numbers spec §4: confirm_zero is the wizard's "Record this month as $0"
// checkbox and nothing else. The KEY must be absent unless the caller set it — an
// always-present `confirm_zero: false` would read as "the client considered it and said no",
// and a future default flip on the server would then be silently overridden.
it('putSpendingMonth ships the body verbatim, with confirm_zero only when the caller sets it', async () => {
  vi.mocked(api).mockResolvedValue({
    month: '2026-09-01', created: 0, updated: 19, unchanged: 0,
    net_pay_set: false, net_pay_cleared: false,
  })
  await putSpendingMonth('2026-09-01', { amounts: [{ category_id: 1, amount: '0.00' }] })
  expect(vi.mocked(api).mock.calls[0]).toEqual([
    '/spending/months/2026-09-01',
    { method: 'PUT', body: '{"amounts":[{"category_id":1,"amount":"0.00"}]}' },
  ])

  await putSpendingMonth('2026-09-01', {
    amounts: [{ category_id: 1, amount: '0.00' }],
    confirm_zero: true,
  })
  expect(vi.mocked(api).mock.calls[1][1]).toEqual({
    method: 'PUT',
    body: '{"amounts":[{"category_id":1,"amount":"0.00"}],"confirm_zero":true}',
  })
})
```

Append to `src/api/netWorth.test.ts` (add `putMonthBalances` to the import on line 2 so it reads `import { deleteMonthBalances, fetchSummary, fetchTimeseries, putMonthBalances } from './netWorth'`):

```ts
// Spec §5: the balances PUT now recomputes every parent-with-components server-side and
// echoes what it wrote. The client sends the components and reads the parents back — this
// pins that the echo survives the typed boundary (a `derived` the type did not declare
// would be dropped by nobody at runtime but is unreachable in TS, which is the bug).
it('putMonthBalances ships the body verbatim and reads the derived echo back', async () => {
  vi.mocked(api).mockResolvedValue({
    month: '2026-09-01', snapshot_created: false, created: 0, updated: 5, unchanged: 0,
    derived: [{ account_id: 9, balance: '194411.66' }],
  })
  const result = await putMonthBalances('2026-09-01', {
    recorded_on: '2026-09-04',
    notes: null,
    balances: [{ account_id: 3, balance: '100.00' }],
  })
  expect(vi.mocked(api).mock.calls[0]).toEqual([
    '/net-worth/months/2026-09-01',
    {
      method: 'PUT',
      body: '{"recorded_on":"2026-09-04","notes":null,"balances":[{"account_id":3,"balance":"100.00"}]}',
    },
  ])
  expect(result.derived).toEqual([{ account_id: 9, balance: '194411.66' }])
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/api/spending.test.ts src/api/netWorth.test.ts`
Expected: FAIL — `src/api/spending.test.ts` reports a TypeScript/assertion failure on `confirm_zero` (`Object literal may only specify known properties`), and `src/api/netWorth.test.ts` fails on `result.derived` being `undefined`/untyped (`Property 'derived' does not exist on type 'MonthUpsertResult'`).

- [ ] **Step 3: Add the types**

In `src/types/api.ts`, replace the `MonthUpsertResult` interface (currently lines 119-127) with:

```ts
export interface MonthUpsertResult {
  month: string
  snapshot_created: boolean
  created: number
  updated: number
  unchanged: number
  /** The change batch this save wrote — null when nothing changed. */
  batch_id?: string | null
  /** 2026-09-04 honest-numbers spec §5: the parents the server DERIVED from the components
   *  in this payload (an account with components has no balance of its own). Echoed because
   *  the client deliberately does not send those rows — this is how it learns what landed.
   *  `BalanceEntry` and not a new shape: it is the same account_id/balance pair. */
  derived?: BalanceEntry[]
}

/** The `PUT /net-worth/months/{m}` body. `notes: null` CLEARS a saved note; an omitted
 *  `notes` leaves it alone. A parent account with components is derived server-side (spec
 *  §5) and must be LEFT OUT — a mismatching parent entry is refused with a 422. */
export interface MonthUpsert {
  recorded_on?: string
  notes?: string | null
  balances: BalanceEntry[]
}
```

In `src/types/api.ts`, insert directly after the `SpendingUpsertResult` interface (currently ends line 192):

```ts
/** The `PUT /spending/months/{m}` body (2026-09-04 honest-numbers spec §4). `net_pay` is
 *  tri-state: omitted leaves the saved value alone, a string upserts it, an explicit null
 *  CLEARS the month's cashflow row. `confirm_zero` is the wizard's "Record this month as $0"
 *  checkbox and nothing else — without it the server refuses an all-zero body with no
 *  take-home (422), which is what stops a balances-only visit from writing a month of
 *  implicit zeros that every chart would then read as a real month of spending nothing. */
export interface SpendingMonthUpsert {
  net_pay?: string | null
  amounts: AmountEntry[]
  confirm_zero?: boolean
}
```

In `src/api/netWorth.ts`, replace the `putMonthBalances` function (lines 66-77) with:

```ts
export function putMonthBalances(month: string, body: MonthUpsert): Promise<MonthUpsertResult> {
  return api<MonthUpsertResult>(`/net-worth/months/${month}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
```

and add `MonthUpsert` to that file's type import block (it already imports `BalanceEntry`, `MonthBalances`, `MonthUpsertResult`) so the list reads `AccountCreate, AccountOut, AccountUpdate, BalanceEntry, MonthBalances, MonthUpsert, MonthUpsertResult, NetWorthSummary, NetWorthTimeseries`. The `notes: null` contract comment that sat above the inline body type now lives on the `MonthUpsert` interface — do not duplicate it here.

In `src/api/spending.ts`, replace the `putSpendingMonth` function (lines 48-60) with:

```ts
export function putSpendingMonth(
  month: string,
  body: SpendingMonthUpsert,
): Promise<SpendingUpsertResult> {
  return api<SpendingUpsertResult>(`/spending/months/${month}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
```

and add `SpendingMonthUpsert` to that file's type import block, so it reads `AmountEntry, CategoryBudgetEntry, CategoryCreate, CategoryOut, CategoryUpdate, SpendingMatrix, SpendingMonth, SpendingMonthUpsert, SpendingUpsertResult, SpendingYearly`. (`AmountEntry` stays imported — `SpendingMonthUpsert` uses it, and so do the budget helpers.)

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/api/spending.test.ts src/api/netWorth.test.ts`
Expected: PASS — both files green (`Test Files 2 passed`).

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: no output (exit 0). `MonthlyUpdatePage.tsx` still compiles: its inline call-site literals are assignable to the new named types.

- [ ] **Step 6: Mutation check**

Delete the `confirm_zero?: boolean` line from `SpendingMonthUpsert`, then run `npx vitest run src/api/spending.test.ts`.
Expected: FAIL — `Object literal may only specify known properties, and 'confirm_zero' does not exist in type 'SpendingMonthUpsert'`. Restore the line.
Delete `derived?: BalanceEntry[]` from `MonthUpsertResult`, then run `npx vitest run src/api/netWorth.test.ts`.
Expected: FAIL — `Property 'derived' does not exist on type 'MonthUpsertResult'`. Restore the line, re-run both files, expect PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types/api.ts src/api/netWorth.ts src/api/spending.ts src/api/netWorth.test.ts src/api/spending.test.ts
git commit -m "feat(api): name the month upsert bodies and mirror confirm_zero + the derived echo"
```

---

### Task 2: Per-step saves — the spending leg only writes an entered month, and the Review step says what landed

**Files:**
- Modify: `src/pages/MonthlyUpdatePage.tsx` (module scope after `snapshotOf` `:91-99`; state `:141-171`; load continuation `:241-253`; `selectMonth` `:624-637`; `deleteMonth` `:593-598`; `save()` `:434-551`; the saved card `:840-848`; the review primary `:1267-1278`)
- Test: `src/pages/MonthlyUpdatePage.test.tsx`

This is the lane's core. After it, a balances-only visit writes balances and nothing else, and the wizard prints a receipt of both legs.

- [ ] **Step 1: Write the failing tests**

Append to `src/pages/MonthlyUpdatePage.test.tsx`, BEFORE the `describe('MonthlyUpdatePage — shell frame …')` block at the end of the file:

```ts
// --- per-step saves (2026-09-04 honest-numbers spec §4) -----------------------------------

// Enter one category amount. The spending leg now writes only when the month has something
// to record, so a test that needs the spending PUT to go out has to say so out loud.
async function enterSpending(amount = '250.00') {
  fireEvent.change(await screen.findByLabelText('Food'), { target: { value: amount } })
}

it('writes balances only when nothing was entered on the spending step, and says so', async () => {
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  // The pre-save note: the user learns the spending half will be skipped BEFORE clicking.
  await screen.findByText('Spending: nothing entered — this save writes balances only.')
  fireEvent.click(screen.getByRole('button', { name: /save month/i }))

  await screen.findByText(/month saved/i)
  expect(vi.mocked(netWorthApi.putMonthBalances).mock.calls.length).toBe(1)
  // The whole point of the lane: 19 rows of $0.00 are NOT a month of spending nothing.
  expect(spendingApi.putSpendingMonth).not.toHaveBeenCalled()
  expect(screen.getByText('Balances: 1 row (1 added, 0 changed, 0 unchanged).')).toBeTruthy()
  expect(screen.getByText('Spending: skipped — nothing entered.')).toBeTruthy()
})

it('net pay alone saves the cashflow row, with every blank category as $0.00', async () => {
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  fireEvent.change(await screen.findByLabelText('Household take-home'), {
    target: { value: '9000.00' },
  })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  // Blank categories inside a SAVED step are still $0.00 — the gate decides whether the leg
  // runs, never what it contains.
  await waitFor(() =>
    expect(spendingApi.putSpendingMonth).toHaveBeenCalledWith('2026-08-01', {
      net_pay: '9000.00',
      amounts: [{ category_id: 7, amount: '0.00' }],
    }),
  )
})

it('an already-entered month always writes — zeroing a category is an edit, not a skip', async () => {
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
    month: '2026-08-01', exists: true, net_pay: null,
    amounts: [{ category_id: 7, amount: '300.00' }], budgets: [],
  })
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  fireEvent.change(await screen.findByLabelText('Food'), { target: { value: '0.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await waitFor(() =>
    expect(spendingApi.putSpendingMonth).toHaveBeenCalledWith('2026-08-01', {
      amounts: [{ category_id: 7, amount: '0.00' }],
    }),
  )
})

it('leaves an empty month on the server alone when the visit enters nothing', async () => {
  // Production's Sep 2026: rows that are all $0.00 with no take-home. A balances-only visit
  // must not rewrite them (and must not count as "entered" either).
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
    month: '2026-08-01', exists: true, net_pay: null,
    amounts: [{ category_id: 7, amount: '0.00' }], budgets: [],
  })
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await screen.findByText('Spending: skipped — nothing entered.')
  expect(spendingApi.putSpendingMonth).not.toHaveBeenCalled()
})

it('prints one sentence per leg after a full save, with the cleared take-home appended', async () => {
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
    month: '2026-08-01', exists: true, net_pay: '9000.00',
    amounts: [{ category_id: 7, amount: '300.00' }], budgets: [],
  })
  vi.mocked(spendingApi.putSpendingMonth).mockResolvedValue({
    month: '2026-08-01', created: 0, updated: 1, unchanged: 0,
    net_pay_set: false, net_pay_cleared: true,
  })
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  fireEvent.change(await screen.findByLabelText('Household take-home'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await screen.findByText(/month saved/i)
  expect(screen.getByText('Balances: 1 row (1 added, 0 changed, 0 unchanged).')).toBeTruthy()
  expect(
    screen.getByText(
      'Spending: 1 row (0 added, 1 changed, 0 unchanged). Household take-home cleared.',
    ),
  ).toBeTruthy()
})

it('the receipt belongs to the visit — switching months clears it', async () => {
  renderWizard()
  await screen.findByLabelText('Checking')
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  await enterSpending()
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await screen.findByText(/month saved/i)
  fireEvent.click(screen.getByRole('button', { name: /^Jun 2026/ }))
  await waitFor(() => expect(screen.queryByText(/month saved/i)).toBeNull())
})
```

- [ ] **Step 2: Update the existing tests that reached a save without entering spending**

These six tests mock `putSpendingMonth` and assert on its calls; under the gate their spending leg would be skipped and the mocks would never run. Each one keeps its subject — make the month enterable, nothing else. In `src/pages/MonthlyUpdatePage.test.tsx`, replace the line `  await screen.findByLabelText('Food')` with `  await enterSpending()` in exactly these tests (occurrence counts in brackets):

- `names the half-landed save and retries only the spending leg` (1)
- `keeps the accurate old message when the balances leg itself fails` (1)
- `re-sends balances on retry when they were edited after the partial failure` (2 — the first pass and the retry pass)
- `drops the stale saved card the moment a new save attempt begins` (2)
- `the save toast carries Undo when a batch was written, and fires spending then balances` (1)
- `an all-unchanged save toasts nothing and offers no Undo` (1 — its "unchanged" counts come from the spending PUT, which now has to run for the test to mean what its name says)

Then replace the whole body of `never sends net_pay for a month that had none and stays blank` (currently at `src/pages/MonthlyUpdatePage.test.tsx:563-574`) with:

```ts
it('never sends net_pay for a month that had none and stays blank', async () => {
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  // A month has to have something to record before the leg runs at all now (spec §4); the
  // CONTRACT under test is unchanged — a month that never had a take-home gets no net_pay
  // key, so the server is never asked to clear a row that does not exist.
  await enterSpending()
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await waitFor(() => {
    const body = vi.mocked(spendingApi.putSpendingMonth).mock.calls[0][1]
    expect('net_pay' in body).toBe(false)
  })
})
```

Leave every other test in the file exactly as it is. In particular `forgets the draft once the month is saved` keeps its `await screen.findByLabelText('Food')`: it asserts the DRAFT dies on a save, and a balances-only save is now the honest version of that story.

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run src/pages/MonthlyUpdatePage.test.tsx`
Expected: FAIL — three of the new tests fail against today's page, which PUTs spending unconditionally and prints one counts string:

- `writes balances only when nothing was entered on the spending step, and says so` — `Unable to find an element with the text: Spending: nothing entered — this save writes balances only.`
- `leaves an empty month on the server alone when the visit enters nothing` — `Unable to find an element with the text: Spending: skipped — nothing entered.`
- `prints one sentence per leg after a full save, with the cleared take-home appended` — `Unable to find an element with the text: Balances: 1 row (1 added, 0 changed, 0 unchanged).`

`net pay alone …`, `an already-entered month always writes …` and `the receipt belongs to the visit …` pass already (today's unconditional PUT satisfies the first two, and `selectMonth` already drops the saved card) — they are the regression guards that must STAY green through Step 4. The updated existing tests are green again, because entering an amount is exactly what the new behaviour needs.

- [ ] **Step 4a: The receipt type and its sentences (module scope)**

In `src/pages/MonthlyUpdatePage.tsx`, add `SpendingMonthUpsert` and `SpendingUpsertResult` to the `import type { … } from '../types/api'` block (line 29-35), so it reads `AccountOut, CategoryOut, HouseholdOut, MonthUpsertResult, SpendingMatrix, SpendingMonthUpsert, SpendingUpsertResult`.

Then insert this block directly after the `snapshotOf` function (after line 99, before `readDraft`):

```ts
// ── What this visit's save wrote ─────────────────────────────────────────────────────
// ONE state for two jobs that must never disagree: the receipt the Review step prints
// (spec §4 — "Balances: 26 rows. Spending: skipped — nothing entered.") and the memory of a
// leg that already COMMITTED while its sibling failed (A8's retry). A landed balances leg
// keeps the exact canonical payload it shipped, so a retry whose payload still matches skips
// that PUT, while an edit in between changes the string and honestly re-sends. Only the
// balances leg carries a payload: the order is balances then spending, so it is the only one
// that can commit while the other fails — a signature on the spending leg would be a field
// nothing could ever read.
interface SaveLegs {
  month: string
  balances: { payload: string; result: MonthUpsertResult } | null
  spending:
    | { status: 'saved'; result: SpendingUpsertResult }
    | { status: 'skipped'; reason: string }
    | null
}

// The row COUNT leads and the server's three-way split follows: "did all 26 accounts land?"
// is the question the split alone never answered.
function rowsWord(n: number): string {
  return `${n} row${n === 1 ? '' : 's'}`
}

function balancesSentence(result: MonthUpsertResult): string {
  const total = result.created + result.updated + result.unchanged
  return (
    `Balances: ${rowsWord(total)} (${result.created} added, ` +
    `${result.updated} changed, ${result.unchanged} unchanged).`
  )
}

function spendingSentence(leg: NonNullable<SaveLegs['spending']>): string {
  if (leg.status === 'skipped') return `Spending: skipped — ${leg.reason}`
  const { created, updated, unchanged } = leg.result
  return (
    `Spending: ${rowsWord(created + updated + unchanged)} (${created} added, ` +
    `${updated} changed, ${unchanged} unchanged).` +
    // A DELETION the user asked for by blanking a box: the counts never mention the cashflow
    // row that just went away, so the receipt says it — from the server's own flag, not from
    // what we hoped we sent.
    (leg.result.net_pay_cleared ? ' Household take-home cleared.' : '')
  )
}
```

- [ ] **Step 4b: Swap the two save states for one, and seed `hadSpending`**

In `src/pages/MonthlyUpdatePage.tsx`, delete the `const [saved, setSaved] = useState<string | null>(null)` line (line 150) and the whole `balancesLeg` state with its comment (lines 157-167 — the block from `// A8 (2026-08-31 tier-1): the balances leg that already COMMITTED …` through `  } | null>(null)`). In their place put:

```ts
  // What this visit's save wrote, per leg (spec §4) — and, while the spending half is still
  // outstanding, the memory the retry needs. Cleared on month load, on a month delete, and at
  // the start of any attempt that is not a retry of a partial failure.
  const [legs, setLegs] = useState<SaveLegs | null>(null)
  // Did the LOADED month carry ENTERED spending — any non-zero amount, or a net pay row (the
  // spec §3 definition)? An entered month is one the user is EDITING, so its save always
  // writes: a correction that zeroes a category must land rather than be skipped as "nothing
  // entered". Server-derived like `matrix` — deliberately NOT part of the draft snapshot.
  const [hadSpending, setHadSpending] = useState(false)
```

In the load continuation, replace `setSaved(null)` and `setBalancesLeg(null)` (lines 242-243) with the single line `setLegs(null)`, and extend the net-pay seeding (line 253) to:

```ts
        setHadNetPay(spendMonth.net_pay !== null)
        setHadSpending(
          spendMonth.net_pay !== null || spendMonth.amounts.some((a) => Number(a.amount) !== 0),
        )
```

In `selectMonth` (line 628), replace `setSaved(null)` with `setLegs(null)`. In `deleteMonth`, replace the pair `setSaved(null)` (line 594) and `setBalancesLeg(null)` with its comment (lines 595-597) with:

```ts
      // A remembered half-landed save describes rows that no longer exist — leaving it would
      // keep the primary reading "Retry spending" for a deleted month, and the receipt would
      // narrate a month that is gone.
      setLegs(null)
```

While you are in `deleteMonth`, fix the now-stale comment above `balancesDelete` (lines 566-568), which names the retired state:

```ts
      // Named *Delete, not *Leg: `legs.balances` is already this component's remembered
      // half-landed SAVE (the A8 retry), and shadowing that word here would read as the
      // same thing.
```

- [ ] **Step 4c: Derive the gate once, where the note and the save both read it**

In `src/pages/MonthlyUpdatePage.tsx`, directly under the `amountsValid` derivation (after line 380), add:

```ts
  // Spec §4's gate, derived ONCE so the Review step's pre-save note and save() itself can
  // never disagree about whether the spending leg will run. Committed values, like every
  // other live figure on this page — a cell still holding "$250" (no blur yet) is entered.
  const anyAmountEntered = categories.some(
    (c) => (Number(canonicalAmount(amounts[c.id] ?? '')) || 0) !== 0,
  )
  // A month nobody entered must stay un-entered: 19 rows of $0.00 read as a real month of
  // spending nothing in every chart, average and projection window (spec §0).
  const willWriteSpending = hadSpending || anyAmountEntered || netPay.trim() !== ''
```

- [ ] **Step 4d: Rewrite `save()` as two independent legs**

Replace the whole `save` function in `src/pages/MonthlyUpdatePage.tsx` (lines 434-551) with:

```ts
  const save = async () => {
    setSaving(true)
    setError(null)
    // Keep ONLY a retry memory — a balances leg that landed while its spending sibling did
    // not. Any other receipt belongs to a FINISHED attempt, and leaving it up would put two
    // verdicts for one month on screen (a stale "Month saved" beside a split-save alert).
    const retryOf =
      legs !== null && legs.month === month && legs.spending === null ? legs.balances : null
    setLegs(retryOf === null ? null : { month, balances: retryOf, spending: null })
    // canonicalAmount, not .trim(): a cell committed by blur is already canonical, but a save
    // reached without one (Ctrl+Enter, or a click in jsdom) must not ship "$1,600.00" or
    // "=200+50" to a Decimal column. Computed ONCE, then spent three ways — the wire, the
    // boxes and the baseline — which is what keeps those three from drifting apart below.
    // `?? ''` so a key missing from the record can never throw inside the payload builder.
    const canonBalances: Record<number, string> = Object.fromEntries(
      accounts.map((a) => [a.id, canonicalAmount(balances[a.id] ?? '')]),
    )
    const canonAmounts: Record<number, string> = Object.fromEntries(
      categories.map((c) => [c.id, canonicalAmount(amounts[c.id] ?? '')]),
    )
    const canonNetPay = netPay.trim() === '' ? '' : canonicalAmount(netPay)
    // Everything the balances PUT would ship, serialized — the "is this a PURE retry?"
    // comparison. Numeric keys serialize in ascending order (snapshotOf's law), so equal
    // values always compare equal.
    const balancesPayload = JSON.stringify({ balances: canonBalances, recordedOn, notes })
    // Which PUT is in flight — the catch words the banner by the leg that actually failed.
    let leg: 'balances' | 'spending' = 'balances'
    try {
      let balanceResult: MonthUpsertResult
      if (retryOf !== null && retryOf.payload === balancesPayload) {
        // The balances PUT already landed for exactly this payload — skip it and reuse its
        // counts (they describe the request that actually ran).
        balanceResult = retryOf.result
      } else {
        balanceResult = await putMonthBalances(month, {
          recorded_on: recordedOn === '' ? undefined : recordedOn,
          // null (not undefined): blanking the field must CLEAR a previously saved note.
          notes: notes.trim() === '' ? null : notes,
          balances: accounts.map((a) => ({ account_id: a.id, balance: canonBalances[a.id] })),
        })
      }
      // NOT named `balancesLeg`: that was the retired state's name, and reusing it here
      // would read as the old A8 field rather than as this attempt's landed half.
      const landedBalances = { payload: balancesPayload, result: balanceResult }
      // From here on any failure must leave this leg REMEMBERED, so the retry re-attempts
      // only what failed.
      setLegs({ month, balances: landedBalances, spending: null })
      leg = 'spending'
      let spendingLeg: NonNullable<SaveLegs['spending']>
      if (willWriteSpending) {
        const body: SpendingMonthUpsert = {
          amounts: categories.map((c) => ({ category_id: c.id, amount: canonAmounts[c.id] })),
        }
        if (canonNetPay !== '') {
          body.net_pay = canonNetPay
        } else if (hadNetPay) {
          // Tri-state rider (spec §4.2): blanking a previously saved net pay must CLEAR it —
          // omitting would silently keep the stale figure in every savings-rate denominator.
          body.net_pay = null
        }
        spendingLeg = { status: 'saved', result: await putSpendingMonth(month, body) }
      } else {
        spendingLeg = { status: 'skipped', reason: 'nothing entered.' }
      }
      setLegs({ month, balances: landedBalances, spending: spendingLeg })
      const saveBatches = [
        spendingLeg.status === 'saved' ? (spendingLeg.result.batch_id ?? null) : null,
        balanceResult.batch_id ?? null,
      ]
      if (saveBatches.some((id) => id !== null)) {
        toast.success(
          `Saved ${formatMonth(month)} — ${balanceResult.created + balanceResult.updated} balances updated`,
          {
            action: {
              label: 'Undo',
              onAction: () =>
                void undoBatches(saveBatches, `Undone — ${formatMonth(month)} is back to how it was.`, () => {
                  setLoading(true)
                  setLoadNonce((n) => n + 1)
                }),
            },
          },
        )
      }
      // Coverage moved: this month now has balances, and spending too when that leg ran. Tell
      // the scope row to re-read it.
      setCoverageNonce((n) => n + 1)
      // What the wire received IS what the boxes now hold. Adopting the canonical values into
      // the STATE as well as the baseline is load-bearing: a cell advanced past by clicks
      // still held raw text ("9,000"), and a baseline taken from that raw state would differ
      // from the "9000" the next focus+blur commits — filing a draft for fully saved work.
      // Safe for a SKIPPED spending leg too: a skip means the amounts are the seed's zeros
      // (anything else would have run the leg), so canonicalizing them changes nothing.
      setBalances(canonBalances)
      setAmounts(canonAmounts)
      setNetPay(canonNetPay)
      if (spendingLeg.status === 'saved') {
        // Only a leg that RAN may teach us the server's state: a skipped one changed nothing,
        // so a month that had a take-home still has it, and an empty month is still empty.
        setHadNetPay(canonNetPay !== '')
        setHadSpending(canonNetPay !== '' || anyAmountEntered)
      }
      setBaseline({
        month,
        data: snapshotOf(canonBalances, canonAmounts, canonNetPay, recordedOn, notes),
      })
      setRestored(false)
    } catch (err) {
      if (leg === 'spending') {
        // Truth-telling (A8): the balances PUT COMMITTED before this failure — the old
        // "nothing was lost" banner lied in both directions. State remembers the landed leg,
        // so the primary (now "Retry spending") re-attempts only what failed.
        setError('Balances saved. Spending failed — Retry saves only spending.')
      } else {
        setError(err instanceof ApiError ? err.message : 'Saving failed — nothing was lost, retry')
      }
    } finally {
      setSaving(false)
    }
  }
```

- [ ] **Step 4e: The receipt card, the pre-save note and the primary's label**

In `src/pages/MonthlyUpdatePage.tsx`, replace the saved card (lines 840-848) with:

```tsx
        {legs !== null && legs.month === month && legs.spending !== null && (
          // The receipt (spec §4): one line per leg, so a SKIP is as visible as a write. It
          // renders above the step body, which is the review step whenever a save lands —
          // the only step the primary is reachable from.
          <div className="card" style={{ marginBottom: '1rem' }}>
            <h2 className="eyebrow">Month saved</h2>
            {legs.balances !== null && <p>{balancesSentence(legs.balances.result)}</p>}
            <p>{spendingSentence(legs.spending)}</p>
            <p>
              <Link to="/net-worth">See net worth</Link> · <Link to="/spending">See spending</Link>
            </p>
          </div>
        )}
```

In the review step, directly after the "Server-side rounding …" `<p className="drill-hint">` (line 1227-1230), add:

```tsx
            {!willWriteSpending && (
              // Said BEFORE the click, not only in the receipt after it: "Save month" on an
              // untouched spending step now writes balances only, and a user who expected a
              // month of zeros deserves to learn that while they can still act on it.
              <p className="drill-hint" role="status">
                Spending: nothing entered — this save writes balances only.
              </p>
            )}
```

Replace the primary's label expression (lines 1274-1277) with:

```tsx
                {/* A8: while a committed balances leg is remembered with its spending sibling
                    still outstanding, the primary IS the retry the banner promised. (After an
                    in-between balance edit the click re-sends balances too — save() compares
                    the payload, not the label.) */}
                {saving
                  ? 'Saving…'
                  : legs !== null && legs.month === month && legs.spending === null
                    ? 'Retry spending'
                    : 'Save month'}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/pages/MonthlyUpdatePage.test.tsx`
Expected: PASS — every test in the file, including the six updated ones and the six new ones (`Test Files 1 passed`).

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc -b`
Expected: no output (exit 0).
Run: `npx eslint src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.test.tsx`
Expected: no output (exit 0). In particular no `react-hooks/set-state-in-effect`: every new `setLegs`/`setHadSpending` call sits in a promise continuation or an event handler.

- [ ] **Step 7: Mutation check**

In `save()`, change `if (willWriteSpending) {` to `if (true) {` (the pre-gate behaviour), then run `npx vitest run src/pages/MonthlyUpdatePage.test.tsx`.
Expected: FAIL — `writes balances only when nothing was entered on the spending step, and says so` fails on `expect(spendingApi.putSpendingMonth).not.toHaveBeenCalled()`, and `leaves an empty month on the server alone when the visit enters nothing` fails on the same line. Restore `willWriteSpending`.
Then change the skip reason to `'nothing to record.'`, re-run.
Expected: FAIL — `Unable to find an element with the text: Spending: skipped — nothing entered.` Restore `'nothing entered.'` and re-run: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.test.tsx
git commit -m "feat(wizard): save each step's half on its own and print what each leg wrote"
```

---

### Task 3: "Record this month as $0" — the only source of `confirm_zero`

**Files:**
- Modify: `src/pages/MonthlyUpdatePage.tsx` (state; load continuation; `selectMonth`; the gate from Task 2 Step 4c; the spending body in `save()`; the spending step's grid; the spending-leg catch)
- Modify: `src/pages/MonthlyUpdatePage.css` (a `.entry-zero-confirm` rule after `.entry-budget`)
- Test: `src/pages/MonthlyUpdatePage.test.tsx`

Spec §4: a month you truly spent nothing in is a real answer — but it has to be said out loud. The checkbox is unchecked by default and is never remembered across months: consent is about THIS save.

- [ ] **Step 1: Write the failing tests**

Append to `src/pages/MonthlyUpdatePage.test.tsx`, after the per-step-save block from Task 2:

```ts
it('the $0 checkbox records an empty month on purpose, and is the only source of confirm_zero', async () => {
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  const box = (await screen.findByLabelText('Record this month as $0')) as HTMLInputElement
  expect(box.checked).toBe(false)
  expect(
    screen.getByText(
      'Writes $0.00 for every category — use it for a month you truly spent nothing.',
    ),
  ).toBeTruthy()
  fireEvent.click(box)
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  // The pre-save note is gone: this save WILL write the spending leg.
  expect(
    screen.queryByText('Spending: nothing entered — this save writes balances only.'),
  ).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await waitFor(() =>
    expect(spendingApi.putSpendingMonth).toHaveBeenCalledWith('2026-08-01', {
      amounts: [{ category_id: 7, amount: '0.00' }],
      confirm_zero: true,
    }),
  )
})

it('forgets the $0 intent on a month switch — consent is about one save', async () => {
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  fireEvent.click(await screen.findByLabelText('Record this month as $0'))
  fireEvent.click(screen.getByRole('button', { name: /^Jun 2026/ }))
  // A month switch always lands on the balances step; walk back to the checkbox.
  await screen.findByLabelText('Checking')
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  expect(
    ((await screen.findByLabelText('Record this month as $0')) as HTMLInputElement).checked,
  ).toBe(false)
})

it('shows the server refusal verbatim when an emptying save skips the box', async () => {
  // Lane B's guard: all-zero amounts with the take-home cleared and no confirm_zero. The
  // wizard must not swallow the sentence that says how to proceed.
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
    month: '2026-08-01', exists: true, net_pay: '9000.00', amounts: [], budgets: [],
  })
  vi.mocked(spendingApi.putSpendingMonth).mockRejectedValue(
    new ApiError(
      'Nothing to record: every category is $0.00 and no take-home was entered — set confirm_zero to write an empty month on purpose',
      422,
    ),
  )
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  fireEvent.change(await screen.findByLabelText('Household take-home'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe(
    'Balances saved. Spending failed — Retry saves only spending. Nothing to record: every category is $0.00 and no take-home was entered — set confirm_zero to write an empty month on purpose',
  )
  expect(screen.getByRole('button', { name: 'Retry spending' })).toBeTruthy()
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/pages/MonthlyUpdatePage.test.tsx`
Expected: FAIL — three failures: `Unable to find a label with the text of: Record this month as $0` (twice), and in the third test `expected 'Balances saved. Spending failed — Retry saves only spending.' to be 'Balances saved. Spending failed — Retry saves only spending. Nothing to record: …'`.

- [ ] **Step 3: Add the checkbox, wire `confirm_zero`, and stop swallowing the server's sentence**

In `src/pages/MonthlyUpdatePage.tsx`, add the state next to `hadSpending` (Task 2 Step 4b):

```ts
  // Spec §4: the deliberate empty month. Unchecked by default and NOT part of the draft
  // snapshot — a draft is typed work, this is consent about the save in front of you, and a
  // week-old "yes" resurrecting over fresh data is exactly the failure the drafts avoid.
  const [recordZero, setRecordZero] = useState(false)
```

In the load continuation, next to `setHadSpending(…)`, add `setRecordZero(false)` (a new month starts unconsented). In `selectMonth`, next to `setDeleteArm('')`, add `setRecordZero(false)` — same reason the danger-zone arm resets there.

Extend the gate from Task 2 Step 4c:

```ts
  const willWriteSpending =
    hadSpending || anyAmountEntered || netPay.trim() !== '' || recordZero
```

In `save()`, inside the `if (willWriteSpending)` branch, after the `net_pay` handling and before the `await`, add:

```ts
        if (recordZero) {
          // Only the checkbox may confirm an empty month — the key is ABSENT otherwise, so a
          // body the user did not consent to is refused by the server rather than waved
          // through by a client-side default.
          body.confirm_zero = true
        }
```

In the spending-leg `catch` branch, replace the `setError('Balances saved. Spending failed — Retry saves only spending.')` line with:

```ts
        // Truth-telling (A8), plus the server's own words when it had any: a 422 from the
        // empty-month guard is an instruction ("set confirm_zero"), not noise to swallow.
        const why = err instanceof ApiError ? ` ${err.message}` : ''
        setError(`Balances saved. Spending failed — Retry saves only spending.${why}`)
```

In the spending step, directly after the closing `</table>` and before the `{pasteNote && …}` block, add:

```tsx
            {/* Spec §4: the ONLY way a month of $0.00 rows gets written on purpose. The
                sentence under it is the whole explanation — this control has no other cue. */}
            <label className="entry-zero-confirm">
              <input
                type="checkbox"
                checked={recordZero}
                onChange={(e) => setRecordZero(e.target.checked)}
              />
              Record this month as $0
            </label>
            <p className="drill-hint">
              Writes $0.00 for every category — use it for a month you truly spent nothing.
            </p>
```

In `src/pages/MonthlyUpdatePage.css`, after the `.entry-budget.delta-negative` rule (line 209-211), add:

```css
/* Spec §4: the deliberate-empty-month checkbox. A form row under the grid, deliberately
   toneless — choosing it is an answer, not a warning, so it borrows neither --warn (the
   liability cue) nor --negative (the danger zone). */
.entry-zero-confirm {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
  font-size: 0.85rem;
  cursor: pointer;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/pages/MonthlyUpdatePage.test.tsx`
Expected: PASS — the whole file, including `walks balances -> spending -> review and submits both PUTs`, whose exact-object assertion proves `confirm_zero` is ABSENT when the box is untouched.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc -b`
Expected: no output (exit 0).
Run: `npx eslint src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.test.tsx`
Expected: no output (exit 0).

- [ ] **Step 6: Mutation check**

Change `if (recordZero) { body.confirm_zero = true }` to `body.confirm_zero = recordZero`, then run `npx vitest run src/pages/MonthlyUpdatePage.test.tsx`.
Expected: FAIL — `walks balances -> spending -> review and submits both PUTs` reports the extra `confirm_zero: false` key in its exact-object assertion. Restore the guarded form.
Then delete `|| recordZero` from `willWriteSpending`, re-run.
Expected: FAIL — `the $0 checkbox records an empty month on purpose …` times out waiting for `putSpendingMonth` to be called. Restore it and re-run: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.test.tsx src/pages/MonthlyUpdatePage.css
git commit -m "feat(wizard): record a month as \$0 on purpose, and surface the server's refusal"
```

---

### Task 4: `FeedBanner` gains a named action button

**Files:**
- Modify: `src/components/shell/Feed.tsx:60-84` (the `FeedBanner` export)
- Test: `src/components/shell/Feed.test.tsx` (the `describe('FeedBanner', …)` block at the end)

The empty-month repair (Task 5) needs a button that says "Delete the empty month". `FeedBanner`'s only button today is hardcoded "Retry", and calling a delete "Retry" would be a lie. One additive prop; every existing caller is untouched.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('FeedBanner', …)` block in `src/components/shell/Feed.test.tsx`:

```ts
  it('offers a named action button beside the message, disabled while it is running', () => {
    const onAction = vi.fn()
    const { rerender } = render(
      <FeedBanner
        error="This month was saved with no spending."
        action={{ label: 'Delete the empty month', onAction }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete the empty month' }))
    expect(onAction).toHaveBeenCalled()
    // A second click while the first request is in flight would DELETE twice — the second
    // 404s and the caller would show "Delete failed" for a delete that worked.
    rerender(
      <FeedBanner
        error="This month was saved with no spending."
        action={{ label: 'Delete the empty month', onAction, disabled: true }}
      />,
    )
    expect(
      (screen.getByRole('button', { name: 'Delete the empty month' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('renders Retry before an action when a banner offers both', () => {
    render(
      <FeedBanner
        error="bad"
        retry={() => {}}
        retryLabel="Retry the feed"
        action={{ label: 'Delete it', onAction: () => {} }}
      />,
    )
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Retry', 'Delete it'])
  })
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/components/shell/Feed.test.tsx`
Expected: FAIL — `Property 'action' does not exist on type …` from the typechecked test run, and at runtime `Unable to find an accessible element with the role "button" and name "Delete the empty month"`.

- [ ] **Step 3: Add the prop**

In `src/components/shell/Feed.tsx`, replace the `FeedBanner` export (lines 60-84) with:

```tsx
/** The alert Feed renders its banner through; exported bare for errors that are not about a
 *  feed's freshness: form validation, a save that failed, a what-if that would not compute.
 *  Renders nothing for any falsy error — the pages' `{error && …}` guard says the same thing,
 *  and an empty message is reachable (an ApiError built from an HTTP/2 empty statusText).
 *
 *  `retry` re-runs the fetch behind the banner; `action` is for a banner whose fix is
 *  something else entirely (the wizard's "Delete the empty month" — calling that Retry would
 *  be a lie). Both may appear; Retry comes first, because it is the cheaper answer. */
export function FeedBanner({
  error,
  retry,
  retryLabel,
  action,
}: {
  error?: string | null
  retry?: () => void
  retryLabel?: string
  action?: { label: string; onAction: () => void; disabled?: boolean }
}) {
  if (!error) return null
  return (
    <div className="error-banner" role="alert">
      {error}
      {retry !== undefined && (
        <>
          {' '}
          <button type="button" className="button" aria-label={retryLabel} onClick={retry}>
            Retry
          </button>
        </>
      )}
      {action !== undefined && (
        <>
          {' '}
          <button
            type="button"
            className="button"
            disabled={action.disabled}
            onClick={action.onAction}
          >
            {action.label}
          </button>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/components/shell/Feed.test.tsx`
Expected: PASS — all `Feed` and `FeedBanner` tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc -b`
Expected: no output (exit 0).
Run: `npx eslint src/components/shell/Feed.tsx src/components/shell/Feed.test.tsx`
Expected: no output (exit 0).

- [ ] **Step 6: Mutation check**

Delete `disabled={action.disabled}` from the action button, then run `npx vitest run src/components/shell/Feed.test.tsx`.
Expected: FAIL — `expected false to be true` in `offers a named action button beside the message, disabled while it is running`. Restore it, re-run: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/shell/Feed.tsx src/components/shell/Feed.test.tsx
git commit -m "feat(shell): let a FeedBanner offer a named action beside Retry"
```

---

### Task 5: The empty-month banner and its one-click repair

**Files:**
- Modify: `src/pages/MonthlyUpdatePage.tsx` (state; load continuation; `save()`'s success path; a new `deleteEmptySpending`; the render, just under the existing `<FeedBanner error={error} />` at line 827)
- Test: `src/pages/MonthlyUpdatePage.test.tsx`

Spec §4 repair: "This month was saved with no spending. Enter it below, or delete the empty month." The delete is the Health card's action — `DELETE /spending/months/{m}` with `source: 'repair'` — and balances are untouched by design.

- [ ] **Step 1: Write the failing tests**

Append to `src/pages/MonthlyUpdatePage.test.tsx`, after the Task 3 block:

```ts
// --- the empty-month repair (2026-09-04 honest-numbers spec §4) ---------------------------

// Production's Sep 2026 shape: rows that exist and are all $0.00, and no take-home.
const EMPTY_MONTH = {
  month: '2026-08-01', exists: true, net_pay: null,
  amounts: [{ category_id: 7, amount: '0.00' }], budgets: [],
}

it('flags a month that was saved with no spending, and offers the delete', async () => {
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue(EMPTY_MONTH)
  renderWizard()
  expect(
    await screen.findByText(
      'This month was saved with no spending. Enter it below, or delete the empty month.',
    ),
  ).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Delete the empty month' })).toBeTruthy()
})

it('says nothing about an empty month when the month has spending', async () => {
  renderWizard()
  await screen.findByLabelText('Checking')
  expect(screen.queryByText(/saved with no spending/)).toBeNull()
})

it('deletes only the spending rows, offers Undo, and leaves the balances snapshot alone', async () => {
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue(EMPTY_MONTH)
  vi.mocked(spendingApi.deleteSpendingMonth).mockResolvedValue({ batchId: 'b-empty' })
  vi.mocked(lifecycleApi.undoBatch).mockResolvedValue({
    type: 'batch', batch_id: 'u-9', at: '2026-09-04T09:00:00+00:00', source: 'undo', actor: null,
    label: 'Undid: Deleted Aug 2026 spending', month: '2026-08-01', rows: 1, undoable: true,
    undone_by: null,
  })
  renderWizardAt('/update?month=2026-08-01')
  fireEvent.click(await screen.findByRole('button', { name: 'Delete the empty month' }))
  await waitFor(() =>
    expect(spendingApi.deleteSpendingMonth).toHaveBeenCalledWith('2026-08-01', {
      source: 'repair',
    }),
  )
  // The month keeps its net worth: only the spending half was empty.
  expect(netWorthApi.deleteMonthBalances).not.toHaveBeenCalled()
  await screen.findByText("Deleted Aug 2026's empty spending rows — balances untouched.")
  // Coverage moved (the spending feed is gone), so the ribbon has to re-read it.
  await waitFor(() => expect(vi.mocked(fetchCoverage).mock.calls.length).toBeGreaterThan(1))
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(lifecycleApi.undoBatch).toHaveBeenCalledWith('b-empty'))
  await screen.findByText("Undone — Aug 2026's rows are back.")
})

it('surfaces a failed repair instead of pretending the month is clean', async () => {
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue(EMPTY_MONTH)
  vi.mocked(spendingApi.deleteSpendingMonth).mockRejectedValue(new ApiError('db exploded', 500))
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: 'Delete the empty month' }))
  expect(await screen.findByText('Delete failed: db exploded — retry')).toBeTruthy()
  // The banner stays: the month is still empty.
  expect(screen.getByText(/saved with no spending/)).toBeTruthy()
})

it('drops the banner the moment the month is given real spending', async () => {
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue(EMPTY_MONTH)
  renderWizard()
  await screen.findByText(/saved with no spending/)
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  await enterSpending()
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await screen.findByText(/month saved/i)
  expect(screen.queryByText(/saved with no spending/)).toBeNull()
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/pages/MonthlyUpdatePage.test.tsx`
Expected: FAIL — four failures, all of the form `Unable to find an element with the text: This month was saved with no spending. Enter it below, or delete the empty month.` / `Unable to find an accessible element with the role "button" and name "Delete the empty month"`. (`says nothing about an empty month when the month has spending` passes already — it is the regression guard.)

- [ ] **Step 3: Detect the empty month, render the banner, wire the repair**

In `src/pages/MonthlyUpdatePage.tsx`, add the state next to `recordZero`:

```ts
  // The LOADED month is an empty one (spec §3): rows exist, every amount is $0.00 and there
  // is no take-home. Read from the month payload rather than from /coverage — the wizard
  // already holds the answer, and a second source could disagree with the boxes on screen.
  const [emptyMonth, setEmptyMonth] = useState(false)
  const [repairing, setRepairing] = useState(false)
```

In the load continuation, next to `setHadSpending(…)`, add:

```ts
        setEmptyMonth(
          spendMonth.exists &&
            spendMonth.net_pay === null &&
            // At least one row: a month with NO rows at all is missing, not empty, and the
            // repair delete would 404 on it.
            spendMonth.amounts.length > 0 &&
            spendMonth.amounts.every((a) => Number(a.amount) === 0),
        )
```

In `save()`, inside the `if (spendingLeg.status === 'saved') { … }` block added in Task 2, add one line after `setHadSpending(…)`:

```ts
        // A leg that wrote all zeros with no take-home (the confirm_zero path) leaves the
        // month empty on purpose — and an empty month still says so, which is the point.
        setEmptyMonth(canonNetPay === '' && !anyAmountEntered)
```

Add the repair handler directly after `deleteMonth` (after line 616):

```ts
  // Spec §4 repair: the empty month's one-click fix — the SAME call the Data-health card's
  // zero-month repair makes (`source: 'repair'`, so the change log labels it a repair and the
  // Activity card can still undo it). Balances are untouched by design: the snapshot is the
  // ritual's anchor, and the month keeps its net worth.
  const deleteEmptySpending = async () => {
    setRepairing(true)
    setError(null)
    try {
      const { batchId } = await deleteSpendingMonth(month, { source: 'repair' })
      const repaired = month
      toast.success(
        `Deleted ${formatMonth(repaired)}'s empty spending rows — balances untouched.`,
        batchId === null
          ? undefined
          : {
              action: {
                label: 'Undo',
                onAction: () =>
                  void undoBatches([batchId], `Undone — ${formatMonth(repaired)}'s rows are back.`, () => {
                    setLoading(true)
                    setLoadNonce((n) => n + 1)
                  }),
              },
            },
      )
      setEmptyMonth(false)
      // The spending feed is gone: the ribbon must re-read coverage, and the form must
      // re-seed (the zeros it is showing no longer exist).
      setCoverageNonce((n) => n + 1)
      setLoading(true)
      setLoadNonce((n) => n + 1)
    } catch (err) {
      setError(
        err instanceof ApiError ? `Delete failed: ${err.message} — retry` : 'Delete failed — retry',
      )
    } finally {
      setRepairing(false)
    }
  }
```

In the render, directly after `<FeedBanner error={error} />` (line 827), add:

```tsx
        {emptyMonth && (
          // Spec §4: the repair prompt for a month that was saved with no spending — the
          // wizard is where the fix lives, so the banner carries both routes out of it.
          <FeedBanner
            error="This month was saved with no spending. Enter it below, or delete the empty month."
            action={{
              label: 'Delete the empty month',
              onAction: () => void deleteEmptySpending(),
              disabled: repairing,
            }}
          />
        )}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/pages/MonthlyUpdatePage.test.tsx`
Expected: PASS — the whole file. Note `shows the server refusal verbatim when an emptying save skips the box` (Task 3) stays green: its month has a take-home, so it is not empty and only one `role="alert"` is on screen.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc -b`
Expected: no output (exit 0).
Run: `npx eslint src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.test.tsx`
Expected: no output (exit 0).

- [ ] **Step 6: Mutation check**

Change the detection's `spendMonth.amounts.length > 0 &&` to `true &&`, then run `npx vitest run src/pages/MonthlyUpdatePage.test.tsx`.
Expected: FAIL — `says nothing about an empty month when the month has spending` finds the banner (the default fixture is a month with no rows at all, which is MISSING, not empty). Restore the line.
Then change `{ source: 'repair' }` to `{}` in `deleteEmptySpending`, re-run.
Expected: FAIL — `deletes only the spending rows, offers Undo, and leaves the balances snapshot alone` reports the call was made with `{}` instead of `{ source: 'repair' }`. Restore it and re-run: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.test.tsx
git commit -m "feat(wizard): flag a month saved with no spending and offer the repair delete"
```

---

### Task 6: Derived parent rows — read-only, live sum, never sent

**Files:**
- Modify: `src/pages/MonthlyUpdatePage.tsx` (module scope after `snapshotOf`; the load continuation's seeding `:260-313`; `balancesValid` `:377`; `flipSign` `:766-770`; `firstBalanceId` `:676-679`; the balances card's `onPaste` `:854`; the row renderer `:920-986`; the wire array in `save()`)
- Modify: `src/pages/MonthlyUpdatePage.css` (after `.entry-component`, line 77)
- Test: `src/pages/MonthlyUpdatePage.test.tsx`

Spec §5: an account with at least one component has no balance of its own. Two totals typed by hand every month become one number the wizard computes and the server verifies.

- [ ] **Step 1: Write the failing tests**

Append to `src/pages/MonthlyUpdatePage.test.tsx`, after the Task 5 block:

```ts
// --- derived parents (2026-09-04 honest-numbers spec §5) ----------------------------------

const parent401k = {
  id: 8, name: 'Fidelity 401(k)', slug: 'fidelity-401k', group: 'pre_tax' as const,
  sort_order: 6, is_active: true, is_component: false, parent_account_id: null, person_id: 1,
}
const preTaxPart = {
  id: 9, name: '401(k) pre-tax', slug: 'k-pre-tax', group: 'pre_tax' as const,
  sort_order: 7, is_active: true, is_component: true, parent_account_id: 8, person_id: 1,
}
const afterTaxPart = {
  id: 10, name: '401(k) after-tax', slug: 'k-after-tax', group: 'pre_tax' as const,
  sort_order: 8, is_active: true, is_component: true, parent_account_id: 8, person_id: 1,
}

function withComponents(accounts = [account, parent401k, preTaxPart, afterTaxPart]) {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue(accounts)
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
    month,
    exists: month === '2026-07-01',
    recorded_on: null,
    notes: null,
    balances:
      month === '2026-07-01'
        ? [
            { account_id: 1, balance: '1500.00' },
            { account_id: 8, balance: '1000.00' },
            { account_id: 9, balance: '600.00' },
            { account_id: 10, balance: '400.00' },
          ]
        : [],
  }))
}

it('renders a parent with components as a read-only derived row that sums its cells live', async () => {
  withComponents()
  renderWizard()
  const row = ((await screen.findByText('Fidelity 401(k)')).closest('tr')) as HTMLElement
  expect(row.className).toContain('entry-derived')
  expect(within(row).getByText('derived')).toBeTruthy()
  // No box at all: an account with components has no balance of its own (spec §5).
  expect(within(row).queryByRole('textbox')).toBeNull()
  const cells = within(row).getAllByRole('cell')
  expect(cells[1].textContent).toBe('$1,000.00') // last month, as stored
  expect(cells[2].textContent).toBe('$1,000.00') // this month, derived from the seed
  expect(cells[3].textContent).toBe('$0.00') // Δ

  // A component cell moves the parent, its Δ and the live net worth in the same keystroke.
  fireEvent.change(screen.getByLabelText(/^401\(k\) pre-tax/), { target: { value: '700.00' } })
  expect(within(row).getAllByRole('cell')[2].textContent).toBe('$1,100.00')
  expect(within(row).getAllByRole('cell')[3].textContent).toBe('$100.00')
  const footer = screen.getByRole('status', { name: /live totals/i })
  expect(within(footer).getByText('$2,600.00')).toBeDefined() // 1,500 cash + 1,100 derived
})

it('never sends a derived parent — the server computes it from the components', async () => {
  withComponents()
  renderWizard()
  await screen.findByText('Fidelity 401(k)')
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await waitFor(() =>
    expect(netWorthApi.putMonthBalances).toHaveBeenCalledWith(
      '2026-08-01',
      expect.objectContaining({
        balances: [
          { account_id: 1, balance: '1500.00' },
          { account_id: 9, balance: '600.00' },
          { account_id: 10, balance: '400.00' },
        ],
      }),
    ),
  )
})

it('a column paste fills the component cells and skips the derived parent', async () => {
  withComponents()
  renderWizard()
  const checking = (await screen.findByLabelText('Checking')) as HTMLInputElement
  fireEvent.paste(checking, { clipboardData: { getData: () => '1600\n700\n500' } })

  expect(checking.value).toBe('1600')
  expect((screen.getByLabelText(/^401\(k\) pre-tax/) as HTMLInputElement).value).toBe('$700.00')
  expect((screen.getByLabelText(/^401\(k\) after-tax/) as HTMLInputElement).value).toBe('$500.00')
  // Three targets, not four: the derived row is not a paste slot, so nothing shifts past it.
  expect(screen.getByText(/pasted 3 of 3 values/i)).toBeDefined()
  const row = (screen.getByText('Fidelity 401(k)').closest('tr')) as HTMLElement
  expect(within(row).getAllByRole('cell')[2].textContent).toBe('$1,200.00')
})

it('autofocuses the first TYPABLE cell when the table opens on a derived parent', async () => {
  withComponents([parent401k, preTaxPart, afterTaxPart])
  renderWizard()
  const first = await screen.findByLabelText(/^401\(k\) pre-tax/)
  expect(document.activeElement).toBe(first)
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/pages/MonthlyUpdatePage.test.tsx`
Expected: FAIL — four failures: `expected '' to contain 'entry-derived'` (the row has no class), `Unable to find an element with the text: derived`, the PUT assertion reports the extra `{ account_id: 8, balance: '1000.00' }` entry, `pasted 3 of 3 values` is actually `pasted 4 of 4 values`, and the autofocus lands on the parent's box instead of the first component.

- [ ] **Step 3a: The derivation, at module scope**

In `src/pages/MonthlyUpdatePage.tsx`, insert after the `SaveLegs` block from Task 2 Step 4a:

```ts
// ── Derived parents (2026-09-04 honest-numbers spec §5) ──────────────────────────────
// An account with at least one component has NO balance of its own: its value for the month
// IS the sum of its components' cells. Only components that are ON SCREEN count — a parent
// whose components are all inactive keeps its own box, because there would be nothing to sum
// (the server's drift check owns that case, and never rewrites).
function componentsOf(accounts: AccountOut[]): Map<number, number[]> {
  const byParent = new Map<number, number[]>()
  const present = new Set(accounts.map((a) => a.id))
  for (const account of accounts) {
    // A component whose parent is not on screen derives nothing — it is just a row.
    if (account.parent_account_id === null || !present.has(account.parent_account_id)) continue
    byParent.set(account.parent_account_id, [
      ...(byParent.get(account.parent_account_id) ?? []),
      account.id,
    ])
  }
  return byParent
}

// Rewrites every derived parent's entry INSIDE the balances record, rather than overlaying it
// at render time. That is what lets the live subtotals, the live net worth, the preview memo
// and the draft snapshot stay byte-identical: they all read this one record, and it is now
// always right.
function deriveParents(
  byParent: Map<number, number[]>,
  record: Record<number, string>,
): Record<number, string> {
  if (byParent.size === 0) return record
  const next = { ...record }
  for (const [parentId, childIds] of byParent) {
    // CENTS, summed as integers: every cell is a 2dp decimal, so rounding each child before
    // adding keeps the parent exact. A float sum drifts a hundredth over a long list, and the
    // server's drift check would then report a mismatch nobody typed.
    const cents = childIds.reduce(
      (acc, id) => acc + Math.round((Number(canonicalAmount(next[id] ?? '')) || 0) * 100),
      0,
    )
    next[parentId] = (cents / 100).toFixed(2)
  }
  return next
}
```

- [ ] **Step 3b: Seed, validate, focus and paste through the derivation**

In `src/pages/MonthlyUpdatePage.tsx`, inside the load continuation, replace the `seededBalances` assignment (lines 262-264) with:

```ts
        const byParent = componentsOf(activeAccounts)
        // The parent's SEED is its components' sum, not the stored figure: a snapshot that
        // drifted must show the truth the save will write. Taken BEFORE the baseline below,
        // or the draft machinery would file a phantom draft for work nobody typed.
        const seededBalances = deriveParents(
          byParent,
          Object.fromEntries(activeAccounts.map((a) => [a.id, byId.get(a.id) ?? '0.00'])),
        )
```

and replace the `setBalances(draft ? … : seededBalances)` call (lines 304-313) with:

```ts
        setBalances(
          draft
            ? deriveParents(
                byParent,
                Object.fromEntries(
                  activeAccounts.map((a) => [
                    a.id,
                    draft.balances?.[String(a.id)] ?? seededBalances[a.id],
                  ]),
                ),
              )
            : seededBalances,
        )
```

Add the memo directly ABOVE the `balancesValid` derivation (before line 377) — `balancesValid`, `firstBalanceId`, the paste handler, the row renderer and `save()` all read it, and a `const` declared further down would be a use-before-declaration throw on the first render:

```ts
  // Which parents are derived, and from which cells — ONE map, spent by the row renderer, the
  // paste target list, the autofocus pick, the validity check and the PUT payload. Deriving
  // it in five places is how those five drift apart.
  const componentsByParent = useMemo(() => componentsOf(accounts), [accounts])
```

Replace `balancesValid` (line 377) with:

```ts
  // A derived row has no box, so it has nothing to validate — and its value is always
  // canonical by construction.
  const balancesValid = accounts.every(
    (a) => componentsByParent.has(a.id) || isAmount(balances[a.id] ?? ''),
  )
```

Replace `firstBalanceId` (line 679) with:

```ts
  // The first TYPABLE row: focus() on a derived row's cell would find nothing, and the step
  // would open with the caret nowhere.
  const firstBalanceId = orderedBalanceRows.find((a) => !componentsByParent.has(a.id))?.id
```

Replace the balances card's `onPaste` prop (line 854) with:

```tsx
            onPaste={(e) =>
              handlePaste(
                e,
                // Spec §5: a derived row is not a paste target. Filtering here (not inside
                // handlePaste) keeps the positional walk's slot count honest — "3 of 3", not
                // "3 of 4 with one silently shifted".
                orderedBalanceRows.filter((a) => !componentsByParent.has(a.id)),
                (id) => `bal-${id}`,
                (updater) => setBalances((cur) => deriveParents(componentsByParent, updater(cur))),
              )
            }
```

Replace `flipSign` (lines 766-770) with:

```tsx
  const flipSign = (accountId: number) =>
    setBalances((cur) => {
      const canon = canonicalAmount(cur[accountId] ?? '')
      return deriveParents(componentsByParent, {
        ...cur,
        [accountId]: canon.startsWith('-') ? canon.slice(1) : `-${canon}`,
      })
    })
```

In `save()`, replace the wire array inside `putMonthBalances` with:

```ts
          // Spec §5: a parent with components is derived server-side from the components in
          // this very payload. Sending one would at best be noise and at worst a 422.
          balances: accounts
            .filter((a) => !componentsByParent.has(a.id))
            .map((a) => ({ account_id: a.id, balance: canonBalances[a.id] })),
```

- [ ] **Step 3c: The row itself**

In `src/pages/MonthlyUpdatePage.tsx`, replace the whole `{groupAccounts.map((account) => { … })}` block (lines 920-986) with:

```tsx
                            {groupAccounts.map((account) => {
                              const value = balances[account.id] ?? ''
                              const prior = priorBalances[account.id]
                              const delta =
                                prior === undefined ? null : committed(value) - Number(prior)
                              const derived = componentsByParent.has(account.id)
                              return (
                                <tr
                                  key={account.id}
                                  className={derived ? 'entry-derived' : undefined}
                                >
                                  <td
                                    className={account.is_component ? 'entry-component' : undefined}
                                  >
                                    {derived ? (
                                      // No <label>: there is no control to point at. The badge
                                      // is the row's whole explanation (spec §5).
                                      <span>
                                        {account.name}
                                        <span className="badge">derived</span>
                                      </span>
                                    ) : (
                                      <label htmlFor={`bal-${account.id}`}>
                                        {account.name}
                                        {account.is_component && (
                                          <span className="badge">component</span>
                                        )}
                                      </label>
                                    )}
                                  </td>
                                  <td className="num entry-ref">
                                    {prior === undefined ? '—' : formatCurrency(prior)}
                                  </td>
                                  <td className="num entry-cell-col">
                                    {derived ? (
                                      // The live sum of the component cells below it, written
                                      // by the same state update that fills any of them.
                                      <span className="entry-derived-value">
                                        {formatCurrency(committed(value))}
                                      </span>
                                    ) : (
                                      <>
                                        <AmountInput
                                          id={`bal-${account.id}`}
                                          className={
                                            `${isAmount(value) ? '' : 'invalid'}${
                                              flashIds.has(`bal-${account.id}`)
                                                ? ' pasted-flash'
                                                : ''
                                            }`.trim() || undefined
                                          }
                                          autoFocus={account.id === firstBalanceId}
                                          value={value}
                                          onValueChange={(next) =>
                                            setBalances((cur) =>
                                              // Spec §5: a component's keystroke IS its
                                              // parent's value — ONE write, so the row, the
                                              // subtotals and the live net worth can never
                                              // show three different answers.
                                              deriveParents(componentsByParent, {
                                                ...cur,
                                                [account.id]: next,
                                              }),
                                            )
                                          }
                                        />
                                        {/* A1 (2026-08-31 tier-1): advisory amber, NEVER a gate —
                                            a card can legitimately go positive after a refund, so
                                            Next/Save stay enabled and the table hint below keeps
                                            stating the sign convention. */}
                                        {account.group === 'liability' &&
                                          committed(value) > 0 && (
                                            <span className="entry-liability-cue" role="status">
                                              liabilities are entered negative
                                              <button
                                                type="button"
                                                className="button"
                                                aria-label={`Flip sign on ${account.name}`}
                                                onClick={() => flipSign(account.id)}
                                              >
                                                Flip sign
                                              </button>
                                            </span>
                                          )}
                                      </>
                                    )}
                                  </td>
                                  <td
                                    className={`num entry-delta${
                                      delta === null || delta === 0
                                        ? ''
                                        : delta > 0
                                          ? ' delta-positive'
                                          : ' delta-negative'
                                    }`}
                                  >
                                    {/* Typo tripwire: a fat-fingered digit shows a huge Δ instantly. */}
                                    {delta === null ? '—' : formatCurrency(delta)}
                                  </td>
                                </tr>
                              )
                            })}
```

In `src/pages/MonthlyUpdatePage.css`, directly after the `.entry-component label { padding-left: 1.1rem; }` rule (line 77), add:

```css
/* Spec §5: a parent with components is DERIVED — the sum of the cells under it, never typed.
   The row reads as a total rather than as an input: muted, tabular, sitting where every other
   row shows a box. (Its sibling .entry-component above indents the components themselves.) */
.entry-derived .entry-derived-value {
  display: inline-block;
  padding: 0.25rem 0;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3d: Update the one existing test whose fixture has a real parent**

`excludes components from the group subtotal and the live net worth` (`src/pages/MonthlyUpdatePage.test.tsx:401-425`) is the only existing test with a component whose parent is on screen, so its "Brokerage" row is derived now and has no label to type into. Replace the two lines

```ts
  fireEvent.change(screen.getByLabelText('Brokerage'), { target: { value: '1000' } })
  fireEvent.change(component, { target: { value: '250' } })
```

with

```ts
  // Brokerage HAS a component, so it is a DERIVED row now (spec §5): the figure is typed into
  // the component, and the parent shows the sum. The subtotal rule under test is unchanged —
  // a component is counted inside its parent, never beside it.
  fireEvent.change(component, { target: { value: '1000' } })
```

Every assertion below it stays exactly as written: the subtotal is still `$1,000.00` (the derived parent) and the live net worth is still `$2,500.00` (1,500 checking + 1,000 derived).

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/pages/MonthlyUpdatePage.test.tsx`
Expected: PASS — the whole file (`Test Files 1 passed`).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc -b`
Expected: no output (exit 0).
Run: `npx eslint src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.test.tsx`
Expected: no output (exit 0) — in particular no `react-hooks/preserve-manual-memoization` complaint about the new `useMemo`, which closes over `accounts` only.

- [ ] **Step 6: Mutation check**

Change `deriveParents(componentsByParent, { ...cur, [account.id]: next })` back to `{ ...cur, [account.id]: next }` in the cell handler, then run `npx vitest run src/pages/MonthlyUpdatePage.test.tsx`.
Expected: FAIL — `renders a parent with components as a read-only derived row that sums its cells live` reports `expected '$1,000.00' to be '$1,100.00'`. Restore it.
Then delete `.filter((a) => !componentsByParent.has(a.id))` from the wire array in `save()`, re-run.
Expected: FAIL — `never sends a derived parent — the server computes it from the components` reports the extra `{ account_id: 8, balance: '1000.00' }` in the payload. Restore it.
Then drop the `.filter(…)` from the `onPaste` row list, re-run.
Expected: FAIL — `a column paste fills the component cells and skips the derived parent` reports `pasted 3 of 4 values` and an after-tax cell of `$0.00` (the values shifted by one). Restore it and re-run: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.test.tsx src/pages/MonthlyUpdatePage.css
git commit -m "feat(wizard): derive a parent account's balance from its components"
```

---

### Task 7: Lane verification

**Files:** none changed unless a check fails.

Everything before this task verified one file at a time. This one proves the lane did not break a neighbour: `MonthlyUpdatePage` is imported by the router, `FeedBanner` by twenty cards, and `putMonthBalances`/`putSpendingMonth` by the importer and the Health card.

- [ ] **Step 1: Run the whole frontend suite**

Run: `npx vitest run`
Expected: PASS — `Test Files … passed`, `Tests … passed`, zero failed. The count is at least 2272 (the 2026-09-03 baseline) plus this lane's new tests. If a file outside this lane fails, fix it here rather than in a later lane, and name the cause in the commit message.

- [ ] **Step 2: Typecheck and lint the whole project**

Run: `npx tsc -b`
Expected: no output (exit 0).
Run: `npm run lint`
Expected: no output (exit 0).

- [ ] **Step 3: Check the line endings and the diff's shape**

Run: `git diff --stat main`
Expected: exactly these files, no others — `src/api/netWorth.test.ts`, `src/api/netWorth.ts`, `src/api/spending.test.ts`, `src/api/spending.ts`, `src/components/shell/Feed.test.tsx`, `src/components/shell/Feed.tsx`, `src/pages/MonthlyUpdatePage.css`, `src/pages/MonthlyUpdatePage.test.tsx`, `src/pages/MonthlyUpdatePage.tsx`, `src/types/api.ts`.
Run: `git ls-files --eol src/pages/MonthlyUpdatePage.tsx src/components/shell/Feed.tsx src/types/api.ts`
Expected: every line reads `i/lf    w/lf`.

- [ ] **Step 4: Confirm nothing dead was left behind**

Run: `npx eslint src --rule '{"@typescript-eslint/no-unused-vars":"error"}'`
Expected: no output (exit 0).
Run: `grep -rn "setSaved\|balancesLeg" src/`
Expected: no matches — the two states Task 2 replaced are gone, including from comments.

- [ ] **Step 5: Commit anything the sweep fixed**

```bash
git status --short
git commit -am "fix(wizard): <what the sweep found>"
```
(Skip the commit when the sweep was clean — `git status --short` printing nothing IS the result.)

**Not in this lane:** the two-theme browser smoke and the before/after production table are lane V's (spec §7); the Health card's new `parent_component_drift` row and the attention items are lanes A/D.

---

## Self-review

**Spec §4 (wizard decoupling) coverage**

| Spec sentence | Task |
|---|---|
| Balances step → `PUT /net-worth/months/{m}` only | Task 2 (`save()` legs; `writes balances only …`) |
| Spending step writes only on a non-blank/non-zero amount OR net pay | Task 2 (`willWriteSpending`; `net pay alone saves the cashflow row`) |
| …OR the "Record this month as $0" checkbox, with its sentence | Task 3 (checkbox + `Writes $0.00 for every category — use it for a month you truly spent nothing.`) |
| Blank categories inside a saved step are `$0.00` | Task 2 (`net pay alone saves the cashflow row, with every blank category as $0.00`) |
| Net pay alone saves the cashflow row and no category rows | Task 2 — with the honest caveat that the wire still carries every category at `$0.00`, exactly as today; the server owns which rows change |
| Review step lists what each save wrote | Task 2 (`balancesSentence`/`spendingSentence`, the receipt card) |
| Review step keeps the danger-zone delete | Untouched by every task; `deleteMonth` only swaps `setSaved`/`setBalancesLeg` for `setLegs(null)` |
| Undo keeps working, one batch per PUT | Task 2 (`saveBatches` reads the spending batch only when that leg ran; existing undo tests still green) |
| `confirm_zero: true` only from the checkbox | Task 3 (`if (recordZero)`; the mutation check pins the absent key) |
| Repair banner + delete reusing `DELETE /spending/months/{m}`, balances untouched | Task 5 |

**Spec §5 (derived parents) coverage — the wizard's share**

| Spec sentence | Task |
|---|---|
| A parent row renders read-only with the live sum | Task 6 (`entry-derived-value`) |
| …the prior value and the delta | Task 6 (the row keeps both existing columns) |
| …class `entry-derived`, badge "derived" | Task 6 (row class + `.badge`) |
| Range paste skips it | Task 6 (the filtered `orderedBalanceRows`) |
| The live subtotal is unchanged | Task 6 (`deriveParents` writes the record, so `subtotalOf` and `preview` are literally untouched) |
| No parent entry in the PUT | Task 6 (the filtered wire array) |
| `MonthUpsertResult.derived` readable by the client | Task 1 |

**Name and type consistency (checked across tasks)**
- `SaveLegs`, `legs`, `setLegs`, `retryOf` — introduced in Task 2, used unchanged in Tasks 3 and 5.
- `hadSpending`, `anyAmountEntered`, `willWriteSpending` — declared in Task 2 Step 4c; Task 3 extends the last one with `|| recordZero` and nothing else renames.
- `recordZero`/`setRecordZero` (Task 3), `emptyMonth`/`setEmptyMonth` and `repairing` (Task 5), `componentsByParent`/`componentsOf`/`deriveParents` (Task 6) — each name appears with the same spelling in every task that reads it.
- `SpendingMonthUpsert` (Task 1) is the type annotated on `body` in Task 2's `save()` and extended with `confirm_zero` in Task 3; `MonthUpsert` (Task 1) types `putMonthBalances`, whose call site Task 6 edits.
- `FeedBanner`'s new prop is `action: { label, onAction, disabled? }` in Task 4 and is passed with exactly those three keys in Task 5.
- `deriveParents(byParent, record)` takes the MAP, not the account list — `componentsOf(accounts)` builds it (module scope in the load continuation, `componentsByParent` in the component).

**Deliberate deviations from the brief, and why**
- `.entry-derived` lives in `src/pages/MonthlyUpdatePage.css`, not `panels.css`: that is where `.entry-component` actually is (the brief's file reference was off by one sheet).
- The gate carries a fourth term, `hadSpending`, that the brief did not name: without it, zeroing a category on a month that already has spending would be silently skipped and the server would keep the old figure. The brief's three terms are all present and unchanged.
- `FeedBanner` gains one prop. The brief listed only page/api/type files, but the banner's button had to say "Delete the empty month", and renaming the shared Retry button would have touched twenty callers instead of none.
