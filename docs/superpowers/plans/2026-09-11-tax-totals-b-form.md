# Lane B — computed tax totals, form and page (2026-09-11) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> implementer for this lane in its own worktree, TDD per task, then a spec-compliance review and a
> code-quality review, then merge to local main — never pushed). Steps use `- [x]` checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-11-computed-tax-totals-and-per-person-payroll-tables-design.md`
— this lane implements **Part 1 §1.6 (client side), §1.7 and §1.8 (frontend)**. Read §1.6–1.7
before Task 1. Lane A ships the server; this lane builds against the contracts below and stubs the
API in tests, so it never waits.

**Goal:** derived rows render as read-only computed figures with a formula caption, update live
through the preview endpoint as components are typed, never enter a save body, keep pasted sheet
columns aligned, and disappear from the what-if override list; the §199A repair branch goes.

**Architecture:** `InputsForm` gains a `computed` cell kind that is rendered, previewed and pasted
over but never edited or saved; a 300 ms debounced `previewTaxInputs` call with a sequence guard
feeds the computed figures; `TaxesPage` filters derived items out of the override select;
`HealthCard` loses its repair branch.

**Tech stack:** React 19 + TypeScript + Vitest (jsdom) in `src/`.

---

## Mechanics (read once)

- Worktree: `C:/Users/edyli/personal-finance-dashboard/.worktrees/tax-b`, branch
  `tax/b-computed-totals-form`, cut from `main`. `node_modules` is a junction to the main checkout's
  (the orchestrator creates it); do not run `npm install`.
- Tests: `npx vitest run src/components/taxes/InputsForm.test.tsx` (and the other files you touch);
  `npx tsc -b`; `npx eslint src/components/taxes src/pages/TaxesPage.tsx src/components/settings src/api src/types`
  before every commit. The full `npm test` once at the end.
- Commits: small, `feat(taxes): …`; never push; never delete files (edits inside files are fine).
- House rule: the browser never recomputes an engine figure. The computed cell shows what the
  server sent (GET, preview, or save echo) and nothing else.

## Contracts (lane A ships these; build against them verbatim)

```ts
// src/types/api.ts
export interface TaxInputItemOut { …existing…; formula: string | null }   // derived: caption; else null
                                    // derived items: value = computed figure or null; suggested = null
export interface DerivedPreviewItemOut { key: string; person_id: number | null; value: string | null }
export interface DerivedPreviewOut { year: number; filing_status: FilingStatus; derived: DerivedPreviewItemOut[] }
// src/api/taxes.ts
export function previewTaxInputs(year: number, body: TaxInputsUpdate): Promise<DerivedPreviewOut>
// POST /taxes/years/${year}/inputs/preview — same body shape as putTaxInputs
```

The PUT 422 for a derived key reads `"{label} is computed from its components (…) — edit those
instead"`; the form never sends one, so this is only ever seen through a stale client.

---

## Task 1 — types and API client

**Files:** modify `src/types/api.ts` (`TaxInputItemOut` ~l.706; add the two preview interfaces
beside `TaxInputsOut`), `src/api/taxes.ts` (add `previewTaxInputs`; delete `putTaxInputsForRepair`
and its comment), `src/api/taxes.test.ts` (if it lists exported functions).

- [x] Add `formula: string | null` with a comment: the server's caption for a computed line, null
  for an editable one. Add `DerivedPreviewItemOut` / `DerivedPreviewOut`.
- [x] `previewTaxInputs(year, body)` → `api<DerivedPreviewOut>(\`/taxes/years/${year}/inputs/preview\`, { method: 'POST', body: JSON.stringify(body) })`.
- [x] Remove `putTaxInputsForRepair` (Task 5 removes its only caller first if you prefer order; both
  land in this lane). `npx tsc -b` clean.
- [x] Commit: `feat(taxes): preview client + formula field; repair writer retired`.

## Task 2 — computed cells in `InputsForm` (spec §1.7)

**Files:** modify `src/components/taxes/InputsForm.tsx`, `src/components/taxes/taxes.css`; tests in
`src/components/taxes/InputsForm.test.tsx` (extend `inputsFixture()`: every item gains
`formula: null`, and `gross_paycheck` becomes `value: '8333.3333', suggested: null, formula: 'Annual Salary ÷ 24'`).

- [x] Failing tests:
  - `renders a derived row as a read-only figure with its formula and no chip` — the Gross Paycheck
    row shows `$8,333.33` in an `<output>` (query `screen.getByRole('status', …)` is wrong for
    `<output>`; use `container.querySelector('output[data-computed="gross_paycheck"]')` or give it
    `aria-label="Gross Paycheck (computed)"` and query by label), the caption text `Annual Salary ÷ 24`
    is present, there is no `Apply suggestion for Gross Paycheck` button, and no input has that label.
  - `renders a muted dash for a computed line with no components entered` — `value: null` → the
    figure reads `—`.
  - `Enter walks past computed rows` — extend the existing walk test: from Annual Salary, Enter lands
    on the next EDITABLE cell (HSA Contributions), never on Gross Paycheck.
  - `never puts a computed cell in the PUT body` — change Annual Salary, save: the body has no
    `gross_paycheck`; `changedCount` counts editable cells only.
  - Existing `offers the derived suggestion once, over the primary person's column` is retired (no
    chip on derived rows); replace with `renders one computed figure per person column on a married year`.
