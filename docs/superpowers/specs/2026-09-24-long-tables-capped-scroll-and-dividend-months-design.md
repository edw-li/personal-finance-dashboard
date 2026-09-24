# Long tables: capped scroll boxes, and dividends grouped by month (2026-09-24) — design record

**Status:** approved by the user 2026-09-24 ("Looks right"). Implementation on branch
`feat/table-scroll` (worktree `.worktrees/table-scroll`, cut from main @f50abe8d). Stop at LOCAL main —
no push, no deploy (the user pushes and deploys). Frontend only: no backend change, no migration.

**The ask, verbatim:** *"take a look at the production data … and add scroll bars to tables that are long
and take up too much vertical space … the user doesn't need to scroll excessively on the page to view
content. Note another session is running on this repo, but hopefully the scopes are such that there are no
conflicts and we can merge each independently."* Then: *"Let me know if there are any other graceful ways
to handle this issue from a user experience perspective. If not, a simple scroll bar suffices."*

**The choice:** three approaches were offered with mockups (a capped scroll box; the first rows plus
"Show all"; the capped box plus the dividend ledger grouped by month). The user picked the third and
added: *"i like the idea of grouping by months, let's do this but also add a scroll bar if the months
gets too long. So both this option and option 1"* — then *"yeah let's do the dividends by month since
there are so many of them. But I also want to keep a scroll bar around as the months grow. So it stays a
reasonable height still."* The design summary below (§2–§4) was approved with *"Looks right"*.

House rules that still hold: both themes; desktop widths (1280, 1600, 1920 — no phone work); copy names
the noun; money shown is never invented (month totals are sums of the stored entries, the same browser-side
sum the Monthly dividend income chart and the trailing-12/YTD tiles already make); absent ≠ zero (a month
with no entries is not listed, it is not a $0 row).

## 0. Evidence — production, 2026-09-24

Method: a read-only `pg_dump` of the production database (alembic head `f12026092301`; the host runs
b33c202b, whose frontend equals main's) restored into a PRIVATE local database `finance_scroll` (login
password reset in that copy only); the app from this worktree on private ports (uvicorn 8061, vite 5261
with its own dependency cache — see §5.3); a headless Edge walk of every route and every local section at
1440×900, measuring each rendered `<table>`.

| Table (route › section) | Rows | Height | Content below it | Notes |
|---|---:|---:|---:|---|
| Portfolio › Income › **Dividends** | 378 | 16,733 px | 69 px | ~19 screens; grows every month (auto rows from refreshes); no wrapper at all |
| Portfolio › Manage › **Transactions** | 80 | 3,565 px | 69 px | drag-to-reorder, sticky row actions; scrolls sideways only, so a drag scrolls the PAGE today |
| Portfolio › **Holdings** | 73 | 3,388 px | 591 px | sortable headers, row opens the detail dock |
| Monthly update › Edit balances | 57 | 2,127 px | 194 px | data-entry grid — OUT (§1) |
| Portfolio › Allocation › **Security classifications** | 37 | 1,724 px | 573 px | inline editors in every row |
| Portfolio › Manage › **Securities** (tab) | 87 | ≈3,800 px (est.) | — | 87 securities, 86 active; inline "Set price" form in the actions cell |
| Credit cards › Rewards › **Rewards matrix** | 19 | 1,056 px | 610 px | 85 px header (card names), 1-row `tfoot` "Est. $/yr won" |
| Net worth › Accounts › **Accounts** | 29 | 1,045 px | 97 px | 1-row `tfoot` "Net worth", row toggles the drill chart above |
| Spending › History › Yearly rollups | 19 | 939 px | 64 px | 8-row `tfoot` (267 px) — OUT (§1) |

