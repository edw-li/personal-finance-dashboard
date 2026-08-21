# Info Hints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An ⓘ beside every chart title, section title, and KPI tile on the data pages, showing a brief authored explanation on hover and keyboard focus.

**Architecture:** One `InfoHint` component (focusable button, `aria-label` + CSS `::after` bubble from `data-tip` — no JS tooltip machinery), a `hint?` prop on StatTile, and verbatim transcription of the copy table below into ~20 files.

**Tech Stack:** unchanged; frontend-only; NO migrations.

**Spec:** `docs/superpowers/specs/2026-08-20-info-hints-design.md`

**THE COPY IS THE DELIVERABLE.** Strings in the tables are transcribed exactly (straight quotes escaped as needed for JSX; typographic dashes/× kept). Placement pattern unless a row says otherwise: titles get `<InfoHint text="…" />` inside the heading element after its text; tiles get `hint="…"` on the StatTile.

---

### Task 1: Component, styles, StatTile prop

**Files:**
- Create: `src/components/InfoHint.tsx`, `src/components/InfoHint.test.tsx`
- Modify: `src/components/panels.css`, `src/components/StatTile.tsx`, `src/components/StatTile.test.tsx`

- [x] **Step 1:** `src/components/InfoHint.tsx`:

```tsx
import { Info } from 'lucide-react'
import './panels.css'

// The ⓘ beside titles and tile labels (2026-08-20 user request): a focusable button so
// keyboard and touch reach the bubble, aria-label so screen readers hear the same words
// the CSS ::after renders from data-tip. Click does nothing — hover/focus IS the
// affordance, and a button that navigated would make every title a mystery link.
export default function InfoHint({ text }: { text: string }) {
  return (
    <button type="button" className="info-hint" aria-label={text} data-tip={text}>
      <Info size={13} aria-hidden="true" />
    </button>
  )
}
```

- [x] **Step 2:** Append to `src/components/panels.css`:

```css
/* InfoHint — the ⓘ beside titles/labels. The bubble is pure CSS from data-tip: shows on
   hover AND :focus-visible, so keyboard and touch (tap = focus) reach it without JS. The
   resets matter: eyebrows are uppercase/letterspaced/muted, and the bubble must not
   inherit any of that. */
.info-hint {
  position: relative;
  display: inline-flex;
  align-items: center;
  margin-left: 0.35rem;
  padding: 0;
  border: none;
  background: none;
  color: var(--muted);
  cursor: help;
  vertical-align: middle;
}
.info-hint:hover,
.info-hint:focus-visible {
  color: var(--text);
}
.info-hint:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.info-hint::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: -8px;
  /* The codebase's one z-index: the bubble must float over chart canvases and table
     rows; nothing else in the app stacks. */
  z-index: 2;
  display: none;
  width: max-content;
  max-width: 280px;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--text);
  font-size: 0.78rem;
  font-weight: 400;
  line-height: 1.45;
  letter-spacing: normal;
  text-transform: none;
  text-align: left;
  white-space: normal;
}
.info-hint:hover::after,
.info-hint:focus-visible::after {
  display: block;
}
```

- [x] **Step 3:** `StatTile.tsx` — add the prop and render it in the label (import InfoHint):

```tsx
  hint?: string
```
```tsx
      <div className="stat-label">
        {label}
        {hint !== undefined && <InfoHint text={hint} />}
      </div>
```

- [x] **Step 4:** Tests. `InfoHint.test.tsx`: renders a `type="button"` with `aria-label`
  === text and `data-tip` === text; the svg icon is `aria-hidden`. `StatTile.test.tsx`:
  a tile with `hint` renders the info button inside the label; without it, no button.
- [x] **Step 5:** `npx vitest run src/components/InfoHint.test.tsx src/components/StatTile.test.tsx` → PASS; commit `feat: InfoHint component + StatTile hint prop`.

---

### Task 2: Overview, Net Worth, Spending

**Files:** `src/pages/OverviewPage.tsx`, `src/pages/NetWorthPage.tsx`, `src/pages/SpendingPage.tsx` (imports: `InfoHint` where headings are hinted).

