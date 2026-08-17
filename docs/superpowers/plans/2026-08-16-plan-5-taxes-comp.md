# Plan 5: Tax Engine + Taxes/ESPP/Paycheck/Comp Modules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Implementer subagents read their exact `### Task N:` section, `## Global rules`, and
> `## Workbook reference`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-08-16 (overnight run)
**Goal:** Port the sheet's full tax calculation engine (golden-tested against 2023–2026 to the
cent), and ship the four remaining data pages: `/taxes`, `/espp`, `/paycheck`, `/comp`.
**Architecture:** Pure-Decimal tax engine in `services/tax_service.py` (bracket walker +
capital-gains stacking + derived-input suggestions) fed by the already-imported
`tax_inputs`/`tax_brackets`; thin computed services for ESPP modeler/lots, paycheck waterfall,
comp deltas; four REST routers mirroring the portfolio router idioms; four React pages
following the PortfolioPage/panel conventions with the frozen ECharts theme.
**Tech stack:** FastAPI + async SQLAlchemy (existing), pydantic v2 (Decimals serialize as JSON
strings), React 19 + TS + ECharts via the in-repo `<EChart>` wrapper.
**Spec:** `docs/superpowers/specs/2026-08-12-finance-dashboard-design.md` §4 (taxes/comp data
model), §5 (taxes/espp/paycheck/comp API surface + tax_service), §6 (pages), §9 (tax-engine
golden tests = the acceptance gate). Binding forward notes: Plan 2 "Forward notes for Plans 3+
(finalized)", Plan 3 "Forward notes for Plans 4+", Plan 4 "Forward notes for Plans 5+" — each
restated below where it lands.

**Scope guard — NO SCHEMA CHANGES.** Every table this plan touches exists since Plan 1 and is
populated with real data since Plan 2. No new Alembic revision may be created; `alembic check`
must stay clean with the single head `e5b93d0a416f` throughout. (Plan 4's C1 outage lesson:
prod deploys from main continuously — the only migration-safe plan is no migration at all.)

---

## Workbook reference (verified against the real file, 2026-08-16)

Authoritative. Extracted from the live workbook (formulas via `data_only=False`, cached values
via `data_only=True`). Implementers MUST NOT open the real workbook — everything needed is
pinned here. Cell coordinates: Taxes sheet columns C/D/E/F = years 2023/2024/2025/2026.

### The sheet's computation model (Taxes rows 96–125)

`calculateTaxes(rates, thresholds, income)` is a Google Apps Script custom function; its
semantics are the standard progressive bracket walk, confirmed by reproducing four cached
outputs exactly (worked examples below). `calculateCGTaxes(rates, thresholds, ti, cg)` is the
capital-gains stacking walk: the CG amount occupies the interval `[ti, ti+cg]` of the CG
bracket space.

Let the 43 input keys be as in `app/tax_keys.py`. The sheet computes, per year:

```
fed_agi        = (latest_w2_income + other_w2_income + stcg_total + unqualified_dividends
                  + interest_total + other_income_1099)
                 − (trad_401k_contributions + hsa_contributions + hsa_contributions_employer
                    + other_pretax_deductions)                                   # r96
fed_deduction  = max(standard_deduction, itemized_deduction)                     # r43
fed_ti         = fed_agi − fed_deduction                                         # r97
fed_tax        = walk(federal_brackets, fed_ti)                                  # r98
fed_eff        = fed_tax / fed_agi                                               # r99

state_agi      = fed_agi − (unq_div_us_treasuries_etf × unq_div_state_exempt_pct)
                 + (hsa_contributions + hsa_contributions_employer)              # r100
state_ti       = state_agi − state_standard_deduction                            # r101
state_tax      = walk(state_brackets, state_ti) − state_exemption_credits        # r102
state_eff      = state_tax / state_agi                                           # r103

w2_income      = latest_w2_income + other_w2_income                              # r104
medicare_wages = w2_income − (hsa + hsa_employer + other_pretax)                 # r105
medicare_tax   = walk(medicare_brackets, medicare_wages)                         # r106
medicare_eff   = medicare_tax / w2_income                                        # r107

ss_wages       = min(medicare_wages, max_ss_threshold)                           # r109
ss_tax         = walk(ss_brackets, ss_wages)                                     # r110
ss_eff         = ss_tax / w2_income                                              # r111

sdi_taxable    = w2_income − other_pretax_deductions      # NOT hsa — CA quirk   # r113
sdi_tax        = walk(disability_brackets, sdi_taxable)                          # r114
sdi_eff        = sdi_tax / w2_income                                             # r115

cg_amount      = ltcg_total + qualified_dividends + other_capital_gains  if ltcg_total > 0
                 else (that sum) if ltcg_total < 0 and sum > 0
                 else qualified_dividends + other_capital_gains                  # r118
cg_tax         = stack(cg_brackets, fed_ti, cg_amount)                           # r119
cg_rate        = cg_tax / cg_amount   (None when cg_amount == 0; sheet #DIV/0!)  # r120

gross_income   = latest_w2_income + other_w2_income + stcg_standard
                 + unqualified_dividends + interest_total + other_income_1099
                 + ltcg_brokerage + qualified_dividends + other_capital_gains    # r121
                 # NOTE: uses the *_standard/_brokerage COMPONENTS, not the netted totals
total_income   = fed_agi   (the sheet's r122 repeats the clean r96 formula)      # r122
total_tax      = fed + state + medicare + ss + sdi + cg taxes                    # r123
take_home      = gross_income − total_tax                                        # r124
overall_eff    = total_tax / gross_income                                        # r125
```

Notes frozen from the formulas:
- `capital_loss_deductions` (r27) is **never wired into AGI** — the sheet models it as a line
  but no output formula reads it. Port faithfully (engine ignores it; suggestion still
  computed).
- Medicare/SS wages do NOT subtract trad-401k (FICA treatment) — only HSA(±employer)+dental/
  vision. SDI subtracts only dental/vision.
- The SS wage base is modeled as the bracket-2 threshold with rate 0; r109's `min()` makes the
  cap explicit. Engine: `ss_wages = min(medicare_wages, max(threshold))`, then walk — the cap
  applies only when the table has >1 row AND the top rate is 0 (the sheet's wage-base shape;
  single-row or progressive-top tables walk uncapped — tax-neutral for every real table).
- CG bracket rates 2/3 in the sheet are formulas `IF(agi > 200000, 18.8%, 15%)` /
  `IF(agi > 200000, 23.8%, 20%)` (NIIT folded in). The DB imported their cached VALUES
  (2023: .15/.20; 2024–26: .188/.238). The engine walks stored rates verbatim; the summary
  emits an advisory warning when stored rates contradict the AGI>200k rule (see Task 1).
- Negative or zero walk income → tax 0. State tax may go negative after credits (keep value,
  emit warning). Stacking clamps its base at `max(fed_ti, 0)`.

### Per-year formula drift in the sheet (canonical model = the clean shape above)

The sheet's four year-columns are NOT mutually consistent — classic hand-edited drift. The
canonical engine follows the clean model (2024's column, which also matches the sheet's own
r122 "Total Income" row in ALL four years). Each divergence is pinned to the cent:

| # | Year | Sheet's drift | Effect on sheet vs canonical |
|---|---|---|---|
| D1 | 2023 | r97 subtracts qualified_dividends + a literal 1 from fed TI (`=C96-C43-C41-1`) — qdivs were never IN its AGI | sheet fed tax LOWER by (129+1)×0.24 = **31.20** |
| D2 | 2025 | r96 adds ltcg+qdiv+ocg (1267.19) into fed AGI (`+E38+E41+E42`), contradicting its own r122; CG then double-taxed | sheet fed tax HIGHER by 1267.19×0.32 = **405.50**; state tax HIGHER by 1267.19×0.093 = **117.85** (flows via state AGI) |
| D3 | 2026 | r43 is a stale HARDCODED 15750 (2025's standard deduction), ignoring its own max(16100, 29824); r97 also subtracts F41(=0)+1 | sheet fed TI higher by 14073+1 → sheet fed tax HIGHER by **4918.93** |
| D4 | 2026 comp | Focal r5's Equity Delta % divides by (RSUs × grant price) instead of unvested equity (r3/r4 shape) | sheet 0.233260 vs canonical 0.236734 |

Precedent: Plan 3 (savings-rate / 4%-line) and Plan 4 (Unrealized column) both shipped the
principled formula and documented the sheet's self-contradictions. Golden tests must BOTH
(a) assert the canonical outputs and (b) reproduce each drifted sheet value to the cent by
applying the documented drift (proving we understand every delta — see Task 1 tests).

### Sheet cached outputs (golden reference; raw cached floats)

| Quantity (row) | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|
| Fed AGI (r96) | 117726.64 | 211776.2 | 260643.24 ⚠D2 | 280128.2067 |
| Fed TI (r97) | 103746.64 ⚠D1 | 197176.2 | 233429.958 ⚠D2 | 264377.2067 ⚠D3 |
| Fed tax (r98) | 18299.1936 ⚠D1 | 40782.884 | 51760.58656 ⚠D2 | 62079.27233 ⚠D3 |
| State AGI (r100) | 119746.282 | 215122.0164 | 263400.0787 ⚠D2 | 284428.2067 |
| State TI (r101) | 114383.282 | 209582.0164 | 257694.0787 ⚠D2 | 278722.2067 |
| State tax (r102) | 7146.495224 | 15884.45652 | 20257.18732 ⚠D2 | 22206.80322 |
| Medicare wages (r105) | 102822.4 | 231274.46 | 271576.78 | 302094.0267 |
| Medicare tax (r106) | 1490.9248 | 3634.94981 | 4582.05433 | 5299.209627 |
| SS wages (r109) | 102822.4 | 168600 | 176100 | 176100 |
| SS tax (r110) | 6374.9888 | 10453.2 | 10918.2 | 10918.2 |
| SDI taxable (r113) | 104989.08 | 235424.46 | 275876.78 | 306394.0267 |
| SDI tax (r114) | 944.90172 | 1950 | 2700 | 3000 |
| CG amount (r118) | 129 | 179.13 | 1267.19 | 0 |
| CG tax (r119) | 19.35 | 33.67644 | 238.23172 | 0 |
| Gross income (r121) | 126321.23 | 237973.17 | 287209.06 | 306694.0267 |
| Total income (r122) | 117726.64 | 211776.2 | 259376.05 | 280128.2067 |
| Total tax (r123) | 34275.85414 | 72739.16677 | 90456.25993 | 103503.4852 |
| Take-home (r124) | 92045.37586 | 165234.0032 | 196752.8001 | 203190.5415 |

### Canonical engine expected values (controller-derived; independently re-derive in Task 1)

At cents, computed from the model above on the sheet's input values (== the dev DB's imported
`tax_inputs`, which are 4dp-quantized; the only 4dp-affected input is 2026 latest_w2_income
157441.6667 whose 3.3e-5 shift is invisible at cents):

