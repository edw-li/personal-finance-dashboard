# Taxes · Paycheck · Comp — polish findings

Pages/areas covered (dark + light at 1440×900; spot checks at 1920×1080 and 1280×800):
- **Taxes** (/taxes): Summary, What-if, Inputs and Tax tables tabs (switch films); all four YEAR chips 2023–2026 (cached and
  uncached, from the top, from the waterfall, from Marginal rates, from Composition); "Filing status … Change…" popover
  (opened, radios, Escape); "New tax year…" popover (opened, not saved); Totals tiles + By-jurisdiction table; the
  "Where … gross income went" waterfall (hover sweep of every step, 2023–2026); Will I owe? (tiles, Your inputs vs your
  records table, RSU **Apply** (fenced), **Open Inputs**, Partner — simulated, "How this is estimated" fold open/close);
  Marginal rates (hover, both themes, zoom); Tax composition by year (hover, click → docked "Tax year 2025" panel + donut,
  1440 and 1920); What-if (first-visit arrival ×3, presets Max 401(k) / Sell all NVDA, sale leg + override editors, pin,
  compare table); Inputs (typing, live derived lines, sticky save bar, Ctrl+Enter save (fenced), client validation error,
  year switch with unsaved work); Tax tables (both status tabs, typing a threshold, save-button states).
- **Paycheck** (/paycheck): Summary (cold load, in-app arrival, WHOSE Edward ↔ Grace films, per-check breakdown, sankey
  node/link hover, Contribution pace hover + keyboard focus), Try changes (presets, slider drag, compare table),
  Profiles (cold deep link, form, history table, Edit → Save profile/Cancel, not saved).
- **Comp** (/comp): Summary (chart hover), Vesting (chart, table, row expand), Manage (both forms, Edit → Save event, not
  saved); tab switches between all three.

Scripts: `SCRATCH/work-taxes-paycheck-comp/*.mjs` · shots: `SCRATCH/shots/taxes-paycheck-comp/`. Evidence paths are
relative to SCRATCH; bare names after the first path on a line live in the same `shots/taxes-paycheck-comp/` folder.
IDs: TPC = taxes-paycheck-comp.

## Findings (most impactful first)

### TPC-01 · Paycheck Summary: a lone tile, a card inside a card, and a flow card that stops 95px short
- Where: Paycheck › Summary (`/paycheck`) · all themes/widths
- What happens: (a) **Household take-home** sits alone on its own row: a 320px tile in a 1,151px row, 831px of empty
  space beside it (lead 1). (b) Directly under it, the **Per-check breakdown** card contains a second bordered tile,
  **Monthly net** (320px wide inside a 568px card — a box in a box, lead 2). That nested figure is set larger (31.7px, hero
  style, with a count-up) than the household total above it (21.5px), so a per-person sub-figure out-shouts the page's
  headline, and Edward's $7,136.72 is printed twice (household tile sub-line + nested hero). (c) The breakdown and
  "Where each check goes" share a grid row (588px), but the flow card's visible box is only 493px tall — its bottom edge
  ends 95px above its neighbour's (97px at 1920, 108px at 1280).
- Evidence: shots/taxes-paycheck-comp/paycheck-summary-dark-1440-full.png · tour-light-1440/paycheck-full.png ·
  tour-dark-1280/paycheck.png (gaps(): `chart-card-slot contentBottomGap 94`)
- Cause: `src/pages/PaycheckPage.tsx:1468-1492` (household tile in its own `.kpi-row.kpi-row-lone`, capped at 320px by
  `panels.css:91`); `PaycheckPage.tsx:110-127` (the nested `hero` Monthly-net tile inside `BreakdownPanel`);
  `ChartSurface.tsx:45` + `chartInteractions.css:1` — the grid item is `.chart-card-slot` (stretched), but the class-less
  host div and the `section.card` inside it keep their content height.
- Polish: make one KPI row at the top of Summary — *Household take-home* · *Monthly net (follows the WHOSE chip)* ·
  *Net pay per check* · *Employer match per check* — and drop the nested tile from the breakdown card (the list keeps
  NET PAY as its total). Let span-6 chart cards fill their grid cell (`.chart-card-slot{display:flex;flex-direction:column}`,
  host `flex:1`, `.chart-card{flex:1}`), letting the sankey grow or pinning its caption to the bottom.
- Impact: the first screen of Paycheck reads as a clean row of equal tiles over two even-height cards instead of a
  stray tile, a box-in-a-box and ragged columns; the page's headline figure becomes the biggest number.
- Size: M · Confidence: high

