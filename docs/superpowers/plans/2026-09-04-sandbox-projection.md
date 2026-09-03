# Sandbox lane J — Projection scenarios (`ScenarioPanel`, URL knobs, pins as reference series) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Projection page onto the sandbox grammar per `docs/superpowers/specs/2026-09-03-planning-sandboxes-design.md` §11: the eight knobs and the retirement months live in the URL (`whatif=annual_return:0.06`, `whatif=retire:2:2035-06` — the same keys as the query the page sends), preview live (300 ms) through the already-pure `GET /projection`, blank still means "derived" (the empty run's echo seeds each knob's caption and placeholder, a blank knob wears a "derived" badge, Reset to derived is `reset()`), pins (max three) join the investable chart as dashed reference series end-labelled with their names and a compare table of the headline figures, and the Recalculate button is retired. No Apply — nothing on this page is stored.

**Architecture:** `projectionScenario.ts` is the codec (knobs alphabetical, then `retire:` by person — the parity fixture's order), the router's fences as the accept rule, `toParams` (a straight copy into `ProjectionParams`), `derivedOf` (the echo as each knob's actual), and the compare-row map. The PAGE owns `useSandbox` (one-sided: no `baselineOf`; `initialBaseline` = the `projection:default` snapshot; `onBaseline` re-caches it; `dataKey` carries a retry nonce so the frame's Retry re-runs everything) and derives `data = result ?? baseline` for tiles and charts, `missing` from `errorStatus === 404`, and `fromCache` from result identity — no setState in effects. `ScenarioPanel` is the knobs card: `SandboxPanel` (open by default, "Reset to derived", no Apply) over eight `SliderBox`es and per-person month inputs, with `CompareTable<ProjectionOut>` (no Δ column — the payload is one-sided) whose pinned columns are the pins' live results. `projectionOption` gains an optional `references` argument built with the chart grammar's `referenceLine()`; if the chart-grammar primitives lane has not merged, this lane creates `src/charts/reference.ts` with exactly the chart spec's signature (C1 supersedes it at merge — same name, same shape).

**Tech Stack:** React 19, react-router 7, TypeScript, vitest + Testing Library, ECharts 6 option builders; lane G's `src/sandbox/*`.

**Worktree / commands:** Branch `sandbox-projection`, worktree `.worktrees/sandbox-projection`, `cmd /c mklink /J node_modules ..\..\node_modules`. `npx vitest run <file>`, `npx tsc -b`, `npx eslint src/components/projection src/pages/ProjectionPage.tsx src/charts/reference.ts`. Backend tests, if any were needed, would run on `FINANCE_TEST_DB=finance_test_sandbox_j` (none planned — `GET /projection` is unchanged).

**Prerequisites on main:** lane G merged (lane B is not needed here); shell Plan 3 Task 6 (Projection through `PageFrame`) merged. Verify: `ls src/sandbox/useSandbox.ts && grep -n "PageFrame" src/pages/ProjectionPage.tsx`.

**Shared-file hotspots:** `src/pages/ProjectionPage.tsx` + `.test.tsx` and `src/components/projection/*` (this lane only among the sandbox lanes; the chart-grammar lane C5 also migrates `projectionChartOptions.ts` — the `references` argument here is ADDITIVE and the existing builder tests are the byte-identical pin, so the merge is a union). `src/charts/reference.ts`: created by chart-grammar C1 AND conditionally by this lane (Task 3) — if both exist at merge, take C1's file wholesale; the call site here uses only `referenceLine(name, data)`. `src/sandbox/sandboxConformance.test.ts` (lane G) walks `ScenarioPanel.tsx` once it exists: import nothing named `api` from the client (the panel imports nothing from `src/api/` at all — the page passes the sandbox in).

**Overnight rule:** no file deletions. The page's `Knobs`/`recalculate`/`load` code is REPLACED (edits); `ProjectionPage.css`'s `.projection-form`/`.projection-actions` rules become unused and go on the verify plan's retire list.

---

## File structure

| File | Responsibility |
|---|---|
| `src/components/projection/projectionScenario.ts` (new) | `ProjectionScenario`, knobs + fences, `decodeProjection`/`encodeProjection`/`isEmptyProjection`, `toParams`, `derivedOf`, `labelForProjection`, `COMPARE_ROWS`, `projectionValue`, `SLIDER` ranges |
| `src/components/projection/projectionScenario.test.ts` (new) | round trip incl. the parity fixture's projection case, fences, params copy, derived map, labels |
| `src/charts/reference.ts` (new — CONDITIONAL, only if absent) | `referenceLine(name, data, { step? })` — the chart spec §10 helper |
| `src/charts/reference.test.ts` (new — conditional) | the series shape |
| `src/components/projection/projectionChartOptions.ts` (modify) | `projectionOption(data, { references })` — pins as dashed end-labelled reference series; wider right inset |
| `src/components/projection/projectionChartOptions.test.ts` (modify) | one reference series per pin; unchanged without references |
| `src/components/projection/ScenarioPanel.tsx` (new) | the knobs card on `SandboxPanel` + `SliderBox` + retire month inputs + `CompareTable` |
| `src/components/projection/ScenarioPanel.test.tsx` (new) | derived badges + placeholders, URL from knobs, retire entry, compare columns, no Apply, Reset to derived |
| `src/pages/ProjectionPage.tsx` (modify) | `useSandbox` at page level; `data = result ?? baseline`; Retry nonce; references from pins; `ScenarioPanel` replaces the Assumptions form |
| `src/pages/ProjectionPage.test.tsx` (modify) | Recalculate tests re-pointed to live knobs; pins → series; 404 → wizard unchanged |

---

### Task 1: `projectionScenario.ts`

**Files:**
- Create: `src/components/projection/projectionScenario.ts`
- Test: `src/components/projection/projectionScenario.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/projection/projectionScenario.test.ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProjectionOut } from '../../types/api'
import {
  COMPARE_ROWS,
  decodeProjection,
  derivedOf,
  encodeProjection,
  isEmptyProjection,
  labelForProjection,
  projectionValue,
  toParams,
} from './projectionScenario'

const fixture = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../backend/tests/fixtures/sandbox_entries.json'), 'utf8'),
) as { cases: { page: string; entries: string[] }[] }

const echo: ProjectionOut = {
  starting_balance: '100000.00', base_month: '2026-09-01', start_month: '2026-09-01', annual_return: '0.05',
  monthly_contribution: '4000.00', annual_spend: '60000.00', swr_pct: '0.04', years: 30, fi_target: '1500000.00',
  fi_ratio: '0.066667', fi_month: '2041-03-01', coast_fi_month: null, months: ['2026-09-01', '2026-10-01'],
  projected: ['100000.00', '104400.00'], coast: ['100000.00', '100400.00'], warnings: [], volatility: '0.15',
  inflation: '0.03', contribution_growth: '0.03', bands: null, fi_probability: '0.62', fi_month_p10: '2038-01-01',
  fi_month_p50: '2041-06-01', fi_month_p90: null, retirements: [],
}

describe('projection scenario codec', () => {
  it('round-trips knobs (alphabetical) then retirements (by person) and accepts the parity fixture unchanged', () => {
    const projection = fixture.cases.find((c) => c.page === 'projection')!
    const scenario = decodeProjection(projection.entries)
    expect(scenario).toEqual({ knobs: { annual_return: '0.06', monthly_contribution: '5400' }, retirements: { 2: '2035-06' } })
    expect(encodeProjection(scenario)).toEqual(projection.entries)
    expect(encodeProjection(decodeProjection(['retire:3:2040-01', 'years:40', 'retire:1:2035-06', 'swr:0.035']))).toEqual([
      'swr:0.035',
      'years:40',
      'retire:1:2035-06',
      'retire:3:2040-01',
    ])
  })

  it('applies the router’s fences, drops garbage, keeps the last of a duplicate', () => {
    expect(
      decodeProjection([
        'annual_return:0.6', 'annual_return:0.06', 'swr:0', 'swr:2', 'volatility:1.5', 'inflation:0.3', 'contribution_growth:-0.1',
        'years:0', 'years:61', 'years:7.5', 'annual_spend:0', 'monthly_contribution:-100', 'retire:x:2035-06', 'retire:2:2035-13', 'bonus:1', 'NVDA',
      ]),
    ).toEqual({ knobs: { annual_return: '0.06', monthly_contribution: '-100' }, retirements: {} })
    expect(isEmptyProjection({ knobs: {}, retirements: {} })).toBe(true)
    expect(isEmptyProjection({ knobs: {}, retirements: { 2: '2035-06' } })).toBe(false)
  })

  it('copies the scenario into fetchProjection’s params, omitting unset knobs', () => {
    expect(toParams(decodeProjection(['annual_return:0.06', 'years:40', 'volatility:0', 'retire:2:2035-06']))).toEqual({
      annualReturn: '0.06',
      years: '40',
      volatility: '0',
      retirements: [{ personId: 2, month: '2035-06' }],
    })
    expect(toParams({ knobs: {}, retirements: {} })).toEqual({ retirements: [] })
  })

  it('reads the echo as each knob’s derived value', () => {
    expect(derivedOf(echo)).toEqual({
      annual_return: '0.05', annual_spend: '60000.00', contribution_growth: '0.03', inflation: '0.03',
      monthly_contribution: '4000.00', swr: '0.04', volatility: '0.15', years: '30',
    })
    expect(derivedOf({ ...echo, volatility: null, annual_spend: null }).volatility).toBeNull()
    expect(derivedOf(null).years).toBeNull()
  })

  it('labels a pin by its first two knobs', () => {
    expect(labelForProjection(decodeProjection(['annual_return:0.06', 'monthly_contribution:5400', 'years:40']))).toBe('Return 6% · Contribution $5,400.00')
    expect(labelForProjection(decodeProjection(['retire:2:2035-06']))).toBe('Retire #2 2035-06')
  })

  it('maps the compare rows onto the payload', () => {
    expect(COMPARE_ROWS.map((r) => r.key)).toEqual([
      'fi_target', 'fi_ratio', 'fi_month', 'coast_fi_month', 'fi_probability', 'fi_month_p10', 'fi_month_p50', 'fi_month_p90', 'monthly_contribution',
    ])
    expect(projectionValue(echo, 'fi_target')).toBe('1500000.00')
    expect(projectionValue(echo, 'coast_fi_month')).toBeNull()
    expect(projectionValue(echo, 'years')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/projection/projectionScenario.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// src/components/projection/projectionScenario.ts
// The Projection sandbox's codec (2026-09-03 planning-sandboxes spec §11). Pure. Knob values
// are the SERVER'S wire vocabulary — the same keys and fractions as the query the page sends
// (`annual_return=0.06`, `retire=2:2035-06`), so a link IS the request. Blank means derived:
// an unset knob is absent from the URL and the empty run's echo stands in for it.
import type { ProjectionParams } from '../../api/projection'
import type { CompareRow } from '../../sandbox/CompareTable'
import { compareDecimals } from '../../sandbox/decimal'
import { formatEntry, formatRetire, isWireDecimal, lastWins, parseEntry, parseKnob, parseRetire } from '../../sandbox/scenarioUrl'
import type { ProjectionOut } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import { shiftPoint } from '../../utils/percent'

// Alphabetical: the canonical URL order (the parity fixture's).
export const KNOBS = [
  'annual_return',
  'annual_spend',
  'contribution_growth',
  'inflation',
  'monthly_contribution',
  'swr',
  'volatility',
  'years',
] as const
export type ProjectionKnob = (typeof KNOBS)[number]

export interface ProjectionScenario {
  knobs: Partial<Record<ProjectionKnob, string>>
  /** person id → YYYY-MM */
  retirements: Record<number, string>
}

export const EMPTY_PROJECTION_SCENARIO: ProjectionScenario = { knobs: {}, retirements: {} }

// The router's own fences (api/projection.py RETURN_MIN/MAX, SWR_MESSAGE, VOLATILITY,
// INFLATION, GROWTH, YearsQuery) — a link may not carry a value the server would 422.
function accept(key: ProjectionKnob, value: string): boolean {
  if (key === 'years') return /^\d{1,2}$/.test(value) && Number(value) >= 1 && Number(value) <= 60
  if (!isWireDecimal(value)) return false
  const within = (lo: string, hi: string) => compareDecimals(value, lo) >= 0 && compareDecimals(value, hi) <= 0
  switch (key) {
    case 'annual_return':
      return within('-0.5', '0.5')
    case 'swr':
      return compareDecimals(value, '0') > 0 && compareDecimals(value, '1') <= 0
    case 'volatility':
      return within('0', '1')
    case 'inflation':
      return within('-0.1', '0.25')
    case 'contribution_growth':
      return within('0', '0.25')
    case 'annual_spend':
      return compareDecimals(value, '0') > 0
    case 'monthly_contribution':
      return true // any money figure; the server bounds its magnitude
  }
}

/** The sliders' tracks — UI ranges, wider than typical but inside the fences above. */
export const SLIDER: Record<ProjectionKnob, { min: string; max: string; step: string; kind: 'percent' | 'money' | 'plain' }> = {
  annual_return: { min: '-0.5', max: '0.5', step: '0.001', kind: 'percent' },
  annual_spend: { min: '0', max: '1000000', step: '1000', kind: 'money' },
  contribution_growth: { min: '0', max: '0.25', step: '0.001', kind: 'percent' },
  inflation: { min: '-0.1', max: '0.25', step: '0.001', kind: 'percent' },
  monthly_contribution: { min: '0', max: '50000', step: '100', kind: 'money' },
  swr: { min: '0.001', max: '0.1', step: '0.0005', kind: 'percent' },
  volatility: { min: '0', max: '1', step: '0.005', kind: 'percent' },
  years: { min: '1', max: '60', step: '1', kind: 'plain' },
}

export function decodeProjection(entries: string[]): ProjectionScenario {
  const parsed = entries.map(parseEntry).filter((e): e is NonNullable<typeof e> => e !== null)
  const knobs = lastWins(
    parsed.map((e) => parseKnob(e, KNOBS, accept)).filter((k): k is NonNullable<typeof k> => k !== null),
    (k) => k.key,
  )
  const retirements = lastWins(
    parsed.filter((e) => e.key === 'retire').map((e) => parseRetire(e.fields)).filter((r): r is NonNullable<typeof r> => r !== null),
    (r) => String(r.person_id),
  )
  const scenario: ProjectionScenario = { knobs: {}, retirements: {} }
  for (const k of knobs) scenario.knobs[k.key] = k.value
  for (const r of retirements) scenario.retirements[r.person_id] = r.month
  return scenario
}

export function encodeProjection(scenario: ProjectionScenario): string[] {
  return [
    ...KNOBS.filter((key) => scenario.knobs[key] !== undefined).map((key) => formatEntry(key, scenario.knobs[key] as string)),
    ...Object.keys(scenario.retirements)
      .map(Number)
      .sort((a, b) => a - b)
      .map((personId) => formatRetire({ person_id: personId, month: scenario.retirements[personId] })),
  ]
}

export function isEmptyProjection(scenario: ProjectionScenario): boolean {
  return KNOBS.every((key) => scenario.knobs[key] === undefined) && Object.keys(scenario.retirements).length === 0
}

/** A straight copy into fetchProjection's params; unset knobs are absent (blank omits). */
export function toParams(scenario: ProjectionScenario): ProjectionParams {
  const k = scenario.knobs
  const params: ProjectionParams = {
    retirements: Object.keys(scenario.retirements)
      .map(Number)
      .sort((a, b) => a - b)
      .map((personId) => ({ personId, month: scenario.retirements[personId] })),
  }
  if (k.annual_return !== undefined) params.annualReturn = k.annual_return
  if (k.monthly_contribution !== undefined) params.monthlyContribution = k.monthly_contribution
  if (k.annual_spend !== undefined) params.annualSpend = k.annual_spend
  if (k.swr !== undefined) params.swr = k.swr
  if (k.years !== undefined) params.years = k.years
  if (k.volatility !== undefined) params.volatility = k.volatility
  if (k.inflation !== undefined) params.inflation = k.inflation
  if (k.contribution_growth !== undefined) params.contributionGrowth = k.contribution_growth
  return params
}

/** The echo as each knob's DERIVED value — the caption, the placeholder and the reset target. */
export function derivedOf(baseline: ProjectionOut | null): Record<ProjectionKnob, string | null> {
  return {
    annual_return: baseline?.annual_return ?? null,
    annual_spend: baseline?.annual_spend ?? null,
    contribution_growth: baseline?.contribution_growth ?? null,
    inflation: baseline?.inflation ?? null,
    monthly_contribution: baseline?.monthly_contribution ?? null,
    swr: baseline?.swr_pct ?? null,
    volatility: baseline?.volatility ?? null,
    years: baseline === null ? null : String(baseline.years),
  }
}

const SHORT: Record<ProjectionKnob, string> = {
  annual_return: 'Return',
  annual_spend: 'Spend',
  contribution_growth: 'Growth',
  inflation: 'Inflation',
  monthly_contribution: 'Contribution',
  swr: 'SWR',
  volatility: 'Volatility',
  years: 'Horizon',
}

export function labelForProjection(scenario: ProjectionScenario): string {
  const parts: string[] = []
  for (const key of KNOBS) {
    const value = scenario.knobs[key]
    if (value === undefined) continue
    const { kind } = SLIDER[key]
    parts.push(kind === 'percent' ? `${SHORT[key]} ${shiftPoint(value, 2)}%` : kind === 'money' ? `${SHORT[key]} ${formatCurrency(value)}` : `${SHORT[key]} ${value}y`)
  }
  for (const [personId, month] of Object.entries(scenario.retirements)) parts.push(`Retire #${personId} ${month}`)
  return parts.slice(0, 2).join(' · ')
}