| Quantity | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|
| fed_agi | 117726.64 | 211776.20 | 259376.05 | 280128.21 |
| fed_deduction | 13850.00 | 14600.00 | 27213.28 | 29824.00 |
| fed_ti | 103876.64 | 197176.20 | 232162.77 | 250304.21 |
| fed_tax | 18330.39 | 40782.88 | 51355.09 | 57160.35 |
| state_agi | 119746.28 | 215122.02 | 262132.89 | 284428.21 |
| state_ti | 114383.28 | 209582.02 | 256426.89 | 278722.21 |
| state_tax | 7146.50 | 15884.46 | 20139.34 | 22206.80 |
| medicare_tax | 1490.92 | 3634.95 | 4582.05 | 5299.21 |
| ss_tax | 6374.99 | 10453.20 | 10918.20 | 10918.20 |
| sdi_tax | 944.90 | 1950.00 | 2700.00 | 3000.00 |
| cg_amount | 129.00 | 179.13 | 1267.19 | 0.00 |
| cg_tax | 19.35 | 33.68 | 238.23 | 0.00 |
| gross_income | 126321.23 | 237973.17 | 287209.06 | 306694.03 |
| total_tax | 34307.05 | 72739.17 | 89932.91 | 98584.56 |
| take_home | 92014.18 | 165234.00 | 197276.15 | 208109.47 |

If an implementer's engine disagrees with a cell here, they must show the walk arithmetic and
flag the controller in their report — do NOT silently adjust either side. (2024 is drift-free:
every 2024 value must equal the sheet cached value at cents.)

Worked walk examples (anchor the semantics; controller-verified against cached cells):
- Fed 2024, TI 197176.20: 11600×.10 + (47150−11600)×.12 + (100525−47150)×.22 +
  (191950−100525)×.24 + (197176.2−191950)×.32 = 1160 + 4266 + 11742.50 + 21942 + 1672.384
  = **40782.884** (== sheet r98c4).
- State 2023, TI 114383.281975: 104.12 + 285.44 + 571.00 + 907.32 + 1141.52 +
  (114383.281975−68350)×.093 = 7290.495224; − credits 144 = **7146.495224** (== r102c3).
- CG 2025 stack: base TI 233429.958 (sheet's, for the pin) or 232162.768 (canonical) — both
  land entirely inside CG bracket 2 (48351..533400) → 1267.19 × .188 = **238.23172** either way.
- Medicare 2024: 200000×.0145 + 31274.46×.0235 = 2900 + 734.94981 = **3634.94981**.

### Tax input values by year (== dev DB `tax_inputs`; fixtures for the golden tests)

Section/labels per `app/tax_keys.py`. Values as imported (4dp):

| key | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|
| annual_salary | 145000 | 151000 | 162000 | 188930 |
| gross_paycheck | 6041.6667 | 6291.6667 | 6750 | 7872.0833 |
| pay_periods | 9 | 18 | 20 | 20 |
| latest_w2_income | 54375 | 113250 | 135000 | 157441.6667 |
| other_w2_income | 50690.08 | 122474.46 | 141176.78 | 149252.36 |
| w2_stock_rsus_sold | 0 | 84029.8 | 113757.74 | 120000 |
| w2_bonuses | 25000 | 0 | 0 | 0 |
| w2_salary_checkpoint | 3845.17 | 36250.08 | 25166.68 | 27000 |
| w2_espp_sale_component | 0 | 0 | 0 | 0 |
| w2_employer_hsa | 666.68 | 2000 | 2000 | 2000 |
| w2_other | 21178.23 | 194.58 | 252.36 | 252.36 |
| stcg_total | 84 | 951.93 | 8040.08 | 0 |
| stcg_standard | 754 | 951.93 | 8040.08 | 0 |
| stcg_espp_component | 0 | 0 | 0 | 0 |
| unqualified_dividends | 286.65 | 833.46 | 1653.14 | 0 |
| unq_div_us_treasuries_etf | 152.45 | 824.55 | 1621.99 | 0 |
| unq_div_state_exempt_pct | 0.9645 | 0.9753 | 0.9514 | 0.9753 |
| unq_div_other | 134.2 | 8.91 | 31.15 | 0 |
| interest_total | 20750.5 | 24.76 | 62.87 | 0 |
| interest_standard | 82.5 | 24.76 | 62.87 | 0 |
| interest_us_treasuries | 20668 | 0 | 0 | 0 |
| other_income_1099 | 6 | 259.43 | 9 | 0 |
| trad_401k_contributions | 6222.91 | 21567.84 | 21965.82 | 21965.82 |
| hsa_contributions | 1500 | 2150 | 2300 | 2300 |
| hsa_contributions_employer | 666.68 | 2000 | 2000 | 2000 |
| capital_loss_deductions | 0 | 0 | 0 | 0 |
| other_pretax_deductions | 76 | 300 | 300 | 300 |
| pretax_dental | 76 | 228 | 228 | 228 |
| pretax_vision | 0 | 72 | 72 | 72 |
| standard_deduction | 13850 | 14600 | 15750 | 16100 |
| itemized_deduction | 7579.64 | 10016 | 27213.282 | 29824 |
| itemized_salt | 7563.64 | 17488.59 | 24141.06 | 22000 |
| itemized_donations | 0 | 0 | 3050 | 7800 |
| itemized_vehicle_reg | 16 | 16 | 16 | 16 |
| itemized_sec199a_div | 0 | 0 | 6.222 | 8 |
| itemized_other | 0 | 0 | 0 | 0 |
| state_standard_deduction | 5363 | 5540 | 5706 | 5706 |
| state_exemption_credits | 144 | 149 | 147 | 153 |
| ltcg_total | -670 | 0 | 536.38 | 0 |
| ltcg_brokerage | -670 | 0 | 536.38 | 0 |
| ltcg_espp_component | 0 | 0 | 0 | 0 |
| qualified_dividends | 129 | 179.13 | 719.81 | 0 |
| other_capital_gains | 0 | 0 | 11 | 0 |

Bracket tables: 100 rows in the dev DB, keyed (year, jurisdiction, bracket_index 1-based).
Federal 7 brackets (rates .10/.12/.22/.24/.32/.35/.37; thresholds 2023: 0/11000/44725/95375/
182100/231250/578125; 2024: 0/11600/47150/100525/191950/243725/609350; 2025==2026:
0/11925/48475/103350/197300/250525/626350). State (CA) 9 brackets (rates .01/.02/.04/.06/.08/
.093/.103/.113/.123; thresholds 2023: 0/10412/24684/38959/54081/68350/349137/418961/698271;
2024: 0/10756/25499/40245/55867/70607/360659/432787/721314; 2025==2026: 0/11079/26264/41452/
57542/72724/371479/445771/742953). Medicare 2: .0145/.0235 at 0/200000 (all years).
Social security 2: .062/0 at 0/160200 (2023), 0/168600 (2024), 0/176100 (2025, 2026).
Disability 2: .009/0 at 0/153164 (2023); .01/0 at 0/195000 (2024), 0/270000 (2025), 0/300000
(2026). Capital gains 3: 2023 0/.15/.20, 2024–26 0/.188/.238, thresholds 2023: 0/44625/492300;
2024: 0/47026/518900; 2025==2026: 0/48351/533400.

### Derived-input suggestion formulas (the sheet's gray input cells, rows 3–42)

Suggestions are computed from STORED input values of the referenced keys (sheet-faithful:
gray formulas reference cells). `s = stcg_standard + stcg_espp_component`,
`L = ltcg_total (stored)`:

```
gross_paycheck        = annual_salary / 24            # sheet hardcodes 24
latest_w2_income      = pay_periods × gross_paycheck  # stored gross_paycheck
other_w2_income       = rsus_sold + bonuses + salary_checkpoint + espp_sale_component
                        + employer_hsa + w2_other
stcg_total            = s+L if (s ≥ 0 and L < 0 and s+L ≥ 0) else (s if (s ≥ 0 and s+L ≥ 0) else 0)
unqualified_dividends = unq_div_us_treasuries_etf + unq_div_other
interest_total        = interest_standard + interest_us_treasuries
capital_loss_deductions = (L + s) if (L + s) < 0 else 0     # negative when it applies
other_pretax_deductions = pretax_dental + pretax_vision
itemized_deduction    = sum(salt, donations, vehicle_reg, sec199a, other) if salt < CAP
                        else CAP + sum(donations, vehicle_reg, sec199a, other)
                        where CAP = 40000 if year >= 2025 else 10000   # sheet hardcodes per column
ltcg_total            = ltcg_brokerage + ltcg_espp_component
```

`capital_loss_deductions` has `is_derived=False` in `tax_keys.py` while the sheet computes it —
do NOT change tax_keys/seeds (insert-only seeding; no data migration allowed). The suggestions
map is keyed by what `derive_suggestions()` returns, and the FRONTEND shows suggestion chips
based on presence in that map, not on `is_derived`.

### ESPP modeler (ESPP sheet cols B–D; per-period chained model)

White inputs per period column: semi_annual_base, additional_payments (both stored on
`espp_periods`), contribution_pct (stored), plus what-if knobs NOT stored anywhere:
current subscription_price, purchase_fmv (sheet: 170.79 / 171.0 in both columns) and the
first period's carry_forward (sheet: 0). Chain, in period_end order within one calendar year
(year = period_end.year), starting `unused_25k = 25000`, `carry = carry_param`:

```
eligible       = semi_annual_base + additional_payments               # r7
contribution   = HALF_UP2(eligible × contribution_pct)                # r9  ROUND(x, 2)
available      = contribution + carry                                 # r11
purchase_price = CEIL2(0.85 × min(subscription_price, purchase_fmv))  # r18 ROUNDUP(x, 2)
shares_calc    = FLOOR_INT(available / purchase_price)                # r19 INT()
max_shares     = FLOOR_INT(unused_25k / subscription_price)           # r20
over_limit     = shares_calc >= max_shares                            # r21
shares         = min(shares_calc, max_shares)                         # r22
cost           = CEIL2(shares × purchase_price)                       # r23
carry_next     = 0 if over_limit else available − cost                # r24
refund         = available − cost if over_limit else 0                # r25
value_25k      = HALF_UP2(shares × subscription_price)                # r27
unused_next    = unused_25k − value_25k                               # r15 chain
```

Year totals: `total_25k_value = Σ value_25k` (r28), `out_of_pocket_cost = Σ cost` (r30),
`fmv_of_shares = (Σ shares) × LAST period's purchase_fmv` (r31 — uses the last column's FMV;
faithful quirk). Golden (sheet values: sub 170.79 / fmv 171.0 / carry 0 on the two real
periods — Feb: base 81000 add 0 pct 0.14; Aug: base 94465 add 0 pct 0.11):
Feb: eligible 81000, contribution 11340.00, available 11340.00, purchase_price 145.18
(0.85×170.79 = 145.1715 → CEIL2), shares_calc 78, unused 25000, max_shares 146, NOT over,
shares 78, cost 11324.04, carry_next 15.96, refund 0, value_25k 13321.62.
Aug: contribution 10391.15 (94465×.11 = 10391.15), available 10407.11, unused 11678.38,
max_shares 68, shares_calc 71, OVER limit, shares 68, cost 9872.24, refund 534.87,
carry_next 0, value_25k 11613.72. Totals: 24935.34 / 21196.28 / (146×171) 24966.00.
Rounding helpers: HALF_UP2 = quantize(0.01, ROUND_HALF_UP); CEIL2 = quantize(0.01,
ROUND_CEILING); FLOOR_INT = int(x.to_integral_value(ROUND_FLOOR)). (Sheet values are all
positive; negative-input behavior is guarded out at the API.)

### ESPP lots (sheet cols I–P)

Stored per lot (4 real lots; all: subscription 48.509, purchase_price 41.23265 = 0.85 ×
min(sub, fmv) UNROUNDED at 5dp — note the modeler's CEIL2 does NOT apply to the lots table).
Computed per lot: `cost_basis = HALF_UP2(shares × purchase_price)` (lot 1: 260 × 41.23265 =
10720.489 → 10720.49), `market_value = HALF_UP2(shares × current_price)`, `gain_amount =
market_value − cost_basis`, `gain_pct = (current_price − purchase_price) / purchase_price`
(r16 shape, quantize 6dp), where current_price = the espp ticker's latest price (app_settings
`espp_ticker` = "NVDA" → securities → latest_prices; the soft link can dangle — computed
fields become null, page renders gracefully). Disposition: reference_date = sold_date or
today; `qualified = reference_date >= qualifying_date`; `days_until_qualified =
max(0, qualifying_date − today).days` for unsold lots, null for sold. Sold lots use sold_price
for market_value/gain (realized). Lots: (2024-02-29, q 2025-09-01, 260 sh, fmv 79.112),
(2024-08-30, q 2025-09-01, 255 sh, fmv 119.37), (2025-02-28, q 2026-02-28, 274 sh, fmv 124.8),
(2025-08-29, q 2026-08-29, 241 sh, fmv 174.18). None sold.

### Paycheck Modeler (per-check waterfall; sheet left block)

```
gross       = annual_salary / pay_periods_per_year        # sheet: /24
trad_401k   = trad_401k_pct × gross
taxable     = gross − (trad_401k + dental_vision_per_check + hsa_per_check)
withholding = withholding_pct × taxable
post_tax    = taxable − withholding
roth_401k   = roth_401k_pct × gross
after_tax   = after_tax_401k_pct × gross
espp        = espp_pct × gross
net_pay     = post_tax − (roth_401k + after_tax + espp)
monthly_net = net_pay × pay_periods_per_year / 12         # sheet: ×2 at 24 periods
```

Full precision internally; quantize each line HALF_UP 2dp at output only (displayed lines may
disagree with displayed net by a cent — net is authoritative). Golden (the real profile:
salary 188930, 24 pp, trad .13, roth 0, at .03, espp .11, withholding 0.334009167 [9dp],
d&v 12.50, hsa 100): gross 7872.08, trad_401k 1023.37, taxable 6736.21, withholding 2249.96,
post_tax 4486.26, roth 0.00, after_tax 236.16, espp 865.93, net 3384.16, monthly 6768.33
(sheet full-precision: net 3384.164109, monthly 6768.328218 — 9dp pct shift ≈ 1.6e-6,
invisible at cents). The sheet's right-hand "Percentages"/"Monthly Budget" blocks depend on
the budget table and are OUT of Plan 5 scope (spec §6 lists only profile form + waterfall +
history) — sanctioned deviation, record in forward notes.

### Focal History computed columns

```
base_delta       = new_base − current_base          (null when new_base is null)
base_delta_pct   = base_delta / current_base        (null likewise; 6dp)
unvested_equity  = unvested_rsus × unvested_price   (null when either is null)
equity_delta     = refresh_rsus × grant_price       (null when either is null)
equity_delta_pct = equity_delta / unvested_equity   (null when either side null/0; 6dp)
tc_before        = current_base + (unvested_equity or 0)
tc_after         = (new_base or current_base) + (unvested_equity or 0) + (equity_delta or 0)
```

`tc_before/tc_after` are the Plan-5 interpretation of spec §4's "TC before/after" (the sheet
has no TC column): total comp proxy = base + unvested equity value; the UI labels it
"Base + unvested equity". Canonical equity_delta_pct = delta/unvested_equity (the sheet's
r3/r4 shape; r5 drifted — D4 above). Expected rows (DB prices are 4dp-quantized:
129.5651, 183.2508):

