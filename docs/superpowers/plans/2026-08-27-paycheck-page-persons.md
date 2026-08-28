# Paycheck Page: Person Switcher + Household Tile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **RECONCILIATION (orchestrator, 2026-08-27):** Plan 1's contracts, now written, CONFIRM
> this plan's Task-0 assumptions verbatim: `GET /paycheck/breakdown?profile_id=&person_id=`
> (both optional, **profile_id wins outright**, absent person = primary, 404s for unknown
> person / profile-less person), `PaycheckProfileOut` carries `person_id` + `hsa_coverage`
> (`'none'|'self'|'family'`), create accepts optional `person_id`, and the profiles list
> stays one effective_date-DESC list. Task 0's STOP conditions should not fire; if one does,
> reality wins and the deviation is recorded.

**Goal:** Make `/paycheck` a two-earner page. Me/\<Partner\> switcher chips (the Net-Worth owner-chip grammar) move the waterfall, the per-paycheck sankey, the profile history and the create form to one person at a time; a **household take-home tile** adds the monthly net of the profile **in force for each person**; the profile form gains the `hsa_coverage` tier. A one-person household gets **none** of it — no chips, no tile, no `person_id` on the wire, the same snapshot key, the same DOM — and that is pinned by an explicit zero-diff test. **No new dependencies, no migrations** (those are Plan 1 of this batch).

**Architecture:** One state object owns the whole question: `selection = { profileId, personId }`, where **`null` means "the default"** on both axes — `profileId: null` = whichever profile the server has in force, `personId: null` = the primary person, sent as **no query param at all**. That single convention is what makes the single-earner page byte-identical: the request, the snapshot key (`paycheck:breakdown:current`, unsuffixed) and the create body all keep their pre-batch shape whenever `personId` is null. The chips write `personId` (and reset `profileId`, because a pinned row belongs to the person being left); everything else on the page reads it.

Three **independent** loads, each with its own sequence ref, banner and busy flag — the page already runs two (profiles, breakdown) and this plan adds the third:

| Load | Trigger | Failure costs |
|---|---|---|
| `fetchProfiles()` | mount + writes | the table (existing banner) |
| `fetchBreakdown(profileId, personId)` | `selection` identity | the waterfall (existing banner) |
| `fetchHousehold()` | mount (once) | **the chips only** — page unaffected |
| household legs: `fetchBreakdown(undefined, <each person>)` | household load + writes | **the tile only** — absent, never half-true |

The household tile is deliberately **not** derived from the waterfall's payload: that one follows the chips and any pinned row, while the tile is always "the profile in force for each person". Two extra GETs on a two-person household, once per household load, is the price of a figure that cannot drift with a chip press.

The profile history is filtered **client-side** — `GET /paycheck/profiles` stays one ordered list (spec §4.1), so a chip press costs zero requests for the table. When the household is unknown (not loaded, or the endpoint failed) the list is **unfiltered**: without a person to filter by, an empty table would be a lie, and today's whole list is the honest degradation.

**Tech Stack:** React 19 + TypeScript 5.9 + Vitest 3 + @testing-library/react 16, ECharts 6 (never rendered in jsdom). No new packages.

