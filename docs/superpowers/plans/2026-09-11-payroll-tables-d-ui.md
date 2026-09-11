# Lane D — per-person payroll tables, editor and summary (2026-09-11) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> implementer for this lane in its own worktree, TDD per task, then a spec-compliance review and a
> code-quality review, then merge to local main — never pushed). Steps use `- [x]` checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-11-computed-tax-totals-and-per-person-payroll-tables-design.md`
— this lane implements **Part 2 §2.6–2.7 and §2.8 (frontend)**. Read §2.4–2.7 before Task 1. Lane C
ships the server; build against the contracts below and stub the API in tests.

**Goal:** the bracket editor lets each person on the return carry their own Social Security and
Disability table beside the default, and the summary shows each earner's payroll line.

**Architecture:** `BracketsEditor` widens its per-table state key from jurisdiction to
jurisdiction+person and grows a per-person strip under the two per-worker blocks; `SummaryPanel`
renders sub-rows from `per_person`.

**Tech stack:** React 19 + TypeScript + Vitest (jsdom) in `src/`.

---

## Mechanics (read once)

- Worktree: `C:/Users/edyli/personal-finance-dashboard/.worktrees/tax-d`, branch
  `tax/d-payroll-tables-ui`, cut from `main`. `node_modules` is a junction the orchestrator creates;
  do not `npm install`.
- Tests: `npx vitest run src/components/taxes/BracketsEditor.test.tsx src/pages/TaxesPage.test.tsx`
  plus any file you touch; `npx tsc -b`; `npx eslint src/components/taxes src/pages src/types src/api`.
  Full `npm test` at the end.
- Commits small (`feat(taxes): …`); never push; never delete files.

## Contracts (lane C ships these; build against them verbatim)

```ts
export interface TaxPersonOut { id: number; name: string }                    // already exists
export interface PersonBracketsOut { person_id: number; name: string;
                                     jurisdictions: Record<string, TaxBracketOut[]> } // only social_security / disability
export interface TaxBracketsOut { …existing…; people: TaxPersonOut[]; per_person: PersonBracketsOut[] }
export interface TaxBracketsUpdate { filing_status: FilingStatus; jurisdictions: Record<string, TaxBracketIn[]>;
                                     person_id?: number | null }              // omitted/null = the defaults
export interface PersonWageTaxOut { person_id: number | null; name: string | null; w2_income: string;
                                    taxable_wages: string; tax: string; effective_rate: string | null;
                                    table: 'own' | 'default' }
export interface WageTaxOut { …existing…; per_person?: PersonWageTaxOut[] }  // optional: stored fixtures predate it
```

422 sentences the editor shows verbatim: `"{name}: per-person tables exist only for social_security
and disability"`, `"person {id} is not on a {status} return"`.

---

## Task 1 — types

**Files:** modify `src/types/api.ts` (`TaxBracketsOut` ~l.784, `TaxBracketsUpdate` ~l.799,
`WageTaxOut` ~l.825; add `PersonBracketsOut`, `PersonWageTaxOut`).