| focal_year | base_delta | pct | unvested_equity | equity_delta | eq_pct | tc_before | tc_after |
|---|---|---|---|---|---|---|---|
| 2024 | 6000.00 | 0.041379 | 224150.00 | 35928.00 | 0.160286 | 369150.00 | 411078.00 |
| 2025 | 11000.00 | 0.072848 | 278824.10 | 65054.18 | 0.233316 | 429824.10 | 505878.28 |
| 2026 | 26930.00 | 0.166235 | 333882.96 | 79041.50 | 0.236734 ⚠D4 | 495882.96 | 601854.46 |
| 2027 | null | null | null | null | null | 188930.00 | 188930.00 |

Reconciliation tolerance vs sheet cached: unvested_equity ±0.15 (4dp price × ~2000 shares),
pcts ±0.000002, deltas exact.

---

## Global rules (bind every task)

1. **All subagents run on Opus 5** (user mandate, tonight extended to reviewers).
2. **No schema changes, no new migrations, no seed/tax_keys edits.** `alembic check` stays
   clean; head stays `e5b93d0a416f`. If a task seems to need a column — STOP and report.
3. **Decimal discipline:** engine and services are pure-Decimal (`Decimal(str(x))` only in
   tests when converting literals; never float arithmetic). Output quantums: money 2dp
   HALF_UP; input values (tax_inputs) 4dp; rates 4dp; percentages/effective rates 6dp via
   `quantize_pct`; ESPP lot prices 5dp; shares/RSUs 4dp. Reuse
   `app/services/money.py` (quantize_money / quantize_pct / require_reasonable_date and the
   422 vocabulary) — do NOT mint new validation phrasing where money.py has one. Numeric
   bounds BEFORE insert per money.py `_quantize_bounded` (tax_inputs Numeric(14,4) →
   max_abs 10^10; comp/paycheck money Numeric(12,2) → 10^10; espp money per model scales).
4. **pydantic v2 serializes Decimal as JSON strings** — frontend money/pct types are strings.
5. **API idioms mirror `app/api/portfolio.py`:** APIRouter(prefix, tags), `Depends(get_db)` +
   `get_current_user`, 404 detail strings, 409 on natural-key conflicts, 422 via money.py,
   response_model schemas in `app/schemas/<module>.py`, output-side literal quantizes.
   PATCH uses `extra="ignore"` semantics consistent with existing panels (200 ≠ field
   changed). Full-replace PUT semantics where specified. No new dependencies.
6. **Tests:** pytest, `-W error` clean; suites follow `backend/tests/test_portfolio_api.py`
   fixtures (client + db, shared-session contract: seed ORM objects at COLUMN SCALE — e.g.
   `Decimal("48.50900")` for (14,5) — or wire strings come out unquantized). Engine tests are
   pure (no DB). Frontend: vitest ^3, RTL with explicit `cleanup()`, `vi.mock('../EChart')`
   (never render echarts in jsdom), option builders exported as pure functions and tested
   directly, api modules mocked per test.
7. **React laws (react-hooks 7):** no setState in an effect's synchronous body — page loads
   use the beginLoad promise-callback pattern with flips in callbacks; watch
   `preserve-manual-memoization` (inline load chains in effects rather than useCallback in
   many-setter components); stale-response races guarded by the seqRef recipe (see
   NetWorthPage/PortfolioPage). Reduced-motion users: charts already handle via theme/wrapper.
   a11y: aria-pressed on toggle buttons, keyboard operability for row actions.
8. **Charts:** frozen palette + dark theme in `src/charts/theme.ts` — do NOT touch theme.ts or
   derive new colors; ≤3-hue + "Other" folding conventions; `src/charts/echarts.ts` registers
   components — add only what a new chart type needs (BarChart/LineChart already registered;
   check before adding). Bundle will grow; code-splitting remains Plan 6 (note final size).
9. **Money rendering:** reuse `src/utils/format.ts` (formatCurrency/formatPct/…); render
   backend-computed values, never re-derive (Plan 4 lesson: totals.unrealized_gl class).
10. **Commits:** conventional prefixes, one per task plus fix commits; `git add` ONLY the
    files you created/modified (NEVER `git add -A` — the worktree contains .venv and
    node_modules); `git commit -q -m`. NEVER push. Never run `git checkout`/`switch`/`merge`.
11. **Gates per task (run from the WORKTREE root; cwd persists):**
    - `backend/.venv/Scripts/python.exe -m pytest backend/tests -q -W error` (or `cd backend`
      variants used by prior plans: `cd` once, then relative — stay consistent with how the
      session started; the venv answers from the worktree either way)
    - `backend/.venv/Scripts/python.exe -m ruff check backend` and
      `backend/.venv/Scripts/python.exe -m ruff format --check backend`
    - `npm test`, `npm run lint`, `npm run build` (frontend tasks; lint carries exactly ONE
      sanctioned pre-existing warning)
    - `backend/.venv/Scripts/python.exe -m alembic check` from `backend/` — single head
      e5b93d0a416f, no diffs (run via `cd backend && ...` is NOT needed: alembic.ini lives in
      backend/, so run `backend/.venv/Scripts/python.exe -m alembic -c backend/alembic.ini
      check` if cwd is the worktree root; prior plans ran it with cwd=backend — either is fine
      as long as it PASSES)
    Format-wins rule: AST-identical ruff rewraps of plan-shown code are sanctioned.
12. **Privacy:** the real workbook path/file never appears in committed code, fixtures, or
    reports. The pinned values in this doc ARE sanctioned for golden fixtures (spec §9
    mandates sheet-exact tax fixtures; private repo — same posture as Plans 2–4 docs).
    No financial values in log statements.
13. **Dev DB is REAL DATA** (loopback 5433, `finance`): tasks never write to it. Only Task 10
    (controller-supervised) touches it, read-only. Test DB `finance_test` is rebuilt by
    conftest per run.
14. **The suggestions/derived-input contract:** stored values are authoritative for the
    engine; suggestions are advisory (UI chips). Never auto-apply a suggestion server-side.

---

## File structure

