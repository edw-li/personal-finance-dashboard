export interface TokenResponse {
  access_token: string
  token_type: string
}

export interface MeResponse {
  email: string
}

export type AccountGroup =
  | 'cash'
  | 'pre_tax'
  | 'post_tax'
  | 'taxable'
  | 'equity'
  | 'other'
  | 'liability'

export interface AccountOut {
  id: number
  name: string
  slug: string
  group: AccountGroup
  sort_order: number
  is_active: boolean
  is_component: boolean
  parent_account_id: number | null
  /** NULL = joint/household, never "unknown" — the migration backfilled every row. */
  person_id: number | null
}

export interface AccountCreate {
  name: string
  group: AccountGroup
  sort_order?: number
  is_component?: boolean
  /** Omitted or null = joint; the API never guesses the primary person. */
  person_id?: number | null
  parent_account_id?: number | null
}

export interface AccountUpdate {
  name?: string
  group?: AccountGroup
  sort_order?: number
  is_active?: boolean
  is_component?: boolean
  /** Explicit null RETAGS to joint; an omitted key leaves the owner alone. */
  person_id?: number | null
  /** Explicit null UNLINKS the parent; an omitted key leaves it alone. */
  parent_account_id?: number | null
}

export interface BalanceEntry {
  account_id: number
  balance: string
}

/** One EXCLUSIVE owner column of the timeseries — `name` is null for the joint
 *  (NULL-owned) row; the UI supplies the word "Joint". Values are aligned with `months`
 *  and sum to `net_worth` month by month, which is why they can be stacked. */
export interface OwnerSeries {
  person_id: number | null
  name: string | null
  values: string[]
}

export interface OwnerTotal {
  person_id: number | null
  name: string | null
  total: string
}

export interface NetWorthTimeseries {
  months: string[]
  accounts: AccountOut[]
  series: { account_id: number; values: (string | null)[] }[]
  group_totals: Record<AccountGroup, string[]>
  net_worth: string[]
  mom_pct: (string | null)[]
  /** Snapshot notes aligned with months — the chart's annotation layer (user text). */
  notes: (string | null)[]
  /** Per-owner net worth, primary person first and Joint last — the "By owner" stack. */
  owner_series: OwnerSeries[]
}

export interface GroupSummary {
  group: AccountGroup
  total: string
  mom_delta: string | null
}

export interface NetWorthSummary {
  month: string | null
  net_worth: string | null
  mom_delta: string | null
  mom_pct: string | null
  groups: GroupSummary[]
  /** The latest snapshot split by owner instead of by group; empty with no snapshots. */
  owner_totals: OwnerTotal[]
}

/** Which months each hand-entered feed covers — ascending first-of-month ISO dates
 *  (GET /coverage, 2026-09-03 shell spec §7). */
export interface CoverageOut {
  balances: string[]
  spending: string[]
  net_pay: string[]
}

export interface MonthBalances {
  month: string
  exists: boolean
  recorded_on: string | null
  notes: string | null
  balances: BalanceEntry[]
}

export interface MonthUpsertResult {
  month: string
  snapshot_created: boolean
  created: number
  updated: number
  unchanged: number
  /** The change batch this save wrote — null when nothing changed. */
  batch_id?: string | null
}

export interface CategoryOut {
  id: number
  name: string
  slug: string
  sort_order: number
  is_active: boolean
}

export interface CategoryCreate {
  name: string
  sort_order?: number
}

export interface CategoryUpdate {
  name?: string
  sort_order?: number
  is_active?: boolean
}

export interface AmountEntry {
  category_id: number
  amount: string
}

export interface SpendingMatrix {
  months: string[]
  categories: CategoryOut[]
  // budgets: the category's RESOLVED budget per month (greatest effective_month <= M,
  // spec §2), aligned with months; null = unbudgeted that month.
  series: { category_id: number; values: (string | null)[]; budgets: (string | null)[] }[]
  totals: string[]
  net_pay: (string | null)[]
  savings_rate: (string | null)[]
  four_pct_rule: (string | null)[]
  /** Sum of the resolved category budgets per month; null when NO category has one. */
  total_budget: (string | null)[]
}

export interface SpendingMonth {
  month: string
  exists: boolean
  net_pay: string | null
  amounts: AmountEntry[]
  /** Budgets RESOLVED for this month — only categories with one appear (wizard subtext). */
  budgets: AmountEntry[]
}

export interface CategoryBudgetEntry {
  effective_month: string
  /** null = the dated "budget ends here" marker (spec §2), not a missing value. */
  amount: string | null
}

export interface SpendingUpsertResult {
  month: string
  created: number
  updated: number
  unchanged: number
  net_pay_set: boolean
  /** An explicit `net_pay: null` deleted the month's cashflow row (the blank-clears rider). */
  net_pay_cleared: boolean
  /** The change batch this save wrote — null when nothing changed. */
  batch_id?: string | null
}

export interface YearRollup {
  year: number
  by_category: { category_id: number; total: string }[]
  total: string
  net_pay_total: string | null
  savings_rate: string | null
}

export interface SpendingYearly {
  years: YearRollup[]
}

export type HoldingType = 'etf' | 'mutual_fund' | 'stock' | 'private'
export type TransactionType = 'buy' | 'sell' | 'split'
export type TransactionSource = 'import' | 'ui'
export type AllocationDimension = 'industry' | 'type' | 'account'

export interface SecurityOut {
  id: number
  ticker: string
  name: string
  industry: string | null
  holding_type: HoldingType
  is_manual_priced: boolean
  is_active: boolean
  annual_dividend: string | null
  ex_div_date: string | null
}

export interface SecurityCreate {
  ticker: string
  name: string
  industry?: string | null
  holding_type: HoldingType
  is_manual_priced?: boolean
  annual_dividend?: string | null
  ex_div_date?: string | null
}

export type SecurityUpdate = Partial<Omit<SecurityCreate, 'ticker'>> & {
  is_active?: boolean
}

export interface TransactionOut {
  id: number
  security_id: number
  account: string
  type: TransactionType
  txn_date: string | null
  shares: string
  price: string
  fees: string | null
  split_factor: string | null
  sort_index: number
  source: TransactionSource
  notes: string | null
}

export interface TransactionCreate {
  security_id: number
  account: string
  type: TransactionType
  txn_date?: string | null
  shares?: string | null
  price?: string | null
  fees?: string | null
  split_factor?: string | null
  notes?: string | null
}

export type TransactionUpdate = Partial<Omit<TransactionCreate, 'security_id'>>

export interface DividendOut {
  id: number
  security_id: number
  account: string | null
  pay_date: string
  amount: string
  // Ownership: 'auto' rows belong to the refresh (rewritten every run inside its window,
  // and a delete comes back next run); 'manual' rows are the user's alone. The three
  // event fields are the auto path's provenance — always null on a manual row, and on
  // auto rows pay_date equals ex_date (Yahoo's chart feed carries no payment date).
  source: string
  ex_date: string | null
  per_share: string | null
  shares_held: string | null
  notes: string | null
}

export interface DividendCreate {
  security_id: number
  account?: string | null
  pay_date: string
  amount: string
  notes?: string | null
}

/**
 * The dividends PATCH body — createDividend's minus the immutable security_id, the same
 * formula TransactionUpdate applies above; `updateDividend` in src/api/portfolio.ts is
 * its consumer. (The server refuses an explicit null for amount/pay_date — 422 — so a
 * sparse caller may omit them but must not blank them.)
 */
export type DividendUpdate = Partial<Omit<DividendCreate, 'security_id'>>

