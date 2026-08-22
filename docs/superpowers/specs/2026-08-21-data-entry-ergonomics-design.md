# Data-Entry Ergonomics — Design Spec ("spreadsheet feel, dashboard design")

**Date:** 2026-08-21
**Status:** Approved direction (this document pending user review)
**Repo:** `personal-finance-dashboard`

## 1. Context & Goals

The dashboard replaced the sheet's charts; its entry ergonomics still trail the sheet's cells.
A full inventory (2026-08-21) found the gap is an absent ergonomics layer, not the form factor:

- Zero keyboard, paste, or focus handling anywhere in `src/` (no `onKeyDown`, `onPaste`,
  `autoFocus`, `tabIndex`, or `.focus()` call exists).
- No type-to-replace: pre-filled values must be manually selected before overtyping.
- Three divergent strict validators (`isNumeric` in MonthlyUpdatePage, `PLAIN_DECIMAL` in
  InputsForm, `isPlainDecimal` in `utils/percent.ts`) all reject `$1,234.56` — exactly what a
  sheet or bank site copies out — while `1e5` silently passes the wizard and stores 100000.
- The wizard grids are not `<form>`s (Enter is dead) and wrap into 3–4 visual columns, so Tab
  fights the down-a-column muscle memory.
- Ledger forms wipe security/account/date after every save; dividends have no edit path.
- Live context is missing: last month's value exists only as the prefill being overwritten,
  and totals appear only on the review step.

**Goal:** port the sheet's typing mechanics into the existing dashboard design — one
uninterrupted keyboard path, type-to-replace, tolerant parsing, inline arithmetic, column
paste, adjacent prior values, live totals — without changing the save model, wire format,
or visual language.

### Decision log (from the 2026-08-21 ideation session)

| Decision | Choice |
|---|---|
| Approach | Hand-rolled shared input layer; **no grid library** (deps stay lean; entry shapes are single-column lists and short rows, not 2D ranges) |
| Save model | Unchanged — explicit bulk saves with review step; **no autosave-per-cell** (drafts already prevent loss; half-typed numbers never hit the wire) |
| Rejected | Command-box entry grammar; OCR/LLM capture; inline editing of history tables (possible future corrections feature); paste-block ledger import (revisit after Phase 3) |
| Transition | The idempotent xlsx importer remains the parallel-run bridge; unchanged by this work |

## 2. Phase map

Three independently shippable phases, one implementation plan each:

1. **Input layer** — shared component: parse, arithmetic, type-to-replace, keyboard flow.
2. **Paste + wizard-as-table** — column/keyed paste; balances/spending become real tables
   with prior-value and live-Δ columns and sticky totals.
3. **Fewer keystrokes** — ledger carry-forward/duplicate/edit; computed balance suggestion
   chips (beyond sheet parity).

## 3. Phase 1 — the input layer

### 3.1 `parseAmount` (`src/utils/amount.ts`)

One tolerant parser replacing the three divergent validators for money/decimal boxes.

- **Accepts:** optional leading `+`/`-`; `$`; comma grouping (stripped, positions not
  validated); surrounding whitespace; accounting negatives `(1,234.56)`; a single decimal
  point.
- **Rejects:** exponent notation (`e`/`E`) — closing the silent `1e5` hole — plus multiple
  points, any other characters, and empty/blank input.
- **Returns** `{ canonical: string } | null`. Canonical form is a plain signed decimal.
  **Idempotence guarantee:** input already in plain-decimal form is returned *verbatim*
  (never `0.00` → `0`), so canonicalizing a server-seeded string is a no-op — the wizard's
  draft/dirty machinery must see zero difference from a focus+blur of an untouched field.
- Not quantized client-side; the server's 2dp `ROUND_HALF_UP` stays authoritative.
- Integer fields (pay periods, share counts entered as integers, focal year) keep their
  existing integer regexes. Percent fields gain tolerance by parsing through `parseAmount`
  first, then the existing exact `shiftPoint` string math, unchanged.

### 3.2 Inline arithmetic

- A money field beginning with `=` evaluates as an expression over `+ - * / ( )` and decimal
  literals: `=1200+34.56` commits `1234.56`. Tiny recursive-descent evaluator; never `eval`.
- Evaluated on commit (Enter/blur); result quantized 2dp HALF_UP via the client `quantize`
  already proven in BracketsEditor (lifted into `utils`). Malformed expressions leave the raw
  text in place and mark the field invalid.
- Money boxes only — not integers, dates, or percents.

### 3.3 `<AmountInput>` (`src/components/AmountInput.tsx`)

