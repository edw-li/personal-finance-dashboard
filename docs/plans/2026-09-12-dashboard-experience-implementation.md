# Dashboard experience redesign — implementation plan

Status: **Approved on 2026-09-12; implemented and validated locally.** The user approved all recommended decisions and authorized parallel local implementation. Production deployment remains a separate release step.

The governing specification is the [design document](2026-09-12-dashboard-experience-design.md). It covers audit items **1, 3–8, and 10**. The tasks below are the approved implementation requirements; the [implementation review](../reviews/2026-09-12-dashboard-experience-review.md) records the delivered behavior and checks.

## 1. Sequence and dependencies

| Phase | Selected items | Reviewable result | Relative scope |
| --- | --- | --- | --- |
| A. Metrics and monthly review | 1, 3 | Consistent definitions, inspectable numbers, a complete monthly review/save/close workflow. | Large: data contracts, persistence, and write-path integration. |
| B. Chart interaction and page organization | 7, 8 | Shared details/expansion/export behavior and task-oriented views with preserved navigation and editing. | Large: shared components plus adoption across existing pages. |
| C. Overview | 4 | A useful first viewport and independently resilient sections. | Medium after A/B. |
| D. Projection | 6 | Chart and assumptions together, explicit probability meaning, consistent real/nominal display. | Medium after A/B. |
| E. Allocation | 10 | Honest classifications/coverage, editable targets, and clearly bounded employer exposure. | Medium–large: metadata, targets, and their UI. |
| F. Assistant | 5 | Computed evidence, better provider recovery, shared side-panel behavior, and saved findings. | Large; depends on the metric and context contracts above. |

~~~mermaid
flowchart LR
    A[Metrics and month review] --> B[Chart and navigation foundations]
    B --> C[Overview]
    B --> D[Projection]
    B --> E[Allocation]
    A --> F[Assistant]
    C --> F
    D --> F
    E --> F
~~~

These phases are implementation and review boundaries, not requests for six rounds of permission. Once the design is approved, proceed through routine work in this order. Return for a design decision only if evidence requires changing the agreed scope or behavior.

## 2. Current integration points

| Area | Existing files to build on |
| --- | --- |
| Monetary calculations and periods | backend/app/services/savings.py; backend/app/services/coverage.py; backend/app/api/spending.py; backend/app/services/net_worth_calc.py |
| Coverage UI and monthly inputs | src/pages/MonthlyUpdatePage.tsx; src/components/shell/ScopeBar.tsx; src/api/coverage.ts; src/types/api.ts |
| Metric presentation | src/components/StatTile.tsx; src/components/InfoHint.tsx; src/components/overview/overviewChartOptions.ts; src/components/overview/ytd.ts |
| Shared charts | src/components/ChartCard.tsx; src/components/EChart.tsx; src/components/ChartExportMenu.tsx; src/components/ChartTable.tsx; src/charts/timeZoom.ts |
| Page views and deep links | Existing page components; src/components/shell/useScope.ts; SettingsRail and existing Settings anchors |
| Overview loading | src/pages/OverviewPage.tsx; src/components/overview/attention.ts; existing PageFrame/Feed/cache conventions |
| Projection | src/pages/ProjectionPage.tsx; src/components/projection/ScenarioPanel.tsx; src/components/projection/projectionChartOptions.ts; backend/app/api/projection.py; backend/app/services/projection.py; backend/app/services/montecarlo.py |
| Allocation | src/components/portfolio/AllocationPanel.tsx; src/components/portfolio/allocationChartOptions.ts; backend/app/models/portfolio.py; backend/app/schemas/portfolio.py |
| Assistant | src/components/assistant/AssistantDrawer.tsx; src/components/assistant/viewState.ts; src/api/assistantStream.ts; src/api/assistantSession.ts; backend/app/services/assistant_context.py; backend/app/services/assistant_tools.py; backend/app/services/assistant_chat.py |
| Preferences and persistence | src/prefs/prefsStore.ts; backend/app/services/prefs_registry.py; backend/app/models/lifecycle.py; backend/app/services/snapshot.py; existing migrations and Activity/undo services |

Prefer extending these boundaries. New shared services should remove duplicate calculations and coordinate behavior; they should not introduce a new frontend framework, chart library, ORM, or general-purpose dashboard builder.

## 3. Phase A — metrics and month review

### A1. Define and test the metric contract

