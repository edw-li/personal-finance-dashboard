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
   - Test: two overlapping loads where the older settles last, and grips/dim stay until the newest
     settles.
2. **`TransactionsPanel.tsx`:** in the save's success handler, call `onChangedRef.current()` FIRST,
   before reading `result.transactions`, so a malformed answer still reloads (R3 review, optional
   hardening).
   - Test: a success answer without `transactions` still triggers `onChanged`.
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

- New module tests: …
- Per-panel test counts (before → after): …
- Undo-failure expectations changed: …
- Full vitest / tsc / eslint / build: …
- Lines removed from the five panels: …