- [x] Implement: `Cell` gains `computed: boolean` and `formula: string | null` (from
  `item.is_derived` / `item.formula`); `flatCells` (walk + paste + save) contains editable cells
  only; rows keep every cell for rendering. A computed cell renders
  `<output id={…} className="tax-computed" aria-label={\`${row.label} (computed)\`} title={\`${formula} — edit the components\`}>{figure}</output>`
  where `figure` = `suggestionText(cell.unit, shown)` for a value and `—` for null; the chip track
  shows `<span className="tax-suggestion-value">{row.formula}</span>` when `row.isDerived`. CSS:
  `.tax-computed` mirrors the input's box metrics (height, padding, right alignment, `var(--muted)`
  colour, no border or a dashed one), so the grid does not jump between editable and computed rows.
- [x] Commit: `feat(taxes): derived rows render as computed figures with a formula caption`.

## Task 3 — live preview (spec §1.7)

**Files:** modify `src/components/taxes/InputsForm.tsx`; tests in `InputsForm.test.tsx` (stub
`previewTaxInputs` in the existing `vi.mock('../../api/taxes', …)` alongside `putTaxInputs`; use
`vi.useFakeTimers()` for the debounce).

- [x] Failing tests:
  - `previews computed totals 300 ms after the last keystroke, with the whole form as the body` —
    type into Annual Salary twice within 300 ms: ONE preview call, body = the PUT shape of the current
    form (values map / rows exactly as `submit()` would build them, but for ALL editable cells, not
    the diff — the server overlays them); resolve with `derived: [{ key: 'gross_paycheck', person_id: 1, value: '9000.0000' }]`
    → the computed figure reads `$9,000.00`.
  - `drops a stale preview response` — two edits 400 ms apart, two calls; resolve the FIRST after the
    second: the figure shows the second response's value.
  - `keeps the last figure when a preview fails` — reject → the previous figure stays, no banner.
  - `the save echo wins over a pending preview` — save resolves while a preview is in flight: the
    echo's value shows and the late preview is ignored.
- [x] Implement: `computedValues` state keyed by cell id, seeded from the payload and re-seeded by
  the save echo; a `previewSeq` ref; an effect on `values` (editable cells) that `setTimeout`s 300 ms
  (`MOTION_MS`-style constant `PREVIEW_DEBOUNCE_MS = 300`), builds the body with the same
  `toWire` canonicalization `submit()` uses (skip cells whose text is not a valid entry — send
  nothing for them rather than garbage), calls `previewTaxInputs`, and applies the response only when
  its sequence is current and no save landed since. A blank editable cell is sent as `null`.
- [x] Commit: `feat(taxes): computed totals re-derive live through the preview endpoint`.

## Task 4 — paste keeps sheet alignment (spec §1.7)

**Files:** modify `src/components/taxes/InputsForm.tsx` (`handlePaste`); tests in `InputsForm.test.tsx`.

- [x] Failing tests: `column paste skips computed slots and keeps alignment` — paste three values
  into Annual Salary on the single fixture (Annual Salary, Gross Paycheck [computed], HSA
  Contributions in walk order): Annual Salary gets value 1, HSA gets value 3, value 2 is discarded,
  the note ends with `· 1 computed cell skipped`; `keyed paste ignores a computed label` — a keyed
  block naming Gross Paycheck: not filled, note counts it as skipped. Update the existing paste tests'
  expected `Pasted N of M values` denominators (editable cells only).
- [x] Implement: build the positional `column` from ALL cells (editable and computed, in render
  order) so slots line up with the sheet; when a slot's cell is computed, count `computedSkipped`
  and consume the value; `reachable` counts editable cells; keyed candidates exclude computed cells
  and a label match against a computed row counts as skipped. Note grammar:
  `${n} computed cell${n === 1 ? '' : 's'} skipped`.
- As built: the KEYED candidate list includes computed cells rather than excluding them. A
  pasted line naming a computed row has to be answered by its own row — dropped from the list,
  `matchLabel` would fuzzy-match "Gross Paycheck" onto a neighbouring editable line and fill the
  wrong cell — so the match is made and then refused: counted as skipped, never filled, never
  reported as unmatched. `reachable` still counts editable cells only, so the note's denominator
  is the one this task specified, and so is the observable behaviour.
- [x] Commit: `feat(taxes): pasted sheet columns skip computed slots without losing alignment`.

## Task 5 — page, copy, health card

**Files:** modify `src/pages/TaxesPage.tsx` (`overrideDefinitions`), `src/components/settings/HealthCard.tsx`
(delete the `rewrite_itemized_deduction` branch, `repairItemized`, the `fetchTaxInputs`/
`putTaxInputsForRepair` imports if unused), `src/components/taxes/InputsForm.tsx` (copy);
tests in `src/pages/TaxesPage.test.tsx`, `src/components/settings/HealthCard.test.tsx`.

- [x] `overrideDefinitions` skips items with `is_derived`. Test: the what-if select offers no
  derived key.
- [x] Copy: card hint → "The year's income and deduction line items. Computed lines total their
  components as you type; grey chips are offers you apply."; intro paragraph → "Stored values feed
  the engine; computed lines follow their components. Clearing a field unsets that input."
- [x] HealthCard: remove the branch and its test(s); any `types/api.ts` comment naming the action.
- [x] Commit: `feat(taxes): override list excludes computed keys; §199A repair branch retired`.

## Task 6 — gates

- [x] `npx eslint .` (0 errors), `npx tsc -b`, `npm test` (full vitest) — green.
- [x] Final report: commits, test counts, and any contract mismatch you had to assume (name it so the
  integration pass checks it against lane A's shipped shapes).
