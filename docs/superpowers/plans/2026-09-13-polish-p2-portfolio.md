# Lane P2 — networth-portfolio-cards (2026-09-13 polish) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> Opus implementer for this lane in its own worktree, TDD per task, then a spec-compliance review
> and a code-quality review, then a local merge into main by the lead — never pushed). Steps use
> `- [ ]` checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-13-surface-grammar-and-view-fit-polish-design.md` —
this lane implements §7 (Portfolio tables), §9 (skeleton parity for Portfolio + Credit cards),
§10 (Net worth lede, Portfolio one-line subheader), §11 (Allocation `allocation-heat` →
Holdings ChartCard, `allocation-classifications` → Security classifications card, Missing quotes
→ `Disclosure`), §12 (Portfolio vocabulary, tiles per view, the allocation pair → one card),
§13 (the whole Allocation classify path) and §14's Portfolio/Net worth copy items ("Clear
selection", "Accounts — {month}", Missing-price gating, "Import · not reviewed", Prices line).
Evidence: `scratchpad/ux-audit-2026-09-13/reports/networth-portfolio-cards.md` (W1–W4, W8, W10,
T1–T2, A1–A4, S1–S3, S5, S7, C1–C7, C10, C13, M3). D1's ledger grouping and D8's categories
scroller are OUT of scope.

**Goal:** the Allocation view leads from "Unclassified 65.6%" to classified holdings in one
card + one click; Portfolio, Net worth and Credit cards speak the shared card/KPI grammar and
show tiles only where a view summarises.

**Architecture:** the ranked allocation table becomes the donut `ChartCard`'s `aside`; the
classification accordion becomes an always-visible card with inline PATCHing selects and a
`useImperativeHandle` handle (`focusUnclassified()`) that the "Classify these N holdings"
buttons drive; the industry heat treemap moves to a self-contained `HeatTreemapCard` in the
Holdings view; `.panel`/`.tiles-row`/`.tab-row` are retired for `.card`/`.kpi-row`/`Segmented`.
Net worth's owner strip becomes the By-group card's `lede`; tiles render behind a
`views.section` condition on all three pages.

**Tech stack:** React 19 + TypeScript + Vite + ECharts 6; vitest + Testing Library (jsdom).
Backend untouched.

---

## Mechanics (read once)

- Worktree: `C:/Users/edyli/personal-finance-dashboard/.worktrees/polish-p2`, branch
  `polish/p2-portfolio`, cut from `main` AFTER lanes F1 and F2 have merged (Task 0 verifies).
  `node_modules` is a junction the orchestrator creates; do not `npm install`.
- Run every command from the worktree root. Tests: `npx vitest run <paths>` scoped to the files
  you touch; gates at the end of every task: `npx tsc -b` and
  `npx eslint src/pages/NetWorthPage.tsx src/pages/PortfolioPage.tsx src/pages/CreditCardsPage.tsx src/components/portfolio src/components/creditcards src/api/allocation.ts`.
  Full `npx vitest run` and `npm run build` in Task 12 only.
- Commits small, one per task, prefixes `feat(allocation):`, `feat(portfolio):`,
  `feat(networth):`, `feat(cards):`, `refactor(portfolio):`. Never push. Never delete files
  other than the ones this plan names (none — every removal here is a block inside a file).
- House rules this lane must respect: no literal finite duration in any stylesheet (durations are
  `var(--t-*)` only; `motion.test.ts` sweeps every `.css`); per-page stylesheets never import each
  other (`portfolio.css` and `allocation.css` are component sheets, imported by the components);
  existing tests are updated, never deleted without a replacement; every new behaviour gets a
  focused test. No `setState` inside a `useEffect` body (react-hooks v7 — the codebase's
  "adjust-during-render" and event-handler idioms are what to use). Pure helpers live in `.ts`
  files, not beside a component (`react-refresh/only-export-components` warns otherwise and the
  eslint warning budget is the baseline).
- The lane edits ONLY: `src/pages/NetWorthPage.{tsx,css,test.tsx}`,
  `src/pages/PortfolioPage.{tsx,css,test.tsx}`, `src/pages/CreditCardsPage.{tsx,test.tsx}`,
  `src/components/portfolio/*`, `src/components/creditcards/*` (nothing there changes in this
  plan), `src/api/allocation.ts`. A primitive that turns out to be missing is added locally under
  a page/component-scoped selector and reported — shared files (`panels.css`, `ChartCard.tsx`,
  `PageSkeleton.tsx`, `skeletonMetrics.ts`, `Segmented.tsx`) are never edited here.

## Primitives this lane consumes (delivered by F1/F2, verified in Task 0)

| Primitive | Where | Used as |
| --- | --- | --- |
| `PageFrame` prop `sections` | `src/components/shell/PageFrame.tsx` | already wired by F2 on all three pages (Net worth with `LocalSectionNav trailing={<Segmented Monthly/Quarterly/>}`); **do not re-wire** |
| `ChartCard` props `aside?: ReactNode`, `lede`, `footer`, `span` | `src/components/ChartCard.tsx` | Allocation aside (Task 7), Net worth lede (Task 10) |
| `StatTile` `badge?` | `src/components/StatTile.tsx` | not needed by this lane |
| `GhostTile` `delta?: boolean`; `PageSkeletonSpec.tiles: number \| { count: number; delta?: boolean }` | `src/components/PageSkeleton.tsx` | Portfolio `tiles: 5`, Credit cards `tiles: { count: 4, delta: false }` |
| `Disclosure` (`summary`, `className`, children) | `src/components/Disclosure.tsx` | Missing quotes (Task 7) |
| `useScrollEdges(ref)` | `src/components/useScrollEdges.ts` | Transactions/Securities scrollers (Task 9) |
| `.kpi-row`, `.kpi-row-dense`, `.kpi-row-5`, `.card-grid`, `.span-6/.span-12`, `.row-actions`/`.col-identity` sticky rules, tokens `--fill`, `--border` | `src/components/panels.css` | classes only |

Import forms assumed below: `import Disclosure from '../Disclosure'` (default) and
`import { useScrollEdges } from '../useScrollEdges'` (named). Task 0 checks both and tells you
which to flip if F2 chose otherwise.

---

## Task 0 — Pre-flight: the branch and the primitives

**Files:** none modified.

- [ ] **Step 1: Confirm the worktree sits on the merged foundation**

```bash
cd C:/Users/edyli/personal-finance-dashboard/.worktrees/polish-p2
git status --short && git log --oneline -3
```
Expected: clean tree, branch `polish/p2-portfolio`, and the log shows the F1/F2 merge commits
above the spec commit `ab92b91`.

- [ ] **Step 2: Verify every primitive this plan consumes exists under the assumed name**

```bash
ls src/components/Disclosure.tsx src/components/useScrollEdges.ts
grep -n "export" src/components/Disclosure.tsx src/components/useScrollEdges.ts
grep -n "aside" src/components/ChartCard.tsx | head -3
grep -n "kpi-row-dense\|td.row-actions\|data-scroll-more" src/components/panels.css | head -5
grep -n "delta" src/components/PageSkeleton.tsx | head -3
grep -n "sections" src/components/shell/PageFrame.tsx | head -3
grep -n "sections=\|local-section-toolbar" src/pages/NetWorthPage.tsx src/pages/PortfolioPage.tsx src/pages/CreditCardsPage.tsx
```
Expected: both files exist; `Disclosure.tsx` has `export default function Disclosure` (else flip
the import in Task 7 to the named form); `useScrollEdges.ts` has `export function useScrollEdges`
(else flip Task 9's import to the default form); `aside` appears in `ChartCardProps`;
`.kpi-row-dense` and `td.row-actions` exist in panels.css; `delta` appears in `GhostTile`;
`sections` appears in `PageFrame`'s props; each page shows one `sections=` line and NO
`local-section-toolbar`.

If anything is missing: stop, report to the lead which primitive is absent, and only if told to
proceed add it under a lane-scoped selector (`.allocation-…`, `.portfolio-page …`) in this
lane's own stylesheets.

- [ ] **Step 3: Baseline gates, so a later failure is yours**

```bash
npx tsc -b && npx eslint src/pages/NetWorthPage.tsx src/pages/PortfolioPage.tsx src/pages/CreditCardsPage.tsx src/components/portfolio src/components/creditcards src/api/allocation.ts && npx vitest run src/pages/PortfolioPage.test.tsx src/pages/NetWorthPage.test.tsx src/pages/CreditCardsPage.test.tsx src/components/portfolio
```
Expected: tsc silent, eslint 0 errors (warnings allowed), vitest all green. Note the warning
count — it is the budget you hand back in Task 12.

---

## Task 1 — "Unknown" → "Unclassified" in one voice (`api/allocation.ts`)

The server keeps spelling its catch-all slice `Unknown` (`backend/app/services/portfolio_allocation.py`
`dimension_label`); the page maps it. One helper, used by the donut, the CSV, the ranked table,
the drift table and the selection title.

**Files:**
- Modify: `src/api/allocation.ts:10` (after `UNKNOWN_CLASSIFICATION`) and `:93-100` (`allocationLabel`)
- Modify: `src/components/portfolio/allocationChartOptions.ts:5` (import), `:275-277` (`exposureOption` datum name), `:286-288` (`exposureCsv`)
- Test: `src/components/portfolio/allocationExperience.test.tsx:80-88`

- [ ] **Step 1: Write the failing test** — replace the last `it(...)` block (lines 80–88) of
`src/components/portfolio/allocationExperience.test.tsx` with:

```tsx
it('spells the catch-all slice Unclassified in the donut and the export, and keeps missing prices blank', () => {
  const option = exposureOption(data) as unknown as { series: { data: { name: string; allocationKey: string; value: number }[] }[] }
  expect(option.series[0].data.map((row) => row.allocationKey)).toEqual(['equity', '__unknown__'])
  // The wire says "Unknown"; the page says what it means (2026-09-13 polish §13).
  expect(option.series[0].data.map((row) => row.name)).toEqual(['Equity', 'Unclassified'])
  expect(option.series[0].data.reduce((sum, row) => sum + row.value, 0)).toBe(500)
  const csv = exposureCsv(data)
  expect(csv.rows[1].slice(0, 4)).toEqual(['Unclassified', '300.00', '60.0000', 'Unclassified'])
  expect(csv.rows[2].slice(0, 4)).toEqual(['Unpriced: GAP', '', '', 'Value unavailable'])
  expect(csv.rows[1]).toContain('person:7')
  expect(allocationLabel('__unknown__', 'asset_class')).toBe('Unclassified')
  expect(displayLabel('__unknown__', 'Unknown')).toBe('Unclassified')
  expect(displayLabel('equity', 'Equity')).toBe('Equity')
})
```
and change the test file's line 3 import to:

```tsx
import { allocationLabel, displayLabel, saveAllocationTargets, saveClassification } from '../../api/allocation'
```

- [ ] **Step 2: Run it to see it fail**

```bash
npx vitest run src/components/portfolio/allocationExperience.test.tsx
```
Expected: FAIL — `displayLabel` is not exported (TypeScript/ESM import error) or the name
assertion reads `'Unknown'`.

- [ ] **Step 3: Add the label helpers** — in `src/api/allocation.ts`, directly after line 10
(`export const UNKNOWN_CLASSIFICATION = '__unknown__'`) insert:

```ts
/** What the page calls the server's "__unknown__" catch-all (2026-09-13 polish §13): those
 *  holdings are not unknowable, they are not yet classified — and the Security classifications
 *  card is where that gets fixed. The wire keeps "Unknown" (portfolio_allocation.dimension_label);
 *  nothing here changes what the server sends. */
export const UNCLASSIFIED_LABEL = 'Unclassified'
/** Every slice and drift row's label passes through here so the page speaks in one voice. */
export function displayLabel(key: string, label: string): string {
  return key === UNKNOWN_CLASSIFICATION ? UNCLASSIFIED_LABEL : label
}
```
and change `allocationLabel`'s first line (was `if (key === UNKNOWN_CLASSIFICATION) return 'Unknown'`) to:

```ts
  if (key === UNKNOWN_CLASSIFICATION) return UNCLASSIFIED_LABEL