| # | Anchor (find the element) | Text |
|---|---|---|
| 1 | Overview net-worth StatTile | Assets minus liabilities from the latest monthly snapshot, with its change from the month before. |
| 2 | Overview portfolio StatTile | Market value of every priced holding at the latest quotes, and today's move vs the prior close. |
| 3 | Overview spending StatTile | The latest entered month's total spend against your trailing 12-month average. |
| 4 | Overview effective-tax StatTile | Total tax ÷ gross income from the tax engine, for the year named in the label. |
| 5 | YTD card `<h2 className="eyebrow">` | The year so far: net-worth change since the last pre-January snapshot, plus spend, net pay, savings rate, and dividends. |
| 6 | "Net worth trend" h2 | Net worth at every monthly snapshot — the series the Net Worth page breaks down by group. |
| 7 | "Portfolio performance" h2 | Portfolio value vs cost basis over time. The S&P 500 line invests only the starting balance — contributions are not added to it. |
| 8 | "Recent spending" h2 | Total spend for each of the last 12 entered months. |
| 9 | NetWorth hero StatTile | Assets minus liabilities for the latest snapshot; liabilities are entered as negatives. |
| 10 | NetWorth group StatTiles (the mapped three — ONE shared string) | This group's latest total and its change from the prior snapshot. |
| 11 | "By group over time" h2 | Asset groups stacked to their combined total, with liabilities and net worth as their own lines. Diamonds mark months with a saved note. |
| 12 | "Account drill-down" h2 | Individual account balances over time — toggle accounts here or by clicking table rows. |
| 13 | "Accounts — latest …" h2 | Each account's latest balance and change. Component accounts live inside a parent aggregate and are excluded from totals. |
| 14 | Spending spend StatTile | The latest entered month's total across all categories. |
| 15 | "12-month average" StatTile | Mean monthly spend over the last 12 entered months, including the latest. |
| 16 | "Savings rate (actual)" StatTile | (net pay − spend) ÷ net pay for the latest month. |
| 17 | "Net pay" StatTile | Take-home pay entered for the latest month. |
| 18 | Spending bars h2 (the dynamic heading — hint is static, describes both modes) | Top categories stacked per month under your net-pay line; the dashed line is what your investable assets could sustainably fund each month. Click a bar for that month's breakdown. |
| 19 | "What changed — …" h2 | The month's biggest category moves, vs the prior month and vs each category's 12-month average. |
| 20 | "Month × category heatmap" h2 | Spend per category per month on one shared scale — darker is more. Rows are ordered by all-time total. |
| 21 | "Savings rate (actual)" chart h2 | (net pay − spend) ÷ net pay each month; above the zero line you saved, below it you overspent. |
| 22 | "Category trends" h2 | Single-category history — pick up to 3 to compare. |
| 23 | "Yearly rollups" h2 | Category totals per calendar year, with net pay and that year's savings rate. |

- [x] Transcribe, run `npm run test` (existing page tests must keep passing — headings gain no text nodes), commit `feat: info hints — overview, net worth, spending`.

---

### Task 3: Portfolio family

**Files:** `src/pages/PortfolioPage.tsx`, `src/components/portfolio/AllocationPanel.tsx`, `TransactionsPanel.tsx`, `DividendsPanel.tsx`, `SecuritiesPanel.tsx`, `RealizedPanel.tsx`, `HoldingDetailPanel.tsx`.