export interface HoldingOut {
  security_id: number
  ticker: string
  name: string
  industry: string | null
  holding_type: HoldingType
  is_manual_priced: boolean
  shares: string
  avg_cost: string | null
  cost_basis: string
  price: string | null
  quoted_at: string | null
  price_source: 'yfinance' | 'manual' | null
  day_change_pct: string | null
  day_change_amount: string | null
  market_value: string | null
  weight_pct: string | null
  unrealized_gl: string | null
  unrealized_gl_pct: string | null
  realized_gl: string
  dividends_collected: string
  annual_dividend: string | null
  annual_income: string | null
  yield_pct: string | null
  yoc_pct: string | null
  xirr_pct: string | null
  accounts: string[]
  warnings: string[]
}

export interface HoldingsTotals {
  market_value: string
  cost_basis: string
  unrealized_gl: string
  unrealized_gl_pct: string | null
  day_change_amount: string | null
  day_change_pct: string | null
  realized_gl: string
  dividends_collected: string
  annual_income: string
  unpriced_count: number
}

export interface HoldingsResponse {
  /** OLDEST quote timestamp — the staleness clock ("Prices as of", attention strip). */
  as_of: string | null
  /** NEWEST quote timestamp — dates the performance chart's live ping. Never swap the
   * two: a stale manual quote in as_of would drag the ping behind the weekly series'
   * end and silently retire it. */
  latest_quote_at: string | null
  totals: HoldingsTotals
  holdings: HoldingOut[]
}

export interface AllocationSlice {
  key: string
  market_value: string
  weight_pct: string
  holdings: number
}

export interface AllocationResponse {
  by: AllocationDimension
  total_market_value: string
  slices: AllocationSlice[]
}

// GET /portfolio/history — parallel arrays (NetWorthTimeseries posture); index i across
// all five lists is one weekly imported point. sp500 is the sheet's baseline: the
// STARTING balance benchmarked into VOO shares. benchmark is the contribution-matched
// leg, derived server-side at read time — every inferred contribution buys VOO instead.
// Entries are Decimal strings wherever computable; all-null only when VOO has no bars.
export interface PortfolioHistory {
  dates: string[]
  market_value: string[]
  cost_basis: string[]
  sp500: string[]
  benchmark: (string | null)[]
}

// GET /portfolio/dividend-events — display-only historical ex-dividend feed (2026-08-28):
// provider-known dates and per-share amounts from BEFORE the auto-ingest's 370-day window
// (the ledger owns everything inside it). Deliberately NO dollar amount: shares held on an
// old ex-date are unknowable from the dateless imported book, so these annotate the
// performance chart and never join dividend_payments or any money figure.
export interface DividendEventOut {
  security_id: number
  ex_date: string
  per_share: string
}

export interface RealizedRow {
  security_id: number
  ticker: string
  name: string
  realized_gl: string
}

export interface RealizedResponse {
  total: string
  rows: RealizedRow[]
}

// GET /portfolio/accounts — the labels behind every transaction's and dividend's `account`
// string, with their owner. person_id null = JOINT (the net-worth convention, never
// "unknown": the migration backfilled every pre-existing label to the primary person).
// Labels are immutable this batch — they are the positions' identity.
export interface PortfolioAccountOut {
  id: number
  label: string
  person_id: number | null
}

// PATCH /portfolio/accounts/{id} — person_id ONLY, and always explicitly: an omitted key
// means "leave the owner alone" server-side, so retagging to joint must send null.
export interface PortfolioAccountUpdate {
  person_id: number | null
}

export interface RefreshResult {
  updated: string[]
  failed: Record<string, string>
  skipped_manual: string[]
  duration_ms: number
  dividends_ingested: number
}

// GET /prices/refresh-status — the persisted outcome of the most recent refresh run
// (manual or scheduled) plus the live scheduler's next fire.
export interface LastRefresh {
  at: string
  trigger: string
  updated: number
  failed: Record<string, string>
  skipped_manual: number
  history_appended: boolean
  // Optional, not required: a payload stored before the dividend feature shipped carries
  // none of these keys and the server echoes nulls for it (stale-deploy armor).
  dividends_ingested?: number | null
  dividends_removed?: number | null
  dividends_skipped_overlap?: number | null
}

export interface RefreshStatus {
  /** null before the first recorded run. */
  last: LastRefresh | null
  /** null when no scheduler is running (SCHEDULER_ENABLED=0). */
  next_run_at: string | null
}

// GET /system/status — the Settings System card's and the Overview snapshot's feed: the
// refresh-status shape (verbatim; one composition server-side) plus scheduler, database,
// backup and environment facts. PortfolioPage keeps reading /prices/refresh-status.
export interface SystemPricesStatus extends RefreshStatus {
  scheduler_running: boolean
}

export interface SystemDatabaseStatus {
  size_bytes: number
  /** null when the alembic_version table is absent or empty (create_all-built schemas). */
  alembic_head: string | null
}

export interface BackupStatus {
  last_success_at: string
  object_key: string
  /** du -h's human string ("1.2M") exactly as backup_db.sh recorded it — not bytes. */
  size: string
  /** Verify-phase fields (2026-09-03 data-lifecycle spec §8) — absent on markers an older
   *  script wrote; `verified === false` carries `verify_error`. */
  size_bytes?: number | null
  encrypted?: boolean | null
  retention_days?: number | null
  verified?: boolean | null
  verified_at?: string | null
  row_counts?: Record<string, number> | null
  verify_error?: string | null
}

export interface BackupRun {
  at: string
  ok: boolean
  /** The uploaded object key — absent on failed runs. */
  object?: string | null
  error?: string | null
  /** Absent on runs the script wrote before the verify phase. */
  verified?: boolean | null
}

export interface RefreshRun {
  at: string
  trigger: string
  updated: number
  failed_count: number
}

export interface SystemStatus {
  prices: SystemPricesStatus
  database: SystemDatabaseStatus
  /** null until backup_db.sh records its first marker (or while the row is malformed). */
  backup: BackupStatus | null
  /** Last-10 run trails, newest first. Optional, not required: a stale deploy's payload
   *  lacks them and must still parse (the LastRefresh armor); consumers `?? []`. */
  backup_runs?: BackupRun[]
  refresh_runs?: RefreshRun[]
  /** settings.environment verbatim — 'dev' | 'prod' in practice; never a reason to reject. */
  environment: string
}

export interface PricePoint {
  d: string
  c: string
}

// GET /prices/history/{ticker}?days= — daily closes, oldest first (the holding drill-in's
// chart feed; the sparklines endpoint is the weekly-downsampled cousin).
export interface PriceHistoryResponse {
  ticker: string
  points: PricePoint[]
}

// Partial: a held security with no bars is ABSENT (not []) — consumers must `?? []`
// (Task 12 review M1).
export type SparklinesResponse = Partial<Record<string, PricePoint[]>>

export interface LatestPriceOut {
  security_id: number
  price: string
  quoted_at: string
  source: 'yfinance' | 'manual'
}

// --- taxes ---
// Money, rates and effective rates are pydantic Decimals on the wire — JSON strings, at
// the quantum the router picked: inputs 4dp, bracket rates 4dp, thresholds 2dp, summary
// money 2dp, effective rates 6dp.

// How ONE year is filed, and which of a year's bracket tables a request means. Mirrors the
// backend's `FilingStatus` Literal (app/schemas/taxes.py), whose columns
// (`tax_years.filing_status`, `tax_brackets.filing_status`) are NOT NULL default 'single' —
// so every row that existed before the marriage migrations is a single filer and history is
// untouched.
export type FilingStatus = 'single' | 'married_joint' | 'married_separate'

export interface TaxYearOut {
  year: number
  notes: string | null
  filing_status: FilingStatus
  input_count: number
  bracket_count: number
}

// PATCH /taxes/years/{year} — the year row's one mutable field. Flipping it changes which
// bracket tables the engine walks, whether the per-person inputs split into two columns,
// and therefore every figure on the page: the caller reloads the year afterwards.
export interface TaxYearUpdate {
  filing_status: FilingStatus
}

