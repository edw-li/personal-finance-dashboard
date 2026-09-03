# Sandbox lane P — Paycheck "Try it" (`TryItPanel`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Paycheck page the sandbox of `docs/superpowers/specs/2026-09-03-planning-sandboxes-design.md` §9: a closed-by-default "Try it" card under the waterfall whose knobs (the five percentages, HSA per check + coverage, salary and periods) live in the URL as `whatif=<knob>:<wire value>`, previewed live through `POST /paycheck/preview`, compared per check / monthly / annually with server deltas, with the pace strip re-rendered from `pace.scenario`, four presets sized from the pace rows' limits, up to three pins, and an Apply that pre-fills the existing profile form dated the first of next month — the form's own Add profile remains the only write.

**Architecture:** `paycheckScenario.ts` is the page's codec and preset logic (pure, tested alone): `decodePaycheck`/`encodePaycheck` over lane G's `parseKnob`/`formatEntry` with alphabetical canonical order, `toOverrides` (a straight copy into `PaycheckPreviewOverrides`), `labelForPaycheck`, and `paycheckPresets` using `divideDecimals` so no float ever reaches a wire string. `TryItPanel` composes lane G's `useSandbox` (spec: `baselineOf: (r) => r`, `dataKey` = the selectors + the shown profile id, `enabled: open`), `SandboxPanel`, `SliderBox`, `PresetRow`, `CompareTable` under a `Segmented` unit toggle, and `PacePanel` over `result.pace.scenario`. The page mounts the panel inside its breakdown `Feed` and owns Apply: it remounts `ProfilesPanel` with an `initialForm` seed (a keyed remount, so no setState-in-effect), scrolls the date box into view and focuses it.

**Tech Stack:** React 19, react-router 7, TypeScript, vitest + Testing Library; lane G's `src/sandbox/*`; lane B's `previewPaycheck()` and `PaycheckPreviewOut`.

**Worktree / commands:** Branch `sandbox-paycheck`, worktree `.worktrees/sandbox-paycheck`, `cmd /c mklink /J node_modules ..\..\node_modules` from the worktree root. `npx vitest run <file>`, `npx tsc -b`, `npx eslint src/components/paycheck src/pages/PaycheckPage.tsx`. No backend tests in this lane (any it needed would run on `FINANCE_TEST_DB=finance_test_sandbox_p`).

**Prerequisites on main:** lane G (`src/sandbox/*`) and lane B (`previewPaycheck`, `PaycheckPreviewOut`) merged; shell Plan 3 Task 4 (Paycheck through `PageFrame` + `Feed`, person chips as the owner scope) merged — the page shape below is that plan's result. Verify before starting: `ls src/sandbox/useSandbox.ts src/api/paycheck.ts && grep -n "previewPaycheck\|<Feed" src/api/paycheck.ts src/pages/PaycheckPage.tsx`.

**Shared-file hotspots:** `src/pages/PaycheckPage.tsx` and `src/pages/PaycheckPage.test.tsx` (this lane only — lanes T and J do not touch them); `src/pages/PaycheckPage.test.tsx`'s `vi.mock('../api/paycheck', …)` factory gains `previewPaycheck: vi.fn()` (Task 4). `src/components/paycheck/` gains two modules and no other lane writes there. `src/sandbox/sandboxConformance.test.ts` (lane G) will start walking `TryItPanel.tsx` the moment it exists — it must import only `previewPaycheck` from `../../api/paycheck`, never `api` from the client, and spell no mutating `method:`.

**Overnight rule:** no file deletions.

---

## File structure

| File | Responsibility |
|---|---|
| `src/components/paycheck/paycheckScenario.ts` (new) | knobs, `decodePaycheck`/`encodePaycheck`/`isEmptyPaycheck`, `toOverrides`, `labelForPaycheck`, `paycheckPresets`, `applySeedFor` |
| `src/components/paycheck/paycheckScenario.test.ts` (new) | round trip, garbage dropped, last wins, overrides copy, labels, presets (values, disabled titles), apply seed |
| `src/components/paycheck/TryItPanel.tsx` (new) | the sandbox card: SandboxPanel + SliderBoxes + coverage toggle + salary/periods boxes + presets + unit toggle + CompareTable + PacePanel + Apply button |
| `src/components/paycheck/TryItPanel.test.tsx` (new) | closed/no request, arrival opens + runs, drag debounce/release, presets, unit toggle, Apply calls back and writes nothing, failure keeps last result |
| `src/pages/PaycheckPage.tsx` (modify) | mount `TryItPanel` under the flow card; `ProfilesPanel` `initialForm` seed + keyed remount; Apply handler |
| `src/pages/PaycheckPage.test.tsx` (modify) | `previewPaycheck` mock; Apply pre-fills the form and calls no writer |

---

### Task 1: `paycheckScenario.ts` — codec, presets, apply seed

