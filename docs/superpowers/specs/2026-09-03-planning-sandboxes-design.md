# Planning sandboxes — design

**Date:** 2026-09-03
**Status:** drafted from the audit's pre-approved recommendations; the decisions in §2 are the author's
picks for the owner's morning review
**Source:** `docs/superpowers/specs/2026-09-02-fresh-eyes-dashboard-audit.md` §8 idea 1 (Paycheck "Try it"),
§9 ideas 5–6 (Taxes side-by-side, presets, pinning), §5 idea 5 (Projection scenarios + URL state), §11
idea 7 (natural-language what-if → sandbox), §13 T7; post-fix ranking item 10. Fourth of the five
polish/feature specs. Depends on the shell grammar (`2026-09-03-shell-grammar-design.md` §5 PageFrame,
§6 URL scope, §8 Segmented; Plan 3 Task 1 `Feed`) and cites the chart grammar
(`2026-09-03-chart-grammar-design.md` §6 ChartCard, §7 tooltips, §10 references, §12 color) wherever a
sandbox draws.

## 1. Context and goals

Three pages already compute planning answers without storing anything, each differently.
`POST /taxes/what-if` returns baseline, scenario and delta, but the panel shows two of eight deltas,
drops the previous result on failure, runs only on a click and holds one scenario. `GET /projection` is
a pure GET-with-knobs whose boxes mirror nothing into the URL, so a scenario cannot be shared or
compared. Paycheck has no what-if: trying a different 401(k) percentage means writing a dated profile
and deleting it afterwards (audit §8 friction 1).

This spec gives the three pages one sandbox grammar: scenario state in the URL, a hook that debounces a
pure preview request while the server keeps owning the math, slider-and-box controls with
reset-to-actual and delta chips, side-by-side comparison with up to three pinned scenarios, presets,
and an explicit Apply that hands the scenario to the write path the page already has. Nothing in a
sandbox writes to the database until the user clicks Apply and confirms.

## 2. Decisions

| Decision | Choice |
|---|---|
| Live scenario state | The URL: one repeated `whatif` param family, written `replace`-style (§4, §6) |
| Pinned scenarios | localStorage `finance.sandbox.<page>`, at most three per page, knobs only — never results |
| Server-saved scenarios | Deferred to the Data lifecycle spec's preferences endpoint, which migrates the localStorage keys |
| Math | Server-only; the client never adds, scales or annualizes a figure |
| Requests | Pure endpoints — `POST /paycheck/preview` (new), `POST /taxes/what-if` (+ NIIT delta), `GET /projection` — all through `apiReadOnly`, so a preview never invalidates the snapshot cache |
| Live vs button | Live; the Run and Recalculate buttons are retired |
| Failure posture | Keep the last result, marked stale, with the server's sentence above it (audit §9 friction 6) |
| Apply | Never a new write path: Paycheck → the existing profile form, pre-filled; Taxes → the existing inputs PUT for overrides only, after a before → after confirmation; Projection has none |
| Build approach | Shared grammar and backend as two parallel lanes, then three page lanes in worktrees, then the assistant seam |

## 3. Scope

**In:** `src/sandbox/` (URL grammar, `useSandbox`, pins, `SandboxPanel`, `SliderBox`, `DeltaChip`,
`CompareTable`, `PresetRow`); Paycheck "Try it"; Taxes side-by-side, presets, pinning and the `whatif`
URL family absorbing `?whatif=TICKER` / `?whatif-lot=`; Projection live knobs, URL state, pins and
compare curves; `POST /paycheck/preview`; `niit_tax` on `WhatIfDelta`; a write-purity conformance test;
the assistant seam as a designed contract built in the assistant grounding lane.

**Out:** mobile and anything below 1180 px; transaction-level spending; XIRR; any write that does not
go through an explicit Apply with confirmation; server-saved scenarios; the T7 siblings with their own
data needs (§16).

## 4. Where scenario state lives — three approaches

**A — URL only.** Every knob a query param; pins would be bookmarks. Shareable, refresh-safe,
back-button-honest with `replace`. But a comparison needs several scenarios on one screen, and one URL
carries one unless a `pin1=…&pin2=…` family makes links unreadable.