// One person COLUMN of a year's return, in render order (primary first). Not the household
// roster: the server has already narrowed it to the people THIS year's status covers —
// everybody under married-joint, the primary alone under single and MFS.
export interface TaxPersonOut {
  id: number
  name: string
}

export interface TaxInputItemOut {
  key: string
  label: string
  sort_order: number
  is_derived: boolean
  // Definition flag (`tax_input_definitions.is_per_person`): this key is stored once per
  // PERSON — salary, the W-2 family, 401k, HSA, pre-tax deductions and the two tracker-only
  // withholding keys — so the payload repeats the item once per person column. Household
  // keys (interest, dividends, itemized deductions, LTCG…) appear exactly once.
  is_per_person: boolean
  // WHICH column this item belongs to. Null for a household key, and also for a per-person
  // key on a database with no people roster — the pre-household spelling of "the primary".
  person_id: number | null
  value: string | null
  // The sheet's gray-cell formula for this key, when it has one, computed from THIS column's
  // own values. Advisory: the UI offers a chip, nothing is ever applied server-side.
  // Present-ness (not is_derived) is what a chip renders on.
  suggested: string | null
}

export interface TaxInputSectionOut {
  section: string
  items: TaxInputItemOut[]
}

export interface TaxInputsOut {
  year: number
  // The status these columns were assembled under — the payload's own answer, so the form
  // can never draw two columns for a year the engine is reading as one return.
  filing_status: FilingStatus
  // The person columns, primary first. Empty on a roster-less database, which reproduces
  // the pre-household payload exactly.
  people: TaxPersonOut[]
  sections: TaxInputSectionOut[]
}

// One person-qualified write. `person_id` null on a per-person key means "the primary
// person" — which is what every client that predates this batch says by saying nothing.
export interface TaxInputRowIn {
  key: string
  person_id: number | null
  value: string | null
}

// PUT body — keys unknown to the definition table are a 422, and a null VALUE unsets
// (deletes) that stored input rather than storing a 0. `values` is the household/primary
// shorthand every shipped client sends; `rows` is its person-qualified form. The two are
// merged server-side, and the same (key, person) twice is a 422.
export interface TaxInputsUpdate {
  values: Record<string, string | null>
  rows?: TaxInputRowIn[]
}

export interface TaxBracketOut {
  bracket_index: number
  rate: string
  threshold: string
}

// The PUT element. `bracket_index` is renumbered server-side on every replace and a
// round-tripped one is ignored, so an edited TaxBracketOut VARIABLE can be handed straight
// back (a fresh object literal carrying bracket_index trips excess-property checking).
export interface TaxBracketIn {
  rate: string
  threshold: string
}

// A Record, not a fixed key set: the six known jurisdictions are always present, and an
// importer-written extra one survives a read. Drive render order from `JURISDICTIONS`
// (src/api/taxes.ts) and append whatever else came back.
export interface TaxBracketsOut {
  year: number
  // WHICH status' tables these are. The GET defaults to 'single' rather than the year's own
  // status, so a caller that cares always names one.
  filing_status: FilingStatus
  // Every status this YEAR has at least one stored bracket row for, sorted — the editor's
  // tab set, so an MFJ table entered ahead of the wedding stays reachable from a year still
  // filed single.
  statuses_with_rows: FilingStatus[]
  jurisdictions: Record<string, TaxBracketOut[]>
}

// Per-jurisdiction FULL REPLACE within ONE status: a jurisdiction absent from the body is
// untouched, and so is every other status' copy of it; an empty array deletes that table.
// Unknown jurisdiction names are a 422.
export interface TaxBracketsUpdate {
  filing_status: FilingStatus
  jurisdictions: Record<string, TaxBracketIn[]>
}

// Which cloned tables are usually right as they landed, and which need edits. Social
// Security's wage base and SDI's rate/cap are per-person parameters that do not move with
// filing status, so the copy IS the answer; federal, state, capital gains and Medicare's
// additional tier are per-return thresholds and only a starting shape. The classification is
// FIXED (a property of the tax code), not derived from what the source happened to hold.
export interface BracketCloneReviewFlags {
  verbatim_ok: string[]
  review: string[]
}

export interface TaxBracketsCloneOut extends TaxBracketsOut {
  review_flags: BracketCloneReviewFlags
}

export interface IncomeTaxOut {
  agi: string
  taxable_income: string
  tax: string
  effective_rate: string | null
}

export interface WageTaxOut {
  w2_income: string
  taxable_wages: string
  tax: string
  effective_rate: string | null
}

export interface CapitalGainsTaxOut {
  taxable_income: string // the ordinary income the gains stack on top of
  gains_amount: string
  tax: string
  effective_rate: string | null // null when there are no gains (the sheet's #DIV/0!)
}

export interface TaxTotalsOut {
  gross_income: string
  total_income: string
  total_tax: string
  take_home: string
  effective_rate: string | null
}

export interface TaxSummaryOut {
  year: number
  // Jurisdictions with NO bracket table for this year's filing status. Always empty for a
  // single-filer year (a partial single year has always computed, with per-jurisdiction
  // warnings, and stored history depends on that). Non-empty means the engine REFUSED to
  // compute rather than walk another status' thresholds — and then **every section below is
  // null on the wire**, so a reader must check this FIRST and never touch a figure.
  //
  // Typed optional rather than required on purpose: the field only started being reported
  // with the marriage batch, and requiring it would break the pinned golden `TaxSummaryOut`
  // fixtures in taxChartOptions.test.ts / overviewChartOptions.test.ts that predate it. The
  // sections stay non-nullable for the same reason — the trend feed keeps refusal years OUT
  // of `years` entirely (see `incomplete` below), so the ONLY payload that can carry nulls
  // is GET /years/{y}/summary, which SummaryPanel guards on this list.
  brackets_missing_for_status?: string[]
  federal: IncomeTaxOut
  state: IncomeTaxOut
  medicare: WageTaxOut
  social_security: WageTaxOut
  disability: WageTaxOut
  capital_gains: CapitalGainsTaxOut
  // NIIT (2026-08-31): capital_gains' wire shape — gains_amount is net investment
  // income, taxable_income the surcharged base. OPTIONAL for brackets_missing_for_status's
  // reason above: pinned fixtures predate the section, and an absent section reads as
  // zero everywhere it is charted.
  niit?: CapitalGainsTaxOut
  totals: TaxTotalsOut
  warnings: string[]
}

// A year the trend feed had to skip — named so the page can offer the fix.
export interface TaxIncompleteYearOut {
  year: number
  filing_status: FilingStatus
  brackets_missing_for_status: string[]
}

export interface TaxSummariesOut {
  years: TaxSummaryOut[]
  // Kept OUT of `years` on purpose: that list is consumed positionally by the chart builders
  // and a null-sectioned entry would be a landmine in every consumer. Optional here so the
  // repo's existing `{ years: [...] }` fixtures keep compiling; read it with `?? []`.
  incomplete?: TaxIncompleteYearOut[]
}

// --- taxes: what-if ---
// POST /taxes/what-if — a scenario run against a STORED year; nothing is written. The
// request halves mirror backend/app/schemas/taxes.py's WhatIfIn field-for-field (an
// omitted `price`/`sale_price` means "use the latest quote", and an omitted `term` means
// "long", with a warning when the lot's acquisition dates are unknown). Money and rates
// arrive as Decimal strings at the summary's own quanta — money 2dp, effective rates 6dp
// — and are rendered verbatim, never re-derived from the two summaries.

export interface SaleLegIn {
  security_id: number
  shares: string
  price?: string
  term?: 'long' | 'short'
}

export interface EsppSaleIn {
  lot_id: number
  sale_price?: string
}