**Files:**
- Create: `src/components/paycheck/paycheckScenario.ts`
- Test: `src/components/paycheck/paycheckScenario.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/paycheck/paycheckScenario.test.ts
import { describe, expect, it, vi } from 'vitest'
import type { PaycheckProfileOut } from '../../types/api'
import {
  applySeedFor,
  decodePaycheck,
  encodePaycheck,
  isEmptyPaycheck,
  labelForPaycheck,
  paycheckPresets,
  toOverrides,
} from './paycheckScenario'

const profile: PaycheckProfileOut = {
  id: 7,
  person_id: 1,
  effective_date: '2026-01-01',
  annual_salary: '100000.00',
  pay_periods_per_year: 24,
  trad_401k_pct: '0.130000000',
  roth_401k_pct: '0.000000000',
  after_tax_401k_pct: '0.030000000',
  espp_pct: '0.110000000',
  withholding_pct: '0.334009167',
  dental_vision_per_check: '12.50',
  hsa_per_check: '100.00',
  hsa_coverage: 'self',
  notes: null,
}

describe('paycheck scenario codec', () => {
  it('round-trips every knob in alphabetical (canonical) order', () => {
    const entries = ['trad_401k_pct:0.15', 'hsa_coverage:family', 'hsa_per_check:250', 'pay_periods_per_year:26', 'annual_salary:200000']
    const scenario = decodePaycheck(entries)
    expect(scenario).toEqual({
      trad_401k_pct: '0.15',
      hsa_coverage: 'family',
      hsa_per_check: '250',
      pay_periods_per_year: '26',
      annual_salary: '200000',
    })
    expect(encodePaycheck(scenario)).toEqual([
      'annual_salary:200000',
      'hsa_coverage:family',
      'hsa_per_check:250',
      'pay_periods_per_year:26',
      'trad_401k_pct:0.15',
    ])
    expect(decodePaycheck(encodePaycheck(scenario))).toEqual(scenario)
  })

  it('drops garbage and out-of-range values, keeps the last of a duplicate key', () => {
    expect(
      decodePaycheck(['NVDA', 'bonus_pct:0.1', 'trad_401k_pct:13', 'espp_pct:-0.1', 'hsa_coverage:spouse', 'pay_periods_per_year:0', 'annual_salary:0', 'trad_401k_pct:0.1', 'trad_401k_pct:0.2']),
    ).toEqual({ trad_401k_pct: '0.2' })
    expect(isEmptyPaycheck({})).toBe(true)
    expect(isEmptyPaycheck({ espp_pct: '0' })).toBe(false)
  })

  it('copies knobs straight into the preview body, periods as a number', () => {
    expect(toOverrides({ trad_401k_pct: '0.15', pay_periods_per_year: '26', hsa_coverage: 'family' })).toEqual({
      trad_401k_pct: '0.15',
      pay_periods_per_year: 26,
      hsa_coverage: 'family',
    })
    expect(toOverrides({})).toEqual({})
  })

  it('labels a pin by its first two changed knobs', () => {
    expect(labelForPaycheck({ trad_401k_pct: '0.15', hsa_per_check: '250', espp_pct: '0' })).toBe('ESPP 0% · HSA $250.00')
    expect(labelForPaycheck({ annual_salary: '200000' })).toBe('Salary $200,000.00')
    expect(labelForPaycheck({ hsa_coverage: 'family', pay_periods_per_year: '26' })).toBe('HSA family · 26 periods')
  })

  it('sizes presets from the limits by exact division, and disables the ones without a datum', () => {
    const apply = vi.fn()
    const limits: Record<string, string | null> = {
      limit_401k_elective: '24500.00',
      limit_hsa_self: '4300.00',
      limit_hsa_family: null,
      limit_espp_423: '25000.00',
    }
    const presets = paycheckPresets(
      { salary: '100000.00', periods: 24, coverage: 'self', esppPct: '0.110000000', limitFor: (key) => limits[key] ?? null },
      apply,
    )
    expect(presets.map((p) => [p.id, p.disabled ?? false])).toEqual([
      ['max401k', false],
      ['maxhsa', false],
      ['maxespp', false],
      ['stopespp', false],
    ])
    presets[0].apply()
    expect(apply).toHaveBeenLastCalledWith({ trad_401k_pct: '0.245' })
    presets[1].apply()
    expect(apply).toHaveBeenLastCalledWith({ hsa_per_check: '179.16' }) // 4300 / 24, floored to cents
    presets[2].apply()
    expect(apply).toHaveBeenLastCalledWith({ espp_pct: '0.15' }) // the lesser of 15 % and 25000 / 100000
    presets[3].apply()
    expect(apply).toHaveBeenLastCalledWith({ espp_pct: '0' })

    const family = paycheckPresets(
      { salary: '100000.00', periods: 24, coverage: 'family', esppPct: '0', limitFor: (key) => limits[key] ?? null },
      apply,
    )
    expect(family[1].disabled).toBe(true)
    expect(family[1].title).toBe("Enter this year's HSA limit in Settings › Limits")
    expect(family[3].disabled).toBe(true)
    expect(family[3].title).toBe('ESPP is already 0%')

    const none = paycheckPresets(
      { salary: '100000.00', periods: 24, coverage: 'none', esppPct: '0.1', limitFor: () => null },
      apply,
    )
    expect(none[0].title).toBe("Enter this year's 401(k) limit in Settings › Limits")
    expect(none[1].title).toBe('Choose Self or Family HSA coverage first')
    expect(none[2].title).toBe("Enter this year's ESPP §423 limit in Settings › Limits (the ESPP pace row appears once ESPP is above 0%)")
  })

  it('caps Max 401(k) at the server bound when the limit exceeds the salary', () => {
    const apply = vi.fn()
    paycheckPresets({ salary: '20000', periods: 24, coverage: 'self', esppPct: '0', limitFor: () => '24500' }, apply)[0].apply()
    expect(apply).toHaveBeenLastCalledWith({ trad_401k_pct: '1' })
  })

  it('builds the Apply seed: the profile with the scenario applied, percents shifted, dated next month', () => {
    const seed = applySeedFor(profile, { trad_401k_pct: '0.15', hsa_per_check: '250', hsa_coverage: 'family' }, '2026-09-01')
    expect(seed).toEqual({
      effective_date: '2026-10-01',
      annual_salary: '100000.00',
      pay_periods_per_year: '24',
      trad_401k_pct: '15',
      roth_401k_pct: '0',
      after_tax_401k_pct: '3',
      espp_pct: '11',
      withholding_pct: '33.4009167',
      dental_vision_per_check: '12.50',
      hsa_per_check: '250',
      hsa_coverage: 'family',
      notes: '',
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/paycheck/paycheckScenario.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// src/components/paycheck/paycheckScenario.ts
// The Paycheck sandbox's codec and presets (2026-09-03 planning-sandboxes spec §9). Pure —
// no React, no fetching. Values are the SERVER'S wire vocabulary throughout (fractions for
// the five pcts, money strings, the coverage tier as stored); the percent shift lives in
// SliderBox's box and in the Apply seed, which speaks the profile form's percent grammar.
import { compareDecimals, divideDecimals } from '../../sandbox/decimal'
import type { Preset } from '../../sandbox/PresetRow'
import { formatEntry, isWireDecimal, lastWins, parseEntry, parseKnob } from '../../sandbox/scenarioUrl'
import type { HsaCoverage, PaycheckPreviewOverrides, PaycheckProfileOut } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import { addMonths } from '../../utils/months'
import { shiftPoint } from '../../utils/percent'

export const PCT_KNOBS = [
  'trad_401k_pct',
  'roth_401k_pct',
  'after_tax_401k_pct',
  'espp_pct',
  'withholding_pct',
] as const
// Alphabetical: the canonical URL order, so an arriving link in this order is never rewritten.
export const KNOBS = [
  'after_tax_401k_pct',
  'annual_salary',
  'espp_pct',
  'hsa_coverage',
  'hsa_per_check',
  'pay_periods_per_year',
  'roth_401k_pct',
  'trad_401k_pct',
  'withholding_pct',
] as const
export type PaycheckKnob = (typeof KNOBS)[number]
export type PaycheckScenario = Partial<Record<PaycheckKnob, string>>

export const HSA_TIERS: readonly HsaCoverage[] = ['none', 'self', 'family']
// The paycheck router's own bounds (api/paycheck.py MIN_PAY_PERIODS / MAX_PAY_PERIODS).
const MIN_PAY_PERIODS = 1
const MAX_PAY_PERIODS = 366
// app/limit_keys.py — the keys the pace rows carry.
export const LIMIT_401K_ELECTIVE = 'limit_401k_elective'
export const LIMIT_ESPP_423 = 'limit_espp_423'
export const HSA_LIMIT_KEY: Record<Exclude<HsaCoverage, 'none'>, string> = {
  self: 'limit_hsa_self',
  family: 'limit_hsa_family',
}
// The §423 ceiling on the ESPP slider (spec §9): 15 % of salary.
export const ESPP_MAX_PCT = '0.15'

function accept(key: PaycheckKnob, value: string): boolean {
  if (key === 'hsa_coverage') return (HSA_TIERS as readonly string[]).includes(value)
  if (key === 'pay_periods_per_year') {
    return /^\d{1,3}$/.test(value) && Number(value) >= MIN_PAY_PERIODS && Number(value) <= MAX_PAY_PERIODS
  }
  if (!isWireDecimal(value)) return false
  if (key === 'annual_salary') return compareDecimals(value, '0') > 0
  if (key === 'hsa_per_check') return compareDecimals(value, '0') >= 0
  return compareDecimals(value, '0') >= 0 && compareDecimals(value, '1') <= 0 // the five pcts
}

export function decodePaycheck(entries: string[]): PaycheckScenario {
  const knobs = lastWins(
    entries
      .map(parseEntry)
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => parseKnob(entry, KNOBS, accept))
      .filter((knob): knob is NonNullable<typeof knob> => knob !== null),
    (knob) => knob.key,
  )
  const scenario: PaycheckScenario = {}
  for (const knob of knobs) scenario[knob.key] = knob.value
  return scenario
}

export function encodePaycheck(scenario: PaycheckScenario): string[] {
  return KNOBS.filter((key) => scenario[key] !== undefined).map((key) =>
    formatEntry(key, scenario[key] as string),
  )
}

export function isEmptyPaycheck(scenario: PaycheckScenario): boolean {
  return KNOBS.every((key) => scenario[key] === undefined)
}

/** decode → request body is a straight copy (spec §6); periods is the body's one integer. */
export function toOverrides(scenario: PaycheckScenario): PaycheckPreviewOverrides {
  const overrides: PaycheckPreviewOverrides = {}
  for (const key of KNOBS) {
    const value = scenario[key]
    if (value === undefined) continue
    if (key === 'pay_periods_per_year') overrides.pay_periods_per_year = Number(value)
    else if (key === 'hsa_coverage') overrides.hsa_coverage = value as HsaCoverage
    else overrides[key] = value
  }
  return overrides
}

const SHORT: Record<PaycheckKnob, string> = {
  trad_401k_pct: '401(k)',
  roth_401k_pct: 'Roth',
  after_tax_401k_pct: 'After-tax',
  espp_pct: 'ESPP',
  withholding_pct: 'Withholding',
  hsa_per_check: 'HSA',
  annual_salary: 'Salary',
  pay_periods_per_year: 'periods',
  hsa_coverage: 'HSA',
}

/** "401(k) 15% · HSA $250.00" — the first two changed knobs, in canonical order (spec §8.5). */
export function labelForPaycheck(scenario: PaycheckScenario): string {
  const parts: string[] = []
  for (const key of KNOBS) {
    const value = scenario[key]
    if (value === undefined) continue
    if ((PCT_KNOBS as readonly string[]).includes(key)) parts.push(`${SHORT[key]} ${shiftPoint(value, 2)}%`)
    else if (key === 'pay_periods_per_year') parts.push(`${value} periods`)
    else if (key === 'hsa_coverage') parts.push(`HSA ${value}`)
    else parts.push(`${SHORT[key]} ${formatCurrency(value)}`)
    if (parts.length === 2) break
  }
  return parts.join(' · ')
}

export interface PresetContext {
  /** The SCENARIO's salary and periods — presets are sized against what is being modelled. */
  salary: string
  periods: number
  coverage: HsaCoverage
  esppPct: string
  /** A limit from the pace rows already in the payload; null when nothing is entered. */
  limitFor: (key: string) => string | null
}

const LIMITS_HINT = 'in Settings › Limits'

/** Max 401(k) · Max HSA · Max ESPP · Stop ESPP (spec §9). Exact division, floored, so an
 *  annualized figure never exceeds the cap it was sized from; the server still validates. */
export function paycheckPresets(
  ctx: PresetContext,
  apply: (patch: PaycheckScenario) => void,
): Preset[] {
  const elective = ctx.limitFor(LIMIT_401K_ELECTIVE)
  const hsaLimit = ctx.coverage === 'none' ? null : ctx.limitFor(HSA_LIMIT_KEY[ctx.coverage])
  const espp = ctx.limitFor(LIMIT_ESPP_423)
  const fraction = (limit: string) => {
    const raw = divideDecimals(limit, ctx.salary, 9) ?? '0'
    return compareDecimals(raw, '1') > 0 ? '1' : raw // the server's [0, 1] bound
  }
  return [
    {
      id: 'max401k',
      label: 'Max 401(k)',
      disabled: elective === null,
      title: elective === null ? `Enter this year's 401(k) limit ${LIMITS_HINT}` : undefined,
      apply: () => {
        if (elective !== null) apply({ trad_401k_pct: fraction(elective) })
      },
    },
    {
      id: 'maxhsa',
      label: 'Max HSA',
      disabled: hsaLimit === null,
      title:
        ctx.coverage === 'none'
          ? 'Choose Self or Family HSA coverage first'
          : hsaLimit === null
            ? `Enter this year's HSA limit ${LIMITS_HINT}`
            : undefined,
      apply: () => {
        if (hsaLimit !== null) apply({ hsa_per_check: divideDecimals(hsaLimit, String(ctx.periods), 2) ?? '0' })
      },
    },
    {
      id: 'maxespp',
      label: 'Max ESPP',
      disabled: espp === null,
      title:
        espp === null
          ? `Enter this year's ESPP §423 limit ${LIMITS_HINT} (the ESPP pace row appears once ESPP is above 0%)`
          : undefined,
      apply: () => {
        if (espp === null) return
        const byLimit = fraction(espp)
        apply({ espp_pct: compareDecimals(byLimit, ESPP_MAX_PCT) < 0 ? byLimit : ESPP_MAX_PCT })
      },
    },
    {
      id: 'stopespp',
      label: 'Stop ESPP',
      disabled: compareDecimals(ctx.esppPct, '0') === 0,
      title: compareDecimals(ctx.esppPct, '0') === 0 ? 'ESPP is already 0%' : undefined,
      apply: () => apply({ espp_pct: '0' }),
    },
  ]
}