export const COMPARE_ROWS: CompareRow[] = [
  { key: 'fi_target', label: 'FI target', kind: 'money' },
  { key: 'fi_ratio', label: 'FI ratio', kind: 'percent' },
  { key: 'fi_month', label: 'FI date', kind: 'month' },
  { key: 'coast_fi_month', label: 'Coast FI date', kind: 'month' },
  { key: 'fi_probability', label: 'FI probability', kind: 'percent' },
  { key: 'fi_month_p10', label: 'p10 date', kind: 'month' },
  { key: 'fi_month_p50', label: 'p50 date', kind: 'month' },
  { key: 'fi_month_p90', label: 'p90 date', kind: 'month' },
  { key: 'monthly_contribution', label: 'Monthly contribution', kind: 'money' },
]

const ROW_KEYS = new Set(COMPARE_ROWS.map((r) => r.key))

export function projectionValue(result: ProjectionOut, key: string): string | null {
  if (!ROW_KEYS.has(key)) return null
  return (result as unknown as Record<string, string | null | undefined>)[key] ?? null
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/projection/projectionScenario.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/projection/projectionScenario.ts src/components/projection/projectionScenario.test.ts
git commit -m "feat(projection): sandbox codec with the router's fences, params copy, derived map, compare rows"
```

---

### Task 2: Pins as reference series in `projectionOption`

**Files:**
- Create (CONDITIONAL — only if `ls src/charts/reference.ts` fails): `src/charts/reference.ts`, `src/charts/reference.test.ts`
- Modify: `src/components/projection/projectionChartOptions.ts`, `src/components/projection/projectionChartOptions.test.ts`

- [ ] **Step 1 (conditional): the chart spec's helper.** Skip if chart-grammar C1 has merged `src/charts/reference.ts`; then read its `referenceLine` signature and use it in Step 3 as is.

```ts
// src/charts/reference.test.ts
import { describe, expect, it } from 'vitest'
import { MUTED } from './theme'
import { referenceLine } from './reference'

describe('referenceLine', () => {
  it('is a dashed MUTED 2 px line, no symbols, above the data, optionally stepped', () => {
    const line = referenceLine('FI target', [1, 2, null])
    expect(line).toMatchObject({ name: 'FI target', type: 'line', symbol: 'none', z: 9, color: MUTED, lineStyle: { width: 2, type: 'dashed', color: MUTED }, data: [1, 2, null] })
    expect('step' in line).toBe(false)
    expect(referenceLine('Budget', [1], { step: 'end' }).step).toBe('end')
  })
})
```

```ts
// src/charts/reference.ts
// Reference series (2026-09-03 chart-grammar spec §10): "a comparison with its own data" — the
// 4 % rule, budgets, the FI target, averages, a pinned scenario. Dashed MUTED 2 px, no
// symbols, drawn above the data (z 9); `step: 'end'` for budgets that hold until a change.
// Data is solid; thresholds and events are dashed; nothing else is. (Minimal form written by
// the projection sandbox lane; the chart-grammar primitives lane's copy supersedes it.)
import { MUTED } from './theme'

export interface ReferenceLineOptions {
  step?: 'end'
}

export function referenceLine(name: string, data: (number | null)[], options: ReferenceLineOptions = {}) {
  return {
    name,
    type: 'line' as const,
    symbol: 'none' as const,
    color: MUTED,
    lineStyle: { width: 2, type: 'dashed' as const, color: MUTED },
    z: 9,
    ...(options.step === undefined ? {} : { step: options.step }),
    data,
  }
}
```

Run: `npx vitest run src/charts/reference.test.ts` → PASS.

- [ ] **Step 2: Write the failing builder test** — append to `projectionChartOptions.test.ts` (reuse the file's existing projection fixture variable; below it is called `data` — use the file's name):

```ts
describe('projectionOption references (pinned scenarios)', () => {
  it('adds one dashed, end-labelled series per reference after the data series, widening the right inset', () => {
    const option = projectionOption(data, {
      references: [
        { name: 'Sell 40 VTI', data: data.projected.map((v) => String(Number(v) * 1.1)) },
        { name: 'Retire 2035', data: data.projected },
      ],
    })!
    const series = option.series as { name: string; lineStyle?: { type?: string }; endLabel?: { formatter?: string }; z?: number }[]
    const names = series.map((s) => s.name)
    expect(names.slice(-2)).toEqual(['Sell 40 VTI', 'Retire 2035'])
    const pin = series.at(-2)!
    expect(pin.lineStyle?.type).toBe('dashed')
    expect(pin.endLabel?.formatter).toBe('Sell 40 VTI')
    expect(pin.z).toBe(9)
    expect((option.grid as { right: number }).right).toBe(84)
    expect((option.legend as { data: string[] }).data).toContain('Sell 40 VTI')
  })

  it('is byte-identical to the plain option without references', () => {
    expect(projectionOption(data, {})).toEqual(projectionOption(data))
  })
})
```

Run: `npx vitest run src/components/projection/projectionChartOptions.test.ts` → FAIL (`projectionOption` takes one argument; no reference series).

- [ ] **Step 3: Implement** — in `projectionChartOptions.ts` add `import { referenceLine } from '../../charts/reference'` and change the signature and body:

```ts
/** A pinned scenario's deterministic line, drawn as a reference series (chart grammar §10):
 *  dashed MUTED, end-labelled with the pin's name. The fan stays the live scenario's. */
export interface ProjectionReference {
  name: string
  data: string[]
}

export interface ProjectionExtras {
  references?: ProjectionReference[]
}

export function projectionOption(
  data: Pick<ProjectionOut, 'months' | 'projected' | 'coast' | 'fi_target' | 'bands'> &
    Partial<Pick<ProjectionOut, 'retirements'>>,
  extras: ProjectionExtras = {},
): EChartsOption | null {
  if (data.months.length < 2) return null
  const target = data.fi_target === null ? null : Number(data.fi_target)
  const bands = data.bands ?? null
  const retirementMark = retirementMarkLine(data.months, data.retirements ?? [])
  const references = (extras.references ?? []).map((ref) => ({
    ...referenceLine(ref.name, ref.data.map(Number)),
    endLabel: { show: true, formatter: ref.name, color: MUTED, fontSize: 11 },
  }))
  // …bandSeries unchanged…
  return {
    dataZoom: timeZoom(data.months, 'all'),
    // The endLabel variant (chart grammar §8): room for the pin names past the last month.
    grid: { left: 76, right: references.length > 0 ? 84 : 24, top: 40, bottom: 28 },
    legend: {
      top: 0,
      data: [
        PROJECTION_SERIES[0],
        PROJECTION_SERIES[1],
        ...(target === null ? [] : [PROJECTION_SERIES[2]]),
        ...(bands === null ? [] : [...BAND_SERIES]),
        ...references.map((ref) => ref.name),
      ],
    },
    // …tooltip, xAxis, yAxis unchanged…
    series: [
      ...bandSeries,
      // …the three existing series unchanged…
      ...references,
    ],
  }
}
```

(Only the lines shown change; everything marked unchanged stays byte for byte — the existing tests are the pin.)

- [ ] **Step 4: Run**

Run: `npx vitest run src/components/projection/projectionChartOptions.test.ts src/charts`
Expected: PASS — the two new tests and every existing pin.

- [ ] **Step 5: Commit**

```bash
git add src/components/projection/projectionChartOptions.ts src/components/projection/projectionChartOptions.test.ts
git add src/charts/reference.ts src/charts/reference.test.ts 2>/dev/null || true
git commit -m "feat(projection): pinned scenarios join the investable chart as end-labelled reference series"
```

---

### Task 3: `ScenarioPanel`

**Files:**
- Create: `src/components/projection/ScenarioPanel.tsx`
- Test: `src/components/projection/ScenarioPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/projection/ScenarioPanel.test.tsx
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSandbox, type SandboxSpec } from '../../sandbox/useSandbox'
import type { PersonOut, ProjectionOut } from '../../types/api'
import { decodeProjection, encodeProjection, isEmptyProjection, labelForProjection, type ProjectionScenario } from './projectionScenario'
import ScenarioPanel from './ScenarioPanel'