```
backend/app/services/tax_service.py     # walk/stack + compute_breakdown + derive_suggestions
backend/app/services/espp_calc.py       # modeler chain + lot computed fields (pure)
backend/app/services/paycheck_calc.py   # waterfall (pure)
backend/app/services/comp_calc.py       # focal computed fields (pure)
backend/app/schemas/taxes.py            # TaxYearOut, TaxInputsOut, BracketsOut/In, TaxSummaryOut...
backend/app/schemas/espp.py             # LotOut/In, PeriodOut/In, ModelerOut...
backend/app/schemas/paycheck.py         # ProfileOut/In, BreakdownOut
backend/app/schemas/comp.py             # CompEventOut/In (computed fields inline)
backend/app/api/taxes.py                # /api/v1/taxes/*
backend/app/api/espp.py                 # /api/v1/espp/*
backend/app/api/paycheck.py             # /api/v1/paycheck/*
backend/app/api/comp.py                 # /api/v1/comp/*
backend/app/main.py                     # register 4 routers (modify)
backend/tests/test_tax_service.py       # engine goldens + drift pins + edges
backend/tests/test_taxes_api.py
backend/tests/test_espp_calc.py
backend/tests/test_espp_api.py
backend/tests/test_paycheck_comp_api.py # paycheck_calc/comp_calc unit + both routers
src/types/api.ts                        # add tax/espp/paycheck/comp wire types (modify)
src/api/taxes.ts / espp.ts / paycheck.ts / comp.ts
src/pages/TaxesPage.tsx / TaxesPage.css
src/components/taxes/InputsForm.tsx     # sectioned inputs + suggestion chips
src/components/taxes/BracketsEditor.tsx
src/components/taxes/SummaryPanel.tsx   # waterfall + trends
src/components/taxes/taxChartOptions.ts # pure option builders
src/components/taxes/taxes.css
src/pages/EsppPage.tsx / EsppPage.css   # lots table + modeler card
src/pages/PaycheckPage.tsx / PaycheckPage.css
src/pages/CompPage.tsx / CompPage.css
src/components/comp/compChartOptions.ts # TC trajectory builder (pure)
src/App.tsx                             # swap 4 placeholders (modify)
+ vitest files colocated: TaxesPage.test.tsx, InputsForm.test.tsx, BracketsEditor.test.tsx,
  taxChartOptions.test.ts, EsppPage.test.tsx, PaycheckPage.test.tsx, CompPage.test.tsx,
  compChartOptions.test.ts
```

---

## Expected suite growth

Baselines in this worktree at branch point: backend 284 pytest `-W error`, frontend 52 vitest,
lint 1 sanctioned warning. Every task leaves ALL gates green.

---

### Task 1: Tax engine (`tax_service.py`) — walkers, breakdown, suggestions [TDD]

**Files:** Create `backend/app/services/tax_service.py`, `backend/tests/test_tax_service.py`.

Pure module: no DB, no FastAPI imports. Public surface:

```python
JURISDICTION_WARN_MISSING = "no {j} brackets for {year}: {j} tax computed as 0"

def walk(brackets: list[tuple[Decimal, Decimal]], income: Decimal) -> Decimal:
    """Progressive bracket walk. brackets = [(rate, threshold)...] sorted by threshold asc,
    thresholds[0] == 0. income <= 0 -> 0. Full precision (no quantize)."""

def stack(brackets: list[tuple[Decimal, Decimal]], base: Decimal, amount: Decimal) -> Decimal:
    """Capital-gains stacking: tax the interval [max(base,0), max(base,0)+amount] through
    the CG brackets. amount <= 0 -> 0."""

@dataclass
class JurisdictionResult:  # agi/wages naming per section; keep one dataclass with
    ...                    # optional fields, or one per family — implementer's choice,
                           # but the FIELD NAMES in TaxBreakdown below are binding.

@dataclass
class TaxBreakdown:
    year: int
    federal: ...      # agi, taxable_income, tax, effective_rate
    state: ...        # agi, taxable_income, tax, effective_rate
    medicare: ...     # w2_income, taxable_wages, tax, effective_rate
    social_security:  # w2_income, taxable_wages, tax, effective_rate
    disability: ...   # w2_income, taxable_wages, tax, effective_rate
    capital_gains: .. # taxable_income, gains_amount, tax, effective_rate (None when gains==0)
    totals: ...       # gross_income, total_income, total_tax, take_home, effective_rate
    warnings: list[str]

def compute_breakdown(year: int, inputs: dict[str, Decimal],
                      brackets: dict[str, list[tuple[Decimal, Decimal]]]) -> TaxBreakdown:
    """Canonical model from the Workbook reference. Missing input keys default to 0 and are
    listed once in warnings ('missing inputs defaulted to 0: k1, k2 …' — only keys from
    tax_keys). Missing jurisdiction -> that tax 0 + warning. Effective rates: None when the
    denominator is 0, else quantize_pct-style 6dp is applied at the SCHEMA layer, not here —
    the dataclass carries full precision."""

def derive_suggestions(year: int, inputs: dict[str, Decimal]) -> dict[str, Decimal]:
    """The 10 suggestion formulas (Workbook reference), quantized 4dp HALF_UP. Always
    returns all 10 keys; referenced inputs missing from the dict default to 0, like the
    engine (sheet-faithful: empty cells are 0)."""

def niit_advisory(fed_agi: Decimal, cg_brackets: list[tuple[Decimal, Decimal]]) -> str | None:
    """Sheet models bracket-2/3 CG rates as IF(agi>200000, .188/.238, .15/.20). Return a
    warning string when stored rates contradict the rule for this AGI, else None. Called by
    compute_breakdown; tolerate <3 brackets (no advisory)."""
```

State tax may be negative after exemption credits → keep the value, append warning
`"state tax negative after exemption credits"`. Take-home/total per Workbook reference.

- [ ] **Step 1: failing tests first** — write `test_tax_service.py`:
  - `test_walk_2024_federal` — the worked example: expect Decimal("40782.884") exactly.
  - `test_walk_income_below_first_threshold`, `test_walk_zero_and_negative_income` (0),
    `test_walk_income_inside_first_bracket`, `test_walk_exactly_on_threshold` (boundary owned
    by the higher bracket start: tax(11600) = 1160 for 2024 federal).
  - `test_stack_within_single_bracket` (CG 2025 pin: base 233429.958 → 238.23172 — the D2 pin
    uses the sheet TI on purpose), `test_stack_spans_brackets` (synthetic: base 40000,
    amount 20000, 2023 CG table → 4625×0 + 15375×.15 = 2306.25), `test_stack_negative_base_clamps`
    (base −5000, amount 1000, 2023 CG → 0 rate bracket → 0), `test_stack_zero_amount` (0).
  - **Golden tests, one per year** (`test_golden_2023` … `test_golden_2026`): inputs = the
    pinned table (module-level `YEAR_INPUTS: dict[int, dict[str, Decimal]]` fixture built from
    string literals), brackets = pinned tables (`YEAR_BRACKETS`). Assert every canonical row
    of the "Canonical engine expected values" table at cents:
    `breakdown.federal.tax.quantize(Decimal("0.01"), ROUND_HALF_UP) == Decimal("18330.39")` etc.
    2024 asserts equality with the SHEET values (drift-free year).
  - **Drift-pin tests** (prove D1–D3 to the cent):
    - `test_sheet_drift_2023_qdiv_minus_one`: `walk(fed_2023, fed_agi_2023 − ded −
      Decimal("129") − 1)` == Decimal("18299.1936").
    - `test_sheet_drift_2025_cg_in_agi`: rebuild with agi+1267.19: fed tax == 51760.58656
      (walk over 233429.958); state over (state_agi+1267.19): walk − 147 == 20257.18732
      (allow ≤ Decimal("0.0001") for float-repr of the cached cell: assert
      abs(x − Decimal("20257.18732")) < Decimal("0.001")).
    - `test_sheet_drift_2026_stale_deduction`: walk(fed_2026, agi_2026 − Decimal("15750") − 1)
      == pinned 62079.27 at cents (cached 62079.27233; assert abs diff < 0.001).
  - Suggestions: `test_suggestions_match_stored_2025` — derive_suggestions on the 2025 inputs
    returns values equal (4dp) to the stored derived keys (gross_paycheck 6750, latest_w2
    135000, other_w2 141176.78, stcg_total 8040.08, unq_div 1653.14, interest 62.87,
    cap_loss 0, other_pretax 300, itemized 27213.282, ltcg 536.38);
    `test_suggestion_salt_cap_2024_vs_2025` (salt 17488.59 → 2024 cap 10000: 10016;
    2025 formula with the same items under the 40000 cap: 17504.59 — the 2024 non-salt
    items sum to exactly 16);
    `test_suggestion_stcg_netting_branches` (3 branches + the 0 fallthrough),
    `test_suggestion_capital_loss_negative` (L=-5000, s=1000 → -4000).
  - Warnings: `test_missing_inputs_warning`, `test_missing_jurisdiction_zero_and_warning`
    (drop "disability" → sdi tax 0 + warning), `test_negative_state_tax_warning`
    (credits 10^6), `test_niit_advisory_flags_mismatch` (agi 250000 with .15/.20 rates →
    warning; agi 150000 with .15/.20 → None; agi 250000 with .188/.238 → None).
- [ ] **Step 2:** run the new file only: `backend/.venv/Scripts/python.exe -m pytest
  backend/tests/test_tax_service.py -q` — expect import errors/failures.
- [ ] **Step 3:** implement `tax_service.py` until green. If any golden disagrees with the
  canonical table, STOP, show the walk arithmetic in your report, and defer to the controller.
- [ ] **Step 4:** full gates (pytest -W error whole suite, ruff check, ruff format --check).
- [ ] **Step 5:** commit `feat: tax engine with golden tests vs sheet 2023-2026`.

### Task 2: Taxes API — inputs/brackets/summary/clone [TDD]

**Files:** Create `backend/app/schemas/taxes.py`, `backend/app/api/taxes.py`,
`backend/tests/test_taxes_api.py`. Modify `backend/app/main.py` (register router),
`backend/app/schemas/__init__.py` if the package re-exports (follow the existing pattern).

Router prefix `/taxes`, all auth-required. `{year}`/`{source_year}` path params carry
`Path(ge=1900, le=2100)` on EVERY route (int4 overflow on a raw GET would otherwise 500;
out-of-bounds years 422 instead of 404 — no legal year is excluded). Endpoints (spec §5):

- `GET /taxes/years` → `[{year, notes, input_count, bracket_count}]` ordered asc.
- `GET /taxes/years/{year}/inputs` → `{year, sections: [{section, items: [{key, label,
  sort_order, is_derived, value, suggested}]}]}` — sections in tax_keys.SECTIONS order, items
  by sort_order; `value` null when no row; `suggested` from derive_suggestions (null when
  absent from the map). 404 when the tax_years row doesn't exist.
- `PUT /taxes/years/{year}/inputs` body `{values: {key: str|number|null}}` → bulk upsert:
  unknown key → 422 listing it; null deletes the row; values quantized 4dp with bound 10^10
  via a `_quantize_bounded`-style call (money.py: use `quantize_price(v, f"values.{key}",
  max_abs=Decimal(10)**10)` — the 4dp quantum matches). AUTO-CREATES the tax_years row when
  missing (year must satisfy 1900 ≤ year ≤ 2100 → else 422). Response = the GET shape.
  Partial: keys not in the body are untouched.