Dividend history on production: 14 months (Aug 2025 → Sep 2026), 1–72 entries a month (Sep 2026: 40,
$594.94; Dec 2025: 72, $2,013.04). Every other table measured ≤ 584 px. Already capped (unchanged here):
Settings › Accounts / Portfolio accounts / Spending categories / Calendar feed links and the Activity feed
(`.settings-scroll`, 420 px), Credit cards › Categories & weights (`.categories-scroll`, 440 px), Comp ›
Vesting schedule (`.vest-scroll`, `clamp(420px, 60vh, 720px)`), every chart's Table twin
(`.chart-table-scroll`, 320 px). All target tables sit in a `.card` whose background is `--surface`.

## 1. Decisions

1. **Approach:** every long table scrolls inside a capped box (§2); the dividend ledger is additionally
   grouped by month inside its capped box (§4).
2. **In scope (seven tables):** Dividends, Transactions, Securities, Holdings, Security classifications,
   Net worth › Accounts, Rewards matrix.
3. **Out of scope, on purpose:**
   - *Monthly update's entry grids* (balances, spending): the concurrent correctness batch's lane M is
     rewriting that page, and a data-entry grid with its own sticky footer (`.entry-footer`) needs its own
     design.
   - *Yearly rollups*: its point is the 8-row totals block (Total, Net pay, savings rates, Months matched).
     Pinned, it would take 267 px of a 540 px box (≈5 categories visible); unpinned, the totals would hide
     below the fold inside the box. It is also the last card on its tab and ≈1 screen tall. (Change from the
     approved summary, which listed it — stated to the user at spec review.)
   - *The already-capped tables* keep their tuned heights (the reorder smoke measures the 420/440 px boxes).
     One improvement does reach them: print releases their caps (§2.5) — today they print only their
     visible slice.
   - *Short or fixed tables* (brackets, scenario comparisons, ESPP/Comp/Paycheck tables, card roster,
     realized gains, allocation targets): all under the cap on production data.
   - Pagination, virtualization, new sorting or filtering.
4. **The cap:** `clamp(420px, 60vh, 720px)` — the vesting schedule's cap (2026-09-13 polish spec §7:
   one scroll usually suffices on a tall screen; a short screen still gets a box instead of a card that
   swallows the page). 540 px at a 900 px window (≈11–12 ledger rows, ≈14 Net worth rows), 648 px at 1080,
   720 px from 1200 up, 420 px floor. A table shorter than its cap renders exactly as today.

## 2. The capped table box — `TableScroll`

### 2.1 Component

New `src/components/TableScroll.tsx` (default export) with its own sheet `src/components/tableScroll.css`
(imported by the component, the Disclosure/Segmented idiom):

```tsx
<TableScroll label="Holdings table" className="holdings-scroll" ref={optionalRef}>
  <table className="port-table">…</table>
</TableScroll>
```

- Renders `<div className={'table-scroll' + className} role="region" aria-label={label} tabIndex={0}>`.
  The label names the box for screen readers ("Holdings table, region") and `tabIndex={0}` makes it
  keyboard-scrollable even when it holds nothing focusable (read-only tables); the global
  `:where(…, [tabindex]):focus-visible` ring already covers it.
- `className` keeps the old wrapper's class, so the existing horizontal rules (`.holdings-scroll`,
  `.matrix-scroll`) and the tests that find tables by those classes keep working.
- `ref` (React 19 ref-as-prop, the ClassificationEditor idiom) is merged with the component's own ref, for
  the two callers that scroll the box (§3.5, §4.5).
- Contract: exactly one `<table>` as a direct child, living as long as the box. Callers render
  `TableScroll` only when the table renders (their existing empty states stay outside it).
- Hooks: `useScrollEdges(ref, true, 'xy')` (§2.3) and `useStickyInsets(ref)` (§2.4).
- `HoldingsScroll.tsx` is deleted; its two callers (Transactions, Securities) use `TableScroll` with
  `className="holdings-scroll"`, and its comment's reasoning (a component so the hook mounts with the
  scroller) moves to `TableScroll`.

### 2.2 Stylesheet (`tableScroll.css`)

