# Two Income Streams + Contribution Limits (Lean P3) — Design Spec

**Date:** 2026-08-27
**Status:** Approved scope (user Q&A this session); spec pending user review. Implementation
PAUSED after plans are written, per user instruction.
**Lineage:** P3 of the marriage-readiness phasing — audit
`2026-08-26-marriage-readiness-audit.md` §3.3/§11; builds on the merged
household-foundation + married-taxes batch (`2026-08-26-household-foundation-married-taxes-design.md`).

## 1. Context & Goals

The household batch made married *taxes* correct, but income is still structurally
single-stream: one paycheck-profile timeline, a withholding tracker whose partner side is
*entered* rather than simulated, one salary node in the money-flow sankey, and paydays for one
person. This batch makes the partner a first-class earner — and adds the contribution-limit
registry the dashboard has never had (no 401(k)/HSA/ESPP caps are modeled for anyone today).

## 2. Decision Log (user Q&A, 2026-08-27)

| Decision | Choice |
|---|---|
| Scope | **Lean P3**: per-person paycheck profiles, simulated two-earner withholding, second sankey source, partner paydays. Comp/RSU/ESPP person-scoping + employer-ticker registry stay DEFERRED until spouse equity exists. |
| Contribution limits | **Included**: data-driven per-year registry + on-pace indicators on the Paycheck page. |
| Paycheck UX | **Person switcher chips** (Net-Worth owner-chip grammar) + a combined household take-home tile. No side-by-side dual view. |
| Execution | Overnight autonomous, same pipeline; **paused after plans are written** for user go. |
| Standing facts | Spouse: W-2 only, same semi-monthly cadence (24), CA. Household net pay stays one wizard field. App ships NO IRS limit values — user enters them yearly (brackets philosophy). |

**Out of scope:** comp_events/rsu_grants/ESPP person-scoping; employer-ticker registry;
biweekly cadence; IRA/backdoor modeling (registry keys stay extensible); per-person net pay;
415(c) employer-match estimation (see §6 caveat); reconciling limit indicators against tax
inputs (paycheck-profile-driven only this batch); portfolio/cards/projection (P4); marriage
calculator/W-4 helper (P5).

## 3. Data model (three migrations, chained on current head)

1. **`paycheck_profiles.person_id`** — nullable→backfilled NOT NULL int FK → people.id.
   Backfill: all existing rows → primary person. Unique swap:
   `effective_date` → **(person_id, effective_date)**. (Audit: the old unique is enforced in
   the model, `_require_free_effective_date`, and migration e301f88ed241 — all three move.)
2. **`paycheck_profiles.hsa_coverage`** — String(10) NOT NULL server_default `'self'`
   (`'none'|'self'|'family'`, Python-validated). Drives which HSA cap applies per person.
3. **`contribution_limits`** — `id`, `year` int NOT NULL, `key` String(40) NOT NULL,
   `value` Numeric(14,2) NOT NULL, UNIQUE (year, key). Importer-immune (column-reflection
   pin like rsu_grants/custom_events). Seeded keys (definitions in code, VALUES from user):
   `limit_401k_elective`, `limit_415c_total`, `limit_hsa_self`, `limit_hsa_family`,
   `limit_espp_423`. Registry is deliberately generic — later batches add keys (IRA) without
   migrations.

## 4. Backend design

### 4.1 Per-person profiles (`api/paycheck.py`)
- CRUD gains `person_id` (default primary for wire back-compat; explicit on create).
  `_require_free_effective_date` scopes to the person. `_default_profile(db, person_id)` —
  one “profile in force” per person; existing callers that don't pass a person resolve to
  the primary (byte-identical legacy behavior, pinned).
- `GET /paycheck/breakdown?person_id=` (absent = primary). `GET /paycheck/profiles` gains
  `person_id` on rows; list stays one ordered list (UI groups by person).
- **Importer scoping:** `apply_paycheck` writes/updates only rows whose `person_id` is the
  primary (mirrors the tax-sweep person clause; partner profiles are import-immune). Pinned.
- Derived-W2 tax suggestion: the per-column suggestion machinery from the married-taxes
  batch now sources each person's suggestion from THAT person's in-force profile (partner
  column suggests from partner profile; absent profile → no suggestion, as today).

### 4.2 Withholding tracker upgrade (`services/withholding_calc.py`, `api/taxes.py`)
- Partner leg becomes **simulated exactly like the primary's** (salary checks at their
  all-in withholding %; no vest/ESPP legs — lean scope) **when the partner has an in-force
  profile**; otherwise the existing entered-inputs fallback (P2 behavior + its warning)
  remains, byte-identical. Response distinguishes `partner_source: "simulated"|"entered"`;
  the panel heading follows ("Partner — simulated" / "Partner — entered, not simulated").
- The two tracker keys (`w2_fed_withholding`/`w2_state_withholding`) stay as the fallback's
  source and are ignored (with a note in the panel) once a partner profile exists — one
  source of truth at a time, no blending.
- Additional-Medicare gap math unchanged (wage inputs still from tax inputs). Single-year
  and MFS paths byte-identical (goldens + P2 pins untouched).

### 4.3 Money-flow second source (`services/money_flow.py`, `moneyFlowOptions.ts`)
- The salary decomposition splits by person: named source nodes `Salary — <primary>` and
  `Salary — <partner>` from each person's W-2 input rows (married years with partner W-2
  rows only; single years and partner-less years render today's single `Salary` node
  byte-identically — pinned). Conservation/residual math unchanged (same totals, one node
  split in two).
