# Polish: layouts that end together, tile rows, feedback where you act, exact undo, a sidebar that fits (2026-09-25) — design record

**Status:** implementation and agreed verification complete on LOCAL main, 2026-09-26, including the user's footer
and badge amendments. Final product `d1766fdf` is accepted through the complete matrix plus 90 affected reruns; exact
coverage, retained failed attempts and focused code-gate attribution are in
[the final verification record](../plans/2026-09-25-polish-V-verify.md). No push or deploy; the user handles those.
Backend AND frontend change; no migration (the `change_log` table already exists).

**The ask, verbatim:** after the 2026-09-24 polish audit (archived in `docs/reviews/2026-09-24-polish-audit/` —
`00-REPORT.md` plus eight lane files whose IDs this record cites: OU, NWSP, PE, TPC, PCC, SGS, MOTION, WF), the user
picked five of its fourteen headline items: *"Let's go ahead and implement 4 (note similar issues also exist
elsewhere like in Settings, Calendar, etc), 5, 11, 12, 13."* Those items, as the audit named them:

- **4** — side-by-side cards don't end on the same line (app-wide, including Settings and Calendar).
- **5** — KPI tile rows aren't one aligned strip.
- **11** — feedback appears where the user isn't looking.
- **12** — one consistent way to save, delete and undo.
- **13** — the sidebar doesn't fit ordinary laptop screens.

**The one decision asked:** how far item 12's "one consistent Undo" goes. Options: extend the backend change log so every
delete undoes exactly; an honest frontend split (exact Undo where it exists, an in-app confirm elsewhere); or UI
unification only. The user chose **"Exact Undo everywhere (Recommended)"**. The design summary (§2–§8) was approved with
*"yes"*.

**House rules that still hold:** both themes; desktop widths 1280–1920, plus 1366×768 and 1536×864 for the sidebar; no
phone work. Motion uses the tokens in `src/index.css` / `src/theme/motion.ts` and is zeroed under reduced motion. No
colour outside `src/theme/tokens.ts`. Copy names the noun. Money shown is never invented.

**Out of scope:**
- The audit's other headline items (1–3, 6–10, 14) and its long tail. Not in this batch: toast placement over sticky bars
  (WF-08), developer-speak error copy (WF-14), app-wide number-format dialects (MOTION-17), the theme-toggle flicker, the
  palette's arrow keys, wheel scrolling over charts, the Monthly update's save-jumps-to-top (WF-01).
- The user's standing exclusions: mobile/responsive, transaction-level spending, realized gains / XIRR.

---

## 0. Evidence (from the audit, production data, 2026-09-24)

| Item | What was measured | IDs |
|---|---|---|
| 13 | The sidebar needs 886 px of height. At 1280×800 / 1366×768 / 1536×864 it overflows by 86 / 118 / 22 px. It grows its own 16 px scrollbar and pushes "Light theme" and "Log out" below its fold; at 1366×768 the whole footer is hidden. Compact density still overflows by 18 px at 800 px. "Search or jump…" is truncated at every width. | SGS-06, MOTION-21 |
| 4 | Paired chart cards end apart: Overview Recent spending 63 px short of Portfolio performance; Spending › Trends 69 px (488 px with All categories); Paycheck's flow card 95 px; ESPP 17 px; card detail 43 px. Other gaps: "Changes worth understanding" shows a 109 px blank band (277 px on Data status with the trend Table open); Settings › Household leaves a 261 px hole under Household; Price refresh leaves a 173 px hole beside Assistant; the calendar has a 65 px blank band under the weekday names; Tax tables' two columns leave 123–142 px ragged gaps; the Allocation donut floats with up to 294 px of blank below it; budget meters end at 1112 vs 1119 px; the ESPP pace meter ends 27 px short. | OU-04, NWSP-08, TPC-01, PE-11, PCC-28, SGS-09, SGS-10, PCC-04, TPC-12, PE-20, NWSP-14, TPC-22, SGS-20 |
| 5 | Badges ("Provisional", "Not yet reviewed", "Borderline") wrap under their labels, putting those values 17–19 px below their neighbours. Deltas break mid-phrase ("21 / days", "Sep / 1"). Tiles with no sub-line leave 35–58 px empty. The Net worth row height runs 145 → 111 → 128 px as months are picked. Five-tile rows wrap 4 + 1 (and 2 + 2 + 1 with the dock open). Skeletons ghost five tiles as 4 + 1. Paycheck has a lone ¼-width tile plus a hero tile nested inside a card. The calendar's cash-flow tiles have a 22 px ragged bottom. | OU-03, NWSP-04, PCC-12, PE-02, PE-09, MOTION-01, TPC-01, PCC-17, TPC-18 |
| 11 | Edit copies a row into a form scrolled off-screen (−54 to −280 px in Settings, −186 px on the card roster), with no focus and no Esc. Row errors land in a banner at the card top, off-screen, shoving the table down 52–73 px. A new transaction lands ~3,000 px down. The rewards-matrix editor renders below the fold. A chart's Table opens with 21 px visible. Activity's report opens out of sight. "Open Inputs" lands at the top of the form instead of on the named field. | SGS-04/05/18, WF-04/05/06/11, PCC-19, TPC-06/14/16, NWSP-15, MOTION-11 |
| 12 | Delete speaks six dialects (native `confirm()`, typed arm, click-to-arm, inline confirm, instant + Undo, instant with nothing). The re-create Undos are lossy: a transaction returns at the ledger's end with a new id; a card loses its multipliers and pins; a reward category loses its cells; a security delete would drop its price history. Success is told five ways. Save buttons are lit with nothing to save. The kind change "recomputes ALL history" with no confirm or Undo. Focus drops to `<body>` after most saves, deletes and Undos. "Saving…" sometimes shows on the wrong button, and busy labels resize buttons. | WF-03/07/09/10/12/13/17, SGS-05/16/17, TPC-12/18/19 |