**Specs:** `docs/superpowers/specs/2026-08-27-two-income-streams-design.md` — §5 (Paycheck page bullets), §4.1 (per-person profile contracts), §6 (error handling & honesty), §7 (byte-identity pins), §9 Plan 3 (this plan's scope). Binding for semantics.

---

## Preconditions — Plans 1 & 2 of this batch land FIRST

This plan assumes the backend contracts below. **Task 0 verifies every one of them before a line is written.** If a plan file `docs/superpowers/plans/2026-08-27-person-paycheck-profiles.md` exists, reconcile names against it; at the time of writing it does **not** exist, so these are contracts taken from the spec and must be re-checked against the merged code:

1. `paycheck_profiles.person_id` — NOT NULL FK → `people.id`, existing rows backfilled to the primary. Surfaces on **`PaycheckProfileOut`** as `person_id: int`.
2. `paycheck_profiles.hsa_coverage` — `'none' | 'self' | 'family'`, NOT NULL, server_default `'self'`. Surfaces on `PaycheckProfileOut` and is accepted on create/update.
3. `GET /paycheck/breakdown?person_id=<id>` — **absent = the primary person**; combines with the existing `profile_id`.
4. `POST /paycheck/profiles` accepts `person_id` (absent = primary).
5. `GET /paycheck/profiles` still returns **one** list, `effective_date` DESC across all people, each row carrying `person_id`.
6. `GET /api/v1/household` → `{people: [{id, name, is_primary}], marriage_date}` — already merged (`src/api/household.ts`, `HouseholdOut` in `src/types/api.ts`).

**Out of scope here (other plans):** the contribution-pace strip (Plan 4 — this plan leaves a marked mount point and must not build it), the withholding panel's `partner_source` copy, the money-flow salary split, per-person paydays (all Plan 2), and the Settings limits card (Plan 4).

**House rules that bind every task:** decimal strings on the wire, never re-derived on the client; comments explain constraints, not narration; no file deletions; small frequent commits; **never push**; setState only in promise continuations, never in an effect's synchronous body (`react-hooks/set-state-in-effect`).

---

## File structure

| File | Change |
|---|---|
| `src/types/api.ts` | `HsaCoverage`; `person_id` + `hsa_coverage` on `PaycheckProfileOut`; optional both on `PaycheckProfileCreate` |
| `src/api/paycheck.ts` | `personId` param on `fetchBreakdown` |
| `src/api/paycheck.test.ts` (new) | query-string plumbing pin |
| `src/components/paycheck/paycheckSankeyOptions.test.ts` | fixture repair (two new required wire fields) |
| `src/pages/PaycheckPage.tsx` | household fetch, person chips, person-scoped breakdown + snapshot key, filtered history, keyed form, household tile, `hsa_coverage` form field + column, Plan-4 mount point |
| `src/pages/PaycheckPage.css` | `.paycheck-person-row`, `.paycheck-household`, select override |
| `src/pages/PaycheckPage.test.tsx` | household mock + one-person default; fixture repair; **two body goldens gain `hsa_coverage`** (the only edits to existing cases); new two-earner describe block |

---

## Phase 0 — Preconditions

### Task 0: Verify Plans 1-2 landed and the toolchain answers

**Files:** none (environment only)

- [ ] **Step 1: Confirm a clean tree on a feature branch.**

```bash
git status --porcelain          # expected: EMPTY
git rev-parse --abbrev-ref HEAD # expected: a feature branch, NOT main
```

If you are on `main`: `git checkout -b paycheck-page-persons`. Do not stash or discard anyone else's work.

- [ ] **Step 2: Verify the backend contracts.** Run:

```bash
cd backend && .venv/Scripts/python -c "from app.models import PaycheckProfile; print(sorted(c.name for c in PaycheckProfile.__table__.c))"
```

Expected: the list **contains `person_id` and `hsa_coverage`**. If either is missing, Plan 1 has not merged — **STOP and report**; nothing in this plan can be built against a single-person profile table.

- [ ] **Step 3: Verify the breakdown route takes a person.** Run:

```bash
cd backend && grep -n "person_id" app/api/paycheck.py | head -20
```

Expected: `person_id` appears as a query parameter on the breakdown route and on the create schema. If the parameter is spelled differently (e.g. `owner`), adapt every `person_id` reference in this plan to that spelling and note the substitution in each commit message; nothing else changes.

- [ ] **Step 4: Frontend baseline.** Run:

```bash
npx vitest run src/pages/PaycheckPage.test.tsx src/components/paycheck/paycheckSankeyOptions.test.ts
npx tsc -b
```

Expected: all green. If `tsc -b` already fails because `PaycheckProfileOut` lacks the two new fields while the backend has them, that is exactly what Task 1 fixes — note it and continue.

---

## Phase 1 — Wire types & client

### Task 1: `person_id` + `hsa_coverage` on the wire, `personId` on the breakdown client

**Files:**
- Modify: `src/types/api.ts` (`PaycheckProfileOut` `:990-1004`, `PaycheckProfileCreate` `:1006-1018`)
- Modify: `src/api/paycheck.ts` (`fetchBreakdown` `:36-41`)
- Create: `src/api/paycheck.test.ts`
- Modify: `src/components/paycheck/paycheckSankeyOptions.test.ts` (fixture `:10-23`)
- Modify: `src/pages/PaycheckPage.test.tsx` (fixtures `:56-84`)

- [ ] **Step 1: Write the failing client test.** Create `src/api/paycheck.test.ts`:

```ts
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createProfile, fetchBreakdown, fetchProfiles } from './paycheck'

// The client module is a thin path/verb/body mapper; fetch is the seam (household.test.ts's
// arrangement). Every assertion here is about the REQUEST, not the response.
const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  // A FRESH Response per call: a body can only be consumed once, and these tests call
  // their client more than once.
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function lastUrl(): string {
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as string
}

it('asks for the default breakdown with NO query string at all', async () => {
  await fetchBreakdown()
  // The byte-identity pin (spec §7): a single-earner household must send exactly the
  // request the server has always answered — no person_id, no empty "?".
  expect(lastUrl()).toBe('/api/v1/paycheck/breakdown')
})

it('sends profile_id alone, person_id alone, and both in that order', async () => {
  await fetchBreakdown(7)
  expect(lastUrl()).toBe('/api/v1/paycheck/breakdown?profile_id=7')

  await fetchBreakdown(undefined, 2)
  expect(lastUrl()).toBe('/api/v1/paycheck/breakdown?person_id=2')

  await fetchBreakdown(7, 2)
  expect(lastUrl()).toBe('/api/v1/paycheck/breakdown?profile_id=7&person_id=2')
})

it('leaves the profiles list unscoped — one ordered list, grouped by the UI', async () => {
  await fetchProfiles()
  // Spec §4.1: the list stays one payload for every person, so a chip press costs no
  // request for the table.
  expect(lastUrl()).toBe('/api/v1/paycheck/profiles')
})

it('POSTs the create body verbatim, person_id included when the caller sends one', async () => {
  await createProfile({
    effective_date: '2026-09-01',
    annual_salary: '120000',
    person_id: 2,
    hsa_coverage: 'family',
  })
  const init = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1] as RequestInit
  expect(lastUrl()).toBe('/api/v1/paycheck/profiles')
  expect(init.method).toBe('POST')
  expect(JSON.parse(init.body as string)).toEqual({
    effective_date: '2026-09-01',
    annual_salary: '120000',
    person_id: 2,
    hsa_coverage: 'family',
  })
})
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `npx vitest run src/api/paycheck.test.ts`
Expected: FAIL — `fetchBreakdown` takes one argument, so `?person_id=2` never appears; and `tsc`/vitest reject `person_id`/`hsa_coverage` on `PaycheckProfileCreate`.

- [ ] **Step 3: Implement the types.** In `src/types/api.ts`, replace the `PaycheckProfileOut` and `PaycheckProfileCreate` blocks (`:990-1018`) with:

```ts
/**
 * HSA coverage tier (2026-08-27 spec §3.2) — decides WHICH annual HSA cap applies to this
 * person, so it is per profile, not per household. Stored NOT NULL with server_default
 * 'self'; the backfill gave every pre-batch row 'self'.
 */
export type HsaCoverage = 'none' | 'self' | 'family'

export interface PaycheckProfileOut {
  id: number
  /** Whose profile this is (spec §3.1). NOT NULL server-side; legacy rows backfilled to
   *  the primary person, so this is always a real id, never null. */
  person_id: number
  effective_date: string
  annual_salary: string
  pay_periods_per_year: number
  // The five pcts are Numeric(10,9) — 9dp strings, e.g. "0.130000000".
  trad_401k_pct: string
  roth_401k_pct: string
  after_tax_401k_pct: string
  espp_pct: string
  withholding_pct: string
  dental_vision_per_check: string
  hsa_per_check: string
  hsa_coverage: HsaCoverage
  notes: string | null
}

export interface PaycheckProfileCreate {
  effective_date: string
  annual_salary: string
  /** ABSENT = the primary person (spec §4.1's wire back-compat). The page omits it unless
   *  a partner chip is actually picked, which is what keeps the single-earner create
   *  byte-identical to the pre-batch one. */
  person_id?: number
  pay_periods_per_year?: number // the sheet's 24 (semi-monthly) is the default
  trad_401k_pct?: string
  roth_401k_pct?: string
  after_tax_401k_pct?: string
  espp_pct?: string
  withholding_pct?: string
  dental_vision_per_check?: string
  hsa_per_check?: string
  hsa_coverage?: HsaCoverage
  notes?: string | null
}
```

- [ ] **Step 4: Implement the client.** In `src/api/paycheck.ts`, replace `fetchBreakdown` (`:36-41`) with:

```ts
// No id = the profile in force today (the latest one effective now or earlier, falling
// back to the earliest future one); 404 when there are no profiles at all. `personId`
// absent = the PRIMARY person (spec §4.1) — the params are built by presence, never as
// empty strings, so a single-earner request carries no query string at all and stays the
// exact request the server has always answered.
export function fetchBreakdown(
  profileId?: number,
  personId?: number,
): Promise<PaycheckBreakdownOut> {
  const params: string[] = []
  if (profileId !== undefined) params.push(`profile_id=${profileId}`)
  if (personId !== undefined) params.push(`person_id=${personId}`)
  const qs = params.length === 0 ? '' : `?${params.join('&')}`
  return api<PaycheckBreakdownOut>(`/paycheck/breakdown${qs}`)
}
```

- [ ] **Step 5: Repair the two fixture files** (the new wire fields are REQUIRED on `PaycheckProfileOut`, so every fixture that builds one must carry them — `tsc -b` fails otherwise).

In `src/components/paycheck/paycheckSankeyOptions.test.ts`, in the `profile` fixture (`:10-23`), add `person_id: 1,` immediately after `id: 1,` and `hsa_coverage: 'self',` immediately after `hsa_per_check: '100.00',`.

In `src/pages/PaycheckPage.test.tsx`, do the same to **both** fixtures: `profile2026` (`:56-69`) gets `person_id: 1,` after `id: 1,` and `hsa_coverage: 'self',` after `hsa_per_check: '100.00',`; `profile2025` (`:71-84`) gets `person_id: 1,` after `id: 2,` and `hsa_coverage: 'self',` after `hsa_per_check: '75.00',`.

Both fixture people are the **primary** — that is what keeps every pre-existing test the pre-batch page.

- [ ] **Step 6: Run to pass.**

```bash
npx vitest run src/api/paycheck.test.ts src/pages/PaycheckPage.test.tsx src/components/paycheck/paycheckSankeyOptions.test.ts
npx tsc -b
```

Expected: all green. The page still ignores both new fields — that is Tasks 2-4.

- [ ] **Step 7: Commit.**

```bash
git add src/types/api.ts src/api/paycheck.ts src/api/paycheck.test.ts src/components/paycheck/paycheckSankeyOptions.test.ts src/pages/PaycheckPage.test.tsx
git commit -m "feat(paycheck-ui): person_id + hsa_coverage on the wire, personId on fetchBreakdown"
```

---

## Phase 2 — The page

### Task 2: Person switcher chips, and every per-person surface behind them

**Files:**
- Modify: `src/pages/PaycheckPage.test.tsx` (mock header `:9-15`, imports `:1-6`, fixtures after `:126`, `beforeEach` `:157-165`, new describe at end of file)
- Modify: `src/pages/PaycheckPage.tsx` (imports `:1-26`, `ProfilesPanel` props `:239-260`, `submit` body `:345-361`, `breakdownKey` `:616-619`, page state `:621-643`, breakdown effect `:683-712`, `reselectWith` `:729-737`, `onProfilesChanged` `:756-764`, render `:766-845`)
- Modify: `src/pages/PaycheckPage.css` (append)

- [ ] **Step 1: Write the failing tests.**

(a) In `src/pages/PaycheckPage.test.tsx`, add the household module mock immediately after the existing `vi.mock('../api/paycheck', ...)` block (`:15`):

```tsx
// The chips' source. Mocked because the page now fetches it on mount: unmocked, the real
// client would reach `fetch` in jsdom and the isolated-fetch catch would swallow a network
// error on every test in this file.
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))
```

(b) Extend the two import lines at the top (`:4-5`) to:

```tsx
import type { HouseholdOut, PaycheckBreakdownOut, PaycheckProfileOut } from '../types/api'
import { clearSnapshots, getSnapshot, setSnapshot } from '../api/snapshotCache'
```

(c) Add to the client import block after `:47`:

```tsx
import { fetchHousehold } from '../api/household'
```

(d) Add fixtures immediately after `breakdown2025` (`:126`):

```tsx
const ME = { id: 1, name: 'Me', is_primary: true }
const SAM = { id: 2, name: 'Sam', is_primary: false }