const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() }
vi.mock('../ToastProvider', () => ({ useToast: () => toast }))

const echo: ProjectionOut = {
  starting_balance: '100000.00', base_month: '2026-09-01', start_month: '2026-09-01', annual_return: '0.05',
  monthly_contribution: '4000.00', annual_spend: '60000.00', swr_pct: '0.04', years: 30, fi_target: '1500000.00',
  fi_ratio: '0.066667', fi_month: '2041-03-01', coast_fi_month: null, months: ['2026-09-01', '2026-10-01'],
  projected: ['100000.00', '104400.00'], coast: ['100000.00', '100400.00'], warnings: [], volatility: '0.15',
  inflation: '0.03', contribution_growth: '0.03', bands: null, fi_probability: '0.62', fi_month_p10: '2038-01-01',
  fi_month_p50: '2041-06-01', fi_month_p90: null, retirements: [],
}
const people: PersonOut[] = [{ id: 1, name: 'Edward', is_primary: true }, { id: 2, name: 'Grace', is_primary: false }]
const preview = vi.fn<(s: ProjectionScenario) => Promise<ProjectionOut>>()

function Host() {
  const spec: SandboxSpec<ProjectionScenario, ProjectionOut> = {
    page: 'projection', decode: decodeProjection, encode: encodeProjection, isEmpty: isEmptyProjection,
    preview, dataKey: 'projection', debounceMs: 300, labelFor: labelForProjection,
  }
  const sandbox = useSandbox(spec)
  const location = useLocation()
  return (
    <>
      <ScenarioPanel sandbox={sandbox} baseline={sandbox.baseline} people={people} />
      <span data-testid="url">{location.pathname + location.search}</span>
    </>
  )
}