- `GET /taxes/years/{year}/brackets` → `{year, jurisdictions: {federal: [{bracket_index,
  rate, threshold}...], state: [...], medicare: [...], social_security: [...],
  disability: [...], capital_gains: [...]}}` (all six keys always present, possibly empty
  lists; ordered by bracket_index). 404 on missing year.
- `PUT /taxes/years/{year}/brackets` body `{jurisdictions: {<name>: [{rate, threshold}...]}}`
  → per-jurisdiction FULL REPLACE (delete + insert, bracket_index = 1-based array order);
  jurisdictions absent from the body are untouched. Validation per jurisdiction: 1..12 rows;
  thresholds[0] == 0, strictly ascending; rate 0 ≤ r ≤ 1 (the Plan-1 mis-scale guard: a 37.43
  meant as 37.43% must 422), quantized 4dp; thresholds quantized 2dp, bound 10^10. Unknown
  jurisdiction name → 422. Auto-creates the year row like PUT inputs. Response = GET shape.
- `POST /taxes/years/{year}/clone-brackets-from/{source_year}` → 404 if source has no
  brackets; 409 if target already has ANY brackets; creates target year row if missing
  (bounds-checked); copies all six jurisdictions verbatim. Response = GET brackets shape.
- `GET /taxes/years/{year}/summary` → TaxSummaryOut: the TaxBreakdown serialized — money
  fields quantized 2dp, effective rates 6dp (`quantize_pct`), `capital_gains.effective_rate`
  null when gains == 0; plus `warnings: [str]`. Loads inputs + brackets for the year (404 when
  year row missing). SERIALIZATION GUARDS (Task 1 quality review I3 — engine outputs are
  UNBOUNDED; API-legal inputs can produce ~10^20 money values and ~10^24 rates): money fields
  use plain `.quantize(Decimal("0.01"), ROUND_HALF_UP)` (NEVER money.py's bounded
  quantize_money — a GET must not 422/500 on stored data); effective rates use quantize_pct
  ONLY when `rate.copy_abs() < Decimal("1e12")`, else serialize null and append warning
  `"<jurisdiction> effective rate out of range"`. One test seeds absurd-but-bound-legal
  inputs (e.g. unq_div_us_treasuries_etf 9999999999.9999 × unq_div_state_exempt_pct
  -9999999999.9999) and asserts the summary returns 200 with nulled rates + warning.
- `GET /taxes/summary` → `{years: [TaxSummaryOut...]}` for every tax_years row having ≥1
  input, ordered asc (trend feed).

Re-import interplay (Plan 2 note, restate in code comment on the PUT handlers): taxes
re-import is sheet-wins within imported years — UI edits to 2023–2026 are clobbered by a
future re-import; cutover order documented, not guarded.

- [ ] **Step 1: failing tests** in `test_taxes_api.py` (client+db fixtures; seed via ORM at
  column scale — TaxYear/TaxInputDefinition rows must be inserted before TaxInput because the
  test DB starts empty; seed definitions from `TAX_INPUT_DEFINITIONS` in a helper):
  - years list empty → `[]`; after seeding 2024 with 2 inputs → counts correct.
  - GET inputs 404 on missing year; GET returns all 43 definition rows with null values when
    unset; values echo at 4dp strings; suggested present for derived-able keys (seed the 2025
    pinned inputs and assert suggested == stored for gross_paycheck and itemized_deduction).
  - PUT inputs: creates year row (1900-bound: year 1800 → 422); upserts + deletes via null;
    unknown key 422; |value| ≥ 10^10 → 422; non-numeric string → 422 (pydantic);
    re-GET reflects.
  - GET/PUT brackets: full-replace semantics (PUT federal only → state untouched); rate 37.43
    → 422; thresholds not ascending → 422; thresholds[0] != 0 → 422; 13 rows → 422; unknown
    jurisdiction → 422; empty list for a jurisdiction in the body → deletes all its rows
    (legal: full replace with []).
  - clone: happy path copies 6×N rows; 409 when target non-empty; 404 when source empty.
  - summary: seed the FULL pinned 2024 inputs + brackets via the API (PUT inputs + PUT
    brackets), GET summary → assert `federal.tax == "40782.88"`, `state.tax == "15884.46"`,
    `totals.total_tax == "72739.17"`, `totals.take_home == "165234.00"`,
    `capital_gains.effective_rate == "0.188000"`; warnings empty.
  - summary 404 on missing year; all-years summary skips input-less years.
  - auth: one unauthenticated 401 spot-check per router (existing house pattern).
- [ ] **Step 2:** run the suite file → failures. **Step 3:** implement schemas/router,
  register in main.py. **Step 4:** full gates. **Step 5:** commit
  `feat: taxes API (inputs, brackets, clone, computed summaries)`.

### Task 3: ESPP service + API [TDD]

**Files:** Create `backend/app/services/espp_calc.py`, `backend/app/schemas/espp.py`,
`backend/app/api/espp.py`, `backend/tests/test_espp_calc.py`, `backend/tests/test_espp_api.py`.
Modify `backend/app/main.py`.

`espp_calc.py` (pure): the rounding helpers (HALF_UP2/CEIL2/FLOOR_INT), `PeriodInputs` /
`PeriodResult` dataclasses, `run_modeler(periods: list[PeriodInputs], subscription_price,
purchase_fmv, carry_forward) -> ModelerResult` implementing the chained model (periods
pre-sorted by period_end; chain unused_25k/carry; year totals incl. the last-period-FMV
quirk), and `lot_metrics(lot, current_price: Decimal | None, today: date) -> dict` (cost_basis,
market_value, gain_amount, gain_pct, qualified, days_until_qualified, is_sold — sold lots use
sold_price and ignore current_price; unpriced+unsold → nulls for market fields).

Router `/espp`:
- `GET /espp/lots` → `{espp_ticker, current_price, quoted_at, lots: [LotOut...]}` ordered by
  purchase_date; LotOut = stored fields + computed metrics (today = `date.today()`).
  current_price: app_settings espp_ticker (envelope `{"value": ...}`) → securities by ticker →
  latest_prices; ALL of ticker-missing / security-missing / price-missing degrade to null
  (dangling soft link — Plan 1 note).
- `POST /espp/lots` LotIn: purchase_date (unique → 409), qualifying_date ≥ purchase_date,
  shares > 0 (quantize 4dp), subscription_price/purchase_fmv > 0 (5dp), purchase_price
  optional → default `quantize5(Decimal("0.85") × min(sub, fmv))` (NO ceil — lots-table
  shape), sold_date/sold_price both-or-neither (409? no — 422), sold_date ≥ purchase_date,
  sold_price > 0, all dates `require_reasonable_date`, notes optional.
- `PATCH /espp/lots/{id}` partial; same validations on present fields; cross-field rules
  validated against the MERGED row (Plan 4 house law); clearing a sold pair: explicit nulls
  for both (one null + one value → 422). 404 unknown id.
- `DELETE /espp/lots/{id}` → 204.
- `GET /espp/periods` → ordered by period_end. `POST/PATCH/DELETE /espp/periods[/{id}]`:
  label required non-empty ≤60 (unique → 409), period_end > period_start, base ≥ 0,
  additional ≥ 0 (2dp), contribution_pct 0 ≤ p ≤ 1 (quantize 9dp — Numeric(10,9)).
- `GET /espp/modeler?subscription_price=&purchase_fmv=&carry_forward=&year=` →
  computes over the periods whose period_end.year == year (default: the latest year having
  periods; 404 "no espp periods" when none). Param defaults: subscription_price/purchase_fmv
  ← the espp ticker's latest price (422 `"no live price for <ticker>; pass
  subscription_price and purchase_fmv"` when unavailable and not provided); carry_forward
  default 0, must be ≥ 0; prices must be > 0. Response: `{year, espp_ticker, price_source:
  "params"|"latest_price", subscription_price, purchase_fmv, carry_forward, periods:
  [{id, label, period_start, period_end, semi_annual_base, additional_payments,
  contribution_pct, eligible_earnings, contribution, available, purchase_price,
  shares_before_limit, unused_25k, max_shares_25k, over_limit, shares, cost, carry_forward_out,
  refund, value_25k}], totals: {total_25k_value, out_of_pocket_cost, fmv_of_shares,
  remaining_25k}}` — remaining_25k = 25000 − total_25k_value (for the gauge).

- [ ] **Step 1: failing calc tests** (`test_espp_calc.py`): the two-period golden from the
  Workbook reference asserting EVERY intermediate (both periods); single-period chain;
  three-period chain (synthetic: verify unused_25k decrements by value_25k cumulatively);
  over-limit branch flips refund/carry correctly; rounding pins: CEIL2(145.1715) == 145.18,
  CEIL2 on an exact cent stays put (CEIL2(145.18) == 145.18), FLOOR_INT(78.999) == 78;
  lot_metrics: cost_basis 10720.49 pin, qualified boundary (today == qualifying_date →
  qualified, days 0), unsold+unpriced nulls, sold lot uses sold_price and days null.
- [ ] **Step 2: failing API tests** (`test_espp_api.py`): lots CRUD happy paths + every 422/
  409 rule above + purchase_price default pin (post sub 48.509 fmv 79.112 → "41.23265");
  periods CRUD + rules; modeler: seed the two real periods + explicit params 170.79/171/0 →
  assert the golden numbers (shares "78"/"68", refund "534.87", totals "24935.34"/"21196.28"/
  "24966.00", remaining "64.66"); param defaulting: seed NVDA security + latest price at
  column scale → price_source "latest_price"; no price + no params → 422; year param
  selects; empty periods → 404; auth 401 spot-check.
Ratified implementer decisions (wire-visible): modeler share counts serialize as Decimal
STRINGS ("78" not 78) — Task 5/8 type them as strings; `PATCH /espp/lots` with
`purchase_price: null` RE-DERIVES the 85% default from the merged sub/fmv pair (useful
divergence from the explicit-null-is-no-op convention; test-pinned); `price_source` is
"params" only when BOTH prices came from the query; `?year=` with no periods → 404.
Quality-review ratifications: Numeric(10,9) fields serialize via a plain-format
`PlainSerializer` (`format(v, "f")`) so `0` never reaches the wire as `"0E-9"` — the SAME
pattern is MANDATORY for Task 4's five paycheck 9dp fields; modeler param bound is 10^10
(matches the latest_prices Numeric(14,4) source, so a stored quote can never 422 a
no-param GET); `ModelerOut` additionally carries `quoted_at` (null when price_source is
"params") for Task 8's provenance line; `price_source` typed as a Literal.

- [ ] **Step 3:** implement to green. **Step 4:** full gates. **Step 5:** commit
  `feat: ESPP lots/periods API + chained 25k modeler`.

### Task 4: Paycheck + Comp APIs [TDD]

**Files:** Create `backend/app/services/paycheck_calc.py`, `backend/app/services/comp_calc.py`,
`backend/app/schemas/paycheck.py`, `backend/app/schemas/comp.py`, `backend/app/api/paycheck.py`,
`backend/app/api/comp.py`, `backend/tests/test_paycheck_comp_api.py`. Modify `main.py`.

