# The app's sense of time, "Will I owe?" and the retirement projection (2026-09-23) — design record

**Status:** **approved for implementation 2026-09-24** (the user, on this record: "looks good,
proceed."). Written 2026-09-23 against main @b33c202b (batch 1 and the drag-reorder batch have since
been pushed; the test speed-up is on local main @60b6191f). Real-data copy for §V4 prepared by the
controller 2026-09-24: `finance_realdata_b2` = `finance_realdata` cloned, migrated f12026091203 →
f12026092301 (row counts otherwise identical) and seeded with prod's September change-log history
(41 rows; script `…/scratchpad/batch2/setup/seed-sept-changelog.sql` in the 06a5d2e6 session
scratchpad); read-only from here on. Source: the
2026-09-22 fresh-eyes audit (`scratchpad/audit-2026-09-22/`, gitignored), items **#1** (the app's
sense of time), **#3** ("Will I owe in April?") and **#4** (the retirement projection), with the
research maps written today (`scratchpad/batch2-research/{time-model,tax-owe,projection}-map.md`).
Batch 1 (quick fixes, speed, charts) is `2026-09-23-quick-fixes-speed-and-chart-cleanup-design.md`;
this record follows its structure.

**Review round (2026-09-23).** An adversarial review (C1, I1–I7, 22 minors) is applied throughout,
with the controller's choices: an ended month's spending is **missing / partial / entered**, and a
rent-only month saved during the month stays partial until a save after the month or an explicit
"Confirm {September} spending is complete" (K3, M1, M2; copy in T3, T4, T6, T8, T12); budget
suggestions skip such months (K6) and the spending charts draw them as partial (T12); a grid check
**on or before** a person's first profile is $0 (W1 — Grace 8 checks, $1,950.00); 401(k) and HSA
projections stop at the stored limits (W3); the RSU flag is **stateless**, priced at the close on or
before the 1st of the month (W3); K's clock-grep test carries a shrinking allowlist (K1); "Next" leads
to the due part (M1); a Settings "Plan until (year)" default (R11); the Overview's withholding read is
memoised (W12); and the minors — overdue windows and dates, restamping before the 1st, legacy months,
importer finalization, a current snapshot bounded to next month plus a health check, a process-env-only
override, one reset per index, clamping in every phase, a take-home-shortfall note, cached bytes,
draft staleness, copy fixes, test ownership and reloading open tabs.

**User decisions (binding — quoted, then restated as the rules this record implements):**

- *Time model.* "the Net Worth portion of the monthly update is meant to be a snapshot on the first
  of the month, while the Spending portion ... is meant to be the spending through the last day of the
  month ... I've been recording/finalizing the net worth balances value on the first of the month, but
  then waiting at least until the next month when all of the spending for the previous month is in to
  then record the spending for that month. That's why September is only the rent cost ... The October
  net worth value is simply an un-finalized snapshot, will get updated and finalized on the actual 1st
  of October." And: "sometimes i may record the account balances on the first of the month, but then
  the spending details may get recorded a few days later (not necessarily also on the first of the
  month) because it may take a few days for things like credit card transactions to post, etc. Let's
  make sure we design effectively around that as well". Agreed direction — keep the routine, rewrite
  no history, no data migration: (1) balances are labelled by date ("as of Oct 1"); a month's change
  is named for the month it covers ("September: Sep 1 → Oct 1"); month M's story = M's spending and
  take-home + the change from M's 1st to the next 1st. (2) A snapshot recorded before its date is
  **provisional** (honest "since Sep 1 · N days" labels) and becomes final automatically once updated
  on or after its date; every page (Overview, Projection, card utilization, assistant) uses the same
  latest snapshot with its as-of date and provisional flag. (3) The monthly update has two
  **independent** parts — balances (due on the 1st) and the previous month's spending + take-home (due
  once that month has ended, entered whenever transactions have posted, often days later); saving one
  never touches the other (no re-send of balances on every save, no silent snapshot copy when spending
  is saved for a month without a snapshot — and if such a copy can still arise it counts as
  provisional). Spending is a to-do from the 1st and turns amber only after the 15th. Until entered,
  month M shows its known net-worth change "· spending not entered yet"; averages, savings rate and
  Projection stay on the last complete month. Late-posting charges are plain edits; a month stays open
  until the existing close/review step. One reminder on the 1st lists both parts (the reminder that can
  never fire is fixed). Year to date runs from the Jan 1 balances. No false "missing" / "never
  entered" / "Finish M's update" alerts for months not yet due.
