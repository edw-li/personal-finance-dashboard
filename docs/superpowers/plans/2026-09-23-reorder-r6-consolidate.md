# Lane R6 — consolidate the ordered-save pieces (2026-09-23) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> implementer in its own worktree, TDD per task, then ONE combined spec + code-quality review, then
> merge into `feat/reorder-base` — never main, never pushed). Steps use `- [ ]` checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-23-drag-to-reorder-design.md`. This lane adds no feature. It
applies §8.1's single Undo-failure sentence (amended 2026-09-23, f53f498c) everywhere, and it extracts
the pieces three code reviews found duplicated across the five reorderable panels (R2, R3 and R5
reviews). Those five panels are `CategoriesCard.tsx`, `AccountsCard.tsx`, `TransactionsPanel.tsx`,
`CardsPanel.tsx` and `CategoriesPanel.tsx`.

**Goal:** one copy module and two small hooks shared by the five panels, plus three small correctness
guards parked by the reviews. There is no behaviour change except the unified Undo-failure wording.

**Deliberately NOT in scope** (the reviews agreed these are panel-specific):
- the optimistic-layer state: what retires the saved layer differs per panel, and Transactions tags
  its layers by owner scope;
- the Undo mechanism: Settings uses the change-log `undoBatch`, the rest re-send the previous order;
- the Transactions success toast, with its figure changes.

No `useClientUndoOrder` mega-hook.

**Tech stack:** React 19 + TypeScript strict, vitest/jsdom (vitest globals OFF → `afterEach(cleanup)`).

---

## Mechanics (read once)

- **Worktree:** `C:/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r6`, branch
  `feat/reorder-consolidate`, cut from `feat/reorder-base` after R5 merged.
  - `node_modules` is a Windows junction; never install anything.
  - Never touch main, the main checkout or other worktrees; another Claude job is merging into main.
- **Memory is critically low on this box.**
  - Always run vitest as `npx vitest run --maxWorkers=2 …`.
  - Run ONE full run at the end.
  - Run no servers; this lane has no browser check (lane V's probe covers every surface afterwards).
- **Per task:** targeted tests + `npx tsc -b` + `npx eslint <touched files>`. Small conventional
  commits.
- **Known flakes** (re-run the file alone before calling one a failure): `PaycheckPage … employer
  match under the waterfall`, `OverviewPage … mounts the three snapshot charts`.

## File map

| File | Change |
|---|---|
| `src/components/reorder/orderCopy.ts` (create) + test | the §8.1 sentences as constants/builders, `clause()`, `undoFailureText(err)` |
| `src/components/reorder/useRequestCount.ts` (create) + test | `{ busy, track(run) }` |
| `src/components/reorder/useLatest.ts` (create) + test | a ref kept equal to the latest value |
| the five panels | use the three modules; delete their local copies (`clause`/`reason`/`message` helpers, counters, latest refs); unified Undo-failure wording |
| their tests | update Undo-failure expectations only |
| `src/pages/PortfolioPage.tsx` | `reloading` cleared only by the newest load (seq-guarded), same idiom as CreditCardsPage's `loading` guard |
| `src/components/portfolio/TransactionsPanel.tsx` | success handler calls the latest `onChanged` FIRST, so a malformed answer still reloads |
| `src/components/settings/ActivityCard.test.tsx` | the "caps the feed … Load more inside it" test waits for the list itself, not the region (a load flake seen twice today) |

---

### Task 1: `orderCopy.ts`

- [ ] **Step 1: failing tests** `src/components/reorder/orderCopy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ApiError } from '../../api/client'
import { ORDER_RESTORED, clause, movedToast, orderSaveFailed, undoFailed, undoFailureText } from './orderCopy'

