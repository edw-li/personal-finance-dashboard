# Data-Entry Ergonomics Phase 3 — Ledger Ergonomics + Suggestion Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship spec §5 — ledger carry-forward/duplicate/edit/focus-return (§5.1) and computed balance suggestion chips in the wizard backed by a new `accounts.suggest_source` mapping (§5.2) — completing the data-entry ergonomics initiative.

**Architecture:** §5.1 is frontend-only (the dividends PATCH already exists server-side, unwired; focus-return uses `document.getElementById(...).focus()` — the house DOM-protocol idiom, no component changes). §5.2 adds one nullable dashboard-only column (importer-immune, the `rsu_grants` posture), one read-only endpoint that reuses the existing `allocation(by="account")` and vesting-schedule computations, chips in the wizard's balances table (the tax form's Apply pattern), and a Settings mapping card riding the long-unconsumed `updateAccount` client.

**Tech Stack:** Alembic migration (chained on `b0465b6d6ac2`), FastAPI + pytest; React 19 + vitest/RTL (fireEvent). No new dependencies.

**Branch:** `feature/data-entry-ergonomics-p3` off `main` (post-P2 `0ea74ed`).

**Execution conventions:** as Phases 1-2 (Opus implementers; parallel spec+quality reviews with hygiene rules; file-disjoint pipelining; final whole-branch review; ff-merge; user pushes). Baselines at branch start: 676 vitest / 51 files; 757 pytest; lint 1 sanctioned warning; EChart chunk byte-identical 700.93 kB (stays byte-identical — charts untouched).

---

## Locked design decisions

1. **`suggest_source` format:** nullable `String(200)`; two v1 kinds — `portfolio:<account-label>` (label = a transactions `account` text, resolved against `allocation(..., "account")` buckets) and `vesting:unvested` (the vesting schedule's unvested value). PATCH validates the shape (422 on anything else); explicit `null` clears (the tri-state `model_fields_set` precedent from spending's net_pay).
2. **Importer-immune, user-owned** — like `is_component`/`parent_account_id` ("the importer never diffs it"): the importer's account apply must never write the column; pinned by a full-tuple importer test (the `rsu_grants` pattern).
3. **Suggestions endpoint is read-only and advisory:** `GET /net-worth/suggestions` → `{ suggestions: [{account_id, source, value}], warnings: string[] }`; values quantized 2dp HALF_UP money strings; a mapped-but-unresolvable source (unknown label, no vesting data) emits a warning naming the account, never a 500 and never a silent skip.
4. **Chips render only on the ribbon's anchor month** (spec §5.2: suggestions are "now" values, wrong for backfills) — the wizard already computes `anchor`; fetch suggestions only when `month === anchor`, and degrade to no-chips on fetch failure (`.catch(() => null)`, the fetchMatrix precedent).
5. **Apply is manual, never auto** (tax-form pattern); the chip hides while the suggested value equals the box's committed text.
6. **Focus-return idiom:** `document.getElementById('<first-field-id>')?.focus()` in each save-success path — DOM protocol like `data-entry-scope`; AmountInput keeps its no-ref API. jsdom supports it (`document.activeElement` updates); tests use real `.focus()` semantics from Phase 1's lessons.
7. **Carry-forward cue:** kept fields stay filled; the submit button's label flips to `Add another` while the kept-context state is active, and a one-line `drill-hint` names what was kept. No new colors/animations.
8. **Duplicate** seeds the whole form from the row (editingId stays null → POST), focuses shares/amount.
9. **Settings card** "Balance suggestions": one row per active non-component account — name + a `<select>` (None / `Portfolio: <label>` per allocation bucket / `Unvested RSUs`); change PATCHes immediately via `updateAccount` (single-flight busy flag, error banner verbatim). Options come from `fetchAllocation('account')` + a static vesting entry.
10. **Out of scope:** BracketsEditor paste (spec §4.1 exclusion); ledger paste-block import; the visual/a11y ledger from P2's final review; any importer changes beyond the immunity pin.