function mount(entry = '/projection') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Host />
    </MemoryRouter>,
  )
}
const url = () => screen.getByTestId('url').textContent

beforeEach(() => {
  localStorage.clear()
  preview.mockReset()
  preview.mockImplementation(async (s) => ({ ...echo, annual_return: s.knobs.annual_return ?? echo.annual_return, fi_month: s.knobs.annual_return ? '2039-01-01' : echo.fi_month }))
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ScenarioPanel', () => {
  it('opens by default with every knob derived: badge, placeholder and caption from the echo; no Apply', async () => {
    mount()
    expect(screen.getByRole('button', { name: 'Hide knobs' }).getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => expect(preview).toHaveBeenCalledWith({ knobs: {}, retirements: {} }))
    await waitFor(() => expect(screen.getAllByText('derived')).toHaveLength(8))
    expect((screen.getByLabelText('Annual return') as HTMLInputElement).placeholder).toBe('5')
    expect(screen.getByRole('button', { name: 'actual 5%' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Reset to derived' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText(/^Apply/)).toBeNull()
  })

  it('a typed knob writes the URL as a fraction, shows its delta chip and is fetched', async () => {
    mount()
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1))
    const box = screen.getByLabelText('Annual return') as HTMLInputElement
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: '6' } })
    fireEvent.blur(box)
    expect(url()).toBe('/projection?whatif=annual_return%3A0.06')
    await waitFor(() => expect(preview).toHaveBeenLastCalledWith({ knobs: { annual_return: '0.06' }, retirements: {} }))
    expect(screen.getByText('+1.0 pp')).toBeTruthy()
    expect(screen.getAllByText('derived')).toHaveLength(7)
  })

  it('a retirement month is an immediate retire entry; blank removes it', async () => {
    mount()
    const grace = screen.getByLabelText('Retires — Grace') as HTMLInputElement
    fireEvent.change(grace, { target: { value: '2035-06' } })
    expect(url()).toBe('/projection?whatif=retire%3A2%3A2035-06')
    await waitFor(() => expect(preview).toHaveBeenLastCalledWith({ knobs: {}, retirements: { 2: '2035-06' } }))
    fireEvent.change(grace, { target: { value: '' } })
    expect(url()).toBe('/projection')
  })

  it('refuses a garbled month in the box’s words', () => {
    mount()
    fireEvent.change(screen.getByLabelText('Retires — Grace'), { target: { value: 'soon' } })
    expect(screen.getByRole('alert').textContent).toBe("Grace's retirement month must look like YYYY-MM")
    expect(url()).toBe('/projection')
  })

  it('compares baseline and scenario without a Δ column, and pins as columns', async () => {
    mount('/projection?whatif=annual_return%3A0.06')
    const row = (await screen.findByText('FI date')).closest('tr') as HTMLElement
    await waitFor(() => expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['FI date', 'Mar 2041', 'Jan 2039']))
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['', 'Baseline', 'Scenario'])
    fireEvent.click(screen.getByRole('button', { name: 'Pin this scenario' }))
    await waitFor(() => expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain('Return 6%Unpin'))
  })

  it('Reset to derived empties the URL', async () => {
    mount('/projection?whatif=years%3A40&whatif=retire%3A2%3A2035-06')
    await waitFor(() => expect(preview).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Reset to derived' }))
    expect(url()).toBe('/projection')
  })

  it('states that the seed is fixed and points the withdrawal rate at Settings', () => {
    mount()
    expect(screen.getByText(/seed-stable/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/projection/ScenarioPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// src/components/projection/ScenarioPanel.tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import CompareTable from '../../sandbox/CompareTable'
import SandboxPanel from '../../sandbox/SandboxPanel'
import { MONTH_TOKEN } from '../../sandbox/scenarioUrl'
import SliderBox from '../../sandbox/SliderBox'
import type { Sandbox } from '../../sandbox/useSandbox'
import type { PersonOut, ProjectionOut } from '../../types/api'
import { FeedBanner } from '../shell/Feed'
import {
  COMPARE_ROWS,
  KNOBS,
  SLIDER,
  derivedOf,
  projectionValue,
  type ProjectionKnob,
  type ProjectionScenario,
} from './projectionScenario'

// The knobs card (2026-09-03 planning-sandboxes spec §11): open by default — on this page the
// knobs ARE the page. Blank means derived: an unset knob sits on the echo's value, wears the
// "derived" badge and shows the echo as its caption; a typed one shows its delta against the
// echo. Reset to derived is the sandbox's reset. No Apply: nothing here is stored — the
// withdrawal rate lives in Settings.
const LABELS: Record<ProjectionKnob, string> = {
  annual_return: 'Annual return',
  annual_spend: 'Annual spend',
  contribution_growth: 'Contribution growth',
  inflation: 'Inflation',
  monthly_contribution: 'Monthly contribution',
  swr: 'Withdrawal rate',
  volatility: 'Volatility',
  years: 'Horizon (years)',
}

const HINTS: Partial<Record<ProjectionKnob, string>> = {
  monthly_contribution:
    'Derived from the trailing 12 months of (net pay − spend) plus every earner\'s payroll deductions — 401(k), ESPP and HSA. RSU vests are not included; raise it to model them.',
  annual_spend: 'Derived from the trailing 12-month spend × 12.',
  swr: 'Derived from Settings. The FI target is annual spend ÷ this rate.',
  volatility: 'Turns the fan on; 0 turns it off.',
  inflation: 'Converts the chart to today\'s dollars; 0 reads nominal dollars.',
  contribution_growth: 'Models raises: the contribution escalates at this rate.',
}

// Render order: the five derived-from-data knobs, then the three assumptions.
const ORDER: ProjectionKnob[] = ['annual_return', 'monthly_contribution', 'annual_spend', 'swr', 'years', 'volatility', 'inflation', 'contribution_growth']

export default function ScenarioPanel({
  sandbox,
  baseline,
  people,
}: {
  sandbox: Sandbox<ProjectionScenario, ProjectionOut>
  /** The empty run — every knob's derived value. */
  baseline: ProjectionOut | null
  people: PersonOut[]
}) {
  const [open, setOpen] = useState(true)
  const [monthError, setMonthError] = useState<string | null>(null)
  const derived = derivedOf(baseline)
  const { scenario } = sandbox

  const knob = (key: ProjectionKnob) => (next: string, commit: boolean) =>
    sandbox.set(
      (current) => {
        const knobs = { ...current.knobs }
        if (next === '') delete knobs[key]
        else knobs[key] = next
        return { ...current, knobs }
      },
      { immediate: commit },
    )

  const setRetire = (person: PersonOut, month: string) => {
    const text = month.trim()
    if (text !== '' && !MONTH_TOKEN.test(text)) {
      setMonthError(`${person.name}'s retirement month must look like YYYY-MM`)
      return
    }
    setMonthError(null)
    sandbox.set(
      (current) => {
        const retirements = { ...current.retirements }
        if (text === '') delete retirements[person.id]
        else retirements[person.id] = text
        return { ...current, retirements }
      },
      { immediate: true },
    )
  }

  return (
    <SandboxPanel
      eyebrow="Scenario"
      hint="Every knob the projection runs on. Blank knobs are derived from your data (or their planning defaults) and re-derive on their own — nothing is saved."
      open={open}
      onToggle={() => setOpen((o) => !o)}
      toggleLabels={{ open: 'Show knobs', close: 'Hide knobs' }}
      sandbox={sandbox}
      resetLabel="Reset to derived"
      staleNoun="this projection"
      skeletonHeight={220}
      compare={
        <CompareTable<ProjectionOut>
          rows={COMPARE_ROWS}
          baseline={baseline}
          scenario={sandbox.result}
          valueOf={projectionValue}
          pins={sandbox.pins.map((pin) => ({ id: pin.id, label: pin.label, result: sandbox.pinResults[pin.id] }))}
          onUnpin={sandbox.unpin}
          caption="Headline figures — baseline (derived) against the live scenario and any pins"
        />
      }
    >
      {ORDER.map((key) => (
        <SliderBox
          key={key}
          id={`scenario-${key}`}
          label={LABELS[key]}
          hint={HINTS[key]}
          kind={SLIDER[key].kind}
          value={scenario.knobs[key] ?? ''}
          actual={derived[key]}
          min={SLIDER[key].min}
          max={SLIDER[key].max}
          step={SLIDER[key].step}
          onChange={knob(key)}
        />
      ))}
      {people.map((person) => (
        <div key={person.id} className="slider-box">
          <div className="slider-box-head">
            <label htmlFor={`scenario-retire-${person.id}`}>Retires — {person.name}</label>
            {scenario.retirements[person.id] === undefined && <span className="sandbox-badge">works throughout</span>}
          </div>
          <input
            id={`scenario-retire-${person.id}`}
            type="month"
            className="field-input"
            value={scenario.retirements[person.id] ?? ''}
            onChange={(e) => setRetire(person, e.target.value)}
          />
        </div>
      ))}
      <FeedBanner error={monthError} />
      <p className="drill-hint">
        Percents are percents (5 = 5%). A retirement month drops that person&apos;s CURRENT monthly
        take-home and payroll deductions — the paycheck profile in force today — out of the
        contribution stream from that month on; blank means they work for the whole horizon. The
        Monte Carlo seed is fixed, so scenarios are seed-stable: identical knobs redraw identical
        bands, and two scenarios differ only by their knobs, never by sampling noise. The withdrawal
        rate&apos;s stored value lives in <Link to="/settings">Settings</Link>.
      </p>
    </SandboxPanel>
  )
}
```

(`KNOBS` is imported for the type-level completeness check `ORDER.length === KNOBS.length` — add `if (ORDER.length !== KNOBS.length) throw new Error('ScenarioPanel: ORDER must list every knob')` at module scope so a knob added to the codec cannot silently vanish from the card.)

- [ ] **Step 4: Run the tests and the conformance walk**

Run: `npx vitest run src/components/projection/ScenarioPanel.test.tsx src/sandbox/sandboxConformance.test.ts`
Expected: PASS (7 + the walk covering `ScenarioPanel.tsx`).

- [ ] **Step 5: Commit**

```bash
git add src/components/projection/ScenarioPanel.tsx src/components/projection/ScenarioPanel.test.tsx
git commit -m "feat(projection): ScenarioPanel — derived-badged sliders, retire months, compare with pins, Reset to derived"
```

---

### Task 4: `ProjectionPage` on `useSandbox`

**Files:**
- Modify: `src/pages/ProjectionPage.tsx`, `src/pages/ProjectionPage.test.tsx`

- [ ] **Step 1: Re-point the page tests.** In `src/pages/ProjectionPage.test.tsx` (the mocks — `../api/projection` with `fetchProjection`, `../components/EChart` marker with `data-series`, `../api/netWorth`, `../api/household` — stay), add `const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() }; vi.mock('../components/ToastProvider', () => ({ useToast: () => toast }))`, and `localStorage.clear()` in `beforeEach`. Then, test by test:

  - `'seeds the knobs from the echo, percent-shifted into the boxes vocabulary'` → rename `'shows the echo as each knob’s derived caption and placeholder'`:
    ```tsx
    renderPage()
    await screen.findByText('FI target')
    expect((screen.getByLabelText('Annual return') as HTMLInputElement).placeholder).toBe('5')
    expect((screen.getByLabelText('Monthly contribution') as HTMLInputElement).placeholder).toBe('4000.00')
    expect(screen.getByRole('button', { name: 'actual 5%' })).toBeTruthy()
    expect(screen.getAllByText('derived')).toHaveLength(8)
    ```
  - `'recalculates with fraction-shifted knobs and hands blanks through as omissions'` → `'writes a typed knob to the URL as a fraction and fetches it; blank knobs stay omitted'`:
    ```tsx
    renderPage()
    await screen.findByText('FI target')
    const box = screen.getByLabelText('Annual return') as HTMLInputElement
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: '6' } })
    fireEvent.blur(box)
    await waitFor(() => expect(vi.mocked(fetchProjection)).toHaveBeenLastCalledWith({ annualReturn: '0.06', retirements: [] }))
    expect(screen.getByTestId('location').textContent).toBe('/projection?whatif=annual_return%3A0.06')
    ```
    (Add a `location` probe to `renderPage` the way the shell plans do: a `<span data-testid="location">` rendering `useLocation().pathname + search` inside the `MemoryRouter`.)
  - `'refuses an out-of-range withdrawal rate in the box vocabulary, spending no request'` → the new sentence comes from `SliderBox`'s fence over `SLIDER.swr` (`0.1%`…`10%`):
    ```tsx
    const box = screen.getByLabelText('Withdrawal rate') as HTMLInputElement
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: '150' } })
    fireEvent.blur(box)
    expect(screen.getByRole('alert').textContent).toBe('Withdrawal rate must be between 0.1% and 10%')
    expect(vi.mocked(fetchProjection)).toHaveBeenCalledTimes(1)
    ```
  - `'does not refetch the history on Recalculate'` → same body with the Annual return box typed as above; assert `fetchTimeseries` called once.
  - `'keeps the trend span fixed while the Horizon knob reshapes the chart below'` → type `10` into `Horizon (years)` and blur, then the file's existing span assertions.
  - `'seeds the three assumption boxes from the echo like every other knob'` → placeholders `15`, `3`, `3` on `Volatility`, `Inflation`, `Contribution growth`.
  - `'leaves the assumption boxes blank when a stale backend echoes null'` → `expect(screen.getAllByText('not set')).toHaveLength(3)` and empty placeholders on those three boxes.
  - `'says in both hints that the defaults are what blank runs'` → assert the ScenarioPanel hint text (`getByLabelText(/Blank knobs are derived from your data/)` — the InfoHint button's aria-label is the hint) and the investable chart's drill-hint as before.
  - `'recalculates with the Monte Carlo knobs shifted back to fractions'` → type `20` into `Volatility`, blur → `fetchProjection` last called with `expect.objectContaining({ volatility: '0.2' })`.
  - `'sends a typed zero volatility — the fan’s off switch, not a refusal'` → type `0`, blur → `expect.objectContaining({ volatility: '0' })` and the URL contains `whatif=volatility%3A0`.
  - Add: `'pins the live scenario and draws it as a series on the investable chart'`:
    ```tsx
    renderPage('/projection?whatif=annual_return%3A0.06')
    await screen.findByText('FI target')
    fireEvent.click(screen.getByRole('button', { name: 'Pin this scenario' }))
    const chart = await screen.findByLabelText(/Projected investable balance over the next/)
    await waitFor(() => expect(seriesOf(chart)).toContain('Return 6%'))
    ```
  - Add: `'the frame’s Retry re-runs the scenario after a failure'`:
    ```tsx
    vi.mocked(fetchProjection).mockRejectedValueOnce(new ApiError('boom', 500))
    renderPage()
    await screen.findByRole('alert')
    vi.mocked(fetchProjection).mockResolvedValue(projectionOut())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('FI target')
    ```
  - `'answers a fresh database with the wizard, not an error'` and `'renders the model warnings verbatim'` and the FI-tile tests: unchanged.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/pages/ProjectionPage.test.tsx`
