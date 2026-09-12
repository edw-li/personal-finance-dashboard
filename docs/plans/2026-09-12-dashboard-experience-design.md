# Dashboard experience redesign — approved design

Status: **Approved on 2026-09-12; implemented locally.** All recommended decisions are accepted. See the [implementation review](../reviews/2026-09-12-dashboard-experience-review.md) for behavior and validation.

Prepared from the fresh production audit and the current source at commit 99dd3f0223b2bff042f69a6adf7357a1f460e961. Earlier audit documents and prior memory were not used. This document and the companion [implementation plan](2026-09-12-dashboard-experience-implementation.md) are the review package.

## 1. Scope and intended outcome

The selected audit items are **1, 3, 4, 5, 6, 7, 8, and 10**:

| Audit item | Outcome |
| --- | --- |
| 1 — Metric definitions and explanations | The same named metric means the same thing on every page, with an inspectable source and date window. |
| 3 — Monthly update and completion | Enter, review, save, and close a month confidently, with incomplete periods clearly identified. |
| 4 — Overview | Important changes and upcoming events appear immediately, and one failed feed cannot blank the page. |
| 5 — Assistant | Numerical answers use application calculations, evidence is clickable, and the assistant fits beside the work. |
| 6 — Projection | Assumptions, chart, and outcomes form one usable planning workspace. |
| 7 — Chart interactions | Selection, inspection, expansion, export, and navigation behave predictably. |
| 8 — Page organization | Summary, exploration, and editing tasks have clear homes without long stacks of forms. |
| 10 — Portfolio allocation | Views distinguish investment wrappers from actual exposure and show user-defined allocation targets. |

This is a coordinated redesign of existing capabilities. It preserves the desktop focus. Mobile layouts, spending transactions, realized gains/XIRR work, the separate portfolio/ESPP reconciliation project, a motion-system redesign, and new Liquidity/Goals/shared-scenario pages are outside this iteration. Existing features remain reachable when reorganized.

Approval of these plans authorizes implementation and validation in the local repository. Production deployment is a subsequent release decision based on the implemented, tested result.

## 2. Approved decisions

The user approved these recommendations for implementation on 2026-09-12.

| Decision | Recommendation | Reason |
| --- | --- | --- |
| Spending labels | Use **Living spending** for the primary lifestyle/budget metric. Show **Tax paid from take-home**, **Transfers**, and **Cash outflow** separately. | The existing API already provides these components; a generic total currently hides their different meanings. |
| Comparison average | Compare a selected month with eligible months in the **12 calendar months before it**. Print the dates and contributing count. | The comparison month cannot lower its own benchmark, and gaps cannot silently extend the window. |
| Standalone rolling average | Keep an average ending at a selected completed month as a separate, explicitly named metric. | A trailing planning average and a previous-month comparison answer different questions. |
| Month closure | Closing is an explicit user action after a review. Saving alone does not certify completeness. | A single housing entry is not evidence that spending is finished. |
| Historical data | Keep pre-existing history available with an **Unreviewed history** designation and offer an explicit batch-review workflow. | Users should not have to close years of data before the dashboard is useful, and migration should not claim reviews occurred. |
| Details and assistant | Share coordinated side-panel behavior. Use a dock when the main content still has adequate width, with overlay and expanded reading modes available. | This avoids stacking drawers over one another and keeps the chart visible while inspecting or asking about it. |
| Projection dollars | Default to today's dollars; offer a display-only future-dollars switch. | A display choice should not change the model's inflation assumption or its FI result. |
| Allocation depth | Implement classifications, coverage, employer exposure, and targets now. Leave fund-constituent look-through for a later project. | The current security model does not contain enough fund constituent data to claim complete sector/geographic exposure. |
| Assistant persistence | Save individual useful answers explicitly, with their evidence and date. Keep unsaved conversations temporary. | This solves losing useful findings without introducing an entire conversation-management product. |

