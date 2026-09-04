# Motion & polish — Lane M1 (charts: entrances that actually play) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close `docs/superpowers/specs/2026-09-05-motion-polish-design.md` §6. Four changes: (1) the ResizeObserver stops killing every entrance by resizing to the size the engine already holds; (2) `group` leaves the init effect, so a drill that toggles the connect group re-points the live instance instead of disposing the canvas the bar → pie `universalTransition` morph needs; (3) the first animated paint waits on a one-shot IntersectionObserver (≥ 20% visible) — a chart below the fold draws itself as its card brightens — and every paint after the mount's one entrance is already-drawn; (4) the house clock reaches sankey/pie/treemap/line, the tooltip follows the cursor in 0.12s (0 under reduce), and a chart with no `onClick` stops wearing a pointer.

**Architecture:** All of it lives in `src/components/EChart.tsx` (the wrapper — NOT `src/charts/`, where the spec's lane table guessed it) plus two pure modules. `EChart` gains two effects between the init effect and the option effect: a `group` effect (`chart.group = group ?? ''` + `connect`, keyed on the theme deps so a palette re-init re-connects) and a visibility effect (one-shot IO, guarded for jsdom exactly like `PageFrame`'s sticky sentinel). The option effect's `setOption` body becomes an `apply()` closure so it can be *held* in a ref and run later by the observer; `paintedOnceRef` survives the init effect, which is what makes a theme swap repaint already-drawn with no entrance replay. Nothing new enters React state — the gate is three refs, written from an effect body and an observer callback, both sanctioned. `charts/theme.ts` gains per-series-type motion blocks (ECharts merges `theme[seriesType]` into a series BEFORE that series' own `defaultOption`, which is the only place the house clock can out-rank sankey's 1000ms 'linear' and friends) plus `tooltip.transitionDuration`; `charts/motion.ts` gains `defaultCursor`, a `quiesceRipples`-shaped transform; `charts/sankey.ts` restates `MOTION` on `SANKEY_MARKS`. One consequence to accept: a deferred first paint means an instance can exist for a frame with no option — every `instanceRef` consumer dispatches from hover/click handlers, which cannot fire before the canvas is drawn.

**Tech Stack:** React 19 + TypeScript 5.9, echarts 6 (mocked at the module boundary in jsdom — house law, no canvas), vitest 3 + @testing-library/react, eslint 9 + eslint-plugin-react-hooks 7. No new dependencies.

**Depends on:** nothing else. M1's files are disjoint from M2's (`index.css`, `Layout.*`, `RouteBoundary`, `panels.css`, `shell/PageFrame.tsx`), so this lane runs in parallel and merges after M2 per the spec's order. **M3 owns `src/components/ChartCard.tsx` — M1 never opens it** (the IntersectionObserver lives in `EChart.tsx`, not the card).

**Worktree / commands:** the worktree already exists at `5512e0c` with a `node_modules` junction (`git worktree list` to confirm; if gone, `git worktree add .worktrees/motion-m1 -b motion-m1 main` then `cmd //c "mklink /J node_modules ..\..\node_modules"` inside it). Every command below runs from `/c/Users/edyli/personal-finance-dashboard/.worktrees/motion-m1`. Local commits only — **never push**, never merge from inside this plan.

**Done when:** `npx vitest run src/charts src/components/EChart.test.tsx src/components/ChartCard.test.tsx src/pages/SpendingPage.test.tsx src/pages/TaxesPage.test.tsx` is green, `npx tsc -b` is clean, `npx eslint` is silent on every touched file, and a full `npx vitest run` shows no new failures against main's baseline.

**House rules (every task):** no `setState` in a `useEffect` synchronous body (handlers and observer callbacks are where state moves); ref writes only in effects, handlers and continuations; comments say WHY, not WHAT; files stay LF; every task ends with a mutation check proving the new test fails when the behaviour is reverted; one commit per task.