| # | Anchor | Text |
|---|---|---|
| 24 | "Portfolio value" StatTile | Market value of every priced holding at the latest quotes. |
| 25 | "Unrealized gain" StatTile | Market value minus cost basis across current holdings. |
| 26 | "Realized gains" StatTile | Lifetime gains and losses booked on sells, by the average-cost method. |
| 27 | "Cost basis" StatTile | What the current holdings cost to acquire, fees included, average-cost method. |
| 28 | "Dividends collected" StatTile | Every dividend logged — auto-ingested and manual — with the expected annual income at current rates. |
| 29 | "Performance" panel-title h2 | Value vs cost basis over time. The S&P 500 baseline invests only the starting balance, so it compares price performance, not a contribution-matched alternative. |
| 30 | "Holdings"/"Holdings — X" panel-title h2 (static hint) | One row per held security: price, value, weight, gains, yields, and money-weighted return. XIRR needs dated transactions — imported rows have none until backfilled. |
| 31 | "Allocation by industry" panel-title | Holdings grouped by industry; cell size and shading both follow market value. |
| 32 | "Allocation" donut panel-title | Portfolio share by holding type or account — top three slices named, the rest folded into Other. |
| 33 | "Transactions" panel-title | The buy/sell/split ledger every computed figure stands on. Sheet-imported rows are rewritten by re-imports; rows added here are never touched. |
| 34 | "Dividends" panel-title | The dividend log. Refreshes write auto rows from real events — shares held on the ex-date × the per-share amount; manual entry covers manual-priced holdings and older history. |
| 35 | "Trailing 12-mo income" StatTile | Dividends received in the last 12 months, including the current one. |
| 36 | "YTD income" StatTile | Dividends received this calendar year. |
| 37 | "Projected annual income" StatTile | Each holding's trailing-12-month dividend rate × shares held, summed. |
| 38 | "Securities" panel-title | The instruments themselves — metadata, pricing mode, active flag. Deactivate a dead ticker to stop refreshing it; deleting is refused while records reference it. |
| 39 | "Realized gains" panel-title | Lifetime realized gain or loss per security from sells, average-cost method. |
| 40 | "Price history" h3 (HoldingDetailPanel) | Daily closes for this security over the chosen window; manual-priced securities accrue one point per hand entry. |

- [ ] Transcribe, gates, commit `feat: info hints — portfolio`.

---

### Task 4: Taxes family

**Files:** `src/pages/TaxesPage.tsx`, `src/components/taxes/SummaryPanel.tsx`, `InputsForm.tsx`, `BracketsEditor.tsx`, `WhatIfPanel.tsx`.

| # | Anchor | Text |
|---|---|---|
| 41 | "Tax year" h2 (TaxesPage) | One column of inputs and bracket tables per year. Creating a year copies the newest year's brackets. |
| 42 | "Totals — {year}" h2 | The engine's answer for this year, computed from the stored inputs and bracket tables below. |
| 43 | "Gross income" StatTile | Every income component summed before any tax — the waterfall's opening bar. |
| 44 | "Total tax" StatTile | All six jurisdictions summed: federal, state, Medicare, Social Security, SDI, and capital gains. |
| 45 | "Take-home" StatTile | Gross income minus total tax. |
| 46 | "Effective rate" StatTile | Total tax ÷ gross income. |
| 47 | "Where {year}'s gross income went" h3 | Gross income walked down to take-home — each floating bar is one jurisdiction's bite. |
| 48 | Trend/breakdown h2 (dynamic — static hint) | Tax composition per year stacked by jurisdiction, with the overall effective rate on the right axis. Click a year for its breakdown. |
| 49 | InputsForm's heading (locate its eyebrow) | The year's income and deduction line items — the old sheet's white cells. Grey suggestions derive from other lines and never auto-apply. |
| 50 | BracketsEditor's heading | The rate tables the engine walks, one per jurisdiction; thresholds are inclusive floors and must ascend from 0. |
| 51 | WhatIfPanel card title | Model prospective sales or input changes against this year's stored return — nothing is saved. |
| 52 | "Δ total tax" StatTile (WhatIfPanel) | Scenario total tax minus baseline — positive means the scenario owes more. |
| 53 | "Δ take-home" StatTile | Scenario take-home minus baseline. |
| 54 | Effective-rate StatTile (WhatIfPanel) | Overall effective rate, baseline → scenario. |

- [ ] Transcribe, gates, commit `feat: info hints — taxes`.

---

### Task 5: ESPP, Paycheck, Comp, Projection, Update, Settings (+ presence test)

**Files:** `src/pages/EsppPage.tsx`, `PaycheckPage.tsx`, `CompPage.tsx`, `ProjectionPage.tsx`, `MonthlyUpdatePage.tsx`, `SettingsPage.tsx`, `src/pages/ProjectionPage.test.tsx`.

