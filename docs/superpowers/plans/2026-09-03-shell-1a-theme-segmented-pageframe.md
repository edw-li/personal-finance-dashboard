# Shell 1a — Theme tokens, ECharts bridge, Segmented, PageFrame — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first half of the shell primitives from `docs/superpowers/specs/2026-09-03-shell-grammar-design.md`: a single token source for both palettes, a theme provider with a light theme and density switch, an ECharts bridge that recolors every chart without touching a builder, the `Segmented` control, and the `PageFrame` component. Nothing in this plan migrates a page; everything it builds is mounted where it is page-independent (theme provider, Appearance card) and otherwise waits for Plans 2–3.

**Architecture:** `src/theme/tokens.ts` is the one source of truth for colors; `index.css` carries static copies of both palettes for first paint and a vitest keeps them equal. `ThemeProvider` sets `data-theme` / `data-density` on `<html>`, persists to localStorage, follows the OS when asked, and exposes a `version` that `EChart` uses to re-initialize with a versioned ECharts theme; `charts/recolor.ts` maps every dark token hex found inside an option to its light counterpart at `setOption` time, so builders keep importing constants. `Segmented` and `PageFrame` live in `src/components/shell/` with their styles in `shell.css`.

**Tech Stack:** React 19, TypeScript 5.9, Vite 6, vitest 3 + @testing-library/react, ECharts 6 (`echarts/core`), plain CSS with custom properties.

**Worktree / commands:** Work in a worktree on branch `shell-1a`. Frontend commands run from the repo root of the worktree: `npx vitest run <file>`, `npx tsc -b`, `npx eslint <files>`. There is no backend work in this plan.

---

## File structure

| File | Responsibility |
|---|---|
| `src/theme/tokens.ts` (new) | `ThemeTokens` type, `DARK`, `LIGHT`, the CSS variable names, `cssDeclarations()` for the drift test, `contrastRatio()` helper |
| `src/theme/tokens.test.ts` (new) | Contrast acceptance for both palettes; drift test against `index.css` |
| `src/index.css` (modify) | Chart tokens added to `:root`; a `[data-theme="light"]` block; density rules |
| `index.html` (modify) | Two-line anti-flash script applying the stored theme before the bundle |
| `src/components/shell/ThemeProvider.tsx` (new) | Context: theme choice, resolved theme, density, version; persistence; OS following |
| `src/components/shell/ThemeProvider.test.tsx` (new) | Attributes, persistence, `matchMedia` following, version bump |
| `src/charts/recolor.ts` (new) | Deep-walk an option and swap dark token hexes for light ones |
| `src/charts/recolor.test.ts` (new) | Mapping coverage, untouched strings, nested arrays |
| `src/charts/theme.ts` (modify) | `buildTheme(tokens)`; `FINANCE_THEME` = `buildTheme(DARK)`; `OTHER_SERIES_COLOR` raised to 3:1 |
| `src/charts/echarts.ts` (modify) | `registerThemeVersion(resolved, version)` + `themeName(version)` |
| `src/components/EChart.tsx` (modify) | Re-init on theme version; recolor under light |
| `src/components/shell/Segmented.tsx` (new) | The four-variant control |
| `src/components/shell/Segmented.test.tsx` (new) | ARIA per variant, arrow keys on tabs, `multiple` |
| `src/components/shell/PageFrame.tsx` (new) | Header, actions, subheader, sticky scope-row slot, five states, context |
| `src/components/shell/PageFrame.test.tsx` (new) | The five states, sticky class, context |
| `src/components/shell/shell.css` (new) | Styles for PageFrame, the scope row, Segmented, the sidebar footer (footer rules used by Plan 1c) |
| `src/components/settings/AppearanceCard.tsx` (new) | Theme + density controls |
| `src/components/settings/AppearanceCard.test.tsx` (new) | Writes through the provider |
| `src/pages/SettingsPage.tsx` (modify) | Mounts `AppearanceCard` |
| `src/App.tsx` (modify) | Wraps the tree in `ThemeProvider` |
| `src/components/panels.css` (modify) | Legibility floor + hero clamp + tabular numerals (§13 of the spec) |

`ScopeBar` (Plan 1b) renders inside PageFrame's scope-row slot; this plan defines the slot as a plain `scopeRow?: ReactNode` prop so 1a and 1b have no file overlap. Plan 2 wires them together.

---

### Task 1: Token source of truth

**Files:**
- Create: `src/theme/tokens.ts`
- Test: `src/theme/tokens.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/theme/tokens.test.ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DARK, LIGHT, contrastRatio, cssDeclarations, type ThemeTokens } from './tokens'

function block(css: string, selector: string): string {
  const start = css.indexOf(selector)
  if (start === -1) throw new Error(`no ${selector} block in index.css`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

/** Every `--name: value;` declaration in a block, whitespace-normalized. */
function declarations(blockText: string): Set<string> {
  return new Set(
    blockText
      .split('\n')
      .map((line) => line.replace(/\/\*.*?\*\//g, '').trim())
      .filter((line) => line.startsWith('--'))
      .map((line) => line.replace(/\s+/g, ' ')),
  )
}

describe('tokens', () => {
  const surfaces: [string, ThemeTokens][] = [
    ['dark', DARK],
    ['light', LIGHT],
  ]

  it.each(surfaces)('%s: text tones read at 4.5:1 on the surface', (_name, t) => {
    for (const tone of [t.text, t.muted, t.positive, t.negative, t.warn, t.accent]) {
      expect(contrastRatio(tone, t.surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(surfaces)('%s: every chart slot and the Other gray read at 3:1', (_name, t) => {
    for (const slot of [...t.palette, t.otherSeries]) {
      expect(contrastRatio(slot, t.surface)).toBeGreaterThanOrEqual(3)
    }
  })

  it('index.css carries byte-equal copies of both palettes (no drift)', () => {
    const css = readFileSync(path.resolve(__dirname, '../index.css'), 'utf8')
    const root = declarations(block(css, ':root'))
    for (const decl of cssDeclarations(DARK)) expect(root).toContain(decl)
    const light = declarations(block(css, '[data-theme="light"]'))
    for (const decl of cssDeclarations(LIGHT)) expect(light).toContain(decl)
  })

  it('contrastRatio is symmetric and white-on-black is 21', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/theme/tokens.test.ts`
Expected: FAIL — `Cannot find module './tokens'`.

- [ ] **Step 3: Write the module**