export interface WhatIfDelta {
  total_tax: string
  take_home: string
  federal_tax: string
  state_tax: string
  medicare_tax: string
  social_security_tax: string
  disability_tax: string
  capital_gains_tax: string
  // NIIT delta (2026-09-03 planning-sandboxes spec §13). OPTIONAL: pinned fixtures and the
  // assistant's compact result predate it; null when either summary has no NIIT block.
  niit_tax?: string | null
  // A fraction delta (scenario − baseline); null when either side has no rate at all.
  effective_rate: string | null
}

export interface ChangedInput {
  key: string
  label: string
  before: string // "0.00" when the key had no stored row (2dp, _money-rendered)
  after: string
}

export interface SaleDetailOut {
  security_id: number
  ticker: string
  shares: string
  price: string
  proceeds: string
  cost_basis: string
  gain: string
  term: string
  warnings: string[]
}

export interface EsppSaleDetailOut {
  lot_id: number
  purchase_date: string
  shares: string
  sale_price: string
  proceeds: string
  ordinary_income: string
  capital_gain: string
  term: string
  disposition: string
  warnings: string[]
}

export interface WhatIfOut {
  year: number
  baseline: TaxSummaryOut
  scenario: TaxSummaryOut
  delta: WhatIfDelta
  changed_inputs: ChangedInput[]
  sale_details: SaleDetailOut[]
  espp_sale_details: EsppSaleDetailOut[]
  warnings: string[]
}

// --- taxes: the "Will I owe?" tracker ---
// GET /taxes/years/{year}/withholding — the CURRENT year only (any other year is a 422,
// even a stored one) and computed end to end at read time from paycheck profiles, RSU
// grants, employer prices and the bracket tables; nothing in it is persisted. Money is 2dp
// Decimal strings. Every input is a soft link that can break — a missing ticker, no bar
// behind a past vest, no current quote, an unschedulable grant, an unusable profile — and
// each break EXCLUDES that piece from the estimate and names itself in `warnings` rather
// than failing the read, so the warnings are part of the number, not decoration.

/** Withholding received so far vs the full-year estimate — the shape both legs below wear. */
export interface WithholdingLegOut {
  ytd: string
  projected: string
}

/** The partner's SIMULATED salary leg — the primary's leg shape plus its own check grid. */
export interface WithholdingPartnerLeg {
  ytd: string
  projected: string
  checks_elapsed: number
  checks_total: number
}

export interface WithholdingOut {
  year: number
  // 'single' | 'married_joint' | 'married_separate' — a plain string on the wire (the
  // backend validates it Python-side, like `group`), so the card compares rather than
  // switches on a union it would have to keep in lockstep.
  filing_status: string
  // The engine's liability for the year — the same figure TaxSummaryOut.totals.total_tax
  // carries, verbatim. NULL exactly when the engine REFUSED: a married year with no bracket
  // table for its filing status (see `brackets_missing_for_status`). The withholding legs
  // below are still real — they come from profiles, grants and prices — but there is
  // nothing honest to compare them against, and the card must say so rather than compare
  // against a zero.
  liability_total: string | null
  // The salary leg is all-in: the user's withholding_pct already carries its FICA, so no
  // salary-side FICA is added anywhere.
  salary: WithholdingLegOut
  vest: {
    // The vest BASE (fmv x shares) the two tax legs below were computed on — reported so
    // the card can show its own inputs.
    income_ytd: string
    income_projected: string
    supplemental_ytd: string
    supplemental_projected: string
    fica_ytd: string
    fica_projected: string
  }
  total: WithholdingLegOut
  // liability_total - total.projected: POSITIVE means "will owe", negative is a refund.
  // NULL whenever `liability_total` is — a subtraction with no minuend. Never read this
  // through a bare Number(): null would arrive as a confident 0, i.e. "dead even".
  balance_projected: string | null
  // Paychecks received / expected this year — the progress denominator for the salary leg.
  checks_elapsed: number
  checks_total: number
  // The partner leg — `partner_source` below says which of its two modes is in force.
  // NULL is a different silence from "0.00" in all three: `partner_wages` is null when this
  // year's return covers one person (single, MFS, or a household with no partner row) and
  // "0.00" when a partner is on the return with no W-2 entered; the two withheld fields are
  // null when nothing is stored — the state the server also warns about — and "0.00" only
  // when a zero was really entered.
  partner_wages: string | null
  partner_withheld_fed: string | null
  partner_withheld_state: string | null
  // 'simulated' exactly when the partner has a paycheck profile, 'entered' otherwise (the
  // 2026-08-26 fallback). In 'simulated' the two withheld fields above are still stored
  // facts on the wire, but they are money in no total and a warning says so.
  partner_source: string
  // Null in 'entered' mode: a leg that was never simulated has no figures, and '0.00'
  // would read as "simulated, and it came to nothing".
  partner_salary: WithholdingPartnerLeg | null
  // SIGNED. Positive is the under-withholding trap (each employer withholds the 0.9% surtax
  // only above $200k of its own wages; a joint return owes it above a lower combined
  // threshold), negative is over-withholding, "0.00" is one earner or no surtax tier.
  additional_medicare_gap: string
  // Jurisdictions with no bracket table for THIS filing status — a call to action, never a
  // silent zero. Non-empty is exactly the state in which the two fields above are null.
  brackets_missing_for_status: string[]
  // Null only when NEITHER statutory leg exists (no computable prior year AND the engine
  // refused this year). The prior-leg fields are null together when that leg is missing
  // (first year, refused prior year, or a prior total <= 0 — the last two warn).
  safe_harbor: {
    prior_year: number | null
    prior_total_tax: string | null
    prior_agi: string | null // the AGI the statutory gate was tested against
    multiplier: string | null // 1.10 above the IRC 6654(d)(1)(C) AGI gate, 1.00 at/below
    threshold: string | null // prior_total_tax x multiplier
    prior_filing_status: string | null
    current_year_threshold: string | null // 90% of this year's liability; null on refusal
    effective_threshold: string // min of the legs that exist — `met` is judged on it
    met: boolean // total.projected >= effective_threshold
  } | null
  warnings: string[]
}

// --- espp ---
// espp_lots prices are 5dp (the one place in the app that is not 4dp), shares 4dp,
// period money 2dp, contribution_pct 9dp ("0.130000000"), modeler money 2dp and
// gain_pct 6dp. Modeler share COUNTS are Decimals too, so they arrive as strings ("78")
// even though the chain's INT() keeps them whole.

export interface EsppLotOut {
  id: number
  purchase_date: string
  qualifying_date: string
  shares: string
  subscription_price: string
  purchase_fmv: string
  purchase_price: string
  sold_date: string | null
  sold_price: string | null
  notes: string | null
  // --- computed (espp_calc.lot_metrics); the market fields are null when the
  // espp_ticker soft link dangles, or when a sold row is missing its price.
  // days_until_qualified is null for sold lots.
  cost_basis: string
  market_value: string | null
  gain_amount: string | null
  gain_pct: string | null
  qualified: boolean
  days_until_qualified: number | null
  is_sold: boolean
}

export interface EsppLotCreate {
  purchase_date: string
  qualifying_date: string
  shares: string
  subscription_price: string
  purchase_fmv: string
  // Omitted (or null) means "use the 85% default" — the server derives
  // 0.85 x min(subscription_price, purchase_fmv) at 5dp.
  purchase_price?: string | null
  // The disposition pair must be set (or cleared) together.
  sold_date?: string | null
  sold_price?: string | null
  notes?: string | null
}

// PATCH: the NOT NULL columns take a value or are omitted — an explicit null on one of
// them is a server-side no-op, so it is not in the type. `purchase_price: null` is the
// exception that DOES mean something: re-derive the 85% default from the merged row.
// The sold pair and notes are nullable columns, where null really clears.
export type EsppLotUpdate = Partial<EsppLotCreate>