- `.table-scroll { max-height: clamp(420px, 60vh, 720px); overflow: auto; }` — scroll chaining stays the
  browser default: at the box's end the wheel carries on scrolling the page (no trap).
- `.table-scroll > table { border-collapse: separate; border-spacing: 0; }` — the reorder tables' model
  (`reorder.css`), applied to every capped table: each cell keeps its own bottom border, so a stuck header
  cell carries its hairline with it and no box-shadow redraw is needed (the collapsed model leaves a sticky
  cell's border behind in the grid). Every target table draws bottom borders only, so the resting table
  keeps one hairline per row boundary.
- **Pinned header:** `.table-scroll > table > thead th { position: sticky; top: 0; z-index: 1;
  background: var(--surface); }` — z-index 1 like `.settings-scroll` / `.categories-scroll`, so a lifted
  reorder row (`z-index: 2`, `reorder.css`) still paints over it, as R7 accepted. Two-axis corner cells —
  `thead th.col-identity` and the last header cell of a table with `td.row-actions` — get `z-index: 2`, so
  body cells pinned on the same axis (col-identity is z 1 and later in the DOM) never paint over them.
  These rules sit in the new sheet; `panels.css`'s pinned-column rules are untouched (their full text is
  pinned by `surfaceGrammar.test.ts`).
- **Pinned totals row:** `.table-scroll > table > tfoot :is(td, th) { position: sticky; bottom: 0;
  z-index: 1; background: var(--surface); box-shadow: 0 -1px 0 var(--border); }` — the top hairline as an
  outer shadow: at rest it lands on the last body row's own bottom border (one line), stuck it draws the
  edge. A `tfoot .col-identity` cell keeps its right hairline and gains the top one (combined rule, z 2).
- **"More below" fade:** `.table-scroll::after` — a 28 px `linear-gradient(transparent → var(--surface))`
  block, `position: sticky; left: 0; bottom: 0; margin-top: -28px; pointer-events: none; z-index: 1`,
  `opacity: 0` by default and `opacity: 1` while `data-scroll-more~="bottom"` AND the table has no
  `tfoot` (a pinned totals row already marks that edge). Hidden at the end of the box, so the last row is
  never faded. Opacity transition under `prefers-reduced-motion: no-preference` only (`--t-fast`);
  `display: none` under `forced-colors: active`. The top edge needs no cue: the pinned header is the edge.
  The existing horizontal masks (`panels.css`) keep working on the same element — the fade is a child, so
  it does not compete with the box's `mask-image`.
- **Scroll margin on what scrolls under the pinned rows:** `.table-scroll > table > tbody * {
  scroll-margin-top: calc(var(--table-head-h, 0px) + 4px); scroll-margin-bottom: calc(var(--table-foot-h,
  0px) + 4px); }` — a Tab, a keyboard reorder or a `scrollIntoView` lands a body control clear of the
  pinned rows, with room for an outside focus ring. Not a `scroll-padding` on the box (Task 3 review): that
  counts the pinned rows' own controls — Holdings' sort buttons, the matrix's card buttons (re-focused after
  the card detail closes) — as out of view, so focusing one scrolled the box half its height (240 px per Tab
  across a sort header, a mouse click 1000 → 760; measured in Edge). With the margin the header Tab-walk
  moves 0 px, and a body control lands ~4 px below the header or above the totals row.
- **Inset focus ring:** `index.css`'s one inset-ring rule gains `.table-scroll` in its container list
  (`:is(.attention-strip, .settings-scroll, .categories-scroll, .table-scroll) :is(a, button,
  .button):focus-visible { outline-offset: -2px }`), for the same reason it lists the others: a ring drawn
  outside a control is cut where the control sits flush with the box's edge. `focusCss.test.ts` names it.