---

### Task 1: backend — `accounts.suggest_source` column, schemas, PATCH, importer immunity

**Files:**
- Create: `backend/alembic/versions/<generated>_account_suggest_source.py` (via `alembic revision`, chained on `b0465b6d6ac2`)
- Modify: `backend/app/models/net_worth.py` (Account model)
- Modify: `backend/app/schemas/net_worth.py` (AccountOut, AccountUpdate)
- Modify: `backend/app/api/net_worth.py` (update_account handler)
- Test: `backend/tests/test_net_worth_api.py` (or the file owning accounts CRUD tests — grep), `backend/tests/test_importer*.py` (immunity pin)

- [ ] **Step 1: failing tests.** In the accounts API test file (follow its fixture idioms):

```python
async def test_account_suggest_source_round_trip(auth_client):
    created = (await auth_client.post(
        "/api/v1/net-worth/accounts", json={"name": "RH Taxable Acct", "group": "taxable"}
    )).json()
    assert created["suggest_source"] is None

    patched = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{created['id']}",
        json={"suggest_source": "portfolio:RH Taxable"},
    )
    assert patched.status_code == 200
    assert patched.json()["suggest_source"] == "portfolio:RH Taxable"

    cleared = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{created['id']}", json={"suggest_source": None}
    )
    assert cleared.json()["suggest_source"] is None


async def test_account_suggest_source_shape_is_validated(auth_client):
    created = (await auth_client.post(
        "/api/v1/net-worth/accounts", json={"name": "Shape Check", "group": "cash"}
    )).json()
    for bad in ["portfolio:", "prices:VOO", "vesting:vested", "portfolio"]:
        resp = await auth_client.patch(
            f"/api/v1/net-worth/accounts/{created['id']}", json={"suggest_source": bad}
        )
        assert resp.status_code == 422, bad
```