### TPC-02 · Taxes: picking the current year throws you ~1,000px away from the card you were reading
- Where: Taxes › Summary › YEAR chips (`/taxes?year=2025` → 2026) while reading Marginal rates or Tax composition
- What happens: with Marginal rates at the top of the viewport (y=104) on 2025, clicking **2026** in the sticky year row
  leaves Marginal rates at y=1,149 — off-screen; you land mid-way through the "Your inputs vs your records" table
  instead. Same from Tax composition (y=388 → 1,270). The reverse (2026 → 2025) keeps the card in place, so the jump
  only happens one way. The inserted card also arrives in two steps: a 148px "Loading…" line, then 1,023px.
- Evidence: shots/taxes-paycheck-comp/film-2025to2026-from-composition-dark-1440/00--107ms.jpg → 08-216ms.jpg ·
  taxes-anchor-after-2026-dark-1440.png (script t16-anchor.mjs: `2025 marginal top 104 → after 2026 marginal top 1149`)
- Cause: `src/pages/TaxesPage.tsx:965-974` mounts the Will I owe? card only for the current year, above Marginal rates;
  `WithholdingPanel.tsx:592` renders a plain "Loading…" and then the full card. Browser scroll anchoring only
  compensates the first 138px (the Totals card growing) — likely because the cards' scroll-linked reveal transforms are a
  scroll-anchoring suppression trigger.
- Polish: on a year-chip click, pin the first card in view with the existing `holdPosition()` helper
  (`components/shell/holdPosition.ts`) until the withholding feed lands, and give the card a skeleton sized to its last
  height (or keep its last payload per year in the snapshot cache like the year detail).
- Impact: flipping years to compare a card stays a comparison — the chart you were reading stays under your eyes.
- Size: M · Confidence: high

### TPC-03 · "Where … gross income went": most steps are slivers or labels floating over nothing
- Where: Taxes › Summary › waterfall (`/taxes`) · every year, both themes
- What happens (lead 3): 8–9 steps across a ~1,015px plot, each bar capped at 24px wide (≈20% of its slot) on a $0–$350K
  axis 252px tall. For 2026: Medicare $5.1K draws 3.7px, SDI $3.1K 2.2px, Cap. gains $0 nothing; for 2025 Cap. gains $190
  and NIIT $419 are labels with no bar under them. The tooltip only answers on the 24px bar or its label (e.g. 8 of 84
  hover probes on the Medicare column), so the small taxes are hard to hover as well as to see.
- Evidence: shots/taxes-paycheck-comp/taxes-waterfall-dark-1440.png · taxes-waterfall-2025-dark-1440.png ·
  tour-light-1440/taxes-full.png
- Cause: `src/charts/waterfall.ts:82-96` (`barMaxWidth: 24`, no minimum height, item tooltip at 104-116);
  `SummaryPanel.tsx:313-322` (a 320px full-width card for 8–9 values).
- Polish: widen the steps to fill their slot (e.g. `barCategoryGap: '40%'`, or a cap of ~64px when there are ≤ 12
  categories), give non-zero steps a visible floor (`barMinHeight: 3`), draw thin connector lines from each step's end to
  the next start, use a column-wide hover (axis trigger that ignores the placeholder) and trim the height to ~260px.
  Alternative: one horizontal "of every $1 of gross" bar, labelled.
- Impact: every tax becomes a readable, hoverable shape; the card stops reading as an empty plot with two tall bars.
- Size: S (the widths/min-height/hover) – M (connectors) · Confidence: high

### TPC-04 · Paycheck's loading ghost doesn't match the page — 119px shift on every arrival, 660px on a Profiles link
- Where: Paycheck arrival (`/paycheck`, sidebar link or reload); direct link/reload of `/paycheck?section=profiles`
- What happens: the ghost is one full-width 720px card at y≈180. When the household feed answers, the Household tile
  appears above it and pushes the ghost and then the content down 119px (CLS 0.054 at 1440; 0.045 at 1920; 0.057 at
  1280). On a Profiles deep link it is worse: the page shows the **Summary's** 720px breakdown ghost plus a Profiles ghost
  below it; the Summary ghost then vanishes and the Profiles form jumps up ~660px (CLS 0.30, two runs, both themes).
- Evidence: shots/taxes-paycheck-comp/film-paycheck-arrive-dark-1440/03-238ms.jpg → 06-393ms.jpg ·
  film-profiles-coldload-dark-run1/06-771ms.jpg → 11-1111ms.jpg
- Cause: `PaycheckPage.tsx:1468-1470` (household tile rendered outside the Feed, only once its own feed lands, above the
  ghost); `PaycheckPage.tsx:1494-1505` (the breakdown `<Feed>` sits outside the section panels, so its skeleton renders on
  the Profiles tab too); ghost height `skeletonMetrics.ts:71` is one card, while the page is a tile row + two half cards.