```ts
// src/theme/tokens.ts
// THE color source of truth for both palettes (2026-09-03 shell spec §11). index.css carries
// static copies for first paint and tokens.test.ts keeps them equal; charts/theme.ts builds
// the ECharts theme from here; charts/recolor.ts maps DARK → LIGHT inside options.
// Dark values are the pre-existing ones (index.css + charts/theme.ts), unchanged except
// `otherSeries`, raised from #4a5060 (2.16:1) to meet 3:1 on the surface.

export interface ThemeTokens {
  bg: string
  surface: string
  surface2: string
  border: string
  text: string
  muted: string
  accent: string
  positive: string
  negative: string
  warn: string
  gridLine: string
  axisLine: string
  otherSeries: string
  /** Fixed slot order IS the CVD-safety mechanism — never reorder (charts/theme.ts). */
  palette: readonly [string, string, string, string, string, string, string, string]
  /** 12 steps, near-zero first (recedes into the card), for heatmaps. */
  sequential: readonly string[]
}

export const DARK: ThemeTokens = {
  bg: '#0f1115',
  surface: '#171a21',
  surface2: '#1e222c',
  border: '#262b36',
  text: '#e6e9ef',
  muted: '#8b93a3',
  accent: '#4f8cff',
  positive: '#3fb968',
  negative: '#e05252',
  warn: '#c98500',
  gridLine: '#1e222c',
  axisLine: '#262b36',
  otherSeries: '#6b7382',
  palette: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  sequential: [
    '#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6',
    '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#cde2fb',
  ],
}

// Cool neutral (approved 2026-09-03): pale blue-gray page, white cards, the same hue
// family darkened until each slot clears 3:1 on white.
export const LIGHT: ThemeTokens = {
  bg: '#f2f5f9',
  surface: '#ffffff',
  surface2: '#f7f9fc',
  border: '#e1e7ef',
  text: '#141a24',
  muted: '#5f6b7a',
  accent: '#3b7dd8',
  positive: '#1f8f4e',
  negative: '#c73a3a',
  warn: '#a86400',
  gridLine: '#e6ebf2',
  axisLine: '#d5dce6',
  otherSeries: '#7f8a9c',
  palette: ['#2f6fdc', '#c94f1e', '#15895f', '#a86f00', '#c2436f', '#1f7a1f', '#6f63d6', '#c94848'],
  sequential: [
    '#e8f0fb', '#d3e2f7', '#bcd3f2', '#a3c2ec', '#89b0e6', '#6f9ddf',
    '#5589d6', '#3f76cb', '#2f65b8', '#255399', '#1d427c', '#153260',
  ],
}

/** The CSS custom-property declarations a palette expands to — the shape index.css must
 *  carry verbatim (tokens.test.ts). Order is stable so the test can diff by set. */
export function cssDeclarations(t: ThemeTokens): string[] {
  return [
    `--bg: ${t.bg};`,
    `--surface: ${t.surface};`,
    `--surface-2: ${t.surface2};`,
    `--border: ${t.border};`,
    `--text: ${t.text};`,
    `--muted: ${t.muted};`,
    `--accent: ${t.accent};`,
    `--positive: ${t.positive};`,
    `--negative: ${t.negative};`,
    `--warn: ${t.warn};`,
    `--grid-line: ${t.gridLine};`,
    `--axis-line: ${t.axisLine};`,
    `--other-series: ${t.otherSeries};`,
    ...t.palette.map((hex, i) => `--chart-${i + 1}: ${hex};`),
  ]
}

function channel(hex: string, offset: number): number {
  const c = parseInt(hex.slice(offset, offset + 2), 16) / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG 2.x relative luminance of a #rrggbb color. */
export function luminance(hex: string): number {
  const h = hex.replace('#', '')
  return 0.2126 * channel(h, 0) + 0.7152 * channel(h, 2) + 0.0722 * channel(h, 4)
}

/** WCAG contrast ratio between two #rrggbb colors (order-independent). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}
```

- [ ] **Step 4: Update `src/index.css` so the drift test can pass**

Replace the whole `:root` block and add the light block and density rules. The file becomes:

```css
:root {
  /* Native widgets (date pickers, scrollbars, form autofill) follow the app's darkness
     instead of flashing white chrome into it. */
  color-scheme: dark;
  /* Tokens mirror src/theme/tokens.ts DARK — tokens.test.ts fails on any drift. */
  --bg: #0f1115;
  --surface: #171a21;
  --surface-2: #1e222c;
  --border: #262b36;
  --text: #e6e9ef;
  --muted: #8b93a3;
  --accent: #4f8cff;
  --positive: #3fb968;
  --negative: #e05252;
  /* PALETTE[3] amber — the app's advisory/staleness register. */
  --warn: #c98500;
  --grid-line: #1e222c;
  --axis-line: #262b36;
  --other-series: #6b7382;
  --chart-1: #3987e5;
  --chart-2: #d95926;
  --chart-3: #199e70;
  --chart-4: #c98500;
  --chart-5: #d55181;
  --chart-6: #008300;
  --chart-7: #9085e9;
  --chart-8: #e66767;
  /* Motion tokens (2026-08-27 spec §4). Consumed only inside
     prefers-reduced-motion: no-preference blocks — under `reduce` nothing reads them. */
  --t-fast: 120ms;
  --t-page: 180ms;
  /* Density: comfortable is the pre-2026-09 geometry; compact scales the root font and the
     card/table padding (shell spec §11). */
  --density-card-pad: 1.1rem 1.25rem 1.25rem;
  --density-cell-pad: 0.45rem 0.6rem;
  --density-grid-gap: 1rem;
  font-family: system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}

/* Tokens mirror src/theme/tokens.ts LIGHT — tokens.test.ts fails on any drift. */
[data-theme="light"] {
  color-scheme: light;
  --bg: #f2f5f9;
  --surface: #ffffff;
  --surface-2: #f7f9fc;
  --border: #e1e7ef;
  --text: #141a24;
  --muted: #5f6b7a;
  --accent: #3b7dd8;
  --positive: #1f8f4e;
  --negative: #c73a3a;
  --warn: #a86400;
  --grid-line: #e6ebf2;
  --axis-line: #d5dce6;
  --other-series: #7f8a9c;
  --chart-1: #2f6fdc;
  --chart-2: #c94f1e;
  --chart-3: #15895f;
  --chart-4: #a86f00;
  --chart-5: #c2436f;
  --chart-6: #1f7a1f;
  --chart-7: #6f63d6;
  --chart-8: #c94848;
}

[data-density="compact"] {
  font-size: 90%;
  --density-card-pad: 0.85rem 1rem 1rem;
  --density-cell-pad: 0.3rem 0.45rem;
  --density-grid-gap: 0.75rem;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
}

html {
  /* The scrollbar's column is reserved even when content is short: without this, the
     monthly-update wizard's unmount-while-loading dropped the page under viewport
     height mid month-switch and the vanishing scrollbar shifted the whole layout
     ~15px sideways until data landed (spec Addendum §A1). Also steadies skeleton
     phases on short pages. */
  scrollbar-gutter: stable;
}

a {
  color: var(--accent);
  text-decoration: none;
}

button {
  font: inherit;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/theme/tokens.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/theme/tokens.ts src/theme/tokens.test.ts src/index.css
git commit -m "feat(shell): theme token source with contrast and drift tests; light palette in index.css"
```

---

### Task 2: Density tokens consumed by cards, tables and grids

**Files:**
- Modify: `src/components/panels.css` (the `.card`, `.card-grid`, `.kpi-row`, `.data-table td` rules)

- [ ] **Step 1: Point the four rules at the density variables**

In `src/components/panels.css` change exactly these declarations:

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: var(--density-card-pad);
  min-width: 0;
}

.card-grid {
  display: grid;
  gap: var(--density-grid-gap);
  grid-template-columns: repeat(12, 1fr);
}

.kpi-row {
  display: grid;
  gap: var(--density-grid-gap);
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  margin-bottom: 1rem;
}

.data-table td {
  padding: var(--density-cell-pad);
  border-bottom: 1px solid var(--surface-2);
}
```

(The `minmax(190px, 1fr)` → `minmax(220px, 1fr)` change is the spec's hero-row fix: a fifth tile wraps into a balanced row instead of orphaning.)

- [ ] **Step 2: Run the full frontend suite to confirm nothing depended on the old literals**

Run: `npx vitest run`
Expected: all green (CSS is not asserted by tests; this is a smoke run).

- [ ] **Step 3: Commit**

```bash
git add src/components/panels.css
git commit -m "style(shell): density variables for card, grid and table padding; 220px KPI tiles"
```

---

### Task 3: Legibility floor and hero clamp

**Files:**
- Modify: `src/components/panels.css` (`.eyebrow`, `.stat-label`, `.stat-value`, `.stat-tile-hero .stat-value`, `.stat-delta`, `.data-table th`, `.badge`)
- Modify: `src/components/Layout.css` (`.nav-heading`)

- [ ] **Step 1: Raise the floor and clamp the hero**

In `src/components/panels.css`:

```css
.eyebrow {
  margin: 0 0 0.75rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
}

.stat-label {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 0.45rem;
}

/* Clamped so a $1,000,000.00 hero never overflows its tile in a split-screen window
   (2026-09-02 audit: "$799,395.!" at 1180px); tabular numerals keep count-ups steady. */
.stat-value {
  font-family: ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', Menlo, Consolas, monospace;
  font-size: clamp(1.1rem, 0.9rem + 0.5vw, 1.45rem);
  font-weight: 600;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  min-width: 0;
  overflow-wrap: anywhere;
}

.stat-tile-hero .stat-value {
  font-size: clamp(1.5rem, 1rem + 1.1vw, 2.4rem);
}

.stat-delta {
  margin-top: 0.35rem;
  font-size: 0.8rem;
}

