# Polish L1 — Layout + sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make side-by-side layouts end together and the sidebar fit ordinary laptop screens — the design record's §2, §3 (except §3.3 Settings) and §5.5's first bullet (`docs/superpowers/specs/2026-09-25-polish-alignment-feedback-undo-design.md`), including shared contract **C5** (ChartCard `fill`) from `2026-09-25-polish-00-overview.md`.

**Architecture:** almost all of it is CSS, held by CSS text tests in the house style (`tableScrollCss.test.ts`: comments stripped, whitespace flattened, declarations pinned) because jsdom lays nothing out; the geometry itself is proven in headless Edge against the production-data copy (Task 17). The TypeScript changes are small and each has a Testing Library test: ChartCard gains `fill` (C5), `reserveControls` and a Table reveal; the Overview computes its deeper spans from the chosen order and FLIPs the reflow; the tax tables pack into two stacks; the Allocation list moves into a TableScroll box; the Guide detail gains a Step/Previous/Next foot; the sidebar footer becomes one row.

**Tech stack:** React 19 + TypeScript 5.9, Vite 6, Vitest 3 + Testing Library (jsdom), ECharts 6.1 (never rendered in jsdom — page tests mock `EChart`), CSS container queries and subgrid (Edge 152), headless Edge via playwright-core for the browser checks.

**Box rules (from the overview):** work only in `C:\Users\edyli\personal-finance-dashboard\.worktrees\polish-layout` on `feat/polish-layout`; its `node_modules` is a junction — never delete it. Type-check with `npx tsc -p tsconfig.app.json --noEmit` / `npx tsc -p tsconfig.node.json --noEmit`, never `tsc -b`. While developing run `npx vitest run <files>`; the whole suite once at the end with `--maxWorkers=4`. Commit per task; never push, never merge.

**Before-numbers, measured on this branch's base (657e3d62) in headless Edge against the production copy (`work-L1/measure.mjs`, results in `work-L1/results-before*.json`):**