- *"Will I owe?"* Tax inputs stay **typed by hand** ("the tax process is only once a year and fairly
  intensive anyways") — never auto-fed or overwritten. Headline = the balance on the typed inputs; a
  per-person reconciliation strip lists the withholding sources next to what Paycheck, Comp and ESPP
  project, flags differences whose tax effect exceeds **$250** (with hysteresis so live quotes don't
  flicker — met statelessly, W3) and shows "balance if matched"; the existing Apply chips stay explicit user actions, shown
  only when figures differ. Full-year pay basis on both sides (`pay_periods` = checks in the whole
  year). Grace: "I will adjust the payment profile at some later time to capture all of the jobs for
  the year. For now we can consider it starting Sept 1" → checks before a person's **earliest** profile
  count as $0 (and so does a grid check dated on the start day, which pays the half-month before it —
  W1), and every check is priced by the profile effective on its date (sequential jobs = more profiles
  later; the UI says so). Estimated tax payments: none (no new keys). ESPP §423 qualifying cap
  fixed to the IRS rule; ESPP ordinary income no longer charged FICA/SDI; `gross_income` includes the
  ESPP capital-gain components — these can move stored years, documented "moved by design". Sale view:
  proceeds · tax due · net cash · after-tax gain instead of "Δ take-home". Filing status: plain text +
  "Change…" with a confirm naming the consequences, change-logged with Undo. Unsaved tax edits:
  `beforeunload` + sessionStorage drafts with a restore banner (the wizard's pattern — the app uses
  `<BrowserRouter>`, so no `useBlocker`). Percent inputs display as percents (units on
  `ChangedInput`). Deferred: Social Security wage-cap modelling in withholding.
- *Retirement projection.* After the **last** earner retires, withdraw "Annual spend" (the FI-target
  figure) each year, constant in today's dollars; taxes on withdrawals and Social Security are not
  modelled (the page says so). Between retirements the working partner's saving continues and their pay
  is assumed to cover spending (the page says so). **One** Monte Carlo run gives one headline FI date
  (median with its range) **and** "money lasts": the probability it lasts to a user-chosen **"plan
  until" year** (a knob; no birth years, no migration) plus "in 9 of 10 paths it lasts until at least
  YYYY"; ≥ 90 % on track, 75–90 % borderline, < 75 % at risk. Scheduled RSU vests included by default
  (today's quote, after ~32.23 % sell-to-cover withholding labelled "≈ after withholding", only vests
  after the base snapshot's as-of date, stopping at the grant holder's — the primary's — retirement),
  with a toggle. Relabel the two meanings of "p10". Cache results per input set (the fingerprint covers
  every table read). Byte-identical results when the new knobs are off; keep drawing random numbers
  after depletion; no numpy.
- *Historical trend (changed 2026-09-23, relayed by the coordinator — supersedes the earlier
  "remove the curve"):* "can we keep the historical trend curve around along with the actual recorded
  history?" → the tab, its fitted curve, its fit method and its reach all stay; only honesty and labels
  change (R8). Plan vs actual stays a later batch.
- *Server size stays* (1 GB, 2 vCPU, single worker); `/projection` measured 0.8–1.8 s on prod, so speed
  is part of the design (R9).

**House rules** (unchanged from earlier records, restated): money math lives on the server and the
browser never recomputes an engine figure; absent ≠ zero; percents in the UI, fractions on the wire;
copy names the noun and the reason; both themes; desktop widths 1280 / 1600 / 1920 only (no phone
work); every mutating path keeps the ChangeBatch/Undo grammar; sandboxes and what-ifs stay pure
(compute-only); payloads change additively (the assistant reads these endpoints — no field is removed or
renamed, new fields are nullable or defaulted); **one "today"** — the server's `product_today()`
(America/Los_Angeles) — for every rule, delivered to the browser rather than recomputed from the
browser clock.

**Verification data.** `finance_realdata` on the dev Postgres (127.0.0.1:5433) is a byte-verified
restore of prod's 2026-09-23 06:30 UTC nightly. Checked today (read-only): its `alembic_version` is
**f12026091203** (not c4a7e2b9d13f — the nightly predates only the reorder batch's
**f12026092301**, which is main's head). Census on that copy, relied on below: 38 snapshots, 36 recorded
exactly on their 1st, Oct 2026 recorded 2026-09-22, the first (Sep 2023) recorded 2023-09-24, none
NULL; net worth Dec 1 2025 $566,912.72 · Jan 1 2026 $605,273.99 · Sep 1 $806,667.88 · Oct (provisional)
$933,250.90; investable Sep 1 $734,884.53 · Oct $839,559.73; the only month in the balances window
missing a feed is Sep 2026 (spending $2,072.23, no take-home); no month closed, adoption 2026-09-12;
reminder day unset (default 1) and **zero** `ritual:` calendar overrides; 2026 is married-joint, Edward's
profiles 2026-01-01 and 2026-08-17 (both $188,930, 24/yr), Grace's one profile 2026-09-01 ($24,000,
24/yr); 2026 typed inputs: Edward `pay_periods` 20, `w2_salary_checkpoint` $27,000,
`w2_stock_rsus_sold` $120,000, `trad_401k_contributions` $21,965.82, `hsa_contributions` $2,300; Grace
`pay_periods` 10, no 401(k) or HSA rows; **no stored tax year carries a non-zero ESPP component and no
ESPP lot is sold**; 4 RSU grants; NVDA latest quote $228.87 (2026-09-22); 2026 limits: 401(k) elective
$24,500.00, HSA self $4,400.00 / family $8,750.00. The copy's `change_log` holds **one** row (its own
restore line, 2026-09-23 07:08 UTC) — the log is not exported, so no restore carries history. **Prod
facts (read-only census, 2026-09-23):** prod's `change_log` starts 2026-09-04 (201 rows); for month
2026-09-01 it holds `monthly_spending` insert ×19 + update ×1 by source `ui` on 2026-09-07 PT (after a
`repair` delete ×19 on 2026-09-04) and a `monthly_cashflow` insert + delete on 2026-09-07 (no take-home
row remains); every month has a `month_reviews` row with all flags false and none closed. So after
deploy September reads **partial** from Oct 1 (K3 clause (c) is not met). Use the copy read-only;
§V4 says how verification gets a current, migrated copy — seeded with these facts — without ever
writing to `finance_realdata`.

---

## 0. Scope

### 0.1 Items

| # | Item (audit ref) | Lane |
|---|---|---|
| K1 | One "today": the server's day reaches the browser; a dev-only clock override (process environment only) with matching change-log stamps (trust T4, map T4) | K |
| K2 | Snapshot state: as-of date, provisional flag, one current snapshot (the latest up to next month), in every net-worth payload (trust F1, wealth NW-1) | K |
| K3 | Month status: the two parts; an ended month's spending is missing / partial / entered; due / overdue; coverage windows that end at the newest overdue month (data-entry F1, shell F1, review C1) | K |
| K4 | Final once saved on or after its date (restamped when saved before it); a provisional month cannot be closed; legacy months untouched | K |
| K5 | The workbook importer never rewrites a final snapshot's `recorded_on` | K |
| K6 | Budget suggestions skip months whose spending is not complete (review I1) | K |
| T1 | Overview net-worth tile, receipt and "Changes worth understanding" by date | T |
| T2 | Year to date from the Jan 1 balances (trust F2) | T |
| T3 | Needs attention: two parts, to-do vs overdue, no premature alerts | T |
| T4 | Data status and Settings › System "Data through" | T |
| T5 | Settings › Data health checks, plus a far-future-snapshot check | T |
| T6 | One monthly reminder on the reminder day listing both parts | T |
| T7 | Net worth page: labels by date, the current snapshot selectable, provisional points drawn as such | T |
| T8 | Month ribbon: chip states, Edit target, "Back to latest" (trust F3, flows F9) | T |
| T9 | Card utilization and the closing effect read the current snapshot with its date | T |
| T10 | Assistant evidence: a month's net-worth change is the next 1st minus this 1st | T |
| T11 | Copy: glossary, start card, Settings feed card, README | T |
| T12 | Spending and Overview charts draw a partly entered month as partial (review I2) | T |
| M1 | The monthly update's two independent parts: each saves only itself; "Confirm … spending is complete"; "Next" leads to the due part | M |
| M2 | "What's due" strip and the default landing | M |
| M3 | Which months can be opened: no "Start Nov", early next-month balances only | M |
| M4 | "Balances as of … · recorded …" replaces the Recorded-on box; confirm to finalize | M |
| M5 | The review tells the month's story (this 1st → next 1st) | M |
| M6 | Deletes and drafts per part | M |
| M7 | Guide routine and palette copy | M |
| W1 | One payroll start: checks on or before a person's first profile date are $0 (planning T1, income INC-02, review I3) | W |
| W2 | Full-year pay basis on both sides | W |
| W3 | Reconciliation, server: rows (401(k) and HSA capped at the limits), tax effects, stateless flags, balance if matched (trust F5) | W |
| W4 | Reconciliation, UI; inline notes; Apply only when different; Overview to-do | W |
| W5 | ESPP §423 qualifying-disposition cap (income INC-23) | W |
| W6 | ESPP ordinary income out of FICA/SDI; gross income counts ESPP gains (planning T2/W7, INC-24) | W |
| W7 | Sale view: proceeds · tax due · net cash · after-tax gain (planning W5, INC-24) | W |
| W8 | Filing status: text + "Change…", change-logged with Undo (planning T3) | W |
| W9 | Unsaved tax edits survive (planning T7) | W |
| W10 | Units in "Inputs this scenario moved" and the Apply confirmation | W |
| W11 | The Taxes page reads the server's year | W |
| W12 | The withholding read is memoised per data version and day (review minor 22) | W |
| R1 | Engine: partial-retirement phase, drawdown, depletion, lumps — byte-identical when off (planning J1) | R |
| R2 | Retirement semantics in the router; phases echo | R |
| R3 | "Plan until" and "money lasts" (new-features F14) | R |
| R4 | Scheduled vests, on by default (planning J2, new-features F3) | R |
| R5 | Start from the current snapshot (planning J4) | R |
| R6 | One headline FI date; the two "p10"s renamed (planning J3) | R |
| R7 | Page: tiles, chart, knobs, compare rows, receipts, copy | R |
| R8 | Historical trend kept, labelled as a fitted curve (planning J5, changed decision) | R |
| R9 | Speed: result cache per input set; Monte Carlo off the event loop (perf B6) | R |
| R10 | Assistant context, URL grammar, parity fixture | R |
| R11 | "Plan until (year)" default in Settings › Plan assumptions (review minor 15) | R |

### 0.2 Explicitly out of scope

Social Security wage-cap modelling in withholding (income INC-08; the audit's "≈ $4.8K" was not
re-measured and is partly offset by the vest leg's zero SS marginal — tax map §1.4; deferred by the
user) · estimated tax payments (no new keys) · birth years and ages · plan vs actual and saved plans
(new-features F13) · auto-feeding tax inputs from Paycheck/Comp/ESPP · server size · audit items #5–#12
(money checkup, net-worth bridge, concentration, wizard prefill/safer entry, assistant bugs, chart
hygiene, vocabulary, quick fixes) — including the wizard's own `beforeunload`, receipt date formatting
(`MetricInspector` still prints ISO) and the hidden-hint problem (trust F9) · mobile · dividends,
interest and brokerage gains in the reconciliation · a person/owner column on RSU or ESPP tables
(income INC-21) · the withholding check grid's ~1st/16th dates (kept; see W1) · a retirement tax rate
(planning J6).

### 0.3 Lanes, ownership and order

One git worktree + branch per lane. **K goes first and is small**: it lands the contracts every other
lane reads. W and R's engine work do not depend on K and may start at once; T, M and R's router
integration start from main after K merges.

| Lane | Branch | Owns (files other lanes must not edit) |
|---|---|---|
| **K** time contract | `feat/time-contract` | `backend/app/services/clock.py`, `backend/app/config.py` (the override check), `backend/app/main.py` (the header middleware), new `backend/app/services/snapshot_state.py`, new `backend/app/services/month_status.py`, `backend/app/services/changelog.py` (the commit stamp only), `backend/app/services/budgets.py` (the seed window only), `backend/app/services/coverage.py`, `backend/app/api/coverage.py`, `backend/app/schemas/coverage.py`, `backend/app/api/net_worth.py` (summary, timeseries, month GET, and the standalone PUT's restamp flag), `backend/app/schemas/net_worth.py`, `backend/app/services/month_writes.py`, `backend/app/api/month_review.py` (the restamp flag it passes), `backend/app/services/month_review.py` (blockers only), `backend/app/importer/apply.py` (snapshot `recorded_on` only), `backend/app/schemas/metrics.py` (completeness literal), `src/api/client.ts` (header read), new `src/utils/productToday.ts`, `src/utils/months.ts`, new `src/utils/asOf.ts`, `src/charts/partial.ts`, `src/components/spending/budgetMonth.ts`, `src/utils/metricReceipt.ts` (labels), `src/components/settings/LimitsCard.tsx` + `settingsPrefetch.ts` (one year read each) |
| **T** time surfaces | `feat/time-surfaces` | `backend/app/services/health_checks.py`, `backend/app/services/calendar/generators/ritual.py`, `backend/app/services/calendar/__init__.py` (ritual sources), `backend/app/services/assistant_evidence.py`, `src/components/overview/{attention,freshness,ytd,upNext}.ts`, `src/components/overview/{OverviewChanges,DataStatusCard}.tsx`, `src/components/settings/{SystemCard,CalendarFeedCard}.tsx`, `src/pages/NetWorthPage.tsx`, `src/components/networth/**`, `src/components/shell/{ScopeBar,MonthRibbon}.tsx`, `src/components/shell/shell.css` (chip states), `src/components/creditcards/{CardDetail.tsx,closingEffect.ts,verdictCopy.ts}`, `src/components/overview/overviewChartOptions.ts`, `src/components/spending/{spendingChartOptions,spendingHeatmapOptions}.ts`, `src/pages/SpendingPage.tsx` (the ScopeBar `defaultMonth` prop and the chart options' `flows_due` input only), `src/guide/content/start.tsx` |
| **M** monthly update | `feat/monthly-update-two-parts` | `src/pages/MonthlyUpdatePage.tsx` (+ its CSS), `src/components/monthly/**`, `src/components/paletteRegistry.ts`, `src/components/CommandPalette.tsx` (the update entry), `src/guide/content/routines.tsx` |
| **W** Will I owe? | `fix/will-i-owe` | `backend/app/services/withholding_calc.py`, `backend/app/services/pace_walk.py`, `backend/app/services/espp_pace.py`, `backend/app/services/calendar/generators/payroll.py`, `backend/app/api/taxes.py`, `backend/app/schemas/taxes.py`, `backend/app/services/tax_service.py`, `backend/app/services/tax_whatif.py`, `backend/app/tax_keys.py`, new `backend/app/services/tax_reconciliation.py`, `backend/app/api/paycheck.py` + `schemas/paycheck.py` (pace payload), `src/components/taxes/**`, `src/pages/TaxesPage.tsx`, `src/components/paycheck/PacePanel.tsx`, new `src/components/overview/taxDrift.ts` |
| **R** projection | `feat/retirement-projection` | `backend/app/services/projection.py`, `backend/app/services/montecarlo.py`, `backend/app/api/projection.py`, `backend/app/schemas/projection.py`, `backend/app/schemas/app_settings.py` (`plan_until_year`), `backend/tests/fixtures/sandbox_entries.json`, `src/components/settings/PlanAssumptionsCard.tsx` (+ its test), `src/pages/ProjectionPage.tsx` (+ CSS), `src/components/projection/**`, `src/api/projection.ts`, `src/charts/markLine.ts` (`percentileMarks` only), `src/components/assistant/samples.ts`, the projection chart fixtures in `src/charts/fixtures/` |

Shared files, **additive local edits only** (the merge step resolves them): `src/types/api.ts` (every
lane), `src/pages/OverviewPage.tsx` (T: net-worth tile, YTD labels, attention wiring; W: the tax year
read and the tax to-do line), `backend/app/api/calendar.py` (T: ritual sources; W: `_payday_sources`),
`backend/app/services/assistant_context.py` (R: `_projection` and its decoder only),
`src/guide/content/pages-planning.tsx` (W: the Taxes card; R: the Projection card),
`src/guide/content/reference.tsx` (T and R: different glossary entries), `README.md` (T: the time-model
section; W: §7.5; R: the Sandboxes section), `src/components/spending/BudgetPanel.tsx` (K: the
partial-rule import; T: the `defaultMonth` prop), `backend/app/api/app_settings.py` (K: the re-export
of the moved `read_update_due_day`; R: the `plan_until_year` key), `backend/app/services/read_cache.py`
(R: the projection memo; W: the withholding memo).

**Tests are never exclusive.** A lane updates every test its contract change breaks, in whichever file
it lives — K3 breaks T-owned `test_health_checks.py:325-357` at K's merge; T and W both edit
`OverviewPage.test.tsx`; K (summary fields) and R both edit `test_assistant_context.py` — and the
later lane rebases onto the earlier one's version.

**Merge order (to local main):** K → W → R → T → M, gates re-run after each merge (ready-first is
allowed after K, as in batch 1, provided each lane rebases on the current main and re-runs its gates).
Integration points: after T and M the Guide label fence (`guideContent.test.ts`) must pass on merged
main; after R and W the assistant context tests; after all five the real-data walk (§V4).

### 0.4 Cross-lane contracts (owned by K unless stated)

**(a) One today.** Every `/api/…` response carries `X-Product-Today: YYYY-MM-DD` (=
`clock.product_today()`). The browser's `todayIso()`, `currentMonthIso()` and the new `currentYear()`
(`src/utils/months.ts`) return the server's day once any response has carried it, and the browser's
local day only before that (the login page). `useProductToday()` re-renders on a change. Every lane
reads the day through these three functions — never `new Date()` for a rule. Under the dev override
(K1) the change log's stamps follow the same day (`clock.change_stamp()`), so K3's evidence and the
V4 write scenarios agree.

**(b) Snapshot state** — backend `app/services/snapshot_state.py`, the one owner of "provisional" and
"current":

```python
@dataclass(frozen=True)
class SnapshotState:
    id: int
    month: date                 # the key: balances on this 1st
    recorded_on: date | None    # stored; None = unknown
    provisional: bool
    as_of: date | None          # the date the balances describe

def snapshot_state(id, month, recorded_on, today) -> SnapshotState
async def load_snapshot_states(db, today) -> list[SnapshotState]   # ascending by month
def current_and_previous(states, today) -> tuple[SnapshotState | None, SnapshotState | None]
```

Rules: `provisional = month > today or (recorded_on is not None and recorded_on < month)`.
`as_of = month` when final; when provisional, `recorded_on` if it is set and `<= today`, else `None`
("date unknown"). **Current snapshot = the latest snapshot whose month is at most the month after
today's; previous = the one before it.** A snapshot further ahead (only an API client or an import can
store one) is never current — it stays in the timeseries and charts, and T5's health check names it.
Wire shape (`schemas/coverage.py`, re-exported where used):

```python
class SnapshotStateOut(BaseModel):
    month: date
    as_of: date | None
    recorded_on: date | None
    provisional: bool = False
```

**(c) Time status** — `GET /coverage` gains `time: TimeStatusOut | None = None` (null only on an empty
book), computed by `app/services/month_status.py` from rows `load_coverage` already reads:

```python
class BalancesPartOut(BaseModel):
    month: date            # the current month: the balances due on its 1st
    status: Literal["final", "provisional", "missing"]
    due_on: date           # = month
    overdue_from: date     # min(reminder date of `month` + 6 days, the month's last day)
                           # (default: the 7th)
    overdue: bool          # status != "final" and today >= overdue_from
    snapshot: SnapshotStateOut | None

class FlowsPartOut(BaseModel):
    month: date                     # a month that has ended
    spending: Literal["missing", "partial", "entered"]   # K3's rule
    spending_entered: bool          # == (spending == "entered"); kept for readers
    spending_saved_on: date | None  # product date of the newest spending write in the change log
    take_home_entered: bool         # a take-home row (0.00 counts)
    due_on: date                    # the 1st of the next month
    overdue_from: date              # reminder date of the next month + 15 days (default: the 16th)
    overdue: bool                   # today >= overdue_from

class TimeStatusOut(BaseModel):
    today: date
    current_month: date
    reminder_day: int                       # app setting calendar_update_due_day, default 1
    current_snapshot: SnapshotStateOut | None
    previous_snapshot: SnapshotStateOut | None
    balances: BalancesPartOut
    flows_due: list[FlowsPartOut] = []      # every ended month from the first snapshot month on
                                            # whose spending is not "entered" or whose take-home
                                            # is missing, newest first
    provisional_past: list[SnapshotStateOut] = []  # months before the current one whose snapshot
                                            # is still provisional (recorded early, never saved
                                            # again), newest first; legacy months left out
    last_complete_month: date | None        # the review book's default_month (unchanged rule)
```

"Reminder date of month X" = `date(X.year, X.month, reminder_day)`; thresholds are date arithmetic, so
month length never matters (a day-28 reminder in February puts the flows threshold on Mar 15), and the
balances threshold is capped at the month's last day so a reminder day of 23–28 still turns unsaved
balances overdue inside their own month.

**(d) Label builders** — `src/utils/asOf.ts` (pure, tested; T and M both use them):
`formatAsOf(state)` → "Oct 1" (with ", 2025" outside the server's current year) or "date unknown";
`asOfPhrase(state)` → "as of Oct 1" / "as of Sep 22 · provisional"; `changePhrase(previous, current,
{ period })` → "September: Sep 1 → Oct 1" (both final, consecutive months — the user's own wording),
"since Sep 1 · 21 days" (current provisional; days = `daysBetween(previous.as_of, current.as_of)`),
"since Sep 22 · 40 days (Oct 1 balances stayed provisional)" (the previous snapshot is still
provisional), "since Aug 1 · 2 months" (both final, a gap), "since Jul 1" (quarterly);
`storyNote(flows)` → " · spending not entered yet" (spending *missing*) or " · spending not complete
yet" (*partial*) while that month is listed in `flows_due`, else nothing. `daysBetween` lives in
`utils/months.ts` and uses `Date.UTC` (never `new Date(isoString)`).

**(e) Completeness** — `MetricEvidence.completeness` gains `"provisional"` (backend literal and
`COMPLETENESS_LABELS.provisional = 'Provisional — recorded before its date'`).

**(f) Withholding** (owned by W) — `WithholdingOut.reconciliation: ReconciliationOut | None = None`
(W3). The Overview reads only `reconciliation.flagged_count` and `.rows[].tax_effect` (W4), through the
memoised read (W12).

**(g) Projection** (owned by R) — additive `ProjectionOut` fields in R2–R5; the assistant reads them
through `assistant_context._projection` (R10).

**(h) Plan-until setting** (owned by R) — `GET/PUT /settings` gain `plan_until_year: int | None`
(app_settings key `plan_until_year`, envelope `{"value": 2075}`; R11); the projection reads it through
`read_plan_until_year(db)` and echoes where its year came from (R3).

### 0.5 Migrations: none

Confirmed item by item: K adds no column (as-of and provisional derive from the existing `month` and
`recorded_on`; finalization and restamping write a value; the partial-spending rule reads the existing
`change_log` and `month_reviews`; the header, override and change stamp are code; the budget seed is
code); T keeps the reminder's event keys, adds a health check in code and touches no table; M writes
through the existing month-review PUT (the Confirm is a PUT with no legs); W relabels `pay_periods` in
code (`tax_keys.label_for` serves labels from code — no seed rewrite), change-logs through the existing
`change_log`, adds no tax key, and memoises in process memory; R's knobs are query parameters, its
plan-until default is an `app_settings` key (a row, not a column) and its cache lives in process
memory. **The export head therefore does not move in this batch.** It does move at deploy if the
(unpushed) reorder batch ships in the same deploy — see §V5.

### 0.6 Decisions this record takes that the user did not

Listed so they can be vetoed before planning (items marked *(review)* were adopted by the controller
from the 2026-09-23 review): (1) a final snapshot's as-of is its 1st even when it was recorded later
(Sep 2023, recorded Sep 24, reads "as of Sep 1, 2023"; the receipt shows the recorded date); (2) "N
days" counts from the previous balances' date to the provisional recording date (Sep 1 → Sep 22 =
**21** days; the direction's "22 days" example was written on Sep 23); (3) any balances save of a
provisional snapshot restamps its recorded date — on or after the 1st that makes it final (a "Confirm
Oct 1 balances" button covers the unchanged case), before the 1st it stays provisional with the new
date; legacy (`unreviewed_history`) months are never restamped *(review)*; (4) closing a month is
blocked while that month's own snapshot is provisional (not for legacy months); (5) the wizard's
Recorded-on box becomes read-only text; balances may be recorded early only for next month; spending
cannot be entered for months that have not begun; (6) overdue thresholds follow the reminder day
(defaults: balances amber from the 7th — today's nudge day — capped at the month's last day; flows from
the 16th); (7) the importer never rewrites a final snapshot's `recorded_on` and finalizes a provisional
one whose balances it changes on or after the 1st *(review)*; (8) reconciled rows are salary wages,
traditional 401(k), employee HSA, RSU income and ESPP sale income — not dental/vision, employer HSA,
bonuses, dividends/interest or brokerage gains; (9) the flags are **stateless**: flagged =
|tax effect| > $250, and on the RSU row only the not-yet-vested vests are priced, for the flag, at the
close on or before the 1st of the month after a ±10 % band (the displayed figures stay on today's
quote) *(review, controller)*; (10) a grid check **on or before** a person's first profile date is $0 —
the 1st-of-month check pays the half-month before it — and the same rule applies to the Paycheck pace
walk and the calendar's paydays, which are priced by the profile in force on their date *(review)*;
(11) the Overview surfaces tax drift as one Needs-attention line, not on the tile, read through a
memoised withholding call *(review)*; (12) the sale view's "tax due" excludes overrides;
(13) projection "plan until" defaults to a Settings year when one is stored (R11), else the latest year
whose December is on the axis (2055 today), and a later year lengthens the horizon; the partial phase
saves only the working partner's payroll deductions and employer match, and says so when that
partner's take-home is below your spending *(review)*; the growth-only line never withdraws; vests are
flat in today's dollars; every phase clamps at $0 *(review)*; (14) the Monte Carlo runs in a worker
thread with a capacity of one; (15) a dev-only `PRODUCT_TODAY` override exists for tests and real-data
checks, read from the process environment only, and the change log stamps the overridden day
*(review)*; (16) an ended month's spending counts as entered only when certified, never logged, saved
after the month, or confirmed after the month — a take-home save never completes it — with a "Confirm
{September} spending is complete" action *(review, controller)*; (17) the current snapshot is the
latest up to next month, and a health check names anything further ahead *(review)*; (18) the 401(k)
and HSA projections stop at the year's stored limits *(review)*; (19) on the current month's Balances
step "Next" goes to the previous month's spending while it is due *(review)*.

---

## K. The time contract (lane K)

### K1. One "today", delivered by the server

**Problem.** The backend keeps one product clock in Pacific time (`backend/app/services/clock.py:33-40`)
but the browser decides "has the 1st arrived / has the month ended / which year is it" from its own
clock: `src/utils/months.ts:16-28`, a private copy in `src/pages/MonthlyUpdatePage.tsx:66-71`, a second
partial-month rule in `src/components/spending/budgetMonth.ts:93-98`, and direct year reads at
`src/pages/OverviewPage.tsx:384`, `src/pages/TaxesPage.tsx:194, 309, 886`,
`src/components/settings/LimitsCard.tsx:37`, `settingsPrefetch.ts:138`. Around midnight, and off
Pacific time, the two disagree. There is also no way to run the real-data copy "as of Oct 1".

**Decision.**
- Backend: an HTTP middleware adds `X-Product-Today: <product_today().isoformat()>` to every response
  whose path starts with `/api/` (errors included). Same-origin in prod (nginx) and dev (Vite proxy);
  also listed in the CORS middleware's `expose_headers` for cross-origin dev setups.
- Backend dev override: `clock.product_today()` returns `PRODUCT_TODAY` (ISO date) when that variable
  is set in the **process environment** (`os.environ` only — e.g. `PRODUCT_TODAY=2026-10-01 uvicorn …`;
  the clock module keeps importing nothing from the app) **and** the process environment's
  `ENVIRONMENT` is unset or `dev`. A `PRODUCT_TODAY` line in `backend/.env` is ignored by the clock and
  by the validator alike: `Settings` declares no field for it. `Settings._validate_safety` refuses to
  start when `os.environ` carries `PRODUCT_TODAY` and `settings.environment` is anything other than
  `dev` (prod sets `ENVIRONMENT: prod`, `docker-compose.prod.yml:8`); startup logs one WARNING line
  naming the override. `product_now()` is unchanged (instants stay real).
- Change-log stamps: `ChangeBatch.commit` (`backend/app/services/changelog.py:132-140`) stamps `at`
  with new `clock.change_stamp()` — `datetime.now(UTC)` normally; under the override, the
  `PRODUCT_TODAY` date combined with the real Pacific wall-clock time, converted to UTC — so the
  change-log evidence K3 reads agrees with the overridden day.
- Frontend: `src/api/client.ts` reads the header on every response it handles (success or error)
  before parsing and calls `setServerToday()` in new `src/utils/productToday.ts` (a tiny store:
  `getServerToday()`, `setServerToday()`, `useProductToday()` via `useSyncExternalStore`, and a
  test reset). `todayIso()` / `currentMonthIso()` return the server day when known; new `currentYear()`.
- Sweep (K's files only): `budgetMonth.isMonthInProgress` is deleted and its callers use
  `charts/partial.isPartialMonth(month, todayIso())` — one partial rule; `LimitsCard.tsx:37` and
  `settingsPrefetch.ts:138` use `currentYear()`. The wizard's private `todayIso` goes in lane M (M1),
  the Taxes/Overview year reads in lane W (W11). Deliberate exceptions, documented in
  `productToday.ts`: quote staleness (`src/utils/staleness.ts`, UTC by design — the backend's health
  check is UTC too) and instants (`explainSelection` capturedAt, pin createdAt).

**Acceptance.** Backend: the header is present and equal to the (patched) product day on a 200, a
404, a 422 and a 401; the override works in dev, is ignored for **any** `ENVIRONMENT` other than `dev`
(`prod` included), a value only in `backend/.env` changes nothing, and the settings validator refuses
a process-environment override outside dev; `change_stamp()` returns the overridden date with a real
time of day and `datetime.now(UTC)` without the override, and a batch committed under the override is
stamped on that date. Frontend (vitest): with fake timers at 2026-09-30 23:30 local and a server day of
2026-10-01 in the store, `currentMonthIso()` is 2026-10-01, `isPartialMonth('2026-09-01', todayIso())`
is false and `currentYear()` is 2026; with no server day the functions return the fake local date
(every existing suite passes unchanged); a response header updates the store and `useProductToday()`
re-renders. A grep test fails if `new Date().getFullYear()` or a private `todayIso` reappears outside
`utils/months.ts`, `productToday.ts` and the listed exceptions. At K's merge the reads that other lanes
fix are still there, so the test carries a **named allowlist** — `TaxesPage.tsx` and
`OverviewPage.tsx` (W11), `MonthlyUpdatePage.tsx` (M1) — and W and M each delete their entry in the
lane that fixes the read. After M merges (last in the order; with ready-first merging, after whichever
of W and M lands second) an "allowlist is empty" assertion joins the gate.

### K2. Snapshot state in every net-worth payload

**Problem.** `recorded_on` exists (`backend/app/models/net_worth.py:48`) but no payload outside the
wizard's month GET carries it: `SummaryOut` and `TimeseriesOut` have no date, no provisional flag and no
"compared with what" (`backend/app/schemas/net_worth.py:115-154`). The summary's default is simply the
last snapshot (`backend/app/api/net_worth.py:438-439`) while Projection picks "latest month ≤ today"
twice (`backend/app/api/projection.py:296-304`, `net_worth_calc.py:125-132`). So the Overview says "Net
worth — Oct 2026 … +15.7 % MoM" for a 21-day change and Projection starts from Sep.

**Decision.** `snapshot_state.py` per §0.4(b). Payload additions (all additive, defaults shown):
- `SummaryOut`: `as_of: date | None = None`, `recorded_on: date | None = None`,
  `provisional: bool = False`, `previous: SnapshotStateOut | None = None` (the snapshot the delta
  compares with — the previous quarter end at quarterly grain), `days_since_previous: int | None = None`
  (`(as_of − previous.as_of).days` when both are known).
- `TimeseriesOut`: `as_of: list[date | None]`, `recorded_on: list[date | None]`,
  `provisional: list[bool]`, aligned with `months` after the quarterly filter (all default `[]` for
  replayed caches).
- `MonthBalancesOut` (`GET /net-worth/months/{m}`): `as_of`, `provisional`.
The summary's default becomes the **current snapshot** — the latest one whose month is at most the
month after today's (§0.4(b)); a further-ahead snapshot is still viewable with `?month=` and drawn in
the charts, but never the default. It is the same rule Projection (R5), card utilization (T9) and the
assistant use. Deltas keep their arithmetic (`mom_delta`, `mom_pct` — change into the viewed
snapshot); only their labels change (T1, T7).

**Acceptance.** Unit tests for `snapshot_state` over: recorded on the 1st (final, as-of the 1st);
recorded later (final, as-of the 1st — the Sep 2023 / Sep 24 case); recorded before (provisional,
as-of the recorded day — the Oct / Sep 22 case); NULL (final); month in the future with NULL or with a
date on/after the month (provisional, as-of None); a month that has begun with a recorded date after
today (final by the rule, as-of the 1st — only an API or import can store such a date);
`current_and_previous` skipping a snapshot two months ahead (the one before it is current). API tests:
summary default, `?month=`, `?granularity=quarterly` and owner scopes carry the fields; a snapshot two
months ahead is not the summary default but answers `?month=`; timeseries lists stay aligned after the
quarterly filter; existing exact-payload pins updated additively. On the real-data copy with
`PRODUCT_TODAY=2026-09-23`: summary `month` 2026-10-01, `as_of` 2026-09-22, `provisional` true,
`previous.month` 2026-09-01, `days_since_previous` 21, `net_worth` 933250.90, `mom_delta` 126583.02.

### K3. Month status: the two parts, due and overdue

**Problem.** Coverage's window is "first snapshot … last snapshot" with no today at all
(`backend/app/services/coverage.py:46-83`), so the month in progress — and any early next-month
snapshot — is "missing" spending from its first day: prod shows `spending_missing: [Oct]`,
`net_pay_missing: [Sep, Oct]`, and every consumer (attention, Data status, three health checks, the
ribbon) repeats the false alarm. Nothing says what is actually due. And "entered" means only "a non-zero
amount or a confirmed zero", so September's rent — $2,072.23 saved on Sep 7 — would read as September's
spending from Oct 1, and a take-home typed on the 30th from a paystub would clear the month before the
card charges post (review C1).

**Decision.**
- `month_status.py` computes `TimeStatusOut` (§0.4(c)) from the snapshot states, spending presence (a
  non-zero amount or a confirmed zero), take-home presence, the review rows, the change log, the
  reminder day and today. `read_update_due_day` moves from the router module `api/app_settings.py` into
  `month_status.py` (services may not import routers); `api/app_settings.py` re-exports it, so existing
  importers (the calendar router) are untouched. `balances.status` is `missing` when the current month
  has no snapshot, `provisional` when its snapshot is provisional, else `final`. `provisional_past`
  lists earlier months whose snapshot is still provisional (months before the adoption month are left
  out — legacy history stays as it is).
- **Spending of an ended month M** is *missing* when it has no non-zero amount and no confirmed zero.
  Otherwise it is *entered* when any of the following holds, and *partial* when none does:
  - (a) **Certified.** M has a `closed_at` (closed now or at some point), or M is before the adoption
    month — history the review feature adopted. Either way the user already vouched for it.
  - (b) **No spending write on record.** The change log holds no row-level `monthly_spending` write for
    M: history from before the log began (prod's starts 2026-09-04), months entered only by import (an
    import logs one summary line with no month, `importer/service.py:56-75`), rows past the 400-day
    retention (`snapshot_store.py:44`), and any restored copy (the log is not exported).
  - (c) **Saved after the month ended.** A `monthly_spending` write for M with `source = 'ui'`, dated on
    or after the 1st of M+1 in product time — `(at AT TIME ZONE 'America/Los_Angeles')::date` — from a
    batch that was not later undone (`changelog.undone_by`); undo batches themselves never count.
  - (d) **Confirmed after the month ended.** A `month_reviews` write for M dated on or after the 1st of
    M+1 whose after-image has `spending_reviewed = true` (M1's Confirm), or an import or restore summary
    line dated on or after the 1st of M+1.

  A take-home save on its own never completes spending, and an unchanged save logs nothing
  (`changelog.py:100`), which is why the explicit Confirm exists. `flows_due` lists every ended month —
  from the first snapshot month through `current_month − 1` — whose spending is not *entered* or whose
  take-home is missing, newest first; the current month and later are never listed.
  `spending_saved_on` is the product date of M's newest counted `monthly_spending` write (None when
  there is none). On prod, September 2026 has only `ui` writes dated Sep 7 and no review write, so it
  reads **partial** from Oct 1. The same rule answers a month that is still running (it can only be
  *entered* through (a) or (b) then); `month_status` exposes it as `spending_state(month)` for T6's
  reminder, which lists the month before each reminder date ahead of time.
- **Why the change log and not the review flags.** The flags are honoured only while
  `confirmation_revision` equals M's digest (`services/month_review.py:100-110`) and every PUT resets them
  (`api/month_review.py:109-112`), so a late charge, a balances correction, a new paycheck profile, an
  import or an Undo would silently bring the to-do back. A change-log row is a one-time event that later
  edits cannot erase, and nothing here writes a flag.
- **Query.** One indexed query per `/coverage`, over the candidate months only — ended months that have
  spending and are neither closed nor before the adoption month (none on Sep 23; September from Oct 1):
  `change_log` rows with `month` in the candidates and `table_name` in (`monthly_spending`,
  `month_reviews`), plus summary lines (`op = 'batch'`, source `import` or `restore`) dated on or after
  the earliest candidate's next 1st; undone batches from `undone_by`.
- **Dev clock.** Under the override, K1's `change_stamp()` dates new evidence on the overridden day, so
  the V4 write scenarios read true.
- **Copy for the partial state** — the one wording, implemented by T and M ("due by" = the day before
  `overdue_from`):

  | Surface | Copy |
  |---|---|
  | T3, Needs attention | "Finish {September} spending — entered during September; add what has posted since" (todo) |
  | T3, from the 16th | "{September} spending is still partial — was due {Oct 15}" (warn) |
  | T3, take-home also missing | "Finish {September} spending and enter take-home" |
  | T4, Data status | "Spending through {Aug 2026} · {Sep} partly entered" (then " — due" or " — overdue") |
  | T6, reminder item | "{September} spending — entered during September; add what has posted since" |
  | T8, ribbon | "{Sep 2026} — Sep 1 balances · spending entered during September (partial) · take-home missing" |
  | T12, charts | tooltip head "{September} — spending partly entered (due by {Oct 15})" |
  | `storyNote` | " · spending not complete yet" |
  | M2, strip | "{September} spending & take-home · entered during September — add the rest or confirm" |

- `coverage.classify(…, today, overdue_through)` — the "missing" windows end at the **newest month M
  with `overdue_from(M) <= today`**, not at the last snapshot (with a reminder day of 17 or later that can
  be three months back: with day 28, August's flows are overdue only from Oct 13). `missing` /
  `spending_missing` = window months with no spending rows and no take-home; `net_pay_missing` = window
  months without take-home. `entered`, `empty`, `zero_with_net_pay`, `net_pay`,
  `net_pay_without_spending` and `latest` keep their meaning (coverage's `entered` still counts a
  take-home-only month; spending completeness lives in `time`).
- `GET /coverage` returns `time`. `load_coverage` reads `recorded_on` with the months (one query, as
  now), the reminder day and the evidence query above.
- `last_complete_month` = the review book's `default_month`, whose rule does not change: averages,
  savings rate and Projection stay on the last closed (or legacy-eligible) month.

**Acceptance.** Pure tests for `month_status` at: Sep 23 with an early Oct snapshot and Sep spending
saved Sep 5 (balances final, `flows_due` empty); Oct 1 (balances provisional, not overdue; Sep due with
spending **partial**, `take_home_entered` false); Oct 7 (balances overdue if still provisional; with a
reminder day of 28 the balances threshold is the month's last day); Oct 15 vs Oct 16 (flows not overdue
/ overdue); a month with take-home but no spending and the reverse; a confirmed-zero month; three
missing months (all listed, newest first); a reminder day of 28 on Oct 3 (the missing window ends at
July); a reminder day of 28 in February (flows threshold Mar 15); Dec → Jan (Jan 1 balances missing;
December due); the first snapshot recorded mid-month; `provisional_past` for an Oct snapshot never
saved again, checked on Nov 5; an empty book (`time` null). The spending state, one test each:

| Scenario | Expected |
|---|---|
| Rent saved Sep 5; checked Oct 1 | *partial* |
| Take-home alone saved Oct 1 | still *partial* |
| A spending save on Oct 3 | *entered* |
| That Oct 3 save, then undone | *partial* again |
| A no-change Confirm on Oct 2 | *entered* |
| A spending tick saved Sep 30 | *partial* |
| A save at 17:30 PT on Sep 30 (00:30 UTC Oct 1) | *partial* |
| A closed month (closed, then edited) | *entered* |
| A month before the adoption month | *entered* |
| A month with no change-log rows | *entered* |
| An import summary line dated Oct 2 | *entered* |
| No non-zero amount and no confirmed zero | *missing* |

Coverage tests rewritten for the new windows (`test_coverage_service.py:12-45`,
`test_coverage_api.py:30-100`); one test pins that the evidence query touches only the candidate
months. On the migrated copy seeded with prod's September change-log facts (§V4):
`PRODUCT_TODAY=2026-09-23` → `spending_missing` and `net_pay_missing` empty (were `[Oct]` and `[Sep,
Oct]`), `flows_due` empty; `PRODUCT_TODAY=2026-10-03` → `balances.status` provisional, `flows_due` =
`[Sep: spending partial, spending_saved_on 2026-09-07, take_home_entered false, overdue false]`;
`2026-10-16` → Sep overdue. Without the seed (no change-log history) September reads *entered* under
clause (b) — which is why V4 seeds.

### K4. Final once saved on or after its date

**Problem.** `write_balances` stamps `recorded_on = body.recorded_on or today` on create and rewrites it
only when the client sends it (`backend/app/services/month_writes.py:116-132`); the wizard sends it on
every save, seeded with the stored value or the browser's today (`MonthlyUpdatePage.tsx:558-562, 880`),
so a NULL date is silently overwritten and nothing ever turns an early snapshot final. The server would
also close a month whose own opening balances were recorded before the month began.

**Decision.**
- In `write_balances`, when the snapshot already exists and is provisional (its stored `recorded_on`
  is earlier than `month`) and the body does **not** send `recorded_on`: set `recorded_on =
  product_today()` on **any** balances save, values changed or not. On or after the 1st that makes the
  snapshot final; before the 1st it stays provisional but its as-of moves to the day the values were
  last saved (values updated on Sep 25 no longer read "as of Sep 22"). An explicit `recorded_on` in the
  body still wins (API clients, tests). The restamp is always recorded in the change batch (even on the
  standalone `PUT /net-worth/months/{m}`, which otherwise does not log metadata), so Undo restores the
  earlier date. Final snapshots are never restamped: correcting last March's balance today leaves its
  recorded date alone.
- **Legacy months are never restamped.** `write_balances` gains a keyword `restamp: bool = True`; the
  month-review PUT passes `current.state != "unreviewed_history"` (it already holds the book), and the
  standalone PUT reads the month's state from `load_review_book(db, extra_months=[month])` and passes
  the same. A re-save of a legacy month whose snapshot was recorded early would otherwise move its digest
  off `legacy_revision`, flip it to "changed since review" and drop it from the averages. (No such month
  exists on the copy — only Oct 2026 was recorded early, after adoption — but the rule is general.)
- Creation is unchanged (`recorded_on = body.recorded_on or today`): created on/after its 1st → final;
  created before → provisional. The server keeps accepting any first-of-month (the importer and API
  are unchanged); the wizard is the guard against far-future months (M3). A spending-only save never
  creates or touches a snapshot (the PUT already skips an absent balances leg,
  `backend/app/api/month_review.py:87-91`). Once M1 lands no path in the app sends a balances leg with
  a spending save, so the old silent copy cannot arise; an API client that sends both legs is writing
  balances deliberately and is stamped like any balances write (provisional when before the 1st).
- `classify_month` (`backend/app/services/month_review.py:136-146`) adds one blocker when the month's
  own snapshot is provisional and the month is not legacy history: "{Oct 1} balances were recorded
  early, on {Sep 22} — save them again on or after {Oct 1} before closing {October}." `closed`, the
  digest (`review_input_v1` stays frozen) and every other state rule are untouched.

**Acceptance.** Service tests: provisional + save on/after the 1st with unchanged balances → final,
recorded today, one logged snapshot update, Undo restores the old date; with changed balances → same
plus the balance updates; save before the 1st → still provisional, recorded today (as-of today),
logged, Undo restores; explicit `recorded_on` wins; a final snapshot's date never moves; a NULL date is
not overwritten by a balances save; `restamp=False` (a legacy month) leaves `recorded_on` alone and its
state stays `unreviewed_history` after an unchanged save; a spending-only PUT creates no snapshot.
Month-review tests: the provisional blocker appears only for a provisional, non-legacy month, and on the
real-data copy every month's `state`, `input_revision`, `eligible_spending`, `eligible_savings` and the
book's `default_month` are identical before and after K (only Oct 2026's `blockers` gain the sentence).

### K5. The importer never rewrites a final snapshot's date

**Problem.** A workbook re-import diff-updates every snapshot's `recorded_on` from column B
(`backend/app/importer/apply.py:439-458`) — which can flip a month provisional/final and changes the
review digest of closed months (the fingerprint includes `recorded_on`, `review_input_v1.py:63-65`).

**Decision.** For an existing **final** snapshot the importer leaves `recorded_on` untouched; when the
sheet's column B differs it adds one warning per month: "Net Worth: {Oct 2026} is stored as recorded on
{2026-10-01}; the sheet says {2026-10-03} — the stored date is kept." For an existing **provisional**
snapshot whose balances the import changes on or after its 1st, K4's rule applies: `recorded_on`
becomes the import's product day, so the month is final (a provisional month can never have been
closed — K4's blocker — so no certified digest moves); without a balance change it stays as stored, with
the same warning when column B differs. A new snapshot takes column B, as now (NULL when blank). A row
whose column B is before its month imports as provisional and warns: "Net Worth: {Oct 2026} is dated
{2026-09-22}, before its month — it imports as provisional Oct 1 balances."

**Acceptance.** Importer tests: re-import with a different date keeps a final snapshot's stored date and
warns; a blank column B leaves a stored date alone; a re-import on or after the 1st that changes a
provisional snapshot's balances finalizes it on the import day, and one that changes nothing leaves it
provisional; a new row takes its column B; a pre-month row warns and reads provisional;
`test_importer_apply.py:701` updated.

### K6. Budget suggestions skip months whose spending is not complete

**Problem.** `load_suggestions` builds its window with `seed_window(coverage.entered,
coverage.net_pay_without_spending, current_month)` (`backend/app/services/budgets.py:59-71, 172-173`).
From Oct 1 the rent-only September — non-zero, and before the current month — joins the 12-month seed
window: "dragging every mean down a twelfth and handing nine categories a fake $0 minimum", the failure
the code's own comment warns about (`budgets.py:44-47`). It hits the Budget card's suggestions and its
Seed action every month, from the 1st until the flows are entered. (The review-book averages are safe:
they read eligible months only.)

**Decision.** `seed_window` also drops every month listed in `time.flows_due` whose spending is
*missing* or *partial*; a month listed only for its missing take-home keeps its complete spending in the
window. `load_suggestions` takes those months from the same `load_coverage` call.

**Acceptance.** `seed_window` tests: a partial month is excluded, a month missing only its take-home is
kept, the window still ends before the current month. On the seeded migrated copy at
`PRODUCT_TODAY=2026-10-03` the suggestion window ends at Aug 2026 (it would include Sep without the
rule).

---

## T. Time surfaces (lane T)

### T1. The Overview net-worth tile, its receipt and "Changes worth understanding"

**Problem.** "Net worth — {formatMonth(summary.month)}" + "… MoM" + hint "latest monthly snapshot … the
month before" (`src/pages/OverviewPage.tsx:463, 481, 485`); the receipt's `as_of` is the month key and
its completeness defaults to Complete (`src/utils/metricReceipt.ts:16-18`); the changes card says "since
{Sep 2026}" (`src/components/overview/OverviewChanges.tsx:21`).

**Decision.** From `summary.as_of / provisional / previous / days_since_previous` and the §0.4(d)
builders:
- Label "Net worth — as of Oct 1"; a provisional snapshot reads "Net worth — as of Sep 22" with the
  tile badge **Provisional**.
- Delta "▲ $126,583.02 (+15.7 %) since Sep 1 · 21 days" (provisional) or "▲ $X (+Y %) · September:
  Sep 1 → Oct 1" (final, consecutive; plus `storyNote` — " · spending not entered yet" when
  September's spending is missing, " · spending not complete yet" when it is partial — while September
  is listed in `/coverage` `time.flows_due`), "since Aug 1 · 2 months" across a gap, "since Sep 22 · 40
  days (Oct 1 balances stayed provisional)" after a never-confirmed provisional snapshot. No "MoM"
  anywhere on the Overview.
- Hint: "Assets minus liabilities from your latest balances, dated by when they describe, with the
  change since the balances before them."
- Receipt: `as_of` = the snapshot's `as_of`; `completeness` = `provisional` when provisional; definition
  adds "Recorded {Sep 22}. Balances recorded before their date stay provisional until saved again on or
  after it." when provisional, and only "Recorded {Sep 24, 2023}." for a final snapshot recorded after
  its 1st (nothing for one recorded on its 1st or with no recorded date).
- Changes card: "Largest account movements since Sep 1" (+ " · to Sep 22 (provisional)"), from the
  timeseries `as_of` list.
- The Overview's net-worth trend chart draws a provisional last point with the existing partial style
  (`charts/partial.partialItemStyle`) and its tooltip says "Oct 1 balances recorded early, on Sep 22 —
  provisional".

**Acceptance.** OverviewPage tests (the ≈ 20 "Net worth — Aug 2026" pins and `:672`'s "MoM" pin
rewritten) for final, provisional, gap, NULL-date and owner-scoped cases; receipt completeness; the
changes-card wording. Browser (`PRODUCT_TODAY=2026-09-23`, both themes, 1280 and 1600): "Net worth — as
of Sep 22 · Provisional · ▲ $126,583.02 (+15.7 %) since Sep 1 · 21 days".

### T2. Year to date from the Jan 1 balances

**Problem.** The YTD base is "the last snapshot before January 1" (`src/components/overview/ytd.ts:76-100`)
— Dec 1, so December 2025 counts as 2026: "+$366,338.18 (+64.6 %) since Dec 2025 (through Oct)";
"through" is the last in-year month key, future included (`:135`).

**Decision.** `year = currentYear()` (server). Base = the snapshot keyed `{year}-01-01` in whatever
state; when there is none, the first snapshot keyed in `year` ("since Mar 1 — no Jan 1 balances");
when no snapshot is keyed in `year`, the net-worth row reads "— · Jan 1 balances not recorded yet".
"Through" = the **current snapshot** when it comes after the base (its key may be next year: an early
Jan 1 snapshot recorded Dec 28 still describes Dec 28 of this year), labelled by `asOfPhrase`. When the
base is the current snapshot (Jan 1–31 after the Jan 1 balances), the row reads "$0 so far — the change
starts from your Jan 1 balances". Printed: "▲ $327,976.91 (+54.2 %) since Jan 1 (to Sep 22 ·
provisional)". The flow rows (spending, take-home, saved) keep their existing windows.

**Acceptance.** `ytd.test.ts:60-117` rewritten: Jan 1 base; no Jan snapshot (first in-year base); none
in the year; a provisional current snapshot; an early next-year snapshot recorded in December; January
before and after the Jan 1 balances. On the copy at 2026-09-23: +$327,976.91 (+54.2 %).

### T3. Needs attention: two parts, to-do vs overdue

**Problem.** `update-due` nudges from day 7 for balances only, `spending-missing` names any month in the
balances window (so the month in progress and an early next month are "never entered"), and review rows
add "Finish {current month}'s update" from day 7 (`src/components/overview/attention.ts:52-91, 237-265`)
— every item is premature in the user's routine, and all items look alike.

**Decision.** Attention items gain `tone: 'todo' | 'warn'` (default `warn`; todo items render in the
neutral text colour with the same link affordance). From `coverage.time`:
- **Balances** (when `balances.status != final`): missing → "Record {Oct 1} balances" (todo); provisional
  → "Update {Oct 1} balances — recorded early, on {Sep 22}" (todo); either with `overdue` → "{Oct 1}
  balances are overdue — due {Oct 1}" / "{Oct 1} balances are still provisional (recorded {Sep 22})"
  (warn). Link `/update?month={M}&step=balances`.
- **Flows** (when `flows_due` is non-empty): one line for the newest listed month, naming what it
  lacks — spending *missing*: "Enter {September} spending & take-home" / "Enter {September} spending";
  spending *partial*: "Finish {September} spending — entered during September; add what has posted
  since" / "Finish {September} spending and enter take-home" (K3's copy table); spending *entered*:
  "Enter {September} take-home" — plus " (+N earlier months)". Tone warn if any listed month is
  overdue; the newest-overdue wording is "{September} spending & take-home are overdue", "{September}
  spending is still partial — was due {Oct 15}" or "{September} take-home is overdue". Link
  `/update?month={newest}&step=spending`.
- **Earlier provisional balances** (when `provisional_past` is non-empty): "{Oct 1} balances are still
  provisional (recorded {Sep 22}) — confirm or update them" (warn), newest only, plus " (+N earlier)";
  link `/update?month={M}&step=balances`.
- `update-overdue`, `update-due` and `spending-missing` are removed (replaced by the lines above);
  `spending-empty` stays.
- Review rows: past months only (`month < current_month`), never the current month (the day-7 rule and
  `UPDATE_NUDGE_DAY`'s use there go), and never a month listed in `flows_due` (the flows line already
  asks for it).

**Acceptance.** `attention.test.ts` (`:143-170`, `:352-446`) rewritten over the §K3 dates: nothing on
Sep 23; on Oct 3 two todo lines, "Update Oct 1 balances — recorded early, on Sep 22" and "Finish
September spending and enter take-home"; after take-home alone is saved the flows line still reads
"Finish September spending — entered during September; add what has posted since"; after a post-month
spending save or the Confirm it reads "Enter September take-home" or disappears; a warn flows line on
Oct 16; a three-month backlog is one line "(+2 earlier months)"; the earlier-provisional line on Nov 5
for an Oct snapshot never saved again; "ready to close" appears for September only once its spending is
*entered* and its take-home is in; no current-month review row on any day; the empty book still shows
only "Start here". Browser on the seeded copy at 2026-10-03 and 2026-10-16, both themes.

### T4. Data status and Settings › System "Data through"

**Problem.** Spending and take-home are amber whenever they are ≥ 1 month behind the latest balances
month (`src/components/overview/freshness.ts:91-112`), which in the user's routine is always; "Balances
through Oct 2026" names a future month.

**Decision.** `freshnessClauses(coverage)` reads `coverage.time`:
- Balances: "Balances as of {Sep 22}" (+ " — provisional, for {Oct 1}") — amber only when
  `time.balances.overdue` or `provisional_past` is non-empty; a missing current snapshot adds " · {Oct 1}
  due".
- Spending: "Spending through {Aug 2026}" = the newest ended month whose spending is *entered* (K3);
  tails " · {Sep} in progress" (current month with entries), " · {Sep} partly entered — due" / "— overdue"
  (a *partial* month in `flows_due`), " · {Sep} due" / " · {Sep} overdue" (a *missing* one), then the
  existing older-gap list; amber only when a listed month is overdue.
- Take-home ("Net pay"): the same with `take_home_entered`.
Settings › System reuses the clauses (`SystemCard.tsx:78-86`).

**Acceptance.** `freshness.test.ts:27-160` and `SystemCard.test.tsx:96-211` rewritten; on the seeded
copy no amber at 2026-09-23 or 2026-10-03 ("Spending through Aug 2026 · Sep partly entered — due" on Oct
3); spending/take-home amber at 2026-10-16.

### T5. Settings › Data health

**Problem.** `spending_gap` WARNs "Enter Oct 2026 spending" (coverage's old window,
`backend/app/services/health_checks.py:118-131`); `balances_without_spending` warns for the just-ended
month from its 1st (`:146-182`); `identical_snapshot` compares an early draft (`:221-257`).

**Decision.** `spending_gap` inherits K3's windows unchanged in code. `check_coverage_gaps` excludes
a month whose flows are not yet overdue (it takes the month status). `identical_snapshot` compares the
latest two **final** snapshots. A tenth check, `future_snapshot` (warn), names any snapshot more than a
month ahead — the ones K2 never makes current: "Balances filed for {Dec 2026}, more than a month ahead —
they are not used as your current balances. Delete them or file them under the right month." with a
link to that month's Balances step. The nine existing checks keep their order and ids; the new one is
appended.

**Acceptance.** `test_health_checks.py` (`:136-161`, `:227-245`, `:297-323` — now ten checks —
`:325-357`) updated; `future_snapshot` ok with an early next-month snapshot and warn with one two months
ahead; on the copy at 2026-09-23 no WARN from these four checks.

### T6. One monthly reminder listing both parts

**Problem.** The ritual emits an event on day *d* of month M "for M−1" and suppresses it once M−1's
snapshot exists (`backend/app/services/calendar/generators/ritual.py:29-60`; sources
`backend/app/api/calendar.py:479-481`) — a snapshot made on M−1's 1st suppresses it a month before it is
due, so it never fires; it also asks for the wrong things.

**Decision.** For each month U in the window, one event on U's reminder date listing the pending parts:
"{Oct 1} balances" (pending when U's snapshot is missing or provisional; item detail "not recorded yet" or
"recorded early, on {Sep 22} — update them") and "{September} spending & take-home" (pending when U−1's
spending is not *entered* under K3's rule or its take-home is missing — the same rule answers a month
that is still running, which is why a future event already lists it; the item detail names what is
missing — "not entered", "entered during September; add what has posted since" for *partial* spending,
"take-home not entered"). Label: "Monthly update — {Oct 1} balances · {September} spending &
take-home" (or the one pending part). No event when nothing is pending. While
pending after its date, the event is re-dated to today (as now) with detail "Due since {Oct 1}", then
"Overdue — {part} was due {Oct 1}" from that part's `overdue_from`. `href` `/update` (the wizard lands on
the first due part, M2). **Keys unchanged** — `ritual:{YYYY-MM of U−1}:{nominal date}` — so ICS UIDs
and any done/snooze override keep attaching (the copy has none). Sources gain the snapshot states and
flows presence (from K3's service, not a second derivation). Settings copy
(`src/components/settings/CalendarFeedCard.tsx:233-235`): "The Monthly update reminder lands on day
{d} of each month and lists what is due: that day's balances and the previous month's spending and
take-home."

**Acceptance.** `calendar/test_generators.py:231-277`, `test_calendar_api.py:225-332`, `test_model.py`
key pins (unchanged keys asserted), frontend `upNext` / `CalendarGrid` / `calendarFixtures` labels; a
take-home-only save leaves the September item pending with the *partial* detail. On the seeded copy: at
2026-09-23 the Oct 1 event lists both parts and nothing is re-dated; at 2026-10-03 the event sits on
today with "Due since Oct 1" and the September item reads "entered during September; add what has
posted since · take-home not entered"; after saving Oct 1 balances (scratch clone) it lists only
September.

### T7. Net worth page

**Problem.** Hero "Net worth — {month}" + "vs prior month", group tiles "vs prior", table "MoM %", What
moved on snapshot i vs i−1 (`src/pages/NetWorthPage.tsx:438-472, 667-709, 775-800, 882-931`;
`networth/netWorthChartOptions.ts:398-511`); the ribbon gets no anchor, so the latest (provisional)
month cannot be selected (`:603-612`).

**Decision.** Hero label/delta/badge exactly as T1 (quarterly grain: "since Jul 1"); group tiles "since
{Sep 1}"; table header "Change since {Sep 1}" (the % column keeps its values); What moved "What moved —
{September}: Sep 1 → Oct 1" or "What moved — since Sep 1 · 21 days (provisional)"; the hero hint says
"this snapshot". Charts draw a provisional point with the partial style and the T1 tooltip; range chips
cut on the timeseries `as_of` dates instead of month keys (identical for final snapshots; an early Jan 1
snapshot recorded in December stays in last year's YTD). The page passes `anchor = max(currentMonthIso(),
current snapshot month)` so the provisional month is a chip and can be selected.

**Acceptance.** `NetWorthPage.test.tsx:627-823` rewritten; chart option tests for the provisional point;
browser: the Oct chip is selectable and pressed when viewing Oct, both themes.

### T8. Month ribbon

**Problem.** Chips know presence only ("balances and spending entered" for a rent-only month), the ring
reads as a selection, "Edit ↗" edits `selected ?? anchor` (today's month), and "Back to latest" compares
with the newest balances month (`src/components/shell/MonthRibbon.tsx:85-129`,
`src/components/shell/ScopeBar.tsx:199-234, 281-300`).

**Decision.**
- View-mode anchor defaults to `max(currentMonthIso(), the current snapshot's month)` (K2's rule, so a
  far-future snapshot never stretches the ribbon; T5's health check links to it instead).
- Chip states: balances half filled when final, hatched (the partial style) when provisional; spending
  half filled when the month's spending is *entered* (K3) and its take-home is in, hatched when the
  month is in progress, its spending is *partial*, or one of the two is missing, empty when it has
  neither; a due or overdue month (from `time.flows_due`) gets the neutral or amber dot. Words
  (aria-label/tooltip): before October begins, "{Oct 2026} — Oct 1 balances recorded early (provisional)
  · spending not due yet (October has not begun)"; during October, "… (October in progress)"; for a
  partial September, K3's "{Sep 2026} — Sep 1 balances · spending entered during September (partial) ·
  take-home missing"; for a missing one, "{Sep 2026} — Sep 1 balances · spending not entered ·
  take-home missing".
- Pages pass `defaultMonth` (Net worth: the current snapshot's month; Spending: `default_month`;
  Budgets: its resolved month). "Back to latest" hides when the selection equals it and is labelled "Back
  to latest balances" on Net worth, "Back to last complete month" on Spending.
- "Edit ↗" edits the month on screen (`selected ?? defaultMonth ?? anchor`) at the step the page is
  about (`step=balances` from Net worth, `step=spending` from Spending).

**Acceptance.** `MonthRibbon.test.tsx:41-117`, `ScopeBar.test.tsx:199-216` rewritten for the new states
(including partial spending, a take-home-only month, a not-yet-begun month and an in-progress one),
defaults, labels and edit targets; Guide lines naming "Back to latest", if any, updated in the same lane.

### T9. Card utilization and the closing effect

**Problem.** "(as of Oct 2026) — … this reads the latest net-worth snapshot"
(`src/components/creditcards/CardDetail.tsx:540-546`; `closingEffect.ts:14-62`, `verdictCopy.ts:186-192`).

**Decision.** Same current snapshot; copy "(as of Sep 22 · provisional)" / "(as of Oct 1)" from
`asOfPhrase`.

**Acceptance.** `CreditCardsPage.test.tsx:579`, `verdictCopy.test.ts:222` rewritten for both states.

### T10. Assistant evidence

**Problem.** The month bundle pairs spending month M with snapshot M and the change **into** M
(`backend/app/services/assistant_evidence.py:228-290`) — August's change beside September's spending.

**Decision.** For spending month M: `net_worth` = snapshot M ("{Sep 1} balances"); `net_worth_change` =
snapshot M+1 − snapshot M with the definition "{September}: balances {Sep 1} → {Oct 1}", window
`[M, M+1]`, `completeness` `provisional` when M+1 is provisional and `unavailable` when M+1 is missing
("{Oct 1} balances not recorded yet"); `as_of` = M+1's as-of. The household and net-worth context
sections carry the new summary fields as they are (no code change beyond tests).

**Acceptance.** `test_assistant_evidence` cases for final, provisional and missing M+1.

### T11. Copy

**Problem.** The Guide and README describe a month-end ritual ("each account's month-end balance",
README 7.7 "month-end ritual"), the glossary has no balance-date convention (trust §3), and the
Settings feed card promises a reminder "to enter last month" that never fires.

**Decision.** Glossary entries (`src/guide/content/reference.tsx`): **Balances as of** ("the day your balances
describe — the 1st of the month"), **Provisional balances** ("recorded before their date; final once
saved again on or after it"), **A month's story** ("its spending and take-home, and the net-worth change
from its 1st to the next 1st"), **Due / overdue** (the two parts and their default days), **Partly
entered spending** ("spending saved while the month was still running — it counts once you save the
month again after it ends or confirm it is complete"). Overview start card (`OverviewPage.tsx:808-809`)
and `src/guide/content/start.tsx:307` say "balances on the 1st; last month's spending once it has
posted". README gets a short "Time model" section (§V6) and 7.7's "month-end ritual" becomes "the
monthly update (balances on the 1st, the ended month's spending once it has posted)".

**Acceptance.** The Guide label and where fences pass; copy review in the lane's spec review.

### T12. Spending and Overview charts draw a partly entered month as partial

**Problem.** Overview › Recent spending, Spending's bars and the heatmap hatch a month only while its
last day is after today (`isPartialMonth`), and `notEnteredMonths`
(`src/components/overview/overviewChartOptions.ts:94-111`) marks only `spending_missing` and
`spending_empty` months. So on Oct 1–15 the rent-only September is drawn as a normal, very low month
($2,072 against a typical ≈ $5.5K) — the false signal the time-model decision asks to avoid (review I2).

**Decision.** In `overviewChartOptions.ts`, `spendingChartOptions.ts` (bars and the net-pay line) and
`spendingHeatmapOptions.ts`, a month listed in `time.flows_due` with spending *partial* keeps the
existing partial treatment (`partialItemStyle`, the axis marker) after it has ended, with the tooltip
head "{September} — spending partly entered (due by {Oct 15})"; a *missing* one stays hollow as today.
Averages and reference lines already exclude it (it is not eligible) — unchanged. The pages pass
`time.flows_due` from the coverage they already fetch.

**Acceptance.** Option tests: a partial ended month is hatched with that tooltip head, a missing one is
hollow, an entered one is solid; the conformance fixtures for partial months updated. Browser on the
seeded copy at 2026-10-03, both themes: September is visibly partial on Recent spending, the Spending
bars and the heatmap.

---

## M. The two-part monthly update (lane M)

### M1. Two independent parts, each saving only itself

**Problem.** One atomic save always sends the balances leg (every typed account, `recorded_on`, notes)
and spending only if something was typed (`src/pages/MonthlyUpdatePage.tsx:865-889`); entering spending
for a month without a snapshot creates one copied from M−1, stamped today (`:536-538, 877-885`); only the
Review step can save.

**Decision.** Within month M the steps stay Balances → Spending → Review, but they are two parts:
- **Balances** ("{Oct 1} balances"): primary button "Save {Oct 1} balances" (enabled when the balances
  part is dirty and valid). The body carries `balances` only. Each step's primary action is its
  part's save, so the existing shortcuts that press the primary (`AmountInput`'s Ctrl/Cmd+Enter and
  Ctrl+S) save that part; the component itself is not changed.
- **Spending** ("{September} spending & take-home"): primary "Save {September} spending" (spending,
  take-home, the zero confirmation). The body carries `spending` only.
- **Confirm spending is complete.** On the Spending step of an ended month whose spending is *partial*
  (K3), with nothing dirty, the secondary action reads **"Confirm {September} spending is complete"**.
  It sends a month-review PUT with no legs whose `reviewed` sets `spending: true` and carries the other
  two ticks as they stand; it is change-logged like any PUT (Undo reverses it, and K3 then reads the
  month as partial again). Banner above the table while the month is partial: "{September}'s spending
  was saved during September. Add anything that has posted since and save, or confirm it's complete."
  A save that changes any amount after the month ended completes it too (K3 clause (c)); a take-home
  save alone does not.
- **Review**: "Save progress" and "Save and close {September}" send only the **dirty** parts plus
  `reviewed` and `close`. An untouched part is never re-sent.
- Dirty = differs from the loaded baseline of that part (balances: amounts, notes, hand-typed parents;
  spending: amounts, take-home, zero confirmation). `expected_revision` is the month's current review
  revision and is refreshed from each save's response, as now.
- No path creates a snapshot as a side effect of a spending save; opening the Spending step of a month
  without balances is allowed (the redirect at `:1103-1110` goes); closing such a month stays blocked
  (the server's existing "Enter balances before closing the month." blocker, and the Review step says
  "Record {Nov 1} balances before closing {November}" beside the disabled close).
- **"Next" leads to what is due.** On the Balances step of the current month, while the previous
  month is in `flows_due`, the secondary button reads **"Next: {September} spending & take-home"** and
  opens `/update?month={Sep}&step=spending`; "Next: {October} spending" appears only when nothing
  earlier is due. Elsewhere the Next buttons move within the month ("Next: review").
- The private `todayIso` (`:66-71`) is deleted; every rule reads K1's server day; M deletes
  `MonthlyUpdatePage.tsx` from K1's grep allowlist in the same lane.
- A charge that posts after the spending was saved is a plain edit of that month's Spending step; the
  month stays open until it is closed on the existing Review step (editing a closed month turns it
  "changed since review", as today).

**Acceptance.** Wizard tests: a spending save's request body has no `balances` key; a balances save has
no `spending` key; a Review save of a month where only spending changed sends only spending; a month
without a snapshot + spending save creates no snapshot (API assertion on a test DB: no
`net_worth_snapshots` insert in the change batch); the revision refresh between two part saves;
Ctrl+S per step; the Confirm appears only for an ended, *partial*, clean month, sends a PUT with no legs
and `reviewed.spending` true, and after it `/coverage` reads the month *entered* (Undo → *partial*); the
banner shows only while partial; on the current month's Balances step with September due, "Next" opens
September's Spending step, and with nothing due it reads "Next: {October} spending". `:269`, `:287-300`
pins replaced.

### M2. "What's due" and where /update lands

**Problem.** `/update` opens the calendar month (`:279`), which in the user's routine is never the part
that is due (on Oct 3 they need Oct 1 balances and September's spending).

**Decision.** A strip at the top of the wizard from `coverage.time`: one chip per due part — "{Oct 1}
balances · recorded early, on Sep 22 — update or confirm" / "· not recorded yet"; for the flows,
"{September} spending & take-home · not entered", "… · take-home not entered", or for *partial*
spending K3's "{September} spending & take-home · entered during September — add the rest or confirm";
one chip per `provisional_past` month ("{Oct 1} balances · still provisional (recorded Sep 22) —
confirm or update"). Each chip links to its month and step and is amber when overdue. With nothing due
it reads "Nothing due — {Oct 1} balances recorded early ({Sep 22}); update or confirm them on {Oct 1}"
when next month's early snapshot exists (today's case on Sep 23), else "Nothing due — next: {Nov 1}
balances on {Nov 1}". `/update` with no `month` lands on the first due part (balances first), else on
the current month's Balances step. After a part saves, the success toast (with Undo, as now) adds "Next
due: {September} spending & take-home →" when another part is due.

**Acceptance.** Tests for the landing rule at the §K3 dates and for the strip's chips (missing,
take-home-only, partial, earlier provisional), links, tones and both nothing-due wordings; browser on the
seeded copy at 2026-09-23 (the early-snapshot wording) and 2026-10-03: `/update` opens Oct 1 balances
with the provisional banner (M4) and a September chip reading "entered during September — add the rest
or confirm".

### M3. Which months can be opened

**Problem.** The ribbon anchor is `max(current, latest covered + 1)` (`:1113-1119`), so from the day the
current month's snapshot exists the wizard offers the next month, then the one after ("Start Nov
2026"); any future month opens by URL.

**Decision.** Anchor = `max(currentMonthIso(), the current snapshot's month)` (K2). "Start {month}" is replaced by
**"Record {Nov 1} balances early"**, shown only when next month (relative to the server day) has no
snapshot; it opens next month's Balances step with the banner "These are {Nov 1} balances recorded
before {Nov 1} — they stay provisional until you save them again on or after {Nov 1}." A month beyond
next month (URL or ribbon) shows "{Dec 1} balances can be recorded from {Nov 1} (early) or on {Dec 1}"
with both saves disabled. Spending for a month that has not begun is disabled ("{October} spending can
be entered once October begins"); the current month's spending is allowed with "{September} is in
progress — its spending and take-home are due once it ends. What you save now is kept as a partial
month." Close gating is unchanged (the current month still needs its extra tick; the server's
future-month blocker stays).

**Acceptance.** `:365-392` ("offers starting the month after the latest covered month") rewritten:
next-month early offer only, never two months ahead, the far-future banner and disabled saves, the
in-progress banner.

### M4. "Balances as of … · recorded …" and confirming provisional balances

**Problem.** "Recorded on" is an editable date seeded with today, sent on every save, shown nowhere else
and ambiguous (`:1409-1422`).

**Decision.** The box goes. Under the Balances heading a read-only line from `MonthBalancesOut`:
"Balances as of {Oct 1} · recorded {Oct 1}" / "Balances as of {Sep 22} · provisional for {Oct 1} —
recorded early, on {Sep 22}" / "recorded date unknown" (NULL) / "not recorded yet". The wizard never
sends `recorded_on` (K4 stamps it). For a provisional snapshot on or after its date the banner reads
"These {Oct 1} balances were recorded early, on {Sep 22}. Update any account that changed and save —
saving on or after {Oct 1} makes them final." and the primary button reads **"Confirm {Oct 1} balances"**
while nothing is dirty (it sends the unchanged balances, which finalizes them). Column headers: "{Sep 1}"
for the previous snapshot (was "Last month"), "{Oct 1}" for this one (was "This month"), "Δ since {Sep 1}".

**Acceptance.** Tests: no `recorded_on` in any body; the four line variants; Confirm enabled only for a
provisional snapshot on/after its date with nothing dirty; after confirm the line reads "recorded
{today}" and the strip drops the balances chip; saving early balances again before their date reads
"as of {that day} · provisional". Scratch-clone browser check at `PRODUCT_TODAY=2026-10-01`: Confirm Oct
1 balances → `recorded_on` 2026-10-01, `provisional` false, Undo restores 2026-09-22.

### M5. The review tells the month's story

**Problem.** Review tiles pair M's spending with "vs prior month" (snapshot M − snapshot M−1,
`:1876-1882`), and "Largest balance changes · prior month" does the same
(`src/components/monthly/ReviewChanges.tsx:40-59`) — August's change on September's review.

**Decision.** The Net worth tile becomes "{Sep 1} balances" (the typed total, as now) with delta
"{September}'s change: ▲ $X ({Sep 1} → {Oct 1})" from `GET /net-worth/summary?month={M+1}` when M+1 has
a snapshot **and** that summary's `previous.month` is M (its `mom_delta`; a provisional M+1 reads "▲ $X
({Sep 1} → {Sep 22} · provisional)"); when M+1 compares with an older snapshot because M has none,
"{September}'s change needs {Sep 1} balances"; otherwise "{September}'s change appears once {Oct 1}
balances are recorded". "Save and close {September}" is also disabled while {Sep 1} balances are
provisional, with K4's sentence beside it. ReviewChanges' balance section compares M+1 with M under
the heading "Largest balance changes · {Sep 1} → {Oct 1}", or shows that sentence when M+1 is missing.
The three confirmations read "I checked every {Sep 1} account balance.", "I checked {September}
spending, tax and transfers.", "I checked {September} household take-home." The story uses saved figures
(the month's balances part is a different snapshot from M+1), and closing still certifies snapshot M +
flows M (review v1 unchanged).

**Acceptance.** Review tests for M+1 final, provisional and missing; ReviewChanges tests; on the copy at
2026-10-03 September's review shows "September's change: ▲ $126,583.02 (Sep 1 → Sep 22 · provisional)".

### M6. Deletes and drafts per part

**Problem.** One delete removes a month key's snapshot, spending and take-home together, and one
draft holds both parts, so in the two-part model deleting or restoring one part would drag the other
with it.

**Decision.** "Delete this month everywhere" (`:1844-1864`) becomes two actions, each keeping the
type-YYYY-MM guard and Undo: on Balances "Delete {Oct 1} balances" (`DELETE /net-worth/months/{m}`), on
Spending "Delete {September} spending & take-home" (`DELETE /spending/months/{m}`). Drafts split into
`finance-update-draft:balances:<month>` and `finance-update-draft:flows:<month>`; a legacy
`finance-update-draft:<month>` is split into the two on first read (its `recordedOn` dropped) and
removed. The restore banner names the part.

**Acceptance.** Tests for both deletes (each leaves the other part intact), the legacy-draft split and
per-part restore.

### M7. Guide and palette

**Problem.** The routine card says "Do it in the first days of the month … each account's month-end
balance" and names **Start <Month>** and **Recorded on** (`src/guide/content/routines.tsx:16-46`); the
palette offers "Enter {current month} update" (`src/components/paletteRegistry.ts:153`), which is never
the part that is due.

**Decision.** The routine card (`src/guide/content/routines.tsx:8-60`): "Two parts on their own
schedule. On the 1st, record that day's balances. Once the month just ended has posted — usually a few
days later — enter its spending and take-home, then review and close it. Saving one part never touches
the other; balances recorded early stay provisional until you save them again on or after their date."
Tasks: record the 1st's balances; enter last month's spending and take-home; confirm last month's
spending is complete when it was saved during the month (**Confirm <Month> spending is complete**);
review and close; record next month's balances early (optional); delete a part — every `**Label**`
matching the new UI (placeholders such as `<Date>` and `<Month>` as the fence allows). Palette entry
(`src/components/paletteRegistry.ts:153`) "Monthly update — what's due" → `/update`.

**Acceptance.** `guideContent.test.ts:147-170` fences pass; palette test updated.

---

## W. Will I owe? (lane W)

### W1. One payroll start: checks on or before a person's first profile date are $0

**Problem.** `_salary_leg` prices a check before the earliest profile with that profile
(`backend/app/services/withholding_calc.py:301`), so Grace's profile from Sep 1 is stretched to January:
"17 of 24 checks", $5,850 projected of which $3,656.25 is invented; the only admission is a folded
warning (`:80-82, 337`). The Paycheck pace walk does the same (`backend/app/services/pace_walk.py:97-104`,
disclosed as "before {date} assumes your earliest profile"), and calendar paydays have no start at all
and are priced by today's profile (`backend/app/services/calendar/generators/payroll.py:27-57`,
`backend/app/api/calendar.py:159-204`).

**Decision.**
- `_salary_leg`: a grid check dated **on or before** the person's earliest profile's effective date
  contributes $0 withholding and $0 gross and is **not counted** — the grid's check on the 1st pays the
  half-month before it, so a job that starts on the 1st is first paid on the 16th. `checks_total` = grid
  checks after the earliest profile date; `checks_elapsed` = those on or before today. A switch between
  two profiles keeps "on or after" (a check dated on a later profile's effective date is priced by it,
  unchanged). Every counted check is priced by the profile in force on its date. The grid
  (`check_dates`, cadence from the profile in force today) is unchanged — Edward's first profile is Jan
  1 and the first grid check Jan 16, so a household whose first profile starts on or before Jan 1 is
  byte-identical.
- `EARLY_CHECKS_WARNING` / `PARTNER_EARLY_CHECKS_WARNING` become "{name}'s checks on or before {Sep 1},
  the first paycheck profile's start, count as $0 — add a profile for an earlier job or salary to
  include them", shown inline (W4), not only in the disclosure.
- `pace_walk`: a payday on or before the person's earliest profile date credits nothing, on both sides
  of today (the scenario side too); the payload keeps `backfilled_from` (now always null) and adds
  `starts_on: date | None` (the earliest profile date when it falls inside the window). PacePanel's note:
  "Nothing counts before {Sep 1}, when the first paycheck profile starts." — 8 paydays for Grace (Sep 15,
  Sep 30, Oct 15, Oct 30, Nov 13, Nov 30, Dec 15, Dec 31: real paydays pulled back over weekends), the
  same count as the tax card's 8 grid checks.
- Calendar: `_payday_sources` passes each person's full profile list and the earliest date on
  `PaydaySource`; paydays on or before it are not emitted, and each payday's net pay comes from the
  profile in force on that payday. `payday_events`' signature is unchanged (the new data rides on
  `PaydaySource`), so `services/calendar/__init__.py` stays lane T's.
- UI copy wherever a partial year shows (partner block, pace note): "Each check is priced by the
  paycheck profile in force on its date. For a raise or a new job, add a profile with its start date."

**Acceptance.** Calc tests: the three backfill pins (`test_withholding_calc.py:181, 199, 471`) rewritten
to $0 semantics; `test_single_earner_defaults_leave_the_estimate_byte_identical` and every
jurisdiction/bonus/tier test pass unchanged; a mid-year raise still prices by date; a future-start
profile gives 0 elapsed checks. Pace walk tests for a window before, straddling and after the first
profile, including a payday on the start date. Calendar tests: no Grace payday on or before Sep 1 (her
first is Sep 15); Edward's July paydays priced by the Jan 1 profile. On the copy at 2026-09-23: Grace's
leg `checks_total` 8 (first counted check Sep 16), `checks_elapsed` 1, projected $1,950.00 (8 ×
$243.75; was $5,850.00), gross $8,000.00; her Paycheck pace counts the same 8 paydays; Edward's leg is
byte-identical.

### W2. Full-year pay basis on both sides

**Problem.** `pay_periods` is labelled "checks received so far this year" and the engine comment says
year-to-date (`backend/app/tax_keys.py:16`, `backend/app/services/tax_service.py:108-110`) while the
withholding side always projects the whole year.

**Decision.** Label (served from code by `label_for`): "Pay periods (semi-monthly periods in the whole
year — 24 for a full year, including those still to come)" — the engine divides the salary by a
hard-coded 24 (`latest_w2_income = pay_periods × salary / 24`, `tax_service.py:108-110`), so "paychecks"
would invite 26 from a biweekly earner and overstate wages by 8.3 %; the engine comment and the Inputs
form's help say full year; the liability tile hint: "The tax engine's total on your typed inputs —
enter full-year figures, including paychecks and vests still to come." `WithholdingEstimate`/
`WithholdingOut` publish the grid facts the reconciliation needs (additive): per person gross
projected, elective 401(k) (traditional and Roth) and employee HSA summed over counted checks (W3 applies
the limits), the first counted check date.

**Acceptance.** Inputs payload label test; the published facts equal sums over the walk (unit tests).

### W3. Reconciliation (server)

**Problem.** Withholding counts $171,235.24 of 2026 vests while the liability taxes a typed $120,000;
nothing compares any typed input with what the app projects except a trailing sentence
(`src/components/taxes/WithholdingPanel.tsx:616-642`); the refund headline ($26,574.73) overstates by
≈ $18K (planning T1).

**Decision.** New `backend/app/services/tax_reconciliation.py`, called by `withholding_estimate(…,
reconcile=True)` from `GET /taxes/years/{year}/withholding` (the calendar's internal calls pass
`reconcile=False`). Compute-only; nothing is written.
- **Rows**, per person on the return (people `_return_people` puts on it), each only when either side is
  non-zero:
  - `salary` (source paycheck): typed = `latest_w2_income + w2_salary_checkpoint` of the person's
    materialized bucket; projected = their leg's gross over counted checks (W1).
  - `trad_401k` (paycheck): typed `trad_401k_contributions`; projected = the traditional share of the
    person's elective deferrals over counted checks, **stopped at the year's stored
    `limit_401k_elective`** — `breakdown()` never caps (`paycheck_calc.py:57-72`), payroll does: when
    Σ (traditional + Roth) exceeds the limit, the limit is split by the two rates. No limit stored for
    the year → uncapped, and the facts say so.
  - `hsa` (paycheck): typed `hsa_contributions`; projected = Σ `hsa_per_check` over counted checks,
    stopped at the limit for the profile's coverage (`limit_hsa_self` / `limit_hsa_family`) minus the
    employer's annual deposit (`limit_check.employer_hsa`, the Paycheck pace's own rule — the deposit
    counts against the same cap), never below 0; no cap for coverage `none` or no stored limit.
  - `rsu` (comp, primary only): typed `w2_stock_rsus_sold`; projected `vest.income_projected`.
  - `espp` (espp, primary only): typed `w2_espp_sale_component` + `ltcg_espp_component` +
    `stcg_espp_component`; projected Σ over lots with `sold_date` in the year of
    `decompose_espp(today=sold_date, sale_price=sold_price)` (after W5).
  A person with no paycheck profile gets no paycheck rows and one note ("{name} has no paycheck
  profile, so their inputs are not reconciled — their withholding comes from the entered W-2 rows").
  Notes also say what is never reconciled: dental/vision, employer HSA, bonuses, dividends and interest,
  brokerage gains.
- **Tax effect** per row = liability with that row's projection overlaid on the stored rows − the
  typed liability (positive = more tax). Overlay (in memory, the preview's `_stored_slot` adoption
  rules): salary adds (projected − typed) to the person's `w2_salary_checkpoint`; 401(k), HSA, RSU
  replace their key; ESPP replaces the three keys (ordinary → the primary's `w2_espp_sale_component`,
  capital → the long or short component by term). The feed is built once from the rows already read
  (`_engine_feed` is split into a DB read and a pure `_engine_feed_from_rows`); no per-row query.
- `liability_if_matched` = every row overlaid together; `balance_if_matched` = that − `total.projected`
  (withholding does not depend on these inputs).
- **Flags, stateless.** `flagged = |flag_effect| > 250.00`, where `flag_effect` is the row's tax
  effect — except on `rsu`, the only row that moves with live quotes. There, for the flag only, the
  not-yet-vested vests are priced at the **close on or before the 1st of the current month**
  (`_close_on_or_before`, which past vests already use; the latest quote when no such close is stored),
  and the difference is then shrunk toward zero by `QUOTE_TOLERANCE` (10 %) × that not-yet-vested income
  before re-pricing. The displayed `projected` and `tax_effect` stay on today's quote. No other row has
  hysteresis, and there is no memory: the GET stays pure, restarts change nothing, every caller (the
  Taxes card, the Overview, the assistant) sees the same flags, and the RSU flag can change at most
  monthly or when an input changes. That is how this record meets the decision's "hysteresis so live
  quotes don't flicker": the one quote-driven row is flagged on a monthly reference price inside a ±10 %
  band, instead of on a remembered state.
- **Apply** only where a chip exists today and figures differ: the `rsu` row carries `{key:
  "w2_stock_rsus_sold", person_id: primary, value: projected}` when projected ≠ typed. No new Apply.
- Payload (additive, `schemas/taxes.py`):

```python
class ReconciliationApplyOut(BaseModel):
    key: str
    person_id: int | None
    value: Decimal

class ReconciliationFactsOut(BaseModel):
    typed_pay_periods: Decimal | None = None
    typed_checkpoint: Decimal | None = None
    projected_checks: int | None = None
    projected_from: date | None = None        # first counted check
    capped_at: Decimal | None = None          # trad_401k / hsa: the limit that stopped the projection
    future_vest_income: Decimal | None = None # rsu: at today's quote
    quote_tolerance: Decimal | None = None    # rsu: the income band that never flags
    reference_price: Decimal | None = None    # rsu: the flag's price (close on or before the 1st)
    reference_date: date | None = None        # rsu: that close's date

class ReconciliationRowOut(BaseModel):
    key: Literal["salary", "trad_401k", "hsa", "rsu", "espp"]
    person_id: int | None
    person_name: str | None
    label: str                  # "Salary wages", "Traditional 401(k)", "HSA (paycheck)", "RSU income", "ESPP sale income"
    source: Literal["paycheck", "comp", "espp"]
    typed: Decimal | None       # None = none of its inputs entered ("not entered")
    typed_keys: list[str]
    projected: Decimal
    difference: Decimal         # projected − (typed or 0)
    tax_effect: Decimal
    flagged: bool
    facts: ReconciliationFactsOut
    apply: ReconciliationApplyOut | None = None

class ReconciliationOut(BaseModel):
    rows: list[ReconciliationRowOut]
    flagged_count: int
    liability_if_matched: Decimal | None
    balance_if_matched: Decimal | None
    flag_above: Decimal = Decimal("250.00")
    notes: list[str] = []
```

  `WithholdingOut.reconciliation` is null when the engine refused the year (`liability_total` null).

**Acceptance.** Service tests: each row's typed/projected/effect on fixtures (single earner, MFJ two
earners, MFS — partner rows absent, a person with no profile, a mid-year raise, a future-start profile,
sold and unsold ESPP lots); the rsu effect equals the what-if's Δ total tax for
`w2_stock_rsus_sold=projected` to the cent; a partner row's effect equals a preview-overlay engine run
(the what-if folds onto the primary and is not the reference); `liability_if_matched` equals one engine
run with every overlay; the 401(k) cap binds and splits by rate (traditional + Roth over the limit), and
is absent when no limit is stored; the HSA cap subtracts the employer deposit and ignores coverage
`none`; flags: $260 of effect → flagged and $240 → not, on every row; the same inputs give the same flags
on repeated calls in any order (no module state, no reset fixture); a quote move inside the month never
changes the RSU flag, a new reference close on the 1st can; a ±8 % quote move on a matched RSU row never
flags; purity (SELECT-only, `test_withholding_liability_is_the_summary_total_verbatim` unchanged,
`balance_projected` unchanged). On the copy at 2026-09-23: rows for Edward salary ($184,441.67 vs
$188,930.00), 401(k) ($21,965.82 vs **$24,500.00**, "capped at the 2026 limit"), HSA ($2,300.00 vs
$2,400.00 — at, not over, the self-only limit minus the $2,000 deposit), RSU ($120,000.00 vs the
payload's `vest.income_projected`) and Grace salary ($10,000.00 vs **$8,000.00**), 401(k) (not entered
vs **$800.00**), HSA (not entered vs **$600.00**); the RSU row flagged; `balance_if_matched` reported.
Timing: an uncached withholding GET (W12's memo cleared) has a median ≤ 2× the pre-batch median and
≤ 150 ms locally; W12 serves repeats from memory.

### W4. Reconciliation strip and inline notes (UI)

**Problem.** The only comparison on the card is a trailing sentence with an Apply chip shown whether or
not the figures match (`WithholdingPanel.tsx:616-642`); the partner backfill warning sits in the folded
disclosure (`:374-380`); the Overview's tax tile carries no caveat (trust F5).

**Decision.** Under the tiles (headline unchanged: the balance on the typed inputs) a card "Your inputs
vs your records", grouped by person, one row each: label · "Your inputs" (typed or "not entered", with
"20 pay periods + $27,000 checkpoint" when relevant) · "{Paycheck|Comp|ESPP} projects" (with "24 checks
from Jan 16" / "8 checks from Sep 16" / "capped at the {2026} limit ($24,500)" / "vests at their
vest-day close, later ones at today's quote") · difference · "≈ +$18,265 tax" · warn register when
flagged · Apply (rsu) · "Open Inputs". Lead line: "{3} inputs differ from your records by more than
$250 of tax (this month's reference price for unvested RSUs)" and "Balance if they matched your
records: refund ≈ $X" — X is the magnitude of `balance_if_matched`; a positive value reads "owe ≈ $X",
and the words and tone follow the headline tile's existing rules. The vest sentence and its chip move
into the RSU row; the partner block's copy becomes "Simulated from {Grace}'s paycheck profile — {1} of
{8} checks since {Sep 1} …" plus W1's sentence inline; the folded disclosure keeps only method notes.
The Inputs form's `annual_salary` suggestion chip shows only when the stored value differs from the
suggestion. Overview: a Needs-attention line (warn) "{5} of {2026}'s tax inputs differ from your records
→" to `/taxes?section=summary` when `flagged_count > 0`, built by `taxDrift.ts` from the current year's
withholding GET (served by W12's memo), fetched after first paint and only when that tax year exists.

**Acceptance.** `WithholdingPanel.test.tsx` (`:186`, `:494`, `:786-899`, `:930`) rewritten: strip rows,
"not entered", the "capped at" detail, flagged styling, the lead line with its reference-price clause,
Apply present only when different and writing only `w2_stock_rsus_sold`, balance-if-matched wording for
owe/refund/even; partner copy "1 of 8 checks since Sep 1"; Inputs chip visibility; Overview line appears
only when flagged and links to the card. Browser, both themes, 1280 and 1600.

### W5. ESPP §423 qualifying-disposition cap

**Problem.** `cap = shares × subscription_price × d/(1−d)` assumes the subscription price is already
discounted (`backend/app/services/tax_whatif.py:53-57, 149-161`), but the app stores the undiscounted
offering-date close (`backend/app/api/espp.py:196-200`, `espp_calc.py:392`): ordinary income is 17.6 %
too high ($2,225.71 vs $1,891.85 on the Feb 29 2024 lot).

**Decision.** `cap = shares × subscription_price × discount` (IRC §423(c): the lesser of the actual gain
and the discount on the offering-date FMV). `qualified_discount_ratio` and `QUALIFIED_FMV_WARNING`
("grant-date FMV approximated…") are removed — the offering-date FMV is stored; the module docstring
says so.

**Acceptance.** `test_tax_whatif.py:187-199, 294-299` rewritten (the 100-subscription fixture caps at
15.00 per share: 150.00, not 176.47); the Feb 29 2024 lot (260 sh, $48.509) at a sale price with gain ≥
the cap yields ordinary $1,891.85 = the ESPP page's discount component; a loss yields 0.00.

### W6. ESPP income: no FICA/SDI; gross income counts ESPP gains (moved by design)

**Problem.** ESPP ordinary income rides `other_w2_income` into the Medicare/SS/SDI bases (+$52.31
Medicare on $2,225.71; `tax_whatif.py:11-18`, `tax_service.py:336-343, 723-754`) and the page disclaims
it (`WhatIfPanel.tsx:640-646`); `gross_income` omits `stcg_espp_component` and `ltcg_espp_component`
(`tax_service.py:783-792`), so take-home and the effective rate are wrong whenever ESPP gains exist.

**Decision.** `EarnerWages` gains `espp_ordinary: Decimal = ZERO` (set by `earner_from_inputs` from
`w2_espp_sale_component`); `fica_wages` and `sdi_wages` subtract it; income-tax wages keep it. The
withholding card's additional-Medicare gap uses the same Medicare wages (primary wage base minus the
primary's ESPP ordinary income). `gross_income` adds the two ESPP gain components. The disclaimer
paragraph loses its FICA sentences. On the 2026-09-23 copy no stored year carries an ESPP component, so
no stored figure moves today; README §7.5 records the change (§V6).

**Acceptance.** New goldens: a year with `w2_espp_sale_component` has lower Medicare/SS/SDI and
unchanged federal/state wages; a year with ESPP gains has `take_home = gross − tax` including them;
every existing golden (components 0) is byte-identical; `test_what_if_espp_disqualified_hits_w2_and_fica`
rewritten to "hits W-2, not FICA".

### W7. The sale view

**Problem.** A sale shows "Δ take-home" (`WhatIfPanel.tsx:470-478`), an income concept that never
counts proceeds: a $59.5K qualified lot reads "−$11,651".

**Decision.** `WhatIfOut.sale_summary: SaleSummaryOut | None = None`, present when the scenario has a
sale or ESPP leg: `proceeds` (Σ legs), `gain` (brokerage gains + ESPP ordinary + ESPP capital),
`tax_due` (total tax of baseline + legs **without overrides** − baseline; equal to `delta.total_tax`
when there are no overrides, one extra engine run otherwise), `net_cash = proceeds − tax_due`,
`after_tax_gain = gain − tax_due`. With legs present the tiles read **Proceeds · Tax due · Net cash ·
After-tax gain** in place of "Δ take-home" (a line notes when overrides are also in the scenario:
"Tax due counts the sales only; the overrides change the total below"). Without legs the tiles are
unchanged.

**Acceptance.** API tests: legs only (tax_due = delta.total_tax), legs + override (extra run),
overrides only (null); UI tests for both tile sets; the Feb 29 2024 lot shows net cash = proceeds − tax
due and a positive after-tax gain.

### W8. Filing status: a deliberate, undoable setting

**Problem.** The status is a view-filter-looking toggle beside the year chips that PATCHes on one click
(`src/pages/TaxesPage.tsx:443-469, 768-786`), and the PATCH is not change-logged
(`backend/app/api/taxes.py:898-916`).

**Decision.**
- Backend: the PATCH takes `batch: ChangeBatch = Depends(change_batch)`, records the `tax_years` row
  update, labels "Changed {2026} filing status to {Married filing jointly}", and returns the batch in
  `X-Change-Batch` (the put-inputs pattern). New `GET /taxes/years/{year}/status-options` →
  `{year, current, options: [{status, label, people: [{id, name}], tables_missing: [str], computable:
  bool}]}` from `_return_people` and `_missing_for_status` — the server's rules, not a client copy.
- Frontend: the scope row shows "Filing status: {Married filing jointly} · Change…". The dialog lists
  the statuses with, for the selected one: whose rows count on the return; missing tables ("{2026} has no
  Married-filing-separately tables yet — the estimate, What-if and Will I owe? stay unavailable until you
  add or clone them in Tax tables"); "the partner's withholding leaves / joins the card"; "{2027}'s
  prior-year safe harbor uses this year's total tax". Confirm → PATCH → the standard Undo toast. The Tax
  tables toggle is relabelled "Tables for status" and marks "this year's status".

**Acceptance.** API: change-logged, Undo restores the status, 404/422 unchanged, status-options for
each status. UI: no PATCH without confirm; dialog text for MFJ→MFS with missing tables; Undo toast;
`TaxesPage.test.tsx:1640-1799, 2056` rewritten.

### W9. Unsaved tax edits survive

**Problem.** Tax inputs and tables edits die on any navigation, reload or 401 redirect
(`InputsForm.tsx:287-340`, `BracketsEditor.tsx`; no guard in `src/`).

**Decision.** `beforeunload` while `inputsDirty || bracketsDirty`. SessionStorage drafts written
continuously: `finance-tax-inputs-draft:<year>` and `finance-tax-brackets-draft:<year>:<status>`, each
storing the edited values **and the values that were loaded** when editing began. On the next load a
draft is restored only while its loaded values still equal what the server now returns — then with the
banner "Restored unsaved tax inputs for {2026} — they are not saved yet · Discard restored entries"
(tables: "… tax tables for {2026} ({MFJ}) …"). If the server's values have changed since (another
device saved, or an Apply wrote), the draft is dropped with the note "Unsaved tax inputs for {2026} were
discarded: the saved values changed since you typed them." — a restore would silently revert that
change on the next Save. A draft equal to its loaded values is dropped silently; Save and Discard
clear it.

**Acceptance.** Tests: draft written on edit with its loaded values; restored after remount (also after
a simulated 401 redirect) while the server's values are unchanged; dropped with the note when they
changed; dropped silently when equal; cleared on save/discard; `beforeunload` registered only while
dirty.

### W10. Units in "Inputs this scenario moved" and the Apply confirmation

**Problem.** `ChangedInput` quantizes every key to cents and carries no unit
(`backend/app/api/taxes.py:2351-2368`, `schemas/taxes.py:337-341`); the list and the confirm print
"$0.98 → $0.95" for 97.53 % → 95 % and "$52.00 → $48.00" for pay periods (`WhatIfPanel.tsx:596`,
`TaxesPage.tsx:550-552`).

**Decision.** `ChangedInput.unit: Literal["money","count","percent"] = "money"` from `unit_for(key)`;
quantize money 2 dp, count 0 dp, percent 4 dp. Both surfaces render with `inputUnits.figureText(unit,
…)`: "97.53% → 95%", "52 → 48".

**Acceptance.** API pins (the exact `changed_inputs` dicts gain `unit`); UI tests for all three units.

### W11. The Taxes page reads the server's year

**Problem.** The Will I owe? card mounts when `d.summary.year === new Date().getFullYear()` (the
browser's year) while its endpoint answers only the product clock's year
(`backend/app/api/taxes.py:2162-2178`); on New Year's Eve evening in Pacific time the two disagree.

**Decision.** `TaxesPage.tsx:886` (the Will I owe? mount), `:194` and `:309` (the new-year default) and
`OverviewPage.tsx:384` use `currentYear()` / `todayIso()` (K1); W deletes `TaxesPage.tsx` and
`OverviewPage.tsx` from K1's grep allowlist in the same lane.

**Acceptance.** With a browser clock of Dec 31 23:30 and a server day of Jan 1, the card mounts for the
new year only if that tax year exists; K1's grep test passes with W's allowlist entries removed.

### W12. The withholding read, memoised per data version and day

**Problem.** With the reconciliation the withholding GET runs about ten tax-engine passes, and W4 adds
a call on every Overview visit (review minor 22) — on a 2 vCPU box whose Overview batch 1 just made
fast.

**Decision.** `read_cache.py` gains `WITHHOLDING_TABLES` — every table the GET reads: `tax_years`,
`tax_inputs`, `tax_brackets`, `people`, `paycheck_profiles`, `contribution_limits`, `rsu_grants`,
`securities`, `latest_prices`, `app_settings`, `espp_lots`, and `price_history` restricted to the
employer ticker's bars (the only rows read, `_employer_bars`) — pinned by the SQL-capture test pattern,
and `cached_withholding(db, year, build)` on the existing `_memoised` machinery. Key = (fingerprint,
product today, year). It stores the serialized JSON bytes (R9's rule); the HTTP route returns them
as-is, and a direct caller (the assistant) receives `WithholdingOut.model_validate_json(bytes)`. The
calendar's internal `reconcile=False` calls are not cached.

**Acceptance.** Cache tests: a hit for the same data and day; a miss when any listed table (including
an employer bar), the day or the year changes (one test per table); the captured SQL tables equal the
list; the bytes equal an uncached run's. On the migrated copy the Overview's second visit is served
from memory (warm median ≤ 20 ms for the GET).

---

## R. Retirement projection (lane R)

### R1. Engine: phases, drawdown, depletion and lumps

**Problem.** Each retirement subtracts that person's current take-home + payroll + match from one
escalating stream, floored at 0 (`backend/app/services/projection.py:78-82`, `montecarlo.py:97-101`);
nothing is ever withdrawn, so "both retire Jul 2035" grows $1.88M → $4.08M (planning J1). Deleting the
floor would not fix it: the stream's cash part is a trailing mean of recorded net pay, the drop is
today's profile (projection map §2.2).

**Decision.** `project()` and `simulate()` take three new optional inputs:
- `resets: Sequence[tuple[int, Decimal]]` — at month index *k* (index 0 folds to 1, as drops do) the
  contribution becomes `level × growth^(k−1)` (the escalator tracked by repeated multiplication, the
  same way the loop escalates) and keeps escalating. A reset **sets** a level, so there is **at most one
  reset per index**: the router emits one per phase boundary (people retiring in the same month share
  one), and the engine raises `ValueError` on a second.
- `withdrawal: tuple[int, Decimal] | None` — from index *w* (folded ≥ 1) each month
  `balance = balance × factor + contribution + lump − W`.
- `lumps: Mapping[int, Decimal]` — added after growth at their index (0 folds to 1); no random draws.
- **The clamp holds in every phase.** Whenever a month's result would be below 0, the balance becomes 0
  and the path's **depletion index** is recorded (first time only) — during the drawdown, and before it
  when a negative typed `monthly_contribution` (legal, `projectionScenario.ts:57-61`) would have driven
  the balance negative. That keeps `montecarlo.py:17-18`'s "balances stay positive" true and the log
  axis drawable. A depleted path keeps drawing its Gaussian every month (common random numbers: a change
  of spend or retirement never reshuffles later paths).
With the three inputs empty, results are **byte-identical** whenever no balance would go below 0 —
always, with a non-negative contribution — because the loop runs today's statements in today's order
and the clamp never fires. `MonteCarloResult` gains `depletion_indices: list[int | None]`.
`drops`/`drop_schedule` are replaced by `resets` (the router no longer produces drops; engine tests
move to resets). Floats stay floats; no numpy.

**Acceptance.** Engine tests: empty inputs byte-identical to today's pinned strings
(`test_montecarlo.py:139-151`; and at the API, with no grants or `vests=0`, no retirement, no
`plan_until` and no stored plan-until year, `test_projection_api.py:256-303`); a reset mid-horizon
escalates from its level; a second reset at one index raises; withdrawal to depletion clamps at 0 and
records the index; a negative typed contribution clamps at 0 and records depletion before any
drawdown; a depleted path's later draws equal the undepleted run's draws (same RNG sequence); lumps add
exactly.

### R2. Retirement semantics and the phases echo

**Problem.** A retirement removes that person's take-home, payroll saving and match from one stream
floored at 0 (R1), so on prod data Edward's retirement alone zeroes the stream — Grace, still working,
stops saving too — and nothing is withdrawn after the last retirement (`backend/app/api/projection.py:257-268`,
`test_projection_api.py:512-533`).

**Decision.** Earners = people with a usable paycheck profile (`_default_profile`, current or earliest
future — the set `_payroll_savings` counts). Retirement months sort into phases:
- **Working** (t0 → first retirement): the derived (or typed) `monthly_contribution`, as now.
- **Partly retired** (first → last retirement): `resets` to Σ over earners still working of their
  payroll saving + employer match (from their profile in force today). The cash part stops: the working
  partner's pay is assumed to cover spending — no surplus, no withdrawal (the user's rule). When that
  partner's monthly take-home (from the same profile) is below `annual_spend / 12`, the response says
  so in `warnings`: "{Grace}'s take-home (≈ $1.1K/mo) is below your spending (≈ $5.5K/mo); the
  difference is not withdrawn."
- **Retired** (from the last earner's retirement month): contribution 0 and `withdrawal = annual_spend /
  12` (the FI-target figure, constant in today's dollars — the engine runs in real terms; under an
  explicit `inflation=0` that is a flat nominal amount).
A drawdown exists only when every earner has a retirement month on the axis; otherwise the last phase
runs to the horizon and the response says why (R3). New echo (additive): `phases: list[PhaseOut] = []`
with `from_month`, `kind` (`working`, `partly_retired`, `retired`), `working_person_ids`,
`monthly_contribution` (today's dollars at t0), `monthly_withdrawal | None`, `take_home_monthly |
None` (the working earners' take-home, partly-retired phases only); and `drawdown:
DrawdownOut | None` (`start_month`, `annual_withdrawal`). `RetirementOut.monthly_drop` keeps its value
(the paycheck that stops, informational). Retirement 422s are unchanged; a person without a profile
still cannot retire. The growth-only (coast) line is unchanged: no contributions, vests or withdrawals,
so Coast FI keeps its meaning.

**Acceptance.** API tests replacing the floor pins (`test_projection_api.py:512-533, 867-878`,
`test_montecarlo.py:189-207`): one of two retires → the other's saving continues, no withdrawal; both
retire → withdrawals from the later month, the line and the median fall; same month → one reset + the
withdrawal; a single-earner retirement goes straight to drawdown; a typed contribution keeps phase 0
typed and phase 1 profile-derived; the phases echo matches; on the copy "Edward retires Jul 2035, Grace
works" carries the take-home-shortfall warning with Grace's ≈ $1.1K/mo against ≈ $5.5K/mo.

### R3. "Plan until" and "money lasts"

**Decision.**
- Knob `plan_until: int | None` (a calendar year). Absent → the year stored in Settings › Plan
  assumptions (R11) when one is set and not yet past; otherwise the latest year whose December is on the
  axis (start Sep 2026 + 30 years ends Sep 2056 → **2055**; no extension, byte-identical while no year is
  stored). A stored year earlier than the start year is ignored with the warning "The plan-until year in
  Settings ({2025}) has passed — using {2055}." A later year lengthens the horizon to `ceil(months to Dec
  {plan_until} / 12)` years (≤ 60; the echo `years` is the effective value, with the warning "The
  horizon was lengthened to {50} years to reach the end of {2075}."); a knob earlier than the start year
  → 422 "plan_until must be {2026} or later"; beyond 60 years → 422 "plan_until must be {2085} or
  earlier — the projection runs at most 60 years". Retirement months are validated against the
  effective axis.
- `money_lasts: MoneyLastsOut | None` from the **same** simulation as the FI dates: `plan_until`;
  `probability` = share of paths never depleted through Dec {plan_until} (null when volatility is 0);
  `verdict` `on_track` (≥ 0.90) / `borderline` (0.75 ≤ p < 0.90) / `at_risk` (< 0.75) (null when
  probability is null); `lasts_until_p10: date | None` = the month at the 10th percentile of depletion
  indices, "never" sorting as +∞ (`reach_percentile`'s rule; null = beyond the axis); `horizon_end`;
  `deterministic_depleted_month: date | None` (the constant-return line, receipt only); `reason: str |
  None`. `money_lasts` is always present in new responses (optional in TypeScript for replayed
  caches); with no drawdown its figures are null and `reason` is "Withdrawals start once everyone with
  a paycheck has a retirement month — {Grace} has none." or "Set retirement months to see whether the
  money lasts."; with no annual spend (no history and none typed): "Withdrawals need an annual spend —
  type one or enter spending history."; when Dec {plan_until} is before the drawdown month: "{2034} is
  before withdrawals begin ({Jul 2035}) — choose a later year." Success counts a depletion in any phase
  (R1's clamp), so a negative typed contribution that empties the balance before retirement fails too.
- `plan_until` echoes the resolved year, and `plan_until_source: Literal["knob", "setting", "default"]`
  says where it came from.

**Acceptance.** Tests: default year and no extension (byte-identical arrays); the stored year used when
the knob is absent, the knob winning over it, a passed stored year ignored with its warning; extension
math incl. months not a multiple of 12; the 422s; probability counted through Dec of the year (a path
depleting in January of the next year succeeds); verdict boundaries at exactly 0.90 and 0.75;
`lasts_until_p10` null when fewer than 10 % deplete; volatility 0 → deterministic month only; each
reason.

### R4. Scheduled vests, on by default

**Problem.** Vests (≈ $171K gross this year, ≈ $116K after sell-to-cover) are in no leg of the
contribution (`backend/app/api/projection.py:356-390`; the page says so, `ScenarioPanel.tsx:41`).

**Decision.** Knob `vests: bool | None` (absent = on when grants exist; URL `vests:0` turns it off).
Lumps built in the router: per grant `rsu_vesting.schedule` (a grant that will not schedule is skipped
with the Comp page's warning); keep vests dated **after the base snapshot's as-of date** (R5; after
today when the base has no as-of date — a provisional snapshot with no usable recorded date), **before
the primary's retirement month** when one is set, and on the axis; value = shares × the latest employer
quote (`_espp_quote`) × (1 − 0.3223) via the calendar's `after_sell_to_cover` (one owner of the rate),
flat in today's dollars; index = months from `start_month` (0 folds to 1). No quote → no lumps and
"No {NVDA} quote yet — scheduled vests are left out"; no ticker → "Set the employer-stock ticker in
Settings to include vests". Echo `vests: VestsOut | None` (`included`, `price`, `price_as_of`,
`withholding_rate` 0.3223, `next_12_months` after withholding, `by_year: [{year, gross,
after_withholding}]`, `stops: date | None`, `excluded_reason: str | None`). Vests never enter the
growth-only line or the FI target.

**Acceptance.** Tests: on by default, off byte-identical to today; the as-of cut (a Sep 16 vest is in
with a Sep 1 base, out with the Sep 22 provisional base); the retirement cut; no quote; a broken grant;
by-year sums; a base with no as-of date cuts at today. On the copy: `next_12_months` ≈ the calendar's
after-sell-to-cover sum over the same vests.

### R5. Start from the current snapshot

**Problem.** Projection starts from the latest snapshot with month ≤ today, read twice
(`backend/app/api/projection.py:296-304`, `net_worth_calc.py:125-132`) — Sep ($734,884.53, FI ratio
44.8 %) while the Overview shows Oct.

**Decision.** One read through K2's `current_and_previous`; the starting balance is that snapshot's
investable total (the existing sum, by snapshot id). `base_month` echoes its key; new `base_as_of`,
`base_recorded_on`, `base_provisional`. The axis still starts at today's month (a base as-of is never
after today). The Investable balance tile reads "as of {Sep 22} · provisional". Only the starting
balance moves: the derived contribution and annual spend keep their window, which ends at the last
complete month (K3's `last_complete_month`, unchanged).

**Acceptance.** API: base = the current snapshot (K2) incl. a provisional next-month one, never one two
months ahead; the three fields; `test_projection_api.py:108-150` rewritten. On the copy at 2026-09-23:
`starting_balance` 839559.73, `base_as_of` 2026-09-22, `fi_ratio` = 839559.73 ÷ that response's
`fi_target` (the audit measured 51.1 %).

### R6. One headline FI date; the two "p10"s renamed

**Decision.** The headline FI date is the simulation's median first-reach month (`fi_month_p50`) with
its range; with volatility 0 it is `fi_month`, labelled "at a constant return". The deterministic
crossing stays in the payload, the chart's constant-return annotation and the receipt. Words: reach
dates are "1 in 10 paths by", "half of paths by", "9 in 10 paths by" (never "p10/p50/p90"); the balance
fan is "middle 80 % of paths" and "middle 50 % of paths"; depletion is only ever "in 9 of 10 paths the
money lasts until at least {YYYY}".

**Acceptance.** Grep-level test: no user-visible "p10", "p50" or "p90" in `src/components/projection/**`
or `ProjectionPage.tsx`; label tests below.

### R7. The page

**Decision.**
- Tiles (five): FI target · FI ratio · Investable balance ("as of …", R5) · **FI date** — value "{Jun
  2034}" (or "Beyond {Sep 2056}"), delta "1 in 10 paths by {Jan 2031} · 9 in 10 by {May 2041}", receipt
  with "reach FI within {30} years: {99.8 %}" and the constant-return date · **Money lasts** — value
  "{92 %} of paths through {2075}", tone by verdict (on track positive, borderline warn, at risk
  negative), delta "In 9 of 10 paths the money lasts until at least {2079}" (or "beyond {Sep 2076}, the
  end of the projection"); with volatility 0 and a drawdown, "Lasts through {2075} at a constant return"
  or "Runs out {Mar 2061} at a constant return" (neutral tone, no percentage); "—" with the `reason` when
  there is no drawdown. The "Reach FI within" tile goes (its figure lives in the FI date receipt and the
  compare table).
- Chart: a "Retired" wash from the drawdown month (replaces "After FI"); rules "Withdrawals start" and
  "Plan until {2075}"; a "9 in 10 paths last to here" rule at `lasts_until_p10` when on the axis;
  per-person retirement rules as now; the reach marks on the target line labelled "1 in 10 / half / 9 in
  10 paths" with tooltips (`percentileMarks` no longer `silent`); legend swatches unchanged in colour. On
  the log axis a band edge ≤ 0 is drawn at the axis floor instead of dropping the whole month, and the
  footer says "Paths that ran out are drawn at the axis floor."
- Knobs: "Plan until" (year box; placeholder = the echo, which starts from the Settings year when one
  is stored — "{2075} (from Settings)" — else the horizon default; hint "The year the money has to last
  through. Later years lengthen the horizon. Set a lasting default in Settings › Plan assumptions.") and
  "Include scheduled vests" (on/off; readout "≈ {$116K} over the next 12 months, after withholding").
  Hints: `monthly_contribution` — "… Scheduled RSU vests are added separately (Include scheduled
  vests)."; `annual_spend` — "… After everyone with a paycheck has retired, this is also what the
  projection withdraws each year." The retirement paragraph
  (`ScenarioPanel.tsx:284-306`) becomes: "Retirement months split the plan into phases. While one of you
  works, that person's 401(k), HSA and ESPP deductions and employer match keep going, and their pay is
  assumed to cover your spending — the chart's notes say when it does not, and the difference is not
  withdrawn. From the last retirement on, the projection withdraws your annual spend each year in
  today's dollars. Taxes on withdrawals and Social Security are not modelled. RSU vests stop at
  {Edward}'s retirement."
- Compare rows: "FI date (most likely)", "FI · 1 in 10 paths by", "FI · 9 in 10 paths by", "Reach FI
  within horizon", "Money lasts through plan-until year", "Lasts at least until (9 in 10 paths)",
  "Scheduled vests".
- Receipts (`projectionDisplay.ts:78-109`): the probability receipt says what it measures; the
  money-lasts receipt lists plan-until, withdrawal, phases and the caveats (i.i.d. lognormal returns at
  your return and volatility; untaxed withdrawals; no Social Security or pension).
- Codec (`projectionScenario.ts`): `plan_until` (4-digit year, 2000–2199 client fence; the server
  validates exactly) and `vests` (`0`/`1`) join `KNOBS` in alphabetical order; `toParams`,
  `src/api/projection.ts` and the TS types follow.

**Acceptance.** `ProjectionPage.test.tsx` (`:269`, `:452-570`, `:657-710`, `:875-1063`),
`projectionChartOptions.test.ts` (`:112-183`, `:248-266`, `:352-496`), `projectionDisplay.test.ts`,
`projectionScenario.test.ts`, `ScenarioPanel.test.tsx` rewritten (including the volatility-0
money-lasts wording and a Settings-sourced plan-until placeholder); conformance roster and fixtures
(`src/charts/conformance.test.ts:73-79`) updated. Browser on the copy, both themes, 1280 and 1600:
default view (vests on, no retirements); both retire Jul 2035 with plan-until 2075 (drawdown visible,
money-lasts tile with a verdict); one retires (partly-retired phase copy and the take-home-shortfall
note); log axis with depleted paths.

### R8. Historical trend: kept, labelled as a fitted curve

**Problem.** "Net worth over time (projected)" extends a quadratic fit to $9.46M / $92.7M beside a
planning model that says ≈ $1.8M (`src/components/projection/ProjectionTrendPanel.tsx:11-43`,
`polyTrend.ts:35-77`).

**Decision (per the changed user decision).** The tab, the fit (`fitPolyTrend` over every snapshot, as
today), the 1Y/5Y/10Y/40Y reach and the log axis stay. Only honesty changes: title "Net worth trend — a
curve fitted to your recorded history"; lede "A second-degree curve fitted to every recorded net-worth
snapshot, in nominal dollars, extended {10} years. It is not a forecast and uses none of your plan's
assumptions."; footer adds "Its reach is set by the 1Y–40Y chips; the planning horizon and "plan until"
do not change it." The recorded snapshots stay as dots (a provisional one hollow, with T1's tooltip).
Nothing else reads the fit: no tile, receipt, compare row, FI date, money-lasts figure or assistant
context uses it, pinned by an import-fence test (only `ProjectionTrendPanel.tsx` and
`projectionChartOptions.ts` import `polyTrend`). The fit stays a browser computation — an exploratory
display, not an engine figure.

**Acceptance.** Label tests; the import fence; the chart option test for the hollow provisional dot;
existing trend tests (`ProjectionPage.test.tsx:452-570`) keep their fit and span assertions.

### R9. Speed: a result cache per input set, and the simulation off the event loop

**Problem.** `/projection` takes 0.8–1.8 s on prod; one page view is up to five simulations (baseline,
scenario, three pins) plus the assistant's; the pure-Python walk blocks the single event loop.

**Decision.**
- `read_cache.py` gains `PROJECTION_TABLES` — every table the route reads: `accounts`,
  `net_worth_snapshots`, `account_balances`, `spending_categories`, `monthly_spending`,
  `monthly_cashflow`, `paycheck_profiles`, `month_reviews`, `month_review_adoption`, `people`,
  `contribution_limits`, `app_settings`, `category_budgets`, `rsu_grants`, `securities`,
  `latest_prices` — pinned by the SQL-capture test pattern the book's list uses, and
  `cached_projection(db, key, build)` on the existing `_memoised` machinery (stable-store, single-flight,
  pending-changes bypass). Key = (fingerprint, product today, the normalized validated knobs:
  Decimals normalized, retire entries sorted, `vests`, `plan_until`, `years`; the stored plan-until year
  is in `app_settings`, so the fingerprint covers it). LRU of 16. The cache holds the **serialized JSON
  bytes**, not `ProjectionOut` models (seven series of up to 721 Decimals each would sit in memory on a
  1 GB box): the HTTP route returns the bytes as-is, and a direct caller (the assistant) receives
  `ProjectionOut.model_validate_json(bytes)`, so no caller can mutate a shared value and no deep copy is
  needed. 422s and 404s are never cached.
- `simulate` runs via `anyio.to_thread.run_sync(…, limiter=MC_LIMITER)` with a module
  `CapacityLimiter(1)`; the deterministic walk stays inline. Results are identical (the walk is pure;
  Decimal conversions use explicit rounding). The thread still shares the GIL, so other requests slow
  down during a cold run but are no longer blocked for its whole length.

**Acceptance.** Cache tests: a hit for identical knobs; a miss when any listed table, the day or a knob
changes (one test per table); the captured SQL tables equal `PROJECTION_TABLES`; the cached bytes equal
an uncached run's, and two direct callers get independent models. The threaded run's bands equal the
inline run's. Timing on the migrated copy (local, sequential, median of 5, cache cleared for cold):
default cold ≤ 1.15 × the pre-batch baseline measured on the same box; identical repeat ≤ 50 ms;
plan-until 2075 cold ≤ 2.0 × baseline; a `/coverage` request sent 50 ms after a cold `/projection`
completes in under 1 s (a bound, not an ordering race). Record prod expectations in the lane plan.

### R10. Assistant context, URL grammar, parity fixture

**Decision.** `assistant_context._projection` passes `plan_until` and `vests` explicitly (the direct-call
trap: new route parameters are `Annotated[…, Query()] = None`); `PROJECTION_KNOBS` and
`_projection_scenario` accept them; the context carries `money_lasts`, `drawdown`, `phases`, `vests`
and the base fields. `sandbox_entries.json` gains a projection case with `plan_until` and `vests:0`,
read by the three parity suites. The sample prompt "Why do my FI dates differ?" becomes "When do we
reach FI, and does the money last?".

**Acceptance.** `test_assistant_context.py:258-365` extended; `test_sandbox_links.py`,
`scenarioUrl.test.ts`, `projectionScenario.test.ts` pass the new case byte for byte.

### R11. A lasting "Plan until" default in Settings

**Problem.** The plan-until knob, like the retirement months, lives only in the URL and pins, so every
visit restarts at the horizon default (2055) and the money-lasts answer changes meaning from one visit
to the next (review minor 15).

**Decision.** Settings › Plan assumptions (`src/components/settings/PlanAssumptionsCard.tsx`) gains
**"Plan until (year)"** beside the withdrawal rate. It is stored as the `app_settings` key
`plan_until_year` (envelope `{"value": 2075}` — a row, no migration) through the existing `GET/PUT
/settings` (`AppSettingsOut` / `AppSettingsUpdate` gain `plan_until_year: int | None`; `null` clears
it) and read by `read_plan_until_year(db)` in `api/app_settings.py`, which returns None for a missing
or malformed row (the `get_swr_pct` posture). The PUT accepts a whole year **from next year** (the
server's year + 1) **through the latest year the projection can reach** (the one whose December falls
within 60 years of the current month — 2085 today); anything else is a 422 "plan_until_year: must be a
year from {2027} through {2085}". The Projection knob starts from it (R3) and the URL knob still wins.
Like the withdrawal rate beside it, it is a planning preference saved through the settings PUT, which
is not change-logged today and stays that way (its existing grammar). Until the user sets it, the
default stays the latest year whose December is on the horizon (2055 on today's copy).

**Acceptance.** API: round-trip, clear with `null`, the 422 bounds (this year, next year, 2085, 2086),
a malformed row read as None. Card tests: the field shows the stored year, validates like the server
and saves with the other assumptions. Projection: the stored year becomes the default with
`plan_until_source: "setting"` (R3).

---

## Edge cases, decided

| Case | Decision | Items |
|---|---|---|
| First snapshot recorded after its 1st (Sep 2023, Sep 24) | Final; "as of Sep 1, 2023"; the receipt names the recorded date | K2, T1 |
| Provisional snapshot updated on/after its date | Any balances save finalizes (recorded today); Confirm covers "unchanged"; Undo restores | K4, M4 |
| Provisional snapshot saved again before its date | Restamped to that day, still provisional ("as of Sep 25"); Undo restores | K4, M4 |
| A provisional snapshot never saved again after its 1st | Named in Needs attention, the strip and Data status until confirmed or updated; later changes read "since Sep 22 · 40 days (Oct 1 balances stayed provisional)" | K3, T3, T4, M2, §0.4(d) |
| Spending saved during the month (rent) | *Partial* from the 1st: a to-do, amber from the 16th, drawn partial, out of budget seeds; complete after a post-month spending save or "Confirm … spending is complete" | K3, K6, T3, T12, M1 |
| Take-home saved before the card charges post | Never completes spending; the month stays due until spending is saved after the month or confirmed | K3, M1 |
| A post-month spending save that is undone | The month reads *partial* again | K3 |
| An unchanged save after the month | Logs nothing, so it proves nothing — the Confirm exists for exactly this | K3, M1 |
| Month with spending but no snapshot | Allowed; no snapshot is created; the chip shows the spending half; closing blocked until its balances exist; the health check names it | M1, T5, T8 |
| Deleting a month | Two deletes, one per part, each with the typed guard and Undo | M6 |
| Workbook re-import and `recorded_on` | A final snapshot's date is never rewritten; warnings name differences; a provisional one whose balances change on/after its 1st is finalized on the import day; pre-month rows import provisional | K5 |
| Closed / reviewed months | Digests untouched (finalization never touches final snapshots; `review_input_v1` frozen); real-data parity asserted; a provisional month cannot be closed; a closed month's spending counts as entered even after later edits | K3, K4 |
| Legacy months recorded early | Never restamped and never blocked, so they stay in the averages; left out of `provisional_past` | K3, K4 |
| Year boundary | Jan 1 balances due Jan 1, December flows due, one reminder listing both; YTD base = Jan 1 of the new year ("not recorded yet" until then); an early Jan 1 snapshot recorded in December counts toward the old year's YTD "to Dec 28"; last complete month unchanged; the Will I owe? card follows the server year | K3, T2, T6, W11 |
| Months with no take-home | Due/overdue until a take-home row exists (0.00 counts); the flows line and reminder name "take-home" | K3, T3, T6 |
| Grace period across month lengths | Thresholds are the reminder date + 6 (capped at the month's last day) / + 15 days — date arithmetic; the missing window ends at the newest month already overdue | K3 |
| Browser vs server today | The server's day via `X-Product-Today`; the browser clock only before the first response; the dev override is read from the process environment only and stamps the change log on the same day | K1 |
| Reminder keys and overrides | Keys and ICS UIDs unchanged; zero existing `ritual:` overrides on the copy | T6 |
| Single-earner households | Tax engine byte-identical (ESPP components 0); withholding byte-identical when the first profile starts on/before Jan 1 (the first grid check is Jan 16); projection byte-identical with no retirements, vests off, no plan-until year stored and a non-negative contribution | W1, W6, R1 |
| A job that starts on the 1st | The grid's check on that 1st pays the half-month before it and is $0; the first counted check is the 16th (Grace: 8 checks) | W1 |
| Partial retirement | Working partner's payroll saving + match continue; pay covers spending; no withdrawal; a note when their take-home is below your spending | R2 |
| Depletion before the plan-until year | Counts as failure; clamps at 0 in any phase; keeps drawing random numbers | R1, R3 |
| Plan-until earlier than the last retirement | `money_lasts` figures null with the reason | R3 |
| A stored plan-until year that has passed | Ignored with a warning; the horizon default applies | R3, R11 |
| Vests with no quote / no ticker | Left out with a reason | R4 |
| A person with no profile at all | Not an earner (projection); no paycheck reconciliation rows, a note; entered-mode withholding as today | R2, W3 |
| 401(k) or HSA deferrals above the year's limit | The projection stops at the stored limit (split by rate for the 401(k)); uncapped when no limit is stored | W3 |
| Live quotes and the RSU flag | The flag prices unvested vests at the close on or before the 1st of the month, after a ±10 % band; the figures shown stay on today's quote | W3 |
| Far-future months | The wizard refuses; the server still accepts (API/import), labels them provisional, never makes them current and names them in a health check | M3, K2, T5 |

---

## Process, verification and rollout

**V1. Per lane** (in its worktree): write a lane plan (superpowers:writing-plans) at
`docs/superpowers/plans/2026-09-2x-<lane>.md` (x = the day it is written; lanes k, t, m, w, r); TDD for
every behaviour change; worktrees get a `node_modules` **junction** (PowerShell `New-Item -ItemType
Junction` — Git Bash `ln -s` copies on this box; check `ReparsePoint` before deleting any worktree's
`node_modules`); a private test database per lane (`FINANCE_TEST_DB=finance_test_{k,t,m,w,r}`, never the
shared one); full backend suite, `ruff`, full vitest, `tsc -b`, `eslint`, `vite build`; small,
described commits. Browser checks run each lane's own backend (port 80xx, `SCHEDULER_ENABLED=0`,
`SNAPSHOT_ENABLED=0`, `PRODUCT_TODAY` per scenario) and Vite (`VITE_API_PROXY`).

**V2. Review.** An independent reviewer per lane checks spec compliance, then code quality; every
finding is fixed or answered; re-review until clean.

**V3. Merge** to **local main only** in the order K → W → R → T → M (ready-first after K allowed),
re-running the gates after each merge; the user pushes and deploys.

**V4. Real-data verification without writing to the shared copy.**
- Source: `finance_realdata` (prod's 2026-09-23 06:30 UTC nightly, head f12026091203). Never written.
- Current, migrated copy (inside the dev Postgres container `finance-dashboard-db-1`, user `finance`):
  `createdb -T finance_realdata finance_realdata_b2` (or `pg_dump finance_realdata | psql
  finance_realdata_b2` when the template has open connections), then `alembic upgrade head`
  with `DATABASE_URL` pointing at **finance_realdata_b2 only** (f12026091203 → f12026092301; this batch
  adds nothing). Record the head and every table's row count before and after.
- Seed prod's September history into `finance_realdata_b2`: the copy's change log holds only its restore
  line, so without history September would read *entered* under K3 clause (b). A seed script kept in the
  lane plan (not in the app) inserts change-log rows mirroring the census facts — `monthly_spending`
  delete ×19 by `repair` at 2026-09-04, insert ×19 + update ×1 by `ui` at 2026-09-07 12:00 PT, and a
  `monthly_cashflow` insert + delete by `ui` at 2026-09-07, all with `month` 2026-09-01 — so September
  reads *partial* from Oct 1, exactly as prod will. `finance_realdata_b2` is written only by this setup
  (migrate + seed); after it, it is used read-only.
- Read-only use: backends for browser walks point at `finance_realdata_b2`; walk scripts issue GETs only
  (a request fence that aborts any non-GET, the audit's pattern). A write scenario clones
  `finance_realdata_b2` to `finance_realdata_b2_<lane>` and drops it afterwards.
- Fresher data is optional: prod nightlies are GPG-encrypted since 2026-09-23 07:02 UTC, so a newer copy
  needs the user to decrypt on prod (their census/backup recipe); not required for this batch.
- Scenarios (`PRODUCT_TODAY`): **2026-09-23** (provisional headline, nothing due — the strip reads
  "Nothing due — Oct 1 balances recorded early (Sep 22); update or confirm them on Oct 1" — YTD
  +$327,976.91, Projection base $839,559.73 as of Sep 22, no amber, no health WARN, the Oct 1 reminder
  listing both parts); **2026-10-03** (two to-dos — "Update Oct 1 balances — recorded early, on Sep 22"
  and "Finish September spending and enter take-home" — September drawn partial, budget seeds ending at
  Aug 2026, the wizard landing on Oct 1 balances, September's story on review); **2026-10-16** (flows
  overdue amber); **2027-01-05** (year boundary). Write scenarios on a clone at 2026-10-01/03: Confirm Oct
  1 balances → final, Undo → provisional; save September take-home only → no snapshot row in the change
  log and September still *partial*; save a September amount on Oct 3 → *entered*, Undo → *partial*;
  "Confirm September spending is complete" → *entered*; close September.
- Before/after screenshots of every changed view (Overview, Net worth, Spending — charts, ribbon and
  Budgets — Credit cards detail, Monthly update, Taxes Summary / What-if / Inputs, Paycheck pace,
  Projection both tabs, Calendar, Settings Data, System and Plan assumptions) in dark and light at 1600,
  the busiest also at 1280 and 1920; "before" is main at the merge base with the real clock of the day,
  "after" uses `PRODUCT_TODAY` set to that same day plus the scenario days; 0 console or page errors.
- Timings on `finance_realdata_b2` (R9's and W12's targets; plus `/coverage` — whose warm median stays
  within 1.2× its pre-batch median, the evidence being one indexed SELECT over the candidate months —
  `/net-worth/summary` and the withholding GET, before and after).

**V5. Rollout (for the user; not executed).** Push `main`; on prod `git pull` and the README 4.1
rebuild of **both** images. This batch adds **no migration**. If the unpushed reorder batch
(f12026092301) ships in the same deploy, the deploy applies that migration: take **"Snapshot now"
right after the deploy** (older snapshots and restore points read "different schema — not restorable
here"). **Reload every open tab** after the deploy (README 4.4): a tab still running the old bundle
sends `recorded_on` on every save, so its Oct 1 save would not finalize and a spending save could still
copy a snapshot. After deploy: the Overview says "Net worth — as of Sep 22 · Provisional" until you save
the Oct 1 balances; on Oct 1 open /update, update or confirm the Oct 1 balances. From Oct 1 September
reads **partial** (its spending was saved on Sep 7): once its charges have posted, add them and save —
or press "Confirm September spending is complete" — enter its take-home, and close it. Read Taxes › Will
I owe? and fix any flagged input by hand (the headline stays on your typed inputs). On Projection set
both retirement months, and set a lasting "Plan until (year)" in Settings › Plan assumptions.

**V6. README "moved by design".**
- *Time model* (new README section): balances are dated ("as of Oct 1"; provisional when recorded early);
  YTD now starts from Jan 1 (+$366,338.18 → +$327,976.91 on the 09-23 data); Projection starts from the
  same current snapshot as the Overview ($734,884.53 → $839,559.73 investable on 09-23; FI ratio up
  accordingly); the monthly reminder fires; Needs attention, Data status and Data health flag only what is
  due; spending saved while its month was still running stays *partial* until it is saved again after
  the month or confirmed complete, and such a month stays out of budget suggestions and is drawn as
  partial; every month's review state is unchanged.
- *§7.5 tax divergences*, more deliberate changes: the ESPP §423 qualifying cap falls to 85 % of the old
  figure (ordinary income moves only where the cap binds); ESPP ordinary income out of Medicare/SS/SDI;
  `gross_income` (take-home, effective rate) includes ESPP gains — no stored year carries ESPP
  components on the 09-23 data, so nothing stored moved; and a check on or before a person's first
  paycheck profile date counts as $0 (Grace's projected withholding $5,850.00 → $1,950.00, 8 checks from
  Sep 16; her Paycheck pace figures shrink the same way). **Do not "fix" these.**
- *Sandboxes / Projection*: scheduled vests are included by default (the FI date moves earlier); a
  retirement now splits the plan into phases and withdraws annual spend after the last one (the old
  "balance stops moving" behaviour is gone); a balance never goes below $0 in any phase (a negative
  typed contribution bottoms out at $0); the headline FI date is the simulation's median; the Historical
  trend is a fitted curve, not a forecast.