`paycheck_calc.breakdown(profile) -> dict` per the Workbook waterfall (full precision;
quantize at schema). `comp_calc.metrics(event) -> dict` per the Focal computed table
(null-tolerant exactly as pinned).

Router `/paycheck`:
- `GET /paycheck/profiles` ordered by effective_date DESC.
- `POST /paycheck/profiles` / `PATCH /paycheck/profiles/{id}` / `DELETE`: salary > 0 (2dp,
  bound 10^10), pay_periods_per_year int 1 ≤ n ≤ 366 (**the divide-by-zero guard — Plan 1
  forward note**), each pct 0 ≤ p ≤ 1 (9dp), dental/hsa ≥ 0 (2dp, bound 10^6),
  effective_date unique → 409 + reasonable-date.
- `GET /paycheck/breakdown?profile_id=` → default profile = max effective_date ≤ today, else
  the earliest future one; 404 when no profiles. Response: `{profile: ProfileOut, gross,
  trad_401k, dental_vision, hsa, taxable, withholding, post_tax, roth_401k, after_tax_401k,
  espp, net_pay, monthly_net, warnings: []}` — warning when
  trad+roth+at+espp > 1 (`"contribution percentages exceed 100%"`) or net_pay < 0
  (`"net pay is negative"`).

Router `/comp`:
- `GET /comp/events` ordered by focal_year asc; each = stored fields + computed
  (base_delta, base_delta_pct, unvested_equity, equity_delta, equity_delta_pct, tc_before,
  tc_after — 2dp money / 6dp pct, nulls per the pinned table).
- `POST /comp/events` / `PATCH /comp/events/{id}` / `DELETE`: focal_year int 1990 ≤ y ≤ 2100,
  unique → 409; current_base > 0; new_base nullable > 0; RSU counts nullable ≥ 0 (4dp);
  prices nullable ≥ 0 (4dp). PATCH validates merged row.

- [ ] **Step 1: failing tests** (`test_paycheck_comp_api.py`):
  - paycheck_calc unit: the real-profile golden (all 11 lines at the pinned cents); a 26-period
    profile (monthly = net×26/12); zero-pct profile (net == post_tax). The five Numeric(10,9)
    pct fields on ProfileOut MUST use the Task-3 plain-format PlainSerializer pattern (no
    "0E-9" on the wire) — pin `"0.000000000"` for a zero pct in a test.
  - paycheck API: CRUD + every validation (pay_periods 0 → 422 is MANDATORY); breakdown
    default-profile selection (two profiles: effective 2026-01-01 and 2027-01-01 with
    frozen... use dates relative to `date.today()` — one past, one future → past wins; only
    future → future wins); explicit profile_id; 404 empty; warnings branch (pcts summing 1.2).
  - comp_calc unit: the four pinned rows (2024–2027) exactly.
  - comp API: CRUD + validations + computed fields on GET (seed the 2026 event at column
    scale → assert "333882.96", "0.236734", "601854.46"); auth 401 spot-checks.
Ratified implementer decisions: net<0 warning judged on the DISPLAYED (2dp) net; pct-sum
warning excludes withholding_pct (a tax, not a contribution); null semantics split — paycheck
NOT NULL columns take the explicit-null-is-no-op house rule while comp's nullable columns
(new_base/RSUs/prices) treat explicit null as CLEAR (tc_after falls back to current_base;
new_base=0 rejected, null is "no raise"); comp_calc ratios guarded at PCT_MAX_ABS 1e12
(taxes _effective_rate posture — storable extremes reach ~1e26); integer id path/query
params bounded at 2^31−1 on both routers (int4 overflow otherwise 500s). The same
unbounded-id latent 500 exists on /espp/lots/{id} and /espp/periods/{id} — fix in this
task's review fix round (authorized file-scope extension: api/espp.py + test_espp_api.py,
IdPath bound only).

- [ ] **Step 2:** implement to green. **Step 3:** full gates. **Step 4:** commit
  `feat: paycheck waterfall + comp events APIs`.

### Task 5: Frontend wire types + API clients

**Files:** Modify `src/types/api.ts` (append the four modules' wire types — money/pct fields
are `string`, nullables `| null`, matching Tasks 2–4 response shapes EXACTLY). Create
`src/api/taxes.ts`, `src/api/espp.ts`, `src/api/paycheck.ts`, `src/api/comp.ts` following
`src/api/portfolio.ts` (typed thin wrappers over `client.ts`; query-string helpers for the
modeler params; no react-query).

Note (Task 2 review M8): brackets serialize as `Record<string, Bracket[]>` (importer-written
extra jurisdictions survive reads) — export a frontend `JURISDICTIONS` order const in
`src/api/taxes.ts` to drive render order; `BracketIn` ignores a round-tripped `bracket_index`.
Note (Task 3 review M2/M6): EsppPage's modeler `price_source` is `'params' | 'latest_price'`
— a DIFFERENT union than HoldingOut's same-named field; `espp_ticker` types as
`string | null` (any stored string echoes through), and `ModelerOut.quoted_at` is
`string | null`.
Note (Task 4): ProfileOut carries five 9dp pct strings ("0.130000000"); BreakdownOut =
{profile, the 11 waterfall lines, monthly_net, warnings: string[]}; CompEventOut computed
fields are `string | null` EXCEPT tc_before/tc_after which are never null.

- [ ] **Step 1:** write types + clients (every endpoint from Tasks 2–4, including
  clone-brackets and modeler params). **Step 2:** `npx tsc --noEmit` via `npm run build`
  (build runs tsc) + `npm run lint` + `npm test` (existing 52 still green).
  **Step 3:** commit `feat: tax/espp/paycheck/comp API clients + wire types`.

### Task 6: Taxes page — inputs form + brackets editor

**Files:** Create `src/pages/TaxesPage.tsx`, `src/pages/TaxesPage.css`,
`src/components/taxes/InputsForm.tsx`, `src/components/taxes/BracketsEditor.tsx`,
`src/components/taxes/taxes.css`, tests `src/pages/TaxesPage.test.tsx`,
`src/components/taxes/InputsForm.test.tsx`, `src/components/taxes/BracketsEditor.test.tsx`.
Modify `src/App.tsx` (route swap).

Page shell: year chips (from GET /taxes/years; chip style = the existing panel chip
vocabulary in panels.css), a "New year" action = clone-brackets-from-latest + jump (POST,
then reload years; window.prompt-free: a small inline form with a number input, default
latest+1). Data loads with the beginLoad/seqRef house pattern; year switch reloads
inputs+brackets+summary (summary consumed in Task 7's panel; until Task 7 lands, render the
raw totals line from GET summary — Task 7 replaces it).

InputsForm: three sections (Ordinary income / Deductions / Capital gains) rendering items in
order; each row = label + text input (controlled, string state; blank = null) + when
`suggested != null && suggested !== value` a suggestion chip `suggested $X` with an Apply
button (fills the input locally — save still explicit). Save button per section or one for
the form (one for the form; disabled while saving) → PUT only CHANGED keys (diff against
loaded values; blank→null deletes). 422 surfaces the detail string inline (house error-note
pattern) — note a `suggested` value can exceed the input bound 10^10 (unbounded engine
outputs), so Apply-then-save can legitimately 422; the inline error covers it (Task 2
review M8). aria: inputs labelled via htmlFor/id.

BracketsEditor: six jurisdiction sections; each a small table (rows: index, rate as %
string, threshold) + add/remove row + per-jurisdiction Save (PUT with ONLY that jurisdiction
in the body). Client-side pre-validation mirrors the API (first threshold 0, ascending,
rate 0..1 after /100 conversion — the editor DISPLAYS percent form `10` for rate `0.10`;
convert on load/save; keep 4dp) with inline errors; server 422 rendered verbatim.

- [ ] **Step 1: failing tests** — InputsForm: renders 3 sections + items; typing + save calls
  PUT with only changed keys; Apply fills input; blank saves null; 422 detail rendered.
  BracketsEditor: renders six sections; ascending-violation blocks save with message; save
  sends single jurisdiction, percent→fraction conversion pinned ("37" → "0.37").
  TaxesPage: year chips render from mocked API; switching year reloads (mock call counts);
  clone flow calls POST then reloads years. (Mock `src/api/taxes`; no EChart here.)
Ratified implementer decisions: fresh-DB bootstrap — clone source is the newest year with
bracket_count>0; when NO year has brackets, "Create year" calls putTaxInputs(year, {values:{}})
(the auto-create affordance) instead of a guaranteed-404 clone; selected year is component
state (no URL param); percent↔fraction conversion is decimal-point string-shifting (no
floats; mutation-verified against Number()*10**n).

- [ ] **Step 2:** implement; swap `<Route path="/taxes">` to TaxesPage. **Step 3:**
  `npm test`, lint, build. **Step 4:** commit `feat: taxes page — inputs form + bracket editor`.

### Task 7: Taxes page — liability waterfall + multi-year trends

**Files:** Create `src/components/taxes/SummaryPanel.tsx`,
`src/components/taxes/taxChartOptions.ts`, `src/components/taxes/taxChartOptions.test.ts`;
modify `src/pages/TaxesPage.tsx` (mount panel), extend `TaxesPage.test.tsx`.

taxChartOptions.ts exports PURE builders (no React):
- `waterfallOption(summary: TaxSummaryOut)` — ECharts stacked-bar waterfall: categories
  [Gross, Federal, State, Medicare, Soc. Sec., SDI, Cap. gains, Take-home]; the classic
  invisible-placeholder + visible-bar stacked pattern; palette slots from theme PALETTE
  (taxes = one hue family + the existing negative/positive conventions; NO new colors);
  values from totals.gross_income/take_home + each tax (parse strings via the existing
  chart-side number handling used in SpendingPage options).
- `trendOption(years: TaxSummaryOut[])` — dual: stacked bars per year of the six tax
  amounts (composition) + a line series on a % axis for totals.effective_rate (6dp string →
  ×100). ≤3 hue + Other law applies to the six stacks: use the sequential ramp convention
  from AllocationPanel if six distinct slots exceed the law — six ordered slots of ONE
  family is the compliant choice; follow theme.ts slot comments.
- Both builders: reduced-motion/theme handled by the wrapper — builders stay data-only.

SummaryPanel: current-year waterfall (from the year's summary) + all-years trend (GET
/taxes/summary once per visit; seqRef; skeleton/empty states per house patterns) + a
warnings strip rendering summary.warnings (escape via React text nodes; note: a freshly
created sparse year carries a long 21-key missing-inputs warning — render as-is, wrapped) +
stat tiles (StatTile) for total tax / take-home / overall effective rate.

- [ ] **Step 1: failing tests** — taxChartOptions: waterfall placeholder arithmetic pinned
  (placeholder[i] = running take from gross downward — assert exact arrays for the 2024
  golden summary), trend maps years to categories + rate line values ×100; SummaryPanel:
  renders tiles from mocked summaries, warning strip lists warnings (vi.mock '../EChart' and
  the api module).