describe('orderCopy (spec §8.1)', () => {
  it('speaks the §8.1 sentences', () => {
    expect(movedToast('Housing')).toBe('Moved Housing')
    expect(ORDER_RESTORED).toBe('Order restored')
    expect(orderSaveFailed('Network is down.')).toBe(
      "Couldn't save the new order — Network is down. The list is back to how it was.",
    )
    expect(undoFailed('Network is down.')).toBe("Couldn't undo the move — Network is down.")
  })

  it('a sentence placed inside ours loses only its trailing stop', () => {
    expect(clause('Later changes touched these rows — undo those first.')).toBe(
      'Later changes touched these rows — undo those first',
    )
    expect(clause('no stop')).toBe('no stop')
    expect(clause('trailing space. ')).toBe('trailing space')
  })

  it('an Undo refused by the server (any 4xx) shows the server sentence verbatim; anything else is ours', () => {
    const overlap = new ApiError(409, 'Later changes touched these rows — undo those first')
    expect(undoFailureText(overlap, 'the order')).toBe('Later changes touched these rows — undo those first')
    const stale = new ApiError(409, 'The cards changed since this list was loaded — nothing was moved.')
    expect(undoFailureText(stale, 'the order')).toBe('The cards changed since this list was loaded — nothing was moved.')
    expect(undoFailureText(new ApiError(500, 'Internal Server Error'), 'the order')).toMatch(/^Couldn't undo the move — /)
    expect(undoFailureText(new TypeError('Failed to fetch'), 'the order')).toMatch(/^Couldn't undo the move — /)
  })
})
```

  Before writing it, read `src/api/client.ts` for the real `ApiError` constructor signature and the
  `describeError(err, noun)` helper, and match them. If `ApiError`'s constructor differs, adapt the
  test's construction, not the module's contract.

- [ ] **Step 2: see it fail.** Run `npx vitest run --maxWorkers=2 src/components/reorder/orderCopy.test.ts`.

- [ ] **Step 3: implement** `src/components/reorder/orderCopy.ts`:

```ts
import { ApiError, describeError } from '../../api/client'

// The sentences every reorderable list speaks (2026-09-23 spec §8.1), written once. Before this
// module the five panels carried their own copies, and two lanes had drifted into two Undo-failure
// wordings.

export const ORDER_RESTORED = 'Order restored'

export function movedToast(name: string): string {
  return `Moved ${name}`
}

/** A sentence placed inside ours loses its trailing stop, so ours ends with exactly one. */
export function clause(text: string): string {
  return text.replace(/[.\s]+$/, '')
}

export function orderSaveFailed(reason: string): string {
  return `Couldn't save the new order — ${clause(reason)}. The list is back to how it was.`
}

export function undoFailed(reason: string): string {
  return `Couldn't undo the move — ${clause(reason)}.`
}

/** An Undo the server refused (any 4xx — the stale-list 409, the change-log's overlap sentence)
 *  says the server's own sentence; anything else is ours around the reason. */
export function undoFailureText(err: unknown, noun: string): string {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) return err.message
  return undoFailed(describeError(err, noun))
}
```

  Adjust the `describeError` call to its real signature. If `ApiError` exposes the status under
  another name, use that name.

- [ ] **Step 4: pass, lint, commit:** `feat(reorder): one copy module for the §8.1 order sentences`.

### Task 2: `useRequestCount.ts`

- [ ] **Step 1: failing test** `src/components/reorder/useRequestCount.test.tsx`. Use a tiny
  component that shows `busy` and exposes buttons starting two tracked requests backed by deferred
  promises. Cover:
  - `busy` is false at rest;
  - it is true after one start;
  - it stays true when the FIRST of two overlapping requests settles;
  - it is false only after both settle;
  - a request whose `run()` throws synchronously leaves the count balanced (busy false, error
    rethrown);
  - a rejecting request still decrements.

  Use `afterEach(cleanup)`.

- [ ] **Step 2: see it fail.**

- [ ] **Step 3: implement.**

```ts
import { useCallback, useState } from 'react'

/** How many of a list's requests are in flight — a count, never a flag: an Undo overlapping a later
 *  save must not re-enable the grips when the first of the two settles (R2/R3/R5 code reviews). The
 *  caller's `run` returns its WHOLE chain (`.then(onSaved, onFailed)` included), so the count drops
 *  only after the handlers ran. */
export function useRequestCount(): { busy: boolean; track: <T>(run: () => Promise<T>) => Promise<T> } {
  const [count, setCount] = useState(0)
  const track = useCallback(<T,>(run: () => Promise<T>): Promise<T> => {
    setCount((n) => n + 1)
    let pending: Promise<T>
    try {
      pending = run()
    } catch (err) {
      setCount((n) => n - 1)
      throw err
    }
    return pending.finally(() => setCount((n) => n - 1))
  }, [])
  return { busy: count > 0, track }
}
```

- [ ] **Step 4: pass, lint, commit:** `feat(reorder): useRequestCount — in-flight requests counted, not flagged`.

### Task 3: `useLatest.ts`

- [ ] **Step 1: failing test.** Render with prop A, then B. A callback captured during the first
  render reads `ref.current` after the rerender and gets B.
- [ ] **Step 2: see it fail.**
- [ ] **Step 3: implement.**

```ts
import { useLayoutEffect, useRef } from 'react'

/** A ref that always holds the latest value — for async callbacks (a save or Undo answering after a
 *  re-render) that must call the CURRENT `onChanged`, never the one captured at drop time. */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}