export interface EsppLotsResponse {
  // The quote the whole table was priced against. current_price/quoted_at are null at
  // every break in the soft link; espp_ticker itself is null only when the SETTING is
  // missing (a configured ticker echoes even if no security/price row exists).
  espp_ticker: string | null
  current_price: string | null
  quoted_at: string | null
  lots: EsppLotOut[]
}

export interface EsppOfferingOut {
  id: number
  offering_start: string
  // Numeric(14,5) — render verbatim (kind="plain" column), never formatCurrency's 2dp.
  subscription_price: string
  notes: string | null
}

export interface EsppOfferingCreate {
  offering_start: string
  subscription_price: string
  notes?: string | null
}

// offering_start / subscription_price are NOT NULL (value or omit); notes: null clears.
export type EsppOfferingUpdate = Partial<EsppOfferingCreate>

export interface EsppPeriodOut {
  id: number
  label: string
  period_start: string
  period_end: string
  semi_annual_base: string
  additional_payments: string
  contribution_pct: string // 9dp
}

export interface EsppPeriodCreate {
  label: string
  period_start: string
  period_end: string
  semi_annual_base: string
  additional_payments?: string
  contribution_pct: string
}

// Every stored column here is NOT NULL, so a field is either sent with a value or left
// out — an explicit null is a server-side no-op and has no place in the type.
export type EsppPeriodUpdate = Partial<EsppPeriodCreate>

// One modeled row — a stored espp_periods row verbatim, or a derived slot-filler
// (stored=false, id=null) that materializes only when saved via POST /espp/periods.
export interface EsppModelerPeriod {
  id: number | null
  stored: boolean
  label: string
  period_start: string
  period_end: string
  semi_annual_base: string
  additional_payments: string
  contribution_pct: string // 9dp fraction
  // The price this row was chained at + provenance (offering_start null = quote/override).
  subscription_price: string
  offering_start: string | null
  // --- computed chain (espp_calc.run_modeler)
  eligible_earnings: string
  contribution: string
  available: string
  purchase_price: string
  shares_before_limit: string
  unused_25k: string // remaining limit at the START of this period
  max_shares_25k: string
  over_limit: boolean
  shares: string
  cost: string
  carry_forward_out: string
  refund: string
  value_25k: string
}

export interface EsppModelerTotals {
  total_25k_value: string
  out_of_pocket_cost: string
  fmv_of_shares: string
  remaining_25k: string // 25000 - total_25k_value, for the gauge
}

export interface EsppModelerOut {
  year: number
  espp_ticker: string | null
  // LEGACY (stale-tab armor): "params" iff both prices overridden. New UI reads the two
  // source fields below.
  price_source: 'params' | 'latest_price'
  subscription_source: 'override' | 'offering' | 'latest_price' | 'mixed'
  fmv_source: 'override' | 'latest_price'
  // Provenance, not data: null whenever no stored quote is behind the numbers.
  quoted_at: string | null
  // The override echo — null when offerings/quote drive per-period (blank knob = smart
  // default; the box is never seeded from this).
  subscription_price: string | null
  purchase_fmv: string
  carry_forward: string
  // Server-owned year-chip list (stored ∪ offering-covered ∪ {now, now+1}), sorted.
  available_years: number[]
  warnings: string[]
  periods: EsppModelerPeriod[]
  totals: EsppModelerTotals
}

// --- paycheck ---

/**
 * HSA coverage tier (2026-08-27 spec §3.2) — decides WHICH annual HSA cap applies to this
 * person, so it is per profile, not per household. Stored NOT NULL with server_default
 * 'self'; the backfill gave every pre-batch row 'self'.
 */
export type HsaCoverage = 'none' | 'self' | 'family'

export interface PaycheckProfileOut {
  id: number
  /** Whose profile this is (spec §3.1). NOT NULL server-side; legacy rows backfilled to
   *  the primary person, so this is always a real id, never null. */
  person_id: number
  effective_date: string
  annual_salary: string
  pay_periods_per_year: number
  // The five pcts are Numeric(10,9) — 9dp strings, e.g. "0.130000000".
  trad_401k_pct: string
  roth_401k_pct: string
  after_tax_401k_pct: string
  espp_pct: string
  withholding_pct: string
  dental_vision_per_check: string
  hsa_per_check: string
  hsa_coverage: HsaCoverage
  notes: string | null
}

export interface PaycheckProfileCreate {
  effective_date: string
  annual_salary: string
  /** ABSENT = the primary person (spec §4.1's wire back-compat). The page omits it unless
   *  a partner chip is actually picked, which is what keeps the single-earner create
   *  byte-identical to the pre-batch one. */
  person_id?: number
  pay_periods_per_year?: number // the sheet's 24 (semi-monthly) is the default
  trad_401k_pct?: string
  roth_401k_pct?: string
  after_tax_401k_pct?: string
  espp_pct?: string
  withholding_pct?: string
  dental_vision_per_check?: string
  hsa_per_check?: string
  hsa_coverage?: HsaCoverage
  notes?: string | null
}

// PATCH: every stored column except `notes` is NOT NULL, so those are sent with a value
// or omitted (an explicit null would be a server-side no-op). Only `notes: null` clears.
export type PaycheckProfileUpdate = Partial<PaycheckProfileCreate>

// One check in the sheet's waterfall order, plus the monthly roll-up. Every line is a
// 2dp display value of a full-precision chain, so the lines may not reconcile to
// `net_pay` by a cent — `net_pay` is the authoritative one, and none of these are ever
// re-derived on the client.
export interface PaycheckBreakdownOut {
  profile: PaycheckProfileOut
  gross: string
  trad_401k: string
  dental_vision: string
  hsa: string
  taxable: string
  withholding: string
  post_tax: string
  roth_401k: string
  after_tax_401k: string
  espp: string
  net_pay: string
  monthly_net: string
  warnings: string[]
  pace: PaceItem[]
}

// --- paycheck: the "Try it" sandbox (POST /paycheck/preview, 2026-09-03 planning-sandboxes
// spec §13) ---
// Nothing is stored. `overrides` is the server's ProfileOverrides (extra keys 422): every
// field optional, in the WIRE vocabulary — fractions for the five pcts, money strings for
// the per-check amounts, the coverage tier as stored. The percent shift happens in
// SliderBox's box and nowhere else.

export interface PaycheckPreviewOverrides {
  annual_salary?: string
  pay_periods_per_year?: number
  trad_401k_pct?: string
  roth_401k_pct?: string
  after_tax_401k_pct?: string
  espp_pct?: string
  withholding_pct?: string
  dental_vision_per_check?: string
  hsa_per_check?: string
  hsa_coverage?: HsaCoverage
}

export interface PaycheckPreviewIn {
  /** The base — the same two selectors GET /breakdown takes; both null = the primary's
   *  profile in force. */
  profile_id: number | null
  person_id: number | null
  overrides: PaycheckPreviewOverrides
}

/** The eleven waterfall lines plus `savings` (trad + Roth + after-tax + ESPP + HSA), each a
 *  2dp string; in a `delta` block each is the difference of two such figures. */
export interface PaycheckPreviewLines {
  gross: string
  trad_401k: string
  dental_vision: string
  hsa: string
  taxable: string
  withholding: string
  post_tax: string
  roth_401k: string
  after_tax_401k: string
  espp: string
  net_pay: string
  savings: string
}

export interface PaycheckPreviewBlock {
  baseline: PaycheckPreviewLines
  scenario: PaycheckPreviewLines
  delta: PaycheckPreviewLines
}

export interface PaycheckChangedField {
  key: keyof PaycheckPreviewOverrides
  label: string
  before: string
  after: string
}