- [ ] **Step 2:** implement + mount. **Step 3:** npm gates. **Step 4:** commit
  `feat: taxes page — liability waterfall + effective-rate trends`.

### Task 8: ESPP page

**Files:** Create `src/pages/EsppPage.tsx`, `src/pages/EsppPage.css`,
`src/pages/EsppPage.test.tsx`. Modify `src/App.tsx`.

Sections:
1. **Lots table** (GET /espp/lots): purchase date, shares, subscription/FMV/purchase price,
   cost basis, current price + market value + gain $ / gain % (formatCurrency/formatPct;
   nulls render "—"), disposition badge (`Qualified` / `Qualifying in N days` /
   `Sold (qualified|unqualified)`) — countdown from days_until_qualified. Row edit (inline
   form) + delete with confirm; add-lot form (purchase_price left blank → server default;
   sold fields paired). Single-flight busy flag per the SecuritiesPanel pattern is
   acceptable; ticker + price staleness line (quoted_at date-only compare — Plan 4 note).
2. **Modeler card** (GET /espp/modeler): three knobs (subscription, FMV, carry) initialized
   from the response echo (price_source note rendered: "using latest NVDA price" vs
   "custom"); Recalculate button → refetch with params (beginLoad; seqRef); per-period
   mini-table of the computed chain (shares, cost, refund, carry, value_25k; over-limit
   badge); **$25k gauge** = a plain CSS progress bar (div-based, width = total_25k/25000,
   formatCurrency labels, aria role="meter" with aria-valuenow) — no new echarts type.
   Empty state when 404 (no periods): "Add periods via the API of this page" → periods
   management UI: small table + add/edit/delete forms for periods (label, dates, base,
   additional, pct%). (Periods CRUD lives here — nowhere else in the app.)

- [ ] **Step 1: failing tests** — lots table renders metrics + badges from mocked api
  (qualified vs countdown vs sold); add-lot posts payload with omitted purchase_price;
  modeler knobs refetch with params (assert query args); gauge width/aria pinned for the
  golden totals ("24935.34" → 99.74%); period add form posts pct as fraction ("11" → 0.11).
Ratified implementer decisions: modeler knobs live on the PAGE and survive a failed
recalculate (the clean-seed 422 needs them); knob seeding fills only still-blank fields
(typing survives the first load); failed lots/periods RELOADS keep the previous payload +
banner (same-entity rule — deliberate deviation from TaxesPage's drop-on-fail, which is
about cross-year confusion) while the modeler drops its chain on failure; period edits
PATCH the full row (Task 4 M6 binding); blank purchase_price = omit on POST / explicit
null on PATCH; sold rows show sold_price in the Price column; three components in one
page file (react-refresh constraint; nothing non-component exported); shiftPoint copied
from BracketsEditor with attribution (dedup → forward note).

- [ ] **Step 2:** implement + route swap. **Step 3:** npm gates. **Step 4:** commit
  `feat: ESPP page — lots, disposition countdown, 25k modeler`.

### Task 9: Paycheck + Comp pages

**Files:** Create `src/pages/PaycheckPage.tsx`, `src/pages/PaycheckPage.css`,
`src/pages/PaycheckPage.test.tsx`, `src/pages/CompPage.tsx`, `src/pages/CompPage.css`,
`src/pages/CompPage.test.tsx`, `src/components/comp/compChartOptions.ts`,
`src/components/comp/compChartOptions.test.ts`. Modify `src/App.tsx` (both routes).

PaycheckPage: profile history table (effective date desc; edit/delete; "New profile" form
prefilled from the latest profile — the monthly comp-change ritual); breakdown panel for the
SELECTED profile (default = server default): the 11-line waterfall as a definition list
(label/value rows, net_pay emphasized, monthly_net tile) + warnings strip. Percent inputs
in percent form, converted to 9dp fractions on save ("13" → 0.13; display back ×100).
BINDING (Task 4 review M6): the edit form PATCHes the FULL profile shape, never a delta —
whole-row validation means a delta-PATCH against a row with any invalid stored field 422s
on unrelated edits. CompPage's form does the same; when clearing half an equity pair
(rsus/price), surface the orphaned operand rather than silently nulling the product.

CompPage: events table (focal year asc; stored + computed columns; edit/delete + add form) +
TC trajectory chart: `tcTrajectoryOption(events)` pure builder — stacked bars per focal_year:
base = (new_base ?? current_base), equity = tc_after − base (two palette slots, existing
stacked-bar conventions from SpendingPage), line overlay of tc_after. Label the chart
"Base + unvested equity value". Null-safe: 2027-style rows chart base-only.

- [ ] **Step 1: failing tests** — paycheck: breakdown lines render golden values from mocked
  api; new-profile form converts "13" → "0.13"... (assert 0.13 as the 9dp string "0.130000000"
  or number per client typing — pin whichever the client sends; body uses strings for pcts);
  profile switch refetches breakdown. comp: table renders computed cols with "—" nulls;
  add-form posts; tcTrajectoryOption pinned for the four golden events (2027 equity 0).
Ratified implementer decisions (Task 9): shiftPoint promoted to src/utils/percent.ts (its
own commit; both prior copies now import it — forward-note dedup done); TC chart uses the
identity palette slots PALETTE[0]/[1] (two identity categories, not a positional ramp) +
INK line; paycheck blank pct/money boxes send "0" (explicit-null is a no-op server-side, so
clearing a box is the only way to say "stop contributing"); paycheck bodies carry all 11
keys on BOTH verbs; breakdown keeps-previous on reload failure (panel heading self-identifies
its profile) but a 404 DROPS it with branched sentences (no profiles vs profile not found);
row selection lights from the breakdown payload's own profile.id; post-write form reset
seeds from whichever row is now newest; comp orphan-pair warning derives at render
(advisory, never a gate).

- [ ] **Step 2:** implement + routes. **Step 3:** npm gates. **Step 4:** commit
  `feat: paycheck + comp pages with TC trajectory`.

### Task 10: Real-data reconciliation (controller-supervised; read-only on dev DB)

No committed code. Controller (or a supervised subagent) runs an in-process ASGI sweep from
the worktree against the REAL dev DB (config default `localhost:5433/finance`; conftest is
NOT involved — plain script, GET-only):

