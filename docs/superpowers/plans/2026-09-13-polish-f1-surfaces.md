# Lane F1 — panel-and-chart surfaces (2026-09-13 polish batch) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> implementer for this lane in its own worktree, TDD per task, then a spec-compliance review and a
> code-quality review, then a local merge into main by the lead — never pushed). Steps use `- [ ]`
> checkboxes; tick them as you go.

**Spec:** `docs/superpowers/specs/2026-09-13-surface-grammar-and-view-fit-polish-design.md` — this
lane implements **§2.2 (detail panel motion), §2.3 (chart Expand dialog), §4 (panel chrome, incl. the
assistant inside it), §5 (receipt copy and labels), the `ChartCard aside` bullet of §12, and F1's
share of §2.6/§11 (Disclosure adoption — last task, conditional on F2)**. Read §0, §1, §2.2, §2.3, §4,
§5, §12 (the ChartCard bullet), §15 and §16 before Task 1. The evidence behind every change is
`scratchpad/ux-audit-2026-09-13/reports/shell-and-panels.md` (findings A1–A3, A6, B1–B7, E1–E5,
F1–F3, G1 items 1–2, Appendix A) — read it once; it explains *why* each rule below exists.

**Goal:** every surface this lane owns moves the way the motion grammar says a surface moves (dock
slides in and fades out, mode switches morph, the Expand dialog fades up and its chart fills it), the
panel's chrome collapses to one row with content-first focus order, the assistant lives inside that
chrome as a non-modal request, and the receipt reads in sentences instead of enum keys.

**Architecture:** `DetailPanelProvider` gains a `modal` flag per request, an exit "ghost" (the last
request stays painted for one `--t-fast` beat, unmounted on `animationend` or a
`MOTION_MS.fast + 50` timer), one CSS box model for its three modes (`--dp-top/--dp-bottom/--dp-w`),
localStorage persistence of mode and width, `--dock-width` published on `<html>`, and a header whose
controls follow the body in the DOM but are grid-placed into the header row. `EChart` accepts
`height: 'fill'` and resizes with `{ animation: { duration: 0 } }`; `ChartCard` passes `'fill'` when
expanded, swaps the selection panel's title/subtitle, and gains `aside`. `utils/metricReceipt.ts`
owns the labels and `formatEvidenceValue`; `explainSelection.ts` owns the prompt. The assistant opens
`{ id: 'assistant', modal: false, actions: <model select + New chat> }` and drops its own header.

**Tech stack:** React 19 + TypeScript 5.9 + Vite 6 + ECharts 6 + lucide-react; vitest 3 with
Testing Library / jsdom 26 in `src/`. No backend changes; nothing touches the database.

---

## Mechanics (read once)

- **Worktree:** `C:/Users/edyli/personal-finance-dashboard/.worktrees/polish-f1`, branch
  `polish/f1-surfaces`, cut from `main` (`ab92b91` or later). The orchestrator creates it:

  ```powershell
  cd C:\Users\edyli\personal-finance-dashboard
  git worktree add .worktrees\polish-f1 -b polish/f1-surfaces main
  cmd /c mklink /J .worktrees\polish-f1\node_modules ..\..\node_modules
  ```

  Work ONLY inside the worktree. `node_modules` is a junction — never `npm install` there.
- **Commands** (run from the worktree root; each is exact and its expected output is stated in the
  task that uses it): `npx tsc -b` · `npx eslint <paths>` · `npx vitest run <paths>` ·
  `npx vitest run` · `npm run build`. Node on this box is v18.12 (engines say ≥20); vitest and vite
  run fine on it — do not "fix" the engine.
- **Baselines on main @ab92b91:** `npx vitest run` → 2753 tests green; scoped eslint over this lane's
  files → 0 errors, 3 warnings (all `react-refresh/only-export-components`); repo-wide `eslint .` →
  0 errors, 24 warnings. This lane must not add errors; new warnings only of that same kind, and only
  if unavoidable (there should be none).
- **Commit after every task**, small, conventional prefixes as given per task (`feat(panel):`,
  `feat(chart):`, `fix(copy):`, `feat(assistant):`, `refactor(...)`). Never push. Never delete files.
  Never run `git worktree remove`, `git branch -D`, or anything that prompts — the lead does that at
  the end of the night.
- **Ownership (spec §1):** this lane edits only
  `src/components/details/{DetailPanelProvider,MetricInspector,SelectionDetail}.tsx`,
  `src/components/details/{details.css,explainSelection.ts}`, `src/components/{ChartCard,ChartSurface,EChart}.tsx`,
  `src/components/chartInteractions.css`, `src/components/assistant/{AssistantDrawer,AssistantDockMount}.tsx`,
  `src/components/assistant/assistant.css`, `src/utils/metricReceipt.ts`, `src/types/metrics.ts`, their
  tests, plus files no lane owns that this lane must touch and reports: `src/App.test.tsx` (two
  `name: 'Back'` queries — the Back button is renamed by spec), and — Task 12 only —
  `src/components/ChartTable.tsx` + `src/components/assistant/AssistantEvidence.tsx` (Disclosure
  adoption, spec §11 assigns it to F1). **Do NOT edit** `panels.css`, `shell.css`, `index.css`,
  `Segmented.tsx`, `tokens.ts`, `Layout.tsx`, any page, or anything under `src/components/shell/` —
  those are F2's or the page lanes'.
- **House rules encoded below:** durations in CSS only as `var(--t-fast|--t-xfade|--t-page|--t-nav)`
  (`src/theme/motion.test.ts` fails the whole suite on a literal `120ms`); keyframes and transitions
  sit inside `@media (prefers-reduced-motion: no-preference)` blocks the way the codebase does;
  JS timers read `MOTION_MS` from `src/theme/motion.ts`. Keyframe names are this lane's own
  (`detail-panel-in`, `detail-panel-out`, `dp-backdrop-in`, `surface-in`, `chart-backdrop-in`) so
  they never collide with F2's `pop-in` / `panel-in` / `backdrop-in` in `panels.css` (spec §16).
- **jsdom facts the tests rely on:** no `HTMLElement.prototype.animate`, no `AnimationEvent`, no
  `PointerEvent`, no `HTMLDialogElement.showModal`, no `matchMedia`. The provider therefore gates its
  exit ghost on `typeof el.animate === 'function'`; the ghost tests stub `animate`, drive
  `animationend` with `fireEvent.animationEnd`, and use `vi.useFakeTimers()` for the fallback timer.
  The drag test stubs `PointerEvent` from `MouseEvent`.
- **F2 dependency:** `src/components/Disclosure.tsx` is F2's deliverable. It does not exist on main
  today. Task 12 adopts it ONLY if it is present in your worktree (F2 merged before F1 branched, or
  you rebased onto a main that has it). Otherwise skip Task 12 and say so in the hand-off.
- **Not in this lane (F2 does them in `panels.css`; do not duplicate):** `.info-hint[aria-expanded="true"]`
  styling, adding `.metric-info-button` / `.detail-panel-resizer` to the hover-transition list, the
  `--scrim` / `--shadow` / `--fill` tokens (this lane consumes `var(--scrim, <today's value>)` with a
  fallback so the token lands when F2 merges), `.segmented-tabs` styling.

## Contracts this lane publishes (page lanes build against these verbatim)

```ts
// src/components/details/DetailPanelProvider.tsx
export interface DetailPanelRequest {
  id: string; title: string; subtitle?: string; content: ReactNode; actions?: ReactNode
  contextKey?: string; returnTo?: HTMLElement | null; onClose?: () => void
  modal?: boolean               // NEW — default true; false = no backdrop / aria-modal / inert / Tab trap
}
export function defaultPanelWidth(viewport: number): number   // clamp(400px, 26vw, 560px) as a number
export const MODE_STORAGE_KEY = 'finance.detailPanel.mode'
export const WIDTH_STORAGE_KEY = 'finance.detailPanel.width'
// document.documentElement carries --dock-width: '<n>px' while a dock is open, else '0px'

// src/components/EChart.tsx
height?: number | 'fill'       // 'fill' renders style height: 100%

// src/components/ChartCard.tsx
aside?: ReactNode              // body → <div class="chart-card-body chart-card-with-aside"> with the aside in column 2
// the selection panel opens with title = selection.label, subtitle = chart title

// src/utils/metricReceipt.ts
export const COMPLETENESS_LABELS: Record<string, string>
export function formatComponentLabel(label: string): string    // sentence case, no underscores
export function formatCompleteness(value: string): string      // map, then the sentence-case fallback
export function formatEvidenceValue(value, unit?, displayPrecision?): string  // MOVED here; MetricInspector re-exports it

// src/components/details/explainSelection.ts
export function explainPrompt(request: ExplainSelectionRequest): string
```

## Task list

| # | Task | Commit prefix |
| --- | --- | --- |
| 1 | Receipt labels and the `formatEvidenceValue` move (`utils/metricReceipt.ts`) | `fix(copy):` |
| 2 | `MetricInspector` copy: Data status, labels, definition tooltip, no "About this number" subtitle | `fix(copy):` |
| 3 | Metric-aware "Explain this number" prompt (`explainPrompt`) | `fix(copy):` |
| 4 | `SelectionDetail` says the label once + Scope row; `ChartCard` title/subtitle swap; pin strip | `fix(copy):` |
| 5 | `EChart` `height: 'fill'` and animation-free resize | `feat(chart):` |
| 6 | Chart Expand dialog: entrance, exit, void fix | `feat(chart):` |
| 7 | `ChartCard aside` | `feat(chart):` |
| 8 | Detail panel chrome + behaviour: `modal`, Escape pops one level, header row, persistence, default width, `--dock-width`, drag flag | `feat(panel):` |
| 9 | Detail panel motion: exit ghost, unified box model, keyframes, transitions | `feat(panel):` |
| 10 | Assistant inside the panel | `feat(assistant):` |
| 11 | Gates: tsc, eslint, scoped vitest, full vitest, build | — |
| 12 | Disclosure adoption — **requires F2's `Disclosure`; skip and report if absent** | `refactor(...)` |

---

## Task 1 — Receipt labels and the `formatEvidenceValue` move (spec §5)

**Files:**
- Modify: `src/utils/metricReceipt.ts`
- Modify: `src/components/details/MetricInspector.tsx` (lines 7 and 12–23: the `formatEvidenceValue` body moves out; a re-export stays)
- Create: `src/utils/metricReceipt.test.ts`

Why the move: Task 3's `explainPrompt` (in `explainSelection.ts`) needs `formatEvidenceValue`, and
`MetricInspector.tsx` already imports `explainSelection.ts` — importing back would be a cycle. A pure
formatter belongs in `utils/` anyway; the re-export keeps every existing importer (`SelectionDetail`,
`AssistantEvidence`, the tests) on its current import path.

- [x] **Step 1: Write the failing test**

Create `src/utils/metricReceipt.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { COMPLETENESS_LABELS, formatCompleteness, formatComponentLabel, formatEvidenceValue } from './metricReceipt'

// Reader-facing words for machine keys (2026-09-13 spec §5). The panel printed "Basis  complete"
// and "pre tax / post tax / liability" — the enum and the account-group keys leaking through.
describe('receipt labels', () => {
  it('maps every completeness value to a sentence', () => {
    expect(COMPLETENESS_LABELS).toEqual({
      complete: 'Complete',
      unreviewed_history: 'Includes months not yet reviewed',
      incomplete: 'Incomplete — some months missing',
      unavailable: 'Unavailable',
      mixed: 'Mixed sources',
      partial: 'Partial — some holdings unpriced',
      estimate: 'Estimate',
    })
    expect(formatCompleteness('mixed')).toBe('Mixed sources')
    expect(formatCompleteness('unreviewed_history')).toBe('Includes months not yet reviewed')
  })

  it('falls back to sentence case without underscores for a value the map has no words for', () => {
    // CashflowStrip and projectionDisplay pass their own vocabulary today.
    expect(formatCompleteness('partial_estimate')).toBe('Partial estimate')
    expect(formatCompleteness('scheduled_events')).toBe('Scheduled events')
    expect(formatCompleteness('estimated')).toBe('Estimated')
    // Exclusion reasons ride the same fallback and are already prose.
    expect(formatCompleteness('Take-home missing')).toBe('Take-home missing')
  })

  it('sentence-cases component labels, never prints an underscore, and leaves acronyms alone', () => {
    expect(formatComponentLabel('pre_tax')).toBe('Pre tax')
    expect(formatComponentLabel('post tax')).toBe('Post tax')
    expect(formatComponentLabel('liability')).toBe('Liability')
    expect(formatComponentLabel('HSA employer')).toBe('HSA employer')
    expect(formatComponentLabel('  living   spending ')).toBe('Living spending')
    expect(formatComponentLabel('')).toBe('')
  })

  it('formats values from here so the prompt and the panel agree on one notation', () => {
    expect(formatEvidenceValue('123.45', 'USD')).toBe('$123.45')
    expect(formatEvidenceValue('0.123456789', 'ratio', 7)).toBe('12.3456789%')
    expect(formatEvidenceValue(3, 'count')).toBe('3')
    expect(formatEvidenceValue(null)).toBe('Unavailable')
  })
})
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/utils/metricReceipt.test.ts`
Expected: FAIL — the four names are not exported from `./metricReceipt` (`is not a function` /
`toEqual` against `undefined`).

- [x] **Step 3: Implement — `src/utils/metricReceipt.ts` becomes**

```ts
import type { MetricEvidence } from '../types/metrics'
import type { HouseholdOut } from '../types/api'
import { getSnapshot } from '../api/snapshotCache'

/** Resolve a stored scope identifier for reading without changing the evidence. */
export function formatMetricScope(scope: MetricEvidence['scope']): string {
  if (scope === null || scope === 'household' || scope === 'Household' || scope === 'all') return 'Household'
  if (scope === 'joint') return 'Joint'
  const personId = typeof scope === 'number' ? scope : /^person:\d+$/.test(scope) ? Number(scope.slice(7)) : null
  if (personId === null) return scope as string
  return getSnapshot<HouseholdOut>('shell:household')?.people.find((person) => person.id === personId)?.name ?? 'Selected person'
}

/** Attach a receipt to an existing server value. Callers supply its actual date, scope
 * and components; this helper performs no monetary calculations. */
export function metricReceipt(input: Pick<MetricEvidence, 'id' | 'label' | 'value' | 'definition' | 'source_link'> & Partial<MetricEvidence>): MetricEvidence {
  return { definition_version: 'dashboard-v1', unit: 'USD', scope: 'household', completeness: input.value === null ? 'unavailable' : 'complete', components: [], source_label: 'Open source records', as_of: null, warnings: [], ...input }
}

/** The receipt's value in its unit's own notation. Lives here, not in MetricInspector, so the
 *  panel and the assistant's explain prompt format one figure the same way (MetricInspector
 *  re-exports it for its existing importers). */
export function formatEvidenceValue(value: string | number | null, unit?: string, displayPrecision?: number | null): string {
  if (value === null) return 'Unavailable'
  if (!unit) return String(value)
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value)
  const precision = typeof displayPrecision === 'number' && Number.isInteger(displayPrecision) && displayPrecision >= 0 && displayPrecision <= 9 ? displayPrecision : undefined
  if (unit === 'USD') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: precision ?? 2 }).format(number)
  if (unit === 'ratio') return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: precision ?? 2 }).format(number)
  if (unit === 'percent') return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: precision ?? 2 }).format(number)}%`
  if (unit === 'count') return new Intl.NumberFormat('en-US', { maximumFractionDigits: precision ?? 6 }).format(number)
  return `${value} ${unit}`
}

/** Reader-facing words for the completeness enum (2026-09-13 spec §5): the server's five values
 *  (`backend/app/schemas/metrics.py`) plus the two the frontend sets itself (partial, estimate). */
export const COMPLETENESS_LABELS: Record<string, string> = {
  complete: 'Complete',
  unreviewed_history: 'Includes months not yet reviewed',
  incomplete: 'Incomplete — some months missing',
  unavailable: 'Unavailable',
  mixed: 'Mixed sources',
  partial: 'Partial — some holdings unpriced',
  estimate: 'Estimate',
}

/** Sentence case with no underscores: `pre_tax` → `Pre tax`, ` HSA employer ` → `HSA employer`.
 *  Only the first letter is touched, so acronyms and proper names keep their capitals. */
export function formatComponentLabel(label: string): string {
  const words = label.replaceAll('_', ' ').replace(/\s+/g, ' ').trim()
  return words === '' ? '' : words.charAt(0).toUpperCase() + words.slice(1)
}

/** A completeness value — or an exclusion reason — as a reader would say it: the map first, the
 *  sentence-case fallback for anything the map has no words for. */
export function formatCompleteness(value: string): string {
  return COMPLETENESS_LABELS[value] ?? formatComponentLabel(value)
}
```

- [x] **Step 4: Re-export from `MetricInspector.tsx`**

In `src/components/details/MetricInspector.tsx` replace line 7 (`import { formatMetricScope } …`)
and delete lines 12–23 (the whole `formatEvidenceValue` function) so the top of the file reads:

```tsx
import { Info } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import type { MetricEvidence } from '../../types/metrics'
import { isApplicationSource } from '../../types/metrics'
import { formatEvidenceValue, formatMetricScope } from '../../utils/metricReceipt'
import { useDetailPanel } from './DetailPanelProvider'
import { explainSelection } from './explainSelection'
import './details.css'

// Moved to utils/metricReceipt.ts (the explain prompt formats the same figure); re-exported so
// SelectionDetail, AssistantEvidence and the tests keep their import path.
export { formatEvidenceValue }