Expected: the re-pointed tests FAIL (no sliders, no URL state).

- [ ] **Step 3: Rewrite the page.** Keep `message`, `TREND_SPANS`/`TrendSpan`, the history and household effects, the tiles, the two chart cards and the missing-state card; replace `Knobs`/`EMPTY_KNOBS`/the fence constants/`RETIRE_MONTH_RE`/`knobsFromEcho`/`load`/`recalculate`/the Assumptions `<form>` with the sandbox. The component:

```tsx
export default function ProjectionPage() {
  // The default run the last visit cached — the sandbox's initial baseline (and result, when
  // the URL carries no scenario), so the first paint is instant and revalidated underneath.
  const [cachedProjection] = useState(() => getSnapshot<ProjectionOut>('projection:default'))
  // The frame's Retry: a new dataKey re-runs the live scenario, the baseline and every pin.
  const [retryNonce, setRetryNonce] = useState(0)
  const spec = useMemo<SandboxSpec<ProjectionScenario, ProjectionOut>>(
    () => ({
      page: 'projection',
      decode: decodeProjection,
      encode: encodeProjection,
      isEmpty: isEmptyProjection,
      preview: (scenario) => fetchProjection(toParams(scenario)),
      dataKey: `projection:${retryNonce}`,
      debounceMs: 300,
      initialBaseline: cachedProjection ?? null,
      // The empty run IS the page's default payload — the one knob-free projection the
      // snapshot cache may hold (knob-parameterized runs never enter it).
      onBaseline: (baseline) => setSnapshot('projection:default', baseline),
      labelFor: labelForProjection,
    }),
    [retryNonce, cachedProjection],
  )
  const sandbox = useSandbox(spec)
  // What the tiles and charts draw: the live scenario, or the derived run while it is empty.
  const data = sandbox.result ?? sandbox.baseline
  // Still the cached object → a cached paint; the first live payload is a new object.
  const fromCache = data !== null && data === cachedProjection
  // A 404 is "nothing to project from yet" (no snapshots): the wizard, not a Retry.
  const missing = sandbox.result === null && sandbox.errorStatus === 404

  const [history, setHistory] = useState<NetWorthTimeseries | null>(
    () => getSnapshot<NetWorthTimeseries>('projection:history') ?? null,
  )
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [trendYears, setTrendYears] = useState<TrendSpan>(10)
  const [household, setHousehold] = useState<HouseholdOut | null>(null)

  useEffect(() => {
    // …the history effect, unchanged…
  }, [])

  useEffect(() => {
    // …the household effect, unchanged…
  }, [])

  const people = household?.people ?? []
  // Pinned scenarios that have answered join the chart as reference series (spec §11).
  const references = sandbox.pins.flatMap((pin) => {
    const result = sandbox.pinResults[pin.id]
    return result === 'pending' || 'error' in result ? [] : [{ name: pin.label, data: result.projected }]
  })
  const chart = data === null ? null : projectionOption(data, { references })
  const fit = history === null ? null : fitPolyTrend(history.months, history.net_worth)
  const nwChart =
    history === null || data === null ? null : netWorthProjectionOption(history, fit, data.start_month, trendYears)

  return (
    <div className="page projection-page">
      <PageFrame
        title="Projection"
        resource={{
          status: missing ? 'ready' : data === null ? (sandbox.error !== null ? 'error' : 'loading') : 'ready',
          error: missing ? null : sandbox.error,
          busy: sandbox.busy,
          fromCache,
          retry: () => setRetryNonce((n) => n + 1),
        }}
        skeleton={{ tiles: 5, cards: [{ span: 12, height: 340 }] }}
      >
        {missing ? (
          <section className="card">
            <h2 className="eyebrow">Projected investable balance</h2>
            <p className="empty-note">
              {sandbox.error} — <Link to="/update">enter a monthly update</Link> to start one.
            </p>
          </section>
        ) : (
          data !== null && (
            <>
              {/* …the kpi-row of five StatTiles, unchanged, reading `data`… */}
              {/* …the warnings block, unchanged… */}
              {/* …the trend chart card, unchanged (animateEntrance={!fromCache})… */}
              <section className="card projection-chart-card">
                <h2 className="eyebrow">
                  Projected investable balance
                  <InfoHint text="Deterministic compounding at your assumptions; the bands hold the middle 50% and 80% of simulated outcomes. Dashed lines are pinned scenarios." />
                </h2>
                {chart ? (
                  <>
                    <EChart
                      option={chart}
                      height={340}
                      ariaLabel={`Projected investable balance over the next ${data.years} years`}
                      exportConfig={{ name: 'projection', csv: () => projectionCsv(data) }}
                      animateEntrance={!fromCache}
                    />
                    <ChartZoomHint />
                  </>
                ) : (
                  <p className="empty-note">Nothing to chart at this horizon.</p>
                )}
                <p className="drill-hint">
                  {/* …the existing sentence, unchanged… */}
                </p>
              </section>
              <ScenarioPanel sandbox={sandbox} baseline={sandbox.baseline} people={people} />
            </>
          )
        )}
      </PageFrame>
    </div>
  )
}
```

