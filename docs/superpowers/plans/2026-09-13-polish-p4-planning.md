# Lane P4 — Projection · Calendar · Settings view-fit polish (2026-09-13) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one Opus
> implementer for this lane in its own worktree, TDD per task, a spec-compliance review and a
> code-quality review after the lane, then a local merge into main by the lead — never pushed).
> Steps use `- [ ]` checkboxes for tracking.

**Spec:** `docs/superpowers/specs/2026-09-13-surface-grammar-and-view-fit-polish-design.md` — this
lane implements the **P4 rows** of §1, §7, §9, §10, §11, §12 and §14 (Projection, Calendar,
Settings). Evidence: `scratchpad/ux-audit-2026-09-13/reports/projection-calendar-settings-themes.md`
(P-1…P-11, C-1…C-7, S-1…S-5, S-8, S-10, S-11, G-1; gitignored — read it once for the measurements,
the plan restates what implementation needs).

**Goal:** three pages stop leaking prose outside their cards, stop hiding controls behind inner
scrollers and empty voids, reserve their boxes while lazily loaded cards fetch, and print money
that reads honestly (no "~−$0") — without editing any shell file.

**Architecture:** page-scoped CSS plus a handful of small owned components: Projection moves its
notes into `ChartCard` slots and pins the chart column under a *measured* outcomes band; Calendar
hosts its Add-event form in the shell's detail panel through the ChartCard "stable host + portal"
idiom (inline card fallback when no provider), and its footnotes move into the calendar card;
Settings hides the section bands, draws a `SettingsGhost` per lazily loaded card, and primes a
30-second warm cache on tab hover that cards consume on mount (the API client only dedupes
in-flight GETs, so a hover prefetch needs somewhere to land).

**Tech stack:** React 19 + TypeScript + Vite; ECharts 6 (untouched here); Vitest + Testing
Library/jsdom. No backend changes.

---

## Mechanics (read once)

- Worktree: `C:/Users/edyli/personal-finance-dashboard/.worktrees/polish-p4`, branch
  `polish/p4-planning`, cut from `main` **after F1 (`polish/f1-surfaces`) and F2 (`polish/f2-shell`)
  have merged**. `node_modules` is a junction the orchestrator creates; do not `npm install`.
- Every command below runs from the worktree root. Windows: use Git Bash syntax (forward slashes).
- Scoped tests while working:
  `npx vitest run src/pages/ProjectionPage.test.tsx src/pages/CalendarPage.test.tsx src/pages/SettingsPage.test.tsx src/components/projection src/components/calendar src/components/settings src/sandbox`
- Lane gates (Task 16): `npx tsc -b`, then
  `npx eslint src/pages/ProjectionPage.tsx src/pages/CalendarPage.tsx src/pages/SettingsPage.tsx src/components/projection src/components/calendar src/components/settings`,
  then the scoped vitest line, then `npx vitest run` (full) and `npm run build`.
- Commits small, one per task, prefixes `feat(projection):`, `feat(calendar):`, `feat(settings):`,
  `fix(copy):`, `refactor(calendar):`. Never push. Never delete files or drop databases — deletions
  are deferred to the end of the night (Task 16 lists them for the lead).
- House constraints: no literal durations in CSS (tokens only — this lane adds **no** transitions
  or animations); motion, if any, under `prefers-reduced-motion: no-preference`; per-page
  stylesheets never depend on another page's sheet; existing tests are updated, never deleted.
- `tsconfig.app.json` has `noUnusedLocals: true` — an import left behind after a move fails
  `tsc -b`. Each task names the imports that become unused.
- Lint: `eslint-plugin-react-hooks` recommended (compiler rules included). Never call a `useState`
  setter synchronously in an effect body (inside `.then` is fine); never read `ref.current` during
  render; keep `useCallback`/`useMemo` deps complete.

## Preconditions — F1/F2 primitives this lane builds on (verify before Task 1)

Run these from the worktree. Every expectation must hold; if one does not, **stop and tell the
lead** — F1/F2 have not merged and this lane's branch point is wrong.