## File structure
| File | Responsibility |
|---|---|
| `src/components/EChart.tsx` + `.test.tsx` | Resize guard; `group` effect; visibility gate + `apply()`; cursor and reduce-tooltip merges. Tests: a ResizeObserver stub that can fire, `getWidth`/`getHeight` on the fake, four new describes |
| `src/charts/theme.ts` + `.test.ts` | Per-series-type motion blocks; `tooltip.transitionDuration: 0.12`, pinned in dark AND light |
| `src/charts/motion.ts` + `.test.ts` | `defaultCursor` beside `quiesceRipples`, with its table |
| `src/charts/sankey.ts` + `.test.ts` | `SANKEY_MARKS` restates `MOTION` |
| `src/pages/SpendingPage.tsx` | Comment only, at the `group` toggle (:497) — the expression stays |

`src/charts/conformance.ts` is READ but not changed: no rule pins a series animation key (rule 8 only asks stacked *bars* for a function `animationDelay`), so the new motion keys pass every fixture untouched. The lane gate proves it.

---
### Task 1: The resize that killed every entrance
**Files:** Modify `src/components/EChart.test.tsx`, `src/components/EChart.tsx` (:150)
- [ ] **Step 1: Write the failing tests** — in `EChart.test.tsx`, add `dispose`, `resize`, `getWidth`, `getHeight` (all `ReturnType<typeof vi.fn>`) to `interface FakeChartLike`, and to `class FakeChart` in the `vi.mock('../charts/echarts', …)` factory beside `resize`:
```tsx
    // jsdom's container is 0×0, so a fake answering 0 is a chart already at its element's size.
    getWidth = vi.fn(() => 0)
    getHeight = vi.fn(() => 0)
```
Declare `let resizeNotify: (() => void)[] = []` above the file-level `beforeEach`, clear it there (`resizeNotify = []`), and give the ResizeObserver stub a constructor that keeps its callback — the browser fires that callback the moment `observe()` is called, and it is the notification under test:
```tsx
    class {
      constructor(cb: () => void) { resizeNotify.push(cb) }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
```
Then append to the file:
```tsx
describe('EChart resize guard (spec §6)', () => {
  it('ignores the notification that only echoes the size the engine already holds', () => {
    render(<EChart ariaLabel="test chart" option={OPTION} />)
    resizeNotify.forEach((fire) => fire())
    // resize() mid-entrance restarts every animator from frame 0 — why entrances have never been seen.
    expect(lastChart().resize).not.toHaveBeenCalled()
  })
  it('resizes when the element and the engine disagree', () => {
    render(<EChart ariaLabel="test chart" option={OPTION} />)
    const chart = lastChart()
    chart.getWidth.mockReturnValue(800) // the element is still jsdom's 0-wide
    resizeNotify.forEach((fire) => fire())
    expect(chart.resize).toHaveBeenCalledTimes(1)
  })
})
```
- [ ] **Step 2: Run them to see them fail** — `npx vitest run src/components/EChart.test.tsx`. Expected: FAIL — `ignores the notification…` reports `expected "spy" not to be called at least once`.
- [ ] **Step 3: Guard the observer** — replace `src/components/EChart.tsx:150` (`const observer = new ResizeObserver(() => chart.resize())`) with:
```tsx
    // The browser fires this the moment observe() is called, carrying the size the chart was
    // just init'ed at; resize() there restarts every animator, killing the entrance (spec §6).
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== chart.getWidth() || el.clientHeight !== chart.getHeight()) {
        chart.resize()
      }
    })
```
- [ ] **Step 4: Run them to see them pass** — same command. Expected: PASS, no other case regressed.
- [ ] **Step 5: Typecheck and lint** — `npx tsc -b`; `npx eslint src/components/EChart.tsx src/components/EChart.test.tsx` (exit 0, no output).
- [ ] **Step 6: Mutation check** — flip the guard's `!==` pair to `===`, re-run the file. Expected: FAIL — `resizes when the element and the engine disagree` reports 0 calls. Restore, re-run: PASS.
- [ ] **Step 7: Commit**
```bash
git add src/components/EChart.tsx src/components/EChart.test.tsx
git commit -m "fix(charts): resize only on a real size change, so entrances survive the observer"
```