/** The profile form's seed for Apply (spec §9): the base profile with the scenario applied,
 *  in the FORM's grammar — percents as percents ("15", never "0.15"), the first of the month
 *  after `todayMonthIso` as the effective date, an empty note. Field names are the form's. */
export interface ApplySeed {
  effective_date: string
  annual_salary: string
  pay_periods_per_year: string
  trad_401k_pct: string
  roth_401k_pct: string
  after_tax_401k_pct: string
  espp_pct: string
  withholding_pct: string
  dental_vision_per_check: string
  hsa_per_check: string
  hsa_coverage: HsaCoverage
  notes: string
}

export function applySeedFor(
  profile: PaycheckProfileOut,
  scenario: PaycheckScenario,
  todayMonthIso: string,
): ApplySeed {
  const pct = (key: (typeof PCT_KNOBS)[number]) => shiftPoint(scenario[key] ?? profile[key], 2)
  return {
    effective_date: addMonths(todayMonthIso, 1),
    annual_salary: scenario.annual_salary ?? profile.annual_salary,
    pay_periods_per_year: scenario.pay_periods_per_year ?? String(profile.pay_periods_per_year),
    trad_401k_pct: pct('trad_401k_pct'),
    roth_401k_pct: pct('roth_401k_pct'),
    after_tax_401k_pct: pct('after_tax_401k_pct'),
    espp_pct: pct('espp_pct'),
    withholding_pct: pct('withholding_pct'),
    dental_vision_per_check: profile.dental_vision_per_check,
    hsa_per_check: scenario.hsa_per_check ?? profile.hsa_per_check,
    hsa_coverage: (scenario.hsa_coverage as HsaCoverage | undefined) ?? profile.hsa_coverage,
    notes: '',
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/paycheck/paycheckScenario.test.ts`
Expected: PASS (7 tests). `shiftPoint('0.000000000', 2)` must yield `'0'` and `'0.334009167'` → `'33.4009167'` — if a pin differs, check `utils/percent.ts`'s zero handling rather than editing the expectation.

- [ ] **Step 5: Commit**

```bash
git add src/components/paycheck/paycheckScenario.ts src/components/paycheck/paycheckScenario.test.ts
git commit -m "feat(paycheck): sandbox codec, presets sized by exact division, and the Apply seed"
```

---

### Task 2: `TryItPanel`

**Files:**
- Create: `src/components/paycheck/TryItPanel.tsx`
- Test: `src/components/paycheck/TryItPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/paycheck/TryItPanel.test.tsx
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { PaceItem, PaycheckBreakdownOut, PaycheckPreviewLines, PaycheckPreviewOut, PaycheckProfileOut } from '../../types/api'
import TryItPanel from './TryItPanel'

vi.mock('../../api/paycheck', () => ({ previewPaycheck: vi.fn(), createProfile: vi.fn(), updateProfile: vi.fn() }))
import { createProfile, previewPaycheck, updateProfile } from '../../api/paycheck'
const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() }
vi.mock('../ToastProvider', () => ({ useToast: () => toast }))

const profile: PaycheckProfileOut = {
  id: 7,
  person_id: 1,
  effective_date: '2026-01-01',
  annual_salary: '100000.00',
  pay_periods_per_year: 24,
  trad_401k_pct: '0.130000000',
  roth_401k_pct: '0.000000000',
  after_tax_401k_pct: '0.030000000',
  espp_pct: '0.110000000',
  withholding_pct: '0.300000000',
  dental_vision_per_check: '12.50',
  hsa_per_check: '100.00',
  hsa_coverage: 'self',
  notes: null,
}

const pace = (over: Partial<PaceItem>[] = []): PaceItem[] => [
  { key: 'limit_401k_elective', label: '401(k) elective deferral', annualized: '13000.00', limit: '24500.00', ratio: '0.5306', tone: 'ok' },
  { key: 'limit_415c_total', label: '415(c) total additions (excludes employer match)', annualized: '16000.00', limit: null, ratio: null, tone: 'ok' },
  { key: 'limit_hsa_self', label: 'HSA — self-only', annualized: '2400.00', limit: '4300.00', ratio: '0.5581', tone: 'ok' },
  { key: 'limit_espp_423', label: 'ESPP §423 annual', annualized: '11000.00', limit: '25000.00', ratio: '0.4400', tone: 'ok' },
  ...(over as PaceItem[]),
]

const lines = (net: string, savings: string): PaycheckPreviewLines => ({
  gross: '4166.67', trad_401k: '541.67', dental_vision: '12.50', hsa: '100.00', taxable: '3512.50',
  withholding: '1053.75', post_tax: '2458.75', roth_401k: '0.00', after_tax_401k: '125.00', espp: '458.33',
  net_pay: net, savings,
})

const breakdown: PaycheckBreakdownOut = {
  profile, gross: '4166.67', trad_401k: '541.67', dental_vision: '12.50', hsa: '100.00', taxable: '3512.50',
  withholding: '1053.75', post_tax: '2458.75', roth_401k: '0.00', after_tax_401k: '125.00', espp: '458.33',
  net_pay: '1875.42', monthly_net: '3750.84', warnings: [], pace: pace(),
}

function previewOut(scenarioNet = '1875.42', delta = '0.00'): PaycheckPreviewOut {
  const block = { baseline: lines('1875.42', '1225.00'), scenario: lines(scenarioNet, '1225.00'), delta: { ...lines('0.00', '0.00'), net_pay: delta } }
  const monthly = { baseline: lines('3750.84', '2450.00'), scenario: lines('3750.84', '2450.00'), delta: lines('0.00', '0.00') }
  return {
    profile,
    per_check: block,
    monthly,
    annual: { baseline: lines('45010.08', '29400.00'), scenario: lines('45010.08', '29400.00'), delta: lines('0.00', '0.00') },
    pace: { baseline: pace(), scenario: pace() },
    changed: [],
    warnings: [],
  }
}

function Url() {
  const l = useLocation()
  return <span data-testid="url">{l.pathname + l.search}</span>
}

function mount(entry = '/paycheck', onApply = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <TryItPanel profileId={null} personId={null} breakdown={breakdown} onApply={onApply} />
      <Url />
    </MemoryRouter>,
  )
  return onApply
}