- Add a metric/evidence schema containing definition version, value, unit, source scope, date window, contributing count, completeness, components, and application-owned source link.
- Add server-side helpers for the approved spending components, comparison/rolling windows, savings rollups, and source receipts. Reuse existing engine functions.
- Preserve existing API fields during adoption; add explicit fields/metadata rather than silently repurposing a field used by another page.
- Replace separate Overview and Spending average calculations with consumers of the same contract. Apply the agreed eligibility policy to Projection's derived inputs and assistant comparisons.
- Inventory headline metrics on the other pages and attach explanations to existing values. Calendar's receipt must identify the scheduled-events boundary; portfolio receipts must distinguish refresh time from quote dates.
- Correct automatic dividend date labels throughout relevant UI/export/assistant evidence without inventing a payment date or rewriting historic entries.

Meaningful checks: previous versus inclusive windows; a gap inside 12 calendar months; no data; a known zero; missing net pay; zero denominator; living/tax/transfer separation; employer versus employee contributions; household-only spending beside owner-scoped assets; Decimal rounding and period aggregation.

### A2. Add review metadata and historical adoption

- Add month-review persistence with a unique household-month identity, reviewed feed flags, closure time/actor, and reviewed input revision. Record the adoption boundary for legacy eligibility.
- Extend coverage responses with explicit review state and eligibility information. Keep raw enteredness separate for consumers that still need it.
- Implement the approved historical fallback and batch-review endpoint/UI. Migration marks history unreviewed, does not close months or fill missing data, and never admits current/future periods through the fallback.
- Define relevant input fingerprints/revisions once. Make corrections, imports, undo, restore, and relevant calculation-definition changes expose outdated review state.
- Register new data with current-version export/restore and Activity/undo behavior. Plan downgrade/recovery without deleting financial records.

Meaningful checks: migration preserves every financial amount; an entered partial month remains incomplete; a historical fallback is labeled; confirmation of a true-zero month is respected; a financial correction invalidates review; unrelated current-price refresh does not invalidate a balance review; deletion/restore/undo update review state coherently.

### A3. Coordinate saves and build the review screen

- Extract reusable write operations from the current balance/spending endpoints where needed, retaining all validation and derived-account rules.
- Add a coordinated monthly-update request that validates and commits submitted balances, spending, take-home, and review metadata in one transaction/Activity batch.
- Include an expected revision to detect conflicting edits. Preserve the local draft on validation, conflict, or network failure.
- Replace the wizard's sequential two-leg save path with this operation. Keep standalone editors working through compatible services and review invalidation.
- Add explicit Save progress and Save and close actions; derive closure availability from the review checklist.
- Build the changed-row receipt, largest-change review prompts, missing-input links, explicit-zero confirmation, completion badge, and post-save receipt. Move deletion into Month actions.
- Add the shared metric inspector to the preview figures; distinguish “since last save” changes from “since previous month” movement.
- Update retrospective page defaults and favorable comparison tones to honor completeness. The current month's values remain accessible with clear status.

Meaningful checks: a failure after validating/writing one feed rolls back the whole request; retry does not duplicate an Activity batch; concurrent editing does not overwrite changes; a derived parent remains derived; blank/zero/clear remain distinct; a failed close retains the draft; after a successful close, page and assistant metric consumers receive the same eligible month.

Review artifact: a desktop walkthrough of an incomplete month, a changed month, a true-zero month, a closed month corrected later, and a historical batch review. Include a before/after table for any headline whose approved definition changed.

## 4. Phase B — charts, details, and task views

### B1. Build shared interaction components

- Add coordinated detail-panel primitives used by metric inspectors, chart selections, and eventually the assistant. Support dock, overlay, and expanded reading with keyboard focus behavior and resize limits.
- Add typed selection adapters for periods, entities/categories, heatmap cells, flows, and projection dates. Source values come from the underlying data, not parsed tooltip strings or canvas pixels.
- Extend ChartCard with persistent selection/detail hooks, Expand, visible zoom reset, and compact export actions. Preserve Table access and existing export fallbacks.
- Ensure expansion and panel resizing retain chart range, legend, scale, and selected entity. Keep chart connection groups working without duplicate interaction loops.
- Provide table-based equivalents for meaningful inspection and source-navigation actions.

### B2. Adopt the chart pattern

- Start with Spending's timeline/detail pair and Portfolio's holding/allocation selections; they exercise the main period and entity cases.
- Keep Spending's history visible when opening a monthly breakdown. Apply the correct range or an explicit independent range to every affected chart.
- Adopt the pattern on Net Worth, the income pages, tax visuals, credit-line history, and Projection. Where an existing chart has no deeper source, offer a pinned readout without manufacturing navigation.
- Preserve existing keyboard shortcuts, legend semantics, themes, density, patterns, and reduced-motion behavior.