- Palette: sources currently consume PALETTE[0..4] and the mid-column [5..7] — no free
  slot. The two salary nodes share the existing salary slot's hue family (implementation
  follows `charts/theme.ts` + the dataviz skill; the constraint is: distinguishable,
  CVD-safe, and the single-node path keeps its exact current color).

### 4.4 Calendar paydays (`services/calendar_events.py`, `api/calendar.py`)
- Payday composition iterates **in-force profiles per person** (not “the latest profile”):
  one `payday` event per person per date, labeled with the person's name when >1 person has
  a profile (`Payday — Sam`); the cadence-24 gate stays per profile. Same-date collisions
  are two labeled chips (existing multi-event day rendering). Single-profile households
  render today's unlabeled events byte-identically.

### 4.5 Contribution limits (`api/limits.py` new, `services/limit_check.py` new)
- CRUD: `GET /limits?year=` → `{year, items: [{key, label, value|null}]}` (definitions in
  code with labels/sort; values null until entered), `PUT /limits/{year}` bulk upsert,
  clone-from-prior-year helper (`POST /limits/{year}/clone-from/{src}`, 409 on non-empty
  target — the brackets-clone grammar).
- `limit_check.paycheck_pace(profile, limits, hsa_coverage) -> list[PaceItem]` — pure:
  annualized elective deferral (trad+roth % × salary) vs `limit_401k_elective`; elective +
  after-tax annualized vs `limit_415c_total` **with the stated caveat that employer match is
  not modeled** (indicator copy says "excludes employer match"); HSA per-check × periods vs
  the coverage-tier limit; ESPP % × salary vs `limit_espp_423` (primary only — partner has
  no ESPP; the check simply has no ESPP row for a profile with espp_pct 0). Each item:
  `{key, label, annualized, limit|null, ratio|null, tone: ok|warn|over}` — `warn` ≥ 95%,
  `over` > 100%; missing limit value → ratio null + "enter this year's limit" hint.
- Breakdown response embeds `pace: [PaceItem]` for the requested person.

## 5. Frontend design

- **Paycheck page**: Me/Partner switcher chips (RangeChips grammar; hidden for one-person
  households — page byte-identical, pinned). Chip switches profile form, waterfall,
  per-paycheck sankey, and profile history to that person; create-profile form carries the
  selected person. New **household take-home tile** (sum of in-force breakdowns' monthly
  net; renders only with 2+ profiles). New **contribution-pace strip** under the waterfall:
  one meter row per PaceItem (role=meter grammar from BudgetPanel), tones per §4.5, and an
  "enter limits" link to Settings when values are missing.
- **Settings → Contribution limits card** (new, follows the Accounts-card idiom): year
  selector chips, the five limit rows with currency inputs, clone-from-prior-year button.
- **WithholdingPanel**: heading + hint follow `partner_source`; when simulated, the two
  tracker-key rows in the partner facts list are replaced by the simulated figures and a
  one-line "from their paycheck profile" provenance; entered-fallback rendering unchanged.
- **Calendar legend**: payday chips carry the person label when applicable (legend copy
  updated; event type unchanged — no wire type changes beyond the label).
- Types/clients: `src/api/paycheck.ts` person param + `pace`; new `src/api/limits.ts`;
  `types/api.ts` additions.

## 6. Error handling & honesty

Missing partner profile → withholding falls back to entered inputs with the existing
warning; missing limit values → pace rows render with an explicit call-to-action, never a
fake 100% cap; 415(c) indicator names its no-match caveat inline; household tile absent
rather than half-true when only one profile exists. No silent fallbacks anywhere.

## 7. Testing

Byte-identity pins: single-person Paycheck page, legacy no-person API calls, single-node
sankey, unlabeled paydays, entered-fallback withholding (the P2 tests must pass untouched).
New: per-person profile CRUD/unique/default resolution; importer immunity for partner
profiles; simulated-partner withholding math (hand-checked fixture) + source flag; sankey
two-source conservation; per-person paydays; limit registry CRUD/clone; `paycheck_pace`
boundaries (94.9/95/100.1%, missing values, coverage tiers, espp_pct 0); page chips/tile/
pace-strip vitest; goldens + full suites green. Real-data browser smoke at batch end
(paycheck chips + pace strip + withholding simulated heading + sankey + calendar).

## 8. Migration & compatibility

Backfills: profiles → primary; `hsa_coverage` default `'self'` (user corrects in the form
if family HDHP). Wire back-compat: absent `person_id` params resolve to primary everywhere.
The withholding upgrade must keep the P2 entered-fallback path byte-identical (it is the
no-partner-profile behavior, not dead code). No pushes; deletions to the morning list.

## 9. Plan breakdown (for writing-plans)

1. **Person-scoped profiles (backend)** — migrations 1-2, profiles CRUD/default/importer
   scoping, derived-suggestion wiring, breakdown person param.
2. **Withholding simulation + money-flow split** — simulated partner leg + source flag +
   panel provenance; two salary source nodes; calendar per-person paydays.
3. **Paycheck page + household tile** — switcher chips, per-person views, household
   take-home tile, client/types.
4. **Contribution limits end-to-end + batch verification** — migration 3, limits API +
   Settings card, `limit_check` + pace strip, full gates + browser smoke checklist.
