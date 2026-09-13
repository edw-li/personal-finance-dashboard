# Lane P3 — income & taxes polish (Paycheck, Comp, ESPP, Taxes) — implementation plan (2026-09-13)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> Opus implementer for this lane in its own worktree, TDD per task, then a spec-compliance review
> and a code-quality review, then a local merge to main by the lead — never pushed). Steps use
> `- [ ]` checkboxes for tracking.

**Spec:** `docs/superpowers/specs/2026-09-13-surface-grammar-and-view-fit-polish-design.md` —
this lane implements the **P3 rows of §1, §7, §8, §10, §11, §12 and §14** (and is measured by §15
items 3, 5 and 9). Evidence: `scratchpad/ux-audit-2026-09-13/reports/income-taxes.md` (W1–W5, W8,
T1, A1–A5, S1–S4, X1–X2, C1–C7, M5). Read §7, §8, §10–§12 and §14 of the spec before Task 1.

**Goal:** the four income pages fit their tabs — sandboxes open on their own tab, row actions stay
visible in scrolled tables, Taxes' year and filing status live in the sticky scope row with the
year admin behind a popover, no sentence says "below" for something on another tab, and no text
floats outside a card.

**Architecture:** page-local edits only, on top of the primitives F1/F2 already merged
(`Disclosure`, `.popover-surface` + `usePopoverDismiss`, sticky `.row-actions`/`.col-identity` +
`useScrollEdges`, `.kpi-row-5`, `PageFrame sections`). `SandboxPanel` grows one prop
(`defaultOpen`); the taxes panels grow a `goTo(section)` prop threaded from `TaxesPage`; the Taxes
year admin becomes a small `TaxYearMenu` component in the frame's `actions` slot.

**Tech stack:** React 19 + TypeScript + Vite, vitest + Testing Library (jsdom). No backend
change; nothing here touches the database.

---

## Mechanics (read once)

- Worktree: `C:/Users/edyli/personal-finance-dashboard/.worktrees/polish-p3`, branch
  `polish/p3-income`, cut from `main` AFTER F1 and F2 merged. `node_modules` is a junction the
  orchestrator creates; do not `npm install`. Every command below runs from the worktree root.
- Files this lane may touch (spec §1): `src/pages/PaycheckPage.*`, `src/components/paycheck/*`,
  `src/pages/CompPage.*`, `src/components/comp/*`, `src/pages/EsppPage.*`,
  `src/components/espp/*`, `src/pages/TaxesPage.*`, `src/components/taxes/*`,
  `src/sandbox/SandboxPanel.tsx` (+ its test). NOT `src/sandbox/sandbox.css`, NOT `panels.css`,
  NOT `shell.css`, NOT `PageFrame.tsx`. A primitive that turns out to be missing is added under a
  page-scoped selector in the lane's own stylesheet and REPORTED, never added to a shared file.
- The `sections={<LocalSectionNav … />}` wiring on all four `PageFrame`s is F2's. Leave it exactly
  as merged; never render a second nav in the body.
- House rules: no literal durations in CSS (tokens only — this lane adds no motion of its own);
  per-page stylesheets never import another page's sheet; existing tests are UPDATED, not
  deleted; every new behaviour gets a focused Testing Library test.
- Gates after each task: the task's own test file(s), then `npx tsc -b`. Lane gates at the end
  (Task 13): `npx tsc -b`; `npx eslint src/pages/PaycheckPage.tsx src/pages/CompPage.tsx
  src/pages/EsppPage.tsx src/pages/TaxesPage.tsx src/components/paycheck src/components/comp
  src/components/espp src/components/taxes src/sandbox`; scoped vitest on those paths; full
  `npx vitest run`; `npm run build`.
- Commits: one per task, small, in the house grammar — `feat(paycheck):`, `feat(comp):`,
  `feat(espp):`, `feat(taxes):`, `feat(sandbox):`, `fix(copy):`. Never push. Never delete files.
- Test-running notes: `npx vitest run <file> -t "<substring of the test name>"` runs one test.
  Expected outputs are written as `Tests  1 failed` / `Tests  N passed`: the count of OTHER
  tests in a file is not the point, the named one failing-then-passing is.

## Contracts — what F1/F2 ship and this lane consumes verbatim

Task 0 verifies every one of these exists before any edit. Use these names exactly.

```ts
// src/components/Disclosure.tsx (F2, spec §2.6) — default export
<Disclosure summary={ReactNode} defaultOpen?: boolean open?: boolean onToggle?: () => void
            className?: string id?: string name?: string>{children}</Disclosure>
// renders <details class="disclosure [className]"><summary>…</summary><div class="disclosure-body">…</div></details>
// Children are always in the DOM (a native <details>), so getByText reaches them while closed.

// src/components/usePopoverDismiss.ts (F2, spec §11) — named export
usePopoverDismiss(open: boolean, onClose: () => void,
                  triggerRef: RefObject<HTMLElement | null>, surfaceRef: RefObject<HTMLElement | null>): void
// outside pointerdown + Escape call onClose; focus returns to triggerRef on close.
// panels.css: .popover-surface { position:absolute; z-index:20; background; border; radius; shadow; padding }

// src/components/useScrollEdges.ts (F2, spec §7) — named export
useScrollEdges(ref: RefObject<HTMLElement | null>): void
// toggles data-scroll-more="left right" on the scroller; a null ref (table not rendered) is a no-op.
// panels.css: .data-table th:last-child, .data-table td.row-actions → sticky right;
//             .data-table th.col-identity, .data-table td.col-identity → sticky left.

// panels.css (F2, spec §12): .kpi-row-5; .card-grid > .span-6 (already existed)
// src/components/StatTile.tsx (F2, spec §10): badge?: ReactNode  (NOT used by this lane; listed so nobody re-adds it)
// src/components/shell/PageFrame.tsx (F2, spec §3): sections?: ReactNode — wired on all four pages already.
```

If `Disclosure` turns out to be a NAMED export in the merged F2 (`export function Disclosure`),
change the three `import Disclosure from '…/Disclosure'` lines (Tasks 2, 5, 9) to
`import { Disclosure } from '…/Disclosure'` — nothing else moves.

## File map

| File | Change |
| --- | --- |
| `src/sandbox/SandboxPanel.tsx` (+ `.test.tsx`) | `defaultOpen` prop: open from the first paint, toggle not rendered |
| `src/components/paycheck/TryItPanel.tsx` (+ test), `src/components/paycheck/pace.css` | `defaultOpen`, eyebrow "Try changes — …", Employer match → `Disclosure` |
| `src/components/taxes/WhatIfPanel.tsx` (+ test) | `defaultOpen`, eyebrow "What-if — YYYY" |
| `src/pages/PaycheckPage.tsx` / `.css` / `.test.tsx` | summary card-grid, household delta (no orphan), profiles intro / fieldset order / split disclosure, sticky columns, `defaultOpen` |
| `src/pages/CompPage.tsx` / `.css` / `.test.tsx`, `src/components/comp/VestingSchedulePanel.tsx` | column-set toggle, strip off Manage, sticky columns, vest-scroll clamp, Manage doors |
| `src/pages/EsppPage.tsx` / `.css` / `.test.tsx`, `src/components/espp/PositionStrip.tsx` (+ test) | `kpi-row-5`, field-attached hints, "Purchase model" eyebrow, Purchase model door, sticky columns |
| `src/components/taxes/taxSections.ts` (new) | `TaxSection` type shared by the panels and the page |
| `src/components/taxes/SummaryPanel.tsx`, `MarginalPanel.tsx` (+ tests) | view names instead of "below", "Open Tax tables" door |
| `src/components/taxes/WithholdingPanel.tsx` (+ test) | methodology `Disclosure`, `sentence()`, doors, view names |
| `src/components/taxes/BracketsEditor.tsx` (+ test), `src/components/taxes/taxes.css` | "Editing tables for" eyebrow, `.bracket-grid` / `.bracket-group`, helper paragraph once |
| `src/components/taxes/InputsForm.tsx` (+ test), `src/components/taxes/taxes.css` | 40ch label track, hover wash, sticky `entry-footer` save bar |
| `src/components/taxes/TaxYearMenu.tsx` (new), `src/pages/TaxesPage.tsx` / `.css` / `.test.tsx`, `src/components/taxes/taxes.css` | scope row (year chips + filing status), "New tax year…" popover with arm-and-confirm delete, MFS caveat as subheader, year card removed, `goTo` threading |

---

## Task 0 — preflight (no commit)

**Files:** none modified.

- [ ] **Step 1: Confirm the worktree and branch**

Run: `git rev-parse --abbrev-ref HEAD && git status --short | head`
Expected: `polish/p3-income` and an empty status. If the worktree does not exist yet, from the
main checkout: `git worktree add .worktrees/polish-p3 -b polish/p3-income main`, then work from
`.worktrees/polish-p3`.

- [ ] **Step 2: Confirm the F1/F2 primitives are on this branch**

Run:
```bash
ls src/components/Disclosure.tsx src/components/usePopoverDismiss.ts src/components/useScrollEdges.ts
grep -n "sections" src/components/shell/PageFrame.tsx | head -3
grep -n "kpi-row-5\|popover-surface\|td.row-actions\|col-identity" src/components/panels.css | head
grep -n "export" src/components/Disclosure.tsx src/components/usePopoverDismiss.ts src/components/useScrollEdges.ts
grep -n "sections=" src/pages/PaycheckPage.tsx src/pages/CompPage.tsx src/pages/EsppPage.tsx src/pages/TaxesPage.tsx
```
Expected: all three files listed; `sections` appears in PageFrame; the four panels.css selectors
each match; the export lines show the shapes in the Contracts block (default `Disclosure`, named
hooks); every page has exactly one `sections=` line. **If anything is missing, stop and report to
the lead — do not implement the primitive in a shared file.** Read the three primitive files
(they are short) so the prop names in the tasks below are checked against the real thing.

- [ ] **Step 3: Baseline — the lane's tests are green before the first edit**

Run: `npx vitest run src/pages/PaycheckPage.test.tsx src/pages/CompPage.test.tsx src/pages/EsppPage.test.tsx src/pages/TaxesPage.test.tsx src/components/paycheck src/components/comp src/components/espp src/components/taxes src/sandbox`
Expected: `Test Files  N passed`, `Tests  N passed`, no failures. Note N for the hand-off.

---

## Task 1 — `SandboxPanel` gains `defaultOpen`

**Files:**
- Modify: `src/sandbox/SandboxPanel.tsx`
- Test: `src/sandbox/SandboxPanel.test.tsx`

- [ ] **Step 1: Write the failing test** — append inside `describe('SandboxPanel', …)`:

```tsx
  it('defaultOpen: open from the first paint, no open/close toggle, Reset still there', () => {
    const sb = sandbox()
    // The page hands `open: false` (its own state) — defaultOpen wins, and the closed hint is
    // never drawn: the tab click WAS the ask (2026-09-13 polish spec §8).
    const onToggle = mount(sb, { open: false, defaultOpen: true, closedHint: <p>Try a scenario.</p> })
    expect(screen.queryByRole('button', { name: /^(Try it|Close)$/ })).toBeNull()
    expect(screen.queryByText('Try a scenario.')).toBeNull()
    expect(screen.getByTestId('controls')).toBeTruthy()
    expect(screen.getByTestId('compare')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reset to actual' }))
    expect(sb.reset).toHaveBeenCalledTimes(1)
    expect(onToggle).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run it — it fails**

Run: `npx vitest run src/sandbox/SandboxPanel.test.tsx -t "defaultOpen"`
Expected: `Tests  1 failed` — the "Try it" toggle is found and/or `controls` is missing (and
`tsc` would reject the unknown `defaultOpen` prop).

- [ ] **Step 3: Implement** — in `src/sandbox/SandboxPanel.tsx`:

Add the prop to `SandboxPanelProps` (after `toggleLabels`):
```tsx
  /** The panel is the sole content of its own tab (2026-09-13 polish spec §8): it renders open
   *  from the first paint and the open/close toggle is not rendered — the tab click was the ask.
   *  "Reset to actual" stays. The page's `open` is still honoured when it is true (the URL-entries
   *  arrival latch keeps working unchanged); `defaultOpen` only ever ADDS openness. */
  defaultOpen?: boolean
```
Destructure it (`defaultOpen = false,` right after `toggleLabels = { open: 'Try it', close: 'Close' },`)
and replace the component's `return (…)` with:
```tsx
  // One truth for "is the card open": the page's state, or the tab-owns-it flag.
  const isOpen = defaultOpen || open
  return (
    <section className="card sandbox-card">
      <div className="sandbox-header">
        <h2 className="eyebrow">
          {eyebrow}
          <InfoHint text={hint} />
        </h2>
        <div className="sandbox-header-actions">
          {isOpen && (
            <button type="button" className="button" disabled={sandbox.empty} onClick={sandbox.reset}>
              {resetLabel}
            </button>
          )}
          {/* No second gate on a tab that IS the sandbox: the toggle only exists where the card
              shares a page with other content. */}
          {!defaultOpen && (
            <button type="button" className="button" aria-expanded={isOpen} onClick={onToggle}>
              {isOpen ? toggleLabels.close : toggleLabels.open}
            </button>
          )}
        </div>
      </div>
      {!isOpen ? (
        closedHint
      ) : (
        <>
          {presets}
          <div className="sandbox-controls">{children}</div>
          <Feed
            data={sandbox.result}
            error={sandbox.error}
            busy={sandbox.busy}
            staleNoun={staleNoun}
            skeleton={{ height: skeletonHeight, label: 'Running the scenario…' }}
          >
            {() => <>{compare}</>}
          </Feed>
          {!hidePins && <PinRow sandbox={sandbox} />}
          {!sandbox.empty && apply !== undefined && <div className="sandbox-apply">{apply}</div>}
        </>
      )}
    </section>
  )