// The DEFAULT arrangement is one person: every test written before this batch is therefore
// the pre-batch page, unchanged, and the two-earner tests opt in explicitly.
function household(over: Partial<HouseholdOut> = {}): HouseholdOut {
  return { people: [ME], marriage_date: null, ...over }
}

const samProfile: PaycheckProfileOut = {
  id: 3,
  person_id: SAM.id,
  effective_date: '2026-03-01',
  annual_salary: '120000.00',
  pay_periods_per_year: 24,
  trad_401k_pct: '0.060000000',
  roth_401k_pct: '0.000000000',
  after_tax_401k_pct: '0.000000000',
  espp_pct: '0.000000000',
  withholding_pct: '0.280000000',
  dental_vision_per_check: '9.00',
  hsa_per_check: '0.00',
  hsa_coverage: 'none',
  notes: 'Sam base',
}

// effective_date DESC across BOTH people — the one ordered list the router answers with.
const TWO_PERSON_PROFILES = [samProfile, profile2026, profile2025]

const samBreakdown = breakdownOf(samProfile, {
  gross: '5000.00',
  trad_401k: '300.00',
  dental_vision: '9.00',
  hsa: '0.00',
  taxable: '4691.00',
  withholding: '1400.00',
  post_tax: '3291.00',
  roth_401k: '0.00',
  after_tax_401k: '0.00',
  espp: '0.00',
  net_pay: '2615.67',
  monthly_net: '5231.34',
})

/**
 * Routes each breakdown request the way the server would: the partner's id answers with
 * Sam's check, a pinned 2025 id with the 2025 one, everything else with the primary's
 * in-force check. `sam` may be an Error — that is the "partner has no profile in force"
 * case the household tile has to degrade on.
 */
function routeBreakdowns(sam: PaycheckBreakdownOut | Error = samBreakdown) {
  vi.mocked(fetchBreakdown).mockImplementation((profileId?: number, personId?: number) => {
    if (personId === SAM.id) {
      return sam instanceof Error ? Promise.reject(sam) : Promise.resolve(sam)
    }
    if (profileId === profile2025.id) return Promise.resolve(breakdown2025)
    return Promise.resolve(breakdownOf(profile2026))
  })
}

/** The two-earner arrangement: both people, both timelines, routed breakdowns. */
function twoEarners(sam: PaycheckBreakdownOut | Error = samBreakdown) {
  vi.mocked(fetchHousehold).mockResolvedValue(household({ people: [ME, SAM] }))
  vi.mocked(fetchProfiles).mockResolvedValue(TWO_PERSON_PROFILES)
  routeBreakdowns(sam)
}
```

(e) Add the household default to `beforeEach` (`:157-165`), immediately after the `clearSnapshots()` line:

```tsx
  vi.mocked(fetchHousehold).mockResolvedValue(household())
