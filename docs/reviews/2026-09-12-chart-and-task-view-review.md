# Chart interactions and task views

The shared chart controls and task views are implemented locally. This record describes their contracts and the focused verification for review; desktop screenshots and deployment checks belong to the integrated application review.

## Chart and detail contracts

- `ChartCard` retains existing props. A domain-specific `selectionAdapter` maps a chart event to `ChartSelection`; `rowSelection` maps an export-table row to the same selection. Supplying an adapter replaces legacy click navigation with inspection. Charts without an adapter or legacy handler use the source option for a conservative pinned readout.
- `selection`, `onSelectionChange` and `renderSelection` support controlled selection. `selectionScopeKey` invalidates pins when the owner, entity or scenario boundary changes. `independentRangeLabel` names charts whose time window differs from the page.
- Expand moves the existing chart host into a dialog: the ECharts instance, legend, connection group and manually selected zoom survive expansion and closing. Reset zoom returns to the initial or subsequently selected page range. Exports use the current instance; CSV and Table use the same source table builder.
- `DetailPanelProvider` coordinates one visible dock, overlay or expanded reading surface, with history/back, resizing, keyboard focus and source links. Expanded charts show their selection inside the expanded chart and release the separate detail panel. A hidden retained task view releases its detail surface while keeping the chart's pin.
- Chart detail content uses a stable panel host: live content can refresh without repeatedly opening the panel when a parent also consumes detail context. Dismissal keeps the pin closed until another selection or the Details action; Back restores exactly one chart's content. Overlay focus returns after the page stops being inert.
- `SelectionDetail` emits `finance:explain-selection` through `explainSelection`. The event includes a copied typed selection, original route, chart title and capture time. Its source actions use validated internal links; optional `onOpenSource` enables the source page's existing focus/highlight action.
- `MetricInfoButton` opens the shared inspector from exact evidence supplied by a metric service or an existing server response. It renders definition, value, scope, period, components, completeness, warnings, as-of and source. It does not reconstruct metrics from formatted display values.

## Route/view matrix

The `section` query parameter is shared across pages. Changing it preserves other query parameters, including owner, month, range, tax year and existing scenario values. An explicit section wins over a legacy arrival. Visited sections remain mounted to retain draft and chart state; unopened sections mount on demand.

| Route | Sections | Legacy arrival behavior |
| --- | --- | --- |
| `/net-worth` | `overview`, `accounts` | `drill` opens Accounts; consumed account arrivals retain the inferred view. Monthly/Quarterly is available beside the local tabs because it scopes both views. |
| `/portfolio` | `overview`, `holdings`, `allocation`, `income`, `manage` | `ticker` opens Holdings; `tab=dividends` opens Income; transaction/security/realized arrivals open Manage and focus the visible editor. Holding inspection leaves its table available. |
| `/credit-cards` | `rewards`, `lines`, `manage` | Add/edit anchors open Manage. Card-detail state is cleared atomically when choosing another task view. |
| `/paycheck` | `summary`, `changes`, `profiles` | `whatif` opens Try changes; profile/editor arrivals are recognized. Exact `profile` source links wait for the household/profile roster, verify the selected owner, then open that historical check. Invalid or cross-owner profile references show an explicit fallback explanation. |
| `/comp` | `summary`, `vesting`, `manage` | Grant/vesting references open Vesting; focal/grant editor anchors open Manage. |
| `/espp` | `summary`, `lots`, `purchase` | `lot` and lot anchors open and focus the exact lot; model/year arrivals open Purchase model. Chart clicks pin values; Open lot records navigates and highlights explicitly. |
| `/taxes` | `summary`, `whatif`, `inputs`, `tables` | `whatif` and `whatif-lot` open What-if; input/bracket anchors open their editors. `comp` pins a historical year's detail beside the retained all-years chart. |
| `/settings` | `household`, `planning`, `account`, `integrations`, `data` | Existing card/band anchors map to the owning view; restore arrivals retain their anchor and focus behavior. |

## Verification

Focused coverage checks selection from source data, keyboard-accessible table inspection, source actions, owner invalidation, expansion using the same canvas, preserved ECharts zoom/legend state, reset zoom, export controls, detail-panel focus/geometry and legacy section retention after a query parameter is consumed.

The page integration tests exercise all eight view matrices using actual tab navigation and explicit section URLs. Existing save/undo, validation, caches, stale responses and scope behavior remain covered. Added regressions cover cross-view comp/tax/ESPP drafts, Portfolio record-editor drafts and visible focus, and validated historical Paycheck source links.

The integrated frontend run passed all 2,843 tests; final focused checks passed another 194. Full lint reported no errors, and the production build passed. The [integrated review](2026-09-12-dashboard-experience-review.md) records desktop screenshots, failure fixtures, request measurements and migration evidence.

The final shared/Portfolio/Spending/ESPP/allocation run passed all 111 tests. Subsequent chart/panel history and focus regressions passed all 23 tests. Paycheck's exact-source arrival and existing behavior passed all 78 tests, including an invalid arrival after an already displayed historical check. TypeScript passed, and scoped lint reported no errors. Final aggregate validation is recorded by the integration owner after the lanes finish.