- Polish: reserve the household row in the ghost (a tile-row placeholder when the household has 2+ people, or render the
  tile row inside the same Feed), shape the ghost as two half-width cards, and skip the breakdown ghost when the active
  section is Profiles.
- Impact: Paycheck lands in place instead of lurching; a bookmarked Profiles link opens straight onto the form.
- Size: S–M · Confidence: high

### TPC-05 · Tax Inputs: the Save button leaps 481px sideways on the first keystroke
- Where: Taxes › Inputs › sticky save bar (`/taxes?section=inputs`)
- What happens: clean, the bar reads "No changes yet … [Save inputs]" with Save at the right edge (x=1,255). Type one
  character and the bar gains "Ctrl + Enter" at the right and Save jumps to the middle (x=774) — 481px at 1440, 721px at
  1920, light and dark. The one control you are about to reach for moves as soon as it becomes relevant.
- Evidence: shots/taxes-paycheck-comp/taxes-inputs-dirty-dark-1440.png · taxes-savebar-dirty-light-1440.png ·
  taxes-open-inputs-landing.png (clean state, Save at right)
- Cause: `src/pages/MonthlyUpdatePage.css:140-144` — the wizard's global `.entry-footer{justify-content:space-between}`
  (loaded app-wide once `warmAllRoutes` fetches that chunk) also styles the Taxes bar, which reuses the class name
  (`InputsForm.tsx:859`); the third child only exists while dirty (`InputsForm.tsx:869-873`).
- Polish: pin the button: `margin-left:auto` on Save with the shortcut hint before it (or always render the hint,
  greyed while clean), and scope the wizard rule to the wizard.
- Impact: the primary action stays where the eye and pointer expect it; no chasing the button.
- Size: S · Confidence: high

### TPC-06 · Tax Inputs: pressing Save in the sticky bar shows its error 1,181px above, out of sight
- Where: Taxes › Inputs, scrolled to the lower sections, Save in the sticky bar
- What happens: type "abc" in *Other Capital Gains* (bottom of the form) and press **Save inputs** → the only message,
  "Enter a number for: Other Capital Gains", is rendered at the top of the card, 1,181px above the viewport. On screen
  nothing changes; the bar still says "1 change to save". A failed save does the same (seen with the audit fence's 503 —
  the fence itself is not the finding, where its message appears is).