Importer immunity (in the importer test file, mirroring `test_importer_never_writes_rsu_grants`'s full-compare posture): set `suggest_source` on an account the synthetic workbook also carries, run the import twice, assert the column survives both runs verbatim.

- [ ] **Step 2: run to RED** (`.venv/Scripts/python -m pytest tests/<files> -q -k suggest`) — expect KeyError/422-mismatch failures.

- [ ] **Step 3: implement.**

Model (after `parent_account_id`):

```python
    # Where the wizard's balance suggestion for this account comes from (spec 2026-08-21
    # §5.2): "portfolio:<account-label>" or "vesting:unvested". Dashboard-only and
    # user-owned — the importer never reads or writes it (same posture as is_component).
    suggest_source: Mapped[str | None] = mapped_column(String(200), default=None)
```

Migration: `cd backend && .venv/Scripts/python -m alembic revision -m "account suggest_source"` then fill upgrade/downgrade with `op.add_column("accounts", sa.Column("suggest_source", sa.String(200), nullable=True))` / `op.drop_column(...)`; verify `down_revision = "b0465b6d6ac2"` and run `alembic upgrade head` + `alembic check` (cwd=backend).

Schemas: `AccountOut` gains `suggest_source: str | None`; `AccountUpdate` gains `suggest_source: str | None = None` plus a validator:

```python
SUGGEST_SOURCE_SHAPE = re.compile(r"^(portfolio:.+|vesting:unvested)$")

    @field_validator("suggest_source")
    @classmethod
    def suggest_source_known(cls, value: str | None) -> str | None:
        # The two shipped kinds (spec §5.2). An explicit null is the CLEAR and is
        # distinguished from omitted by model_fields_set in the handler.
        if value is None or SUGGEST_SOURCE_SHAPE.fullmatch(value):
            return value
        raise ValueError("suggest_source must be 'portfolio:<account-label>' or 'vesting:unvested'")
```

Handler (`update_account`): follow the file's existing sparse-PATCH pattern, adding the tri-state — apply the field when `"suggest_source" in body.model_fields_set` (a provided null writes None = clear).

- [ ] **Step 4: gates.** Target files green; full `pytest -q` (757 + new); `ruff check` + `format --check`; `alembic check` clean single head.

- [ ] **Step 5: commit** — `feat: accounts.suggest_source — dashboard-only suggestion mapping (migration <rev>)`.

---

### Task 2: backend — `GET /net-worth/suggestions`

**Files:**
- Modify: `backend/app/api/net_worth.py`
- Modify: `backend/app/schemas/net_worth.py` (SuggestionOut, SuggestionsOut)
- Test: the net-worth API test file

- [ ] **Step 1: failing tests** (seed via existing idioms; the portfolio side needs a security + transaction + latest price under a known account label — copy the portfolio test file's seed helpers):

```python
async def test_suggestions_resolve_portfolio_and_warn_on_unknown(auth_client, db):
    # account A mapped to a label with holdings; account B mapped to a label that has none
    ...
    resp = await auth_client.get("/api/v1/net-worth/suggestions")
    body = resp.json()
    by_id = {s["account_id"]: s for s in body["suggestions"]}
    assert by_id[a_id]["value"] == "<seeded market value, 2dp>"
    assert by_id[a_id]["source"] == "portfolio:RH Taxable"
    assert b_id not in by_id
    assert any("Ghost Label" in w for w in body["warnings"])


async def test_suggestions_empty_when_nothing_mapped(auth_client):
    resp = await auth_client.get("/api/v1/net-worth/suggestions")
    assert resp.json() == {"suggestions": [], "warnings": []}
```

(A `vesting:unvested` case: seed one RSU grant via the comp API and assert the suggestion equals the schedule's `unvested_value`; if seeding employer prices in this file is disproportionate, assert instead that an unpriceable vesting mapping lands in `warnings` — pick whichever the existing comp test helpers make cheap, and say which in the report.)

- [ ] **Step 2: RED, Step 3: implement.**

Schemas:

```python
class SuggestionOut(BaseModel):
    account_id: int
    source: str
    value: Decimal


class SuggestionsOut(BaseModel):
    suggestions: list[SuggestionOut]
    warnings: list[str]
```

Endpoint sketch (adapt imports to the codebase's real names — `load_portfolio`/`build_positions`/`allocation` live in `app.api.portfolio` + `app.services.portfolio_calc`; the vesting unvested value comes from the same computation `GET /comp/vesting-schedule` uses — import the comp router's helper the way taxes imports comp's `_employer_bars` (cross-router precedent), or lift a small pure helper if none is importable):

```python
@router.get("/suggestions", response_model=SuggestionsOut)
async def suggestions(db: AsyncSession = Depends(get_db)) -> SuggestionsOut:
    """Advisory 'now' values for mapped accounts (spec §5.2). Read-only; the wizard
    offers them as Apply chips on the anchor month only — backfills never see these."""
    mapped = [
        a for a in (await db.execute(select(Account).where(Account.is_active))).scalars()
        if a.suggest_source
    ]
    if not mapped:
        return SuggestionsOut(suggestions=[], warnings=[])
    out: list[SuggestionOut] = []
    warnings: list[str] = []
    portfolio_needed = any(a.suggest_source.startswith("portfolio:") for a in mapped)
    buckets: dict[str, Decimal] = {}
    if portfolio_needed:
        ...  # allocation(positions, securities, latest, "account") → {label: market_value}
    for account in mapped:
        kind, _, param = account.suggest_source.partition(":")
        if kind == "portfolio":
            value = buckets.get(param)
            if value is None:
                warnings.append(
                    f"{account.name}: no holdings under portfolio label '{param}'"
                )
                continue
        else:  # vesting:unvested
            value = ...  # unvested_value from the schedule computation; None → warning
            if value is None:
                warnings.append(f"{account.name}: vesting schedule has no priceable value")
                continue
        out.append(SuggestionOut(
            account_id=account.id,
            source=account.suggest_source,
            value=value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
        ))
    return SuggestionsOut(suggestions=out, warnings=warnings)
```

- [ ] **Step 4: gates** (file + full pytest + ruff + alembic check). **Step 5: commit** — `feat: GET /net-worth/suggestions — advisory balance values from portfolio/vesting`.

---

### Task 3: frontend — portfolio ledger ergonomics (transactions + dividends)

**Files:**
- Modify: `src/components/portfolio/TransactionsPanel.tsx` + `.test.tsx`
- Modify: `src/components/portfolio/DividendsPanel.tsx` + `.test.tsx`
- Modify: `src/api/portfolio.ts` (add `updateDividend`)

- [ ] TransactionsPanel: on successful CREATE (not edit), instead of `setForm(EMPTY)`: keep `security_id/account/type/txn_date`, clear `shares/price/fees/split_factor/notes`, set a `kept` flag rendering a `drill-hint` ("Security, account and date kept — enter the next lot.") and flipping the submit label to `Add another`; focus the shares AmountInput via a new stable id (`id="txn-shares"`) + `document.getElementById('txn-shares')?.focus()`. Any edit/cancel/security-change clears `kept`. Add a per-row `Duplicate` button (aria-label `Duplicate this <type>`) seeding the full form with editingId null + the same focus. TDD: pins for (a) carry-forward after add (fields kept, shares cleared, activeElement = shares box), (b) Duplicate seeds + POSTs a new row, (c) edit still resets fully.
- [ ] `updateDividend(id, body)` client (PATCH `/portfolio/dividends/${id}` — the route EXISTS server-side, unwired). DividendsPanel gains the TransactionsPanel form-swap edit pattern (editingId, startEdit from row Edit buttons, Cancel, PATCH on save) + the same carry-forward on create (keep security/account/pay_date; clear amount/notes; focus `id="div-amount"`). TDD: edit round-trip pin (PATCH body exact), carry-forward pin, delete-while-editing reset pin (copy TransactionsPanel's).
- [ ] Gates: `npx vitest run src/components/portfolio` green; tsc; eslint. Commit: `feat: ledger carry-forward + duplicate + dividends edit — the entry-session ergonomics`.

---

### Task 4: frontend — focus-return sweep (paycheck, ESPP, comp, grants)

**Files:**
- Modify: `src/pages/PaycheckPage.tsx`, `src/pages/EsppPage.tsx`, `src/pages/CompPage.tsx`, `src/components/comp/RsuGrantsPanel.tsx` + their test files

- [ ] Each panel's save-success path focuses its first entry field via getElementById (add stable ids where missing: `paycheck-effective-date`, `lot-purchase-date`, `period-label`, `comp-focal-year`, `grant-label`). One pin per panel: after a successful add, `document.activeElement` is the first field. (Paycheck already reseeds a carry-forward form — focus completes its ritual; do not change its seeding.)
- [ ] Gates: targeted files green; tsc; eslint. Commit: `feat: focus returns to the first field after every panel save`.

---

### Task 5: frontend — wizard suggestion chips

**Files:**
- Modify: `src/api/netWorth.ts` (fetchSuggestions), `src/types/api.ts` (SuggestionsOut types)
- Modify: `src/pages/MonthlyUpdatePage.tsx` + `.css` + `.test.tsx`

- [ ] Types + client: `SuggestionOut { account_id: number; source: string; value: string }`, `SuggestionsOut { suggestions: SuggestionOut[]; warnings: string[] }`; `fetchSuggestions(): Promise<SuggestionsOut>` → GET `/net-worth/suggestions`.
- [ ] Wizard: state `suggestions: Record<number, string> | null`; in the load effect, fetch ONLY when `month === anchor` — anchor is derivable pre-render from the timeseries payload already in the Promise.all; simplest compliant shape: fetch unconditionally in the Promise.all with `.catch(() => null)`, but RENDER chips only when `month === anchor` (decision 4's letter is about display; note the trade-off in a comment: one advisory GET on non-anchor months buys effect simplicity). In the balances table's This-month cell, under the AmountInput:

```tsx
{month === anchor && suggestion !== undefined && !suggestionMatches && (
  <span className="entry-suggestion">
    suggested {formatCurrency(suggestion)}
    <button type="button" className="chip"
      aria-label={`Apply suggested balance for ${account.name}`}
      onClick={() => setBalances((cur) => ({ ...cur, [account.id]: suggestion }))}>
      Apply
    </button>
  </span>
)}
```

with `suggestionMatches = canonicalAmount(value) === canonicalAmount(suggestion)` (hide-when-equal, decision 5). CSS: `.entry-suggestion { display: block; font-size: 0.72rem; color: var(--muted); margin-top: 2px; }` (chip class exists). Warnings from the payload render once above the table as a `drill-hint` (advisory).
- [ ] Tests: chip renders on the anchor month with the mocked suggestion and Apply writes the value (then the chip hides); no chip on a non-anchor month; fetch failure → no chips, wizard intact. Mock `fetchSuggestions` in the netWorth mock block; the anchor in the fixture is the current month (`currentMonthIso()`) — set the wizard URL month accordingly (the fixture's covered months make `anchor === currentMonthIso()`; assert with the existing month-fixture helpers).
- [ ] Gates: targeted file green; tsc; eslint. Commit: `feat: wizard balance suggestion chips — portfolio/vesting values on the anchor month`.

---

### Task 6: frontend — Settings "Balance suggestions" mapping card

**Files:**
- Modify: `src/pages/SettingsPage.tsx` + `.test.tsx` (+ `src/components/settings/settings.css` if needed)

- [ ] New `card span-6` section "Balance suggestions": loads `fetchAccounts()` + `fetchAllocation('account')` (existing client — verify its name in src/api/portfolio.ts) with the page's seq/busy idioms; renders active non-component accounts as rows (name + `<select>`: None / one option per allocation bucket labeled `Portfolio: <label>` with value `portfolio:<label>` / `Unvested RSUs` = `vesting:unvested`; current value preselected from `account.suggest_source`). A change PATCHes immediately via the (previously unconsumed) `updateAccount(id, { suggest_source: value || null })`, single-flight busy flag, server error sentences verbatim in a banner, success echoes into local state. A one-line hint: suggestions appear in the monthly wizard on the newest month only.
- [ ] Tests: renders options from the allocation buckets; change fires the PATCH with the exact body incl. explicit null on None; error path keeps the old selection.
- [ ] Gates: targeted file green; tsc; eslint. Commit: `feat: settings card maps accounts to balance-suggestion sources`.

---

### Task 7: gates + final review + merge

- [ ] Full gates: `npm run test`, backend `pytest -q`, tsc, lint (1 sanctioned warning), build (chunk byte-identical), `alembic check`.
- [ ] Final whole-branch review (exclusive tree); fix Critical/Important on-branch.
- [ ] ff-merge to main, delete branch; the user pushes (migration auto-applies at backend boot on deploy).

## Self-review (spec §5 coverage)

§5.1: transactions carry-forward + duplicate (T3), dividends edit + carry-forward (T3, PATCH pre-existing server-side), focus-return everywhere (T3 idiom + T4 sweep). §5.2: mapping column + validation + clear (T1), importer immunity pinned (T1), read-only suggestions endpoint with warnings (T2), anchor-month-only advisory chips with hide-when-equal Apply (T5), config surface (T6 — the spec's open item, decided: Settings card). §6 invariants: no bulk-write changes; chips write client state only (the wizard's existing save path ships them); migration additive + boot-applied.
