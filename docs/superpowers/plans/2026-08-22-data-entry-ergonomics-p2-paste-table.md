# Data-Entry Ergonomics Phase 2 — Paste + Wizard-as-Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship spec §4 — range paste into every `data-entry-scope` (positional, transposed, keyed) and the wizard's two entry steps rebuilt as real tables with prior-value/Δ columns and live sticky totals — plus the `net_pay: null` clear rider (this phase's only backend change).

**Architecture:** A pure clipboard classifier (`src/utils/paste.ts`) feeds page-level `onPaste` handlers on the existing scope containers (parents own the state, so parents do the filling; `AmountInput` is untouched). The wizard swaps its wrapping card grids for single-column `.data-table` layouts whose cells are the same AmountInputs, keeping the Phase 1 keyboard protocol, validity gating, and the sessionStorage draft machinery byte-identical in semantics. Spending's "Typical" column derives client-side from the existing `GET /spending/matrix`.

**Tech Stack:** React 19 + TS + vitest/RTL (fireEvent; no user-event) on the frontend; FastAPI + pytest for the one backend rider. No new dependencies, no migrations.

**Branch:** `feature/data-entry-ergonomics-p2` off `main` (post-Phase-1 `ef31027`).

**Execution conventions:** as Phase 1 — Opus implementers; spec + quality reviews per task (parallel pair with the no-tree-mutation hygiene rules); cross-task pipelining only on disjoint files; final whole-branch review before ff-merge. Baseline gates at branch start: 639 vitest / 50 files; 753 pytest; lint 1 sanctioned warning; EChart chunk 700.93 kB byte-identical (this phase must keep it byte-identical — charts untouched).

---

## Locked design decisions (implementers do not relitigate)