```

- [ ] **Step 4: Route the donut and the CSV through it** — in
`src/components/portfolio/allocationChartOptions.ts` change line 5 to:

```ts
import { displayLabel, UNCLASSIFIED_LABEL } from '../../api/allocation'
import type { AllocationData } from '../../api/allocation'
```
In `exposureOption` change the datum's `name: s.label,` to `name: displayLabel(s.key, s.label),`.
In `exposureCsv` change the row's first cell `s.label,` to `displayLabel(s.key, s.label),` and
`s.is_unknown ? 'Unknown' : 'Classified',` to `s.is_unknown ? UNCLASSIFIED_LABEL : 'Classified',`.

- [ ] **Step 5: Run the tests and the gates**

```bash
npx vitest run src/components/portfolio/allocationExperience.test.tsx src/components/portfolio/allocationChartOptions.test.ts && npx tsc -b
```
Expected: PASS (the heat treemap's `'Unknown fund industry'` group name in
`allocationChartOptions.test.ts:220` is an INDUSTRY label and is unchanged on purpose).

- [ ] **Step 6: Commit**

```bash
git add src/api/allocation.ts src/components/portfolio/allocationChartOptions.ts src/components/portfolio/allocationExperience.test.tsx
git commit -m "feat(allocation): the catch-all slice reads Unclassified — displayLabel/UNCLASSIFIED_LABEL, donut and CSV routed through it"
```

---

## Task 2 — Retire the Portfolio vocabulary: `.panel` → `.card`, `.panel-title` → `.eyebrow`, `.tiles-row` → `.kpi-row kpi-row-dense`

Purely presentational (same tokens), and it is what lets the stagger (`useStagger` GROUPS =
`.kpi-row, .card`), the scroll-linked reveal and the skeleton grammar reach Portfolio (M3, W7, W8).

**Files:**
- Modify: `src/components/portfolio/portfolio.css:10-14`
- Modify: `src/components/portfolio/allocation.css:2`
- Modify: `src/pages/PortfolioPage.css:15`
- Modify: `src/components/portfolio/DividendsPanel.tsx:228-229`, `RealizedPanel.tsx:25-26`,
  `SecuritiesPanel.tsx:159-160`, `TransactionsPanel.tsx:286-287`, `AllocationPanel.tsx:126-127, 172-173`,
  `AllocationTargetEditor.tsx:22-24`
- Modify: `src/pages/PortfolioPage.tsx:584, 691-694`
- Test: `src/pages/PortfolioPage.test.tsx` (new test appended at the end of the file)

- [ ] **Step 1: Write the failing test** — append to `src/pages/PortfolioPage.test.tsx`:

```tsx
// ── Shared card grammar (2026-09-13 polish §12, M3) ───────────────────────────────────────
// .panel/.panel-title/.tiles-row sat outside the motion, reveal and skeleton selectors, which
// all key on .card and .kpi-row. Same tokens, shared names.
describe('PortfolioPage — card vocabulary', () => {
  it('renders every block as .card/.eyebrow and the tiles as a dense .kpi-row', async () => {
    renderPage('/portfolio?section=holdings')
    await screen.findByText('Portfolio value')
    expect(document.querySelector('.panel, .panel-title, .tiles-row')).toBeNull()
    expect(document.querySelector('.loading-dim > .kpi-row.kpi-row-dense')).not.toBeNull()
    const holdings = screen.getByRole('heading', { name: 'Holdings' })
    expect(holdings.className).toBe('eyebrow')
    expect(holdings.closest('.card')).not.toBeNull()
    expect(holdings.closest('.card-title-row')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run it to see it fail**

```bash
npx vitest run src/pages/PortfolioPage.test.tsx -t "card vocabulary"
```
Expected: FAIL — `.panel` elements are found / heading className is `panel-title`.

- [ ] **Step 3: Replace the private classes with the shared ones**

`src/components/portfolio/portfolio.css` — replace lines 10–14 (the `.panel`, `.panel-title`,
`.panel-title-row` block and its comment) with:

```css
/* Portfolio's panels ARE cards now (2026-09-13 polish §12): panels.css's .card and .eyebrow carry
   the box and the heading, so the stagger, the scroll-linked reveal and the skeleton grammar reach
   them (they key on .card/.kpi-row). Only the title row — eyebrow beside an action — is local. */
.card-title-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 0.75rem; }
.card-title-row .eyebrow { margin: 0; }
```

`src/components/portfolio/allocation.css` — delete line 2
(`.allocation-workspace .panel { margin-bottom: 0; }`).

`src/pages/PortfolioPage.css` — delete line 15 (`.tiles-row { … }`).

In each of these files change `<section className="panel">` → `<section className="card">` and
`<h2 className="panel-title">` → `<h2 className="eyebrow">`:
`DividendsPanel.tsx:228-229`, `RealizedPanel.tsx:25-26`, `SecuritiesPanel.tsx:159-160`,
`TransactionsPanel.tsx:286-287`.

`src/components/portfolio/AllocationPanel.tsx` — line 126 `className="panel allocation-ranked"` →
`className="card allocation-ranked"`, line 127 `className="panel-title"` → `className="eyebrow"`
(this block is replaced wholesale in Task 7; renaming now keeps the tree consistent in between);
line 172 `className="panel allocation-employer"` → `className="card allocation-employer"`, line
173 `className="panel-title"` → `className="eyebrow"`.

`src/components/portfolio/AllocationTargetEditor.tsx` — lines 22–24 become:

```tsx
  return <section className="card allocation-targets" aria-label="Allocation targets">
    <div className="card-title-row">
      <h2 className="eyebrow">Your allocation targets</h2>
```

`src/pages/PortfolioPage.tsx` — line 584 `<div className="tiles-row">` →
`<div className="kpi-row kpi-row-dense">`; line 691 becomes
`<LocalSectionPanel state={views} section="holdings" className="card-grid">` (the heat card
joins this grid in Task 5); lines 692–694 become:

```tsx
              <section className="card span-12">
                <div className="card-title-row">
                  <h2 className="eyebrow">
```

- [ ] **Step 4: Run the tests and the gates**

```bash
npx vitest run src/pages/PortfolioPage.test.tsx src/components/portfolio && npx tsc -b && npx eslint src/pages/PortfolioPage.tsx src/components/portfolio
```
Expected: PASS, tsc silent, eslint clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/portfolio src/pages/PortfolioPage.tsx src/pages/PortfolioPage.css src/pages/PortfolioPage.test.tsx
git commit -m "refactor(portfolio): .panel/.panel-title/.tiles-row retired for the shared .card/.eyebrow/.kpi-row grammar"
```

---

## Task 3 — Portfolio chrome and copy: Segmented record tabs, "Clear selection", one-line price status

**Files:**
- Modify: `src/pages/PortfolioPage.tsx:38` (imports), `:70` (after `TAB_ARRIVALS`), `:388-391` (`noPricesWords`), `:477-546` (subheader), `:700-704` (Clear selection), `:761-789` (Manage tabs)
- Modify: `src/pages/PortfolioPage.css` (full listing below)
- Test: `src/pages/PortfolioPage.test.tsx:88, 347, 351, 359, 844, 859, 890-893, 905, 939` + two new tests

- [ ] **Step 1: Update the existing assertions and add the failing tests**

In `src/pages/PortfolioPage.test.tsx`:

- line 88: `import { formatDate, formatDateTime } from '../utils/format'`
- line 347: `await waitFor(() => expect(screen.getByRole('tab', { name: 'Transactions' }).getAttribute('aria-selected')).toBe('true'))`
- line 351: `fireEvent.click(screen.getByRole('tab', { name: 'Securities' }))`
- line 359: `expect(await screen.findByRole('tab', { name: 'Transactions', selected: true })).toBeTruthy()`
- lines 844 and 859: `const header = screen.getByText(/^Prices as of /)`
- line 890: `expect(await screen.findByText('No priced holdings in this view')).toBeTruthy()`
- line 891: `expect(screen.queryByText('Prices never refreshed')).toBeNull()`
- line 893: `expect(screen.getByText(/last refresh /)).toBeTruthy()`
- line 905: `expect(await screen.findByText('Prices never refreshed')).toBeTruthy()`
- line 939: `await screen.findByText(/Prices as of|Prices never refreshed/)`

Append inside the `describe('PortfolioPage — card vocabulary', …)` block added in Task 2:

```tsx
  it('joins the price clock and the last refresh into one status line (2026-09-13 polish §10)', async () => {
    vi.mocked(fetchRefreshStatus).mockResolvedValue({
      last: { at: '2026-09-11T20:10:00Z', trigger: 'scheduled', updated: 36, failed: {}, skipped_manual: 0, history_appended: false },
      next_run_at: null,
    })
    renderPage()
    await screen.findByText('Portfolio value')
    const line = document.querySelector('.page-frame-subheader .portfolio-status-line') as HTMLElement
    expect(line.textContent).toBe(`Prices as of ${formatDate('2026-08-27T20:00:00Z')} · last refresh ${formatDateTime('2026-09-11T20:10:00Z')} (scheduled) · 36 updated`)
    expect(document.querySelectorAll('.page-frame-subheader .refresh-status-line')).toHaveLength(1)
  })

  it('names the Manage records with shell tabs and clears a selection by its real verb', async () => {
    renderPage('/portfolio?ticker=voo')
    await screen.findByRole('heading', { name: /Holdings — VOO/ })
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(await screen.findByRole('heading', { name: 'Holdings' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Manage' }))
    const tabs = screen.getByRole('tablist', { name: 'Portfolio records' })
    expect(tabs.className).toContain('segmented-tabs')
    expect([...tabs.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Transactions', 'Securities', 'Realized'])
    expect(document.querySelector('.tab-row')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Realized' }))
    const panel = document.getElementById('portfolio-records-realized') as HTMLElement
    expect(panel.hidden).toBe(false)
    expect(screen.getByRole('tab', { name: 'Realized' }).getAttribute('aria-controls')).toBe('portfolio-records-realized')
  })
```

- [ ] **Step 2: Run to see the new tests fail**

```bash
npx vitest run src/pages/PortfolioPage.test.tsx -t "card vocabulary"
```
Expected: FAIL — no `.portfolio-status-line`, no tablist named "Portfolio records".

- [ ] **Step 3: Imports and constants** — in `src/pages/PortfolioPage.tsx` add after line 38
(`import PageFrame from '../components/shell/PageFrame'`):

```tsx
import Segmented from '../components/shell/Segmented'
import type { SegmentedOption } from '../components/shell/Segmented'
```
and after line 70 (`const TAB_ARRIVALS …`) add:

```tsx
// The Manage view's three ledgers as a shell tablist (2026-09-13 polish §12, S3) — the page's
// private .tab-row was a second, differently styled tab idiom. `Tab` still carries 'dividends'
// for the ?tab= arrival, which lands on the Income view instead.
const RECORD_TABS: readonly SegmentedOption<Tab>[] = [
  { value: 'transactions', label: 'Transactions' },
  { value: 'securities', label: 'Securities' },
  { value: 'realized', label: 'Realized' },
]
const RECORD_PANEL_IDS: Partial<Record<Tab, string>> = {
  transactions: 'portfolio-records-transactions',
  securities: 'portfolio-records-securities',
  realized: 'portfolio-records-realized',
}
```

- [ ] **Step 4: Manage tabs** — replace lines 761–789 (from `<div className="portfolio-manage">`
through the realized wrapper's closing `</div>` and the `</div>` that closes `.portfolio-manage`) with:

```tsx
                <div className="portfolio-manage">
                  <Segmented
                    variant="tabs"
                    size="sm"
                    ariaLabel="Portfolio records"
                    options={RECORD_TABS}
                    value={tab}
                    onChange={setTab}
                    panelIds={RECORD_PANEL_IDS}
                  />
                  <div id={RECORD_PANEL_IDS.transactions} role="tabpanel" hidden={tab !== 'transactions'}>
                    <TransactionsPanel
                      securities={securities}
                      transactions={transactions}
                      accounts={accountLabels}
                      primaryName={primaryName}
                      onChanged={reload}
                    />
                  </div>
                  <div id={RECORD_PANEL_IDS.securities} role="tabpanel" hidden={tab !== 'securities'}><SecuritiesPanel securities={securities} onChanged={reload} /></div>
                  <div id={RECORD_PANEL_IDS.realized} role="tabpanel" hidden={tab !== 'realized'}>{realized && <RealizedPanel realized={realized} />}</div>
                </div>
```

- [ ] **Step 5: Clear selection** — lines 700–704: the button's text `All holdings` becomes
`Clear selection` (C1: the table stays up; the button only clears the drill).

- [ ] **Step 6: One status line** — change `noPricesWords` (lines 388–391) to sentence case:

```tsx
  const noPricesWords =
    (holdings !== null && holdings.holdings.length === 0) || refreshStatus?.last != null
      ? 'No priced holdings in this view'
      : 'Prices never refreshed'
```
and replace the `subheader={…}` prop (lines 477–546) with:

```tsx
        subheader={
          <>
            {/* One line (2026-09-13 polish §10, C10): the price clock and the scheduler's last run
                read as a sentence — "Prices as of … · last refresh … (scheduled) · 36 updated".
                as_of is the OLDEST quote (A4) and keeps its stale tone + both-clocks tooltip. */}
            <p className="portfolio-status-line">
              {asOf ? (
                <span
                  className={isStaleQuote(asOf) ? 'as-of stale' : 'as-of'}
                  title={
                    newestQuote
                      ? `oldest quote across holdings — newest ${formatDate(newestQuote)}`
                      : 'oldest quote across holdings'
                  }
                >
                  Prices as of {formatDate(asOf)}
                </span>
              ) : (
                <span className="as-of">{noPricesWords}</span>
              )}
              {refreshStatus?.last && (
                <span className="refresh-status-line">
                  {' · '}last refresh {formatDateTime(refreshStatus.last.at)} ({refreshStatus.last.trigger}) · {refreshStatus.last.updated} updated
                  {refreshStatus.last.failed && Object.keys(refreshStatus.last.failed).length > 0 && (
                    <> · {Object.keys(refreshStatus.last.failed).length} failed</>
                  )}
                  {refreshStatus.next_run_at && <> · next {formatDateTime(refreshStatus.next_run_at)}</>}
                </span>
              )}
            </p>
            {/* One element, always mounted: a live region added at announce-time is not read.
                Partial failures are an alert, not a status — they need the user's attention. */}
            <div
              className={refreshNote.failed > 0 ? 'hint refresh-note-bad' : 'hint'}
              role={refreshNote.failed > 0 ? 'alert' : 'status'}
              title={refreshNote.detail || undefined}
            >
              {refreshNote.text}
            </div>
            {failedEntries.length > 0 && (
              <div className="refresh-failures">
                {failedEntries.map(([ticker, reason]) => (
                  <span key={ticker} className="refresh-failure" title={reason}>
                    {ticker}
                    {/* One click retires the ZI ritual (README 7.4's manual is_active edit):
                        deactivating removes the ticker from every future refresh; the
                        Securities tab can always bring it back. */}
                    <button
                      type="button"
                      aria-label={`Deactivate ${ticker} so refreshes skip it`}
                      disabled={deactivating !== null}
                      onClick={() => deactivate(ticker)}
                    >
                      {deactivating === ticker ? 'Deactivating…' : 'Deactivate'}
                    </button>
                  </span>
                ))}
              </div>
            )}
          </>
        }
```

- [ ] **Step 7: The page stylesheet** — replace `src/pages/PortfolioPage.css` in full with:

```css
/* Page-scoped rules ONLY. Everything the portfolio components consume lives in
   src/components/portfolio/portfolio.css (imported by each of them); the app-wide vocabulary
   (.page, .card, .kpi-row, .stat-tile, .error-banner, .empty-note, .loading-dim, .segmented)
   lives in panels.css/shell.css, and the title row, subheader and sticky scope row belong to
   PageFrame's shell.css. Nothing any of those files defines is redefined here. */

/* The price clock and the scheduler's last run share ONE line under the title row (2026-09-13
   polish §10) — a sentence, muted, with the stale variant in the shared amber advisory token
   (--warn, PALETTE[3]) every other stale cue wears; the title attribute carries the words. */
.portfolio-page .portfolio-status-line { margin: 0 0 4px; font-size: 12px; color: var(--muted); }
.portfolio-page .as-of.stale { color: var(--warn); }

/* The refresh note keeps ONE element mounted so a live region exists before the first
   refresh — collapse its margin while it is empty. */
.portfolio-page .hint:empty { margin: 0; }
.hint.refresh-note-bad { color: var(--negative); }

/* The last-run failures, each with its one-click deactivate. Amber = the app's advisory
   register (--warn, PALETTE[3] amber); the chip's button carries panels.css's
   .button tokens at chip scale. */
.refresh-failures { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 10px; }
.refresh-failure {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 3px 6px 3px 10px;
  border: 1px solid var(--border); border-left: 3px solid var(--warn); border-radius: 8px;
  background: var(--surface); color: var(--text); font-size: 12px;
}
.refresh-failure button {
  border: 1px solid var(--border); border-radius: 6px; background: var(--surface-2);
  color: var(--text); font-size: 11px; padding: 2px 8px; cursor: pointer;
}
.refresh-failure button:hover { border-color: var(--muted); }
.refresh-failure button:disabled { opacity: 0.5; cursor: not-allowed; }
.refresh-failure button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

/* Manage: the shell Segmented tablist above whichever ledger card is showing (the hidden
   wrappers take no grid track). The old .tab-row idiom is gone (2026-09-13 polish §12, S3). */
.portfolio-manage { display: grid; gap: 12px; }

/* The refresh button carries no shared .button class — same tokens as panels.css .button. */
.refresh-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); color: var(--text); font-size: 0.85rem; padding: 0.35rem 0.75rem; cursor: pointer; }
.refresh-btn:hover { border-color: var(--muted); }
.refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.refresh-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

@media (prefers-reduced-motion: no-preference) {
  /* Literal, not a token: an INFINITE spinner's period is a rate, not a grammar duration,
     and reading a --t-* would freeze it mid-turn under reduce — which is exactly why
     motion.test.ts's literal sweep exempts `infinite` (spec §1). */
  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
}
```

- [ ] **Step 8: Run the tests and the gates**

```bash
npx vitest run src/pages/PortfolioPage.test.tsx src/theme/motion.test.ts && npx tsc -b && npx eslint src/pages/PortfolioPage.tsx
```
Expected: PASS (all PortfolioPage tests incl. the three rewritten Manage ones; motion sweep
still clean), tsc silent, eslint clean.

- [ ] **Step 9: Commit**

```bash
git add src/pages/PortfolioPage.tsx src/pages/PortfolioPage.css src/pages/PortfolioPage.test.tsx
git commit -m "feat(portfolio): Manage ledgers on a shell Segmented tablist, Clear selection, one-line price status"
```

---

## Task 4 — Portfolio tiles per view + skeleton parity

Tiles belong to a view's summary (spec §12): Overview, Holdings and Allocation keep the five; on
Income the Dividends card's own three tiles are the row; Manage gets none. The strip sits above
in the sticky block, so a tile-less view cannot make it jump — no height reservation needed
(the three tile views render the identical row).

**Files:**
- Modify: `src/pages/PortfolioPage.tsx:98` (after `PAGE_SECTIONS`), `:583` (tiles condition), `:572` (skeleton)
- Test: `src/pages/PortfolioPage.test.tsx:710` (retry test) + new describe

- [ ] **Step 1: Write the failing tests** — append to `src/pages/PortfolioPage.test.tsx`:

```tsx
// ── Tiles per view (2026-09-13 polish §12, S1/S7) ────────────────────────────────────────
describe('PortfolioPage — tiles per view', () => {
  it('shows the five tiles on Overview, Holdings and Allocation, and none on Income or Manage', async () => {
    renderPage()
    await screen.findByText('Portfolio value')
    const pageTiles = () => document.querySelector('.loading-dim > .kpi-row')
    expect(pageTiles()).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Holdings' }))
    expect(pageTiles()).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Income' }))
    expect(pageTiles()).toBeNull()
    expect(screen.queryByText('Portfolio value')).toBeNull()
    // The Dividends card's own tiles are the Income row (Trailing 12-mo / YTD / Projected).
    const income = screen.getByRole('tabpanel', { name: 'Income' })
    expect(within(income).getByRole('heading', { name: /Dividends/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Manage' }))
    expect(pageTiles()).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Allocation' }))
    expect(pageTiles()).not.toBeNull()
    expect(screen.getByText('Portfolio value')).toBeTruthy()
  })
})
```
and in the existing retry test (`'shows the alert alone on a failed first load and retries back
into the skeleton'`, line ~710) after `expect(container.querySelector('.page-skeleton')).not.toBeNull()` add:

```tsx
  // Ghost parity (spec §9): five real tiles, five ghosts.
  expect(container.querySelectorAll('.page-skeleton .skeleton-tile')).toHaveLength(5)
```
Change the test file's first line to import `within` as well:

```tsx
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
```

- [ ] **Step 2: Run to see them fail**

```bash
npx vitest run src/pages/PortfolioPage.test.tsx -t "tiles per view|retries back into the skeleton"
```
Expected: FAIL — the tiles row is present on Income/Manage; 4 ghost tiles, not 5.

- [ ] **Step 3: Gate the tiles on the view** — in `src/pages/PortfolioPage.tsx` add after line 98
(`const PAGE_SECTIONS = …`):

```tsx
// Tiles belong to a view's summary, not to every view (2026-09-13 polish §12, S1): Overview,
// Holdings and Allocation read the whole book; on Income the Dividends card's own three tiles
// are the row; Manage is a ledger and gets none. Nothing reserves the row's height — the tab
// strip lives in the sticky block above, so a view without tiles cannot make it jump.
const TILE_VIEWS: ReadonlySet<string> = new Set(['overview', 'holdings', 'allocation'])
```
Change the tiles condition (line 583) from `{totals && (` to `{totals && TILE_VIEWS.has(views.section) && (`.
Change the skeleton (line 572) `tiles: 4,` → `tiles: 5,`.

- [ ] **Step 4: Run the tests and the gates**

```bash
npx vitest run src/pages/PortfolioPage.test.tsx && npx tsc -b && npx eslint src/pages/PortfolioPage.tsx
```
Expected: PASS, tsc silent, eslint clean.

- [ ] **Step 5: Commit**

```bash
git add src/pages/PortfolioPage.tsx src/pages/PortfolioPage.test.tsx
git commit -m "feat(portfolio): tiles only on Overview/Holdings/Allocation; five ghost tiles"
```

---

## Task 5 — The industry heat treemap moves to the Holdings view as a normal ChartCard

`details.allocation-heat` (a bare `<summary>` on the page background, T2/A1, blank until scrolled
20% in, A3) becomes `HeatTreemapCard`, mounted after the holdings table. Option builder and
selection adapter are lifted verbatim; the card fetches the classification records itself
(industry lives on the security's classification).

**Files:**
- Create: `src/components/portfolio/ownerScopeLabel.ts`
- Create: `src/components/portfolio/HeatTreemapCard.tsx`
- Create: `src/components/portfolio/HeatTreemapCard.test.tsx`
- Modify: `src/components/portfolio/AllocationPanel.tsx:1-19` (imports), `:32`, `:70-74`, `:87-95`, `:154-165`
- Modify: `src/components/portfolio/allocation.css:26-27`
- Modify: `src/pages/PortfolioPage.tsx:33` (import), `:738` (mount after the holdings `</section>`)
- Test: `src/pages/PortfolioPage.test.tsx:727-739, 768-793` + one new test

- [ ] **Step 1: Write the failing tests**

Create `src/components/portfolio/HeatTreemapCard.test.tsx`:

```tsx
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fetchClassifications } from '../../api/allocation'
import type { HoldingOut } from '../../types/api'
import HeatTreemapCard from './HeatTreemapCard'

vi.mock('../../api/allocation', async (original) => ({
  ...await original<typeof import('../../api/allocation')>(),
  fetchClassifications: vi.fn(),
}))
// echarts is never rendered in jsdom (house law); the option is pinned in allocationChartOptions.test.ts.
vi.mock('../EChart', async () => {
  const { createElement } = await import('react')
  return { default: ({ ariaLabel }: { ariaLabel?: string }) => createElement('div', { 'data-testid': 'echart', 'aria-label': ariaLabel }) }
})

const VOO: HoldingOut = {
  security_id: 1, ticker: 'VOO', name: 'Vanguard S&P 500 ETF', industry: 'Index', holding_type: 'etf',
  is_manual_priced: false, shares: '10', avg_cost: '400.00', cost_basis: '4000.00', price: '450.00',
  quoted_at: '2026-08-27T20:00:00Z', price_source: 'yfinance', day_change_pct: '0.0022', day_change_amount: '10.00',
  market_value: '4500.00', weight_pct: '1.0', unrealized_gl: '500.00', unrealized_gl_pct: '0.125', realized_gl: '0.00',
  dividends_collected: '15.00', annual_dividend: '6.00', annual_income: '60.00', yield_pct: '0.0133', yoc_pct: '0.015',
  xirr_pct: '0.09', accounts: ['Fidelity Brokerage'], warnings: [],
}

beforeEach(() => vi.mocked(fetchClassifications).mockResolvedValue([]))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('draws the treemap as a plain chart card with its colour key and metric toggle, no accordion', async () => {
  render(<MemoryRouter><HeatTreemapCard holdings={[VOO]} /></MemoryRouter>)
  expect(await screen.findByLabelText('Holdings grouped by known industry and unknown exposure')).toBeTruthy()
  expect(screen.getByText(/Orange = loss, blue = gain/)).toBeTruthy()
  expect(screen.getByRole('group', { name: 'Heat metric' })).toBeTruthy()
  expect(document.querySelector('details')).toBeNull()
  expect(fetchClassifications).toHaveBeenCalledTimes(1)
})

it('says so on the card when the industry records cannot be fetched', async () => {
  vi.mocked(fetchClassifications).mockRejectedValue(new Error('records down'))
  render(<MemoryRouter><HeatTreemapCard holdings={[VOO]} /></MemoryRouter>)
  expect((await screen.findByRole('status')).textContent).toContain('Industry records unavailable')
})
```

In `src/pages/PortfolioPage.test.tsx` add the import
`import { expectInDocumentOrder } from '../testing/domOrder'` after line 20, then replace the
test `'opens allocation charts from their task view while retaining performance'` (lines 727–739) with:

```tsx
it('opens the allocation donut from its task view while retaining performance', async () => {
  renderPage()
  await screen.findByText('Performance')
  expect(screen.getByLabelText(/Line chart of portfolio value against cost basis/)).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: 'Allocation' }))
  await screen.findByLabelText('Portfolio allocation by asset class')
  expect(screen.getByRole('group', { name: 'Export portfolio-performance', hidden: true })).toBeTruthy()
  // The industry heat treemap lives with the holdings now (2026-09-13 polish §11), not here.
  expect(screen.queryByLabelText(/Holdings grouped by known industry/)).toBeNull()
  expect(document.querySelector('details.allocation-heat')).toBeNull()
})

it('draws the industry heat treemap under the holdings table with its own metric toggle', async () => {
  renderPage('/portfolio?section=holdings')
  const table = (await screen.findByRole('heading', { name: 'Holdings' })).closest('.card') as HTMLElement
  const heat = (await screen.findByLabelText(/Holdings grouped by known industry/)).closest('.chart-card') as HTMLElement
  expectInDocumentOrder(table, heat)
  expect(screen.getByRole('group', { name: 'Heat metric' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Day change' }))
  expect(screen.getByRole('button', { name: 'Day change' }).getAttribute('aria-pressed')).toBe('true')
})
```
and in `'renders the panels real empty notes for an owner who holds nothing'` (lines 768–793)
replace the two lines after `await waitFor(() => expect(fetchAllocationData).toHaveBeenCalledWith('asset_class', SAM.id))`
(the `getAllByText(...).length).toBe(2)` wait and its comment) with:

```tsx
  // The donut falls back to its note rather than an empty canvas. The heat treemap now lives in
  // the Holdings view (2026-09-13 polish §11) and shows its own note THERE, so the count here is one.
  const allocation = screen.getByRole('tabpanel', { name: 'Allocation' })
  await waitFor(() => expect(within(allocation).getAllByText('No priced holdings yet.').length).toBe(1))
```
(keep the `Orange = loss` assertion that follows — the key stays off under an empty note wherever the card sits).

- [ ] **Step 2: Run to see them fail**

```bash
npx vitest run src/components/portfolio/HeatTreemapCard.test.tsx src/pages/PortfolioPage.test.tsx -t "heat treemap|allocation donut|real empty notes"
```
Expected: FAIL — `HeatTreemapCard` module not found; the treemap is still inside Allocation.

- [ ] **Step 3: The scope label helper** — create `src/components/portfolio/ownerScopeLabel.ts`:

```ts
import type { OwnerScope } from '../../api/netWorth'
import { getSnapshot } from '../../api/snapshotCache'
import type { HouseholdOut } from '../../types/api'
import { HOUSEHOLD_SNAPSHOT } from '../shell/ScopeBar'

/** The scope's name for a selection receipt — read off the household snapshot the ScopeBar
 *  already keeps, so no card fetches the household a second time to label a slice. Shared by
 *  AllocationPanel and HeatTreemapCard (one definition, two views). */
export function ownerScopeLabel(owner: OwnerScope): string {
  if (owner === null) return 'Household'
  if (owner === 'joint') return 'Joint'
  return getSnapshot<HouseholdOut>(HOUSEHOLD_SNAPSHOT)?.people.find((person) => person.id === owner)?.name ?? 'Selected owner'
}
```

- [ ] **Step 4: The card** — create `src/components/portfolio/HeatTreemapCard.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { fetchClassifications } from '../../api/allocation'
import type { SecurityClassification } from '../../api/allocation'
import { errorDetail } from '../../api/client'
import type { OwnerScope } from '../../api/netWorth'
import type { HoldingOut } from '../../types/api'
import type { ChartSelection } from '../../types/metrics'
import { formatDate } from '../../utils/format'
import ChartCard from '../ChartCard'
import Segmented from '../shell/Segmented'
import { HEAT_METRICS, heatTreemapCsv, heatTreemapOption } from './allocationChartOptions'
import type { HeatMetric } from './allocationChartOptions'
import { ownerScopeLabel } from './ownerScopeLabel'
import './portfolio.css'

// The industry heat treemap, moved out of the Allocation view's bare <details> to stand under
// the holdings table as a normal card (2026-09-13 polish §11 — T2/A1, and A3's blank-until-
// scrolled accordion). The option builder and the selection adapter are AllocationPanel's,
// verbatim; only the mount moved. It fetches the classification records itself because
// industry lives on the security's classification, not on the holding — a failed fetch
// degrades to "Unknown industry" cells and SAYS so on the card (card-local advisory).
export default function HeatTreemapCard({ holdings, owner = null }: { holdings: HoldingOut[]; owner?: OwnerScope }) {
  const [metric, setMetric] = useState<HeatMetric>('unrealized')
  const [classifications, setClassifications] = useState<SecurityClassification[]>([])
  const [classificationError, setClassificationError] = useState<string | null>(null)
  // Refetch when a holding's shares, price or quote date moves — the same revision key
  // AllocationPanel keys its fetches on, so the two views agree on when industries are stale.
  const holdingsRevision = holdings.map((h) => `${h.security_id}:${h.shares}:${h.price}:${h.quoted_at}`).join('|')
  useEffect(() => {
    let cancelled = false
    void fetchClassifications().then((rows) => {
      if (!cancelled) { setClassifications(rows); setClassificationError(null) }
    }).catch((err) => { if (!cancelled) setClassificationError(errorDetail(err)) })
    return () => { cancelled = true }
  }, [holdingsRevision])
  const industryHoldings = useMemo(() => {
    const byId = new Map(classifications.map((row) => [row.security_id, row]))
    return holdings.map((holding) => ({ ...holding, industry: byId.get(holding.security_id)?.industry ?? null }))
  }, [holdings, classifications])
  const heat = useMemo(() => heatTreemapOption(industryHoldings, metric), [industryHoldings, metric])
  const scopeLabel = ownerScopeLabel(owner)
  const scopedSource = (ticker: string) =>
    `/portfolio?section=holdings${owner === null ? '' : `&owner=${owner}`}&ticker=${encodeURIComponent(ticker)}`
  const holdingSelection = (ticker: string): ChartSelection | null => {
    const holding = holdings.find((h) => h.ticker === ticker)
    if (!holding) return null
    return { kind: 'entity', id: `${owner}:${ticker}`, label: ticker, entityType: 'security', entityId: holding.security_id,
      scope: scopeLabel, context: { owner }, source: { href: scopedSource(ticker), label: `Open ${ticker} holding` },
      values: [{ label: 'Market value', value: holding.market_value, unit: 'USD' },
        { label: 'Shares', value: holding.shares }, { label: 'Quoted', value: formatDate(holding.quoted_at) }],
    }
  }
  return <ChartCard title="Holding performance · industry coverage"
    hint="Area is priced market value; color is performance. Fund industries remain unknown. Select a ticker to inspect it."
    ariaLabel="Holdings grouped by known industry and unknown exposure" option={heat} empty="No priced holdings yet."
    exportName="holdings-industry-performance" csv={() => heatTreemapCsv(industryHoldings)} height={360}
    error={classificationError === null ? null : `Industry records unavailable: ${classificationError}`}
    controls={<Segmented variant="toggle" size="sm" ariaLabel="Heat metric" options={HEAT_METRICS} value={metric} onChange={setMetric} />}
    selectionScopeKey={String(owner ?? 'household')}
    selectionAdapter={(event) => {
      const ticker = (event as unknown as { data?: { ticker?: string } }).data?.ticker
      return ticker ? holdingSelection(ticker) : null
    }} rowSelection={(row) => holdingSelection(String(row[1]))}
    footer={heat !== null ? <p className="hint">Orange = loss, blue = gain, with color capped at ±50%. Unknown industries remain visible.</p> : undefined} />
}
```

- [ ] **Step 5: Mount it under the holdings table** — in `src/pages/PortfolioPage.tsx` add after
line 33 (`import HoldingDetailPanel …`):

```tsx
import HeatTreemapCard from '../components/portfolio/HeatTreemapCard'
```
and directly after the holdings `</section>` (the line before `</LocalSectionPanel>` of the
`holdings` panel, ~line 738) insert:

```tsx
              {/* The industry heat treemap (2026-09-13 polish §11): a card under the table it
                  colours, no longer a closed <details> at the foot of Allocation. */}
              <HeatTreemapCard holdings={holdings.holdings} owner={scope.owner} />
```

- [ ] **Step 6: Take it out of AllocationPanel** — in `src/components/portfolio/AllocationPanel.tsx`:

- line 16 becomes `import { exposureCsv, exposureOption } from './allocationChartOptions'`; delete line 17 (`import type { HeatMetric } …`).
- delete line 32 (`const [metric, setMetric] = useState<HeatMetric>('unrealized')`).
- delete lines 70–74 (the `industryHoldings` and `heat` memos).
- delete lines 87–95 (`const holdingSelection = …` through its closing `}`).
- delete lines 154–165 (`<details className="allocation-heat">` through `</details>`).

Everything else stays (the `holdings` prop still drives `holdingsRevision`; `formatShares` is still
used by the Missing-quotes list). In `src/components/portfolio/allocation.css` replace lines 26–27 with:

```css
.allocation-classifications > summary { padding: 4px 0; cursor: pointer; font-weight: 600; }
```
(Task 6 deletes that line too when the accordion becomes a card.)

- [ ] **Step 7: Run the tests and the gates**

```bash
npx vitest run src/components/portfolio src/pages/PortfolioPage.test.tsx && npx tsc -b && npx eslint src/pages/PortfolioPage.tsx src/components/portfolio
```
Expected: PASS; tsc silent (no unused imports left in AllocationPanel); eslint clean.

- [ ] **Step 8: Commit**

```bash
git add src/components/portfolio/ownerScopeLabel.ts src/components/portfolio/HeatTreemapCard.tsx src/components/portfolio/HeatTreemapCard.test.tsx src/components/portfolio/AllocationPanel.tsx src/components/portfolio/allocation.css src/pages/PortfolioPage.tsx src/pages/PortfolioPage.test.tsx
git commit -m "feat(portfolio): industry heat treemap is a ChartCard under the holdings table (HeatTreemapCard), not an Allocation accordion"
```

---

## Task 6 — The Security classifications card (replaces `details.allocation-classifications`)

Always visible, opens on the work (spec §13): eyebrow, coverage sentence, `Segmented
variant="chips"` Unclassified / Not reviewed / All beside the search box, a compact table whose
Asset class and Geography selects PATCH on change (Undo toast on success, inline `role="alert"`
on failure), the industry box only where `industry_available`, a note edited in place, and a
source column reading "Import · not reviewed" / "Reviewed {date}". The old per-row Review form
goes. The card exposes `focusUnclassified()` through a React 19 `ref` prop for Task 7.

**Files:**
- Create: `src/components/portfolio/classificationRows.ts` (pure helpers — a `.ts` file, so
  `react-refresh/only-export-components` stays quiet)
- Create: `src/components/portfolio/classificationRows.test.ts`
- Create: `src/components/portfolio/ClassificationEditor.test.tsx`
- Rewrite: `src/components/portfolio/ClassificationEditor.tsx`
- Modify: `src/components/portfolio/allocation.css:16, 19, 23, 26, 28` + appended block
- Modify: `src/components/portfolio/allocationExperience.test.tsx:3-6, 63-78` (the old Review-form test goes; its replacement is the new test file)

- [ ] **Step 1: Write the failing helper tests** — create `src/components/portfolio/classificationRows.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { SecurityClassification } from '../../api/allocation'
import { coverageSentence, defaultClassificationFilter, emptyFilterSentence, filterClassificationRows } from './classificationRows'

const row = (over: Partial<SecurityClassification>): SecurityClassification => ({
  security_id: 1, ticker: 'VOO', name: 'Vanguard S&P 500 ETF', holding_type: 'etf', asset_class: null, industry: null,
  geography: null, source: 'Existing security records', note: null, reviewed_at: null, industry_available: false, ...over,
})
const fund = row({ security_id: 2, ticker: 'VFFSX', name: 'Vanguard 500 Index' })
const stock = row({ security_id: 3, ticker: 'NVDA', name: 'NVIDIA', holding_type: 'stock', asset_class: 'equity', geography: 'us',
  industry: 'Semis', reviewed_at: '2026-09-01T00:00:00Z', industry_available: true })
const seenFund = row({ security_id: 4, ticker: 'BND', name: 'Total Bond', asset_class: null, reviewed_at: '2026-08-01T00:00:00Z' })

describe('coverageSentence', () => {
  it('counts the gap and the unreviewed separately', () => {
    expect(coverageSentence([fund, stock, seenFund])).toBe('2 of 3 securities have no asset class · 1 not yet reviewed')
    expect(coverageSentence([fund, stock])).toBe('1 of 2 securities has no asset class · 1 not yet reviewed')
  })
  it('says the work is done when it is', () => {
    expect(coverageSentence([stock])).toBe('The security has an asset class · all reviewed')
    expect(coverageSentence([stock, { ...stock, security_id: 9, ticker: 'AMD' }])).toBe('All 2 securities have an asset class · all reviewed')
    expect(coverageSentence([])).toBe('No securities yet — they appear here once transactions are recorded.')
  })
})

describe('filters', () => {
  it('opens on Unclassified only while there is something to classify', () => {
    expect(defaultClassificationFilter([fund, stock])).toBe('unclassified')
    expect(defaultClassificationFilter([stock])).toBe('all')
    expect(defaultClassificationFilter([])).toBe('all')
  })
  it('chips and search compose', () => {
    expect(filterClassificationRows([fund, stock, seenFund], 'unclassified', '').map((r) => r.ticker)).toEqual(['VFFSX', 'BND'])
    expect(filterClassificationRows([fund, stock, seenFund], 'unreviewed', '').map((r) => r.ticker)).toEqual(['VFFSX'])
    expect(filterClassificationRows([fund, stock, seenFund], 'all', 'nvid').map((r) => r.ticker)).toEqual(['NVDA'])
    expect(filterClassificationRows([fund, stock, seenFund], 'unclassified', 'bond').map((r) => r.ticker)).toEqual(['BND'])
  })
  it('names why a filtered table is empty', () => {
    expect(emptyFilterSentence('unclassified', '')).toBe('All securities have an asset class.')
    expect(emptyFilterSentence('unreviewed', '')).toBe('Every security has been reviewed.')
    expect(emptyFilterSentence('all', 'zzz')).toBe('No securities match “zzz”.')
  })
})
```

- [ ] **Step 2: Write the failing card tests** — create `src/components/portfolio/ClassificationEditor.test.tsx`:

```tsx
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveClassification } from '../../api/allocation'
import type { SecurityClassification } from '../../api/allocation'
import { formatDate } from '../../utils/format'
import ToastProvider from '../ToastProvider'
import ClassificationEditor from './ClassificationEditor'
import type { ClassificationEditorHandle } from './ClassificationEditor'

vi.mock('../../api/allocation', async (original) => ({
  ...await original<typeof import('../../api/allocation')>(),
  saveClassification: vi.fn(),
}))

const fund: SecurityClassification = { security_id: 2, ticker: 'FUND', name: 'A fund', holding_type: 'etf',
  asset_class: null, industry: null, geography: null, source: 'Existing security records', note: null,
  reviewed_at: null, industry_available: false }
const stock: SecurityClassification = { security_id: 3, ticker: 'NVDA', name: 'NVIDIA', holding_type: 'stock',
  asset_class: 'equity', industry: 'Semis', geography: 'us', source: 'Reviewed by you', note: null,
  reviewed_at: '2026-09-01T00:00:00Z', industry_available: true }

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('Security classifications card', () => {
  it('opens on the unclassified rows, states coverage, and saves an inline pick with Undo', async () => {
    vi.mocked(saveClassification).mockResolvedValue({ data: fund, headers: new Headers({ 'X-Change-Batch': 'batch-9' }) })
    const onChanged = vi.fn()
    render(<ToastProvider><ClassificationEditor classifications={[fund, stock]} onChanged={onChanged} /></ToastProvider>)
    expect(screen.getByRole('region', { name: 'Security classifications' })).toBeTruthy()
    expect(screen.getByText('1 of 2 securities has no asset class · 1 not yet reviewed')).toBeTruthy()
    // Chips carry their counts; Unclassified is the default while there is work.
    expect(screen.getByRole('button', { name: /^Unclassified/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText('FUND asset class')).toBeTruthy()
    expect(screen.queryByLabelText('NVDA asset class')).toBeNull()
    // A fund's industry is a sentence, not a box; its source is the import, not yet reviewed.
    expect(screen.queryByLabelText('FUND industry')).toBeNull()
    expect(screen.getByText('Fund holdings not loaded')).toBeTruthy()
    expect(screen.getByText('Import · not reviewed')).toBeTruthy()
    // The old per-row Review form is gone.
    expect(screen.queryByRole('button', { name: /Review/ })).toBeNull()
    fireEvent.change(screen.getByLabelText('FUND asset class'), { target: { value: 'bonds' } })
    // Optimistic: the pick shows at once…
    expect((screen.getByLabelText('FUND asset class') as HTMLSelectElement).value).toBe('bonds')
    // …and the PATCH carries the whole row with the change applied.
    await waitFor(() => expect(saveClassification).toHaveBeenCalledWith(2, { asset_class: 'bonds', industry: null, geography: null, note: null }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
    expect(screen.getByText('FUND classification saved')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('reveals the whole list behind All and names a reviewed source by its date', () => {
    render(<ClassificationEditor classifications={[fund, stock]} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^All/ }))
    expect((screen.getByLabelText('NVDA asset class') as HTMLSelectElement).value).toBe('equity')
    expect((screen.getByLabelText('NVDA geography') as HTMLSelectElement).value).toBe('us')
    expect(screen.getByText(`Reviewed ${formatDate(stock.reviewed_at)}`)).toBeTruthy()
    // A stock's industry is editable in place.
    expect((screen.getByLabelText('NVDA industry') as HTMLInputElement).value).toBe('Semis')
    // The search box shares the chips' row and narrows the list.
    fireEvent.change(screen.getByLabelText('Find a security'), { target: { value: 'fund' } })
    expect(screen.queryByLabelText('NVDA asset class')).toBeNull()
    expect(screen.getByLabelText('FUND asset class')).toBeTruthy()
  })

  it('says the work is done when nothing is unclassified, and opens on All', () => {
    render(<ClassificationEditor classifications={[stock]} onChanged={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^All/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /^Unclassified/ }))
    expect(screen.getByText('All securities have an asset class.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show all securities' }))
    expect(screen.getByLabelText('NVDA asset class')).toBeTruthy()
  })

  it('keeps a failed pick inline on its row and reverts the select', async () => {
    vi.mocked(saveClassification).mockRejectedValue(new Error('Connection interrupted'))
    render(<ClassificationEditor classifications={[fund]} onChanged={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('FUND asset class'), { target: { value: 'bonds' } })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Connection interrupted')
    expect(alert.closest('tr')).toBe(screen.getByLabelText('FUND asset class').closest('tr'))
    expect((screen.getByLabelText('FUND asset class') as HTMLSelectElement).value).toBe('')
  })

  it('saves a note on blur and an industry on Enter, each carrying the row as typed', async () => {
    vi.mocked(saveClassification).mockResolvedValue({ data: stock, headers: new Headers() })
    render(<ClassificationEditor classifications={[stock]} onChanged={vi.fn()} />)
    const note = screen.getByLabelText('NVDA note')
    fireEvent.change(note, { target: { value: 'fact sheet' } })
    fireEvent.blur(note)
    await waitFor(() => expect(saveClassification).toHaveBeenCalledWith(3, { asset_class: 'equity', industry: 'Semis', geography: 'us', note: 'fact sheet' }))
    const industry = screen.getByLabelText('NVDA industry')
    fireEvent.change(industry, { target: { value: 'Semiconductors' } })
    fireEvent.keyDown(industry, { key: 'Enter' })
    await waitFor(() => expect(saveClassification).toHaveBeenLastCalledWith(3, { asset_class: 'equity', industry: 'Semiconductors', geography: 'us', note: 'fact sheet' }))
    // An unchanged blur is not a request.
    fireEvent.blur(industry)
    expect(saveClassification).toHaveBeenCalledTimes(2)
  })

  it('focusUnclassified() pins the Unclassified chip, scrolls the card in and focuses the first select', () => {
    // jsdom implements no scrollIntoView (PortfolioPage.test.tsx's idiom).
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true })
    try {
      const handle = createRef<ClassificationEditorHandle>()
      render(<ClassificationEditor ref={handle} classifications={[fund, stock]} onChanged={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /^All/ }))
      fireEvent.change(screen.getByLabelText('Find a security'), { target: { value: 'nvda' } })
      act(() => handle.current?.focusUnclassified())
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
      expect(screen.getByRole('button', { name: /^Unclassified/ }).getAttribute('aria-pressed')).toBe('true')
      expect((screen.getByLabelText('Find a security') as HTMLInputElement).value).toBe('')
      expect(document.activeElement).toBe(screen.getByLabelText('FUND asset class'))
      expect(document.getElementById('security-classifications')).toBe(screen.getByRole('region', { name: 'Security classifications' }))
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })
})
```

- [ ] **Step 3: Run to see them fail**

```bash
npx vitest run src/components/portfolio/classificationRows.test.ts src/components/portfolio/ClassificationEditor.test.tsx
```
Expected: FAIL — `./classificationRows` not found; the editor renders a `<details>`.

- [ ] **Step 4: The helpers** — create `src/components/portfolio/classificationRows.ts`:

```ts
import type { SecurityClassification } from '../../api/allocation'

/** The Security classifications card's three chips (2026-09-13 polish §13). */
export type ClassificationFilter = 'unclassified' | 'unreviewed' | 'all'

export const CLASSIFICATION_FILTERS: readonly { value: ClassificationFilter; label: string }[] = [
  { value: 'unclassified', label: 'Unclassified' },
  { value: 'unreviewed', label: 'Not reviewed' },
  { value: 'all', label: 'All' },
]

/** No asset class yet — the gap the Allocation donut draws as "Unclassified". */
export const isUnclassified = (row: SecurityClassification): boolean => row.asset_class === null
/** Never confirmed by a person; imports and price refreshes leave reviewed_at empty. */
export const isUnreviewed = (row: SecurityClassification): boolean => row.reviewed_at === null

/** Which chip a fresh card opens on: the work when there is any, otherwise the whole list. */
export function defaultClassificationFilter(rows: SecurityClassification[]): ClassificationFilter {
  return rows.some(isUnclassified) ? 'unclassified' : 'all'
}

export function filterClassificationRows(
  rows: SecurityClassification[], filter: ClassificationFilter, search: string,
): SecurityClassification[] {
  const needle = search.trim().toLowerCase()
  return rows.filter((row) => {
    const onChip = filter === 'all' || (filter === 'unclassified' ? isUnclassified(row) : isUnreviewed(row))
    return onChip && (needle === '' || `${row.ticker} ${row.name}`.toLowerCase().includes(needle))
  })
}

/** "12 of 37 securities have no asset class · 37 not yet reviewed" — the card's one-line brief. */
export function coverageSentence(rows: SecurityClassification[]): string {
  const total = rows.length
  if (total === 0) return 'No securities yet — they appear here once transactions are recorded.'
  const unclassified = rows.filter(isUnclassified).length
  const unreviewed = rows.filter(isUnreviewed).length
  const head = unclassified === 0
    ? total === 1 ? 'The security has an asset class' : `All ${total} securities have an asset class`
    : `${unclassified} of ${total} ${total === 1 ? 'security' : 'securities'} ${unclassified === 1 ? 'has' : 'have'} no asset class`
  const tail = unreviewed === 0 ? 'all reviewed' : `${unreviewed} not yet reviewed`
  return `${head} · ${tail}`
}

/** What an empty filtered table says instead of a headerless grid. */
export function emptyFilterSentence(filter: ClassificationFilter, search: string): string {
  if (search.trim() !== '') return `No securities match “${search.trim()}”.`
  if (filter === 'unclassified') return 'All securities have an asset class.'
  if (filter === 'unreviewed') return 'Every security has been reviewed.'
  return 'No securities yet.'
}
```

- [ ] **Step 5: The card** — replace `src/components/portfolio/ClassificationEditor.tsx` in full with:

```tsx
import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { KeyboardEvent, Ref } from 'react'
import { ASSET_CLASSES, GEOGRAPHIES, saveClassification, UNCLASSIFIED_LABEL } from '../../api/allocation'
import type { ClassificationInput, SecurityClassification } from '../../api/allocation'
import { errorDetail } from '../../api/client'
import { undoBatch } from '../../api/lifecycle'
import { formatDate } from '../../utils/format'
import Segmented from '../shell/Segmented'
import { useToast } from '../ToastProvider'
import {
  CLASSIFICATION_FILTERS, coverageSentence, defaultClassificationFilter, emptyFilterSentence,
  filterClassificationRows, isUnclassified, isUnreviewed,
} from './classificationRows'
import type { ClassificationFilter } from './classificationRows'
import './portfolio.css'
import './allocation.css'

/** What the Allocation card's "Classify these N holdings" action drives (2026-09-13 polish §13). */
export interface ClassificationEditorHandle {
  /** Scroll the card in, pin the Unclassified chip and put the caret on the first row's
   *  asset-class select. */
  focusUnclassified: () => void
}

/** The card's DOM id — the classify action's scroll target and an anchor deep links can use. */
export const CLASSIFICATION_CARD_ID = 'security-classifications'

// The Security classifications card (2026-09-13 polish §13; replaces the closed
// details.allocation-classifications accordion — A2/D6/W9). Always visible and opening on the
// work: a coverage sentence, filter chips + search on one row, a compact table whose selects
// PATCH on change through the same saveClassification + Undo toast the old Review form used.
export default function ClassificationEditor({ classifications, onChanged, ref }: {
  classifications: SecurityClassification[]
  onChanged: () => void
  /** React 19 ref-as-prop: AllocationPanel holds it to drive focusUnclassified(). */
  ref?: Ref<ClassificationEditorHandle>
}) {
  // null = "not chosen yet". The rows land AFTER the first render, so the default chip is derived
  // from them on every render rather than frozen by a useState initializer; a chip click or the
  // classify action pins an explicit choice.
  const [chosen, setChosen] = useState<ClassificationFilter | null>(null)
  const filter = chosen ?? defaultClassificationFilter(classifications)
  const [search, setSearch] = useState('')
  const [focusTick, setFocusTick] = useState(0)
  const rootRef = useRef<HTMLElement>(null)
  useImperativeHandle(ref, () => ({
    focusUnclassified() {
      setChosen('unclassified')
      setSearch('')
      // Optional call: jsdom has no scrollIntoView (HoldingDetailPanel's idiom). The card's
      // scroll-margin-top (allocation.css) keeps its top clear of the sticky tab strip.
      rootRef.current?.scrollIntoView?.({ block: 'start' })
      setFocusTick((tick) => tick + 1)
    },
  }), [])
  // The focus has to wait for the commit that renders the Unclassified rows — an effect keyed on
  // the tick IS that commit. DOM focus only; no state is written here (react-hooks v7).
  useEffect(() => {
    if (focusTick === 0) return
    rootRef.current
      ?.querySelector<HTMLSelectElement>('tbody select[data-field="asset_class"]')
      ?.focus({ preventScroll: true })
  }, [focusTick])
  const rows = filterClassificationRows(classifications, filter, search)
  const counts: Record<ClassificationFilter, number> = {
    unclassified: classifications.filter(isUnclassified).length,
    unreviewed: classifications.filter(isUnreviewed).length,
    all: classifications.length,
  }
  const showAll = () => { setChosen('all'); setSearch('') }
  return <section ref={rootRef} id={CLASSIFICATION_CARD_ID} className="card allocation-classifications" aria-label="Security classifications">
    <h2 className="eyebrow">Security classifications</h2>
    <p className="allocation-coverage-sentence">{coverageSentence(classifications)}</p>
    <p className="hint">Classifications apply to the security across all owners and survive price refreshes and imports. Fund industry stays unknown until constituent data is available.</p>
    <div className="classification-toolbar">
      <Segmented variant="chips" size="sm" ariaLabel="Classification filter"
        options={CLASSIFICATION_FILTERS.map((option) => ({ ...option, badge: counts[option.value] }))}
        value={filter} onChange={setChosen} />
      <input className="field-input classification-search" type="search" aria-label="Find a security" placeholder="Find a security"
        value={search} onChange={(event) => setSearch(event.target.value)} />
    </div>
    {rows.length === 0
      ? <p className="empty-note">
          {emptyFilterSentence(filter, search)}
          {(filter !== 'all' || search.trim() !== '') && <>{' '}<button type="button" className="button" onClick={showAll}>Show all securities</button></>}
        </p>
      : <div className="holdings-scroll"><table className="port-table classification-table">
          <thead><tr>
            <th scope="col">Security</th><th scope="col">Asset class</th><th scope="col">Geography</th>
            <th scope="col">Industry</th><th scope="col">Note</th><th scope="col">Source</th>
          </tr></thead>
          <tbody>{rows.map((row) => <ClassificationRow key={row.security_id} row={row} onChanged={onChanged} />)}</tbody>
        </table></div>}
  </section>
}

// One draft per row, reset only when THIS row's server values change (its own save landing, an
// undo) — an unrelated row's refetch never wipes what is being typed here.
const serverKey = (row: SecurityClassification) =>
  `${row.asset_class}|${row.geography}|${row.industry}|${row.note}|${row.reviewed_at}`
const draftOf = (row: SecurityClassification) => ({
  key: serverKey(row),
  asset_class: row.asset_class ?? '', geography: row.geography ?? '',
  industry: row.industry ?? '', note: row.note ?? '',
})

// The selects are optimistic: the pick shows at once, the PATCH follows, a failure reverts it
// beside an inline alert. The typed fields save on blur or Enter when they differ from the
// server. Nothing is disabled while saving — disabling a focused control drops the caret, and
// the classify path is a keyboard walk down this table — the row is aria-busy instead and a
// second edit waits for the first to land.
function ClassificationRow({ row, onChanged }: { row: SecurityClassification; onChanged: () => void }) {
  const [draft, setDraft] = useState(() => draftOf(row))
  // Adjust-during-render (the codebase's prop→state idiom): a new server row for this security
  // replaces the draft before anything paints.
  if (draft.key !== serverKey(row)) setDraft(draftOf(row))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  async function save(patch: Partial<ClassificationInput>) {
    setBusy(true)
    setError(null)
    // The body is the row as the USER sees it (draft + this change), so two quick edits to one
    // row cannot send the second PATCH with the first field's stale server value.
    const body: ClassificationInput = {
      asset_class: draft.asset_class || null, geography: draft.geography || null,
      industry: draft.industry.trim() || null, note: draft.note.trim() || null, ...patch,
    }
    try {
      const result = await saveClassification(row.security_id, body)
      const id = result.headers.get('X-Change-Batch')
      toast.success(`${row.ticker} classification saved`, id ? { action: { label: 'Undo', onAction: () => {
        void undoBatch(id).then(onChanged).catch((err) => toast.error(errorDetail(err)))
      } } } : undefined)
      onChanged()
    } catch (err) {
      setError(errorDetail(err))
      setDraft(draftOf(row)) // the pick did not land — the select goes back to the truth
    } finally {
      setBusy(false)
    }
  }
  const pick = (field: 'asset_class' | 'geography', value: string) => {
    if (busy) return
    setDraft((current) => ({ ...current, [field]: value }))
    void save({ [field]: value || null })
  }
  const saveText = (field: 'industry' | 'note') => {
    if (busy) return
    const next = draft[field].trim() || null
    if (next !== (row[field] ?? null)) void save({ [field]: next })
  }
  const saveOnEnter = (field: 'industry' | 'note') => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); saveText(field) }
  }
  return <tr className={isUnclassified(row) ? 'allocation-unknown' : undefined} aria-busy={busy || undefined}>
    <th scope="row">
      <span className="ticker">{row.ticker}</span>
      <span className="sub" title={row.name}>{row.name}</span>
      {error && <span role="alert" className="classification-row-error">{error}</span>}
    </th>
    <td><select className="field-input" data-field="asset_class" aria-label={`${row.ticker} asset class`} value={draft.asset_class}
      onChange={(event) => pick('asset_class', event.target.value)}>
      <option value="">{UNCLASSIFIED_LABEL}</option>
      {Object.entries(ASSET_CLASSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></td>
    <td><select className="field-input" data-field="geography" aria-label={`${row.ticker} geography`} value={draft.geography}
      onChange={(event) => pick('geography', event.target.value)}>
      <option value="">Not set</option>
      {Object.entries(GEOGRAPHIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></td>
    <td>{row.industry_available
      ? <input className="field-input" aria-label={`${row.ticker} industry`} value={draft.industry} maxLength={80} placeholder="Industry"
          onChange={(event) => setDraft((current) => ({ ...current, industry: event.target.value }))}
          onBlur={() => saveText('industry')} onKeyDown={saveOnEnter('industry')} />
      : <span className="sub">Fund holdings not loaded</span>}</td>
    <td><input className="field-input" aria-label={`${row.ticker} note`} value={draft.note} maxLength={500} placeholder="Add a note"
      onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
      onBlur={() => saveText('note')} onKeyDown={saveOnEnter('note')} /></td>
    {/* The raw server source rides the title; the cell says the one thing that matters (§14). */}
    <td className="classification-source" title={row.source}>
      {row.reviewed_at ? `Reviewed ${formatDate(row.reviewed_at)}` : 'Import · not reviewed'}
    </td>
  </tr>
}
```

- [ ] **Step 6: Stylesheet** — in `src/components/portfolio/allocation.css`:

- line 16 becomes `.allocation-target-form { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin: 12px 0; }`
- line 19 becomes `.allocation-add-target label { display: flex; flex-direction: column; gap: 5px; font-size: 0.85rem; }`
- line 23 becomes `.allocation-employer h3 { font-size: 0.92rem; margin: 8px 0 12px; }`
- delete the `.allocation-classifications > summary { … }` line (Task 5 left it) and the
  `.allocation-search { … }` line

and append at the end of the file:

```css
/* Security classifications card (2026-09-13 polish §13). scroll-margin-top keeps the card's top
   clear of the sticky tab strip when the classify action scrolls it in: --sticky-inset is what
   PageFrame measures onto .page-frame-body, and custom properties inherit down to here. */
.allocation-classifications { scroll-margin-top: calc(var(--sticky-inset, 0px) + 12px); }
.allocation-coverage-sentence { margin: 0 0 6px; font-size: 0.95rem; }
.classification-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin: 8px 0 12px; }
.classification-search { max-width: 26ch; }
/* Compact rows: ticker over name in the row header, boxes sized to their words, a saving row
   dimmed rather than disabled (a disabled control drops the caret). */
.classification-table th[scope='row'] { white-space: normal; }
.classification-table th[scope='row'] .ticker { display: block; font-weight: 600; }
.classification-table th[scope='row'] .sub { display: block; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.classification-table .field-input { min-width: 11ch; }
.classification-table select.field-input { max-width: 22ch; }
.classification-table tr[aria-busy='true'] { opacity: 0.6; }
.classification-row-error { display: block; margin-top: 4px; color: var(--negative); font-size: 0.78rem; white-space: normal; }
.classification-source { color: var(--muted); font-size: 12px; }
```

- [ ] **Step 7: Retire the old Review-form test** — in
`src/components/portfolio/allocationExperience.test.tsx` delete the test
`'reviews a fund without pretending its wrapper is an industry'` (lines 63–78) and trim the
imports so nothing is unused:

```tsx
import { allocationLabel, displayLabel, saveAllocationTargets } from '../../api/allocation'
import type { AllocationData } from '../../api/allocation'
import AllocationTargetEditor from './AllocationTargetEditor'
import { exposureCsv, exposureOption } from './allocationChartOptions'
```
(the `vi.mock` factory may keep `saveClassification: vi.fn()`; nothing imports it from the test now).

- [ ] **Step 8: Run the tests and the gates**

```bash
npx vitest run src/components/portfolio && npx tsc -b && npx eslint src/components/portfolio
```
Expected: PASS (both new files + allocationExperience), tsc silent, eslint clean (no
`only-export-components` warning: `CLASSIFICATION_CARD_ID` is a constant export, which the rule
allows via `allowConstantExport`; the interface is a type).

- [ ] **Step 9: Commit**

```bash
git add src/components/portfolio/classificationRows.ts src/components/portfolio/classificationRows.test.ts src/components/portfolio/ClassificationEditor.tsx src/components/portfolio/ClassificationEditor.test.tsx src/components/portfolio/allocation.css src/components/portfolio/allocationExperience.test.tsx
git commit -m "feat(allocation): Security classifications card — filter chips, inline PATCHing selects with Undo, focusUnclassified() handle"
```

---

## Task 7 — Targets: no Unclassified row or option, a classify hint with the shared action

`TargetForm` stops seeding `__unknown__` and stops offering it in Add category; when the priced
book has unclassified value it says so and offers the same Classify action (callback prop).
Activate stays enabled (drift stays honest — Unclassified remains a slice). `ClassifyButton`
is born here so the ranked row, the slice detail and this form spell the verb identically.

**Files:**
- Create: `src/components/portfolio/ClassifyButton.tsx`
- Modify: `src/components/portfolio/AllocationTargetEditor.tsx:2` (imports), `:17-19` (props), `:32-33` (TargetForm mount), `:38` (drift label), `:49-57` (TargetForm signature + seeding), `:84` (hint), `:98-102` (Add category)
- Modify: `src/components/portfolio/allocation.css` (one rule appended)
- Test: `src/components/portfolio/allocationExperience.test.tsx:30-61` (the two target tests are rewritten)

- [ ] **Step 1: Rewrite the target tests to the new contract** — in
`src/components/portfolio/allocationExperience.test.tsx` replace the whole
`describe('allocation targets', …)` block (lines 30–61) with:

```tsx
describe('allocation targets', () => {
  it('seeds only classified categories, offers no Unclassified target, and points at the classify path', async () => {
    vi.mocked(saveAllocationTargets).mockResolvedValue({ data: {} as never, headers: new Headers() })
    const onChanged = vi.fn()
    const onClassify = vi.fn()
    render(<AllocationTargetEditor data={data} owner={7} onChanged={onChanged} onClassify={onClassify} unclassifiedCount={1} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set targets' }))
    // No __unknown__ row (spec §13): a gap to close, not a category to hold a weight.
    expect(screen.queryByLabelText('Unknown target percent')).toBeNull()
    expect(screen.queryByLabelText('Unclassified target percent')).toBeNull()
    const add = screen.getByRole('combobox') as HTMLSelectElement
    expect([...add.options].map((option) => option.textContent)).toEqual([
      'Choose a category', 'Bonds', 'Cash / cash equivalents', 'Real assets', 'Mixed', 'Other',
    ])
    // 300 of the 500 priced book has no classification — the form says so and hands over the verb.
    expect(screen.getByText(/Unclassified holdings are 60\.0% of the priced book — classify them first\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Classify these 1 holding' }))
    expect(onClassify).toHaveBeenCalledOnce()
    // Activation still needs exactly 100% — and stays available, drift stays honest.
    fireEvent.change(screen.getByLabelText('Equity target percent'), { target: { value: '60' } })
    expect((screen.getByRole('button', { name: 'Activate targets' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
    expect(saveAllocationTargets).toHaveBeenCalledWith('asset_class', 7, 'draft', [
      { key: 'equity', target_pct: '60', tolerance_pp: '0' },
    ])
  })

  it('keeps input after a failed activation and sends percentage-point tolerance explicitly', async () => {
    vi.mocked(saveAllocationTargets).mockRejectedValue(new Error('Connection interrupted'))
    render(<AllocationTargetEditor data={data} owner={7} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set targets' }))
    fireEvent.change(screen.getByLabelText('Equity target percent'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('Equity tolerance percentage points'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Activate targets' }))
    await screen.findByText('Connection interrupted')
    expect((screen.getByLabelText('Equity target percent') as HTMLInputElement).value).toBe('100')
    expect(saveAllocationTargets).toHaveBeenCalledWith('asset_class', 7, 'active', [
      { key: 'equity', target_pct: '100', tolerance_pp: '5' },
    ])
    // Without the callback the hint still states the share; only the action is absent.
    expect(screen.getByText(/Unclassified holdings are 60\.0%/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Classify these/ })).toBeNull()
  })

  it('labels a saved Unclassified drift row by the page word, not the wire word', () => {
    const drifted: AllocationData = { ...data, target_set: { id: 1, scope_key: 'person:7', dimension: 'asset_class', state: 'active', updated_at: '2026-09-01T00:00:00Z',
      targets: [{ key: 'equity', target_pct: '40', tolerance_pp: '5' }, { key: '__unknown__', target_pct: '60', tolerance_pp: '5' }] },
      drift: [
        { key: 'equity', label: 'Equity', market_value: '200.00', weight_pct: '0.4', target_pct: '40', tolerance_pp: '5', drift_pp: '0.00', drift_amount: '0.00', outside_tolerance: false, has_unpriced: false },
        { key: '__unknown__', label: 'Unknown', market_value: '300.00', weight_pct: '0.6', target_pct: '60', tolerance_pp: '5', drift_pp: '0.00', drift_amount: '0.00', outside_tolerance: false, has_unpriced: false },
      ] }
    render(<AllocationTargetEditor data={drifted} owner={7} onChanged={vi.fn()} />)
    expect(screen.getByRole('rowheader', { name: 'Unclassified' })).toBeTruthy()
    expect(screen.queryByRole('rowheader', { name: 'Unknown' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run to see them fail**

```bash
npx vitest run src/components/portfolio/allocationExperience.test.tsx
```
Expected: FAIL — an `Unknown target percent` box is still rendered; no classify hint.

- [ ] **Step 3: The shared button** — create `src/components/portfolio/ClassifyButton.tsx`:

```tsx
// The one verb that closes the "Unclassified" gap (2026-09-13 polish §13), spelled the same
// wherever it appears — the ranked row, the slice detail, the targets form. Primary by default;
// the targets form passes the quiet class because Save/Activate are that form's primaries.
export default function ClassifyButton({ count, onClick, className = 'button button-primary' }: {
  count: number
  onClick: () => void
  className?: string
}) {
  return (
    <button type="button" className={`${className} allocation-classify`} onClick={onClick}>
      Classify these {count} {count === 1 ? 'holding' : 'holdings'}
    </button>
  )
}
```

- [ ] **Step 4: The form** — in `src/components/portfolio/AllocationTargetEditor.tsx`:

Line 2 becomes:

```tsx
import { allocationLabel, ASSET_CLASSES, displayLabel, GEOGRAPHIES, saveAllocationTargets } from '../../api/allocation'
```
and add after line 8 (`import { useToast } …`): `import ClassifyButton from './ClassifyButton'`.

Lines 17–19 (the component signature) become:

```tsx
export default function AllocationTargetEditor({ data, owner, onChanged, onClassify, unclassifiedCount = 0 }: {
  data: AllocationData; owner: OwnerScope; onChanged: () => void
  /** The Security classifications card's focusUnclassified(), when the page has one. */
  onClassify?: () => void
  /** Members of the Unclassified slice — the N in "Classify these N holdings". */
  unclassifiedCount?: number
}) {
```
Lines 32–33 (the `TargetForm` mount) become:

```tsx
    {editing && <TargetForm key={`${data.by}:${data.scope_key}:${saved?.updated_at ?? ''}`}
      data={data} owner={owner} onSaved={() => { onChanged(); setEditing(false) }} onClassify={onClassify} unclassifiedCount={unclassifiedCount} />}
```
Line 38's drift row header `<th scope="row">{row.label}</th>` becomes
`<th scope="row">{displayLabel(row.key, row.label)}</th>`.

Lines 49–57 (the `TargetForm` signature and the rows initializer) become:

```tsx
function TargetForm({ data, owner, onSaved, onClassify, unclassifiedCount }: {
  data: AllocationData; owner: OwnerScope; onSaved: () => void; onClassify?: () => void; unclassifiedCount: number
}) {
  const saved = data.draft_target_set ?? data.target_set
  const [rows, setRows] = useState<AllocationTarget[]>(() => {
    const initial = [...(saved?.targets ?? [])]
    // Unclassified is never SEEDED (spec §13): it is a gap to close, not a category to hold a
    // weight. A row a user saved earlier is theirs to keep or Remove.
    for (const slice of data.slices) if (!slice.is_unknown && !initial.some((row) => row.key === slice.key)) {
      initial.push({ key: slice.key, target_pct: '0', tolerance_pp: '0' })
    }
    return initial
  })
  // The share of the priced book with no classification — from the coverage figures, so it is
  // right whether or not an Unclassified slice is in the list.
  const unknownShare = Number(data.coverage.unknown_market_value) > 0 && Number(data.total_market_value) > 0
    ? Number(data.coverage.unknown_market_value) / Number(data.total_market_value)
    : null
```
After the form's first hint paragraph (line 84, `<p className="hint">Save an unfinished draft …</p>`) add:

```tsx
    {unknownShare !== null && <p className="hint allocation-classify-hint">
      <span>Unclassified holdings are {formatPct(unknownShare, { signed: false })} of the priced book — classify them first.</span>
      {onClassify && unclassifiedCount > 0 && <ClassifyButton count={unclassifiedCount} onClick={onClassify} className="button" />}
    </p>}
```
Lines 98–102 (the Add category select) lose the Unknown entry:

```tsx
      <label>Add category {choices ? <select className="field-input" value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="">Choose a category</option>
        {Object.entries(choices).filter(([key]) => !rows.some((r) => r.key === key))
          .map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select> : <input className="field-input" value={category} maxLength={100} onChange={(e) => setCategory(e.target.value)} />}</label>
```

Append to `src/components/portfolio/allocation.css`:

```css
/* "Unclassified holdings are 60.0% of the priced book — classify them first" beside its action. */
.allocation-classify-hint { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.allocation-classify { white-space: nowrap; }
```

- [ ] **Step 5: Run the tests and the gates**

```bash
npx vitest run src/components/portfolio && npx tsc -b && npx eslint src/components/portfolio
```
Expected: PASS, tsc silent (no unused `UNKNOWN_CLASSIFICATION` import), eslint clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/portfolio/ClassifyButton.tsx src/components/portfolio/AllocationTargetEditor.tsx src/components/portfolio/allocation.css src/components/portfolio/allocationExperience.test.tsx
git commit -m "feat(allocation): targets never seed or offer Unclassified; the form names the unclassified share and hands over the classify action"
```

---

## Task 8 — One allocation card: the ranked table as the donut's aside, and the classify path wired

`.allocation-overview-grid` + `section.allocation-ranked` (the stretched twin, W1) become the
donut `ChartCard` with `aside` = coverage line · priced-book line · ranked table · warnings ·
Missing-quotes `Disclosure`. The Unclassified row and the Unclassified slice's detail carry
`ClassifyButton`, which drives the classifications card's `focusUnclassified()`. Card order:
toolbar → allocation card → Security classifications → targets → employer.

**Files:**
- Rewrite: `src/components/portfolio/AllocationPanel.tsx`
- Rewrite: `src/components/portfolio/allocation.css` (full final listing)
- Create: `src/components/portfolio/AllocationPanel.test.tsx`

- [ ] **Step 1: Write the failing tests** — create `src/components/portfolio/AllocationPanel.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAllocationData, fetchClassifications, fetchEmployerExposure } from '../../api/allocation'
import type { AllocationData, AllocationMember, EmployerExposure, SecurityClassification } from '../../api/allocation'
import { expectInDocumentOrder } from '../../testing/domOrder'
import AllocationPanel from './AllocationPanel'

vi.mock('../../api/allocation', async (original) => ({
  ...await original<typeof import('../../api/allocation')>(),
  fetchAllocationData: vi.fn(), fetchClassifications: vi.fn(), fetchEmployerExposure: vi.fn(), saveClassification: vi.fn(),
}))
// echarts is never rendered in jsdom (house law); the marker exposes the slice NAMES the donut draws.
vi.mock('../EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ option, ariaLabel }: { option: { series?: { data?: { name: string }[] }[] }; ariaLabel?: string }) =>
      createElement('div', { 'data-testid': 'echart', 'aria-label': ariaLabel, 'data-names': (option.series?.[0]?.data ?? []).map((d) => d.name).join('|') }),
  }
})

const member = (ticker: string, id: number): AllocationMember => ({
  security_id: id, ticker, name: `${ticker} fund`, account: null, shares: '10', market_value: '150.00',
  quoted_at: '2026-09-10T00:00:00Z', classification_source: 'Existing security records', classification_reviewed_at: null,
})
const DATA: AllocationData = {
  by: 'asset_class', scope_key: 'household', total_market_value: '500.00', as_of: '2026-09-10T00:00:00Z',
  latest_quote_at: '2026-09-10T00:00:00Z', source_href: '/portfolio?section=holdings',
  slices: [
    { key: 'equity', label: 'Equity', market_value: '200.00', weight_pct: '0.4', holdings: 1, is_unknown: false, members: [member('NVDA', 1)] },
    { key: '__unknown__', label: 'Unknown', market_value: '300.00', weight_pct: '0.6', holdings: 2, is_unknown: true, members: [member('VFFSX', 2), member('FXAIX', 3)] },
  ],
  coverage: { holding_count: 3, priced_count: 3, unpriced_count: 0, classified_count: 1, classified_market_value: '200.00',
    unknown_market_value: '300.00', classified_weight_pct: '0.4', unpriced_holdings: [], warnings: [] },
  target_set: null, draft_target_set: null, drift: [],
}
const row = (id: number, ticker: string, over: Partial<SecurityClassification> = {}): SecurityClassification => ({
  security_id: id, ticker, name: `${ticker} fund`, holding_type: 'mutual_fund', asset_class: null, industry: null, geography: null,
  source: 'Existing security records', note: null, reviewed_at: null, industry_available: false, ...over,
})
const ROWS = [row(2, 'VFFSX'), row(3, 'FXAIX'), row(1, 'NVDA', { holding_type: 'stock', asset_class: 'equity', geography: 'us', industry: 'Semis', reviewed_at: '2026-09-01T00:00:00Z', industry_available: true })]
const EMPLOYER: EmployerExposure = { ticker: null, scope_key: 'household', as_of: '2026-09-10', quoted_at: null, held_shares: '0', held_value: null,
  held_weight_pct: null, priced_portfolio_value: '500.00', unvested_shares: 0, unvested_value: null, unvested_scope: 'primary', warnings: [] }

beforeEach(() => {
  vi.mocked(fetchAllocationData).mockResolvedValue(DATA)
  vi.mocked(fetchClassifications).mockResolvedValue(ROWS)
  vi.mocked(fetchEmployerExposure).mockResolvedValue(EMPLOYER)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

const renderPanel = () => render(<MemoryRouter><AllocationPanel holdings={[]} onSelectTicker={vi.fn()} /></MemoryRouter>)

describe('AllocationPanel — one card', () => {
  it('renders the donut with the coverage line and the ranked table as its aside, spelling Unclassified', async () => {
    const { container } = renderPanel()
    await screen.findByLabelText('Portfolio allocation by asset class')
    expect(container.querySelector('.allocation-overview-grid')).toBeNull()
    expect(container.querySelector('.allocation-ranked')).toBeNull()
    const card = screen.getByLabelText('Portfolio allocation by asset class').closest('.chart-card') as HTMLElement
    const aside = card.querySelector('.allocation-aside') as HTMLElement
    expect(aside).not.toBeNull()
    expect(aside.querySelector('.allocation-coverage-line')?.textContent).toBe('3 of 3 holdings priced · 40.0% of priced value classified')
    expect([...aside.querySelectorAll('.allocation-ranked-table tbody th button')].map((b) => b.textContent)).toEqual(['Equity', 'Unclassified'])
    expect(screen.getByTestId('echart').getAttribute('data-names')).toBe('Equity|Unclassified')
    // The coverage-count caveat belongs to books with unpriced holdings only (§14, C5).
    expect(screen.queryByText(/Missing-price value cannot be estimated/)).toBeNull()
    expect(screen.queryByText('Missing quotes (0)')).toBeNull()
  })

  it('shows the Missing-quotes disclosure and the caveat only when holdings are unpriced', async () => {
    vi.mocked(fetchAllocationData).mockResolvedValue({ ...DATA, coverage: { ...DATA.coverage, holding_count: 4, unpriced_count: 1,
      unpriced_holdings: [{ ...member('GAP', 9), market_value: null, quoted_at: null }] } })
    renderPanel()
    await screen.findByLabelText('Portfolio allocation by asset class')
    expect(screen.getByText(/Missing-price value cannot be estimated/)).toBeTruthy()
    expect(screen.getByText('Missing quotes (1)').closest('details.disclosure')).not.toBeNull()
  })

  it('orders the cards allocation → Security classifications → targets', async () => {
    renderPanel()
    await screen.findByLabelText('Portfolio allocation by asset class')
    expectInDocumentOrder(
      screen.getByLabelText('Portfolio allocation by asset class').closest('.chart-card') as HTMLElement,
      screen.getByRole('region', { name: 'Security classifications' }),
      screen.getByRole('region', { name: 'Allocation targets' }),
    )
  })

  it('the Unclassified row offers "Classify these 2 holdings"; the click pins the chip, scrolls the card in and focuses a select', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true })
    try {
      renderPanel()
      const classify = await screen.findByRole('button', { name: 'Classify these 2 holdings' })
      await screen.findByLabelText('VFFSX asset class')
      // Scoped to the chip group: the ranked table's own "Unclassified" category button would
      // otherwise match the same prefix.
      const chips = within(screen.getByRole('group', { name: 'Classification filter' }))
      fireEvent.click(chips.getByRole('button', { name: /^All/ }))
      expect(screen.getByLabelText('NVDA asset class')).toBeTruthy()
      fireEvent.click(classify)
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
      expect(chips.getByRole('button', { name: /^Unclassified/ }).getAttribute('aria-pressed')).toBe('true')
      expect(screen.queryByLabelText('NVDA asset class')).toBeNull()
      expect(document.activeElement).toBe(screen.getByLabelText('VFFSX asset class'))
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('selecting the Unclassified slice puts the classify action ahead of the Open buttons', async () => {
    renderPanel()
    await screen.findByLabelText('Portfolio allocation by asset class')
    fireEvent.click(screen.getByRole('button', { name: 'Unclassified' }))
    const detail = document.querySelector('.chart-inline-selection') as HTMLElement
    expect(detail).not.toBeNull()
    expect(screen.getByRole('article', { name: 'Unclassified selected values' })).toBeTruthy()
    const labels = [...detail.querySelectorAll('button')].map((b) => b.textContent)
    expect(labels.indexOf('Classify these 2 holdings')).toBeGreaterThan(-1)
    expect(labels.indexOf('Classify these 2 holdings')).toBeLessThan(labels.indexOf('Open VFFSX'))
    expect(labels).toContain('Open FXAIX')
  })

  it('an Equity selection carries no classify action', async () => {
    renderPanel()
    await screen.findByLabelText('Portfolio allocation by asset class')
    fireEvent.click(screen.getByRole('button', { name: 'Equity' }))
    const detail = document.querySelector('.chart-inline-selection') as HTMLElement
    expect(detail.textContent).not.toContain('Classify these')
    expect(detail.textContent).toContain('Open NVDA')
  })
})
```

- [ ] **Step 2: Run to see them fail**

```bash
npx vitest run src/components/portfolio/AllocationPanel.test.tsx
```
Expected: FAIL — `.allocation-overview-grid` still rendered; no `Classify these 2 holdings` button.

- [ ] **Step 3: The panel** — replace `src/components/portfolio/AllocationPanel.tsx` in full with:

```tsx
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  ALLOCATION_DIMENSIONS, displayLabel, fetchAllocationData, fetchClassifications, fetchEmployerExposure, UNCLASSIFIED_LABEL,
} from '../../api/allocation'
import type { AllocationData, AllocationDimension, EmployerExposure, ExposureSlice, SecurityClassification } from '../../api/allocation'
import type { OwnerScope } from '../../api/netWorth'
import { errorDetail } from '../../api/client'
import type { AllocationResponse, HoldingOut } from '../../types/api'
import type { ChartSelection } from '../../types/metrics'
import { formatCurrency, formatDate, formatPct, formatShares } from '../../utils/format'
import ChartCard from '../ChartCard'
import Disclosure from '../Disclosure'
import Segmented from '../shell/Segmented'
import SelectionDetail from '../details/SelectionDetail'
import AllocationTargetEditor from './AllocationTargetEditor'
import ClassificationEditor from './ClassificationEditor'
import type { ClassificationEditorHandle } from './ClassificationEditor'
import ClassifyButton from './ClassifyButton'
import { exposureCsv, exposureOption } from './allocationChartOptions'
import { ownerScopeLabel } from './ownerScopeLabel'
import './portfolio.css'
import './allocation.css'

interface Props {
  holdings: HoldingOut[]
  byType?: AllocationResponse | null
  byAccount?: AllocationResponse | null
  owner?: OwnerScope
  refreshKey?: number
  onSelectTicker: (ticker: string) => void
}

// The Allocation view (2026-09-13 polish §12–13): ONE allocation card (donut + ranked aside),
// then the Security classifications card, then targets, then employer equity. Every
// "Classify these N holdings" button on the view drives the classifications card's handle.
export default function AllocationPanel({ holdings, owner = null, refreshKey = 0, onSelectTicker }: Props) {
  const [dimension, setDimension] = useState<AllocationDimension>('asset_class')
  const [reload, setReload] = useState(0)
  const [result, setResult] = useState<{ key: string; data: AllocationData } | null>(null)
  const [classificationRows, setClassificationRows] = useState<SecurityClassification[]>([])
  const [employer, setEmployer] = useState<{ owner: OwnerScope; data: EmployerExposure } | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const [classificationError, setClassificationError] = useState<string | null>(null)
  const [employerError, setEmployerError] = useState<{ owner: OwnerScope; message: string } | null>(null)
  const [selection, setSelection] = useState<ChartSelection | null>(null)
  const classificationsCard = useRef<ClassificationEditorHandle>(null)
  const dataKey = `${owner ?? 'household'}:${dimension}`
  const scopeLabel = ownerScopeLabel(owner)
  const holdingsRevision = holdings.map((h) => `${h.security_id}:${h.shares}:${h.price}:${h.quoted_at}`).join('|')
  useEffect(() => {
    let cancelled = false
    void fetchAllocationData(dimension, owner).then((data) => {
      if (!cancelled) { setResult({ key: dataKey, data }); setFailure(null) }
    }).catch((err) => { if (!cancelled) setFailure({ key: dataKey, message: errorDetail(err) }) })
    return () => { cancelled = true }
  }, [dimension, owner, dataKey, reload, refreshKey, holdingsRevision])
  useEffect(() => {
    let cancelled = false
    void fetchClassifications().then((rows) => {
      if (!cancelled) { setClassificationRows(rows); setClassificationError(null) }
    }).catch((err) => { if (!cancelled) setClassificationError(errorDetail(err)) })
    return () => { cancelled = true }
  }, [reload, refreshKey, holdingsRevision])
  useEffect(() => {
    let cancelled = false
    void fetchEmployerExposure(owner).then((data) => {
      if (!cancelled) { setEmployer({ owner, data }); setEmployerError(null) }
    }).catch((err) => { if (!cancelled) setEmployerError({ owner, message: errorDetail(err) }) })
    return () => { cancelled = true }
  }, [owner, reload, refreshKey, holdingsRevision])

  const data = result?.key === dataKey ? result.data : null
  const error = failure?.key === dataKey ? failure.message : null
  const option = useMemo(() => data ? exposureOption(data) : null, [data])
  const refresh = () => setReload((value) => value + 1)
  const classify = () => classificationsCard.current?.focusUnclassified()
  const unknownSlice = data?.slices.find((slice) => slice.is_unknown) ?? null
  const scopedSource = () => `/portfolio?section=holdings${owner === null ? '' : `&owner=${owner}`}`
  const sliceSelection = (slice: ExposureSlice): ChartSelection => ({
    kind: 'entity', id: `${dataKey}:${slice.key}`, label: displayLabel(slice.key, slice.label), entityType: 'allocation', entityId: slice.key,
    scope: scopeLabel, values: [
      { label: 'Priced market value', value: slice.market_value, unit: 'USD' },
      { label: 'Share of priced holdings', value: slice.weight_pct, unit: 'ratio' },
      { label: 'Holdings', value: slice.holdings },
      { label: 'Oldest quote', value: data?.as_of ? formatDate(data.as_of) : null },
    ], source: { href: scopedSource(), label: 'Open holdings' },
    context: { dimension, owner, classification: slice.is_unknown ? UNCLASSIFIED_LABEL : 'Classified', pricedDenominator: data?.total_market_value ?? null },
  })
  return <div className="allocation-workspace">
    <div className="allocation-toolbar"><Segmented ariaLabel="Allocation dimension" variant="toggle" options={ALLOCATION_DIMENSIONS}
      value={dimension} onChange={(next) => { setSelection(null); setDimension(next) }} /></div>
    {error && <p className="error-banner" role="alert">Could not load allocation: {error}. <button className="button" onClick={refresh}>Retry</button></p>}
    {/* ONE card (W1): the ranked table is the donut's legend, riding the ChartCard aside, so
        there is no twin card to stretch to the canvas height. */}
    <ChartCard title={`Allocation by ${ALLOCATION_DIMENSIONS.find((d) => d.value === dimension)?.label.toLowerCase()}`}
      hint="Weights divide current priced value by the priced portfolio total. Unclassified holdings stay in the denominator. Select a category to inspect its holdings."
      ariaLabel={`Portfolio allocation by ${dimension.replace('_', ' ')}`} option={option}
      empty={data?.slices.some((s) => Number(s.market_value) < 0) ? 'Review negative positions in the table before using allocation weights.' : 'No priced holdings yet.'}
      exportName={`allocation-${dimension}`} csv={data ? () => exposureCsv(data) : undefined}
      height={330} busy={data === null && error === null} error={error}
      caption={data ? `${scopeLabel} · priced book ${formatCurrency(data.total_market_value)} · ${formatDate(data.as_of)}` : undefined}
      aside={data ? <AllocationAside data={data} onSelect={(slice) => setSelection(sliceSelection(slice))} onClassify={classify} onSelectTicker={onSelectTicker} /> : undefined}
      selection={selection} onSelectionChange={setSelection} selectionScopeKey={dataKey}
      selectionAdapter={(event) => {
        const key = (event as unknown as { data?: { allocationKey?: string } }).data?.allocationKey
        const slice = data?.slices.find((s) => s.key === key)
        return slice ? sliceSelection(slice) : null
      }} rowSelection={(_row, index) => data?.slices[index] ? sliceSelection(data.slices[index]) : null}
      renderSelection={(selected) => {
        const slice = data?.slices.find((s) => selected.kind === 'entity' && s.key === selected.entityId)
        return <><SelectionDetail selection={selected} chartTitle="Portfolio allocation" onClear={() => setSelection(null)} />
          {slice && <div className="allocation-members">
            {/* The classify action sits FIRST; the per-holding Open buttons stay (spec §13). */}
            {slice.is_unknown && slice.members.length > 0 && <ClassifyButton count={slice.members.length} onClick={classify} />}
            <h3>Holdings in this category</h3>
            {slice.members.map((member) => <div key={`${member.security_id}:${member.account}`} className="allocation-member">
              <button className="button" onClick={() => onSelectTicker(member.ticker)}>Open {member.ticker}</button>
              <span>{formatCurrency(member.market_value)}{member.account ? ` · ${member.account}` : ''}</span>
              <small>{member.classification_source} · {member.classification_reviewed_at ? `reviewed ${formatDate(member.classification_reviewed_at)}` : 'not reviewed'}</small>
            </div>)}
          </div>}
        </>
      }} />
    {classificationError && <p className="error-banner">Classification records unavailable: {classificationError} <button className="button" onClick={refresh}>Retry</button></p>}
    {/* Directly after the allocation card, before the targets (spec §13). */}
    <ClassificationEditor ref={classificationsCard} classifications={classificationRows} onChanged={refresh} />
    {data && <AllocationTargetEditor key={dataKey} data={data} owner={owner} onChanged={refresh}
      onClassify={classify} unclassifiedCount={unknownSlice?.members.length ?? 0} />}
    {employer?.owner === owner ? <EmployerPanel value={employer.data} onSelectTicker={onSelectTicker} /> : employerError?.owner === owner
      ? <p className="error-banner">Employer exposure unavailable: {employerError.message} <button className="button" onClick={refresh}>Retry</button></p> : null}
  </div>
}

// The donut's legend AND its table (spec §12 `aside`): coverage line, priced-book line, the
// ranked categories (each name a button that selects the slice), the coverage warnings and the
// Missing-quotes disclosure. The Unclassified row carries the classify action beneath it.
function AllocationAside({ data, onSelect, onClassify, onSelectTicker }: {
  data: AllocationData
  onSelect: (slice: ExposureSlice) => void
  onClassify: () => void
  onSelectTicker: (ticker: string) => void
}) {
  const { coverage } = data
  return <div className="allocation-aside">
    <p className="allocation-coverage-line">
      <b>{coverage.priced_count} of {coverage.holding_count}</b> holdings priced ·{' '}
      {coverage.classified_weight_pct === null
        ? 'classified share unavailable'
        : <><b>{formatPct(coverage.classified_weight_pct, { signed: false })}</b> of priced value classified</>}
    </p>
    {/* The coverage-count caveat only where there ARE unpriced holdings (§14, C5). */}
    <p className="hint">
      Priced book {formatCurrency(data.total_market_value)} · quotes {formatDate(data.as_of)}
      {data.latest_quote_at !== data.as_of ? ` – ${formatDate(data.latest_quote_at)}` : ''}.
      {coverage.unpriced_count > 0 ? ' Missing-price value cannot be estimated from coverage counts.' : ''}
    </p>
    <table className="port-table allocation-ranked-table">
      <thead><tr><th scope="col">Category</th><th scope="col" className="num">Value</th><th scope="col" className="num">Weight</th></tr></thead>
      <tbody>{data.slices.map((slice, index) => <Fragment key={slice.key}>
        <tr className={slice.is_unknown ? 'allocation-unknown' : undefined}>
          <th scope="row"><button type="button" className="allocation-category-button" onClick={() => onSelect(slice)}>
            <span className="allocation-category-swatch" aria-hidden="true"
              style={{ backgroundColor: slice.is_unknown ? 'var(--other-series)' : `var(--chart-${index % 8 + 1})` }} />
            {displayLabel(slice.key, slice.label)}
          </button></th>
          <td className="num">{formatCurrency(slice.market_value)}</td>
          <td className="num">{formatPct(slice.weight_pct, { signed: false })}</td>
        </tr>
        {slice.is_unknown && slice.members.length > 0 && <tr className="allocation-unknown allocation-classify-row">
          <td colSpan={3}><ClassifyButton count={slice.members.length} onClick={onClassify} /></td>
        </tr>}
      </Fragment>)}</tbody>
    </table>
    {coverage.warnings.map((warning) => <p className="hint" key={warning}>{warning}</p>)}
    {coverage.unpriced_holdings.length > 0 && <Disclosure summary={`Missing quotes (${coverage.unpriced_count})`} className="allocation-missing-quotes">
      {coverage.unpriced_holdings.map((h) => <p key={`${h.security_id}:${h.account}`}>
        <button type="button" className="button" onClick={() => onSelectTicker(h.ticker)}>{h.ticker}</button> · {formatShares(h.shares)} shares · value unavailable
      </p>)}
    </Disclosure>}
  </div>
}

function EmployerPanel({ value, onSelectTicker }: { value: EmployerExposure; onSelectTicker: (ticker: string) => void }) {
  return <section className="card allocation-employer" aria-label="Employer equity exposure">
    <h2 className="eyebrow">Employer equity · {value.ticker ?? 'Not configured'}</h2>
    <div className="allocation-employer-grid">
      <div><h3>Shares you hold</h3><strong>{formatCurrency(value.held_value)}</strong>
        <p>{formatShares(value.held_shares)} shares · {formatPct(value.held_weight_pct, { signed: false })} of the selected priced portfolio</p>
        {value.ticker && <button className="button" onClick={() => onSelectTicker(value.ticker!)}>Open Portfolio position</button>}
        <p className="hint">Source: Portfolio positions · selected owner scope</p>
      </div>
      <div><h3>Unvested awards</h3><strong>{formatCurrency(value.unvested_value)}</strong>
        <p>{formatShares(value.unvested_shares)} shares · {value.unvested_scope}</p>
        <a href="/comp?section=vesting">Open Comp vesting schedule</a>
        <p className="hint">Not included in allocation weights or added to net worth here.</p>
      </div>
    </div>
    <p className="hint">As of {formatDate(value.as_of)} · quote {formatDate(value.quoted_at)}. Held shares come from Portfolio; the separate ESPP lot ledger is not added.</p>
    {value.warnings.map((warning) => <p key={warning} className="hint">{warning}</p>)}
  </section>
}
```
(If Task 0 found `Disclosure` is a named export, the import is `import { Disclosure } from '../Disclosure'`.)

- [ ] **Step 4: The stylesheet, final** — replace `src/components/portfolio/allocation.css` in full with:

```css
/* Allocation view (AllocationPanel, ClassificationEditor, AllocationTargetEditor). Imported by
   those components; nothing here depends on PortfolioPage.css. The inline-size container stays
   for the ChartCard aside's own container query (panels.css .chart-card-with-aside). */
.allocation-workspace { display: grid; gap: 16px; container-type: inline-size; }
.allocation-toolbar { display: flex; flex-wrap: wrap; gap: 12px; }

/* ONE card (2026-09-13 polish §12–13, W1): the ranked table rides the donut ChartCard's `aside`,
   so there is no twin card to stretch to the canvas height. */
.allocation-aside { display: grid; gap: 8px; align-content: start; font-size: 0.85rem; }
.allocation-coverage-line { margin: 0; color: var(--muted); }
.allocation-coverage-line b { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }
.allocation-aside .hint { margin: 0; }
.allocation-ranked-table th:first-child { white-space: normal; }
.allocation-category-button { display: inline-flex; align-items: center; gap: 8px; background: transparent; color: var(--text); border: 0; font: inherit; padding: 5px 0; cursor: pointer; text-align: left; }
.allocation-category-swatch { width: 9px; height: 9px; border-radius: 2px; flex: none; }
.allocation-category-button:hover { text-decoration: underline; }
.allocation-category-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 3px; }
.allocation-unknown { background: var(--surface-2); }
/* The classify action: its own full-width row under Unclassified, and first in the slice detail. */
.allocation-classify-row td { padding-top: 0; padding-bottom: 10px; }
.allocation-classify { white-space: nowrap; }
.allocation-members > .allocation-classify { margin: 4px 0 8px; }

/* Targets. */
.allocation-target-form { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin: 12px 0; }
.allocation-target-form .field-input { max-width: 15ch; }
.allocation-add-target { display: flex; align-items: end; gap: 8px; margin-top: 12px; }
.allocation-add-target label { display: flex; flex-direction: column; gap: 5px; font-size: 0.85rem; }
.allocation-add-target .field-input { max-width: 32ch; }
/* "Unclassified holdings are 60.0% of the priced book — classify them first" beside its action. */
.allocation-classify-hint { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }

/* Employer equity. */
.allocation-employer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.allocation-employer-grid > div + div { border-left: 1px solid var(--border); padding-left: 24px; }
.allocation-employer h3 { font-size: 0.92rem; margin: 8px 0 12px; }
.allocation-employer strong { font-size: 1.35rem; font-variant-numeric: tabular-nums; }
.allocation-employer p { font-size: 0.85rem; }

/* Slice detail members. */
.allocation-member { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 8px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.allocation-member small { grid-column: 1 / -1; color: var(--muted); }

/* Security classifications card (2026-09-13 polish §13). scroll-margin-top keeps the card's top
   clear of the sticky tab strip when the classify action scrolls it in: --sticky-inset is what
   PageFrame measures onto .page-frame-body, and custom properties inherit down to here. */
.allocation-classifications { scroll-margin-top: calc(var(--sticky-inset, 0px) + 12px); }
.allocation-coverage-sentence { margin: 0 0 6px; font-size: 0.95rem; }
.classification-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin: 8px 0 12px; }
.classification-search { max-width: 26ch; }
/* Compact rows: ticker over name in the row header, boxes sized to their words, a saving row
   dimmed rather than disabled (a disabled control drops the caret). */
.classification-table th[scope='row'] { white-space: normal; }
.classification-table th[scope='row'] .ticker { display: block; font-weight: 600; }
.classification-table th[scope='row'] .sub { display: block; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.classification-table .field-input { min-width: 11ch; }
.classification-table select.field-input { max-width: 22ch; }
.classification-table tr[aria-busy='true'] { opacity: 0.6; }
.classification-row-error { display: block; margin-top: 4px; color: var(--negative); font-size: 0.78rem; white-space: normal; }
.classification-source { color: var(--muted); font-size: 12px; }
```
Gone for good: `.allocation-overview-grid` (and its dead `> .chart-card` rule, W1), `.allocation-ranked`,
`.allocation-book-value`, `.allocation-coverage`, the `@container (max-width: 900px)` rule,
`.allocation-classification-form`, `.allocation-search`, both `> summary` rules and `.allocation-heat[open]`.

- [ ] **Step 5: Run the tests and the gates**

```bash
npx vitest run src/components/portfolio src/pages/PortfolioPage.test.tsx && npx tsc -b && npx eslint src/components/portfolio src/pages/PortfolioPage.tsx
```
Expected: PASS — including PortfolioPage's `'opens the allocation donut …'` and
`'renders the panels real empty notes …'`; tsc silent; eslint clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/portfolio/AllocationPanel.tsx src/components/portfolio/AllocationPanel.test.tsx src/components/portfolio/allocation.css
git commit -m "feat(allocation): one allocation card — ranked table and coverage as the donut aside, Missing quotes as a Disclosure, Classify these N holdings from the row and the slice detail"
```

---

## Task 9 — Transactions and Securities ledgers: `.holdings-scroll` + `useScrollEdges`

Both `.port-table`s already end in `td.row-actions`, so F2's sticky rule pins the actions the
moment the table lives in a scroller (spec §7). The hook toggles `data-scroll-more` on that
scroller so the edge fade appears only when there is more to the side.

**Files:**
- Modify: `src/components/portfolio/TransactionsPanel.tsx:1, 15, 453-…` (import, hook, wrapper)
- Modify: `src/components/portfolio/SecuritiesPanel.tsx:1, 11, 272-…` (import, hook, wrapper)
- Test: `src/components/portfolio/TransactionsPanel.test.tsx`, `src/components/portfolio/SecuritiesPanel.test.tsx` (one test each)

- [ ] **Step 1: Write the failing tests**

Append inside the top-level `describe` of `src/components/portfolio/TransactionsPanel.test.tsx`:

```tsx
  it('keeps the ledger in a .holdings-scroll scroller so the sticky row actions can pin (2026-09-13 polish §7)', () => {
    const { container } = render(<TransactionsPanel securities={securities} transactions={[importTxn]} onChanged={() => {}} />)
    const scroller = container.querySelector('.holdings-scroll') as HTMLElement
    expect(scroller).not.toBeNull()
    expect(scroller.querySelector('table.port-table')).not.toBeNull()
    expect(scroller.querySelector('td.row-actions')).not.toBeNull()
  })
```
Append inside `describe('SecuritiesPanel', …)` of `src/components/portfolio/SecuritiesPanel.test.tsx`:

```tsx
  it('keeps the ledger in a .holdings-scroll scroller so the sticky row actions can pin (2026-09-13 polish §7)', () => {
    const { container } = render(<SecuritiesPanel securities={[autoPriced, manualPriced]} onChanged={vi.fn()} />)
    const scroller = container.querySelector('.holdings-scroll') as HTMLElement
    expect(scroller).not.toBeNull()
    expect(scroller.querySelector('table.port-table')).not.toBeNull()
    expect(scroller.querySelector('td.row-actions')).not.toBeNull()
  })
```

- [ ] **Step 2: Run to see them fail**

```bash
npx vitest run src/components/portfolio/TransactionsPanel.test.tsx src/components/portfolio/SecuritiesPanel.test.tsx -t "holdings-scroll"
```
Expected: FAIL — no `.holdings-scroll` in either panel.

- [ ] **Step 3: Wrap and hook** — in BOTH `TransactionsPanel.tsx` and `SecuritiesPanel.tsx`:

- line 1: `import { useRef, useState } from 'react'`
- add before the `import './portfolio.css'` line: `import { useScrollEdges } from '../useScrollEdges'`
  (the default form if Task 0 said so)
- in the component body, after its last `useState` declaration:

```tsx
  // The ledger can outgrow a docked page (W10); the edge fade and the pinned actions column
  // (panels.css .row-actions rule) both read this scroller (2026-09-13 polish §7).
  const scrollRef = useRef<HTMLDivElement>(null)
  useScrollEdges(scrollRef)
```
- the table: `<table className="port-table">` (TransactionsPanel line 453, SecuritiesPanel line 272)
  becomes `<div className="holdings-scroll" ref={scrollRef}><table className="port-table">` and the
  matching `</table>` (the one that closes THAT table, just before the `)}` of the empty-note
  ternary) becomes `</table></div>`.

- [ ] **Step 4: Run the tests and the gates**

```bash
npx vitest run src/components/portfolio/TransactionsPanel.test.tsx src/components/portfolio/SecuritiesPanel.test.tsx src/pages/PortfolioPage.test.tsx && npx tsc -b && npx eslint src/components/portfolio
```
Expected: PASS, tsc silent, eslint clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/portfolio/TransactionsPanel.tsx src/components/portfolio/TransactionsPanel.test.tsx src/components/portfolio/SecuritiesPanel.tsx src/components/portfolio/SecuritiesPanel.test.tsx
git commit -m "feat(portfolio): Transactions and Securities ledgers scroll inside .holdings-scroll with useScrollEdges — sticky row actions under a dock"
```

---

## Task 10 — Net worth: tiles and owner lede on Overview only; "Accounts — {month}"

The `dl.networth-owner-strip` (orphan text, W4/T1) becomes the `lede` of the "By group over
time" ChartCard — "Edward **$806,708.50** · Joint **−$40.62**" in tabular figures — so it lives
with the chart it explains and no longer repeats on Accounts. The KPI row renders on Overview
only (spec §12). The Accounts card names the month it shows (§14, C2).

**Files:**
- Modify: `src/pages/NetWorthPage.tsx:2` (Fragment), `:56` (after `GROUP_TILE_HINT`), `:435-438` (`viewedLabel`), `:495` (after `noClosedQuarter`, the `ownerLede`), `:563-571` (skeleton), `:636` (tiles condition), `:687-712` (strip removed), `:742` (lede prop)
- Modify: `src/pages/NetWorthPage.css:3-22`
- Test: `src/pages/NetWorthPage.test.tsx:209-231, 631, 694-695` + new describe

- [ ] **Step 1: Rewrite the strip tests and add the failing view test**

In `src/pages/NetWorthPage.test.tsx` replace lines 209–231 (the two strip tests) with:

```tsx
it('renders the per-owner lede on the By-group card in chip order, skipping owners the payload lacks', async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Whose' })
  // Me then Joint — the fixture's owner_totals has no SAM row, and a missing owner is
  // SKIPPED, never rendered as $0.00. Order comes from the chips, so the two agree.
  const lede = document.querySelector('.chart-lede .networth-owner-lede') as HTMLElement
  expect(lede).not.toBeNull()
  expect(lede.textContent).toBe('Me $150.00 · Joint $80.00')
  expect([...lede.querySelectorAll('b.num')].map((b) => b.textContent)).toEqual(['$150.00', '$80.00'])
  // It sits INSIDE the By-group card, not loose on the page (2026-09-13 polish §10, W4).
  expect(lede.closest('.chart-card')?.querySelector('.eyebrow')?.textContent).toContain('By group over time')
  expect(document.querySelector('.networth-owner-strip')).toBeNull()
})

it('hides the owner lede for a one-person household', async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household({ people: [ME] }))
  renderPage()
  await screen.findByText('Net worth')
  await waitFor(() => expect(fetchHousehold).toHaveBeenCalled())
  expect(document.querySelector('.networth-owner-lede')).toBeNull()
})
```
Line 631: `expect(document.querySelector('.networth-owner-lede')).toBeNull()`.
Lines 694–695:

```tsx
    expect(screen.queryByText(/^Accounts — /)).toBeNull()
    expect(document.querySelector('.networth-owner-lede')).toBeNull()
```
Append at the end of the file:

```tsx
// ── Tiles per view (2026-09-13 polish §12) ───────────────────────────────────────────────
describe('NetWorthPage — tiles per view', () => {
  it('keeps the tiles and the owner lede to Overview, and names the month on the Accounts card', async () => {
    renderPage()
    await screen.findByText('Net worth — Aug 2026')
    expect(document.querySelector('.networth-owner-lede')).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Accounts' }))
    expect(screen.queryByText('Net worth — Aug 2026')).toBeNull()
    expect(document.querySelector('.loading-dim > .kpi-row')).toBeNull()
    // The card names the month it shows (C2) — "latest" is reserved for a book with no column.
    expect(screen.getByRole('heading', { name: /Accounts — Aug 2026/ })).toBeTruthy()
    expect(screen.queryByText(/Accounts — latest month/)).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(screen.getByText('Net worth — Aug 2026')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to see them fail**

```bash
npx vitest run src/pages/NetWorthPage.test.tsx -t "owner lede|tiles per view"
```
Expected: FAIL — no `.networth-owner-lede`; tiles still render on Accounts.

- [ ] **Step 3: The page** — in `src/pages/NetWorthPage.tsx`:

Line 2: `import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'`.

After line 56 (`const GROUP_TILE_HINT = …`) add:

```tsx
// The By-group card's owner lede is one .chart-lede line: 0.82rem × 1.5 line height (19.7px)
// plus its −0.25rem/0.6rem margins (5.6px) ≈ 25. Reserved here because skeletonMetrics'
// chartCardBox knows no lede and shared files belong to lane F2 (2026-09-13 polish §1).
const LEDE_ROW = 25
```
Lines 435–438 (`viewedLabel`) become:

```tsx
  // …so the card heading names the month it shows — the viewed month, or the latest column when
  // nothing is picked (2026-09-13 polish §14, C2) — never "latest" over a dated table.
  const viewedLabel =
    viewedIndex >= 0 && months[viewedIndex] !== undefined
      ? formatMonth(months[viewedIndex])
      : `latest ${granularity === 'quarterly' ? 'quarter' : 'month'}`
```
After the `noClosedQuarter` block (line ~495) add:

```tsx
  // D5's per-owner split of the viewed snapshot, now the lede of the By-group card (2026-09-13
  // polish §10, W4): it explains that chart, and Accounts already answers ownership row by row.
  // Ordered BY the chips (primary, others, Joint) so the two can never disagree; an owner with no
  // owner_totals row is SKIPPED, never a fabricated $0.00. Under a person scope the server narrows
  // owner_totals to that person + Joint, and the lede honestly narrows with it.
  const ownerLede =
    ownerScopes.length > 0 && summary !== null && summary.month && summary.owner_totals.length > 0
      ? ownerScopes
        .filter(({ ownerScope }) => ownerScope !== null)
        .flatMap(({ ownerScope, label }) => {
          const entry = summary.owner_totals.find((total) =>
            ownerScope === 'joint' ? total.person_id === null : total.person_id === ownerScope,
          )
          return entry === undefined ? [] : [{ label, total: entry.total }]
        })
      : []
```
Skeleton (lines 563–571): drop `strip: true,` and reserve the lede on the first card:

```tsx
        // cards: the three boxes the page really draws — the stacked chart (360, two Segmented
        // controls, zoomable, plus its owner lede line), the What-moved movers (a six-row plot
        // plus its lede line, one Segmented control) and the account drill-down (280, zoomable,
        // with a footer). The owner strip that used to sit between the tiles and the first chart
        // is that lede now, so there is no strip to ghost.
        skeleton={{
          tiles: 4,
          cards: [
            { span: 12, height: ghostCardBody(chartCardBox(360, { controls: true, zoomable: true }) + LEDE_ROW) },
            { span: 12, height: ghostCardBody(chartCardBox(255, { controls: true })) },
            { span: 12, height: ghostCardBody(chartCardBox(280, { zoomable: true, footer: true })) },
          ],
        }}
```
(delete the old `// strip: the owner row …` comment lines above it too).

Line 636: `{summary && summary.month && (` becomes
`{views.section === 'overview' && summary && summary.month && (` with the comment above it:

```tsx
            {/* Tiles belong to a view's summary (2026-09-13 polish §12): Overview only — the
                Accounts table carries its own month column. */}
```
Delete lines 687–712 (the D5 comment block and the whole `<dl className="networth-owner-strip">…</dl>`).

In the "By group over time" ChartCard, after `zoomWindow={zoomWindow}` (line ~742) add:

```tsx
                  lede={
                    ownerLede.length > 0 ? (
                      <span className="networth-owner-lede">
                        {ownerLede.map((entry, index) => (
                          <Fragment key={entry.label}>
                            {index > 0 && ' · '}
                            {entry.label} <b className="num">{formatCurrency(entry.total)}</b>
                          </Fragment>
                        ))}
                      </span>
                    ) : undefined
                  }
```

- [ ] **Step 4: The stylesheet** — in `src/pages/NetWorthPage.css` replace lines 3–22 (the
`.networth-owner-strip` comment and three rules) with:

```css
/* The per-owner split rides the By-group card's lede now (2026-09-13 polish §10); .chart-lede b
   gives the figures text ink, this gives them the tiles' steady digits. */
.networth-owner-lede .num { font-variant-numeric: tabular-nums; }
```

- [ ] **Step 5: Run the tests and the gates**

```bash
npx vitest run src/pages/NetWorthPage.test.tsx && npx tsc -b && npx eslint src/pages/NetWorthPage.tsx
```
Expected: PASS, tsc silent, eslint clean. (`PageSkeleton`'s `strip` prop stays optional; F2 owns
that file and `skeletonMetrics.OWNER_STRIP` — flag both as now-unused in the hand-off.)

- [ ] **Step 6: Commit**

```bash
git add src/pages/NetWorthPage.tsx src/pages/NetWorthPage.css src/pages/NetWorthPage.test.tsx
git commit -m "feat(networth): owner split as the By-group card lede, tiles on Overview only, Accounts card names its month"
```

---

## Task 11 — Credit cards: tiles on Rewards and Credit lines only; four delta-less ghosts

**Files:**
- Modify: `src/pages/CreditCardsPage.tsx:358` (skeleton), `:377` (tiles condition)
- Test: `src/pages/CreditCardsPage.test.tsx` (new describe appended)

- [ ] **Step 1: Write the failing tests** — append to `src/pages/CreditCardsPage.test.tsx`:

```tsx
// ── Tiles per view + ghost parity (2026-09-13 polish §9, §12 — S5/S7) ────────────────────
describe('CreditCardsPage — tiles per view', () => {
  it('shows the tiles on Rewards and Credit lines but not on Manage', async () => {
    seedHappyPath()
    renderPage()
    await screen.findByText('Total credit line')
    fireEvent.click(screen.getByRole('tab', { name: 'Credit lines' }))
    expect(screen.getByText('Total credit line')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Manage' }))
    expect(screen.queryByText('Total credit line')).toBeNull()
    expect(document.querySelector('.loading-dim > .kpi-row')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Rewards' }))
    expect(screen.getByText('Total credit line')).toBeTruthy()
  })

  it('ghosts four tiles without a delta line while the first payload is in flight', () => {
    seedHappyPath()
    vi.mocked(fetchCreditCards).mockReturnValue(new Promise(() => {}))
    const { container } = renderPage()
    expect(container.querySelectorAll('.page-skeleton .skeleton-tile')).toHaveLength(4)
    expect(container.querySelector('.page-skeleton .skeleton-delta')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to see them fail**

```bash
npx vitest run src/pages/CreditCardsPage.test.tsx -t "tiles per view"
```
Expected: FAIL — tiles render on Manage; three ghost tiles with delta blocks.

- [ ] **Step 3: The page** — in `src/pages/CreditCardsPage.tsx`:

Line 358: `skeleton={{ tiles: { count: 4, delta: false }, cards: [{ span: 12, height: 320 }, { span: 12, height: 260 }] }}`
(the real tiles carry no delta line, so the ghost must not either — S7's 36px shift).

Line 377: `{kpis && (` becomes `{kpis && views.section !== 'manage' && (` with this comment above it:

```tsx
            {/* Tiles belong to a view's summary (2026-09-13 polish §12): Rewards and Credit lines
                read the lineup; Manage edits it and gets none. */}
```

- [ ] **Step 4: Run the tests and the gates**

```bash
npx vitest run src/pages/CreditCardsPage.test.tsx && npx tsc -b && npx eslint src/pages/CreditCardsPage.tsx
```
Expected: PASS, tsc silent, eslint clean.

- [ ] **Step 5: Commit**

```bash
git add src/pages/CreditCardsPage.tsx src/pages/CreditCardsPage.test.tsx
git commit -m "feat(cards): tiles on Rewards and Credit lines only; four delta-less ghost tiles"
```

---

## Task 12 — Gates, the leftovers sweep, hand-off

**Files:** none new; fixes only if the sweep finds something.

- [ ] **Step 1: Sweep for retired vocabulary and wire words**

```bash
grep -rn "className=\"panel\|panel-title\|tiles-row\|tab-row\|allocation-overview-grid\|allocation-ranked\b\|allocation-heat\|allocation-classification-form\|allocation-search\|networth-owner-strip\|All holdings" src/pages/NetWorthPage.tsx src/pages/NetWorthPage.css src/pages/PortfolioPage.tsx src/pages/PortfolioPage.css src/pages/CreditCardsPage.tsx src/components/portfolio src/api/allocation.ts
grep -rn "'Unknown'" src/components/portfolio/*.tsx src/api/allocation.ts
```
Expected: the first grep prints nothing. The second prints only industry vocabulary
(`allocationChartOptions.ts` `'Unknown fund industry'` / `'Unknown industry'`) — those name an
industry, not the classification catch-all, and stay.

- [ ] **Step 2: Full gates**

```bash
npx tsc -b
npx eslint src/pages/NetWorthPage.tsx src/pages/PortfolioPage.tsx src/pages/CreditCardsPage.tsx src/components/portfolio src/components/creditcards src/api/allocation.ts
npx vitest run src/pages/NetWorthPage.test.tsx src/pages/PortfolioPage.test.tsx src/pages/CreditCardsPage.test.tsx src/components/portfolio src/api
npx vitest run
npm run build
```
Expected: tsc silent; eslint 0 errors and a warning count no higher than Task 0's baseline;
scoped vitest green; FULL vitest green (the count grows by the new files: `classificationRows`,
`ClassificationEditor`, `AllocationPanel`, `HeatTreemapCard` and the new page tests); build
succeeds. If anything fails: fix in the task's own files, re-run, and amend with a
`fix(<scope>):` commit — never skip a test.

- [ ] **Step 3: Leave the hand-off note for the lead** (in the final report, not a file):

- Files that grew: `AllocationPanel.tsx` (aside + wiring), `ClassificationEditor.tsx` (card), new
  `HeatTreemapCard.tsx`, `ClassifyButton.tsx`, `classificationRows.ts`, `ownerScopeLabel.ts`.
- Now-unused shared pieces this lane could not touch (F2's files): `PageSkeleton`'s `strip`
  prop, `skeletonMetrics.OWNER_STRIP`, `--m-owner-strip` / `.skeleton-strip` in panels.css.
- Coordination with P1: `HistoricalReview.tsx` still renders `details.panel`; `portfolio.css`'s
  `.panel` box is gone from this lane, so if P1 has not yet renamed it to `.card` the Monthly
  update accordion is unstyled until it does (spec §12 assigns that rename to P1).
- `panels.css`'s F2 sticky rule `.port-table th:last-child` now also touches the allocation
  ranked table and the classification table (non-scrolling — the rule is inert there except its
  1px hairline); flag for lane V's eyeball.
- Acceptance §15 item 8 is exercised by `AllocationPanel.test.tsx` (button text, 12-row filter,
  select focus) and `allocationExperience.test.tsx` (no `__unknown__` row / option).

---

## Self-review (run by the plan author against the spec; findings folded in above)

**Spec coverage — every P2 line in the spec has a task:**

| Spec item | Task |
| --- | --- |
| §7 Portfolio Transactions/Securities `.row-actions` + `useScrollEdges` on `.holdings-scroll` | 9 |
| §9 skeleton parity: Portfolio `tiles: 5`, Credit cards `tiles: 4` without delta | 4, 11 |
| §10 Net worth owner strip → By-group `lede`, not on Accounts | 10 |
| §10 Portfolio two subheader lines → one "Prices as of … · last refresh …" line | 3 |
| §11 `allocation-heat` → Holdings ChartCard, always open | 5 |
| §11 `allocation-classifications` → Security classifications card | 6 |
| §11 Allocation "Missing quotes" → `Disclosure` | 8 |
| §12 `.panel`→`.card`, `.panel-title`→`.eyebrow`, `.tiles-row`→`.kpi-row kpi-row-dense`, `.tab-row`→`Segmented tabs` with `panelIds`; `portfolio.css:12-14`, `PortfolioPage.css:15, 44-45` deleted | 2, 3 |
| §12 tiles per view: Portfolio (Overview/Holdings/Allocation; Income = Dividends tiles; Manage none), Net worth (Overview), Credit cards (Rewards, Credit lines) | 4, 10, 11 |
| §12/§13 allocation pair → one card with `aside` (coverage line, ranked table, Missing quotes) | 8 |
| §13 "Classify these N holdings" on the Unclassified row and slice detail → scroll, filter, focus | 6 (handle), 8 (buttons) |
| §13 classifications card: eyebrow, coverage sentence, chips (default Unclassified/All), search on the row, inline selects PATCH + Undo + inline error, industry only where available, note in place, empty-filter sentence + show-all, Review form removed, placed after the allocation card | 6, 8 |
| §13 TargetForm: no `__unknown__` seed/option, "classify first" hint with the action, Activate enabled | 7 |
| §13 "Unknown" → "Unclassified" in ranked table, legend, selection title (`allocationLabel`) | 1, 8 |
| §14 "Clear selection"; "Accounts — {month}"; Missing-price gated on `unpriced_count > 0`; "Import · not reviewed"; Prices line | 3, 10, 8, 6, 3 |
| §1 house rules: no literal durations (none added), no cross-page CSS imports, tests updated not deleted | all |

**Placeholder scan:** no TBD/TODO/"similar to"; every code step carries its code; every command
carries an expected result.

**Type consistency:** `displayLabel(key, label)` / `UNCLASSIFIED_LABEL` (Task 1) are what Tasks 6–8
import; `ClassificationEditorHandle.focusUnclassified()` and `CLASSIFICATION_CARD_ID =
'security-classifications'` (Task 6) are what Task 8 wires and both test files query;
`AllocationTargetEditor`'s `onClassify?` / `unclassifiedCount?` (Task 7) match the props Task 8
passes; `ClassifyButton({ count, onClick, className? })` (Task 7) is used identically in Tasks 7 and 8;
`RECORD_TABS: readonly SegmentedOption<Tab>[]` + `RECORD_PANEL_IDS` (Task 3) match the
`panelIds` contract in `Segmented.tsx`; `HeatTreemapCard({ holdings, owner? })` (Task 5) is what
`PortfolioPage` mounts; `ownerScopeLabel(owner)` is shared by Tasks 5 and 8.

## Spec ambiguities resolved in this plan

1. **"N = unknown members"** — N is `slice.members.length` (the server sorts every member into
   `members`, `portfolio_allocation.py:184`); the button hides when the list is empty.
2. **Geography's empty option** — the spec renames only the asset-class catch-all; the geography
   select's blank reads "Not set" (it is not the "Unclassified" the donut means).
3. **Which classifications feed the heat treemap after the move** — `HeatTreemapCard` fetches
   `/portfolio/classifications` itself (lazily, only when Holdings is visited) rather than adding a
   fourteenth request to `PortfolioPage.load()`'s `Promise.all`, which every page test would have
   had to mock. A fetch failure is a card-local advisory, not a silent "Unknown industry".
4. **The optimistic select** — a controlled select bound to server state snaps back for the
   PATCH's flight; the row keeps a draft keyed on the row's server values so the pick shows at
   once, reverts beside an inline `role="alert"` on failure, and unrelated refetches never wipe
   a note being typed. Controls are not disabled while saving (disabling drops the caret the
   classify path just placed); the row is `aria-busy` and a second edit waits.
5. **Post-save focus** — when an Unclassified row is classified it leaves the filtered table and
   the caret goes to the document; browsers resume sequential focus from that position, so no
   focus-management machinery was added (deferred, noted for V).
6. **Priced-book line** — the ChartCard `caption` is the PNG caption only, so the aside keeps a
   one-line "Priced book $… · quotes …" hint; the Missing-price caveat is appended to it only when
   `unpriced_count > 0`.
7. **Date format in the status line** — `formatDateTime` as the codebase has it (the spec's
   "Sep 11, 1:10 PM" is illustrative); no new formatter.
8. **Ghost height for the new lede** — `skeletonMetrics.chartCardBox` has no `lede` option and is
   a shared file; Net worth reserves a documented local `LEDE_ROW = 25`.
9. **Manage tabpanels** — the three ledger wrappers carry `role="tabpanel"` + the `panelIds` ids
   so the Segmented tablist's `aria-controls` resolves; nested inside the view's own tabpanel,
   which ARIA allows.
10. **C13 (category-button affordance) and W2 (targets empty state)** — not adopted by the spec's
    §12–14; left as-is and not implemented here.

---

## Results

Lane P2 (`polish/p2-portfolio`, worktree `.worktrees/polish-p2`), cut from main @`895cdaf` (F1 + F2 merged).
Fourteen commits, one per task plus three hand-off fixes. Never pushed.

### Commits

| Task | SHA | Subject |
| --- | --- | --- |
| 0 | — | pre-flight only, no files modified |
| 1 | `f1c8b60` | the catch-all slice reads Unclassified — `displayLabel`/`UNCLASSIFIED_LABEL`, donut and CSV routed through it |
| 2 | `04c70a1` | `.panel`/`.panel-title`/`.tiles-row` retired for the shared `.card`/`.eyebrow`/`.kpi-row` grammar |
| 3 | `21305ae` | Manage ledgers on a shell `Segmented` tablist, Clear selection, one-line price status |
| 4 | `31423d0` | tiles only on Overview/Holdings/Allocation; five ghost tiles |
| 5 | `2982c26` | industry heat treemap is a `ChartCard` under the holdings table (`HeatTreemapCard`) |
| 6 | `c44b640` | Security classifications card — filter chips, inline PATCHing selects with Undo, `focusUnclassified()` |
| 7 | `aebe47a` | targets never seed or offer Unclassified; the form names the share and hands over the action |
| 8 | `b6bf194` | one allocation card — ranked table and coverage as the donut aside, Missing quotes as a `Disclosure` |
| 9 | `ff10cb3` | Transactions and Securities ledgers scroll inside `.holdings-scroll` with `useScrollEdges` |
| 10 | `513a148` | owner split as the By-group card lede, tiles on Overview only, Accounts card names its month |
| 11 | `3ec946d` | tiles on Rewards and Credit lines only; four delta-less ghost tiles |
| 12 | `80a7ec2` | `test(portfolio)`: await the post-edit reset (the assigned pre-existing flake) |
| 12 | `d533754` | `docs(portfolio)`: the drill-in comments name Clear selection |
| 12 | `33e3709` | `test(networth)`: the ghost-parity guard pins the By-group box with its owner lede row |

### Gates (Task 12, from the worktree root)

- `npx tsc -b` — silent.
- `npx eslint <lane files>` — 0 errors, **1 warning** (`creditcards/CategoriesPanel.tsx` `react-refresh/only-export-components`), unchanged from the Task 0 baseline.
- `npx eslint .` — 0 errors, **25 warnings** = the repo baseline of 25. This lane adds none
  (`CLASSIFICATION_CARD_ID` is a constant export, which `allowConstantExport` permits).
- `npx vitest run` — **2957 passed / 2959**, 217 files passed of 218. The single failure is
  pre-existing and outside this lane (see below).
- `npm run build` — built in 9.67s.

### Deviations from the plan

1. **Task 1 rippled into the target tests.** Making `allocationLabel('__unknown__')` return
   "Unclassified" renamed the target row's `aria-label`, so the two existing `allocation targets`
   tests failed at Task 1 (the plan only rewrites them at Task 7). Updated the two labels in place
   at Task 1 (`Unknown target percent` to `Unclassified target percent`); Task 7 replaced the whole
   block as planned.
2. **`ClassificationEditor.tsx` renamed at Task 2 too.** The plan lists the `.panel` to `.card`
   renames but omits this file, which still carried `details.panel`; renamed with the rest so no
   component was left referencing a class Task 2 deleted. Task 6 replaced the file wholesale.
3. **`HeatTreemapCard.test.tsx`'s `beforeEach` is a block, not an expression.** The plan's
   `beforeEach(() => vi.mocked(fetchClassifications).mockResolvedValue([]))` implicitly *returns
   the mock function*, and vitest treats a function returned from a hook as that hook's teardown —
   so it called `fetchClassifications()` after every test, producing an unhandled rejection that
   failed the reject-path test. Body wrapped in braces, with a comment.
4. **A row's typed fields compare against what was last SENT, not against the prop.** The plan's
   `saveText` compared `draft[field]` with `row[field]`, so a blur right after an Enter-save
   re-PATCHed the same words (the server row still says the old value until the parent's refetch
   lands) — the plan's own "an unchanged blur is not a request" assertion caught it. The draft now
   carries a `sent` pair, re-based whenever the server row changes. Held in *state*, not a ref:
   react-hooks v7's `refs` rule rejects both reading and writing a ref during render.
5. **`HoldingsScroll` component instead of a hook call in each panel body (Task 9).** Per the
   lead's mid-lane note, `useScrollEdges` never re-arms if its ref is null at mount, and both
   ledgers render their table only once rows exist. The scroller is now a four-line component that
   calls the hook itself, so the hook mounts with a non-null element. This needs no `active`
   argument and will not conflict with the new two-arg signature.
6. **Two existing NetWorth tests updated for the new arrangement (Task 10).** `reads the last
   column at or before the pick...` asserted a *tile* while sitting on the Accounts view (tiles are
   Overview-only now) — it clicks through to Overview for that line; `snaps a ribbon pick back...`
   used a bare `document.querySelector('.chart-lede')` that now matches the new owner lede first —
   scoped to the movers card, the idiom its sibling test already used.
7. **One assertion in `src/components/PageSkeleton.test.tsx` (a lane-F2 file) updated.** Its
   ghost-parity guard pins NetWorthPage's first skeleton card by exact string; the plan's mandated
   `+ LEDE_ROW` changed it. The guard's intent (no bare literal) is intact — flagged for the lead
   as this lane's only touch outside its file list.
8. **Two stale comments** in `HoldingDetailPanel.{tsx,test.tsx}` named the "All holdings" button
   that Task 3 renamed; updated to "Clear selection" (`d533754`).

### Notes for lane V

- **Classify button text, exactly:** `Classify these {N} holding` / `...{N} holdings` (singular at
  N = 1). One component, `src/components/portfolio/ClassifyButton.tsx`, used by the ranked row, the
  Unclassified slice detail (first, above the `Open {ticker}` buttons) and the targets form.
- **Classifications card selector:** `#security-classifications`, also
  `section.card.allocation-classifications[aria-label="Security classifications"]`. The chips are
  a `Segmented variant="chips"` group named **"Classification filter"** (Unclassified / Not
  reviewed / All, each with a count badge); the search box is `input[aria-label="Find a security"]`.
  Row controls are `[aria-label="{TICKER} asset class"]`, `...geography`, `...industry`, `...note`.
- **Acceptance §15 item 8** is exercised by `AllocationPanel.test.tsx` (button text, the filtered
  row count, focus landing on a select, `scrollIntoView({ block: 'start' })`) and
  `allocationExperience.test.tsx` (no `__unknown__` row, no Unknown option).
- Portfolio's single subheader line is now `p.portfolio-status-line` inside
  `.page-frame-subheader` — "Prices as of {date} · last refresh {datetime} ({trigger}) · {n} updated".
- `panels.css`'s F2 sticky rule (`.port-table:has(td.row-actions) th:last-child`) now also sees the
  allocation ranked table and the classification table. Neither has a `td.row-actions`, so the rule
  is inert there — worth one eyeball.

### Hand-off / follow-ups for the lead

- **Now-unused shared pieces this lane could not touch (F2's files):** `PageSkeleton`'s `strip`
  prop, `skeletonMetrics.OWNER_STRIP`, and `--m-owner-strip` / `.skeleton-strip` in `panels.css`.
  NetWorth was their only caller. `PageSkeleton.test.tsx` still covers `strip` directly.
- **Coordination with P1:** `HistoricalReview.tsx` still renders `details.panel`, and
  `portfolio.css`'s `.panel` box is gone as of `04c70a1` — until P1 renames it to `.card` (spec
  §12 assigns that), the Monthly-update accordion renders unstyled.
- **Pre-existing failure, not this lane's:** `src/pages/OverviewPage.test.tsx > OverviewPage tiles
  > renders the four tiles from one snapshot` fails whenever the run happens after 17:00 PDT. Its
  `daysAgo()` helper computes in **UTC** (`new Date(...).toISOString()`), while `OverviewPage`
  compares the quote day against `todayIso()`, a **local** calendar date — so once UTC rolls over,
  the fixture's "yesterday" is the page's "today" and the tile reads " today" instead of
  " on Sep 13, 2026". One-line fix in P1's file (build the fixture date locally); left untouched
  here. Reproduces on the file alone, and nothing in this lane's diff is imported by that page.
- **Known parallel-run flakes seen once each and green on re-run:** `CreditCardsPage.test.tsx`
  ("an auto weight names the ENTERED months behind it", also flaky at the Task 0 baseline) and
  `settings/CategoriesCard.test.tsx` ("retires and restores without touching the other columns").
  `RestoreCard.test.tsx` never tripped.
- **Deferred by the plan (§13 ambiguity 5):** after an Unclassified row is classified it leaves the
  filtered table and the caret goes to the document; no focus-management machinery was added.

### Review round (APPROVE WITH FIXES, applied 2026-09-13)

Merged main @`b4063c5` into the lane first (`4c20ae2`, clean — no file overlap). Main's
`useScrollEdges(ref, active = true)` and named `page` container both arrived; `HoldingsScroll`
already had the documented shape, so nothing needed changing there.

All five items applied TDD (failing test, run, implement, run) in one commit, `f3b24b9`:

1. **Dimension-blind "Unclassified" (IMPORTANT).** `displayLabel(key, label, by)` now takes the
   dimension and returns `UNCLASSIFIED_LABEL` only on `asset_class`; `allocationLabel` returns the
   wire's "Unknown" on every other dimension. `data.by` is threaded from `exposureOption`,
   `exposureCsv` (both the label column and the Classification column), the selection title and
   `context.classification`, the ranked table and the drift rows. `ClassifyButton` (ranked row and
   slice detail) and the targets "classify them first" hint render only when
   `data.by === 'asset_class'` — a `classifiable` const in both `AllocationPanel` and
   `AllocationAside`. Tests: `allocationExperience.test.tsx` pins the label/option/CSV on
   `by: 'industry'` ("Unknown industry" survives); `AllocationPanel.test.tsx` switches the
   dimension toggle to Industry and asserts the ranked names and that no classify button renders,
   in the aside or behind the slice detail.
2. **Dropped edits inside one round-trip (IMPORTANT).** `pick`/`saveText` no longer return early on
   `busy`. Both go through `enqueue(next)`, which applies the optimistic draft and chains the PATCH
   on a `useRef<Promise<void>>` queue (`queue.current = queue.current.then(() => save(next))`), read
   and written in handlers only. The draft's `sent` now covers all four fields as display strings,
   and a `serverKey` change folds the new row in **field by field** (`rebased()`): a field equal to
   its last `sent` value takes the server's word, an unsent local edit is left alone. A failed PATCH
   reverts only the fields that request carried. Tests: two picks inside one in-flight PATCH → both
   shown, two PATCHes in order with the second carrying the first's value; a same-row refetch
   mid-typing keeps the text while the untouched field adopts the server's.
   *Lint note:* the `saveOnEnter(field)` factory was invoked during render, which react-hooks v7's
   `refs` rule reads as handing a ref-touching function to render — the Enter handlers are inlined
   now, matching the `onBlur` siblings that always linted clean.
3. **Treemap staleness (IMPORTANT).** `AllocationPanel` gained `onClassificationsChanged?`, fired
   from the classifications card's `onChanged` alongside its own `refresh`. `PortfolioPage` keeps a
   `classificationsVersion` counter and passes it to `HeatTreemapCard` as `refreshKey`, which is in
   that card's fetch effect deps. Tests: the card refetches when `refreshKey` bumps; the panel
   calls `onClassificationsChanged` after an inline save.
4. **Classify under an overlay panel (IMPORTANT).** `AllocationPanel` reads `useDetailPanel()`
   (null-guarded) and its `classify` handler now does `detailPanel?.close(); setSelection(null);`
   before `focusUnclassified()` — the page is `inert` under an overlay/reading panel, so the focus
   was a no-op and the button read as dead. Test: a mocked provider records `close` before
   `scrollIntoView`.
5. **Minors.** `.allocation-workspace`'s `container-type: inline-size` removed (the two-column pair
   it served is gone; the aside's query names ChartCard's own `.chart-card-has-aside` container) and
   the sheet's header comment corrected. The three Manage `role="tabpanel"` wrappers carry
   `aria-label="Transactions" / "Securities" / "Realized"`. The allocation card renders an
   `AllocationAsideGhost` (bars only — no faked coverage sentence or ranked rows) while the first
   payload is in flight, so the body is two columns from the first paint instead of flipping when
   data lands; covered by a test.

**Gates after the round:** `npx tsc -b` silent · scoped eslint 0 errors / 1 warning (the
pre-existing `creditcards/CategoriesPanel.tsx`, unchanged) · scoped vitest 289/289 across the
portfolio components and the three pages plus `motion.test.ts` · full `npx vitest run`
**3060 passed / 3061**, 223 files of 224 · `npm run build` 9.79s.

**The one failure is the same pre-existing, out-of-lane one reported before the round:**
`src/pages/OverviewPage.test.tsx > OverviewPage tiles > renders the four tiles from one snapshot`.
Its `daysAgo()` builds the fixture date in **UTC** while `OverviewPage` compares the quote day
against `todayIso()`, a **local** calendar date, so after 17:00 PDT the fixture's "yesterday" is the
page's "today" and the tile reads " today". It fails identically when that file is run alone, so it
is not an ordering flake; nothing in this lane's diff is imported by that page. One-line fix in
P1's file (build the fixture date locally). No other suite failed this round — the
`CreditCardsPage` and `settings/CategoriesCard` order flakes seen earlier did not reappear.

### Follow-up: the auto-weight month test made deterministic (2026-09-13)

Merged main first — a fast-forward to `90667e3`, no merge commit and no conflicts. Fixed in `fdb9d5c`.

**Root cause — a module-level cache leaking between two renders inside ONE test, not a clock or a
fixture problem.** `CreditCardsPage.tsx:71` seeds its state from `getSnapshot(SNAPSHOT_KEY)`
(`api/snapshotCache`), and `CreditCardsPage.test.tsx`'s `beforeEach` calls `clearSnapshots()`
between *tests* — but this test renders the page **twice within one test**: once with two reward
categories sharing a Food pool (each row $900, "1/2 share"), then, after `cleanup()` and a new
mock, once with a single category (expecting $1,800). The second render therefore painted the
first render's snapshot, `await screen.findByText('Categories & weights')` resolved off that stale
paint, and the bare assertion beneath it raced the new fetch. Whether it passed depended purely on
whether the second fetch's microtasks flushed first, which is why it was an occasional flake at
baseline and went constant once merged-tree scheduling shifted.

**Proof, before and after.** Stalling the second `fetchRewardCategories` by 30ms and logging the
second render's first paint printed exactly the reported failure string —
`Groceries$900.00 auto · 1/2 share · from 2 entered months` — and the test failed with
`expected … to contain '$1,800.00'`. After the fix the same perturbation (stretched to 60ms) passes.

**Fix — no assertion weakened.** `clearSnapshots()` after each mid-test `cleanup()` (both sites:
this test and `shows the advantage tile only when merging genuinely wins`, which had the same
latent hazard), because each second render models a *different book* and must not inherit the
previous one's snapshot; plus the `$1,800.00` assertion now waits (`waitFor`) for the value the
fetch answers, so it cannot outrun the payload even if a cache is reintroduced. Both full strings
are asserted unchanged, including `auto · from 2 entered months`.

**Not a production bug.** Painting a cached snapshot and then refreshing is the page's intended
behaviour within a session; only the test crossed two different books in one module realm.

**Verification:** full `npx vitest run` twice — **3062 passed / 3062, 225 files** both times (the
`OverviewPage` UTC/local failure reported earlier is gone too, fixed by P1 on main). `tsc -b`
silent; eslint on the touched file clean.