| # | Anchor | Text |
|---|---|---|
| 55 | "Lots" h2 | Each semi-annual purchase: cost, value at the current quote (or its sale price), gain, and the qualifying-date countdown. |
| 56 | "Purchase modeler…" h2 | What the current period will buy — contributions, estimated shares at the 15% discount, and the $25k IRS limit. Nothing here is stored. |
| 57 | "Out of pocket" hand-rolled `.stat-label` (insert `<InfoHint …/>` after the text) | Your contributions after the carry-forward — what the purchase actually costs you. |
| 58 | "FMV of shares" hand-rolled `.stat-label` | The purchased shares valued at the period's fair market value. |
| 59 | "Offering periods" h2 | The contribution windows behind the modeler: eligible base, extra payments, and your contribution percentage. |
| 60 | "Per-check breakdown — …" h2 | One paycheck from gross to net in the sheet's order — pre-tax deductions, then withholding, then post-tax contributions. The net is authoritative; lines are display-rounded. |
| 61 | "Monthly net" StatTile | Net pay per check × checks per year ÷ 12. |
| 62 | Profiles panel heading (locate it) | One profile per comp change; the breakdown uses the profile in force today unless a row is pinned. |
| 63 | Comp TC chart h2 (wraps TC_CHART_LABEL) | Base salary stacked under the value of unvested equity, including the year's refresh — this app's total-comp proxy; the line is the server's own total. |
| 64 | "Focal history" h2 | One row per focal year: base moves, grants, and the computed equity and TC deltas. Everything right of the notes is computed by the server. |
| 65 | "FI target" StatTile | Annual spend ÷ withdrawal rate — the balance at which withdrawals could cover spending. |
| 66 | "FI ratio" StatTile | Investable balance as a share of the FI target. |
| 67 | "Investable balance" StatTile | Pre-tax + post-tax + taxable + equity from the latest snapshot — cash and liabilities excluded. |
| 68 | "Projected FI date" StatTile | First month the projected balance reaches the target; "growth alone" repeats it with contributions off. |
| 69 | "FI probability" StatTile | Share of 500 simulated paths reaching the target within the horizon, with median (p50) and pessimistic (p90) dates. |
| 70 | "Net worth over time (projected)" h2 | Every snapshot as dots with a quadratic best-fit extended forward — momentum, not a plan. Log axis: equal steps are equal multiples. |
| 71 | "Projected investable balance" h2 | Deterministic compounding at your assumptions; the bands hold the middle 50% and 80% of simulated outcomes. |
| 72 | "Assumptions" h2 | Every knob the projection runs on. Blank boxes use the greyed defaults or derive from your data on Recalculate. |
| 73 | Update balances-step h2 (dynamic — static hint) | Every account's balance for the month, pre-filled from the prior month; components are tracked inside their parent. |
| 74 | "Spending & net pay" h2 | The month's spend per category plus take-home pay — a blank net pay skips the cashflow row. |
| 75 | "Review & save — …" h2 | A client-side preview; the server's rounding is authoritative once saved. |
| 76 | "App settings" h2 | The withdrawal rate feeds the 4% line and FI target; the ESPP ticker prices lots; the cron schedules price refreshes (applied on save). |
| 77 | "Password" h2 | Changes your login password; existing sessions stay signed in until their token expires. |
| 78 | "Import workbook" h2 | Dry run shows the diff without writing. Apply overwrites sheet-owned rows — dividends are never touched; taxes inside sheet-covered years reset to the sheet. |

- [ ] **Presence test** (ProjectionPage.test.tsx): the FI-target tile's label contains an
  `info-hint` button whose aria-label starts "Annual spend ÷ withdrawal rate", and both
  chart-card headings contain one (three asserts — the app-wide transcription's canary).
- [ ] Gates, commit `feat: info hints — espp, paycheck, comp, projection, update, settings`.

---

### Task 6: Whole-feature gate

- [ ] `npm run test` (existing suites green — heading text queries unaffected; report exact), `npm run lint` (1 sanctioned warning), `npm run build` (chunk line reported). Backend untouched — run `cd backend && .venv/Scripts/python.exe -m ruff format --check .` only as a no-op sanity. Tick all checkboxes; commit `chore: info hints gate green`.

---

## Self-review notes

- Spec §2/§3 → Task 1 exactly; §4's copy = tables 1-78 (every data page covered; Login excluded per spec §3).
- Dynamic headings (18, 30, 48, 73) carry static hints per spec §3.
- Rows 10 (shared string via the mapped tiles), 57-58 (hand-rolled stat labels) carry their own placement notes.
- Test posture per spec §5: component + StatTile + one presence canary; no per-page churn.