| Surface | Before |
|---|---|
| Sidebar overflow (comfortable) | 1280×800 **86 px** (theme + log-out below the fold), 1366×768 **118 px** (both hidden), 1536×864 **22 px** (log-out hidden), 1440×900 0; compact: 1280×800 **18 px**, 1366×768 **50 px**; "Search or jump…" ellipsised at every comfortable width |
| Chart pairs, bottoms apart (Table closed) | Overview 63 px · Spending › Trends 84 / 68 / 36 px (1280 / 1440 / 1920) · Paycheck 109 / 95 / 97 px · ESPP 17 px · card detail 20 / 44 / 0 px; Table open: 292–460 px |
| Overview primary band | blank band under "Changes" 134 / 100 / 66 px; trend Table open → Data status 242–310 px blank |
| Calendar | 65 px between the weekday labels and the first week |
| Tax tables | 1280: one column (card 2,642 px); 1440: two grid columns, ragged gap up to 152 px; 1920: three columns, gap up to 447 px |
| Allocation card height | 431 / 725 / 431 / 461 / 431 px (spread 294 px; 310 px at 1280) |
| Budget meter ends | 1119.1 vs 1111.6 px (7.5 px ragged); empty track `--surface-2` (#1e222c on #171a21) |
| Pace meter ends | 1098 vs 1070.5 px (ESPP 27.5 px short) |
| Chart Table reveal | Net worth 21 px of the table visible, Taxes 0 px, Spending 86 px |

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/components/Layout.css` | modify | short-viewport nav rhythm (`@media (max-height: 900px)`) |
| `src/components/Layout.tsx` | modify | search pill label "Search…" |
| `src/components/shell/SidebarFooter.tsx` | modify | one-row footer: email (tooltip: env + build) · theme icon · log-out icon |
| `src/components/shell/shell.css` | modify | the footer's one-row rules (old row/pill/hash rules removed) |
| `src/components/sidebarCss.test.ts` | create | pins the rhythm and the footer rules |
| `src/components/ChartCard.tsx` | modify | `fill` (C5), `reserveControls`, `--chart-h`, Table reveal |
| `src/components/chartInteractions.css` | modify | slot → host → card flex chain; fill plot; aside plot centred |
| `src/components/chartFillCss.test.ts` | create | pins the chain, the fill plot and the aside centring |
| `src/pages/SpendingPage.tsx` | modify (Trends region + one const) | one configured height, reserved controls row, All categories → span 12 |
| `src/pages/OverviewPage.tsx` | modify (primary band, deeper spans, Customize) | trend `fill`; spans from order; FLIP wiring |
| `src/pages/OverviewPage.css` | modify | wealth rows `1fr auto`; Data status note pinned |
| `src/components/overview/customizeReflow.ts` | create | `deeperSpans`, `childRects`, `flipChildren` |
| `src/components/creditcards/carddetail.css` | modify | the credits card as a column, add-credit row pinned |
| `src/pages/CalendarPage.css` | modify | `.cal-grid { grid-template-rows: auto }` |
| `src/components/taxes/bracketColumns.ts` | create | `groupWeight`, `balancedSplit` |
| `src/components/taxes/BracketsEditor.tsx` | modify (layout wrapper only) | two stacks, split held per tab |
| `src/components/taxes/taxes.css` | modify | `.bracket-columns` / `.bracket-column`, one column under 900px of page |
| `src/components/portfolio/AllocationPanel.tsx` | modify (the aside's table) | ranked table inside a `TableScroll` box |
| `src/components/portfolio/allocation.css` | modify | aside capped at `--chart-h` beside the plot |
| `src/components/spending/budgets.css` | modify | one shared column template (subgrid); empty track `--fill` |
| `src/components/paycheck/pace.css` | modify | one shared column template (subgrid) |
| `src/guide/TaskDetail.tsx` | modify | the detail's foot: Step N of M · ← Previous · Next → |
| `src/guide/GuideCard.tsx` | modify (outside-scope, minimal) | passes the neighbours and the focus-moving select to TaskDetail |
| `src/pages/GuidePage.css` | modify | the foot's rules |
| Tests (modify) | `SidebarFooter.test.tsx`, `Layout.test.tsx`, `ChartCard.test.tsx`, `SpendingPage.test.tsx`, `OverviewPage.test.tsx`, `overviewCss.test.ts`, `calendarCss.test.ts`, `BracketsEditor.test.tsx`, `AllocationPanel.test.tsx`, `GuideCard.test.tsx` | |
| Tests (create) | `customizeReflow.test.ts`, `bracketColumns.test.ts`, `taxesCss.test.ts`, `allocationCss.test.ts`, `carddetailCss.test.ts`, `budgetsCss.test.ts`, `paceCss.test.ts` | |

`PaycheckPage.tsx`, the ESPP cards and `CardDetail.tsx` are NOT edited: their span-6 chart cards fill through ChartCard's default. `panels.css` is not touched (L2 owns its tile section).

**Shared-file regions (wave 1):** `OverviewPage.tsx` — this lane edits the imports, one block inserted after `showYtd` (before the `cashflowOnly` comment, one unchanged blank line between), the Year to date branch condition, the two deeper `span` props, the Customize `onChange`, the trend's `fill` and the deeper grid's `ref`; L2 owns the tile region (~440–560). `SpendingPage.tsx` — one const beside `MAX_TREND` and the Trends panel; L2 owns the KPI row.

---

## Task 1: Sidebar — the short-viewport rhythm

**Files:**
- Create: `src/components/sidebarCss.test.ts`
- Modify: `src/components/Layout.css` (the `.sidebar` comment, the `.sidebar-search span` comment, a new block after `.nav-link.active svg`)

- [ ] **Step 1: Write the failing test**

Create `src/components/sidebarCss.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (tableScrollCss.test.ts's idiom): a pin survives a re-indent and a
// comment moving, and fails only when a declaration actually changes. jsdom lays nothing out, so the
// rules are what can be held to the spec here (2026-09-25 polish spec §2); the fit itself — no
// scrollbar of its own, theme and Log out in view at 1280×800 … 1536×864 — is measured in Edge.
const flat = (file: string) =>
  readFileSync(path.join(__dirname, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')

const LAYOUT = flat('Layout.css')

/** The text between `opener`'s own `{` and the `}` that closes it — containment, not adjacency. */
function inside(css: string, opener: string): string {
  const start = css.indexOf(opener)
  expect(start, opener).toBeGreaterThan(-1)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}' && (depth -= 1) === 0) return css.slice(open + 1, i)
  }
  throw new Error(`unclosed ${opener}`)
}

describe('the sidebar on a short screen (Layout.css)', () => {
  // The nav + footer needed 886px: at 1280×800, 1366×768 and 1536×864 the sidebar grew its own
  // scrollbar and hid the theme and log-out buttons (SGS-06, MOTION-21).
  it('tightens the nav rhythm under 900px of height', () => {
    const short = inside(LAYOUT, '@media (max-height: 900px) {')
    expect(short).toContain('.nav-link { padding-top: 0.32rem; padding-bottom: 0.32rem; }')
    expect(short).toContain('.nav-heading { margin-top: 0.2rem; }')
    expect(short).toContain('.sidebar nav { gap: 0.3rem; }')
    expect(short).toContain('.sidebar-title { padding-bottom: 0.6rem; }')
    expect(short).toContain('.sidebar-search { margin-bottom: 0.4rem; }')
  })

  // "Nothing in the nav moves at ≥ 901 px of height": the tall rhythm stays the base rule.
  it('keeps the tall rhythm and the scrolling fallback outside that query', () => {
    expect(LAYOUT).toMatch(/\.nav-link \{[^}]*padding: 0\.5rem 0\.75rem;/)
    expect(LAYOUT).toMatch(/\.nav-heading \{[^}]*margin: 0\.35rem 0 0\.1rem;/)
    expect(LAYOUT).toMatch(/\.sidebar nav \{[^}]*gap: 0\.45rem;/)
    expect(LAYOUT).toMatch(/\.sidebar-title \{[^}]*padding: 0\.25rem 0\.75rem 1rem;/)
    expect(LAYOUT).toMatch(/\.sidebar-search \{[^}]*margin: 0 0\.25rem 0\.6rem;/)
    expect(LAYOUT).toMatch(/\.sidebar \{[^}]*overflow-y: auto;/)
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/components/sidebarCss.test.ts`
Expected: FAIL — `tightens the nav rhythm under 900px of height` fails with `@media (max-height: 900px) {: expected -1 to be greater than -1`; the second test passes.

- [ ] **Step 3: Implement**

In `src/components/Layout.css`, replace the `.sidebar` comment (lines 12–15) with:

```css
/* Sticky, not static: as a plain flex child the sidebar is as tall as the PAGE, so on a
   long page the nav scrolled away at the top and logout sat at the document's bottom.
   Pinned to the viewport instead (height is the viewport exactly — border-box, so the padding
   is inside it). Its own scrollbar is a fallback now, for a window under ~700px: the short-screen
   rhythm below and the one-row footer (shell.css) fit it from 768px of height up. */
```

Replace the `.sidebar-search span` comment (lines 53–54) with:

```css
/* One line always. The label is "Search…" (2026-09-25 polish spec §2): "Search or jump…" was cut to
   "Search or ju…" at every width, so the ellipsis below is now only a guard. */
```

After the `.nav-link.active svg { color: var(--accent); }` rule, add:

```css
/* Short screens (2026-09-25 polish spec §2, SGS-06): the nav and its footer needed 886px, so at
   1280×800, 1366×768 and 1536×864 the sidebar grew a scrollbar of its own and pushed the theme and
   log-out buttons below its fold. Under 900px of height the rhythm tightens — the links most of all,
   fourteen of them. Compact density scales these rems with the root font, so the two compose; at
   901px and up nothing here applies and nothing in the nav moves. */
@media (max-height: 900px) {
  .nav-link {
    padding-top: 0.32rem;
    padding-bottom: 0.32rem;
  }

  .nav-heading {
    margin-top: 0.2rem;
  }

  .sidebar nav {
    gap: 0.3rem;
  }

  .sidebar-title {
    padding-bottom: 0.6rem;
  }

  .sidebar-search {
    margin-bottom: 0.4rem;
  }
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run src/components/sidebarCss.test.ts src/components/motionCss.test.ts`
Expected: PASS (2 + existing motionCss tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/Layout.css src/components/sidebarCss.test.ts
git commit -m "feat(shell): tighten the sidebar's rhythm under 900px of height" -m "The nav and footer needed 886px, so 1280x800, 1366x768 and 1536x864 grew a sidebar scrollbar and hid theme/log-out (SGS-06, MOTION-21). Under 900px of height the link padding, heading margin, section gap, title and search spacing tighten (spec §2); compact density composes; >= 901px is unchanged."
```

---

## Task 2: Sidebar — the search pill reads "Search…"

**Files:**
- Modify: `src/components/Layout.tsx:186-190`
- Test: `src/components/Layout.test.tsx` (the "offers a visible search row" test)

- [ ] **Step 1: Write the failing test**

In `src/components/Layout.test.tsx`, replace the test `it('offers a visible search row that opens the palette', …)` with:

```tsx
  // The palette's discoverability, and the bus that carries the ask: the row is in the
  // sidebar, the palette is mounted next to <main>, and neither imports the other. The label is
  // "Search…" (2026-09-25 polish spec §2): "Search or jump…" was ellipsised at every width.
  it('offers a visible search row that opens the palette', () => {
    renderShell()
    expect(screen.queryByRole('combobox', { name: 'Command palette' })).toBeNull()
    const row = screen.getByRole('button', { name: /^Search…/ })
    expect(row.querySelector('span')?.textContent).toBe('Search…')
    // The key hint stays beside it.
    expect(row.querySelector('kbd')?.textContent).toMatch(/K$/)
    fireEvent.click(row)
    expect(screen.getByRole('combobox', { name: 'Command palette' })).toBeTruthy()
  })
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/components/Layout.test.tsx -t "visible search row"`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name /^Search…/`.

- [ ] **Step 3: Implement**

In `src/components/Layout.tsx`, replace the button block (lines 186–190):

```tsx
          <button type="button" className="sidebar-search" onClick={requestPaletteOpen}>
            <Search size={14} aria-hidden="true" />
            {/* "Search…", not "Search or jump…" (2026-09-25 polish spec §2): the long label was cut
                to "Search or ju…" at every width; the key hint says the rest. */}
            <span>Search…</span>
            <kbd aria-label={isMac ? 'Command K' : 'Control K'}>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run src/components/Layout.test.tsx`
Expected: PASS (all Layout tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/Layout.tsx src/components/Layout.test.tsx
git commit -m "feat(shell): the sidebar search pill reads 'Search…'" -m "'Search or jump…' was ellipsised at every width (SGS-06); the short label never truncates at 210px and the Ctrl K / Cmd K hint stays (spec §2)."
```

---

## Task 3: Sidebar — the one-row account footer

**Files:**
- Modify: `src/components/shell/SidebarFooter.tsx:28-113`
- Modify: `src/components/shell/shell.css:219-285` (the footer section)
- Test: `src/components/shell/SidebarFooter.test.tsx`, `src/components/sidebarCss.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/components/shell/SidebarFooter.test.tsx`, replace the tests `shows email, environment pill, build hash, and logs out`, `hides the pill until the status answers, and survives a failed status`, `drops the whole row when there is no email yet` and `keeps the diagnostics status where a mutation cannot wipe it` with:

```tsx
  // ONE row (2026-09-25 polish spec §2): the four stacked rows cost the sidebar ~90px, which on a
  // 768–864px laptop pushed theme and Log out below its fold.
  it('is one row — the email, then the theme and log-out icon buttons — and logs out', () => {
    render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    const footer = document.querySelector('.sidebar-footer') as HTMLElement
    expect(Array.from(footer.children).map((child) => child.className)).toEqual([
      'sidebar-footer-email',
      'sidebar-footer-icon',
      'sidebar-footer-icon',
    ])
    expect(screen.getByText('me@example.com')).toBeTruthy()
    // Icons only: the name is for a screen reader, the title for a pointer.
    const theme = screen.getByRole('button', { name: 'Switch to light theme' })
    expect(theme.textContent).toBe('')
    expect(theme.getAttribute('title')).toBe('Switch to light theme')
    const logOut = screen.getByRole('button', { name: 'Log out' })
    expect(logOut.textContent).toBe('')
    expect(logOut.getAttribute('title')).toBe('Log out')
    fireEvent.click(logOut)
    expect(logout).toHaveBeenCalled()
  })

  it("names the environment and the build in the email's tooltip, not on screen", async () => {
    render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    const email = screen.getByText('me@example.com')
    await waitFor(() => expect(email.getAttribute('title')).toBe('me@example.com · prod · build abc123'))
    expect(screen.queryByText('prod')).toBeNull()
    expect(screen.queryByText('abc123')).toBeNull()
  })

  it('leaves the environment out of the tooltip when the status never answers', async () => {
    vi.mocked(fetchSystemStatus).mockRejectedValue(new Error('offline'))
    render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    await waitFor(() => expect(fetchSystemStatus).toHaveBeenCalled())
    // An unlabeled environment is honest; a stale or guessed one is not.
    expect(screen.getByText('me@example.com').getAttribute('title')).toBe('me@example.com · build abc123')
  })

  it('keeps both buttons, and only them, while there is no email yet', () => {
    vi.mocked(useAuth).mockReturnValue({ email: null, isAuthenticated: true, isLoading: false, login: vi.fn(), logout, authError: null, retry: vi.fn() } as never)
    render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    expect(document.querySelector('.sidebar-footer-email')).toBeNull()
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Switch to light theme',
      'Log out',
    ])
  })

  it('keeps the diagnostics status where a mutation cannot wipe it', async () => {
    render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    await waitFor(() => expect(screen.getByText('me@example.com').getAttribute('title')).toContain('prod'))
    // api() clears every snapshot after any non-GET. A boundary reading the cache would lose
    // the environment and the alembic head the first time the user saved anything — exactly
    // the session in which they are most likely to need Copy details.
    clearSnapshots()
    expect(getSnapshot(SYSTEM_SNAPSHOT)).toBeUndefined()
    expect(getLastSystemStatus()).toMatchObject({ environment: 'prod' })
  })
```

Append to `src/components/sidebarCss.test.ts`:

```ts
const SHELL = flat('shell/shell.css')

describe('the one-row account footer (shell.css)', () => {
  it('lays the footer out as one row, the email taking the slack and ellipsising', () => {
    expect(SHELL).toMatch(/\.sidebar-footer \{[^}]*display: flex;[^}]*align-items: center;/)
    expect(SHELL).not.toMatch(/\.sidebar-footer \{[^}]*flex-direction: column;/)
    expect(SHELL).toMatch(
      /\.sidebar-footer-email \{[^}]*flex: 1;[^}]*min-width: 0;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/,
    )
  })

  it('draws the theme toggle and Log out as 28px icon buttons that never shrink', () => {
    expect(SHELL).toMatch(/\.sidebar-footer-icon \{[^}]*flex: none;[^}]*width: 28px;[^}]*height: 28px;[^}]*padding: 0;/)
    // With no email yet the buttons keep the row's end.
    expect(SHELL).toContain('.sidebar-footer-icon:first-of-type { margin-left: auto; }')
  })

  it('keeps the house hover and focus ring on the icon buttons', () => {
    expect(SHELL).toContain('.sidebar-footer-icon:hover { background: var(--surface-2); color: var(--text); }')
    expect(SHELL).toContain('.sidebar-footer-icon:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }')
  })

  it('retires the stacked rows, the environment pill and the hash', () => {
    for (const gone of ['.sidebar-footer-row', '.sidebar-footer-pill', '.sidebar-footer-hash']) {
      expect(SHELL).not.toContain(gone)
    }
  })
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/components/shell/SidebarFooter.test.tsx src/components/sidebarCss.test.ts`
Expected: FAIL — the footer's children are `sidebar-footer-row …`; the buttons carry text ("Light theme", "Log out"); no `title` on the email; the four shell.css tests fail (`flex-direction: column` present, no `.sidebar-footer-email { flex: 1`, no 28px buttons, the old classes present).

- [ ] **Step 3: Implement the component**

In `src/components/shell/SidebarFooter.tsx`, replace the comment above the component (lines 28–30) with:

```tsx
// Identity at the bottom of the sidebar (2026-09-03 shell spec §12) — who is signed in, which
// deployment and which build, so two tabs (dev vs prod) can never be confused — plus a one-click
// theme toggle and Log out. ONE row since 2026-09-25 (polish spec §2): the four stacked rows cost
// ~90px, which on a 768–864px laptop pushed both buttons below the sidebar's fold. The environment
// and the build now ride the email's tooltip (Settings › Data › System states them too).
```

Replace the `return (…)` block (lines 79–112) with:

```tsx
  // `{email} · {environment} · build {hash}`; the environment only once the status answered — an
  // unlabeled footer is honest, a stale or guessed environment is not.
  const identity = [email, status?.environment, `build ${buildHash}`].filter(Boolean).join(' · ')
  const themeLabel = `Switch to ${next} theme`
  return (
    <div className="sidebar-footer">
      {email && (
        <span className="sidebar-footer-email" title={identity}>
          {email}
        </span>
      )}
      {/* Icons, each named for a screen reader and titled for a pointer. */}
      <button type="button" className="sidebar-footer-icon" onClick={onToggleTheme} aria-label={themeLabel} title={themeLabel}>
        {resolved === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
      </button>
      <button type="button" className="sidebar-footer-icon" onClick={logout} aria-label="Log out" title="Log out">
        <LogOut size={16} aria-hidden="true" />
      </button>
    </div>
  )
```

- [ ] **Step 4: Implement the CSS**

In `src/components/shell/shell.css`, replace everything from `/* ── Sidebar footer (rendered by Plan 1c's SidebarFooter) ──…` through the end of the `.sidebar-footer-icon { … }` rule (the rules `.sidebar-footer`, `.sidebar-footer-row`, `.sidebar-footer-email`, `.sidebar-footer-pill`, `.sidebar-footer-pill.is-dev`, `.sidebar-footer-hash`, `.sidebar-footer-icon`) with:

```css
/* ── Sidebar footer (rendered by SidebarFooter) ─────────────────────────── */

/* ONE row (2026-09-25 polish spec §2): the email takes the slack and ellipsises; the theme toggle
   and Log out are 28px icon buttons at the row's end. The four stacked rows before it (email, the
   environment pill with the build hash, two labelled buttons) cost ~90px — enough, with the nav, to
   push both buttons below the sidebar's fold on a 768–864px laptop. */
.sidebar-footer {
  margin-top: auto;
  padding: 0.5rem 0.25rem 0;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 0.15rem;
  font-size: 0.72rem;
  color: var(--muted);
}

.sidebar-footer-email {
  flex: 1;
  min-width: 0;
  padding: 0 0.35rem 0 0.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-footer-icon {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--muted);
  cursor: pointer;
}

/* With no email yet (the session still loading) the buttons keep the row's end; beside an email,
   which already takes the slack, this changes nothing. */
.sidebar-footer-icon:first-of-type {
  margin-left: auto;
}
```

(The `.sidebar-footer-icon:hover`, `.sidebar-footer-icon:focus-visible` rules and the reduced-motion transition block that follow stay as they are.)

- [ ] **Step 5: Run them and see them pass**

Run: `npx vitest run src/components/shell/SidebarFooter.test.tsx src/components/sidebarCss.test.ts src/components/Layout.test.tsx src/components/surfaceGrammar.test.ts src/components/motionCss.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/SidebarFooter.tsx src/components/shell/shell.css src/components/shell/SidebarFooter.test.tsx src/components/sidebarCss.test.ts
git commit -m "feat(shell): one-row sidebar footer — email, theme icon, log-out icon" -m "Four stacked footer rows cost ~90px and pushed theme and Log out below the sidebar's fold on 768-864px laptops (SGS-06). The row is now [email, ellipsised][theme][log out]: 28px icon buttons with aria-label + title, the house hover and focus ring, the leaving-System toast unchanged. The environment and build move to the email's title ('{email} · {env} · build {hash}') per spec §2; Settings' System 'Build' fact is lane L5's."
```

---

## Task 4: ChartCard `fill` and the slot chain (contract C5)

**Files:**
- Modify: `src/components/ChartCard.tsx` (imports, props, destructuring, EChart height, section class/style)
- Modify: `src/components/chartInteractions.css:1`
- Create: `src/components/chartFillCss.test.ts`
- Test: `src/components/ChartCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/components/ChartCard.test.tsx`:

```tsx
// Contract C5 (2026-09-25 polish spec §3.1): a half-width card always has a partner in its row, so it
// grows its PLOT to the row's height — the configured height is the floor. jsdom lays nothing out;
// what the card declares is what can be pinned here, and chartFillCss.test.ts pins the CSS.
describe('ChartCard fill (spec §3.1, contract C5)', () => {
  const chart = () => screen.getByTestId('echart')
  const card = () => document.querySelector('section.chart-card') as HTMLElement

  it('fills by default at span 6: the chart takes the plot box and the configured height is its floor', () => {
    render(<ChartCard {...base} option={OPTION} span={6} height={260} />)
    expect(chart().getAttribute('data-height')).toBe('fill')
    expect(card().classList.contains('chart-card-fill')).toBe(true)
    expect(card().style.getPropertyValue('--chart-h')).toBe('260px')
  })

  it('keeps a fixed plot at span 12 unless asked, and takes `fill` when it is', () => {
    render(<ChartCard {...base} option={OPTION} height={220} />)
    expect(chart().getAttribute('data-height')).toBe('220')
    expect(card().classList.contains('chart-card-fill')).toBe(false)
    // The configured height is on every card: the Allocation aside caps itself at it (§3.6).
    expect(card().style.getPropertyValue('--chart-h')).toBe('220px')
    cleanup()
    render(<ChartCard {...base} option={OPTION} height={220} fill />)
    expect(chart().getAttribute('data-height')).toBe('fill')
    expect(card().classList.contains('chart-card-fill')).toBe(true)
  })

  it('lets a half-width card opt out', () => {
    render(<ChartCard {...base} option={OPTION} span={6} height={300} fill={false} />)
    expect(chart().getAttribute('data-height')).toBe('300')
    expect(card().classList.contains('chart-card-fill')).toBe(false)
  })

  it('never fills a card with an aside — its plot sits inside the aside wrapper, which does not grow', () => {
    render(<ChartCard {...base} option={OPTION} span={6} height={240} aside={<p>Legend</p>} />)
    expect(chart().getAttribute('data-height')).toBe('240')
    expect(card().classList.contains('chart-card-fill')).toBe(false)
  })

  it('keeps the skeleton at the configured height while the data is out — the CSS grows it with the row', () => {
    render(<ChartCard {...base} option={null} busy span={6} height={300} />)
    expect((document.querySelector('.chart-card-skeleton') as HTMLElement).style.height).toBe('300px')
    expect(card().classList.contains('chart-card-fill')).toBe(true)
  })
})
```

Create `src/components/chartFillCss.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (tableScrollCss.test.ts's idiom). jsdom computes none of these
// rules; the equal bottoms they produce are measured in Edge (2026-09-25 polish spec §3.1).
const flat = (file: string) =>
  readFileSync(path.join(__dirname, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')

const CHART = flat('chartInteractions.css')

describe('chart cards fill their row (chartInteractions.css)', () => {
  // The grid stretched only the slot; the portal host and the card inside it kept their content
  // height, so paired cards ended 17–95px apart (OU-04, NWSP-08, TPC-01c, PE-11, PCC-28).
  it("chains slot → host → card as column flexboxes, the Expand dialog's own chain", () => {
    expect(CHART).toContain('.chart-card-slot { min-width: 0; display: flex; flex-direction: column; }')
    expect(CHART).toContain('.chart-card-slot > div { flex: 1; display: flex; flex-direction: column; min-height: 0; }')
    expect(CHART).toContain('.chart-card-slot .chart-card { flex: 1; display: flex; flex-direction: column; }')
  })

  it("grows a filling card's plot from its configured height, contained so the row never ratchets", () => {
    expect(CHART).toContain(
      '.chart-card-slot .chart-card-fill > :is(.loading-dim, .chart-card-skeleton) { flex: 1 0 auto; min-height: var(--chart-h); contain: size; }',
    )
    // The chart itself never collapses below the floor, even where its box cannot be resolved.
    expect(CHART).toContain(".chart-card-slot .chart-card-fill > .loading-dim > [role='img'] { min-height: var(--chart-h); }")
  })

  it('keeps every fill rule under the slot, so the Expand dialog sizes its own card', () => {
    expect(CHART).toContain('.chart-expanded-dialog .loading-dim { flex: 1; min-height: 0; }')
    expect(CHART).not.toMatch(/(^|\}) *\.chart-card-fill/)
  })
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/components/ChartCard.test.tsx src/components/chartFillCss.test.ts`
Expected: FAIL — `data-height` is `260` not `fill`; no `chart-card-fill` class; `--chart-h` is `''`; the three CSS pins fail (`.chart-card-slot { min-width: 0; }` only).

- [ ] **Step 3: Implement ChartCard**

In `src/components/ChartCard.tsx`:

Replace `import type { ReactNode } from 'react'` with:

```tsx
import type { CSSProperties, ReactNode } from 'react'
```

In `ChartCardProps`, replace `span?: 6 | 12` with:

```tsx
  span?: 6 | 12
  /** Grow the plot to the card's height inside a stretched grid row (2026-09-25 polish spec §3.1,
   *  contract C5): the card ends on its partner's line and the extra height goes to the chart, not
   *  to a blank band under the footer. `height` stays the plot's floor. On by default at span 6 —
   *  every half-width card has a partner — and passed explicitly by the Overview's Net worth trend.
   *  Never with an `aside`: that plot sits inside the aside wrapper, which does not grow. */
  fill?: boolean
```

In the destructuring, replace `zoomable = false, group, busy = false, error = null, span = 12,` with:

```tsx
  zoomable = false, group, busy = false, error = null, span = 12, fill,
```

After `const { fromCache } = usePageFrame()`, add:

```tsx
  // C5: a half-width card fills unless it says otherwise; an aside card never does (above).
  const filled = aside === undefined && (fill ?? span === 6)
```

In the `body` branch that renders the chart, replace `height={expanded ? 'fill' : height}` with:

```tsx
          height={expanded || filled ? 'fill' : height}
```

Replace the `<section …>` opening tag with:

```tsx
    <section
      ref={cardRef}
      className={`card chart-card span-${span}${filled ? ' chart-card-fill' : ''}${aside !== undefined ? ' chart-card-has-aside' : ''}`}
      // The configured plot height as a variable: a filling plot's floor (chartInteractions.css) and
      // the Allocation aside's cap (allocation.css) read it.
      style={{ '--chart-h': `${height}px` } as CSSProperties}
    >
```

- [ ] **Step 4: Implement the CSS**

In `src/components/chartInteractions.css`, replace line 1 (`.chart-card-slot { min-width: 0; }`) with:

```css
/* The slot chain (2026-09-25 polish spec §3.1): ChartSurface portals the card into a class-less host
   div inside .chart-card-slot, and the grid stretched only the slot — the host and the card kept their
   content height, so paired cards ended 17–95px apart. slot → host → card is now a column flexbox
   chain, the Expand dialog's own (below), so a card always fills its slot. A slot nothing stretches is
   as tall as its card, exactly as before. */
.chart-card-slot { min-width: 0; display: flex; flex-direction: column; }
.chart-card-slot > div { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.chart-card-slot .chart-card { flex: 1; display: flex; flex-direction: column; }
/* A filling card (ChartCard `fill`) hands its extra height to the PLOT: the configured height
   (--chart-h, set on the card) is the floor and the plot grows with the row, so the footer ends on the
   card's bottom edge. contain: size keeps the canvas out of the row's measurement — a card that grew
   never ratchets the row, and when the neighbour's Table closes both shrink back. The skeleton holds
   the same box while the data is out. The chart's own floor is a guard for a box nothing resolves. */
.chart-card-slot .chart-card-fill > :is(.loading-dim, .chart-card-skeleton) { flex: 1 0 auto; min-height: var(--chart-h); contain: size; }
.chart-card-slot .chart-card-fill > .loading-dim > [role='img'] { min-height: var(--chart-h); }
```

- [ ] **Step 5: Run them and see them pass**

Run: `npx vitest run src/components/ChartCard.test.tsx src/components/chartFillCss.test.ts src/components/details/surfaceCss.test.ts src/components/surfaceGrammar.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ChartCard.tsx src/components/chartInteractions.css src/components/ChartCard.test.tsx src/components/chartFillCss.test.ts
git commit -m "feat(charts): ChartCard fill — paired chart cards end on one line (C5)" -m "The grid stretched .chart-card-slot but not the portal host or the card, so paired cards ended 17-95px apart (OU-04, NWSP-08, TPC-01c, PE-11, PCC-28). slot -> host -> card is now a column flex chain (the Expand dialog's). ChartCard gains fill (default span === 6, never with an aside): the plot wrapper and skeleton grow from --chart-h (the configured height) with contain: size so the row never ratchets, and EChart gets height='fill'."
```

---

## Task 5: Spending › Trends — one height, a reserved controls row, All categories full width

**Files:**
- Modify: `src/components/ChartCard.tsx` (props, destructuring, header)
- Modify: `src/pages/SpendingPage.tsx:60` (a const) and the Trends panel (`span`/`height`/`reserveControls` on the two ChartCards)
- Test: `src/components/ChartCard.test.tsx`, `src/pages/SpendingPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/components/ChartCard.test.tsx`:

```tsx
// Spending › Trends (spec §3.1): the card without controls reserves the controls row, so its plot
// starts on the same line as its partner's, whose header carries a Segmented.
describe('ChartCard reserveControls (spec §3.1)', () => {
  it('reserves an empty controls row in a header with nothing to put there', () => {
    render(<ChartCard {...base} option={OPTION} reserveControls />)
    const controls = document.querySelector('.chart-card-header .chart-card-controls') as HTMLElement
    expect(controls).toBeTruthy()
    expect(controls.childElementCount).toBe(0)
  })

  it('draws no controls row by default', () => {
    render(<ChartCard {...base} option={OPTION} />)
    expect(document.querySelector('.chart-card-controls')).toBeNull()
  })
})
```

Append to the `describe` in `src/pages/SpendingPage.test.tsx` that holds the "§18: the trends card swaps to small multiples on All categories" test:

```tsx
  // 2026-09-25 polish spec §3.1 (NWSP-08): one configured height for the pair, and the card without
  // controls reserves the controls row, so the two month axes start on one line; both fill the row.
  it('pairs the two Trends charts at one height, the card without controls reserving that row', async () => {
    renderPage()
    await openView('Trends')
    await screen.findByText(/Category trends/)
    const card = (name: RegExp) => screen.getByRole('heading', { name }).closest('section.chart-card') as HTMLElement
    const savings = card(/^Savings rate$/)
    const trends = card(/Category trends/)
    for (const section of [savings, trends]) {
      expect(section.classList.contains('span-6')).toBe(true)
      expect(section.classList.contains('chart-card-fill')).toBe(true)
      expect(section.style.getPropertyValue('--chart-h')).toBe('260px')
    }
    expect(savings.querySelector('.chart-card-header .chart-card-controls')?.childElementCount).toBe(0)
    expect(trends.querySelector('.chart-card-header .chart-card-controls')).not.toBeNull()
  })

  // NWSP-08/10: "All categories" leaves no half-row hole — the small multiples take the full row, and
  // the Savings rate card, which would otherwise sit alone beside ~570px of nothing, does too.
  it('spans both Trends cards across the row in All categories', async () => {
    renderPage()
    await openView('Trends')
    await screen.findByText(/Category trends/)
    fireEvent.click(screen.getByRole('button', { name: 'All categories' }))
    const card = (name: RegExp) => screen.getByRole('heading', { name }).closest('section.chart-card') as HTMLElement
    expect(card(/^Savings rate$/).classList.contains('span-12')).toBe(true)
    expect(card(/Category trends/).classList.contains('span-12')).toBe(true)
    expect(card(/Category trends/).classList.contains('chart-card-fill')).toBe(false)
  })
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/components/ChartCard.test.tsx src/pages/SpendingPage.test.tsx -t "reserve|Trends charts|All categories"`
Expected: FAIL — no `.chart-card-controls` for `reserveControls` (TS also rejects the unknown prop in the editor; vitest runs it); Savings `--chart-h` is `260px` but Category trends' is `220px`; the Savings card has no controls row; in All categories both are still `span-6`.

- [ ] **Step 3: Implement ChartCard**

In `ChartCardProps`, after the `fill?: boolean` block, add:

```tsx
  /** Reserve the header's controls row with nothing in it, so this card's plot starts on the same
   *  line as a paired card whose header carries controls (Spending › Trends, spec §3.1). */
  reserveControls?: boolean
```

In the destructuring, replace `zoomable = false, group, busy = false, error = null, span = 12, fill,` with:

```tsx
  zoomable = false, group, busy = false, error = null, span = 12, fill, reserveControls = false,
```

Replace the controls block inside `.chart-card-header`:

```tsx
        {(controls !== undefined || actions !== undefined || reserveControls) && (
          <div className="chart-card-controls">
            {controls}
            {actions}
          </div>
        )}
```

- [ ] **Step 4: Implement the Trends region**

In `src/pages/SpendingPage.tsx`, after `const MAX_TREND = 3` add:

```tsx
// The Trends pair's one plot height (2026-09-25 polish spec §3.1, NWSP-08): 260 and 220 put the two
// month axes 14px apart and ended the cards 36–84px apart. Both cards fill their row as well; this
// is the floor.
const TREND_HEIGHT = 260
```

On the Savings rate ChartCard, replace `span={6}` with `span={trendView === 'all' ? 12 : 6}`, replace `height={260}` with `height={TREND_HEIGHT}`, and add after it:

```tsx
            // Its partner's header carries the Compare / All categories toggle; the empty row keeps
            // the two plots — and their month axes — starting on one line.
            reserveControls={trendView === 'compare'}
```

On the Category trends ChartCard, replace `span={6}` with:

```tsx
            // All categories spans the row (NWSP-08/10): the small multiples need the width, and the
            // Savings rate card above takes the full row with it rather than sit beside a hole.
            span={trendView === 'all' ? 12 : 6}
```

and replace `height={trendView === 'all' ? smallMultiplesHeight(heatmapOrder.length) : 220}` with:

```tsx
            height={trendView === 'all' ? smallMultiplesHeight(heatmapOrder.length) : TREND_HEIGHT}
```

- [ ] **Step 5: Run them and see them pass**

Run: `npx vitest run src/components/ChartCard.test.tsx src/pages/SpendingPage.test.tsx`
Expected: PASS (all tests in both files).

- [ ] **Step 6: Commit**

```bash
git add src/components/ChartCard.tsx src/components/ChartCard.test.tsx src/pages/SpendingPage.tsx src/pages/SpendingPage.test.tsx
git commit -m "feat(spending): Trends pair — one plot height, a reserved controls row, All categories full width" -m "Savings rate (260) and Category trends (220) started their plots 14px apart and ended 36-84px apart (NWSP-08). Both now use TREND_HEIGHT and fill their row; the card without controls reserves the controls row (new ChartCard reserveControls). In All categories both cards span 12 (NWSP-08/10): the small multiples need the width, and Savings rate would otherwise sit beside a half-row hole."
```

---

## Task 6: The chart Table reveals itself (§5.5, MOTION-11)

**Files:**
- Modify: `src/components/ChartCard.tsx` (import, a ref + handler + effect, the export menu's `onToggleTable`)
- Test: `src/components/ChartCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/components/ChartCard.test.tsx`:

```tsx
// 2026-09-25 polish spec §5.5 (MOTION-11): "Table" opened the twin below the fold — 21px of it on
// Net worth, none on Taxes — and the click looked like it did nothing. jsdom has no scrollIntoView,
// so the prototype is stubbed (GuideCard.test's idiom).
describe('ChartCard Table reveal (spec §5.5)', () => {
  const csv = () => ({ headers: ['Month', 'Net worth'], rows: [['2026-08-01', '1500.00']] })
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
  let scrollIntoView: ReturnType<typeof vi.fn>
  beforeEach(() => {
    scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original)
    else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  })

  it('brings the opened twin into view — nearest, smoothly — and does nothing on close', () => {
    render(<ChartCard {...base} option={OPTION} csv={csv} />)
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })
    expect(scrollIntoView.mock.instances[0]).toBe(document.querySelector('.chart-table'))
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('lands at once for a reader who asked for less motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    render(<ChartCard {...base} option={OPTION} csv={csv} />)
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'instant' })
  })

  it('does not scroll again when the card re-renders with the twin open', () => {
    const { rerender } = render(<ChartCard {...base} option={OPTION} csv={csv} />)
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    rerender(<ChartCard {...base} option={{ series: [] } as EChartsOption} csv={csv} />)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/components/ChartCard.test.tsx -t "Table reveal"`
Expected: FAIL — `expected "spy" to be called 1 times, but got 0 times`.

- [ ] **Step 3: Implement**

In `src/components/ChartCard.tsx`, add the import beside the other component imports:

```tsx
import { prefersReducedMotion } from './useReducedMotion'
```

After the line `const table = showTable && csv ? csv() : null`, add:

```tsx
  // The Table twin opens where the reader is looking (2026-09-25 polish spec §5.5, MOTION-11): under a
  // tall chart it opened below the fold and the click looked like it did nothing. Only the click that
  // OPENS it scrolls — `nearest`, so a twin already on screen stays put — smoothly unless the reader
  // asked for less motion. In the Expand dialog it scrolls the dialog, the twin's own scroller.
  const revealTableRef = useRef(false)
  const toggleTable = () => {
    revealTableRef.current = !tableOpen
    setTableOpen((open) => !open)
  }
  useEffect(() => {
    if (!showTable || !revealTableRef.current) return
    revealTableRef.current = false
    cardRef.current
      ?.querySelector<HTMLElement>('.chart-table')
      ?.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'instant' : 'smooth' })
  }, [showTable])
```

In the `ChartExportMenu` props, replace `onToggleTable={csv === undefined ? undefined : () => setTableOpen((open) => !open)}` with:

```tsx
            onToggleTable={csv === undefined ? undefined : toggleTable}
```

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run src/components/ChartCard.test.tsx`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/components/ChartCard.tsx src/components/ChartCard.test.tsx
git commit -m "feat(charts): opening a chart's Table scrolls the twin into view" -m "The Table twin opened below the fold (21px visible on Net worth, 0 on Taxes) and the click looked like nothing happened (MOTION-11, spec §5.5). The opening click now scrolls it into view: block 'nearest', smooth unless prefers-reduced-motion. Closing and re-renders do not scroll."
```

---

## Task 7: Overview — the trend is the elastic card; Data status pins its note

**Files:**
- Modify: `src/pages/OverviewPage.css:179-187` (the primary band) and `:235` (`.data-status-note`)
- Modify: `src/pages/OverviewPage.tsx` (the trend ChartCard: `fill`)
- Test: `src/pages/overviewCss.test.ts`, `src/pages/OverviewPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/pages/overviewCss.test.ts`, replace the test `gives the two primary columns a shared bottom by stretching their last card` with:

```ts
  // Lane V measured the agenda column ending 66px below the wealth column (the limit is 24px); then
  // the stretch landed as a 66–134px blank band inside "Changes" (OU-04). The columns still share a
  // bottom, and the slack goes to something that can use it (2026-09-25 polish spec §3.2): on the left
  // the Net worth trend's row is the 1fr (the trend fills it), "Changes" keeps its own height; on the
  // right only the last card, Data status, takes slack — when the left column is the taller.
  it('gives the two primary columns a shared bottom — the slack to the trend, and to the agenda’s last card', () => {
    expect(declarationsFor(overview, '.overview-primary')).toContain('align-items: stretch;')
    expect(declarationsFor(overview, '.overview-wealth-column')).toContain('grid-template-rows: 1fr auto;')
    expect(declarationsFor(overview, '.overview-agenda-column')).toContain('grid-template-rows: auto auto 1fr;')
    // A stretched row must not reintroduce the margins the pair was built without.
    expect(declarationsFor(overview, '.overview-primary .card')).toContain('margin: 0;')
  })

  // With the trend's Table open the left column is the taller and Data status stretches (spec §3.2):
  // its note rides the card's foot instead of hanging over a 242–310px blank band.
  it("pins Data status's note to the card's foot, keeping its air when nothing stretches", () => {
    const card = declarationsFor(overview, '.overview-data-status')
    expect(card).toContain('display: flex;')
    expect(card).toContain('flex-direction: column;')
    const note = declarationsFor(overview, '.data-status-note')
    expect(note).toContain('margin: auto 0 0;')
    expect(note).toContain('padding-top: .6rem;')
  })
```

In `src/pages/OverviewPage.test.tsx`, append to `describe('OverviewPage chart cards (charts C2)', …)`:

```tsx
  // 2026-09-25 polish spec §3.2: the elastic card of the wealth column is the trend, which grows its
  // plot from 220px; "Changes" under it keeps its own height.
  it('lets the Net worth trend fill the wealth column', async () => {
    serve()
    renderPage()
    const trend = (await screen.findByRole('heading', { name: /Net worth trend/ })).closest('section.chart-card') as HTMLElement
    expect(trend.classList.contains('chart-card-fill')).toBe(true)
    expect(trend.style.getPropertyValue('--chart-h')).toBe('220px')
  })
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/pages/overviewCss.test.ts src/pages/OverviewPage.test.tsx -t "primary columns|Data status's note|fill the wealth column"`
Expected: FAIL — `grid-template-rows: auto 1fr;` found instead of `1fr auto;`; no `.overview-data-status {` block (`no .overview-data-status block`); the trend has no `chart-card-fill` class.

- [ ] **Step 3: Implement the CSS**

In `src/pages/OverviewPage.css`, replace the comment and rules at lines 179–187 (from `/* The two columns end on the same line …` through `.overview-agenda-column { grid-template-rows: auto auto 1fr; }`) with:

```css
/* The two columns end on one line (lane V: the agenda column ran 66px past the wealth column at
   1440 and 1920, over the 24px limit), and the slack goes to something that can use it (2026-09-25
   polish spec §3.2, OU-04). `stretch` hands both columns the taller one's height. On the left the Net
   worth trend's row is the 1fr and the trend fills it (ChartCard `fill`); "Changes" keeps its own
   height instead of carrying a 66–134px blank band. On the right the cards are content-sized and only
   the last, Data status, takes slack — when the left column is the taller (the trend's Table open),
   with its note pinned to its foot (below). Row counts are exact: trend + changes, and up next +
   needs attention + data status. */
.overview-primary { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(310px, 1fr); gap: 1rem; align-items: stretch; }
.overview-wealth-column, .overview-agenda-column { display: grid; gap: 1rem; min-width: 0; }
.overview-wealth-column { grid-template-rows: 1fr auto; }
.overview-agenda-column { grid-template-rows: auto auto 1fr; }
```

Replace `.data-status-note { margin: .6rem 0 0; }` with:

```css
/* Data status is the card that stretches when the wealth column runs taller (spec §3.2): a column, so
   its note rides the card's foot rather than hanging over a blank band. The note's air becomes padding
   so it holds when there is no slack to push it down. */
.overview-data-status { display: flex; flex-direction: column; }
.data-status-note { margin: auto 0 0; padding-top: .6rem; }
```

- [ ] **Step 4: Implement the trend's `fill`**

In `src/pages/OverviewPage.tsx`, on the "Net worth trend" ChartCard, replace `height={220}` with:

```tsx
                height={220}
                // The wealth column's elastic card (2026-09-25 polish spec §3.2): the plot grows with
                // the band from 220px, so "Changes" below keeps its own height.
                fill
```

- [ ] **Step 5: Run them and see them pass**

Run: `npx vitest run src/pages/overviewCss.test.ts src/pages/OverviewPage.test.tsx src/components/overview/DataStatusCard.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/OverviewPage.css src/pages/OverviewPage.tsx src/pages/overviewCss.test.ts src/pages/OverviewPage.test.tsx
git commit -m "feat(overview): the Net worth trend takes the primary band's slack" -m "The wealth column's last row was the 1fr, so 'Changes worth understanding' carried a 66-134px blank band; with the trend's Table open, Data status carried 242-310px (OU-04). Rows are now 1fr auto and the trend fills (ChartCard fill); the agenda stays content-sized with only Data status stretching, its note pinned to the card's foot (spec §3.2)."
```

---

## Task 8: Overview — Customize spans follow the chosen order

**Files:**
- Create: `src/components/overview/customizeReflow.ts`, `src/components/overview/customizeReflow.test.ts`
- Modify: `src/pages/OverviewPage.tsx` (an import; a block after `showYtd`; the Year to date branch; the two deeper `span` props)
- Test: `src/pages/OverviewPage.test.tsx`

- [ ] **Step 1: Write the failing unit tests**

Create `src/components/overview/customizeReflow.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { deeperSpans } from './customizeReflow'

// 2026-09-25 polish spec §3.2 (OU-16): the two half-width charts pair only when they are adjacent;
// the spans are computed from the order the reader chose instead of hard-coded.
describe('deeperSpans', () => {
  const spans = (shown: Parameters<typeof deeperSpans>[0]) => Object.fromEntries(deeperSpans(shown))

  it('pairs the two charts where they sit side by side — the default order', () => {
    expect(spans(['ytd', 'performance', 'spending', 'money_flow'])).toEqual({ ytd: 12, performance: 6, spending: 6, money_flow: 12 })
  })

  it('pairs them in either order', () => {
    expect(spans(['spending', 'performance', 'ytd'])).toEqual({ spending: 6, performance: 6, ytd: 12 })
  })

  it('runs a chart with no half-width neighbour across the row', () => {
    expect(spans(['ytd', 'spending', 'money_flow'])).toEqual({ ytd: 12, spending: 12, money_flow: 12 })
    expect(spans(['performance', 'money_flow', 'spending'])).toEqual({ performance: 12, money_flow: 12, spending: 12 })
  })

  it('spans nothing when nothing is shown', () => {
    expect(deeperSpans([]).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/components/overview/customizeReflow.test.ts`
Expected: FAIL — `Failed to resolve import "./customizeReflow"`.

- [ ] **Step 3: Implement `deeperSpans`**

Create `src/components/overview/customizeReflow.ts`:

```ts
import type { OverviewCard } from '../../prefs/overviewLayout'

/** The deeper views drawn half-width (2026-09-25 polish spec §3.2): the two chart cards that read as
 *  a pair. Every other deeper view runs the full row. */
export const HALF_WIDTH_CARDS: ReadonlySet<OverviewCard> = new Set<OverviewCard>(['performance', 'spending'])

/**
 * Each deeper view's span, from the order the reader chose in Customize (spec §3.2, OU-16): two
 * adjacent half-width views pair, 6 + 6, and a half-width view whose neighbour is not half-width runs
 * the full row — so hiding or reordering never strands a chart beside a ~567px hole. `shown` is the
 * render order with the views that draw nothing already left out: an empty Year to date between the
 * two charts must not keep them apart. Pairs are taken left to right.
 */
export function deeperSpans(shown: readonly OverviewCard[]): Map<OverviewCard, 6 | 12> {
  const spans = new Map<OverviewCard, 6 | 12>()
  for (let index = 0; index < shown.length; index += 1) {
    const id = shown[index]
    const next = shown[index + 1]
    if (HALF_WIDTH_CARDS.has(id) && next !== undefined && HALF_WIDTH_CARDS.has(next)) {
      spans.set(id, 6)
      spans.set(next, 6)
      index += 1
    } else {
      spans.set(id, 12)
    }
  }
  return spans
}
```

Run: `npx vitest run src/components/overview/customizeReflow.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Write the failing page tests**

In `src/pages/OverviewPage.test.tsx`, append a new describe after `describe('OverviewPage chart cards (charts C2)', …)`:

```tsx
// 2026-09-25 polish spec §3.2 (OU-16): the half-width charts pair only when adjacent in the order the
// reader chose; a chart with no half-width neighbour runs the full row.
describe('OverviewPage deeper spans follow the chosen order', () => {
  const spanOf = (name: RegExp): number | null => {
    const card = screen.getByRole('heading', { name }).closest('section.chart-card') as HTMLElement
    return card.classList.contains('span-6') ? 6 : card.classList.contains('span-12') ? 12 : null
  }
  const saveCards = (cards: string[]) =>
    localStorage.setItem(STORAGE_KEYS.overview_layout, JSON.stringify({ tiles: [...DEFAULT_OVERVIEW_LAYOUT.tiles], cards }))

  it('runs Recent spending across the row when Portfolio performance is hidden', async () => {
    saveCards(['ytd', 'spending', 'money_flow'])
    serve()
    renderPage()
    await screen.findByRole('heading', { name: /Recent spending/ })
    expect(spanOf(/Recent spending/)).toBe(12)
  })

  it('runs both charts across the row when Money flow sits between them', async () => {
    saveCards(['performance', 'money_flow', 'spending', 'ytd'])
    serve()
    renderPage()
    await screen.findByRole('heading', { name: /Recent spending/ })
    expect(spanOf(/Portfolio performance/)).toBe(12)
    expect(spanOf(/Recent spending/)).toBe(12)
  })

  it('pairs the two charts in either order when they are adjacent', async () => {
    saveCards(['spending', 'performance', 'ytd', 'money_flow'])
    serve()
    renderPage()
    await screen.findByRole('heading', { name: /Recent spending/ })
    expect(spanOf(/Portfolio performance/)).toBe(6)
    expect(spanOf(/Recent spending/)).toBe(6)
  })

  // Year to date draws nothing once its feeds answer without the rollup; an absent card is no
  // neighbour, so the two charts either side of it still pair.
  it('pairs the two charts across a Year to date that draws nothing', async () => {
    saveCards(['performance', 'ytd', 'spending', 'money_flow'])
    serve()
    vi.mocked(fetchYearly).mockRejectedValue(new ApiError('rollup offline', 503))
    renderPage()
    await screen.findByRole('alert')
    await screen.findByRole('heading', { name: /Recent spending/ })
    expect(screen.queryByRole('heading', { name: /Year to date/ })).toBeNull()
    expect(document.querySelector('.overview-deeper .loading-fallback')).toBeNull()
    expect(spanOf(/Portfolio performance/)).toBe(6)
    expect(spanOf(/Recent spending/)).toBe(6)
  })
})
```

- [ ] **Step 5: Run them and see them fail**

Run: `npx vitest run src/pages/OverviewPage.test.tsx -t "deeper spans"`
Expected: FAIL — the first two tests find `span-6` (hard-coded); the other two pass.

- [ ] **Step 6: Implement in the page**

In `src/pages/OverviewPage.tsx`, add after `import OverviewCustomize from '../components/overview/OverviewCustomize'`:

```tsx
import { deeperSpans } from '../components/overview/customizeReflow'
```

Immediately after the `showYtd` declaration (the line ending `(data.dividends?.length ?? 0) > 0)`), insert a blank line and:

```tsx
  // The deeper grid's spans follow the order the reader chose (2026-09-25 polish spec §3.2, OU-16),
  // over the views that DRAW: Year to date renders nothing once its feeds answer with no history, and
  // a card that is not there must not keep the two charts apart. Its skeleton, while those feeds are
  // out, is a card, so it counts.
  const ytdDraws = showYtd || (ytd === null && (wealth.busy || investments.busy || spending.busy))
  const shownDeeper = layout.cards.filter((id) => id !== 'ytd' || ytdDraws)
  const deeperSpan = deeperSpans(shownDeeper)
```

(Leave the existing blank line before the `// The matrix months are a UNION …` comment in place.)

In the Year to date entry of `deeperCards`, replace the condition line `) : ytd === null && (wealth.busy || investments.busy || spending.busy) ? (` with:

```tsx
            ) : ytdDraws ? (
```

On the Portfolio performance ChartCard, replace `span={6}` with:

```tsx
                span={deeperSpan.get('performance') ?? 12}
```

On the Recent spending ChartCard, replace `span={6}` with:

```tsx
                span={deeperSpan.get('spending') ?? 12}
```

- [ ] **Step 7: Run them and see them pass**

Run: `npx vitest run src/pages/OverviewPage.test.tsx src/components/overview/customizeReflow.test.ts`
Expected: PASS (all).

- [ ] **Step 8: Commit**

```bash
git add src/components/overview/customizeReflow.ts src/components/overview/customizeReflow.test.ts src/pages/OverviewPage.tsx src/pages/OverviewPage.test.tsx
git commit -m "feat(overview): deeper card spans follow the Customize order" -m "span={6} was hard-coded on Portfolio performance and Recent spending, so hiding or reordering left a chart alone beside a ~567px hole (OU-16). deeperSpans pairs two adjacent half-width views and runs a half-width view with no half-width neighbour across the row, over the views that draw (an empty Year to date never separates a pair) — spec §3.2."
```

---

## Task 9: Overview — a short FLIP for the Customize reflow

**Files:**
- Modify: `src/components/overview/customizeReflow.ts` (two functions), `src/components/overview/customizeReflow.test.ts`
- Modify: `src/pages/OverviewPage.tsx` (react import, type import, the reflow block, the Customize `onChange`, the deeper grid's `ref`)
- Test: `src/pages/OverviewPage.test.tsx`

- [ ] **Step 1: Write the failing unit tests**

Append to `src/components/overview/customizeReflow.test.ts` (and extend its imports to `import { afterEach, describe, expect, it, vi } from 'vitest'`, `import { EASE_OUT, MOTION_MS } from '../../theme/motion'`, `import { childRects, deeperSpans, flipChildren } from './customizeReflow'`):

```ts
function box(left: number, top: number): DOMRect {
  return { left, top, right: left + 100, bottom: top + 50, width: 100, height: 50, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

/** A container of children at the given boxes, each with a spy for animate() (jsdom has none). */
function container(boxes: DOMRect[]) {
  const root = document.createElement('div')
  const animate = vi.fn()
  for (const rect of boxes) {
    const child = document.createElement('div')
    child.getBoundingClientRect = () => rect
    child.animate = animate as unknown as Element['animate']
    root.appendChild(child)
  }
  return { root, animate }
}

describe('childRects', () => {
  it("reads each child's box under the id it draws, in render order", () => {
    const { root } = container([box(0, 0), box(600, 0)])
    expect(childRects(root, ['performance', 'spending'])).toEqual(new Map([['performance', box(0, 0)], ['spending', box(600, 0)]]))
  })

  it('is empty without a container', () => {
    expect(childRects(null, ['performance']).size).toBe(0)
  })
})

// 2026-09-25 polish spec §3.2 (OU-16): the popover's reflow glides instead of snapping behind it.
describe('flipChildren', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('glides a moved child from its old box, on --t-fast with the house curve', () => {
    const { root, animate } = container([box(0, 200)])
    flipChildren(root, ['spending'], new Map([['spending', box(600, 0)]]))
    expect(animate).toHaveBeenCalledWith([{ translate: '600px -200px' }, { translate: 'none' }], { duration: MOTION_MS.fast, easing: EASE_OUT })
  })

  it('fades in a child that was not there before', () => {
    const { root, animate } = container([box(0, 0)])
    flipChildren(root, ['money_flow'], new Map())
    expect(animate).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], { duration: MOTION_MS.fast, easing: EASE_OUT })
  })

  it('leaves a child that did not move alone', () => {
    const { root, animate } = container([box(0, 0)])
    flipChildren(root, ['ytd'], new Map([['ytd', box(0, 0)]]))
    expect(animate).not.toHaveBeenCalled()
  })

  it('does nothing for a reader who asked for less motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { root, animate } = container([box(0, 200)])
    flipChildren(root, ['spending'], new Map([['spending', box(600, 0)]]))
    expect(animate).not.toHaveBeenCalled()
  })

  it('does nothing where animate() is missing, or without a container', () => {
    const root = document.createElement('div')
    root.appendChild(document.createElement('div'))
    expect(() => flipChildren(root, ['spending'], new Map([['spending', box(600, 0)]]))).not.toThrow()
    expect(() => flipChildren(null, ['spending'], new Map())).not.toThrow()
  })
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/components/overview/customizeReflow.test.ts`
Expected: FAIL — `childRects` / `flipChildren` are not exported (`is not a function`).

- [ ] **Step 3: Implement the helpers**

In `src/components/overview/customizeReflow.ts`, add at the top:

```ts
import { EASE_OUT, MOTION_MS } from '../../theme/motion'
import { prefersReducedMotion } from '../useReducedMotion'
```

and append:

```ts
/** Each child's box, keyed by the view it draws: `ids` is the render order, one child per id. */
export function childRects(container: Element | null, ids: readonly string[]): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>()
  if (container === null) return rects
  ids.forEach((id, index) => {
    const child = container.children[index]
    if (child !== undefined) rects.set(id, child.getBoundingClientRect())
  })
  return rects
}

/**
 * The Customize reflow's short FLIP (spec §3.2, OU-16): each child that moved glides from where it
 * was, and one that was not there before fades in — --t-fast on the house curve, so the page
 * rearranging behind the popover reads as the same cards moving, not cards popping in and out. WAAPI
 * (the LocalSectionPanel idiom) on `translate`, so a card's scroll-linked reveal, which rides
 * `transform`, composes with it. Widths snap: a span change is not a move. Nothing under reduced
 * motion, or where animate() is missing (jsdom).
 */
export function flipChildren(container: Element | null, ids: readonly string[], before: ReadonlyMap<string, DOMRect>): void {
  if (container === null || prefersReducedMotion()) return
  ids.forEach((id, index) => {
    const child = container.children[index] as HTMLElement | undefined
    if (child === undefined || typeof child.animate !== 'function') return
    const was = before.get(id)
    if (was === undefined) {
      child.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOTION_MS.fast, easing: EASE_OUT })
      return
    }
    const now = child.getBoundingClientRect()
    const dx = Math.round(was.left - now.left)
    const dy = Math.round(was.top - now.top)
    if (dx === 0 && dy === 0) return
    child.animate([{ translate: `${dx}px ${dy}px` }, { translate: 'none' }], { duration: MOTION_MS.fast, easing: EASE_OUT })
  })
}
```

Run: `npx vitest run src/components/overview/customizeReflow.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 4: Write the failing page test**

Append to `describe('OverviewPage deeper spans follow the chosen order', …)` in `src/pages/OverviewPage.test.tsx`:

```tsx
  // The popover's reflow is FLIPped (spec §3.2). jsdom lays every box at 0,0, so nothing "moves" —
  // but a view shown again has no old box, and fades in.
  it('fades a view shown again from the Customize popover in', async () => {
    const animate = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true, writable: true })
    onTestFinished(() => Reflect.deleteProperty(HTMLElement.prototype, 'animate'))
    serve()
    renderPage()
    await screen.findByRole('heading', { name: new RegExp(`Money flow.*${CURRENT_YEAR}`) })
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Money flow' }))
    animate.mockClear()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Money flow' }))
    const flow = screen.getByRole('heading', { name: new RegExp(`Money flow.*${CURRENT_YEAR}`) }).closest('.chart-card-slot')
    const fades = animate.mock.instances.filter((_, i) => JSON.stringify(animate.mock.calls[i][0]) === JSON.stringify([{ opacity: 0 }, { opacity: 1 }]))
    expect(fades).toEqual([flow])
  })
```

- [ ] **Step 5: Run it and see it fail**

Run: `npx vitest run src/pages/OverviewPage.test.tsx -t "fades a view shown again"`
Expected: FAIL — `expected [] to deeply equal [ HTMLDivElement{…} ]`.

- [ ] **Step 6: Wire the FLIP into the page**

In `src/pages/OverviewPage.tsx`:

Replace `import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'` with:

```tsx
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
```

Replace `import { deeperSpans } from '../components/overview/customizeReflow'` with:

```tsx
import { childRects, deeperSpans, flipChildren } from '../components/overview/customizeReflow'
```

After `import { DEFAULT_OVERVIEW_LAYOUT } from '../prefs/overviewLayout'` add:

```tsx
import type { OverviewLayout } from '../prefs/overviewLayout'
```

Directly after `const deeperSpan = deeperSpans(shownDeeper)` (Task 8), add:

```tsx
  // …and the reflow glides (spec §3.2): the boxes are read in the Customize change handler, BEFORE the
  // new layout commits, and played in a layout effect after it — the page never paints in between. The
  // tile row is found from the deeper grid rather than given a ref of its own: its markup is the tile
  // lane's, and one child per tile is all this needs.
  const deeperRef = useRef<HTMLDivElement>(null)
  const reflowFrom = useRef<{ tiles: Map<string, DOMRect>; cards: Map<string, DOMRect> } | null>(null)
  const tileRow = () => deeperRef.current?.closest('.overview-page')?.querySelector('.kpi-row') ?? null
  const applyLayout = (next: OverviewLayout) => {
    reflowFrom.current = { tiles: childRects(tileRow(), layout.tiles), cards: childRects(deeperRef.current, shownDeeper) }
    setLayout(next)
    setLocal('overview_layout', next)
  }
  // Unkeyed on purpose: it runs after every commit and does nothing unless a Customize change left
  // boxes to play from; the ids it plays to are this render's.
  useLayoutEffect(() => {
    const from = reflowFrom.current
    if (from === null) return
    reflowFrom.current = null
    flipChildren(tileRow(), layout.tiles, from.tiles)
    flipChildren(deeperRef.current, shownDeeper, from.cards)
  })
```

Replace `<OverviewCustomize value={layout} onChange={next => { setLayout(next); setLocal('overview_layout', next) }} />` with:

```tsx
<OverviewCustomize value={layout} onChange={applyLayout} />
```

Replace `<div className="overview-deeper card-grid">` with:

```tsx
<div ref={deeperRef} className="overview-deeper card-grid">
```

- [ ] **Step 7: Run them and see them pass**

Run: `npx vitest run src/pages/OverviewPage.test.tsx src/components/overview/customizeReflow.test.ts src/components/overview/OverviewCustomize.test.tsx`
Expected: PASS (all).

- [ ] **Step 8: Commit**

```bash
git add src/components/overview/customizeReflow.ts src/components/overview/customizeReflow.test.ts src/pages/OverviewPage.tsx src/pages/OverviewPage.test.tsx
git commit -m "feat(overview): the Customize reflow glides — a short FLIP on --t-fast" -m "Toggling or reordering in the popover re-laid the page out instantly, cards popping in and out behind it (OU-16). The change handler reads the tile row's and deeper grid's boxes before the new layout commits; a layout effect plays a translate FLIP (moved) or a fade (newly shown) on --t-fast with the house curve, and nothing under reduced motion (spec §3.2)."
```

---

## Task 10: Card detail — the credits card ends with the chart card

**Files:**
- Modify: `src/components/creditcards/carddetail.css`
- Create: `src/components/creditcards/carddetailCss.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/creditcards/carddetailCss.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (tableScrollCss.test.ts's idiom); the equal bottoms are measured
// in Edge (2026-09-25 polish spec §3.1).
const CSS = readFileSync(path.join(__dirname, 'carddetail.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')

describe('card detail — the credits card beside the credit-line chart (carddetail.css)', () => {
  // PCC-28: the two cards ended 20–44px apart. The chart card now fills its row (ChartCard `fill`);
  // its non-chart partner is stretched by the grid, and pins its add row to its foot.
  it('lays the credits card out as a column with the add-credit row pinned to its foot', () => {
    expect(CSS).toContain('.card-detail .card-grid > .card { display: flex; flex-direction: column; }')
    expect(CSS).toContain('.card-detail .card-grid > .card > .credit-add { margin-top: auto; padding-top: 0.6rem; }')
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/components/creditcards/carddetailCss.test.ts`
Expected: FAIL — neither rule exists.

- [ ] **Step 3: Implement**

Append to `src/components/creditcards/carddetail.css`:

```css
/* The credits card ends with the credit-line chart card beside it (2026-09-25 polish spec §3.1,
   PCC-28: 20–44px apart). The chart card fills its row (ChartCard `fill`); this non-chart partner is
   stretched by the grid's default, and as a column it pins its add-credit row — with the rewards line
   under it — to its foot, so the space a taller neighbour leaves opens between the credits and their
   Add row, never under the card's last line. The row's air becomes padding, so it holds when nothing
   pushes it down. */
.card-detail .card-grid > .card {
  display: flex;
  flex-direction: column;
}

.card-detail .card-grid > .card > .credit-add {
  margin-top: auto;
  padding-top: 0.6rem;
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run src/components/creditcards/carddetailCss.test.ts src/components/creditcards/CardDetail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/creditcards/carddetail.css src/components/creditcards/carddetailCss.test.ts
git commit -m "feat(credit-cards): card detail's credits card ends with its chart partner" -m "The credits card and the credit-line chart card ended 20-44px apart (PCC-28). The chart card fills its row via ChartCard's span-6 default; the credits card, stretched by the grid, is a column with its add-credit row pinned to its foot (spec §3.1). CSS only."
```

---

## Task 11: Calendar — the weekday header sits on the first week

**Files:**
- Modify: `src/pages/CalendarPage.css:331-334`
- Test: `src/pages/calendarCss.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/pages/calendarCss.test.ts`:

```ts
describe('CalendarPage.css — the weekday header (2026-09-25 polish spec §3.4, PCC-04)', () => {
  // The header row is row 1 of the same grid (the ARIA rows are display: contents), and
  // grid-auto-rows sized it like a week: 76px for 15px of labels, a 65px blank band above the month.
  it('sizes the header row to its labels and leaves the weeks to the auto rows', () => {
    const grid = declarationsFor('.cal-grid')
    expect(grid).toContain('grid-template-rows: auto;')
    expect(grid).toContain('grid-auto-rows: minmax(76px, auto);')
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/pages/calendarCss.test.ts -t "weekday header"`
Expected: FAIL — `expected '…' to contain 'grid-template-rows: auto;'`.

- [ ] **Step 3: Implement**

In `src/pages/CalendarPage.css`, replace the Calendar v2 `.cal-grid` rule (lines 331–334) with:

```css
.cal-grid {
  grid-template-columns: repeat(7, minmax(0, 1fr)) 84px;
  /* Row 1 is the weekday header (2026-09-25 polish spec §3.4, PCC-04): sized to its labels. The auto
     rows below still size the weeks — without this they sized the header too, a 76px row for 15px of
     text that left a 65px band between the names and the first week. */
  grid-template-rows: auto;
  grid-auto-rows: minmax(76px, auto);
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run src/pages/calendarCss.test.ts src/components/surfaceGrammar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/CalendarPage.css src/pages/calendarCss.test.ts
git commit -m "fix(calendar): the first week sits right under the weekday names" -m "grid-auto-rows: minmax(76px, auto) also sized the header row, leaving 65px of blank between the weekday labels and the first week (PCC-04). grid-template-rows: auto sizes row 1 to its labels; the weeks keep the auto rows (spec §3.4)."
```

---

## Task 12: Tax tables — two independent columns

**Files:**
- Create: `src/components/taxes/bracketColumns.ts`, `src/components/taxes/bracketColumns.test.ts`, `src/components/taxes/taxesCss.test.ts`
- Modify: `src/components/taxes/BracketsEditor.tsx` (imports; a split held per tab after `isEmpty`; the grid wrapper)
- Modify: `src/components/taxes/taxes.css:253-276`
- Test: `src/components/taxes/BracketsEditor.test.tsx` (the "lays the jurisdictions out as a grid of groups" test)

- [ ] **Step 1: Write the failing unit tests**

Create `src/components/taxes/bracketColumns.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { balancedSplit, groupWeight } from './bracketColumns'

describe('groupWeight', () => {
  it('counts the heading, the column heads and the buttons, then a row per bracket', () => {
    expect(groupWeight(7)).toBe(10)
  })

  it("counts an empty table as its one-line note", () => {
    expect(groupWeight(0)).toBe(4)
  })

  it("adds the per-worker strip: the helper, then an earner's own table or the one-line offer", () => {
    expect(groupWeight(2, { helper: true, people: [0, 2] })).toBe(5 + 1 + 1 + 5)
    expect(groupWeight(2, { helper: false, people: [0] })).toBe(5 + 1)
  })
})

// 2026-09-25 polish spec §3.5 (TPC-12d): two independent columns, the order kept whole.
describe('balancedSplit', () => {
  it('splits where the two columns come closest in height', () => {
    // Production-shaped: Federal 7, State 10, Medicare 2, Social Security 2 + strip, Disability 2 + two
    // earners' tables, Capital gains 3.
    expect(balancedSplit([10, 13, 5, 8, 15, 6])).toBe(3)
  })

  it('keeps the longer column first on a tie', () => {
    expect(balancedSplit([1, 2, 1])).toBe(2)
  })

  it('leaves fewer than two groups in one column', () => {
    expect(balancedSplit([])).toBe(0)
    expect(balancedSplit([5])).toBe(1)
  })
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/components/taxes/bracketColumns.test.ts`
Expected: FAIL — `Failed to resolve import "./bracketColumns"`.

- [ ] **Step 3: Implement the helpers**

Create `src/components/taxes/bracketColumns.ts`:

```ts
/**
 * A bracket group's height in table rows (2026-09-25 polish spec §3.5), estimated from what it holds:
 * the heading, the column heads and the button row (≈ 3 rows), then a row per bracket — an empty
 * table's note is one. Under a per-worker table the strip adds its helper sentence where it has it,
 * then per earner either their own table (its head, column heads and buttons, ≈ 3, plus its rows) or
 * the one-line offer to add one. An estimate, not a measurement: it only has to tell a 10-row state
 * table from a 2-row Medicare one.
 */
export function groupWeight(rows: number, strip?: { helper: boolean; people: readonly number[] }): number {
  const table = 3 + Math.max(rows, 1)
  if (strip === undefined) return table
  return table + (strip.helper ? 1 : 0) + strip.people.reduce((sum, own) => sum + (own > 0 ? 3 + own : 1), 0)
}

/**
 * Where the second column starts (spec §3.5, TPC-12d): the contiguous split of `weights` whose two
 * columns come closest in height, a tie keeping the longer column first. Contiguous on purpose — the
 * first column reads down, then the second — so the tables stay in JURISDICTIONS order for the eye,
 * the keyboard and a screen reader, in two columns or one. Fewer than two groups stay together.
 */
export function balancedSplit(weights: readonly number[]): number {
  if (weights.length < 2) return weights.length
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let best = 1
  let bestGap = Number.POSITIVE_INFINITY
  let first = 0
  for (let at = 1; at < weights.length; at += 1) {
    first += weights[at - 1]
    const gap = Math.abs(total - 2 * first)
    if (gap <= bestGap) {
      best = at
      bestGap = gap
    }
  }
  return best
}
```

Run: `npx vitest run src/components/taxes/bracketColumns.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 4: Write the failing editor and CSS tests**

In `src/components/taxes/BracketsEditor.test.tsx`, replace the test `lays the jurisdictions out as a grid of groups, each table over its own strip` with:

```tsx
  it('lays the jurisdictions out in two independent stacks, in JURISDICTIONS order, each table over its own strip', () => {
    render(<BracketsEditor brackets={bracketsFixture()} onSaved={vi.fn()} />)
    // 2026-09-25 polish spec §3.5 (TPC-12d): two stacks, not grid rows — a short table leaves no
    // ragged gap beside a tall one. The fixture's estimated heights (Federal 5, State 4, Medicare 4 |
    // Social Security 6, Disability 5, Capital gains 4) split three and three.
    const columns = document.querySelector('.bracket-columns') as HTMLElement
    expect(Array.from(columns.children).map((column) => column.className)).toEqual(['bracket-column', 'bracket-column'])
    expect(
      Array.from(columns.children).map((column) => Array.from(column.children).map((group) => group.querySelector('h3')?.textContent)),
    ).toEqual([
      ['Federal brackets', 'State brackets', 'Medicare brackets'],
      ['Social Security brackets — default for everyone', 'Disability brackets — default for everyone', 'Capital gains brackets'],
    ])
    const groups = Array.from(columns.querySelectorAll('.bracket-column > *'))
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
    const row = screen.getByText('Tables for status').closest('.bracket-status-row') as HTMLElement
    expect(row.contains(screen.getByRole('group', { name: 'Tables for status' }))).toBe(true)
  })

  // The split is read off the SAVED tables and held while editing: an added row grows its column in
  // place and never moves a table — or a focused Save — to the other side.
  it('holds the split while rows are added', () => {
    render(<BracketsEditor brackets={bracketsFixture()} onSaved={vi.fn()} />)
    const stacks = () =>
      Array.from(document.querySelectorAll('.bracket-column')).map((column) => column.querySelectorAll(':scope > .bracket-group').length)
    expect(stacks()).toEqual([3, 3])
    for (let i = 0; i < 6; i += 1) fireEvent.click(screen.getByRole('button', { name: 'Add Federal bracket' }))
    expect(stacks()).toEqual([3, 3])
  })
```

Create `src/components/taxes/taxesCss.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (tableScrollCss.test.ts's idiom); the packed columns are measured
// in Edge (2026-09-25 polish spec §3.5).
const CSS = readFileSync(path.join(__dirname, 'taxes.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')

describe('Tax tables in two independent columns (taxes.css)', () => {
  it('packs the tables in two stacks that end independently', () => {
    expect(CSS).toContain('.bracket-columns { display: flex; align-items: flex-start; gap: 1rem 2rem; }')
    expect(CSS).toContain('.bracket-column { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 1rem; }')
  })

  // Two columns down to 900px of PAGE — 1280 (≈990px) keeps two, the dock gets one.
  it('falls to one column below 900px of page, asked for by name', () => {
    expect(CSS).toContain('@container page (max-width: 899px) { .bracket-columns { flex-direction: column; align-items: stretch; } }')
  })

  it('retires the row grid', () => {
    expect(CSS).not.toContain('.bracket-grid')
  })
})
```

- [ ] **Step 5: Run them and see them fail**

Run: `npx vitest run src/components/taxes/BracketsEditor.test.tsx src/components/taxes/taxesCss.test.ts`
Expected: FAIL — `.bracket-columns` is null (`Cannot read properties of null (reading 'children')`), the three CSS pins fail.

- [ ] **Step 6: Implement the editor**

In `src/components/taxes/BracketsEditor.tsx`:

After `import { useEffect, useRef, useState } from 'react'` add:

```tsx
import type { ReactNode } from 'react'
```

After `import AmountInput from '../AmountInput'` add:

```tsx
import { balancedSplit, groupWeight } from './bracketColumns'
```

Immediately after the `const isEmpty = …` line, add:

```tsx
  // Two independent columns (2026-09-25 polish spec §3.5, TPC-12d): a short table no longer leaves a
  // ragged hole beside a tall one. The split is read off the SAVED tables and held for this tab — and
  // re-read when a clone fills an empty one — so rows added while editing grow their column in place,
  // and a save never moves a table, or the Save under the pointer, to the other side.
  const splitKey = `${activeStatus}:${isEmpty ? 'empty' : 'rows'}`
  const weigh = (): number[] => [
    ...JURISDICTIONS.map((name) =>
      groupWeight(
        (payload.jurisdictions[name] ?? []).length,
        PER_WORKER_JURISDICTIONS.includes(name) && people.length > 0
          ? {
              helper: name === firstStripName,
              people: people.map(
                (person) =>
                  (payload.per_person ?? []).find((entry) => entry.person_id === person.id)?.jurisdictions[name]?.length ?? 0,
              ),
            }
          : undefined,
      ),
    ),
    ...extras.map((name) => groupWeight((payload.jurisdictions[name] ?? []).length)),
  ]
  const [split, setSplit] = useState(() => ({ key: splitKey, at: balancedSplit(weigh()) }))
  if (split.key !== splitKey) setSplit({ key: splitKey, at: balancedSplit(weigh()) })
  // The two stacks. Keyed, so each keeps its identity across renders; a group changes stacks only
  // when the split itself moves (a tab switch, a clone).
  const columns = (groups: ReactNode[]) => [
    <div key="first" className="bracket-column">
      {groups.slice(0, split.at)}
    </div>,
    ...(split.at < groups.length
      ? [
          <div key="second" className="bracket-column">
            {groups.slice(split.at)}
          </div>,
        ]
      : []),
  ]
```

Replace the wrapper `<div className="bracket-grid">` and its two child expressions: change `<div className="bracket-grid">` to:

```tsx
      <div className="bracket-columns">
        {columns([
```

change the line `{JURISDICTIONS.map((name) => {` to `...JURISDICTIONS.map((name) => {`, change the `})}` that closes it to `}),`, change `{extras.map((name) => (` to `...extras.map((name) => (`, change the `))}` that closes it to `)),`, and close the call before the wrapper's `</div>`:

```tsx
        ])}
      </div>
```

(The group JSX between them is unchanged; the comment inside the map that says "The group is one grid cell" now reads "The group is one stack entry".)

- [ ] **Step 7: Implement the CSS**

In `src/components/taxes/taxes.css`, replace the comment and rules from `/* The jurisdictions as a grid (2026-09-13 polish spec §12; …` through `.bracket-grid .bracket-person-strip { margin-bottom: 0; }` with:

```css
/* The jurisdictions in two independent columns (2026-09-25 polish spec §3.5, TPC-12d): a stack each,
   the split chosen by BracketsEditor from the tables' estimated heights, so a short table never leaves
   a ragged gap beside a tall one (up to 152px under the old grid's rows, 447px at three columns). Each
   group is a form plus its optional per-person strip, so a strip stays under the table it qualifies.
   Two columns down to 900px of PAGE — the named container, so 1280 (≈990px) keeps two and the dock
   gets one — then the stacks stack, still in JURISDICTIONS order. */
.bracket-columns {
  display: flex;
  align-items: flex-start;
  gap: 1rem 2rem;
}

.bracket-column {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

@container page (max-width: 899px) {
  .bracket-columns {
    flex-direction: column;
    align-items: stretch;
  }
}

.bracket-columns .bracket-block {
  margin-bottom: 0;
}

.bracket-columns .bracket-block.has-person-strip {
  margin-bottom: 0.55rem;
}

.bracket-columns .bracket-person-strip {
  margin-bottom: 0;
}
```

- [ ] **Step 8: Run them and see them pass**

Run: `npx vitest run src/components/taxes/`
Expected: PASS (every taxes test file).

- [ ] **Step 9: Commit**

```bash
git add src/components/taxes/bracketColumns.ts src/components/taxes/bracketColumns.test.ts src/components/taxes/taxesCss.test.ts src/components/taxes/BracketsEditor.tsx src/components/taxes/BracketsEditor.test.tsx src/components/taxes/taxes.css
git commit -m "feat(taxes): tax tables pack into two independent columns" -m "The auto-fill grid lined tables up in rows, leaving ragged gaps up to 152px (447px at three columns), and 1280 fell to one column (TPC-12d). The editors now stack in two columns split by estimated height (groupWeight / balancedSplit, contiguous so the order stays JURISDICTIONS for eye, keyboard and screen reader); the split is read off the saved tables and held per tab. Two columns down to 900px of page, one below (spec §3.5). Layout wrapper only — save/confirm logic untouched."
```

---

## Task 13: Portfolio › Allocation — the plot centred, the list capped at its height

**Files:**
- Modify: `src/components/portfolio/AllocationPanel.tsx` (import; the aside's table inside `TableScroll`)
- Modify: `src/components/portfolio/allocation.css` (a container-query block)
- Modify: `src/components/chartInteractions.css` (plot centring beside an aside)
- Create: `src/components/portfolio/allocationCss.test.ts`
- Test: `src/components/portfolio/AllocationPanel.test.tsx`, `src/components/chartFillCss.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `describe('AllocationPanel — one card', …)` in `src/components/portfolio/AllocationPanel.test.tsx`:

```tsx
  // 2026-09-25 polish spec §3.6 (PE-20): the ranked list scrolls in a capped box under a pinned header
  // instead of growing the card by up to 294px when the breakdown has many categories.
  it('puts the ranked list in a named, capped table box inside the aside', async () => {
    renderPanel()
    await screen.findByLabelText('Portfolio allocation by asset class')
    const box = screen.getByRole('region', { name: 'Allocation categories' })
    expect(box.classList.contains('table-scroll')).toBe(true)
    expect(box.classList.contains('allocation-table-scroll')).toBe(true)
    expect(box.parentElement?.classList.contains('allocation-aside')).toBe(true)
    expect(box.firstElementChild?.classList.contains('allocation-ranked-table')).toBe(true)
  })
```

Create `src/components/portfolio/allocationCss.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (tableScrollCss.test.ts's idiom); the constant card height is
// measured in Edge across the five breakdowns (2026-09-25 polish spec §3.6).
const CSS = readFileSync(path.join(__dirname, 'allocation.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')

describe('the Allocation aside beside the donut (allocation.css)', () => {
  it('caps the aside at the plot height while it sits beside the plot, the list box taking the squeeze', () => {
    expect(CSS).toContain(
      '@container (min-width: 900px) { .chart-card-slot .allocation-aside { display: flex; flex-direction: column; } .chart-card-slot .allocation-aside:not(:has(> .allocation-missing-quotes[open])) { max-height: var(--chart-h); } .chart-card-slot .allocation-aside > .allocation-table-scroll { flex: 1 1 auto; min-height: 0; } }',
    )
  })
})
```

Append to `src/components/chartFillCss.test.ts`:

```ts
describe('a plot beside an aside (chartInteractions.css)', () => {
  // PE-20: the donut floated at the top of its column beside a list up to 624px long.
  it('centres the plot column in its row; the aside keeps the top', () => {
    expect(CHART).toContain('.chart-card-slot .chart-card-with-aside > .chart-card-plot { align-self: center; }')
    expect(CHART).toMatch(/\.chart-card-with-aside \{[^}]*align-items: start;/)
  })
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/components/portfolio/AllocationPanel.test.tsx src/components/portfolio/allocationCss.test.ts src/components/chartFillCss.test.ts`
Expected: FAIL — no region named "Allocation categories"; the container block is missing; no plot-centring rule.

- [ ] **Step 3: Implement the panel**

In `src/components/portfolio/AllocationPanel.tsx`, add beside the other component imports:

```tsx
import TableScroll from '../TableScroll'
```

In `AllocationAside`, replace the ranked table (from `<table className="port-table allocation-ranked-table">` to its `</table>`) with the same table inside a `TableScroll` box:

```tsx
    {/* Capped at the donut's height beside it (2026-09-25 polish spec §3.6, PE-20; allocation.css):
        the list scrolls under its pinned header instead of resizing the card by up to 294px. */}
    <TableScroll label="Allocation categories" className="allocation-table-scroll">
      <table className="port-table allocation-ranked-table">
        <thead><tr><th scope="col">Category</th><th scope="col" className="num">Value</th><th scope="col" className="num">Weight</th></tr></thead>
        <tbody>{data.slices.map((slice, index) => <Fragment key={slice.key}>
          <tr className={slice.is_unknown ? 'allocation-unknown' : undefined}>
            <th scope="row"><button type="button" className="allocation-category-button" onClick={() => onSelect(slice)}>
              <span className="allocation-category-swatch" aria-hidden="true"
                style={{ backgroundColor: slice.is_unknown ? 'var(--other-series)' : `var(--chart-${index % 8 + 1})` }} />
              {displayLabel(slice.key, slice.label, data.by)}
            </button></th>
            <td className="num">{formatCurrency(slice.market_value)}</td>
            <td className="num">{formatPct(slice.weight_pct, { signed: false })}</td>
          </tr>
          {classifiable && slice.is_unknown && slice.members.length > 0 && <tr className="allocation-unknown allocation-classify-row">
            <td colSpan={3}><ClassifyButton count={slice.members.length} onClick={onClassify} /></td>
          </tr>}
        </Fragment>)}</tbody>
      </table>
    </TableScroll>
```

- [ ] **Step 4: Implement the CSS**

Append to `src/components/portfolio/allocation.css`:

```css
/* The ranked list beside the donut (2026-09-25 polish spec §3.6, PE-20): no taller than the plot —
   the card sets the chart's configured height as --chart-h — so the card keeps one height across Asset
   class, Industry, Geography, Account and Holding type (it swung 431 → 725px). The table scrolls in its
   TableScroll box under a pinned header; the coverage lines stay put above it. Only while the aside
   sits BESIDE the plot: stacked under it (a card under 900px, the dock open) the box keeps TableScroll's
   own cap, and in the Expand dialog, outside the slot, the aside is its old self. With the Missing
   quotes list open the cap lets go: that list is the reader's own ask, and a cap would bury it. */
@container (min-width: 900px) {
  .chart-card-slot .allocation-aside {
    display: flex;
    flex-direction: column;
  }

  .chart-card-slot .allocation-aside:not(:has(> .allocation-missing-quotes[open])) {
    max-height: var(--chart-h);
  }

  .chart-card-slot .allocation-aside > .allocation-table-scroll {
    flex: 1 1 auto;
    min-height: 0;
  }
}
```

In `src/components/chartInteractions.css`, after the rule `.chart-card-with-aside > .chart-card-plot, .chart-card-with-aside > .chart-card-aside { min-width: 0; }`, add:

```css
/* The plot sits in the middle of its row (2026-09-25 polish spec §3.6, PE-20), not at the top of a
   column a long legend stretched — the donut floated over ~294px of nothing. The aside keeps the top.
   Under the slot only: in the Expand dialog the plot column must stretch to the dialog's row. */
.chart-card-slot .chart-card-with-aside > .chart-card-plot { align-self: center; }
```

- [ ] **Step 5: Run them and see them pass**

Run: `npx vitest run src/components/portfolio/ src/components/chartFillCss.test.ts src/components/ChartCard.test.tsx src/components/TableScroll.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/portfolio/AllocationPanel.tsx src/components/portfolio/AllocationPanel.test.tsx src/components/portfolio/allocation.css src/components/portfolio/allocationCss.test.ts src/components/chartInteractions.css src/components/chartFillCss.test.ts
git commit -m "feat(portfolio): Allocation card keeps one height — the list capped at the donut's" -m "Switching the breakdown resized the card 431 -> 725px and left the donut floating at the top (PE-20). The ranked table moves into a TableScroll box (pinned header) and, beside the plot, the aside is capped at --chart-h (the chart's configured height), the box taking the squeeze; the plot column is centred in its row. Stacked or expanded, the old sizing stands (spec §3.6)."
```

---

## Task 14: Budget meters end on one line; empty tracks read as meters

**Files:**
- Modify: `src/components/spending/budgets.css` (`.budget-rows`, `.budget-row`, `.budget-meter`, `.budget-entry`, the 720px query)
- Create: `src/components/spending/budgetsCss.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/spending/budgetsCss.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (tableScrollCss.test.ts's idiom); the track ends are measured in
// Edge (2026-09-25 polish spec §3.7).
const CSS = readFileSync(path.join(__dirname, 'budgets.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')

describe('budget meters (budgets.css)', () => {
  // NWSP-14: each row sized its own figures column, so Housing's track ended at 1112 and the rest at 1119.
  it('gives every row one column template, the figures column as wide as the widest figure', () => {
    expect(CSS).toContain(
      '.budget-rows { display: grid; grid-template-columns: minmax(110px, 160px) minmax(0, 1fr) minmax(150px, max-content) auto; gap: 0.55rem 0.75rem; }',
    )
    expect(CSS).toContain('.budget-entry { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; row-gap: 0.35rem; }')
    expect(CSS).toContain('.budget-entry > * { grid-column: 1 / -1; }')
    expect(CSS).toMatch(/\.budget-row \{[^}]*display: grid;[^}]*grid-template-columns: subgrid;/)
  })

  // An empty track in --surface-2 was #1e222c on #171a21 — twelve of thirteen rows read as blank space.
  it('draws the empty track in --fill, so an empty meter reads as a meter', () => {
    expect(CSS).toMatch(/\.budget-meter \{[^}]*background: var\(--fill\);/)
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/components/spending/budgetsCss.test.ts`
Expected: FAIL — `.budget-rows` is a flex column; `.budget-entry` is a flex column; `.budget-row` has its own template; the track is `var(--surface-2)`.

- [ ] **Step 3: Implement**

In `src/components/spending/budgets.css`, replace the `.budget-rows` and `.budget-row` rules (lines 4–15) with:

```css
/* One column template for every row (2026-09-25 polish spec §3.7, NWSP-14): name · meter · figures ·
   edit. Each row sized its own figures column before, so a wider figure (Housing's) ended that track
   7px short of the rest; the list's figures column is now as wide as its widest figure, and every row —
   and every entry around a row — takes the list's columns as a subgrid, so every track ends on one x. */
.budget-rows {
  display: grid;
  grid-template-columns: minmax(110px, 160px) minmax(0, 1fr) minmax(150px, max-content) auto;
  gap: 0.55rem 0.75rem;
}

.budget-row {
  display: grid;
  grid-template-columns: subgrid;
  align-items: center;
  column-gap: 0.75rem;
}
```

Replace `.budget-meter`'s `background: var(--surface-2);` with:

```css
  /* --fill, not --surface-2 (spec §3.7): an empty track has to read as a meter against the card. */
  background: var(--fill);
```

Replace `.budget-entry { display: flex; flex-direction: column; gap: 0.35rem; }` with:

```css
.budget-entry { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; row-gap: 0.35rem; }
/* The row and its editor span the entry: the row borrows the columns, the editor the full width. */
.budget-entry > * { grid-column: 1 / -1; }
```

Replace the narrow-screen query at the end of the rows' rules:

```css
@media (max-width: 720px) {
  .budget-rows {
    grid-template-columns: minmax(0, 1fr);
  }

  .budget-row {
    row-gap: 0.3rem;
  }
}
```

(`.budget-row-unbudgeted` keeps its own `grid-template-columns: minmax(110px, 160px) auto; justify-content: start;` — it is later in the sheet at the same specificity, so its two columns win over `subgrid`, and `column-gap` on `.budget-row` spaces them.)

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run src/components/spending/`
Expected: PASS (budgetsCss + BudgetPanel tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/spending/budgets.css src/components/spending/budgetsCss.test.ts
git commit -m "feat(spending): budget meters end on one x; empty tracks read as meters" -m "Each .budget-row sized its own figures column, so tracks ended at 1112 vs 1119px, and the empty track (--surface-2) was invisible on the card (NWSP-14). The list now owns one column template (figures minmax(150px, max-content)) and every entry and row is a subgrid of it; empty tracks use --fill (spec §3.7). CSS only."
```

---

## Task 15: Contribution pace — the ESPP track ends with the others

**Files:**
- Modify: `src/components/paycheck/pace.css` (`.pace-rows`, `.pace-row`, the 720px query)
- Create: `src/components/paycheck/paceCss.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/paycheck/paceCss.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (tableScrollCss.test.ts's idiom); the track ends are measured in
// Edge (2026-09-25 polish spec §3.7).
const CSS = readFileSync(path.join(__dirname, 'pace.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')

describe('contribution pace meters (pace.css)', () => {
  // TPC-22: each row was its own grid, and ESPP's wider figures ended its track 27px short.
  it('shares the figure and verdict columns across the rows through a subgrid', () => {
    expect(CSS).toContain(
      '.pace-rows { display: grid; grid-template-columns: minmax(150px, 240px) minmax(0, 1fr) minmax(160px, max-content) minmax(90px, max-content); gap: 0.55rem 0.75rem; }',
    )
    expect(CSS).toContain('.pace-row { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; align-items: center; gap: 0.75rem; }')
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/components/paycheck/paceCss.test.ts`
Expected: FAIL — `.pace-rows` is a flex column; `.pace-row` has its own template.

- [ ] **Step 3: Implement**

In `src/components/paycheck/pace.css`, replace the `.pace-rows` and `.pace-row` rules (lines 6–17) with:

```css
/* One column template for the strip (2026-09-25 polish spec §3.7, TPC-22): name · meter · figures ·
   verdict. Each row was its own grid before, and ESPP's wider "$21.7K / $21.3K practical" ended its
   track 27px short of the others; the figures and verdict columns are now as wide as the widest in the
   strip and every row takes them as a subgrid, so the "100%" ends line up. */
.pace-rows {
  display: grid;
  grid-template-columns: minmax(150px, 240px) minmax(0, 1fr) minmax(160px, max-content) minmax(90px, max-content);
  gap: 0.55rem 0.75rem;
}

.pace-row {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  align-items: center;
  gap: 0.75rem;
}
```

Replace the narrow-screen query:

```css
@media (max-width: 720px) {
  .pace-rows {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .pace-meter {
    grid-column: 1 / -1;
  }
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run src/components/paycheck/`
Expected: PASS (paceCss + PacePanel + TryItPanel tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/paycheck/pace.css src/components/paycheck/paceCss.test.ts
git commit -m "feat(paycheck): contribution pace tracks end together" -m "Each .pace-row was its own grid, so ESPP's wider figures ended its track 27px short of the 401(k), 415(c) and HSA ones (TPC-22). .pace-rows owns the column template and every row is a subgrid of it (spec §3.7). CSS only."
```

---

## Task 16: Guide — Step N of M · ← Previous · Next →

**Files:**
- Modify: `src/guide/TaskDetail.tsx` (a `step` prop and the foot)
- Modify: `src/guide/GuideCard.tsx` (outside-scope, minimal: builds `step`, moves focus with the selection)
- Modify: `src/pages/GuidePage.css` (the foot's rules)
- Test: `src/guide/GuideCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `describe('GuideCard (master–detail)', …)` in `src/guide/GuideCard.test.tsx`:

```tsx
  // 2026-09-25 polish spec §3.8 (SGS-20): a numbered rail's detail says where the reader is and walks
  // to the neighbouring task; focus moves with the selection, onto the rail row now selected.
  it('a numbered rail’s detail says Step N of M and walks forward and back, focus moving with it', () => {
    renderCard(numberedCard, '/guide?section=routines')
    const foot = () => detail().querySelector('.guide-detail-foot') as HTMLElement
    expect(within(foot()).getByText('Step 1 of 2')).toBeTruthy()
    expect(within(foot()).queryByRole('button', { name: /^Previous/ })).toBeNull()
    fireEvent.click(within(foot()).getByRole('button', { name: 'Next: Look afterwards' }))
    const second = document.getElementById('checklist-after') as HTMLElement
    expect(second.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(second)
    expect(within(detail()).getByRole('heading', { level: 4, name: 'Look afterwards' })).toBeTruthy()
    expect(within(foot()).getByText('Step 2 of 2')).toBeTruthy()
    expect(within(foot()).queryByRole('button', { name: /^Next/ })).toBeNull()
    fireEvent.click(within(foot()).getByRole('button', { name: 'Previous: Open the fixture' }))
    expect(document.getElementById('checklist-open')?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(document.getElementById('checklist-open'))
  })

  it('an un-numbered rail’s detail offers Next only, and nothing on the last task', () => {
    renderCard()
    const foot = () => detail().querySelector('.guide-detail-foot')
    expect(foot()?.textContent).not.toMatch(/Step/)
    expect(within(foot() as HTMLElement).queryByRole('button', { name: /^Previous/ })).toBeNull()
    fireEvent.click(within(foot() as HTMLElement).getByRole('button', { name: 'Next: Export the example' }))
    expect(document.getElementById('example-export')?.getAttribute('aria-selected')).toBe('true')
    fireEvent.click(within(foot() as HTMLElement).getByRole('button', { name: 'Next: Show the table' }))
    expect(document.getElementById('example-table')?.getAttribute('aria-selected')).toBe('true')
    expect(foot()).toBeNull()
  })
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/guide/GuideCard.test.tsx`
Expected: FAIL — `.guide-detail-foot` is null (`Cannot read properties of null`).

- [ ] **Step 3: Implement TaskDetail**

In `src/guide/TaskDetail.tsx`:

Add the interface above the component:

```tsx
/** Where the selected task sits in its rail, and the way to its neighbours (2026-09-25 polish spec
 *  §3.8). A numbered rail — a checklist read in order — says "Step N of M" and offers both ways; an
 *  un-numbered one only Next. */
export interface TaskStep {
  /** 0-based position in the rail. */
  index: number
  count: number
  numbered: boolean
  previous: GuideTask | null
  next: GuideTask | null
  onGo: (task: GuideTask) => void
}
```

Change the signature, and read the neighbours once, before the effect:

```tsx
export default function TaskDetail({ task, id, step }: { task: GuideTask; id: string; step?: TaskStep }) {
  // Only a numbered rail walks backwards; any rail walks forward while there is a next task.
  const previous = step?.numbered ? step.previous : null
  const next = step?.next ?? null
```

After the `{task.to && (…)}` Go link, before the closing `</div>`, add:

```tsx
      {/* The foot (spec §3.8, SGS-20): the setup checklist had no Next and no sign of progress, so the
          reader bounced between rail and detail. The buttons select the neighbouring rail row; the
          card moves focus there with the selection. Named by the task they lead to. */}
      {step !== undefined && (step.numbered || next !== null) && (
        <div className="guide-detail-foot">
          {step.numbered && (
            <span className="guide-step-count">
              Step {step.index + 1} of {step.count}
            </span>
          )}
          {previous !== null && (
            <button type="button" className="button" aria-label={`Previous: ${previous.title}`} onClick={() => step.onGo(previous)}>
              ← Previous
            </button>
          )}
          {next !== null && (
            <button type="button" className="button" aria-label={`Next: ${next.title}`} onClick={() => step.onGo(next)}>
              Next →
            </button>
          )}
        </div>
      )}
```

- [ ] **Step 4: Implement GuideCard**

In `src/guide/GuideCard.tsx`:

Replace `import type { GuideCard as GuideCardData } from './types'` with:

```tsx
import type { GuideCard as GuideCardData, GuideTask } from './types'
```

After `const detailId = \`${card.id}-detail\``, add:

```tsx
  // The detail's foot (2026-09-25 polish spec §3.8): Previous / Next select the neighbouring row, and
  // focus moves with the selection onto it — the rail's arrow-key idiom: preventScroll holds the page,
  // then the row is brought into the rail's own view.
  const index = selected ? all.findIndex((task) => task.id === selected.id) : -1
  const go = (task: GuideTask) => {
    selection.select(task.id)
    const row = document.getElementById(task.id)
    row?.focus({ preventScroll: true })
    row?.scrollIntoView?.({ block: 'nearest' })
  }
```

Replace `<TaskDetail task={selected} id={detailId} />` with:

```tsx
            <TaskDetail
              task={selected}
              id={detailId}
              step={{ index, count: all.length, numbered: card.numbered === true, previous: all[index - 1] ?? null, next: all[index + 1] ?? null, onGo: go }}
            />
```

- [ ] **Step 5: Implement the CSS**

In `src/pages/GuidePage.css`, after the `.guide-detail { min-width: 0; }` rule, add:

```css
/* The detail's foot (2026-09-25 polish spec §3.8, SGS-20): where the reader is on a numbered rail, and
   the way to the neighbouring task — a walk through the checklist without the round trip to the rail.
   The buttons keep the row's end whether or not a count leads it. */
.guide-detail-foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border);
}

.guide-step-count {
  color: var(--muted);
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}

.guide-detail-foot .button:first-of-type {
  margin-left: auto;
}
```

- [ ] **Step 6: Run them and see them pass**

Run: `npx vitest run src/guide/ src/pages/GuidePage.test.tsx`
Expected: PASS (all guide tests).

- [ ] **Step 7: Commit**

```bash
git add src/guide/TaskDetail.tsx src/guide/GuideCard.tsx src/guide/GuideCard.test.tsx src/pages/GuidePage.css
git commit -m "feat(guide): the task detail walks the rail — Step N of M, Previous, Next" -m "The 18-step setup checklist had no Next and no progress, so readers bounced between rail and detail (SGS-20). A numbered rail's detail gains 'Step N of M · ← Previous · Next →', an un-numbered one 'Next →' only; the buttons select the neighbouring row and focus moves with the selection onto it (spec §3.8). GuideCard passes the neighbours (outside-scope, minimal)."
```

---

## Task 17: Verify in Edge against the production copy

**Files:** none in the repo; scripts in `…/73b0666c-…/scratchpad/work-L1/` (`measure.mjs`, `summarize.mjs`).

- [ ] **Step 1: Run the measurements on this branch**

My vite (`--host 127.0.0.1 --port 5271`, proxy to `127.0.0.1:8077`) serves the worktree live. From `work-L1/`:

```bash
APP_BASE=http://127.0.0.1:5271 node measure.mjs after-sidebar sidebar
APP_BASE=http://127.0.0.1:5271 node measure.mjs after pairs overview calendar taxes allocation meters guide tablereveal
node summarize.mjs results-after.json
```

Expected, per the spec's acceptance lines:
- Sidebar: `overflow ≤ 0` and both footer buttons `inView` at 1280×800, 1366×768, 1536×864, 1440×900 — comfortable and compact, both themes; `searchTruncated: false`; the first link tops at 1920×1080 equal the before-run's.
- Pairs: `bottomsDiff ≤ 1` on all five surfaces at 1280/1440/1920, both themes, in every state (closed, each Table open, closed again).
- Overview: `columnsDiff ≤ 1`; `changesBlank ≤ 24`.
- Calendar: `band ≤ 12`.
- Taxes: two columns at 1280 and 1440 (and 1920); no gap between consecutive tables in a column beyond the 16px stack gap.
- Allocation: `spread ≤ 1`.
- Meters: one budget end per width; one pace end per width.
- Guide: the foot present.
- Table reveal: the table fully in view after the click.

- [ ] **Step 2: Look at the screenshots**

Open `shots/L1/after/*` (both themes): the sidebar crops, the pair shots, the Overview band with the Table open, the calendar, the tax tables at 1280 and 1440, Allocation on Industry and Asset class, the budgets. Anything that measures right but looks wrong is a defect: fix it with a failing test first, as above.

- [ ] **Step 3: Stop and clean up**

Close every browser (the scripts do); stop my vite (`Stop-Process` on its PID after confirming its command line is `…polish-layout…vite.js … --port 5271`).

---

## Task 18: Gates and the As-built record

- [ ] **Step 1: Type-check, lint, test**

```bash
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
npx eslint .
npx vitest run --maxWorkers=4
```

Expected: both tsc runs print nothing; eslint `0 errors`, `≤ 26 warnings`; vitest all files and tests passed.

- [ ] **Step 2: Append "As built" to this plan and commit**

Record what changed against the plan and why, the before → after numbers per surface, the gate numbers, the outside-scope touches and anything left undone. Commit:

```bash
git add docs/superpowers/plans/2026-09-25-polish-L1-layout.md
git commit -m "docs(plan): polish L1 as built — measurements, gates, deviations"
```

---

## As built (2026-09-25)

All eighteen tasks done, TDD throughout (every test was run red before its code). Branch `feat/polish-layout` on 657e3d62,
one commit per task plus three browser-pass fixes (tax split calibration, guide sentence, FLIP clamp) — not pushed, not merged.

### What changed against the plan, and why

1. **Tax tables — the weights are calibrated pixels, and each column is charged its gaps** (`f19e6773`, after Task 12).
   Edge showed the row-unit estimate choosing the split after Medicare: columns 1,404 vs 1,068 px, 337 px apart. Measured on the
   production copy a bracket row is 61.5 px and a table's fixed parts 88.5 px (Federal 519, State 642, Medicare 211, Social
   Security 348, Disability 415, Capital gains 273), so `groupWeight` now charges calibrated pixels (row 62, table 88, strip
   margin 9, helper 31, offer 32, an earner's own table 89 + rows, 11 between strip items) and `balancedSplit(weights, gap)`
   charges each column its 1rem gaps (`STACK_GAP = 16`). The split now falls after State: 1,504 vs 1,621 px — the best
   contiguous split for these tables.
2. **Tax tables — contiguous, not alternating** (Task 12, deliberate). The spec says "tables assigned alternately by estimated
   height". A contiguous split keeps the DOM, Tab and reading order in JURISDICTIONS order in two columns and in one (an
   alternating one would reorder the tables for keyboard and screen-reader users, and in the stacked narrow layout). The split is
   read off the SAVED tables and held per (status, empty-or-not), so adding rows or saving never moves a table — or the focused
   Save — to the other stack (a move would remount it and drop focus).
3. **Tax tables at 1920 — two columns, per the spec.** The old auto-fill grid had three columns at 1920 (card 1,210 px, gaps up
   to 447 px); two stacks make the card 1,432 px with no gaps. Possible follow-up for the user: a third stack from ~1,600 px of
   page.
4. **Spending › Trends, All categories — BOTH cards span 12**, not only Category trends: Savings rate alone at span 6 would sit
   beside a ~570 px half-row hole, the very thing OU-16 fixes on the Overview.
5. **ChartCard gained a second prop, `reserveControls`** (besides C5's `fill`), for the Spending pair's reserved controls row.
   `fill` never applies to a card with an `aside` (its plot sits in the aside wrapper, which does not grow) — no such span-6 card
   exists today; the guard keeps a future one from collapsing its chart.
6. **The FLIP clamps its sideways travel to the grid** (`76bb2cf0`, after Task 9). Filmed in Edge: hiding Portfolio performance
   started Recent spending — now full width — at its old left edge, ~580 px past the grid, and the page flashed a horizontal
   scrollbar for 120 ms. Now 0 px of horizontal overflow across hide/show of both charts and Year to date. Widths snap (a span
   change is not a move). The tile row is FLIPped too, found from the deeper grid rather than given a ref, to stay out of L2's
   tile markup.
7. **Allocation's cap lets go while "Missing quotes" is open** (the reader's own list must not be buried), applies only while
   the aside sits beside the plot (card ≥ 900 px), and not in the Expand dialog (outside the slot). The plot-centring rule is
   under the slot too (the dialog's plot column must stretch).
8. **Card detail — the pinned "action row" is the add-credit form** (the card's last form row, the Settings §3.3 analogy), with
   the rewards line under it; the chart card fills its row through the span-6 default. CSS only; `CardDetail.tsx` untouched.
9. **Guide foot** — Previous only on numbered rails; no Next on the last task, no Previous on the first; the buttons are named
   for the task they lead to ("Next: Look afterwards"); focus moves onto the newly selected rail row (the rail's arrow-key idiom).
10. **The deeper spans live in a small module** (`customizeReflow.ts`: `deeperSpans`, `childRects`, `flipChildren`), called from
    OverviewPage.tsx; the page computes the shown order (an empty Year to date never separates a pair) and wires the FLIP.

### Measured in headless Edge on the production copy (both themes; `work-L1/results-*.json`)

| Surface | Before | After |
|---|---|---|
| Sidebar overflow, comfortable | 1280×800 **86**, 1366×768 **118**, 1536×864 **22**, 1440×900 0 px | **0** at all four (and 1920×1080) |
| Sidebar overflow, compact | 1280×800 **18**, 1366×768 **50** px | **0** everywhere |
| Theme / Log out in view | hidden at 1280×800 and 1366×768 (both), 1536×864 (Log out) | both in view everywhere, 28×28 px |
| Search pill | "Search or ju…" truncated at every comfortable width | "Search…", never truncated |
| Nav at ≥ 901 px of height | — | first link tops identical at 1920×1080 (nothing moved); the indicator still lands on its row (31 px rows at 768, 37 at 1080) |
| Pairs, Table closed (1280/1440/1920) | Overview 63 · Trends 84/68/36 · Paycheck 109/95/97 · ESPP 17 · card detail 20/44/0 px | **0** on all five, both themes |
| Pairs, either Table open, and closed again | 292–460 px apart | **0** in every state |
| Trends plot tops | 288 vs 302 px (heights 260 vs 220) | 302 vs 302 px (floor 260 on both) |
| Overview: blank under "Changes" | 134 / 100 / 66 px | **0** (limit 24) |
| Overview: columns | 0 (by stretching Changes) | 0 (the trend fills); trend Table open → Data status' note pinned, blank 242–310 → **0** |
| Calendar: labels → first week | 65 px | **8 px** (limit 12) |
| Tax tables | 1280: one column, card 2,642 px; 1440: ragged gaps ≤ 152 px, card 1,590; 1920: three columns, gaps ≤ 447, card 1,210 | two stacks at 1280/1440/1920, gaps 16 px (the stack gap), card 1,448 / 1,448 / 1,432 px; column bottoms 117 px apart (independent) |
| Allocation card height across the five breakdowns | 431/725/431/461/431 px (spread 294; 310 at 1280) | **431** on all five (spread **0**) |
| Budget meter ends | 1119.1 vs 1111.6 px; empty track #1e222c on #171a21 | one end (1111.6 at 1440); track `--fill` (#262b36 dark, #e6ebf2 light) |
| Pace meter ends | 1098 vs 1070.5 px | one end (1070.5 at 1440) |
| Guide numbered rail | no Next, no progress | "Step 1 of 18 · Next →"; two Nexts → "Step 3 of 18", focus on the selected row |
| Chart Table reveal (px of the 364 px twin in view) | Net worth 21 · Taxes 0 · Spending 86 · Overview trend 280 | **364** on all four |

Interactive checks (Edge): Customize — hiding Portfolio performance runs Recent spending across the row (span 12, 1,151 px);
showing it again appends it after Money flow, both span 12, the new card fading in over 120 ms; 0 console errors. Expand on a
filling card (ESPP Lot anatomy) — the plot fills the dialog (680 px in 852); after Esc the pair is equal again. With the detail
dock open (ESPP, 368 px cards) the pair still ends together. Screenshots in `shots/L1/after*/`.

### Gates

- `npx tsc -p tsconfig.app.json --noEmit`: clean. `npx tsc -p tsconfig.node.json --noEmit`: clean.
- `npx eslint .`: 0 errors, 26 warnings (the baseline).
- `npx vitest run --maxWorkers=4`: **309 files, 4,541 tests passed** (220 s). The three stderr blocks in the run
  (LotAnatomyCard's jsdom navigation, WhatsDue, exportImage) are pre-existing — LotAnatomyCard's reproduces with the base
  ChartCard.

### Outside-scope touches

- `src/guide/GuideCard.tsx` — passes the neighbours and the focus-moving select to TaskDetail (its only renderer).
- `src/guide/content/start.tsx` — the "The footer" fact said the footer shows which deployment this is; it now describes the
  one-row footer (deployment and build on the address's tooltip).
- `src/components/Layout.test.tsx` — the shell-boundary tests waited for the retired "dev" pill; they wait for the tooltip now.
- New files: `src/components/overview/customizeReflow.ts`, `src/components/taxes/bracketColumns.ts`, and the tests
  `sidebarCss`, `chartFillCss`, `customizeReflow`, `bracketColumns`, `taxesCss`, `allocationCss`, `carddetailCss`,
  `budgetsCss`, `paceCss`.

### Left undone / notes for the coordinator

- Card detail's credit rows still wrap their buttons ("Resets Jan / 1") — PCC-28's other half, not in spec §3.1; a nowrap would
  overflow the card at dock widths.
- Tax tables' TPC-12a/b/c (always-lit Saves, the echo line, the clipped "$1,485,906.(") are other items / lane L7.
- `src/components/paletteBus.ts`'s comment still names "Search or jump…" (comment only; not this lane's file).
- By design: while one card's Table is open its partner's plot grows to match (~590–750 px); the Overview trend's Table open
  stretches Data status (its note pinned) — both as the spec accepts.
- The shared backend on :8077 was intermittently slow under other lanes' load (one capture caught a 15 s client-timeout abort
  of the investments feed); the endpoints answer in ~30 ms otherwise. Unrelated to this lane.