- Evidence: shots/taxes-paycheck-comp/taxes-inputs-validation-from-bottom-dark-1440.png (script t11: `top:-1181, inViewport:false`)
- Cause: `InputsForm.tsx:678` (the form's only `FeedBanner` sits above the first section) fed by `submit()` at ~463-470
  and the save `.catch` at ~516.
- Polish: show save/validation errors inside the sticky bar (it is always in view), and on a validation failure scroll
  to and focus the first invalid field.
- Impact: Save always answers where it was pressed; no silent "nothing happened".
- Size: S · Confidence: high

### TPC-07 · Comp and Tax composition charts: three or four 24px sticks across a 1,100–1,590px plot
- Where: Comp › Summary "Base + unvested equity value" (`/comp`); Taxes › Summary "Tax composition by year"
- What happens (lead 4): Comp draws 3 focal years as 24px bars in ~338px slots at 1440 (≈7% fill) and ~500px slots at
  1920 (≈5%); the total-comp line between them does most of the visual work. Tax composition draws 4 years the same way.
  At 1920 the Comp page is one wide, mostly empty chart plus 350px of bare page below it.
- Evidence: shots/tour-dark-1440/comp-full.png (the shared tour) · shots/taxes-paycheck-comp/tour-dark-1920/comp.png ·
  taxes-card5-dark-1440.png
- Cause: `compChartOptions.ts:83` and `taxChartOptions.ts:268,288` — `barMaxWidth: 24`, the chart grammar's cap
  (`charts/grammar.ts:3-4,175-181`) that suits 12–36 monthly bars, applied to 3–4 categories.
- Polish: scale the cap with the category count (e.g. up to 56–72px when there are ≤ 6 categories) and/or give these
  cards less width (Comp: chart span-8 beside a small focal-years table — base, raise %, equity — span-4).
- Impact: year-over-year comp and tax mixes read as solid, comparable blocks instead of pins on a line.
- Size: S (width) – M (layout) · Confidence: high

### TPC-08 · Switching tax years slides the table's columns 143px and moves "Change…" 104px
- Where: Taxes › Summary › By jurisdiction; scope row (`/taxes`, 2026 ↔ 2025/2024/2023)
- What happens: 2026 (two earners) has indented per-person rows ("Edward capped at $184,500.00 DEFAULT"), so its first
  column is wider: Base's right edge sits at x=872 in 2026 vs 729 in 2025 (−143px), Taxable 1,054 vs 964, Tax 1,223 vs
  1,181. Flipping chips to compare years makes every figure jump sideways. In the scope row, "Filing status: Married
  filing jointly · Change…" vs "Single · Change…" moves the button 104px (785 ↔ 681).
- Evidence: shots/taxes-paycheck-comp/taxes-summary-dark-1440-top.png vs film-year-2025-top-dark-1440/04-241ms.jpg
  (script t4-yearcols.mjs)
- Cause: `SummaryPanel.tsx:171` (auto-layout `.data-table`, widths follow content of rows 197-233);
  `FilingStatusMenu.tsx:131-147` (button placed right after the status text).
- Polish: `table-layout: fixed` with fixed numeric column widths on this table; put the status on its own fixed-width
  slot (or the Change… button before the text).
- Impact: flipping years becomes a true side-by-side comparison — numbers change in place instead of sliding.
- Size: S · Confidence: high

### TPC-09 · What-if tab opens in three stages; the whole results block drops 61px mid-arrival
- Where: Taxes › What-if, first visit (`/taxes?section=whatif`)
- What happens: 3/3 runs: a skeleton appears, then the Δ tiles paint at y=384 beside "Loading holdings, ESPP lots and
  limits…", then ~35ms later the preset chip row pops in above and everything drops to y=445. The empty state then says
  "nothing" three times: a centred "No legs yet…", a 194px "Δ by jurisdiction — Nothing moved" card and "Inputs this
  scenario moved — Nothing moved", over a compare table of $0.00 deltas.
- Evidence: shots/taxes-paycheck-comp/film-tab-whatif-dark-1440/03-199ms.jpg, 05-322ms.jpg, 07-381ms.jpg ·
  taxes-tab-whatif-dark-1440-full.png
- Cause: `WhatIfPanel.tsx:452` (`presets={holdings === null ? null : <PresetRow/>}` — the row is omitted, not reserved,
  until the holdings feed lands); results Feed renders independently (`SandboxPanel.tsx:96-106`).
- Polish: reserve the preset row's height (ghost chips) from the first paint; while the scenario is empty, collapse the Δ
  chart and compare table into one empty state whose call to action is the preset chips.
- Impact: the tab settles once, and the empty sandbox reads as an invitation rather than three zeros.
- Size: S · Confidence: high

### TPC-10 · What-if editors: a sale leg spread over 268px, internal keys in the picker, headings glued to tables
- Where: Taxes › What-if with a leg (`/taxes?section=whatif&whatif=sale:47:…&whatif=trad_401k_contributions:24500.00`)
- What happens: (a) the sale leg's three short lines (ticker+shares / price+term / held+Remove) sit ~90px apart
  (y=320, 411, 501) because its box is stretched to the height of the overrides column beside it. (b) The override picker
  reads "Traditional 401k Contributions (trad_401k_contributions)" in monospace in a 260px box, so it shows
  "Traditional 401k Contributio" and exposes a snake_case key. (c) "SALE LEGS" and "INPUTS THIS SCENARIO MOVED" start
  0px under the compare table's last row.
- Evidence: shots/taxes-paycheck-comp/taxes-whatif-nvda-dark-1440-full.png (scripts t22-legs.mjs, t17-whatifspacing.mjs)
- Cause: (a) `taxes.css:363-368` `.whatif-form` is a wrapping flex box with default `align-content` inside the stretched
  `.sandbox-controls` grid (`sandbox.css:17-22`); (b) `WhatIfPanel.tsx:919` `{d.label} ({d.key})` + `.field-input` mono;
  (c) `taxes.css:55-57` `.tax-section` only has a bottom margin (`WhatIfPanel.tsx:575-577, 639-640`).
- Polish: `align-content:flex-start` (or `align-self:start`) on the leg forms; option text = label only, grouped with
  `<optgroup>` by the Inputs sections, proportional left-aligned font; add a top margin to `.tax-section` after a table.
- Impact: the sandbox's editors read as tidy, labelled rows instead of floating fragments and developer keys.
- Size: S · Confidence: high

### TPC-11 · Paycheck "Try changes": the answer is below the fold while you drag, and numbers show raw
- Where: Paycheck › Try changes (`/paycheck?section=changes`)
- What happens: the sliders sit at y≈290–540; the outcome rows (**Net pay**, Payroll savings) are at y≈1,093, below a
  900px viewport — drag Traditional 401(k) and you see Gross/401(k)/Dental/HSA change, not the net. The boxes show raw
  placeholders ("188930.00", "100.00") beside formatted chips ("actual $188,930.00"); withholding shows
  "29.4978927" / "actual 29.4978927%" (the chip wraps to two lines at 1920; the Profiles form shows 29.4978927% too). The
  compare table's columns also slide 13–58px the moment the first Δ appears.
- Evidence: shots/taxes-paycheck-comp/paycheck-tryit-after-slider-dark-1440.png · tour-dark-1920/paycheck-changes.png ·
  paycheck-tryit-dark-1440-full.png
- Cause: `SandboxPanel.tsx:96-106` (presets → knobs → compare stacked); `sandbox/SliderBox.tsx:67-69,176,193`
  (`display()`/placeholder shift the wire decimal without rounding or currency formatting).
- Polish: at ≥1280px lay the card out as knobs (left) + a sticky compare column (right), or add a sticky one-line
  "Net pay $3,568 → $2,901 (−$667) · Payroll savings +$1,614" strip at the card top; format placeholders like the chips
  and round percentages to 2 dp for display; fix the compare table's column widths.
- Impact: the sandbox becomes a live instrument — you see the effect of the slider while your hand is on it.
- Size: M · Confidence: high

### TPC-12 · Tax tables: seven always-lit Save buttons, every figure printed twice, a clipped threshold
- Where: Taxes › Tax tables (`/taxes?section=tables`)
- What happens: (a) 7 blue primary **Save** buttons are enabled with nothing changed, and stay so after editing one
  table — unlike Inputs, whose Save is disabled until there is a change. (b) Every threshold box has a small echo of the
  same value under it ("$24,800.00" / "$24,800.00"), doubling the rows; the echo disappears while typing a form it can't
  parse ("25k"), so the row shrinks under the cursor. (c) State bracket 9's "$1,485,906.00" is clipped to
  "$1,485,906.(" (108px box, 121px text). (d) Two columns with different row counts leave 123–142px ragged gaps; at 1280
  the grid falls to one column of 560px tables with ~410px empty beside them (page 1,848 → 2,900px).
- Evidence: shots/taxes-paycheck-comp/taxes-tab-tables-dark-1440-full.png · taxes-tables-typing-dark-1440.png ·
  tour-dark-1280/taxes-tables.png (script t12-tables.mjs: 7 enabled Saves, 26 Remove buttons)
- Cause: `BracketsEditor.tsx:723-733` (Save disabled only while saving); `BracketsEditor.tsx:176-184` (echo always
  rendered, empty when unparseable); `taxes.css:259-264, 278-280` (auto-fill 480px columns, `align-items:start`,
  560px tables).
- Polish: enable/colour each Save only when its table is dirty (show "Saved" otherwise); show the echo only while the box
  is focused and its text differs from the canonical value, in a reserved line; widen threshold boxes to fit 7 digits +
  cents; pack the tables in independent columns (CSS columns/masonry) and allow two columns down to ~1,000px.
- Impact: a calmer editor where the one table you changed is obviously the one to save, and ~⅓ less scrolling.
- Size: M · Confidence: high

### TPC-13 · Composition drill-in: the donut's labels truncate to "S…", "M…" and "…"
- Where: Taxes › Summary › Tax composition by year › click a year → docked "Tax year 2025" panel (`/taxes?comp=2025`)
- What happens: in the 400px dock (1440) the donut labels read "NIIT 0.46%", "Cap. gains…", "SDI 2.…", "Soc…", "M…",
  "S…" and, for the biggest slice (Federal, ~57%), just "…". At 1920 (499px dock) still "Federal …", "Medicare 5…",
  "Soc. Sec. 12.…". Also "Clear selection" wraps alone onto a second row at 1440.
- Evidence: shots/taxes-paycheck-comp/taxes-dock-pie-light-1440.png · taxes-dock-pie-dark-1920.png ·
  taxes-composition-selected-dark-1440.png
- Cause: `taxChartOptions.ts:321-326` (`radius ['42%','70%']`, outside labels `'{b}  {d}%'`) in a narrow host.
- Polish: in narrow hosts drop the leader-line labels and put a compact legend list under the donut (name · % · $), or
  let labels wrap (`overflow:'break'`, `alignTo:'edge'`).
- Impact: the drill-in actually answers "how was 2025's tax split?" instead of showing ellipses.
- Size: S · Confidence: high

### TPC-14 · "Open Inputs" lands at the top of the form, not on the line it names
- Where: Taxes › Summary › Will I owe? › Your inputs vs your records › any **Open Inputs**
- What happens: "Open Inputs — HSA (paycheck), Grace" switches to Inputs at scrollY 0 with focus on `<body>`; the HSA
  row is at y=1,363, 1.5 screens down, in the other person's column — the user hunts for it.
- Evidence: shots/taxes-paycheck-comp/taxes-open-inputs-landing.png (script t20: `scrollY 0`, row at 1363)
- Cause: `WithholdingPanel.tsx:313` → `TaxesPage.tsx:827` `goTo('inputs')` passes no target.
- Polish: pass the cell as the section's target (LocalSections already scrolls/focuses `#id` targets): scroll the exact
  box `tax-input-<cell>` under the sticky row, focus it and flash the row (the form's `pasted-flash`).
- Impact: one click from "this differs" to the exact box to fix.
- Size: S · Confidence: high

### TPC-15 · Tax Inputs: long labels ellipsised beside 330px of empty card; computed lines change silently
- Where: Taxes › Inputs (`/taxes?section=inputs`)
- What happens: "Pay periods (semi-monthly periods in the whole year — 24 for a full year, including those still to
  come)" shows 345 of 592px, "Sec 199A QBI deduction (20% of qualified REIT/PTP dividends)" is cut 15px short — while
  each row ends at x=1,042 and the card continues to x≈1,372. When you type, the derived lines (Gross Paycheck, Latest W2
  Income …) update ~400ms later with no cue, sometimes out of view.
- Evidence: shots/taxes-paycheck-comp/taxes-inputs-dirty-dark-1440.png · taxes-inputs-validation-from-bottom-dark-1440.png
- Cause: `taxes.css:96-102, 116-119` (`nowrap` + ellipsis, label track capped at 40ch); `InputsForm.tsx:425-437`
  (preview replaces figures without marking them).
- Polish: let labels wrap to two lines (or move the long explanation into an InfoHint); briefly highlight derived
  figures that changed (reuse `pasted-flash`).
- Impact: every label is readable and the "computed lines follow their components" promise becomes visible.
- Size: S · Confidence: high

### TPC-16 · Profile / focal-event edit: two-line primary buttons and a field 18–33px out of line
- Where: Paycheck › Profiles (Edit a row) and Comp › Manage (Edit an event)
- What happens: in edit mode "Save profile" / "Save event" wrap onto two lines (54px tall, 72px wide) next to a
  one-line 36px "Cancel", at 1280, 1440 and 1920. In the Employer HSA fieldset the third box ("Additional individuals
  covered") sits 18px (1440) / 33px (1920) higher than its two siblings. Edit also fills the form without scrolling or
  focusing it. The Comp edit form shows prices as raw "89.6600" next to "$145,000.00".
- Evidence: shots/taxes-paycheck-comp/paycheck-profile-edit-dark-1440.png · comp-manage-edit-1440.png ·
  paycheck-profiles-dark-1440-full.png (scripts p11-savewrap.mjs, p8-profileform.mjs)
- Cause: `PaycheckPage.css:125-131,154-158` and `CompPage.css:33-39` (actions confined to one 150px auto-fit cell);
  `PaycheckPage.css:238-242` (`.paycheck-count-field` stacks box + note, so the box rises); `PaycheckPage.tsx:482-485`
  (`startEdit` only sets state).
- Polish: let the actions cell span 2 columns (or `white-space:nowrap`), put the note below the grid row instead of
  inside the cell, and on Edit scroll the form into view and focus its first field (as a seeded mount already does).
- Impact: edit mode looks deliberate and aligned instead of cramped.
- Size: S · Confidence: high

### TPC-17 · Table headers switch typeface mid-row; money in two fonts in one row
- Where: every data table in the lane (By jurisdiction, Your inputs vs your records, What-if/Try-changes compare,
  Profiles history, Focal history, RSU grants, Vesting) — app-wide rule
- What happens: numeric column headers render in monospace ("TAX  EFFECT", "EFF.  RATE", "CURRENT  BASE" with wide gaps)
  while text headers ("LINE", "YEAR", "NOTES") are proportional. In Will I owe?, "Your inputs"/"Your records" money is
  proportional ($184,441.67) while Difference/Tax effect money in the same row is monospace.
- Evidence: shots/taxes-paycheck-comp/taxes-card3-dark-1440.png · comp-manage-dark-1440-full.png
- Cause: `components/panels.css:244-248` (`.data-table .num` sets the mono font on `th` as well as `td`);
  `taxes.css:580-582` (`.recon-figure` proportional).
- Polish: keep right alignment but inherit the header font (`.data-table th.num{font-family:inherit}`); give money
  figures in the reconciliation one face.
- Impact: calmer, consistent headers across every table; figures in a row compare at a glance.
- Size: S · Confidence: high

### TPC-18 · Will I owe?: a one-click write with no preview or undo, its error 480px away; uneven tiles
- Where: Taxes › Summary › Will I owe? (`/taxes`, 2026)
- What happens: the RSU row's **Apply** writes $120,000.00 → $170,325.76 to the stored return immediately (no preview,
  no confirmation unless Inputs is dirty, no toast/Undo on success — read in source; the write was fenced here). Its
  failure message appears under the Partner block, ~480px below the button. Of the three tiles only *Projected tax* has
  no sub-line, and "$79,781.62 so far" is repeated in the line under the tiles. Seven identical "Open Inputs" chips form
  a column of noise.
- Evidence: shots/taxes-paycheck-comp/taxes-apply-fenced-dark-1440.png · taxes-card3-dark-1440.png
- Cause: `WithholdingPanel.tsx:446-470` (`writeVestIncome` PUTs on click), `:859` (error position),
  `TaxesPage.tsx:588-595` (no toast); tiles at `WithholdingPanel.tsx:601-625`.
- Polish: show "RSU income $120,000 → $170,326 · Apply / Cancel" inline, then a toast with Undo (the filing-status change
  already does this); render the Apply error in the row; give Projected tax a sub-line (e.g. "27.3% effective") and drop
  the duplicate "so far"; show "Open Inputs" on row hover/focus only.
- Impact: a money-changing action gets the same safety and clarity as the rest of the app; the card reads cleaner.
- Size: S–M · Confidence: medium (success path fenced; verified in source)

### TPC-19 · Saves elsewhere in the lane end in silence
- Where: Taxes Inputs "Save inputs", Tax tables "Save", What-if "Apply N overrides", Paycheck "Add/Save profile",
  Comp "Add event/Save event"
- What happens: on success the only change is the button returning to its idle label (and fields re-seeding); there is
  no "Saved" confirmation or Undo — while the filing-status change and a grant delete on the same pages show a toast with
  Undo. (Success paths could not be exercised here — writes are fenced; read in source.)
- Evidence: `grep toast.` finds calls only in `TaxesPage.tsx:482-535` and `RsuGrantsPanel.tsx:267-284`;
  shots/taxes-paycheck-comp/taxes-inputs-save-fenced-dark-1440.png (fenced save — the form's only feedback surface is
  the banner at the top of the card)
- Cause: `InputsForm.tsx:490-513`, `BracketsEditor.tsx:599-632`, `TaxesPage.tsx:575-595`, `PaycheckPage.tsx:660-688`.
- Polish: a short success toast ("Saved 2026 inputs · Undo" where the change log allows) plus a subtle flash on the rows
  that changed.
- Impact: every save is acknowledged the same way; users stop re-checking whether it took.
- Size: S–M · Confidence: medium

### TPC-20 · Marginal rates: the "you are here" diamond nearly disappears; the axis runs to $1.8M
- Where: Taxes › Summary › Marginal rates (`/taxes`)
- What happens: the ◆ marking your taxable income is 11px, white on the pale current bracket (dark) and near-black on
  the navy current bracket (light) — the one mark that answers the card's question is the least visible. The axis runs to
  $1.80M, so your brackets occupy the left ~15% of a 1,100px ladder.
- Evidence: shots/taxes-paycheck-comp/taxes-ladder-zoom-dark.png · taxes-ladder-zoom-light.png
- Cause: `taxChartOptions.ts:392-401` (colours, 15% headroom past the top floor), `:471-487` (diamond `symbolSize 11`,
  `INK`).
- Polish: give the marker a surface-coloured outline (or a full-height tick with a "$258.7K" label); cap the axis near
  ~2× the higher taxable income and draw the top brackets as "and up".
- Impact: "which bracket am I in, and how close is the next?" answered at a glance.
- Size: S · Confidence: high

### TPC-21 · Vesting table: date rows snap open, with no chevron
- Where: Comp › Vesting (`/comp?section=vesting`) › click a date (e.g. Dec 16, 2026)
- What happens: four tranche rows appear in one frame (only a 120ms row background transition); nothing on the row
  signals it can open — the only hint is a sentence above the table. Expanded future tranches show "—" in Value while
  their parent shows $47,610.96 est.
- Evidence: shots/taxes-paycheck-comp/comp-vest-row-expanded.png (script c2-vestrow.mjs)
- Cause: `VestingSchedulePanel.tsx:31-66` (rows mounted/unmounted, no motion; value "—" at line ~91), while the
  Dividends table already has a row glide (`components/portfolio/dividends.css:55-`).
- Polish: add a chevron in the date cell and reuse the dividends glide; show est. values on future tranches so the
  children add up to the parent.
- Impact: the table's one interaction becomes discoverable and feels like the rest of the app.
- Size: S–M · Confidence: high

### TPC-22 · Contribution pace: the ESPP meter ends 27px short of the others
- Where: Paycheck › Summary › Contribution pace
- What happens: the 401(k), 415(c) and HSA tracks end at x=1,098; ESPP's ends at 1,071 (1,578 vs 1,551 at 1920; 938 vs
  911 at 1280), so the "100%" ends of the meters don't line up.