- **The box's own ring over its edge mask:** `.table-scroll:focus-visible { mask-image: none !important; }`
  — a `mask-image` clips everything outside the border box, the outline included, so the box's ring
  vanished whenever a sideways edge mask was active (Task 3 review; WCAG 2.4.7 for a new tab stop). The
  hint is worth less than the ring while the box has focus; the mask returns once focus moves into the
  table or away, and a mouse focus (no `:focus-visible`) keeps it. `!important`: `panels.css`'s two-token
  mask rule is (0,4,0) and may load after the new sheet.

### 2.3 `useScrollEdges` — vertical edges, opt-in

`useScrollEdges(ref, active = true, axes: 'x' | 'xy' = 'x')`. With `'xy'` it also writes `top` (scrollTop
> 0) and `bottom` (scrollTop + clientHeight < scrollHeight − 1, the same 1 px tolerance as the right edge)
into the same `data-scroll-more` token list, after `left`/`right`. Opt-in so every existing caller's
attribute stays byte-identical (an `overflow-x: auto` box computes `overflow-y: auto` and can round 1 px
taller than its content). The existing `~=` mask selectors ignore the new tokens. Same listeners (scroll,
own resize, window resize); in `'xy'` mode the ResizeObserver also observes the box's child `<table>`, so
rows arriving or a month opening (§4) refresh the tokens without a scroll (the box's own size does not
change once it is capped, so observing the box alone would miss them).

### 2.4 `useStickyInsets` — the pinned rows' heights

Measures the box's `table > thead` and `table > tfoot` heights and writes them as `--table-head-h` /
`--table-foot-h` (px, `0px` when absent) on the box's inline style; re-measured by a ResizeObserver on the
table (a header that wraps, a density switch, a `tfoot` that appears once data lands). Guarded for jsdom /
no-ResizeObserver (then measured once on mount). Consumers: the scroll margin (§2.2) and the dividend
month rows' sticky offset (§4.3). Lives in `src/components/tableScrollDom.ts` with the `revealInBox` helper
(§4.5) — not `tableScroll.ts`: on this case-insensitive Windows box `import './TableScroll'` would resolve
to a `tableScroll.ts` before `TableScroll.tsx` (`.ts` is tried first).

### 2.5 Print

`@media print` (in `index.css`): `:root :is(.table-scroll, .settings-scroll, .categories-scroll,
.vest-scroll, .chart-table-scroll) { max-height: none; overflow: visible; mask-image: none !important; }`
and, for the same five, `… :is(th, td) { position: static !important; }`, with the fade hidden — paper gets
every row of an open table. (Collapsed dividend months stay collapsed on paper: print what is on screen.)
The release lives in `index.css`, not the new sheet (Task 3 review): route chunks load their sheets lazily
— Settings and Comp never load `tableScroll.css` — and a page's own cap sheet can load after it at the same
(0,1,0) specificity and win. `:root` lifts the rule to (0,2,0), so it wins in any load order, and the four
older caps' own files stay untouched. Static cells and no mask (Task 3 review, an Edge PDF): released, a
box no longer scrolls, so its sticky cells pinned to the PAGE — Net worth's totals row printed over other
tables' rows, Transactions' pinned actions over a data column — and a box printing with a sideways token
kept its edge mask; the browser repeats a table's header and totals rows on every printed page by itself.
`!important`, print only: the pinned action header is `.port-table:has(td.row-actions) th:last-child` at
(0,3,2), the two-token mask rule (0,4,0). `tableScroll.css` keeps only the fade's print hide (the fade is
TableScroll's own and loads with it).

### 2.6 Interplay (checked against the code)

- **Drag to reorder (Transactions):** `scrollParentOf` takes the nearest ancestor that scrolls vertically
  with real overflow — the capped box — and `stickyHeaderOf` finds the row's own sticky `thead th`; the
  auto-scroll zone starts below the header (R7). So a drag now scrolls the box instead of the page; the
  window-level scroll re-track still covers a page scroll. No reorder code changes.