.data-table th {
  text-align: left;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 0.5rem 0.6rem;
  border-bottom: 1px solid var(--border);
}

.badge {
  display: inline-block;
  margin-left: 0.5rem;
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 0.66rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted);
}
```

In `src/components/Layout.css`:

```css
.nav-heading {
  margin: 0.35rem 0 0.1rem;
  padding: 0 0.75rem;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
}
```

- [ ] **Step 2: Run the suite**

Run: `npx vitest run src/components`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add src/components/panels.css src/components/Layout.css
git commit -m "style(shell): legibility floor (0.72rem eyebrows/th/nav), hero value clamp, tabular numerals"
```

---

### Task 4: ThemeProvider

**Files:**
- Create: `src/components/shell/ThemeProvider.tsx`
- Test: `src/components/shell/ThemeProvider.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/shell/ThemeProvider.test.tsx
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ThemeProvider, { useTheme } from './ThemeProvider'

function Probe() {
  const { theme, resolved, density, version, setTheme, setDensity } = useTheme()
  return (
    <div>
      <span data-testid="state">{`${theme}|${resolved}|${density}|${version}`}</span>
      <button onClick={() => setTheme('light')}>light</button>
      <button onClick={() => setTheme('system')}>system</button>
      <button onClick={() => setTheme('dark')}>dark</button>
      <button onClick={() => setDensity('compact')}>compact</button>
    </div>
  )
}

type Listener = (e: { matches: boolean }) => void
let prefersLight = false
let listeners: Listener[] = []

beforeEach(() => {
  localStorage.clear()
  prefersLight = false
  listeners = []
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-density')
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('light') ? prefersLight : !prefersLight,
      media: query,
      addEventListener: (_: string, cb: Listener) => listeners.push(cb),
      removeEventListener: (_: string, cb: Listener) => {
        listeners = listeners.filter((l) => l !== cb)
      },
    })),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const state = () => screen.getByTestId('state').textContent

describe('ThemeProvider', () => {
  it('defaults to dark, comfortable, and stamps the html element', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(state()).toBe('dark|dark|comfortable|0')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.density).toBe('comfortable')
  })

  it('setTheme(light) resolves light, bumps the version and persists', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => screen.getByText('light').click())
    expect(state()).toBe('light|light|comfortable|1')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('finance.theme')).toBe('light')
  })

  it('reads a stored choice on mount', () => {
    localStorage.setItem('finance.theme', 'light')
    localStorage.setItem('finance.density', 'compact')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(state()).toBe('light|light|compact|0')
    expect(document.documentElement.dataset.density).toBe('compact')
  })

  it('system follows the OS live and only bumps the version when the resolved theme changes', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => screen.getByText('system').click())
    expect(state()).toBe('system|dark|comfortable|0') // OS is dark: nothing resolved changed
    prefersLight = true
    act(() => listeners.forEach((l) => l({ matches: true })))
    expect(state()).toBe('system|light|comfortable|1')
    act(() => screen.getByText('dark').click())
    expect(state()).toBe('dark|dark|comfortable|2')
  })

  it('density persists and does not touch the chart version', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => screen.getByText('compact').click())
    expect(state()).toBe('dark|dark|compact|0')
    expect(localStorage.getItem('finance.density')).toBe('compact')
  })

  it('ignores garbage in storage', () => {
    localStorage.setItem('finance.theme', 'neon')
    localStorage.setItem('finance.density', 'huge')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(state()).toBe('dark|dark|comfortable|0')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/components/shell/ThemeProvider.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the provider**

```tsx
// src/components/shell/ThemeProvider.tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

// The shell's appearance state (2026-09-03 shell spec §11). Browser-local by decision:
// localStorage now, the Data-lifecycle spec's server prefs later. `version` is the chart
// bridge's signal — EChart re-initializes with a versioned theme whenever the RESOLVED
// palette changes, and only then (density and a same-palette choice do not redraw charts).
export type ThemeChoice = 'system' | 'dark' | 'light'
export type ResolvedTheme = 'dark' | 'light'
export type Density = 'comfortable' | 'compact'

export const THEME_KEY = 'finance.theme'
export const DENSITY_KEY = 'finance.density'
const LIGHT_QUERY = '(prefers-color-scheme: light)'

interface ThemeState {
  theme: ThemeChoice
  resolved: ResolvedTheme
  density: Density
  version: number
  setTheme: (next: ThemeChoice) => void
  setDensity: (next: Density) => void
}

const ThemeContext = createContext<ThemeState | null>(null)

function readChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'dark'
  } catch {
    return 'dark'
  }
}

function readDensity(): Density {
  try {
    return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'
  } catch {
    return 'comfortable'
  }
}

function osPrefersLight(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(LIGHT_QUERY).matches
}