- Evidence: shots/taxes-paycheck-comp/paycheck-pace-hover-dark-1440.png (script p4-pacecols.mjs)
- Cause: `components/paycheck/pace.css:12-17` — each `.pace-row` is its own grid with `minmax(160px, auto)` figures,
  and ESPP's "$21.7K / $21.3K practical" is wider.
- Polish: fixed widths for the figures/verdict columns (or `grid-template-columns: subgrid` from `.pace-rows`).
- Impact: the meters compare cleanly as a set.
- Size: S · Confidence: high

### TPC-23 · What-if Δ effective rate reads "+0.1 pp" beside 27.3% → 27.5%
- Where: Taxes › What-if compare table, Effective rate row (Sell all NVDA + Max 401(k))
- What happens: Baseline 27.3%, Scenario 27.5%, Δ "+0.1 pp" (true values 27.32% → 27.47%, +0.14pp). The reader's own
  subtraction says 0.2.
- Evidence: shots/taxes-paycheck-comp/taxes-whatif-nvda-dark-1440-full.png
- Cause: the Δ is the server's own `delta.effective_rate` shown by `sandbox/DeltaChip.tsx:21-26` (1 dp of points),
  while each rate is rounded separately to 1 dp (`taxScenario.ts:137,160-161,187-188`).