```

- [ ] **Step 4: pass, lint, commit:** `feat(reorder): useLatest`.

### Task 4: the five panels use the shared pieces

For EACH of `src/components/settings/CategoriesCard.tsx`, `src/components/settings/AccountsCard.tsx`,
`src/components/portfolio/TransactionsPanel.tsx`, `src/components/creditcards/CardsPanel.tsx` and
`src/components/creditcards/CategoriesPanel.tsx`:
1. **Copy:** replace the local sentence helpers (`clause`, `reason`, `message`, `orderSaveFailed`,
   `undoFailed`, any inline "Order restored" / "Moved …" / "Couldn't save the new order …" strings)
   with `orderCopy` imports.
   - The **Undo-failure path** uses `undoFailureText(err, <the panel's noun>)`. This changes the R3/R5
     wording from "Couldn't restore the order — …" to "Couldn't undo the move — …", and makes every
     4xx verbatim.
   - Keep each panel's non-reorder copy (edit/delete/form errors) as it is.
2. **Counter:** replace the local in-flight counter (`inFlight`, `pending`, `requestStarted/Settled`,
   `begin/settle`, `track`) with `useRequestCount()`.
   - Every request path goes through `track(() => <whole chain>)`: saves, Undo, edits, deletes, creates
     and reloads that the panel already counted.
   - Keep each panel's existing `disabled:` expression otherwise (`busy || reloading`,
     `busy || loadError !== null`).
3. **Latest ref:** replace the local latest-`onChanged` ref and its layout effect with
   `const onChangedRef = useLatest(onChanged)`, where the panel has one. The Settings cards own their
   `load`; if they keep a latest-ref for it, use `useLatest` there too.
4. **Tests:** run the panel's tests and update ONLY the Undo-failure string expectations that change,
   in R3's and R5's tests. Every other expectation must pass unchanged. If one doesn't, the refactor
   changed behaviour: stop and fix the code, not the test.
5. **Commit per panel:** `refactor(<area>): <Panel> speaks the shared order copy and counts requests
   with useRequestCount`.

### Task 5: the three parked guards

1. **`PortfolioPage.tsx`:** the `reloading` flag is cleared in `.finally` even by a load that `seqRef`
   has discarded (R3 review, PortfolioPage.tsx ~:383/:391). Clear it only when
   `seq === seqRef.current`. Mirror CreditCardsPage's `loading` guard (R5, c7a9337c).
   - Test: two overlapping loads where the older (discarded) one settles FIRST, and grips/dim stay
     until the newest settles. (Amended 2026-09-23 at lane R6's review: this said "settles last",
     which the guard cannot show — by then the newest has already lifted the dim.)
2. **`TransactionsPanel.tsx`:** in the save's AND the Undo's success handlers, call
   `onChangedRef.current()` before reading `result.transactions` (the save drops its pending layer
   first), so a malformed answer still reloads (R3 review, optional hardening). (Amended 2026-09-23
   at lane R6's review: this named only the save; the Undo's handler has the same shape.)
   - Test: a save and an Undo each answered with a malformed (body-less) answer still trigger
     `onChanged`.
3. **`ActivityCard.test.tsx`:** the "caps the feed with a scroll region that carries Load more inside
   it" test waits for the list itself before asserting. It raced the list's load under suite load
   twice today.
   - Fence extension: test file only.

Commit each.

### Task 6: gates and results

- [ ] Run `npx vitest run --maxWorkers=2 src/components/reorder src/components/settings src/components/portfolio src/components/creditcards src/pages/SettingsPage.test.tsx src/pages/PortfolioPage.test.tsx src/pages/CreditCardsPage.test.tsx`.
- [ ] Run ONE full `npx vitest run --maxWorkers=2`, then `npx tsc -b`, `npx eslint .` and `npm run build`.
- [ ] Scope check: `git diff --stat feat/reorder-base...HEAD`. It should list only the files in the
  file map, plus this plan's Results.
- [ ] Fill in Results. Commit: `docs(plan): lane R6 — results`.

## Results (filled in by the implementer)