/** The palette a choice lands on right now — also what index.html's inline script mirrors. */
export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') return osPrefersLight() ? 'light' : 'dark'
  return choice
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // A blocked localStorage costs persistence, never the switch itself.
  }
}

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(readChoice)
  const [density, setDensityState] = useState<Density>(readDensity)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readChoice()))
  const [version, setVersion] = useState(0)

  // Stamp the document. Effects, not render: the DOM outside React's tree is a side effect.
  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])
  useEffect(() => {
    document.documentElement.dataset.density = density
  }, [density])

  const applyResolved = useCallback((next: ResolvedTheme) => {
    setResolved((current) => {
      if (current === next) return current
      setVersion((v) => v + 1)
      return next
    })
  }, [])

  // Follow the OS only while the choice is System; the listener is torn down otherwise.
  useEffect(() => {
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(LIGHT_QUERY)
    const onChange = (event: { matches: boolean }) =>
      applyResolved(event.matches ? 'light' : 'dark')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [theme, applyResolved])

  const setTheme = useCallback(
    (next: ThemeChoice) => {
      setThemeState(next)
      persist(THEME_KEY, next)
      applyResolved(resolveTheme(next))
    },
    [applyResolved],
  )

  const setDensity = useCallback((next: Density) => {
    setDensityState(next)
    persist(DENSITY_KEY, next)
  }, [])

  const value = useMemo<ThemeState>(
    () => ({ theme, resolved, density, version, setTheme, setDensity }),
    [theme, resolved, density, version, setTheme, setDensity],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** Safe outside a provider (tests render pages bare): dark, comfortable, version 0. */
export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext)
  return (
    ctx ?? {
      theme: 'dark',
      resolved: 'dark',
      density: 'comfortable',
      version: 0,
      setTheme: () => {},
      setDensity: () => {},
    }
  )
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/shell/ThemeProvider.test.tsx`
Expected: PASS (6 tests). If the lint rule `react-hooks/set-state-in-effect` complains anywhere, note that this file sets state only inside callbacks and event listeners; the two DOM effects touch `document`, not state.

- [ ] **Step 5: Mount it and add the anti-flash script**

`src/App.tsx` — wrap the existing tree:

```tsx
import { lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import { ROUTE_CHUNKS } from './components/routeChunks'
import ThemeProvider from './components/shell/ThemeProvider'
import ToastProvider from './components/ToastProvider'
import { AuthProvider } from './contexts/AuthContext'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
```

and

```tsx
export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            {/* …unchanged Routes… */}
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
```

`index.html` — add the script as the first child of `<head>` after the charset meta:

```html
    <script>
      // Mirrors ThemeProvider.resolveTheme so a light-theme user never sees a dark flash.
      try {
        var t = localStorage.getItem('finance.theme');
        var light = t === 'light' || (t === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
        document.documentElement.dataset.theme = light ? 'light' : 'dark';
        if (localStorage.getItem('finance.density') === 'compact') document.documentElement.dataset.density = 'compact';
      } catch (e) {}
    </script>
```

- [ ] **Step 6: Type-check and run the app tests**

Run: `npx tsc -b && npx vitest run src/App.test.tsx src/components/Layout.test.tsx`
Expected: PASS (if `src/App.test.tsx` does not exist, run only the Layout test).

- [ ] **Step 7: Commit**

```bash
git add src/components/shell/ThemeProvider.tsx src/components/shell/ThemeProvider.test.tsx src/App.tsx index.html
git commit -m "feat(shell): ThemeProvider with system/dark/light, density, persistence and anti-flash script"
```

---

### Task 5: Recolor map for chart options

**Files:**
- Create: `src/charts/recolor.ts`
- Test: `src/charts/recolor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/charts/recolor.test.ts
import { describe, expect, it } from 'vitest'
import { DARK, LIGHT } from '../theme/tokens'
import { lightFromDark, recolorOption } from './recolor'

describe('recolorOption', () => {
  it('maps every dark token hex to its light counterpart, wherever it sits', () => {
    const option = {
      color: [...DARK.palette],
      series: [
        { type: 'bar', itemStyle: { color: DARK.positive }, data: [{ value: 1, itemStyle: { color: DARK.negative } }] },
        { type: 'line', lineStyle: { color: DARK.text }, areaStyle: { color: DARK.otherSeries } },
      ],
      visualMap: { inRange: { color: [...DARK.sequential] } },
      tooltip: { backgroundColor: DARK.surface2, borderColor: DARK.axisLine },
    }
    const out = recolorOption(option, lightFromDark) as typeof option
    expect(out.color).toEqual([...LIGHT.palette])
    expect(out.series[0].itemStyle.color).toBe(LIGHT.positive)
    expect(out.series[0].data[0].itemStyle.color).toBe(LIGHT.negative)
    expect(out.series[1].lineStyle.color).toBe(LIGHT.text)
    expect(out.series[1].areaStyle.color).toBe(LIGHT.otherSeries)
    expect(out.visualMap.inRange.color).toEqual([...LIGHT.sequential])
    expect(out.tooltip.backgroundColor).toBe(LIGHT.surface2)
  })

  it('is case-insensitive on input and leaves unknown strings, numbers and functions alone', () => {
    const fmt = (v: number) => `$${v}`
    const option = { a: DARK.accent.toUpperCase(), b: '#123456', c: 3, d: fmt, e: null }
    const out = recolorOption(option, lightFromDark) as typeof option
    expect(out.a).toBe(LIGHT.accent)
    expect(out.b).toBe('#123456')
    expect(out.c).toBe(3)
    expect(out.d).toBe(fmt)
    expect(out.e).toBeNull()
  })

  it('does not mutate its input', () => {
    const option = { color: [DARK.palette[0]] }
    recolorOption(option, lightFromDark)
    expect(option.color[0]).toBe(DARK.palette[0])
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/charts/recolor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// src/charts/recolor.ts
// The light-theme bridge for chart OPTIONS (shell spec §11). Builders keep importing the
// dark constants from charts/theme.ts (the "never invent a hue outside this file" rule is
// what makes this safe): under a light theme EChart deep-copies the option and swaps every
// exact dark token hex for its light counterpart at setOption time. Gradients, rgba()
// strings and anything not in the map pass through untouched.
import { DARK, LIGHT, type ThemeTokens } from '../theme/tokens'

function pairs(from: ThemeTokens, to: ThemeTokens): Map<string, string> {
  const map = new Map<string, string>()
  const scalar: (keyof ThemeTokens)[] = [
    'bg', 'surface', 'surface2', 'border', 'text', 'muted', 'accent',
    'positive', 'negative', 'warn', 'gridLine', 'axisLine', 'otherSeries',
  ]
  for (const key of scalar) map.set((from[key] as string).toLowerCase(), to[key] as string)
  from.palette.forEach((hex, i) => map.set(hex.toLowerCase(), to.palette[i]))
  from.sequential.forEach((hex, i) => map.set(hex.toLowerCase(), to.sequential[i]))
  return map
}

export const lightFromDark: Map<string, string> = pairs(DARK, LIGHT)

/** Deep-copies `value`, replacing string leaves found in `map` (case-insensitive). */
export function recolorOption(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === 'string') return map.get(value.toLowerCase()) ?? value
  if (Array.isArray(value)) return value.map((item) => recolorOption(item, map))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = recolorOption(item, map)
    }
    return out
  }
  return value
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/charts/recolor.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/charts/recolor.ts src/charts/recolor.test.ts
git commit -m "feat(charts): dark→light option recolor map for the theme bridge"
```

---

### Task 6: ECharts theme builder and versioned registration

**Files:**
- Modify: `src/charts/theme.ts`
- Modify: `src/charts/echarts.ts`
- Test: `src/charts/theme.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// src/charts/theme.test.ts
import { describe, expect, it } from 'vitest'
import { DARK, LIGHT } from '../theme/tokens'
import { echarts, registerThemeVersion, themeName } from './echarts'
import { FINANCE_THEME, OTHER_SERIES_COLOR, PALETTE, buildTheme } from './theme'

describe('chart theme bridge', () => {
  it('the dark constants are the DARK tokens', () => {
    expect([...PALETTE]).toEqual([...DARK.palette])
    expect(OTHER_SERIES_COLOR).toBe(DARK.otherSeries)
    expect(FINANCE_THEME).toEqual(buildTheme(DARK))
  })

  it('buildTheme(LIGHT) uses the light palette and surfaces', () => {
    const light = buildTheme(LIGHT)
    expect(light.color).toEqual([...LIGHT.palette])
    expect(light.tooltip.backgroundColor).toBe(LIGHT.surface2)
    expect(light.legend.textStyle.color).toBe(LIGHT.text)
    expect(light.valueAxis.splitLine.lineStyle.color).toBe(LIGHT.gridLine)
  })

  it('registers a versioned theme name that init() accepts', () => {
    const name = registerThemeVersion('light', 3)
    expect(name).toBe('finance-3')
    expect(themeName(0)).toBe('finance')
    // echarts throws on an unregistered theme name only via console warnings, so assert
    // the registry directly: a registered theme is retrievable by init.
    const el = document.createElement('div')
    const chart = echarts.init(el, name, { renderer: 'canvas', width: 10, height: 10 })
    expect(chart).toBeTruthy()
    chart.dispose()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/charts/theme.test.ts`
Expected: FAIL — `buildTheme` / `registerThemeVersion` are not exported.

- [ ] **Step 3: Rewrite `src/charts/theme.ts`**

Keep every exported constant name (pages import them). Replace the file body with:

```ts
// THE chart color source of truth for BUILDERS: the dark constants below are the DARK
// tokens (src/theme/tokens.ts) and stay hard-coded in options on purpose — under a light
// theme EChart recolors the finished option through charts/recolor.ts, so no builder ever
// branches on theme. dataviz-validated 2026-08-14 on surface #171a21 (lightness band,
// chroma, adjacent CVD dE 8.4, normal-vision 19.3, contrast >= 3:1). Fixed slot order IS
// the CVD-safety mechanism — never reorder, never cycle past 8, never invent a hue outside
// tokens.ts.
import { DARK, type ThemeTokens } from '../theme/tokens'
import type { AccountGroup } from '../types/api'

export const PALETTE = DARK.palette

// Groups wear fixed entity colors (stack adjacency = validated palette adjacency).
export const GROUP_COLORS: Record<AccountGroup, string> = {
  cash: PALETTE[0],
  pre_tax: PALETTE[1],
  post_tax: PALETTE[2],
  taxable: PALETTE[3],
  equity: PALETTE[4],
  other: PALETTE[5],
  liability: PALETTE[7],
}

export const GROUP_LABELS: Record<AccountGroup, string> = {
  cash: 'Cash',
  pre_tax: 'Pre-tax',
  post_tax: 'Post-tax',
  taxable: 'Taxable',
  equity: 'Equity',
  other: 'Other',
  liability: 'Liabilities',
}

export const GROUP_ORDER: AccountGroup[] = [
  'cash', 'pre_tax', 'post_tax', 'taxable', 'equity', 'other', 'liability',
]

// Sequential blue, dark -> light on the dark surface (near-zero recedes to the card).
export const SEQUENTIAL_BLUE = DARK.sequential

// Neutral gray for the folded "Other" stack — 3.6:1 on the surface (was #4a5060 at 2.16:1).
export const OTHER_SERIES_COLOR = DARK.otherSeries

export const INK = DARK.text
export const MUTED = DARK.muted
export const GRID_LINE = DARK.gridLine
export const AXIS_LINE = DARK.axisLine
export const SURFACE = DARK.surface
export const SURFACE_2 = DARK.surface2
export const POSITIVE = DARK.positive
export const NEGATIVE = DARK.negative

const FONT_FAMILY = "system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

/** The ECharts theme object for a token set — registered per resolved theme by
 *  charts/echarts.ts (`registerThemeVersion`). */
export function buildTheme(t: ThemeTokens) {
  return {
    color: [...t.palette],
    backgroundColor: 'transparent',
    textStyle: { color: t.muted, fontFamily: FONT_FAMILY },
    categoryAxis: {
      axisLine: { lineStyle: { color: t.axisLine } },
      axisTick: { show: false },
      axisLabel: { color: t.muted },
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: t.muted },
      splitLine: { lineStyle: { color: t.gridLine, width: 1, type: 'solid' as const } },
    },
    legend: {
      textStyle: { color: t.text, fontSize: 12 },
      icon: 'roundRect',
      itemWidth: 12,
      itemHeight: 8,
    },
    tooltip: {
      backgroundColor: t.surface2,
      borderColor: t.axisLine,
      borderWidth: 1,
      textStyle: { color: t.text, fontSize: 12 },
      extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,0.4); border-radius: 8px;',
    },
    // echarts 6's default visualMap label token (#54555a) is ~2.3:1 on our surface and
    // does not follow textStyle — pin it here so heatmaps don't compensate per-page.
    visualMap: { textStyle: { color: t.muted } },
  }
}

// Registered once by src/charts/echarts.ts as 'finance' (the version-0 name).
export const FINANCE_THEME = buildTheme(DARK)
```

- [ ] **Step 4: Add versioned registration to `src/charts/echarts.ts`**

Replace the two lines `import { FINANCE_THEME } from './theme'` and `echarts.registerTheme('finance', FINANCE_THEME)` with:

```ts
import { DARK, LIGHT } from '../theme/tokens'
import { FINANCE_THEME, buildTheme } from './theme'
import type { ResolvedTheme } from '../components/shell/ThemeProvider'
```

and, after the `echarts.use([...])` call:

```ts
echarts.registerTheme('finance', FINANCE_THEME)

/** 'finance' for the initial paint, 'finance-<n>' after the n-th palette change. */
export function themeName(version: number): string {
  return version === 0 ? 'finance' : `finance-${version}`
}

/** Registers the theme for a resolved palette under its versioned name and returns the
 *  name. Idempotent per name; ECharts overwrites a re-registration. */
export function registerThemeVersion(resolved: ResolvedTheme, version: number): string {
  const name = themeName(version)
  echarts.registerTheme(name, buildTheme(resolved === 'light' ? LIGHT : DARK))
  return name
}
```

(Use `import type` for `ResolvedTheme` so `echarts.ts` does not pull React into the chart chunk.)

- [ ] **Step 5: Run the test and the chart suites**

Run: `npx vitest run src/charts`
Expected: PASS, including the pre-existing chart option tests (colors are unchanged for dark except `OTHER_SERIES_COLOR`; if a test pinned `#4a5060`, update that expectation to `#6b7382`).

- [ ] **Step 6: Commit**

```bash
git add src/charts/theme.ts src/charts/echarts.ts src/charts/theme.test.ts
git commit -m "feat(charts): buildTheme from tokens, versioned theme registration, 3:1 Other gray"
```

---

### Task 7: EChart follows the theme version and recolors under light

**Files:**
- Modify: `src/components/EChart.tsx`
- Test: `src/components/EChart.test.tsx` (existing — add cases)

- [ ] **Step 1: Add the failing tests**

Append to `src/components/EChart.test.tsx` (keep its existing mocks; if the file mocks `../charts/echarts`, extend that mock with `registerThemeVersion: vi.fn(() => 'finance-1')` and `themeName: (v: number) => (v === 0 ? 'finance' : \`finance-${v}\`)`):

```tsx
import ThemeProvider from './shell/ThemeProvider'
import { DARK, LIGHT } from '../theme/tokens'

describe('EChart — theme bridge', () => {
  it('re-initializes with the versioned theme name when the palette changes', async () => {
    localStorage.clear()
    const init = vi.mocked(echarts.init)
    init.mockClear()
    function Harness() {
      const { setTheme } = useTheme()
      return (
        <>
          <button onClick={() => setTheme('light')}>go light</button>
          <EChart option={{ series: [] }} />
        </>
      )
    }
    render(<ThemeProvider><Harness /></ThemeProvider>)
    expect(init).toHaveBeenCalledTimes(1)
    expect(init.mock.calls[0][1]).toBe('finance')
    act(() => screen.getByText('go light').click())
    await waitFor(() => expect(init).toHaveBeenCalledTimes(2))
    expect(init.mock.calls[1][1]).toBe('finance-1')
  })

  it('recolors dark token hexes in the option under the light theme', async () => {
    localStorage.setItem('finance.theme', 'light')
    const instance = latestInstance() // the test file's helper for the mocked init() return
    render(
      <ThemeProvider>
        <EChart option={{ series: [{ type: 'bar', itemStyle: { color: DARK.positive } }] }} />
      </ThemeProvider>,
    )
    await waitFor(() => expect(instance.setOption).toHaveBeenCalled())
    const applied = instance.setOption.mock.calls.at(-1)?.[0] as {
      series: { itemStyle: { color: string } }[]
    }
    expect(applied.series[0].itemStyle.color).toBe(LIGHT.positive)
  })
})
```

Add `import { useTheme } from './shell/ThemeProvider'` alongside the ThemeProvider import. If the existing test file has no `latestInstance` helper, add one that returns the object the mocked `echarts.init` resolves to (the file already builds that object for its other tests — reuse it).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/EChart.test.tsx`
Expected: the two new tests FAIL (init called with 'finance' both times; option not recolored).

- [ ] **Step 3: Implement in `src/components/EChart.tsx`**

Add imports:

```tsx
import { echarts, registerThemeVersion, themeName } from '../charts/echarts'
import { lightFromDark, recolorOption } from '../charts/recolor'
import { useTheme } from './shell/ThemeProvider'
```

Inside the component, before the refs:

```tsx
  const { resolved, version: themeVersion } = useTheme()
```

Change the init effect: register the theme before init and depend on the version.

```tsx
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    // Version 0 is the 'finance' theme echarts.ts registers at import; every later palette
    // change registers 'finance-<n>' here, then re-inits so axes, legend and tooltip chrome
    // pick the new tokens. Series colors are handled by recolorOption in the effect below.
    const name = themeVersion === 0 ? themeName(0) : registerThemeVersion(resolved, themeVersion)
    const chart = echarts.init(el, name)
    // …the existing chart.on(...) wiring, unchanged…
    chartRef.current = chart
    lastStrippedRef.current = null
    if (instanceRef) instanceRef.current = chart
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(el)
    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
      lastStrippedRef.current = null
      if (instanceRef) instanceRef.current = null
    }
  }, [instanceRef, resolved, themeVersion])
```

In the setOption effect, recolor before the reduced-motion handling:

```tsx
    // Light theme: swap every dark token hex in the finished option for its light twin.
    // Builders stay theme-blind (charts/recolor.ts). Dark is the identity.
    const themed = resolved === 'light' ? (recolorOption(option, lightFromDark) as EChartsOption) : option
    const base = REDUCED_MOTION ? quiesceRipples(themed) : themed
```

and add `resolved` to that effect's dependency array: `[option, animateEntrance, zoomWindow, resolved]`. The zoom fast-path fingerprint must include the theme so a palette change is never treated as "zoom only": change `const stripped = JSON.stringify({ ...option, dataZoom: undefined })` to `const stripped = JSON.stringify({ ...option, dataZoom: undefined, __theme: resolved })`.

- [ ] **Step 4: Run the test file and the full component suite**

Run: `npx vitest run src/components`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/EChart.tsx src/components/EChart.test.tsx
git commit -m "feat(charts): EChart re-inits on theme version and recolors options under light"
```

---

### Task 8: Segmented control

**Files:**
- Create: `src/components/shell/Segmented.tsx`
- Create: `src/components/shell/shell.css`
- Test: `src/components/shell/Segmented.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/shell/Segmented.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Segmented from './Segmented'

afterEach(cleanup)

const OPTIONS = [
  { value: 'all', label: 'All' },
  { value: '1y', label: '1Y' },
  { value: 'ytd', label: 'YTD' },
] as const

describe('Segmented', () => {
  it('toggle: a group of pressed buttons, one active', () => {
    const onChange = vi.fn()
    render(<Segmented variant="toggle" ariaLabel="Time range" options={OPTIONS} value="1y" onChange={onChange} />)
    const group = screen.getByRole('group', { name: 'Time range' })
    expect(group).toBeTruthy()
    expect(screen.getByRole('button', { name: '1Y' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'YTD' }))
    expect(onChange).toHaveBeenCalledWith('ytd')
  })

  it('tabs: a tablist whose tabs control panels and move with arrow keys', () => {
    const onChange = vi.fn()
    render(
      <Segmented
        variant="tabs"
        ariaLabel="Portfolio records"
        options={[{ value: 'tx', label: 'Transactions' }, { value: 'div', label: 'Dividends' }]}
        value="tx"
        onChange={onChange}
        panelIds={{ tx: 'panel-tx', div: 'panel-div' }}
      />,
    )
    expect(screen.getByRole('tablist', { name: 'Portfolio records' })).toBeTruthy()
    const tx = screen.getByRole('tab', { name: 'Transactions' })
    expect(tx.getAttribute('aria-selected')).toBe('true')
    expect(tx.getAttribute('aria-controls')).toBe('panel-tx')
    expect(tx.getAttribute('tabindex')).toBe('0')
    expect(screen.getByRole('tab', { name: 'Dividends' }).getAttribute('tabindex')).toBe('-1')
    fireEvent.keyDown(tx, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('div')
    fireEvent.keyDown(tx, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('div') // wraps from first to last
  })

  it('steps: the active step carries aria-current', () => {
    render(
      <Segmented
        variant="steps"
        ariaLabel="Wizard"
        options={[{ value: 'a', label: '1 Balances' }, { value: 'b', label: '2 Spending' }]}
        value="b"
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: '2 Spending' }).getAttribute('aria-current')).toBe('step')
    expect(screen.getByRole('button', { name: '1 Balances' }).hasAttribute('aria-current')).toBe(false)
  })

  it('chips with multiple: toggles membership and returns the new array', () => {
    const onChange = vi.fn()
    render(
      <Segmented
        variant="chips"
        ariaLabel="Accounts"
        multiple
        options={[{ value: 'a', label: 'Checking' }, { value: 'b', label: 'HYSA' }]}
        value={['a']}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'HYSA' }))
    expect(onChange).toHaveBeenCalledWith(['a', 'b'])
    fireEvent.click(screen.getByRole('button', { name: 'Checking' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('disabled options render disabled and never fire', () => {
    const onChange = vi.fn()
    render(
      <Segmented
        variant="toggle"
        ariaLabel="X"
        options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B', disabled: true }]}
        value="a"
        onChange={onChange}
      />,
    )
    const b = screen.getByRole('button', { name: 'B' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    fireEvent.click(b)
    expect(onChange).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/shell/Segmented.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// src/components/shell/Segmented.tsx
import type { KeyboardEvent, ReactNode } from 'react'
import './shell.css'

// The ONE "pick one of N" control (2026-09-03 shell spec §8). Four visual variants, each
// with the semantics its use deserves: toggle/chips are pressed-button groups, tabs are a
// real tablist (arrow keys, roving tabindex, aria-controls), steps carry aria-current.
export type SegmentedVariant = 'toggle' | 'tabs' | 'steps' | 'chips'

export interface SegmentedOption<V extends string> {
  value: V
  label: ReactNode
  disabled?: boolean
  /** Small trailing badge (a count, a "tie" pill). */
  badge?: ReactNode
  title?: string
}

type SegmentedProps<V extends string> = {
  variant: SegmentedVariant
  options: readonly SegmentedOption<V>[]
  ariaLabel: string
  size?: 'sm' | 'md'
  /** tabs only: the id of the panel each tab controls, by value. */
  panelIds?: Partial<Record<V, string>>
} & (
  | { multiple?: false; value: V; onChange: (next: V) => void }
  | { multiple: true; value: readonly V[]; onChange: (next: V[]) => void }
)

export default function Segmented<V extends string>(props: SegmentedProps<V>) {
  const { variant, options, ariaLabel, size = 'md', panelIds } = props
  const isOn = (value: V): boolean =>
    props.multiple ? props.value.includes(value) : props.value === value

  const select = (value: V) => {
    if (props.multiple) {
      const current = props.value
      props.onChange(
        current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
      )
    } else {
      props.onChange(value)
    }
  }

  // Tabs move with the arrow keys and wrap; the active tab is the only one in the tab order
  // (WAI-ARIA tabs pattern). Disabled tabs are skipped.
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (variant !== 'tabs' || props.multiple) return
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const enabled = options.filter((o) => !o.disabled)
    if (enabled.length === 0) return
    const position = enabled.findIndex((o) => o.value === options[index].value)
    const step = event.key === 'ArrowRight' ? 1 : -1
    const next = enabled[(position + step + enabled.length) % enabled.length]
    props.onChange(next.value)
    document.getElementById(tabId(ariaLabel, next.value))?.focus()
  }

  const role = variant === 'tabs' ? 'tablist' : 'group'
  const className = ['segmented', `segmented-${variant}`, size === 'sm' ? 'segmented-sm' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className} role={role} aria-label={ariaLabel}>
      {options.map((option, index) => {
        const on = isOn(option.value)
        const common = {
          key: option.value,
          type: 'button' as const,
          className: on ? 'active' : '',
          disabled: option.disabled,
          title: option.title,
          onClick: () => select(option.value),
        }
        if (variant === 'tabs') {
          return (
            <button
              {...common}
              id={tabId(ariaLabel, option.value)}
              role="tab"
              aria-selected={on}
              aria-controls={panelIds?.[option.value]}
              tabIndex={on ? 0 : -1}
              onKeyDown={(event) => onTabKey(event, index)}
            >
              {option.label}
              {option.badge !== undefined && <span className="segmented-badge">{option.badge}</span>}
            </button>
          )
        }
        return (
          <button
            {...common}
            aria-pressed={variant === 'steps' ? undefined : on}
            aria-current={variant === 'steps' && on ? 'step' : undefined}
          >
            {option.label}
            {option.badge !== undefined && <span className="segmented-badge">{option.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}

function tabId(group: string, value: string): string {
  return `tab-${group.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${value}`
}
```

- [ ] **Step 4: Write `src/components/shell/shell.css`**

```css
/* ── Shell primitives (2026-09-03 shell spec) ─────────────────────────────── */
/* Imported by every component in src/components/shell/. panels.css keeps the card, tile,
   table and form grammar; this file owns the page frame, the scope row, the Segmented
   control and the sidebar footer. */

/* Segmented: the one "pick one of N" control. `.segmented` is the same name panels.css
   used for RangeChips and the hand-rolled groups, so an unmigrated page keeps its look
   until Plan 4 deletes the old rule. */
.segmented {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.segmented button {
  padding: 0.35rem 0.8rem;
  border: none;
  background: none;
  color: var(--muted);
  font-size: 0.8rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.segmented-sm button {
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
}

.segmented button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.segmented button.active {
  background: var(--surface-2);
  color: var(--text);
}

.segmented button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Chips: pill-shaped, no shared border box (the drill-down / trend pickers). */
.segmented-chips {
  border: none;
  border-radius: 0;
  overflow: visible;
  flex-wrap: wrap;
  gap: 6px;
}

.segmented-chips button {
  padding: 0.25rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 0.75rem;
}

.segmented-chips button.active {
  background: none;
  color: var(--text);
  border-color: currentColor;
}

.segmented-chips button:focus-visible {
  outline-offset: 1px;
}

/* Steps: the wizard's numbered pills. */
.segmented-steps {
  border: none;
  overflow: visible;
  gap: 0.5rem;
}

.segmented-steps button {
  border: 1px solid var(--border);
  border-radius: 999px;
}

.segmented-steps button.active {
  background: none;
  color: var(--text);
  border-color: var(--accent);
}

.segmented-badge {
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--surface-2);
  font-size: 0.65rem;
  color: var(--muted);
}

/* ── PageFrame ───────────────────────────────────────────────────────────── */

.page-frame-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.page-frame-header h1 {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.page-frame-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.page-frame-subheader {
  margin: -0.25rem 0 0.9rem;
}

/* The scope row pins while the page scrolls (user decision 2026-09-03: layout A with the
   scope row sticky). The hairline appears only once it is actually stuck — an
   IntersectionObserver on the sentinel above it toggles .is-stuck. z-index sits above
   cards (which have none) and below the palette (20), drawer (15) and toasts (30). */
.page-frame-sentinel {
  height: 1px;
  margin-top: -1px;
}

.page-frame-scope {
  position: sticky;
  top: 0;
  z-index: 8;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1.25rem;
  padding: 0.6rem 0;
  margin: 0 0 1rem;
  background: var(--bg);
  border-bottom: 1px solid transparent;
}

.page-frame-scope.is-stuck {
  border-bottom-color: var(--border);
}

.page-frame-scope .eyebrow {
  margin: 0;
}

.page-frame-stale {
  margin: 0 0 0.9rem;
  color: var(--muted);
  font-size: 0.8rem;
}

.page-frame-stale .button {
  margin-left: 0.5rem;
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
}

/* ── Sidebar footer (rendered by Plan 1c's SidebarFooter) ─────────────────── */

.sidebar-footer {
  margin-top: auto;
  padding: 0.5rem 0.25rem 0;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.72rem;
  color: var(--muted);
}

.sidebar-footer-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.5rem;
  min-width: 0;
}

.sidebar-footer-email {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-footer-pill {
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.sidebar-footer-pill.is-dev {
  color: var(--warn);
  border-color: var(--warn);
}

.sidebar-footer-hash {
  font-family: ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', Menlo, Consolas, monospace;
}

.sidebar-footer-icon {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.5rem;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--muted);
  cursor: pointer;
  width: 100%;
  text-align: left;
}

.sidebar-footer-icon:hover {
  background: var(--surface-2);
  color: var(--text);
}

.sidebar-footer-icon:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

/* One focus ring for the shell's own controls, including the nav (which had none). */
.nav-link:focus-visible,
.logout-button:focus-visible,
.sidebar-search:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

@media (prefers-reduced-motion: no-preference) {
  .segmented button,
  .sidebar-footer-icon {
    transition:
      background-color var(--t-fast) ease,
      border-color var(--t-fast) ease,
      color var(--t-fast) ease;
  }
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/components/shell/Segmented.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/Segmented.tsx src/components/shell/Segmented.test.tsx src/components/shell/shell.css
git commit -m "feat(shell): Segmented control (toggle/tabs/steps/chips) with ARIA per variant; shell.css"
```

---

### Task 9: PageFrame

**Files:**
- Create: `src/components/shell/PageFrame.tsx`
- Test: `src/components/shell/PageFrame.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/shell/PageFrame.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PageFrame, { usePageFrame } from './PageFrame'

afterEach(cleanup)

// jsdom has no IntersectionObserver; PageFrame must degrade to "never stuck".
type IOCallback = (entries: { isIntersecting: boolean }[]) => void
let observers: IOCallback[] = []
beforeEach(() => {
  observers = []
  vi.stubGlobal(
    'IntersectionObserver',
    vi.fn((cb: IOCallback) => ({
      observe: () => observers.push(cb),
      disconnect: () => {},
      unobserve: () => {},
    })),
  )
})

function CacheProbe() {
  return <span data-testid="cache">{String(usePageFrame().fromCache)}</span>
}

describe('PageFrame', () => {
  it('renders the title row with actions, the subheader and children when ready', () => {
    render(
      <PageFrame
        title="Net worth"
        actions={<button>Enter month</button>}
        subheader={<p>as of Sep 2026</p>}
        resource={{ status: 'ready' }}
      >
        <p>body</p>
      </PageFrame>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Net worth' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enter month' })).toBeTruthy()
    expect(screen.getByText('as of Sep 2026')).toBeTruthy()
    expect(screen.getByText('body')).toBeTruthy()
    expect(document.querySelector('.page-frame-scope')).toBeNull()
  })

  it('loading with no data: header, scope row and the skeleton — no children', () => {
    render(
      <PageFrame
        title="Portfolio"
        scopeRow={<span>scope</span>}
        resource={{ status: 'loading' }}
        skeleton={{ tiles: 3, cards: [{ span: 12, height: 200 }] }}
      >
        <p>body</p>
      </PageFrame>,
    )
    expect(screen.getByText('scope')).toBeTruthy()
    expect(screen.getByRole('status', { name: '' }).textContent).toBe('Loading…')
    expect(document.querySelectorAll('.stat-tile')).toHaveLength(3)
    expect(screen.queryByText('body')).toBeNull()
  })

  it('error with no data: an alert with the message and Retry', () => {
    const retry = vi.fn()
    render(
      <PageFrame title="Taxes" resource={{ status: 'error', error: 'boom', retry }}>
        <p>body</p>
      </PageFrame>,
    )
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('boom')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('body')).toBeNull()
  })

  it('error with data on screen: children stay and a stale line names it', () => {
    render(
      <PageFrame title="Spending" resource={{ status: 'ready', error: 'offline', retry: () => {} }}>
        <p>body</p>
      </PageFrame>,
    )
    expect(screen.getByText('body')).toBeTruthy()
    expect(screen.getByText(/Showing earlier data — offline/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('busy dims the body and fromCache reaches the context', () => {
    render(
      <PageFrame title="Overview" resource={{ status: 'ready', busy: true, fromCache: true }}>
        <CacheProbe />
      </PageFrame>,
    )
    expect(document.querySelector('.loading-dim.is-loading')).toBeTruthy()
    expect(screen.getByTestId('cache').textContent).toBe('true')
  })

  it('the scope row gains is-stuck when its sentinel leaves the viewport', () => {
    render(
      <PageFrame title="Net worth" scopeRow={<span>scope</span>} resource={{ status: 'ready' }}>
        <p>body</p>
      </PageFrame>,
    )
    const row = document.querySelector('.page-frame-scope') as HTMLElement
    expect(row.classList.contains('is-stuck')).toBe(false)
    observers.forEach((cb) => cb([{ isIntersecting: false }]))
    expect(row.classList.contains('is-stuck')).toBe(true)
    observers.forEach((cb) => cb([{ isIntersecting: true }]))
    expect(row.classList.contains('is-stuck')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/shell/PageFrame.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// src/components/shell/PageFrame.tsx
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import PageSkeleton from '../PageSkeleton'
import '../panels.css'
import './shell.css'

// One component owns the top of every page and its lifecycle states (2026-09-03 shell
// spec §5). Pages keep their own state and hand a `resource` summary here; the frame
// decides what that means on screen, identically everywhere:
//   loading, no data   → header · scope row · skeleton
//   error, no data     → header · scope row · alert with Retry
//   ready              → children (dimmed while `busy`)
//   ready + error      → children + one stale line with Retry
// The scope row is sticky; the hairline appears only while it is actually stuck.
export interface PageResource {
  status: 'loading' | 'ready' | 'error'
  error?: string | null
  /** Revalidating while data is on screen. */
  busy?: boolean
  /** Painted from the snapshot cache — charts read it to skip the entrance animation. */
  fromCache?: boolean
  retry?: () => void
}

export interface PageSkeletonSpec {
  tiles?: number
  cards?: { span: 4 | 6 | 8 | 12; height?: number }[]
}

interface PageFrameContextValue {
  fromCache: boolean
}

const PageFrameContext = createContext<PageFrameContextValue>({ fromCache: false })

/** `fromCache` for charts rendered inside a frame; false outside one. */
export function usePageFrame(): PageFrameContextValue {
  return useContext(PageFrameContext)
}

const DEFAULT_SKELETON: PageSkeletonSpec = { tiles: 4, cards: [{ span: 12, height: 320 }] }

export default function PageFrame({
  title,
  actions,
  subheader,
  scopeRow,
  resource,
  skeleton = DEFAULT_SKELETON,
  children,
}: {
  title: string
  /** Right side of the title row — the page's primary action lives here, never in the scope row. */
  actions?: ReactNode
  /** Under the title row: page-local status lines (Portfolio's refresh result). */
  subheader?: ReactNode
  /** The sticky row's content — a ScopeBar (Plan 1b) or any page-specific controls. Absent → no row. */
  scopeRow?: ReactNode
  resource: PageResource
  /** Ghost layout while loading with no data. */
  skeleton?: PageSkeletonSpec
  children: ReactNode
}) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)

  // The sentinel sits one pixel above the sticky row; once it scrolls out, the row is
  // pinned. Guarded for jsdom and old browsers: without the observer the row simply never
  // shows its hairline.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || scopeRow === undefined || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setStuck(!entry.isIntersecting)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [scopeRow])

  const hasData = resource.status === 'ready'
  const showSkeleton = resource.status === 'loading'
  const showErrorOnly = resource.status === 'error'
  const staleError = hasData && resource.error ? resource.error : null

  return (
    <PageFrameContext.Provider value={{ fromCache: resource.fromCache === true }}>
      <header className="page-frame-header">
        <h1>{title}</h1>
        {actions !== undefined && <div className="page-frame-actions">{actions}</div>}
      </header>
      {subheader !== undefined && <div className="page-frame-subheader">{subheader}</div>}
      {scopeRow !== undefined && (
        <>
          <div ref={sentinelRef} className="page-frame-sentinel" aria-hidden="true" />
          <div className={`page-frame-scope${stuck ? ' is-stuck' : ''}`}>{scopeRow}</div>
        </>
      )}
      {showSkeleton && <PageSkeleton tiles={skeleton.tiles ?? 0} cards={skeleton.cards ?? []} />}
      {showErrorOnly && (
        <div className="error-banner" role="alert">
          {resource.error ?? 'Something went wrong.'}{' '}
          {resource.retry !== undefined && (
            <button type="button" className="button" onClick={resource.retry}>
              Retry
            </button>
          )}
        </div>
      )}
      {hasData && (
        <>
          {staleError !== null && (
            <p className="page-frame-stale" role="status">
              Showing earlier data — {staleError}
              {resource.retry !== undefined && (
                <button type="button" className="button" onClick={resource.retry}>
                  Retry
                </button>
              )}
            </p>
          )}
          <div className={`loading-dim${resource.busy ? ' is-loading' : ''}`}>{children}</div>
        </>
      )}
    </PageFrameContext.Provider>
  )
}
```

Note on the skeleton's status role: `PageSkeleton` renders `<p className="visually-hidden" role="status">Loading…</p>`, which is what the test's `getByRole('status')` finds.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/shell/PageFrame.test.tsx`
Expected: PASS (6 tests). If `getByRole('status', { name: '' })` is too strict in your Testing Library version, use `screen.getByText('Loading…')`.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/PageFrame.tsx src/components/shell/PageFrame.test.tsx
git commit -m "feat(shell): PageFrame — header, actions, subheader, sticky scope row, five lifecycle states"
```

---

### Task 10: Appearance card in Settings

**Files:**
- Create: `src/components/settings/AppearanceCard.tsx`
- Test: `src/components/settings/AppearanceCard.test.tsx`
- Modify: `src/pages/SettingsPage.tsx` (mount the card after the Password card)

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/settings/AppearanceCard.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ThemeProvider from '../shell/ThemeProvider'
import AppearanceCard from './AppearanceCard'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('AppearanceCard', () => {
  it('shows the current choices and writes them through the provider', () => {
    render(<ThemeProvider><AppearanceCard /></ThemeProvider>)
    expect(screen.getByRole('region', { name: 'Appearance' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Light' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('finance.theme')).toBe('light')
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }))
    expect(document.documentElement.dataset.density).toBe('compact')
  })

  it('carries the anchor id the palette jumps to', () => {
    render(<ThemeProvider><AppearanceCard /></ThemeProvider>)
    expect(document.getElementById('appearance')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/settings/AppearanceCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the card**

```tsx
// src/components/settings/AppearanceCard.tsx
import InfoHint from '../InfoHint'
import Segmented from '../shell/Segmented'
import { useTheme, type Density, type ThemeChoice } from '../shell/ThemeProvider'
import '../panels.css'

// Theme and density (2026-09-03 shell spec §11). Browser-local for now — the note says so,
// because a preference that does not follow you to another device deserves a sentence.
const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

const DENSITIES: { value: Density; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
]

export default function AppearanceCard() {
  const { theme, density, setTheme, setDensity } = useTheme()
  return (
    <section className="card span-6" id="appearance" role="region" aria-label="Appearance">
      <h2 className="eyebrow">
        Appearance
        <InfoHint text="Theme and density are remembered in this browser. System follows your operating system's light or dark setting live." />
      </h2>
      <div className="settings-field">
        <span className="eyebrow">Theme</span>
        <Segmented variant="toggle" ariaLabel="Theme" options={THEMES} value={theme} onChange={setTheme} />
      </div>
      <div className="settings-field">
        <span className="eyebrow">Density</span>
        <Segmented
          variant="toggle"
          ariaLabel="Density"
          options={DENSITIES}
          value={density}
          onChange={setDensity}
        />
      </div>
      <p className="drill-hint">Remembered in this browser only.</p>
    </section>
  )
}
```

If `settings.css` has no `.settings-field` rule, add one:

```css
.settings-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 0.9rem;
}
```

- [ ] **Step 4: Mount it in `src/pages/SettingsPage.tsx`**

Import `AppearanceCard from '../components/settings/AppearanceCard'` and render `<AppearanceCard />` directly after the closing tag of the Password card's `<section className="card span-6">` (the one containing "Existing sessions stay signed in").

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/components/settings/AppearanceCard.test.tsx src/pages/SettingsPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/AppearanceCard.tsx src/components/settings/AppearanceCard.test.tsx src/pages/SettingsPage.tsx src/components/settings/settings.css
git commit -m "feat(settings): Appearance card — theme (system/dark/light) and density"
```

---

### Task 11: Type-check, lint, full suite, smoke

- [ ] **Step 1: Run everything**

Run: `npx tsc -b && npx eslint src/theme src/charts src/components/shell src/components/settings/AppearanceCard.tsx src/components/EChart.tsx src/App.tsx && npx vitest run`
Expected: tsc clean, eslint no errors, all tests green.

- [ ] **Step 2: Visual smoke in both themes**

With the dev stack up (frontend on 5173, backend on 8000), run the audit's headless walk twice: once as-is, once after `localStorage.setItem('finance.theme','light')` in the init script. Confirm Overview and Net worth render legible charts in light (axes, legend, tooltip, series recolored) and that Settings shows the Appearance card. Save screenshots under the scratchpad.

- [ ] **Step 3: Commit anything the smoke required and push the branch**

```bash
git add -A
git commit -m "chore(shell): smoke fixes for theme bridge" # only if there were changes
```

---

## Self-review

**Spec coverage (§ of the design):** §11 tokens/bridge/density/Appearance → Tasks 1, 2, 4–7, 10. §8 Segmented → Task 8. §5 PageFrame (header, actions, subheader, sticky row, five states, context) → Task 9; the scope row's *contents* (ScopeBar) are Plan 1b, wired in Plan 2. §13 legibility floor + hero clamp + tabular numerals → Task 3; toast/InfoHint/invalidation are Plan 1c. **Placeholders:** none. **Type consistency:** `PageResource`, `PageSkeletonSpec`, `usePageFrame`, `Segmented` props, `useTheme` return shape, `registerThemeVersion`/`themeName`, `recolorOption`/`lightFromDark`, `cssDeclarations`/`contrastRatio` are used with the same names throughout.