### B3. Reorganize pages

- Implement the local-view matrix in design section 6 using URL-addressable view state.
- Move existing edit/add forms into focused editors. Preserve validation, drafts, save/undo, and all existing actions.
- Map existing query parameters and anchors to the correct local view, including command-palette arrivals, holding links, tax what-if links, and Settings anchors.
- Retain selected owner/person/month/range when switching views. Preserve browser back/forward behavior and restore the relevant scroll/selection context.
- Avoid fetching/mounting unopened secondary views unnecessarily; keep a deliberate cache lifetime and invalidate data after relevant writes.

Meaningful checks: select → inspect → expand → export → close retains context; keyboard users can reach the same record; changing owner cannot leave another owner's selection visible; a deep link opens a hidden target view correctly; browser back restores the prior view; an unsaved editor survives view changes or prompts explicitly; moved forms still save and undo correctly.

Review artifact: a chart interaction walkthrough plus a route/view matrix confirming that existing capabilities remain reachable. Include light/dark screenshots at the agreed desktop sizes.

## 5. Phase C — Overview

- Replace the single composite loading gate with independently keyed wealth, investment, spending/review, and upcoming/planning resource groups.
- Render coherent data inside each group and explicit as-of dates across groups. Retain prior content on revalidation and show unavailable data distinctly from zero/empty results.
- Deduplicate shared in-flight reads and ignore late responses after a scope change.
- Implement the first-viewport arrangement from design section 7: headline metrics, primary wealth chart, upcoming events, and actionable data prompts.
- Add deterministic change summaries linked to the selected month/account/category. Reuse existing results rather than introducing inferred explanations of market gains.
- Add bounded, validated preferences for tile/optional-card order and visibility, with defaults and reset.
- Place the remaining deeper charts in their intended optional sections, using the new chart/detail controls.

Meaningful checks: an unavailable tax/calendar feed does not hide independent content; a valid empty agenda differs from an error; switching owner cannot paint late results from a previous request; customization persists and resets; “complete month” links open the exact missing step; first-viewport content does not shift unexpectedly as optional data arrives.

Review artifact: the normal first viewport, one optional feed timing out, a partially entered month, and a customized arrangement. Record request counts and observed first-useful-content timing on the same fixture/environment before and after; report measurements rather than inventing a universal latency promise.

## 6. Phase D — Projection

- Put assumptions, planning chart, selection details, and headline results in one desktop workspace. Move polynomial history to its dedicated secondary view and lazy-load it.
- Replace derived/actual wording with records/default/override source labels and link to metric receipts.
- Make probability's horizon explicit and clarify deterministic versus simulated reach dates.
- Add a chart-window helper that frames the relevant milestone range, with bounded behavior for already-reached, never-reached, and unavailable targets.
- Implement a display-unit transform over the existing simulation outputs, applying the inflation factor to all monetary series, bands, target values, table rows, exports, and selected-date readouts.
- Preserve underlying assumptions and reach results when only display units change. Keep inputs' base-date units explicit.
- Preserve existing scenarios, pins, links, reset, and baseline comparisons. Avoid broad changes to the simulation or retirement model beyond the approved metric eligibility changes in Phase A.

Meaningful checks: today's/future dollars preserve FI dates/probabilities; zero inflation produces equal displayed paths; all bands and the target use the same conversion; tooltip/table/export values agree; horizon changes label and viewport consistently; a late response from an older knob value cannot replace the current scenario; scenario links and pins still reproduce their assumptions.

Review artifact: a side-by-side baseline and contribution change, a display-unit toggle, a scenario that does not reach its target, and the historical-trend view.

## 7. Phase E — Allocation

- Add classifications and source/review metadata to the security domain, plus the editing controls needed to maintain them.
- Introduce an allocation response with an explicit dimension, priced denominator, unpriced count, classification coverage, unknown slices, and source dates.
- Migrate/reuse only supported existing classifications. Do not fabricate sector/geographic exposure for funds. Keep user overrides independent of price refreshes.
- Build allocation views with a readable amount/weight table, selection details, and meaningful source links.
- Add persisted target sets keyed by dimension and owner scope. Validate totals, explicit tolerance units, and draft versus active state.
- Calculate and show target drift in percentage points and dollars using the current priced book; retain unknown/unpriced information and explanatory receipts.
- Add the held-employer/unvested-award panel with separate source boundaries. Do not repair or combine the separate ESPP ledger.
- Integrate new persistence with exports, current-version restore, and Activity/undo where applicable.