- **Whole-row clicks** (Holdings, Net worth): unaffected; the header's sort buttons (Holdings) and card
  buttons (matrix, `card-col-<id>`, the focus-return target after the card detail closes) stay pinned and
  visible.
- **Reload keeps the box's position:** the panels re-render in place on `onChanged` (no remount), so the
  box's `scrollTop` survives an edit/delete; verified in the browser (§6).
- **Horizontal masks:** Holdings and Classifications gain the edge masks their bare `div.holdings-scroll`
  never had (the ledgers already have them) — consistent with every other sideways scroller.

## 3. Where it applies

| # | Table | File (wrapper today) | Change |
|---|---|---|---|
| 3.1 | Dividends | `components/portfolio/DividendsPanel.tsx:365` (none) | `TableScroll label="Dividends by month"` + §4 |
| 3.2 | Transactions | `components/portfolio/TransactionsPanel.tsx:686` (`HoldingsScroll`) | `TableScroll className="holdings-scroll" label="Transactions table"` |
| 3.3 | Securities | `components/portfolio/SecuritiesPanel.tsx:273` (`HoldingsScroll`) | `TableScroll className="holdings-scroll" label="Securities table"` |
| 3.4 | Holdings | `components/portfolio/HoldingsTable.tsx:83` (bare `div.holdings-scroll`) | `TableScroll className="holdings-scroll" label="Holdings table"` |
| 3.5 | Security classifications | `components/portfolio/ClassificationEditor.tsx:87` (bare `div.holdings-scroll`) | `TableScroll className="holdings-scroll" label="Security classifications table"`, plus the focus fix below |
| 3.6 | Net worth › Accounts | `pages/NetWorthPage.tsx:870` (none) | wrap in `TableScroll label="Accounts table"`; `tfoot` "Net worth" pinned |
| 3.7 | Rewards matrix | `components/creditcards/RewardsMatrix.tsx:213` (`div.matrix-scroll`) | `TableScroll className="matrix-scroll" label="Rewards matrix"`; `tfoot` "Est. $/yr won" pinned |

**3.5 focus fix:** "Classify these N holdings" (`focusUnclassified`) scrolls the card into view and focuses
the first row's asset-class select with `preventScroll: true`. Inside a box that was scrolled down, that
row can be out of view; the handler now sets the box's `scrollTop = 0` first (the filtered list's first
row is the box's first row). The page's own scroll is unchanged.

## 4. Dividends by month

### 4.1 Grouping — `src/components/portfolio/dividendMonths.ts`

`groupDividendsByMonth(dividends: DividendOut[]): DividendMonth[]` where
`DividendMonth = { key: 'YYYY-MM'; label: string; rows: DividendOut[]; totalCents: number }`.

- Month = `pay_date.slice(0, 7)` — the **Recorded date** column, and exactly the basis of
  `monthlyIncomeSums` (the chart right above), so a month's total equals its bar to the cent. Automatic
  entries are recorded on the ex-date, manual ones on the entered pay date — the card's hint already says
  so.
- Months newest first (sorted by key, descending); rows keep the API's order within a month
  (`pay_date desc, id desc`).
- `totalCents` sums `Math.round(Number(amount) * 100)` — integer cents, no float drift; shown with
  `formatCurrency(totalCents / 100)`. `label` = `formatMonth(key + '-01')` → "Sep 2026".
- Pure and unit-tested; no month is invented (a month with no entries is absent).

### 4.2 Markup and look

One `<tbody>` per month inside the ledger's single table (keeps the column grid shared, so amounts align
down the whole ledger):