---
### Task 2: `group` gets its own effect, so a drill morphs instead of blanking
**Files:** Modify `src/components/EChart.test.tsx`, `src/components/EChart.tsx` (:118-124, :159, new effect), `src/pages/SpendingPage.tsx` (:497 comment)
- [ ] **Step 1: Write the failing test** — into the existing `describe('EChart — group, decals, live reduced motion (chart grammar)')`:
```tsx
  it('a group change re-points the LIVE instance instead of re-initializing it', () => {
    const init = vi.mocked(chartsModule.echarts.init)
    const { rerender } = render(<EChart ariaLabel="test chart" option={OPTION} group="spending" />)
    const chart = lastChart()
    const inits = init.mock.calls.length
    // Spending's drill (SpendingPage:497) and its trend compare toggle (:664) both flip the
    // group; disposing there throws away the canvas the bar → pie universalTransition needs.
    rerender(<EChart ariaLabel="test chart" option={OPTION} />)
    expect(chart.dispose).not.toHaveBeenCalled()
    expect(init.mock.calls.length).toBe(inits)
    expect((chart as unknown as { group: string }).group).toBe('')
    rerender(<EChart ariaLabel="test chart" option={OPTION} group="spending" />)
    expect(lastChart()).toBe(chart)
    expect((chart as unknown as { group: string }).group).toBe('spending')
  })
```
- [ ] **Step 2: Run it to see it fail** — `npx vitest run src/components/EChart.test.tsx`. Expected: FAIL — `expected "dispose" not to be called at least once`.
- [ ] **Step 3: Move the group out of the init effect** — delete the `if (group !== undefined) { … }` block at `EChart.tsx:118-124` (its comment goes with it) and drop `group` from the init effect's deps at :159 → `}, [instanceRef, resolved, themeVersion])`. Insert immediately after the init effect:
```tsx
  // `group` is deliberately NOT an init dependency (spec §6): a page that toggles the connect
  // group mid-life must not lose its instance. Declared after the init effect so it runs on the
  // fresh chart in the same commit (effects fire in declaration order), and keyed on the same
  // theme deps so a palette re-init re-connects — a disposed instance leaves its group by
  // itself, which is why the init cleanup never disconnects (that would unlink the siblings).
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    // '' is echarts' own "no group": leaving the old name on a drilled-in chart would keep
    // relaying the siblings' axisPointer and zoom actions to a pie that cannot use them.
    chart.group = group ?? ''
    if (group !== undefined) echarts.connect(group)
  }, [group, instanceRef, resolved, themeVersion])
```
Then replace `src/pages/SpendingPage.tsx:497` with the same expression, now explained:
```tsx
            group={
              /* Off for the drill-in pie: it has no axisPointer or zoom to share, and echarts
                 relays every action across a connect group. Safe to toggle since 2026-09-05 —
                 `group` has its own effect, so this re-points the live instance instead of
                 disposing the canvas the bar → pie morph runs on. */
              activeDetail ? undefined : 'spending'
            }
```
The Taxes composition drill (`src/components/taxes/CompositionPanel.tsx`) passes NO group at all — verified 2026-09-05 — so its morph needs nothing here beyond Task 1's resize guard. Leave it alone.
- [ ] **Step 4: Run the tests to see them pass** — `npx vitest run src/components/EChart.test.tsx src/pages/SpendingPage.test.tsx`. Expected: PASS, including the existing `sets chart.group and connects on every init — the theme re-init included` (the new effect's theme deps are what keep it green).
- [ ] **Step 5: Typecheck and lint** — `npx tsc -b`; `npx eslint src/components/EChart.tsx src/components/EChart.test.tsx src/pages/SpendingPage.tsx` (exit 0).
- [ ] **Step 6: Mutation check** — put `group` back into the init effect's deps, re-run `EChart.test.tsx`. Expected: FAIL — `a group change re-points the LIVE instance…` reports `expected "dispose" not to be called at least once`. Remove it again, re-run: PASS.
- [ ] **Step 7: Commit**
```bash
git add src/components/EChart.tsx src/components/EChart.test.tsx src/pages/SpendingPage.tsx
git commit -m "fix(charts): apply the connect group in its own effect so a drill keeps its instance"
```

---
### Task 3: The first paint waits for the card to be on screen — and it is the mount's only entrance
**Files:** Modify `src/components/EChart.test.tsx`, `src/components/EChart.tsx` (refs after :88, init cleanup, new effect, option effect :220-234)
- [ ] **Step 1: Write the failing tests** — append to `src/components/EChart.test.tsx`:
```tsx
describe('EChart first paint waits for visibility (spec §6)', () => {
  type IOEntry = { isIntersecting: boolean; intersectionRatio: number }
  let notify: ((entries: IOEntry[]) => void)[] = []
  let disconnects: ReturnType<typeof vi.fn>[] = []
  // jsdom has no IntersectionObserver, so only this describe has one — every other case in
  // the file keeps painting synchronously, which is the no-observer contract below.
  beforeEach(() => {
    notify = []
    disconnects = []
    vi.stubGlobal('IntersectionObserver', vi.fn((cb: (entries: IOEntry[]) => void) => {
      const disconnect = vi.fn()
      disconnects.push(disconnect)
      return { observe: () => notify.push(cb), disconnect, unobserve: () => {} }
    }))
  })
  it('holds the first animated paint until 20% of the canvas is on screen, once', () => {
    render(<EChart ariaLabel="test chart" option={{ series: [] } as EChartsOption} />)
    const chart = lastChart()
    expect(chart.setOption).not.toHaveBeenCalled()
    // isIntersecting alone is not the gate: a 5%-visible chart is reported as intersecting.
    notify.forEach((fire) => fire([{ isIntersecting: true, intersectionRatio: 0.05 }]))
    expect(chart.setOption).not.toHaveBeenCalled()
    notify.forEach((fire) => fire([{ isIntersecting: true, intersectionRatio: 0.6 }]))
    expect(chart.setOption).toHaveBeenCalledTimes(1)
    const [first] = chart.setOption.mock.calls[0] as [Record<string, unknown>]
    expect('animationDuration' in first).toBe(false)
    expect(disconnects[0]).toHaveBeenCalled() // one-shot: scrolling away never re-arms it
  })
  it('a cached paint never waits — it has no entrance to protect', () => {
    render(<EChart ariaLabel="test chart" option={{ series: [] } as EChartsOption} animateEntrance={false} />)
    const [only] = lastChart().setOption.mock.calls[0] as [Record<string, unknown>]
    expect(only.animationDuration).toBe(0)
  })
  it('the entrance is the mount’s only one — the next paint is already-drawn', () => {
    const bars = (v: number) => ({ series: [{ type: 'bar', data: [v] }] }) as EChartsOption
    const { rerender } = render(<EChart ariaLabel="test chart" option={bars(1)} />)
    const chart = lastChart()
    notify.forEach((fire) => fire([{ isIntersecting: true, intersectionRatio: 1 }]))
    rerender(<EChart ariaLabel="test chart" option={bars(2)} />)
    const last = chart.setOption.mock.calls.at(-1) as [Record<string, unknown>]
    expect(last[0].animationDuration).toBe(0)
  })
  it('with no observer nothing waits, and a theme re-init repaints already-drawn', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    function Harness() {
      const { setTheme } = useTheme()
      return (<><button onClick={() => setTheme('light')}>go light</button><EChart ariaLabel="test chart" option={OPTION} /></>)
    }
    render(<ThemeProvider><Harness /></ThemeProvider>)
    const [first] = lastChart().setOption.mock.calls[0] as [Record<string, unknown>]
    expect('animationDuration' in first).toBe(false)
    act(() => screen.getByText('go light').click())
    await waitFor(() => expect(instances.length).toBe(2))
    const [after] = lastChart().setOption.mock.calls[0] as [Record<string, unknown>]
    expect(after.animationDuration).toBe(0)
  })
})
```
- [ ] **Step 2: Run them to see them fail** — `npx vitest run src/components/EChart.test.tsx`. Expected: FAIL on cases 1, 3 and 4 (`expected "setOption" not to be called`, then `expected undefined to be 0` twice).
- [ ] **Step 3a: The three refs** — in `src/components/EChart.tsx`, after `lastStrippedRef` (:88):
```tsx
  // Has this MOUNT ever painted? Unlike lastStrippedRef this survives the init effect, so a
  // palette re-init repaints already-drawn instead of replaying the entrance (spec §6).
  const paintedOnceRef = useRef(false)
  // The first paint, held until the card is on screen; latest-wins, and the init cleanup drops
  // it because the chart its closure captured is being disposed.
  const pendingPaintRef = useRef<(() => void) | null>(null)
  const visibleRef = useRef(false) // opened once, by the observer below or by its absence
```
Add `pendingPaintRef.current = null` beside `lastStrippedRef.current = null` in the init effect's cleanup.
- [ ] **Step 3b: The one-shot gate** — a new effect immediately after Task 2's group effect:
```tsx
  // A chart below the fold used to spend its entrance off-screen and was already still by the
  // time it was scrolled to. One-shot gate (spec §6): the first animated paint waits until 20%
  // of the canvas is on screen. Guarded like PageFrame's sentinel — no observer, no waiting.
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      visibleRef.current = true
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        // The initial delivery reports a sliver as intersecting, so the RATIO is the gate.
        if (!entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.2)) return
        observer.disconnect() // opened once per mount, never closed again
        visibleRef.current = true
        const pending = pendingPaintRef.current
        pendingPaintRef.current = null
        pending?.()
      },
      { threshold: 0.2 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
```
- [ ] **Step 3c: One entrance per mount, held until then** — in the option effect replace the `chart.setOption(…)` call and the `lastStrippedRef.current = stripped` line after it (:220-234; the `aria`/decals comment rides along unchanged) with:
```tsx
    // The mount's ONE entrance: the first paint animates in, and everything after it — a
    // revalidation, a scope change, the theme re-init that rebuilds the instance — repaints
    // already-drawn. Only the ENTRANCE duration is zeroed, so update animation still runs
    // (zoom morphs, Projection's trend-span toggles — Addendum §A2).
    const entrance = animateEntrance && !paintedOnceRef.current
    const apply = () => {
      chart.setOption(
        {
          ...base,
          ...(decals ? { aria: { enabled: true, label: { enabled: false }, decal: { show: true } } } : {}),
          ...(reducedMotion ? { animation: false } : entrance ? {} : { animationDuration: 0 }),
        },
        { notMerge: true },
      )
      paintedOnceRef.current = true
      lastStrippedRef.current = stripped
    }
    // Only an animated first paint waits: a cached or reduced-motion paint has no entrance to
    // protect, and the zoom fast path cannot fire meanwhile (lastStrippedRef stays null).
    if (entrance && !reducedMotion && !visibleRef.current) {
      pendingPaintRef.current = apply
      return
    }
    apply()
```
- [ ] **Step 4: Run the tests to see them pass** — `npx vitest run src/components/EChart.test.tsx src/components/ChartCard.test.tsx`. Expected: PASS.
- [ ] **Step 5: Typecheck and lint** — `npx tsc -b`; `npx eslint src/components/EChart.tsx src/components/EChart.test.tsx` (exit 0).
- [ ] **Step 6: Mutation check** — delete the `if (entrance && !reducedMotion && !visibleRef.current) { … }` block: FAIL — `holds the first animated paint…` reports `expected "setOption" not to be called`. Restore it, then delete `paintedOnceRef.current = true`: FAIL — `the entrance is the mount’s only one…` reports `expected undefined to be 0`. Restore, re-run: PASS.
- [ ] **Step 7: Commit**
```bash
git add src/components/EChart.tsx src/components/EChart.test.tsx
git commit -m "feat(charts): defer the first paint until the card is 20% on screen, once per mount"
```

---
### Task 4: The house clock reaches every series type, the tooltip follows, and a dead chart drops its pointer
**Files:** Modify `src/charts/theme.ts(+.test.ts)`, `src/charts/motion.ts(+.test.ts)`, `src/charts/sankey.ts(+.test.ts)`, `src/components/EChart.tsx(+.test.tsx)`
- [ ] **Step 1: Write the failing tests** — `src/charts/theme.test.ts`, inside the existing `carries the house motion block…` loop body (add `import { MOTION } from './motion'`):
```tsx
      // A block keyed by series type is the only place the house clock can win for these four.
      for (const type of ['sankey', 'pie', 'treemap', 'line'] as const) expect(theme[type]).toEqual(MOTION)
      expect(theme.tooltip.transitionDuration).toBe(0.12)
```
`src/charts/sankey.test.ts`, in `describe('SANKEY_MARKS')` (importing `MOTION`): `expect(SANKEY_MARKS).toMatchObject(MOTION)`.
`src/charts/motion.test.ts`, a new describe (importing `defaultCursor`):
```tsx
describe('defaultCursor', () => {
  it('blunts every series that has not asked for a cursor and leaves the ones that have', () => {
    const out = defaultCursor(optionWith([{ type: 'line' }, { type: 'bar', cursor: 'pointer' }]))
    expect(seriesOf(out).map((s) => (s as { cursor?: string }).cursor)).toEqual(['default', 'pointer'])
    expect(defaultCursor(optionWith({ type: 'pie' }))).toEqual({ series: { type: 'pie', cursor: 'default' } })
    expect(defaultCursor({} as EChartsOption)).toEqual({})
  })
})
```
`src/components/EChart.test.tsx`, appended:
```tsx
describe('EChart cursor and tooltip motion (spec §6)', () => {
  const bar = { series: [{ type: 'bar' }], tooltip: { formatter: () => 'x' } } as EChartsOption
  const applied = () => lastChart().setOption.mock.calls[0][0] as
    { series: { cursor?: string }[]; tooltip: { transitionDuration?: number; formatter?: unknown } }
  it('a chart with no onClick paints series that do not pretend to be clickable', () => {
    render(<EChart ariaLabel="test chart" option={bar} />)
    expect(applied().series[0].cursor).toBe('default')
  })
  it('an onClick leaves the pointer alone', () => {
    render(<EChart ariaLabel="test chart" option={bar} onClick={vi.fn()} />)
    expect(applied().series[0].cursor).toBeUndefined()
  })
  it('under reduce the tooltip snaps, keeping the page’s own formatter', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    render(<EChart ariaLabel="test chart" option={bar} />)
    // notMerge: a bare `tooltip: { transitionDuration: 0 }` would drop the formatter with it.
    expect(applied().tooltip.transitionDuration).toBe(0)
    expect(typeof applied().tooltip.formatter).toBe('function')
  })
})
```
- [ ] **Step 2: Run them to see them fail** — `npx vitest run src/charts src/components/EChart.test.tsx`. Expected: FAIL — `expected undefined to equal { animationDuration: 450, … }`, `expected undefined to be 0.12`, `defaultCursor is not a function`, `expected undefined to be 'default'`.
- [ ] **Step 3a: `src/charts/theme.ts`** — after the `...MOTION,` spread in `buildTheme`:
```tsx
    // SeriesModel.mergeDefaultAndTheme merges theme[seriesType] into a series BEFORE that
    // series' own defaultOption — and those defaults (sankey 1000ms 'linear', pie 1000ms
    // 'cubicInOut', treemap 900ms 'quinticInOut', line 'linear') are why the clock above never
    // reached these four. One object, four keys: echarts clones what it merges.
    sankey: MOTION, pie: MOTION, treemap: MOTION, line: MOTION,
```
and inside the `tooltip` block:
```tsx
      // 0.12s of follow instead of echarts' 0.4s of lag: the box tracks the cursor rather
      // than swimming after it. EChart zeroes it under reduce, where the preference is known.
      transitionDuration: 0.12,
```
- [ ] **Step 3b: `src/charts/motion.ts`** — beside `quiesceRipples`:
```tsx
/** ECharts gives every series a 'pointer' cursor whether or not a click does anything, so a
 *  chart with no `onClick` promises a drill-in it lacks. An explicit cursor is left alone. */
export function defaultCursor(option: EChartsOption): EChartsOption {
  const series = (option as { series?: unknown }).series
  if (series === undefined) return option
  const blunt = (one: unknown): unknown => {
    const s = one as { cursor?: string } | null
    return s !== null && typeof s === 'object' && s.cursor === undefined ? { ...s, cursor: 'default' } : one
  }
  return { ...option, series: Array.isArray(series) ? series.map(blunt) : blunt(series) } as EChartsOption
}
```
- [ ] **Step 3c: `src/charts/sankey.ts`** — `import { MOTION } from './motion'`, then after `type: 'sankey',` in `SANKEY_MARKS`:
```tsx
  // Restated on the series because a sankey's own defaultOption out-ranks the theme's top-level
  // clock; buildTheme's per-type block covers a sankey built without these marks, which are
  // what both flow builders actually spread.
  ...MOTION,
```
- [ ] **Step 3d: `src/components/EChart.tsx`** — import `defaultCursor` beside `quiesceRipples`, and above the option effect:
```tsx
  // The PRESENCE of a handler, never its identity: pages pass inline closures, and a fresh
  // function each render must never repaint the chart.
  const clickable = onClick !== undefined
```
In the option effect add `__clickable: clickable` to the `stripped` fingerprint (a flip with an otherwise unchanged option must not ride the zoom fast path), replace the `const base = …` line with:
```tsx
    const pointed = clickable ? themed : defaultCursor(themed)
    const base = reducedMotion ? quiesceRipples(pointed) : pointed
```
change the reduced-motion arm of `apply()`'s spread to:
```tsx
          ...(reducedMotion
            ? {
                animation: false,
                // notMerge: a bare tooltip object here would drop the page's own formatter.
                tooltip: { ...(base as { tooltip?: object }).tooltip, transitionDuration: 0 },
              }
            : entrance ? {} : { animationDuration: 0 }),
```
and add `clickable` to that effect's dependency array.
- [ ] **Step 4: Run the tests to see them pass** — `npx vitest run src/charts src/components/EChart.test.tsx`. Expected: PASS, conformance fixtures included (no rule pins an animation key).
- [ ] **Step 5: Typecheck and lint** — `npx tsc -b`; `npx eslint src/charts src/components/EChart.tsx src/components/EChart.test.tsx` (exit 0).
- [ ] **Step 6: Mutation check** — delete `sankey: MOTION,` from `buildTheme`: FAIL — theme test `expected undefined to equal {…}`. Restore, then change `clickable ? themed : defaultCursor(themed)` to `themed`: FAIL — `expected undefined to be 'default'`. Restore, then drop the `...(base as { tooltip?: object }).tooltip` spread: FAIL — `expected undefined to be 'function'`. Restore, re-run: PASS.
- [ ] **Step 7: Commit**
```bash
git add src/charts/theme.ts src/charts/theme.test.ts src/charts/motion.ts src/charts/motion.test.ts src/charts/sankey.ts src/charts/sankey.test.ts src/components/EChart.tsx src/components/EChart.test.tsx
git commit -m "feat(charts): put the house clock on every series type, follow the cursor, drop the false pointer"
```

---
### Task 5: Lane gate (read-only — no mutation check, no commit)
**Files:** none
- [ ] **Step 1: The lane's suites** — `npx vitest run src/charts src/components/EChart.test.tsx src/components/ChartCard.test.tsx src/pages/SpendingPage.test.tsx src/pages/TaxesPage.test.tsx`. Expected: every file green; record the counts.
- [ ] **Step 2: The whole suite** — `npx vitest run`. Expected: no failure `main` does not already have (re-run a suspect file on `main` before blaming this lane).
- [ ] **Step 3: Types and lint** — `npx tsc -b`; `npx eslint src/charts src/components/EChart.tsx src/components/EChart.test.tsx src/pages/SpendingPage.tsx` (exit 0, no output).
- [ ] **Step 4: The lane stayed inside its lines** — `git diff --stat main...HEAD`. Expected: only the files in the table above; `src/components/ChartCard.tsx` is NOT among them (M3 owns it), and nothing under `src/index.css` or `src/components/shell/` (M2).
- [ ] **Step 5: Hand off** — report the four commits and the vitest counts, and note what jsdom cannot prove: the entrances themselves, the deferred below-the-fold draw and the drill morph belong to lane V's browser smoke (spec §10).