- [x] Add the fields above with one-line comments (default = everyone; person table = that earner's).
  `per_person` on `WageTaxOut` is OPTIONAL so the golden `TaxSummaryOut` fixtures in
  `taxChartOptions.test.ts` / `overviewChartOptions.test.ts` stay valid. `npx tsc -b` clean.
- [x] Commit: `feat(taxes): per-person bracket and payroll wire types`.

## Task 2 — the per-person strip in `BracketsEditor` (spec §2.6)

**Files:** modify `src/components/taxes/BracketsEditor.tsx`, `src/components/taxes/taxes.css`;
tests in `src/components/taxes/BracketsEditor.test.tsx` (extend `bracketsFixture()` with
`people: [{ id: 1, name: 'Alex' }]` and `per_person: [{ person_id: 1, name: 'Alex', jurisdictions: { social_security: [], disability: [] } }]`;
add a married fixture with two people and a stored Disability table for person 4).

- [x] Failing tests:
  - `heads the two per-worker blocks as the default for everyone` — `Social Security brackets — default for everyone`
    and `Disability brackets — default for everyone`; the other four headings unchanged.
  - `offers to add a person table under each per-worker block` — `Add a table for Alex` appears twice
    (SS and Disability), never under Federal.
  - `seeds a draft from the default table and saves it with the person` — default Disability
    `1% / 0`; click `Add a table for Alex` → an editable table `Disability — Alex` pre-filled with the
    default rows; edit rate to 1.3, Save → `putTaxBrackets(2024, { filing_status: 'single', person_id: 1, jurisdictions: { disability: [{ rate: '0.0130', threshold: '0.00' }] } })`.
  - `renders a stored person table and removes it with an empty PUT` — the married fixture: person
    4's Disability table renders; `Remove — use the default` → PUT with `person_id: 4, jurisdictions: { disability: [] }`
    after a confirm; on echo the strip shows `Add a table for Sam` again.
  - `keys errors and saving per table and person` — a 422 on Alex's table renders under Alex's
    table only; the default's Save is disabled while Alex's is in flight (single-flight).
  - `reports dirty work from a draft person table` — a seeded draft makes `onDirtyChange(true)`.
- [x] Implement: table state keyed `${name}` for defaults and `${name}:${personId}` for person
  tables (`tablesOf` reads `per_person`); `errors`/`saving` use the same keys; `save(name, personId?)`
  sends `person_id` when set; `remove(name, personId)` is `save` with `[]` behind the existing
  delete-all confirm worded `Delete Alex's Disability table for 2024 (Single)? They fall back to the default.`;
  a draft slot exists in `tables` under the person key even before a row is stored (dirty = differs
  from payload). The strip renders under each `PER_WORKER` block for each `payload.people` entry; a
  `drill-hint` under the strip: "Per-worker tax: the default applies to anyone without their own
  table. Add one for an earner on an employer's voluntary plan, or in a job exempt from Social Security."
  CSS: `.bracket-person` (indented block, subtle left rule) and `.bracket-person-head`.
- [x] Copy: card `InfoHint` gains "Social Security and Disability may also carry a table per person.";
  the empty-tab clone note gains ", including any per-person tables" after "come across correct".
- [x] Commit: `feat(taxes): per-person Social Security and Disability tables in the bracket editor`.

## Task 3 — per-earner sub-rows in `SummaryPanel` (spec §2.7)

**Files:** modify `src/components/taxes/SummaryPanel.tsx`, `src/components/taxes/taxes.css`;
tests: create `src/components/taxes/SummaryPanel.test.tsx` (render with a `TaxSummaryOut` fixture;
mirror the harness of `MarginalPanel.test.tsx`).

- [x] Failing tests:
  - `renders one sub-row per earner under Social Security and Disability on a two-earner year` —
    names, wages, taxable, tax, rate; `capped at $184,500` on the earner whose SS taxable < wages;
    `own table` / `default` tags.
  - `renders a sub-row for a single earner who uses their own table`.
  - `renders no sub-rows for a single earner on the default table`, and none when `per_person` is
    absent (stored fixture shape).
- [x] Implement: after each of the two rows, map `per_person` when `rows.length >= 2 || rows.some(r => r.table === 'own')`;
  sub-row `<tr className="tax-person-row">` with the name cell indented; the capped note is derived
  by comparing the two strings as numbers (display only — no money math); tags are small `badge`s.
  "By jurisdiction" hint gains "Social Security and Disability are per worker: each earner's row shows
  their own wage base, cap and table."
- [x] Commit: `feat(taxes): summary shows each earner's Social Security and Disability line`.

## Task 4 — gates

- [x] `npx eslint .` (0 errors), `npx tsc -b`, `npm test` — green.
- [x] Final report: commits, counts, any contract assumption to check against lane C's shipped shapes.

---

## As built (lane D, 2026-09-11)

Three commits on `tax/d-payroll-tables-ui`: wire types, the editor strip, the summary
sub-rows. `npx eslint .` 0 errors, `npx tsc -b` clean, `npm test` 2734 passed / 193 files
(2724 / 192 before). Departures from the text above, all spec-faithful:

- **`0.013`, not `0.0130`.** `shiftPoint` trims trailing zeros, and the PUT ships the typed
  text for the server to quantize — the same pins the file already carries (`0.1`, `0.37`,
  `0.093`). The saved-rate test asserts `0.013`.
- **`capped at $184,500.00`.** `formatCurrency` is the house money renderer and keeps cents;
  the only cents-free variant is `formatCurrencyCompact`, which would read `$184.5K`.
- **`people` / `per_person` are REQUIRED on `TaxBracketsOut`** (the contract block's shape);
  the five existing `TaxBracketsOut` fixtures gained `people: []`, `per_person: []`. Only
  `WageTaxOut.per_person` is optional, as instructed.
- **A person card is a sibling `<form>` of its jurisdiction's block, not a child** — forms do
  not nest — so the two share a `<Fragment>` and the rows editor is a local `BracketRows`
  component both render. Person heads are `<h4>`, leaving the six `<h3>` headings the
  editor's spine.
- **`Discard draft`** beside Save on a seeded-but-unsaved person table: client-side, no
  request. Without it a mis-clicked `Add a table for …` had no way back but a tab switch.
- **Dirty compares the tables key-SORTED** (`serialize`), because a seeded draft is appended
  while the payload lists it in roster order.
- The existing heading pin (`Social Security brackets`) and the clone-note pin were updated:
  the spec changes both sentences.

### Review round (both reviews applied, same branch)

One commit. `npx eslint .` 0 errors, `npx tsc -b` clean, `npm test` 2739 passed / 193 files
(2734 before; five new tests). What changed:

- **No `capped at $0.00`.** The note now also requires `Number(taxable_wages) > 0`: an
  SS-exempt earner on an all-zero own table (spec §2.2) reports 0 taxable wages, which is
  not a wage base the walk stopped at. New `SummaryPanel.test.tsx` case.
- **An EMPTY draft saved is discarded, not deleted.** `Add a table for X` under a per-worker
  default that has no rows itself seeds a draft with zero rows; its Save used to ask the
  delete-all question and PUT `[]` for a table the server never stored. The `stored`
  predicate is now `hasStoredTable(name, personId)`, shared by `submit` and `personCard`, and
  an unstored empty save does what `Discard draft` does — no confirm, no request.
- **A tab switch cannot race a save.** The tab buttons are `disabled={tabBusy || saving !==
  null}` and `openStatus` returns early on an in-flight save: the echo re-seats `payload`,
  which would otherwise land on whichever status' tables the switch had put on screen.
- **The person name cell is a plain `<td>` again** — `display: flex` on a cell drops it from
  the accessibility tree. The flex row is a `.tax-person-name` span inside it, and the indent
  is `.tax-person-row > td:first-child`'s padding.
- **Label in name (WCAG 2.5.3)** on the three strip buttons: the aria-labels are gone; each
  keeps its visible text and appends its context in a `visually-hidden` span, so the spoken
  name contains the words on the button (`Add a table for Alex — Disability`,
  `Remove — use the default — Disability — Sam`, `Discard draft — Disability — Alex`). The
  tests query by role with those names.
- **`Removing…`** on the Remove button while its own PUT is in flight (`saving` is now
  `{ key, removing }`), rather than `Saving…` on the Save button beside it.
- Smaller: the spec §2.8 **tab-switch test** (the strip reloads with the tab's roster and
  stays clean); the seed test's echo carries a DIFFERENT default rate (1.1%) so "the default
  was untouched" discriminates; `.bracket-person > .error-banner { justify-self: stretch }`;
  `.tax-person-name .badge { margin-left: 0 }`; the `PER_WORKER_JURISDICTIONS` comment says
  what is true of its type; ONE comment at the first read site explains every `?? []` (the
  fields stay REQUIRED on the type — the reads cover the window where this lane is merged and
  the server lane is not); the `'This return'` fallback is gone (a roster-less DB cannot hold
  a person table, so a null name is unreachable — it renders as nothing if that changes).