export interface PaycheckPreviewOut {
  profile: PaycheckProfileOut
  per_check: PaycheckPreviewBlock
  monthly: PaycheckPreviewBlock
  annual: PaycheckPreviewBlock
  pace: { baseline: PaceItem[]; scenario: PaceItem[] }
  changed: PaycheckChangedField[]
  /** Scenario-side advisories only — the breakdown's own two sentences. */
  warnings: string[]
}

// --- comp ---

export interface CompEventOut {
  id: number
  focal_year: number
  current_base: string
  new_base: string | null
  unvested_rsus: string | null
  unvested_price: string | null
  refresh_rsus: string | null
  grant_price: string | null
  notes: string | null
  // --- computed (comp_calc.metrics): 2dp money, 6dp percentages, null wherever an input
  // is missing — and equity_delta_pct is also null on a zero denominator (rsus 0 is a
  // legal write) or a ratio past 1e12.
  base_delta: string | null
  base_delta_pct: string | null
  unvested_equity: string | null
  equity_delta: string | null
  equity_delta_pct: string | null
  // Total comp proxy = base + unvested equity (+ the refresh grant, after). The "after"
  // base is (new_base ?? current_base) — chart math deriving equity as tc_after - base
  // must use that same selection or a raise silently folds into the equity stack.
  // Never null: current_base is NOT NULL and every missing side contributes 0.
  tc_before: string
  tc_after: string
}

export interface CompEventCreate {
  focal_year: number
  current_base: string
  new_base?: string | null
  unvested_rsus?: string | null
  unvested_price?: string | null
  refresh_rsus?: string | null
  grant_price?: string | null
  notes?: string | null
}

// PATCH, and the one place the house null convention splits: focal_year / current_base
// are NOT NULL (send a value or omit — a null there is a no-op), while an explicit null
// on any other field really CLEARS that column (a raise that never happened, a grant
// that was withdrawn). That is the deliberate difference from EsppLotUpdate.
export type CompEventUpdate = Partial<CompEventCreate>

// --- comp: RSU grants + the vesting schedule ---
// Grants store PARAMETERS only: vest rows are never persisted, so every read recomputes the
// schedule (a cliff, then 6.25% quarterly steps) and the vested split moves on its own
// between reads. Prices and percentages are 4dp Decimal strings — grant_price Numeric(14,4),
// cliff_pct Numeric(7,4) in (0, 1] — while `shares` here is a whole-share INT, not a string,
// because the column is one (the seed candidates below are the exception).

export interface RsuGrantOut {
  id: number
  // Router-validated membership, exactly as AccountGroup/HoldingType narrow their own plain
  // String columns; anything else is a 422 on the way in.
  kind: 'new_hire' | 'refresh'
  label: string // unique, <= 60 chars after trim — a duplicate is a 409
  focal_year: number | null
  shares: number
  grant_price: string
  first_vest_date: string
  cliff_pct: string
  // Shares-per-vest rounding (spec §8.2): each vest floors the cumulative entitlement to a
  // multiple of this, the final vest trues up. 1 = single shares (the refreshes); the real
  // offer grant vests in tens — both broker-verified.
  vest_quantum: number
  notes: string | null
  // --- computed (rsu_vesting), judged against the SERVER's day: never re-derive these on
  // the client, and never carry them across an edit — re-read the row instead.
  vest_count: number
  vested_shares: number
  unvested_shares: number
}

// POST, and PATCH takes a Partial of it. The null split lands differently from CompEventCreate
// above: only focal_year and notes are nullable columns, so only their explicit null CLEARS —
// on every other field a null is a server-side no-op (send a value or leave it out).
export interface RsuGrantCreate {
  kind: 'new_hire' | 'refresh'
  label: string
  focal_year?: number | null
  shares: number
  grant_price: string
  first_vest_date: string
  cliff_pct: string
  // Optional so pre-§8.2 callers keep working: the server defaults an omitted value to 1.
  vest_quantum?: number
  notes?: string | null
}

// PATCH, and the split is RsuGrantCreate's own (NOT CompEventUpdate's): kind, label, shares,
// grant_price, first_vest_date and cliff_pct are NOT NULL — send a value or omit, because an
// explicit null on one of them is a server-side no-op. Only focal_year and notes are nullable
// columns, where a null really CLEARS. The merged row is re-validated, so a PATCH gets a
// POST's rules and a delta body must still satisfy them.
export type RsuGrantUpdate = Partial<RsuGrantCreate>

// One tranche of one grant. A past vest is priced at the stored close ON OR BEFORE its date
// (what the stock was worth THEN); a future one is left unpriced here and valued at the
// latest quote by the tiles only. Both money fields are null when no such bar exists, and a
// zero-share tranche is a real event that stays in the list.
export interface VestOut {
  vest_date: string
  grant_id: number
  label: string
  shares: number
  fmv: string | null
  value: string | null // fmv x shares, 2dp
  is_past: boolean
}

// One vest DATE across every grant — the table's summary row (2026-08-21 revision). Every
// past tranche on a day priced at the SAME close, so `fmv` is that one close (never an
// average) and `value` is close x summed shares — which can differ from the sum of the
// individually rounded tranche values by up to half a cent per tranche. Future days carry
// the latest quote x summed shares — an estimate, and `value_is_estimate` is how the row
// says so. Unpriced either way is null. The per-grant breakdown for a date is its `vests`
// entries.
export interface VestDayOut {
  vest_date: string
  is_past: boolean
  tranche_count: number
  shares: number
  fmv: string | null
  value: string | null
  value_is_estimate: boolean
}

// A prefill for a focal year that has refresh RSUs on its comp event but no grant yet — the
// chips above the grants form, never a row the server wrote. `shares` is comp_events.refresh_rsus
// verbatim at its 4dp scale (a string, unlike the whole-share ints above); the grant writer is
// what enforces whole shares, so the chip's prefill has to land an integer in the box.
export interface SeedCandidateOut {
  focal_year: number
  shares: string
  grant_price: string
  suggested_first_vest_date: string
  suggested_label: string
}

// GET /comp/vesting-schedule — the whole Comp card set in one read-only payload, computed
// end to end. The ticker -> security -> quote/history chain is a soft link that breaks at any
// hop, so every price-dependent field is nullable and `warnings` names each break; a grant
// too broken to schedule is dropped from BOTH lists with a warning naming it.
export interface VestingScheduleOut {
  ticker: string | null
  latest_price: string | null
  quoted_at: string | null
  grants: RsuGrantOut[]
  vests: VestOut[] // chronological across grants, past and future together
  vest_days: VestDayOut[] // `vests` grouped by date — the table's rows (2026-08-21 revision)
  tiles: {
    next_vest: { vest_date: string; shares: number; est_value: string | null } | null
    unvested_shares: number
    unvested_value: string | null
    vested_this_year_shares: number
    // The PRICED SUBSET ONLY — a vest whose date has no stored close is in the share count
    // above and not in this figure. Null (not "0.00") when nothing vested this year could be
    // priced at all: those vests happened and their value is unknown, and a confident zero
    // would be a different claim.
    vested_this_year_income: string | null
  }
  seed_candidates: SeedCandidateOut[]
  // Informational only: focal history and a grant disagreeing is a hint, never an error —
  // the grant is the vesting truth. Kept apart from `warnings` so the UI can tone them apart.
  drift_warnings: string[]
  warnings: string[]
}

// --- calendar ---

export type CalendarEventType =
  | 'rsu_vest'
  | 'espp_purchase'
  | 'espp_qualify'
  | 'ex_dividend'
  | 'payday'
  | 'offering_start'
  | 'tax_deadline'
  | 'update_due'
  | 'custom'

