# Tax What-If Sandbox — Design Spec

**Date:** 2026-08-20
**Status:** Feature approved by user in chat; design details settled autonomously in-session.
**Feature branch:** `feature/tax-what-if`

## 1. Context & Goals

The golden-tested tax engine (`services/tax_service.py`) only ever recomputes stored
yearly inputs. The importer explicitly ignores the sheet's "ESPP Taxation Calculator"
block (a parity gap), and the question the user actually asks before any sale — *what
does selling this do to my taxes?* — has no answer in the app.

Goal: a computed, **nothing-stored** endpoint that takes a scenario (brokerage sale legs,
ESPP lot sales, raw input overrides) against a stored tax year and returns
baseline vs. scenario vs. delta, using the engine verbatim. Plus a What-if card on
/taxes and deep links from the portfolio holding drill-in and the ESPP lots table.

## 2. Endpoint

`POST /api/v1/taxes/what-if` (JWT). POST because the scenario is a structured body
(lists of legs) that does not fit query params — a documented departure from the ESPP
modeler's GET-with-knobs; like the modeler, **nothing is written**.

### Request (`WhatIfIn`)

```json
{
  "year": 2026,
  "sales": [
    {"security_id": 12, "shares": "50", "price": "182.5000", "term": "long"}
  ],
  "espp_sales": [
    {"lot_id": 3, "sale_price": "182.5000"}
  ],
  "overrides": {"qualified_dividends": "2500.00"}
}
```

- All three collections optional (empty scenario = baseline echoed twice, delta zeros —
  legal, harmless). Bounded: ≤ 20 sales, ≤ 20 espp_sales (typo fence).
- `sales[].price` optional → defaults to the security's latest price; 422 if neither
  exists. `sales[].term` is `'long' | 'short'`, optional → defaults `'long'`, and when the
  position has any dateless transaction the response carries a warning naming the
  assumption ("acquisition dates unknown — treated as long-term").
- `espp_sales[].sale_price` optional → defaults to the ESPP ticker's latest quote (the
  ESPP modeler's `latest_price` source); 422 when neither exists.
- `overrides` values are **absolute replacements** for stored inputs in the scenario
  (`null` = treat the key as absent/0). Unknown keys 422 (the PUT-inputs vocabulary).
  Sales apply **deltas**; overrides apply last, as replacements — so an override of a key
  a sale also touches wins, deliberately (the response's `changed_inputs` makes it
  visible).

### Validation / errors