- Polish: show rates to two decimals in the compare table, or derive the Δ from the displayed values.
- Impact: numbers that agree with each other.
- Size: S · Confidence: high

### TPC-24 · Delight: let the breakdown list and the flow point at each other
- Where: Paycheck › Summary (breakdown list beside "Where each check goes")
- What happens: hovering a sankey node nicely focuses its flows ("Taxable → Withholding"), but the matching line in the
  list beside it doesn't react, and the list rows have no hover at all; tooltips give "$1,987.04 Withholding" without
  the share of the check.
- Evidence: shots/taxes-paycheck-comp/paycheck-sankey-withholding.png
- Cause: `PaycheckPage.tsx:138-145` (plain `<dl>` rows) and `FlowPanel` (no shared hover state).
- Polish: cross-highlight — hover a row to emphasise its node (`dispatchAction('highlight')`), hover a node to tint its
  row — and add "25.2% of gross" to node tooltips.
- Impact: the two halves read as one story, the way the page intends.
- Size: M · Confidence: high

## Strengths to keep (≤6)
- Sankey hover focus: adjacency highlight, dimmed remainder, "Taxable → Withholding" link tooltips, pointer cursor.
- Contribution pace meters: 14px invisible hover bands, the hovered segment swells, one tip per part, and keyboard focus
  opens every line with a ring around the whole track.