**B — localStorage only.** Named scenarios per page, nothing in the URL. Compare and pins come free, but
nothing can link into a scenario — not the assistant, not the Portfolio drill-in's "Model selling in
Taxes →" — and storage is user-writable, so every read needs validation anyway.

**C — server-saved scenarios.** A `scenarios` table, CRUD, ids in the URL. Durable and cross-device,
but a migration, five endpoints and a naming UI for a feature whose premise (T7) is planning without a
database write — and the shell spec already deferred preferences storage to the Data lifecycle spec.

**Pick: A for the live scenario, B for pins, C deferred.** The URL is the source of truth for what is
on screen — the shell's scope rule applied to knobs — so every sandbox view is a link the assistant can
deep-link into (§12). Pins are personal working memory, re-run against live data on every mount so a
pinned column can never show a stale number. Both homes share one encoding (§6): a pin is an array of
the URL's entry strings. `finance.sandbox.*` migrates with `finance.scope` when the preferences endpoint
lands.

## 5. Architecture and module map

```
src/sandbox/
  scenarioUrl.ts       encode/decode the `whatif` entry grammar; legacy alias recognition
  useSandbox.ts        URL ⇄ scenario · debounce · sequence guard · baseline · stale · pins
  pins.ts              finance.sandbox.<page>: read/validate/write, versioned, max 3
  SandboxPanel.tsx     card frame: eyebrow · Try it/Close · Reset to actual · presets · body · Apply slot
  SliderBox.tsx        <input type="range"> + AmountInput pair, actual tick, per-knob delta chip
  DeltaChip.tsx        signed Δ with tone; `invert` for cost lines (WhatIfPanel's inverted())
  CompareTable.tsx     rows × (Baseline | Scenario | Δ | pinned…); pinned header = label · Unpin
  PresetRow.tsx        chips; disabled with a title naming the missing datum
src/components/paycheck/TryItPanel.tsx       new — the Paycheck sandbox
src/components/taxes/WhatIfPanel.tsx         rewired onto useSandbox; compare, presets, pins
src/components/projection/ScenarioPanel.tsx  the knobs card, extracted from ProjectionPage
src/api/paycheck.ts    previewPaycheck() via apiReadOnly
src/api/whatif.ts      runWhatIf() moves from api() to apiReadOnly (today every Run clears every snapshot)
```

Backend: `app/api/paycheck.py` (`POST /preview`; `_resolve_breakdown_profile` and `_scenario_profile`
extracted so GET and POST share one path), `app/schemas/paycheck.py`, `app/schemas/taxes.py` +
`app/api/taxes.py` (`niit_tax`), `tests/conftest.py` (`forbid_writes`), and — in the assistant lane —
`app/services/sandbox_links.py`. Each unit is testable without mounting a page.

## 6. Scenario URL grammar