```
┌ Dividends ─────────────────────────────────────────────────────────────────┐
│ 14 months · 378 entries                                     [ Expand all ] │
│┌──────────────────────────────────────────────────────────────────────────┐│
││ Ticker  Account     Recorded date   Amount  Source  Per share  Notes     ││ ← pinned
││ ▾ Sep 2026  40 entries                $594.94                            ││ ← pinned under it while inside Sep
││   XLV    RH Joint   Sep 21, 2026    $0.44   AUTO    $0.64 × 0.69 [Edit][Delete]
││   …                                                                      ││
││ ▸ Aug 2026  19 entries                $218.59                            ││
││ ▸ Jul 2026  18 entries                $248.57                            ││
││░░░░░░░░░░░░░░░░░░░░░░░░ fade: more below ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░││
│└──────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

- Month row: `<tr className="dividend-month-row">` with `<th scope="rowgroup" colSpan={3}>` holding a
  `<button type="button" aria-expanded>`: the Disclosure chevron (`ChevronRight`, rotated 90° when open,
  same size/transition tokens as `disclosure.css`), the month label, and "N entries" (muted; "1 entry");
  then `<td className="num">` with the month's total under the Amount column; then `<td colSpan={4} />`.
  The whole row toggles on click (handler on the `<tr>`; the button is the keyboard and screen-reader
  control — its click bubbles to the row, so one toggle per activation). Its accessible name is
  "Sep 2026, 40 entries" (a visually-hidden comma between label and count) and its description is the month's
  total (`aria-describedby` → the total cell); being a padding-free text button it keeps an OUTSIDE focus ring.
- Look: the month row's cells use an opaque band (`--surface-2`), `font-weight: 600`, text `--text`, the
  count `--muted`; hover lifts the band to `--fill` (opaque; the muted count keeps AA: 4.59:1 dark, 4.53:1
  light — the first draft's 6% color-mix fell to 4.40:1); the pinned cells draw a bottom hairline
  (`box-shadow: 0 1px 0 var(--border)`, the pinned totals row's idiom) so rows visibly slide under the band;
  `user-select: none` (a double-click toggles twice, never selects the label). Entry rows are unchanged (same cells, badges, per-share line, Edit/Delete), indented one
  step in the first cell so they read as children of the month.
- Toolbar line above the box: "14 months · 378 entries" (muted) and an **Expand all / Collapse all**
  button (label follows state: "Collapse all" only when every month is open). Hidden with fewer than two
  months. Expand all is the Ctrl+F path to every entry (rows of a closed month are not rendered).
- The Edit/Delete cell keeps `td.row-actions` (pinned right when the box scrolls sideways at narrow
  widths). Each entry row carries `data-dividend-id`.

### 4.3 Pinned month row

`.dividend-month-row > *` cells are `position: sticky; top: var(--table-head-h, 0px); z-index: 1` with
their opaque band — so while you scroll inside a long month, its month line stays just under the pinned
column header. When the next month's row arrives it takes the place: Edge pins a table's sticky cells
against the whole TABLE, not their row group (measured 2026-09-24 — sticky cells, a sticky row and a
positioned tbody alike), so passed month lines stack at one offset and the newest passed paints on top —
the line shown is the month you are in. Two consequences are handled:
- a click, or a TAB (Shift+Tab) that lands on a COVERED month line — focus arriving from another element with
  Tab as the last key, and the next month's line overlapping this one — first scrolls the BOX
  until that month's group starts just under the column header (its own line uncovered). Shift+Tab back
  up the ledger would otherwise rest on a toggle hidden under a later month's line — the browser does not
  scroll to it, since it counts as in view (WCAG 2.4.11) — and collapsing the month you are inside keeps
  your place instead of dropping you among the months below. Focus handed back by code (the palette's Esc,
  a dialog closing) or a window refocus never scrolls: those reach a line the reader already left, and a
  jump would lose their place (both reproduced in Edge during review);
- entry rows carry `scroll-margin-top: calc(var(--table-head-h, 0px) + 2.5rem)` (2.5rem ≥ one month line in
  both densities) so a Tab-focused Edit/Delete lands clear of both pinned lines — a margin on the rows, not
  scroll padding on the box, which would count the pinned toggles themselves as out of view and jump the
  box when one takes focus (the TableScroll review, §2.2).
`revealInBox` (§4.5) is given the month line's MEASURED height as an extra top inset, so a revealed row
lands exactly below it.

### 4.4 Open state

- `open: Set<monthKey>` in component state. **Default: one month open, all others folded — the newest on or
  before the current month** (a future-dated manual entry — the form allows one — is listed first but must not
  fold the current month away; with only future months, the newest) —
  seeded the first time rows exist (a cold load that starts empty seeds when the payload lands; a warm
  snapshot seeds at mount). React's adjust-during-render idiom (a `seeded` flag), no effect.
- Click/Enter/Space on a month toggles it; Expand all opens every month; Collapse all closes every month.
- Not persisted (URL/prefs): each visit starts with the newest month open.
- Data changes keep the set: a reload, a delete that empties a month (the key lingers harmlessly; Undo
  brings the month back as it was), a scope switch (Whose chips) — months are rebuilt from whatever rows
  the page shows. If the scope shows months none of which are open, they all show folded; the user opens
  what they want.

### 4.5 Add, edit, delete, undo

- After a successful **add** or **edit** save, the saved entry's month (from the SAVED form's `pay_date` —
  the month the entry was saved into) is
  opened, and once the refreshed rows render, the BOX (never the page) scrolls so the saved row shows below
  the pinned lines: `revealInBox(box, row)` adjusts `box.scrollTop` only when the row is outside the box's
  visible band. The entry form keeps focus (the rapid-entry session: amount box focused after an add) and
  the page does not move. The pending reveal is consumed by the next ledger the page renders after the save
  (found → revealed, not found → dropped), is dropped by a delete or a new edit, and lapses after 10 s (an
  identical refetch is skipped by the page, and a later unrelated ledger change must not scroll to an old row).
- **Delete** and its **Undo** are unchanged; the month's count and total follow the rows.
- **Edit** still seeds the form above the table without scrolling or focusing (unchanged).
- Empty ledger: unchanged ("No dividends recorded." — no toolbar, no box).

## 5. Working beside the correctness batch

### 5.1 Files

Touched: `components/TableScroll.tsx` (new), `components/tableScroll.css` (new), `components/tableScrollDom.ts`
(new), `components/useScrollEdges.ts`, `components/portfolio/{DividendsPanel,TransactionsPanel,
SecuritiesPanel,HoldingsTable,ClassificationEditor}.tsx`, `components/portfolio/dividendMonths.ts` (new),
`components/portfolio/dividends.css` (new — the month rows and toolbar; imported by DividendsPanel, so the
shared `portfolio.css` stays untouched), `components/portfolio/HoldingsScroll.tsx` (deleted — both of its
callers import `portfolio.css` themselves), `components/creditcards/RewardsMatrix.tsx`,
`pages/NetWorthPage.tsx` (one wrapper around the table), `index.css` (the inset focus-ring selector list and the print release), and their tests.
Not touched: anything under Taxes, Projection, Monthly update, Overview, Spending, backend.

### 5.2 Merge

The other session's lanes (K time contract, W Will I owe, R projection; T time surfaces and M two-part
monthly update later) merge into local main as they finish. This branch merges independently: before
merging, merge the then-current main into `feat/table-scroll`, re-run the gates, then merge `--no-ff`
into local main. The other session's coordinator works in the main checkout, so it is messaged first
(merge window) and any uncommitted file of theirs is left alone. Expected overlap: `NetWorthPage.tsx`
(lane T may relabel dates there) — this branch's edit there is a wrapper around the accounts `<table>`,
so a conflict, if any, is local and mechanical.

### 5.3 Dev servers on this box

A worktree's `node_modules` is a junction to the main checkout's, so vite's default dependency cache
(`<root>/node_modules/.vite`) is SHARED by every dev server on the box, and a vite started from the main
checkout watches `.worktrees/**` (a new worktree's `tsconfig.json` made it clear the cache and reload,
which broke React with "Invalid hook call" until restart). This branch's vite runs from its own worktree
with a private `cacheDir` (a wrapper config in the session scratchpad). No shared server is restarted.

## 6. Testing and verification

**Unit (vitest; globals off → `afterEach(cleanup)` in every rendering test):**
- `useScrollEdges`: `'xy'` writes `top`/`bottom` after `left`/`right` with the 1 px tolerance; default
  `'x'` never writes them (existing tests unchanged).
- `tableScrollDom.ts`: `useStickyInsets` writes both variables (stubbed ResizeObserver + heights), `0px`
  without a `tfoot`; `revealInBox` scrolls up/down/not at all around the pinned insets (mocked rects).
- `TableScroll`: role, label, `tabIndex=0`, classes merged, ref forwarded, one table child.
- `dividendMonths.ts`: month basis = `pay_date` month; months descending; row order kept; integer-cent
  totals (e.g. three × $0.10 = 30 cents exactly); labels; singular/plural; totals equal
  `monthlyIncomeSums` for every month inside the chart window (same fixture).
- `DividendsPanel`: newest month open by default and seeded on a late payload; toggle by row click, by
  button, by Enter/Space; `aria-expanded`; Expand all / Collapse all labels and effect; toolbar counts and
  its absence with one month / no rows; add opens the saved month and does not move focus off the amount
  box; edit to another month opens that month; delete updates count/total; Undo; existing tests adjusted
  only where they reach rows in a month that is now folded (open it, never weaken an assertion).
- Callers: Transactions/Securities tests still find `.holdings-scroll` > `table.port-table` and
  `td.row-actions`; Holdings, Classifications (the `scrollTop = 0` before focus), Net worth, Rewards matrix
  render inside a `role="region"` box with their label.
- CSS pins (`tableScrollCss.test.ts`, the flat-text idiom of `surfaceGrammar.test.ts`): the cap value,
  separate borders, sticky `thead th` (top 0, z 1, `--surface`), corner z 2, sticky `tfoot` cells with the
  top hairline, the fade's gating selector, the forced-colors and print blocks, the body-row scroll margin and the focused box's mask drop (the reduced-motion transition is left unpinned); `focusCss.test.ts`
  gains `.table-scroll` in the inset-ring container list; the existing pins stay green unchanged.

**Real browser on the production copy (`finance_scroll`), both themes, 1280×800, 1600×1000, 1920×1080,
read-only by construction (non-GET API calls fenced), with before/after page heights:**
- every target box: height = min(cap, table height); the page height drops accordingly (Portfolio ›
  Income from ≈17,600 px to ≈2,000 px at 1440×900);
- after scrolling each box to its middle: every `thead th` sits at the box top (±1 px) and paints above the
  rows (hit test), `tfoot` cells sit at the box bottom (Net worth, matrix); background of pinned cells =
  the card's background in both themes;
- the fade shows at rest (no `tfoot`), not at the end; Tab reaches the box, the ring is visible, ArrowDown
  / PageDown scroll it; a wheel at the box end scrolls the page;
- Dividends: one month row per distinct month (14), the newest open, the rest folded; every month total
  equals an independent sum of `GET /portfolio/dividends` for that month and the chart's bar for the months
  in its window; Expand all renders all 378 entry rows, Collapse all none; while scrolled inside an open
  month its row stays pinned under the header;
- Transactions: a real pointer drag toward the box's bottom edge auto-scrolls the BOX (page still), then
  Escape cancels with nothing sent; keyboard lift + ArrowDown past the visible band keeps the row in view;
- clean console, CLS < 0.1 on the touched routes.

**Gates:** `tsc -b`, eslint (0 errors, warnings ≤ baseline), full vitest, `vite build`.

## 7. Rollout

Frontend only. After the user pushes: prod `git pull` → rebuild the frontend image (README 4.1). Nothing
to migrate, nothing to re-seed.