A controlled input that keeps the house state pattern (parent owns raw strings, e.g.
`Record<id, string>`); props: `value`, `onValueChange`, `kind: 'money' | 'shares' | 'percent'
| 'plain'`, plus passthroughs (`id`, `placeholder`, `disabled`).

- **Focus:** select-all (type-to-replace); the value-at-focus is remembered.
- **Commit (Enter/blur):** parse or evaluate → `onValueChange(canonical)`. Unparseable input
  is left verbatim with the existing `.invalid` convention.
- **Display:** while focused, the raw state; while blurred and parseable, a formatted echo
  (`formatCurrency`/`formatShares` per `kind`). Display-only — state and wire format never
  contain formatted text.
- **Escape:** restore the value-at-focus and re-select (the sheet's cancel-cell-edit).
- Styling stays `.field-input` (already right-aligned monospace). Rider: portfolio panels'
  divergent `.entry-form input` styling unifies onto `.field-input`.

### 3.4 Keyboard protocol

- A container opts into column-flow with a `data-entry-scope` attribute; each `AmountInput`
  renders `data-entry-cell`. **Inside a scope:** Enter commits and focuses the next cell in
  DOM order (Shift+Enter previous); ArrowDown/ArrowUp likewise; ArrowLeft/Right stay native.
  Enter on the last cell focuses the scope's **primary action** button, so Enter-Enter
  finishes the step. **Outside a scope** (single-row ledger forms), Enter falls through to
  native implicit form submission — commit-the-row, matching sheet row entry via Tab-across.
- **Ctrl+Enter** (and Ctrl+S, preventDefault'd, listener scoped to entry containers)
  activates the scope's primary action directly: the wizard step's Next/Save, the tax form's
  Save, a jurisdiction's Save.
- Scopes and primary actions in Phase 1: wizard balances step, wizard spending step
  (Next/Save month); tax InputsForm (Save inputs); each BracketsEditor jurisdiction (its
  Save). **Documented behavior change:** plain Enter in the tax form currently submits all
  43 inputs via implicit submission; it becomes advance-to-next, with Ctrl+Enter saving.
- **autoFocus:** first cell of a wizard step on mount. Ledger panels refocus their first
  field after a successful save (mechanism ships here; per-panel adoption completes in
  Phase 3).

### 3.5 Adoption map

Wizard first (grids gain scopes; Next/Save wired as primary actions), then a mechanical
sweep: tax inputs + bracket cells, ESPP, paycheck, comp events, RSU grants, portfolio
panels. All money/decimal call sites end on `parseAmount`; the two wizard validators and
their `.invalid` gating collapse into it.

## 4. Phase 2 — paste + the wizard as a table

### 4.1 Range paste (any `data-entry-scope`, so the tax form gets it too)

`onPaste` intercepts only when the clipboard text contains a newline or tab; single-value
paste stays native (and now parses tolerantly anyway).

- **Positional mode** (rows of one cell each, **or** a single row of many cells — the source
  sheet stores months as rows, so a copied month is a horizontal range; it fills transposed):
  fill the focused cell and following cells in scope order. Each cell goes through
  `parseAmount`; unparseable cells are filled verbatim and show the standard `.invalid` red —
  same as if typed. Values beyond the last cell are dropped and counted.
- **Keyed mode** (≥2 rows of ≥2 tab-separated cells): the first cell of each row is matched
  to a row label (account/category name; trimmed case-insensitive exact, else
  slug-normalized) and the **last** cell fills the matched input regardless of focus position
  (covers both `name<TAB>value` and `name<TAB>…<TAB>latest-month` ranges). Unmatched rows are
  reported, matched ones fill.
- **Feedback:** a transient `aria-live` status under the grid — "Filled 24 of 26 · 2
  unmatched: …" — and a brief highlight flash on filled cells.
- **Undo:** the existing draft machinery already covers a bad paste — the restore banner's
  "Discard" returns to the server seed; no new undo system.

### 4.2 The wizard becomes a table (`MonthlyUpdatePage`)

- **Balances step:** one table — `Account | Last month | This month | Δ` — with group
  subheader rows and **live group subtotal rows**; component accounts stay indented under
  their parent (existing `nestComponents` order and badge preserved).
- **Spending step:** `Category | Typical (3-mo median) | This month | Δ vs typical`; net pay
  stays in the meta row above. Seeds remain `0.00` (spending is a flow, not a balance — the
  reference column provides the context prefill would fake).
- **Sticky footer, both steps:** the review preview promoted to always-visible live totals —
  net worth + Δ vs prior month while entering balances; total spend + savings rate while
  entering spending. The review step remains as the atomic-save gate (server-authoritative
  rounding note), slimmed.
- **Narrow viewports:** reference and Δ columns hide under a breakpoint; the label + input
  column always survives.
- **Data:** spending medians need the trailing three months — one additional fetch (existing
  spending matrix/timeseries endpoint) on wizard load.
- **Rider (small API change):** blanking a previously saved net pay currently cannot clear it
  (blank = omitted = skip). `net_pay: null` becomes an explicit clear on
  `PUT /spending/months/{month}`, mirroring the `notes: null` convention, with a test.

## 5. Phase 3 — fewer keystrokes

### 5.1 Ledger ergonomics

- **TransactionsPanel:** after a successful add, keep security/account/type/date, clear
  shares/price/fees/notes, focus shares, and show a subtle "kept from last entry" hint. Add a
  per-row **Duplicate** action (seeds the full row, focuses shares).
- **DividendsPanel:** add the missing edit path (form-swap, like transactions — verify
  `PATCH /portfolio/dividends/{id}` exists; add if not) and the same carry-forward
  (keep security/account/pay_date, clear amount).
- Focus-return-after-save lands on every panel (paycheck, ESPP, comp, grants).

### 5.2 Computed balance suggestions (wizard chips) — beyond sheet parity

The sheet made the user hand-copy their own GOOGLEFINANCE numbers into Net Worth; the
dashboard already computes them.

- **Mapping:** nullable `accounts.suggest_source` (one alembic revision; importer-immune —
  the column is dashboard-only, like `rsu_grants`). Structured `kind:param` values, initial
  kinds:
  - `portfolio:<account-label>` — live market value of holdings under that transactions
    account label (covers manual-priced NAV securities too, since they fold into holdings).
  - `vesting:unvested` — unvested shares from the computed vesting schedule × the grant
    ticker's latest stored price (the schedule endpoint's existing valuation).
- **Endpoint:** `GET /net-worth/suggestions` → `{account_id: value}` for mapped accounts,
  computed from current prices/data. Read-only.
- **UI:** the tax form's proven pattern — a grey "suggested $X · Apply" chip beside the row's
  input; never auto-applied. Shown **only on the ribbon's anchor month** (the newest
  enterable month) — suggestions are "now" values and would be wrong for backfills.