1. **Paste lives in the PAGE, not the component.** AmountInput cannot set sibling state (parents own the `Record<id, string>`); the scope container's `onPaste` intercepts multi-cell text during bubble, `preventDefault()`s, and writes state directly. Single-cell paste never intercepts — native insertion + Phase 1 tolerant parsing already handle it.
2. **Pasted cells land RAW.** Fill writes the trimmed cell text into state exactly as if typed: parseable text echoes, garbage shows the standard `.invalid`/aria-invalid, the belts canonicalize at save. No paste-time evaluation or rejection.
3. **Classification rules** (spec §4.1 + Phase-1 amendments): rows split on `/\r?\n/` (trailing empties dropped), cells on `\t`. 1×1 → native (classifier returns null). N×1 → positional column. 1×N → positional transposed (the source sheet stores months as rows). ≥2 rows where any row has ≥2 cells → keyed: label = first cell, value = LAST cell; rows with fewer than 2 cells in keyed mode count as unmatched.
4. **Label matching:** trimmed case-insensitive exact first, else slug-normalized (lowercase, strip every non-alphanumeric) equality. No fuzzy distance — a miss is reported, never guessed.
5. **Feedback:** one transient status line per step (`role="status"` + `aria-live="polite"`), wording `Pasted N of M values` / `· K unmatched: A, B, +j more` / `· j values didn't fit`. Filled cells flash via a CSS animation class cleared on a 700 ms timer. The existing draft-discard affordance is the paste undo — no new undo system.
6. **Table semantics:** the wizard's two grids become single-column `.data-table` layouts. DOM order of cells inside each scope = table row order, so the Phase 1 Enter/arrow protocol walks straight down. Group subheader + live subtotal rows for balances; components render indented under their parent and are EXCLUDED from subtotals/net worth exactly as today (`is_component`).
7. **Reference columns:** balances show `Last month` (the prior month's per-account balance — a NEW `priorBalances` state; today the prior fetch is consumed only for seeding/prevNetWorth) and `Δ` vs it. Spending shows `Typical` = median of the up-to-3 latest non-null matrix values STRICTLY BEFORE the wizard month, and `Δ` vs typical. Both live-update from committed values (`canonicalAmount`, matching the preview memo).
8. **Sticky footer** on both entry steps: net worth preview + Δ vs prior (balances); total spend + savings rate (spending) — the same `preview` memo the review step uses. The review step itself stays untouched (still the atomic save gate).
9. **Narrow viewports:** below 720 px the reference and Δ columns hide (CSS only); label + input always survive.
10. **`net_pay` rider semantics:** omitted → no-op (unchanged); string → upsert (unchanged); **explicit `null` → delete the month's `MonthlyCashflow` row** (mirrors the `notes: null` clear). Response gains additive `net_pay_cleared: bool`. The wizard sends `null` only when the loaded month HAD a net_pay and the box is blank at save.
11. **Deliberate non-goals this phase:** no paste on ledger row forms (single-row shapes; Phase 3 owns ledger ergonomics); no changes to AmountInput or utils/amount; review step unchanged; importer untouched.

---

### Task 1: backend rider — `net_pay: null` clears the cashflow row

**Files:**
- Modify: `backend/app/api/spending.py` (the `put_month` handler, lines ~277-343)
- Modify: the spending schemas file (find `SpendingMonthUpsert` / `SpendingUpsertResult` — `grep -rn "SpendingUpsertResult" backend/app/schemas`)
- Test: the spending API test file (`grep -rln "put.*months" backend/tests` — follow its existing fixtures/idioms exactly)

- [ ] **Step 1: Write the failing tests** (in the spending API test file, matching its existing async-client idiom):

```python
async def test_put_month_net_pay_null_clears(client, db_session):
    # Arrange: a month with net_pay set.
    put = await client.put(
        "/api/v1/spending/months/2026-08-01",
        json={"net_pay": "9000.00", "amounts": []},
    )
    assert put.status_code == 200
    assert put.json()["net_pay_set"] is True

    # Act: explicit null clears it.
    cleared = await client.put(
        "/api/v1/spending/months/2026-08-01",
        json={"net_pay": None, "amounts": []},
    )
    assert cleared.status_code == 200
    body = cleared.json()
    assert body["net_pay_set"] is False
    assert body["net_pay_cleared"] is True

    got = await client.get("/api/v1/spending/months/2026-08-01")
    assert got.json()["net_pay"] is None


async def test_put_month_net_pay_omitted_is_still_a_no_op(client, db_session):
    await client.put(
        "/api/v1/spending/months/2026-07-01",
        json={"net_pay": "5000.00", "amounts": []},
    )
    result = await client.put("/api/v1/spending/months/2026-07-01", json={"amounts": []})
    assert result.json()["net_pay_set"] is False
    assert result.json()["net_pay_cleared"] is False
    got = await client.get("/api/v1/spending/months/2026-07-01")
    assert got.json()["net_pay"] == "5000.00"


async def test_put_month_net_pay_null_on_a_month_without_one_is_harmless(client, db_session):
    result = await client.put(
        "/api/v1/spending/months/2026-06-01", json={"net_pay": None, "amounts": []}
    )
    assert result.status_code == 200
    assert result.json()["net_pay_cleared"] is False  # nothing existed to clear
```

(Adapt fixture names — `client`/`db_session` — to whatever the file actually uses. If a helper seeds categories, an empty `amounts` list avoids it entirely.)

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && .venv/Scripts/python -m pytest tests/<the file> -q -k net_pay`
Expected: FAIL — `net_pay_cleared` missing from the response (and the clear leaves 9000.00 in place).

- [ ] **Step 3: Implement**

In `backend/app/api/spending.py::put_month`, the current provided-detection is:

```python
    net_pay_provided = "net_pay" in body.model_fields_set and body.net_pay is not None
```

Replace the net_pay handling with a three-way split (comment the semantics):

```python
    # net_pay is tri-state (the notes-null convention, spec 2026-08-21 §4.2 rider):
    # omitted = leave it alone; a string = upsert; an EXPLICIT null = clear the month's
    # cashflow row. model_fields_set is what tells an omitted field from a null one.
    net_pay_present = "net_pay" in body.model_fields_set
    net_pay_provided = net_pay_present and body.net_pay is not None
    net_pay_clear = net_pay_present and body.net_pay is None
```

Keep the existing quantize/negative checks under `net_pay_provided` unchanged. After the amounts loop, replace the cashflow write block:

```python
    net_pay_cleared = False
    if net_pay_provided:
        cashflow = await db.get(MonthlyCashflow, month)
        if cashflow is None:
            db.add(MonthlyCashflow(month=month, net_pay=net_pay_value))
        else:
            cashflow.net_pay = net_pay_value
    elif net_pay_clear:
        cashflow = await db.get(MonthlyCashflow, month)
        if cashflow is not None:
            await db.delete(cashflow)
            net_pay_cleared = True
```

and extend the return with `net_pay_cleared=net_pay_cleared`.

In the schemas file: `SpendingUpsertResult` gains `net_pay_cleared: bool = False` (additive default keeps every existing constructor/test green). Verify `SpendingMonthUpsert.net_pay` is `Decimal | None = None` typed so explicit null passes validation — if it is `Decimal | None` already, nothing to change; if it forbids null, loosen exactly that field.

- [ ] **Step 4: Run the file, then the full backend suite**

Run: `cd backend && .venv/Scripts/python -m pytest tests/<the file> -q` then `.venv/Scripts/python -m pytest -q`
Expected: file green; full suite 753 + 3 new, all green. Also `.venv/Scripts/python -m ruff check app tests && .venv/Scripts/python -m ruff format --check app tests` (CI runs format --check — keep it clean).

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat: PUT spending month — explicit net_pay null clears the cashflow row"
```

---

### Task 2: pure utils — clipboard classifier + label matcher + spending typical

**Files:**
- Create: `src/utils/paste.ts`
- Create: `src/utils/paste.test.ts`
- Modify: `src/utils/spending.ts` (append `typicalSpend`)
- Modify: `src/utils/spending.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Create `src/utils/paste.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { classifyPaste, matchLabel } from './paste'

describe('classifyPaste', () => {
  it('returns null for single-cell text — native paste handles it', () => {
    expect(classifyPaste('1234.56')).toBeNull()
    expect(classifyPaste('$1,234.56\n')).toBeNull() // one trailing newline is still one cell
  })
  it('classifies a column as positional', () => {
    expect(classifyPaste('1\n2\n3')).toEqual({ mode: 'positional', values: ['1', '2', '3'] })
    expect(classifyPaste('1\r\n2\r\n')).toEqual({ mode: 'positional', values: ['1', '2'] })
  })
  it('classifies a single row of many cells as positional, transposed', () => {
    // The source sheet stores months as ROWS — a copied month is a horizontal range.
    expect(classifyPaste('1\t2\t3')).toEqual({ mode: 'positional', values: ['1', '2', '3'] })
  })
  it('classifies multi-row multi-cell as keyed: first cell label, LAST cell value', () => {
    expect(classifyPaste('Checking\t100\nSavings\t200')).toEqual({
      mode: 'keyed',
      rows: [
        { label: 'Checking', value: '100' },
        { label: 'Savings', value: '200' },
      ],
      skipped: 0,
    })
    // name<TAB>…<TAB>latest-month ranges take the LAST cell.
    expect(classifyPaste('Checking\tJan\t100\nSavings\tJan\t200')).toEqual({
      mode: 'keyed',
      rows: [
        { label: 'Checking', value: '100' },
        { label: 'Savings', value: '200' },
      ],
      skipped: 0,
    })
  })
  it('counts one-cell rows inside a keyed block as skipped', () => {
    expect(classifyPaste('Checking\t100\norphan\nSavings\t200')).toEqual({
      mode: 'keyed',
      rows: [
        { label: 'Checking', value: '100' },
        { label: 'Savings', value: '200' },
      ],
      skipped: 1,
    })
  })
  it('trims cells and drops fully empty rows', () => {
    expect(classifyPaste(' 1 \n\n 2 \n')).toEqual({ mode: 'positional', values: ['1', '2'] })
  })
})

describe('matchLabel', () => {
  const labels = [
    { id: 1, name: 'Checking' },
    { id: 7, name: 'Food & Dining' },
  ]
  it('matches trimmed case-insensitive exact first', () => {
    expect(matchLabel(labels, '  checking ')).toBe(1)
  })
  it('falls back to slug-normalized equality', () => {
    expect(matchLabel(labels, 'food-and-dining')).toBeNull() // "and" is letters — NOT equal
    expect(matchLabel(labels, 'Food &  Dining')).toBe(7) // whitespace/punct differences vanish
    expect(matchLabel(labels, 'FOOD DINING')).toBe(7)
  })
  it('never guesses', () => {
    expect(matchLabel(labels, 'Chequing')).toBeNull()
  })
})
```

Append to `src/utils/spending.test.ts` (match its existing import style; `SpendingMatrix` fixtures exist in that file — reuse the local builder if one exists, else build inline):

```ts
describe('typicalSpend', () => {
  const matrix = {
    months: ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01'],
    categories: [],
    series: [
      { category_id: 7, values: ['10.00', '30.00', null, '20.00'] },
      { category_id: 8, values: [null, null, null, null] },
    ],
    totals: [],
    net_pay: [],
    savings_rate: [],
    four_pct_rule: [],
  }
  it('takes the median of the up-to-3 latest non-null values strictly before the month', () => {
    // Before 2026-08: candidates are 20.00 (Jul), 30.00 (May), 10.00 (Apr) → median 20.
    expect(typicalSpend(matrix, '2026-08-01', 7)).toBe(20)
    // Before 2026-06: candidates 30, 10 → even count, mean of the middle pair = 20.
    expect(typicalSpend(matrix, '2026-06-01', 7)).toBe(20)
    // Before 2026-05: only 10 → 10.
    expect(typicalSpend(matrix, '2026-05-01', 7)).toBe(10)
  })
  it('returns null with no history', () => {
    expect(typicalSpend(matrix, '2026-08-01', 8)).toBeNull()
    expect(typicalSpend(matrix, '2026-04-01', 7)).toBeNull() // nothing strictly before
    expect(typicalSpend(matrix, '2026-08-01', 99)).toBeNull() // unknown category
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/paste.test.ts src/utils/spending.test.ts`
Expected: FAIL — `./paste` unresolved; `typicalSpend` not exported.

- [ ] **Step 3: Implement**

Create `src/utils/paste.ts`:

```ts
// Clipboard classification for range paste (spec 2026-08-21 §4.1). Pure text-in,
// structure-out: the PAGES decide what to fill — parents own the entry state, so
// AmountInput never touches a sibling.

export interface PositionalPaste {
  mode: 'positional'
  values: string[]
}

export interface KeyedPaste {
  mode: 'keyed'
  rows: { label: string; value: string }[]
  /** One-cell rows found inside a keyed block — reported, never guessed at. */
  skipped: number
}

/**
 * Split clipboard text into a paste plan, or null when it is a single cell (native
 * insertion + tolerant parsing already handle that). Rows on newlines, cells on tabs —
 * the two characters parseAmount deliberately REFUSES as grouping, so a multi-cell
 * clipboard can never masquerade as one number (the amount.ts pin's counterpart).
 *
 * Shapes: N×1 → positional column. 1×N → positional TRANSPOSED (the source sheet stores
 * months as rows, so a copied month arrives horizontal). ≥2 rows with any 2-cell row →
 * keyed: first cell is the label, LAST cell the value (covers both name→value and
 * name→…→latest-month ranges).
 */
export function classifyPaste(text: string): PositionalPaste | KeyedPaste | null {
  const rows = text
    .split(/\r?\n/)
    .map((row) => row.split('\t').map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell !== ''))
  if (rows.length === 0) return null
  if (rows.length === 1) {
    const cells = rows[0].filter((cell) => cell !== '')
    return cells.length <= 1 ? null : { mode: 'positional', values: cells }
  }
  if (rows.every((cells) => cells.length === 1)) {
    return { mode: 'positional', values: rows.map((cells) => cells[0]) }
  }
  const keyed = rows.filter((cells) => cells.length >= 2)
  return {
    mode: 'keyed',
    rows: keyed.map((cells) => ({ label: cells[0], value: cells[cells.length - 1] })),
    skipped: rows.length - keyed.length,
  }
}

/** Lowercase and strip every non-alphanumeric — "Food &  Dining" ≡ "food dining". */
function slugOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Resolve a pasted label to a row id: trimmed case-insensitive exact first, then
 * slug-normalized equality. A miss is a report, never a guess — filling the wrong
 * account with the right number is worse than filling nothing.
 */
export function matchLabel(labels: { id: number; name: string }[], pasted: string): number | null {
  const needle = pasted.trim().toLowerCase()
  for (const { id, name } of labels) {
    if (name.trim().toLowerCase() === needle) return id
  }
  const slug = slugOf(pasted)
  if (slug === '') return null
  for (const { id, name } of labels) {
    if (slugOf(name) === slug) return id
  }
  return null
}
```

Append to `src/utils/spending.ts` (import `SpendingMatrix` from types if not already imported):

```ts
/**
 * The spending step's "Typical" reference: the median of the up-to-3 latest non-null
 * matrix values STRICTLY before `month`. Spending is a flow, so seeds stay 0.00 — this
 * column is the context prefill would fake (spec §4.2). Number() here is display-side
 * math on server strings, same license as the chart builders.
 */
export function typicalSpend(
  matrix: SpendingMatrix,
  month: string,
  categoryId: number,
): number | null {
  const series = matrix.series.find((s) => s.category_id === categoryId)
  if (series === undefined) return null
  const values: number[] = []
  for (let i = matrix.months.length - 1; i >= 0 && values.length < 3; i -= 1) {
    if (matrix.months[i] >= month) continue // ISO strings — string compare IS date compare
    const value = series.values[i]
    if (value !== null) values.push(Number(value))
  }
  if (values.length === 0) return null
  values.sort((a, b) => a - b)
  const mid = Math.floor(values.length / 2)
  return values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2
}
```

- [ ] **Step 4: Run to green**

Run: `npx vitest run src/utils/paste.test.ts src/utils/spending.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/paste.ts src/utils/paste.test.ts src/utils/spending.ts src/utils/spending.test.ts
git commit -m "feat: clipboard classifier + label matcher + spending typical median"
```

---

### Task 3: the balances step becomes a table (Last month | This month | Δ, subtotals, sticky footer)

**Files:**
- Modify: `src/pages/MonthlyUpdatePage.tsx`
- Modify: `src/pages/MonthlyUpdatePage.css`
- Modify: `src/pages/MonthlyUpdatePage.test.tsx`

- [ ] **Step 1: State + data**

1. New state after `prevNetWorth`: `const [priorBalances, setPriorBalances] = useState<Record<number, string>>({})`.
2. In the load effect, after `setPrevNetWorth(prevSum)`, keep the prior month's per-account values (empty when the prior month doesn't exist):

```ts
        setPriorBalances(
          priorMonth.exists
            ? Object.fromEntries(priorMonth.balances.map((b) => [b.account_id, b.balance]))
            : {},
        )
```

- [ ] **Step 2: Live helpers** (above the return, after `firstBalanceId`):

```ts
  // Committed value of one cell for the live columns — the preview memo's rule.
  const committed = (raw: string | undefined) => Number(canonicalAmount(raw ?? '')) || 0

  // Per-group live subtotal + its prior twin (components excluded, exactly like net worth).
  const groupTotals = (group: (typeof GROUP_ORDER)[number]) => {
    const rows = accounts.filter((a) => a.group === group && !a.is_component)
    const now = rows.reduce((acc, a) => acc + committed(balances[a.id]), 0)
    const prior = rows.reduce(
      (acc, a) => acc + (priorBalances[a.id] === undefined ? 0 : Number(priorBalances[a.id])),
      0,
    )
    return { now, prior }
  }
```

- [ ] **Step 3: Replace the balances rendering.** The `{GROUP_ORDER.map(...)}` block (the `group-block`/`entry-grid` markup) becomes ONE table; the meta-row and the surrounding card (with its `data-entry-scope`) stay. New markup:

```tsx
          <table className="data-table entry-table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="num entry-ref">Last month</th>
                <th className="num">This month</th>
                <th className="num entry-delta">Δ</th>
              </tr>
            </thead>
            <tbody>
              {GROUP_ORDER.map((group) => {
                const groupAccounts = accounts.filter((a) => a.group === group)
                if (groupAccounts.length === 0) return null
                const totals = groupTotals(group)
                return (
                  <Fragment key={group}>
                    <tr className="entry-group-row">
                      <th colSpan={4}>{GROUP_LABELS[group]}</th>
                    </tr>
                    {groupAccounts.map((account) => {
                      const value = balances[account.id] ?? ''
                      const prior = priorBalances[account.id]
                      const delta = prior === undefined ? null : committed(value) - Number(prior)
                      return (
                        <tr key={account.id}>
                          <td className={account.is_component ? 'entry-component' : undefined}>
                            <label htmlFor={`bal-${account.id}`}>
                              {account.name}
                              {account.is_component && <span className="badge">component</span>}
                            </label>
                          </td>
                          <td className="num entry-ref">
                            {prior === undefined ? '—' : formatCurrency(prior)}
                          </td>
                          <td className="num entry-cell-col">
                            <AmountInput
                              id={`bal-${account.id}`}
                              className={isAmount(value) ? undefined : 'invalid'}
                              autoFocus={account.id === firstBalanceId}
                              value={value}
                              onValueChange={(next) =>
                                setBalances((cur) => ({ ...cur, [account.id]: next }))
                              }
                            />
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
                    <tr className="entry-subtotal-row">
                      <td>Subtotal</td>
                      <td className="num entry-ref">{formatCurrency(totals.prior)}</td>
                      <td className="num">{formatCurrency(totals.now)}</td>
                      <td className="num entry-delta">{formatCurrency(totals.now - totals.prior)}</td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
```

(`import { Fragment } ...` joins the react import.) After the liabilities hint `<p className="drill-hint">…</p>`, add the sticky footer ABOVE the wizard-footer:

```tsx
          <div className="entry-footer" role="status">
            <span>
              Net worth (live): <strong>{formatCurrency(preview.netWorth)}</strong>
            </span>
            {preview.delta !== null && (
              <span className={preview.delta >= 0 ? 'delta-positive' : 'delta-negative'}>
                <span aria-hidden="true">{preview.delta >= 0 ? '▲ ' : '▼ '}</span>
                {formatCurrency(preview.delta)} vs prior month
              </span>
            )}
          </div>
```

- [ ] **Step 4: CSS** — in `MonthlyUpdatePage.css`, REPLACE the `.entry-grid` / `.entry-field` rules (they become orphans — verify with `grep -rn "entry-grid\|entry-field" src` after the spending step converts in Task 4; until then leave them in place and delete in Task 4):

```css
/* The single-column entry table: Tab/Enter walk straight down one visual column,
   the way the sheet's muscle memory expects (spec §4.2). */
.entry-table { width: 100%; }
.entry-table td, .entry-table th { padding: 0.3rem 0.6rem; }
.entry-table .entry-cell-col { width: 160px; }
.entry-table .entry-ref, .entry-table .entry-delta { width: 130px; color: var(--muted); }
.entry-table label { cursor: pointer; }
.entry-component label { padding-left: 1.1rem; }
.entry-group-row th {
  text-align: left;
  padding-top: 0.9rem;
  font-size: 0.72rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--muted);
}
.entry-subtotal-row td {
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 0.8rem;
}
.delta-positive { color: var(--positive); }
.delta-negative { color: var(--negative); }

/* Live totals ride the viewport bottom while the column scrolls (the sheet's total row). */
.entry-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.6rem 0.9rem;
  margin-top: 0.75rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 0.9rem;
}

/* Narrow viewports: the label + input column always survives. */
@media (max-width: 720px) {
  .entry-table .entry-ref, .entry-table .entry-delta { display: none; }
}
```

(If `--positive`/`--negative` variable names differ, use the ones `.stat-delta-positive/-negative` use — check `src/components/panels.css` and reuse; never invent a new color literal.)

- [ ] **Step 5: Test updates + new pins.** Existing tests keep working (labels still resolve via `htmlFor`; the single-account fixture autofocuses so raw-value assertions stand). Add:

```tsx
it('shows last month beside the cell and a live delta as you type', async () => {
  renderWizard()
  const balanceInput = await screen.findByLabelText('Checking')
  const row = balanceInput.closest('tr') as HTMLElement
  expect(within(row).getByText('$1,500.00')).toBeDefined() // last-month reference
  fireEvent.change(balanceInput, { target: { value: '1600.00' } })
  expect(within(row).getByText('$100.00')).toBeDefined() // live Δ
})

it('keeps the live net-worth footer in sync while entering balances', async () => {
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '2000' } })
  const footer = screen.getByRole('status')
  expect(within(footer).getByText('$2,000.00')).toBeDefined()
})
```

(`within` joins the RTL import. NOTE: the draft-restore banner also has `role="status"` — it only renders when a draft restored, and these tests type fresh, so `getByRole('status')` is unambiguous; if a collision appears, scope by class or use `getAllByRole`.) Also update any assertion that located inputs via the old `entry-field` structure (none are known — the suite queries by label).

- [ ] **Step 6: Gates + commit**

`npx vitest run src/pages/MonthlyUpdatePage.test.tsx` green; `npx tsc -b`; eslint on both files.

```bash
git add src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.css src/pages/MonthlyUpdatePage.test.tsx
git commit -m "feat: balances step as a table — last-month + live-delta columns, group subtotals, sticky net-worth footer"
```

---

### Task 4: the spending step becomes a table (Typical | This month | Δ) + net_pay clear wiring

**Files:**
- Modify: `src/pages/MonthlyUpdatePage.tsx`
- Modify: `src/pages/MonthlyUpdatePage.css` (delete the now-orphaned `.entry-grid`/`.entry-field` rules)
- Modify: `src/types/api.ts` (`SpendingUpsertResult` + the PUT body type)
- Modify: `src/api/spending.ts` (`putSpendingMonth` body type)
- Modify: `src/pages/MonthlyUpdatePage.test.tsx`

- [ ] **Step 1: Data.** Add `fetchMatrix` to the spending import and `typicalSpend` to the utils/spending import. The load effect's `Promise.all` gains `fetchMatrix()` as a seventh fetch; store it: `const [matrix, setMatrix] = useState<SpendingMatrix | null>(null)` (type import from types/api), `setMatrix(matrixData)` in the then-callback. Also new state `const [hadNetPay, setHadNetPay] = useState(false)`; in the load callback set `setHadNetPay(spendMonth.net_pay !== null)`.

- [ ] **Step 2: Wire types.** In `src/types/api.ts`, `SpendingUpsertResult` gains `net_pay_cleared: boolean`. In `src/api/spending.ts`, the body type becomes `{ net_pay?: string | null; amounts: AmountEntry[] }`.

- [ ] **Step 3: net_pay clear in `save()`.** Replace `if (netPay.trim() !== '') body.net_pay = canonNetPay` with:

```ts
      if (netPay.trim() !== '') {
        body.net_pay = canonNetPay
      } else if (hadNetPay) {
        // Tri-state rider (spec §4.2): blanking a previously saved net pay must CLEAR it —
        // omitting would silently keep the stale figure in every savings-rate denominator.
        body.net_pay = null
      }
```

and in the success path, after `setNetPay(canonNetPay)`, add `setHadNetPay(canonNetPay !== '')`.

- [ ] **Step 4: Replace the spending `entry-grid` with a table** (meta-row with the net-pay AmountInput stays above it; card keeps its scope):

```tsx
          <table className="data-table entry-table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="num entry-ref">Typical (3-mo median)</th>
                <th className="num">This month</th>
                <th className="num entry-delta">Δ vs typical</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => {
                const value = amounts[category.id] ?? ''
                const typical = matrix === null ? null : typicalSpend(matrix, month, category.id)
                const delta =
                  typical === null
                    ? null
                    : (Number(canonicalAmount(value)) || 0) - typical
                return (
                  <tr key={category.id}>
                    <td>
                      <label htmlFor={`amt-${category.id}`}>{category.name}</label>
                    </td>
                    <td className="num entry-ref">
                      {typical === null ? '—' : formatCurrency(typical)}
                    </td>
                    <td className="num entry-cell-col">
                      <AmountInput
                        id={`amt-${category.id}`}
                        className={isAmount(value) ? undefined : 'invalid'}
                        value={value}
                        onValueChange={(next) =>
                          setAmounts((cur) => ({ ...cur, [category.id]: next }))
                        }
                      />
                    </td>
                    <td
                      className={`num entry-delta${
                        delta === null || delta === 0
                          ? ''
                          : delta > 0
                            ? ' delta-negative' /* overspend vs typical reads as the bad direction */
                            : ' delta-positive'
                      }`}
                    >
                      {delta === null ? '—' : formatCurrency(delta)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="entry-footer" role="status">
            <span>
              Total spend (live): <strong>{formatCurrency(preview.totalSpend)}</strong>
            </span>
            <span>
              Savings rate:{' '}
              {preview.savings === null ? '—' : formatPct(preview.savings, { signed: false })}
            </span>
          </div>
```

Then delete the orphaned `.entry-grid`/`.entry-field` CSS (verify `grep -rn "entry-grid\|entry-field" src` returns nothing outside this CSS file first).

- [ ] **Step 5: Tests.** Update the `fetchMatrix` mock into the spending api mock block (`fetchMatrix: vi.fn()`) and seed it in `beforeEach` with a minimal matrix (`months: ['2026-07-01'], series: [{ category_id: 7, values: ['300.00'] }], categories: [], totals: [], net_pay: [], savings_rate: [], four_pct_rule: []`). New pins:

```tsx
it('shows the typical column and a live delta against it', async () => {
  renderWizard()
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  const food = await screen.findByLabelText('Food')
  const row = food.closest('tr') as HTMLElement
  expect(within(row).getByText('$300.00')).toBeDefined() // 3-mo median (one sample)
  fireEvent.change(food, { target: { value: '250.00' } })
  expect(within(row).getByText('-$50.00')).toBeDefined() // under typical
})

it('clears a previously saved net pay when the box is blanked', async () => {
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
    month: '2026-08-01', exists: true, net_pay: '9000.00', amounts: [],
  })
  renderWizard()
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  const netPayBox = await screen.findByLabelText('Net pay (take-home)')
  fireEvent.change(netPayBox, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await waitFor(() => {
    expect(spendingApi.putSpendingMonth).toHaveBeenCalledWith(
      '2026-08-01',
      expect.objectContaining({ net_pay: null }),
    )
  })
})

it('never sends net_pay for a month that had none and stays blank', async () => {
  renderWizard()
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await waitFor(() => {
    const body = vi.mocked(spendingApi.putSpendingMonth).mock.calls[0][1]
    expect('net_pay' in body).toBe(false)
  })
})
```

Also update `putSpendingMonth` result mocks to include `net_pay_cleared: false`.

- [ ] **Step 6: Gates + commit**

Targeted file green; `npx tsc -b`; eslint.

```bash
git add src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.css src/pages/MonthlyUpdatePage.test.tsx src/types/api.ts src/api/spending.ts
git commit -m "feat: spending step as a table — typical median + delta, live totals footer, net_pay blank-clears"
```

---

### Task 5: range paste into the wizard (both steps)

**Files:**
- Modify: `src/pages/MonthlyUpdatePage.tsx`
- Modify: `src/pages/MonthlyUpdatePage.css` (flash animation)
- Modify: `src/pages/MonthlyUpdatePage.test.tsx`

- [ ] **Step 1: Page state + handler.** Imports: `classifyPaste, matchLabel` from `../utils/paste`; `ClipboardEvent` type from react. New state:

```ts
  const [pasteNote, setPasteNote] = useState<string | null>(null)
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set()) // input ids, e.g. 'bal-3'
```

Clear both in `selectMonth` and in `setStep`. Flash decay (no setState in the effect's sync body — timer callback only):

```ts
  useEffect(() => {
    if (flashIds.size === 0) return
    const timer = setTimeout(() => setFlashIds(new Set()), 700)
    return () => clearTimeout(timer)
  }, [flashIds])
```

One generic handler, parameterized per step (place above the return):

```ts
  // Range paste (spec §4.1): the PARENT owns the entry state, so the scope container does
  // the filling. Single-cell clipboards return null and fall through to native insertion.
  const handlePaste = (
    e: ClipboardEvent<HTMLDivElement>,
    rows: { id: number; name: string }[],
    idOf: (rowId: number) => string,
    setRecord: (updater: (cur: Record<number, string>) => Record<number, string>) => void,
  ) => {
    const plan = classifyPaste(e.clipboardData.getData('text/plain'))
    if (plan === null) return
    e.preventDefault()
    const filled = new Set<string>()
    const fills: Record<number, string> = {}
    const unmatched: string[] = []
    let overflow = 0
    if (plan.mode === 'positional') {
      // Fill from the focused cell onward, in this grid's rendered order.
      const target = (e.target as HTMLElement).closest('input[data-entry-cell]')
      const ordered = rows.map((r) => idOf(r.id))
      const startAt = target === null ? 0 : Math.max(0, ordered.indexOf((target as HTMLInputElement).id))
      plan.values.forEach((value, i) => {
        const slot = startAt + i
        if (slot >= rows.length) {
          overflow += 1
          return
        }
        fills[rows[slot].id] = value
        filled.add(ordered[slot])
      })
    } else {
      for (const { label, value } of plan.rows) {
        const id = matchLabel(rows, label)
        if (id === null) {
          unmatched.push(label)
        } else {
          fills[id] = value
          filled.add(idOf(id))
        }
      }
      overflow = plan.skipped
    }
    if (Object.keys(fills).length > 0) setRecord((cur) => ({ ...cur, ...fills }))
    setFlashIds(filled)
    const parts = [`Pasted ${Object.keys(fills).length} of ${rows.length} values`]
    if (unmatched.length > 0) {
      const shown = unmatched.slice(0, 4).join(', ')
      const more = unmatched.length > 4 ? `, +${unmatched.length - 4} more` : ''
      parts.push(`${unmatched.length} unmatched: ${shown}${more}`)
    }
    if (overflow > 0) parts.push(`${overflow} value${overflow === 1 ? '' : 's'} didn't fit`)
    setPasteNote(parts.join(' · '))
  }
```

**Positional-mode note (bake into a comment):** the balances grid's `rows` array must be the RENDERED order — `GROUP_ORDER.flatMap((g) => accounts.filter((a) => a.group === g))` — not the raw accounts array; hoist that flatten into a variable shared with `firstBalanceId`. The spending grid's `rows` is `categories` as rendered. `idOf` is `(id) => \`bal-${id}\`` / `(id) => \`amt-${id}\``. The net-pay box is deliberately NOT part of positional fill (it is outside the table; a keyed paste can't reach it either — accounts/categories only, spec §4.1).

- [ ] **Step 2: Wire the two cards.** Balances card: `<div className="card" data-entry-scope="" onPaste={(e) => handlePaste(e, orderedBalanceRows, (id) => \`bal-${id}\`, setBalances)}>`; spending card likewise with `categories` and `amt-`. Render the note under each table (before the footer):

```tsx
          {pasteNote && (
            <p className="drill-hint" role="status" aria-live="polite">
              {pasteNote}
            </p>
          )}
```

(One note state serves both steps — it clears on step change.) Flash: each `AmountInput` in both tables extends its className: `className={`${isAmount(value) ? '' : 'invalid'}${flashIds.has(\`bal-${account.id}\`) ? ' pasted-flash' : ''}`.trim() || undefined}` (same for `amt-`). CSS:

```css
/* Paste feedback: filled cells flash once; the note line narrates the fill. */
@keyframes pasted-flash {
  from { background: color-mix(in srgb, var(--accent) 25%, var(--bg)); }
  to { background: var(--bg); }
}
.field-input.pasted-flash { animation: pasted-flash 0.7s ease-out; }
```

(If `color-mix` is out of the project's browser budget, use a literal derived from the accent at ~25% alpha via `rgba` — check how theme.ts/panels.css derive accent tints and copy that idiom.)

- [ ] **Step 3: Tests.** jsdom paste: `fireEvent.paste(el, { clipboardData: { getData: () => text } })`. The single-account fixture can't exercise ordering — override mocks locally with a two-account list:

```tsx
const savings = {
  id: 2, name: 'Savings', slug: 'savings', group: 'cash' as const,
  sort_order: 2, is_active: true, is_component: false, parent_account_id: null,
}

it('fills down from the focused cell on a column paste', async () => {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account, savings])
  renderWizard()
  const checking = await screen.findByLabelText('Checking')
  fireEvent.paste(checking, { clipboardData: { getData: () => '1,000\n2000' } })
  expect((checking as HTMLInputElement).value).toBe('1,000') // focused → raw, landed as typed
  expect((screen.getByLabelText('Savings') as HTMLInputElement).value).toBe('$2,000.00')
  expect(screen.getByText(/pasted 2 of 2 values/i)).toBeDefined()
})

it('fills a transposed horizontal range the same way', async () => {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account, savings])
  renderWizard()
  const checking = await screen.findByLabelText('Checking')
  fireEvent.paste(checking, { clipboardData: { getData: () => '1000\t2000' } })
  expect((screen.getByLabelText('Savings') as HTMLInputElement).value).toBe('$2,000.00')
})

it('keyed paste matches names regardless of focus and reports misses', async () => {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account, savings])
  renderWizard()
  const checking = await screen.findByLabelText('Checking')
  fireEvent.paste(checking, {
    clipboardData: { getData: () => 'savings\t2500\nChequing\t9\nChecking\t1750' },
  })
  expect((screen.getByLabelText('Savings') as HTMLInputElement).value).toBe('$2,500.00')
  expect((checking as HTMLInputElement).value).toBe('1750')
  expect(screen.getByText(/1 unmatched: Chequing/i)).toBeDefined()
})

it('reports overflow instead of silently dropping', async () => {
  renderWizard() // single-account fixture
  const checking = await screen.findByLabelText('Checking')
  fireEvent.paste(checking, { clipboardData: { getData: () => '1\n2\n3' } })
  expect((checking as HTMLInputElement).value).toBe('1')
  expect(screen.getByText(/2 values didn't fit/i)).toBeDefined()
})

it('leaves single-value paste to the browser', async () => {
  renderWizard()
  const checking = await screen.findByLabelText('Checking')
  const result = fireEvent.paste(checking, { clipboardData: { getData: () => '1234.56' } })
  expect(result).toBe(true) // not default-prevented — native insertion proceeds
})
```

(The `'$2,000.00'` assertions ride the display rule: unfocused cells echo. The focused `Checking` cell shows raw pasted text.)

- [ ] **Step 4: Gates + commit**

Targeted file green; `npx tsc -b`; eslint.

```bash
git add src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.css src/pages/MonthlyUpdatePage.test.tsx
git commit -m "feat: range paste into the wizard — positional/transposed/keyed with narrated fills"
```

---

### Task 6: range paste into the tax inputs form

**Files:**
- Modify: `src/components/taxes/InputsForm.tsx`
- Modify: `src/components/taxes/InputsForm.test.tsx`

- [ ] **Step 1: Handler.** Same pattern as Task 5, adapted to the string-keyed values record. The ordered rows are the sections' items flattened in render order; labels are `item.label`; ids are the existing `tax-input-${item.key}` DOM ids. Note state + flash mirror Task 5 (component-local `pasteNote`/`flashKeys`); the note renders above `.tax-form-actions`. The `<form data-entry-scope="">` gains the `onPaste`. Complete handler (adapt the Task 5 code — the differences are: rows are `{ key, label }`, fills write `setValues((current) => ({ ...current, ...fills }))` keyed by string keys, `idOf = (key) => \`tax-input-${key}\``, and there is no month/step clearing — the note clears on save success and on unmount naturally):

```ts
  const flatItems = inputs.sections.flatMap((section) => section.items)
```

Positional start index resolves against `flatItems.map((item) => \`tax-input-${item.key}\`)`; keyed matching uses `matchLabel(flatItems.map((item, i) => ({ id: i, name: item.label })), label)` mapping the matched INDEX back to `flatItems[i].key` (matchLabel wants numeric ids — indexes serve).

- [ ] **Step 2: Tests** (InputsForm.test.tsx has a 4-item, 3-section fixture — reuse it):

```tsx
it('column paste fills down the flattened sections from the focused item', () => {
  render(<InputsForm inputs={INPUTS} onSaved={() => {}} />)
  const first = screen.getByLabelText('Annual Salary') as HTMLInputElement
  fireEvent.paste(first, { clipboardData: { getData: () => '200000\n8333.33' } })
  expect(first.value).toBe('$200,000.00') // blurred → echo (nothing is focused in jsdom)
  expect(screen.getByText(/pasted 2 of 4 values/i)).toBeDefined()
})

it('keyed paste matches item labels', () => {
  render(<InputsForm inputs={INPUTS} onSaved={() => {}} />)
  fireEvent.paste(screen.getByLabelText('Annual Salary'), {
    clipboardData: { getData: () => 'HSA Contributions\t4300\nNot A Line\t1' },
  })
  expect((screen.getByLabelText('HSA Contributions') as HTMLInputElement).value).toBe('$4,300.00')
  expect(screen.getByText(/1 unmatched: Not A Line/i)).toBeDefined()
})
```

(Adapt fixture item names to the file's actual `INPUTS` builder — read it first; the two used here must exist or be substituted with real ones. The paste-filled values count into the changed-key diff exactly like typed text — assert the Save button enables in the first test: `expect((screen.getByRole('button', { name: /save inputs/i }) as HTMLButtonElement).disabled).toBe(false)`.)

- [ ] **Step 3: Gates + commit**

`npx vitest run src/components/taxes` green; `npx tsc -b`; eslint.

```bash
git add src/components/taxes/InputsForm.tsx src/components/taxes/InputsForm.test.tsx
git commit -m "feat: range paste into the tax inputs form"
```

---

### Task 7: full-suite gates + sweep

- [ ] **Step 1:** `grep -rn "entry-grid\|entry-field" src` → must be empty (the old grid CSS died in Task 4).
- [ ] **Step 2:** Full gates: `npm run test` (expect 639 + this phase's additions, green), `cd backend && .venv/Scripts/python -m pytest -q` (753 + 3), `npx tsc -b`, `npm run lint` (1 sanctioned warning), `npm run build` (EChart chunk byte-identical 700.93 kB).
- [ ] **Step 3:** Fix fallout per the display rule only; commit `fix: phase-2 gates sweep fallout` if needed.
- [ ] **Step 4:** Hand to the final whole-branch review, then ff-merge to main (user pushes).

---

## Self-review (spec §4 coverage)

- §4.1 paste — classifier + transposed + keyed-last-cell (Task 2), page fill from focused cell in scope order with raw landing + `.invalid` for garbage (Task 5, decision 2), keyed regardless of focus + unmatched reporting (Tasks 2/5), aria-live note + flash (Task 5), draft-discard as undo (decision 5, no code), tax form coverage (Task 6). Ledger row forms deliberately excluded (decision 11).
- §4.2 table — balances table with Last month/Δ + group subheaders/subtotals + component indent (Task 3), spending table with 3-mo-median Typical + Δ (Task 4), sticky live footers (Tasks 3/4), review step untouched (decision 8), narrow-viewport hiding (Task 3 CSS), matrix fetch (Task 4), net_pay null-clear rider end to end (Tasks 1 + 4).
- §6 invariants — wire stays canonical strings (belts unchanged); draft machinery untouched (state shape identical; paste writes state like typing so drafts capture pasted work automatically — a free win worth a comment in Task 5); no new bulk write paths; `aria-live` on the paste status (§6 a11y).