Meaningful checks: slices sum to the advertised denominator; unknowns cannot disappear into display grouping; classification coverage differs correctly from price coverage; a fund wrapper is never labeled as an industry; targets reject invalid totals; changing owner selects the correct target set; price changes update dollar drift; missing prices do not become zero drift; unvested awards do not inflate portfolio weights or net worth.

Review artifact: an allocation view with intentionally unknown fund exposure, a target edit and drift comparison, a missing-price example, and the employer panel with source links.

## 8. Phase F — Assistant

### F1. Computed answers and evidence

- Add allowlisted metric/comparison tools using the Phase A services, plus structured results for the standard review prompts.
- Stream/render the deterministic summary independently of narrative-provider availability.
- Add validated metric-reference rendering and source-link handling. Supported numerical claims use provided values; unsupported references trigger bounded repair or a computed-summary fallback.
- Keep broad page-data tools for questions needing them, but route known calculations through the shared functions.
- Add Explain this selection using the Phase B selection contract; capture the original period, owner, entity, and scenario at send time.

### F2. Provider recovery and reading experience

- Measure and implement a bounded silent-provider/first-output policy within the overall budget. Keep rate-limit distinctions, cancellation, model attribution, and progress states clear.
- Allow bounded automatic fallback before narrative starts; after a partial answer, offer an explicit restart with clear separation of attempts.
- Move the assistant onto shared dock/overlay/expanded-reading behavior and preserve the chart context while reading evidence.
- Add explicit saved findings with user ownership, dated metric evidence, source context, reopen, and delete controls. Avoid automatic retention of whole conversations or unrelated raw context.
- Ensure current-version export/restore handles saved evidence and ownership deliberately; a saved historical figure is never silently replaced by a live recomputation.

Meaningful checks: fixture month review exactly matches page metrics; incomplete-month selection follows policy; invalid source/reference IDs cannot render as verified evidence; slow/failed providers still leave a useful computed summary; a partial failure cannot produce duplicated/concatenated answers; Stop and disconnect cancel work; navigation does not mutate an in-flight question's context; saved findings survive a new session and remain isolated to their owner.

Review artifact: a successful month review with clickable figures, a deliberately failing provider, an explanation launched from a chart selection, the resizable reading layout, and a saved finding reopened after its source data has changed.

## 9. Cross-cutting verification and release preparation

Use the repository's existing frontend/backend test stacks. Frontend work requires Node 20 or newer as declared by package.json; do not relax that requirement to match an older local executable. Backend verification uses the existing Python/PostgreSQL test setup and isolated test data.

For each phase, run targeted tests for changed contracts and meaningful interactions, then the relevant lint/type/build checks. Once the full change is assembled, run the required frontend and backend suites, migration checks, and an integrated desktop browser walkthrough. Do not add tests that merely repeat incidental markup or verify an unchanged label.

The final review covers:

- The selected scope, with every audit item mapped to demonstrated acceptance criteria.
- All 13 existing routes, moved forms, important deep links, and command-palette destinations.
- Light/dark themes, existing densities, keyboard access, and reduced-motion compatibility at desktop sizes.
- Empty, incomplete, legacy, closed, corrected, stale, and failed-feed states using representative fixtures.
- Consistent metric values and date windows across page, inspector, export, and assistant evidence.
- Saved preferences, month state, targets, and findings surviving expected reload/session/restore paths.
- Before/after request behavior and observed usability/performance limitations.

New tables/columns change the snapshot schema. Release preparation must include a tested migration path, an identifiable pre-upgrade database backup, a current-version restore check, and a post-upgrade baseline snapshot. This is the minimum integration needed for the new persistence; general compatibility for all older snapshot schemas is not included.

Prepare the local review build, implementation notes, validation evidence, and concrete deployment/recovery steps before requesting a production release decision. Do not deploy from an approved design alone.

## 10. Completion checklist

- [x] Design and implementation plan approved by the user.
- [x] Phase A: shared metric definitions and month review complete.
- [x] Phase B: chart interactions and page organization complete.
- [x] Phase C: Overview complete.
- [x] Phase D: Projection complete.
- [x] Phase E: Allocation complete.
- [x] Phase F: Assistant complete.
- [x] Integrated acceptance walkthrough and required checks complete.
- [x] Review build, limitations, and release/migration steps prepared in the [implementation review](../reviews/2026-09-12-dashboard-experience-review.md).
- [ ] Production release separately authorized, if requested. This is a future release decision outside the completed local delivery.