// One forward-looking event (2026-08-24 spec §5). No money fields in v1 — labels and
// details carry share counts and prices as text. Sorted by (date, type, label) on the
// server; the label carries identity (grant label, lot purchase date) so ICS UIDs built
// from it never collide on same-day same-type events.
export interface CalendarEvent {
  date: string // ISO YYYY-MM-DD
  type: CalendarEventType
  label: string
  detail: string | null
  href: string | null // null for custom events — they have no page (spec §9.3)
  id: number | null // set only for custom events, the edit/delete handle
  /** Set only for custom events too. When it is not null the server has already stamped
   *  " — <name>" onto `label`, and anything that re-saves the row must strip it first
   *  (calendarView.stripPersonSuffix). */
  person_id: number | null
}

export interface CalendarResponse {
  events: CalendarEvent[]
}

// POST/PATCH body — full replace (the form always submits all three fields).
export interface CustomEventBody {
  date: string
  label: string
  detail: string | null
  /** null = household. */
  person_id: number | null
}

export interface CustomEventOut {
  id: number
  date: string
  /** As STORED — unstamped. The suffix is composed by GET /calendar, never persisted. */
  label: string
  detail: string | null
  person_id: number | null
}

// --- projection ---
// GET /projection — the FIRE modeler (the ESPP modeler's shape: knobs as query params,
// the echo is what the page's form seeds from). Money 2dp; rates 6dp when a param was
// quantized, verbatim seeds otherwise ("0.05" / "0.04").

/** One resolved retirement (GET /projection?retire=<person_id>:<YYYY-MM>, 2026-08-28
 *  spec §4.3). `month` is a first-of-month ISO date on the projection's own axis;
 *  `monthly_drop` is that person's take-home from the paycheck profile in force at
 *  request time — today's figure, not a projection of it. */
export interface RetirementEcho {
  person_id: number
  name: string
  month: string
  monthly_drop: string
}

/** One earner's monthly payroll-deducted savings (401(k) traditional/Roth/after-tax, ESPP,
 *  HSA) from the paycheck profile in force. */
export interface PayrollSavingOut {
  person_id: number
  name: string
  monthly: string
}

/** How a DERIVED monthly contribution was built (2026-09-03): cash savings — the trailing
 *  mean of (net pay − spend) — plus every earner's payroll deductions. Null when the knob
 *  was typed. */
export interface ContributionBreakdownOut {
  cash: string
  payroll: string
  total: string
  by_person: PayrollSavingOut[]
}

export interface ProjectionOut {
  starting_balance: string
  /** The snapshot month the starting balance came from. */
  base_month: string
  /** The projection's t0 — the current calendar month. */
  start_month: string
  annual_return: string
  monthly_contribution: string
  annual_spend: string | null
  swr_pct: string
  years: number
  fi_target: string | null
  fi_ratio: string | null
  fi_month: string | null
  coast_fi_month: string | null
  // Parallel arrays: index i across all three is one month.
  months: string[]
  projected: string[]
  coast: string[]
  warnings: string[]
  // Monte Carlo. The three assumption echoes name what the run actually used, and a live
  // server always sends them (absent knobs default server-side) — they stay NULLABLE for
  // a stale backend, which the page reads as "no placeholder". `bands` and the probability
  // block are null whenever volatility was an explicit 0 (the fan's off switch).
  volatility: string | null
  inflation: string | null
  contribution_growth: string | null
  /** Keys "p10"/"p25"/"p50"/"p75"/"p90"; each list is parallel to `months`. */
  bands: Record<string, string[]> | null
  fi_probability: string | null
  fi_month_p10: string | null
  fi_month_p50: string | null
  fi_month_p90: string | null
  /** Echoed retirements, sorted by month. `[]` from a live server with no `retire`
   *  param; null/absent from a backend older than the dual-career batch — the `bands`
   *  posture, so every reader takes it as `?? []`. */
  retirements: RetirementEcho[] | null
  /** Present when the contribution was DERIVED, null when it was typed; absent from a
   *  backend older than 2026-09-03 — readers take it as `?? null`. */
  contribution_breakdown?: ContributionBreakdownOut | null
}

// --- import (mirrors backend/app/importer/report.py) ---

export interface ImportEntityCounts {
  creates: number
  updates: number
  skips: number
  deletes: number
}

export interface ImportSheetReport {
  entities: Record<string, ImportEntityCounts>
  warnings: string[]
  errors: string[]
  samples: string[]
  samples_truncated: number
}

// sheets always carries all nine keys (report.SHEET_KEYS), even when a sheet is clean.
export interface ImportReport {
  dry_run: boolean
  applied: boolean
  sheets: Record<string, ImportSheetReport>
}

// --- app settings ---

export interface AppSettingsOut {
  swr_pct: string
  espp_ticker: string | null
  price_refresh_cron: string
}

// PUT is full-form (the paycheck/espp whole-form law): all three settings every time.
export type AppSettingsUpdate = AppSettingsOut

// --- overview: money flow ---
// GET /overview/money-flow?year= (2026-08-25 spec §5) — one server-composed, reconciled
// year; all money 2dp Decimal strings. Conservation is structural: the five sources sum
// to gross_income (other_income balances), and taxes.total + pre_tax_savings +
// take_home_cash + retained_equity == gross_income (retained_equity is the residual) —
// at 2dp the paycheck sankey's ±$0.01 reconciliation drift is tolerated.

/** One earner's slice of the salary source node. */
export interface MoneyFlowPersonSalary {
  name: string
  amount: string
}

export interface MoneyFlowSources {
  salary_and_bonus: string
  rsu_vests: string
  espp: string
  investment_income: string
  /** BALANCING node: engine gross minus the four named sources (1099 income, employer
   * HSA, w2_other, stored-total drift). A negative here made renderable false. */
  other_income: string
  /** EMPTY = today's single `Salary & bonus` node. Two or more entries (primary first)
   *  split it per earner and sum to `salary_and_bonus`, which stays the household total. */
  salary_people: MoneyFlowPersonSalary[]
}

export interface MoneyFlowTaxes {
  total: string
  federal: string
  state: string
  medicare: string
  social_security: string
  disability: string
  capital_gains: string
  // Optional for the same fixture reason; the server always sends it.
  niit?: string
}

export interface MoneyFlowCategory {
  name: string
  amount: string
}

export interface MoneyFlowOut {
  year: number
  /** Years with any stored tax inputs — the card's chip row. */
  available_years: number[]
  /** false + reason: render the SERVER's sentence verbatim instead of a chart. */
  renderable: boolean
  reason: string | null
  warnings: string[]
  sources: MoneyFlowSources
  gross_income: string
  taxes: MoneyFlowTaxes
  pre_tax_savings: string
  take_home_cash: string
  /** Residual: gross − taxes − pre-tax − take-home (≈ vest shares kept + ESPP + timing). */
  retained_equity: string
  /** Top-7 by year sum, biggest first, positive-only (the /spending fold). */
  categories: MoneyFlowCategory[]
  /** The folded positive remainder; null when nothing folded. */
  other_spend: string | null
  total_spend: string
  /** SIGNED: take_home_cash − total_spend; negative draws a red Drawdown source. */
  saved: string
}

// --- credit cards (2026-08-25 spec §2/§3) -----------------------------------------------

export type RewardsCurrency = 'cash' | 'points' | 'miles'

export interface CardCreditOut {
  id: number
  label: string
  annual_value: string
  counts: boolean
}

export interface CardCreditIn {
  label: string
  annual_value: string
  counts: boolean
}

export interface CreditLimitEventOut {
  id: number
  effective_date: string
  limit_amount: string
  note: string | null
}

export interface CreditLimitEventIn {
  effective_date: string
  limit_amount: string
  note: string | null
}