- 404 `tax year {year} not found` (no `tax_years` row) — the sandbox models a real year.
- 404 unknown `security_id` / `lot_id`.
- 409 `lot already sold` for an `is_sold` ESPP lot.
- 422: shares ≤ 0, price ≤ 0, selling more shares than held ("selling 60.000000 NVDA —
  only 41.520000 held"), no price available, unknown override key, list bounds.
- The year may legitimately have zero brackets/inputs — the engine already answers that
  with warnings and zero taxes; the sandbox does not add its own gate.

### Response (`WhatIfOut`)

```
{
  year,
  baseline: TaxSummaryOut,          // _summary_out(compute_breakdown(stored))
  scenario: TaxSummaryOut,          // _summary_out(compute_breakdown(mutated copy))
  delta: {                          // scenario − baseline, 2dp money / 6dp rate-or-null
    total_tax, take_home,
    federal_tax, state_tax, medicare_tax, social_security_tax, disability_tax,
    capital_gains_tax,
    effective_rate                  // fraction delta; null when either side is null
  },
  changed_inputs: [                 // only keys the scenario moved, engine vocabulary
    {key, label, before, after}     // label from tax_input_definitions
  ],
  sale_details: [
    {security_id, ticker, shares, price, proceeds, cost_basis, gain, term, warnings[]}
  ],
  espp_sale_details: [
    {lot_id, purchase_date, shares, sale_price, proceeds, ordinary_income,
     capital_gain, term, disposition, warnings[]}   // disposition: qualified|disqualified
  ],
  warnings: [ ...aggregated scenario-level warnings ]
}
```

`TaxSummaryOut` and its `_summary_out` mapper are **reused from `api/taxes.py`**, not
re-derived — one quantization discipline for both endpoints.

## 3. Brokerage sale classification

- Cost basis: **average cost** — the app's only method. Folded per security across
  accounts (`load_portfolio(with_history=False, with_dividends=False)` +
  `fold_transactions`, summed over accounts): `avg = cost_basis / shares`;
  `basis = shares_sold × avg`; `gain = shares_sold × price − basis` (cents at the edges,
  full precision inside — the engine's posture).
- Oversell is a 422 (in a sandbox, an impossible sale is a typo, not a warning).
- Term: the request's word. Long → the LTCG keys; short → the STCG keys. The default is
  long with a warning whenever the position carries dateless transactions (the imported
  book), because the app cannot know the holding period.

## 4. ESPP disposition decomposition (the sheet's calculator, restored)

Inputs per lot (all stored): `purchase_date`, `qualifying_date`, `shares`,
`subscription_price`, `purchase_fmv`, `purchase_price`. `today` is read once in the
router (paycheck.py's clock posture). `total_gain = (sale_price − purchase_price) × shares`.

- **Disposition:** `qualified` when `today ≥ qualifying_date`, else `disqualified` (the
  lot's qualifying date already encodes the 2-years-from-grant / 1-year-from-purchase
  rule — the sheet computes it that way).
- **Disqualified:** `ordinary = (purchase_fmv − purchase_price) × shares` (the bargain
  element at purchase, W-2 income); `capital = (sale_price − purchase_fmv) × shares`
  (loss allowed — flows as a negative gain into the engine's netting);
  `term = long if today > purchase_date + 365 days else short`.
- **Qualified:** `ordinary = clamp(min(total_gain, shares × subscription_price × 15/85), ≥ 0)`;
  `capital = total_gain − ordinary`, always long-term. The `15/85` reconstructs the
  grant-date FMV from the subscription price (subscription = 85% of the lookback FMV);
  when the lookback picked the purchase-date FMV instead (a falling market) this
  overstates the grant FMV — every qualified leg therefore carries the warning
  "grant-date FMV approximated from the subscription price".
- **FICA note (spec-level, also a page hint):** ordinary income lands in
  `other_w2_income`, which raises the engine's Medicare/SS/SDI wage bases — the sheet's
  own structure (its ESPP component rolls into the W-2 total). Real-world ESPP ordinary
  income is FICA-exempt; the engine is sheet-faithful, and the sandbox inherits that.

## 5. Engine key mapping — the load-bearing detail

`compute_breakdown` reads the **total** keys; the component keys feed only
`gross_income` and the suggestion formulas. Every delta therefore lands on **both** the
component key and the total the engine actually consumes (exactly how the sheet's own
gray formulas roll up):

| Scenario delta | Component key (+=) | Engine total key (+=) |
|---|---|---|
| Brokerage long gain | `ltcg_brokerage` | `ltcg_total` |
| Brokerage short gain | `stcg_standard` | `stcg_total` |
| ESPP ordinary income | `w2_espp_sale_component` | `other_w2_income` |
| ESPP long capital | `ltcg_espp_component` | `ltcg_total` |
| ESPP short capital | `stcg_espp_component` | `stcg_total` |

`overrides` then replace stored values per key, after the deltas. `changed_inputs`
reports every key whose scenario value differs from its stored value (deltas and
overrides alike), with `tax_input_definitions` labels.

## 6. Service & files

- `backend/app/services/tax_whatif.py` — pure scenario math: sale classification, ESPP
  decomposition, the key-mapping table, `apply_scenario(stored_inputs, sales, espp, overrides)
  → (scenario_inputs, changed, details, warnings)`. No DB, no HTTP (tax_service's posture).
- `backend/app/api/taxes.py` — the `POST /taxes/what-if` route: loads year inputs +
  brackets (the existing summary path's queries), holdings fold, ESPP lots + quote;
  calls the service; runs `compute_breakdown` twice; maps via `_summary_out`; computes
  the delta from the two **quantized** summaries (so the delta can never contradict the
  two panels it sits between).
- Schemas in `backend/app/schemas/taxes.py`: `WhatIfIn`, `SaleLegIn`, `EsppSaleIn`,
  `WhatIfDelta`, `ChangedInput`, `SaleDetailOut`, `EsppSaleDetailOut`, `WhatIfOut`.

## 7. Frontend

- **TaxesPage — "What if" card** (new component `src/components/taxes/WhatIfPanel.tsx`),
  rendered under `SummaryPanel` for the selected year. Own feeds, own failure surface
  (SummaryPanel's posture): `fetchHoldings()` + `fetchLots()` load lazily on first
  expansion of the card (a `<details>`-style closed-by-default card — the page is
  already long).
  - Sale legs: security select (held tickers, shares prefill = full held amount, price
    prefill = latest), Long/Short segmented (default Long), add/remove rows (≤ 20).
  - ESPP legs: unsold-lot select (labelled by purchase date + shares), sale price
    prefill = quote.
  - Run → delta tiles (Δ total tax, Δ take-home, effective rate before → after) +
    per-leg details table (proceeds/basis/gain/ordinary/term/disposition) +
    `changed_inputs` list ("LTCG: Brokerage Gain/Loss 12,000.00 → 30,500.00") +
    warnings in the advisory register. Server figures verbatim; nothing recomputed.
  - Raw `overrides` get **no UI in v1** (the API supports them; the inputs form already
    edits stored values — YAGNI).
- **Deep links:** `HoldingDetailPanel` gains "Model selling in Taxes →" linking to
  `/taxes?whatif=TICKER`; the EsppPage lots table gains a per-unsold-lot "Model sale →"
  linking to `/taxes?whatif-lot={id}`. `WhatIfPanel` reads the params once on mount
  (wizard's searchParams precedent), opens itself, and prefills one leg.
- New API client module `src/api/whatif.ts`; types in `types/api.ts`.

## 8. Testing

- **pytest (`tests/test_tax_whatif.py` + api tests):** classification math per branch
  with hand-computed fixtures (disqualified gain/loss, qualified clamp at both ends of
  the min(), term boundary at exactly 365 days); dual-key mapping (component AND total
  move together); overrides win over deltas; empty scenario ⇒ baseline == scenario and
  zero deltas; oversell/sold-lot/unknown-key/no-price errors; delta arithmetic pinned
  against two independently-computed summaries; FICA movement from ESPP ordinary income
  asserted (sheet-faithful).
- **vitest:** WhatIfPanel render/add-remove legs/prefills/delta tiles verbatim/warnings
  advisory register/deep-link prefill; HoldingDetailPanel + EsppPage link presence.

## 9. Non-goals

- Nothing stored, no scenario persistence/naming (a later feature if wanted).
- No lot-level brokerage basis (the app is average-cost everywhere).
- No withholding/estimated-payment modeling (the engine models liability, not payments).
- No multi-year scenarios; one stored year per call.
- No UI for raw input overrides in v1.