```
In the file's header comment, after "a header toggle with aria-expanded" add
"(omitted under `defaultOpen`, where the tab is the gate — 2026-09-13 polish spec §8)".

- [ ] **Step 4: Run the file — all green**

Run: `npx vitest run src/sandbox/SandboxPanel.test.tsx`
Expected: `Tests  7 passed` (6 existing + the new one).

- [ ] **Step 5: Commit**

```bash
git add src/sandbox/SandboxPanel.tsx src/sandbox/SandboxPanel.test.tsx
git commit -m "feat(sandbox): SandboxPanel defaultOpen — open from the first paint, no toggle (spec §8)"
```

---
## Task 2 — `TryItPanel`: `defaultOpen`, tab-aligned eyebrow, Employer match as a `Disclosure`

**Files:**
- Modify: `src/components/paycheck/TryItPanel.tsx` (props ~L111-125, state ~L117, SandboxPanel props ~L232-236, the `<details className="sandbox-disclosure">` block ~L355-364)
- Modify: `src/components/paycheck/pace.css` (append one rule)
- Test: `src/components/paycheck/TryItPanel.test.tsx`

- [ ] **Step 1: Update the two pinned strings and write the failing test**

In `TryItPanel.test.tsx`:
1. Line ~134 (test "mounts closed and spends no request…"): change
   `screen.getByRole('heading', { name: /Try it — effective Jan 1, 2026/ })` to
   `screen.getByRole('heading', { name: /Try changes — effective Jan 1, 2026/ })`.
2. Line ~343 (test "offers the match policy as knobs, under its own disclosure"): replace
   `expect(screen.getByText('Employer match')).toBeTruthy()` with
   ```tsx
    // The shared primitive (2026-09-13 polish spec §11), named as the advanced knob group it is.
    const summary = screen.getByText('Employer match (advanced)')
    expect(summary.closest('details')?.classList.contains('disclosure')).toBe(true)
   ```
3. Append inside `describe('TryItPanel', …)`:
```tsx
  it('defaultOpen mounts the card open with no toggle, keeps Reset, and runs at once', async () => {
    render(
      <MemoryRouter initialEntries={['/paycheck']}>
        <TryItPanel profileId={null} personId={null} breakdown={breakdown} onApply={vi.fn()} defaultOpen />
      </MemoryRouter>,
    )
    // The Try changes tab IS the sandbox (2026-09-13 polish spec §8): no "Try it" gate, no Close.
    expect(screen.queryByRole('button', { name: /^(Try it|Close)$/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reset to actual' })).toBeTruthy()
    // The eyebrow reads like the tab it lives on — not a third name for one thing (audit C2).
    expect(screen.getByRole('heading', { name: /Try changes — effective Jan 1, 2026/ })).toBeTruthy()
    await waitFor(() =>
      expect(previewPaycheck).toHaveBeenCalledWith({ profile_id: null, person_id: null, overrides: {} }),
    )
  })
```

- [ ] **Step 2: Run the file — three tests fail**

Run: `npx vitest run src/components/paycheck/TryItPanel.test.tsx`
Expected: `Tests  3 failed` (the heading regex, the disclosure summary, the new defaultOpen test).

- [ ] **Step 3: Implement**

`TryItPanel.tsx` — add the import (with the other component imports, after `import Segmented from '../shell/Segmented'`):
```tsx
import Disclosure from '../Disclosure'
```
Props + state (replace the signature and the first two state lines):
```tsx
export default function TryItPanel({
  profileId,
  personId,
  breakdown,
  onApply,
  defaultOpen = false,
}: {
  /** The page's two selectors — exactly what GET /breakdown was asked with. */
  profileId: number | null
  personId: number | null
  /** The check on screen: its profile is the base, its pace rows carry the limits. */
  breakdown: PaycheckBreakdownOut
  /** Apply: the page pre-fills its profile form with this seed. */
  onApply: (seed: ApplySeed) => void
  /** The Try changes tab mounts this card as its sole content (2026-09-13 polish spec §8): open
   *  from the first paint, with no open/close toggle. The URL-entries latch below still runs. */
  defaultOpen?: boolean
}) {
  const [params] = useSearchParams()
  // Arriving with entries opens the panel (spec §6); a tab that IS the sandbox opens it too
  // (2026-09-13 polish spec §8); otherwise closed by default (§8.1).
  const entriesKey = readEntries(params).join(SEP)
  const [open, setOpen] = useState(defaultOpen || entriesKey !== '')
```
`<SandboxPanel …>` props — change the eyebrow and add the flag:
```tsx
      eyebrow={`Try changes — effective ${formatDate(profile.effective_date)}`}
      hint="Move a percentage or an amount and see the check the server computes for it, against the profile shown above — nothing is saved."
      open={open}
      onToggle={() => setOpen((o) => !o)}
      defaultOpen={defaultOpen}
```
Replace the `<details className="sandbox-disclosure">…</details>` block with:
```tsx
      {/* Behind a disclosure because the match is a POLICY that changes once a year, not a
          knob to drag — but it is the one input the 415(c) row cannot be reasoned about
          without, so it is here rather than only on the profile form. The shared primitive
          (2026-09-13 polish spec §11); the class spans the knob grid (pace.css). */}
      <Disclosure summary="Employer match (advanced)" className="tryit-disclosure">
        <div className="sandbox-disclosure-grid">
          <SliderBox id="tryit-match-rate-1" label="First match rate" kind="percent" value={scenario.match_rate_1 ?? ''} actual={profile.match_rate_1} min="0" max={KNOB_MAX.match_rate_1} step="0.05" onChange={knob('match_rate_1')} />
          <BoxKnob id="tryit-match-band-1" label="First match band" kind="money" value={scenario.match_band_1 ?? ''} actual={profile.match_band_1} validate={(text) => (acceptKnob('match_band_1', text) ? null : 'First match band must be a plain amount, like 6000')} onCommit={knob('match_band_1')} />
          <SliderBox id="tryit-match-rate-2" label="Second match rate" kind="percent" value={scenario.match_rate_2 ?? ''} actual={profile.match_rate_2} min="0" max={KNOB_MAX.match_rate_2} step="0.05" onChange={knob('match_rate_2')} />
          <BoxKnob id="tryit-match-band-2" label="Second match band" kind="money" value={scenario.match_band_2 ?? ''} actual={profile.match_band_2} validate={(text) => (acceptKnob('match_band_2', text) ? null : 'Second match band must be a plain amount, like 11000')} onCommit={knob('match_band_2')} />
        </div>
      </Disclosure>
```
`pace.css` — append:
```css
/* ── Try changes: the match policy's disclosure ─────────────────────── */

/* The disclosure spans the sandbox's knob grid; its four boxes lay out in their own grid inside
   (.sandbox-disclosure-grid, sandbox.css). Declared HERE, not in sandbox.css: that sheet is the
   sandbox lane's, and TryItPanel is the one card that mounts this disclosure. */
.tryit-disclosure {
  grid-column: 1 / -1;
}
```

- [ ] **Step 4: Run the file — all green**

Run: `npx vitest run src/components/paycheck/TryItPanel.test.tsx && npx tsc -b`
Expected: every test passes (the file gains one), `tsc` silent.

- [ ] **Step 5: Commit**

```bash
git add src/components/paycheck/TryItPanel.tsx src/components/paycheck/TryItPanel.test.tsx src/components/paycheck/pace.css
git commit -m "feat(paycheck): Try changes opens on its tab; Employer match is a Disclosure (spec §8, §11)"
```

---

## Task 3 — `WhatIfPanel`: `defaultOpen` and the "What-if — YYYY" eyebrow

**Files:**
- Modify: `src/components/taxes/WhatIfPanel.tsx` (props ~L118-138, open state ~L143-146, SandboxPanel props ~L375-380)
- Test: `src/components/taxes/WhatIfPanel.test.tsx`

- [ ] **Step 1: Update the pinned eyebrow and write the failing test**

In `WhatIfPanel.test.tsx`, line ~490 (test "…re-keys…"): change
`screen.getByRole('heading', { name: /What if — 2025/ })` to
`screen.getByRole('heading', { name: /What-if — 2025/ })`. Then append inside `describe('WhatIfPanel', …)`:
```tsx
  it('defaultOpen mounts the card open with no toggle and loads its feeds at once', async () => {
    mount('/taxes', { defaultOpen: true })
    // The What-if tab IS the sandbox (2026-09-13 polish spec §8): no Open/Close gate, and the
    // eyebrow reads like the tab (audit C2).
    expect(screen.queryByRole('button', { name: /^(Open|Close) what-if$/ })).toBeNull()
    expect(screen.getByRole('heading', { name: /What-if — 2024/ })).toBeTruthy()
    await waitFor(() => expect(addSale()).toBeTruthy())
    expect(vi.mocked(fetchHoldings)).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Reset to actual' })).toBeTruthy()
  })
```

- [ ] **Step 2: Run the file — two tests fail**

Run: `npx vitest run src/components/taxes/WhatIfPanel.test.tsx`
Expected: `Tests  2 failed` (the heading regex and the new test).

- [ ] **Step 3: Implement**

Props (add after `onApplyOverrides` in both the destructuring and the type):
```tsx
  onApplyOverrides,
  defaultOpen = false,
}: {
  …
  onApplyOverrides?: (overrides: Record<string, string | null>, changed: ChangedInput[]) => void
  /** The What-if tab mounts this card as its sole content (2026-09-13 polish spec §8): open from
   *  the first paint, no open/close toggle. The three feeds still load lazily — on this mount,
   *  which LocalSectionPanel only performs on the tab's first visit. */
  defaultOpen?: boolean
}) {
```
Open state:
```tsx
  // Arriving with a scenario opens the card (spec §6); so does a tab that IS the sandbox
  // (2026-09-13 polish spec §8); otherwise it mounts closed (§8.1).
  const entriesKey = readEntries(params).join(SEP)
  const [open, setOpen] = useState(
    defaultOpen || entriesKey !== '' || legacy.ticker !== null || legacy.lotId !== null,
  )
```
`<SandboxPanel …>` props:
```tsx
      eyebrow={`What-if — ${year}`}
      hint="Model prospective sales or input changes against this year's stored return — nothing is saved."
      open={open}
      onToggle={toggle}
      defaultOpen={defaultOpen}
```

- [ ] **Step 4: Run the file — all green**

Run: `npx vitest run src/components/taxes/WhatIfPanel.test.tsx && npx tsc -b`
Expected: every test passes (the file gains one), `tsc` silent.

- [ ] **Step 5: Commit**

```bash
git add src/components/taxes/WhatIfPanel.tsx src/components/taxes/WhatIfPanel.test.tsx
git commit -m "feat(taxes): What-if opens on its tab; eyebrow matches the tab label (spec §8)"
```

---
## Task 4 — Paycheck Summary: breakdown beside its flow, household legs in the tile, Try changes open

**Files:**
- Modify: `src/pages/PaycheckPage.tsx` (`BreakdownPanel` ~L87-150, `FlowPanel` ~L161-186, household strip ~L1441-1458, summary panel ~L1490-1494, `TryItPanel` mount ~L1496-1510)
- Modify: `src/pages/PaycheckPage.css`
- Test: `src/pages/PaycheckPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add the import at the top of `PaycheckPage.test.tsx` (after the `PaycheckPage` import):
```tsx
import { expectInDocumentOrder } from '../testing/domOrder'
```
Append inside `describe('PaycheckPage — the flow card', …)`:
```tsx
  it('lays the breakdown beside the flow in a card grid, with the pace strip full width beneath', async () => {
    render(<MemoryRouter initialEntries={['/paycheck?section=summary']}><PaycheckPage /></MemoryRouter>)
    await screen.findByText('$3,384.16')

    // 2026-09-13 polish spec §12 (audit W1: the waterfall used 41% of a full-width card).
    const grid = document.querySelector('.paycheck-summary-grid') as HTMLElement
    expect(grid.classList.contains('card-grid')).toBe(true)
    const children = Array.from(grid.children)
    expect(children).toHaveLength(2)
    expect(children[0].classList.contains('card')).toBe(true)
    expect(children[0].classList.contains('span-6')).toBe(true)
    expect(children[0].textContent).toContain('Per-check breakdown')
    // ChartCard mounts through ChartSurface: the grid child is its span-6 slot, the card inside.
    expect(children[1].classList.contains('span-6')).toBe(true)
    expect(children[1].querySelector('.chart-card')?.textContent).toContain('Where each check goes')
    // The pace strip is NOT in the grid: it keeps the full width under the pair.
    const pace = screen.getByRole('region', { name: 'Contribution pace' })
    expect(grid.contains(pace)).toBe(false)
    expectInDocumentOrder(grid, pace)
  })
```
Append inside `describe('PaycheckPage — two earners (2026-08-27 spec §5)', …)`:
```tsx
  it('prints each person’s take-home in the household tile’s delta, with no orphan caption', async () => {
    twoEarners()
    render(<MemoryRouter initialEntries={['/paycheck?section=summary']}><PaycheckPage /></MemoryRouter>)
    // The legs are the profiles in force: mine at $6,768.33 a month, Sam's at $5,231.34.
    const tile = (await screen.findByText('Household take-home')).closest('.stat-tile') as HTMLElement
    expect(tile.textContent).toContain('$11,999.67')
    expect(tile.querySelector('.stat-delta')?.textContent).toBe('Me $6,768.33 · Sam $5,231.34')
    // The caption that floated under the tile on the page background is gone (spec §10, audit T1).
    expect(screen.queryByText(/the profile in force for each person/)).toBeNull()
    expect(document.querySelector('.paycheck-household .drill-hint')).toBeNull()
  })
```

- [ ] **Step 2: Run the two tests — both fail**

Run: `npx vitest run src/pages/PaycheckPage.test.tsx -t "card grid|orphan caption"`
Expected: `Tests  2 failed` (`.paycheck-summary-grid` is null; the delta is absent and the caption present).

- [ ] **Step 3: Implement**

`PaycheckPage.tsx`:

1. `BreakdownPanel` — the root becomes a half-width grid card:
```tsx
function BreakdownPanel({ data, still }: { data: PaycheckBreakdownOut; still: boolean }) {
  return (
    <section className="card span-6">
```
2. `FlowPanel` — the ChartCard takes the other half. Add `span={6}` after `height={320}`, and
   fix the footer comment's "the table below" to "the table beside it":
```tsx
      height={320}
      // Half the summary grid, beside the waterfall it draws (2026-09-13 polish spec §12).
      span={6}
      // The legend describes the CHART, so it goes when the chart does: under the empty
      // sentence it was explaining node colours and a hover affordance for a sankey that
      // is not on the page (the table beside it is the surface to read instead).
```
3. Household strip — replace the whole `<section className="paycheck-household">…</section>`:
```tsx
            <section className="paycheck-household">
              <div className="kpi-row kpi-row-lone">
                <StatTile
                  label="Household take-home"
                  value={formatCurrency(householdTotal)}
                  // The legs under the total (2026-09-13 polish spec §10; audit T1): the caption
                  // "Edward + Grace — the profile in force for each person." that floated under
                  // this tile on the page background is gone, and the per-person figures it
                  // alluded to are printed in the tile's own delta slot, the way ESPP prints
                  // "6 lots". Neutral: a level, not a movement.
                  delta={householdNets
                    .map((leg) => `${leg.name} ${formatCurrency(leg.monthlyNet)}`)
                    .join(' · ')}
                  tone="neutral"
                  evidence={metricReceipt({ id: 'household_take_home', label: 'Household take-home', value: householdTotal,
                    definition: 'Sum of monthly net estimates for the paycheck profile currently in force for each person. A person without an in-force profile is omitted.',
                    completeness: 'estimate', source_link: '/paycheck?section=summary',
                    components: householdNets.map(leg => ({ label: leg.name, value: leg.monthlyNet, unit: 'USD' })) })}
                  hint="The monthly net of the profile IN FORCE for each person, added together. It ignores the chip and any pinned row — it is always the whole household — and a person with no profile in force is not counted. Each person has their own profile timeline. The waterfall, the flow beside it and the history in Profiles all follow the chip; the household figure does not — it is always both of you."
                />
              </div>
            </section>
```
4. Summary panel — replace the three stacked children:
```tsx
              <LocalSectionPanel state={views} section="summary">
                {/* Breakdown beside its flow (2026-09-13 polish spec §12): the eleven lines and
                    the sankey that draws them are one story, read side by side; the pace strip
                    keeps the full width beneath. .card-grid collapses to one column under 1000px. */}
                <div className="card-grid paycheck-summary-grid">
                  <BreakdownPanel data={data} still={fromCache} />
                  <FlowPanel data={data} />
                </div>
                <PacePanel items={data.pace} />
              </LocalSectionPanel>
```
5. `TryItPanel` mount — add `defaultOpen` (the changes tab is the sandbox, spec §8):
```tsx
                <TryItPanel
                  profileId={selection.profileId}
                  personId={selection.personId}
                  breakdown={data}
                  defaultOpen
                  onApply={(seed) => {
```

`PaycheckPage.css`:
- Replace the "The household figure" block's second rule: delete
  `.paycheck-household .drill-hint { margin: 0.4rem 0 0; }` (the paragraph is gone) and reword the
  comment above `.paycheck-household` to "A sibling of the scope row's person chips, not part of
  the per-person card below it. The per-person legs ride the tile's delta (2026-09-13 polish spec §10)."
- Append after the waterfall section:
```css
/* ── The summary grid ──────────────────────────────────────────────── */

/* Breakdown beside its flow (2026-09-13 polish spec §12). The page's per-card bottom margin
   would add to the grid gap inside the pair — and the flow card sits one level down, inside
   ChartSurface's slot — so every card in the grid drops it; the grid carries the spacing. */
.paycheck-summary-grid {
  margin-bottom: 1rem;
}

.paycheck-summary-grid .card {
  margin-bottom: 0;
}
```

- [ ] **Step 4: Run the file — all green**

Run: `npx vitest run src/pages/PaycheckPage.test.tsx && npx tsc -b`
Expected: every test passes (the file gains two), `tsc` silent.

- [ ] **Step 5: Commit**

```bash
git add src/pages/PaycheckPage.tsx src/pages/PaycheckPage.css src/pages/PaycheckPage.test.tsx
git commit -m "feat(paycheck): breakdown beside its flow, household legs in the tile, Try changes open (spec §8, §10, §12)"
```

---

## Task 5 — Paycheck Profiles: two-sentence intro, policies first, split behind a `Disclosure`, sticky table edges

**Files:**
- Modify: `src/pages/PaycheckPage.tsx` (`ProfilesPanel` heading/intro ~L695-706, form ~L714-855, history table ~L856-980)
- Modify: `src/pages/PaycheckPage.css`
- Test: `src/pages/PaycheckPage.test.tsx`

- [ ] **Step 1: Write the failing tests** — append inside `describe('PaycheckPage — the profile form', …)`:

```tsx
  it('folds the optional withholding split behind a disclosure, after the employer policies', async () => {
    render(<MemoryRouter initialEntries={['/paycheck?section=profiles']}><PaycheckPage /></MemoryRouter>)
    await screen.findByLabelText('Effective date')

    // 2026-09-13 polish spec §11 / audit W8: the optional, usually-blank policy no longer sits
    // between the pay figures and the deductions.
    const details = screen.getByText('Withholding split (optional)').closest('details') as HTMLDetailsElement
    expect(details.classList.contains('disclosure')).toBe(true)
    // Blank for this household, so it starts shut — the boxes are still reachable by label.
    expect(details.open).toBe(false)
    expect(details.contains(field('Federal withholding %'))).toBe(true)
    // Order: match, employer HSA, then the split.
    expectInDocumentOrder(
      screen.getByText('Employer 401(k) match'),
      screen.getByText('Employer HSA contribution'),
      details,
    )
    // The intro is two sentences; the percent/fraction rule moved into the heading's hint.
    expect(screen.getByText(/One row per comp change, newest first\./).textContent).not.toContain('Percentages')
  })

  it('opens the split disclosure when the row it seeds from stores a split', async () => {
    vi.mocked(fetchProfiles).mockResolvedValue([
      { ...profile2026, fed_withholding_pct: '0.180000000', state_withholding_pct: '0.060000000' },
      profile2025,
    ])
    render(<MemoryRouter initialEntries={['/paycheck?section=profiles']}><PaycheckPage /></MemoryRouter>)
    await screen.findByLabelText('Effective date')
    // The carry-forward form copies the latest row's split, so the disclosure opens with it.
    const details = screen.getByText('Withholding split (optional)').closest('details') as HTMLDetailsElement
    expect(details.open).toBe(true)
    expect(field('Federal withholding %').value).toBe('18%')
  })

  it('pins the identity column and the row actions of the history scroller (spec §7)', async () => {
    render(<MemoryRouter initialEntries={['/paycheck?section=profiles']}><PaycheckPage /></MemoryRouter>)
    await screen.findByLabelText('Effective date')
    const table = document.querySelector('.paycheck-scroll .data-table') as HTMLTableElement
    expect(table.querySelector('thead th.col-identity')?.textContent).toBe('Effective')
    const row = screen.getByRole('button', { name: 'Show the breakdown for Jan 1, 2026' }).closest('tr') as HTMLTableRowElement
    expect(row.querySelector('td.col-identity')).toBeTruthy()
    expect(row.querySelector('td.row-actions')).toBeTruthy()
  })
```
(`field`, `profile2026`, `profile2025` and `expectInDocumentOrder` already exist in the file.)

- [ ] **Step 2: Run the three tests — all fail**

Run: `npx vitest run src/pages/PaycheckPage.test.tsx -t "withholding split behind|opens the split disclosure|pins the identity"`
Expected: `Tests  3 failed` ("Withholding split (optional)" is a `<legend>`, not a `<details>` summary; no `.col-identity`).

- [ ] **Step 3: Implement**

`PaycheckPage.tsx` — imports (add with the other component imports):
```tsx
import Disclosure from '../components/Disclosure'
import { useScrollEdges } from '../components/useScrollEdges'
```
Inside `ProfilesPanel`, after `const [busy, setBusy] = useState(false)`:
```tsx
  // The history scroller's edge cue (data-scroll-more, 2026-09-13 polish spec §7) — the shared
  // hook; a null ref (no rows yet, no table) is a no-op.
  const scrollRef = useRef<HTMLDivElement>(null)
  useScrollEdges(scrollRef)
```
Heading + intro (replace the `<h2>` and the `<p className="drill-hint">` under it):
```tsx
      <h2 className="eyebrow">
        Profile history
        <InfoHint text="One profile per comp change; the breakdown uses the profile in force today unless a row is pinned. Percentages are entered as percents (13 = 13%) and stored as fractions with nine decimal places; withholding is a tax rather than a contribution, so it is not part of the 100% check." />
      </h2>
      {/* Two sentences (2026-09-13 polish spec §14; audit C7): the percent/fraction rule the
          intro used to repeat lives in the heading's hint, once. */}
      <p className="drill-hint">
        One row per comp change, newest first. A new profile starts as a copy of the current
        one — change what moved and give it the date it takes effect on.
      </p>
```
Form body — MOVE the `<fieldset className="paycheck-match"><legend>Withholding split (optional)</legend>…</fieldset>`
block out from between the `PCT_FIELDS` loop and the Dental & vision label, and put the following
in its place AFTER the "Employer HSA contribution" fieldset and BEFORE the Notes label:
```tsx
        {/* The all-in rate's optional split, LAST and behind a disclosure (2026-09-13 polish
            spec §11; audit W8): it is blank for most rows until a paystub says otherwise, and
            sitting between the pay figures and the deductions it split the primary fields.
            Keyed on the row being edited, so a stored split opens it and a new row without one
            starts shut; defaultOpen is read once per key, which is exactly that. */}
        <Disclosure
          key={editingId ?? 'new'}
          summary="Withholding split (optional)"
          className="paycheck-split"
          defaultOpen={form.fed_withholding_pct !== '' || form.state_withholding_pct !== ''}
        >
          <div className="paycheck-match paycheck-split-grid">
            {OPTIONAL_PCT_FIELDS.map(({ field, label }) => (
              <label key={field}>
                {label}
                <AmountInput kind="percent" value={form[field]} onValueChange={set(field)} />
              </label>
            ))}
            <p className="paycheck-match-words">{WITHHOLDING_SPLIT_HINT}</p>
          </div>
        </Disclosure>
```
History table — the scroller takes the ref and the identity column gets its class:
```tsx
        <div className="paycheck-scroll" ref={scrollRef}>
          <table className="data-table">
            <thead>
              <tr>
                {/* Sticky left, the actions sticky right (panels.css, spec §7): the identity and
                    the row's controls frame a scrollable middle at every width. */}
                <th className="col-identity">Effective</th>
```
and the date cell:
```tsx
                  <td className="col-identity">
                    {/* The date cell IS the selector: pressing it moves the waterfall
```
(the `<td className="row-actions">` already exists — leave it.)

`PaycheckPage.css` — append after the `.paycheck-form .paycheck-match legend` rules:
```css
/* The optional split behind a disclosure (2026-09-13 polish spec §11): the <details> spans the
   form grid like the fieldsets do; its body reuses the fieldset's inner grid without the rule
   around it, because the disclosure's own summary row already frames it. */
.paycheck-form .paycheck-split {
  grid-column: 1 / -1;
}

.paycheck-form .paycheck-split-grid {
  border: 0;
  padding: 0.25rem 0 0;
}
```

- [ ] **Step 4: Run the file — all green**

Run: `npx vitest run src/pages/PaycheckPage.test.tsx && npx tsc -b`
Expected: every test passes (the file gains three; the existing split tests — blank posts null,
entered split carries forward, split shown in the table, 0–100 fence — still pass because the
boxes keep their labels), `tsc` silent.

- [ ] **Step 5: Commit**

```bash
git add src/pages/PaycheckPage.tsx src/pages/PaycheckPage.css src/pages/PaycheckPage.test.tsx
git commit -m "feat(paycheck): profiles — split behind a Disclosure, policies first, two-sentence intro, sticky table edges (spec §7, §11, §14)"
```

---
## Task 6 — Comp: column sets, sticky edges, strip off Manage, vest-scroll clamp, Manage doors

**Files:**
- Modify: `src/pages/CompPage.tsx` (imports L1-30, `EventsPanel` ~L119-500, page ~L576-672)
- Modify: `src/pages/CompPage.css` (`.vest-scroll` ~L132-135, new `.comp-column-set`)
- Modify: `src/components/comp/VestingSchedulePanel.tsx` (props ~L172, footer ~L239-270)
- Test: `src/pages/CompPage.test.tsx`

- [ ] **Step 1: Update the three tests the column set and the strip change, and write the new ones**

1. Test "renders the stored and computed columns from the server, nothing re-derived" (~L322) — replace its body:
```tsx
    render(<MemoryRouter initialEntries={['/comp?section=manage']}><CompPage /></MemoryRouter>)

    // Entered first — the default set (2026-09-13 polish spec §7): the typed columns and the note.
    expect(await screen.findByText('FY26 refresh')).toBeTruthy()
    expect(screen.getByText('1,822')).toBeTruthy() // unvested RSUs
    expect(screen.getByText('$183.25')).toBeTruthy() // unvested price
    expect(screen.queryByText('$601,854.46')).toBeNull() // tc_after waits for Computed or All

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByText('$601,854.46')).toBeTruthy() // 2026 tc_after
    expect(screen.getByText('$495,882.96')).toBeTruthy() // 2026 tc_before
    expect(screen.getByText('$333,882.96')).toBeTruthy() // unvested equity
    expect(screen.getByText('$79,041.50')).toBeTruthy() // equity delta
    expect(screen.getByText('$26,930.00')).toBeTruthy() // base delta
    expect(screen.getByText('+16.6%')).toBeTruthy() // base delta pct
    expect(screen.getByText('+23.7%')).toBeTruthy() // equity delta pct

    // ...and 2024's own row, so the table is not showing one event twice.
    expect(screen.getByText('$411,078.00')).toBeTruthy()
    expect(screen.getByText('$224,150.00')).toBeTruthy()
```
2. Test "renders "—" for every null computed column of a bare year" (~L341) — replace its body:
```tsx
    vi.mocked(fetchEvents).mockResolvedValue([event2027])
    render(<MemoryRouter initialEntries={['/comp?section=manage']}><CompPage /></MemoryRouter>)

    // Entered: new_base, unvested_rsus, unvested_price, refresh_rsus, grant_price, notes.
    expect(await screen.findAllByText('$188,930.00')).toHaveLength(1) // the base alone
    expect(screen.getAllByText('—')).toHaveLength(6)

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    // tc_before / tc_after are never null, so they still carry figures.
    expect(screen.getAllByText('$188,930.00')).toHaveLength(3) // base + both TCs
    // ...plus base_delta, base_delta_pct, unvested_equity, equity_delta, equity_delta_pct.
    expect(screen.getAllByText('—')).toHaveLength(11)
```
3. Test "surfaces the vest tiles at the page top, above the focal history (2026-08-31 audit)" (~L820) — replace the whole test:
```tsx
  it('keeps the vest tiles off Manage and above the chart on Summary (2026-09-13 polish spec §12)', async () => {
    vi.mocked(fetchVestingSchedule).mockResolvedValue(SCHEDULE)
    render(<MemoryRouter initialEntries={['/comp?section=manage']}><CompPage /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Focal history' })
    // The tiles have no bearing on the two forms, so Manage does not draw the strip.
    expect(screen.queryByText('Next vest')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Summary' }))
    const nextVest = await screen.findByText('Next vest')
    expectInDocumentOrder(nextVest, screen.getByText('Base + unvested equity value'))
  })
```
4. Append inside `describe('CompPage — events table', …)`:
```tsx
  it('shows the entered columns by default and reveals the computed ones on demand', async () => {
    render(<MemoryRouter initialEntries={['/comp?section=manage']}><CompPage /></MemoryRouter>)
    await screen.findByText('FY26 refresh')
    const headers = () => [...document.querySelectorAll('.comp-scroll thead th')].map((th) => th.textContent)

    // Entered = what a reader typed, plus the note: nine columns fit 1440 without a scroll.
    expect(headers()).toEqual([
      'Year', 'Current base', 'New base', 'Unvested RSUs', 'Unvested price', 'Refresh RSUs',
      'Grant price', 'Notes', '',
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Computed' }))
    // Computed = the server's: base and equity deltas, unvested equity, total comp.
    expect(headers()).toEqual([
      'Year', 'Base delta', 'Base delta %', 'Unvested equity', 'Equity delta', 'Equity delta %',
      'TC before', 'TC after', '',
    ])
    expect(screen.queryByText('FY26 refresh')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(headers()).toHaveLength(16)
    // Year and the action cell frame the scroller whichever set is showing (spec §7).
    expect(document.querySelector('.comp-scroll thead th.col-identity')?.textContent).toBe('Year')
    expect(document.querySelector('.comp-scroll tbody td.col-identity')?.textContent).toBe('2024')
    expect(document.querySelector('.comp-scroll tbody td.row-actions')).toBeTruthy()
  })

  it('offers a Manage door under an empty trajectory, and it switches the view', async () => {
    vi.mocked(fetchEvents).mockResolvedValue([])
    render(<MemoryRouter initialEntries={['/comp?section=summary']}><CompPage /></MemoryRouter>)
    await screen.findByText('No comp events yet — add one in Manage.')
    fireEvent.click(screen.getByRole('button', { name: 'Add a comp event in Manage' }))
    expect(await screen.findByRole('heading', { name: 'Focal history' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Manage' }).getAttribute('aria-selected')).toBe('true')
  })
```
5. Append inside `describe('CompPage — vesting schedule', …)`:
```tsx
  it('offers a Manage door under an empty schedule, and it switches the view', async () => {
    vi.mocked(fetchVestingSchedule).mockResolvedValue(EMPTY_SCHEDULE)
    render(<MemoryRouter initialEntries={['/comp?section=vesting']}><CompPage /></MemoryRouter>)
    await screen.findByText('No grants yet — add one in Manage to see the schedule.')
    fireEvent.click(screen.getByRole('button', { name: 'Add a grant in Manage' }))
    expect(await screen.findByText('RSU grants')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Manage' }).getAttribute('aria-selected')).toBe('true')
  })
```

- [ ] **Step 2: Run the file — the six touched tests fail**

Run: `npx vitest run src/pages/CompPage.test.tsx`
Expected: `Tests  6 failed` (no "All"/"Computed" buttons, the strip still renders on Manage, no doors).

- [ ] **Step 3: Implement**

`CompPage.tsx` — imports: add
```tsx
import type { ReactNode } from 'react'
import Segmented from '../components/shell/Segmented'
import { useScrollEdges } from '../components/useScrollEdges'
```
Above `EventsPanel` (after `orphanWarnings`), add the column model:
```tsx
// ── Columns ─────────────────────────────────────────────────────────────────────────────

type ColumnSet = 'entered' | 'computed' | 'all'

const COLUMN_SETS = [
  { value: 'entered', label: 'Entered' },
  { value: 'computed', label: 'Computed' },
  { value: 'all', label: 'All' },
] as const

/**
 * One column of the focal-history table (2026-09-13 polish spec §7; audit X1: sixteen columns
 * parked Edit/Delete 461px past the scroller's edge at 1440). `kind` is what the column-set
 * toggle filters on: what a reader TYPED (the form's boxes and the note) against what the server
 * computed at read time (the deltas, unvested equity and total comp). Year and the action cell
 * are not in this list — they frame every set, sticky at either edge.
 */
interface EventColumn {
  key: string
  label: string
  kind: 'entered' | 'computed'
  numeric: boolean
  render: (event: CompEventOut) => ReactNode
  title?: (event: CompEventOut) => string | undefined
}

const EVENT_COLUMNS: readonly EventColumn[] = [
  { key: 'current_base', label: 'Current base', kind: 'entered', numeric: true, render: (e) => formatCurrency(e.current_base) },
  { key: 'new_base', label: 'New base', kind: 'entered', numeric: true, render: (e) => formatCurrency(e.new_base) },
  { key: 'base_delta', label: 'Base delta', kind: 'computed', numeric: true, render: (e) => formatCurrency(e.base_delta) },
  { key: 'base_delta_pct', label: 'Base delta %', kind: 'computed', numeric: true, render: (e) => formatPct(e.base_delta_pct) },
  { key: 'unvested_rsus', label: 'Unvested RSUs', kind: 'entered', numeric: true, render: (e) => formatShares(e.unvested_rsus) },
  { key: 'unvested_price', label: 'Unvested price', kind: 'entered', numeric: true, render: (e) => formatCurrency(e.unvested_price) },
  { key: 'unvested_equity', label: 'Unvested equity', kind: 'computed', numeric: true, render: (e) => formatCurrency(e.unvested_equity) },
  { key: 'refresh_rsus', label: 'Refresh RSUs', kind: 'entered', numeric: true, render: (e) => formatShares(e.refresh_rsus) },
  { key: 'grant_price', label: 'Grant price', kind: 'entered', numeric: true, render: (e) => formatCurrency(e.grant_price) },
  { key: 'equity_delta', label: 'Equity delta', kind: 'computed', numeric: true, render: (e) => formatCurrency(e.equity_delta) },
  { key: 'equity_delta_pct', label: 'Equity delta %', kind: 'computed', numeric: true, render: (e) => formatPct(e.equity_delta_pct) },
  { key: 'tc_before', label: 'TC before', kind: 'computed', numeric: true, render: (e) => formatCurrency(e.tc_before) },
  { key: 'tc_after', label: 'TC after', kind: 'computed', numeric: true, render: (e) => formatCurrency(e.tc_after) },
  // The cell ellipsises a long note (CompPage.css), so the full text is the hover title —
  // `undefined`, never null, or React would render a literal title="null" on every unnoted row.
  { key: 'notes', label: 'Notes', kind: 'entered', numeric: false, render: (e) => e.notes ?? '—', title: (e) => e.notes ?? undefined },
]
```
Inside `EventsPanel`, after `const [busy, setBusy] = useState(false)`:
```tsx
  // Which half of the table is showing (2026-09-13 polish spec §7). Entered by default: the
  // typed columns plus Notes fit a 1440 viewport with no horizontal scroll, so the actions stay
  // in view. A view choice, not a preference — not persisted.
  const [columnSet, setColumnSet] = useState<ColumnSet>('entered')
  const visibleColumns = EVENT_COLUMNS.filter(
    (column) => columnSet === 'all' || column.kind === columnSet,
  )
  // The scroller's edge cue (data-scroll-more) — the shared hook; null while no table renders.
  const scrollRef = useRef<HTMLDivElement>(null)
  useScrollEdges(scrollRef)
```
Heading hint and intro (replace the `<InfoHint>` text and the `<p className="drill-hint">` — the
old sentence "Everything to the right of the notes is computed" was wrong about the column order):
```tsx
        <InfoHint text="One row per focal year: base moves, grants, and the computed equity and TC deltas. Entered shows the typed columns, Computed the server's deltas, unvested equity and total comp, All both." />
      </h2>
      <p className="drill-hint">
        One row per focal year. The base is the salary the year started on and the new base
        is what it moved to — leave it blank for a year without a raise. RSU counts and
        their prices travel in pairs: the unvested pair values the equity already granted,
        the refresh pair values the new grant. The Computed columns — base and equity deltas,
        unvested equity, total comp — are the server&apos;s, computed at read time.
      </p>
```
Replace the whole `{events.length > 0 && (<div className="comp-scroll">…</div>)}` block:
```tsx
      {events.length > 0 && (
        <>
          <div className="comp-column-set">
            <span className="eyebrow">Columns</span>
            <Segmented
              variant="toggle"
              size="sm"
              ariaLabel="Focal history columns"
              options={COLUMN_SETS}
              value={columnSet}
              onChange={setColumnSet}
            />
          </div>
          <div className="comp-scroll" ref={scrollRef}>
            <table className="data-table">
              <thead>
                <tr>
                  {/* Year and the action cell frame every set: sticky left and right (panels.css,
                      2026-09-13 polish spec §7). */}
                  <th className="col-identity">Year</th>
                  {visibleColumns.map((column) => (
                    <th key={column.key} className={column.numeric ? 'num' : undefined}>
                      {column.label}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className={event.id === editingId ? 'is-editing' : undefined}>
                    <td className="col-identity">{event.focal_year}</td>
                    {/* Every figure is the server's, rendered as it arrived — the computed half is
                        comp_calc's and none of it is re-derived here (global rule 9). */}
                    {visibleColumns.map((column) => (
                      <td
                        key={column.key}
                        className={
                          column.numeric ? 'num' : column.key === 'notes' ? 'comp-notes-cell' : undefined
                        }
                        title={column.title?.(event)}
                      >
                        {column.render(event)}
                      </td>
                    ))}
                    <td className="row-actions">
                      <button
                        type="button"
                        className="button"
                        aria-label={`Edit the ${event.focal_year} comp event`}
                        onClick={() => startEdit(event)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="button"
                        aria-label={`Delete the ${event.focal_year} comp event`}
                        disabled={busy}
                        onClick={() => remove(event)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
```
Page — the strip is gated on the view (replace the first `<Feed …>{(s) => <VestingTiles …/>}</Feed>`):
```tsx
        {/* The headline strip belongs to the views that read the schedule (2026-09-13 polish
            spec §12): on Manage the tiles have no bearing on the two forms, so the strip is not
            drawn there. The tab strip above is sticky, so nothing else moves when it goes. */}
        {views.section !== 'manage' && (
          <Feed
            data={schedule}
            busy={scheduleBusy}
            staleNoun="the schedule"
            // Its own sentence, not the schedule card's: two identical hidden labels would
            // read out one after the other while the one feed behind them loads.
            skeleton={{ height: FEED_SKELETON.compVesting, label: 'Loading vesting totals…' }}
          >
            {(s) => <VestingTiles schedule={s} />}
          </Feed>
        )}
```
TC chart card — the empty state gets a door (replace the `footer={…}` prop):
```tsx
            footer={
              events !== null && events.length === 0 ? (
                // The empty sentence names Manage; this is the door (2026-09-13 polish spec §14).
                <button type="button" className="button" onClick={() => views.setSection('manage')}>
                  Add a comp event in Manage
                </button>
              ) : (
                <p className="drill-hint">
                  Total comp as this app defines it: the base the year landed on, stacked under
                  the value of the unvested equity behind it (the sheet has no TC column — this is
                  the proxy, and the line is the server&apos;s own total).
                </p>
              )
            }
```
Vesting panel mount — hand it the door:
```tsx
                <VestingSchedulePanel schedule={s} goTo={(section) => views.setSection(section)} />
```

`VestingSchedulePanel.tsx` — props:
```tsx
export default function VestingSchedulePanel({
  schedule,
  goTo,
}: {
  schedule: VestingScheduleOut
  /** The page's view switch: the empty state's "add one in Manage" gets a real door
   *  (2026-09-13 polish spec §14). Absent → the sentence alone. */
  goTo?: (section: 'manage') => void
}) {
```
Footer — right after the quote-line ternary (before `{schedule.grants.length > 0 && (<p className="drill-hint">Vested …`):
```tsx
          {schedule.grants.length === 0 && goTo !== undefined && (
            <button type="button" className="button" onClick={() => goTo('manage')}>
              Add a grant in Manage
            </button>
          )}
```

`CompPage.css` — `.vest-scroll` (audit X2) and the toggle row:
```css
/* … existing comment above .vest-scroll … Capped at a clamp rather than a fixed 420px
   (2026-09-13 polish spec §7 / audit X2): one scroll usually suffices on a tall viewport, and a
   short one still gets a scroller instead of a card that swallows the page. */
.vest-scroll {
  max-height: clamp(420px, 60vh, 720px);
  overflow: auto;
}
```
and append under the Form section:
```css
/* The column-set toggle sits between the form and the table (2026-09-13 polish spec §7). */
.comp-column-set {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.6rem;
}

.comp-column-set .eyebrow {
  margin: 0;
}
```

- [ ] **Step 4: Run the file — all green**

Run: `npx vitest run src/pages/CompPage.test.tsx && npx tsc -b`
Expected: every test passes (the file gains three), `tsc` silent.

- [ ] **Step 5: Commit**

```bash
git add src/pages/CompPage.tsx src/pages/CompPage.css src/pages/CompPage.test.tsx src/components/comp/VestingSchedulePanel.tsx
git commit -m "feat(comp): focal history column sets, sticky edges, strip off Manage, Manage doors (spec §7, §12, §14)"
```

---
## Task 7 — ESPP: five-tile row, field-attached lot hints, "Purchase model" eyebrow + door, sticky edges

**Files:**
- Modify: `src/components/espp/PositionStrip.tsx` (L60)
- Modify: `src/pages/EsppPage.tsx` (`LotsPanel` hints ~L303-324 and form ~L380-400, lots table ~L432-560, `OfferingsPanel` empty note ~L758-761, `ModelerCard` eyebrow ~L1027 and table ~L1140-1230, page ~L1447-1511)
- Modify: `src/pages/EsppPage.css`
- Test: `src/components/espp/PositionStrip.test.tsx`, `src/pages/EsppPage.test.tsx`

- [ ] **Step 1: Update the pinned heading and write the failing tests**

`PositionStrip.test.tsx` — at the end of the test "paints the $25k tile and ghosts the four lot slots until the lots land" add:
```tsx
    // Five tiles, one row at 1440 (2026-09-13 polish spec §12; audit W2 — the fifth wrapped alone).
    expect(document.querySelector('.kpi-row')?.classList.contains('kpi-row-5')).toBe(true)
```
`EsppPage.test.tsx`:
1. Line ~306: `const modelerCard = () => cardFor(/Purchase modeler/)` → `const modelerCard = () => cardFor(/Purchase model/)`.
2. Line ~799: `screen.getByRole('heading', { name: /Purchase modeler/ })` → `screen.getByRole('heading', { name: /Purchase model/ })`.
3. Append inside `describe('EsppPage — lots', …)`:
```tsx
  it('attaches the form rules to the boxes they are about, and pins the scroller’s edges', async () => {
    renderPage('/espp?section=lots')
    await screen.findByText('$10,720.49')

    // The blank-price rule sits under Purchase price, not in a paragraph above the form
    // (2026-09-13 polish spec §14; audit C6).
    const blankRule = screen.getByText(/Leave the purchase price blank/)
    expect(blankRule.classList.contains('espp-field-note')).toBe(true)
    expect(blankRule.parentElement?.querySelector('label')?.textContent).toContain('Purchase price')
    // The sold-pair rule sits under Sold date / Sold price.
    const soldRule = screen.getByText(/Sold date and sold price travel together/)
    const pair = soldRule.closest('.espp-sold-pair') as HTMLElement
    expect(pair.contains(screen.getByLabelText('Sold date'))).toBe(true)
    expect(pair.contains(screen.getByLabelText('Sold price'))).toBe(true)
    // One sentence is left above the form: what a sold row is measured against.
    expect(screen.getByText(/A sold lot is measured against its sale price/)).toBeTruthy()

    // Identity left, actions right (spec §7; audit X1: "Model sale →" started 3px past the edge).
    const table = document.querySelector('.espp-scroll .data-table') as HTMLTableElement
    expect(table.querySelector('thead th.col-identity')?.textContent).toBe('Purchased')
    expect(table.querySelector('tbody td.col-identity')).toBeTruthy()
    expect(table.querySelector('tbody td.row-actions')).toBeTruthy()
  })
```
4. Append inside `describe('EsppPage — offerings', …)`:
```tsx
  it('offers the Purchase model view from the empty offerings note', async () => {
    vi.mocked(fetchOfferings).mockResolvedValue([])
    renderPage('/espp?section=lots')
    await screen.findByText(/No offerings yet/)
    // The sentence names the view, and the door beside it opens it (2026-09-13 polish spec §14).
    expect(screen.getByText(/drive the Purchase model view/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open Purchase model' }))
    expect(await screen.findByRole('heading', { name: /Purchase model/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Purchase model' }).getAttribute('aria-selected')).toBe('true')
  })
```
5. Append inside `describe('EsppPage — modeler', …)`:
```tsx
  it('pins the period column and the row actions of the modeler scroller (spec §7)', async () => {
    renderPage('/espp?section=purchase')
    await screen.findByRole('heading', { name: /Purchase model — 2024/ })
    const table = modelerCard().querySelector('.espp-scroll .data-table') as HTMLTableElement
    expect(table.querySelector('thead th.col-identity')?.textContent).toBe('Period')
    expect(table.querySelector('tbody td.col-identity')).toBeTruthy()
    expect(table.querySelector('tbody td.row-actions')).toBeTruthy()
  })
```
(`fetchOfferings` is among the mocked `../api/espp` imports at the top of the file — the page
calls it on mount; `renderPage`, `modelerCard`, `cardFor` exist.)

- [ ] **Step 2: Run the two files — the new tests fail**

Run: `npx vitest run src/components/espp/PositionStrip.test.tsx src/pages/EsppPage.test.tsx`
Expected: `Tests  4 failed` at least (no `kpi-row-5`, notes still a paragraph, no door, no `.col-identity`).
Tests that address the modeler card by heading also fail until the eyebrow is renamed.

- [ ] **Step 3: Implement**

`PositionStrip.tsx` L60:
```tsx
      {/* Five tiles on ONE row at 1440 (2026-09-13 polish spec §12): the modifier pins five
          equal tracks above the 1000px container width, and .stat-value's cqi cap shrinks the
          figures to fit; below it the row falls back to auto-fit. */}
      <div className="kpi-row kpi-row-5">
```

`EsppPage.tsx` — imports: add
```tsx
import { useScrollEdges } from '../components/useScrollEdges'
```
After `function message(…)` near the top:
```tsx
// The page's three views — PAGE_SECTIONS' ids (below), spelled once so the panels can take a
// `goTo(section)` door (2026-09-13 polish spec §14) without reaching for the page's constant.
type EsppSection = 'summary' | 'lots' | 'purchase'
```
`LotsPanel` — after its `const [busy, setBusy] = useState(false)` line:
```tsx
  // The lots scroller's edge cue (data-scroll-more, spec §7) — the shared hook; null-safe.
  const scrollRef = useRef<HTMLDivElement>(null)
  useScrollEdges(scrollRef)
```
Replace the second intro paragraph (the one starting "Leave the purchase price blank…") with one sentence:
```tsx
      {/* One sentence about the TABLE; the two rules about the FORM sit under the boxes they
          govern (2026-09-13 polish spec §14; audit C6). */}
      <p className="drill-hint">
        A sold lot is measured against its sale price; every other row against the quote above.
      </p>
```
In the form, replace the Purchase price, Sold date and Sold price labels with:
```tsx
        {/* A box with its own note (PaycheckPage's .paycheck-count-field shape): the note lives
            OUTSIDE the label, because a label's text is the box's accessible name. */}
        <div className="espp-field">
          <label>
            Purchase price
            <AmountInput
              kind="plain"
              value={form.purchase_price}
              onValueChange={set('purchase_price')}
            />
          </label>
          <span className="espp-field-note">
            Leave the purchase price blank and the server derives it from the lower of
            subscription price and purchase FMV, less the plan discount (Settings → Plan
            assumptions).
          </span>
        </div>
        {/* The two boxes that travel together share one note. */}
        <div className="espp-sold-pair">
          <label>
            Sold date
            <input
              className="field-input"
              type="date"
              value={form.sold_date}
              onChange={(e) => set('sold_date')(e.target.value)}
            />
          </label>
          <label>
            Sold price
            <AmountInput kind="plain" value={form.sold_price} onValueChange={set('sold_price')} />
          </label>
          <span className="espp-field-note">
            Sold date and sold price travel together: set both to realize a lot, clear both to
            un-sell it.
          </span>
        </div>
```
Lots table — the scroller takes the ref; identity cells get the class (thead, tbody, and both
tfoot rows):
```tsx
        <div className="espp-scroll" ref={scrollRef}>
          <table className="data-table">
            <thead>
              <tr>
                {/* Sticky left; the actions cell sticky right (panels.css, spec §7). */}
                <th className="col-identity">Purchased</th>
```
```tsx
                  <td className="col-identity">{formatDate(lot.purchase_date)}</td>
```
```tsx
                <tr className="espp-totals">
                  <td className="col-identity">Held</td>
```
```tsx
                  <tr className="espp-totals">
                    <td className="col-identity">Sold</td>
```
`OfferingsPanel` — add the door prop and use it in the empty note:
```tsx
function OfferingsPanel({
  offerings,
  bars,
  onChanged,
  goTo,
}: {
  offerings: EsppOfferingOut[]
  bars: PricePoint[]
  onChanged: () => void
  /** The page's view switch — the empty note's door into the Purchase model view (spec §14). */
  goTo: (section: EsppSection) => void
}) {
```
(keep the existing prop names/types exactly as they are today; only `goTo` is new)
```tsx
      {offerings.length === 0 ? (
        <p className="empty-note">
          No offerings yet — add your enrollment date and its closing price to drive the
          Purchase model view.{' '}
          <button type="button" className="button" onClick={() => goTo('purchase')}>
            Open Purchase model
          </button>
        </p>
      ) : (
```
`ModelerCard` — after its state declarations add the scroller hook:
```tsx
  // The period table's edge cue (spec §7) — null until a payload renders the table.
  const scrollRef = useRef<HTMLDivElement>(null)
  useScrollEdges(scrollRef)
```
eyebrow (audit C2 — the tab is "Purchase model"):
```tsx
      <h2 className="eyebrow">
        Purchase model{data === null ? '' : ` — ${data.year}`}
```
table:
```tsx
          <div className="espp-scroll" ref={scrollRef}>
            <table className="data-table">
              <thead>
                <tr>
                  <th className="col-identity">Period</th>
```
```tsx
                  <tr key={rowKey(row)}>
                    <td className="col-identity">
                      {row.label}
```
Page — hand the offerings panel its door:
```tsx
            {(rows) => (
              <OfferingsPanel
                offerings={rows}
                bars={bars ?? []}
                onChanged={onOfferingsChanged}
                goTo={(section) => views.setSection(section)}
              />
            )}
```

`EsppPage.css` — append under the Forms section:
```css
/* A box with its own note (PaycheckPage.css's .paycheck-count-field shape): the note lives
   OUTSIDE the label — a label's text is the box's accessible name — and reads in the form's
   note register rather than the label's uppercase one. */
.espp-form .espp-field {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

/* Sold date and sold price share one note: two tracks of the form grid, the note under both. */
.espp-form .espp-sold-pair {
  grid-column: span 2;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem;
  align-items: end;
}

.espp-form .espp-field-note {
  grid-column: 1 / -1;
  display: block;
  margin-top: 0.2rem;
  font-size: 0.7rem;
  color: var(--muted);
}
```

- [ ] **Step 4: Run the two files — all green**

Run: `npx vitest run src/components/espp/PositionStrip.test.tsx src/pages/EsppPage.test.tsx && npx tsc -b`
Expected: every test passes (the page file gains three; "points the lots hint at the plan
discount…" still passes on the note's text), `tsc` silent.

- [ ] **Step 5: Commit**

```bash
git add src/components/espp/PositionStrip.tsx src/components/espp/PositionStrip.test.tsx src/pages/EsppPage.tsx src/pages/EsppPage.css src/pages/EsppPage.test.tsx
git commit -m "feat(espp): five-tile strip row, field-attached lot hints, Purchase model door, sticky table edges (spec §7, §12, §14)"
```

---
## Task 8 — Taxes copy: `TaxSection`, Summary and Marginal cards name the view (and open it)

**Files:**
- Create: `src/components/taxes/taxSections.ts`
- Modify: `src/components/taxes/SummaryPanel.tsx` (props ~L98-105, InfoHint L126, missing-tables CTA ~L280-296, waterfall `empty` L308)
- Modify: `src/components/taxes/MarginalPanel.tsx` (L87)
- Test: `src/components/taxes/SummaryPanel.test.tsx`, `src/components/taxes/MarginalPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

`SummaryPanel.test.tsx` — the import on line 1 gains `fireEvent`:
```tsx
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
```
Append inside the file's `describe(…)`:
```tsx
  it('names the Tax tables view in the missing-tables call to action and offers a door into it', () => {
    const goTo = vi.fn()
    render(
      <SummaryPanel
        summary={summaryFixture({ brackets_missing_for_status: ['federal', 'state'] })}
        filingStatus="married_joint"
        goTo={goTo}
      />,
    )
    // Nothing on this tab is "below" any more (2026-09-13 polish spec §14; audit C1).
    expect(
      screen.getByText(/In Tax tables, pick the Married filing jointly tab and clone 2026/),
    ).toBeTruthy()
    expect(screen.queryByText(/Bracket tables.*below/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open Tax tables' }))
    expect(goTo).toHaveBeenCalledWith('tables')
  })

  it('renders the call to action without a door when the page hands no goTo', () => {
    render(
      <SummaryPanel
        summary={summaryFixture({ brackets_missing_for_status: ['federal'] })}
        filingStatus="single"
      />,
    )
    expect(screen.getByText(/Enter 2026's rates in Tax tables/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open Tax tables' })).toBeNull()
  })
```
`MarginalPanel.test.tsx` — directly under the existing line
`expect(screen.getByText(/the ladder has nothing to walk/i)).toBeTruthy()` (~L133) add:
```tsx
    // The editor is on another tab now: the sentence names it (spec §14).
    expect(screen.getByText(/Enter them in Tax tables\./)).toBeTruthy()
```

- [ ] **Step 2: Run the two files — three tests fail**

Run: `npx vitest run src/components/taxes/SummaryPanel.test.tsx src/components/taxes/MarginalPanel.test.tsx`
Expected: `Tests  3 failed`.

- [ ] **Step 3: Implement**

Create `src/components/taxes/taxSections.ts`:
```ts
/**
 * The Taxes page's four views — the ids of TaxesPage's PAGE_SECTIONS, spelled once here so the
 * panels can take a `goTo(section)` door (2026-09-13 polish spec §14) without importing the page
 * that mounts them. A section added to the page is added here.
 */
export type TaxSection = 'summary' | 'whatif' | 'inputs' | 'tables'
```

`SummaryPanel.tsx`:
- import: `import type { TaxSection } from './taxSections'`
- props:
```tsx
export default function SummaryPanel({
  summary,
  filingStatus,
  goTo,
}: {
  summary: TaxSummaryOut
  /** The YEAR's status — what the missing-tables call-to-action names. */
  filingStatus: FilingStatus
  /** The page's view switch: the missing-tables call to action opens Tax tables through it
   *  (2026-09-13 polish spec §14). Absent → the sentence alone. */
  goTo?: (section: TaxSection) => void
}) {
```
- L126 InfoHint text:
```tsx
          <InfoHint text="The engine&apos;s answer for this year, computed from the stored inputs (the Inputs view) and bracket tables (the Tax tables view)." />
```
- Missing-tables CTA — replace the `{filingStatus === 'single' ? (…) : (…)}` ternary and add the door:
```tsx
              {/* The way out differs by status. A married year has the single-filer
                  tables sitting right there, so the editor's clone is the answer; a SINGLE
                  year has nothing to clone from and is refusing because it is the year
                  being lived in (2026-09-09 spec 4g) — telling it to clone its own tables
                  would be nonsense. Either way the editor is the Tax tables VIEW, named as
                  such (2026-09-13 polish spec §14), and the button is the door. */}
              {filingStatus === 'single' ? (
                <p>
                  Enter {summary.year}&apos;s rates in Tax tables — the IRS and the Franchise Tax
                  Board publish them each autumn. A settled year that was imported without them
                  still computes; this one is the year you are living in, so a zero here would be
                  a wrong answer rather than a gap.
                </p>
              ) : (
                <p>
                  In Tax tables, pick the {FILING_STATUS_LABELS[filingStatus]} tab and clone{' '}
                  {summary.year}&apos;s single-filer tables — then edit the thresholds that move
                  with filing status.
                </p>
              )}
              {goTo !== undefined && (
                <button type="button" className="button" onClick={() => goTo('tables')}>
                  Open Tax tables
                </button>
              )}
```
- L308 waterfall `empty`:
```tsx
          empty="Nothing to chart yet — this year computes to zero until its inputs are filled in (the Inputs view)."
```

`MarginalPanel.tsx` L87:
```tsx
      empty="No federal or state bracket tables for this year yet — the ladder has nothing to walk. Enter them in Tax tables."
```

- [ ] **Step 4: Run the two files — all green**

Run: `npx vitest run src/components/taxes/SummaryPanel.test.tsx src/components/taxes/MarginalPanel.test.tsx && npx tsc -b`
Expected: every test passes (Summary gains two), `tsc` silent.

- [ ] **Step 5: Commit**

```bash
git add src/components/taxes/taxSections.ts src/components/taxes/SummaryPanel.tsx src/components/taxes/SummaryPanel.test.tsx src/components/taxes/MarginalPanel.tsx src/components/taxes/MarginalPanel.test.tsx
git commit -m "fix(copy): taxes summary and marginal cards name the view instead of \"below\"; Open Tax tables door (spec §14)"
```

---

## Task 9 — Will I owe: methodology behind one `Disclosure`, server notes as sentences, view doors

**Files:**
- Modify: `src/components/taxes/WithholdingPanel.tsx` (imports L1-19, props ~L172-190, confirm sentence ~L258, JSX ~L387-610)
- Test: `src/components/taxes/WithholdingPanel.test.tsx`

- [ ] **Step 1: Update the four pinned sentences and write the failing tests**

In `WithholdingPanel.test.tsx`:
1. ~L500 (test "nudges the W-2 inputs only while the year has vest income to declare"): the expected
   string becomes
   `"This year's vests imply ≈$48,000.00 of W-2 income at vest prices — make sure your W-2 inputs in the Inputs view include it."`
   and the comment above it reads `// The inputs form the reader has to fix this in lives on the Inputs tab — named, never "below".`
2. ~L539-559 (test "renders every server warning verbatim, beside the estimate rather than over it") —
   rename to `'renders every server warning as a sentence, beside the estimate rather than over it'`
   and change the two expected strings to
   `'Vest on 2026-02-18 has no stored price — excluded from the estimate.'` and
   `'No usable paycheck profile — salary withholding estimated as 0.'` (the fixture's lowercase
   fragments stay as they are: the formatter is at the render site).
3. ~L641: the regex becomes
   `/Your side is simulated from paycheck profiles; your partner’s is entered\. Edit all three in Inputs\./`
4. ~L695: the regex becomes
   `/No federal, medicare bracket table for this year’s filing status — the tax engine cannot price the year until they exist\. Add them in Tax tables, or clone another year’s and edit the thresholds\./`
5. Append inside `describe('WithholdingPanel', …)`:
```tsx
  it('folds the methodology behind one disclosure that counts its notes, and leaves the actions in the open', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(
      fixture({ warnings: ['partner checks before their first profile’s effective date use that profile'] }),
    )
    // onVestApplied given, so the Apply chip renders — it is one of the lines that must stay OUT.
    render(<WithholdingPanel year={2026} onVestApplied={vi.fn()} />)
    await screen.findByText('$123,456.78')

    // Safe harbor + assumptions + one server note = three notes (2026-09-13 polish spec §11).
    const summary = screen.getByText('How this is estimated (3 notes)')
    const details = summary.closest('details') as HTMLDetailsElement
    expect(details.classList.contains('disclosure')).toBe(true)
    expect(details.contains(screen.getByText(/Safe harbor \(approx\.\)/))).toBe(true)
    expect(details.contains(screen.getByText(/Checks are estimated on an even calendar grid/))).toBe(true)
    // The server fragment is printed as a sentence: capital first letter, terminal period (§14).
    expect(
      details.contains(
        screen.getByText('Partner checks before their first profile’s effective date use that profile.'),
      ),
    ).toBe(true)
    // The status line, the remedy and the vest Apply stay outside it.
    expect(details.contains(screen.getByText(/withheld so far/))).toBe(false)
    expect(details.contains(screen.getByText(/per remaining paycheck/))).toBe(false)
    expect(details.contains(screen.getByRole('button', { name: 'Apply vest income to W-2 inputs' }))).toBe(false)
  })

  it('calls the page’s goTo from the Inputs and Tax tables doors', async () => {
    const goTo = vi.fn()
    vi.mocked(fetchWithholding).mockResolvedValue(
      married({ brackets_missing_for_status: ['federal'], liability_total: null, balance_projected: null }),
    )
    render(<WithholdingPanel year={2026} goTo={goTo} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Tax tables' }))
    expect(goTo).toHaveBeenCalledWith('tables')
    fireEvent.click(screen.getByRole('button', { name: 'Open Inputs' }))
    expect(goTo).toHaveBeenCalledWith('inputs')
  })
```

- [ ] **Step 2: Run the file — six tests fail**

Run: `npx vitest run src/components/taxes/WithholdingPanel.test.tsx`
Expected: `Tests  6 failed` (four re-pinned sentences, two new tests).

- [ ] **Step 3: Implement**

Imports — add:
```tsx
import type { ReactNode } from 'react'
import Disclosure from '../Disclosure'
import type { TaxSection } from './taxSections'
```
Above `export default function WithholdingPanel` add the formatter:
```tsx
/**
 * Server warning fragments arrive lowercase and unpunctuated ("partner checks before their first
 * profile's effective date use that profile"); the card prints them as sentences. A formatter at
 * the render site — never a rewrite of the payload (2026-09-13 polish spec §14; audit C4).
 */
function sentence(fragment: string): string {
  const text = fragment.trim()
  if (text === '') return text
  const capitalised = text.charAt(0).toUpperCase() + text.slice(1)
  return /[.!?…]$/.test(capitalised) ? capitalised : `${capitalised}.`
}
```
Props — add `goTo` (destructuring and type):
```tsx
  onVestApplied,
  goTo,
}: {
  …
  onVestApplied?: (echo: TaxInputsOut) => void
  /** The page's view switch (2026-09-13 polish spec §14): the partner note's "Open Inputs" and
   *  the missing-tables "Open Tax tables" doors. Absent → the sentences alone. */
  goTo?: (section: TaxSection) => void
}) {
```
~L258 — the Apply confirm sentence:
```tsx
        'Applying writes the W-2 vest input and reloads the Inputs view, discarding its unsaved edits. Continue?',
```
After `const partnerLeg = …` (before `return (`) build the folded notes:
```tsx
  // The methodology, folded (2026-09-13 polish spec §11; audit A2): the safe-harbor sentences,
  // the reference-return note, the assumptions paragraph and the server's own asterisks EXPLAIN
  // the estimate rather than act on it, so they sit behind ONE disclosure whose summary counts
  // them. The status line, the remedies, the split nudge and the vest Apply stay in the open.
  const methodNotes: ReactNode[] = []
  if (withholding !== null) {
    // Nothing at all when NEITHER statutory leg exists: a missing prior year is the normal
    // first-year case and arrives with no warning of its own. The multiplier is the SERVER'S —
    // 110% only above the IRC 6654(d)(1)(C) prior-year AGI gate, 100% at or below it.
    if (split === null && withholding.safe_harbor !== null) {
      methodNotes.push(
        <p className="hint" key="harbor">
          {safeHarborSentence(withholding.safe_harbor)}
          <InfoHint text="Real safe harbor is per-jurisdiction; this compares all-in totals — approximate by construction. The statutory harbor is the LESSER of last year's 100/110% figure and 90% of this year's liability." />
        </p>,
      )
    }
    // The real thing, once the split makes it computable: two harbors against two liabilities,
    // which is how the statute is actually written. The combined sentence above is suppressed
    // rather than shown alongside them.
    if (split !== null && split.federal.safe_harbor !== null) {
      methodNotes.push(
        <p className="hint" key="harbor-federal">
          {safeHarborSentence(split.federal.safe_harbor, 'Federal safe harbor', 'federal tax')}
          <InfoHint text="IRC 6654: the LESSER of 100/110% of last year's federal tax and 90% of this year's. Withhold at least that much and the underpayment penalty does not apply, however large the April bill is." />
        </p>,
      )
    }
    if (split !== null && split.state.safe_harbor !== null) {
      methodNotes.push(
        <p className="hint" key="harbor-state">
          {safeHarborSentence(split.state.safe_harbor, 'California safe harbor', 'California tax')}
          <InfoHint text="R&TC 19136, the federal rule with one extra clause: at $1,000,000 of California AGI the prior-year leg is gone and only 90% of this year's tax will do." />
        </p>,
      )
    }
    // The wedding-year note: the reference return is last year's, so on the first married year it
    // was filed under another status. A labelling matter, never a math one; skipped when the prior
    // leg is missing — there is no reference return to label.
    if (
      withholding.safe_harbor !== null &&
      withholding.safe_harbor.prior_filing_status !== null &&
      withholding.safe_harbor.prior_filing_status !== withholding.filing_status
    ) {
      methodNotes.push(
        <p className="hint" key="reference">
          {`That reference return was filed as ${withholding.safe_harbor.prior_filing_status.replaceAll(
            '_',
            ' ',
          )} — still the legal safe harbor, just a different household.`}
        </p>,
      )
    }
    // What the estimate ASSUMED, in the order it bites: the check grid, the FICA stacking, and
    // the quote the future half rides. "Tends to err toward owing more" rather than a flat
    // promise: the stacking leans that way, but additional-Medicare convexity can run the other,
    // and an even grid is direction-neutral.
    methodNotes.push(
      <p className="drill-hint" key="assumptions">
        Checks are estimated on an even calendar grid, and vest FICA stacks on top of salary
        rather than by date — an approximation that tends to err toward owing more. Future
        vests are valued at the latest quote. Supplemental rates: 22% federal, rising to 37%
        above $1,000,000 of vests and bonuses in a year; California 10.23% on vests and 6.6%
        on bonuses.
      </p>,
    )
    // Advisory, never an error banner: the estimate CAME BACK — these are the honest asterisks
    // on what it was computed from, each naming a piece that was left out. Text-as-key: a fixed
    // list of distinct sentences rendered straight from the payload.
    for (const warning of withholding.warnings) {
      methodNotes.push(
        <p className="hint" key={warning}>
          {sentence(warning)}
        </p>,
      )
    }
  }
```
In the JSX, make these edits inside the `<div className={`loading-dim…`}>` block:

a. The partner "entered" paragraph (~L468-473) becomes:
```tsx
                <p className="drill-hint">
                  Your side is simulated from paycheck profiles; your partner&rsquo;s is
                  entered. Edit all three in Inputs. Partner amounts are already counted once in
                  each total above — don&rsquo;t add them again.
                  {goTo !== undefined && (
                    <>
                      {' '}
                      <button type="button" className="button" onClick={() => goTo('inputs')}>
                        Open Inputs
                      </button>
                    </>
                  )}
                </p>
```
b. The missing-brackets call to action (~L493-500) becomes:
```tsx
          {withholding.brackets_missing_for_status.length > 0 && (
            <p className="hint withholding-cta">
              {`No ${withholding.brackets_missing_for_status.join(
                ', ',
              )} bracket table for this year’s filing status — the tax engine cannot price the year until they exist. Add them in Tax tables, or clone another year’s and edit the thresholds.`}
              {goTo !== undefined && (
                <>
                  {' '}
                  <button type="button" className="button" onClick={() => goTo('tables')}>
                    Open Tax tables
                  </button>
                </>
              )}
            </p>
          )}
```
c. DELETE from the JSX: the three safe-harbor `<p className="hint">` blocks (combined, federal,
   state), the reference-return `<p className="hint">`, the assumptions `<p className="drill-hint">`
   and the `{withholding.warnings.map(…)}` block — they now render from `methodNotes`.
d. The vest sentence (~L554-558) becomes:
```tsx
              {`This year's vests imply ≈${formatCurrency(
                withholding.vest.income_projected,
              )} of W-2 income at vest prices — make sure your W-2 inputs in the Inputs view include it.`}
```
e. After `<FeedBanner error={applyError} />` (the last child of the dim block) add:
```tsx
          {/* One accordion on the page, and the right tool for it: explanation, not controls. */}
          <Disclosure
            className="withholding-method"
            summary={`How this is estimated (${methodNotes.length} ${methodNotes.length === 1 ? 'note' : 'notes'})`}
          >
            {methodNotes}
          </Disclosure>
```

- [ ] **Step 4: Run the file — all green**

Run: `npx vitest run src/components/taxes/WithholdingPanel.test.tsx && npx tsc -b`
Expected: every test passes (the file gains two; "always says how the estimate was made",
"gives each jurisdiction its own safe-harbor sentence…", "labels a safe harbor that references a
return filed under another status" all still find their sentences inside the closed disclosure),
`tsc` silent.

- [ ] **Step 5: Commit**

```bash
git add src/components/taxes/WithholdingPanel.tsx src/components/taxes/WithholdingPanel.test.tsx
git commit -m "feat(taxes): Will I owe — methodology behind one Disclosure, server notes as sentences, view doors (spec §11, §14)"
```

---
## Task 10 — Bracket tables: "Editing tables for", the jurisdiction grid, the helper paragraph once

**Files:**
- Modify: `src/components/taxes/BracketsEditor.tsx` (import L1, status tabs ~L654-671, jurisdiction map ~L687-780)
- Modify: `src/components/taxes/taxes.css` (`.bracket-status-tabs` ~L431-433, new grid rules)
- Test: `src/components/taxes/BracketsEditor.test.tsx`

- [ ] **Step 1: Update the doubled-paragraph pin and write the failing test**

~L665 (test "offers to add a person table under each per-worker block"): replace
```tsx
    expect(
      screen.getAllByText(/the default applies to anyone without their own table/),
    ).toHaveLength(2)
```
with
```tsx
    // Said ONCE, above the first per-person strip (2026-09-13 polish spec §14; audit C3).
    expect(screen.getByText(/the default applies to anyone without their own table/)).toBeTruthy()
```
Append inside the same `describe(…)` block:
```tsx
  it('lays the jurisdictions out as a grid of groups, each table over its own strip', () => {
    render(<BracketsEditor brackets={bracketsFixture()} onSaved={vi.fn()} />)
    // 2026-09-13 polish spec §12 (audit W3: seven 560px tables in a one-column ribbon).
    const grid = document.querySelector('.bracket-grid') as HTMLElement
    expect(grid).toBeTruthy()
    const groups = Array.from(grid.children)
    expect(groups).toHaveLength(6)
    expect(groups.every((group) => group.classList.contains('bracket-group'))).toBe(true)
    // A per-worker group holds its default table AND its per-person strip.
    const socialSecurity = screen
      .getByText('Social Security brackets — default for everyone')
      .closest('.bracket-group') as HTMLElement
    expect(socialSecurity.querySelector('form.bracket-block')).toBeTruthy()
    expect(socialSecurity.querySelector('.bracket-person-strip')).toBeTruthy()
    // The helper paragraph is the first thing in the FIRST strip, and nowhere else.
    expect(
      socialSecurity.querySelector('.bracket-person-strip > :first-child')?.textContent,
    ).toMatch(/Per-worker tax/)
    const disability = screen
      .getByText('Disability brackets — default for everyone')
      .closest('.bracket-group') as HTMLElement
    expect(disability.textContent).not.toMatch(/Per-worker tax/)
    // The editor's status control says what it is FOR, so it cannot be mistaken for the year's
    // filing status in the scope row (audit S3).
    const row = screen.getByText('Editing tables for').closest('.bracket-status-row') as HTMLElement
    expect(row.contains(screen.getByRole('group', { name: 'Bracket filing status' }))).toBe(true)
  })
```

- [ ] **Step 2: Run the file — two tests fail**

Run: `npx vitest run src/components/taxes/BracketsEditor.test.tsx`
Expected: `Tests  2 failed` (`getByText` finds two paragraphs; no `.bracket-grid`).

- [ ] **Step 3: Implement**

`BracketsEditor.tsx`:
- Line 1: `Fragment` is no longer used — `import { useEffect, useRef, useState } from 'react'`.
- Replace the status tabs `<div className="segmented bracket-status-tabs" …>…</div>` with:
```tsx
      {/* One tab per status this year can be filed as. The same six tables exist behind each
          one — a full replace is per (jurisdiction, status) — so the tab is what decides
          which of them a Save rewrites. Labelled, because the scope row above carries the
          YEAR's filing status in the same segmented look (audit S3): that one PATCHes the
          year; this one only picks the tables this card edits. */}
      <div className="bracket-status-row">
        <span className="eyebrow">Editing tables for</span>
        <div
          className="segmented bracket-status-tabs"
          role="group"
          aria-label="Bracket filing status"
        >
          {tabs.map((status) => (
            <button
              key={status}
              type="button"
              className={status === activeStatus ? 'active' : ''}
              aria-pressed={status === activeStatus}
              disabled={tabBusy || saving !== null}
              onClick={() => openStatus(status)}
            >
              {FILING_STATUS_LABELS[status]}
            </button>
          ))}
        </div>
        <InfoHint text="Which status' tables this card's Saves rewrite. The year's own filing status — the tables the engine walks — is set in the scope row at the top of the page." />
      </div>
```
- Just before `{JURISDICTIONS.map((name) => {` add:
```tsx
      {/* The per-worker helper sentence, once, above the FIRST strip (2026-09-13 polish spec §14;
          audit C3: it printed twice, verbatim, 300px apart). */}
```
  and above the `return (` of the component (after `const extras = …` or wherever the
  jurisdiction-derived constants live), compute:
```tsx
  // The first per-worker jurisdiction that draws a strip — where the one helper sentence goes.
  const firstStripName =
    people.length === 0
      ? null
      : (JURISDICTIONS.find((name) => PER_WORKER_JURISDICTIONS.includes(name)) ?? null)
```
- Wrap the jurisdictions and the extras in the grid; each `Fragment` becomes a `div.bracket-group`:
```tsx
      <div className="bracket-grid">
        {JURISDICTIONS.map((name) => {
          const rows = tables[name] ?? []
          const message = errors[name]
          const perWorker = PER_WORKER_JURISDICTIONS.includes(name)
          // Social Security and SDI are per-WORKER taxes: the table here is the default, and
          // each earner the return covers may carry their own beneath it.
          const strip = perWorker && people.length > 0
          // One scope PER jurisdiction, matching the one Save each table has: Enter walks
          // this table's rate/threshold cells and stops at its own Save, never wandering into
          // the next jurisdiction's rows. A person's card is a scope of its own for the same
          // reason — and a SIBLING of this form rather than a child, because forms do not nest.
          // The group is one grid cell: the table and the strip that qualifies it stay together
          // (2026-09-13 polish spec §12).
          return (
            <div key={name} className="bracket-group">
              <form
                className={strip ? 'bracket-block has-person-strip' : 'bracket-block'}
                data-entry-scope=""
                onSubmit={(e) => {
                  e.preventDefault()
                  save(name)
                }}
              >
                {/* …the form's children exactly as today: h3, FeedBanner, BracketRows, .bracket-actions… */}
              </form>
              {strip && (
                <div className="bracket-person-strip">
                  {name === firstStripName && (
                    <p className="drill-hint">
                      Per-worker tax: the default applies to anyone without their own table. Add
                      one for an earner on an employer&apos;s voluntary plan, or in a job exempt
                      from Social Security.
                    </p>
                  )}
                  {people.map((person) => personCard(name, person))}
                </div>
              )}
            </div>
          )
        })}
        {extras.map((name) => (
          <div key={name} className="bracket-group">
            <div className="bracket-block">
              {/* …the read-only imported table exactly as today… */}
            </div>
          </div>
        ))}
      </div>
```
  (Move the existing `<h3>`, `<FeedBanner>`, `<BracketRows>` and `.bracket-actions` markup into
  the form unchanged; move the existing extras `<h3>`, `<p>` and `<table>` into the inner div
  unchanged. The old strip's trailing `<p className="drill-hint">` is deleted — the sentence now
  renders once, first, under the `firstStripName` gate.)

`taxes.css`:
- `.bracket-status-tabs { margin-bottom: 1rem; }` → the row carries the spacing now:
```css
/* The status row sits between the card's hint and the grid: an eyebrow naming what the control
   is FOR, the .segmented (panels.css's), and the hint. Only its placement is this file's business. */
.bracket-status-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-bottom: 1rem;
}

.bracket-status-row > .eyebrow {
  margin: 0;
}

.bracket-status-tabs {
  margin-bottom: 0;
}
```
- After `.bracket-block > .eyebrow { … }` add:
```css
/* The jurisdictions as a grid (2026-09-13 polish spec §12; audit W3): two columns at 1440, three
   at 1920, one on a narrow card. Each group is a form plus its optional per-person strip, so a
   strip stays under the table it qualifies. align-items: start, because Federal and Medicare are
   different heights and a stretched twin would be a void. The grid's gap carries the spacing the
   blocks used to carry themselves. */
.bracket-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(480px, 100%), 1fr));
  gap: 1rem 2rem;
  align-items: start;
}

.bracket-grid .bracket-block {
  margin-bottom: 0;
}

.bracket-grid .bracket-block.has-person-strip {
  margin-bottom: 0.55rem;
}

.bracket-grid .bracket-person-strip {
  margin-bottom: 0;
}
```

- [ ] **Step 4: Run the file — all green**

Run: `npx vitest run src/components/taxes/BracketsEditor.test.tsx && npx tsc -b`
Expected: every test passes (the file gains one), `tsc` silent (`Fragment` gone from the import,
so no unused-import complaint).

- [ ] **Step 5: Commit**

```bash
git add src/components/taxes/BracketsEditor.tsx src/components/taxes/BracketsEditor.test.tsx src/components/taxes/taxes.css
git commit -m "feat(taxes): bracket tables as a jurisdiction grid, status control labelled, helper sentence once (spec §12, §14)"
```

---

## Task 11 — Inputs: 40ch label track, row wash, sticky save bar with the count and the shortcut

**Files:**
- Modify: `src/components/taxes/InputsForm.tsx` (`.tax-form-actions` ~L814-828)
- Modify: `src/components/taxes/taxes.css` (`.tax-input-grid.is-split .tax-input-row` ~L105-107, `.tax-form-actions` ~L206-214, new rules)
- Test: `src/components/taxes/InputsForm.test.tsx`

- [ ] **Step 1: Write the failing test** — append inside the file's main `describe(…)`:

```tsx
  it('keeps Save in a sticky footer bar that reads the change count and the shortcut while dirty', () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    const bar = screen.getByRole('button', { name: 'Save inputs' }).closest('.tax-form-actions') as HTMLElement
    // The wizard's class NAME on purpose (2026-09-13 polish spec §12): panels.css exempts a card
    // holding .entry-footer from the reveal transform, which is what lets position: sticky work
    // inside it — a transformed ancestor would drag the bar along and strand it mid-page.
    expect(bar.classList.contains('entry-footer')).toBe(true)
    expect(bar.textContent).toContain('No changes yet')
    expect(bar.querySelector('kbd')).toBeNull()
    expect(bar.classList.contains('is-dirty')).toBe(false)

    fireEvent.change(screen.getByLabelText('Annual Salary'), { target: { value: '210000' } })
    // "1 change to save · Save inputs · Ctrl+Enter", in that order.
    expect(bar.textContent).toContain('1 change to save')
    expect(bar.textContent).toContain('Ctrl+Enter')
    expect(bar.classList.contains('is-dirty')).toBe(true)
    expectInDocumentOrder(
      screen.getByText('1 change to save'),
      screen.getByRole('button', { name: 'Save inputs' }),
      bar.querySelector('kbd') as HTMLElement,
    )
  })
```
Add the import at the top of the test file: `import { expectInDocumentOrder } from '../../testing/domOrder'`.

- [ ] **Step 2: Run it — it fails**

Run: `npx vitest run src/components/taxes/InputsForm.test.tsx -t "sticky footer bar"`
Expected: `Tests  1 failed` (no `entry-footer` class).

- [ ] **Step 3: Implement**

`InputsForm.tsx` — replace the `<div className="tax-form-actions">…</div>` block:
```tsx
        {/* The save bar rides the viewport bottom while the form scrolls (2026-09-13 polish spec
            §12; audit W5: Save sat 1,842px under the first field). Count · Save · shortcut — the
            shortcut only while there is something it would save. `entry-footer` is the wizard's
            class NAME on purpose: panels.css exempts a card holding it from the reveal transform,
            which is what lets position: sticky work inside it (taxes.css carries its own copy of
            the rule — never an import of the wizard's sheet). */}
        <div className={`tax-form-actions entry-footer${changedCount > 0 ? ' is-dirty' : ''}`}>
          <span className="drill-hint">
            {changedCount === 0
              ? 'No changes yet'
              : `${changedCount} change${changedCount === 1 ? '' : 's'} to save`}
          </span>
          <button
            type="submit"
            data-entry-primary=""
            className="button button-primary"
            disabled={saving || changedCount === 0}
          >
            {saving ? 'Saving…' : 'Save inputs'}
          </button>
          {changedCount > 0 && (
            <span className="drill-hint tax-save-shortcut" aria-label="Ctrl+Enter saves">
              <kbd>Ctrl</kbd>+<kbd>Enter</kbd>
            </span>
          )}
        </div>
```

`taxes.css`:
- `.tax-input-grid.is-split .tax-input-row` (~L105-107) becomes:
```css
/* Married-joint rows: the label track is CAPPED and the row left-justified (2026-09-13 polish
   spec §12; audit W4: a minmax(0, 1fr) track stretched to 675px and put 604px of nothing between
   the label and its box on 46 rows). 40ch holds the longest label — "Sec 199A QBI deduction (20%
   of qualified REIT/PTP dividends)" already ellipsises with a title fallback. */
.tax-input-grid.is-split .tax-input-row {
  grid-template-columns: minmax(0, 40ch) 120px 120px 170px;
  justify-content: start;
}
```
- After the `.tax-input-row { … }` rule add:
```css
/* A wash under the row the pointer is on (.row-click's spirit): in a form where a wrong cell is a
   wrong tax figure, the eye needs to be sure which box belongs to which label. */
.tax-input-row:hover {
  background: var(--surface-2);
  border-radius: 4px;
}
```
- After `.tax-form-actions .drill-hint { margin: 0; }` add:
```css
/* The save bar rides the viewport bottom while the form scrolls (2026-09-13 polish spec §12). The
   wizard's .entry-footer recipe, COPIED under this page's scope rather than imported —
   MonthlyUpdatePage.css travels with its own screen. The class NAME is the wizard's on purpose:
   panels.css exempts `.card:has(.entry-footer)` from the scroll-reveal transform, and a transformed
   ancestor would drag a sticky child along with it and strand the bar mid-page. */
.taxes-page .entry-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.9rem;
  margin-top: 1rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 0.9rem;
}

.tax-save-shortcut kbd {
  font-family: inherit;
  font-size: 0.7rem;
  padding: 0 0.3rem;
  border: 1px solid var(--border);
  border-radius: 4px;
}
```

- [ ] **Step 4: Run the file — all green**

Run: `npx vitest run src/components/taxes/InputsForm.test.tsx && npx tsc -b`
Expected: every test passes (the file gains one; "1 change to save" at ~L432 still matches),
`tsc` silent.

- [ ] **Step 5: Commit**

```bash
git add src/components/taxes/InputsForm.tsx src/components/taxes/InputsForm.test.tsx src/components/taxes/taxes.css
git commit -m "feat(taxes): inputs form — 40ch label track, row wash, sticky save bar with count and shortcut (spec §12)"
```

---
## Task 12 — Taxes page: year + filing status in the scope row, "New tax year…" popover, MFS caveat as subheader, doors threaded

**Files:**
- Create: `src/components/taxes/TaxYearMenu.tsx`
- Modify: `src/pages/TaxesPage.tsx` (imports L1-45, `createYear` ~L594-660, `deleteYear` ~L662-725, render ~L727-936)
- Modify: `src/pages/TaxesPage.css` (whole file — it shrinks)
- Modify: `src/components/taxes/taxes.css` (append the menu rules; the `.new-year-form` rules move here from `TaxesPage.css`)
- Test: `src/pages/TaxesPage.test.tsx`

The card at `TaxesPage.tsx:757-864` (`Tax year` heading, chip row, filing-status row, MFS caveat,
empty note, `details.tax-year-management`, create banner) goes away entirely: the chips and the
status move into `PageFrame scopeRow`, the caveat into `subheader`, create/delete into `actions`
through `TaxYearMenu`, and the empty note becomes a plain body paragraph.

- [ ] **Step 1: Re-point the test helpers, update the pinned tests, write the new ones**

In `src/pages/TaxesPage.test.tsx`:

1. ~L338 — the delete helper reads the arm button by either face:
```tsx
const deleteYearButton = () => { openYearManagement(); return screen.getByRole('button', { name: /^Delete (year|\d{4})…$/ }) as HTMLButtonElement }
```
2. Replace the three helper functions at the bottom of the file (`openYearManagement`,
   `newYearInput`, `createYearButton`) with:
```tsx
/** The year menu's popover — opened when a helper needs what is inside it (the year box, Create,
 *  the delete door). Idempotent: a popover already open is left alone. */
function openYearManagement() {
  if (document.querySelector('.tax-year-menu .popover-surface') === null) {
    fireEvent.click(screen.getByRole('button', { name: 'New tax year…' }))
  }
}
function newYearInput() { openYearManagement(); return screen.getByLabelText('New year') as HTMLInputElement }
function createYearButton() { openYearManagement(); return screen.getByRole('button', { name: /create year/i }) }
/** The arm-and-confirm's second button: the delete itself (TaxYearMenu). */
function confirmDeleteButton() { return screen.getByRole('button', { name: /^Delete \d{4}$/ }) as HTMLButtonElement }
```
3. Every direct `screen.getByLabelText('New year')` outside the helpers becomes `newYearInput()`
   (the popover has to be open for the box to exist). Six sites:
   - ~L512 (`creates a year by cloning…`): `expect((screen.getByLabelText('New year') as HTMLInputElement).value).toBe('2025')` → `expect(newYearInput().value).toBe('2025')`
   - ~L611 (`asks before creating a year…`): `fireEvent.change(screen.getByLabelText('New year'), …)` → `fireEvent.change(newYearInput(), …)`
   - ~L745 (`answers an out-of-range year…`): `const input = screen.getByLabelText('New year')` → `const input = newYearInput()`
   - ~L767 (`retires the create error…`): `fireEvent.change(screen.getByLabelText('New year'), …)` → `fireEvent.change(newYearInput(), …)`
   - ~L789 (`offers the new-year form on a fresh database…`): `expect((screen.getByLabelText('New year') as HTMLInputElement).value)` → `expect(newYearInput().value)`
   - ~L1930 (`paints the year chips AND the detail panel…`): same replacement as L789.
   The `queryByLabelText('New year')` null-checks at ~L444 and ~L577 stay as they are: with the
   popover shut the box is absent, which is exactly what they assert.
4. Test "offers a delete affordance that is shut until a year is selected" (~L1116) — unchanged.
5. Replace the test "asks ONE question before deleting — the delete confirm subsumes the discard one" (~L1131-1150) with:
```tsx
  it('arms the delete inside the popover and asks nothing else — a "Keep" leaves the typed work', async () => {
    renderPage('/taxes?section=inputs')
    await readyInputs()
    // Unsaved work, so the discard gate would fire too if the page stacked questions.
    fireEvent.change(salary(), { target: { value: '999' } })

    fireEvent.click(deleteYearButton())
    // The question is asked where the reader is looking (2026-09-13 polish spec §11), not in a
    // window.confirm — and it is the STRONGER one: deleting the year throws away the saved rows
    // as well as the typed ones, so "discard unsaved changes?" has nothing left to ask.
    expect(screen.getByText(DELETE_2024_CONFIRM)).toBeTruthy()
    expect(confirmSpy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep 2024' }))
    // Declined: no request, the question is gone, and the typed work is still there.
    expect(vi.mocked(deleteTaxYear)).not.toHaveBeenCalled()
    expect(screen.queryByText(DELETE_2024_CONFIRM)).toBeNull()
    expect(salary().value).toBe('$999.00')
    // And no busy leaked out of a question answered "no" — the door is open for a second thought.
    expect(deleteYearButton().disabled).toBe(false)
  })
```
6. In "deletes the selected year, then reloads the list and clears the detail panel" (~L1152),
   "drops an inputs save that echoes into the year being deleted" (~L1180) and "surfaces a delete
   failure verbatim and keeps the year on screen" (~L1222): every
   ```tsx
    fireEvent.click(deleteYearButton())
    expect(confirmSpy).toHaveBeenCalledWith(DELETE_2024_CONFIRM)
   ```
   pair becomes
   ```tsx
    fireEvent.click(deleteYearButton())
    fireEvent.click(confirmDeleteButton())
   ```
   (the third test has only the first line — add the second under it).
7. In `describe('filing status (2026-08-26 design §6)', …)`: the comment above `statusButton`
   becomes `// Scoped to the SCOPE ROW's control: the brackets editor renders a group with the same
   three names ("Bracket filing status"), and only this one changes how the year is filed.`; in
   "stands the California community-property caveat under MFS only" add, right after
   `expect(screen.getByText(CA_CAVEAT)).toBeTruthy()`:
   ```tsx
    // The frame's subheader (2026-09-13 polish spec §12): under the title, above the sticky row.
    expect(screen.getByText(CA_CAVEAT).closest('.page-frame-subheader')).toBeTruthy()
   ```
8. Append a new describe at the end of the file (before the helper functions):
```tsx
describe('TaxesPage — scope row and year menu (2026-09-13 polish spec §11–12)', () => {
  it('puts the year chips and the filing status in the sticky scope row, wired to the same handlers', async () => {
    renderPage('/taxes?section=summary')
    await readyInputs()
    const scope = document.querySelector('.page-frame-scope') as HTMLElement
    expect(scope).toBeTruthy()
    // The year card is gone from the body: no "Tax year" heading, no <details>.
    expect(screen.queryByRole('heading', { name: 'Tax year' })).toBeNull()
    expect(document.querySelector('.tax-year-management')).toBeNull()

    // Chips inside the row, with the same title and pressed state the card's had.
    const chips = () => within(scope).getByRole('group', { name: 'Tax year' })
    expect(within(chips()).getByRole('button', { name: '2024' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(chips()).getByRole('button', { name: '2023' }).getAttribute('title')).toBe('21 inputs · 42 brackets')
    // A chip click is the same door as before: three payloads for the new year.
    fireEvent.click(within(chips()).getByRole('button', { name: '2023' }))
    await waitFor(() => expect(vi.mocked(fetchTaxInputs)).toHaveBeenCalledWith(2023))
    expect(within(chips()).getByRole('button', { name: '2023' }).getAttribute('aria-pressed')).toBe('true')

    // The filing status sits beside it and PATCHes the year like the card's control did — once
    // the year's load has landed (the control is shut while a year is loading, as before).
    const status = () => within(scope).getByRole('group', { name: 'Filing status' })
    const mfj = () => within(status()).getByRole('button', { name: 'Married filing jointly' }) as HTMLButtonElement
    await waitFor(() => expect(mfj().disabled).toBe(false))
    fireEvent.click(mfj())
    await waitFor(() => expect(vi.mocked(patchTaxYear)).toHaveBeenCalledWith(2023, { filing_status: 'married_joint' }))
  })

  it('creates a year from the New tax year popover and closes it; Escape dismisses it', async () => {
    vi.mocked(fetchTaxYears)
      .mockResolvedValueOnce([year2023, year2024])
      .mockResolvedValueOnce([year2023, year2024, year2025])
    renderPage('/taxes?section=summary')
    await readyInputs()

    // Shut until asked: the page's primary action lives in the title row (spec §11, audit A3).
    expect(screen.queryByRole('dialog', { name: 'New tax year' })).toBeNull()
    const trigger = screen.getByRole('button', { name: 'New tax year…' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger.closest('.page-frame-actions')).toBeTruthy()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'New tax year' })
    expect(dialog.classList.contains('popover-surface')).toBe(true)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect((within(dialog).getByLabelText('New year') as HTMLInputElement).value).toBe('2025')
    // The create hint names the view the values are edited in — nothing is "below" any more.
    expect(within(dialog).getByText(/the values are then edited in Tax tables/)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create year' }))
    await waitFor(() => expect(vi.mocked(cloneBrackets)).toHaveBeenCalledWith(2025, 2024))
    // Created: the popover closes and the page is on the new year.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New tax year' })).toBeNull())
    expect(await screen.findByRole('button', { name: '2025' })).toBeTruthy()

    // Escape dismisses it (the shared usePopoverDismiss).
    fireEvent.click(screen.getByRole('button', { name: 'New tax year…' }))
    const reopened = screen.getByRole('dialog', { name: 'New tax year' })
    fireEvent.keyDown(within(reopened).getByLabelText('New year'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New tax year' })).toBeNull())
  })

  it('switches views from a panel’s door and writes ?section= like a tab does', async () => {
    vi.mocked(fetchTaxYears).mockResolvedValue([{ ...year2024, filing_status: 'married_joint' }])
    vi.mocked(fetchTaxSummary).mockImplementation(async (year: number) => ({
      ...summaryFor(year),
      brackets_missing_for_status: ['federal', 'state'],
    }))
    renderPage('/taxes?section=summary')

    // The summary's missing-tables call to action carries the door (spec §14).
    fireEvent.click(await screen.findByRole('button', { name: 'Open Tax tables' }))
    expect(await screen.findByLabelText('Federal bracket 1 rate (%)')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Tax tables' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('location').textContent).toContain('section=tables')
  })
})
```

- [ ] **Step 2: Run the file — the touched and new tests fail**

Run: `npx vitest run src/pages/TaxesPage.test.tsx`
Expected: many failures (`New tax year…` does not exist, so every helper that opens the popover
throws; the arm-and-confirm and scope-row tests fail). The count is not the point; Step 4 is.

- [ ] **Step 3: Implement**

**(a) Create `src/components/taxes/TaxYearMenu.tsx`:**
```tsx
import { useEffect, useRef, useState } from 'react'
import { usePopoverDismiss } from '../usePopoverDismiss'
import { FeedBanner } from '../shell/Feed'
import './taxes.css'

/**
 * "New tax year…" — the page's primary action, in PageFrame's actions slot (2026-09-13 polish
 * spec §11; audit A3/S1: the create/delete row sat in a <details> above every view's results).
 * One popover holds the whole year-management row: the year box and Create, and under a rule the
 * "Delete {year}…" door with its arm-and-confirm INSIDE the popover — no window.confirm; the
 * question and its two answers appear right where the reader is looking.
 *
 * The PAGE keeps the state and the requests (newYear, createYear, deleteYear); this component
 * owns only whether it is open and whether the delete is armed. `onCreate` resolves true when the
 * year now exists — the popover closes on it and hands focus back to the trigger.
 */
export default function TaxYearMenu({
  newYear,
  onNewYearChange,
  onCreate,
  creating,
  createError,
  disabled = false,
  yearMin,
  yearMax,
  createHint,
  selectedYear,
  onDelete,
  deleteDisabled = false,
}: {
  newYear: string
  onNewYearChange: (value: string) => void
  /** Resolves true when the year was created (the popover closes), false when it was refused. */
  onCreate: () => Promise<boolean>
  creating: boolean
  createError: string | null
  /** The whole menu is shut while the year list is still loading. */
  disabled?: boolean
  yearMin: number
  yearMax: number
  createHint: string
  /** null → the delete door renders shut, as "Delete year…". */
  selectedYear: number | null
  /** Runs AFTER the in-popover confirm: the page's deleteYear asks nothing further. */
  onDelete: () => void
  deleteDisabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  // The year the delete was armed FOR: a different selection while armed drops the arm, so the
  // question can never describe one year while the button deletes another.
  const [armedYear, setArmedYear] = useState<number | null>(null)
  const armed = armedYear !== null && armedYear === selectedYear
  const triggerRef = useRef<HTMLButtonElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const armRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const wasArmed = useRef(false)

  const close = () => {
    setOpen(false)
    setArmedYear(null)
  }
  // Outside pointerdown and Escape close it; focus returns to the trigger (the shared hook).
  usePopoverDismiss(open, close, triggerRef, surfaceRef)

  // The year box takes the caret when the popover opens — DOM calls only, no state.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])
  // Arming moves the caret onto the confirm button (the question is its description); a "Keep"
  // hands it back to the door that was pressed, so a keyboard reader is never left on nothing.
  useEffect(() => {
    if (armed) confirmRef.current?.focus()
    else if (wasArmed.current) armRef.current?.focus()
    wasArmed.current = armed
  }, [armed])

  return (
    <div className="tax-year-menu">
      <button
        ref={triggerRef}
        type="button"
        className="button button-primary"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
      >
        New tax year…
      </button>
      {open && (
        <div
          ref={surfaceRef}
          className="popover-surface tax-year-popover"
          role="dialog"
          aria-label="New tax year"
        >
          <form
            className="new-year-form"
            // The bounds are enforced (and worded) by the page's createYear. Left to the browser,
            // the message is a native bubble that differs per engine and blocks submit before
            // this page ever sees it.
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              onCreate().then((created) => {
                if (!created) return
                close()
                triggerRef.current?.focus()
              })
            }}
          >
            <label htmlFor="new-tax-year">New year</label>
            <input
              ref={inputRef}
              id="new-tax-year"
              className="field-input"
              type="number"
              inputMode="numeric"
              min={yearMin}
              max={yearMax}
              value={newYear}
              onChange={(e) => onNewYearChange(e.target.value)}
            />
            <button type="submit" className="button button-primary" disabled={creating}>
              {creating ? 'Creating…' : 'Create year'}
            </button>
            <span className="drill-hint">{createHint}</span>
          </form>
          <FeedBanner error={createError} />
          {/* The other end of this menu's job — Create makes the year in the box, Delete throws
              away the SELECTED one. Armed in place: the question and its two answers appear under
              the door, and "Keep" folds them away. type="button" throughout, so the form's submit
              stays the create path's alone. Disabled rather than absent with no year selected, so
              its shut state is visible rather than missing. */}
          <div className="tax-year-delete">
            <button
              ref={armRef}
              type="button"
              className="button"
              aria-expanded={armed}
              disabled={selectedYear === null || deleteDisabled}
              onClick={() => setArmedYear(armed ? null : selectedYear)}
            >
              {selectedYear === null ? 'Delete year…' : `Delete ${selectedYear}…`}
            </button>
            {armed && selectedYear !== null && (
              <div className="tax-year-delete-confirm">
                <p id="tax-year-delete-question" className="drill-hint">
                  Delete tax year {selectedYear} and all of its inputs and brackets? This cannot be undone.
                </p>
                <div className="tax-year-delete-actions">
                  <button
                    ref={confirmRef}
                    type="button"
                    className="button"
                    aria-describedby="tax-year-delete-question"
                    onClick={() => {
                      onDelete()
                      close()
                      triggerRef.current?.focus()
                    }}
                  >
                    Delete {selectedYear}
                  </button>
                  <button type="button" className="button" onClick={() => setArmedYear(null)}>
                    Keep {selectedYear}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
```

**(b) `src/pages/TaxesPage.tsx`** — imports: add
```tsx
import Segmented from '../components/shell/Segmented'
import TaxYearMenu from '../components/taxes/TaxYearMenu'
import type { TaxSection } from '../components/taxes/taxSections'
```
(`InfoHint`, `LocalSectionNav`, `FILING_STATUSES`, `FILING_STATUS_LABELS` stay in use.)

`createYear` — replace the whole function:
```tsx
  /**
   * Create the year in the box. Resolves TRUE when the year now exists (TaxYearMenu closes its
   * popover on it), FALSE when nothing was created — a refused year, a declined discard, a 409.
   * Everything after the request resolves is bookkeeping around a year that EXISTS, so none of it
   * may ever be reported as a create failure.
   */
  const createYear = (): Promise<boolean> => {
    const year = Number(newYear.trim())
    if (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX) {
      setCreateError(`Enter a year between ${YEAR_MIN} and ${YEAR_MAX}`)
      return Promise.resolve(false)
    }
    // Third of the reload doors (chips, Retry, create, delete, status): creating a year jumps
    // to it and remounts the editors, so it needs the same discard gate — and it must sit
    // before the request so a declined confirm can't orphan a created year.
    if (!confirmDiscard()) return Promise.resolve(false)
    // Seed from the newest year that actually HAS brackets. With none — a fresh database,
    // or a year list imported inputs-first — an empty inputs PUT is what creates the
    // tax_years row (both PUTs auto-create it; that IS the "new year" affordance).
    const source = latestOf(years.filter((y) => y.bracket_count > 0))
    setCreating(true)
    setCreateError(null)
    const request = source
      ? cloneBrackets(year, source.year)
      : putTaxInputs(year, { values: {} })
    return request
      .then(() => {
        // The year EXISTS from here on, so nothing past this point may be reported as a
        // create failure: a second Create against a year that now has brackets answers 409
        // forever.
        setNewYear(String(year + 1))
        // Show it immediately, with placeholder counts the reconcile below overwrites — a
        // failed list reload otherwise leaves the page sitting on the OLD year with no
        // trace of the one that was just made.
        setYears((current) =>
          current.some((y) => y.year === year)
            ? current
            : [
                ...current,
                // 'single' is the column's own default, so the placeholder cannot claim a
                // status the row does not have; the reconcile below replaces it either way.
                // `satisfies`, not a bare literal: inside the array the status would widen
                // to plain `string` and stop being a FilingStatus.
                {
                  year,
                  notes: null,
                  input_count: 0,
                  bracket_count: 0,
                  filing_status: 'single',
                } satisfies TaxYearOut,
              ].sort((a, b) => a.year - b.year),
        )
        loadYear(year)
        // The main banner owns this one, because the main banner is the thing with Retry.
        return reconcileYears()
          .catch((err: unknown) => {
            setError(describeError(err, 'the tax years'))
          })
          .then(() => true)
      })
      .catch((err: unknown) => {
        // 409 (the target already has brackets) and 404 (the source has none) both land
        // here verbatim — the year list is untouched, so nothing jumps.
        setCreateError(err instanceof ApiError ? err.message : 'Could not create the tax year')
        return false
      })
      .finally(() => setCreating(false))
  }
```
`deleteYear` — replace its opening (the doc comment, the signature and the `window.confirm`)
down to `const year = selectedYear`; everything from `// Everything still in flight…` on is unchanged:
```tsx
  // The FOURTH reload door (chips, Retry, create, delete). The question — "delete the year and
  // all of its inputs and brackets?" — is asked INSIDE the year menu's popover (TaxYearMenu's
  // arm-and-confirm, 2026-09-13 polish spec §11), so by the time this runs it has been answered.
  // No confirmDiscard() either: deleting the year throws away the SAVED inputs and brackets as
  // well as the typed ones, so "discard unsaved changes?" is a weaker question with nothing left
  // to add. One question, never two.
  const deleteYear = () => {
    if (selectedYear === null) return
    const year = selectedYear
```
Before `return (` add the door and the scope row:
```tsx
  // The panels' doors into other views (2026-09-13 polish spec §14): "Open Tax tables" in the
  // summary's missing-tables call to action, "Open Inputs" / "Open Tax tables" on the withholding
  // card. The same setter the tab strip uses, so a door pushes ?section= exactly as a tab does.
  const goTo = (section: TaxSection) => views.setSection(section)

  // The scope row (2026-09-13 polish spec §12; audit S1): the year and its filing status are what
  // every card on this page answers FOR, so they live in the sticky row Paycheck's person chips
  // use — not in a body card that cost 202px on every view. Only once there are years: a fresh
  // database has nothing to scope, and the frame draws no row for `undefined`.
  const scopeRow =
    years.length === 0 ? undefined : (
      <div className="scope-bar tax-scope-bar">
        <div className="scope-bar-group">
          {/* The group already announces itself as "Tax year": this word is the sighted label
              for the same thing (ScopeBar's own idiom). */}
          <span className="eyebrow" aria-hidden="true">
            Year
          </span>
          <Segmented
            variant="chips"
            ariaLabel="Tax year"
            options={years.map((y) => ({
              value: String(y.year),
              label: String(y.year),
              title: `${y.input_count} inputs · ${y.bracket_count} brackets`,
            }))}
            value={selectedYear === null ? '' : String(selectedYear)}
            onChange={(value) => selectYear(Number(value))}
          />
        </div>
        {/* The status of the SELECTED year, beside the year it belongs to — not another year
            to pick. Shut while the year is loading or the PATCH is in flight, as before. */}
        {selectedYear !== null && (
          <div className="scope-bar-group">
            <span className="eyebrow" aria-hidden="true">
              Filing status
            </span>
            <Segmented
              variant="toggle"
              ariaLabel="Filing status"
              options={FILING_STATUSES.map((status) => ({
                value: status,
                label: FILING_STATUS_LABELS[status],
                disabled: statusSaving || busy,
              }))}
              value={filingStatus}
              onChange={changeFilingStatus}
            />
            <InfoHint text="Which bracket tables the engine walks for this year, and whether the per-person inputs in the Inputs view split into two columns. Every year starts as Single." />
          </div>
        )}
      </div>
    )
```
Replace the whole `return (…)` of the component:
```tsx
  return (
    <div className="page taxes-page">
      <PageFrame
        title="Taxes"
        // The page's primary action lives in the title row (PageFrame's own note), never in the
        // scope row and never in a body card: create the next year, or delete the selected one.
        actions={
          <TaxYearMenu
            newYear={newYear}
            onNewYearChange={(value) => {
              setNewYear(value)
              // The create sentence described the year that WAS in the box.
              setCreateError(null)
            }}
            onCreate={createYear}
            creating={creating}
            createError={createError}
            disabled={loading}
            yearMin={YEAR_MIN}
            yearMax={YEAR_MAX}
            createHint="Copies the newest year's bracket tables; the values are then edited in Tax tables."
            selectedYear={selectedYear}
            onDelete={deleteYear}
            deleteDisabled={busy || creating}
          />
        }
        // Standing, never dismissible: MFS brackets without Form-8958 community-income splitting
        // are wrong in California, and the sentence has to sit wherever the number does (audit
        // §3.2, design decision log "MFS"). The frame's subheader is where a page-wide caveat
        // goes — under the title, above the sticky row that names the status it is about.
        subheader={
          selectedYear !== null && filingStatus === 'married_separate' ? (
            <p className="filing-status-caveat" role="note">
              California is a community-property state; true MFS requires 50/50
              community-income splitting (Form 8958), which this calculator does not model.
            </p>
          ) : undefined
        }
        sections={<LocalSectionNav state={views} label="Taxes views" />}
        scopeRow={scopeRow}
        resource={{
          // The years LIST is this page's lifecycle; a year's detail is the feed below it.
          // A first-load failure leaves no year selected and nothing to look at, so it is
          // the frame's own error state — with the Retry that reloads the list itself, or
          // the page dead-ends at the banner. With years already on screen the same message
          // rides the frame's stale line instead, over a body that still works.
          status: loading ? 'loading' : error !== null && years.length === 0 ? 'error' : 'ready',
          error,
          // Deliberately NO frame-level `busy`: the year detail is the only thing a load
          // moves, and this page's own `.taxes-page .loading-dim.is-loading` sets
          // pointer-events: none — a page-wide dim would take the year chips and the
          // year menu out of reach for the length of every year load. The Feed below
          // owns the dim, over exactly the editors that rule was written for.
          retry,
        }}
        // No KPI row on this page, so the ghost must not draw one: the two cards are the
        // totals strip and the panel under it.
        skeleton={{
          tiles: 0,
          cards: [
            { span: 12, height: 90 },
            { span: 12, height: 320 },
          ],
        }}
      >
        {/* loadedOnce, not !loading: a FIRST load that failed knows nothing about whether
            there are years, and "No tax years yet" under an error banner reads as an
            answer. The way to make one is the title row's "New tax year…". */}
        {loadedOnce && years.length === 0 && (
          <p className="empty-note">No tax years yet — create one to start.</p>
        )}

        {/* The selected year's own failures — a load, a status flip, a totals refresh, a
            delete — stay an assertive banner beside the year they are about, never the
            frame's "showing earlier data" line, which is the year LIST's grammar. */}
        <FeedBanner error={yearError} retry={retry} />
        <Feed
          data={detail}
          // A seeded-empty revisit has no year to ghost for: the list answers instantly
          // from the snapshot and there is nothing under the empty note.
          busy={busy && years.length > 0}
          staleNoun="the year"
          skeleton={{ height: 320, label: 'Loading the year…' }}
          // Only a delete gets here: every other path either selects a year or has no years
          // to select. Without it the page ends at the empty body with nothing saying the
          // chips in the scope row are waiting for a click.
          empty={
            selection === null && years.length > 0 ? (
              <p className="empty-note">Select a tax year above.</p>
            ) : undefined
          }
        >
          {(d) => (
            <>
              <LocalSectionPanel state={views} section="summary">
                <SummaryPanel summary={d.summary} filingStatus={filingStatus} goTo={goTo} />
                {d.summary.year === new Date().getFullYear() && (
                  <WithholdingPanel
                    key={`withholding-${d.summary.year}`}
                    year={d.summary.year}
                    storedVestW2={vestW2Stored(d.inputs)}
                    inputsDirty={inputsDirty}
                    onVestApplied={onVestApplied}
                    goTo={goTo}
                  />
                )}
                <MarginalPanel summary={d.summary} brackets={d.brackets} />
                <CompositionPanel refreshKey={trendRefresh} />
              </LocalSectionPanel>
              <LocalSectionPanel state={views} section="whatif">
                {/* The What-if tab IS the sandbox (2026-09-13 polish spec §8): open on arrival. */}
                <WhatIfPanel
                  key={`whatif-${d.summary.year}`}
                  year={d.summary.year}
                  definitions={overrideDefinitions(d.inputs)}
                  inputs={d.inputs}
                  brackets={d.brackets}
                  summary={d.summary}
                  onApplyOverrides={applyOverrides}
                  defaultOpen
                />
              </LocalSectionPanel>
              <LocalSectionPanel state={views} section="inputs">
                <InputsForm
                  key={`${inputsKey(d.inputs)}:${inputsEpoch}`}
                  inputs={d.inputs}
                  onSaved={onInputsSaved}
                  onDirtyChange={setInputsDirty}
                />
              </LocalSectionPanel>
              <LocalSectionPanel state={views} section="tables">
                <BracketsEditor
                  key={bracketsKey(d.brackets)}
                  brackets={d.brackets}
                  yearStatus={filingStatus}
                  onSaved={onBracketsSaved}
                  onDirtyChange={setBracketsDirty}
                />
              </LocalSectionPanel>
            </>
          )}
        </Feed>
      </PageFrame>
    </div>
  )
```
(`sections={<LocalSectionNav …/>}` is F2's line — keep it exactly as F2 merged it, and make sure
no `<LocalSectionNav>` remains in the body.)

**(c) `src/pages/TaxesPage.css`** — replace the whole file:
```css
/* Page-scoped rules ONLY (PortfolioPage.css's structure). The app-wide vocabulary
   (.page, .card, .eyebrow, .segmented, .field-input, .button, .error-banner, .empty-note,
   .loading-dim, .scope-bar, .scope-bar-group) lives in panels.css / shell.css, and everything the
   taxes components consume — including the year menu's popover and form — lives in
   src/components/taxes/taxes.css. Nothing either file defines is redefined here. */

.taxes-page .card {
  margin-bottom: 1rem;
}

/* Page-local, deliberately NOT in panels.css: elsewhere the dim covers read-only panels,
   but here it covers two editors, and a dimmed field that still accepts keystrokes takes
   typing that the arriving payload is about to replace. */
.taxes-page .loading-dim.is-loading {
  pointer-events: none;
}

/* Not an .error-banner — nothing failed — and not a chart warning either: the caveat belongs
   to the YEAR, so it rides the frame's subheader (2026-09-13 polish spec §12) under the title
   and above the scope row that names the status it is about, toned with --warn because it
   qualifies every figure below it rather than merely describing them. The subheader carries
   the spacing, so the paragraph carries none. */
.filing-status-caveat {
  margin: 0;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border);
  border-left: 3px solid var(--warn);
  border-radius: 6px;
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.45;
  /* The sentence names a form number and a state; it wraps rather than pushing the row
     sideways (taxes.css's .tax-warnings rule). */
  overflow-wrap: anywhere;
}
```
(`.taxes-page .chip-row`, `.new-year-form*`, `.filing-status-row` and `.filing-status-label`
are gone: the chips are a `Segmented`, the form moved into the component, the status row is
a `.scope-bar-group`.)

**(d) `src/components/taxes/taxes.css`** — append at the end:
```css
/* --- the year menu (TaxYearMenu, in the frame's actions slot) --- */

/* The create row that used to be TaxesPage.css's .new-year-form, moved here WITH the form: the
   menu is a component now, and a component must not depend on the page sheet being in the
   bundle (the note at the top of this file). The hint takes its own line under the row. */
.new-year-form {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.new-year-form label {
  font-size: 0.72rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--muted);
}

.new-year-form .field-input {
  width: 110px;
}

.new-year-form .drill-hint {
  margin: 0;
  flex-basis: 100%;
}

/* The trigger anchors the popover (panels.css's .popover-surface is position: absolute); it
   opens under the button's right edge, so it never runs off the page's right side. */
.tax-year-menu {
  position: relative;
}

.tax-year-menu .popover-surface {
  top: calc(100% + 6px);
  right: 0;
  min-width: 22rem;
}

.tax-year-menu .error-banner {
  margin-top: 0.6rem;
}

/* The delete door under a rule; armed, the question and its two answers appear beneath it. */
.tax-year-delete {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border);
}

.tax-year-delete-confirm {
  margin-top: 0.6rem;
}

.tax-year-delete-confirm .drill-hint {
  margin: 0 0 0.5rem;
  max-width: 40ch;
}

.tax-year-delete-actions {
  display: flex;
  gap: 0.5rem;
}
```

- [ ] **Step 4: Run the file — all green**

Run: `npx vitest run src/pages/TaxesPage.test.tsx && npx tsc -b`
Expected: every test passes (the file gains three), `tsc` silent. If a test that reads the year
box fails with "Unable to find a label with the text of: New year", it still calls
`screen.getByLabelText('New year')` directly — switch it to `newYearInput()` (Step 1 item 3).

- [ ] **Step 5: Commit**

```bash
git add src/components/taxes/TaxYearMenu.tsx src/pages/TaxesPage.tsx src/pages/TaxesPage.css src/pages/TaxesPage.test.tsx src/components/taxes/taxes.css
git commit -m "feat(taxes): year and filing status in the scope row, New tax year popover with in-place delete confirm, MFS caveat as subheader, panel doors (spec §11, §12, §14)"
```

---
## Task 13 — lane gates and hand-off (no source change)

**Files:** none modified (a failing gate is fixed in the task that owns the file, then re-run here).

- [ ] **Step 1: Types**

Run: `npx tsc -b`
Expected: no output, exit 0.

- [ ] **Step 2: Lint the lane's files**

Run: `npx eslint src/pages/PaycheckPage.tsx src/pages/CompPage.tsx src/pages/EsppPage.tsx src/pages/TaxesPage.tsx src/components/paycheck src/components/comp src/components/espp src/components/taxes src/sandbox`
Expected: no errors. Warnings: none new — `sentence()` in `WithholdingPanel.tsx` is module-private
and `TaxYearMenu.tsx` / `taxSections.ts` export one component / one type, so
`react-refresh/only-export-components` has nothing to say. If a warning appears, name it in the
hand-off with the line.

- [ ] **Step 3: Scoped tests**

Run: `npx vitest run src/pages/PaycheckPage.test.tsx src/pages/CompPage.test.tsx src/pages/EsppPage.test.tsx src/pages/TaxesPage.test.tsx src/components/paycheck src/components/comp src/components/espp src/components/taxes src/sandbox`
Expected: `Tests  N+21 passed` against Task 0's baseline N (1 sandbox + 1 TryIt + 1 WhatIf +
2 + 3 Paycheck + 3 Comp + 1 PositionStrip + 3 ESPP + 2 Summary + 2 Withholding + 1 Brackets +
1 Inputs + 3 TaxesPage = 24 new tests, minus none removed — the rewritten tests keep their slots),
no failures.

- [ ] **Step 4: Full suite and build**

Run: `npx vitest run && npm run build`
Expected: `Test Files  … passed`, `Tests  … passed`, no failures; `vite build` ends with the
`dist/` asset list and exit 0. A CLS-flake elsewhere (motion smoke) is not this lane's — note it,
do not touch it.

- [ ] **Step 5: Hand-off note for the lead (in the task report, not a file)**

List: the commit range; the baseline N and the final count; the three copy sites that still say
"below" legitimately (same card: `BracketsEditor.tsx` "edited below" in the clone paragraph,
`VestingSchedulePanel.tsx` "see the notes below", `EsppPage.tsx` "Hover or focus a meter bar
below") — spec §14 lists none of them; whether `Disclosure` was a default or named export; and
anything the primitives did not do as the Contracts block assumed (e.g. `usePopoverDismiss`
listening on the surface rather than the document — the Escape test dispatches on the input inside
the surface, so both work).

---

## Self-review (run before hand-off; fixes go inline, no second pass)

### 1. Spec coverage — every P3 requirement has a task

| Requirement (prompt § / spec §) | Task |
| --- | --- |
| Sandboxes open on their tabs: `SandboxPanel defaultOpen`, toggle hidden, Reset stays (§8) | 1 |
| `TryItPanel` / `WhatIfPanel` accept and forward `defaultOpen`; URL-entries latch still opens (§8) | 2, 3 |
| Paycheck passes it for `changes`; Taxes for `whatif` (§8) | 4, 12 |
| Eyebrows aligned to tab labels: "Try changes — effective …", "What-if — 2026", "Purchase model — 2026" (§8, C2) | 2, 3, 7 |
| Paycheck "Employer match" `.sandbox-disclosure` → `Disclosure` "Employer match (advanced)" (§11) | 2 |
| `.row-actions` + `.col-identity` + `useScrollEdges` on `.paycheck-scroll`, `.comp-scroll`, `.espp-scroll` ×2 (§7) | 5, 6, 7 |
| Comp focal history `Segmented` "Entered \| Computed \| All", default Entered (§7) | 6 |
| Comp `.vest-scroll` `clamp(420px, 60vh, 720px)` (X2) | 6 |
| Paycheck Summary: Breakdown `span-6` + Flow `span={6}` in `.card-grid`, pace beneath (§12) | 4 |
| Orphan "Edward + Grace…" removed; household tile `delta` from `householdNets` (§10) | 4 |
| Profiles intro two sentences; fieldsets match → HSA → split last; split as `Disclosure` (§11, §14) | 5 |
| "the waterfall, the flow and the history below" → "…the flow beside it and the history in Profiles" (§14) | 4 |
| ESPP `PositionStrip` `kpi-row-5` (§12) | 7 |
| ESPP lots hints attached to fields; one sentence + sold-pair rule (§14, C6) | 7 |
| "drive the modeler below" → "…the Purchase model view" + `goTo('purchase')` button (§14) | 7 |
| Taxes: year chips + filing status in `scopeRow` with `.scope-bar-group` + `.eyebrow` (§12) | 12 |
| Taxes `actions` = "New tax year…" popover: year input + Create + "Delete {year}…" arm-and-confirm (§11) | 12 |
| MFS caveat as `subheader` only under MFS; `details.tax-year-management` + card removed (§11, §12) | 12 |
| Editor "Bracket filing status" gets eyebrow "Editing tables for", stays a segmented (S3) | 10 |
| Tax tables `div.bracket-grid` + `div.bracket-group`; duplicated helper shown once (§12, C3) | 10 |
| Inputs: 40ch label track, hover wash, `.tax-form-actions` sticky `entry-footer` "N changes to save · Save inputs · Ctrl+Enter" (§12) | 11 |
| Will I owe: keep status/remedy/nudge/Apply; methodology + warnings in `Disclosure` "How this is estimated (N notes)"; `sentence()` (§11, §14) | 9 |
| All "below" sentences name the view / become `goTo` buttons: SummaryPanel 126/282/290/308, MarginalPanel 87, WithholdingPanel 258/471/496/557, TaxesPage 784/859 (§14) | 8, 9, 12 |
| `goTo(section)` prop threaded from `TaxesPage` (`views.setSection`) (§14) | 8, 9, 12 |
| Comp strip hidden on `manage` (§12) | 6 |
| Comp/ESPP empty-state notes become `goTo` buttons (§14, S4) | 6, 7 |
| House rules: no literal durations; `.entry-footer` copied into `taxes.css` as `.taxes-page .entry-footer`; sheets independent | 11 (and every CSS step) |
| Focused tests named in the prompt: defaultOpen no toggle; scope row handlers; popover create + Escape; bracket-grid; sticky save bar count; Disclosure count; goTo switches sections (MemoryRouter + `?section=`); column-set toggle; row-actions class | 1–3, 12, 12, 10, 11, 9, 12/6/7, 6, 5/6/7 |
| Gates: `tsc -b`, scoped eslint, scoped vitest, full vitest, build | 13 |

Not in this lane, on purpose (the prompt's list is the scope): audit C5 (What-if caveat as a
grid cell), D1 (Comp quote line with no grants), M1–M4 (F1/F2 motion), the Comp "Save all" idea.

### 2. Placeholder scan

No "TBD/TODO/later/similar to Task N". The two `{/* …exactly as today… */}` markers in Task 10
mark EXISTING markup that moves one level down unchanged (the form's children and the extras'
table) and say so; every new line is written out. Every code step has its code; every run step
has its command and expected outcome.

### 3. Type consistency

- `defaultOpen?: boolean` — `SandboxPanel` (Task 1), `TryItPanel` (2), `WhatIfPanel` (3);
  passed as bare `defaultOpen` by `PaycheckPage` (4) and `TaxesPage` (12).
- `TaxSection = 'summary' | 'whatif' | 'inputs' | 'tables'` (`taxSections.ts`, Task 8) —
  `goTo?: (section: TaxSection) => void` on `SummaryPanel` (8) and `WithholdingPanel` (9);
  `TaxesPage` defines `const goTo = (section: TaxSection) => views.setSection(section)` (12) —
  the literals equal `PAGE_SECTIONS`' ids, so it type-checks against `setSection`.
- `EsppSection = 'summary' | 'lots' | 'purchase'` (`EsppPage.tsx`, Task 7) — `OfferingsPanel.goTo`.
- `VestingSchedulePanel.goTo?: (section: 'manage') => void` (Task 6); `CompPage` passes
  `(section) => views.setSection(section)`.
- `ColumnSet = 'entered' | 'computed' | 'all'`; `COLUMN_SETS` `as const` → `Segmented`'s `V`
  infers the union, `onChange={setColumnSet}` type-checks (Task 6).
- `TaxYearMenu.onCreate: () => Promise<boolean>` ↔ `TaxesPage.createYear(): Promise<boolean>`;
  `onDelete: () => void` ↔ `deleteYear` (12).
- Class names used across tasks and tests: `paycheck-summary-grid`, `paycheck-split`,
  `paycheck-split-grid`, `tryit-disclosure`, `comp-column-set`, `espp-field`, `espp-sold-pair`,
  `espp-field-note`, `bracket-grid`, `bracket-group`, `bracket-status-row`, `entry-footer`,
  `is-dirty`, `tax-save-shortcut`, `tax-year-menu`, `tax-year-popover`, `tax-year-delete`,
  `tax-year-delete-confirm`, `tax-year-delete-actions`, `tax-scope-bar`, `withholding-method` —
  each is declared where its task's CSS step says, and spelled identically in the tests.

### 4. Spec ambiguities resolved in this plan (report these in the hand-off)

1. **Where `defaultOpen` lives.** `SandboxPanel` does not own the open state, so it treats
   `defaultOpen || open` as open and hides the toggle; the two panels ALSO seed their own
   `useState` from it, so `enabled: open` runs the first preview at once and the URL-entries latch
   is untouched.
2. **Employer match disclosure class.** `sandbox.css` is outside this lane (spec §1 lists only
   `SandboxPanel.tsx`), so the grid-spanning rule is `.tryit-disclosure` in `pace.css`, not a
   reuse of `.sandbox-disclosure` (whose `> summary` rule would fight `Disclosure`'s own).
3. **Paycheck percent/fraction note.** Audit C7 said "next to the % boxes"; five boxes would repeat
   it, so it moved into the Profile history heading's `InfoHint`, once. The intro is exactly two
   sentences.
4. **Split disclosure open state.** `Disclosure` keyed on `editingId ?? 'new'` with
   `defaultOpen` computed from the form's two split boxes: a stored split opens it, a blank row
   starts shut, and a carry-forward form that copies a split opens too.
5. **Comp column sets.** Entered = the six typed columns + Notes; Computed = the seven server
   columns (base/equity deltas, unvested equity, TC before/after); All = today's interleaved order;
   Year and the action cell always render, sticky. The intro's "everything to the right of the
   notes is computed" was false about the column order and is reworded.
6. **Comp strip on Manage** is a conditional render on `views.section` (spec §12's words), not a
   `hidden` attribute; Summary ↔ Vesting both show it so no height reservation is needed.
7. **Doors under `ChartCard` empty strings.** `ChartCard.empty` is a string, so the Manage
   buttons render in the card `footer` (TC trajectory) and in the schedule card's footer
   (VestingSchedulePanel) when the list is empty; `MarginalPanel` and the tax waterfall keep a
   string that names the view.
8. **Delete arm-and-confirm replaces `window.confirm`** in `deleteYear` (spec §11: "arm-and-confirm
   inside the popover"); the four page tests that pinned `confirmSpy` for delete now drive the
   popover. The create path keeps its `confirmDiscard()` window.confirm — that question is about
   the editors' unsaved work, not about the new year.
9. **Methodology count** pluralises ("1 note" / "N notes"); with the default fixture it reads
   "(2 notes)" and with one server warning "(3 notes)".
10. **`TaxSection` lives in `components/taxes/taxSections.ts`** so panels never import the page
    that mounts them (the page test mocks `WhatIfPanel`'s module with a default-only factory, and
    a value import cycle would be a hazard).
11. **`.entry-footer` scoping** follows the prompt (`.taxes-page .entry-footer` in `taxes.css`);
    the `.new-year-form` rules move from `TaxesPage.css` into `taxes.css` because the form now
    renders from a component, which must not depend on the page sheet.
12. **Popover lifecycle.** The trigger is disabled while the year list loads; a successful create
    closes the popover (`createYear` resolves `true` after the reconcile) and returns focus to the
    trigger; arming moves focus to the confirm button and "Keep" hands it back.
13. **"Purchase model" eyebrow** also changes the two test helpers that addressed the card by
    `/Purchase modeler/`.
14. **ESPP lots hints.** One table sentence stays above the form ("A sold lot is measured
    against…"); the blank-price rule sits under Purchase price, the sold-pair rule under the Sold
    date / Sold price pair (an `.espp-sold-pair` two-track group so the note spans both boxes).
15. **WithholdingPanel L258** (the Apply confirm) says "reloads the Inputs view"; the vest sentence
    (L557) names "the Inputs view" and keeps its Apply chip rather than gaining a second button.

---

## Results (implementer, 2026-09-13)

**Status: DONE.** Branch `polish/p3-income`, cut from `main` @`895cdaf` (F1 + F2 merged). Fourteen
commits, never pushed, no file deleted.

### Commits

| Task | SHA | Subject |
| --- | --- | --- |
| 1 | `0ab2e1f` | feat(sandbox): SandboxPanel defaultOpen — open from the first paint, no toggle (spec §8) |
| 2 | `c2715c2` | feat(paycheck): Try changes opens on its tab; Employer match is a Disclosure (spec §8, §11) |
| 3 | `beb6a16` | feat(taxes): What-if opens on its tab; eyebrow matches the tab label (spec §8) |
| 4 | `5a19a32` | feat(paycheck): breakdown beside its flow, household legs in the tile, Try changes open (spec §8, §10, §12) |
| 5 | `e96e2c5` | feat(paycheck): profiles — split behind a Disclosure, policies first, two-sentence intro, sticky table edges (spec §7, §11, §14) |
| 6 | `9e7d9bf` | feat(comp): focal history column sets, sticky edges, strip off Manage, Manage doors (spec §7, §12, §14) |
| 6b | `61a4a0b` | fix(paycheck): the history scroller renders before its first row so useScrollEdges arms (spec §7) — lead note |
| 7 | `841d659` | feat(espp): five-tile strip row, field-attached lot hints, Purchase model door, sticky table edges (spec §7, §12, §14) |
| 8 | `774df1b` | fix(copy): taxes summary and marginal cards name the view instead of "below"; Open Tax tables door (spec §14) |
| 9 | `d709bf1` | feat(taxes): Will I owe — methodology behind one Disclosure, server notes as sentences, view doors (spec §11, §14) |
| 10 | `a9b6690` | feat(taxes): bracket tables as a jurisdiction grid, status control labelled, helper sentence once (spec §12, §14) |
| 11 | `6dabde3` | feat(taxes): inputs form — 40ch label track, row wash, sticky save bar with count and shortcut (spec §12) |
| 12 | `17bb01b` | feat(taxes): year and filing status in the scope row, New tax year popover with in-place delete confirm, MFS caveat as subheader, panel doors (spec §11, §12, §14) |
| 13 | `3274ce9` | test(taxes): the sandbox-link walk reads the What-if card's open state off its body (spec §8) |

36 files changed, 1738 insertions, 650 deletions.

### Gates (Task 13)

| Gate | Result |
| --- | --- |
| `npx tsc -b` | clean, exit 0 |
| `npx eslint <lane paths>` | **0 errors, 3 warnings** — all pre-existing `react-refresh/only-export-components` in `src/sandbox/DeltaChip.tsx` (×2) and `src/sandbox/SliderBox.tsx`; this lane added none |
| `npx eslint .` | **25 problems (0 errors, 25 warnings)** — exactly the repo baseline of 25 |
| scoped `npx vitest run` | 34 files, **772 passed** (Task 0 baseline 749 → **+23 new tests**) |
| full `npx vitest run` | 214 files, **2953 passed**, 0 failed |
| `npm run build` | `✓ built in 9.40s`, exit 0 |

New-test count is 23, not the plan's predicted 24: the plan's PositionStrip item appends an
assertion to an existing test rather than adding one.

### Deviations (all in the plan's spirit, all recorded here)

1. **`Disclosure` is a default export** and its `onToggle` is `(open: boolean) => void`, not
   `() => void` as the Contracts block said. No call site in this lane passes `onToggle`, so
   nothing moved; the three `import Disclosure from '…'` lines are as written.
2. **Lead note: `useScrollEdges` arming.** The hook reads its ref once, at mount, so a scroller
   that only renders with the first row would never arm. Rather than wait for the `active` second
   argument, the four scrollers (`.paycheck-scroll`, `.comp-scroll`, ESPP lots `.espp-scroll`)
   now render their wrapper `<div>` unconditionally with the row guard moved inside, around the
   `<table>`. All three are bare `overflow-x: auto` boxes, so an empty one is invisible and
   zero-height, and the hook's own `ResizeObserver` picks the table up when rows arrive. The
   modeler's `.espp-scroll` was already inside a payload gate that mounts with its table.
   **Single-arg calls throughout** — if F2's `useScrollEdges(ref, active)` lands, these four call
   sites can take `active` and revert to a guarded wrapper, but they do not need it.
3. **Task 4's card-grid test needed a pace fixture.** The golden breakdown fixture carries no
   `pace` rows, so `PacePanel` drew nothing and `getByRole('region', { name: 'Contribution pace' })`
   found nothing. The test now seeds one `limit_401k_elective` row (the same shape the existing
   "renders the pace strip under the waterfall" test uses).
4. **Task 4 also had to update an existing test.** `PaycheckPage.test.tsx`'s "adds the two
   in-force nets into a household take-home tile" pinned the orphan caption
   `'Me + Sam — the profile in force for each person.'`; it now pins the tile's
   `.stat-delta` (`'Me $6,768.33 · Sam $5,231.34'`) instead. Updated in place, not deleted.
5. **Task 6: 24 existing CompPage tests used `$601,854.46` as their arrival gate.** That is
   `tc_after`, a *computed* column, which the default Entered set no longer renders. Every one of
   them is a "the table has loaded / is still up" gate, so all 24 were re-pointed to
   `'FY26 refresh'` (the 2026 row's own note, an Entered column). Two follow-ons:
   - "reloads BOTH feeds after a comp event write" renders with a full `SCHEDULE`, whose grant
     label is also "FY26 refresh" — its gate is now
     `findByRole('button', { name: 'Delete the 2026 comp event' })`.
   - "keeps the schedule up when a RELOAD of it fails" read `tile('Unvested')` and `'Next vest'`
     on Manage, where the strip is now hidden by design; it clicks through to Vesting before
     reading the tiles, keeping its banner-above-tiles order assertion intact.
6. **Task 12: two more TaxesPage tests needed the popover.** "offers a delete affordance that is
   shut until a year is selected" pinned the exact `Delete year…` label *before* the helper had
   opened the popover (reordered, plus an assertion that a shut door asks nothing); "drops the
   param with the year a delete removed" gained the `confirmDeleteButton()` click.
7. **Task 13: `src/pages/TaxesPage.sandboxLink.test.tsx` is a third Taxes page test file** the
   plan's scoped glob misses. Its `openButton()` helper reads the What-if Open/Close toggle, which
   `defaultOpen` removes; it now reads openness off the card's own "Reset to actual" button and
   asserts the gate is absent. Its own commit (`3274ce9`) so the change is legible.
8. **Task 8: `taxSections.ts` import placement.** Put beside the other component-relative imports
   (after `taxChartOptions`), above the `./taxes.css` line, so the sheet stays last.

### Notes for lane V

- **Taxes scope-row selectors.** `.page-frame-scope` → `.scope-bar.tax-scope-bar` with two
  `.scope-bar-group`s: `role="group"` `aria-label="Tax year"` (chips, `aria-pressed`, `title` =
  `"N inputs · M brackets"`) and `role="group"` `aria-label="Filing status"` (toggle). The
  brackets editor renders a *different* group, `aria-label="Bracket filing status"`, inside
  `.bracket-status-row` — scope any filing-status selector to `.page-frame-scope` or the two will
  collide. The scope row renders only when `years.length > 0`.
- **Year menu.** Trigger `button.button-primary[aria-haspopup="dialog"][aria-expanded]` named
  `New tax year…`, inside `.page-frame-actions`; surface
  `.tax-year-menu .popover-surface[role="dialog"][aria-label="New tax year"]`, anchored
  `top: calc(100% + 6px); right: 0` so it opens **leftward from the trigger's right edge**, inside
  the content column (lead note 2 — verified: nothing on the `.page-frame-header` chain clips it).
  Delete is arm-and-confirm inside the popover (`Delete {year}…` → `Delete {year}` / `Keep
  {year}`); **`window.confirm` is gone from the delete path** — the create path keeps its
  `confirmDiscard()` confirm, which is about the editors' unsaved work.
- **MFS caveat** is now `.page-frame-subheader > p.filing-status-caveat[role="note"]`.
- **Sticky save bar**: `.tax-form-actions.entry-footer` (`.is-dirty` while `changedCount > 0`),
  reading `N changes to save · Save inputs · Ctrl+Enter`. The `.entry-footer` rule is a scoped
  copy in `taxes.css` under `.taxes-page` — `MonthlyUpdatePage.css` is not imported.
- **Comp Manage** draws no vest tile strip; the column set defaults to **Entered** (nine columns),
  so §15 item 5's "first row's last action button within the viewport" should be measured on that
  default. `Segmented` `aria-label="Focal history columns"`.
- **Row-action acceptance**: `.paycheck-scroll`, `.comp-scroll` and both `.espp-scroll` tables now
  carry `td.col-identity` / `td.row-actions`; the first three render their wrapper even with no
  rows, so an empty-state walk will find an empty `div.*-scroll`.

### Copy sites that still say "below", legitimately (same card)

Spec §14 lists none of these:

- `BracketsEditor.tsx` — the clone paragraph's "…are then edited below" (the tables are directly
  under it, in the same card).
- `EsppPage.tsx` — the $25k chain hint's "Hover or focus a meter bar below" and the stale-chain
  warning's "the chain below is stale" (both name the meter rows in the same card).
- `PositionStrip.tsx` — "Unsaved period edits below" (the strip sits above the modeler card on the
  Purchase model tab).
- `VestingSchedulePanel.tsx` — "see the notes below" in the ChartCard `empty` string (the notes are
  in that card's own footer).

Everything else that matched `below` is a code comment.

### Follow-ups (not this lane)

- If F2 ships `useScrollEdges(ref, active)`, the four scrollers can go back to a guarded wrapper
  plus `active={rows.length > 0}` (deviation 2). Purely cosmetic — today's shape is correct.
- `TaxYearMenu` has no test file of its own; every behaviour is covered through
  `TaxesPage.test.tsx`'s new describe (`scope row and year menu`). A focused unit file would let
  the arm-and-confirm focus moves be asserted without the whole page.
- Audit C5 (What-if caveat as a grid cell), D1 (Comp quote line with no grants), the Comp
  "Save all" idea: out of scope by the plan's own list.