One repeated query param, `whatif`, page-scoped by path. Each value is one entry, `<kind>:<fields>`
(`URLSearchParams` percent-encodes the colon; the projection's `retire=2:2035-06` precedent). Values
are in the **server's wire vocabulary** — fractions, canonical decimals, ids — so decode → request body
is a straight copy, the round-trip test is byte equality, and the percent shift happens in exactly one
place: `SliderBox`'s box.

| Entry | Meaning | Pages |
|---|---|---|
| `<knob>:<decimal>` | A knob in the preview body's own key: `trad_401k_pct:0.15`, `hsa_per_check:250`, `annual_return:0.06` | Paycheck, Projection |
| `<knob>:<token>` | A string knob: `hsa_coverage:family`, `years:40` | Paycheck, Projection |
| `<input_key>:<decimal\|null>` | A tax override in the year's input-definition vocabulary: `trad_401k_contributions:23500`, `qualified_dividends:null` | Taxes |
| `sale:<security_id>:<shares>[:<price>][:<L\|S>]` | A brokerage leg; an empty price field is the API's omit case (latest quote); term defaults long | Taxes |
| `espp:<lot_id>[:<price>]` | An ESPP lot sale; empty price = the ESPP quote | Taxes |
| `retire:<person_id>:<YYYY-MM>` | A retirement, mirroring the API's `retire=` spelling | Projection |

Unknown kinds and unparsable values are dropped on arrival and the URL rewritten without them
(`useArrivalParam`'s rule); order is irrelevant; a duplicate key keeps the last. **Legacy aliases:** a
`whatif` value with no colon is the old `?whatif=TICKER`; `?whatif-lot=` is the old lot link. Both keep
working: the Taxes panel resolves the ticker against the holdings feed as today, then rewrites the URL
to `sale:…` / `espp:…` — one `replace`, in the feed's promise callback. The Portfolio drill-in and ESPP
lots table emit the new form from the Taxes lane on.

**Navigation.** Every sandbox write is `setSearchParams(next, { replace: true })` — the convention of
`useScope`, `?month=` and `?card=` — so the back button leaves the page rather than replaying slider
positions. The URL is rewritten in the tick the debounced request fires, so the address bar always
names the request in flight. Reset to actual removes every `whatif` entry; the shell's `owner`, `range`,
`month` and Taxes' `?year=` are keys the sandbox never touches. Arriving with entries opens the panel
and runs immediately.

## 7. `useSandbox`

```ts
interface SandboxSpec<S, R> {
  page: 'paycheck' | 'taxes' | 'projection'
  decode: (entries: string[]) => S        // total: bad entries dropped, never thrown
  encode: (scenario: S) => string[]
  isEmpty: (scenario: S) => boolean
  preview: (scenario: S) => Promise<R>    // the pure request; the hook never inspects R
  baselineOf?: (result: R) => R           // two-sided payloads carry their own baseline;
                                          // absent → the hook runs the empty scenario once
  dataKey: string                         // pins re-run when this changes (Taxes year, Paycheck owner)
  debounceMs?: number                     // default 250
}

interface Sandbox<S, R> {
  scenario: S
  set: (patch: Partial<S> | ((s: S) => S), opts?: { immediate?: boolean }) => void
  reset: () => void
  baseline: R | null
  result: R | null
  busy: boolean
  error: string | null
  stale: boolean                          // result is older than scenario
  pins: Pin[]; pin: (label: string) => void; unpin: (id: string) => void
  pinResults: Record<string, R | 'pending' | { error: string }>
}
```

- **The URL is the state.** `scenario` derives from `useSearchParams` through `decode`; `set` encodes
  and writes `replace`. No second copy of the knobs lives in React state (the `useScope` rule).
- **Trailing-edge debounce, one flight.** Slider `input` events call `set` plainly; box commits,
  presets, pin loads and arrival pass `immediate`. A sequence ref drops non-current responses
  (`WhatIfPanel`'s and `ProjectionPage`'s guard); `AbortController` is not used.
- **Baseline** comes from every two-sided response through `baselineOf`, or from one empty run
  (Projection reuses its `projection:default` snapshot). Compare columns display server deltas.
- **Keep last on failure.** A failed run leaves `result`, sets `stale` and the server's sentence as
  `error`; `Feed` renders the "showing earlier data" line. With no result the error shows alone.
- **Never cached.** Requests ride `apiReadOnly`; results never enter the snapshot cache
  (`ProjectionPage`'s rule for knob-parameterized payloads).
- **Pins.** `pin(label)` appends `{ id, label, createdAt, entries: encode(scenario) }` to
  `finance.sandbox.<page>`; a fourth is refused with the toast "Unpin one first". On mount and on every
  `dataKey` change each pin runs `preview(decode(entries))` into `pinResults`; a 404/409/422 (sold lot,
  deleted profile, missing key) renders the server's sentence in that column with Unpin. Storage is
  validated with the URL's decoder; a corrupt blob reads as empty.

## 8. Control grammar

### 8.1 SandboxPanel

A `.card` with the eyebrow "Try it — {subject}" (Paycheck), "What if — {year}" (Taxes) or "Scenario"
(Projection), an `InfoHint` ending "— nothing is saved", and a header toggle with `aria-expanded` —
closed by default on Paycheck and Taxes, open on Projection where the knobs are the page. Body order:
`PresetRow` · controls · `CompareTable` · pin row (label box, "Pin this scenario", pinned chips, "Copy
link") · Apply slot. Reset to actual sits in the header, disabled when the scenario is empty. Loading
and stale states come from `Feed`.

### 8.2 SliderBox

```ts
interface SliderBoxProps {
  id: string; label: string; hint?: string
  kind: 'percent' | 'money' | 'plain'
  value: string              // wire vocabulary; '' = not set (derived / actual)
  actual: string | null      // the baseline's value: the track tick and the reset target
  min: string; max: string; step: string
  onChange: (next: string, commit: boolean) => void
  disabled?: boolean
}
```

A labelled `<input type="range">` above an `AmountInput` of the same `kind`. The box shows percents
(`shiftPoint(value, 2)`) while the slider runs on the fraction, so the two cannot disagree by a unit.
Dragging emits `commit=false`; release, blur and Enter emit `commit=true`. A tick on the track and a
muted caption ("actual 13.0%") show the baseline; clicking the caption resets that knob alone. A
`DeltaChip` shows the knob's difference from actual ("+2.0 pp", "+$50.00"). Arrow keys step the slider;
the box keeps `AmountInput`'s select-all, Escape-revert and canonicalize-on-commit.

### 8.3 DeltaChip and CompareTable

`DeltaChip` renders a signed, formatted delta with `toneOf`; `invert` flips the color for cost lines so
a rise reads red (`WhatIfPanel.inverted()` promoted to a component). `CompareTable` is a `data-table`
whose rows the page declares (`{ key, label, kind, invert? }`) and whose columns are Baseline ·
Scenario · Δ, then one per pin headed by its label and an Unpin button. The Δ column indexes the
server's delta object by `key`; pinned columns show values only; null is the em dash. A `Segmented`
toggle above the table switches units where the payload has several (Paycheck: Per check / Monthly /
Annual).

### 8.4 Presets

A `PresetRow` chip sets several knobs at once with `immediate`. A preset is a function of the baseline
payload and reference data already on the page; the URL carries the expanded knobs, never the preset's
name, so a link models what was modeled even if a limit changes later. A preset whose datum is missing
renders disabled with a `title` naming what to enter and where ("Enter this year's 401(k) limit in
Settings › Limits").

### 8.5 Pins

Three per page; the default label names the first two changed knobs ("401(k) 15% · HSA $250"). Pins
persist across sessions and re-run on the Taxes year switch. Pins are never part of a link; "Copy link"
copies the live scenario's URL.

### 8.6 Apply

The Apply slot renders only when the scenario is non-empty and the page has a write path, and never
posts on its own. Paycheck hands the scenario to `ProfilesPanel`'s form (§9); Taxes confirms
`changed_inputs` before → after, then calls the existing inputs PUT (§10); Projection renders no slot.
The confirmation is one house-register sentence ("This writes 2 inputs to 2026's stored return and
reloads the form below. Continue?"), and the page's normal invalidation (`api()`) fires once, on the
write.

## 9. Paycheck "Try it"

**Base.** The profile the breakdown is showing — the pinned row (`profile_id`) or the owner's profile
in force (`person_id` from the shell's owner scope), the same two selectors `GET /breakdown` takes.

**Knobs:** `trad_401k_pct` (0–50 %, step 0.5 pp), `roth_401k_pct` and `after_tax_401k_pct` (0–50 %),
`espp_pct` (0–15 %, the §423 ceiling), `hsa_per_check` ($0–$500, step $5) beside an `hsa_coverage`
toggle, `withholding_pct` (0–60 %, step 0.1 pp — the profile's one all-in rate, so a W-4 change is
expressed here; the hint links to the Taxes withholding card's per-check remedy), `annual_salary` and
`pay_periods_per_year` (boxes only). `dental_vision_per_check` flows through unchanged.

**Presets:** Max 401(k) (elective limit ÷ salary into `trad_401k_pct`, Roth untouched); Max HSA
(coverage limit ÷ periods); Max ESPP (the lesser of 15 % and the §423 limit ÷ salary); Stop ESPP.
Limits come from the pace rows already in the payload (`pace[].limit`; null → chip disabled).

**Compare rows:** the eleven waterfall lines plus `savings` (payroll-saving lines summed server-side —
the figure the projection consumes), under a Per check / Monthly / Annual toggle over the payload's
three blocks. Withholding and deductions use `invert`. The pace strip re-renders from `pace.scenario`,
so Max 401(k) visibly turns its row green.

**Apply:** "Save as profile effective …" pre-fills `ProfilesPanel`'s new-profile form with the
scenario's values and the first of next month, scrolls it into view and focuses the date; the user
clicks the form's own Add profile, the only write. The sandbox never PATCHes.

## 10. Taxes what-if 2.0

Builds on the shipped panel (sale legs, ESPP legs, the D1 overrides editor, `changed_inputs`,
warnings) and the existing endpoint.

- **Live.** Legs and overrides become the `S` of `useSandbox`, `debounceMs: 400` (the endpoint folds
  the portfolio on every call); the Run button is retired. Client-side pre-validation stays and
  withholds the request while a leg is invalid: `error` names the leg, `stale` stays false.
- **Side-by-side.** `CompareTable` rows: federal, state, NIIT, Medicare, Social Security, disability,
  capital gains, total tax, take-home, effective rate — Baseline | Scenario | Δ from `WhatIfDelta`,
  which gains `niit_tax` (§13). The two Δ tiles stay as the headline; the audit's per-jurisdiction Δ bar
  is a `ChartCard` with `itemTooltip` and `divergingVisualMap({ center: 0 })` (chart grammar §6, §7,
  §12).
- **Presets:** Max 401(k) (`trad_401k_contributions` = the year's elective limit); Max HSA
  (`hsa_contributions` = coverage limit − `hsa_contributions_employer`); Sell all {ticker} (one
  full-position leg per held ticker, at most six chips); Realize gains to the 15 % ceiling (a leg sized
  so `ltcg_total` lands on the 0 %/15 % threshold of the year's capital-gains table — headroom read from
  data already on the page, then priced by the server; disabled without a CG table or a gain). No Roth
  conversion: the engine has no conversion key.
- **Pins:** up to three (§8.5), re-run on year switch.
- **URL:** the `whatif` family with `sale:` / `espp:` / `<input_key>:` entries; legacy aliases
  normalized (§6); `?year=` untouched.
- **Apply:** overrides only — "Apply N overrides to {year}" → confirmation before → after →
  `PUT /taxes/years/{year}/inputs` through the existing client → the inputs form remounts
  (`WithholdingPanel`'s D4 Apply posture, unsaved-edits check included). Sale and ESPP legs are
  hypothetical and never applied; recording a real sale belongs to Portfolio and ESPP.

## 11. Projection scenarios

The eight knobs and the retirement months move into `ScenarioPanel`, driven by `useSandbox` over
`fetchProjection` — a GET that is already pure and echoes the values it used.

- **Live knobs**, `debounceMs: 300` (the Monte Carlo is the costliest preview). Blank still means
  "derived": a blank knob is absent from the URL, the empty run's echo seeds the placeholder and the
  `actual` caption, and Reset to derived is `reset()`. A blank knob wears a "derived" badge; a typed one
  shows its delta chip against the echo.
- **URL:** `whatif=annual_return:0.06`, `whatif=monthly_contribution:5400`,
  `whatif=retire:2:2035-06` — the same keys as the query the page sends, so a link is the request.
- **Pins and compare.** Each pin's deterministic `projected` line joins the investable `ChartCard` as a
  **reference series** in the chart grammar's sense (§10: "a comparison with its own data" →
  `referenceLine()`, listed under `references` in `axisTooltip`, end-labelled with the pin's name); the
  fan stays the live scenario's. Compare rows: FI target, FI ratio, FI date, coast date, probability,
  p10 / p50 / p90 dates, monthly contribution. `MC_SEED` is fixed, so scenarios differ only by their
  knobs, never by sampling noise — the hint says so.
- **No Apply.** Nothing on this page is stored; the withdrawal rate lives in Settings and the panel
  links there.

## 12. Assistant seam (design only)

The assistant already runs `run_tax_whatif` in-process. The seam is one server-side encoder and one
optional field, built in the assistant grounding lane:

- `app/services/sandbox_links.py` — `sandbox_link(page, entries) -> str` produces `/taxes?whatif=…`
  (later `/paycheck?…`, `/projection?…`) with the grammar of §6, allow-listed to the three sandbox
  paths. A parity fixture, `tests/fixtures/sandbox_entries.json`, is mirrored into
  `src/sandbox/scenarioUrl.test.ts` so encoder and decoder are pinned to the same strings.
- `_run_tax_whatif` adds `sandbox_url` to its compact result; the `tool_result` SSE payload gains
  `link?: { to: string; label: string }`; `assistantStream.ts` passes it through and the drawer renders
  an internal `Link` chip "Open in What-if →" under the tool chip. Only NAV paths are ever rendered as
  links (audit §11 idea 8's allow-list rule).
- Future tools (`run_paycheck_preview`, `run_projection`) reuse the encoder; publishing live sandbox
  entries into the assistant's page context (`viewState.ts`) is the grounding lane's work.

## 13. Backend changes

| Change | Where |
|---|---|
| `POST /paycheck/preview` | `app/api/paycheck.py`, `app/schemas/paycheck.py` |
| `_resolve_breakdown_profile(db, profile_id, person_id, today)` and `_scenario_profile(base, overrides)` extracted; `get_breakdown` uses the first | `app/api/paycheck.py` |
| `WhatIfDelta.niit_tax: Decimal \| None` | `app/schemas/taxes.py`, `app/api/taxes.py` |
| `forbid_writes` fixture + purity walk | `tests/conftest.py`, `tests/test_sandbox_purity.py` |
| `sandbox_links.py`, `sandbox_url`, `link` on `tool_result` | assistant lane (§12) |

**`POST /paycheck/preview`** — request:

```json
{ "profile_id": 7, "person_id": null,
  "overrides": { "trad_401k_pct": "0.15", "hsa_per_check": "250.00", "hsa_coverage": "family" } }
```

`profile_id` / `person_id` select the base exactly as `GET /breakdown` does (explicit row wins; absent
= the primary's profile in force; 404 "no paycheck profiles"). `overrides` is `ProfileOverrides`,
`extra='forbid'`, every field optional, validated by the writers' own helpers word for word: salary
positive within `MONEY_MAX_ABS_12_2`, per-check amounts non-negative within `PER_CHECK_MAX_ABS`, pcts in
[0, 1] with the mis-scale message, periods 1–366 (`PAY_PERIODS_MESSAGE`), coverage in `HSA_COVERAGES`.
The scenario is a dataclass copy of the ORM row with overrides applied — `paycheck_calc.breakdown` and
`limit_check.paycheck_pace` already accept "anything with its columns". `today` is read once for both
the profile and the limits year.

Response:

```
{ "profile": ProfileOut,
  "per_check": { "baseline": Lines, "scenario": Lines, "delta": Lines },
  "monthly":   { "baseline": Lines, "scenario": Lines, "delta": Lines },
  "annual":    { "baseline": Lines, "scenario": Lines, "delta": Lines },
  "pace":      { "baseline": [PaceItemOut], "scenario": [PaceItemOut] },
  "changed":   [ { "key", "label", "before", "after" } ],
  "warnings":  [ …scenario-side CONTRIBUTIONS_WARNING / NEGATIVE_NET_WARNING… ] }
```

`Lines` is the eleven waterfall keys plus `savings` (trad + Roth + after-tax + ESPP + HSA —
`PAYROLL_SAVING_KEYS`). Monthly and annual blocks are scaled server-side on the full-precision chain,
then quantized; every delta is the difference of two `half_up2` figures, so the Δ column can never
contradict its neighbours (the what-if endpoint's rule). The handler performs SELECTs only — no `add`,
`flush` or `commit` in its call graph — and the purity walk proves it.

**`WhatIfDelta.niit_tax`** is `scenario.niit.tax − baseline.niit.tax` when both summaries carry a NIIT
block, else null — additive, so the assistant's compact result and older payloads keep validating.

No migration. No change to `GET /projection`.

## 14. Testing

**Pytest.**
- `test_paycheck_preview_api.py`: empty overrides → `baseline == scenario`, zero deltas, `baseline`
  equal to `GET /breakdown` field by field; overrides → `scenario` equal to `GET /breakdown` of a profile
  created with those values in the same test, then deleted (parity with the real compute); every 422
  text equals the writer's; unknown key; 404 with no profiles; `profile_id` beats `person_id`;
  `changed` lists only moved keys; scaling and `savings` pinned against hand figures.
- `conftest.forbid_writes` attaches `before_flush` to the test session and fails on any flush.
  `test_sandbox_purity.py` walks `app.routes`; for every path ending in `/preview` or `/what-if`, and for
  `GET /projection`, it calls the route with a valid body under `forbid_writes` and asserts every
  table's row count is unchanged — the conformance test that no sandbox path writes.
- `test_tax_whatif.py` / `test_taxes_api.py`: `niit_tax` equals the two summaries' difference; null
  without a NIIT block. `test_assistant_tools.py`: `sandbox_url` matches the parity fixture; a
  non-sandbox page is refused.

**Vitest.**
- `scenarioUrl.test.ts`: encode∘decode identity for every entry kind; garbage dropped; last-wins on a
  duplicate key; legacy alias recognition; the shared parity fixture.
- `useSandbox.test.tsx` (fake timers): a drag collapses into one trailing request; `immediate` bypasses
  the debounce; a stale sequence is dropped; arrival runs at once; failure keeps `result` and sets
  `stale` and `error`; `reset` empties the URL and restores baseline; every write uses `replace`; pins —
  max three, corrupt storage ignored, re-run on `dataKey` change, per-pin error column.
- `SliderBox.test.tsx`: fraction ⇄ percent; drag vs release commit flags; actual tick and caption
  reset; delta chip text. `CompareTable.test.tsx`: columns, inverted tones, em dash, pinned header.
- `sandboxConformance.test.ts`: reads every file under `src/sandbox/` and the three panels as text and
  asserts none imports `api` from `../api/client` (only `apiReadOnly`) or contains a mutating `method:`;
  the Apply handlers live in the pages, which the test excludes.
- Page tests: `TryItPanel` (presets from pace limits, disabled chips, Apply pre-fills and writes
  nothing); `WhatIfPanel` (existing tests re-pointed from Run to live; alias → entry rewrite; compare
  rows including NIIT; Apply confirmation lists before → after and PUTs once); `ScenarioPanel` (derived
  badges, URL from knobs, one reference series per pin).

**Smoke:** the audit's headless walk opens each sandbox from a `whatif=` link, drags a slider, pins,
reloads and screenshots in both themes; console errors fail the run.

## 15. Rollout

Prerequisites on main: shell Plan 1 (`Segmented`, `PageFrame`) and Plan 3 Task 1 (`Feed`).

1. **Lane G — shared grammar** (worktree `sandbox-grammar`): `src/sandbox/*`, `whatif.ts` →
   `apiReadOnly`, the parity fixture, unit tests. **Lane B — backend** (worktree `sandbox-backend`,
   `FINANCE_TEST_DB=finance_test_sandbox_be`): `POST /paycheck/preview`, `niit_tax`, `forbid_writes`, the
   purity walk, `previewPaycheck()` and its types. G and B run in parallel and both merge before phase 2.
2. **Three page lanes**, independent once G + B are on main: **P** Paycheck `TryItPanel`
   (`sandbox-paycheck`); **T** Taxes `WhatIfPanel` rewiring, presets, pins, alias normalization,
   drill-in links emitting the new form (`sandbox-taxes`); **J** Projection `ScenarioPanel`, URL, pins,
   reference series (`sandbox-projection`). Any backend test a page lane needs runs on
   `finance_test_sandbox_<lane>`.
3. **Lane A — assistant seam** (`sandbox-assistant`, `FINANCE_TEST_DB=finance_test_sandbox_a`):
   `sandbox_links.py`, `sandbox_url`, `link` on `tool_result`, the drawer chip. It depends only on G's
   parity fixture, so it runs alongside phase 2.
4. **Verify:** full pytest and vitest, tsc, lint, build; the smoke walk; the README's frontend section
   gains a "Sandboxes" paragraph naming the URL grammar and the no-write rule.

Every lane runs subagent-driven development with a reviewer; implementers on Opus per the standing
mandate; local commits only.

## 16. Out of scope

Server-saved scenarios (Data lifecycle spec); the YTD-anchored max-out helper and "cap reached in
October" projection (needs a per-year YTD anchor the profile lacks); the ESPP contribution optimizer
and the MFJ-vs-single comparison (their own solvers and tables); the equity price-scenario strip (Comp
and ESPP); flat-dollar extra withholding on the paycheck (no column); multi-year tax scenarios;
keyboard chords for sandboxes; mobile.

## 17. Risks and mitigations

- **Refactoring the 793-line `WhatIfPanel`** under live tests: the lane keeps the leg forms and every
  visible string, swapping only the state-and-run layer; tests that clicked Run are re-pointed.
- **Unit confusion** (fraction vs percent): URL, body and hook are fractions; only `SliderBox`'s box
  shifts; the round-trip and slider tests pin both directions.
- **Request churn**: at most one request per debounce window, stale answers dropped; the per-IP limiter
  sits far above that, and previews never invalidate the snapshot cache — fixing, in passing,
  `whatif.ts`'s Run-clears-every-snapshot behavior.
- **Pins that outlive their data** (sold lot, deleted profile, a year without a key): the server's
  sentence renders in that column with Unpin; nothing is silently zeroed.
- **URL length**: twenty legs stay well under 2 KB; `URLSearchParams` owns the encoding.
- **Clock**: `what_if` reads `date.today()` while the withholding card reads `product_today()`; the
  preview follows `paycheck.py`'s `date.today()` for parity with `GET /breakdown`, and the divergence is
  left to the Taxes lane.
- **Two tabs, one storage key**: the last pin writer wins; each tab's URL keeps its own live scenario,
  so nothing on screen moves underneath the user.

## Summary for the coordinator

1. Live scenario state lives in the URL as a repeated `whatif=<kind>:<fields>` family in the server's wire vocabulary, written `replace`-style; `?whatif=TICKER` / `?whatif-lot=` remain as normalized aliases.
2. Pins (max three per page) live in localStorage `finance.sandbox.<page>` as entry arrays and re-run on mount; server-saved scenarios are deferred to the Data lifecycle spec.
3. Server owns the math: `POST /paycheck/preview` (new, pure), `POST /taxes/what-if` (+ `niit_tax`), `GET /projection` (unchanged); every preview rides `apiReadOnly` and never touches the snapshot cache.
4. `useSandbox` = URL ⇄ scenario, trailing-edge debounce, sequence guard, baseline, keep-last-on-failure with `stale`, pins re-run on `dataKey`.
5. Control grammar: `SandboxPanel`, `SliderBox` (range + AmountInput, actual tick, delta chip), `DeltaChip`, `CompareTable`, `PresetRow`; anything drawn uses the chart grammar's `ChartCard`, tooltips and `referenceLine()`.
6. Apply never adds a write path: Paycheck pre-fills the profile form; Taxes PUTs overrides after a before → after confirmation; Projection has none.
7. Assistant seam: `sandbox_links.py` encoder + `sandbox_url` on `run_tax_whatif` + `link` on `tool_result` + a drawer chip, built in the assistant lane against a shared parity fixture.
8. Testing: pytest parity with the real compute and a `forbid_writes` purity walk over every preview path; vitest round-trip, debounce and pins; a source-text conformance test that no sandbox module imports `api`.
9. Plan split: G (grammar) ∥ B (backend, `finance_test_sandbox_be`) → P ∥ T ∥ J (page lanes in worktrees) with A (assistant, `finance_test_sandbox_a`) alongside → verify.
10. Prerequisites: shell Plan 1 (`Segmented`/`PageFrame`) and Plan 3 Task 1 (`Feed`) on main; implementers on Opus; local commits only.