- State lives in the URL: `?year=`, `?section=`, `?whatif=…`, `?owner=`, `?comp=` — reload/share lands on the same view;
  What-if pins persist; typed work is protected by discard prompts and drafts.
- Year switches repaint cached years instantly and morph the waterfall and ladder; scroll anchoring keeps the waterfall
  steady when the Totals card grows/shrinks (the TPC-02 case is the exception).
- Popovers (Change…, New tax year…) pop in over 120ms, trap sensible focus, and Escape returns focus to the trigger;
  "How this is estimated" folds with a 120ms reveal and chevron turn.
- The "Monthly net" count-up on fresh arrival and the What-if preset → answer in ~470ms feel responsive.

## Not reproduced / environment artifacts (what I ruled out)
- DEV badge in the sidebar footer, and every "audit fence: writes are disabled" 503 (saves, Apply) — environment; only
  *where* the message appears is reported (TPC-06, TPC-18).
- "$190$419" label overlap on the 2025 waterfall: transient during the year morph (~200ms), settles apart — not reported.
- Waterfall tooltips unreachable on slivers: partly refuted — hovering the value label also opens the tooltip; kept only
  as the "small target" note in TPC-03.
- Chip highlight lagging the figures on a year click: the chips' 120ms colour transition, not a bug.
- In-app arrival CLS on Paycheck also counted Overview shifts from the page left behind — excluded; only the Paycheck
  shifts are reported.
- "New tax year…" as a primary title-row button: consistent with other pages' title actions — not reported.
- Profiles history table scrolling sideways at 1440/1280: intentional (sticky action column, visible scrollbar).
- Scroll-linked dimming and mid-page sidebar/sticky rows in full-page shots: screenshot artifacts, checked in viewport
  shots.