- [ ] **Step 1:** scratchpad script: httpx.AsyncClient(transport=ASGITransport(app)) with an
  auth token minted via the app's own login (admin@example.com/changeme123), then:
  - `GET /taxes/years` → expect exactly 2023–2026 with 43/43/43/43 input counts (Task 15 of
    Plan 2 seeded 43 defs; inputs per year = 41 sheet rows + 2 state keys = 43).
  - `GET /taxes/years/{y}/summary` for 2023–2026 → compare EVERY field against the canonical
    table at cents; record the four sheet-drift deltas alongside (D1 31.20 / D2 405.50 +
    117.85 / D3 4918.93) — they must reconcile EXACTLY as documented.
  - `GET /espp/modeler?subscription_price=170.79&purchase_fmv=171&carry_forward=0` → the
    golden chain (78/68 shares, refund 534.87, totals 24935.34/21196.28/24966.00).
  - `GET /espp/lots` → 4 lots, cost basis 10720.49/10514.33/11297.75/9937.07
    (= HALF_UP2(shares × 41.23265): 260/255/274/241), disposition vs TODAY recorded
    (2026-08-16: lots 1–3 qualified; lot 4 qualifying 2026-08-29 → 13 days), live NVDA price
    + market values recorded (values are runtime-dependent — record, don't pin).
  - `GET /paycheck/breakdown` → the golden waterfall (net 3384.16, monthly 6768.33).
  - `GET /comp/events` → the four pinned rows.
- [ ] **Step 2:** paste results into this doc under "Task 10 results" (create the section;
  include the drift-delta reconciliation table). Any mismatch = STOP, investigate with the
  systematic-debugging posture before touching code.
- [ ] **Step 3:** commit `docs: Plan 5 reconciliation results vs sheet` (plan doc only).

### Task 10 results (executed 2026-08-17, controller-supervised; read-only, in-process ASGI vs the live dev DB)

**ALL 130 CHECKS PASS** (script exits 0; the only POST was the app's own login; no lifespan
→ no scheduler; no writes).

- **Tax years:** exactly 2023–2026, 43 inputs + 25 brackets each.
- **Summaries vs the canonical table:** all 56 pinned money cells match at cents for all
  four years (AGI/TI/tax per jurisdiction, gains, gross, total, take-home).
- **Sheet-drift reconciliation (sheet − ours, cents-rounded):** 2023 federal −31.20 (D1),
  2024 0.00 / 0.00 (clean year), 2025 federal +405.50 + state +117.85 (D2), 2026 federal
  +4918.92 (D3; 4918.93 at full precision). Every delta equals its documented drift exactly.
- **ESPP modeler (sheet params 170.79/171/0):** the full golden chain — 78/68 shares,
  11324.04/9872.24 costs, 15.96 carry, 534.87 refund, totals 24935.34 / 21196.28 /
  24966.00, remaining 64.66, price_source "params".
- **ESPP lots:** 4 lots, cost bases 10720.49 / 10514.33 / 11297.75 / 9937.07. Runtime
  (recorded, not pinned): NVDA 225.1600 @ 2026-08-14 bar; lots 1–3 qualified; lot 4
  qualifies in 12 days (2026-08-29); market values 58541.60 / 57415.80 / 61693.84 /
  54263.56.
- **Paycheck breakdown (server-default profile, effective 2026-01-01):** all 12 lines at
  the golden cents (gross 7872.08 → net 3384.16, monthly 6768.33), warnings [].
- **Comp events — FIRST real-data pass through comp_calc** (test fixtures had used
  synthetic RSU counts): all 28 cells of the pinned 4-row table reproduce from the REAL
  stored inputs, incl. 2026's 333882.96 / 0.236734 (⚠D4) / 601854.46 and 2027's null
  cascade with tc 188930.00.

### Task 11: Final gates + forward notes + DoD audit

- [ ] **Step 1:** full gates in the worktree: backend pytest -W error / ruff check / format
  --check / alembic check (single head e5b93d0a416f); npm test / lint (1 sanctioned) / build
  (record bundle size). `git log --oneline main..HEAD` sanity: linear, conventional.
- [ ] **Step 2:** append "Forward notes for Plan 6" to this doc — seed list (amend during
  execution): scheduler cron re-read note stands; /settings page still placeholder (import
  UI + app-settings PUT live there); Overview page reuses GET /taxes/summary current-year
  effective rate (spec §5 dashboard), /portfolio/holdings totals, /net-worth/summary;
  code-splitting note with final bundle number; prod import order gotcha (five-slug
  is_component UPDATE + first refresh + ZI flags) stands for the Plan 6 deploy; taxes
  re-import clobbers UI-edited sheet-years (cutover order); paycheck Percentages/Monthly
  Budget block consciously skipped; /prices/history & /portfolio/realized still
  frontend-unconsumed; taxes router joins the accounts/securities accepted TOCTOU class
  (concurrent writes can 500-then-retry; on_conflict_do_* is the batch fix for all three);
  every taxes write auto-creates the year row and nothing deletes one — phantom years from
  typos need a Plan 6 DELETE /taxes/years/{year} (empty-PUT-creates is test-pinned, don't
  just remove it); money.py quantizers preserve Decimal("-0") house-wide (writers/readers
  that care must collapse with + ZERO); espp router imports money._quantize_bounded for the
  5dp/9dp column families — promote public quantize helpers at those scales when money.py
  is next touched, and fold in the Task-4 review M5 dedup then too (identical
  _validated_pct/_merged/IdPath vocabulary now lives in espp+paycheck+comp routers;
  "share both or neither" — currently split because schemas share Pct9 while routers
  duplicate validators); frontend twin: shiftPoint (string percent⇄fraction) now lives in
  BracketsEditor AND EsppPage — promote to src/utils when either is next touched; EsppPage
  next-touch nits (Task 8 re-review N-items): the three .finally seq guards are unpinned
  (cosmetic-only survivor — a stale run can lift the dim early), no periods-load-failure
  test exists (the stale-cue branch there is an unpinned twin of the pinned lots one),
  .span-2 can overflow below ~2 grid tracks (grid-column: 1 / -1 is the idiom), the modeler
  never sends ?year= (server targets the latest year with periods; adding a period in a new
  calendar year silently retargets the card — Plan 6 candidate: a year selector).
- [ ] **Step 3:** Definition-of-done audit against the checklist below; fix or document any
  miss; final commit `docs: Plan 5 final gates + forward notes`.

---

## Forward notes for Plan 6 (from Plan 5 execution, finalized 2026-08-17)

**Data/engine facts:**
- The canonical tax engine deliberately diverges from four sheet drifts (D1–D4 in the
  Workbook reference); Task 10 reconciled every delta to the cent. Do NOT "fix" a summary
  to match the sheet's 2023/2025/2026 cached cells — ours is the self-consistent model.
- `capital_loss_deductions` is engine-inert (sheet-faithful); its suggestion still computes.
  `is_derived` on tax_input_definitions is display-legacy — suggestion chips key off the
  suggestions map, not the flag.
- Missing-inputs warning lists the 21 engine-read keys in one long line; a fresh year is
  NOISY by design (SummaryPanel wraps it).
- Engine outputs are UNBOUNDED (module docstring contract): output paths use plain CENT
  quantize + the 1e12 rate fence (null + "<jurisdiction> effective rate out of range");
  never bounded quantizers on GETs. comp_calc._ratio carries the same fence.
- money.py quantizers preserve Decimal("-0") house-wide; every Plan 5 writer/computed-out
  collapses with + ZERO. Numeric(10,9) fields serialize via Pct9 (PlainSerializer format
  'f') — bare Decimal would wire "0E-9". PostgreSQL NUMERIC can store 'NaN' (DB-direct
  only); format(v,'f') would serialize it as "NaN" — unreachable via API.
- Taxes re-import is sheet-wins within imported years: UI edits to 2023–2026 get clobbered
  by a re-import — cutover order matters (import first, then edit).
- Scheduler cron re-read note stands (restart to apply); prod import order gotcha stands
  (five-slug is_component UPDATE + first refresh + ZI flags) for the Plan 6 deploy.

**API residuals / candidates:**
- Taxes router joins the accounts/securities accepted TOCTOU class (concurrent writes can
  500-then-retry, no corruption; on_conflict_do_* is the batch fix for all three).
- Every taxes write auto-creates the year row and NOTHING deletes one — phantom years from
  typos need a Plan 6 `DELETE /taxes/years/{year}` (empty-PUT-creates is test-pinned).
- espp router imports money._quantize_bounded (5dp/9dp families) — promote public helpers
  when money.py is next touched, and fold in the router-validator dedup then too
  (_validated_pct/_merged/IdPath now live in espp+paycheck+comp; schemas share Pct9 while
  routers duplicate — "share both or neither").
- The modeler never receives ?year= from the UI; adding a period in a new calendar year
  silently retargets the card (heading is the cue) — Plan 6 candidate: year selector.
- GET /espp/modeler could echo bracket-…: no — it's complete; but a modeler knob equal to
  '0' is sent (truthy string) while '' is omitted — the documented client contract.
- /prices/history & /portfolio/realized remain frontend-unconsumed; HoldingOut.accounts
  still unrendered (Plan 4 notes stand).

**Frontend house-law additions this plan:**
- shiftPoint + isPlainDecimal live in src/utils/percent.ts (single copy; one regex shared
  so they can't drift). Percent boxes must gate with isPlainDecimal BEFORE Number() range
  checks — exponent notation ("1e-3") is otherwise stored 100× off silently.
- Dirty-work protection: TaxesPage confirm-gates all three reload doors; EsppPage/
  PaycheckPage/CompPage keep-previous-payload on reload failure with a conditional stale
  cue (" — the table may be showing earlier data." only when a payload is on screen).
- Full-form PATCH is the law for paycheck profiles, espp periods, comp events (whole-row
  server validation; delta-PATCH 422s on unrelated edits when any stored field is bad).
- Waterfall-style stacked bars need `stackStrategy: 'all'` (echarts' samesign default
  un-floats segments whose base crosses zero — taxChartOptions has it; compChartOptions
  doesn't need it for API-legal data since tc_after ≥ base, DB-direct negatives accepted).
- TC chart series label is 'Equity value (incl. refresh)' — deliberately distinct from the
  table's unvested_equity column (different quantities; the collision was a review catch).
- Known cosmetic residuals (accepted): .finally seq guards unpinned on the three new pages
  (a stale run can lift a dim early; no payload lands); Edit buttons clickable during a
  save while Delete is disabled (house-wide class); 1dp formatPct on 9dp pct table columns
  and 2dp formatCurrency on 4dp comp prices (displayed operands don't reproduce displayed
  products); .span-2 overflows below ~2 grid tracks in three stylesheets (grid-column:
  1 / -1 is the idiom); periods-load-failure test still missing on EsppPage.
- Browser-only items for the user's visual pass (never verifiable in jsdom): inputs-grid
  label widths at ~1240px and ~1000px vs the real 43-row payload; native form validation
  interplay (noValidate is set on the new-year form; others rely on inline guards);
  Enter-key implicit submission while a submit button is disabled; chart legend crowding
  beyond ~10 trend years.

**Plan 6 build notes:**
- Overview page: reuse GET /taxes/summary (current-year effective rate), /portfolio/
  holdings totals, /net-worth/summary — do NOT re-derive; investable_base stays the
  4%-line source. It will hit preserve-manual-memoization (Plan 3 note stands).
- Bundle at Plan 5 close: 1,034.68 kB raw / 338.41 kB gzip — code-splitting is due.
- /settings page still placeholder (import UI + app-settings PUT live there; cron
  min-interval guard note stands).

## Execution status (COMPLETE 2026-08-17 — all 11 tasks; ready for the user's merge decision)

Tasks 1–8 COMPLETE, each through implement → spec review → quality review → fix →
re-review (all subagents Opus 5; every verdict SPEC_PASS / QUALITY_APPROVED at close):

| Task | Landed at | Review fix rounds |
|---|---|---|
| 1 tax engine | 2dded98 + a007b78 | stack-clamp coverage, -0 rates, contracts |
| 2 taxes API | 2afec8d + a4e61bc | -0 collapse, 422 details, pins, niit symmetry |
| 3 ESPP API | 3731b46 + 5bb4fec | Pct9 wire format, carry hoist, bound, quoted_at |
| 4 paycheck+comp API | 28aeb3b + 3cd15cc | stored-data guards, warning pins, espp id bounds |
| 5 TS clients | a72b0bf + b27216e + df1c3ac | fetch* rename, blank-knob guard, notes |
| 6 taxes page (forms) | afd6743 + 4b0a995 + a4fdd08 | create recovery, dirty gates, grid readability |
| 7 taxes charts | 7446290 + aa152a1 (+13dd173) | stackStrategy all, guard/formatter pins |
| 8 ESPP page | f2f0a30 + 71e2425 + 9b89248 | echo fixtures, seq pins, un-sell coverage |

| 9 paycheck+comp pages | 6345a24 + 001a72a + 63a9821 | equity label, selection race, plain-decimal gates |
| 10 reconciliation | d84cf8f (results) | 130/130 pass incl. exact drift table; first real-data comp_calc pass |
| 11 final gates + docs | (this commit) | — |

Final gates: backend **518 pytest -W error** + ruff + format + alembic check (single head
e5b93d0a416f, ZERO new migration files); frontend **209 vitest** + lint (1 sanctioned
warning) + build (bundle **1,034.68 kB raw / 338.41 kB gzip**). Branch: linear conventional
commits on `plan-5-taxes-comp` over main@5207d3a, worktree `.worktrees/plan-5-taxes-comp`,
tree clean. NOT merged, NOT pushed (user decides — Plans 1–4 precedent).

**Definition-of-done audit (2026-08-17): every bullet below verified.** Golden gate: the
canonical engine reproduces the pinned table (Task 1 tests), 2024 matches the sheet to the
cent on every quantity (test + Task 10), D1–D4 each reproduced/explained to the cent
(drift-pin tests + Task 10 drift table). Pages render real data with placeholders remaining
only on /settings and the 404 route (by design); inputs/brackets/lots/periods/profiles/
events all editable through the UI; suggestion chips, clone-year, modeler knobs all
test-verified. Every derived value computed at request time; no schema changes; the real
workbook path/filename appears NOWHERE in Plan 5's additions (pre-existing Plan 2–4 docs
carry it, accepted posture); frozen palette untouched (src/charts diff vs main is empty).
Task 10 results + these forward notes recorded. Interactive visual pass = user's morning
step (browser-only items listed in the forward notes).

## Definition of done (Plan 5)

- `pytest -q -W error` green in the worktree (284 baseline + engine + 4 API suites);
  `ruff check` + `ruff format --check` clean; `alembic check` clean with single head
  e5b93d0a416f and ZERO new migration files.
- Golden gate (spec §9): canonical engine reproduces the pinned expected table; 2024 matches
  the sheet to the cent on every quantity; D1–D4 drifts each reproduced/explained to the cent
  by pinned tests + Task 10 reconciliation.
- `npm test` green (52 baseline + new component/option tests); `npm run lint` (1 sanctioned
  warning); `npm run build` clean.
- `/taxes`, `/espp`, `/paycheck`, `/comp` render real data (placeholders gone from App.tsx
  for those routes); inputs/brackets/lots/periods/profiles/events all editable through the
  UI; suggestion chips work; clone-year works; modeler knobs work.
- Every derived value computed at request time; no schema changes; no real-workbook path in
  committed artifacts; frozen palette untouched.
- Task 10 results + Forward notes for Plan 6 recorded in this doc. NOT merged — branch left
  for the user's morning review.