Imports: drop `useRef`, `AmountInput`-free already, `isPlainDecimal`/`shiftPoint`; add `useMemo`, `useSandbox`/`SandboxSpec` from `'../sandbox/useSandbox'`, `ScenarioPanel`, and `decodeProjection, encodeProjection, isEmptyProjection, labelForProjection, toParams, type ProjectionScenario` from `'../components/projection/projectionScenario'`. `ProjectionParams` is no longer imported. The Assumptions `<section>` (its `<form>`, the eight `<input>`s, the retire inputs, the `formError` banner and the Recalculate button) is replaced by `<ScenarioPanel …/>`; its long derivation paragraph now lives in `ScenarioPanel`'s hints and footer.

- [ ] **Step 4: Run**

Run: `npx tsc -b && npx vitest run src/pages/ProjectionPage.test.tsx src/components/projection`
Expected: PASS. If the "cached paint" test in the file (if any) asserts `data-animate="false"` on the first render, `fromCache` must be true while `data === cachedProjection` — check the snapshot is seeded BEFORE `renderPage` and that `initialBaseline` reaches the hook.

- [ ] **Step 5: Lint and commit**

Run: `npx eslint src/pages/ProjectionPage.tsx src/components/projection`

```bash
git add src/pages/ProjectionPage.tsx src/pages/ProjectionPage.test.tsx
git commit -m "feat(projection): knobs live in the URL through useSandbox; ScenarioPanel replaces Recalculate; pins draw as reference series"
```