## 3. Shared metric definitions and evidence — item 1

### 3.1 Metric vocabulary

Preserve financial records. Add explicit definitions and replace ambiguous presentation rather than rewriting historical entries.

| Display name | Definition and boundary |
| --- | --- |
| Living spending | Sum of categories classified as living. Used for lifestyle comparisons, living budgets, and the existing annual-spend planning input. |
| Tax paid from take-home | Sum of tax categories. Payroll withholding is separate because it never reached take-home. |
| Transfers | Sum of transfer categories. Shown separately from money spent outside the household. |
| Cash outflow | Living spending plus tax paid from take-home. |
| All category entries | The current raw sum across all categories, retained in detailed tables/export with this explicit label. |
| Cash saved | Net pay minus cash outflow, using the existing savings service. |
| Total saved | Cash saved plus employee payroll savings, with the existing denominator for its rate. Profile-derived payroll amounts carry that source label. |
| Planned monthly contribution | Existing projection calculation, with cash savings, employee payroll contributions, and employer contributions identified separately. |
| Net worth | Existing snapshot calculation, with liabilities, derived account roll-ups, owner scope, and recorded-on date explained. |
| Portfolio value | Existing priced-holdings calculation, with the quote-date range, missing-price count, and owner scope. |
| Dividend income | Distinguish recorded/manual amounts from automatic event-based amounts and projected annual income. Ex-date and payment date remain different date types. |
| Effective tax rate | Existing engine result, with tax year, numerator, denominator, and estimated-input basis. |

Existing different savings and contribution formulas should not be forced into one formula merely because both describe saving money. Their names and explanations must expose the difference.

Changing the primary spending presentation to living spending can change a displayed headline in months with tax or transfer entries. The other components remain visible, the original entries remain intact, and the before/after presentation will be shown in the implementation review.

### 3.2 Period rules

- A comparison baseline uses the preceding 12 **calendar** months, excluding the focused month. Excluded or missing months reduce the contributing count; they are not replaced with older months.
- The label says, for example, “Previous 12 months · 10 included.” Its inspector lists both included and excluded months and the reason for each exclusion.
- A rolling average ending at a completed month has a separate definition and explicit start/end dates. The assistant must request the intended metric rather than inventing an average from a broad history bundle.
- Savings comparisons require matched spending and take-home data. Period savings rates divide summed numerators by summed denominators; they do not average monthly percentages. A known zero is a value; missing data is not zero. An undefined percentage remains undefined when its denominator is zero.
- A current or future month is never inferred to be complete. Future months remain drafts. A user can close the current month explicitly when their records for that period are final; the status still carries the actual dates.
- Projection defaults use the same eligibility rules, naming their planning window and the number of matched months. Changing eligibility is a documented calculation change, covered by parity tests across its consumers.
- Balance snapshots, spending periods, and market quote dates remain independent. A September 1 balance is not silently relabeled as August spending. A review names the two balance snapshots it compares.
- Household spending remains explicitly household-wide when an owner selector narrows other metrics on the page.

### 3.3 Metric inspector

An “About this number” action beside important figures opens a concise inspector with:

1. Value, units, and plain-language definition.
2. Period, owner scope, and whether it is entered, calculated, estimated, or incomplete.
3. Included components and excluded components.
4. Source records or source page, as-of dates, and relevant data warnings.
5. A link opening the original records with the exact scope and period.

Start with headline metrics on Overview, Spending, Net Worth, Portfolio, Paycheck, Taxes, Projection, and Calendar. The same evidence format supports selected chart values and assistant answers. An informational hint can remain short; the inspector provides the deeper explanation.

Automatic dividends must display ex-date as ex-date. A known payment date can appear separately. Missing payment dates must not be fabricated, and this change does not rebuild dividend transaction history.

### 3.4 Technical boundary