---

## 1. Decisions

1. **D1 — Exact undo everywhere (item 12, the user's choice).**
   - **Where it applies:** every user-intent write in `portfolio.py`, `credit_cards.py`, `espp.py`, `paycheck.py`, `comp.py`
     and `calendar.py` records through a `ChangeBatch`.
   - **Deletes** image their dependent rows (children first, parent last), so `undo_batch` restores the exact rows — same ids,
     same ledger position, same multipliers and pins.
   - **Response:** every logged write returns `X-Change-Batch`.
   - **Consequence:** client-side "re-create" undos are retired.
2. **D2 — The delete grammar.**
   - **Reversible deletes** (everything logged): instant. The row collapses, then the toast says "Deleted {thing}" with Undo,
     and Undo calls the batch undo.
   - **Irreversible or bulk actions:** one in-app `ConfirmPopover` anchored to the button that asked, initial focus on Cancel,
     saying what will be lost.
   - **The native `window.confirm`** leaves the app, fenced by a test.
3. **D3 — Saves.**
   - The primary Save is quiet (`aria-disabled`) until the form differs from what is saved. While dirty, "Unsaved changes"
     sits beside it.
   - Success shows "Saved ✓" beside it for ~2.5 s. Errors show beside it.
   - Only the pressed button shows busy, at its idle width. Focus is never dropped.
   - Plain field saves get no Undo toast. Every logged change stays undoable later from Settings › Data › Activity.
4. **D4 — One-click reclassify / retire / archive / hide.**
   - The change is optimistic, locks only its row, and gets a toast with Undo (batch undo).
5. **D5 — Edits come to the user (item 11).**
   - The form scrolls into view, its first field takes focus (selected), and the edited row is marked. Esc and Cancel leave
     edit mode and return focus to the row's Edit button.
   - Save returns focus there and flashes the row.
   - Chosen over inline row editing: 18 surfaces, most with multi-field forms, and one rule is learnable. Household rename
     stays inline (it already is).
6. **D6 — Paired cards end together, and the extra height goes to something that can use it (item 4).**
   - Chart pairs grow their plot.
   - Settings pairs are re-paired so partners are close in height, then stretched with their action rows pinned to the bottom.
     The 2026-09-13 "short card ends where its content ends" rule is superseded by re-pairing, not by empty cards.
7. **D7 — Tile rows share one grid (item 5).**
   - Each tile is a three-row subgrid: header (title + optional badge) · value · delta. Values sit on one baseline and deltas on one
     line.
   - Row height is stable as months change.
   - Five-tile rows wrap 3 + 2, both rows filled; never 4 + 1.
8. **D8 — The sidebar fits (item 13).**
   - A short-viewport rhythm under 900 px of height.
   - A one-row account footer: email · theme icon · log-out icon; the environment and build hash move to the email's tooltip
     and to Settings › System.
   - The search pill reads "Search…".
9. **D9 — Delivery.**
   - Three waves of parallel lanes in worktrees with Opus implementers, each lane reviewed, merged `--no-ff` to local main;
     then a verification pass on a fresh production copy (§9).
   - Chosen over one sequential lane (2–3× slower) and one lane per item (items 11 and 12 share ~40 files).

---

## 2. Item 13 — the sidebar fits

**Files:** `src/components/Layout.css` (sidebar), `src/components/Layout.tsx` (search label), `src/components/shell/SidebarFooter.tsx`,
`src/components/shell/shell.css` (footer).

- **Short-viewport rhythm** — `@media (max-height: 900px)`:
  - `.nav-link` padding 0.5rem → 0.32rem (vertical);
  - `.nav-heading` margin 0.35rem → 0.2rem top;
  - `.sidebar nav` gap 0.45rem → 0.3rem;
  - `.sidebar-title` bottom padding 1rem → 0.6rem;
  - `.sidebar-search` bottom margin 0.6rem → 0.4rem.

  Compact density composes with it (its own rules still apply). `overflow-y: auto` stays as the fallback below ~700 px.
- **Footer** becomes ONE row: `[full email, flex 1] [theme icon button] [log-out icon button]`.
  The user's 2026-09-26 preview feedback supersedes ellipsis: remove excess address padding so the full current email
  fits at the existing 210px sidebar width; longer identities wrap. Log out uses the existing red `--negative` token,
  including hover.
  - Icon buttons: 28×28 px, `aria-label` ("Switch to light theme" / "Log out") and a `title` tooltip, the existing focus ring
    and hover.
  - The environment pill and build hash leave the visible footer: the email row's `title` reads
    `{email} · {environment} · build {hash}`, and Settings › Data › System gains a "Build" fact (hash) beside the environment
    it already lists.
  - The theme toggle keeps its current behaviour (including the leaving-System toast).
- **Search pill:** "Search…" (the `kbd` keeps Ctrl K / ⌘K); never ellipsised at 210 px.
- **Acceptance:**
  - At 1280×800, 1366×768, 1536×864 and 1440×900, in comfortable and compact density and both themes, the sidebar's
    `scrollHeight ≤ clientHeight` (no scrollbar of its own) and the theme and log-out buttons are fully visible.
  - Nothing in the nav moves at ≥ 901 px of height.
  - The active indicator still slides (it measures the rows).

---

## 3. Item 4 — side-by-side layouts end together

### 3.1 Chart cards fill their row (Overview, Spending › Trends, Paycheck, ESPP, card detail)

Today `ChartSurface` portals the card into a class-less host `<div>` inside `.chart-card-slot`. The grid stretches the slot,
but not the host or the card (`chartInteractions.css:1` sets only `min-width`).

- **Slot chain:** `.chart-card-slot` becomes a column flexbox; its host child `flex: 1; display: flex; flex-direction: column;
  min-height: 0`; `.chart-card-slot .chart-card` `flex: 1; display: flex; flex-direction: column`. This is the same chain the
  Expand dialog already builds for `height: 'fill'`.
- **Plot fill:** `ChartCard` gets a `fill` prop, defaulting to on when `span === 6`. The Overview trend (§3.2) passes it
  explicitly. The plot wrapper `.loading-dim` (and the skeleton) becomes `flex: 1 0 auto; min-height: var(--chart-h);
  contain: size` with `--chart-h` = the configured height, and `EChart` receives `height="fill"`.
  - `contain: size` keeps the canvas from feeding back into the row's height, so a card that grew never ratchets the row: when
    the neighbour's Table closes, both shrink back.
  - Other span-12 cards are unchanged.
- **Footers:** the footer (`.chart-card-row-caption`) sits after the plot, so it ends on the card's bottom edge.
- **Spending › Trends:** both charts use the same configured height, and the card without controls reserves the controls
  row's height, so the two month axes start on one line. "All categories" mode spans the card to 12 columns (NWSP-08, NWSP-10).
- **Card detail:** the credits card beside the limit-history chart card ends with it (PCC-28). The non-chart partner stretches
  by the grid's default; its action row is pinned to the bottom.
- **Acceptance:** at 1280/1440/1920, both themes, paired cards' bottoms are equal within 1 px on all five surfaces, including
  after opening either card's Table and closing it again.

### 3.2 Overview

- **Primary band:** the elastic element is the Net worth trend, not "Changes worth understanding".
  - `.overview-wealth-column` rows become `1fr auto`, and the trend card fills (it passes §3.1's `fill`).
  - "Changes" is content-sized; the right column (Up next · Needs attention · Data status) is content-sized.
  - When the left column is taller (trend Table open), the right column's last card stretches and pins its note to its
    bottom — the only remaining stretch.
  - **Acceptance:** column bottoms equal within 1 px; the blank band under "Changes" ≤ 24 px (its padding).
- **Customize:** spans follow the order the user chose.
  - Two adjacent half-width cards pair; a half-width card whose neighbour is not half-width renders span-12. The rule is
    computed in `OverviewPage.tsx`, not hard-coded at :676/:706.
  - The popover's reflow animates with a short FLIP on `--t-fast` (none under reduced motion) (OU-16).

### 3.3 Settings — re-pair, then stretch

- **Supersedes** `.settings-page .card-grid { align-items: start }` (`SettingsPage.css`). Rows stretch (the grid default), and
  every Settings card is a column flexbox whose action row (`.settings-actions`, or the card's last form row) takes
  `margin-top: auto`, so paired cards end together and their buttons share a line.
- **Pairing rule:** partners' natural heights must be within 15% of the taller at 1440 and 1920 (real data); otherwise re-pair
  or go full width.

| Tab | Today | New |
|---|---|---|
| Household | Household (4) + Spending categories (8); Accounts (12, which also renders Portfolio accounts) | **Household (4) + Portfolio accounts (8)**, a new `PortfolioAccountsCard` extracted from `AccountsCard.tsx:632-700`, owner selects sized to content (`width: auto; min-width: 9rem; max-width: 14rem`); **Spending categories (12)**; **Accounts (12)** |
| Planning | Limits (6) + Plan assumptions (6) | Measured; kept if within 15% (both are forms of similar length), else full width |
| Account | Appearance (6) + Password (6) | Kept. Appearance's segmented pickers stop stretching into empty tails (`align-self: flex-start`, SGS-14) |
| Integrations | Price refresh (6) + Assistant (6); Calendar feed (12) | Price refresh's "Recent refreshes" becomes a one-run-per-line list (`.system-fact-list`, "Today 1:10 PM · 86 updated"; failures in the negative tone), and its facts go single-column inside the half-width card (SGS-10); then kept as a pair |
| Data | Import (12); Backups (6) + Restore (6); Health (6) + System (6); Activity (12) | Measured per pair. System's facts share one label column (`grid-template-columns: 9rem 1fr` on the `dl`), so values line up and "Last backup" stops wrapping beside empty space (SGS-11); System gains "Build" (§2) |

- **Acceptance:** at 1440 and 1920, both themes, every Settings row's cards end within 1 px of each other, and no card shows
  more than 96 px of blank band above its pinned action row.

### 3.4 Calendar

- `.cal-grid` gains `grid-template-rows: auto` (row 1 is the weekday header; `grid-auto-rows` keeps sizing the weeks)
  (PCC-04). **Acceptance:** the first week row starts ≤ 12 px below the weekday labels.
- The cash-flow strip is a tile row (§4).

### 3.5 Taxes › Tax tables

- The editors pack in two independent columns (a two-column flex of stacks, tables assigned alternately by estimated height),
  so a short table never leaves a ragged gap beside a tall one (TPC-12d).
- Two columns down to ~1000 px of page width; one below.

### 3.6 Portfolio › Allocation

- `.chart-card-with-aside` aligns the plot column to the centre of the row, and the aside list is capped at the plot column's
  height inside a `TableScroll`-style box with a pinned header (PE-20).
- The card height stops changing between Asset class / Industry / Geography / Account / Holding type (±1 px).

### 3.7 Meters

- Budgets: every `.budget-row` shares one column template (a fixed ~18ch amount column, or subgrid from the list), so every
  track ends on one x (NWSP-14). Empty tracks use `--fill` so an empty meter reads as a meter.
- Paycheck contribution pace: `.pace-row`s share their figure/verdict columns (subgrid from `.pace-rows`); the ESPP track ends
  with the others (TPC-22).

### 3.8 Guide master–detail

- On a numbered rail (Start here › Set up once, Routines), the detail gains a foot: "Step N of M · ← Previous · Next →"
  (buttons that select the neighbouring rail row, focus moving with the selection) (SGS-20).
- Un-numbered rails gain only "Next →".

---

## 4. Item 5 — tile rows read as one strip

### 4.1 Structure

The user's 2026-09-26 preview feedback replaces the original separate badge row with a badge beside the title.

- **Subgrid:** `.kpi-row` stays the grid. Each `.stat-tile` uses `display: grid; grid-row: span 3;
  grid-template-rows: subgrid; row-gap: 0`, with three children in order:
  1. the header (title and optional badge);
  2. the value;
  3. the delta (empty when none).

  Implicit rows are `auto`. The grid keeps its column gap; tile margins separate visual rows without a subgrid row gap.
- **Badge:** it stays at the header's top right, beside the title. There is no separate badge track or placeholder
  between title and value on unbadged cards. Long titles can wrap while the badge stays at the top right.
- **Value row:** `align-self: baseline`, so the first figure line of hero and normal tiles shares a baseline, even when
  the value has a unit line below it.
- **Wrapped tiles** (`CashflowStrip`'s `role="group"` wrappers): the wrapper spans 3 rows as a subgrid, and the tile inside does
  the same.
- **Spacing:** the tile's own padding and the 0.45 rem / 0.35 rem label and delta spacing are kept as margins inside the rows.

### 4.2 Five-tile rows

- **The generalized rule:** `.kpi-row-5` and `.kpi-row-dense` take Projection's local 3 + 2 rule (`ProjectionPage.css:56-60`).
  - From 660 px to 999 px of `@container page`: six tracks; tiles span 2, the 4th and 5th span 3.
  - At ≥ 1000 px: five columns (unchanged).
  - Below 660 px: two columns, with the odd last tile spanning (the existing 2-column rule).
- The Projection-local copy is deleted.
- **Acceptance:** no 4 + 1 or 2 + 2 + 1 at any width, dock open or closed.

### 4.3 Delta wording

- **Amounts:** tile deltas show whole dollars (the value keeps its cents).
- **Line breaks:** clauses are atomic (`white-space: nowrap` per clause), so a line breaks between "…since Sep 1" and
  "· 21 days", never inside "Sep 1" or "21 days".
- **Examples:**
  - Net worth hero: "▲ $126,583 (+15.7%) since Sep 1 · 21 days".
  - Overview Living spending: "▼ under $5,417 12-mo avg · Aug 2026" (was "under $5,417.48 previous 12-mo average · Aug 2026").
- **Acceptance:** at 1440, both themes, every delta on Overview, Net worth and Spending fits one line; the Net worth and
  Spending rows keep one height (±1 px) across every month the ribbon offers.

### 4.4 A real second line for bare tiles in mixed rows

| Page | Tile | New sub-line (data already on the page) |
|---|---|---|
| Spending | Savings rate — cash | "▲ 4.2 pts vs Jul" (previous month in the matrix; tone by direction, up is good; "No Jul to compare" when absent) |
| Spending | Net pay | "▲ $859 vs Jul" (same rule) |
| Projection | FI ratio | "$802K to go" (FI target − investable; "Target reached" at ≥ 100%) |
| Calendar | Scheduled in | "2 paydays" (count of payday events in the month; "Nothing scheduled") |
| Calendar | Scheduled out | "1 card fee" / "No fees due" |
| Taxes › Will I owe? | Projected tax | "27.3% effective" |
| ESPP | Market value | "NVDA $224.58" (the quote the strip already uses) |
| ESPP | Cost basis | "avg $54.14 / sh" (cost ÷ shares held) |
| Portfolio | Cost basis | "37 holdings" |

- **Rows left bare:** rows whose tiles are ALL bare stay bare (Credit cards, Taxes totals): they are consistent. "Realized
  gains" is left alone (out of scope).
- **Implementation audit:** the implementation audits every `.kpi-row` (26 sites) for mixed rows not listed here and applies
  the same rule.

### 4.5 Paycheck

- One tile row: Household take-home · Monthly net (follows the WHOSE chip) · Net pay per check · Employer match per check.
- The nested hero "Monthly net" tile inside the breakdown card is removed; the list keeps NET PAY as its total (TPC-01a/b).
- The page's skeleton reserves this row (it no longer shifts 119 px on arrival; TPC-04's tile half).

### 4.6 Skeletons

- `PageSkeleton` / `GhostTile` / `SkeletonTileRow` take the row variant (`five`, `dense`, `lone`) and draw subgrid ghosts
  (label, value, delta blocks in the same rows).
- Portfolio, Projection, Calendar and ESPP pass their variant, so a cold load lands without the 4 + 1 → 5-across jump
  (PE-09, MOTION-01's tile half).

---

## 5. Item 11 — every action answers where it was taken

### 5.1 Shared helpers (lane L4)

- **`revealEditor(form, focusSelector?)`:**
  - focuses and selects its first field (or `focusSelector`) with `preventScroll`;
  - then scrolls the form into view (`block: 'nearest'`, honouring the section's `scroll-margin-top` / `--sticky-inset`;
    instant under reduced motion, else smooth). Integrated Edge checks found that a native date field could cancel an
    already-started scroll; focus must come first (`b2b07a8e`).
- **`revealRow(row)`:**
  - inside a `TableScroll` box → `revealInBox`;
  - inside the older caps (`.settings-scroll`, `.categories-scroll`) → `ensureVisible` from `reorderDom.ts`;
  - else `scrollIntoView({ block: 'nearest' })`.
- **`useRowFlash()`:** `flash(key)` sets `data-flash` on the row for `--t-flash`; one CSS rule (generalized from reorder's
  `data-reorder-saved`, which keeps working).
- **`useEscapeCancel(ref, onCancel)`:** Esc inside the form cancels, unless an inner popover consumed it.

### 5.2 Edit into a form (18 surfaces)

- **Surfaces:**
  - Settings categories and accounts;
  - credit-card roster and reward categories;
  - Portfolio transactions, dividends and securities;
  - ESPP lots and offerings;
  - Paycheck profiles;
  - Comp focal events and RSU grants;
  - calendar custom-event edit (focus the title);
  - budget editor (focus the amount);
  - Set price (focus the price);
  - Household rename (focus + select; Enter saves; Esc cancels; its error under the box, cleared on Cancel);
  - Allocation targets;
  - Calendar "Your figure" (focus the amount).
- **Behaviour (D5):**
  - on Edit: `revealEditor`; the row gets `is-editing` (rules added where missing: Transactions, Dividends, Securities) and
    `aria-current="true"`;
  - on Cancel or Esc: leave edit mode, focus the row's Edit button;
  - on Save: focus the row's Edit button and `flash` the row.

### 5.3 Add a row

- **After a create:** the new row is revealed within its own list (`revealRow`) and flashed.
- **Repeat-entry forms** (transactions, dividends, ESPP lots, card credits) keep focus in the form's first field, as today;
  their lists are capped boxes, so the box scrolls and the page does not.
- **Single-add lists** (categories, accounts, cards, reward categories, securities, offerings, profiles, comp events, grants,
  custom events) move focus to the new row's Edit button.
- **Calendar:** a saved custom event lands on its day with focus on that day (bump `focusTick`) and the chip flashes.

### 5.4 Errors beside the control

- **Row actions** (Retire, Kind, Hide, Archive, Delete, Undo) report failures as a toast with the server's sentence. No row
  error goes to a card-top banner, so nothing shoves the table.
- **Form errors** render in the form's action row, beside Save:
  - `FeedBanner` moves from the card top to just above the actions;
  - a validation error that names a field focuses that field;
  - the message clears on the next edit of the form (the change handlers call `setError(null)` — the inventory's list of
    persisting messages).
- **Long forms with a sticky save bar (Tax Inputs):** the error shows in the bar, and a validation failure scrolls to and focuses
  the first invalid cell (TPC-06).
- **Budget editor:** errors render inside the editor under the amount (NWSP-15, WF-11).
- **Vest "Apply":** its error renders beside the chip.
- **Card detail's two forms:** errors render under their own form.

### 5.5 Things that open below the fold

- **Chart "Table":** on open, the table scrolls into view (`nearest`; smooth unless reduced motion) (MOTION-11).
- **Rewards matrix edit:** a sticky editor bar at the bottom of the matrix card (`position: sticky; bottom: 0`), holding:
  - "Editing {Category} × {Card}";
  - the multiplier / condition / cap fields (focused when a cell is picked);
  - "{n} cells changed";
  - Save multipliers and Cancel, which move here from the card header.

  Enter applies the cell; Esc returns focus to the cell. Cancel with drafts asks via `ConfirmPopover` ("Discard {n} changed
  cells?") (WF-06, PCC-31).
- **Activity "View report":** opens inline under its row (Disclosure-style), with the button reading "Hide report" and
  `aria-expanded` (SGS-18).
- **Taxes "Open Inputs" / "Open Tax tables":** pass the named cell as the section target (`tax-input-{cell}`); LocalSections
  focuses it, and it flashes (TPC-14).

---

## 6. Item 12 — save, delete and undo

### 6.1 Backend — change-log coverage (lanes L3a, L3b)

- **Recipe for every committing user-intent route in the six routers** (the 53 committing functions minus the exemptions
  below): `batch: ChangeBatch = Depends(change_batch)`, then:
  - creates: flush, then `record_insert`;
  - updates: `row_image` before the mutation, flush, then `record_update`;
  - deletes: `record_delete`, children first, parent last, using explicit ORM deletes and updates rather than relying on
    `ON DELETE`;
  - a human `label`;
  - `await batch.commit()`;
  - `X-Change-Batch` on the response: 204 via `Response(headers=batch_header(...))`; 200/201 via
    `response.headers.update(batch_header(...))`.
- **Delete imaging (the exact-undo cases):**

| Route | Imaged first (then deleted/updated explicitly) | Then |
|---|---|---|
| `portfolio.delete_security` | its `security_dividend_events`, `price_history` (hundreds of rows; the employer ticker ~780), `latest_prices` | the security |
| `credit_cards.delete_credit_card` | `reward_categories.pinned_card_id` → NULL (updates); its `card_credits`, `reward_rates` (by card), `credit_limit_events` | the card |
| `credit_cards.delete_reward_category` | its `reward_rates` (by category) | the category |
| `spending.delete_category` (existing, completed) | `reward_categories.spending_category_id` → NULL (updates); its `category_budgets` | the category |
| `net_worth.delete_account` (existing, completed) | components' `accounts.parent_account_id` → NULL, `credit_cards.account_id` → NULL (updates) | the account |

- **Reorders become logged** (`reorder_transactions`, `reorder_reward_categories`, `reorder_credit_cards`): `record_update`
  per changed row. Now that the tables' CRUD is logged, an unlogged reorder would let an older edit's undo silently move rows
  back. With it logged, OVERLAP_REFUSAL answers "undo those first". The clients' existing "Undo = re-send the previous order"
  toasts stay.
- **Bulk writes:** `put_reward_rates` records insert/update/delete per cell. `calendar.put_override` flushes and
  `db.refresh(override)` before imaging (server-generated `updated_at`).
- **EXEMPT** (listed with reasons in `tests/test_changelog_pin.py`):
  - `calendar.feed_ics` — machine bookkeeping on an unauthenticated route (no user for a batch).
  - `calendar.revoke_feed_token` — undo would revive a revoked credential.
  - Everything outside the six routers keeps its current status: `taxes.delete_year` / `put_brackets` / `clone_brackets` stay
    EXEMPT, and the price refresh / dividend ingest / backfills stay unlogged machine writes.
- **Existing logged routes that discard their batch id now return the header:** `create_account`, `update_account`,
  `create_category`, `update_category`, `put_category_budget` (for the kind-change and retire toasts).
- **Pin test:** the six modules join `LOGGED` with every user-intent function; the two exemptions join `EXEMPT`.
  `portfolio.update_classification` and `save_allocation_targets` (logged since 2026-09-13 but never pinned) become pinned.
- **Labels** read like the Activity card's existing ones, e.g.:
  - "Deleted security VOO"
  - "Deleted card Capital One Venture X"
  - "Added NVDA buy of Sep 2, 2026"
  - "Deleted the lot purchased Feb 29, 2024"
  - "Edited 3 reward multipliers"
  - "Hid {event}" / "Marked {event} done"
  - "Reordered 12 transactions"

  The Activity card's ⓘ copy lists the new kinds.
- **Accepted behaviours (documented, not fixed):**
  - An undo's whole-row image can revert refresh-owned columns on a security (annual dividend, ex-date); the next refresh
    restores them. `update_classification` already has this property.
  - Undoing a delete after the user re-created the same ticker, card name, lot date or auto dividend refuses with the existing
    REPLAY_REFUSAL sentence.
  - Undoing a security's *create* after a refresh wrote its prices refuses with DEPENDENT_REFUSAL.
  - OVERLAP_REFUSAL cannot see unlogged refresh writes.

### 6.2 Frontend — clients (lane L4)

- **Deletes:** every delete client of a logged route returns `{ batchId: string | null }` via `apiWithHeaders`. Today
  `deleteAccount`, `deleteCategory` and `deleteCategoryBudget` throw the header away.
- **One-click toggles:** retire/restore account and category, kind, archive card, hide reward category, calendar override
  (done/hidden/figure) return `{ data, batchId }`.
- Other creates/updates keep their signatures (their batches are reachable from Activity).

### 6.3 Frontend — primitives (lane L4)

- **`useDeleteWithUndo()`:**
  1. The row takes `data-leaving` (fade + height collapse over `--t-fast`; instant under reduced motion) and leaves the list
     optimistically.
  2. Focus moves to the next row's same control (previous if it was last; else the list's add control).
  3. The toast "Deleted {name}" carries Undo, which calls `undoBatch(batchId)`, reloads, then `revealRow` + `flash` +
     focus on the restored row.
  4. A failed delete puts the row back and toasts the server's sentence.
  5. A failed Undo toasts the refusal sentence (e.g. "Later changes touched these rows — undo those first").
- **`ConfirmPopover`:**
  - built on `.popover-surface` and `usePopoverDismiss`, anchored to its trigger;
  - props: title sentence, consequence line, danger button label, optional typed-arm (Restore only);
  - initial focus on Cancel; Esc or outside click cancels and returns focus to the trigger;
  - `.danger-button` becomes one shared rule (today duplicated in MonthlyUpdatePage.css and settings.css).
- **`BusyButton`:**
  - `aria-busy`, `aria-disabled` (not `disabled`) while busy, clicks ignored;
  - its idle width locked as `min-width`;
  - a small spinner before the unchanged label (or the busy label inside the locked width).
  - Siblings go `aria-disabled` without changing their labels.
- **`useSaveState({ dirty })` + `SaveStatus`:**
  - clean → the Save is `aria-disabled` with `title="No changes to save"`;
  - dirty → "Unsaved changes" beside it;
  - saved → "Saved ✓" for 2.5 s (a fade on `--t-fast`; instant under reduced motion);
  - error → the message beside it.
- **Test fence:** `window.confirm` / `confirm(` appear nowhere in `src/` outside tests.

### 6.4 Where the grammar lands (lanes L5–L7; the inventory's 42 destructive actions and ~45 save buttons)

- **Delete → instant + batch Undo (D2):**
  - transactions; dividends (auto rows included — their undo may refuse after a refresh re-created them);
  - securities (the `confirm()` goes); cards (their lossy re-create goes); reward categories; card credits; limit events;
  - accounts; categories; budget history rows;
  - ESPP lots, offerings and period "Reset";
  - paycheck profiles; comp events; RSU grants; custom calendar events.
- **ConfirmPopover:**

| Action | What it says |
|---|---|
| Restore snapshot | Keeps its typed date arm inside the popover; the `confirm()` goes |
| Apply import | Its long consequence sentence |
| Tax year delete | TaxYearMenu's in-popover arm restyled to the shared component |
| Remove / empty a bracket table | EXEMPT reference data |
| Revoke a feed link | "Calendars using it stop updating — this can't be undone" |
| Remove the assistant key | — |
| Remove a saved finding | — |
| Monthly update part delete | The typed arm goes; one click in the popover; Undo still offered |
| Re-seed budgets | The inline line becomes the popover; Undo still offered |
| Discard-unsaved guards | Taxes year/status switches and Brackets status tabs, anchored to the control that asked |
| Matrix Cancel with drafts | — |
| What-if "Apply N overrides" | Lists the changes; after it, a toast with Undo (put_inputs is logged) |
| Vest Apply with dirty Inputs | The guard only; the Apply itself is instant + Undo |

- **One-click toggles (D4):** category Kind ("Food & Dining is now Transfer — every month recalculated"), account/category
  Retire/Restore, card Archive/Unarchive, reward category Hide/Show, calendar Hide / Mark done. Each is optimistic, locks
  only its row, and shows a toast with Undo.
- **Saves (D3):** every Settings card; Tax Inputs (the bar reads "Saved just now" for 2.5 s instead of "No changes yet");
  Tax tables (a Save lit only for its dirty table); budget editor; roster / reward category / matrix / card detail forms;
  transactions / dividends / securities; ESPP lot / offering / model; paycheck profile; comp event / grant; custom event;
  Projection pin (disabled at 3/3 with the reason beside it, the typed name kept).
- **Busy on the right button:**
  - Monthly update's Review footer (Save progress vs Save and close); Balances/Spending (Save vs Confirm);
  - Limits (Clone vs Save); Assistant (Remove key vs Save); ESPP model (Reset vs Save & recalculate);
  - Allocation targets (Save draft vs Activate); Brackets (Clone vs tab switch).
- **Focus after every save, delete and Undo:** never `<body>`. Destinations as in §6.3 and §5.2.

---

## 7. Lanes and merge plan

| Wave | Lane | Owns | Needs |
|---|---|---|---|
| 1 | **L1 Layout + sidebar** (items 4 except Settings, 13) | ChartSurface, chartInteractions.css, ChartCard (fill, Table reveal), EChart if needed, OverviewPage primary band + Customize spans, SpendingPage Trends region, CalendarPage.css grid, taxes.css tables, Allocation aside, budgets.css, pace.css, Guide TaskDetail/GuidePage.css, Layout.css/.tsx, SidebarFooter, shell.css footer | — |
| 1 | **L2 Tiles** (item 5) | StatTile, panels.css tile rules, PageSkeleton, headline.ts, every page's kpi-row region (Overview, Net worth, Spending, Projection + its CSS, CashflowStrip, Portfolio, PositionStrip, WithholdingPanel, SummaryPanel, WhatIfPanel, DividendsPanel, VestingSchedulePanel, CreditCardsPage, EsppPage, Paycheck Summary + BreakdownPanel, MonthlyUpdate review-kpis) | — |
| 1 | **L3a Backend A** | portfolio.py, calendar.py, spending.py + net_worth.py completions, their tests, the pin test | — |
| 1 | **L3b Backend B** | credit_cards.py, espp.py, paycheck.py, comp.py, their tests, the pin test (merge by union) | — |
| 1 | **L4 Frontend primitives** | new `src/components/feedback/*` (ConfirmPopover, BusyButton, SaveStatus/useSaveState, useDeleteWithUndo, reveal/flash/escape helpers) + feedback.css; `src/api/*.ts` batch-id returns; the window.confirm fence test | backend header contract (§6.1) — tests mock the client |
| 2 | **L5 Settings** | every `src/components/settings/*`, SettingsPage (+ the Household/Integrations/Data layout of §3.3, PortfolioAccountsCard, System "Build") | L1–L4 merged |
| 2 | **L6 Portfolio · ESPP · Comp · Paycheck** | Transactions/Dividends/Securities panels, AllocationTargetEditor, ClassificationEditor, PortfolioPage actions, EsppPage (non-tile regions), CompPage, RsuGrantsPanel, PaycheckPage Profiles, TryItPanel | L1–L4 merged |
| 2 | **L7 Cards · Calendar · Taxes · Budgets · Monthly · Projection · Assistant** | CardsPanel, CategoriesPanel, RewardsMatrix (+ CreditCardsPage save), CardDetail forms, CalendarPage, AddEventForm, EventDetails, DayDrawer, InputsForm, BracketsEditor, WithholdingPanel Apply, WhatIfPanel apply, TaxesPage guards, TaxYearMenu, BudgetPanel, MonthlyUpdatePage (footers, part delete), SandboxPanel pin, AssistantEvidence | L1–L4 merged |
| 3 | **V Verification** | `tools/probes/polish-v/` and the fixes it finds | all merged |

**Shared files between wave-1 lanes:**
- `OverviewPage.tsx`: L1's primary band vs L2's tile text.
- `SpendingPage.tsx`: L1's Trends vs L2's tiles.
- `panels.css`: L1's chart/card-grid vs L2's tile section.
- `test_changelog_pin.py`: L3a vs L3b, merged by union.

Hunks are disjoint by construction; merges resolve by keeping both.

**Box rules:**
- Worktree `node_modules` are PowerShell junctions.
- Each lane's vite runs from its own worktree with a private `cacheDir`.
- Type-check worktrees with `npx tsc -p tsconfig.app.json --noEmit` (never `tsc -b`: shared build info through the junction).
- Backend lanes use the main checkout's venv with the lane's `backend/` as cwd, and their own test databases.
- Local Postgres URLs use `127.0.0.1`, not `localhost` (a new connection to `localhost` stalls ~2.1 s on this box).

---

## 8. Testing

- **Frontend (vitest):**
  - each primitive: ConfirmPopover focus/Esc/outside/trigger return; BusyButton keeps focus and width; useSaveState's
    transitions and 2.5 s expiry; useDeleteWithUndo's optimistic remove, failure put-back, Undo and focus destinations;
    revealEditor/revealRow/flash; useEscapeCancel;
  - StatTile's three-track structure and title-adjacent badge;
  - the kpi-row 3 + 2 rule (CSS text test beside the existing `*Css.test.ts`);
  - every converted surface (delete → toast → Undo calls `undoBatch` with the header's id; Edit → focus in the form; errors
    rendered beside Save);
  - the `window.confirm` fence;
  - the sidebar footer's single row.
- **Backend (pytest):**
  - per logged route: the `(op, table)` sequence, the label and `X-Change-Batch`;
  - exact-undo tests for every cascade delete in §6.1's table (delete → undo → identical rows, ids included, children and
    SET NULL links restored);
  - reorder logging plus OVERLAP_REFUSAL between a reorder and an older edit;
  - REPLAY_REFUSAL after a re-create;
  - the extended pin test.
- **Gates on merged main:**
  - `tsc -p` app + node clean;
  - eslint at or below the baseline;
  - vitest green;
  - `vite build` (the pre-existing tooltip-chunk advisory aside);
  - backend `pytest -n 4` green.

## 9. Verification (lane V) — a real browser on a fresh production copy

- **Environment:**
  - a read-only `pg_dump` of production restored into a private local database (plus a writable twin for the write paths),
    served from merged main on private ports;
  - headless Edge with classic scrollbars;
  - both themes at 1280×800, 1366×768, 1440×900, 1536×864, 1920×1080.
- **The probe (`tools/probes/polish-v/`)** asserts every acceptance line in §2–§6:
  - the sidebar fits;
  - chart pairs end within 1 px, Table open and closed;
  - Overview columns;
  - Settings rows;
  - the calendar header;
  - Allocation card height constant;
  - tile baselines, deltas on one line and row height constant across months;
  - no 4 + 1 anywhere (dock open or closed);
  - the last row's Edit focuses a field fully in view below the sticky block;
  - a new row is in view and flashed;
  - errors in the viewport within 200 px of their control (or in the sticky bar);
  - delete → row gone before the toast → Undo → identical row (ids compared over the API on the writable twin);
  - `document.activeElement` never `<body>` after a save, delete or Undo;
  - no `dialog` event (native confirm) ever fires;
  - a clean console;
  - CLS < 0.1 on every route.
- **Before/after:** it records the audit's before-numbers (§0) beside the after-numbers in its report.

## 10. Rollout

- Local main only. The user pushes and deploys, rebuilding both images (backend and frontend), with no migration.
- Undo reaches back only to writes made after the deploy: the new routes start logging at deploy. Older rows have no images,
  so they can't be undone.