---

### Task 5: Type-check, lint, suites

- [ ] **Step 1: Run**

`npx tsc -b && npx eslint src/components/projection src/pages/ProjectionPage.tsx src/charts && npx vitest run src/components/projection src/pages/ProjectionPage.test.tsx src/charts src/sandbox`
Expected: clean, green.

- [ ] **Step 2: Report** — say whether `src/charts/reference.ts` was created here (so the merge takes C1's copy if both exist), and list the retired CSS rules (`.projection-form`, `.projection-actions` in `ProjectionPage.css`) for the verify plan.

---

## Self-review

**Spec coverage:** §11 eight knobs + retirement months in `ScenarioPanel` driven by `useSandbox` over `fetchProjection`, 300 ms, blank = derived (absent from the URL, the echo seeds placeholder + caption, "derived" badge, Reset to derived = `reset()`), typed knob shows its delta chip → Tasks 1, 3, 4; URL `whatif=annual_return:0.06`, `monthly_contribution:5400`, `retire:2:2035-06` with the query's own keys → Task 1; pins as `referenceLine()` reference series end-labelled with the pin's name, the fan staying the live scenario's, compare rows FI target · ratio · FI date · coast date · probability · p10/p50/p90 · monthly contribution → Tasks 2–4; `MC_SEED` fixed sentence → Task 3; no Apply, Settings link → Task 3; §7 "Projection reuses its projection:default snapshot" → `initialBaseline`/`onBaseline` in Task 4; §14 `ScenarioPanel` tests (derived badges, URL from knobs, one reference series per pin) → Tasks 3–4. `axisTooltip` `references` listing is the chart lane C5's when it migrates this builder (noted in the header). **Placeholders:** none — the two "unchanged" markers in Task 4 refer to code already on disk, named by section. **Type consistency:** `ScenarioPanel({ sandbox, baseline, people })`; `Sandbox<ProjectionScenario, ProjectionOut>`; `projectionOption(data, { references: { name, data: string[] }[] })`; `referenceLine(name, data, { step? })`; `SLIDER[key].{min,max,step,kind}` feeds `SliderBox`; `derivedOf` returns every `ProjectionKnob`; `toParams` → `ProjectionParams` (existing).