export function ApplicationSourceLink({ href, children, onClick }: { href: string; children: ReactNode; onClick?: () => void }) {
```

Everything from `ApplicationSourceLink` down is unchanged in this task.

- [x] **Step 5: Run the tests and the type check**

Run: `npx vitest run src/utils/metricReceipt.test.ts src/components/details`
Expected: 3 files, 12 tests PASS (4 new + 8 existing).

Run: `npx tsc -b`
Expected: no output, exit 0.

- [x] **Step 6: Commit**

```bash
git add src/utils/metricReceipt.ts src/utils/metricReceipt.test.ts src/components/details/MetricInspector.tsx
git commit -m "fix(copy): completeness and component labels read as sentences; formatEvidenceValue moves to utils"
```

---

## Task 2 — `MetricInspector` copy: Data status, labels, definition tooltip, no subtitle (spec §5, §4)

**Files:**
- Modify: `src/components/details/MetricInspector.tsx` (the `MetricInspector` body and `MetricInfoButton`)
- Modify: `src/components/details/details.css` (delete the `.metric-definition-id` rule, line 38)
- Test: `src/components/details/MetricInspector.test.tsx`

- [x] **Step 1: Write the failing tests** — append inside the `describe('metric receipts and captured questions', …)` block of `src/components/details/MetricInspector.test.tsx`:

```tsx
  it('speaks the data status and component labels as sentences and keeps the definition id as a tooltip', () => {
    const { container } = render(<MetricInspector evidence={{ ...evidence, components: [
      { label: 'pre_tax', value: '10', unit: 'USD' },
      { label: 'liability', value: '-5', unit: 'USD', included: false },
    ] }} />)
    // Row label and value (2026-09-13 spec §5): "Basis: mixed" → "Data status: Mixed sources".
    expect(screen.getByText('Data status').nextElementSibling?.textContent).toBe('Mixed sources')
    expect(screen.queryByText('Basis')).toBeNull()
    expect(screen.getByText('Pre tax')).toBeTruthy()
    expect(screen.getByText('Liability (excluded)')).toBeTruthy()
    // The developer footer is gone from the visible receipt; support still has the id on hover.
    expect(screen.queryByText(/Definition:/)).toBeNull()
    expect(container.querySelector('.metric-inspector-definition')?.getAttribute('title'))
      .toBe('Metric living_spending_previous_12, definition spending-v1')
  })
```

and extend the existing `'opens from the figure and refreshes the visible receipt when its source changes'` test
with one assertion right after the first `expect(screen.getByText('$123.45')).toBeTruthy()`:

```tsx
    // The header's title IS the metric; "About this number" as a subtitle said it twice (spec §4).
    expect(document.querySelector('.detail-panel-heading p')).toBeNull()
```

- [x] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/details/MetricInspector.test.tsx`
Expected: FAIL — `Unable to find an element with the text: Data status`; the subtitle assertion fails
because `.detail-panel-heading p` renders "About this number".

- [x] **Step 3: Implement — replace the `MetricInspector` component and `MetricInfoButton`'s `open` call**

Import the two formatters (line 7 becomes):

```tsx
import { formatCompleteness, formatComponentLabel, formatEvidenceValue, formatMetricScope } from '../../utils/metricReceipt'
```

`MetricInspector` becomes:

```tsx
export default function MetricInspector({ evidence }: { evidence: MetricEvidence }) {
  const panel = useDetailPanel()
  const period = evidence.window
  return (
    <article className="metric-inspector" aria-label={`${evidence.label} calculation`}>
      <div className="metric-inspector-value">{formatEvidenceValue(evidence.value, evidence.unit, evidence.display_precision)}</div>
      {/* The definition/version identifier stays in the evidence record (design §3.4) and on hover
          for support; it is no longer printed as a footer (2026-09-13 spec §5). */}
      <p className="metric-inspector-definition" title={`Metric ${evidence.id}, definition ${evidence.definition_version}`}>{evidence.definition || evidence.description}</p>
      <dl className="metric-receipt-list">
        <div><dt>Scope</dt><dd>{formatMetricScope(evidence.scope)}</dd></div>
        <div><dt>Data status</dt><dd>{formatCompleteness(evidence.completeness)}</dd></div>
        {period && <div><dt>Period</dt><dd>{period.from} to {period.to}</dd></div>}
        {period && (period.included.length > 0 || period.excluded.length > 0) && <div><dt>Months included</dt><dd>{period.included.length}</dd></div>}
        {evidence.as_of && <div><dt>As of</dt><dd>{evidence.as_of}</dd></div>}
      </dl>
      {evidence.components.length > 0 && <>
        <h3>Components</h3>
        <dl className="metric-receipt-list">
          {evidence.components.map((component, index) => <div key={`${component.label}-${index}`}>
            {/* Defensive: callers should pass display labels (GROUP_LABELS), but a raw key must
                never reach the reader as `pre_tax`. */}
            <dt>{formatComponentLabel(component.label)}{component.included === false ? ' (excluded)' : ''}{component.description && <small> — {component.description}</small>}</dt>
            <dd>{formatEvidenceValue(component.value, component.unit ?? evidence.unit)}</dd>
          </div>)}
        </dl>
      </>}
      {period && period.included.length > 0 && <>
        <h3>Included months</h3>
        <ul className="metric-months">{period.included.map((month) => <li key={month}>{month.slice(0, 7)}</li>)}</ul>
        {(period.unreviewed_history_count ?? 0) > 0 && <p>{period.unreviewed_history_count} included {period.unreviewed_history_count === 1 ? 'month is' : 'months are'} unreviewed history.</p>}
      </>}
      {period && period.excluded.length > 0 && <>
        <h3>Excluded months</h3>
        <dl className="metric-receipt-list">{period.excluded.map(({ month, reason }) => <div key={month}><dt>{month.slice(0, 7)}</dt><dd>{formatCompleteness(reason)}</dd></div>)}</dl>
      </>}
      {evidence.warnings.length > 0 && <>
        <h3>Data notes</h3>
        <ul className="metric-warnings">{evidence.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
      </>}
      <ApplicationSourceLink href={evidence.source_link} onClick={() => panel?.close()}>{evidence.source_label || 'Open source records'}</ApplicationSourceLink>
      <div className="selection-detail-actions"><button type="button" className="button" onClick={() => explainSelection({
        kind: 'point', id: `metric:${evidence.id}`, label: evidence.label,
        date: evidence.window?.to ?? evidence.as_of ?? undefined, scope: evidence.scope,
        values: [{ label: evidence.label, value: evidence.value, unit: evidence.unit }], evidence: [evidence],
        source: { href: evidence.source_link, label: evidence.source_label },
      }, evidence.label)}>Explain this number</button></div>
    </article>
  )
}
```

In `MetricInfoButton`, the `onClick` line becomes (no subtitle):

```tsx
      if (panel) panel.open({ id, title: evidence.label, content: <MetricInspector evidence={evidence} /> })
```

In `src/components/details/details.css` delete line 38:

```css
.metric-definition-id { color: var(--muted); font-size: .7rem !important; margin-top: 1.2rem !important; }
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run src/components/details`
Expected: all PASS (DetailPanelProvider 4, MetricInspector 5).

- [x] **Step 5: Commit**

```bash
git add src/components/details/MetricInspector.tsx src/components/details/MetricInspector.test.tsx src/components/details/details.css
git commit -m "fix(copy): receipt rows speak in labels — Data status, sentence-cased components, definition id as a tooltip"
```

---

## Task 3 — Metric-aware "Explain this number" prompt (spec §5)

**Files:**
- Modify: `src/components/details/explainSelection.ts` (add `explainPrompt`)
- Modify: `src/components/assistant/AssistantDrawer.tsx` (the `onExplainSelection` listener, lines 581–590)
- Create: `src/components/details/explainSelection.test.ts`
- Test: `src/components/assistant/AssistantExperience.test.tsx` (one new case)

The template lives beside the event, not in the drawer: a pure function is testable without mounting
the assistant, and the drawer stays a consumer.

- [x] **Step 1: Write the failing unit test** — create `src/components/details/explainSelection.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ExplainSelectionRequest, MetricEvidence } from '../../types/metrics'
import { explainPrompt } from './explainSelection'

const evidence: MetricEvidence = {
  id: 'net_worth', definition_version: 'dashboard-v1', label: 'Net worth', definition: 'Sum of balances.',
  value: '806708.50', unit: 'USD', scope: 'household', completeness: 'complete', components: [],
  source_link: '/net-worth', source_label: 'Open source records', as_of: '2026-08-01', warnings: [],
}
const base = { sourceRoute: '/', capturedAt: '2026-09-13T00:00:00Z' }

// "Explain Net worth in Net worth." (audit E4) — a metric's chart title is its own label, so a
// metric is asked about as a FIGURE: value, period or as-of, scope (2026-09-13 spec §5).
describe('explainPrompt', () => {
  it('asks about a metric as a figure with its value, as-of date and scope', () => {
    const request: ExplainSelectionRequest = { ...base, chartTitle: 'Net worth', selection: {
      kind: 'point', id: 'metric:net_worth', label: 'Net worth', date: '2026-08-01', scope: 'household',
      values: [{ label: 'Net worth', value: '806708.50', unit: 'USD' }], evidence: [evidence],
    } }
    expect(explainPrompt(request)).toBe(
      'Explain the Net worth figure ($806,708.50, as of 2026-08-01, Household). Use the captured evidence and distinguish recorded facts from interpretation.',
    )
  })

  it('prefers the evidence window over the as-of date and honours display precision', () => {
    const windowed: MetricEvidence = { ...evidence, id: 'to_cap_rate', label: 'Election to reach cap', value: '0.123456789', unit: 'ratio', display_precision: 7,
      window: { from: '2025-08-01', to: '2026-07-01', included: [], excluded: [] } }
    const request: ExplainSelectionRequest = { ...base, chartTitle: 'Election to reach cap', selection: {
      kind: 'point', id: 'metric:to_cap_rate', label: 'Election to reach cap', scope: 1,
      values: [{ label: 'Election to reach cap', value: '0.123456789', unit: 'ratio' }], evidence: [windowed],
    } }
    expect(explainPrompt(request)).toBe(
      'Explain the Election to reach cap figure (12.3456789%, 2025-08-01 to 2026-07-01, Selected person). Use the captured evidence and distinguish recorded facts from interpretation.',
    )
  })

  it('leaves the parenthesis out when nothing is known beyond the label', () => {
    const request: ExplainSelectionRequest = { ...base, chartTitle: 'Mystery', selection: { kind: 'point', id: 'metric:mystery', label: 'Mystery', values: [] } }
    expect(explainPrompt(request)).toBe('Explain the Mystery figure. Use the captured evidence and distinguish recorded facts from interpretation.')
  })

  it('keeps the chart-in-title form for chart selections', () => {
    const request: ExplainSelectionRequest = { ...base, chartTitle: 'Net worth', selection: {
      kind: 'period', id: 'aug', period: '2026-08-01', label: 'August', values: [{ label: 'Net worth', value: 200, unit: 'USD' }],
    } }
    expect(explainPrompt(request)).toBe('Explain August in Net worth. Use the captured selection and distinguish recorded facts from interpretation.')
  })
})
```

(`formatMetricScope(1)` reads the household snapshot cache, which is empty in tests → `'Selected person'`.)

- [x] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/details/explainSelection.test.ts`
Expected: FAIL — `explainPrompt is not a function`.

- [x] **Step 3: Implement — `src/components/details/explainSelection.ts` becomes**

```ts
import type { ChartSelection, ExplainSelectionRequest } from '../../types/metrics'
import { formatEvidenceValue, formatMetricScope } from '../../utils/metricReceipt'

export const EXPLAIN_SELECTION_EVENT = 'finance:explain-selection'

export function explainSelection(selection: ChartSelection, chartTitle: string): void {
  // Copy before dispatch: the receiver owns a dated snapshot, even if a page later
  // mutates/replaces its scenario or changes owner while an answer is streaming.
  const request: ExplainSelectionRequest = JSON.parse(JSON.stringify({
    selection,
    chartTitle,
    sourceRoute: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    capturedAt: new Date().toISOString(),
  })) as ExplainSelectionRequest
  window.dispatchEvent(new CustomEvent<ExplainSelectionRequest>(EXPLAIN_SELECTION_EVENT, { detail: request }))
}

export function onExplainSelection(listener: (request: ExplainSelectionRequest) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<ExplainSelectionRequest>).detail)
  window.addEventListener(EXPLAIN_SELECTION_EVENT, handler)
  return () => window.removeEventListener(EXPLAIN_SELECTION_EVENT, handler)
}

/** The assistant's opening question for a captured selection (2026-09-13 spec §5). A metric
 *  receipt (id `metric:…`) is asked about as a FIGURE — value, period or as-of date, scope —
 *  because its chart title is its own label and "Explain Net worth in Net worth" read as a
 *  stutter. A chart selection keeps the selection-in-chart form. */
export function explainPrompt(request: ExplainSelectionRequest): string {
  const { selection, chartTitle } = request
  if (!selection.id.startsWith('metric:')) {
    return `Explain ${selection.label} in ${chartTitle}. Use the captured selection and distinguish recorded facts from interpretation.`
  }
  const evidence = selection.evidence?.[0]
  const figure = selection.values[0]
  const date = 'date' in selection ? selection.date : undefined
  const period = evidence?.window?.from && evidence.window.to
    ? `${evidence.window.from} to ${evidence.window.to}`
    : evidence?.as_of ? `as of ${evidence.as_of}` : date ? `as of ${date}` : null
  const parts = [
    figure === undefined ? null : formatEvidenceValue(figure.value, figure.unit, evidence?.display_precision),
    period,
    selection.scope === undefined ? null : formatMetricScope(selection.scope),
  ].filter((part): part is string => part !== null && part !== '')
  const detail = parts.length > 0 ? ` (${parts.join(', ')})` : ''
  return `Explain the ${selection.label} figure${detail}. Use the captured evidence and distinguish recorded facts from interpretation.`
}
```

- [x] **Step 4: Run the unit test**

Run: `npx vitest run src/components/details/explainSelection.test.ts`
Expected: 4 tests PASS.

- [x] **Step 5: Write the failing drawer test** — append inside `describe('assistant evidence and working context', …)` in `src/components/assistant/AssistantExperience.test.tsx`:

```tsx
  it('asks about a metric as a figure, never "X in X"', async () => {
    mount()
    const captured = { chartTitle: 'Net worth', sourceRoute: '/', capturedAt: '2026-09-13T00:00:00Z',
      selection: { kind: 'point', id: 'metric:net_worth', label: 'Net worth', date: '2026-08-01', scope: 'household',
        values: [{ label: 'Net worth', value: '806708.50', unit: 'USD' }], evidence: [{ ...bundle.metrics[0], window: null, as_of: '2026-08-01' }] } }
    act(() => window.dispatchEvent(new CustomEvent(EXPLAIN_SELECTION_EVENT, { detail: captured })))
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledOnce())
    expect(mocks.stream.mock.calls[0][0].messages.at(-1).content)
      .toBe('Explain the Net worth figure ($806,708.50, as of 2026-08-01, Household). Use the captured evidence and distinguish recorded facts from interpretation.')
    expect(mocks.stream.mock.calls[0][0].intent).toBe('selection')
  })
```

- [x] **Step 6: Run to verify it fails**

Run: `npx vitest run src/components/assistant/AssistantExperience.test.tsx`
Expected: FAIL on the new case — the content is `Explain Net worth in Net worth. Use the captured selection…`.

- [x] **Step 7: Implement in `AssistantDrawer.tsx`**

Import (add to the existing details imports, line 36):

```tsx
import { explainPrompt, onExplainSelection } from '../details/explainSelection'
```

Replace the listener (lines 581–590) with:

```tsx
  useEffect(() => onExplainSelection((selection) => {
    const source = new URL(selection.sourceRoute, window.location.origin)
    setPendingSelection({
      prompt: explainPrompt(selection),
      context: { route: source.pathname, search: Object.fromEntries(source.searchParams.entries()), view: JSON.parse(JSON.stringify(readAssistantView())), selection },
    })
    setTab('chat')
    requestOpen()
  }), [requestOpen])
```

- [x] **Step 8: Run the tests**

Run: `npx vitest run src/components/assistant/AssistantExperience.test.tsx src/components/details`
Expected: all PASS.

- [x] **Step 9: Commit**

```bash
git add src/components/details/explainSelection.ts src/components/details/explainSelection.test.ts src/components/assistant/AssistantDrawer.tsx src/components/assistant/AssistantExperience.test.tsx
git commit -m "fix(copy): explain-this-number names the figure, its period and scope instead of 'X in X'"
```

---

## Task 4 — `SelectionDetail` says the label once; `ChartCard` title/subtitle swap; pin strip (spec §4, audit B5/D3)

**Files:**
- Modify: `src/components/details/SelectionDetail.tsx`
- Modify: `src/components/ChartCard.tsx` (`inspect()` line 132, the effect at line 140, the pin strip lines 245–249)
- Test: `src/components/details/MetricInspector.test.tsx`, `src/components/ChartCard.test.tsx`

- [x] **Step 1: Write the failing tests**

In `src/components/details/MetricInspector.test.tsx` add the import and a case:

```tsx
import SelectionDetail from './SelectionDetail'
```

```tsx
  it('SelectionDetail states the selection once — Scope is a receipt row, no leading paragraph', () => {
    const selection: ChartSelection = { kind: 'period', id: 'aug', period: '2026-08-01', label: 'August', scope: 'household', values: [{ label: 'Net worth', value: 200, unit: 'USD' }] }
    const { container } = render(<SelectionDetail selection={selection} chartTitle="Net worth" />)
    // The panel header already says "August" (audit B5: the label appeared three times in 120px).
    expect(container.querySelector('article > p')).toBeNull()
    const rows = Array.from(container.querySelectorAll('.metric-receipt-list > div'))
      .map((row) => `${row.querySelector('dt')?.textContent}: ${row.querySelector('dd')?.textContent}`)
    expect(rows).toEqual(['Scope: Household', 'Net worth: $200.00'])
  })