Add a shared server-side metric service and a small evidence schema, building on the existing savings, coverage, net-worth, portfolio, and tax services. Routes and assistant tools call these services; pages format their answers.

Each evidence record includes a definition/version identifier, value and unit, scope, date window, included-month count, completeness/source flags, component values where relevant, and an application-owned source link. Monetary calculations and rounding stay server-side. Do not replace the existing engines or add a general-purpose query language.

Acceptance: asking for the same metric with the same scope, period, and data revision produces the same value on the page, in its export, and in an assistant evidence card.

## 4. Month completion and the update workflow — item 3

### 4.1 States

| State | Meaning | Reporting behavior |
| --- | --- | --- |
| Not started | No applicable entries or draft exist. | Empty state, not a zero-value month. |
| In progress | Data has been entered or changed, but the review is incomplete. | Values can be inspected; favorable comparative judgments are neutralized. |
| Ready to review | Required feeds and validations are satisfied. | The review action is available; this is not yet a closed month. |
| Closed | The user reviewed the current financial inputs and explicitly closed the month. | Eligible for completed-month reporting. |
| Needs review | Financial inputs or their relevant definitions changed after closure. | The prior closure remains in history; the current result no longer carries a valid review badge. |
| Unreviewed history | Pre-existing data brought forward at adoption. | Available under the historical policy below, visibly distinguished from reviewed data. |

Store review metadata per household month: reviewed-feed flags, closure time/actor, and the reviewed input revision. “Ready to review” and “Needs review” can be derived from current inputs and that metadata rather than independently editable flags.

Relevant financial corrections through the wizard, standalone editors, imports, undo, or restore invalidate a stale review. Changes to classifications or payroll assumptions that alter reviewed calculations also expose that mismatch. Routine current-price refreshes do not invalidate an unchanged monthly balance snapshot.

### 4.2 Historical adoption

- Record the adoption boundary. Existing past months retain their records and receive an unreviewed-history designation; nothing is automatically marked closed.
- For continuity, pre-adoption past months can contribute to historical baselines under the existing enteredness/matched-data checks. The inspector explicitly counts how many contributing months are unreviewed history.
- Ambiguous all-zero/missing data stays excluded until confirmed. Current and future periods cannot enter through the historical fallback.
- Offer a historical review table with period, balances/spending/take-home coverage, and warnings. The user can select eligible months and review them in a batch after seeing the exact list. Missing values are not filled by that action.
- Default retrospective reporting to the latest closed month. Until one exists, use the latest eligible historical month with its unreviewed designation. Never silently fall back to a partial current month.
- A later correction to a historical month changes its state to needs-review/in-progress and removes the legacy fallback until reviewed. The adoption exception cannot hide new changes.

### 4.3 Entry and review screens

Keep the existing Balances → Spending → Review steps, arithmetic inputs, paste support, keyboard navigation, draft recovery, and undo. Add a persistent compact month/status summary and a discoverable shortcut hint.

Blank inputs remain distinct from entered zero. Provide an explicit, reviewable way to confirm remaining categories as zero, including which categories will be affected. Avoid requiring repetitive typing, while never treating untouched blanks as confirmation.

The Review step becomes a change receipt:

~~~text
September 2026                                  In progress
Balances reviewed   Spending reviewed   Take-home missing

Net worth       Living spending       Cash outflow       Cash saved
[preview]       [preview]             [preview]          [unavailable]

Changes since the last save
Account/category       Before          After             Difference
...

Items to review
Missing take-home → Open field
Large balance change → Inspect account

Back                         Save progress       Save and close month
~~~

The receipt distinguishes changes since the last save from movement since the previous month. Both are useful, but they are different comparisons. Highlight up to three largest absolute account movements and up to three category differences from the existing three-month median. These are review prompts, not anomaly verdicts. A zero or missing baseline shows the amount and available context rather than a misleading percentage. Missing required confirmation prevents closure while saving progress remains available.