const url = () => screen.getByTestId('url').textContent
const toggle = () => screen.getByRole('button', { name: /^(Try it|Close)$/ })

beforeEach(() => {
  localStorage.clear()
  vi.mocked(previewPaycheck).mockImplementation(async () => previewOut())
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TryItPanel', () => {
  it('mounts closed and spends no request; opening runs the empty scenario against the shown profile', async () => {
    mount()
    expect(screen.getByRole('heading', { name: /Try it — effective Jan 1, 2026/ })).toBeTruthy()
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(previewPaycheck).not.toHaveBeenCalled()
    fireEvent.click(toggle())
    await waitFor(() => expect(previewPaycheck).toHaveBeenCalledTimes(1))
    expect(previewPaycheck).toHaveBeenCalledWith({ profile_id: null, person_id: null, overrides: {} })
    expect((screen.getByRole('button', { name: 'Reset to actual' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('arriving with entries opens the card and runs at once; the compare and pace strip read the scenario', async () => {
    vi.mocked(previewPaycheck).mockResolvedValue(previewOut('1958.75', '83.33'))
    mount('/paycheck?whatif=trad_401k_pct%3A0.15')
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => expect(previewPaycheck).toHaveBeenCalledWith({ profile_id: null, person_id: null, overrides: { trad_401k_pct: '0.15' } }))
    const row = (await screen.findByText('Net pay')).closest('tr') as HTMLElement
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Net pay', '$1,875.42', '$1,958.75', '+$83.33'])
    expect(screen.getByRole('region', { name: 'Contribution pace' })).toBeTruthy()
    // The knob shows its distance from actual.
    expect(screen.getByText('+2.0 pp')).toBeTruthy()
  })

  it('a drag debounces; release writes the URL replace-style and previews once', async () => {
    vi.useFakeTimers()
    try {
      mount()
      fireEvent.click(toggle())
      await act(async () => {})
      const slider = screen.getByRole('slider', { name: 'Traditional 401(k) slider' })
      fireEvent.change(slider, { target: { value: '0.19' } })
      fireEvent.change(slider, { target: { value: '0.2' } })
      expect(url()).toBe('/paycheck')
      fireEvent.mouseUp(slider)
      expect(url()).toBe('/paycheck?whatif=trad_401k_pct%3A0.2')
      await act(async () => {})
      expect(previewPaycheck).toHaveBeenLastCalledWith({ profile_id: null, person_id: null, overrides: { trad_401k_pct: '0.2' } })
      expect(previewPaycheck).toHaveBeenCalledTimes(2) // the empty run, then the release
    } finally {
      vi.useRealTimers()
    }
  })

  it('presets are sized from the pace rows and set knobs immediately; a missing limit disables its chip', async () => {
    mount()
    fireEvent.click(toggle())
    await waitFor(() => expect(previewPaycheck).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Max 401(k)' }))
    expect(url()).toBe('/paycheck?whatif=trad_401k_pct%3A0.245')
    fireEvent.click(screen.getByRole('button', { name: 'Max HSA' }))
    expect(url()).toBe('/paycheck?whatif=hsa_per_check%3A179.16&whatif=trad_401k_pct%3A0.245')
    fireEvent.click(screen.getByRole('button', { name: 'Max ESPP' }))
    expect(url()).toContain('whatif=espp_pct%3A0.15')
    fireEvent.click(screen.getByRole('button', { name: 'Stop ESPP' }))
    expect(url()).toContain('whatif=espp_pct%3A0')
    expect(url()).not.toContain('0.15')
    cleanup()
    // Without an ESPP pace row the limit is unknown: disabled, with the sentence.
    render(
      <MemoryRouter initialEntries={['/paycheck']}>
        <TryItPanel profileId={null} personId={null} breakdown={{ ...breakdown, pace: pace().filter((r) => r.key !== 'limit_espp_423') }} onApply={vi.fn()} />
      </MemoryRouter>,
    )
    fireEvent.click(toggle())
    const chip = screen.getByRole('button', { name: 'Max ESPP' }) as HTMLButtonElement
    expect(chip.disabled).toBe(true)
    expect(chip.title).toContain("Enter this year's ESPP §423 limit in Settings › Limits")
  })

  it('the unit toggle switches the compare to the monthly and annual blocks', async () => {
    mount('/paycheck?whatif=trad_401k_pct%3A0.15')
    await screen.findByText('Net pay')
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }))
    const row = screen.getByText('Net pay').closest('tr') as HTMLElement
    expect(within(row).getAllByRole('cell')[1].textContent).toBe('$3,750.84')
    fireEvent.click(screen.getByRole('button', { name: 'Annual' }))
    expect(within(screen.getByText('Net pay').closest('tr') as HTMLElement).getAllByRole('cell')[1].textContent).toBe('$45,010.08')
  })

  it('Apply hands the pre-filled form seed to the page and writes nothing', async () => {
    const onApply = mount('/paycheck?whatif=trad_401k_pct%3A0.15&whatif=hsa_coverage%3Afamily')
    await screen.findByText('Net pay')
    fireEvent.click(screen.getByRole('button', { name: /^Save as profile effective / }))
    expect(onApply).toHaveBeenCalledTimes(1)
    const seed = onApply.mock.calls[0][0]
    expect(seed.trad_401k_pct).toBe('15')
    expect(seed.hsa_coverage).toBe('family')
    expect(seed.annual_salary).toBe('100000.00')
    expect(seed.effective_date).toMatch(/^\d{4}-\d{2}-01$/)
    expect(createProfile).not.toHaveBeenCalled()
    expect(updateProfile).not.toHaveBeenCalled()
  })

  it('no Apply while the scenario is empty', async () => {
    mount()
    fireEvent.click(toggle())
    await waitFor(() => expect(previewPaycheck).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: /^Save as profile/ })).toBeNull()
  })

  it('a failed run keeps the last result under the stale line, in the server’s words', async () => {
    mount('/paycheck?whatif=trad_401k_pct%3A0.15')
    await screen.findByText('Net pay')
    vi.mocked(previewPaycheck).mockRejectedValueOnce(new ApiError('trad_401k_pct must be between 0 and 1', 422))
    fireEvent.click(screen.getByRole('button', { name: 'Stop ESPP' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('trad_401k_pct must be between 0 and 1 — this scenario may be showing earlier data.')
    expect(screen.getByText('Net pay')).toBeTruthy()
  })

  it('the coverage toggle and the salary box are knobs too', async () => {
    mount()
    fireEvent.click(toggle())
    await waitFor(() => expect(previewPaycheck).toHaveBeenCalledTimes(1))
    fireEvent.click(within(screen.getByRole('group', { name: 'HSA coverage' })).getByRole('button', { name: 'Family' }))
    expect(url()).toBe('/paycheck?whatif=hsa_coverage%3Afamily')
    const salary = screen.getByLabelText('Annual salary') as HTMLInputElement
    fireEvent.focus(salary)
    fireEvent.change(salary, { target: { value: '$200,000' } })
    fireEvent.blur(salary)
    expect(url()).toBe('/paycheck?whatif=annual_salary%3A200000&whatif=hsa_coverage%3Afamily')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/paycheck/TryItPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// src/components/paycheck/TryItPanel.tsx
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { previewPaycheck } from '../../api/paycheck'
import CompareTable, { type CompareRow } from '../../sandbox/CompareTable'
import PresetRow from '../../sandbox/PresetRow'
import SandboxPanel from '../../sandbox/SandboxPanel'
import { readEntries } from '../../sandbox/scenarioUrl'
import SliderBox from '../../sandbox/SliderBox'
import { useSandbox, type PinResult, type SandboxSpec } from '../../sandbox/useSandbox'
import type { HsaCoverage, PaycheckBreakdownOut, PaycheckPreviewLines, PaycheckPreviewOut } from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency, formatDate } from '../../utils/format'
import { currentMonthIso } from '../../utils/months'
import AmountInput from '../AmountInput'
import Segmented from '../shell/Segmented'
import PacePanel from './PacePanel'
import {
  ESPP_MAX_PCT,
  HSA_TIERS,
  applySeedFor,
  decodePaycheck,
  encodePaycheck,
  isEmptyPaycheck,
  labelForPaycheck,
  paycheckPresets,
  toOverrides,
  type ApplySeed,
  type PaycheckKnob,
  type PaycheckScenario,
} from './paycheckScenario'
import './pace.css'

// The Paycheck "Try it" card (2026-09-03 planning-sandboxes spec §9). The scenario lives in
// the URL (`whatif=<knob>:<wire value>`); every figure on screen is the server's — the
// preview endpoint returns baseline, scenario and delta at three cadences, and the pace
// strip re-renders from `pace.scenario`. Apply never posts: it hands the PAGE a pre-filled
// profile form, and the form's own Add profile is the only write.
const UNITS = [
  { value: 'per_check', label: 'Per check' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
] as const
type Unit = (typeof UNITS)[number]['value']

// Withholding and the dental/vision deduction are COSTS: a rise reads red.
const ROWS: CompareRow[] = [
  { key: 'gross', label: 'Gross', kind: 'money' },
  { key: 'trad_401k', label: 'Traditional 401(k)', kind: 'money' },
  { key: 'dental_vision', label: 'Dental & vision', kind: 'money', invert: true },
  { key: 'hsa', label: 'HSA', kind: 'money' },
  { key: 'taxable', label: 'Taxable', kind: 'money' },
  { key: 'withholding', label: 'Withholding', kind: 'money', invert: true },
  { key: 'post_tax', label: 'Post-tax', kind: 'money' },
  { key: 'roth_401k', label: 'Roth 401(k)', kind: 'money' },
  { key: 'after_tax_401k', label: 'After-tax 401(k)', kind: 'money' },
  { key: 'espp', label: 'ESPP', kind: 'money' },
  { key: 'net_pay', label: 'Net pay', kind: 'money' },
  { key: 'savings', label: 'Payroll savings', kind: 'money' },
]

const COVERAGE_OPTIONS: { value: HsaCoverage; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'self', label: 'Self only' },
  { value: 'family', label: 'Family' },
]

const MIN_PAY_PERIODS = 1
const MAX_PAY_PERIODS = 366

export default function TryItPanel({
  profileId,
  personId,
  breakdown,
  onApply,
}: {
  /** The page's two selectors — exactly what GET /breakdown was asked with. */
  profileId: number | null
  personId: number | null
  /** The check on screen: its profile is the base, its pace rows carry the limits. */
  breakdown: PaycheckBreakdownOut
  /** Apply: the page pre-fills its profile form with this seed. */
  onApply: (seed: ApplySeed) => void
}) {
  const [params] = useSearchParams()
  // Arriving with entries opens the panel (spec §6); otherwise closed by default (§8.1).
  const [open, setOpen] = useState(() => readEntries(params).length > 0)
  const [unit, setUnit] = useState<Unit>('per_check')
  const profile = breakdown.profile

  const spec = useMemo<SandboxSpec<PaycheckScenario, PaycheckPreviewOut>>(
    () => ({
      page: 'paycheck',
      decode: decodePaycheck,
      encode: encodePaycheck,
      isEmpty: isEmptyPaycheck,
      preview: (scenario) =>
        previewPaycheck({ profile_id: profileId, person_id: personId, overrides: toOverrides(scenario) }),
      baselineOf: (result) => result,
      // A pinned row, an owner switch or a write that changes the profile in force all
      // re-run the pins against the check now on screen.
      dataKey: `${profileId ?? 'current'}:${personId ?? 'primary'}:${profile.id}`,
      enabled: open,
      labelFor: labelForPaycheck,
    }),
    [profileId, personId, profile.id, open],
  )
  const sandbox = useSandbox(spec)
  const { scenario, result } = sandbox

  const knob = (key: PaycheckKnob) => (next: string, commit: boolean) =>
    sandbox.set(
      (current) => {
        const draft = { ...current }
        if (next === '') delete draft[key]
        else draft[key] = next
        return draft
      },
      { immediate: commit },
    )

  // The scenario's own salary/periods/coverage size the presets; limits come from the pace
  // rows already in the payload — the scenario's first (its coverage may differ), then the
  // check's own. null → the chip is disabled with a sentence naming what to enter.
  const limitFor = (key: string): string | null => {
    for (const rows of [result?.pace.scenario, result?.pace.baseline, breakdown.pace]) {
      const row = rows?.find((r) => r.key === key)
      if (row !== undefined && row.limit !== null) return row.limit
    }
    return null
  }
  const coverage = (scenario.hsa_coverage as HsaCoverage | undefined) ?? profile.hsa_coverage
  const presets = paycheckPresets(
    {
      salary: scenario.annual_salary ?? profile.annual_salary,
      periods: Number(scenario.pay_periods_per_year ?? profile.pay_periods_per_year),
      coverage,
      esppPct: scenario.espp_pct ?? profile.espp_pct,
      limitFor,
    },
    (patch) => sandbox.set(patch, { immediate: true }),
  )

  const block = result === null ? null : result[unit]
  const pinSide = (r: PinResult<PaycheckPreviewOut>): PinResult<PaycheckPreviewLines> =>
    r === 'pending' || 'error' in r ? r : r[unit].scenario
  const nextMonth = applySeedFor(profile, scenario, currentMonthIso()).effective_date

  return (
    <SandboxPanel
      eyebrow={`Try it — effective ${formatDate(profile.effective_date)}`}
      hint="Move a percentage or an amount and see the check the server computes for it, against the profile shown above — nothing is saved."
      open={open}
      onToggle={() => setOpen((o) => !o)}
      sandbox={sandbox}
      closedHint={
        <p className="drill-hint">
          Try a different 401(k) percentage, HSA amount or withholding rate without writing a
          profile — nothing is saved until you choose to save it as one.
        </p>
      }
      presets={<PresetRow presets={presets} />}
      staleNoun="this scenario"
      skeletonHeight={220}
      compare={
        block !== null && result !== null ? (
          <>
            <Segmented
              variant="toggle"
              size="sm"
              ariaLabel="Compare unit"
              options={UNITS}
              value={unit}
              onChange={setUnit}
            />
            <CompareTable<PaycheckPreviewLines>
              rows={ROWS}
              baseline={block.baseline}
              scenario={block.scenario}
              valueOf={(side, key) => side[key as keyof PaycheckPreviewLines]}
              delta={(key) => block.delta[key as keyof PaycheckPreviewLines]}
              pins={sandbox.pins.map((pin) => ({ id: pin.id, label: pin.label, result: pinSide(sandbox.pinResults[pin.id]) }))}
              onUnpin={sandbox.unpin}
            />
            {result.warnings.length > 0 && (
              <div className="paycheck-warnings">
                {result.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}
            {!sandbox.empty && <PacePanel items={result.pace.scenario} />}
          </>
        ) : null
      }
      apply={
        <button
          type="button"
          className="button button-primary"
          onClick={() => onApply(applySeedFor(profile, scenario, currentMonthIso()))}
        >
          Save as profile effective {formatDate(nextMonth)}…
        </button>
      }
    >
      <SliderBox id="tryit-trad" label="Traditional 401(k)" kind="percent" value={scenario.trad_401k_pct ?? ''} actual={profile.trad_401k_pct} min="0" max="0.5" step="0.005" onChange={knob('trad_401k_pct')} />
      <SliderBox id="tryit-roth" label="Roth 401(k)" kind="percent" value={scenario.roth_401k_pct ?? ''} actual={profile.roth_401k_pct} min="0" max="0.5" step="0.005" onChange={knob('roth_401k_pct')} />
      <SliderBox id="tryit-after" label="After-tax 401(k)" kind="percent" value={scenario.after_tax_401k_pct ?? ''} actual={profile.after_tax_401k_pct} min="0" max="0.5" step="0.005" onChange={knob('after_tax_401k_pct')} />
      <SliderBox id="tryit-espp" label="ESPP" kind="percent" hint="Capped at 15% — the §423 ceiling." value={scenario.espp_pct ?? ''} actual={profile.espp_pct} min="0" max={ESPP_MAX_PCT} step="0.005" onChange={knob('espp_pct')} />
      <SliderBox id="tryit-hsa" label="HSA per check" kind="money" value={scenario.hsa_per_check ?? ''} actual={profile.hsa_per_check} min="0" max="500" step="5" onChange={knob('hsa_per_check')} />
      <div className="slider-box">
        <div className="slider-box-head">
          <span>HSA coverage</span>
        </div>
        <Segmented
          variant="toggle"
          size="sm"
          ariaLabel="HSA coverage"
          options={COVERAGE_OPTIONS}
          value={coverage}
          onChange={(value) =>
            sandbox.set(
              (current) => {
                const draft = { ...current }
                if (value === profile.hsa_coverage) delete draft.hsa_coverage
                else draft.hsa_coverage = value
                return draft
              },
              { immediate: true },
            )
          }
        />
      </div>
      <SliderBox
        id="tryit-withholding"
        label="Withholding"
        kind="percent"
        hint="The profile's one all-in rate — express a W-4 change here. The Taxes page's withholding card names the per-check remedy."
        value={scenario.withholding_pct ?? ''}
        actual={profile.withholding_pct}
        min="0"
        max="0.6"
        step="0.001"
        onChange={knob('withholding_pct')}
      />
      <BoxKnob
        id="tryit-salary"
        label="Annual salary"
        kind="money"
        value={scenario.annual_salary ?? ''}
        actual={profile.annual_salary}
        validate={(text) => (Number(text) > 0 ? null : 'Annual salary must be positive')}
        onCommit={knob('annual_salary')}
      />
      <BoxKnob
        id="tryit-periods"
        label="Pay periods per year"
        kind="plain"
        value={scenario.pay_periods_per_year ?? ''}
        actual={String(profile.pay_periods_per_year)}
        validate={(text) => {
          const n = Number(text)
          return Number.isInteger(n) && n >= MIN_PAY_PERIODS && n <= MAX_PAY_PERIODS
            ? null
            : `pay_periods_per_year must be between ${MIN_PAY_PERIODS} and ${MAX_PAY_PERIODS}`
        }}
        onCommit={knob('pay_periods_per_year')}
      />
      <p className="drill-hint">
        Dental &amp; vision flows through unchanged. Percentages are of gross;{' '}
        <Link to="/taxes">the Taxes withholding card</Link> says what a rate change does to the
        year. Coverage tiers: {HSA_TIERS.join(' · ')}.
      </p>
    </SandboxPanel>
  )
}

/** A box-only knob (salary, periods): commits on blur/Enter, the router's fences in the
 *  box's own words, a caption that resets to actual. Money boxes canonicalize ("$200,000" →
 *  "200000") the way the profile form does; the typed text is control-local. */
function BoxKnob({
  id,
  label,
  kind,
  value,
  actual,
  validate,
  onCommit,
}: {
  id: string
  label: string
  kind: 'money' | 'plain'
  value: string
  actual: string
  validate: (canonical: string) => string | null
  onCommit: (next: string, commit: boolean) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const text = draft.trim()
    setDraft(null)
    if (text === '') {
      setError(null)
      onCommit('', true)
      return
    }
    if (!isAmount(text, { expressions: false })) {
      setError(`${label} must be a number`)
      return
    }
    const canonical = canonicalAmount(text, { expressions: false })
    const problem = validate(canonical)
    if (problem !== null) {
      setError(problem)
      return
    }
    setError(null)
    onCommit(canonical, true)
  }
  return (
    <div className="slider-box">
      <div className="slider-box-head">
        <label htmlFor={id}>{label}</label>
        {value === '' && <span className="sandbox-badge">actual</span>}
      </div>
      <div
        className="slider-box-row"
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
      >
        <AmountInput
          id={id}
          kind={kind}
          aria-label={label}
          value={draft ?? value}
          placeholder={actual}
          onValueChange={setDraft}
        />
        <button
          type="button"
          className="slider-box-actual"
          onClick={() => {
            setError(null)
            onCommit('', true)
          }}
        >
          actual {kind === 'money' ? formatCurrency(actual) : actual}
        </button>
      </div>
      {error !== null && (
        <p className="sandbox-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/paycheck/TryItPanel.test.tsx src/sandbox/sandboxConformance.test.ts`
Expected: PASS (9 + the conformance walk now including `TryItPanel.tsx`). If the "presets" test's second URL differs in order, remember `encodePaycheck` is alphabetical — `hsa_per_check` precedes `trad_401k_pct`. If the salary-box test's URL lacks the salary, AmountInput's own blur commit ran after `BoxKnob.commit` read the draft: the wrapper's `onBlur` fires on the same focusout event after the child's, so `draft` already holds the canonical text — check `onValueChange={setDraft}` is wired and the test focuses before changing.

- [ ] **Step 5: Lint and commit**

Run: `npx eslint src/components/paycheck && npx tsc -b`

```bash
git add src/components/paycheck/TryItPanel.tsx src/components/paycheck/TryItPanel.test.tsx
git commit -m "feat(paycheck): TryItPanel — URL-scoped knobs, live preview, presets, per-check/monthly/annual compare, pins, Apply seed"
```

---

### Task 3: Mount the panel; Apply pre-fills `ProfilesPanel`

**Files:**
- Modify: `src/pages/PaycheckPage.tsx`

The page, after shell Plan 3 Task 4, renders the breakdown through `<Feed …>{(data) => (<><BreakdownPanel …/><PacePanel …/><FlowPanel …/></>)}</Feed>` and `ProfilesPanel` keyed `${selection.personId ?? 'primary'}:${switchable ? 'scoped' : 'unscoped'}`.

- [ ] **Step 1: Imports and state**

Add `import TryItPanel from '../components/paycheck/TryItPanel'` and `import type { ApplySeed } from '../components/paycheck/paycheckScenario'`. In `PaycheckPage`, next to `householdNonce`:

```tsx
  // Apply from the Try it card (2026-09-03 planning-sandboxes spec §9): the seed pre-fills the
  // profile form by REMOUNTING the panel with it (the nonce rides its key) — an explicit user
  // action, so replacing a half-typed row is the asked-for outcome, and no effect ever
  // setStates to do it. The form's own Add profile stays the only write.
  const [applySeed, setApplySeed] = useState<{ seed: ApplySeed; nonce: number } | null>(null)
```

- [ ] **Step 2: Mount the panel** — inside the breakdown `Feed`'s render prop, after `<FlowPanel data={data} still={fromCache} />`:

```tsx
              <TryItPanel
                profileId={selection.profileId}
                personId={selection.personId}
                breakdown={data}
                onApply={(seed) => setApplySeed((current) => ({ seed, nonce: (current?.nonce ?? 0) + 1 }))}
              />
```

- [ ] **Step 3: Seed the form** — `ProfilesPanel` gains a prop and a mount effect:

In its props type add `/** Apply from the Try it card: the form opens on these values (a keyed remount, see the page). */ initialForm?: ApplySeed` and destructure `initialForm`. Change the form state initializer to
`const [form, setForm] = useState<ProfileFormState>(() => initialForm ?? newProfileForm(latest))`
and add, after the `set`/`setCoverage` helpers:

```tsx
  // A seeded mount brings the date box into view and focuses it (spec §9) — DOM calls only,
  // no state. Guarded: jsdom has no scrollIntoView.
  useEffect(() => {
    if (initialForm === undefined) return
    const el = document.getElementById('paycheck-effective-date')
    el?.scrollIntoView?.({ block: 'center' })
    el?.focus()
  }, [initialForm])
```

Then the mount:

```tsx
          <ProfilesPanel
            key={`${selection.personId ?? 'primary'}:${switchable ? 'scoped' : 'unscoped'}:${applySeed?.nonce ?? 0}`}
            profiles={shownProfiles}
            personId={selection.personId}
            shownId={breakdown?.profile.id ?? null}
            pinnedId={selection.profileId}
            onSelect={selectProfile}
            onShowCurrent={showCurrent}
            onChanged={onProfilesChanged}
            initialForm={applySeed?.seed}
          />
```

`ApplySeed` and `ProfileFormState` share every field name and type (`hsa_coverage: HsaCoverage`, the rest strings), so the assignment type-checks without a cast; if `tsc` disagrees, the two drifted — align `ApplySeed` in `paycheckScenario.ts`, never cast.

- [ ] **Step 4: Run the page tests and types**

Run: `npx tsc -b && npx vitest run src/pages/PaycheckPage.test.tsx`
Expected: the existing page tests FAIL at the `vi.mock('../api/paycheck', …)` factory — `previewPaycheck` is not a function (the panel imports it). That is the next task's first edit.

- [ ] **Step 5: Commit (page only; the test lands in Task 4)**

```bash
git add src/pages/PaycheckPage.tsx
git commit -m "feat(paycheck): mount the Try it card under the flow; Apply pre-fills the profile form dated next month"
```

---

### Task 4: Page tests — the mock factory and the Apply pin

**Files:**
- Modify: `src/pages/PaycheckPage.test.tsx`

- [ ] **Step 1: Extend the mock factory** — in `vi.mock('../api/paycheck', () => ({ … }))` add `previewPaycheck: vi.fn(),` and add `previewPaycheck` to the `import { … } from '../api/paycheck'` list.

- [ ] **Step 2: Write the failing test** — append inside the file's main `describe` (use the file's render helper; shell Plan 3 Task 4 names it `renderPage(entry)`; if it is absent, define `const renderPage = (entry = '/paycheck') => render(<MemoryRouter initialEntries={[entry]}><PaycheckPage /></MemoryRouter>)` next to the other helpers):

```tsx
  it('Apply from Try it pre-fills the profile form for next month and writes nothing', async () => {
    const out = {
      profile: profile2026,
      per_check: { baseline: PREVIEW_LINES, scenario: PREVIEW_LINES, delta: PREVIEW_LINES },
      monthly: { baseline: PREVIEW_LINES, scenario: PREVIEW_LINES, delta: PREVIEW_LINES },
      annual: { baseline: PREVIEW_LINES, scenario: PREVIEW_LINES, delta: PREVIEW_LINES },
      pace: { baseline: [], scenario: [] },
      changed: [],
      warnings: [],
    }
    vi.mocked(previewPaycheck).mockResolvedValue(out)
    renderPage('/paycheck?whatif=trad_401k_pct%3A0.2')
    await screen.findByText('Payroll savings')
    fireEvent.click(screen.getByRole('button', { name: /^Save as profile effective / }))
    const trad = (await screen.findAllByLabelText('Traditional 401(k) %'))[0] as HTMLInputElement
    expect(trad.value).toBe('20%') // AmountInput's blurred echo of the seeded "20"
    const date = document.getElementById('paycheck-effective-date') as HTMLInputElement
    expect(date.value).toMatch(/^\d{4}-\d{2}-01$/)
    expect(document.activeElement).toBe(date)
    expect(createProfile).not.toHaveBeenCalled()
    expect(updateProfile).not.toHaveBeenCalled()
  })
```

with, near the fixtures:

```tsx
const PREVIEW_LINES = {
  gross: '0.00', trad_401k: '0.00', dental_vision: '0.00', hsa: '0.00', taxable: '0.00', withholding: '0.00',
  post_tax: '0.00', roth_401k: '0.00', after_tax_401k: '0.00', espp: '0.00', net_pay: '0.00', savings: '0.00',
}
```

(`profile2026`, `createProfile`, `updateProfile` already exist in the file. If the profile form's `Traditional 401(k) %` label resolves to two inputs because the Try it card's slider is labelled `Traditional 401(k)`, the `findAllByLabelText(…)[0]` above already picks the form's box — its label is the exact string with ` %`.)

- [ ] **Step 3: Run**

Run: `npx vitest run src/pages/PaycheckPage.test.tsx`
Expected: PASS — all existing tests plus the Apply pin.

- [ ] **Step 4: Commit**

```bash
git add src/pages/PaycheckPage.test.tsx
git commit -m "test(paycheck): Apply from Try it pre-fills the profile form and calls no writer"
```

---

### Task 5: Type-check, lint, suites

- [ ] **Step 1: Run**

`npx tsc -b && npx eslint src/components/paycheck src/pages/PaycheckPage.tsx && npx vitest run src/components/paycheck src/pages/PaycheckPage.test.tsx src/sandbox`
Expected: clean, all green.

- [ ] **Step 2: Report** — name the URL grammar the card emits (`whatif=<knob>:<wire>` with the nine knobs), that Apply writes nothing, and the conformance walk's inclusion of `TryItPanel.tsx`.

---

## Self-review

**Spec coverage:** §9 base (the shown profile via the page's two selectors) → `TryItPanel` props + `dataKey`; knobs and ranges (trad/roth/after-tax 0–50 % step 0.5 pp; ESPP 0–15 %; HSA $0–500 step $5 with the coverage toggle; withholding 0–60 % step 0.1 pp with the Taxes hint; salary and periods as boxes; dental flows through) → Task 2; presets from `pace[].limit` with null → disabled + title → Tasks 1–2; compare rows = eleven lines + `savings` under Per check / Monthly / Annual with `invert` on withholding and deductions → Task 2; pace strip from `pace.scenario` → Task 2; Apply pre-fills `ProfilesPanel` dated the first of next month, scrolls and focuses the date, never writes → Tasks 1, 3, 4. §6 arrival opens and runs; §8.1 closed by default; §8.5 pins/labels → Tasks 1–2 via lane G. §14 page tests (presets from pace limits, disabled chips, Apply pre-fills and writes nothing) → Tasks 2, 4. **Placeholders:** none. **Type consistency:** `TryItPanel({ profileId, personId, breakdown, onApply(seed: ApplySeed) })`; `ApplySeed` ≡ `ProfileFormState` field for field; `paycheckPresets(ctx: PresetContext, apply)`; `toOverrides` → `PaycheckPreviewOverrides` (lane B); `CompareTable<PaycheckPreviewLines>` with `valueOf(side, key)`/`delta(key)`; `SandboxSpec`/`useSandbox`/`SliderBox`/`PresetRow`/`Segmented` props match lanes G and 1a.