- **Config:** a minimal mapping editor (accounts list + suggest_source selector) — placement
  is an open item (no accounts admin UI exists today; likely a Settings card).

## 6. Cross-cutting invariants

- **Wire format unchanged:** canonical plain-decimal strings only; formatted text never
  leaves the client; no new bulk write paths — the wizard's two PUTs and row CRUD stand.
- **Draft machinery unchanged:** blur canonicalization must never create spurious dirt
  (idempotence guarantee in §3.1, tested).
- **Import/manual boundary untouched:** the `source` field semantics and importer behavior
  are out of scope.
- **A11y:** paste status is `aria-live`; invalid fields gain `aria-invalid` (border is
  currently the only signal — rider); selects/date inputs keep native key behavior except
  Enter-advance inside scopes.

## 7. Testing

- `amount.test.ts` — parser tolerance/rejection table (commas, `$`, parentheses, exponents,
  verbatim idempotence) and evaluator (precedence, parentheses, malformed, HALF_UP quantize).
- `AmountInput.test.tsx` — select-on-focus, Enter/arrow traversal order, Shift+Enter,
  Escape revert, blur normalize + formatted echo, no-dirty-on-untouched-blur.
- Paste — positional fill with invalid cells and overflow counting; keyed matching with
  unmatched reporting.
- Wizard tests updated for table markup, live subtotal/footer math (must equal the existing
  review-step preview), and draft compatibility.
- Backend — `net_pay: null` clears; suggestions endpoint (mapped, unmapped, value math).
- Invariant test — PUT bodies remain canonical plain decimals.

## 8. Risks & open items

| Risk / item | Mitigation |
|---|---|
| Enter behavior change on the tax form (was save-all, becomes advance) | Deliberate and documented; Ctrl+Enter preserves the save habit |
| Arrow-key hijack inside text inputs | Standard for cell-style UIs; Left/Right untouched; scoped containers only |
| Ctrl+S browser default | preventDefault with listeners scoped to entry containers |
| Dividends PATCH may not exist | Verify during Phase 3 planning; add route if missing |
| Suggestion mapping needs a config surface | Open item — decide placement (Settings card) in Phase 3 planning |
| Extra wizard fetch for spending medians | One request against an existing endpoint; acceptable |

## 9. Out of scope

Grid libraries; autosave-per-cell; command-box entry; OCR/LLM capture; inline editing of
history/analytics tables; paste-block ledger import; any xlsx importer changes.