```

(f) Append a new describe block at the end of the file:

```tsx
describe('PaycheckPage — two earners (2026-08-27 spec §5)', () => {
  it('shows no switcher at all for a one-person household', async () => {
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')
    await waitFor(() => expect(vi.mocked(fetchHousehold)).toHaveBeenCalled())
    // Nothing to switch between: a one-option control is not an affordance, it is noise.
    expect(screen.queryByRole('group', { name: 'Person' })).toBeNull()
  })

  it('renders one chip per person, primary first, with the primary lit', async () => {
    twoEarners()
    render(<PaycheckPage />)
    const chips = await screen.findByRole('group', { name: 'Person' })
    // Primary first, then everyone else by id — the same order NetWorthPage's owner chips
    // use, so a person sits in the same place on both pages.
    expect([...chips.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Me',
      'Sam',
    ])
    expect(screen.getByRole('button', { name: 'Me' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Sam' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('switches the waterfall to the chip’s person and drops the pinned row', async () => {
    twoEarners()
    render(<PaycheckPage />)
    await screen.findByRole('group', { name: 'Person' })

    // Pin a row of MY history first: the switch has to abandon it, or the next request
    // would ask for one person's profile id under another person's scope.
    fireEvent.click(screen.getByRole('button', { name: 'Show the breakdown for Jan 1, 2025' }))
    await screen.findByText('$2,984.91')

    vi.mocked(fetchBreakdown).mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Sam' }))

    await waitFor(() => expect(vi.mocked(fetchBreakdown)).toHaveBeenCalledTimes(1))
    // The household tile's own legs are keyed on the household, not on the chip, so they
    // do not re-fire here — this one call is the page's, with the pin dropped.
    expect(vi.mocked(fetchBreakdown).mock.calls[0]).toEqual([undefined, SAM.id])
    expect(await screen.findByText('Per-check breakdown — effective Mar 1, 2026')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sam' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Me' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('filters the history to the chip’s person and reseeds the form from THEIR latest row', async () => {
    twoEarners()
    render(<PaycheckPage />)
    await screen.findByRole('group', { name: 'Person' })

    // My two rows, and no sign of Sam's — one list on the wire, grouped here.
    await waitFor(() => expect(screen.queryByText('Mar 1, 2026')).toBeNull())
    expect(screen.getByText('Jan 1, 2026')).toBeTruthy()
    expect(screen.getByText('Jan 1, 2025')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Sam' }))

    await waitFor(() => expect(screen.getByText('Mar 1, 2026')).toBeTruthy())
    expect(screen.queryByText('Jan 1, 2025')).toBeNull()
    // The carry-forward form is Sam's now: a half-typed row of mine surviving the switch
    // would be filed under Sam on the next save.
    await waitFor(() => expect(field('Annual salary').value).toBe('$120,000.00'))
    expect(field('Traditional 401(k) %').value).toBe('6%')
  })

  it('carries the picked person on a create, and nothing at all on the primary’s', async () => {
    twoEarners()
    render(<PaycheckPage />)
    await screen.findByRole('group', { name: 'Person' })

    type('Effective date', '2026-09-01')
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))
    await waitFor(() => expect(vi.mocked(createProfile)).toHaveBeenCalledTimes(1))
    // The primary's create carries NO person_id: absent resolves to the primary
    // server-side, which is what keeps the single-earner request byte-identical (§4.1).
    expect(Object.keys(vi.mocked(createProfile).mock.calls[0][0])).not.toContain('person_id')

    fireEvent.click(screen.getByRole('button', { name: 'Sam' }))
    await waitFor(() => expect(field('Annual salary').value).toBe('$120,000.00'))
    type('Effective date', '2026-09-01')
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))
    await waitFor(() => expect(vi.mocked(createProfile)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(createProfile).mock.calls[1][0].person_id).toBe(SAM.id)
  })

  it('keeps the whole page when the household endpoint fails', async () => {
    vi.mocked(fetchHousehold).mockRejectedValue(new ApiError('household down', 503))
    vi.mocked(fetchProfiles).mockResolvedValue(TWO_PERSON_PROFILES)
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')
    await waitFor(() => expect(vi.mocked(fetchHousehold)).toHaveBeenCalled())

    // The switcher is an affordance; losing it must cost the chips and nothing else.
    expect(screen.queryByRole('group', { name: 'Person' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    // The history degrades to today's WHOLE list rather than an empty table: with no
    // household there is no person to filter by, and an empty table would be a lie.
    expect(screen.getByText('Mar 1, 2026')).toBeTruthy()
    expect(screen.getByText('Jan 1, 2026')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `npx vitest run src/pages/PaycheckPage.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "group" and name "Person"` on every two-earner test. The pre-existing tests **must all still pass** at this point (the one-person default keeps them on the pre-batch page); if any of them fails, stop and fix that before implementing.

- [ ] **Step 3: Implement — imports.** In `src/pages/PaycheckPage.tsx`, add after the `../api/paycheck` import block (`:9`):

```tsx
import { fetchHousehold } from '../api/household'
```

and extend the types import (`:17-21`) to:

```tsx
import type {
  HouseholdOut,
  PaycheckBreakdownOut,
  PaycheckProfileCreate,
  PaycheckProfileOut,
} from '../types/api'
```

- [ ] **Step 4: Implement — the create body carries the person.** In `ProfilesPanel`, extend the prop list (`:239-260`) — add `personId` to the destructure and to the prop type:

```tsx
function ProfilesPanel({
  profiles,
  personId,
  shownId,
  pinnedId,
  onSelect,
  onShowCurrent,
  onChanged,
}: {
  profiles: PaycheckProfileOut[]
  /** The person the CHIPS picked, or null for "the default" (the primary, or a household
   *  with nobody to switch between). A create carries it; a PATCH never does — this form
   *  cannot move a stored profile from one person to another. */
  personId: number | null
  /** The profile the breakdown above is actually showing — the server's answer, not ours. */
  shownId: number | null
```

(the rest of the prop type is unchanged), and add one line to the `body` literal in `submit` (`:345-361`), immediately after `notes: form.notes.trim() || null,`:

```tsx
      // Create only, and only for an explicitly-picked person: an absent person_id resolves
      // to the primary server-side (spec §4.1), so the default create is byte-identical to
      // the pre-batch one. A PATCH omits it because the stored row already knows whose it
      // is — sending it would let a mis-click reassign someone's comp history.
      ...(editingId === null && personId !== null ? { person_id: personId } : {}),
```

- [ ] **Step 5: Implement — the per-person snapshot key.** Replace `breakdownKey` (`:616-619`) with:

```tsx
// Per-profile, per-person snapshot key. null profile = whichever profile the server picks
// for today; null person = the primary — and the primary's key keeps its ORIGINAL,
// unsuffixed shape. A changed key would silently cold-start every first paint on this page
// for the single-earner household this app has had until now (2026-08-27 spec §1).
function breakdownKey(profileId: number | null, personId: number | null): string {
  const base = `paycheck:breakdown:${profileId ?? 'current'}`
  return personId === null ? base : `${base}:person:${personId}`
}
```

- [ ] **Step 6: Implement — page state.** In `PaycheckPage`, replace the `cachedBreakdown` line (`:628`) with:

```tsx
  const cachedBreakdown = getSnapshot<PaycheckBreakdownOut>(breakdownKey(null, null))
```

replace the `selection` state (`:640-643`) with:

```tsx
  // An OBJECT, not a bare id: a fresh identity re-runs the load effect, so a write can
  // refetch the SAME waterfall (TaxesPage's `selection`). BOTH axes use null for "the
  // default" — null profile = whichever profile is in force, null person = the primary,
  // sent as no query param at all. That one convention is what keeps the single-earner
  // request, snapshot key and create body byte-identical to the pre-batch page.
  const [selection, setSelection] = useState<{
    profileId: number | null
    personId: number | null
  }>({ profileId: null, personId: null })
  // The chips' source. Fetched on its own, never folded into either load above: the
  // switcher is an affordance, and a household hiccup must not cost the waterfall
  // (NetWorthPage's isolated-fetch posture). null covers both "not loaded" and "failed".
  const [household, setHousehold] = useState<HouseholdOut | null>(null)
```

- [ ] **Step 7: Implement — the household fetch and the derived person state.** Insert immediately after the existing `useEffect(() => { loadProfiles() }, [])` block (`:676-678`):

```tsx
  // Once per visit, and deliberately not part of `loadProfiles`: setState lives in the
  // promise continuations, never in the effect's synchronous body (react-hooks 7).
  useEffect(() => {
    fetchHousehold()
      .then(setHousehold)
      .catch(() => setHousehold(null))
  }, [])
```

and insert the derivations immediately after `const breakdownSeq = useRef(0)` (`:648`):

```tsx
  // Primary first, then everyone else by id — the order NetWorthPage's owner chips use, so
  // a person sits in the same place on both pages. The `?? []` lives INSIDE the memo: a
  // fresh literal in the dep list would re-sort on every render.
  const orderedPeople = useMemo(
    () =>
      [...(household?.people ?? [])].sort(
        (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.id - b.id,
      ),
    [household],
  )
  // One earner means there is nothing to switch between: no chips, no household tile, no
  // person param, no filtered history — the page is the pre-batch one, pinned by test.
  const switchable = orderedPeople.length > 1
  // The person the page is ABOUT: the chip's pick, or the primary when nothing is picked.
  // Only ever compared against a row's person_id — the WIRE still gets selection.personId,
  // which stays null for the primary.
  const activePersonId = selection.personId ?? orderedPeople[0]?.id ?? null
```

- [ ] **Step 8: Implement — the breakdown fetch and the reselect helpers.** In the breakdown effect (`:683-712`), replace the fetch call and the key line:

```tsx
    fetchBreakdown(selection.profileId ?? undefined, selection.personId ?? undefined)
```

```tsx
        const key = breakdownKey(selection.profileId, selection.personId)
```

Then replace `reselectWith` (`:729-737`) with:

```tsx
  const reselectWith = (next: (current: number | null) => number | null) => {
    setBreakdownBusy(true)
    setBreakdownError(null)
    // Cleared TOGETHER with the error it is a flavour of: the empty state renders
    // `breakdownError` as prose, so leaving `missing` up with the error gone would print a
    // literal "null — add one below…" for the whole of the next load (EsppPage's note).
    setBreakdownMissing(false)
    // The person is CARRIED, never reset: this helper re-points the profile axis only
    // (a row press, a delete's fallback, a write's refetch), and dropping the chip's pick
    // here would silently walk the page back to the primary after every save.
    setSelection((current) => ({
      profileId: next(current.profileId),
      personId: current.personId,
    }))
  }
```

and add, immediately after `showCurrent` (`:748-751`):

```tsx
  /**
   * Move the whole page to a person. `null` is the primary — no param on the wire.
   *
   * The pinned profile is DROPPED: it belongs to the person being left, and asking for one
   * person's profile id under another's scope is either a 404 or, worse, someone else's
   * check under this person's name. The switch always lands on "whichever profile is in
   * force for them", which is the same place the page opens on.
   */
  const selectPerson = (personId: number | null) => {
    if (personId === selection.personId) return
    setBreakdownBusy(true)
    setBreakdownError(null)
    setBreakdownMissing(false)
    setSelection({ profileId: null, personId })
  }
```

- [ ] **Step 9: Implement — the filtered history.** Insert immediately after `selectPerson`:

```tsx
  // The history table follows the chips — client-side, because the router answers with one
  // ordered list for every person (spec §4.1), so a chip press costs the table nothing.
  // UNFILTERED whenever there is nobody to switch between, which includes a FAILED
  // household fetch: with no person to filter by, an empty table would be a lie, and
  // today's whole list is the honest degradation (spec §6).
  const shownProfiles = useMemo(
    () =>
      profiles === null || !switchable
        ? (profiles ?? [])
        : profiles.filter((p) => p.person_id === activePersonId),
    [profiles, switchable, activePersonId],
  )
```

- [ ] **Step 10: Implement — the render.** Insert the chips row immediately after the `page-header` div (`:771`), i.e. before the breakdown error banner:

```tsx
      {switchable && (
        <div className="paycheck-person-row">
          <span className="eyebrow">Whose paycheck</span>
          <div className="segmented" role="group" aria-label="Person">
            {orderedPeople.map((person, index) => (
              <button
                key={person.id}
                type="button"
                className={activePersonId === person.id ? 'active' : ''}
                aria-pressed={activePersonId === person.id}
                // The FIRST chip is the primary and carries null — no person param on the
                // wire, so pressing "back to me" restores the exact request this page has
                // always made.
                onClick={() => selectPerson(index === 0 ? null : person.id)}
              >
                {person.name}
              </button>
            ))}
          </div>
          <InfoHint text="Each person has their own profile timeline. The waterfall, the flow and the history below all follow this chip; the household figure above does not — it is always both of you." />
        </div>
      )}
```

Add the Plan-4 mount point between the two panels (`:804-807`):

```tsx
          <BreakdownPanel data={breakdown} still={fromCache} />
          {/* PLAN 4 MOUNT POINT — the contribution-pace strip goes HERE, under the
              waterfall (spec §5). It renders from `breakdown.pace`, which is this div's own
              payload for whichever person the chips already picked, so it needs no chip
              wiring of its own: mount it and nothing above this line changes. */}
          {/* Same payload, same busy dim: the flow can never show a different check than
              the table above it. */}
          <FlowPanel data={breakdown} still={fromCache} />
```

And replace the `ProfilesPanel` usage (`:831-840`) with:

```tsx
          {/* Keyed by the CHIP's pick and by nothing else. Switching person must re-seed
              the carry-forward form from THAT person's latest row — a half-typed row
              surviving the switch would be filed under the wrong person on the next save.
              It reads `selection.personId` rather than the resolved `activePersonId` on
              purpose: the resolved one changes from null to the primary's id when the
              household lands mid-visit, which would remount the panel and destroy a
              half-typed row for no reason. Constant for a one-person household, so a
              breakdown refetch still leaves typed work alone (the pre-batch behaviour). */}
          <ProfilesPanel
            key={selection.personId ?? 'primary'}
            profiles={shownProfiles}
            personId={selection.personId}
            shownId={breakdown?.profile.id ?? null}
            pinnedId={selection.profileId}
            onSelect={selectProfile}
            onShowCurrent={showCurrent}
            onChanged={onProfilesChanged}
          />
```

- [ ] **Step 11: Implement — the CSS.** Append to `src/pages/PaycheckPage.css`:

```css
/* ── The person switcher ───────────────────────────────────────────── */

/* NetWorthPage's owner-row shape, restated rather than imported: that stylesheet travels
   with its own page, and this file must not depend on it happening to be in the bundle
   (this file's opening note). */
.paycheck-person-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.paycheck-person-row .eyebrow {
  margin: 0;
}
```

- [ ] **Step 12: Run to pass.**

```bash
npx vitest run src/pages/PaycheckPage.test.tsx
npx tsc -b
```

Expected: all green — the six new two-earner tests **and** every pre-existing test in the file, unedited.

- [ ] **Step 13: Commit.**

```bash
git add src/pages/PaycheckPage.tsx src/pages/PaycheckPage.css src/pages/PaycheckPage.test.tsx
git commit -m "feat(paycheck-ui): Me/<partner> switcher chips scope the waterfall, flow, history and create"
```

---

### Task 3: The household take-home tile

**Files:**
- Modify: `src/pages/PaycheckPage.test.tsx` (append to the two-earner describe)
- Modify: `src/pages/PaycheckPage.tsx` (state + effect after the household fetch, render after the chips row, `onProfilesChanged`)
- Modify: `src/pages/PaycheckPage.css` (append)

- [ ] **Step 1: Write the failing tests.** Append inside the `describe('PaycheckPage — two earners …')` block:

```tsx
  it('adds the two in-force nets into a household take-home tile', async () => {
    twoEarners()
    render(<PaycheckPage />)

    expect(await screen.findByText('Household take-home')).toBeTruthy()
    // 6768.33 + 5231.34. Each leg is the AUTHORITATIVE monthly figure of one person's
    // in-force profile — never a sum of the display-rounded waterfall lines (rule 9).
    expect(screen.getByText('$11,999.67')).toBeTruthy()
    // The copy says exactly what was added, so the tile can never be read as a forecast.
    expect(screen.getByText('Me + Sam — the profile in force for each person.')).toBeTruthy()
    // Both legs ask for the IN-FORCE profile, so neither carries a profile_id.
    expect(vi.mocked(fetchBreakdown).mock.calls).toContainEqual([undefined, SAM.id])
    expect(
      vi.mocked(fetchBreakdown).mock.calls.every((call) => call[0] === undefined),
    ).toBe(true)
  })

  it('leaves the tile out when the partner has no profile in force', async () => {
    twoEarners(new ApiError('no paycheck profiles', 404))
    render(<PaycheckPage />)
    await screen.findByRole('group', { name: 'Person' })
    await waitFor(() =>
      expect(vi.mocked(fetchBreakdown).mock.calls).toContainEqual([undefined, SAM.id]),
    )

    // Absent, not half-true: one person's net is not a household take-home (spec §6).
    expect(screen.queryByText('Household take-home')).toBeNull()
    // ...and the failure costs the TILE only — my own waterfall is untouched and no
    // banner is raised, because nothing the page promised has failed.
    expect(screen.getByText('$3,384.16')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('leaves the tile out for a one-person household', async () => {
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')
    await waitFor(() => expect(vi.mocked(fetchHousehold)).toHaveBeenCalled())
    expect(screen.queryByText('Household take-home')).toBeNull()
    // The partner legs never fire, so the single-earner page costs exactly one breakdown
    // request — what it cost before this batch.
    expect(vi.mocked(fetchBreakdown)).toHaveBeenCalledTimes(1)
  })

  it('refreshes the household tile after a profile write', async () => {
    twoEarners()
    render(<PaycheckPage />)
    await screen.findByText('$11,999.67')
    vi.mocked(fetchBreakdown).mockClear()

    type('Effective date', '2026-09-01')
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))

    // A new profile can change WHOSE profile is in force, so both legs go out again — a
    // stale household figure is wrong money on screen, which is worse than no figure.
    await waitFor(() => expect(vi.mocked(fetchBreakdown)).toHaveBeenCalledTimes(3))
    expect(vi.mocked(fetchBreakdown).mock.calls).toContainEqual([undefined, SAM.id])
  })
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `npx vitest run src/pages/PaycheckPage.test.tsx`
Expected: FAIL — `Unable to find an element with the text: Household take-home`.

- [ ] **Step 3: Implement — state, the isolated legs, and the sum.** In `src/pages/PaycheckPage.tsx`, add to the page's refs (after `const breakdownSeq = useRef(0)`, `:648`):

```tsx
  const householdSeq = useRef(0)
```

Add state immediately after the `household` state from Task 2:

```tsx
  // One in-force breakdown per person, fetched on its OWN so a partner failure costs the
  // tile and nothing else. Deliberately NOT derived from the waterfall above: that one
  // follows the chips and any pinned row, while this figure is always "the profile in
  // force for each person" (spec §5). Only people who answered are in here.
  const [householdNets, setHouseholdNets] = useState<
    { name: string; monthlyNet: string }[] | null
  >(null)
  // Bumped by a profile write — a new profile can change whose profile is in force.
  const [householdNonce, setHouseholdNonce] = useState(0)
```

Add the effect immediately after the `fetchHousehold` effect from Task 2:

```tsx
  // Two GETs on a two-person household, once per household load (and once per write), and
  // no requests at all for one person: the price of a figure that cannot drift with a chip
  // press. Sequence-guarded like the page's other two loads, because a save landing while
  // these are in flight would otherwise let the older pair overwrite the newer.
  useEffect(() => {
    if (orderedPeople.length < 2) return
    const seq = ++householdSeq.current
    Promise.all(
      orderedPeople.map((person, index) =>
        // Index 0 is the primary, whose param is omitted — the wire's back-compat default.
        fetchBreakdown(undefined, index === 0 ? undefined : person.id)
          .then((data) => ({ name: person.name, monthlyNet: data.monthly_net }))
          // A person with no profile in force 404s; a partner-side outage 5xxs. Both mean
          // "no figure for them", which is what keeps the tile absent rather than half a
          // household presented as a whole one (spec §6).
          .catch(() => null),
      ),
    ).then((legs) => {
      if (seq !== householdSeq.current) return
      setHouseholdNets(
        legs.filter((leg): leg is { name: string; monthlyNet: string } => leg !== null),
      )
    })
  }, [orderedPeople, householdNonce])
```

Add the sum immediately after the `shownProfiles` memo from Task 2:

```tsx
  // The ONE place this page adds money up, and only because there is no server figure for
  // it in this batch. Legal here where the waterfall's lines are not (rule 9): each leg is
  // an AUTHORITATIVE per-person `monthly_net`, not a display-rounded view of a longer
  // chain. Two 2dp figures added in float and re-rounded to cents (spendingSankey's
  // `cents` idiom), so the tile can never print a float artefact.
  const householdTotal =
    householdNets === null
      ? null
      : Math.round(householdNets.reduce((acc, leg) => acc + Number(leg.monthlyNet), 0) * 100) /
        100
```

- [ ] **Step 4: Implement — the tile.** Insert immediately after the chips row in the render (after the `{switchable && (…)}` block from Task 2 Step 10):

```tsx
      {/* TWO OR MORE answers or nothing: one person's net is not a household take-home, and
          printing it as one would be a half-truth (spec §6). It sits OUTSIDE the per-check
          card on purpose — it is not part of any one person's waterfall, and it does not
          follow the chips. */}
      {householdNets !== null && householdNets.length > 1 && (
        <section className="paycheck-household">
          <div className="kpi-row">
            <StatTile
              label="Household take-home"
              value={formatCurrency(householdTotal)}
              hint="The monthly net of the profile IN FORCE for each person, added together. It ignores the chip and any pinned row — it is always the whole household — and a person with no profile in force is not counted."
            />
          </div>
          <p className="drill-hint">
            {householdNets.map((leg) => leg.name).join(' + ')} — the profile in force for
            each person.
          </p>
        </section>
      )}
```

- [ ] **Step 5: Implement — refresh on write.** In `onProfilesChanged` (`:756-764`), add as the last statement of the function body:

```tsx
    // The tile's legs are the profiles IN FORCE, and this write may have changed which
    // those are (a new row dated today displaces the current one). A nonce rather than a
    // direct call: the effect above owns the sequence guard.
    setHouseholdNonce((n) => n + 1)
```

- [ ] **Step 6: Implement — the CSS.** Append to `src/pages/PaycheckPage.css`:

```css
/* The household figure is a sibling of the switcher, not part of the per-person card below
   it. The page's 320px .kpi-row fence already stops a single tile from stretching. */
.paycheck-household {
  margin-bottom: 1rem;
}

.paycheck-household .drill-hint {
  margin: 0.4rem 0 0;
}
```

- [ ] **Step 7: Run to pass.**

```bash
npx vitest run src/pages/PaycheckPage.test.tsx
npx tsc -b
```

Expected: all green.

- [ ] **Step 8: Commit.**

```bash
git add src/pages/PaycheckPage.tsx src/pages/PaycheckPage.css src/pages/PaycheckPage.test.tsx
git commit -m "feat(paycheck-ui): household take-home tile from both in-force breakdowns, absent when only one answers"
```

---

### Task 4: `hsa_coverage` on the profile form and in the history

**Files:**
- Modify: `src/pages/PaycheckPage.test.tsx` (**the two body goldens** at `:375-387` and `:408-420`; one new test)
- Modify: `src/pages/PaycheckPage.tsx` (`ProfileFormState` `:161-173`, after `PCT_FIELDS` `:190`, `EMPTY_PROFILE` `:192-196`, `formFrom` `:199-213`, `submit` body `:345-361`, form JSX after the HSA box `:485`, table header `:524`, row cell `:561`)
- Modify: `src/pages/PaycheckPage.css` (append)

> **This is the one task that edits existing test cases.** Two `toEqual` bodies gain a key,
> because a form field that cannot travel is not a form field. The alternative — omitting
> `hsa_coverage` unless it differs from the default — was rejected: this form sends the FULL
> profile on both verbs (Task 4 review M6's binding), and a single-earner household with a
> family HDHP needs the tier as much as a two-earner one does. Nothing else about the two
> tests changes, and no other existing case is touched.

- [ ] **Step 1: Write the failing test and repair the two goldens.**

(a) In `src/pages/PaycheckPage.test.tsx`, in `posts the full profile with every percent shifted, never divided` (`:375-387`), add one line to the expected body, immediately after `hsa_per_check: '100.00',`:

```tsx
      hsa_coverage: 'self',
```

(b) In `PATCHes the FULL profile shape, never a delta` (`:408-420`), add the same line in the same place:

```tsx
      hsa_coverage: 'self',
```

(c) Append to the `describe('PaycheckPage — the profile form')` block:

```tsx
  it('carries the HSA coverage tier on a save and shows it in the history', async () => {
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    // Carried forward from the latest row like every other box (the comp-change ritual) —
    // the tier changes when the plan does, not when the salary does.
    expect(field('HSA coverage').value).toBe('self')

    type('Effective date', '2026-07-01')
    fireEvent.change(field('HSA coverage'), { target: { value: 'family' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))

    await waitFor(() => expect(vi.mocked(createProfile)).toHaveBeenCalledTimes(1))
    // The stored tier decides WHICH HSA cap applies to this person (spec §4.5), so it
    // travels on the same full-profile body every other column does.
    expect(vi.mocked(createProfile).mock.calls[0][0].hsa_coverage).toBe('family')

    // ...and it is a column of the history, in the plan's words rather than the column's.
    const row = screen
      .getByRole('button', { name: 'Show the breakdown for Jan 1, 2025' })
      .closest('tr')
    expect(row?.textContent).toContain('Self only')
  })
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `npx vitest run src/pages/PaycheckPage.test.tsx`
Expected: FAIL — three failures: `Unable to find a label with the text of: HSA coverage`, and the two goldens now expect a key the form does not send.

- [ ] **Step 3: Implement — form state.** In `src/pages/PaycheckPage.tsx`, extend the types import from Task 2 to include `HsaCoverage`:

```tsx
import type {
  HouseholdOut,
  HsaCoverage,
  PaycheckBreakdownOut,
  PaycheckProfileCreate,
  PaycheckProfileOut,
} from '../types/api'
```

Add `hsa_coverage` to `ProfileFormState` (`:161-173`), immediately after `hsa_per_check: string`:

```tsx
  hsa_coverage: HsaCoverage
```

Add the option list immediately after `PCT_FIELDS` (`:190`):

```tsx
// The tier's own vocabulary, not the column's: the stored value is 'self', the box says
// "Self only" — the same distinction the percent boxes draw between 13 and 0.13.
const HSA_COVERAGES: { value: HsaCoverage; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'self', label: 'Self only' },
  { value: 'family', label: 'Family' },
]

const COVERAGE_LABELS = new Map<HsaCoverage, string>(
  HSA_COVERAGES.map((coverage) => [coverage.value, coverage.label]),
)
```

Add the default to `EMPTY_PROFILE` (`:192-196`) — the server's own server_default, so an empty seed and a fresh row agree:

```tsx
const EMPTY_PROFILE: ProfileFormState = {
  effective_date: '', annual_salary: '', pay_periods_per_year: DEFAULT_PAY_PERIODS,
  trad_401k_pct: '', roth_401k_pct: '', after_tax_401k_pct: '', espp_pct: '',
  withholding_pct: '', dental_vision_per_check: '', hsa_per_check: '',
  hsa_coverage: 'self', notes: '',
}
```

Add the copy to `formFrom` (`:199-213`), immediately after `hsa_per_check: profile.hsa_per_check,`:

```tsx
    hsa_coverage: profile.hsa_coverage,
```

- [ ] **Step 4: Implement — the setter and the box.** In `ProfilesPanel`, add immediately after the generic `set` (`:270-271`):

```tsx
  // Its own setter rather than `set('hsa_coverage')`: this is the one box whose state is a
  // UNION rather than free text, and the generic setter's computed key would widen it to
  // string — a hand-fired change event could then park an unstored tier in state.
  const setCoverage = (value: string) => {
    const next = HSA_COVERAGES.find((coverage) => coverage.value === value)
    if (next !== undefined) setForm((f) => ({ ...f, hsa_coverage: next.value }))
  }
```

Add the control in the form JSX immediately after the HSA money box (`:482-485`):

```tsx
        <label>
          HSA coverage
          {/* A tier, not a figure: the three stored values are the whole domain, so this is
              a select and there is nothing to validate at submit. */}
          <select
            className="field-input"
            value={form.hsa_coverage}
            onChange={(e) => setCoverage(e.target.value)}
          >
            {HSA_COVERAGES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
```

- [ ] **Step 5: Implement — the wire body.** In `submit`'s `body` literal (`:345-361`), add immediately after `hsa_per_check: canonicalAmount(form.hsa_per_check.trim() || '0'),`:

```tsx
      // No belt: a select cannot hold anything outside the union (setCoverage refuses it),
      // and the column is NOT NULL with a server default, so it travels on both verbs like
      // every other stored column.
      hsa_coverage: form.hsa_coverage,
```

- [ ] **Step 6: Implement — the history column.** Add a header immediately after the `<th className="num">HSA</th>` line (`:524`):

```tsx
                <th>HSA coverage</th>
```

and the cell immediately after the `hsa_per_check` cell (`:561`):

```tsx
                  {/* The stored tier in the plan's words. The map is total over the union,
                      so the `??` only ever answers a payload from a newer server. */}
                  <td>{COVERAGE_LABELS.get(profile.hsa_coverage) ?? profile.hsa_coverage}</td>
```

- [ ] **Step 7: Implement — the CSS.** Append to `src/pages/PaycheckPage.css`:

```css
/* The one non-numeric picker on this form: .field-input is right-aligned monospace for
   figures, which reads wrong on a tier name (the Notes box takes the same override). */
.paycheck-form select.field-input {
  text-align: left;
  font-family: inherit;
}
```

- [ ] **Step 8: Run to pass.**

```bash
npx vitest run src/pages/PaycheckPage.test.tsx
npx tsc -b
```

Expected: all green, including the two repaired goldens.

- [ ] **Step 9: Commit.**

```bash
git add src/pages/PaycheckPage.tsx src/pages/PaycheckPage.css src/pages/PaycheckPage.test.tsx
git commit -m "feat(paycheck-ui): hsa_coverage tier on the profile form and in the history"
```

---

### Task 5: The one-person zero-diff pin

**Files:**
- Modify: `src/pages/PaycheckPage.test.tsx` (append to the two-earner describe)

This task is **test-only**. It runs last on purpose: byte-identity has to hold after *every*
edit in this plan, not just after the chips landed.

- [ ] **Step 1: Write the pin.** Append inside the `describe('PaycheckPage — two earners …')` block:

```tsx
  it('renders byte-identically for a one-person household', async () => {
    // The default arrangement IS the one-person one, which is the point of this file: every
    // test above is the pre-batch page, unedited. This one states the invariant outright so
    // a future change to the chips cannot leak into the single-earner page unnoticed.
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')
    await waitFor(() => expect(vi.mocked(fetchHousehold)).toHaveBeenCalled())

    // 1. No switcher, no household tile — nothing to switch between, and one person's net
    //    is not a household sum.
    expect(screen.queryByRole('group', { name: 'Person' })).toBeNull()
    expect(screen.queryByText('Household take-home')).toBeNull()
    // 2. ONE breakdown request, with NEITHER param: the partner legs never fire, so the
    //    page costs exactly what it cost before this batch.
    expect(vi.mocked(fetchBreakdown)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchBreakdown).mock.calls[0]).toEqual([undefined, undefined])
    // 3. The ORIGINAL snapshot key. A person suffix here would cold-start every first
    //    paint on this page for the household this app has had until now (spec §1); the
    //    suffix exists only for an explicitly-picked partner.
    expect(getSnapshot<PaycheckBreakdownOut>('paycheck:breakdown:current')).toBeTruthy()
    // 4. The history is unfiltered and the form is the carry-forward one, as before.
    expect(screen.getByText('Jan 1, 2026')).toBeTruthy()
    expect(screen.getByText('Jan 1, 2025')).toBeTruthy()
    expect(field('Annual salary').value).toBe('$188,930.00')
  })
```

- [ ] **Step 2: Run it.**

Run: `npx vitest run src/pages/PaycheckPage.test.tsx`
Expected: PASS on the first run — this pin describes behaviour Tasks 2-4 were built to preserve. **If it fails, do not weaken it**: it has found a real byte-identity regression (most likely the snapshot key or an unconditional partner fetch), and the implementation is what changes.

- [ ] **Step 3: Commit.**

```bash
git add src/pages/PaycheckPage.test.tsx
git commit -m "test(paycheck-ui): pin the one-person page byte-identical — no chips, no tile, no person param, original snapshot key"
```

---

## Phase 3 — Verification

### Task 6: Full gates

**Files:** none (verification only)

- [ ] **Step 1: The whole frontend suite.**

```bash
npx vitest run
```

Expected: green. Baseline is **1168**; this plan adds **16** — 4 in `src/api/paycheck.test.ts`, and 12 in `src/pages/PaycheckPage.test.tsx` (6 from Task 2, 4 from Task 3, 1 from Task 4, 1 from Task 5) — so **1184**. If the reported figure differs, reconcile it before moving on: a count that grew by less means a test was silently replaced, and a count that shrank means a pre-existing case was deleted. **Zero failures** either way.

- [ ] **Step 2: Types and lint.**

```bash
npx tsc -b
npx eslint src/pages/PaycheckPage.tsx src/pages/PaycheckPage.test.tsx src/api/paycheck.ts src/api/paycheck.test.ts src/types/api.ts
```

Expected: both silent. `react-hooks/set-state-in-effect` is the rule most likely to fire — every `setState` added by this plan lives in a `.then` continuation, never in an effect's synchronous body.

- [ ] **Step 3: Confirm the Plan-4 mount point is in place.**

```bash
grep -n "PLAN 4 MOUNT POINT" src/pages/PaycheckPage.tsx
```

Expected: one hit, between `<BreakdownPanel` and `<FlowPanel`. Plan 4 mounts the contribution-pace strip there and must not need to touch any chip wiring.

- [ ] **Step 4: Review the diff against the byte-identity promise.**

```bash
git diff main --stat
git diff main -- src/pages/PaycheckPage.test.tsx | grep "^-" | grep -v "^---"
```

Expected: the **only** removed lines in the test file are (a) the two import lines replaced in Task 2 Step 1b, and (b) nothing else from any pre-existing test case except the two golden bodies gaining `hsa_coverage: 'self'` (which show as additions, not removals). If a pre-existing assertion was deleted or weakened, that is a regression in the implementation, not in the test — restore it and fix the page.

- [ ] **Step 5: Report.** Summarise for the batch's verification plan (Plan 4): tests added, the two golden bodies that gained a key, and anything the backend contracts did not match. **Do not push.**

---

## Notes for the reviewer

- **Why the primary's chip carries `null`, not their id.** The whole byte-identity promise
  rides on one rule: `personId === null` ⇒ no query param, unsuffixed snapshot key, no
  `person_id` in the create body. Making the primary's chip send their real id would work
  functionally and break all three.
- **Why the household tile refetches instead of reusing the waterfall.** The waterfall
  follows the chips and any pinned row; the tile is defined as "the profile in force for
  each person". Reusing the payload would make the household figure change when the user
  pins a 2025 row — the tile would still say "Household take-home" while showing last
  year's check.
- **Why the history filter degrades open, not closed.** Chips are only visible when the
  household loaded, so "chips visible" and "filter active" are the same condition. A failed
  household fetch therefore shows every row with no chips — the pre-batch page — rather
  than an empty table under a control that is not there.
- **Known cost:** a two-person household spends three breakdown GETs on mount (one for the
  waterfall, two for the tile) and two more after every profile write. Accepted; the
  alternative is a household endpoint, which this batch does not add.