```bash
grep -n "sections" src/components/shell/PageFrame.tsx | head -3
# expect: a `sections?: ReactNode` prop and a `page-frame-sections` wrapper
grep -n "sections=" src/pages/ProjectionPage.tsx src/pages/SettingsPage.tsx
# expect: one match per file — F2 already moved LocalSectionNav into PageFrame's `sections`
grep -n "kpi-row-5\|container-type: inline-size" src/components/panels.css | head -5
# expect: `.kpi-row-5 { grid-template-columns: repeat(5, minmax(0, 1fr)) }` inside an @container block,
#         and `.page { container-type: inline-size }`
grep -n "row-actions\|data-scroll-more" src/components/panels.css | head -4
# expect: the sticky `.data-table td.row-actions` rule and the `[data-scroll-more~="right"]` mask
ls src/components/useScrollEdges.ts src/components/Disclosure.tsx
# expect: both files exist
grep -n "^export" src/components/useScrollEdges.ts src/components/Disclosure.tsx
# expect: `export function useScrollEdges(ref` … and `export default function Disclosure(`
grep -n "modal" src/components/details/DetailPanelProvider.tsx | head -3
# expect: `modal?: boolean` on DetailPanelRequest (F1) — this lane uses the default (true) and never passes it
grep -n "GhostCard" src/components/PageSkeleton.tsx
# expect: NO output. F2 adds `GhostTile delta?` only, so Task 10 creates the settings-scoped ghost.
```

Also note the exact shape of `useScrollEdges` (Task 9 wires it) and `Disclosure` (Task 15):

```bash
sed -n 1,40p src/components/useScrollEdges.ts
sed -n 1,60p src/components/Disclosure.tsx
```

The spec's contract, which the code below is written against: `useScrollEdges(ref: RefObject<HTMLElement | null>): void`
toggles `data-scroll-more` on the scroller (initial, scroll, resize); `<Disclosure summary={ReactNode}
defaultOpen? open? onToggle? onOpen? className? id? name?>` renders `<details class="disclosure">
<summary>{chevron}{summary}</summary><div class="disclosure-body">{children}</div></details>`.
If either differs, adapt the call site in that task and say so in the task's commit body.

## File map

| File | Change |
| --- | --- |
| `src/pages/ProjectionPage.tsx` | `kpi-row-5` band with a measured height (`measureBand` ref), shorter FI tile label, notes into the chart card's `lede`/`footer`, `ScenarioHints` in the compare card |
| `src/pages/ProjectionPage.css` | band static under 1000px, no inner scroller, sticky chart column, compare table cap + caption, preset row flex, collapsed-assumptions rule; warnings/method-note/intro blocks deleted |
| `src/components/projection/ScenarioPanel.tsx` | exports `ScenarioHints`; renders it only when not `compact`; budgets sentence in its own span |
| `src/components/projection/ProjectionTrendPanel.tsx` | intro paragraph → ChartCard `lede` |
| `src/sandbox/sandbox.css` | `.sandbox-pins .field-input` reads as words |
| `src/components/calendar/cashflow.ts` | `signedCompact` prints a zero as `$0` |
| `src/components/calendar/CalendarGrid.tsx` | `gutterLines` (two lines, no slash) replaces `gutterText` |
| `src/components/calendar/CashflowStrip.tsx` | quote date → Vesting `delta`; footnotes → exported `CashflowNotes` |
| `src/components/calendar/DayDrawer.tsx` | est. badge only on non-zero estimates |
| `src/components/calendar/AddEventForm.tsx` | **new** — the form lifted out of the page (`EventFields`, `EMPTY_FIELDS`) |
| `src/pages/CalendarPage.tsx` | form hosted in the detail panel (fallback inline), `CashflowNotes` in the grid card, month `h2` dropped |
| `src/pages/CalendarPage.css` | 76px cells/gutter/rows, gutter lines, `.cal-note`, panel form fit; `.cal-title` and `.cal-strip-asof` rules deleted |
| `src/pages/SettingsPage.tsx` | bands `visually-hidden`, hover/focus prefetch (delegated listeners), skeleton parity, password note removed |
| `src/pages/SettingsPage.css` | `.settings-page .card-grid { align-items: start }` |
| `src/components/settings/SettingsGhost.tsx` | **new** — a card body's ghost at its loaded height |
| `src/components/settings/settingsPrefetch.ts` | **new** — `WARM` keys, `primeWarm`/`takeWarm`/`warmSource`, `prefetchSection` |
| `src/components/settings/*Card.tsx` (12) | ghost instead of `Loading…`; mount load takes primed data; `retry` wrapped |
| `src/components/settings/AccountsCard.tsx` | renders once after both feeds settle |
| `src/components/settings/CategoriesCard.tsx` | `span-8`, `CategoriesTable` child with `useScrollEdges` |
| `src/components/settings/HouseholdCard.tsx` | `span-4` |
| `src/components/settings/SystemCard.tsx` | list-valued facts as `<ul>` spanning both columns |
| `src/components/settings/settings.css` | band rule trimmed to its scroll margin, ghost, fact lists, restore labels |
| `src/components/settings/ImportReportView.tsx`, `RestoreReportView.tsx` | `<details>` → `Disclosure` |
| Tests | updated/added per task (listed inside each task) |

---

### Task 1: Projection outcomes band — one row of five, static when it cannot be

**Files:**
- Modify: `src/pages/ProjectionPage.tsx:97,109`
- Modify: `src/pages/ProjectionPage.css:37`
- Test: `src/pages/ProjectionPage.test.tsx`

- [ ] **Step 1: Retarget the five existing tile assertions to the new label**

In `src/pages/ProjectionPage.test.tsx`, replace every `'Reach FI target within 30 years'` (five
occurrences, lines ~240, 252, 659, 668, 677) with `'Reach FI within 30 yrs'`:

```bash
sed -i "s/Reach FI target within 30 years/Reach FI within 30 yrs/g" src/pages/ProjectionPage.test.tsx
grep -c "Reach FI within 30 yrs" src/pages/ProjectionPage.test.tsx
# expect: 5
```

- [ ] **Step 2: Write the failing test**

Append to the end of `src/pages/ProjectionPage.test.tsx` (the file's module-scope helpers
`renderPage`, `loaded`, `tileFor` are in scope):

```tsx
describe('ProjectionPage — surface polish (2026-09-13 spec §12)', () => {
  it('lays the five outcomes out as one row and glues the FI tile’s (i) to its last word', async () => {
    renderPage()
    await loaded()
    const band = document.querySelector('.projection-outcomes') as HTMLElement
    // panels.css lays .kpi-row-5 out as five equal tracks above 1000px of container width.
    expect(band.classList.contains('kpi-row')).toBe(true)
    expect(band.classList.contains('kpi-row-5')).toBe(true)
    expect(band.querySelectorAll('.stat-tile')).toHaveLength(5)
    // The label ends in a no-break space, so the info button can never wrap onto a line of its own.
    const label = within(band).getByText('Reach FI within 30 yrs')
    expect(label.textContent).toContain('yrs\u00A0')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/pages/ProjectionPage.test.tsx -t "one row"`
Expected: FAIL — `expect(band.classList.contains('kpi-row-5')).toBe(true)` receives `false`.

- [ ] **Step 4: Add the class and the label**

In `src/pages/ProjectionPage.tsx`, line 97, replace

```tsx
            <div className="kpi-row projection-outcomes" aria-label="Planning outcomes">
```

with

```tsx
            <div className="kpi-row kpi-row-5 projection-outcomes" aria-label="Planning outcomes">
```

and, line 109, replace

```tsx
              <StatTile label={`Reach FI target within ${data.years} years`} value={formatPct(data.fi_probability, { signed: false })}
```

with

```tsx
              {/* Short enough for a fifth of the row, and the (i) is glued to the last word with a
                  no-break space so it never drops to a line of its own (audit P-11). */}
              <StatTile label={`Reach FI within ${data.years}\u00A0yrs\u00A0`} value={formatPct(data.fi_probability, { signed: false })}
```

- [ ] **Step 5: Add the below-1000px rule**

In `src/pages/ProjectionPage.css`, directly after line 37
(`.projection-outcomes { position: sticky; … }`) insert:

```css
/* Five tiles, one row (2026-09-13 polish spec §12): panels.css lays .kpi-row-5 out as five equal
   tracks above 1000px of container width. Below that the row wraps, and a two-row band pinned to
   the top of a laptop viewport covered the very chart it describes (audit P-1: 253px, 28% of a
   900px viewport) — so there the band simply scrolls with the page. */
@container (max-width: 999px) {
  .projection-outcomes { position: static; }
}
```

Keep `.projection-page { container-type: inline-size; }` (line 36): F2 sets the same on `.page`,
and the duplicate is harmless — it means these queries resolve even if that rule moves.

- [ ] **Step 6: Run the page tests**

Run: `npx vitest run src/pages/ProjectionPage.test.tsx`
Expected: all tests pass (the five retargeted tile tests and the new one).

- [ ] **Step 7: Commit**

```bash
git add src/pages/ProjectionPage.tsx src/pages/ProjectionPage.css src/pages/ProjectionPage.test.tsx
git commit -m "feat(projection): outcomes band is one row of five tiles, static below 1000px; shorter FI tile label"
```

---

### Task 2: Assumptions column without its scroller; the chart column sticks under the measured band

**Files:**
- Modify: `src/pages/ProjectionPage.tsx` (imports, a `measureBand` ref callback, the band's `ref`)
- Modify: `src/pages/ProjectionPage.css:38-41,52-56`
- Test: `src/pages/ProjectionPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Append inside the `describe('ProjectionPage — surface polish …')` block added in Task 1:

```tsx
  it('measures the outcomes band into --projection-band-h so the chart column sticks under it', async () => {
    // jsdom has no ResizeObserver; the stub is what lets the measurement path run at all.
    class StubResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', StubResizeObserver)
    try {
      renderPage()
      await loaded()
      const band = document.querySelector('.projection-outcomes') as HTMLElement
      // Written on the band's parent (the section panel) so .projection-chart-area inherits it;
      // jsdom lays nothing out, so the measured value is 0px — the WIRING is what is under test.
      expect(band.parentElement?.style.getPropertyValue('--projection-band-h')).toBe('0px')
    } finally {
      vi.unstubAllGlobals()
    }
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/pages/ProjectionPage.test.tsx -t "measures the outcomes band"`
Expected: FAIL — `getPropertyValue` returns `''`.

- [ ] **Step 3: Measure the band**

In `src/pages/ProjectionPage.tsx`, change the React import (line 1) to

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
```

and add, directly before `return <div className="page projection-page">` (line 86):

```tsx
  // The chart column sticks UNDER the outcomes band (spec §12), whose height is measured rather
  // than assumed: it is one row of tiles when their labels fit and taller when one wraps, and a
  // constant would park the chart's header under the band at exactly the widths that wrap.
  // Written on the band's parent (the section panel) so .projection-chart-area inherits it; the
  // 131px fallback in the CSS is the one-row band (115px tile + 8px padding twice). A ref callback
  // with a cleanup (React 19), memoised so React does not re-observe on every render. jsdom and
  // any browser without ResizeObserver keep the fallback.
  const measureBand = useCallback((band: HTMLDivElement | null) => {
    const target = band?.parentElement ?? null
    if (band === null || target === null || typeof ResizeObserver === 'undefined') return undefined
    const write = () => target.style.setProperty('--projection-band-h', `${band.offsetHeight}px`)
    write()
    const observer = new ResizeObserver(write)
    observer.observe(band)
    return () => {
      observer.disconnect()
      target.style.removeProperty('--projection-band-h')
    }
  }, [])
```

Then give the band the ref — line 97 becomes:

```tsx
            <div ref={measureBand} className="kpi-row kpi-row-5 projection-outcomes" aria-label="Planning outcomes">
```

- [ ] **Step 4: Replace the scroller with a sticky chart column**

In `src/pages/ProjectionPage.css`, replace lines 38–41

```css
.projection-workspace { display: grid; grid-template-columns: minmax(480px, 1fr) 350px; align-items: start; gap: 18px; }
.projection-chart-area { min-width: 0; }
.projection-chart-controls { display: flex; gap: 8px; flex-wrap: wrap; }
.projection-assumptions { max-height: min(780px, calc(100vh - 210px)); min-height: 460px; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; border-radius: 10px; }
```

with

```css
.projection-workspace { display: grid; grid-template-columns: minmax(480px, 1fr) 350px; align-items: start; gap: 18px; }
/* The chart stays in view while every knob is reachable (spec §12, audit P-2: the old inner
   scroller hid 932px of controls behind a hard edge through the Withdrawal-rate box). The aside is
   its natural height and the CHART column pins under the outcomes band. --sticky-inset is the
   frame's sticky block (the tab strip, measured by PageFrame); --projection-band-h is the band,
   measured by ProjectionPage.tsx's measureBand; 131px is the one-row band it falls back to. */
.projection-chart-area {
  min-width: 0;
  position: sticky;
  top: calc(var(--sticky-inset, 0px) + var(--projection-band-h, 131px) + 8px);
  align-self: start;
}
.projection-chart-controls { display: flex; gap: 8px; flex-wrap: wrap; }
.projection-assumptions { min-width: 0; }
```

Then extend the `@container (max-width: 999px)` block from Task 1 so a non-sticky band leaves no
gap above the chart:

```css
@container (max-width: 999px) {
  .projection-outcomes { position: static; }
  .projection-chart-area { top: calc(var(--sticky-inset, 0px) + 8px); }
}
```

and replace the file's last block (lines 52–56)

```css
@container (max-width: 900px) {
  .projection-workspace { grid-template-columns: 1fr; }
  .projection-assumptions { max-height: none; }
  .projection-assumptions .sandbox-controls { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
```

with

```css
/* One column: the chart above the knobs. A sticky chart here would pin a 400px canvas over the
   controls the reader is scrolling towards, so it scrolls with them. */
@container (max-width: 900px) {
  .projection-workspace { grid-template-columns: 1fr; }
  .projection-chart-area { position: static; }
  .projection-assumptions .sandbox-controls { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
```

- [ ] **Step 5: Run the page tests**

Run: `npx vitest run src/pages/ProjectionPage.test.tsx`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add src/pages/ProjectionPage.tsx src/pages/ProjectionPage.css src/pages/ProjectionPage.test.tsx
git commit -m "feat(projection): assumptions column loses its inner scroller; the chart column sticks under the measured outcomes band"
```

---

### Task 3: Method note, warnings and trend intro live inside their chart cards

**Files:**
- Modify: `src/pages/ProjectionPage.tsx:136-139`
- Modify: `src/components/projection/ProjectionTrendPanel.tsx:31-45`
- Modify: `src/pages/ProjectionPage.css:5-23,50`
- Test: `src/pages/ProjectionPage.test.tsx`

- [ ] **Step 1: Update the warnings test and add the placement tests**

In `src/pages/ProjectionPage.test.tsx`, replace the body of `it('renders the model warnings verbatim', …)`
(lines ~435–448) with:

```tsx
  it('renders the model warnings verbatim, as the chart card’s lede', async () => {
    vi.mocked(fetchProjection).mockResolvedValue(
      projectionOut({
        warnings: ['no cashflow history — monthly contribution defaulted to 0'],
        monthly_contribution: '0.00',
      }),
    )
    renderPage()

    const warning = await screen.findByText('no cashflow history — monthly contribution defaulted to 0')
    // Inside the card, in the muted header strip — never a paragraph floating between two cards.
    const card = warning.closest('.chart-card') as HTMLElement
    expect(card).not.toBeNull()
    expect(warning.closest('.chart-lede')).not.toBeNull()
    expect(document.querySelector('.projection-warnings')).toBeNull()
  })
```

Then append inside the `describe('ProjectionPage — surface polish …')` block:

```tsx
  it('appends the method sentence to the chart card’s footer and renders no note outside it', async () => {
    renderPage()
    await loaded()
    const card = screen.getByLabelText(/Projected investable balance over the next/).closest('.chart-card') as HTMLElement
    const footer = card.querySelector('.chart-card-row-caption') as HTMLElement
    expect(footer.textContent).toContain('Growth only excludes contributions.')
    expect(footer.textContent).toContain('The central line uses a constant assumed return')
    expect(document.querySelector('.projection-method-note')).toBeNull()
  })

  it('renders the trend intro as the trend card’s lede', async () => {
    renderPage()
    await openTrend()
    const intro = await screen.findByText(/An exploratory fit of past net worth/)
    expect(intro.closest('.chart-lede')).not.toBeNull()
    expect(intro.closest('.chart-card')).not.toBeNull()
    expect(document.querySelector('.projection-view-intro')).toBeNull()
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/pages/ProjectionPage.test.tsx -t "lede|footer"`
Expected: 3 FAIL — `warning.closest('.chart-lede')` is null; the footer lacks the method sentence;
`.projection-view-intro` still exists.

- [ ] **Step 3: Move the prose into the ChartCard slots**

In `src/pages/ProjectionPage.tsx`, replace lines 136–139

```tsx
                  footer={<p className="drill-hint">{display.display_dollars === 'future' ? 'Future dollars include the modeled price inflation in each month; the target rises by the same factor.' : `Today's dollars express buying power at ${formatMonth(data.start_month)}.`} Inputs and headline targets stay in that starting dollar basis. Growth only excludes contributions. {log ? 'The log axis omits values at or below zero.' : ''}</p>} />
                <p className="projection-method-note">The central line uses a constant assumed return; simulated paths vary around it. Identical assumptions reuse the same samples for a stable comparison.</p>
                {unknownPinInflation && <p className="projection-method-note">A pinned scenario has no inflation assumption, so its future-dollar line is unavailable. Its starting-dollar results remain in the comparison table.</p>}
                {data.warnings.length > 0 && <div className="projection-warnings">{data.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
```

with

```tsx
                  // Advisory sentences about what the model ran with — the tax-warnings register:
                  // nothing failed, so never an error banner; the card's own muted header strip.
                  lede={data.warnings.length > 0 ? data.warnings.map((warning) => <p key={warning}>{warning}</p>) : undefined}
                  footer={<p className="drill-hint">{display.display_dollars === 'future' ? 'Future dollars include the modeled price inflation in each month; the target rises by the same factor.' : `Today's dollars express buying power at ${formatMonth(data.start_month)}.`} Inputs and headline targets stay in that starting dollar basis. Growth only excludes contributions. {log ? 'The log axis omits values at or below zero. ' : ''}The central line uses a constant assumed return; simulated paths vary around it. Identical assumptions reuse the same samples for a stable comparison.{unknownPinInflation ? ' A pinned scenario has no inflation assumption, so its future-dollar line is unavailable. Its starting-dollar results remain in the comparison table.' : ''}</p>} />
```

(Only the `footer=` line and the new `lede=` line remain; the three paragraphs below the card are
gone. The `// …` comment above `lede=` sits inside the JSX props list, where `//` comments are legal.)

- [ ] **Step 4: The trend intro becomes the lede**

Replace the whole `return` of `src/components/projection/ProjectionTrendPanel.tsx` (lines 31–45) with:

```tsx
  return <ChartCard title="Net worth over time (projected)"
    hint="Every snapshot as dots with a quadratic best-fit extended forward. This explores historical momentum rather than modeling a financial plan. Log axis: equal steps are equal multiples."
    lede="An exploratory fit of past net worth. Its curve does not use your contribution, spending, or retirement assumptions."
    ariaLabel={fit === null ? 'Net worth history as dots, on a log scale' : `Net worth history with a fitted trend extended ${years} years forward, on a log scale`}
    option={option} error={error} busy={history === null && error === null}
    empty="Not enough monthly snapshots to chart yet." exportName="net-worth-trend"
    csv={history ? () => netWorthProjectionCsv(history, fit, startMonth, years) : undefined} height={430} zoomable
    onLegendChange={setLegend}
    actions={error ? <button className="button" onClick={() => setRetry((value) => value + 1)}>Retry history</button> : undefined}
    controls={<Segmented variant="toggle" size="sm" ariaLabel="Trend span" options={SPANS.map((value) => ({ value: String(value), label: `${value}Y` }))}
      value={String(years)} onChange={(value) => setYears(Number(value))} />}
    footer={<p className="drill-hint">{fit === null ? 'The polynomial trendline needs at least three snapshots — showing the history alone.'
      : `Second-degree polynomial best-fit over every monthly net-worth snapshot, extended ${years} years.`} Months at or below $0 cannot be shown on this log axis.</p>} />
```

- [ ] **Step 5: Delete the orphan CSS, style the multi-paragraph lede**

In `src/pages/ProjectionPage.css` delete lines 5–23 (the `.projection-warnings` comment and its two
blocks) and line 50 (`.projection-method-note, .projection-view-intro { … }`). In their place (top
of the file, after the header comment) add:

```css
/* The warnings lede is one <p> per sentence inside panels.css's .chart-lede strip. */
.projection-page .chart-lede p { margin: 0 0 0.25rem; }
```

- [ ] **Step 6: Run the page and trend tests**

Run: `npx vitest run src/pages/ProjectionPage.test.tsx src/components/projection`
Expected: PASS (all). If `npx tsc -b` complains that `formatMonth` is unused anywhere, it is not —
the footer still calls it; nothing else changes imports here.

- [ ] **Step 7: Commit**

```bash
git add src/pages/ProjectionPage.tsx src/pages/ProjectionPage.css src/components/projection/ProjectionTrendPanel.tsx src/pages/ProjectionPage.test.tsx
git commit -m "feat(projection): method note, warnings and trend intro live inside their chart cards"
```

---

### Task 4: The compare card carries the fine print; the table, the pin box and the preset fit their words

**Files:**
- Modify: `src/components/projection/ScenarioPanel.tsx:228-243,272-289`
- Modify: `src/pages/ProjectionPage.tsx:11,145-152`
- Modify: `src/pages/ProjectionPage.css` (compare rules, preset rule, collapsed rule)
- Modify: `src/sandbox/sandbox.css:52-54`
- Test: `src/pages/ProjectionPage.test.tsx`, `src/components/projection/ScenarioPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append inside `describe('ProjectionPage — surface polish …')` in `src/pages/ProjectionPage.test.tsx`:

```tsx
  it('keeps the assumptions fine print in the compare card, out of the knobs column', async () => {
    renderPage()
    await loaded()
    const compare = document.querySelector('.projection-comparisons') as HTMLElement
    expect(within(compare).getByText(/same random samples/)).toBeTruthy()
    expect(within(compare).getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings')
    // The household has two people in the fixture, so the retirement paragraph is there too.
    expect(within(compare).getByText(/Blank means that person works for the whole horizon/)).toBeTruthy()
    const knobs = document.getElementById('projection-assumptions') as HTMLElement
    expect(within(knobs).queryByText(/same random samples/)).toBeNull()
    expect(within(knobs).queryByText(/Blank means that person works/)).toBeNull()
  })
```

In `src/components/projection/ScenarioPanel.test.tsx`, extend the budgets test
(`'offers Use my budgets under the annual-spend knob only when the echo carries it…'`, line ~242)
by adding after the `expect(screen.getByText(/12 × the living-category budgets resolved for Sep 2026/)).toBeDefined()` line:

```tsx
    // Button and sentence are flex items of one row, so the sentence wraps as a UNIT under the
    // button in a narrow column instead of breaking mid-clause beside it (audit P-8).
    const sentence = screen.getByText(/12 × the living-category budgets resolved for Sep 2026/)
    expect(sentence.tagName).toBe('SPAN')
    expect(sentence.parentElement?.classList.contains('projection-derived-preset')).toBe(true)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/pages/ProjectionPage.test.tsx src/components/projection/ScenarioPanel.test.tsx -t "fine print|Use my budgets"`
Expected: FAIL — the compare card has no `/same random samples/` text; the sentence's parent is
not `.projection-derived-preset`.

- [ ] **Step 3: Export the hints from ScenarioPanel and stop rendering them in compact mode**

In `src/components/projection/ScenarioPanel.tsx`, replace lines 272–289

```tsx
      {people.length > 0 && (
        // Named only where the boxes are: a roster-less database has no retirement to explain.
        <p className="drill-hint">
          A retirement month drops that person&apos;s CURRENT monthly take-home, payroll
          …
        </p>
      )}
      <p className="drill-hint">
        Enter 5 for 5%. Simulations reuse the same random samples so changes reflect your
        assumptions. Money inputs use today&apos;s dollars at the projection start date. The
        withdrawal rate&apos;s stored value lives in{' '}
        <Link to="/settings">Settings</Link>.
      </p>
```

with

```tsx
      {!compact && <ScenarioHints people={people} />}
```

and add at the end of the file:

```tsx
/** The assumptions' fine print. ScenarioPanel renders it itself only when it stands alone; on the
 *  Projection page (`compact`) the PAGE renders it inside the compare card, so the knobs column
 *  ends at its last control and nothing has to be scrolled past to reach a knob (2026-09-13 polish
 *  spec §12, audit P-2). */
export function ScenarioHints({ people }: { people: PersonOut[] }) {
  return (
    <>
      {people.length > 0 && (
        // Named only where the boxes are: a roster-less database has no retirement to explain.
        <p className="drill-hint">
          A retirement month drops that person&apos;s CURRENT monthly take-home, payroll
          deductions and employer match — the paycheck profile in force today, not a projection
          of it — out of the contribution stream from that month on; whatever is left keeps escalating at the
          contribution-growth rate, so a far-off retirement&apos;s cost is slightly understated,
          since the drop never gets that person&apos;s share of the modelled raises. Spending stays
          a household figure, so the FI target does not move. Blank means that person works for the
          whole horizon.
        </p>
      )}
      <p className="drill-hint">
        Enter 5 for 5%. Simulations reuse the same random samples so changes reflect your
        assumptions. Money inputs use today&apos;s dollars at the projection start date. The
        withdrawal rate&apos;s stored value lives in{' '}
        <Link to="/settings">Settings</Link>.
      </p>
    </>
  )
}
```

(`Link` and `PersonOut` are already imported at the top of the file. Two component exports from one
module is fine under `react-refresh/only-export-components`.)

- [ ] **Step 4: The budgets sentence in its own span**

Still in `ScenarioPanel.tsx`, replace lines 228–243

```tsx
            {budgetAnnual !== null && (
              <span className="projection-derived">
                <button
                  type="button"
                  className="button"
                  disabled={usingBudgets}
                  onClick={() => knob('annual_spend')(budgetAnnual, true)}
                >
                  {usingBudgets
                    ? 'using your budgets'
                    : `Use my budgets · ${formatCurrency(budgetAnnual)}/yr`}
                </button>
                {budgetMonth !== null &&
                  ` 12 × the living-category budgets resolved for ${formatMonth(budgetMonth)}.`}
              </span>
            )}
```

with

```tsx
            {budgetAnnual !== null && (
              // A flex row (ProjectionPage.css): the sentence is its own item and wraps as a unit
              // under the button when the column is narrow (audit P-8).
              <span className="projection-derived projection-derived-preset">
                <button
                  type="button"
                  className="button"
                  disabled={usingBudgets}
                  onClick={() => knob('annual_spend')(budgetAnnual, true)}
                >
                  {usingBudgets
                    ? 'using your budgets'
                    : `Use my budgets · ${formatCurrency(budgetAnnual)}/yr`}
                </button>
                {budgetMonth !== null && (
                  <span>12 × the living-category budgets resolved for {formatMonth(budgetMonth)}.</span>
                )}
              </span>
            )}
```

- [ ] **Step 5: The page renders the hints in the compare card**

In `src/pages/ProjectionPage.tsx`, change the import on line 11 to

```tsx
import ScenarioPanel, { ScenarioHints } from '../components/projection/ScenarioPanel'
```

and replace the compare card (lines 145–152)

```tsx
            <section className="card projection-comparisons" aria-label="Scenario comparisons">
              <h2 className="eyebrow">Compare your scenarios</h2>
              <p className="hint">Money inputs and FI targets below use {formatMonth(data.start_month)} dollars. Each probability uses its own scenario horizon.</p>
              <CompareTable<ProjectionOut> rows={COMPARE_ROWS} baseline={sandbox.baseline} scenario={sandbox.result} valueOf={projectionValue}
                pins={sandbox.pins.map((pin) => ({ id: pin.id, label: pin.label, result: sandbox.pinResults[pin.id] }))}
                onUnpin={sandbox.unpin} caption="Headline figures — baseline against the live scenario and any pins" />
              <PinRow sandbox={sandbox} />
            </section>
```

with

```tsx
            <section className="card projection-comparisons" aria-label="Scenario comparisons">
              <h2 className="eyebrow">Compare your scenarios</h2>
              <p className="hint">Money inputs and FI targets in this table use {formatMonth(data.start_month)} dollars. Each probability uses its own scenario horizon.</p>
              <CompareTable<ProjectionOut> rows={COMPARE_ROWS} baseline={sandbox.baseline} scenario={sandbox.result} valueOf={projectionValue}
                pins={sandbox.pins.map((pin) => ({ id: pin.id, label: pin.label, result: sandbox.pinResults[pin.id] }))}
                onUnpin={sandbox.unpin} caption="Headline figures — baseline against the live scenario and any pins" />
              <PinRow sandbox={sandbox} />
              {/* The assumptions' fine print closes the card (spec §12): the knobs column is controls
                  only, and the sentences about entering them sit beside the figures they produce. */}
              <ScenarioHints people={roster} />
            </section>
```

("below" → "in this table" is the spec's §14 copy rule; the sentence no longer sits above anything.)

- [ ] **Step 6: CSS — table cap, caption, preset row, collapsed assumptions**

In `src/pages/ProjectionPage.css`, replace `.projection-comparisons { margin-top: 20px; }` with:

```css
.projection-comparisons { margin-top: 20px; }
/* Three pins wide is the most this table ever holds (audit P-6): past 900px the figure sat a screen
   away from its label. The caption keeps the table self-describing for assistive tech and reads like
   the page's other captions — left, small, muted — instead of centred across the card. */
.projection-comparisons .compare-table { max-width: 900px; }
.projection-comparisons .compare-table caption {
  caption-side: top;
  padding: 0 0 0.4rem;
  text-align: left;
  font-size: 0.75rem;
  color: var(--muted);
}
/* The budgets preset and its sentence are flex items: the sentence wraps as a UNIT under the button
   when the 350px column is narrow (audit P-8), never "12 × the living-" orphaned beside it. After
   .sandbox-controls .projection-derived above, whose display: block it overrides. */
.sandbox-controls .projection-derived-preset {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.5rem;
}
/* Assumptions hidden → the chart takes the whole width and the collapsed header card sits above it,
   where the reader left the toggle (audit P-9). Scoped to the HEADER's toggle button: the ⓘ hints
   inside the card carry aria-expanded too, and would otherwise collapse the workspace permanently. */
.projection-workspace:has(.sandbox-header-actions > [aria-expanded='false']) { grid-template-columns: 1fr; }
.projection-workspace:has(.sandbox-header-actions > [aria-expanded='false']) .projection-chart-area { position: static; }
.projection-workspace:has(.sandbox-header-actions > [aria-expanded='false']) .projection-assumptions { order: -1; }
```

In `src/sandbox/sandbox.css`, replace lines 52–54

```css
.sandbox-pins .field-input {
  max-width: 220px;
}
```

with

```css
/* "Name this scenario" holds WORDS: the shared .field-input is the right-aligned monospace money
   box, and a label wearing it reads as an amount (audit P-7; CalendarPage.css's select rule). */
.sandbox-pins .field-input {
  max-width: 220px;
  text-align: left;
  font-family: inherit;
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/pages/ProjectionPage.test.tsx src/components/projection src/sandbox`
Expected: PASS — including ScenarioPanel's existing `'states that the seed is fixed and points the
withdrawal rate at Settings'` (its Host mounts the panel non-compact, where the hints still render).

- [ ] **Step 8: Commit**

```bash
git add src/components/projection/ScenarioPanel.tsx src/components/projection/ScenarioPanel.test.tsx src/pages/ProjectionPage.tsx src/pages/ProjectionPage.css src/pages/ProjectionPage.test.tsx src/sandbox/sandbox.css
git commit -m "feat(projection): compare card carries the assumptions fine print; table, caption, pin box and budgets preset fit their words"
```

---

### Task 5: Zero amounts print `$0`; the week gutter reads in over out

**Files:**
- Modify: `src/components/calendar/cashflow.ts:34-41`
- Modify: `src/components/calendar/CalendarGrid.tsx:15,58-66,259-261`
- Modify: `src/components/calendar/CashflowStrip.tsx:25-26`
- Modify: `src/components/calendar/DayDrawer.tsx:7,85-87`
- Modify: `src/pages/CalendarPage.css:306-315`
- Test: `src/components/calendar/cashflow.test.ts`, `CalendarGrid.test.tsx`, `CashflowStrip.test.tsx`, `DayDrawer.test.tsx`

- [ ] **Step 1: Write the failing tests**

`src/components/calendar/cashflow.test.ts` — in `it('formats compact magnitudes and signed compacts with the estimate tilde')`, add after the last `expect`:

```ts
    // A zero is a zero (spec §14): no sign to carry, and an estimate of nothing is not "~".
    expect(signedCompact(0, 'out', true)).toBe('$0')
    expect(signedCompact(0, 'in', false)).toBe('$0')
```

`src/components/calendar/CalendarGrid.test.tsx` — change the import on line 6 to
`import CalendarGrid, { gutterLines, shiftMonth } from './CalendarGrid'` and replace the last two
tests (lines ~162–175) with:

```tsx
  it('every row ends with a Week totals gutter reading in over out, on two lines', () => {
    mount()
    const gutters = screen.getAllByRole('gridcell', { name: 'Week totals' })
    expect(gutters).toHaveLength(5) // September 2026 spans five Sunday-first rows
    const lines = (cell: HTMLElement) =>
      Array.from(cell.querySelectorAll('.cal-gutter-line')).map((line) => line.textContent)
    // The week of Sep 13-19: two deliberate lines, no slash for an 84px track to break in half.
    expect(lines(gutters[2])).toEqual(['+$6.8k', '~−$395'])
    expect(lines(gutters[4])).toEqual(['—']) // Sep 27 - Oct 3: nothing
  })

  it('helpers: shiftMonth clamps to month end; gutterLines prints a zero side as $0', () => {
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-28')
    expect(shiftMonth('2026-03-15', -1)).toBe('2026-02-15')
    expect(shiftMonth('2026-12-31', 1)).toBe('2027-01-31')
    expect(gutterLines(summarize([]))).toEqual(['—'])
    const paydayOnly = [calendarEvent({ date: SEP15, type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' })]
    expect(gutterLines(summarize(paydayOnly))).toEqual(['+$6.8k', '$0'])
  })
```

`src/components/calendar/CashflowStrip.test.tsx` — append inside `describe('CashflowStrip')`:

```tsx
  it('prints a zero estimated leg as $0.00 without the tilde', () => {
    const nothingOwed = calendarEvent({ date: '2026-09-15', type: 'tax_deadline', label: 'Q3', amount: '0.00', direction: 'out', basis: 'estimated' })
    render(<CashflowStrip events={[nothingOwed]} month="2026-09-01" quoteAsOf={null} />)
    const cashOut = screen.getAllByRole('group')[1].textContent ?? ''
    expect(cashOut).toContain('$0.00')
    expect(cashOut).not.toContain('~')
  })
```

`src/components/calendar/DayDrawer.test.tsx` — append inside `describe('DayDrawer')`:

```tsx
  it('wears no est. badge on a zero estimate — an estimate of nothing is just $0', () => {
    render(
      <DayDrawer
        day="2026-09-15"
        events={[calendarEvent({ date: '2026-09-15', type: 'tax_deadline', label: 'Tax deadline — Q3 estimated payment', amount: '0.00', direction: 'out', basis: 'estimated' })]}
        renderDetails={() => null}
        onClose={vi.fn()}
        onAddOnDay={vi.fn()}
      />,
    )
    expect(screen.getByText('$0')).toBeTruthy()
    expect(screen.queryByText('est.')).toBeNull()
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/components/calendar`
Expected: FAIL — `signedCompact(0, 'out', true)` is `'~−$0'`; `gutterLines` is not exported; the
strip prints `~$0.00`; the drawer shows `est.` and `~−$0`.

- [ ] **Step 3: The zero rule in cashflow.ts**

Replace lines 34–41 of `src/components/calendar/cashflow.ts`:

```ts
/** "+$6.8k" · "−$395" · "~+$41.2k" — direction is the sign, the tilde says estimate. A zero is
 *  "$0" whatever its direction or basis (2026-09-13 polish spec §14): there is no sign to carry,
 *  and "~−$0" read as negative money on a deadline where the safe harbor was met (audit C-3). */
export function signedCompact(
  cents: number,
  direction: CalendarDirection,
  estimated: boolean,
): string {
  if (cents === 0) return '$0'
  return `${estimated ? '~' : ''}${SIGN[direction]}${formatCompactCents(cents)}`
}
```

- [ ] **Step 4: Two gutter lines**

In `src/components/calendar/CalendarGrid.tsx` replace lines 58–66

```ts
/** "+$6.8k / −$395" for the week gutter; an em dash when nothing moves. */
export function gutterText(summary: CashSummary): string {
  if (summary.cashIn === 0 && summary.cashOut === 0) return '—'
  return `${signedCompact(summary.cashIn, 'in', summary.estimated.cashIn)} / ${signedCompact(
    summary.cashOut,
    'out',
    summary.estimated.cashOut,
  )}`
}
```

with

```ts
/** The week gutter's lines: cash in over cash out — "+$6.8k" then "−$395" — or a lone em dash when
 *  nothing moves. Two lines, never one string with a slash: the 84px track broke the second token
 *  in half (audit C-2). A zero side prints "$0" (cashflow.ts's rule), so the shape is stable. */
export function gutterLines(summary: CashSummary): string[] {
  if (summary.cashIn === 0 && summary.cashOut === 0) return ['—']
  return [
    signedCompact(summary.cashIn, 'in', summary.estimated.cashIn),
    signedCompact(summary.cashOut, 'out', summary.estimated.cashOut),
  ]
}
```

and the gutter cell (lines 259–261) with

```tsx
          <div role="gridcell" className="cal-gutter" aria-label="Week totals" tabIndex={-1}>
            {gutterLines(weekSummary(events, week)).map((line, index) => (
              <span key={index} className="cal-gutter-line">
                {line}
              </span>
            ))}
          </div>
```

In `src/pages/CalendarPage.css`, replace the `.cal-gutter` block (lines 306–315) with:

```css
/* In over out, two lines that never break (audit C-2); a lone em dash when nothing moves. */
.cal-gutter {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  min-height: 92px;
  padding: 4px 6px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  font-size: 0.7rem;
  color: var(--muted);
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.cal-gutter-line {
  white-space: nowrap;
}
```

(F2 already switched this hairline to `var(--border)`; if the merged file still says
`var(--surface-2)` here, keep whatever F2 left — this task changes layout, not colour. Task 6
changes `min-height` to 76px.)

- [ ] **Step 5: No tilde on a zero total; no est. badge on a zero estimate**

`src/components/calendar/CashflowStrip.tsx`, lines 25–26:

```ts
  // The tilde marks a leg that includes an estimate — unless the leg is nothing (spec §14).
  const money = (cents: number, estimated: boolean) =>
    `${estimated && cents !== 0 ? '~' : ''}${cents < 0 ? '−' : ''}${formatCurrency(fromCents(Math.abs(cents)))}`
```

`src/components/calendar/DayDrawer.tsx`: line 7 becomes
`import { cashLine, summarize, toCents } from './cashflow'` and lines 85–87 become

```tsx
                {event.basis === 'estimated' && event.amount !== null && toCents(event.amount) !== 0 && (
                  <span className="badge">est.</span>
                )}
```

- [ ] **Step 6: Run the calendar component tests**

Run: `npx vitest run src/components/calendar src/components/overview/upNext.test.ts`
Expected: PASS. (`upNext` shares `cashLine`, which already omits zero legs — its line is unchanged.)

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar src/pages/CalendarPage.css
git commit -m "feat(calendar): zero amounts print \$0 with no sign or tilde; the week gutter reads in over out"
```

---

### Task 6: Strip footnotes out of the tile grid; shorter empty weeks; one month name in the scope row

**Files:**
- Modify: `src/components/calendar/CashflowStrip.tsx:70-88`
- Modify: `src/pages/CalendarPage.tsx:16,44,555,~708`
- Modify: `src/pages/CalendarPage.css:15-19,38-44,294-296,306,405-410`
- Test: `src/components/calendar/CashflowStrip.test.tsx`, `src/pages/CalendarPage.test.tsx`

- [ ] **Step 1: Update the strip tests**

In `src/components/calendar/CashflowStrip.test.tsx`, change the import to
`import CashflowStrip, { CashflowNotes } from './CashflowStrip'`, then:

In the first test (`'shows four tiles…'`) replace
`expect(screen.getByText(/quote as of Sep 2, 2026/)).toBeTruthy()` with

```tsx
    // The quote date rides the Vesting tile's own delta line (spec §10) — not a footnote row that
    // occupied a whole track of the tile grid and left the right third empty at 1920 (audit C-7).
    expect(tiles[3]).toContain('quote as of Sep 2, 2026')
    expect(document.querySelector('.cal-strip p')).toBeNull()
```

Replace the third test (`'counts the events whose money cannot be known'`) with:

```tsx
  it('CashflowNotes counts the events whose money cannot be known and names the quote', () => {
    const unknowable = calendarEvent({ date: '2026-09-04', type: 'ex_dividend', label: 'Ex-dividend — NVDA', direction: 'in' })
    render(<CashflowNotes events={[events[0], unknowable]} month="2026-09-01" quoteAsOf="2026-09-02T20:00:00Z" />)
    expect(screen.getByText(/1 event has no knowable amount/)).toBeTruthy()
    expect(screen.getByText('Vest estimates ride the employer quote as of Sep 2, 2026.')).toBeTruthy()
    cleanup()
    render(<CashflowNotes events={[events[0]]} month="2026-09-01" quoteAsOf={null} />)
    expect(document.body.textContent).toBe('')
  })
```

- [ ] **Step 2: Update the page tests that read the month from the dropped heading**

In `src/pages/CalendarPage.test.tsx`:

- Change `import { formatDate, formatMonth } from '../utils/format'` to
  `import { formatDate } from '../utils/format'`.
- After `const url = () => …` add:

```tsx
const monthBox = () => screen.getByLabelText('Jump to month') as HTMLInputElement
/** The month on screen, read from the scope row's month box — the duplicate h2 beside it is gone
 *  (2026-09-13 spec §12, audit C-5). */
const shownMonth = (iso: string) => waitFor(() => expect(monthBox().value).toBe(iso.slice(0, 7)))
```

- Line ~150: `expect(screen.getByRole('heading', { name: formatMonth(PREV) })).toBeTruthy()` →
  `expect(monthBox().value).toBe(PREV.slice(0, 7))`
- Line ~219: `await screen.findByRole('heading', { name: formatMonth('2027-03-01') })` →
  `await shownMonth('2027-03-01')`
- Line ~224: `await screen.findByRole('heading', { name: formatMonth(MONTH) })` → `await shownMonth(MONTH)`
- Line ~572: `await screen.findByRole('heading', { name: formatMonth(NEXT) })` → `await shownMonth(NEXT)`

```bash
grep -n "formatMonth" src/pages/CalendarPage.test.tsx
# expect: no output
```

- [ ] **Step 3: Run to verify the strip tests fail**

Run: `npx vitest run src/components/calendar/CashflowStrip.test.tsx src/pages/CalendarPage.test.tsx`
Expected: CashflowStrip FAIL (`CashflowNotes` is not exported; `.cal-strip p` exists). The page
tests still PASS at this point (the month box already exists).

- [ ] **Step 4: The strip is tiles only; the notes are their own component**

In `src/components/calendar/CashflowStrip.tsx`, replace lines 70–88

```tsx
      <div role="group" aria-label="Vesting">
        <StatTile
          label="Vesting"
          value={money(s.vesting, s.estimated.vesting)}
          evidence={…}
          hint={…}
        />
      </div>
      {quoteAsOf !== null && (
        <p className="drill-hint cal-strip-asof">
          Vest estimates ride the employer quote as of {formatDate(quoteAsOf)}.
        </p>
      )}
      {s.unknown > 0 && (
        <p className="drill-hint cal-strip-unknown">
          {s.unknown} {s.unknown === 1 ? 'event has' : 'events have'} no knowable amount.
        </p>
      )}
    </div>
  )
}
```

with

```tsx
      <div role="group" aria-label="Vesting">
        <StatTile
          label="Vesting"
          value={money(s.vesting, s.estimated.vesting)}
          // The quote the estimates ride, on the tile itself (spec §10): a footnote row in the grid
          // took a whole track and left the right third of the strip empty at 1920 (audit C-7).
          delta={quoteAsOf === null ? undefined : `quote as of ${formatDate(quoteAsOf)}`}
          evidence={receipt('vesting', 'Vesting', 'Gross value of scheduled RSU vests using the employer quote shown. Withholding and sell-to-cover reduce the amount available to you; vest value is not cash in.')}
          hint={`Gross value of the month's RSU vests at the latest employer quote${asOf}; sell-to-cover is taken before it reaches you.`}
        />
      </div>
    </div>
  )
}

/** The strip's two footnotes, rendered by the PAGE inside the calendar card's footer (after the
 *  source-health list) rather than between the tiles and the card: prose belongs inside a section
 *  boundary (spec §10), and the audit's orphan check on this page must find nothing. Renders
 *  nothing when there is nothing to say. */
export function CashflowNotes({
  events,
  month,
  quoteAsOf,
}: {
  events: CalendarEvent[]
  month: string
  quoteAsOf: string | null
}) {
  const s = monthSummary(events, month)
  return (
    <>
      {quoteAsOf !== null && (
        <p className="drill-hint cal-note">
          Vest estimates ride the employer quote as of {formatDate(quoteAsOf)}.
        </p>
      )}
      {s.unknown > 0 && (
        <p className="drill-hint cal-note">
          {s.unknown} {s.unknown === 1 ? 'event has' : 'events have'} no knowable amount.
        </p>
      )}
    </>
  )
}
```

(The Vesting tile's `evidence` and `hint` lines are the existing ones — keep them verbatim.)

- [ ] **Step 5: The page renders the notes in the card and drops the duplicate month title**

In `src/pages/CalendarPage.tsx`:

- Line 16: `import CashflowStrip, { CashflowNotes } from '../components/calendar/CashflowStrip'`
- Line 44: `import { formatCurrency, formatDate } from '../utils/format'` (`formatMonth` has no other
  use in the page once the `h2` goes — `noUnusedLocals` would fail on it).
- Delete line 555: `<h2 className="cal-title">{formatMonth(month)}</h2>`
- After `<SourceHealth sources={shown.sources} />` (line ~708) insert

```tsx
                <CashflowNotes events={visible} month={month} quoteAsOf={shown.quote_as_of} />
```

- [ ] **Step 6: CSS — cells, rows, gutter, notes; the two dead rules go**

In `src/pages/CalendarPage.css`:

- Delete lines 15–19 (`.cal-title { … }`).
- `.cal-day` (line 39): `min-height: 92px;` → `min-height: 76px;` and add a comment above the
  block: `/* 76px cells with rows that GROW for busy weeks (below): six rows of 92px for seven events was
  a 587px card of empty boxes (audit C-6). */`
- The v2 `.cal-grid` block (lines ~294–296) becomes

```css
.cal-grid {
  grid-template-columns: repeat(7, minmax(0, 1fr)) 84px;
  grid-auto-rows: minmax(76px, auto);
}
```

- `.cal-gutter` (Task 5's block): `min-height: 92px;` → `min-height: 76px;`
- Delete the block at lines ~405–410:

```css
/* Both footnotes are full-width rows under the tiles, not a fifth tile. */
.cal-strip-asof,
.cal-strip-unknown {
  grid-column: 1 / -1;
  margin: 0;
}
```

and put in its place

```css
/* The strip's footnotes, now the calendar card's last lines under the source-health list. */
.cal-note {
  margin: 0.5rem 0 0;
}
```

- [ ] **Step 7: Run the calendar tests**

Run: `npx vitest run src/components/calendar src/pages/CalendarPage.test.tsx`
Expected: PASS (all).

- [ ] **Step 8: Commit**

```bash
git add src/components/calendar/CashflowStrip.tsx src/components/calendar/CashflowStrip.test.tsx src/pages/CalendarPage.tsx src/pages/CalendarPage.css src/pages/CalendarPage.test.tsx
git commit -m "feat(calendar): strip footnotes leave the tile grid for the card footer; 76px weeks that grow; one month name in the scope row"
```

---

### Task 7: `AddEventForm` is its own component (pure extraction)

**Files:**
- Create: `src/components/calendar/AddEventForm.tsx`
- Modify: `src/pages/CalendarPage.tsx` (imports, `Fields` → `EventFields`, the inline form body)
- Test: `src/pages/CalendarPage.test.tsx` (unchanged — must stay green)

- [ ] **Step 1: Create the component**

`src/components/calendar/AddEventForm.tsx`:

```tsx
import type { RefObject } from 'react'
import type { CalendarDirection, CalendarRecurrence, PersonOut } from '../../types/api'
import AmountInput from '../AmountInput'
import { FeedBanner } from '../shell/Feed'

/** The custom-event form's boxes. The form IS the body a save sends, so every field the PATCH
 *  replaces has a box here even when the form does not show it (a one-off's `until`). '' = unset. */
export interface EventFields {
  date: string
  label: string
  detail: string
  person: string // '' = Household; a tag is always deliberate
  amount: string
  direction: CalendarDirection
  recurrence: CalendarRecurrence
  until: string
}

export const EMPTY_FIELDS: EventFields = {
  date: '',
  label: '',
  detail: '',
  person: '',
  amount: '',
  direction: 'neutral',
  recurrence: 'none',
  until: '',
}

export interface AddEventFormProps {
  mode: 'add' | 'edit'
  fields: EventFields
  onField: <K extends keyof EventFields>(key: K) => (value: EventFields[K]) => void
  /** Primary first, then by id — the page orders them. One person → no picker. */
  people: PersonOut[]
  error: string | null
  saving: boolean
  onSave: () => void
  onCancel: () => void
  /** The date box, so the page can land the caret in it when the form opens. */
  dateRef: RefObject<HTMLInputElement | null>
  /** Where the form stands: the shell's detail panel (fluid two-up columns) or the page's card. */
  hosted: 'panel' | 'card'
}

// The add/edit form (2026-09-03 calendar spec §8), lifted out of the page so the SAME element can
// stand in the shared detail panel or in the fallback card (2026-09-13 polish spec §12). It owns no
// state: the fields, the error and every verb are the page's; this is the boxes and two buttons.
export default function AddEventForm({
  mode,
  fields,
  onField,
  people,
  error,
  saving,
  onSave,
  onCancel,
  dateRef,
  hosted,
}: AddEventFormProps) {
  return (
    <>
      <FeedBanner error={error} />
      <div className={`cal-form${hosted === 'panel' ? ' cal-form-panel' : ''}`}>
        <label className="cal-form-field">
          Date
          <input
            type="date"
            ref={dateRef}
            className="field-input cal-form-input"
            value={fields.date}
            onChange={(e) => onField('date')(e.target.value)}
          />
        </label>
        <label className="cal-form-field">
          Title
          <input
            className="field-input cal-form-input"
            value={fields.label}
            maxLength={120}
            onChange={(e) => onField('label')(e.target.value)}
          />
        </label>
        <label className="cal-form-field cal-form-note">
          Note (optional)
          <input
            className="field-input cal-form-input"
            value={fields.detail}
            maxLength={300}
            onChange={(e) => onField('detail')(e.target.value)}
          />
        </label>
        {people.length > 1 && (
          <label className="cal-form-field">
            Person
            <select
              className="field-input cal-form-input"
              value={fields.person}
              onChange={(e) => onField('person')(e.target.value)}
            >
              <option value="">Household</option>
              {people.map((person) => (
                <option key={person.id} value={String(person.id)}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="cal-form-field">
          Amount (optional)
          <AmountInput
            kind="money"
            className="cal-form-input"
            value={fields.amount}
            onValueChange={onField('amount')}
            aria-label="Amount (optional)"
            placeholder="$0.00"
          />
        </label>
        <label className="cal-form-field">
          Direction
          <select
            className="field-input cal-form-input"
            value={fields.direction}
            onChange={(e) => onField('direction')(e.target.value as CalendarDirection)}
          >
            <option value="neutral">No direction</option>
            <option value="in">Money in</option>
            <option value="out">Money out</option>
          </select>
        </label>
        <label className="cal-form-field">
          Repeats
          <select
            className="field-input cal-form-input"
            value={fields.recurrence}
            onChange={(e) => onField('recurrence')(e.target.value as CalendarRecurrence)}
          >
            <option value="none">Never</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </label>
        {fields.recurrence !== 'none' && (
          <label className="cal-form-field">
            Until (optional)
            <input
              type="date"
              className="field-input cal-form-input"
              value={fields.until}
              onChange={(e) => onField('until')(e.target.value)}
            />
          </label>
        )}
        <button
          type="button"
          className="button button-primary"
          disabled={saving || fields.label.trim() === '' || fields.date === ''}
          onClick={onSave}
        >
          {mode === 'add' ? 'Save event' : 'Save changes'}
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Use it from the page**

In `src/pages/CalendarPage.tsx`:

1. Imports — remove `import AmountInput from '../components/AmountInput'` and
   `import { FeedBanner } from '../components/shell/Feed'`; add
   `import AddEventForm, { EMPTY_FIELDS, type EventFields } from '../components/calendar/AddEventForm'`
   (alphabetically before `CalendarGrid`); drop `CalendarDirection` and `CalendarRecurrence` from
   the `import type { … } from '../types/api'` list (they now live in the form module and the page
   no longer names them).
2. Delete the `interface Fields { … }` and `const EMPTY_FIELDS: Fields = { … }` blocks (lines ~65–84).
3. `const [fields, setFields] = useState<Fields>(EMPTY_FIELDS)` → `useState<EventFields>(EMPTY_FIELDS)`.
4. The `field` helper: `<K extends keyof Fields>(key: K) => (value: Fields[K]) =>` →
   `<K extends keyof EventFields>(key: K) => (value: EventFields[K]) =>`.
5. Replace the inline form card (from `{form !== null && (` down to its closing `)}` — the whole
   `section.card.span-12` with the `.cal-form` div, lines ~577–687) with:

```tsx
              {form !== null && (
                <section className="card span-12">
                  <h2 className="eyebrow">{form.mode === 'add' ? 'Add event' : 'Edit event'}</h2>
                  <AddEventForm
                    mode={form.mode}
                    fields={fields}
                    onField={field}
                    people={orderedPeople}
                    error={formError}
                    saving={saving}
                    onSave={saveForm}
                    onCancel={() => setForm(null)}
                    dateRef={formDateRef}
                    hosted="card"
                  />
                </section>
              )}
```

- [ ] **Step 3: Type-check and run the page tests**

Run: `npx tsc -b && npx vitest run src/pages/CalendarPage.test.tsx`
Expected: tsc clean (if it names an unused import, remove exactly that one); all page tests PASS
unchanged — the add, edit, arrival and land-on-save flows are behaviourally identical.

- [ ] **Step 4: Commit**

```bash
git add src/components/calendar/AddEventForm.tsx src/pages/CalendarPage.tsx
git commit -m "refactor(calendar): AddEventForm is its own component, ready to stand in the detail panel"
```

---

### Task 8: Add event opens in the shared detail panel (inline card without a provider)

**Files:**
- Modify: `src/pages/CalendarPage.tsx` (imports, `FormState`, panel plumbing, focus, render)
- Modify: `src/pages/CalendarPage.css` (panel form fit)
- Test: `src/pages/CalendarPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/pages/CalendarPage.test.tsx`:

1. Change the RTL import to `import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'`.
2. Below the existing `vi.mock('../api/household', …)` line add the panel mock. `undefined` means
   "the real hook" (null without a provider — today's behaviour for every existing test); a test that
   wants to watch the requests sets an API object:

```tsx
type PanelApi = {
  activeId: string | null
  mode: 'dock' | 'overlay' | 'expanded'
  open: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  back: ReturnType<typeof vi.fn>
  setMode: ReturnType<typeof vi.fn>
}
const panelMock = vi.hoisted(() => ({ api: undefined as PanelApi | null | undefined }))
vi.mock('../components/details/DetailPanelProvider', async (importOriginal) => {
  const original = await importOriginal<typeof import('../components/details/DetailPanelProvider')>()
  return {
    ...original,
    useDetailPanel: () => (panelMock.api === undefined ? original.useDetailPanel() : panelMock.api),
  }
})
import DetailPanelProvider from '../components/details/DetailPanelProvider'
```

3. In the file's `afterEach(cleanup)` line, change to
   `afterEach(() => { cleanup(); panelMock.api = undefined })`.
4. Append a new describe at the end of the file:

```tsx
describe('CalendarPage — Add event in the shared detail panel (2026-09-13 spec §12)', () => {
  it('asks the shell panel for the form — id calendar-add, titled with the day — and mounts no inline card', async () => {
    const open = vi.fn()
    const close = vi.fn()
    panelMock.api = { activeId: null, mode: 'dock', open, update: vi.fn(), close, back: vi.fn(), setMode: vi.fn() }
    const { unmount } = renderPage(fixtureEvents(), `/calendar?add=1&date=${DAY_16}`)
    await screen.findByRole('grid')
    await waitFor(() => expect(open).toHaveBeenCalled())
    expect(open.mock.calls.at(-1)?.[0]).toMatchObject({ id: 'calendar-add', title: `Add event on ${formatDate(DAY_16)}` })
    // No card above the grid: the grid stays where it was (audit C-4 measured +206px).
    expect(document.querySelector('.card .cal-form')).toBeNull()
    expect((screen.getByRole('grid').closest('.card') as HTMLElement).previousElementSibling).toBeNull()
    await waitFor(() => expect(url()).toBe('/calendar'))
    // Leaving the page takes the panel with it.
    unmount()
    expect(close).toHaveBeenCalledWith('calendar-add')
  })

  it('hosts the form in a real provider: prefilled, focused, Cancel closes it', async () => {
    vi.mocked(fetchCalendar).mockResolvedValue(payload())
    render(
      <MemoryRouter>
        <DetailPanelProvider>
          <ToastProvider>
            <CalendarPage />
          </ToastProvider>
        </DetailPanelProvider>
      </MemoryRouter>,
    )
    await screen.findByRole('grid')
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add event' })
    const date = within(dialog).getByLabelText('Date') as HTMLInputElement
    expect(date.value).toBe(MONTH)
    // Exactly one form, and it is the panel's.
    expect(document.querySelectorAll('.cal-form')).toHaveLength(1)
    expect(dialog.contains(document.querySelector('.cal-form'))).toBe(true)
    // Focus lands in the panel a frame after it opens (the provider focuses the aside first).
    await waitFor(() => expect(document.activeElement).toBe(date))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('saves from the panel and closes it, landing on the saved day', async () => {
    vi.mocked(fetchCalendar).mockResolvedValue(payload())
    vi.mocked(createCustomEvent).mockResolvedValue({ id: 99, date: DAY_16, label: 'Trip', detail: null, person_id: null, amount: null, direction: 'neutral', recurrence: 'none', until: null })
    render(
      <MemoryRouter>
        <DetailPanelProvider>
          <ToastProvider>
            <CalendarPage />
          </ToastProvider>
        </DetailPanelProvider>
      </MemoryRouter>,
    )
    await screen.findByRole('grid')
    fireEvent.click(screen.getByRole('button', { name: `Open ${formatDate(DAY_16)}` }))
    fireEvent.click(screen.getByRole('button', { name: `Add event on ${formatDate(DAY_16)}` }))
    const dialog = await screen.findByRole('dialog', { name: `Add event on ${formatDate(DAY_16)}` })
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Trip' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save event' }))
    await waitFor(() => expect(createCustomEvent).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(cell(DAY_16).getAttribute('tabindex')).toBe('0')
  })

  it('falls back to the inline card when the shell provides no panel', async () => {
    renderPage()
    await screen.findByRole('grid')
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
    expect(screen.getByRole('heading', { name: 'Add event' })).toBeTruthy()
    expect(document.querySelector('.card .cal-form')).not.toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/pages/CalendarPage.test.tsx -t "detail panel"`
Expected: the first three FAIL (`open` never called; no dialog); the fallback test passes already.

- [ ] **Step 3: Host the form in the panel**

In `src/pages/CalendarPage.tsx`:

1. Imports: line 1 → `import { useCallback, useEffect, useMemo, useRef, useState } from 'react'`; add
   `import { createPortal } from 'react-dom'` after it; add
   `import { useDetailPanel } from '../components/details/DetailPanelProvider'` (after the
   `calendarView` import, before `PageFrame`).
2. Replace `type FormState = { mode: 'add' } | { mode: 'edit'; id: number } | null` with

```ts
/** `day` is the day the form was opened FOR (the drawer's "Add event on …", ?add=1&date=) — the
 *  panel's title; the date box itself is `fields.date` and may be edited away from it. */
type FormState = { mode: 'add'; day?: string } | { mode: 'edit'; id: number } | null
/** One surface for add and edit: reopening the id updates the panel instead of stacking a second. */
const FORM_PANEL_ID = 'calendar-add'
```

3. After `const toast = useToast()` inside the component add:

```tsx
  // The add/edit form's surface (2026-09-13 polish spec §12): the shell's detail panel when the
  // shell provides one — the grid narrows beside the dock instead of dropping 206px under a new
  // card (audit C-4) — and the old inline card in tests and embeds, where useDetailPanel() is null.
  const panel = useDetailPanel()
  const hasPanel = panel !== null
  const openPanel = panel?.open
  const closePanel = panel?.close
  // The panel receives a STABLE host node; the form itself is portaled into that node from this
  // tree, so every keystroke re-renders the form in place without reopening the panel (ChartCard's
  // detail-host idiom).
  const [formHost] = useState(() => document.createElement('div'))
  const formHostMount = useMemo(
    () => (
      <div
        ref={(node) => {
          if (node && formHost.parentNode !== node) node.appendChild(formHost)
          else if (!node) formHost.parentNode?.removeChild(formHost)
        }}
      />
    ),
    [formHost],
  )
```

4. In `openAddForm`, `setForm({ mode: 'add' })` → `setForm({ mode: 'add', day })`.

5. Replace the focus effect

```tsx
  // A DOM call, no state: the form's first field is mounted by the time this runs, and
  // tick 0 is the initial render, where there is no form and nothing to steal focus from.
  useEffect(() => {
    if (formTick > 0) formDateRef.current?.focus()
  }, [formTick])
```

with

```tsx
  // The caret lands in the date box when the form opens; tick 0 is the initial render, where there
  // is no form. Inline, the box is mounted by the time this runs. In the panel it is attached only
  // once the provider has rendered the aside — and the provider's own effect then focuses the
  // aside — so the move waits a frame and runs after it. A DOM call, no state.
  const formShown = form !== null && (panel === null || panel.activeId === FORM_PANEL_ID)
  useEffect(() => {
    if (formTick === 0 || !formShown) return
    if (!hasPanel) {
      formDateRef.current?.focus()
      return
    }
    const frame = requestAnimationFrame(() => formDateRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [formTick, formShown, hasPanel])

  // The panel follows the form: open (or retitle) it while a form is up, close it when the form
  // goes. Save and Cancel end here; a close the panel itself started (×, Escape) has already
  // cleared the form through onClose, and closePanel finds nothing to close.
  const formTitle =
    form === null
      ? null
      : form.mode === 'edit'
        ? 'Edit event'
        : form.day === undefined
          ? 'Add event'
          : `Add event on ${formatDate(form.day)}`
  useEffect(() => {
    if (openPanel === undefined || closePanel === undefined) return
    if (formTitle === null) {
      closePanel(FORM_PANEL_ID)
      return
    }
    openPanel({
      id: FORM_PANEL_ID,
      title: formTitle,
      content: formHostMount,
      // Where focus lands when the panel closes: the header's Add event button — a landmark that
      // outlives whichever button opened the form (the drawer's unmounts with the drawer).
      returnTo: addEventBtnRef.current,
      onClose: () => setForm(null),
    })
  }, [formTitle, openPanel, closePanel, formHostMount])
  // Leaving the page takes the form's panel with it.
  useEffect(() => () => closePanel?.(FORM_PANEL_ID), [closePanel])
```

6. After `const field = …` (the field helper) add the one form element both hosts render:

```tsx
  const eventForm =
    form === null ? null : (
      <AddEventForm
        mode={form.mode}
        fields={fields}
        onField={field}
        people={orderedPeople}
        error={formError}
        saving={saving}
        onSave={saveForm}
        onCancel={() => setForm(null)}
        dateRef={formDateRef}
        hosted={hasPanel ? 'panel' : 'card'}
      />
    )
```

7. Replace Task 7's inline card block with the fallback-only version:

```tsx
              {form !== null && !hasPanel && (
                <section className="card span-12">
                  <h2 className="eyebrow">{form.mode === 'add' ? 'Add event' : 'Edit event'}</h2>
                  {eventForm}
                </section>
              )}
```

8. After the `</PageFrame>` closing tag, before `{drawerDay !== null && (`, add:

```tsx
      {form !== null && hasPanel && createPortal(eventForm, formHost)}
```

- [ ] **Step 4: CSS — the form in a 400px dock**

Append to `src/pages/CalendarPage.css`, after the `.cal-form select.cal-form-input` block (line ~288):

```css
/* The same form inside the shell's detail panel (2026-09-13 spec §12): fluid two-up columns in a
   ~400px dock instead of the card's fixed 170px boxes, the note on a row of its own. */
.cal-form-panel .cal-form-field {
  flex: 1 1 160px;
}

.cal-form-panel .cal-form-field .cal-form-input {
  width: 100%;
}

.cal-form-panel .cal-form-note {
  flex-basis: 100%;
}
```

- [ ] **Step 5: Run the page tests, type-check, lint**

Run: `npx vitest run src/pages/CalendarPage.test.tsx && npx tsc -b && npx eslint src/pages/CalendarPage.tsx src/components/calendar`
Expected: all tests PASS (the four new ones and every existing add/edit test, which run without a
provider and therefore on the inline card); tsc and eslint clean. If eslint's `react-hooks/exhaustive-deps`
asks for `panel` in the focus effect, keep `hasPanel` — it is the boolean the effect reads — and
make sure `formShown` is computed from `panel` outside the effect exactly as above.

- [ ] **Step 6: Commit**

```bash
git add src/pages/CalendarPage.tsx src/pages/CalendarPage.css src/pages/CalendarPage.test.tsx
git commit -m "feat(calendar): Add event opens in the shared detail panel — the grid stays put; inline card without a provider"
```

---

### Task 9: Settings bands hidden, cards start-aligned, Categories wide with sticky row actions

**Files:**
- Modify: `src/pages/SettingsPage.tsx:275,281,286,351,357`
- Modify: `src/pages/SettingsPage.css`
- Modify: `src/components/settings/settings.css:506-527`
- Modify: `src/components/settings/HouseholdCard.tsx:120`
- Modify: `src/components/settings/CategoriesCard.tsx` (span, a `CategoriesTable` child with `useScrollEdges`)
- Test: `src/pages/SettingsPage.test.tsx`, `src/components/settings/CategoriesCard.test.tsx`, `HouseholdCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

`src/pages/SettingsPage.test.tsx` — in `'makes every settings task reachable while showing one panel at a time'`
(line ~941), after `expect(el(heading).classList.contains('card')).toBe(false)` add:

```tsx
      // The band duplicates the selected tab's label (2026-09-13 spec §3, audit S-1): hidden from
      // sight, kept for assistive tech and as the legacy #sec-* anchor.
      expect(el(heading).classList.contains('visually-hidden')).toBe(true)
```

`src/components/settings/CategoriesCard.test.tsx` — append (the file's other tests render the card
bare, with `fetchCategories` mocked in its `beforeEach`; the fixture rows give the table its rows):

```tsx
it('is a span-8 card whose table scroller carries the row-actions column (2026-09-13 spec §7)', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')
  const card = document.getElementById('categories') as HTMLElement
  expect(card.classList.contains('span-8')).toBe(true)
  expect(card.querySelector('.settings-scroll')).not.toBeNull()
  expect(card.querySelectorAll('td.row-actions').length).toBeGreaterThan(0)
})
```

`src/components/settings/HouseholdCard.test.tsx` — append ("Add member" is the card's add button,
`HouseholdCard.tsx:202`):

```tsx
it('is a span-4 card: a two-field form beside the wide categories table (2026-09-13 spec §7)', async () => {
  render(<HouseholdCard onPeopleChange={vi.fn()} />)
  await screen.findByRole('button', { name: 'Add member' })
  expect((document.getElementById('household') as HTMLElement).classList.contains('span-4')).toBe(true)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/pages/SettingsPage.test.tsx src/components/settings/CategoriesCard.test.tsx src/components/settings/HouseholdCard.test.tsx -t "visually-hidden|span-8|span-4|reachable"`
Expected: FAIL on the three new assertions.

- [ ] **Step 3: Hide the bands**

In `src/pages/SettingsPage.tsx` change each of the five band lines:

```tsx
<h2 className="settings-section visually-hidden" id="sec-household">Household</h2>
<h2 className="settings-section visually-hidden" id="sec-planning">Planning</h2>
<h2 className="settings-section visually-hidden" id="sec-account">Account</h2>
<h2 className="settings-section visually-hidden" id="sec-integrations">Integrations</h2>
<h2 className="settings-section visually-hidden" id="sec-data">Data</h2>
```

In `src/components/settings/settings.css` replace lines 506–527 (the `/* --- section bands and the chip rail … */`
comment, the `.card-grid > .settings-section` block and its `:first-child` block) with:

```css
/* --- section bands (2026-09-06 spec §3.1, hidden 2026-09-13 spec §3) --- */

/* The band repeats the selected tab's label, so it is .visually-hidden (panels.css) — kept in the
   DOM for assistive tech and as the legacy #sec-* anchor. What remains is the anchor's inset: a
   jump scrolls the band to the top of the scrollport, which the sticky strip covers; PageFrame
   MEASURES the strip into --sticky-inset on .page-frame-body and the band inherits it, so it lands
   below the strip instead of under it (settingsCss.test.ts pins this declaration). */
.card-grid > .settings-section {
  scroll-margin-top: calc(var(--sticky-inset, 0px) + 0.75rem);
}
```

- [ ] **Step 4: Start-aligned pairs; the span swap**

Append to `src/pages/SettingsPage.css`:

```css
/* A short card ends where its content ends (2026-09-13 spec §12, audit S-4): the panel grid
   stretched every span-6 pair to its taller sibling — Household stood 322px of empty card beside
   Categories. The void is page background now, which reads as "short card", not "empty card". */
.settings-page .card-grid {
  align-items: start;
}
```

`src/components/settings/HouseholdCard.tsx` line 120: `<section className="card span-6" id="household">` →
`<section className="card span-4" id="household">`.

- [ ] **Step 5: Categories — `span-8`, a table child that owns the scroller and its edges**

In `src/components/settings/CategoriesCard.tsx`:

1. Imports: line 1 → `import { useEffect, useRef, useState } from 'react'` (unchanged — `useRef` is
   already there); add `import { useScrollEdges } from '../useScrollEdges'` after the `Segmented` import.
2. Line 141: `<section className="card span-6" id="categories">` → `<section className="card span-8" id="categories">`.
3. Replace the `<div className="settings-scroll"> … </div>` block (lines ~190–271, the scroller with
   the whole `<table className="data-table category-table">`) with

```tsx
              <CategoriesTable
                categories={categories}
                busy={busy}
                editingId={editingId}
                onEdit={(category) => {
                  setEditingId(category.id)
                  setFormError(null)
                  setForm({ name: category.name, sort_order: String(category.sort_order) })
                }}
                onToggleActive={toggleActive}
                onKind={setKind}
                onRemove={remove}
              />
```

4. Add at the end of the file:

```tsx
/** The scrolling table, its own component so `useScrollEdges` sees a scroller that EXISTS on its
 *  first commit: the card mounts before its rows land, and a hook bound to a ref that is still null
 *  then would never observe the element. The scroller flags `data-scroll-more` (panels.css masks
 *  the clipped edge) and the last column is sticky, so Delete is never hidden behind a scrollbar
 *  that only appears on hover (2026-09-13 spec §7, audit S-3). */
function CategoriesTable({
  categories,
  busy,
  editingId,
  onEdit,
  onToggleActive,
  onKind,
  onRemove,
}: {
  categories: CategoryOut[]
  busy: boolean
  editingId: number | null
  onEdit: (category: CategoryOut) => void
  onToggleActive: (category: CategoryOut) => void
  onKind: (category: CategoryOut, next: CategoryKind) => void
  onRemove: (category: CategoryOut) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useScrollEdges(scrollRef)
  return (
    <div className="settings-scroll" ref={scrollRef}>
      <table className="data-table category-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Kind</th>
            <th className="num">Sort</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {categories.map((category) => (
            <tr key={category.id} className={category.id === editingId ? 'is-editing' : undefined}>
              <td>{category.name}</td>
              <td>
                <Segmented
                  variant="toggle"
                  size="sm"
                  ariaLabel={`Kind for ${category.name}`}
                  // disabled while a request is in flight, like the row's other controls: a second
                  // PATCH would race the reload that follows the first and the picker would flicker back.
                  options={KINDS.map((k) => ({ ...k, disabled: busy }))}
                  value={category.kind}
                  onChange={(next) => onKind(category, next)}
                />
              </td>
              <td className="num">{category.sort_order}</td>
              <td>
                <span className="badge">{category.is_active ? 'Active' : 'Retired'}</span>
              </td>
              <td className="row-actions">
                <button type="button" className="button" aria-label={`Edit ${category.name}`} disabled={busy} onClick={() => onEdit(category)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="button"
                  aria-label={category.is_active ? `Retire ${category.name}` : `Restore ${category.name}`}
                  disabled={busy}
                  onClick={() => onToggleActive(category)}
                >
                  {category.is_active ? 'Retire' : 'Restore'}
                </button>
                <button type="button" className="button" aria-label={`Delete ${category.name}`} disabled={busy} onClick={() => onRemove(category)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

If `useScrollEdges` turns out to take something other than a `RefObject` (Preconditions), adapt
this one call and say so in the commit body.

- [ ] **Step 6: Run the tests, type-check**

Run: `npx vitest run src/pages/SettingsPage.test.tsx src/components/settings && npx tsc -b`
Expected: PASS (all — including `settingsCss.test.ts`, which pins the band's `scroll-margin-top`
declaration that Step 3 kept), tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/pages/SettingsPage.tsx src/pages/SettingsPage.css src/pages/SettingsPage.test.tsx src/components/settings/settings.css src/components/settings/HouseholdCard.tsx src/components/settings/HouseholdCard.test.tsx src/components/settings/CategoriesCard.tsx src/components/settings/CategoriesCard.test.tsx
git commit -m "feat(settings): section bands visually hidden, card pairs start-aligned, Categories span-8 with a sticky row-actions scroller"
```

---

### Task 10: `SettingsGhost` and the tab-hover warm cache (modules + unit tests)

**Files:**
- Create: `src/components/settings/SettingsGhost.tsx`
- Create: `src/components/settings/settingsPrefetch.ts`
- Create: `src/components/settings/SettingsGhost.test.tsx`
- Create: `src/components/settings/settingsPrefetch.test.ts`
- Modify: `src/components/settings/settings.css` (ghost rule)

Why a warm cache: `src/api/client.ts`'s `api()` only shares IDENTICAL GETs while they are **in
flight** (`pendingReads`, deleted in `finally`). A hover prefetch that resolves before the click
would be thrown away, so the section loaders park their promises here for 30 s and each card's
mount load takes its own key. Reloads after a save never touch the cache — a primed result may
predate the write.

- [ ] **Step 1: Write the failing tests**

`src/components/settings/SettingsGhost.test.tsx`:

```tsx
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import SettingsGhost, { SETTINGS_CARD_CHROME_PX } from './SettingsGhost'

afterEach(cleanup)

describe('SettingsGhost', () => {
  it('stands as tall as the loaded card minus the chrome already on screen, and announces once', () => {
    render(<SettingsGhost height={415} />)
    const ghost = document.querySelector('.settings-ghost') as HTMLElement
    expect(ghost.classList.contains('skeleton')).toBe(true)
    expect(ghost.getAttribute('aria-hidden')).toBe('true')
    expect(ghost.style.height).toBe(`${415 - SETTINGS_CARD_CHROME_PX}px`)
    expect(ghost.dataset.ghostHeight).toBe('415')
    expect(screen.getByRole('status').textContent).toBe('Loading…')
  })

  it('subtracts extra chrome a card already shows above its body', () => {
    render(<SettingsGhost height={415} chrome={SETTINGS_CARD_CHROME_PX + 42} label="Loading limits…" />)
    const ghost = document.querySelector('.settings-ghost') as HTMLElement
    expect(ghost.style.height).toBe(`${415 - SETTINGS_CARD_CHROME_PX - 42}px`)
    expect(screen.getByRole('status').textContent).toBe('Loading limits…')
  })
})
```

`src/components/settings/settingsPrefetch.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WARM_TTL_MS, primeWarm, resetWarmForTests, takeWarm, warmSource } from './settingsPrefetch'

afterEach(() => {
  resetWarmForTests()
  vi.useRealTimers()
})

describe('settings warm cache', () => {
  it('hands a primed promise to the first taker and then forgets it', async () => {
    const loader = vi.fn(async () => 'primed')
    primeWarm('k', loader)
    primeWarm('k', loader) // a second prime inside the window is a no-op
    expect(loader).toHaveBeenCalledTimes(1)
    const later = vi.fn(async () => 'fresh')
    await expect(takeWarm('k', later)).resolves.toBe('primed')
    expect(later).not.toHaveBeenCalled()
    await expect(takeWarm('k', later)).resolves.toBe('fresh')
    expect(later).toHaveBeenCalledTimes(1)
  })

  it('ignores a prime older than the window', async () => {
    vi.useFakeTimers({ now: 1_000 })
    primeWarm('k', async () => 'old')
    vi.setSystemTime(1_000 + WARM_TTL_MS + 1)
    const later = vi.fn(async () => 'fresh')
    await expect(takeWarm('k', later)).resolves.toBe('fresh')
  })

  it('never serves a prime that failed', async () => {
    primeWarm('k', () => Promise.reject(new Error('down')))
    await Promise.resolve()
    await Promise.resolve() // the rejection's own handler runs, and forgets the entry
    const later = vi.fn(async () => 'fresh')
    await expect(takeWarm('k', later)).resolves.toBe('fresh')
  })

  it('warmSource(true) takes, warmSource(false) is the plain loader', async () => {
    primeWarm('k', async () => 'primed')
    await expect(warmSource(false)('k', async () => 'fresh')).resolves.toBe('fresh')
    await expect(warmSource(true)('k', async () => 'fresh')).resolves.toBe('primed')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/components/settings/SettingsGhost.test.tsx src/components/settings/settingsPrefetch.test.ts`
Expected: FAIL — both modules do not exist.

- [ ] **Step 3: The ghost**

`src/components/settings/SettingsGhost.tsx`:

```tsx
import '../panels.css'
import './settings.css'

/** What a settings card is tall before its body lands, at comfortable density: the card's padding
 *  (1.1rem + 1.25rem) plus the eyebrow row with its (i) and 0.75rem margin — about 68px. A card
 *  that shows more above its body (the Limits year chips) adds that to `chrome`. */
export const SETTINGS_CARD_CHROME_PX = 68

// The loading state of a lazily loaded settings card (2026-09-13 polish spec §9): one pulsing
// block as tall as the card's LOADED body, in the slot the centred "Loading…" sentence used to
// hold, so a tab click lands on a stable layout instead of cards that grow by 200–1100px as their
// fetches answer (audit S-5). Appears at once — no .loading-fallback delay: a 350px void inside a
// card reads as broken, and the acceptance walk wants the ghost within 100ms of the click.
// Screen readers get the same sentence the old fallback carried; the block itself is decoration.
export default function SettingsGhost({
  height,
  chrome = SETTINGS_CARD_CHROME_PX,
  label = 'Loading…',
}: {
  /** The card's height once loaded (spec §9's per-card figures), NOT the block's. */
  height: number
  /** Card chrome already on screen above the body; subtracted so the card stands at `height`. */
  chrome?: number
  label?: string
}) {
  return (
    <>
      <p className="visually-hidden" role="status">
        {label}
      </p>
      <div
        className="skeleton settings-ghost"
        aria-hidden="true"
        data-ghost-height={height}
        style={{ height: Math.max(48, height - chrome) }}
      />
    </>
  )
}
```

Append to `src/components/settings/settings.css` (after the `.settings-scroll thead th` block, ~line 211):

```css
/* A lazily loaded card's body while it fetches (2026-09-13 spec §9): one .skeleton block sized by
   SettingsGhost to the card's loaded height, so the tab switch lands on a stable layout. */
.settings-ghost {
  display: block;
  margin-top: 0.25rem;
}
```

- [ ] **Step 4: The warm cache and the section loaders**

`src/components/settings/settingsPrefetch.ts`:

```ts
import { fetchAssistantSettings } from '../../api/assistant'
import { fetchFeedTokens } from '../../api/calendarFeed'
import { fetchCoverage } from '../../api/coverage'
import { fetchHousehold } from '../../api/household'
import { fetchActivity, fetchHealth, fetchSnapshots } from '../../api/lifecycle'
import { fetchLimits } from '../../api/limits'
import { fetchAccounts } from '../../api/netWorth'
import { fetchProfiles } from '../../api/paycheck'
import { fetchPortfolioAccounts } from '../../api/portfolio'
import { fetchAppSettings } from '../../api/settings'
import { fetchCategories } from '../../api/spending'
import { fetchSystemStatus } from '../../api/system'

// Tab-hover prefetch for the Settings page (2026-09-13 polish spec §9). The API client shares
// identical GETs only while they are IN FLIGHT (client.ts `pendingReads`), so a hover that
// resolved before the click would be thrown away; the section loaders park their promises here
// and every card's MOUNT load takes its own key. Reloads after a save never call takeWarm — a
// primed result may predate the write (the page also never primes a section it has visited).

export type SettingsSection = 'household' | 'planning' | 'account' | 'integrations' | 'data'

/** One key per endpoint, shared by the page's loaders and the cards' mount loads so they cannot
 *  drift apart. Two cards wanting the same endpoint: the first takes it, the second fetches (and
 *  client.ts shares the request if the first is still in flight). */
export const WARM = {
  household: 'household',
  categories: 'categories',
  accounts: 'accounts',
  portfolioAccounts: 'portfolio-accounts',
  limits: (year: number) => `limits:${year}`,
  appSettings: 'app-settings',
  profiles: 'profiles',
  systemStatus: 'system-status',
  assistant: 'assistant-settings',
  feedTokens: 'feed-tokens',
  snapshots: 'snapshots',
  health: 'health',
  coverage: 'coverage',
  activity: 'activity',
} as const

/** How long a primed result may wait for its card. A hover that never became a click is forgotten. */
export const WARM_TTL_MS = 30_000

const warm = new Map<string, { at: number; promise: Promise<unknown> }>()

/** Start `loader` for `key` unless a fresh prime is already parked there. A prime that fails is
 *  forgotten, never served: the card's own load is the one that reports and offers Retry. */
export function primeWarm<T>(key: string, loader: () => Promise<T>): void {
  const entry = warm.get(key)
  if (entry !== undefined && Date.now() - entry.at < WARM_TTL_MS) return
  const promise = loader()
  promise.catch(() => {
    if (warm.get(key)?.promise === promise) warm.delete(key)
  })
  warm.set(key, { at: Date.now(), promise })
}

/** The mount load's source: the primed promise if one is fresh (and it is consumed — the next
 *  taker fetches), else `loader()`. */
export function takeWarm<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const entry = warm.get(key)
  warm.delete(key)
  if (entry !== undefined && Date.now() - entry.at < WARM_TTL_MS) return entry.promise as Promise<T>
  return loader()
}

/** The plain loader, in takeWarm's shape, for every load that is not the mount load. */
export function fresh<T>(_key: string, loader: () => Promise<T>): Promise<T> {
  return loader()
}

export type WarmSource = <T>(key: string, loader: () => Promise<T>) => Promise<T>

/** `initial` is the mount load — take a primed result if there is one; anything else fetches. */
export function warmSource(initial: boolean): WarmSource {
  return initial ? takeWarm : fresh
}

export function resetWarmForTests(): void {
  warm.clear()
}

// What each task's cards ask for on mount (their load chains name the same keys). Account has no
// fetching card (Appearance and Password own no request).
const LOADERS: Record<SettingsSection, () => void> = {
  household: () => {
    primeWarm(WARM.household, fetchHousehold)
    primeWarm(WARM.categories, fetchCategories)
    primeWarm(WARM.accounts, fetchAccounts)
    primeWarm(WARM.portfolioAccounts, fetchPortfolioAccounts)
  },
  planning: () => {
    const year = new Date().getFullYear() // LimitsCard opens on the current year
    primeWarm(WARM.limits(year), () => fetchLimits(year))
    primeWarm(WARM.appSettings, fetchAppSettings)
    primeWarm(WARM.profiles, fetchProfiles)
    primeWarm(WARM.household, fetchHousehold)
  },
  account: () => {},
  integrations: () => {
    primeWarm(WARM.systemStatus, fetchSystemStatus)
    primeWarm(WARM.appSettings, fetchAppSettings)
    primeWarm(WARM.assistant, fetchAssistantSettings)
    primeWarm(WARM.feedTokens, fetchFeedTokens)
  },
  data: () => {
    primeWarm(WARM.snapshots, fetchSnapshots)
    primeWarm(WARM.health, fetchHealth)
    primeWarm(WARM.systemStatus, fetchSystemStatus)
    primeWarm(WARM.coverage, fetchCoverage)
    primeWarm(WARM.activity, () => fetchActivity())
  },
}

/** Warm a section's data before its tab is clicked. Idempotent inside the window. */
export function prefetchSection(section: SettingsSection): void {
  LOADERS[section]()
}
```

- [ ] **Step 5: Run the unit tests**

Run: `npx vitest run src/components/settings/SettingsGhost.test.tsx src/components/settings/settingsPrefetch.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/SettingsGhost.tsx src/components/settings/SettingsGhost.test.tsx src/components/settings/settingsPrefetch.ts src/components/settings/settingsPrefetch.test.ts src/components/settings/settings.css
git commit -m "feat(settings): SettingsGhost (a card body's ghost at its loaded height) and the tab-hover warm cache"
```

---

### Task 11: Every lazily loaded card stands a ghost and takes primed data on mount

**Files:**
- Modify: `HouseholdCard.tsx`, `CategoriesCard.tsx`, `LimitsCard.tsx`, `PlanAssumptionsCard.tsx`,
  `PriceRefreshCard.tsx`, `AssistantCard.tsx`, `CalendarFeedCard.tsx`, `BackupsCard.tsx`,
  `HealthCard.tsx`, `SystemCard.tsx`, `ActivityCard.tsx` (all in `src/components/settings/`)
- Modify: `src/pages/SettingsPage.tsx:254-263` (skeleton parity)
- Test: `src/pages/SettingsPage.test.tsx`

The same three edits in every card, then each card's specifics:

- **(a) imports** — add `import SettingsGhost from './SettingsGhost'` and
  `import { WARM, warmSource } from './settingsPrefetch'` (below the card's `'./settings.css'` import
  is fine; keep the file's import order otherwise).
- **(b) the load chain** — `load` takes `initial = false` and reads its data through
  `warmSource(initial)(KEY, loader)`; the mount effect calls `load(true)`; every other call
  (`retry`, after a save) stays a bare `load()`. A bare `retry={load}` must become
  `retry={() => load()}` — FeedBanner would otherwise hand the click event in as `initial`.
- **(c) the ghost** — the `<p className="empty-note">Loading…</p>` line becomes
  `<SettingsGhost height={N} />` under the same condition.

- [ ] **Step 1: Write the failing page test**

In `src/pages/SettingsPage.test.tsx`, add `LimitsOut` to the `import type { … } from '../types/api'`
list, and append at the end of the file:

```tsx
describe('SettingsPage — loading states (2026-09-13 spec §9)', () => {
  it('stands a ghost of the loaded card until a lazily loaded card has its data', async () => {
    const limits = deferred<LimitsOut>()
    vi.mocked(fetchLimits).mockReturnValue(limits.promise)
    renderPage('planning')
    const card = await waitFor(() => {
      const el = document.getElementById('limits')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    const ghost = card.querySelector('.settings-ghost') as HTMLElement
    expect(ghost).not.toBeNull()
    expect(ghost.dataset.ghostHeight).toBe('415')
    expect(within(card).getByRole('status').textContent).toBe('Loading…')
    expect(card.querySelector('form')).toBeNull()
    expect(card.querySelector('.empty-note')).toBeNull()
    await act(async () => {
      limits.resolve({ year: new Date().getFullYear(), items: [] })
    })
    expect(card.querySelector('.settings-ghost')).toBeNull()
    expect(card.querySelector('form')).not.toBeNull()
  })

  it('ghosts every Data card while it loads and never prints the old Loading… note', async () => {
    const snapshots = deferred<SnapshotEntry[]>()
    vi.mocked(fetchSnapshots).mockReturnValue(snapshots.promise)
    renderPage('data')
    const backups = await waitFor(() => {
      const el = document.getElementById('backups')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect((backups.querySelector('.settings-ghost') as HTMLElement).dataset.ghostHeight).toBe('313')
    expect(screen.queryByText('Loading…', { selector: '.empty-note' })).toBeNull()
    await act(async () => {
      snapshots.resolve([])
    })
    expect(backups.querySelector('.settings-ghost')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/pages/SettingsPage.test.tsx -t "loading states"`
Expected: FAIL — no `.settings-ghost` in the Limits card.

- [ ] **Step 3: HouseholdCard (420)**

```tsx
  const load = (initial = false) => {
    const seq = ++seqRef.current
    warmSource(initial)(WARM.household, fetchHousehold)
      .then((h) => {
```
(rest of the chain unchanged). Mount effect: `load()` → `load(true)` (keep the eslint-disable
comment that follows it). Line 125: `retry={load}` → `retry={() => load()}`. Line 126:
`{!loaded && loadError === null && <p className="empty-note">Loading…</p>}` →
`{!loaded && loadError === null && <SettingsGhost height={420} />}`.

- [ ] **Step 4: CategoriesCard (900)**

`load = (initial = false)` with `warmSource(initial)(WARM.categories, fetchCategories)`; mount
`load(true)`; line 146 `retry={() => load()}`; line 147 → `<SettingsGhost height={900} />`.

- [ ] **Step 5: LimitsCard (415, minus its 42px year-chip row)**

```tsx
  const load = (forYear: number, initial = false) => {
    const seq = ++seqRef.current
    warmSource(initial)(WARM.limits(forYear), () => fetchLimits(forYear))
      .then((payload) => {
```
Mount effect (line 70): `load(year)` → `load(year, true)`. The FeedBanner's `retry={() => load(year)}`
stays. Line 161 →

```tsx
      {/* The year chips above are already on screen, so the ghost is the card minus them too. */}
      {items === null && loadError === null && <SettingsGhost height={415} chrome={SETTINGS_CARD_CHROME_PX + 42} />}
```

with the import `import SettingsGhost, { SETTINGS_CARD_CHROME_PX } from './SettingsGhost'`.

- [ ] **Step 6: PlanAssumptionsCard (415)**

```tsx
  const load = (initial = false) => {
    const seq = ++seqRef.current
    const source = warmSource(initial)
    Promise.all([
      source(WARM.appSettings, fetchAppSettings),
      source(WARM.profiles, fetchProfiles),
      source(WARM.household, fetchHousehold),
    ])
      .then(([stored, rows, household]) => {
```
Mount `load(true)`; line 164 `retry={() => load()}`; line 165 → `<SettingsGhost height={415} />`.

- [ ] **Step 7: PriceRefreshCard (420)**

```tsx
    const source = warmSource(initial)
    Promise.all([source(WARM.systemStatus, fetchSystemStatus), source(WARM.appSettings, fetchAppSettings)])
```
Mount `load(true)`; line 123 `retry={() => load()}`; line 124 → `<SettingsGhost height={420} />`.

- [ ] **Step 8: AssistantCard (420)**

`warmSource(initial)(WARM.assistant, fetchAssistantSettings)`; mount `load(true)`; line 137
`retry={() => load()}`; line 140 → `<SettingsGhost height={420} />`.

- [ ] **Step 9: CalendarFeedCard (357)**

```tsx
    const source = warmSource(initial)
    Promise.all([source(WARM.feedTokens, fetchFeedTokens), source(WARM.appSettings, fetchAppSettings)])
```
Mount `load(true)`; the after-save `load()` calls (lines 86, 96) stay; line 134 `retry={() => load()}`;
line 135 → `<SettingsGhost height={357} />`.

- [ ] **Step 10: BackupsCard (313), HealthCard (313), ActivityCard (487)**

Backups: `warmSource(initial)(WARM.snapshots, fetchSnapshots)`; mount `load(true)`; line 97
`retry={() => load()}`; line 98 → `<SettingsGhost height={313} />`.

Health: `warmSource(initial)(WARM.health, fetchHealth)`; mount `load(true)`; line 141
`retry={() => load()}`; line 142 → `<SettingsGhost height={313} />`.

Activity: `warmSource(initial)(WARM.activity, () => fetchActivity())`; mount `load(true)`; line 124
`retry={() => load()}`; line 125 → `<SettingsGhost height={487} />`. (`loadMore`'s
`fetchActivity(nextBefore)` is untouched.)

- [ ] **Step 11: SystemCard (313)**

```tsx
  const load = (initial = false) => {
    const seq = ++seqRef.current
    const source = warmSource(initial)
    // All-or-nothing, the OverviewPage snapshot's contract: … (keep the existing comment)
    Promise.all([source(WARM.systemStatus, fetchSystemStatus), source(WARM.coverage, fetchCoverage)])
```
Mount `load(true)`; the Retry's `load()` stays; line 165 `? loading && <p className="empty-note">Loading…</p>`
→ `? loading && <SettingsGhost height={313} />`.

- [ ] **Step 12: Page skeleton parity**

In `src/pages/SettingsPage.tsx`, replace the `skeleton={{ … }}` prop (lines 252–263) with:

```tsx
        // The page's own shape: the Household section's three cards at the heights their ghosts
        // will stand at (SettingsGhost heights minus the chrome PageSkeleton's card already draws),
        // so the gate GET resolving swaps like for like instead of jumping.
        skeleton={{
          tiles: 0,
          cards: [
            { span: 4, height: 362 },
            { span: 8, height: 842 },
            { span: 12, height: 987 },
          ],
        }}
```

- [ ] **Step 13: Run every settings test, type-check, lint**

Run: `npx vitest run src/components/settings src/pages/SettingsPage.test.tsx && npx tsc -b && npx eslint src/components/settings src/pages/SettingsPage.tsx`
Expected: PASS. Call-count pins (`fetchHousehold` ×2 after a save, `fetchLimits` ×1 on mount, …) are
unchanged: with nothing primed, `takeWarm` is the loader.

- [ ] **Step 14: Commit**

```bash
git add src/components/settings src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx
git commit -m "feat(settings): every lazily loaded card stands a ghost of its loaded height and takes primed data on mount"
```

---

### Task 12: The Accounts card renders once, after both feeds settle

**Files:**
- Modify: `src/components/settings/AccountsCard.tsx`
- Test: `src/components/settings/AccountsCard.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/components/settings/AccountsCard.test.tsx`, add `act` to the RTL import, add the
`deferred` helper after the fixtures:

```tsx
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
```

and append:

```tsx
it('renders once, after BOTH feeds settle — no roster table before the portfolio labels are in (spec §9)', async () => {
  const accounts = deferred<AccountOut[]>()
  const labels = deferred<PortfolioAccountOut[]>()
  vi.mocked(fetchAccounts).mockReturnValue(accounts.promise)
  vi.mocked(fetchPortfolioAccounts).mockReturnValue(labels.promise)
  render(<AccountsCard people={[ME]} />)
  expect((document.querySelector('.settings-ghost') as HTMLElement).dataset.ghostHeight).toBe('1045')
  expect(screen.queryByText('Portfolio accounts')).toBeNull()
  await act(async () => {
    accounts.resolve([CHECKING])
  })
  // The roster is in, the labels are not: still the ghost — the card used to grow here and again
  // 76ms later, pushing the second table 1118px down the page (audit S-5).
  expect(screen.queryByRole('table', { name: 'Net-worth accounts' })).toBeNull()
  expect(document.querySelector('.settings-ghost')).not.toBeNull()
  await act(async () => {
    labels.resolve([BROKERAGE])
  })
  expect(await screen.findByRole('table', { name: 'Net-worth accounts' })).toBeTruthy()
  expect(screen.getByRole('table', { name: 'Portfolio accounts' })).toBeTruthy()
  expect(document.querySelector('.settings-ghost')).toBeNull()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/settings/AccountsCard.test.tsx -t "renders once"`
Expected: FAIL — no `.settings-ghost` (the card still prints two Loading notes).

- [ ] **Step 3: One settle, one render**

In `src/components/settings/AccountsCard.tsx`:

1. Imports: add `import SettingsGhost from './SettingsGhost'` and
   `import { WARM, warmSource } from './settingsPrefetch'` after `import './settings.css'`.
2. After `const [loaded, setLoaded] = useState(false)` add
   `const [settled, setSettled] = useState(false) // both mount fetches answered, either way`.
3. The two load chains RETURN their promises and take the mount source:

```tsx
  const load = (initial = false) => {
    const seq = ++seqRef.current
    return warmSource(initial)(WARM.accounts, fetchAccounts)
      .then((rows) => {
        if (seq !== seqRef.current) return
        setAccounts(rows)
        setLoadError(null)
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setLoadError(describeError(err, 'the accounts'))
      })
  }

  const loadPortfolio = (initial = false) => {
    const seq = ++portfolioSeqRef.current
    return warmSource(initial)(WARM.portfolioAccounts, fetchPortfolioAccounts)
      .then((rows) => {
        if (seq !== portfolioSeqRef.current) return
        setPortfolioAccounts(rows)
        setPortfolioError(null)
        setPortfolioLoaded(true)
      })
      .catch((err: unknown) => {
        if (seq !== portfolioSeqRef.current) return
        setPortfolioError(describeError(err, 'the portfolio accounts'))
      })
  }
```

4. The mount effect:

```tsx
  useEffect(() => {
    // ONE render when both feeds have SETTLED (2026-09-13 spec §9): the card used to grow twice —
    // the roster landing 76ms before the portfolio labels pushed the second table 1118px down the
    // page (audit S-5). Settled, not fulfilled: a feed that failed still lets the other render.
    void Promise.allSettled([load(true), loadPortfolio(true)]).then(() => setSettled(true))
    // mount-only: two plain functions over stable setters (house idiom)
  }, [])
```

5. Render: line 284 `retry={load}` → `retry={() => load()}`; line 474 `retry={loadPortfolio}` →
   `retry={() => loadPortfolio()}`. Replace
   `{!loaded && loadError === null && <p className="empty-note">Loading…</p>}` with
   `{!settled && <SettingsGhost height={1045} />}`, change `{loaded && (` to `{settled && loaded && (`,
   and wrap everything from the `<h3 className="eyebrow portfolio-accounts-heading">` down to the
   end of the portfolio block (the `)}` after the `settings-note` paragraph) in `{settled && (<> … </>)}`.
   Inside it, delete the portfolio "Loading…" line:

```tsx
      {!portfolioLoaded && portfolioError === null && (
        <p className="empty-note">Loading portfolio accounts…</p>
      )}
```

   (the ghost above already stood for both).

- [ ] **Step 4: Run the card tests**

Run: `npx vitest run src/components/settings/AccountsCard.test.tsx`
Expected: PASS — including `'keeps the net-worth roster alive when the portfolio labels fail to load'`
(allSettled lets the roster render after the labels reject) and `'names the card in the load banner
and keeps Retry there'`.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/AccountsCard.tsx src/components/settings/AccountsCard.test.tsx
git commit -m "feat(settings): Accounts card renders once after both feeds settle, behind one ghost"
```

---

### Task 13: Tab hover and focus prefetch a task's data

**Files:**
- Modify: `src/pages/SettingsPage.tsx` (imports, refs, delegated listeners, the page root's `ref`)
- Test: `src/pages/SettingsPage.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/pages/SettingsPage.test.tsx`, import the reset:
`import { resetWarmForTests } from '../components/settings/settingsPrefetch'` and call
`resetWarmForTests()` as the first line of the file's `beforeEach`. Then append inside the
`describe('SettingsPage — loading states …')` block from Task 11:

```tsx
  it('warms a task’s data on tab hover or focus, once, so the click finds it already loaded', async () => {
    renderPage()
    await waitFor(() => expect(document.getElementById('accounts')).not.toBeNull())
    expect(vi.mocked(fetchProfiles)).not.toHaveBeenCalled()
    expect(vi.mocked(fetchLimits)).not.toHaveBeenCalled()

    fireEvent.pointerOver(screen.getByRole('tab', { name: 'Planning' }))
    expect(vi.mocked(fetchProfiles)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchLimits)).toHaveBeenCalledTimes(1)
    // Again, and by keyboard: still once per section.
    fireEvent.pointerOver(screen.getByRole('tab', { name: 'Planning' }))
    fireEvent.focus(screen.getByRole('tab', { name: 'Planning' }))
    expect(vi.mocked(fetchProfiles)).toHaveBeenCalledTimes(1)
    // The section on screen is never primed: its cards have fetched.
    fireEvent.pointerOver(screen.getByRole('tab', { name: 'Household' }))
    expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('tab', { name: 'Planning' }))
    await screen.findByLabelText('Withdrawal rate (% / year)')
    // The cards took the primed promises instead of asking again.
    expect(vi.mocked(fetchProfiles)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchLimits)).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/pages/SettingsPage.test.tsx -t "warms"`
Expected: FAIL — `fetchProfiles` not called after the hover.

- [ ] **Step 3: Delegated listeners on the page root**

In `src/pages/SettingsPage.tsx`:

1. Import: `import { prefetchSection, type SettingsSection } from '../components/settings/settingsPrefetch'`
   (after the `SystemCard` import).
2. After `const seqRef = useRef(0)` add:

```tsx
  // Warm a task's data on tab hover or focus (2026-09-13 spec §9), so the click lands on filled
  // cards. Delegated NATIVE listeners on the page root, not props on the tabs: the strip is the
  // shell's (LocalSectionNav has no hover hooks) and this page edits no shell file. Once per
  // section per mount, never for the section on screen or one already visited — its cards have
  // fetched, and a primed result must never outlive a save (settingsPrefetch.ts).
  const pageRef = useRef<HTMLDivElement>(null)
  const primedRef = useRef(new Set<SettingsSection>())
  const visitedRef = useRef(new Set<SettingsSection>())
  useEffect(() => {
    visitedRef.current.add(views.section)
  }, [views.section])
  useEffect(() => {
    const root = pageRef.current
    if (root === null) return
    const onIntent = (event: Event) => {
      const tab = event.target instanceof Element ? event.target.closest<HTMLElement>('[role="tab"]') : null
      if (tab === null) return
      // LocalSectionNav's tab ids end in `-tab-<section>` (useLocalSections.tabId).
      const section = PAGE_SECTIONS.find((item) => tab.id.endsWith(`-tab-${item.id}`))?.id
      if (section === undefined || visitedRef.current.has(section) || primedRef.current.has(section)) return
      primedRef.current.add(section)
      prefetchSection(section)
    }
    root.addEventListener('pointerover', onIntent)
    root.addEventListener('focusin', onIntent)
    return () => {
      root.removeEventListener('pointerover', onIntent)
      root.removeEventListener('focusin', onIntent)
    }
  }, [])
```

3. The page root: `<div className="page settings-page">` → `<div className="page settings-page" ref={pageRef}>`.

- [ ] **Step 4: Run the page tests, lint**

Run: `npx vitest run src/pages/SettingsPage.test.tsx && npx eslint src/pages/SettingsPage.tsx && npx tsc -b`
Expected: PASS; the existing lifecycle test (`fetchAppSettings` ×2 after clicking Planning without a
hover) is unchanged; lint and tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx
git commit -m "feat(settings): tab hover and focus prefetch a task's data once, consumed by the cards on mount"
```

---

### Task 14: Copy — one password sentence, system facts as lists, restore labels in the form register

**Files:**
- Modify: `src/pages/SettingsPage.tsx:341-346`
- Modify: `src/components/settings/SystemCard.tsx:51-59,72-92`
- Modify: `src/components/settings/settings.css:100-112,346`
- Test: `src/pages/SettingsPage.test.tsx`, `src/components/settings/SystemCard.test.tsx`

- [ ] **Step 1: Update and add the tests**

`src/pages/SettingsPage.test.tsx`, in `'changes the password, clears all three boxes and says so'`,
replace

```tsx
    // What the change actually DOES, said out loud on the page (2026-09-03 shell spec §10):
    // the server bumps token_version, so every other session ends and only this one — which
    // stored the token the response handed back — survives.
    expect(
      screen.getByText('Other devices are signed out; this one stays signed in.'),
    ).toBeTruthy()
```

with

```tsx
    // What the change DOES is said once, in the heading's (i) (2026-09-13 spec §14, audit S-11):
    // the note under the form repeated that sentence word for word.
    expect(screen.queryByText('Other devices are signed out; this one stays signed in.')).toBeNull()
    expect(screen.getByRole('button', { name: /^About Changes your login password/ })).toBeTruthy()
```

`src/components/settings/SystemCard.test.tsx`, replace `it('renders the last-5 backup trail compactly', …)` with:

```tsx
it('renders the backup trail as a list — three lines, then "+N more" — spanning both fact columns', async () => {
  vi.mocked(fetchSystemStatus).mockResolvedValue(
    systemOut({
      backup_runs: [
        { at: '2026-08-30T03:00:00+00:00', ok: true, object: 'backups/finance.sql.gz.gpg' },
        { at: '2026-08-29T03:00:00+00:00', ok: false, error: 'pg_dump: connection refused' },
        { at: '2026-08-28T03:00:00+00:00', ok: true, object: 'backups/finance.sql.gz.gpg' },
        { at: '2026-08-27T03:00:00+00:00', ok: true, object: 'backups/finance.sql.gz.gpg' },
        { at: '2026-08-26T03:00:00+00:00', ok: true, object: 'backups/finance.sql.gz.gpg' },
      ],
    }),
  )
  render(<SystemCard />)
  const first = await screen.findByText(`${formatDateTime('2026-08-30T03:00:00+00:00')} ok`)
  const list = first.closest('ul') as HTMLElement
  expect(Array.from(list.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
    `${formatDateTime('2026-08-30T03:00:00+00:00')} ok`,
    `${formatDateTime('2026-08-29T03:00:00+00:00')} failed`,
    `${formatDateTime('2026-08-28T03:00:00+00:00')} ok`,
    '+2 more',
  ])
  expect(list.closest('.system-fact')?.classList.contains('system-fact-wide')).toBe(true)
})

it('lists each hand-entered feed on its own line, the row spanning both columns', async () => {
  render(<SystemCard />)
  const balances = await screen.findByText('Balances through Sep 2026')
  expect(balances.tagName).toBe('LI')
  expect(balances.closest('.system-fact')?.classList.contains('system-fact-wide')).toBe(true)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/pages/SettingsPage.test.tsx src/components/settings/SystemCard.test.tsx -t "password|backup trail|own line"`
Expected: the password test FAILS (the note is still there); both SystemCard tests FAIL (joined
string; `SPAN` not `LI`).

- [ ] **Step 3: One password sentence**

In `src/pages/SettingsPage.tsx` delete lines 341–346:

```tsx
                  {/* What the change costs and what it does not: the server bumps token_version,
                      which kills every token issued before it — including this tab's, which is
                      why the response hands back a fresh one for changePassword to store. */}
                  <p className="settings-note">
                    Other devices are signed out; this one stays signed in.
                  </p>
```

(The heading's `InfoHint` — "Changes your login password and signs out every other device; this one
stays signed in." — already says it.)

- [ ] **Step 4: List-valued facts as lists**

In `src/components/settings/SystemCard.tsx` replace `backupRunsLine` (lines 51–59) with:

```ts
// Compact trail (spec §B3, reshaped 2026-09-13 spec §14 / audit S-8): the server stores 10 runs;
// the card lists the newest three, one per line, and counts the rest. Joined into one dd they
// wrapped to ten ragged lines in the half-width column.
const TRAIL_SHOWN = 3
function backupRunLines(runs: BackupRun[]): { lines: string[]; more: number } {
  return {
    lines: runs.slice(0, TRAIL_SHOWN).map((run) => `${formatDateTime(run.at)} ${run.ok ? 'ok' : 'failed'}`),
    more: Math.max(0, runs.length - TRAIL_SHOWN),
  }
}
```

and in `SystemFacts` replace the "Data through" and "Recent backups" facts (lines 72–92) with:

```tsx
      {/* List-valued facts are lists (audit S-8) and take BOTH columns of the facts grid. */}
      <div className="system-fact system-fact-wide">
        <dt>Data through</dt>
        <dd>
          <ul className="system-fact-list">
            {freshnessClauses(coverage).map((clause) => (
              <li key={clause.key} className={clause.lagging ? 'system-stale' : ''}>
                {clause.text}
              </li>
            ))}
          </ul>
        </dd>
      </div>
      <div className="system-fact">
        <dt>Last backup</dt>
        <dd>
          <span className={backup.className}>{backup.text}</span>
        </dd>
      </div>
      <div className="system-fact system-fact-wide">
        <dt>Recent backups</dt>
        <dd>
          {trail.lines.length === 0 ? (
            '—'
          ) : (
            <ul className="system-fact-list">
              {trail.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
              {trail.more > 0 && <li className="system-fact-more">+{trail.more} more</li>}
            </ul>
          )}
        </dd>
      </div>
```

with `const trail = backupRunLines(status.backup_runs ?? [])` added beside `const backup = backupLine(status)`
at the top of `SystemFacts`. The long "Data through" comment above the old block moves above the new
one unchanged. `Fragment` is no longer used — change the React import to
`import { useEffect, useRef, useState } from 'react'`.

- [ ] **Step 5: CSS — lists, the wide row, restore labels**

In `src/components/settings/settings.css`:

Replace the `@media (min-width: 721px)` block at lines 100–112 with:

```css
/* Six facts down a half-width card is a long thin list; two columns fill it (spec §3.3), and
   the label track has to give inside the narrower column. A list-valued fact takes both. */
@media (min-width: 721px) {
  .system-facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.45rem 1.5rem;
  }

  .system-facts .system-fact {
    grid-template-columns: minmax(110px, 40%) 1fr;
  }

  .system-facts .system-fact-wide {
    grid-column: 1 / -1;
  }
}

/* One line per value (audit S-8): timestamps and feed clauses, never a " · "-joined paragraph. */
.system-fact-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.system-fact-more {
  color: var(--muted);
}
```

And extend the label rule at line 346: `.restore-arm label {` → 

```css
/* The source picker's labels wear the same form register as every other label on the page
   (audit S-6): 16px body text over a select read as a sentence, not a field. */
.restore-arm label,
.restore-source label {
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/pages/SettingsPage.test.tsx src/components/settings && npx tsc -b`
Expected: PASS (the freshness tests still find their clause text and `.className`, now on `li`s).

- [ ] **Step 7: Commit**

```bash
git add src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx src/components/settings/SystemCard.tsx src/components/settings/SystemCard.test.tsx src/components/settings/settings.css
git commit -m "fix(copy): one password sentence; system facts as lists across both columns; restore labels in the form register"
```

---

### Task 15: Import and restore report folds use the `Disclosure` primitive (spec §11, P4 row)

**Files:**
- Modify: `src/components/settings/ImportReportView.tsx:91-102`
- Modify: `src/components/settings/RestoreReportView.tsx:67-79`
- Test: `src/components/settings/RestoreReportView.test.tsx` (must stay green), `ImportReportView` via `SettingsPage.test.tsx`

This is the one row of §11 assigned to P4: styling only, no behaviour change — the fold stays a
native `<details>` (Disclosure renders one), closed by default.

- [ ] **Step 1: Confirm the primitive's shape**

Run: `sed -n 1,60p src/components/Disclosure.tsx`
Expected: a default export `Disclosure({ summary, defaultOpen, open, onToggle, onOpen, className, id, name, children })`
rendering `<details className="disclosure">`. If `summary` is named differently, use the real prop name below.

- [ ] **Step 2: Add the pinning assertion**

In `src/components/settings/RestoreReportView.test.tsx`, in the test that reads
`const fold = screen.getByText('2 tables unchanged')`, add right after `const details = fold.closest('details') as HTMLDetailsElement`:

```tsx
    // The house fold (2026-09-13 spec §11): the shared Disclosure primitive, not a bare <details>.
    expect(details.classList.contains('disclosure')).toBe(true)
```

Run: `npx vitest run src/components/settings/RestoreReportView.test.tsx`
Expected: FAIL on the new assertion.

- [ ] **Step 3: Convert both folds**

`src/components/settings/ImportReportView.tsx` — add `import Disclosure from '../Disclosure'` and replace

```tsx
      {sheet.samples.length > 0 && (
        <details>
          <summary>
            {sheet.samples.length} sample changes
            {sheet.samples_truncated > 0 ? ` (+${sheet.samples_truncated} more)` : ''}
          </summary>
          <ul>
            {sheet.samples.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </details>
      )}
```

with

```tsx
      {sheet.samples.length > 0 && (
        <Disclosure
          summary={`${sheet.samples.length} sample changes${sheet.samples_truncated > 0 ? ` (+${sheet.samples_truncated} more)` : ''}`}
        >
          <ul>
            {sheet.samples.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </Disclosure>
      )}
```

`src/components/settings/RestoreReportView.tsx` — add `import Disclosure from '../Disclosure'` and replace

```tsx
      {unchanged.length > 0 && (
        <details>
          <summary>
            {unchanged.length} {unchanged.length === 1 ? 'table' : 'tables'} unchanged
          </summary>
          <ul>
            {unchanged.map(([name, diff]) => (
              <li key={name}>
                {name} ({diff.current})
              </li>
            ))}
          </ul>
        </details>
      )}
```

with

```tsx
      {unchanged.length > 0 && (
        <Disclosure summary={`${unchanged.length} ${unchanged.length === 1 ? 'table' : 'tables'} unchanged`}>
          <ul>
            {unchanged.map(([name, diff]) => (
              <li key={name}>
                {name} ({diff.current})
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
```

- [ ] **Step 4: Run the report tests and the import tests**

Run: `npx vitest run src/components/settings/RestoreReportView.test.tsx src/pages/SettingsPage.test.tsx -t "restore|import|Restore|xlsx"`
Expected: PASS. (`getByText('2 tables unchanged')` still resolves to the summary's text node's
element — Disclosure's `<summary>` holds the chevron and the text; if the chevron wraps the text in
its own span, `fold.closest('details')` still finds the fold.)

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/ImportReportView.tsx src/components/settings/RestoreReportView.tsx src/components/settings/RestoreReportView.test.tsx
git commit -m "feat(settings): import and restore report folds use the Disclosure primitive"
```

---

### Task 16: Lane gates, hand-off notes, deferred deletions

**Files:** none modified unless a gate fails.

- [ ] **Step 1: Type-check and lint**

```bash
npx tsc -b
npx eslint src/pages/ProjectionPage.tsx src/pages/CalendarPage.tsx src/pages/SettingsPage.tsx src/components/projection src/components/calendar src/components/settings
```
Expected: no output from either (warnings ≤ the repo baseline; none new from this lane).

- [ ] **Step 2: Scoped, then full tests**

```bash
npx vitest run src/pages/ProjectionPage.test.tsx src/pages/CalendarPage.test.tsx src/pages/SettingsPage.test.tsx src/components/projection src/components/calendar src/components/settings src/sandbox
npx vitest run
```
Expected: every file passes; the full run's count is the pre-lane count plus this lane's ~22 new
tests. `motionCss.test.ts` passes (no durations added); `mounts.audit.test.ts` passes (the
ProjectionPage prerequisite-gate count is still 1; the trend ChartCard still carries `hint`, `empty`,
`exportName`, `ariaLabel`); `settingsCss.test.ts` passes (the band's scroll-margin declaration is kept).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ built in …` with no errors.

- [ ] **Step 4: Browser eyeball (dev stack, if it is running) — not a gate, a note for the review**

With the shared backend on 8000 and `npm run dev`, at 1440×900: Projection Planning — one row of
five tiles, chart pinned under the band while the knobs scroll, no grey paragraphs between cards,
compare table ≤ 900px, "Hide assumptions" makes the chart full width with the header card above it;
Calendar — Add event opens in the dock and the grid does not move, gutter reads two lines,
`$0` where a deadline is zero, footnotes under the source list; Settings — no bands, Household
short beside a wide Categories with Delete visible, hovering Planning fires its requests in the
Network tab and the click shows filled cards, ghosts pulse in place while Data loads.

- [ ] **Step 5: Hand-off notes for the lead (paste into the lane report)**

```
// TODO(polish-cleanup) — deletions deferred to the end of the night (lane P4 did NOT delete):
//  - src/components/settings/SettingsRail.tsx + SettingsRail.test.tsx: imported by its test only (audit S-12).
//  - src/components/settings/settings.css:284-303 (".settings-page .card" arrival ring + scroll-margin-top):
//    audit S-12 calls it rail-era, BUT the ring is still exercised by the palette's anchored arrival
//    (SettingsPage.tsx hash effect, tests "SettingsPage — anchored arrival from the palette") and the
//    scroll-margin keeps /settings#limits from landing under the sticky strip (settingsCss.test.ts pins
//    it). Recommend KEEPING; delete only if the anchored-arrival ring is also retired.
//  - The CSS this lane already removed (no follow-up): .projection-warnings, .projection-method-note,
//    .projection-view-intro, .cal-title, .cal-strip-asof/.cal-strip-unknown, the band's typography.
// Spec deviations to record in the spec's as-built notes:
//  - Calendar footnotes render inside the calendar CARD (after SourceHealth), not as a bare line under
//    the strip: a paragraph between the tile row and the card is the orphan §15.3 forbids.
//  - AccountsCard uses Promise.allSettled (spec says Promise.all): "settle" is the behaviour the spec
//    describes, and a failed feed must not blank the other (the card's existing contract + test).
//  - The chart column's sticky `top` adds the MEASURED band height (--projection-band-h) to the spec's
//    `var(--sticky-inset) + 8px`; without it the band (z-index 6) covered the chart card's header.
//  - The hover prefetch lands in a 30 s warm cache (settingsPrefetch.ts) that cards consume on mount:
//    client.ts only dedupes in-flight GETs, so a bare prefetch would be discarded before the click.
//  - Vesting delta reads "quote as of Sep 11, 2026" (formatDate, the app's one date formatter).
//  - Compare caption is left-aligned and muted, not visually-hidden (it still names the table for AT).
```

- [ ] **Step 6: No commit for this task unless a gate needed a fix**

If a gate forced a code change, commit it under the task it belongs to
(`fix(projection|calendar|settings): …`) and re-run Steps 1–3.

---

## Self-review

**Spec coverage (P4 rows):**
- §3 "Settings' `h2.settings-section` bands become visually-hidden (ids kept) in P4" → Task 9.
- §7 Settings Categories `.settings-scroll` + `useScrollEdges`, Categories `span-8`, Household `span-4` → Task 9.
- §9 Settings ghosts at the twelve listed heights, Accounts once after both settle, prefetch on tab hover/focus → Tasks 10–13.
- §10 Projection method note → footer, warnings → lede, trend intro → lede → Task 3; Settings bands → Task 9; Calendar quote-date into the Vesting delta, as-of line out of the tile grid → Task 6.
- §11 import/restore reports → Disclosure → Task 15.
- §12 `.projection-outcomes` static below 1000px → Task 1; `.settings-page .card-grid { align-items: start }` → Task 9; Calendar footnotes/76px cells/Add event in the panel/gutter two lines/`$0`/duplicate month title → Tasks 5, 6, 8; Projection one-row band, no inner scroller, sticky chart, hints into the compare card, table max-width + caption, `.sandbox-pins .field-input`, budgets sentence wraps as a unit → Tasks 1, 2, 4.
- §14 Calendar zeros "$0" → Task 5; "below" in the compare hint → Task 4.
- Lead's item 4: password note → Task 14; system facts `<ul>` → Task 14; `.restore-source label` → Task 14.
- Lead's tests list: outcomes `kpi-row-5` (T1); method note/warnings inside `.chart-card` (T3); Add event through a mocked `open` + inline fallback (T8); gutter two lines and `$0` (T5); ghosts before data and cards after (T11); Accounts single render (T12); bands `visually-hidden` (T9). Extra: prefetch (T13), trend lede (T3), fine print placement (T4), band measurement (T2), warm cache and ghost units (T10), system lists (T14).
- House rules: no CSS durations added anywhere; per-page sheets reference only their own classes plus shell vocabulary (`.chart-lede`, `.card`, `.kpi-row-5`); `sandbox.css` is edited only for the rule the lead assigned; no shell file is touched (delegated listeners, ref callbacks and page CSS carry every shell-adjacent need).

**Placeholder scan:** every code step shows the code; the two "adapt if F2's shape differs" notes
(`useScrollEdges` in Task 9, `Disclosure` in Task 15) are gated on an explicit read command in the
Preconditions with the spec's contract spelled out, and Task 9's HouseholdCard test names the one
selector to confirm with a grep. No "TBD", no "similar to Task N".

**Type/name consistency:** `SettingsGhost({ height, chrome?, label? })` + `SETTINGS_CARD_CHROME_PX` (T10) match every call site in T11/T12; `WARM`, `warmSource(initial)`, `takeWarm`, `fresh`, `primeWarm`, `prefetchSection`, `resetWarmForTests`, `SettingsSection` (T10) match T11–T13 and the tests; `CashflowNotes({ events, month, quoteAsOf })` (T6) matches the page call; `gutterLines` (T5) matches the grid render and the test import; `AddEventForm` props (T7) match the page's `eventForm` (T8), including `hosted`; `ScenarioHints({ people })` (T4) matches the page; `FORM_PANEL_ID = 'calendar-add'` matches the mocked-`open` assertion; `FormState` `day` is read by `formTitle`; `measureBand` is the band's `ref` and writes `--projection-band-h`, which the CSS reads with the `131px` fallback.

---

## Results

Lane P4 executed in `.worktrees/polish-p4` on `polish/p4-planning`, branched from main @`895cdaf`
(F1 + F2 merged). Tasks 0–16 done in order, TDD per task, one commit per task. Nothing pushed,
nothing deleted.

### Commits (base `895cdaf` → head `479acf6`)

| Task | SHA | Subject |
| --- | --- | --- |
| 1 | `d80f118` | `feat(projection)`: outcomes band is one row of five tiles, static below 1000px; shorter FI tile label |
| 2 | `2861b2a` | `feat(projection)`: assumptions column loses its inner scroller; the chart column sticks under the measured outcomes band |
| 3 | `880bed0` | `feat(projection)`: method note, warnings and trend intro live inside their chart cards |
| 4 | `2867927` | `feat(projection)`: compare card carries the assumptions fine print; table, caption, pin box and budgets preset fit their words |
| 5 | `3c21595` | `feat(calendar)`: zero amounts print `$0` with no sign or tilde; the week gutter reads in over out |
| 6 | `9aad404` | `feat(calendar)`: strip footnotes leave the tile grid for the card footer; 76px weeks that grow; one month name in the scope row |
| 7 | `a6ea14a` | `refactor(calendar)`: AddEventForm is its own component, ready to stand in the detail panel |
| 8 | `5268dc1` | `feat(calendar)`: Add event opens in the shared detail panel — the grid stays put; inline card without a provider |
| 9 | `9c7b0b3` | `feat(settings)`: section bands visually hidden, card pairs start-aligned, Categories span-8 with a sticky row-actions scroller |
| 10 | `4b51169` | `feat(settings)`: SettingsGhost (a card body's ghost at its loaded height) and the tab-hover warm cache |
| 11 | `c981d84` | `feat(settings)`: every lazily loaded card stands a ghost of its loaded height and takes primed data on mount |
| 12 | `ff63a4d` | `feat(settings)`: Accounts card renders once after both feeds settle, behind one ghost |
| 13 | `70f42f7` | `feat(settings)`: tab hover and focus prefetch a task's data once, consumed by the cards on mount |
| 14 | `458e6d5` | `fix(copy)`: one password sentence; system facts as lists across both columns; restore labels in the form register |
| 15 | `479acf6` | `feat(settings)`: import and restore report folds use the Disclosure primitive |
| 16 | — | gates only; no code change was needed |

46 files changed, +1474 / −541.

### Preconditions (Task 0)

Every F1/F2 expectation held verbatim: `PageFrame` `sections?: ReactNode` + `.page-frame-sections`;
one `sections=` per page in Projection and Settings; `.kpi-row-5` five equal tracks inside
`@container (min-width: 1000px)` with `.page { container-type: inline-size }`; the `td.row-actions`
sticky rule and the `[data-scroll-more~="right"]` mask; `useScrollEdges(ref: RefObject<HTMLElement |
null>): void` and `export default function Disclosure({ summary, … })` rendering
`<details class="disclosure"><summary><chevron/><span class="disclosure-summary">…` ; `modal?: boolean`
on `DetailPanelRequest`; no `GhostCard` in `PageSkeleton`. Both call sites (Task 9's `useScrollEdges`,
Task 15's `Disclosure summary=`) matched the plan's contract, so neither needed adapting.

### Gates (Task 16)

| Gate | Result |
| --- | --- |
| `npx tsc -b` | clean, exit 0 |
| scoped `npx eslint` (the three pages + three component dirs) | 0 errors, **3 warnings**, all pre-existing `react-refresh/only-export-components` in `CalendarGrid.tsx` (it exported three helpers before this lane too) |
| `npx eslint .` (whole repo) | **25 warnings, 0 errors — exactly the repo baseline of 25. This lane adds none.** |
| scoped `npx vitest run` (Projection/Calendar/Settings pages + `components/{projection,calendar,settings}` + `sandbox`) | 44 files, **488 tests**, all pass |
| `npx vitest run` (full) | **216 files / 2954 tests pass** (green run captured; see flakes below) |
| `npm run build` | `✓ built in 19.07s`, no errors |

House-rule checks: the CSS diff adds **no** `transition`, `animation` or literal duration anywhere
(`motionCss.test.ts` green); `mounts.audit.test.ts` green (the trend `ChartCard` still carries
`hint`/`empty`/`exportName`/`ariaLabel`); `settingsCss.test.ts` green (the band's
`scroll-margin-top` declaration was kept). No shell file was edited. The removed classes
(`.projection-warnings`, `.projection-method-note`, `.projection-view-intro`, `.cal-title`,
`.cal-strip-asof`, `.cal-strip-unknown`) and the removed helpers (`gutterText`, `backupRunsLine`)
have zero remaining references outside the three "must be null" test assertions.

**Flakes (all outside this lane, all pass in isolation).** Four full runs: two green, two with a
failure. The offenders were `src/components/portfolio/TransactionsPanel.test.tsx > "a successful
edit still resets the whole form"` (the known pre-existing cross-file flake — passes alone, fails
beside other files), `src/pages/PaycheckPage.test.tsx > "names the employer match under the
waterfall"` and `src/pages/OverviewPage.test.tsx:1879`. None of the three files is touched by P4,
and each passes when run alone. `RestoreCard.test.tsx`'s "leaves focus on the report…" — the known
flake in P4's area — did not trip in any run; per the brief it was left alone (that file is not
edited by this lane).

### Spec coverage, requirement → commit

**Projection.** One-row sticky band, `.kpi-row-5`, shorter FI label with the glued (i) — `d80f118`
(§12). Un-clipped assumptions (`max-height` gone) with the chart column sticky under a *measured*
band — `2861b2a` (§12). Prose inside cards: method sentence appended to the chart card `footer`,
`data.warnings` as the chart card `lede`, trend intro as the trend card `lede` — `880bed0` (§10).
Fine print into the compare card, compare table `max-width: 900px` + left muted caption,
`.sandbox-pins .field-input` reads as words, budgets sentence wraps as a unit, "below" → "in this
table" — `2867927` (§12, §14).

**Calendar.** Footnotes out of the tile grid (quote date → Vesting `delta`, both notes → `CashflowNotes`
inside the calendar card after `SourceHealth`) — `9aad404` (§10, §12). 76px cells with
`grid-auto-rows: minmax(76px, auto)`, duplicate month `h2` dropped — `9aad404` (§12). Add event in
the shared detail panel with the inline-card fallback — `a6ea14a` + `5268dc1` (§12). Gutter reads
in over out on two lines; zero amounts print `$0` with no sign, tilde or `est.` badge — `3c21595`
(§12, §14).

**Settings.** Bands `visually-hidden` with ids kept — `9c7b0b3` (§3, §10). `.settings-page
.card-grid { align-items: start }` — `9c7b0b3` (§12). Span change (Categories `span-8`, Household
`span-4`) with `useScrollEdges` on `.settings-scroll` and the `td.row-actions` column — `9c7b0b3`
(§7). Ghosts at the spec's twelve heights + skeleton parity — `4b51169` + `c981d84` (§9). Single
Accounts render after both feeds settle — `ff63a4d` (§9). Hover/focus prefetch — `4b51169` +
`70f42f7` (§9). Copy: one password sentence, system facts as `<ul>` across both columns, restore
source labels in the form register — `458e6d5` (§14, lead item 4). Import/restore folds on
`Disclosure` — `479acf6` (§11).

### Deviations from the plan (and why)

1. **`EMPTY_FIELDS` stays in `CalendarPage.tsx`** instead of being exported from `AddEventForm.tsx`
   (plan Task 7 Step 1/2). A non-literal value export beside a component costs a
   `react-refresh/only-export-components` warning, and the lane must add none; the `EventFields`
   *type* still comes from the form module, so the cohesion the plan wanted is kept. Applied in
   `5268dc1`.
2. **The no-break spaces in the FI tile label are written as ` ` escapes, not literal NBSP
   characters.** Literal U+00A0 in source trips eslint's `no-irregular-whitespace` (2 errors). Same
   runtime string, so the plan's `expect(label.textContent).toContain('yrs ')` assertion is
   untouched. Folded into `2867927`.
3. **One existing test updated beyond the plan's list:** `SettingsPage.test.tsx > "ghosts the page
   through the frame while the FIRST load is in flight"` expected five `.page-skeleton .card`
   ghosts. Task 12's skeleton-parity change makes it three (Household 4 · Categories 8 · Accounts
   12), so the count and its comment were updated in place, never deleted. In `c981d84`.
4. **`AccountsCard` uses `Promise.allSettled`**, where §9 says `Promise.all` — "settle" is the
   behaviour the spec describes, and the card's existing contract (and its test "keeps the net-worth
   roster alive when the portfolio labels fail to load") requires a failed feed not to blank the
   other. The plan already sanctioned this; recorded here for the spec's as-built notes.
5. **The chart column's sticky `top` adds the measured `--projection-band-h`** to the spec's
   `var(--sticky-inset) + 8px`; without it the band (z-index 6) covered the chart card's header.
   Plan-sanctioned; recorded for the as-built notes.
6. **The hover prefetch lands in a 30s warm cache** (`settingsPrefetch.ts`) that cards consume on
   mount — `client.ts` only dedupes *in-flight* GETs, so a bare prefetch would be discarded before
   the click. Plan-sanctioned; recorded for the as-built notes.
7. **Calendar footnotes render inside the calendar card** (after `SourceHealth`), not as a bare line
   under the strip: a paragraph between the tile row and the card is the orphan §15.3 forbids.
   Plan-sanctioned; recorded for the as-built notes.
8. **Vesting `delta` reads "quote as of Sep 2, 2026"** (`formatDate`, the app's one date formatter),
   and the **compare caption is left-aligned and muted**, not `visually-hidden` (it still names the
   table for assistive tech). Plan-sanctioned; recorded for the as-built notes.
9. **Task 16 Step 4 (browser eyeball) was not performed** — the dev stack was not running in this
   worktree and it is explicitly not a gate. Lane V's acceptance walk covers it.

### Notes for lane V

- **Ghost selectors.** `.settings-ghost` is the block; it carries `aria-hidden="true"` and
  `data-ghost-height="<the card's loaded height>"` (so a walk can assert *which* card's ghost it is
  without measuring). A `<p class="visually-hidden" role="status">Loading…</p>` sits beside it —
  that is the only "Loading…" a settings card prints now; `.empty-note` no longer carries it.
  Heights in use: household 420, categories 900, accounts 1045, limits 415 (chrome
  `SETTINGS_CARD_CHROME_PX + 42`), plan-assumptions 415, price-refresh 420, assistant 420,
  calendar-feed 357, backups 313, health 313, system 313, activity 487.
- **Add-event panel.** The panel id is **`calendar-add`** — one surface for add *and* edit. Titles:
  `Add event`, `Add event on {formatDate(day)}`, or `Edit event`. The panel content is a stable host
  `<div>`; the form is portaled into it, so keystrokes never reopen the panel. `returnTo` is the
  header's "Add event" button. With no `DetailPanelProvider` the page falls back to the inline
  `section.card.span-12` — that is what every pre-existing page test exercises.
- **Prefetch.** Hovering or focusing a Settings tab fires that section's GETs once per mount
  (`prefetchSection`); the section on screen and any already-visited section are never primed. A
  primed promise expires after `WARM_TTL_MS` = 30s. `resetWarmForTests()` clears it between tests.
- **Skeleton parity.** `/settings` now ghosts three cards (span 4 / 8 / 12 at 362 / 842 / 987), not
  five.
- **Projection.** `--projection-band-h` is written on the band's *parent* (the `LocalSectionPanel`)
  by a `ResizeObserver`; without `ResizeObserver` the CSS falls back to `131px`. The band is
  `position: static` below 1000px of container width, and so is the chart column below 900px or
  while the assumptions aside is collapsed (`.projection-workspace:has(.sandbox-header-actions >
  [aria-expanded='false'])`).
- **Container queries.** This lane's `@container` rules are unnamed and resolve to `.projection-page`
  (the same element as `.page`), so the lead's rename to `container: page / inline-size` needs no
  change here.

### Follow-ups — deletions DEFERRED to the lead (lane P4 deleted nothing)

```
// TODO(polish-cleanup) — deletions deferred to the end of the night (lane P4 did NOT delete):
//  - src/components/settings/SettingsRail.tsx + SettingsRail.test.tsx: imported by its test only (audit S-12).
//  - src/components/settings/settings.css (".settings-page .card" arrival ring + scroll-margin-top):
//    audit S-12 calls it rail-era, BUT the ring is still exercised by the palette's anchored arrival
//    (SettingsPage.tsx hash effect, tests "SettingsPage — anchored arrival from the palette") and the
//    scroll-margin keeps /settings#limits from landing under the sticky strip (settingsCss.test.ts pins
//    it). Recommend KEEPING; delete only if the anchored-arrival ring is also retired.
//  - The CSS this lane already removed (no follow-up): .projection-warnings, .projection-method-note,
//    .projection-view-intro, .cal-title, .cal-strip-asof/.cal-strip-unknown, the section bands' typography.
```

Other carry-overs: none. No database, no backend, no shell file was touched; no worktree or branch
cleanup is owed by this lane beyond the usual merge-and-remove.