- **Branch:** `feat/reorder-consolidate`, cut from `feat/reorder-base` @665a8d7c. Baseline of every test
  file the lane touches: 289 green (CategoriesCard 31, AccountsCard 45, TransactionsPanel 63,
  CreditCardsPage 93, PortfolioPage 51, ActivityCard 6).
- **Commits:**
  - modules: 2c17e1f4 (`orderCopy`) · 865141cd (`useRequestCount`) · 9c4d5149 (`useLatest`);
  - panels: 3207dafe (CategoriesCard) · aa22dc50 (AccountsCard) · cc1f744c (TransactionsPanel) ·
    51325576 (CardsPanel) · dc25b3af (CategoriesPanel);
  - guards: 56b6e331 (PortfolioPage `reloading`) · b2b15041 (Transactions reloads before reading the
    answer) · b783e9dc (ActivityCard test waits for the list).
- **New module tests: 10.**
  - `orderCopy.test.ts` (4): the §8.1 sentences; `clause`; any 4xx verbatim (400, 409 ×2, 422 with its
    own stop), and ours around `errorDetail` for a 500, a status-0 timeout, a `TypeError` and a
    non-Error; an empty refusal reads "HTTP 409", never an empty toast.
  - `useRequestCount.test.tsx` (5): idle at rest; busy until the request settles, its answer handed
    on; still busy when the first of two overlapping requests settles; a rejection counts down and
    reaches the caller; a synchronous throw is counted straight back out and rethrown (a later request
    still returns to idle).
  - `useLatest.test.tsx` (1): a callback made in render 1 reads render 2's value; the plain closure
    beside it still reads render 1's.