Closing asks the user to confirm the completeness of balances, spending, and take-home. Zero income is supported explicitly. A month with genuinely unavailable take-home can be saved and inspected, but is not silently certified as complete.

Move deletion to a Month actions menu, preserving the existing confirmation and recovery behavior. Replace the implementation-focused rounding paragraph with useful save/completion status. After saving, show a concise receipt and actions to view the month or continue later.

### 4.4 Save semantics

The current wizard saves balances and spending sequentially. Add a coordinated month-save operation that validates and commits the submitted feeds and review metadata together. A failure leaves the previous saved state intact and the local draft available.

Reuse the existing write rules, including derived-parent accounts, signed liabilities, explicit clears, intentional zeros, Activity, and undo. Omitted fields mean unchanged; explicit clears retain their current meaning. A successful close cannot coexist with an unsaved spending leg.

Use an expected input revision to detect another editor changing the month after the draft was loaded. A conflict shows a fresh before/after comparison and preserves the user's draft instead of overwriting the other edit.

## 5. Shared chart and panel behavior — item 7

### 5.1 Interaction grammar

| Visual | Single selection | Explicit deeper action |
| --- | --- | --- |
| Time series / monthly bars | Pin a period and show values in the detail panel; retain the timeline. | Open that period's page or editor. |
| Category bars / pie / treemap | Select the category or holding; show amount, weight, and underlying members when grouped. | Open category history or holding details. |
| Heatmap | Select both month and category. | Open the selected monthly breakdown. |
| Sankey | Select a node or connection; explain the contributing flow. | Open its source records where a meaningful destination exists. |
| Projection | Select a date; show projected balance, bands, target, and scenario context. | Inspect assumptions or expand the planning chart. |
| Simple history chart | Pin the selected point and its source date. | Offer a source link only when one exists. |

Hover remains a quick preview. Clicking makes a selection persistent; moving the mouse away does not lose it. Clear selection is explicit. Escape dismisses the topmost transient surface, and focus returns to its trigger. Clicking empty plot space may clear a selection but must not navigate.

Charts without a meaningful drill-down do not pretend to offer one. The shared pattern standardizes interaction outcomes; it does not force every chart into the same data model.

For Spending, a selected month's donut/breakdown moves into the detail area instead of replacing the history chart. Existing comparison/highlight behavior should remain available.

### 5.2 Chart chrome and expansion

- Keep Table visible; place PNG, Copy image, and CSV inside one Export menu.
- Add Expand and a visible Reset zoom when a zoom differs from its initial window.
- Expansion preserves the active range, legend, pinned selection, and scale. Closing restores the same view and scroll position.
- Use the existing chart/table/export builders as the data source. CSV and tooltip definitions must agree with the visible scope; exports identify their date window and units.
- A card-level range or a deliberately all-history chart must say so. A page-level range cannot appear to govern a chart that ignores it.
- Provide equivalent selection/source actions from data tables and keyboard-reachable controls.
- Respect existing theme, density, chart patterns, and reduced-motion behavior. A separate animation redesign is not included.

### 5.3 Coordinated side panels

Metric details, chart details, and the assistant use shared panel primitives and coordinated placement. Avoid piling multiple fixed drawers over the same chart.

On roomy desktops, the main content resizes beside a dock. A proposed initial width is about 440 pixels, resizable within a sensible desktop range and clamped to preserve at least about 720 pixels of main content. When there is insufficient room, use the overlay mode; an expanded reading mode supports long answers and tables.

Following an evidence link within the assistant can show its detail view with a clear way back to the answer. Sending a chart selection to the assistant captures the exact entity, period, owner, and scenario—not merely the current route name. Resizing a panel must resize charts without losing their state.

## 6. Page organization — item 8

Keep the existing sidebar routes. Add task-oriented local views and move add/edit forms into focused drawers or expandable sections. This is a navigation/presentation change, not permission to add unselected domain features.