export interface CreditCardOut {
  id: number
  name: string
  slug: string
  annual_fee: string
  rewards_currency: RewardsCurrency
  point_value_cents: string
  /** Owner; null = JOINT (either spouse can hold the card). Never "unknown": the migration
   *  backfilled every pre-existing card to the primary person. */
  person_id: number | null
  primary_holder: string | null
  authorized_users: string | null
  opened_on: string | null
  is_active: boolean
  account_id: number | null
  notes: string | null
  sort_order: number
  credits: CardCreditOut[]
  /** Latest limit event's amount; null when no events yet. */
  current_limit: string | null
  limit_events: CreditLimitEventOut[]
}

/** POST and PATCH body — full object, house style. */
export interface CreditCardIn {
  name: string
  annual_fee: string
  rewards_currency: RewardsCurrency
  point_value_cents: string
  person_id: number | null
  primary_holder: string | null
  authorized_users: string | null
  opened_on: string | null
  is_active: boolean
  account_id: number | null
  notes: string | null
  sort_order: number
}

export interface RewardCategoryOut {
  id: number
  name: string
  slug: string
  sort_order: number
  is_active: boolean
  /** Manual annual-spend override; null = derive from the mapping (or unweighted). */
  annual_spend: string | null
  spending_category_id: number | null
  pinned_card_id: number | null
}

export interface RewardCategoryCreate {
  name: string
  sort_order?: number
  annual_spend?: string | null
  spending_category_id?: number | null
  pinned_card_id?: number | null
}

/** PATCH semantics: omitted = untouched; explicit null CLEARS a nullable column
 *  (annual_spend / spending_category_id / pinned_card_id). name/sort_order/is_active
 *  ignore null (NOT NULL columns). */
export interface RewardCategoryUpdate {
  name?: string
  sort_order?: number
  is_active?: boolean
  annual_spend?: string | null
  spending_category_id?: number | null
  pinned_card_id?: number | null
}

export interface RewardRateOut {
  id: number
  card_id: number
  category_id: number
  multiplier: string
  note: string | null
  monthly_cap: string | null
}

/** Bulk matrix save row. multiplier null DELETES the cell (back to N/A). */
export interface RewardRatePut {
  card_id: number
  category_id: number
  multiplier: string | null
  note: string | null
  monthly_cap: string | null
}

// --- household (2026-08-26 spec §5.1) ---

export interface PersonOut {
  id: number
  name: string
  /** Exactly one row carries it, database-enforced; the API never lets it change. */
  is_primary: boolean
}

export interface HouseholdOut {
  people: PersonOut[]
  marriage_date: string | null
}

export interface MarriageDateOut {
  marriage_date: string | null
}

// --- contribution limits ---

// The five DEFINITIONS always ride back, in the server's display order; `value` is null
// until the user enters that year's figure. The app ships no IRS numbers of its own
// (2026-08-27 spec §2), so null here means "not entered", never "zero".
export interface LimitItemOut {
  key: string
  label: string
  value: string | null
}

export interface LimitsOut {
  year: number
  items: LimitItemOut[]
}

// A PARTIAL map: an omitted key is left alone, an explicit null DELETES the year's row
// (back to "not entered") — the category-budgets tri-state.
export interface LimitsUpdate {
  values: Record<string, string | null>
}

// One contribution line annualized from the profile in force, against the year's entered
// cap. `limit`/`ratio` are null together when nothing has been entered for that key —
// the strip then links to Settings rather than drawing a fabricated 100 %.
export interface PaceItem {
  key: string
  label: string
  annualized: string
  limit: string | null
  ratio: string | null // 4dp fraction, e.g. "0.9500" — the tone was judged on THIS value
  tone: 'ok' | 'warn' | 'over'
}

// --- assistant (2026-09-01 spec §3–§5) ---

export interface AssistantKeyStatus {
  configured: boolean
  source: 'env' | 'override' | null
}

export interface AssistantSettingsOut {
  key: AssistantKeyStatus
  default_model: string
}

// Tri-state api_key (the marriage-date rider): absent = unchanged, null = clear the
// override, string = set.
export interface AssistantSettingsUpdate {
  api_key?: string | null
  default_model?: string
}

export interface AssistantModelOut {
  key: string
  label: string
  available: boolean
  supports_tools: boolean
  default: boolean
  /** The live catalog id this registry key resolved to ("nvidia/…"), or null when the probe
   *  never got that far. Shown in the Settings probe list so a real-key verification can see
   *  WHAT matched, not just that something did. */
  catalog_id: string | null
}

export interface AssistantModelsOut {
  configured: boolean
  key_source: 'env' | 'override' | null
  // true = the catalog answered; false = key rejected/unreachable; null = no key.
  key_ok: boolean | null
  checked_at: string | null
  models: AssistantModelOut[]
}

// What the drawer snapshots at send time: the route, its URL params, and whatever the
// page published through useAssistantView.
export interface AssistantContextIn {
  route: string
  search: Record<string, string>
  view: Record<string, string | number | null>
}

export interface AssistantPreviewSection {
  name: string
  rows: number
}

export interface AssistantPreviewOut {
  sections: AssistantPreviewSection[]
}

// --- data lifecycle (2026-09-03 spec §7–§11) ---

export interface RestoreSchema {
  snapshot_head: string | null
  server_head: string | null
  compatible: boolean
}

export interface RestoreTableDiff {
  current: number
  incoming: number
  /** Same canonical CSV sha256 on both sides. */
  identical: boolean
}

// POST /import/snapshot[?dry_run=] and /import/snapshot/stored/{name}.
export interface RestoreReport {
  dry_run: boolean
  applied: boolean
  /** The snapshot's own export instant — the Restore card asks for its DATE to be typed. */
  exported_at: string | null
  schema: RestoreSchema
  tables: Record<string, RestoreTableDiff>
  preserved_settings: string[]
  warnings: string[]
  errors: string[]
  restore_point: string | null
  batch_id: string | null
  run_id: number | null
}

// GET/POST /system/snapshots — the nightly stored ZIPs, newest first.
export interface SnapshotEntry {
  name: string
  at: string
  size_bytes: number
  alembic_head: string | null
  /** Head equals this server's — the only entries the Restore card offers to apply. */
  restorable: boolean
}

export type ChangeSource = 'ui' | 'import' | 'restore' | 'scheduler' | 'repair' | 'undo'
export type RunKind = 'import_xlsx' | 'restore' | 'snapshot' | 'restore_point' | 'undo'

export interface ActivityBatch {
  type: 'batch'
  batch_id: string
  at: string
  source: ChangeSource
  actor: string | null
  label: string
  month: string | null
  rows: number
  undoable: boolean
  undone_by: string | null
}

export interface ActivityRun {
  type: 'run'
  run_id: number
  at: string
  kind: RunKind
  ok: boolean
  dry_run: boolean
  filename: string | null
  size_bytes: number | null
  has_report: boolean
}

export type ActivityEntry = ActivityBatch | ActivityRun

// GET /activity?limit=&before= — batches and runs interleaved, newest first.
export interface ActivityPage {
  entries: ActivityEntry[]
  next_before: string | null
}

// GET /activity/runs/{id} — the stored report verbatim; narrow on run.kind.
export interface ActivityRunDetail {
  run: ActivityRun
  report: Record<string, unknown> | null
}

export interface PrefEntry {
  value: unknown
  updated_at: string
}

// GET/PATCH /prefs — registered keys only, absent when unset.
export interface PrefsOut {
  prefs: Record<string, PrefEntry>
}

export type HealthSeverity = 'ok' | 'info' | 'warn' | 'error'

export interface HealthFix {
  kind: 'link' | 'action'
  label: string
  to?: string | null
  /** 'delete_spending_month' (one per month in the check's `months`) | 'snapshot_now'. */
  action?: string | null
}

export interface HealthCheck {
  id: string
  severity: HealthSeverity
  title: string
  detail: string
  count: number
  months: string[]
  fix: HealthFix | null
}

// GET /system/health
export interface HealthOut {
  checked_at: string
  checks: HealthCheck[]
}