- **Per-panel test counts (before → after):**
  - CategoriesCard 31 → 31; AccountsCard 45 → 45;
  - TransactionsPanel 63 → 66 (+1 422 Undo row, +2 malformed-answer guards);
  - CreditCardsPage, which holds the CardsPanel and CategoriesPanel tests, 93 → 95 (+2 422 Undo rows);
  - PortfolioPage 51 → 52 (+1 `reloading` guard); ActivityCard 6 → 6.
  - At each panel's first run after its refactor, the only failing test was its Undo-failure string
    (R2's cards: none — they already spoke the §8.1 sentence).
- **Undo-failure expectations changed** (R3's and R5's tests only):
  - `TransactionsPanel.test.tsx`: the 500 row "Couldn't restore the order — the server had a problem
    (HTTP 500)." → "Couldn't undo the move — …"; its negative twin `/Couldn't restore the order/` →
    `/Couldn't undo the move/`, so it still guards something.
  - `CreditCardsPage.test.tsx`, for the roster and for Categories & weights each: the same 500 row, the
    same negative twin, and the test title "never \"Couldn't restore the order\"" → "never \"Couldn't
    undo the move\"".
  - New in all three tables: a 422 row whose server sentence is shown verbatim (the old code said
    "Couldn't restore the order — ids lists … more than once.").
- **Full vitest / tsc / eslint / build:**
  - The ONE full `npx vitest run --maxWorkers=2`: **265 files / 3847 tests, all passed** (350 s, run
    beside another job's vitest in the main checkout). Neither known flake tripped.
  - The Task 6 targeted run: 57 files / 861 tests, green.
  - `npx tsc -b`: 0.
  - `npx eslint .`: 0 errors, 26 warnings, none new. The only one in this lane's files is
    CategoriesPanel's pre-existing `SEED_CATEGORIES` export warning.
  - `npm run build`: exit 0. The new modules ship as their own 0.62 kB chunk.
    - Its one advisory is not this lane's: the echarts `tooltip` chunk is 763.29 kB against the
      760 kB limit. Built from the base's six source files, the same chunk measures 763.29 kB, so the
      overage predates R6.
- **Scope check:** `git diff --stat feat/reorder-base...HEAD` lists the file map's files, the three
  module tests, and `src/pages/PortfolioPage.test.tsx` (the Task 5 page guard's test).
- **Lines removed from the five panels:** 3200 → 3109, **−91** (whitespace-insensitive +150/−241).
  - CategoriesCard 457 → 434 · AccountsCard 722 → 699 · TransactionsPanel 755 → 742 (after gaining
    the Task 5 guard's comment) · CardsPanel 698 → 682 · CategoriesPanel 568 → 552.
  - The raw diff is larger (+348/−439): a chain wrapped in `track(() => …)` moves two spaces right.
- **Adaptations to `client.ts` (Task 1):**
  - `ApiError` is `(message, status)`, so the tests construct it that way.
  - `undoFailureText(err)` takes the error alone, as the file map names it. The reason is
    `errorDetail(err)`. `describeError(err, noun)` is the load-failure sentence ("Couldn't load {noun}
    — …"), and wrapping it would have read "Couldn't undo the move — Couldn't load the order — …".
  - The 4xx branch returns `errorDetail(err)` too. That is the server's sentence verbatim whenever it
    sent one (R2's `err.message` and R3/R5's `errorDetail` agree), and "HTTP 409" when it sent none.
- **Decisions and deviations:**
  - **Kept per panel, as planned:** the optimistic layers; the Undo mechanisms; the Transactions
    success toast; what each 409 save does after its toast (the Settings cards reload through
    `load()`, the rest through `onChanged`); `message()` (form, delete and retag copy); AccountsCard's
    `portfolioBusy`, the portfolio-labels feed's own flag and not the roster's counter. (The 409
    sentence itself and the Transactions delete-Undo's count were unified in the review round below.)
  - **The `reloading` guard lives in `load()`**, as CreditCardsPage's does. Guarding only the two
    callers would have left the dim up for good whenever a refresh's or a deactivation's `load()`
    superseded a reload. Those paths call `load()` directly and never raised the dim themselves.
  - **Task 5.1's page test settles the discarded load FIRST** (the task text is amended to match):
    settling last, the newest has already lifted the dim, before and after the fix. c7a9337c's test
    does the same. It failed before the fix at the first assertion after the discarded load.
  - **Task 5.2 covers the Undo's success handler too** (the task text is amended to match): the
    server has applied the order either way, so the page must reload. It has its own test.
    - In both handlers `onChanged` runs before the answer is read. The save drops its pending layer
      first, so a throwing `onChanged` cannot strand a layer that only an answer retires.
  - **ActivityCard:** with the page answering at once, the old wait passed alone, because a `findBy*`
    drains one tick and the page landed in it. The test's page now lands 25 ms after the first paint.
    With the region wait that failed 3/3 at `.activity-list`; `findByRole('list')` passes 3/3.
- **Behaviour changes found:** none. No expectation outside the Undo-failure strings moved, and no
  code had to be changed back.
- **Review round (2026-09-23, after the merge at 58f048c4; the branch fast-forwarded to it):**
  - cf20aaa6 (item 1): the scroll-cap test finds Load more by name inside the box — the rows' own Undo
    and View report buttons satisfied the bare `button` query.
  - c3ad27ab (item 2): the feed's first test waits for its rows (`findAllByRole('listitem')`).
  - a62645e9 (item 3): a 503 Undo on each Settings card says "Couldn't undo the move — the server had
    a problem (HTTP 503)." — all five call sites now pin the one sentence.
  - 83e7ab31 (item 5): the save guard's title says "a malformed answer".
  - 481da9c2 (item 6): `Probe`'s click handler is `launch`, no longer shadowing `start`.
  - 192afc7a (item 7): the Transactions delete-Undo re-POST runs through `track`, as CardsPanel's and
    CategoriesPanel's do. Its test failed before the fix: the grips woke at once.
  - 6ab63932 (item 8): `orderCopy.staleListText(err)` — the server's sentence verbatim, else
    `errorDetail` ("HTTP 409") — at every 409 save path of the five panels. The Settings cards showed
    `err.message`, so an empty body toasted nothing; their new empty-body tests failed before the fix.
    R3/R5's words are unchanged.
  - This commit (item 4): Task 5's two lines amended, and these Results brought up to date.
  - **Counts:** orderCopy 4 → 5; CategoriesCard 31 → 33; AccountsCard 45 → 47; TransactionsPanel
    66 → 67; ActivityCard 6; useRequestCount 5; CreditCardsPage 95 — all green (targeted runs,
    `--maxWorkers=2`). `npx tsc -b` 0; eslint on the touched files 0 errors (the one warning is
    CategoriesPanel's pre-existing `SEED_CATEGORIES`).
  - **A load flake for lane V's list:** `TransactionsPanel entry session › a successful edit still
    resets the whole form — carry-forward is create-only` failed once while another job's full vitest
    ran beside this one, then passed 3/3 alone. It clicks Edit as soon as `onChanged` has fired, and
    `busy` (which disables Edit) clears one microtask later. This predates R6: the chain is as deep as
    before. The fix would be to wait for Edit to be enabled before clicking.