```

In `src/components/ChartCard.test.tsx`, inside `describe('ChartCard persistent interactions', …)`, add:

```tsx
  it('names the panel after the selection, keeps the chart title as its subtitle, and the pin strip announces only its text', () => {
    render(<DetailPanelProvider><ChartCard {...base} option={history} selectionAdapter={() => selection} /></DetailPanelProvider>)
    fireEvent.click(screen.getByTestId('echart'))
    expect(screen.getByRole('dialog', { name: 'August' })).toBeTruthy()
    expect(document.querySelector('.detail-panel-heading p')?.textContent).toBe('Net worth')
    // role="status" on the text span only (audit D3): a re-pin never re-announces the buttons.
    const strip = document.querySelector('.chart-selection-summary') as HTMLElement
    expect(strip.getAttribute('role')).toBeNull()
    expect(strip.querySelector('[role="status"]')?.textContent).toBe('Pinned: August')
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }))
    expect(screen.getByRole('dialog', { name: 'August' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Details' })).toBeNull()
  })
```

Also update the two existing assertions that named the dialog after the chart (they pass vacuously today and would keep passing vacuously; they should assert the real name):
`'keeps a dismissed custom selection closed across panel-context updates'` line 181 and
`'immediately removes a stale owner selection and its panel on scope change'` line 222 —
`screen.queryByRole('dialog', { name: 'Net worth' })` → `screen.queryByRole('dialog', { name: 'August' })`.

- [x] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/details/MetricInspector.test.tsx src/components/ChartCard.test.tsx`
Expected: FAIL — SelectionDetail renders `<p>August</p>` first and `Scope: Household` as a paragraph; the
dialog is named `Net worth`; the strip carries `role="status"`; no `Show details` button.

- [x] **Step 3: Implement `SelectionDetail.tsx`** (whole file):

```tsx
import type { ChartSelection } from '../../types/metrics'
import { formatMetricScope } from '../../utils/metricReceipt'
import { useDetailPanel } from './DetailPanelProvider'
import { explainSelection } from './explainSelection'
import MetricInspector, { ApplicationSourceLink, formatEvidenceValue } from './MetricInspector'

// The panel's header already names the selection (ChartCard passes title = selection.label,
// subtitle = chart title — 2026-09-13 spec §4), so the body starts with the receipt: Scope as its
// first row, then the values.
export default function SelectionDetail({ selection, chartTitle, onClear, onOpenSource }: { selection: ChartSelection; chartTitle: string; onClear?: () => void; onOpenSource?: () => void }) {
  const panel = useDetailPanel()
  return <article className="selection-detail" aria-label={`${selection.label} selected values`}>
    <dl className="metric-receipt-list">
      {selection.scope !== undefined && <div><dt>Scope</dt><dd>{formatMetricScope(selection.scope)}</dd></div>}
      {selection.values.map((value, index) => <div key={`${value.label}-${index}`}>
        <dt>{value.label}</dt><dd>{formatEvidenceValue(value.value, value.unit)}</dd>
      </div>)}
    </dl>
    {selection.evidence?.map((evidence) => <details key={evidence.id}><summary>{evidence.label}: calculation</summary><MetricInspector evidence={evidence} /></details>)}
    <div className="selection-detail-actions">
      {selection.source && <ApplicationSourceLink href={selection.source.href} onClick={() => { panel?.close(); onOpenSource?.() }}>{selection.source.label}</ApplicationSourceLink>}
      <button type="button" className="button" onClick={() => explainSelection(selection, chartTitle)}>Explain selection</button>
      {onClear && <button type="button" className="button" onClick={onClear}>Clear selection</button>}
    </div>
  </article>
}
```

- [x] **Step 4: Implement the `ChartCard.tsx` swap and strip**

Line 132 (`inspect`) becomes:

```tsx
    if (!expanded && activeView) openPanel?.({ id: panelId, title: next.label, subtitle: title, content: panelContent, contextKey: selectionScopeKey })
```

Line 140 (the effect) becomes:

```tsx
    openPanel?.({ id: panelId, title: selected.label, subtitle: title, content: panelContent, contextKey: selectionScopeKey })
```

Lines 245–249 (the pin strip) become:

```tsx
      {selected && <div className="chart-selection-summary">
        {/* Live region on the TEXT only (audit D3): each pin announces "Pinned: …", never the buttons. */}
        <span role="status">Pinned: {selected.label}</span>
        {panel && !expanded && <button type="button" className="button" onClick={() => panel.open({ id: panelId, title: selected.label, subtitle: title, content: panelContent, contextKey: selectionScopeKey })}>Show details</button>}
        <button type="button" className="button" onClick={clearSelection}>Clear selection</button>
      </div>}
```

- [x] **Step 5: Run the tests**

Run: `npx vitest run src/components/details src/components/ChartCard.test.tsx`
Expected: all PASS.

- [x] **Step 6: Commit**

```bash
git add src/components/details/SelectionDetail.tsx src/components/details/MetricInspector.test.tsx src/components/ChartCard.tsx src/components/ChartCard.test.tsx
git commit -m "fix(copy): selection panel names the selection once (title = label, subtitle = chart); pin strip announces its text only"
```

---

## Task 5 — `EChart`: `height: 'fill'` and an animation-free resize (spec §2.2, §2.3)

**Files:**
- Modify: `src/components/EChart.tsx` (props lines 26 and 39, the ResizeObserver lines 163–168, the host `style` line 354)
- Test: `src/components/EChart.test.tsx`

- [x] **Step 1: Write the failing tests**

In `src/components/EChart.test.tsx`, replace the body of `'resizes when the element and the engine disagree'`
(inside `describe('EChart resize guard (spec §6)')`) with:

```tsx
  it('resizes when the element and the engine disagree — without an engine animation on top of the CSS motion', () => {
    render(<EChart ariaLabel="test chart" option={OPTION} />)
    const chart = lastChart()
    chart.getWidth.mockReturnValue(800) // the element is still jsdom's 0-wide
    resizeNotify.forEach((fire) => fire())
    expect(chart.resize).toHaveBeenCalledTimes(1)
    // The dock's margin transition already moves the canvas per frame (2026-09-13 spec §2.2); an
    // ECharts update animation on each of those ~14 resizes would smear the series behind it.
    expect(chart.resize).toHaveBeenCalledWith({ animation: { duration: 0 } })
  })
```

and add a new describe at the end of the file:

```tsx
// The expanded dialog sizes the chart from the dialog, not from window.innerHeight (spec §2.3):
// the card is a flex column and the host takes 100% of what the chrome leaves.
describe('EChart height', () => {
  it('a number is pixels', () => {
    const { container } = render(<EChart option={OPTION} ariaLabel="Sized chart" height={280} />)
    expect((container.firstElementChild as HTMLElement).style.height).toBe('280px')
  })
  it("'fill' hands the host to its flex parent — height: 100%", () => {
    const { container } = render(<EChart option={OPTION} ariaLabel="Filled chart" height="fill" />)
    expect((container.firstElementChild as HTMLElement).style.height).toBe('100%')
  })
})
```

- [x] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/EChart.test.tsx`
Expected: FAIL — `resize` was called with no arguments; `height="fill"` is a type error at runtime
renders `style.height` as `''` (jsdom drops the invalid `fill` length).

- [x] **Step 3: Implement**

`src/components/EChart.tsx` — the prop (line 39) becomes:

```tsx
  /** Pixels, or 'fill' = `height: 100%` for a host whose parent sizes it (the expanded chart
   *  dialog's flex column — 2026-09-13 spec §2.3). The ResizeObserver below refits either way. */
  height?: number | 'fill'
```

The ResizeObserver callback (lines 163–168) becomes:

```tsx
    // The browser fires this the moment observe() is called, carrying the size the chart was
    // just init'ed at; resize() there restarts every animator, killing the entrance (spec §6).
    // `animation.duration: 0`: while the dock's margin transitions (2026-09-13 spec §2.2) this
    // fires once per frame, and the engine's own update animation on each call would run on
    // top of the CSS motion — the resize is a refit, not a scene change.
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== chart.getWidth() || el.clientHeight !== chart.getHeight()) {
        chart.resize({ animation: { duration: 0 } })
      }
    })
```

The host (line 354) becomes:

```tsx
      style={{ height: height === 'fill' ? '100%' : height, width: '100%' }}
```

- [x] **Step 4: Run the tests and the type check**

Run: `npx vitest run src/components/EChart.test.tsx`
Expected: all PASS (existing + 2 new).

Run: `npx tsc -b`
Expected: no output, exit 0 (`ResizeOpts.animation` exists on the ECharts 6 instance type).

- [x] **Step 5: Commit**

```bash
git add src/components/EChart.tsx src/components/EChart.test.tsx
git commit -m "feat(chart): EChart fills its host on request and refits without an engine animation"
```

---

## Task 6 — Chart Expand dialog: entrance, exit, and the void fix (spec §2.3, audit A3)

**Files:**
- Modify: `src/components/chartInteractions.css` (lines 2–5)
- Modify: `src/components/ChartCard.tsx` (line 171 `chartHeight` and line 188 `height={chartHeight}`)
- Test: `src/components/ChartCard.test.tsx`

Motion timing is not unit-tested (jsdom does not run CSS); lane V measures it. The unit test pins the
one thing the card decides: expanded → `'fill'`, not `innerHeight - 280`.

- [x] **Step 1: Write the failing test** — in `src/components/ChartCard.test.tsx`, first widen the EChart
mock's prop type (line 10) so `data-height` can carry `'fill'`:

```tsx
    default: ({ ariaLabel, animateEntrance = true, group, height, onClick, onDataZoom }: { ariaLabel?: string; animateEntrance?: boolean; group?: string; height?: number | 'fill'; onClick?: (params: { dataIndex: number; seriesIndex: number }) => void; onDataZoom?: (window: { startValue: number; endValue: number }) => void }) =>
```

then add inside `describe('ChartCard persistent interactions', …)`:

```tsx
  it('expanded → the chart fills the dialog; collapsed → the card height comes back', () => {
    render(<ChartCard {...base} option={OPTION} height={320} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand Net worth' }))
    // No `innerHeight - 280` arithmetic (audit A3's 88px void): the dialog's flex column sizes it.
    expect(screen.getByTestId('echart').getAttribute('data-height')).toBe('fill')
    fireEvent.click(screen.getByRole('button', { name: 'Close expanded Net worth' }))
    expect(screen.getByTestId('echart').getAttribute('data-height')).toBe('320')
  })
```

- [x] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/ChartCard.test.tsx`
Expected: FAIL — `data-height` is `"488"` (jsdom's `innerHeight` 768 − 280) instead of `"fill"`.

- [x] **Step 3: Implement `ChartCard.tsx`**

Delete line 171 (`const chartHeight = expanded ? Math.max(height, window.innerHeight - 280) : height`) and
change the `EChart` mount's height prop (line 188) to:

```tsx
          height={expanded ? 'fill' : height}
```

- [x] **Step 4: Implement `chartInteractions.css`** — replace lines 2–5 with:

```css
.chart-expanded-dialog { position: fixed; inset: 24px; width: calc(100vw - 48px); max-width: none; height: calc(100vh - 48px); max-height: none; margin: 0; padding: 0; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 12px; overflow: auto; }
/* --scrim is F2's light-theme token (spec §6); the fallback is today's value. */
.chart-expanded-dialog::backdrop { background: var(--scrim, #0009); }
/* The void fix (spec §2.3): ChartSurface appends a class-less host div, so dialog → host → card
   is the chain that hands the plot every pixel the header, export row and footer do not need.
   EChart's `height: 'fill'` reads it; the ResizeObserver refits the canvas. */
.chart-expanded-dialog > div { height: 100%; }
.chart-expanded-dialog .chart-card { display: flex; flex-direction: column; height: 100%; border: 0; border-radius: 0; }
.chart-expanded-dialog .loading-dim { flex: 1; min-height: 0; }
.chart-expanded-dialog .chart-card-header { position: sticky; top: 0; z-index: 1; background: var(--surface); padding-bottom: .5rem; }
```

and append at the end of the file:

```css

/* ── Expand dialog motion (2026-09-13 spec §2.3) ────────────────────────────
   Entrance: the surface fades up from the card over --t-page; the backdrop over --t-fast. Exit:
   where the engine can transition `display`/`overlay` discretely (Chromium ≥ 117, Safari 17.4),
   the dialog fades over --t-fast on close; elsewhere the close stays instant — focus and scroll
   are already restored by ChartSurface. Tokens only (motion.test.ts); the reduce block zeroes
   them and this block is gated besides. Keyframe names are this lane's own (spec §16). */
@media (prefers-reduced-motion: no-preference) {
  .chart-expanded-dialog[open] { animation: surface-in var(--t-page) var(--ease-out) both; }
  .chart-expanded-dialog[open]::backdrop { animation: chart-backdrop-in var(--t-fast) ease both; }
  @keyframes surface-in { from { opacity: 0; transform: translateY(8px) scale(.985); } }
  @keyframes chart-backdrop-in { from { opacity: 0; } }

  @supports (transition-behavior: allow-discrete) {
    .chart-expanded-dialog {
      transition:
        opacity var(--t-fast) ease,
        transform var(--t-fast) ease,
        overlay var(--t-fast) ease allow-discrete,
        display var(--t-fast) ease allow-discrete;
    }
    .chart-expanded-dialog:not([open]) { opacity: 0; transform: translateY(8px) scale(.985); }
    @starting-style {
      .chart-expanded-dialog[open] { opacity: 0; transform: translateY(8px) scale(.985); }
    }
  }
}
```

- [x] **Step 5: Run the tests, including the motion literal scan**

Run: `npx vitest run src/components/ChartCard.test.tsx src/theme/motion.test.ts`
Expected: all PASS — `motion.test.ts`'s "no stylesheet states a finite duration as a literal" stays
green because every layer's first duration slot is a `var(--t-*)`.

- [x] **Step 6: Commit**

```bash
git add src/components/chartInteractions.css src/components/ChartCard.tsx src/components/ChartCard.test.tsx
git commit -m "feat(chart): the Expand dialog fades up and out; the chart fills it instead of an innerHeight guess"
```

---

## Task 7 — `ChartCard aside` (spec §12)

**Files:**
- Modify: `src/components/ChartCard.tsx` (props interface, destructuring, the `<section>` class, the `{body}` slot at line 244)
- Modify: `src/components/chartInteractions.css` (append)
- Test: `src/components/ChartCard.test.tsx`

Used later by P2 (Allocation's donut + ranked table) and P1 (Spending's dock donut + legend list).
The card is the container-query container (an element cannot query itself), so the two columns
follow the CARD's width — a dock or a `span-6` narrows it — not the viewport's.

- [x] **Step 1: Write the failing test** — inside `describe('ChartCard chrome', …)` in `src/components/ChartCard.test.tsx`:

```tsx
  it('renders an aside beside the plot in a two-column body wrapper, and no wrapper at all without one', () => {
    render(<ChartCard {...base} option={OPTION} aside={<ul className="legend-list"><li>Cash</li></ul>} />)
    const section = document.querySelector('section.chart-card') as HTMLElement
    expect(section.classList.contains('chart-card-has-aside')).toBe(true) // the container-query root
    const wrapper = section.querySelector('.chart-card-body.chart-card-with-aside') as HTMLElement
    expect(wrapper).toBeTruthy()
    expect(wrapper.children[0].className).toBe('chart-card-plot')
    expect(wrapper.children[0].querySelector('[data-testid="echart"]')).toBeTruthy()
    expect(wrapper.children[1].className).toBe('chart-card-aside')
    expect(wrapper.children[1].textContent).toBe('Cash')
    // The wrapper sits where the bare plot did: after the export row, before the zoom/table/footer rows.
    expect(wrapper.previousElementSibling?.className).toBe('chart-card-row chart-card-row-export')
    cleanup()
    render(<ChartCard {...base} option={OPTION} />)
    expect(document.querySelector('.chart-card-body')).toBeNull()
    expect(document.querySelector('.chart-card-has-aside')).toBeNull()
  })
```

- [x] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/ChartCard.test.tsx`
Expected: FAIL — `aside` is not a known prop (tsc) / `.chart-card-has-aside` is not on the section.

- [x] **Step 3: Implement `ChartCard.tsx`**

Add to `ChartCardProps` after `lede`:

```tsx
  /** A second column beside the plot — Allocation's ranked table, Spending's legend list (2026-09-13
   *  spec §12). The body becomes `.chart-card-body.chart-card-with-aside`, one column under 900px of
   *  CARD width (the card is the container-query root). */
  aside?: ReactNode
```

Add `aside` to the destructuring (line 83, after `lede`):

```tsx
  title, hint, ariaLabel, option, empty, exportName, csv, caption, height = 320, controls, actions, footer, lede, aside,
```

The `<section>` (line 208) becomes:

```tsx
    <section className={`card chart-card span-${span}${aside !== undefined ? ' chart-card-has-aside' : ''}`}>
```

The `{body}` slot (line 244) becomes:

```tsx
      {aside !== undefined
        ? <div className="chart-card-body chart-card-with-aside"><div className="chart-card-plot">{body}</div><div className="chart-card-aside">{aside}</div></div>
        : body}
```

- [x] **Step 4: Append to `chartInteractions.css`**

```css

/* ── ChartCard `aside` (2026-09-13 spec §12) ──────────────────────────────
   The plot and a second column. `.chart-card-has-aside` (the section) is the query container — the
   body cannot query itself — so the columns collapse on the CARD's width, which a dock or a span-6
   narrows, not on the viewport's. inline-size containment is safe here: the card's width is the
   grid track's, never its content's, and the InfoHint bubble / ECharts tooltip are already
   positioned inside the card. */
.chart-card-has-aside { container-type: inline-size; }
.chart-card-with-aside { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, .9fr); gap: 1rem 1.5rem; align-items: start; }
.chart-card-with-aside > .chart-card-plot, .chart-card-with-aside > .chart-card-aside { min-width: 0; }
@container (max-width: 899px) {
  .chart-card-with-aside { grid-template-columns: minmax(0, 1fr); }
}
/* Inside the Expand dialog the wrapper is the flex child that grows, and the plot column is its own
   column flexbox so `.loading-dim { flex: 1 }` (above) still reaches the canvas. */
.chart-expanded-dialog .chart-card-with-aside { flex: 1; min-height: 0; grid-template-rows: minmax(0, 1fr); }
.chart-expanded-dialog .chart-card-plot { display: flex; flex-direction: column; min-height: 0; }
```

- [x] **Step 5: Run the tests**

Run: `npx vitest run src/components/ChartCard.test.tsx`
Expected: all PASS.

Run: `npx tsc -b`
Expected: no output, exit 0.

- [x] **Step 6: Commit**

```bash
git add src/components/ChartCard.tsx src/components/ChartCard.test.tsx src/components/chartInteractions.css
git commit -m "feat(chart): ChartCard aside — a second column beside the plot, one column under 900px of card width"
```

---

## Task 8 — Detail panel chrome and behaviour (spec §4, §2.2 `--dock-width` and `.is-dragging`; audit B1, B3, B4, B6, B7, F1, F2, G1-1, G2)

**Files:**
- Modify: `src/components/details/DetailPanelProvider.tsx` (whole file — written out below)
- Modify: `src/components/details/details.css` (whole file — written out below; Task 9 appends motion)
- Modify: `src/components/details/DetailPanelProvider.test.tsx` (whole file — written out below)
- Modify (one query each — the Back button is renamed by spec): `src/components/ChartCard.test.tsx` line 196,
  `src/components/assistant/AssistantExperience.test.tsx` line 82, `src/App.test.tsx` lines 76 and 86

What changes, in one list: `DetailPanelRequest.modal?: boolean`; Escape pops one level; Back/Close become
icon buttons (`ChevronLeft` / `X`, 14px) with `aria-label`s "Back to {previous title}" / "Close details";
the mode toolbar row is replaced by a `Segmented variant="toggle" size="sm"` in the header row whose
options are icon-only (`PanelRight` / `Layers` / `Maximize2`|`Minimize2`) with `title` + an accessible
name ("Beside the page", "Over the page", "Reading mode" / "Exit reading mode"); `active.actions` render
after it; the subtitle is inline; DOM order is heading → body → Back → mode control → actions → Close →
resizer (the header row is grid-placed); mode and width persist in `localStorage`
(`finance.detailPanel.mode`, `finance.detailPanel.width`); the default width is `clamp(400px, 26vw, 560px)`
computed from `window.innerWidth`; `--dock-width` is published on `<html>`; the layout carries
`.is-dragging` while the resizer has the pointer; `.metric-info-button[aria-expanded="true"]`, the
reading-mode measure cap, the receipt grid and the resizer grip land in the CSS.

Motion (transitions, keyframes, the exit ghost, the unified box model's transition) is Task 9 — the
CSS below already uses the `--dp-*` box model so Task 9 only appends the motion block.

- [x] **Step 1: Rewrite the test file** — `src/components/details/DetailPanelProvider.test.tsx` becomes:

```tsx
import { cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DetailPanelProvider, { defaultPanelWidth, MODE_STORAGE_KEY, panelGeometry, useDetailPanel, WIDTH_STORAGE_KEY } from './DetailPanelProvider'

function Harness() {
  const panel = useDetailPanel()!
  return <button type="button" onClick={() => panel.open({ id: 'chart', title: 'August spending', content: <>
    <p>Selected month retained</p>
    <button type="button" onClick={() => panel.open({ id: 'metric', title: 'Living spending', content: <p>Source receipt</p> })}>Open calculation</button>
  </> })}>Inspect month</button>
}

/** The assistant's shape (spec §4): a request that must not take the page hostage in overlay mode. */
function NonModalHarness() {
  const panel = useDetailPanel()!
  return <button type="button" onClick={() => panel.open({ id: 'assistant', title: 'Assistant', content: <p>Chat</p>, modal: false })}>Open assistant</button>
}

const setViewport = (width: number) => Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })

type PointerHost = { PointerEvent?: typeof PointerEvent }
/** jsdom ships no PointerEvent, and Testing Library then falls back to a bare Event that carries no
 *  clientX/button — the resizer reads both. A MouseEvent subclass on the DOCUMENT's window (the
 *  constructor Testing Library resolves through node.ownerDocument.defaultView) is enough. */
function withPointerEvents(run: () => void) {
  const view = document.defaultView as unknown as PointerHost
  const original = view.PointerEvent
  view.PointerEvent = class FakePointerEvent extends MouseEvent { pointerId = 1 } as unknown as typeof PointerEvent
  try {
    run()
  } finally {
    if (original === undefined) delete view.PointerEvent
    else view.PointerEvent = original
  }
}

beforeEach(() => setViewport(1600))
// The provider persists mode and width; a test that switched to overlay must not leak into the next.
afterEach(() => { cleanup(); localStorage.clear() })

describe('coordinated detail panels', () => {
  it('replaces a surface with its evidence; Back returns to the selection; Escape pops one level, then closes', () => {
    render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
    const trigger = screen.getByRole('button', { name: 'Inspect month' })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'August spending' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open calculation' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByText('Source receipt')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to August spending' }))
    expect(screen.getByText('Selected month retained')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open calculation' }))
    // Design §5.1: Escape dismisses the TOPMOST surface. The old assertion pinned whole-stack close
    // (audit F1: a reader who opened evidence from a conversation lost the conversation).
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'August spending' })).toBeTruthy()
    expect(screen.getByText('Selected month retained')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('resizes by keyboard and reserves page space only in dock mode', () => {
    render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
    const separator = screen.getByRole('separator', { name: 'Resize detail panel' })
    // clamp(400px, 26vw, 560px) at 1600 → 416 (spec §4), no longer a fixed 440.
    expect(separator.getAttribute('aria-valuenow')).toBe('416')
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(separator.getAttribute('aria-valuenow')).toBe('436')
    expect((document.querySelector('.detail-layout-content') as HTMLElement).style.marginInlineEnd).toBe('436px')
    fireEvent.click(screen.getByRole('button', { name: 'Over the page' }))
    expect((document.querySelector('.detail-layout-content') as HTMLElement).style.marginInlineEnd).toBe('0')
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Reading mode' }))
    expect(screen.getByRole('dialog').className).toContain('detail-panel-expanded')
    expect(screen.getByText('Selected month retained')).toBeTruthy()
    // Reading mode is a toggle: pressed again it returns to the mode it came from, and relabels.
    expect(screen.getByRole('button', { name: 'Exit reading mode' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Exit reading mode' }))
    expect(screen.getByRole('dialog').className).toContain('detail-panel-overlay')
  })

  it('falls back to overlay when a dock would crowd the main content; the default width follows the viewport', () => {
    expect(panelGeometry(1200, 440, 'dock')).toMatchObject({ canDock: false, mode: 'overlay', width: 440 })
    expect(panelGeometry(1600, 900, 'dock')).toMatchObject({ canDock: true, mode: 'dock', width: 670 })
    expect(defaultPanelWidth(1200)).toBe(400) // 26vw = 312 → the 400px floor
    expect(defaultPanelWidth(1600)).toBe(416)
    expect(defaultPanelWidth(2400)).toBe(560) // 26vw = 624 → the 560px ceiling
  })

  it('restores focus only after an overlay releases the inert page', () => {
    render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
    const trigger = screen.getByRole('button', { name: 'Inspect month' })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Over the page' }))
    const content = document.querySelector('.detail-layout-content')!
    expect(content.hasAttribute('inert')).toBe(true)
    const focusedWhileInert: boolean[] = []
    const originalFocus = trigger.focus.bind(trigger)
    const focus = vi.spyOn(trigger, 'focus').mockImplementation((options) => {
      focusedWhileInert.push(content.hasAttribute('inert'))
      originalFocus(options)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(focusedWhileInert).toEqual([false])
    expect(document.activeElement).toBe(trigger)
    focus.mockRestore()
  })

  it('one chrome row: icon Back/Close, an icon mode control with tooltips, content before controls in the tab order', () => {
    render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
    const dialog = screen.getByRole('dialog', { name: 'August spending' })
    expect(dialog.querySelector('.detail-panel-toolbar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Dock' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Expand reading' })).toBeNull()
    const layout = screen.getByRole('group', { name: 'Detail panel layout' })
    expect(within(layout).getAllByRole('button').map((button) => button.getAttribute('title'))).toEqual(['Beside the page', 'Over the page', 'Reading mode'])
    expect(screen.getByRole('button', { name: 'Beside the page' }).getAttribute('aria-pressed')).toBe('true')
    const close = screen.getByRole('button', { name: 'Close details' })
    expect(close.className).toBe('detail-panel-icon-button')
    expect(close.textContent).toBe('') // an icon, not the word
    // DOM order IS focus order (audit F2 measured five chrome stops before the content).
    const stops = Array.from(dialog.querySelectorAll<HTMLElement>('button, [tabindex="0"]'))
      .map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim())
    expect(stops).toEqual(['Open calculation', 'Beside the page', 'Over the page', 'Reading mode', 'Close details', 'Resize detail panel'])
    fireEvent.click(screen.getByRole('button', { name: 'Open calculation' }))
    const back = screen.getByRole('button', { name: 'Back to August spending' })
    expect(back.className).toBe('detail-panel-icon-button')
    expect(back.getAttribute('title')).toBe('Back to August spending')
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('a non-modal request leaves the page live: no backdrop, no aria-modal, no inert, no Tab trap; Escape still closes', () => {
    setViewport(1200) // no room to dock → overlay, where a modal request would take the page hostage
    render(<DetailPanelProvider><NonModalHarness /></DetailPanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Open assistant' }))
    const dialog = screen.getByRole('dialog', { name: 'Assistant' })
    expect(dialog.className).toContain('detail-panel-overlay')
    expect(dialog.getAttribute('aria-modal')).toBeNull()
    expect(document.querySelector('.detail-panel-backdrop')).toBeNull()
    expect(document.querySelector('.detail-layout-content')!.hasAttribute('inert')).toBe(false)
    // The disabled Dock option explains itself.
    const dock = screen.getByRole('button', { name: 'Beside the page' })
    expect(dock.hasAttribute('disabled')).toBe(true)
    expect(dock.getAttribute('title')).toBe('Widen the window to keep at least 720 pixels of page content beside details.')
    // Tab from the panel's last stop is NOT wrapped back into it.
    screen.getByRole('separator', { name: 'Resize detail panel' }).focus()
    const tab = createEvent.keyDown(document, { key: 'Tab' })
    fireEvent(document, tab)
    expect(tab.defaultPrevented).toBe(false)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a modal overlay still traps Tab inside the panel', () => {
    setViewport(1200)
    render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
    screen.getByRole('separator', { name: 'Resize detail panel' }).focus()
    const tab = createEvent.keyDown(document, { key: 'Tab' })
    fireEvent(document, tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open calculation' }))
  })

  it('remembers the layout mode and the dragged width across mounts — localStorage, not the server', () => {
    const first = render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
    // Untouched controls persist nothing: the default keeps following the viewport.
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(WIDTH_STORAGE_KEY)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Over the page' }))
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize detail panel' }), { key: 'ArrowLeft' })
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('overlay')
    expect(localStorage.getItem(WIDTH_STORAGE_KEY)).toBe('436')
    first.unmount()
    render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('button', { name: 'Over the page' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('separator', { name: 'Resize detail panel' }).getAttribute('aria-valuenow')).toBe('436')
  })

  it('publishes the dock width on <html> for the assistant launcher, and 0px away from the dock', () => {
    render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
    expect(document.documentElement.style.getPropertyValue('--dock-width')).toBe('0px')
    fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
    expect(document.documentElement.style.getPropertyValue('--dock-width')).toBe('416px')
    fireEvent.click(screen.getByRole('button', { name: 'Over the page' }))
    expect(document.documentElement.style.getPropertyValue('--dock-width')).toBe('0px')
    fireEvent.click(screen.getByRole('button', { name: 'Beside the page' }))
    expect(document.documentElement.style.getPropertyValue('--dock-width')).toBe('416px')
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(document.documentElement.style.getPropertyValue('--dock-width')).toBe('0px')
  })

  it('flags the layout while the resizer has the pointer, tracks the drag, and stores the result', () => {
    withPointerEvents(() => {
      render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
      fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
      const separator = screen.getByRole('separator', { name: 'Resize detail panel' })
      const content = document.querySelector('.detail-layout-content') as HTMLElement
      fireEvent.pointerDown(separator, { button: 0, clientX: 800 })
      expect(content.classList.contains('is-dragging')).toBe(true)
      expect(document.querySelector('.detail-panel-layer')?.classList.contains('is-dragging')).toBe(true)
      fireEvent.pointerMove(separator, { clientX: 780 })
      expect(separator.getAttribute('aria-valuenow')).toBe('436')
      fireEvent.pointerUp(separator, {})
      expect(content.classList.contains('is-dragging')).toBe(false)
      expect(document.querySelector('.detail-panel-layer')?.classList.contains('is-dragging')).toBe(false)
      expect(localStorage.getItem(WIDTH_STORAGE_KEY)).toBe('436')
    })
  })
})
```

- [x] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/details/DetailPanelProvider.test.tsx`
Expected: FAIL — `defaultPanelWidth` / `MODE_STORAGE_KEY` / `WIDTH_STORAGE_KEY` are not exported; the
remaining cases fail on `Back to …`, `Over the page`, `aria-valuenow` 440, `--dock-width`, `modal`.

- [x] **Step 3: Write `src/components/details/DetailPanelProvider.tsx`** (whole file):

```tsx
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, Layers, Maximize2, Minimize2, PanelRight, X } from 'lucide-react'
import Segmented from '../shell/Segmented'
import type { SegmentedOption } from '../shell/Segmented'
import './details.css'

export type DetailPanelMode = 'dock' | 'overlay' | 'expanded'
export interface DetailPanelRequest {
  id: string
  title: string
  subtitle?: string
  content: ReactNode
  actions?: ReactNode
  contextKey?: string
  returnTo?: HTMLElement | null
  onClose?: () => void
  /** Default true. `false` (the assistant — 2026-09-13 spec §4): in overlay or reading mode the
   *  page stays live — no backdrop, no aria-modal, no inert, no Tab trap. Escape still closes it. */
  modal?: boolean
}

interface DetailPanelApi {
  activeId: string | null
  mode: DetailPanelMode
  open: (request: DetailPanelRequest) => void
  update: (id: string, request: Partial<Omit<DetailPanelRequest, 'id'>>) => void
  close: (id?: string) => void
  back: () => void
  setMode: (mode: DetailPanelMode) => void
}

const DetailPanelContext = createContext<DetailPanelApi | null>(null)

/** Null outside the shell: reusable charts still offer an inline inspector in tests/embeds. */
export function useDetailPanel(): DetailPanelApi | null {
  return useContext(DetailPanelContext)
}

const MIN_WIDTH = 360
const MAX_WIDTH = 720
// The shell sidebar is 210px. Keep at least 720px for its main content beside a dock.
const MIN_READING_SPACE = 930
export function panelGeometry(viewport: number, preferredWidth: number, desiredMode: DetailPanelMode) {
  const available = viewport - MIN_READING_SPACE
  const canDock = available >= MIN_WIDTH
  const mode: DetailPanelMode = desiredMode === 'dock' && !canDock ? 'overlay' : desiredMode
  const maxWidth = Math.min(MAX_WIDTH, mode === 'dock' ? available : Math.max(MIN_WIDTH, viewport - 48))
  return { mode, canDock, maxWidth, width: Math.max(MIN_WIDTH, Math.min(preferredWidth, maxWidth)) }
}

/** clamp(400px, 26vw, 560px) as a number (2026-09-13 spec §4): the dock's width is a margin the
 *  layout reserves, so it has to be arithmetic, not a CSS length. Used only while nothing is
 *  stored — a dragged width wins. */
export function defaultPanelWidth(viewport: number): number {
  return Math.round(Math.min(560, Math.max(400, viewport * 0.26)))
}

/** Browser preferences, not financial data — localStorage, never the server prefs (spec §4). */
export const MODE_STORAGE_KEY = 'finance.detailPanel.mode'
export const WIDTH_STORAGE_KEY = 'finance.detailPanel.width'
const MODES: readonly DetailPanelMode[] = ['dock', 'overlay', 'expanded']

function readStoredMode(): DetailPanelMode | null {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY)
    return MODES.includes(stored as DetailPanelMode) ? (stored as DetailPanelMode) : null
  } catch {
    return null
  }
}

/** Clamped by panelGeometry on every render (spec §16): a stored width wider than today's maxWidth is fine. */
function readStoredWidth(): number | null {
  try {
    const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY))
    return Number.isFinite(stored) && stored > 0 ? stored : null
  } catch {
    return null
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode or quota: the preference simply does not persist.
  }
}

const focusableSelector = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]'

// Mode tooltips (spec §14): what the panel DOES, not what the layout is called.
const MODE_TITLES: Record<DetailPanelMode, string> = { dock: 'Beside the page', overlay: 'Over the page', expanded: 'Reading mode' }
const EXIT_READING_TITLE = 'Exit reading mode'
const DOCK_DISABLED_TITLE = 'Widen the window to keep at least 720 pixels of page content beside details.'

/** An icon-only option whose accessible name is visually-hidden text: Segmented options carry a
 *  `title` but no per-option aria-label, and Segmented.tsx is not this lane's file to change. */
function iconOption(value: DetailPanelMode, name: string, icon: ReactNode, extra: Partial<SegmentedOption<DetailPanelMode>> = {}): SegmentedOption<DetailPanelMode> {
  return { value, title: name, ...extra, label: <>{icon}<span className="visually-hidden">{name}</span></> }
}

export default function DetailPanelProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<DetailPanelRequest[]>([])
  const stackRef = useRef<DetailPanelRequest[]>([])
  const [desiredMode, setDesiredMode] = useState<DetailPanelMode>(() => readStoredMode() ?? 'dock')
  // null = nothing stored and nothing dragged yet: the width follows the viewport.
  const [preferredWidth, setPreferredWidth] = useState<number | null>(readStoredWidth)
  const [viewport, setViewport] = useState(() => typeof window === 'undefined' ? 1600 : window.innerWidth)
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const dragRef = useRef<{ x: number; width: number } | null>(null)
  const readingOrigin = useRef<DetailPanelMode>('dock')
  const titleId = useId()
  const active = stack.at(-1)
  const previous = stack.at(-2)
  const { mode, width, maxWidth, canDock } = panelGeometry(viewport, preferredWidth ?? defaultPanelWidth(viewport), desiredMode)

  const commit = useCallback((next: DetailPanelRequest[]) => {
    stackRef.current = next
    setStack(next)
  }, [])

  const open = useCallback((request: DetailPanelRequest) => {
    const current = stackRef.current
    const existing = current.findIndex((entry) => entry.id === request.id)
    if (existing !== -1) {
      // Reopening an existing surface updates it and returns to it, never duplicates it.
      commit([...current.slice(0, existing), { ...current[existing], ...request, returnTo: current[existing].returnTo }])
      return
    }
    commit([...current, {
      ...request,
      returnTo: request.returnTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
    }])
  }, [commit])

  const update = useCallback((id: string, request: Partial<Omit<DetailPanelRequest, 'id'>>) => {
    const current = stackRef.current
    const index = current.findIndex((entry) => entry.id === id)
    if (index === -1) return
    const next = [...current]
    next[index] = { ...next[index], ...request }
    commit(next)
  }, [commit])

  const close = useCallback((id?: string) => {
    const current = stackRef.current
    if (id !== undefined) {
      const entry = current.find((item) => item.id === id)
      if (entry === undefined) return
      if (current.length === 1) returnFocus.current = entry.returnTo ?? null
      commit(current.filter((item) => item.id !== id))
      entry.onClose?.()
      return
    }
    if (current.length === 0) return
    returnFocus.current = current[0]?.returnTo ?? null
    commit([])
    current.forEach((entry) => entry.onClose?.())
  }, [commit])

  const back = useCallback(() => {
    const current = stackRef.current
    if (current.length < 2) return
    const last = current.at(-1)
    commit(current.slice(0, -1))
    last?.onClose?.()
  }, [commit])

  /** Persisted on change, not on mount: a reader who never touched the control keeps following the
   *  default (and the viewport-derived width) on every visit. */
  const setMode = useCallback((next: DetailPanelMode) => {
    setDesiredMode(next)
    writeStored(MODE_STORAGE_KEY, next)
  }, [])

  const resizeTo = (next: number) => {
    const clamped = Math.max(MIN_WIDTH, Math.min(maxWidth, next))
    setPreferredWidth(clamped)
    writeStored(WIDTH_STORAGE_KEY, String(Math.round(clamped)))
  }

  const chooseMode = (next: DetailPanelMode) => {
    if (next !== 'expanded') {
      setMode(next)
      return
    }
    // The reading-mode option is a toggle: pressed again, it returns to the mode it came from.
    if (mode === 'expanded') {
      setMode(readingOrigin.current)
      return
    }
    readingOrigin.current = desiredMode
    setMode('expanded')
  }

  useEffect(() => {
    const measure = () => setViewport(window.innerWidth)
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const activeId = active?.id ?? null
  useLayoutEffect(() => {
    // Overlay/expanded content is inert until this commit removes the surface.
    // Restoring focus in close() itself would fail in a real browser.
    if (activeId === null && returnFocus.current) {
      if (returnFocus.current.isConnected) returnFocus.current.focus({ preventScroll: true })
      returnFocus.current = null
    }
  }, [activeId])

  // Modal = the page is taken hostage: backdrop, aria-modal, inert, Tab trap. Never in dock mode,
  // and never for a request that asked not to be (the assistant).
  const modal = active !== undefined && mode !== 'dock' && active.modal !== false

  useEffect(() => {
    if (activeId === null) return
    panelRef.current?.focus({ preventScroll: true })
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        // One level at a time (design §5.1): evidence opened from a conversation returns to it.
        if (stackRef.current.length > 1) back()
        else close()
        return
      }
      if (event.key !== 'Tab' || !modal) return
      const panel = panelRef.current
      const nodes = Array.from(panel?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
        .filter((el) => !el.closest('[hidden]'))
      const first = nodes[0]
      const last = nodes.at(-1)
      if (!first || !last) {
        event.preventDefault()
        panel?.focus()
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !panel?.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', keyboard)
    return () => document.removeEventListener('keydown', keyboard)
  }, [activeId, back, close, modal])

  // The assistant launcher sits BESIDE a dock, not under it (spec §2.2): assistant.css reads this.
  useEffect(() => {
    document.documentElement.style.setProperty('--dock-width', activeId !== null && mode === 'dock' ? `${Math.round(width)}px` : '0px')
  }, [activeId, mode, width])
  useEffect(() => () => { document.documentElement.style.removeProperty('--dock-width') }, [])

  const api: DetailPanelApi = { activeId, mode, open, update, close, back, setMode }
  const modeOptions: SegmentedOption<DetailPanelMode>[] = [
    iconOption('dock', MODE_TITLES.dock, <PanelRight size={14} aria-hidden="true" />, { disabled: !canDock, title: canDock ? MODE_TITLES.dock : DOCK_DISABLED_TITLE }),
    iconOption('overlay', MODE_TITLES.overlay, <Layers size={14} aria-hidden="true" />),
    mode === 'expanded'
      ? iconOption('expanded', EXIT_READING_TITLE, <Minimize2 size={14} aria-hidden="true" />)
      : iconOption('expanded', MODE_TITLES.expanded, <Maximize2 size={14} aria-hidden="true" />),
  ]
  const draggingClass = dragging ? ' is-dragging' : ''

  return (
    <DetailPanelContext.Provider value={api}>
      <div className={`detail-layout-content${draggingClass}`} style={{ marginInlineEnd: active && mode === 'dock' ? width : 0 }} inert={modal || undefined}>
        {children}
      </div>
      {active && createPortal(
        <div className={`detail-panel-layer detail-panel-layer-${mode}${draggingClass}`}>
          {modal && <div className="detail-panel-backdrop" aria-hidden="true" onClick={() => close()} />}
          <aside
            ref={panelRef}
            className={`detail-panel detail-panel-${mode}`}
            style={{ '--dp-dock-w': `${width}px` } as CSSProperties}
            role="dialog"
            aria-modal={modal || undefined}
            aria-labelledby={titleId}
            tabIndex={-1}
          >
            <header className="detail-panel-header">
              <div className="detail-panel-heading">
                <h2 id={titleId}>{active.title}</h2>
                {active.subtitle && <p title={active.subtitle}>{active.subtitle}</p>}
              </div>
            </header>
            <div className="detail-panel-body">{active.content}</div>
            {/* DOM-after the body, CSS-placed in the header row (spec §4): Tab from the panel lands
                on the content first; Back, the layout control, the request's actions, Close and the
                resizer come after it. */}
            {previous !== undefined && (
              <div className="detail-panel-back">
                <button type="button" className="detail-panel-icon-button" aria-label={`Back to ${previous.title}`} title={`Back to ${previous.title}`} onClick={back}>
                  <ChevronLeft size={14} aria-hidden="true" />
                </button>
              </div>
            )}
            <div className="detail-panel-controls">
              <Segmented variant="toggle" size="sm" ariaLabel="Detail panel layout" value={mode} onChange={chooseMode} options={modeOptions} />
              {active.actions}
              <button type="button" className="detail-panel-icon-button" aria-label="Close details" title="Close details" onClick={() => close()}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            {mode !== 'expanded' && (
              <div
                className="detail-panel-resizer"
                role="separator"
                aria-label="Resize detail panel"
                aria-orientation="vertical"
                aria-valuemin={MIN_WIDTH}
                aria-valuemax={Math.round(maxWidth)}
                aria-valuenow={Math.round(width)}
                tabIndex={0}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  dragRef.current = { x: event.clientX, width }
                  setDragging(true)
                  event.currentTarget.setPointerCapture?.(event.pointerId)
                  event.preventDefault()
                }}
                onPointerMove={(event) => {
                  if (!dragRef.current) return
                  resizeTo(dragRef.current.width + dragRef.current.x - event.clientX)
                }}
                onPointerUp={(event) => {
                  dragRef.current = null
                  setDragging(false)
                  event.currentTarget.releasePointerCapture?.(event.pointerId)
                }}
                onPointerCancel={() => { dragRef.current = null; setDragging(false) }}
                onKeyDown={(event) => {
                  const next = event.key === 'ArrowLeft' ? width + 20 : event.key === 'ArrowRight' ? width - 20 : event.key === 'Home' ? MIN_WIDTH : event.key === 'End' ? maxWidth : null
                  if (next === null) return
                  event.preventDefault()
                  resizeTo(next)
                }}
              />
            )}
          </aside>
        </div>, document.body,
      )}
    </DetailPanelContext.Provider>
  )
}
```

- [x] **Step 4: Write `src/components/details/details.css`** (whole file; Task 9 appends the motion block):

```css
/* The coordinated detail panel (2026-09-12 design §5; chrome and box model 2026-09-13 spec §2.2, §4).
   Motion lives in the no-preference block at the foot of this file. */
.detail-layout-content { min-width: 0; }
.detail-panel-layer { position: fixed; inset: 0; z-index: 16; pointer-events: none; }
/* --scrim is F2's light-theme token (spec §6); the fallback is today's dark value. */
.detail-panel-backdrop { position: absolute; inset: 0; background: var(--scrim, #0007); pointer-events: auto; }

/* ONE box model for all three modes (spec §2.2): inset / width / right / border-radius are the same
   properties in every mode, so a mode switch is a transition, not a re-layout. Dock and overlay read
   the dragged width from --dp-dock-w (set inline by the provider); reading mode overrides --dp-w. */
.detail-panel {
  --dp-w: var(--dp-dock-w, 440px);
  position: absolute; inset: var(--dp-top, 0) 0 var(--dp-bottom, 0) auto; width: var(--dp-w);
  max-width: calc(100vw - 24px); min-width: 0; color: var(--text);
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; grid-template-rows: auto minmax(0, 1fr);
  background: var(--surface); border-left: 1px solid var(--border);
  box-shadow: -8px 0 32px #0002; pointer-events: auto;
}
.detail-panel:focus { outline: none; }
.detail-panel-expanded {
  --dp-top: 24px; --dp-bottom: 24px; --dp-w: min(1100px, calc(100vw - 48px));
  right: max(24px, calc((100vw - var(--dp-w)) / 2));
  border: 1px solid var(--border); border-radius: 12px;
}

/* The header row is three grid cells — Back, heading, controls — because Back and the controls come
   AFTER the body in the DOM (focus order heading → content → controls → resizer, spec §4) and are
   placed up here by the grid. Each cell draws the same hairline, so the row reads as one. */
.detail-panel-back { grid-area: 1 / 1 / 2 / 2; display: flex; align-items: center; padding: .6rem 0 .6rem .8rem; border-bottom: 1px solid var(--border); }
.detail-panel-header { grid-area: 1 / 2 / 2 / 3; display: flex; align-items: center; min-width: 0; padding: .6rem .8rem; border-bottom: 1px solid var(--border); }
.detail-panel-controls { grid-area: 1 / 3 / 2 / 4; display: flex; align-items: center; gap: .4rem; padding: .6rem .8rem .6rem 0; border-bottom: 1px solid var(--border); }
.detail-panel-body { grid-area: 2 / 1 / 3 / 4; overflow: auto; overscroll-behavior: contain; padding: var(--density-card-pad, 1.1rem); min-height: 0; line-height: 1.55; }

/* Title and subtitle share a line when they fit; the subtitle (a chart title) ellipsises (spec §4). */
.detail-panel-heading { display: flex; gap: .5rem; flex-wrap: wrap; align-items: baseline; min-width: 0; flex: 1; }
.detail-panel-heading h2 { margin: 0; font-size: .95rem; line-height: 1.4; }
.detail-panel-heading p { flex: 1 1 auto; min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .78rem; color: var(--muted); }

/* Back / Close: the assistant's icon-button scale, not a .button pill (spec §4, audit B7). */
.detail-panel-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; background: none; color: var(--muted); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
.detail-panel-icon-button:hover { color: var(--text); border-color: var(--muted); }
.detail-panel-icon-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.detail-panel-controls .segmented button { padding-inline: .45rem; }

/* Resizer: DOM-last, CSS-first — a 10px strip on the panel's left edge with a visible grip (audit B6). */
.detail-panel-resizer { position: absolute; inset-block: 0; left: -5px; width: 10px; cursor: ew-resize; touch-action: none; z-index: 1; }
.detail-panel-resizer::after { content: ''; position: absolute; top: 50%; left: 3px; width: 3px; height: 32px; translate: 0 -50%; border-radius: 2px; background: var(--border); }
.detail-panel-resizer:hover, .detail-panel-resizer:focus-visible { background: color-mix(in srgb, var(--accent) 40%, transparent); outline: none; }
.detail-panel-resizer:hover::after, .detail-panel-resizer:focus-visible::after { background: var(--accent); }

/* Reading mode: a measure cap for prose and receipts; the assistant's transcript keeps the width. */
.detail-panel-expanded .detail-panel-body > :not(.assistant-dock-mount) { max-width: 72ch; margin-inline: auto; }

.metric-info-button { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; min-height: 24px; margin: -.25rem 0 -.25rem .3rem; padding: 0; background: none; color: var(--muted); border: 0; border-radius: 4px; cursor: pointer; vertical-align: middle; }
.metric-info-button:hover { color: var(--text); }
.metric-info-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
/* The figure whose receipt is open right now (spec §4, audit B4). */
.metric-info-button[aria-expanded="true"] { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
.metric-inspector h3, .selection-detail h3 { margin: 1.2rem 0 .5rem; font-size: .85rem; }
.metric-inspector p, .selection-detail p { margin: .55rem 0; font-size: .85rem; }
.metric-inspector-value { font-size: 1.7rem; font-weight: 650; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.metric-inspector-definition { color: var(--muted); }
.metric-receipt-list { margin: .8rem 0; }
/* Grid, not space-between: in reading mode the value sits a column gap from its label instead of
   960px away at the far edge (audit B3). */
.metric-receipt-list > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 1.5rem; border-bottom: 1px solid var(--border); padding: .45rem 0; font-size: .8rem; }
.metric-receipt-list dt { color: var(--muted); }
.metric-receipt-list dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
.metric-months { display: flex; flex-wrap: wrap; gap: .35rem; list-style: none; padding: 0; font-size: .78rem; }
.metric-months li { padding: .15rem .4rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; }
.metric-warnings { padding-left: 1.1rem; font-size: .82rem; }
.metric-source-link { display: inline-block; color: var(--accent); font-size: .85rem; margin-top: .6rem; }
.selection-detail-actions { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-top: 1rem; }
.selection-detail-actions .metric-source-link { margin: 0; }
```

- [x] **Step 5: Update the three tests that pinned the old Back name**

- `src/components/ChartCard.test.tsx` line 196: `screen.getByRole('button', { name: 'Back' })` →
  `screen.getByRole('button', { name: 'Back to August' })` (the first chart's panel is titled by its
  selection label after Task 4).
- `src/components/assistant/AssistantExperience.test.tsx` line 82: `{ name: 'Back' }` → `{ name: 'Back to Assistant' }`.
- `src/App.test.tsx` line 76: `screen.queryByRole('button', { name: 'Back' })` → `screen.queryByRole('button', { name: /^Back to / })`;
  line 86: `{ name: 'Back' }` → `{ name: 'Back to Financial question' }`. (`App.test.tsx` belongs to no
  lane; this is the only change to it — say so in the hand-off.)

- [x] **Step 6: Run the tests**

Run: `npx vitest run src/components/details src/components/ChartCard.test.tsx src/components/assistant/AssistantExperience.test.tsx src/App.test.tsx`
Expected: all PASS (DetailPanelProvider 10, MetricInspector 6, explainSelection 4, ChartCard, AssistantExperience, App).

Run: `npx tsc -b`
Expected: no output, exit 0.

Run: `npx eslint src/components/details`
Expected: 0 errors; the one pre-existing `react-refresh/only-export-components` warning on `MetricInspector.tsx`
plus — because `DetailPanelProvider.tsx` now exports constants beside the component — possibly the same
warning there. `allowConstantExport: true` is set in `eslint.config.js`, so string constants do NOT warn;
`defaultPanelWidth`/`panelGeometry` are functions and `panelGeometry` was already exported, so the count is
unchanged. If eslint prints anything new, stop and reconsider rather than disabling a rule.

- [x] **Step 7: Commit**

```bash
git add src/components/details/DetailPanelProvider.tsx src/components/details/details.css src/components/details/DetailPanelProvider.test.tsx src/components/ChartCard.test.tsx src/components/assistant/AssistantExperience.test.tsx src/App.test.tsx
git commit -m "feat(panel): one chrome row (icon Back/Close, icon mode control, actions), content-first focus order, Escape pops one level, non-modal requests, persisted mode and width, viewport default width, --dock-width"
```

---

## Task 9 — Detail panel motion: exit ghost, unified box model in motion, keyframes (spec §2.2, audit A1/A2, Appendix A)

**Files:**
- Modify: `src/components/details/DetailPanelProvider.tsx` (state, `commit`, `close`, two effects, the ghost portal)
- Modify: `src/components/details/details.css` (append the motion block)
- Modify: `src/components/details/DetailPanelProvider.test.tsx` (append four cases)

Design choice (spec §2.2 says "the provider keeps the last request mounted with `leaving: true`… the
stack empties on `animationend` or a fallback timer"): the stack empties **immediately** and the last
request is re-rendered as a separate, inert, `aria-hidden` **ghost** `<aside class="detail-panel is-leaving">`
for the exit beat. Same observable result, simpler invariants: `activeId` goes null at once (the (i)'s
`aria-expanded` flips, the Escape listener detaches, `inert` lifts), focus returns through the existing
`activeId` layout effect, and an `open()` during the beat simply replaces the ghost. The ghost is gated on
`typeof panelRef.current.animate === 'function'` — the one cheap signal that separates a CSS-animating
engine from jsdom — so every existing synchronous test keeps passing untouched.

- [x] **Step 1: Write the failing tests** — in `src/components/details/DetailPanelProvider.test.tsx` extend
the imports:

```tsx
import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { MOTION_MS } from '../../theme/motion'
```

add this helper next to `withPointerEvents`:

```tsx
/** jsdom has no Web Animations; the provider reads `typeof el.animate` as "this engine runs CSS
 *  animations" and only then keeps an exit ghost. Stubbing it opts a test in. */
function withAnimations(run: () => void) {
  Object.defineProperty(HTMLElement.prototype, 'animate', { value: () => ({}), configurable: true, writable: true })
  try {
    run()
  } finally {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate
  }
}
```

and append inside `describe('coordinated detail panels', …)`:

```tsx
  it('keeps the closing panel painted as an inert ghost until its exit animation ends', () => {
    withAnimations(() => {
      render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
      const trigger = screen.getByRole('button', { name: 'Inspect month' })
      trigger.focus()
      fireEvent.click(trigger)
      fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
      // For assistive tech, focus and the launcher the surface is already gone…
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(trigger)
      expect(document.documentElement.style.getPropertyValue('--dock-width')).toBe('0px')
      // …while the ghost fades out with the last content still in it (spec §2.2).
      const ghost = document.querySelector('.detail-panel.is-leaving') as HTMLElement
      expect(ghost).toBeTruthy()
      expect(ghost.className).toContain('detail-panel-dock')
      expect(ghost.hasAttribute('inert')).toBe(true)
      expect(ghost.getAttribute('role')).toBeNull()
      expect(ghost.closest('.detail-panel-layer')?.getAttribute('aria-hidden')).toBe('true')
      expect(ghost.textContent).toContain('Selected month retained')
      fireEvent.animationEnd(ghost)
      expect(document.querySelector('.detail-panel')).toBeNull()
    })
  })

  it('unmounts the ghost on the fallback timer when no animationend ever arrives (reduced motion)', () => {
    vi.useFakeTimers()
    try {
      withAnimations(() => {
        render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
        fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
        fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
        expect(document.querySelector('.detail-panel.is-leaving')).toBeTruthy()
        act(() => { vi.advanceTimersByTime(MOTION_MS.fast + 49) })
        expect(document.querySelector('.detail-panel.is-leaving')).toBeTruthy()
        act(() => { vi.advanceTimersByTime(1) })
        expect(document.querySelector('.detail-panel')).toBeNull()
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('a surface opened during the exit beat replaces the ghost instead of stacking under it', () => {
    withAnimations(() => {
      render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
      fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
      fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
      expect(document.querySelector('.detail-panel.is-leaving')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
      expect(document.querySelectorAll('.detail-panel')).toHaveLength(1)
      expect(document.querySelector('.detail-panel.is-leaving')).toBeNull()
      expect(screen.getByRole('dialog', { name: 'August spending' })).toBeTruthy()
    })
  })

  it('the ghost keeps the box model it was closed from', () => {
    withAnimations(() => {
      render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
      fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
      fireEvent.click(screen.getByRole('button', { name: 'Reading mode' }))
      fireEvent.keyDown(document, { key: 'Escape' })
      const ghost = document.querySelector('.detail-panel.is-leaving') as HTMLElement
      expect(ghost.className).toContain('detail-panel-expanded')
      // No backdrop lingers behind a ghost: the page is live the moment the stack empties.
      expect(document.querySelector('.detail-panel-backdrop')).toBeNull()
      expect(document.querySelector('.detail-layout-content')!.hasAttribute('inert')).toBe(false)
      fireEvent.animationEnd(ghost)
      expect(document.querySelector('.detail-panel')).toBeNull()
    })
  })
```

- [x] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/details/DetailPanelProvider.test.tsx`
Expected: the four new cases FAIL — `document.querySelector('.detail-panel.is-leaving')` is `null`
(today the panel unmounts at once). The ten earlier cases still PASS.

- [x] **Step 3: Implement in `DetailPanelProvider.tsx`**

Add the import after the lucide import:

```tsx
import { MOTION_MS } from '../../theme/motion'
```

After `const [dragging, setDragging] = useState(false)` add:

```tsx
  // The exit ghost (spec §2.2): the last request stays painted, inert, for one --t-fast beat after
  // the stack empties. Null in engines without Web Animations (jsdom), where the unmount is at once.
  const [leaving, setLeaving] = useState<{ request: DetailPanelRequest; mode: DetailPanelMode } | null>(null)
  const modeRef = useRef<DetailPanelMode>('dock')
```

`commit` becomes:

```tsx
  const commit = useCallback((next: DetailPanelRequest[]) => {
    stackRef.current = next
    setStack(next)
    // A surface that comes back during the exit beat replaces the ghost; it never stacks under one.
    if (next.length > 0) setLeaving(null)
  }, [])
```

Insert `beginExit` before `close`, and `close` becomes:

```tsx
  /** Arm the exit ghost for `last`. Gated on Web Animations because that is what separates a CSS
   *  animation engine from jsdom: without it the ghost would never hear animationend and would sit
   *  for the whole fallback timer in every unit test. Reads the mode through a ref so `close` keeps
   *  its identity — MetricInfoButton closes its receipt on unmount through `close`, and a new
   *  identity per mode change would close panels by accident. */
  const beginExit = useCallback((last: DetailPanelRequest) => {
    if (typeof panelRef.current?.animate !== 'function') return
    setLeaving({ request: last, mode: modeRef.current })
  }, [])

  const close = useCallback((id?: string) => {
    const current = stackRef.current
    if (id !== undefined) {
      const entry = current.find((item) => item.id === id)
      if (entry === undefined) return
      const next = current.filter((item) => item.id !== id)
      if (next.length === 0) {
        returnFocus.current = entry.returnTo ?? null
        beginExit(entry)
      }
      commit(next)
      entry.onClose?.()
      return
    }
    if (current.length === 0) return
    returnFocus.current = current[0]?.returnTo ?? null
    beginExit(current[current.length - 1])
    commit([])
    current.forEach((entry) => entry.onClose?.())
  }, [beginExit, commit])
```

After the two `--dock-width` effects add:

```tsx
  // Unkeyed on purpose (the EChart latest-ref idiom): beginExit reads the mode the panel was in.
  useEffect(() => { modeRef.current = mode })
  // `reduce` zeroes --t-fast, and a 0ms animation may never report animationend: the timer is the
  // guarantee that no reader is ever stranded behind a ghost (spec §16).
  useEffect(() => {
    if (leaving === null) return
    const timer = window.setTimeout(() => setLeaving(null), MOTION_MS.fast + 50)
    return () => window.clearTimeout(timer)
  }, [leaving])
```

In the JSX, directly after the `{active && createPortal(… , document.body)}` block and before
`</DetailPanelContext.Provider>`, add the ghost:

```tsx
      {active === undefined && leaving !== null && createPortal(
        <div className={`detail-panel-layer detail-panel-layer-${leaving.mode}`} aria-hidden="true">
          <aside
            className={`detail-panel detail-panel-${leaving.mode} is-leaving`}
            style={{ '--dp-dock-w': `${width}px` } as CSSProperties}
            inert
            onAnimationEnd={(event) => { if (event.target === event.currentTarget) setLeaving(null) }}
          >
            <header className="detail-panel-header">
              <div className="detail-panel-heading">
                <h2>{leaving.request.title}</h2>
                {leaving.request.subtitle && <p>{leaving.request.subtitle}</p>}
              </div>
            </header>
            <div className="detail-panel-body">{leaving.request.content}</div>
          </aside>
        </div>, document.body,
      )}
```

Why re-rendering `leaving.request.content` is safe: ChartCard's `panelContent` is a `<div ref>` that
adopts its detached `detailHost` on mount and detaches it on unmount; React detaches the dying
panel's ref before attaching the ghost's (deletions run before placements in one commit), and when a
surface reopens mid-beat the ghost's `ref(null)` likewise runs before the live panel's `ref(node)`.
The assistant's `AssistantDockMount` moves its portal host the same way; its drawer is already
unmounted (`open` is false), so the ghost shows the frame and title fading, which is the intent.

- [x] **Step 4: Append the motion block to `src/components/details/details.css`**

```css

/* ── Motion (2026-09-13 spec §2.2) ─────────────────────────────────────────
   Tokens only (motion.test.ts) — the reduce block zeroes them, and this block is gated besides.
   Entrance: the panel rides in from 24px right over --t-page while the page's margin makes room on
   the same curve (audit A1's one-frame snap). Mode switch: inset / width / right / border-radius
   transition, so dock → reading mode reads as "the same thing, larger" (audit A2). Exit: the
   provider keeps a ghost (.is-leaving) for one --t-fast beat. The entrance sits on .detail-panel,
   not on a per-mode class: a mode switch swaps the class, and a class-scoped animation would
   restart and fight the transition. Keyframe names are this lane's own (spec §16). */
@media (prefers-reduced-motion: no-preference) {
  .detail-layout-content { transition: margin-inline-end var(--t-page) var(--ease-out); }
  .detail-panel {
    animation: detail-panel-in var(--t-page) var(--ease-out) both;
    transition:
      inset var(--t-page) var(--ease-out),
      width var(--t-page) var(--ease-out),
      right var(--t-page) var(--ease-out),
      border-radius var(--t-page) var(--ease-out);
  }
  .detail-panel.is-leaving { animation: detail-panel-out var(--t-fast) ease both; }
  .detail-panel-backdrop { animation: dp-backdrop-in var(--t-fast) ease both; }
  /* Pointer capture: the width follows the hand, never 240ms behind it (spec §2.2). */
  .detail-layout-content.is-dragging, .is-dragging .detail-panel { transition: none; }
  @keyframes detail-panel-in { from { transform: translateX(24px); opacity: 0; } }
  @keyframes detail-panel-out { to { transform: translateX(24px); opacity: 0; } }
  @keyframes dp-backdrop-in { from { opacity: 0; } }
}
/* Nothing in a ghost is reachable — by pointer, by Tab (inert) or by assistive tech (aria-hidden). */
.detail-panel.is-leaving { pointer-events: none; }
```

- [x] **Step 5: Run the tests, the literal-duration scan and the type check**

Run: `npx vitest run src/components/details src/theme/motion.test.ts src/components/ChartCard.test.tsx src/components/assistant/AssistantExperience.test.tsx src/App.test.tsx`
Expected: all PASS (DetailPanelProvider now 14 cases; nothing else changed behaviour — jsdom has no
`animate`, so every synchronous close still unmounts at once).

Run: `npx tsc -b`
Expected: no output, exit 0.

- [x] **Step 6: Commit**

```bash
git add src/components/details/DetailPanelProvider.tsx src/components/details/details.css src/components/details/DetailPanelProvider.test.tsx
git commit -m "feat(panel): the panel slides in, morphs between modes and fades out through an inert exit ghost"
```

**Fallback documented for lane V (spec §2.2):** if the Spending page measures more than two frames over
32ms during a dock open, the provider should set `data-panel-motion` on `.detail-layout-content` for the
`--t-page` duration (a `MOTION_MS.page` timer after each `marginInlineEnd` change) and `EChart`'s
ResizeObserver callback should return early while `el.closest('[data-panel-motion]')` is non-null,
resizing once when the attribute clears (a `MutationObserver` on the layout root, or a `transitionend`
listener on it). Do not build it in this lane; it is the measured-jank contingency only.

---

## Task 10 — The assistant inside the panel (spec §4 assistant bullet, §2.2 launcher; audit B2, E5, G1 items 1–2)

**Files:**
- Modify: `src/components/assistant/AssistantDrawer.tsx` (imports, two module-scope additions, `newChat`, the panel effects, both Escape handlers, the drawer JSX, the launcher)
- Modify: `src/components/assistant/assistant.css`
- Test: `src/components/assistant/AssistantDrawer.test.tsx`, `src/components/assistant/AssistantExperience.test.tsx`

What changes: the assistant opens `{ id: 'assistant', title: 'Assistant', actions: <model select + New chat>,
modal: false }`; its own `.assistant-header` renders only in the standalone (no provider) path that the
tests and embeds use; `.assistant-tabs` becomes `Segmented variant="tabs" size="sm"` in the Context row;
"Review latest completed month" becomes the first `.assistant-sample-chip` (same `intent: 'month_review'`,
still available without a key); the Context row reads "Context: {label}" with an (i) icon button that
toggles the preview list; `.assistant-model-select { max-width: 220px }` in every mode; the
`assistant-drawer-in` keyframe no longer applies to `.assistant-drawer-coordinated`; the launcher sits
beside a dock (`--dock-width`) and hides while the assistant is the active panel; inside the panel the
drawer's own Escape handlers defer to the provider (one level at a time).

- [x] **Step 1: Write the failing tests**

`src/components/assistant/AssistantDrawer.test.tsx` — line 150 becomes:

```tsx
    expect(chip.textContent).toBe('Context: Spending · Mar 2026')
```

and append inside `describe('AssistantDrawer', …)`:

```tsx
  it('offers the computed month review as the first starter chip, on the samples\' own grammar', async () => {
    streamChat.mockImplementation(
      (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
        h.onDone({ model_used: 'kimi-k3' })
        return { abort: vi.fn(), finished: Promise.resolve() }
      },
    )
    mount()
    await openDrawer()
    const chips = Array.from(document.querySelectorAll('.assistant-sample-chip')).map((chip) => chip.textContent)
    expect(chips[0]).toBe('Review latest completed month')
    expect(chips).toContain('Month in review')
    // The old button-above-the-chips row is gone (audit B2: two starter grammars in one drawer).
    expect(document.querySelector('.assistant-review-action')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Review latest completed month' }))
    await waitFor(() => expect(streamChat).toHaveBeenCalled())
    expect((streamChat.mock.calls[0][0] as { intent?: string }).intent).toBe('month_review')
  })

  it('renders the views as a Segmented tablist in the Context row, with an (i) that toggles the preview', async () => {
    mount()
    await openDrawer()
    const row = document.querySelector('.assistant-context') as HTMLElement
    expect(within(row).getByRole('tablist', { name: 'Assistant views' }).className).toContain('segmented-tabs')
    expect(within(row).getByRole('tab', { name: 'Conversation' }).getAttribute('aria-selected')).toBe('true')
    expect(within(row).getByRole('tab', { name: 'Conversation' }).getAttribute('aria-controls')).toBe('assistant-conversation')
    expect(screen.getByRole('log', { name: 'Conversation' }).id).toBe('assistant-conversation')
    expect(document.querySelector('.assistant-tabs')).toBeNull()
    const info = within(row).getByRole('button', { name: 'What the assistant can see' })
    expect(info.getAttribute('aria-expanded')).toBe('false')
    expect(info.textContent).toBe('') // an icon; the sentence is its name, not its label text
    fireEvent.click(info)
    await waitFor(() => expect(screen.getByText(/household/)).toBeTruthy())
    expect(info.getAttribute('aria-expanded')).toBe('true')
    // Standalone (no provider) keeps its own header row with the picker and New chat.
    const header = document.querySelector('.assistant-header') as HTMLElement
    expect(within(header).getByRole('combobox', { name: 'Model' })).toBeTruthy()
    expect(within(header).getByRole('button', { name: 'New chat' })).toBeTruthy()
  })
```

`src/components/assistant/AssistantExperience.test.tsx` — extend the RTL import with `within`, make
`afterEach` restore the viewport, and add one case:

```tsx
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
```

```tsx
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); vi.clearAllMocks(); Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true }) })
```

```tsx
  it('inside the shared panel: non-modal, the model picker and New chat in the panel chrome, no drawer header, launcher stepped aside', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true }) // too narrow to dock → overlay
    mount(true)
    fireEvent.click(screen.getByRole('button', { name: 'Open assistant' }))
    const dialog = await screen.findByRole('dialog', { name: 'Assistant' })
    await screen.findByRole('textbox', { name: 'Ask the assistant' })
    // G1: a chat the reader can use while looking at the numbers — the page stays live.
    expect(dialog.className).toContain('detail-panel-overlay')
    expect(dialog.getAttribute('aria-modal')).toBeNull()
    expect(document.querySelector('.detail-panel-backdrop')).toBeNull()
    expect(document.querySelector('.detail-layout-content')!.hasAttribute('inert')).toBe(false)
    // B2: one chrome row — the drawer's own header is gone; its controls are the panel's actions.
    const controls = dialog.querySelector('.detail-panel-controls') as HTMLElement
    expect(within(controls).getByRole('combobox', { name: 'Model' })).toBeTruthy()
    expect(within(controls).getByRole('button', { name: 'New chat' })).toBeTruthy()
    expect(document.querySelector('.assistant-header')).toBeNull()
    expect(document.querySelector('.assistant-drawer-coordinated')).toBeTruthy()
    // The launcher steps aside while the conversation IS the active panel; the panel's Close is the exit.
    expect(screen.queryByRole('button', { name: 'Open assistant' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open assistant' }).getAttribute('aria-expanded')).toBe('false')
  })
```

- [x] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/assistant`
Expected: FAIL — `Seeing: Spending · Mar 2026`; first chip is `Month in review`; no `tablist` named
`Assistant views`; the provider case finds `aria-modal="true"` and `.assistant-header` present.

- [x] **Step 3: Implement `AssistantDrawer.tsx`**

Imports — line 5 and line 7 become, and add `Segmented` after the details imports:

```tsx
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
```
```tsx
import { Info, Sparkles, Square, X } from 'lucide-react'
```
```tsx
import Segmented from '../shell/Segmented'
import type { SegmentedOption } from '../shell/Segmented'
```

After `const PREVIEW_LIST_ID = 'assistant-context-sections'` add:

```tsx
/** The conversation log's id — the Conversation tab's aria-controls target. Saved findings owns its
 *  own scrolling root (AssistantEvidence) and mounts on demand, so its tab carries none. */
const CONVERSATION_ID = 'assistant-conversation'
const ASSISTANT_TABS: readonly SegmentedOption<'chat' | 'findings'>[] = [
  { value: 'chat', label: 'Conversation' },
  { value: 'findings', label: 'Saved findings' },
]
```

After `RetryCountdown` (before `export default function AssistantDrawer`) add:

```tsx
/** The header's controls. Inside the shared panel they render in the panel's own chrome row
 *  (`DetailPanelRequest.actions`, spec §4); standalone they sit in the drawer's header. Module scope
 *  so the element type is stable across the drawer's per-token re-renders. */
function AssistantHeaderActions({ model, models, streaming, onModel, onNewChat }: {
  model: string
  models: AssistantModelsOut | null
  streaming: boolean
  onModel: (key: string) => void
  onNewChat: () => void
}) {
  return (
    <>
      <select
        className="assistant-model-select"
        aria-label="Model"
        value={model}
        disabled={streaming}
        onChange={(event) => onModel(event.target.value)}
      >
        {(
          models?.models ?? [
            {
              key: model,
              label: modelLabel(model, null),
              available: true,
              supports_tools: true,
              default: true,
              catalog_id: null,
            },
          ]
        ).map((m) => (
          <option key={m.key} value={m.key} disabled={!m.available}>
            {m.label}
            {m.available ? '' : ' (unavailable)'}
          </option>
        ))}
      </select>
      <button type="button" className="assistant-icon-button" onClick={onNewChat}>
        New chat
      </button>
    </>
  )
}
```

Inside the component, after `const closePanel = panel?.close` add `const updatePanel = panel?.update`.

`newChat` (lines 555–562) becomes a stable callback (its deps are refs and setters only):

```tsx
  const newChat = useCallback(() => {
    sendSeq.current += 1
    handleRef.current?.abort()
    setStreaming(false)
    setTranscript([])
    setTab('chat')
  }, [])
```

`onComposerKeyDown`'s Escape branch becomes:

```tsx
    } else if (event.key === 'Escape' && !panel) {
      // Inside the shared panel the provider owns Escape — one level at a time (spec §4).
      event.preventDefault()
      close()
    }
```

Replace the two panel effects (lines 575–580, from `const configured =` through `useEffect(() => () => closePanel?.('assistant'), [closePanel])`) with:

```tsx
  const configured = settings?.key.configured === true

  // Latest-ref (the EChart idiom): the open effect hands the panel its first actions without listing
  // model/models/streaming as deps — re-running open() on those would re-raise the assistant and
  // POP any evidence panel stacked above it. The update effect keeps them current afterwards.
  const headerActionsRef = useRef<ReactNode>(null)
  useEffect(() => {
    headerActionsRef.current = <AssistantHeaderActions model={model} models={models} streaming={streaming} onModel={setModel} onNewChat={newChat} />
  })
  useEffect(() => {
    if (!open || !openPanel) return
    openPanel({
      id: 'assistant',
      title: 'Assistant',
      content: <AssistantDockMount host={portalHost} />,
      actions: headerActionsRef.current,
      // Non-modal (spec §4, audit G1): in overlay mode the page stays live — no backdrop, no inert.
      modal: false,
      onClose: () => { setOpen(false); setPreviewOpen(false) },
    })
  }, [open, openRequest, openPanel, portalHost])
  useEffect(() => {
    if (!open || !updatePanel) return
    updatePanel('assistant', { actions: <AssistantHeaderActions model={model} models={models} streaming={streaming} onModel={setModel} onNewChat={newChat} /> })
  }, [open, updatePanel, model, models, streaming, newChat])
  useEffect(() => () => closePanel?.('assistant'), [closePanel])
```

The drawer JSX — the root's `onKeyDown` becomes:

```tsx
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !panel) {
              event.preventDefault()
              close()
            }
          }}
```

Replace everything from `<div className="assistant-header">` through the closing `</div>` of
`<div className="assistant-context" hidden={tab !== 'chat'}>` (lines 618–695) with:

```tsx
          {/* Standalone only (tests, embeds): inside the shared panel the title, the model picker,
              New chat and Close all live in the panel's own chrome row (spec §4, audit B2). */}
          {!panel && (
            <div className="assistant-header">
              <span className="assistant-title">
                <span aria-hidden="true">✦</span> Assistant
              </span>
              <AssistantHeaderActions model={model} models={models} streaming={streaming} onModel={setModel} onNewChat={newChat} />
              <button
                type="button"
                className="assistant-icon-button"
                aria-label="Close assistant"
                onClick={close}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          )}
          {/* One row (audit E5): what the assistant is looking at, the (i) that lists it, the views.
              Always visible — the tabs live here, so the row cannot hide with the conversation. */}
          <div className="assistant-context">
            <span className="assistant-context-label" title={contextLabel}>
              Context: {contextLabel}
            </span>
            <button
              type="button"
              className="assistant-context-toggle"
              aria-label="What the assistant can see"
              title="What the assistant can see"
              aria-expanded={previewOpen}
              aria-controls={PREVIEW_LIST_ID}
              onClick={togglePreview}
            >
              <Info size={13} aria-hidden="true" />
            </button>
            <Segmented variant="tabs" size="sm" ariaLabel="Assistant views" value={tab} onChange={setTab} options={ASSISTANT_TABS} panelIds={{ chat: CONVERSATION_ID }} />
            {previewOpen && (
              <ul id={PREVIEW_LIST_ID} className="assistant-context-sections">
                {previewSections === null ? (
                  <li>Loading…</li>
                ) : previewSections.length === 0 ? (
                  <li>Couldn&apos;t load the preview.</li>
                ) : (
                  previewSections.map((section) => (
                    <li key={section.name}>
                      {section.name} — {section.rows} row{section.rows === 1 ? '' : 's'}
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
```

(The `{tab === 'findings' && <SavedFindings revision={findingsRevision} />}` line that used to sit
between the tabs and the context row moves to directly after this block — it is the first thing after
the Context row.)

The messages div opener gains the id:

```tsx
          <div
            className="assistant-messages"
            id={CONVERSATION_ID}
            hidden={tab !== 'chat'}
```

Replace the review-action block and the samples block (from `<div className="assistant-review-action">`
through the samples' closing `)}`) with:

```tsx
            {pendingSelection && streaming && <p className="assistant-meta" role="status">Your selected chart point is queued. Finish or stop this answer to continue.</p>}
            {transcript.length === 0 && (
              <div className="assistant-samples">
                {/* The computed review first, on the chips' own grammar (spec §4). It needs no provider
                    key — send() lets an intent through unconfigured — so it is not gated on `configured`. */}
                <button
                  type="button"
                  className="assistant-sample-chip"
                  disabled={streaming}
                  onClick={() => send('Review the latest completed month.', undefined, undefined, { context: buildContext(), intent: 'month_review' })}
                >
                  Review latest completed month
                </button>
                {configured && [...INSIGHT_PRESETS, ...samplesFor(location.pathname)].map((sample) => (
                  <button
                    key={sample.label}
                    type="button"
                    className="assistant-sample-chip"
                    onClick={() => send(sample.prompt, undefined, undefined, sample.intent ? { context: buildContext(), intent: sample.intent } : undefined)}
                  >
                    {sample.label}
                  </button>
                ))}
              </div>
            )}
```

The launcher (in the component's `return`) becomes:

```tsx
      <button ref={launcherRef} type="button" className="assistant-launcher" aria-label="Open assistant" aria-expanded={visible}
        // Hidden while the conversation IS the active panel (spec §2.2): the panel's Close is the exit.
        hidden={panel !== null && panel.activeId === 'assistant'}
        onClick={() => (visible ? close() : requestOpen())}><Sparkles size={18} aria-hidden="true" /></button>
```

- [x] **Step 4: Implement `assistant.css`**

`.assistant-launcher`'s `right` (line 10) becomes, with its comment:

```css
  /* Beside a dock, never under it (2026-09-13 spec §2.2): DetailPanelProvider publishes the dock's
     width on <html> (0px when nothing is docked). */
  right: calc(1.25rem + var(--dock-width, 0px));
```

Delete lines 49–52 and 54–55 (the coordinated select override, the three `.assistant-tabs` rules, the
two `.assistant-review-action` rules). Line 48 (`.assistant-drawer-coordinated { … }`) and line 53 stay.

`.assistant-model-select`'s `max-width: 150px;` becomes `max-width: 220px; /* every mode (spec §4): 998px in reading mode was the bug */`.

`.assistant-context` (lines 122–134) and `.assistant-context-toggle` (lines 144–153) become:

```css
/* A row, not prose: label · (i) · views. The label ellipsises (on Taxes it reads "Taxes · 2026 ·
   Married filing jointly"), the (i) keeps its box, the tablist sits at the right edge. */
.assistant-context {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  padding: 0.45rem 0.75rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.75rem;
  color: var(--muted);
}

.assistant-context-label {
  flex: 1;
  min-width: 0; /* without it a flex item never shrinks past its content, so no ellipsis */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-context .segmented {
  margin-left: auto;
}

/* The (i): InfoHint's scale and its open state (spec §4). */
.assistant-context-toggle {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  min-height: 24px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--muted);
  cursor: pointer;
}

.assistant-context-toggle:hover {
  color: var(--text);
}

.assistant-context-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.assistant-context-toggle[aria-expanded="true"] {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
```

In the `@media (prefers-reduced-motion: no-preference)` block, the drawer rule becomes and the launcher
transition is added:

```css
  /* Standalone only: inside the shared panel the drawer is position: static, so a 24px translate
     would slide its CONTENTS inside an already-visible panel — the panel's own entrance covers it. */
  .assistant-drawer:not(.assistant-drawer-coordinated) {
    animation: assistant-drawer-in var(--t-fast) ease-out;
  }

  .assistant-launcher {
    transition: right var(--t-page) var(--ease-out);
  }
```

- [x] **Step 5: Run the tests, the type check and lint**

Run: `npx vitest run src/components/assistant src/components/details src/theme/motion.test.ts`
Expected: all PASS.

Run: `npx tsc -b`
Expected: no output, exit 0.

Run: `npx eslint src/components/assistant`
Expected: 0 errors, 0 new warnings (`react-hooks/exhaustive-deps` is satisfied: the open effect reads
only refs and its listed deps; the update effect lists `newChat`, which is a stable `useCallback`).

- [x] **Step 6: Commit**

```bash
git add src/components/assistant/AssistantDrawer.tsx src/components/assistant/assistant.css src/components/assistant/AssistantDrawer.test.tsx src/components/assistant/AssistantExperience.test.tsx
git commit -m "feat(assistant): the conversation lives in the shared panel's chrome — non-modal, picker and New chat as panel actions, Segmented views, review chip first, Context row, launcher beside the dock"
```

---

## Task 11 — Gates (spec §15 item 9)

No code changes. Every command runs from the worktree root; stop at the first failure and fix it in
the task that owns the file before continuing.

- [x] **Step 1:** `npx tsc -b` → no output, exit 0.
- [x] **Step 2:** `npx eslint src/components/details src/components/assistant src/components/ChartCard.tsx src/components/ChartSurface.tsx src/components/EChart.tsx`
  → `✖ 3 problems (0 errors, 3 warnings)` or fewer — the warnings are the pre-existing
  `react-refresh/only-export-components` ones. No new rule may be disabled.
- [x] **Step 3:** `npx vitest run src/components/details src/components/assistant src/components/ChartCard.test.tsx src/components/EChart.test.tsx src/utils/metricReceipt.test.ts`
  → all files green.
- [x] **Step 4:** `npx vitest run` → `Test Files  N passed (N)`, `Tests  ≈2783 passed` (2753 on main + about
  30 new), **0 failed**, no unhandled errors. `src/theme/motion.test.ts` (literal durations) and
  `src/theme/tokens.test.ts` must be among the green files.
- [x] **Step 5:** `npm run build` → `tsc -b` silent, then vite prints `✓ built in …s`; the echarts chunk
  advisory stays under the configured 760 kB limit (nothing in this lane adds echarts modules).
- [x] **Step 6:** `npx eslint .` → `0 errors`, warnings ≤ 24 (the repo baseline).
- [x] **Step 7:** Record the numbers (test count, warning count, build time) in the hand-off note; if any
  gate needed a fix, that fix has its own commit in the task that owns the file.

---

## Task 12 — Disclosure adoption (spec §2.6, §11) — **requires F2's `Disclosure`; skip and report if absent**

**Pre-check (do this first, do not guess):**

```bash
ls src/components/Disclosure.tsx src/components/disclosure.css
```

If either file is missing, **skip this task**, leave the `<details>` elements as they are, and write in
the hand-off: "Task 12 skipped — `Disclosure` not present in this worktree; ChartTable, SelectionDetail
calculations, ComputedSummary, SavedFindings and the reasoning block still render bare `<details>`."
The lead re-runs this task on main after F2 merges (or asks F2 to).

If present, read `src/components/Disclosure.tsx` in full and confirm its contract before editing:
(a) `<Disclosure summary defaultOpen? open? onToggle? onOpen? className? id? name?>` renders
`<details class="disclosure …className"><summary>{chevron}{summary}</summary><div class="disclosure-body">{children}</div></details>`;
(b) `className` lands on the `<details>` element; (c) `open` is forwarded to the `<details open>`
attribute and `undefined` leaves the attribute to the reader (React only writes the attribute when the
prop changes). If (c) does not hold, adopt Disclosure everywhere EXCEPT the reasoning block, and report.

**Files:**
- Modify: `src/components/ChartTable.tsx` (lines 17–18 and 48)
- Modify: `src/components/details/SelectionDetail.tsx` (the evidence line)
- Modify: `src/components/assistant/AssistantEvidence.tsx` (`ComputedSummary` lines 47–49, `SavedFindings` lines 85–95)
- Modify: `src/components/assistant/AssistantDrawer.tsx` (the reasoning `<details>` block)
- Tests: existing files pin the behaviour — `ChartTable.test.tsx`, `MetricInspector.test.tsx`,
  `ChartCard.test.tsx`, `AssistantDrawer.test.tsx` (`reasoning streams open, then collapses…`),
  `AssistantExperience.test.tsx`. No behaviour changes, so no new tests; every existing one must stay green.

- [ ] **Step 1: `ChartTable.tsx`** — import and swap the element (the table body is unchanged):

```tsx
import Disclosure from './Disclosure'
```

```tsx
  return (
    <Disclosure className="chart-table" defaultOpen summary="Data table">
      <div className="chart-table-scroll">
        <table className="data-table">
          {/* …unchanged caption / thead / tbody… */}
        </table>
      </div>
    </Disclosure>
  )
```

(Keep the existing `<table>` markup verbatim between the two wrappers; only `<details className="chart-table" open>`
/ `<summary>Data table</summary>` / `</details>` change.)

- [ ] **Step 2: `SelectionDetail.tsx`** — import and swap the calculation disclosure:

```tsx
import Disclosure from '../Disclosure'
```

```tsx
    {selection.evidence?.map((evidence) => <Disclosure key={evidence.id} summary={`${evidence.label}: calculation`}><MetricInspector evidence={evidence} /></Disclosure>)}
```

- [ ] **Step 3: `AssistantEvidence.tsx`** — import and swap the two blocks:

```tsx
import Disclosure from '../Disclosure'
```

`ComputedSummary`'s `<details>` becomes:

```tsx
    <Disclosure summary="Inspect the figures and comparison window">
      <dl>{bundle.metrics.map((metric) => <div key={metric.id}><dt>{metric.label}</dt><dd><EvidenceReference metric={metric} /></dd></div>)}</dl>
    </Disclosure>
```

`SavedFindings`' per-finding `<details className="assistant-saved-finding">` becomes:

```tsx
    {findings?.map((finding) => <Disclosure key={finding.id} className="assistant-saved-finding" summary={<>{finding.title}<small>Evidence from {new Date(finding.evidence_as_of).toLocaleString()}</small></>}>
      <AssistantMessageBody text={finding.content} metrics={finding.evidence} />
      {finding.evidence.length > 0 && <dl>{finding.evidence.map((metric) => <div key={metric.id}><dt>{metric.label}</dt><dd><EvidenceReference metric={metric} /></dd></div>)}</dl>}
      <p className="assistant-meta">Saved {new Date(finding.created_at).toLocaleString()}{finding.model_used ? ` · ${finding.model_used}` : ''}</p>
      <button type="button" className="button" disabled={deleting === finding.id} onClick={() => {
        setDeleting(finding.id)
        deleteFinding(finding.id).then(() => setFindings((rows) => rows?.filter((row) => row.id !== finding.id) ?? null))
          .catch((e: unknown) => setError(errorDetail(e))).finally(() => setDeleting(null))
      }}>{deleting === finding.id ? 'Removing…' : 'Remove saved finding'}</button>
    </Disclosure>)}
```

- [ ] **Step 4: `AssistantDrawer.tsx`** — import and swap the reasoning block (only if pre-check (c) holds):

```tsx
import Disclosure from '../Disclosure'
```

```tsx
                  {item.thinking !== undefined && item.thinking !== '' && (
                    // `open` flips true → undefined the instant the answer starts. React writes the
                    // attribute only when the PROP changes, so that one flip collapses the block and
                    // then hands it over: a reader who opens it back up is never stamped shut again.
                    <Disclosure
                      className="assistant-thinking"
                      open={item.content === '' ? true : undefined}
                      summary={item.content === '' ? 'Reasoning…' : 'Reasoning'}
                    >
                      {/* Plain text, not markdown: a reasoning stream is half-formed by definition. */}
                      <div className="assistant-thinking-body">{item.thinking}</div>
                    </Disclosure>
                  )}
```

- [ ] **Step 5: Run the pinned tests**

Run: `npx vitest run src/components/ChartTable.test.tsx src/components/details src/components/ChartCard.test.tsx src/components/assistant`
Expected: all PASS — in particular `reasoning streams open, then collapses when the answer starts`
(`details.assistant-thinking` has `open`, then loses it) and `names the table with a visually-hidden caption`.

Run: `npx tsc -b` → exit 0. Then re-run Task 11's Steps 4–6 (full vitest, build, repo eslint).

- [ ] **Step 6: Commit**

```bash
git add src/components/ChartTable.tsx src/components/details/SelectionDetail.tsx src/components/assistant/AssistantEvidence.tsx src/components/assistant/AssistantDrawer.tsx
git commit -m "refactor(chart,panel,assistant): data table, calculation, computed-summary, saved-finding and reasoning disclosures adopt the shared Disclosure"
```

---

## Hand-off note (write it at the end; the lead relays it)

1. Commits on `polish/f1-surfaces` (one per task; list the hashes).
2. Gate numbers from Task 11 (test count, eslint warnings, build time).
3. Whether Task 12 ran or was skipped, and why.
4. Files touched outside the lane's ownership: `src/App.test.tsx` (two `Back` queries) and — Task 12 only —
   `src/components/ChartTable.tsx`, `src/components/assistant/AssistantEvidence.tsx`.
5. For lane V (spec §15 item 1): `.detail-panel`, `.detail-panel-backdrop`, `dialog.chart-expanded-dialog[open]`
   report non-zero `animation`/`transition` under no-preference and 0s under reduce; the Spending-page frame
   budget check (≤ 2 frames > 32ms during a dock open) decides whether Task 9's documented
   `data-panel-motion` fallback is needed.
6. For the page lanes: the contracts block at the top of this plan (`aside`, `modal`, `height: 'fill'`,
   `COMPLETENESS_LABELS`, `formatComponentLabel`, `--dock-width`).

---

## Self-review (run by the plan author against the spec; recorded here so the reviewer can check it)

**1. Spec coverage**

| Spec requirement | Task |
| --- | --- |
| §2.2 `.detail-layout-content` margin transition over `--t-page` | 9 |
| §2.2 `detail-panel-in` entrance (translateX 24px, opacity) | 9 (on `.detail-panel`, all modes — see ambiguity 2) |
| §2.2 exit: last request kept mounted, `.is-leaving`, `detail-panel-out` over `--t-fast`, `animationend` or `MOTION_MS.fast + 50` | 9 (as a ghost — see ambiguity 1) |
| §2.2 focus restoration via the `activeId` layout effect | 8/9 (unchanged effect; runs when the stack empties) |
| §2.2 one box model: `--dp-top/--dp-bottom/--dp-w`, expanded overrides, `right: max(24px, …)`, transitions | 8 (box model) + 9 (transitions) |
| §2.2 backdrop mounts with `backdrop-in` over `--t-fast` | 9 (`dp-backdrop-in`) |
| §2.2 dock→overlay animates the margin release | 9 (same transition) |
| §2.2 `.is-dragging` disables transitions while resizing | 8 (class) + 9 (CSS) |
| §2.2 `chart.resize({ animation: { duration: 0 } })` | 5 |
| §2.2 `--dock-width` on `<html>`; launcher `right: calc(1.25rem + var(--dock-width))` + transition; launcher hidden while assistant active | 8 (publish) + 10 (CSS, hidden) |
| §2.2 jank fallback documented | 9 (closing note) |
| §2.3 `surface-in`, `::backdrop` `backdrop-in`, allow-discrete exit with `@starting-style` inside `@supports` | 6 |
| §2.3 void fix: flex column card, `.loading-dim { flex:1 }`, `EChart height: 'fill'`, ChartCard drops `innerHeight − 280` | 5 + 6 |
| §4 header = the only chrome row; Back/Close icon buttons with aria-labels | 8 |
| §4 `Segmented variant="toggle" size="sm"` icon-only mode control, `title` + accessible name, dock disabled reason | 8 (see ambiguity 4) |
| §4 `active.actions` after the mode control | 8 |
| §4 persistence keys `finance.detailPanel.mode` / `.width` | 8 |
| §4 default width `clamp(400px, 26vw, 560px)`; dragged width wins | 8 |
| §4 subtitle inline, "About this number" dropped | 8 (CSS) + 2 (MetricInfoButton) |
| §4 focus order heading → body → controls → resizer; zero stops before content | 8 |
| §4 Escape: `length > 1 ? back() : close()`; test updated to two Escapes | 8 |
| §4 resizer grip `::after` 3×32px, accent on hover/focus | 8 |
| §4 `.metric-info-button[aria-expanded="true"]` | 8 (`.info-hint` twin is F2's, panels.css) |
| §4 reading mode measure cap 72ch (assistant exempt); receipt grid | 8 |
| §4 selection panel title = label, subtitle = chart title; SelectionDetail drops first `<p>`, Scope row | 4 |
| §4 pin strip `role="status"` on the span; "Details" → "Show details" | 4 |
| §4 assistant `openPanel({ id, title, actions, modal:false })`, `.assistant-header` removed (in-panel), `.assistant-tabs` → Segmented tabs, review chip first, select max-width 220, keyframe scoped, `modal?: boolean` semantics, Context row + (i) | 10 (+ 8 for `modal`) |
| §5 `COMPLETENESS_LABELS`, `formatComponentLabel`, fallback; "Basis" → "Data status"; exclusion reasons | 1 + 2 |
| §5 `MetricInspector` applies `formatComponentLabel` defensively | 2 |
| §5 dev footer removed; definition `title="Metric {id}, definition {version}"` | 2 |
| §5 metric-aware explain prompt; chart selections keep the template | 3 |
| §12 `ChartCard aside`, grid columns, single column < 900px container, `container-type` | 7 |
| §2.6 / §11 Disclosure adoption for ChartTable, SelectionDetail calculation, computed summary, reasoning, saved findings | 12 (conditional on F2) |
| §14 mode tooltips "Beside the page" / "Over the page" / "Reading mode" / "Exit reading mode" | 8 |
| §15 item 9 gates | 11 |
| §16 distinct keyframe names; persisted width clamped on read; no stranded reader under reduce | 6/9 names; 8 `panelGeometry`; 9 timer |

Not in this lane by design: §2.1 shared keyframes and hover-list additions (F2), `.info-hint[aria-expanded]`
(F2), tokens (F2 — consumed here with fallbacks), the P1 `GROUP_LABELS` call site.

**2. Placeholder scan** — searched this plan for "TBD", "TODO", "implement later", "fill in", "add appropriate",
"handle edge cases", "similar to Task", "write tests for": none. Every code step shows its code; the two
places that say "unchanged" (`ApplicationSourceLink` onward in Task 1, the transcript map in Task 10) name
the exact existing lines that stay and change nothing in them; Task 12's `{/* …unchanged caption /
thead / tbody… */}` marks verbatim existing markup between two swapped wrappers.

**3. Type consistency** — `DetailPanelRequest.modal?: boolean` (Task 8) is what Task 10 passes;
`defaultPanelWidth`, `MODE_STORAGE_KEY`, `WIDTH_STORAGE_KEY` (Task 8) are what its tests import;
`formatCompleteness` / `formatComponentLabel` / `formatEvidenceValue` (Task 1) are what Tasks 2 and 3
import; `explainPrompt(request: ExplainSelectionRequest)` (Task 3) is what the drawer calls with the
listener's `selection` argument (an `ExplainSelectionRequest`); `EChart height?: number | 'fill'`
(Task 5) is what Task 6 passes and the Task 6 test mock types; `aside?: ReactNode` (Task 7) renders
`.chart-card-body.chart-card-with-aside` + `.chart-card-has-aside` as its test asserts;
`SegmentedOption<DetailPanelMode>` / `SegmentedOption<'chat' | 'findings'>` match `Segmented.tsx`'s
generic; the ghost's `leaving` shape `{ request, mode }` is used identically in `beginExit` and the JSX.

## Ambiguities resolved (and how)

1. **Exit "leaving" state.** Spec §2.2 phrases it as the stack keeping the request with `leaving: true`
   until `animationend`. Implemented as: the stack empties at once and the last request is re-rendered as
   an inert, `aria-hidden` ghost `<aside class="detail-panel is-leaving">` for the beat. Observable result
   is the same (panel stays painted, unmounts on `animationend` or `MOTION_MS.fast + 50`); the invariants
   are simpler (`activeId` null immediately, `inert` lifts, focus returns through the existing effect,
   `open()` mid-beat replaces the ghost). Gated on `typeof el.animate === 'function'` so jsdom unmounts at
   once and every existing synchronous test stays valid.
2. **Entrance keyframe scope.** Spec says `.detail-panel-dock { animation: detail-panel-in }`. Applied to
   `.detail-panel` (all modes): a per-mode class swaps on every mode switch and would restart the
   entrance on top of the inset/width transition. The dock still gets exactly the specified entrance.
3. **Keyframe names.** Spec §2.2/§2.3 name `backdrop-in`; §16 asks F1 to keep distinct names from F2's
   `panels.css` keyframes. Used `dp-backdrop-in` and `chart-backdrop-in` (identical bodies). Lane V's
   acceptance reads durations, not names.
4. **Per-option `aria-label`.** `Segmented`'s options take `title` but no `aria-label`, and
   `Segmented.tsx` is not this lane's file. The accessible name comes from visually-hidden text inside
   the icon label (same result for AT and for `getByRole('button', { name })`), plus `title`.
5. **`.assistant-header` removal.** Removed inside the panel (the spec's context); kept for the standalone
   (no provider) path the tests and embeds use, as the task brief requires.
6. **`formatEvidenceValue` location.** Moved to `utils/metricReceipt.ts` (re-exported from
   `MetricInspector`) so `explainSelection.ts` can format the figure without an import cycle.
7. **`--scrim` token.** F2 defines it; this lane's backdrops read `var(--scrim, <today's colour>)` so the
   light-theme value lands on merge without a second edit to F1's files.
8. **`.info-hint[aria-expanded]` and hover-transition list entries.** Both live in `panels.css` (F2). Only
   `.metric-info-button[aria-expanded]` is done here (details.css).
9. **Tests outside ownership.** `App.test.tsx` queries `name: 'Back'` twice; the button is renamed by
   spec, so the two queries change (`/^Back to /`, `'Back to Financial question'`). Reported in the hand-off.
10. **Launcher hiding.** The `hidden` attribute (UA `display: none`) while `panel.activeId === 'assistant'`;
    the panel's Close (and Escape) are the exits, and the provider's `returnTo` restores focus to the
    launcher once it is visible again.
11. **Findings tab `panelIds`.** Only the Conversation tab gets `aria-controls` (`assistant-conversation`);
    `SavedFindings` owns its own flex/scroll root and mounts on demand, so wrapping it for an id would
    break its sizing.
12. **Escape inside the assistant with a provider.** The drawer's root and composer Escape handlers defer
    to the provider (`!panel`), so Escape pops one level everywhere; standalone keeps the old behaviour.
13. **Review chip gating.** Shown whenever the transcript is empty, configured or not (the computed review
    needs no key — `send()` lets an intent through); the preset/route chips still need a key, as today.
    The "Month in review" preset (same intent, a written-explanation prompt) stays: `samples.test.ts` pins
    it and it is P1/copy-pass territory, not F1's.
14. **Disclosure adoption in `AssistantEvidence.tsx`.** The file is unowned; spec §11 assigns those
    conversions to F1, so Task 12 touches it and reports.
15. **"Review latest completed month" queued-selection status.** The `<p role="status">` that lived inside
    the removed `.assistant-review-action` row renders on its own above the chips.

---

## Results (implementer hand-off, 2026-09-13)

**Status: DONE_WITH_CONCERNS** — Tasks 1–11 complete on `polish/f1-surfaces` (branched from `main`
@`dc91479`); **Task 12 skipped** (F2's `Disclosure` is not in this worktree and not on `main`). One
documented eslint-warning addition (+1, of the same pre-existing kind), and three small deviations
from the plan's letter, all recorded below.

### Commits (one per task, in order)

| # | Task | SHA | Message prefix |
| --- | --- | --- | --- |
| 1 | Receipt labels + `formatEvidenceValue` move | `d80fe07` | `fix(copy):` |
| 2 | `MetricInspector` copy (Data status, labels, tooltip, no subtitle) | `7b86199` | `fix(copy):` |
| 3 | Metric-aware `explainPrompt` | `2ea5ac7` | `fix(copy):` |
| 4 | `SelectionDetail` / `ChartCard` title-subtitle swap + pin strip | `d1e2f23` | `fix(copy):` |
| 5 | `EChart` `height: 'fill'` + animation-free resize | `d951ace` | `feat(chart):` |
| 6 | Expand dialog entrance/exit + void fix | `6269acf` | `feat(chart):` |
| 7 | `ChartCard aside` | `db89632` | `feat(chart):` |
| 8 | Panel chrome + behaviour | `0d79ccf` | `feat(panel):` |
| 9 | Panel motion + exit ghost | `050b2e8` | `feat(panel):` |
| 10 | Assistant inside the panel | `3f93638` | `feat(assistant):` |
| 11 | Gates (no code changes) | — | — |
| 12 | Disclosure adoption | **skipped** | — |

### Gate numbers (Task 11, run from the worktree root)

| Gate | Command | Result |
| --- | --- | --- |
| Types | `npx tsc -b` | no output, exit 0 |
| Lint (scoped) | `npx eslint src/components/details src/components/assistant src/components/ChartCard.tsx src/components/ChartSurface.tsx src/components/EChart.tsx` | **0 errors, 4 warnings** (all `react-refresh/only-export-components`; the same paths on `main` measure 3 — see deviation 1) |
| Tests (scoped) | `npx vitest run src/components/details src/components/assistant src/components/ChartCard.test.tsx src/components/EChart.test.tsx src/utils/metricReceipt.test.ts` | 13 files, **170 tests passed** |
| Tests (full) | `npx vitest run` | **209 files, 2873 tests passed, 0 failed**, no unhandled errors; `src/theme/motion.test.ts` and `src/theme/tokens.test.ts` both green. Duration 98s. |
| Build | `npm run build` | `tsc -b` silent, then `built in 9.09s`; largest chunk `assets/tooltip-*.js` **758.10 kB** (gzip 257.30 kB) — under the configured 760 kB advisory, and unchanged by this lane |
| Lint (repo) | `npx eslint .` | **0 errors, 25 warnings** (`main` measures 24 — see deviation 1) |

The plan's stated vitest baseline (2753) is stale: `main` @`dc91479` already carries more. This lane
adds about 28 tests (metricReceipt 4, MetricInspector +2, explainSelection 4, ChartCard +3, EChart +2,
DetailPanelProvider +10, assistant +3).

### Deviations from the plan / spec

1. **The eslint warning count is +1, not unchanged (Task 8, Step 6).** The plan predicted "the count
   is unchanged" because `panelGeometry` was already exported. That arithmetic missed
   `defaultPanelWidth`, which is a *new* exported function beside the component, so
   `react-refresh/only-export-components` fires once more in `DetailPanelProvider.tsx`
   (`src/components/details`: 3 to 4; repo-wide: 24 to 25). Kept rather than worked around: the
   contracts block publishes `defaultPanelWidth` from `DetailPanelProvider.tsx` verbatim and the page
   lanes build against that path. No rule was disabled, and the warning is the same kind the plan
   pre-authorises. Spec §15 item 9 allows "baseline 24 + documented additions" — this is the addition.
2. **The `headerActionsRef` effect carries a dependency array (Task 10, Step 3).** The plan wrote it
   unkeyed (`useEffect(() => { headerActionsRef.current = <AssistantHeaderActions … /> })`).
   `react-hooks/exhaustive-deps` rejects that shape here — it sees `setModel` referenced inside an
   unkeyed effect and warns about "an infinite chain of updates". Written as
   `}, [model, models, streaming, newChat])` instead: identical behaviour (the deps are exactly the
   ref's inputs, and this effect is declared before the open effect, so `.current` is always set and
   current when the open effect reads it), and the warning goes away. The plan's intent — the open
   effect must NOT list model/models/streaming, so it never re-raises the assistant over a stacked
   evidence panel — is unchanged.
3. **The preset chip list is hoisted out of the JSX (Task 10, Step 3).** The plan's
   `{configured && [...INSIGHT_PRESETS, ...samplesFor(location.pathname)].map((sample) => …)}` makes
   the React Compiler's `react-hooks/refs` rule report **an error** ("Cannot access refs during
   render") on the `send(…)` call inside the map callback — `send` reads `sendSeq` / `handleRef` /
   `lastQuestion` / `modelsRef` / `stickToBottom`. Bisected: the inline `cond && array.map(cb)` is the
   trigger; the same callback outside that shape is clean. Replaced with a hoisted
   `const presetChips = configured ? [...INSIGHT_PRESETS, ...samplesFor(location.pathname)] : []`
   beside `configured`, and `{presetChips.map(…)}` in the JSX. Same rendering, same gating, 0 errors.

Ambiguities 1–15 in the plan's own self-review were all implemented as the plan resolved them; no
further ambiguity surfaced. The spec's §2.2 phrasing (`leaving: true` inside the stack) is realised as
the plan's exit ghost, and §2.2's per-mode entrance selector as the plan's `.detail-panel` selector —
both are the plan's own recorded, reasoned departures from the spec's letter, not new ones.

### Skipped

**Task 12 — Disclosure adoption.** Pre-check run as specified:

- `ls src/components/Disclosure.tsx src/components/disclosure.css` — both missing
- `git ls-tree -r --name-only main -- src/components | grep -i disclosure` — no match

So: **Task 12 skipped — `Disclosure` not present in this worktree; ChartTable, SelectionDetail
calculations, ComputedSummary, SavedFindings and the reasoning block still render bare `<details>`.**
The lead should re-run Task 12 on main after F2 merges (or hand it to F2). Nothing in this lane blocks
that: `SelectionDetail.tsx` still carries its `<details>` on one line, and `AssistantEvidence.tsx` /
`ChartTable.tsx` are untouched.

### Files touched outside this lane's ownership

- `src/App.test.tsx` — the two `name: 'Back'` queries only (the Back button is renamed by spec §4):
  line 76 becomes `{ name: /^Back to / }`, line 86 becomes `{ name: 'Back to Financial question' }`.
  No other change to that file.
- Task 12's unowned files (`ChartTable.tsx`, `AssistantEvidence.tsx`) were **not** touched, since the
  task was skipped.

### For lane V (spec §15 item 1)

- Under `reducedMotion: 'no-preference'`, non-zero `animation` / `transition` durations should read on
  `.detail-panel` (`detail-panel-in` over `--t-page`, plus the inset / width / right / border-radius
  transition), `.detail-panel.is-leaving` (`detail-panel-out` over `--t-fast`),
  `.detail-panel-backdrop` (`dp-backdrop-in`), `.detail-layout-content` (margin-inline-end over
  `--t-page`), `dialog.chart-expanded-dialog[open]` (`surface-in` over `--t-page`) and its
  `::backdrop` (`chart-backdrop-in`). Under `reduce` all read 0s — every duration is a `var(--t-*)`.
- Keyframe names are this lane's own and do not collide with F2's `panels.css`: `detail-panel-in`,
  `detail-panel-out`, `dp-backdrop-in`, `surface-in`, `chart-backdrop-in`.
- **Frame budget check still owed:** Spending (three canvases plus a sankey), no more than two frames
  over 32ms during a dock open. If it fails, Task 9's closing note documents the `data-panel-motion`
  contingency; it is deliberately NOT built.
- Eyeballs this lane could not make in jsdom: the three-cell panel header row (Back / heading /
  controls must read as ONE hairline row), the resizer grip pill, the expanded dialog with a real
  chart filling it (audit A3's 88px void), the assistant's Context row at a narrow dock width, and the
  launcher stepping sideways as a dock opens.

### For the page lanes — contracts now live on this branch

`DetailPanelRequest.modal?: boolean` (default true) · `defaultPanelWidth(viewport)` ·
`MODE_STORAGE_KEY` / `WIDTH_STORAGE_KEY` (`finance.detailPanel.mode` / `finance.detailPanel.width`) ·
`--dock-width` on `<html>` · `EChart height?: number | 'fill'` · `ChartCard aside?: ReactNode`
(plus `.chart-card-has-aside` on the section and `.chart-card-body.chart-card-with-aside` /
`.chart-card-plot` / `.chart-card-aside` inside) · the selection panel opens with
`title = selection.label`, `subtitle = chart title` · `COMPLETENESS_LABELS`, `formatComponentLabel`,
`formatCompleteness`, `formatEvidenceValue` from `src/utils/metricReceipt.ts` (`MetricInspector`
re-exports `formatEvidenceValue`) · `explainPrompt(request)` from
`src/components/details/explainSelection.ts`.

Two renames page lanes may be asserting against: the pin strip's button is now **"Show details"**
(was "Details") and the panel's Back button is **"Back to {previous title}"** (was "Back").

### Review round (2026-09-13, verdict APPROVE WITH FIXES)

All five review items applied in one commit, **`a94e9f8`** —
`fix(panel): review round — header row keeps its title track, Expand dialog closes instantly, reduce
skips the exit ghost, launcher freezes mid-drag, one source for the assistant's panel actions`.

| # | Item | What changed | Pinned by |
| --- | --- | --- | --- |
| 1 | IMPORTANT — header row squeeze | `.detail-panel` becomes `grid-template-columns: auto minmax(min(40%, 12rem), 1fr) minmax(0, auto)` and `.detail-panel-controls` gains `min-width: 0`, so the ~437px of assistant actions shrink into the select's own `flex: 1 1 auto; min-width: 0; text-overflow: ellipsis` instead of collapsing the title track at the 400–416px default dock width. Reasoning also written into the header-row comment. | `surfaceCss.test.ts` |
| 2 | IMPORTANT — Expand dialog exit | The whole `@supports (transition-behavior: allow-discrete)` block and its `@starting-style` are **deleted**. `surface-in` and `chart-backdrop-in` entrances stay; the close is instant, which spec §2.3 allows. The block comment now records the three reasons (host moved back synchronously so the fade played on an empty box; `::backdrop` snapped; `@starting-style`'s `--t-fast` opacity/transform fought the `--t-page` `surface-in` on the same properties). No existing test pinned the deleted rules. | `surfaceCss.test.ts` |
| 3 | minor — reduced motion | `beginExit` early-returns on `typeof panelRef.current?.animate !== 'function' \|\| prefersReducedMotion()` (`src/components/useReducedMotion.ts`), so under `reduce` — where the motion block does not exist — the close is instant again instead of parking an opaque inert ghost over the reflowed page for ~170ms. | new `DetailPanelProvider.test.tsx` case, `matchMedia` stubbed to `matches: true` |
| 4 | minor — launcher during a drag | `.is-dragging .assistant-launcher { transition: none; }` added inside assistant.css's no-preference block, beside the launcher's `right` transition. | `surfaceCss.test.ts` |
| 5 | minor — one source for the actions | The update effect now pushes `headerActionsRef.current` rather than re-rendering `<AssistantHeaderActions …/>`. `model/models/streaming/newChat` stay in its dep list (they are what makes it re-run); a comment says so, and eslint is clean with the body no longer naming them. | existing assistant tests |

**New test file:** `src/components/details/surfaceCss.test.ts` — lane F1's three stylesheets pinned as
text, on `settingsCss.test.ts`'s idiom. jsdom applies no stylesheet, so a computed-style assertion
(the review's first preference for item 1) reports UA defaults and can say nothing about a grid track
or a transition; reading the sheet is the house's proven substitute and covers items 1, 2 and 4.

**Gates after the round**

| Gate | Result |
| --- | --- |
| `npx tsc -b` | no output, exit 0 |
| `npx eslint src/components/details src/components/assistant src/components/ChartCard.tsx src/components/ChartSurface.tsx src/components/EChart.tsx` | **0 errors, 4 warnings** (unchanged — the same `react-refresh/only-export-components` set) |
| `npx vitest run` (scoped: details, assistant, ChartCard, EChart, metricReceipt, motion) | 15 files, **179 tests passed** |
| `npx vitest run` (full) | **210 files, 2877 tests passed, 0 failed** |
| `npm run build` | unchanged from the first round (no source shape changed that the bundler sees differently) |

**One intermittent failure seen once, not ours.** The first full run after this round reported
`src/components/portfolio/TransactionsPanel.test.tsx > TransactionsPanel entry session > a successful
edit still resets the whole form — carry-forward is create-only` (`expected '1' to be ''`). It passes
in isolation both in this worktree and in the main checkout, and the immediately following full run
was 210/210 green. The test asserts the reset form synchronously right after
`await waitFor(() => expect(updateTransaction).toHaveBeenCalled())` — the same race
`AssistantDrawer.test.tsx`'s `openDrawer()` comment documents ("about one run in ten"): the mock is
called before React commits the reset. Pre-existing, order/timing dependent, and in P2's file
(`src/components/portfolio/*`), so it is left for the lead / P2 rather than fixed from this lane.