| Page | Proposed local organization |
| --- | --- |
| Overview | One focused summary; optional deeper charts below. |
| Monthly update | Preserve Balances / Spending / Review; add the completion workflow above. |
| Net worth | Overview / Accounts, with existing group movers and account comparisons placed where they fit. |
| Portfolio | Overview / Holdings / Allocation / Income / Manage. Existing transactions and security maintenance remain in Manage. |
| Spending | Overview / Trends / Budgets / History; monthly editing continues through Monthly update. |
| Credit cards | Rewards / Credit lines / Manage; existing card details open from either relevant view. |
| Paycheck | Summary / Try changes / Profiles; the selected person remains consistent. |
| Comp | Summary / Vesting / Manage, using the existing calculations and grant/focal records. |
| ESPP | Summary / Lots / Purchase model; adding or editing records opens a focused form. |
| Taxes | Summary / What-if / Inputs / Tax tables. The existing withholding outlook belongs in Summary. |
| Projection | Planning workspace / Historical trend. |
| Calendar | Retain the existing Grid / List views. |
| Settings | Convert the existing Household / Planning / Account / Integrations / Data sections into focused views. |

Important constraints:

- Preserve existing URL parameters, deep links, tax-scenario links, and Settings anchors. A deep link opens the appropriate local view before focusing its target.
- Local view is URL-addressable through a shared section parameter, preserving existing parameters such as Calendar's view selector. Back/forward navigation restores the view, period, owner, and relevant selection.
- Changing local views does not discard an unsaved editor. Maintain a draft or offer an explicit unsaved-change decision.
- Keep primary actions visible in context; avoid moving essential operations into an undiscoverable general menu.
- Default views lead with existing answers and relevant charts. Administrative forms are not permanently placed before results.
- Fetch and mount expensive secondary content on first use, retaining appropriate cached state afterward.
- Validate at desktop widths around 1366, 1600, and 1920 pixels in both themes and existing densities. This does not add mobile support.

## 7. Overview — item 4

### 7.1 Proposed first viewport

~~~text
Overview                 Owner scope                 Customize

Net worth       Portfolio value       Living spending       Estimated tax
as-of date      quote dates           review status         tax year

Wealth trend — main chart                    Coming up — next 45 days
                                            Payday / vest / deadline
                                            View calendar

                                            Needs attention
                                            Finish month / missing data

Changes worth understanding
Largest recorded balance moves / latest completed spending comparison

Year to date summary
Optional deeper portfolio, spending, and money-flow views
~~~

Use existing computations for the change summaries. Label account-balance movement as movement; do not claim market gains or causal explanations that the records do not establish. Separate financial events from data-maintenance prompts so both remain understandable.

Customization is deliberately bounded: choose/order the existing summary tiles and optional deeper cards. Store an allowlisted preference with a reset-to-default action. This is not an unrestricted dashboard builder.

### 7.2 Loading behavior

Replace the all-or-nothing twelve-feed gate with independent coherent resource groups for wealth, investments, spending/review, and upcoming/planning information. Preserve a common source revision inside related figures; show different as-of dates where the domains legitimately differ.

Each section supports first-load skeleton, usable content, refreshing, stale-with-retry, and unavailable states. A calendar failure means “could not load upcoming events,” not “no events.” An assistant/provider issue cannot affect Overview's data rendering.

Prioritize the first viewport. Avoid duplicate in-flight reads for shared coverage/system/household data, using the existing cache/prefs approach rather than replacing the frontend data stack. An owner change keys data correctly and discards late results for the old scope.

Acceptance: deliberately failing the tax or calendar dependency still leaves independently available wealth, portfolio, and spending content usable.

## 8. Projection — item 6

### 8.1 Proposed workspace

~~~text
Projection       Planning | Historical trend       Today's $ | Future $

Target      Starting balance      FI date      Reach target within 30 years

Planning chart                                 Assumptions
target / central path / uncertainty bands       Return          [input]
milestone-focused initial window                Contribution    [input]
                                                Living spend    [input]
Selected date details                           More assumptions

Baseline versus current scenario               Existing pins / Copy link
~~~

Keep chart and assumptions visible together, with outcome tiles persistent while adjusting controls. Advanced controls can collapse without changing the model. Use plain source badges: From records, Planning assumption, and Your override.

Move the polynomial extrapolation to Historical trend, loaded when opened. Retain its clear method explanation. It must not be the leading planning answer.

### 8.2 Interpretation and monetary display

- Label probability as “Reach FI target within [horizon] years.” Explain that it counts first reaching the target in the simulated paths, rather than successful retirement spending over a lifetime.
- Label the deterministic date and simulated percentile dates distinctly. Express percentiles in plain language in the inspector. Preserve the existing treatment of paths that never reach the target.
- Initially frame the chart around the relevant FI milestone/range, bounded by the selected horizon. If there is no reach date, show the full horizon. Full horizon and Reset view remain explicit options.
- Keep nominal return/inflation/contribution assumptions unchanged when switching display units. Existing real-dollar paths become future-dollar display values by multiplying each date's values by its inflation factor from the projection start.
- Apply the display factor consistently to all monetary series, bands, target line, selected-date values, tables, and exports. A constant real target becomes an increasing nominal target. FI dates and probabilities do not change when only display units change.
- Keep monetary input fields clearly denominated at the model's base date. Do not turn a display switch into a second, subtly different simulation.
- Preserve existing baseline comparison, pins, deep links, and reset behavior. This iteration does not expand the retirement engine into a spending-depletion or withdrawal-strategy model.

Acceptance: changing a contribution visibly updates the neighboring chart and outcomes; switching dollars changes displayed amounts but leaves the scenario's economic assumptions and FI results invariant.

## 9. Portfolio allocation — item 10

### 9.1 Classification and coverage

Replace the misleading industry-only hierarchy with explicit dimensions: Asset class, Industry, Geography, and Account. Keep holding type (ETF, stock, mutual fund, private) available as a separate descriptive dimension.

Add editable security classifications and their source/last-reviewed metadata. Asset classes should cover equity, bonds, cash/cash equivalents, real assets, mixed, other, and unknown. Geography should support US, international, global/mixed, and unknown. Detailed regional splits can remain unavailable where the data does not support them.

Do not infer fund constituents from the wrapper or ticker name. Existing legitimate stock industries can be reused; a fund's industry exposure remains “Unknown—fund holdings not loaded” until supported by actual data. User-entered classifications are never silently overwritten by a price refresh.

Show amounts and percentages in a readable ranked legend/table beside the visualization. Coverage has two separate meanings: how much value is priced, and how much of that priced value is classified. Unknown categories remain visible in the denominator and in exports. Grouping small slices into Other is a display choice, not a way to conceal missing classification.

Fund-constituent look-through, automatic overlap analysis, and new external data subscriptions are explicitly deferred. The new metadata and coverage format should allow them later.

### 9.2 Targets and drift

Allow the user to define targets and optional tolerance bands for an allocation dimension and owner scope. Use percentage points for tolerance, labeled explicitly. Do not prescribe investment targets.

A saved active target set must total 100%; incomplete editing remains a draft. Display current weight, target weight, difference in percentage points, and dollar difference at the current priced portfolio value. Keep current value/date visible when market changes move drift.

All slices, including unclassified holdings, retain a transparent role in the calculation. No prices means unavailable dollar drift, not zero. Target settings persist across devices; they are financial planning data rather than browser-only chart preferences.

### 9.3 Employer exposure

Show current employer shares/value from Portfolio and unvested awards/value from Comp separately, with source links and dates. Show the held position's share of the existing portfolio denominator. Any combined held-plus-unvested value must be labeled exactly as that and must not be presented as ordinary portfolio allocation or added to net worth.

The separately audited mismatch between Portfolio and the ESPP ledger is not repaired by this work. Do not sum both ledgers or quietly substitute one for the other. The panel names its Portfolio source; a reconciliation workflow remains a separate project.

Acceptance: no chart presents ETF/Mutual Fund as industries, missing exposure is visible, and the user can inspect and adjust a target without losing the current allocation context.

## 10. Assistant — item 5

### 10.1 Application calculations before narrative

Add read-only metric/comparison tools backed by the shared services. Standard prompts such as Month in review, Spending changes, and Contribution pace obtain a compact, deterministic result first. Render that summary as soon as it is available, even if the model is slow or unavailable.

Results include the selected period, baseline window, exact comparison values, completeness state, and evidence identifiers/source links. The model explains these results; it does not calculate averages, savings rates, contribution targets, or deltas from a raw list.

For supported structured reviews, numerical claims render from validated metric references and comparison fields. Invalid or missing references are rejected; a bounded retry can repair the response, otherwise the computed summary remains with a clear explanation that the narrative could not be completed. Free-form interpretation is still interpretation, and citations alone do not certify its conclusions.

Evidence links open the exact page/view/period/owner/scenario. Source URLs are constructed by the application and validated, rather than accepted as arbitrary links from the model. User-supplied hypothetical inputs remain clearly identified as scenario assumptions.

### 10.2 Waiting and recovery

Retain stop, progress, model choice, and retry. Add a bounded time-to-first-useful-output policy so one silent provider does not consume nearly the entire overall budget before fallback has a chance. Initial values will be measured in implementation; start by evaluating a roughly 20–25 second silent-provider window within the existing total budget.

Distinguish data loading, tool calculation, model waiting, and answer streaming. A provider failure before narrative can use one bounded automatic fallback. A failure after partial narrative leaves a clearly labeled partial answer with an explicit restart action; do not concatenate a different model's answer onto it as if it were one continuous result.

Stop/disconnect must cancel pending work. Rate limits retain their retry guidance. Automated verification uses provider fakes; any live smoke test is small and its observed timing is reported separately from the deterministic tests.

### 10.3 Working context and saved findings

Use the shared side-panel behavior from section 5. Add Explain this selection to supported chart detail panels and useful metric inspectors. Capture source identifiers, scope, period, and scenario at send time. Navigation afterward must not silently rewrite the context of the question already being answered.

An explicit Save finding action stores the question, answer, referenced metric values/definitions, source context, model, and timestamp for that user. Saved findings remain available across sessions/devices in the assistant panel. Their original figures remain dated; opening current data is a separate action. Saving an answer does not automatically save a whole conversation or grant the assistant write tools for financial records.

Acceptance: the standard month review uses the same baseline and savings values as the selected page, survives a narrative-provider failure with a useful computed summary, and can be reopened later with its original evidence intact.

## 11. Delivery boundaries and review

Implementation is divided into six phases in the companion plan. Each phase has a reviewable result and tests for its material behavior. A single approved design governs the sequence; routine implementation choices do not require new permission requests. Changes to the metric definitions, historical policy, feature scope, or persistence behavior return to the user as explicit design changes.

Review builds must demonstrate light/dark desktop layouts, keyboard operation, empty and incomplete data, changed owner/date context, delayed/failed feeds, and the existing editing/recovery paths that moved. The acceptance criteria are outcomes, not merely snapshots of JSX or CSS.

New persistence must integrate with the existing migration, export/restore, and Activity/undo conventions where applicable. Restoring current-version data must retain month review state, allocation configuration, and saved findings with correct ownership. Existing full historical-snapshot compatibility is a separate issue; this project does not imply that it has been solved.

The implementation review will include screenshots or a runnable preview, the completed acceptance checklist, observed limitations, and the concrete release/migration steps. Production changes are not part of this planning step.
