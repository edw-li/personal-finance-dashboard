# Scrollbar Gutter + Animated Zoom Windows Implementation Plan (Addendum A1/A2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Month switches on `/update` stop shifting the layout (stable scrollbar gutter), and the All/1Y/YTD chips morph the chart window (~300 ms echarts update animation) instead of snapping — with update animation also revived on cached paints so Projection's 10Y/40Y span toggle morphs too.

**Architecture:** One global CSS rule (`scrollbar-gutter: stable`). In `EChart`, a zoom-only fast path: the wrapper fingerprints the last applied option minus its `dataZoom`; when a new option matches the fingerprint and the page supplied a resolved `zoomWindow`, it dispatches an animated `dataZoom` action on the live instance instead of the `notMerge` rebuild (the rebuild is what snaps). Entrance suppression narrows from `animation: false` to `animationDuration: 0` so update animations survive cached paints. Reduced motion is untouched: full `animation: false`, fast path skipped.

**Tech Stack:** React 19, echarts 6 (`dispatchAction`), vitest (existing FakeChart mock has `dispatchAction` and `getOption` → `{ dataZoom: [{ startValue: 3, endValue: 9 }] }`).

**Spec:** `docs/superpowers/specs/2026-08-27-navigation-ux-polish-design.md` — Addendum §A1/§A2.

**Conventions:** run tests with `npx vitest run <file>`; never push; commit per task; locate edits by quoted code (line anchors are from tonight's main @b242313+).

---

### Task 1: Stable scrollbar gutter

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1:** After the `body { … }` rule, add:

```css
html {
  /* The scrollbar's column is reserved even when content is short: without this, the
     monthly-update wizard's unmount-while-loading dropped the page under viewport
     height mid month-switch and the vanishing scrollbar shifted the whole layout
     ~15px sideways until data landed (spec Addendum §A1). Also steadies skeleton
     phases on short pages. */
  scrollbar-gutter: stable;
}
```

- [ ] **Step 2:** `npx vitest run` — green (CSS-only). **Step 3: Commit**

```bash
git add src/index.css
git commit -m "fix(layout): stable scrollbar gutter — month switches stop shifting the page"
```

---

### Task 2: `resolvedWindow` in timeZoom

**Files:**
- Modify: `src/charts/timeZoom.ts`
- Modify: `src/charts/timeZoom.test.ts`

- [ ] **Step 1: Write the failing tests.** Append to `src/charts/timeZoom.test.ts` (match its existing import/describe style):

```ts
describe('resolvedWindow', () => {
  const dates = ['2024-01-01', '2024-06-01', '2025-01-01', '2025-06-01']

  it('resolves a preset to its start index and the LAST axis index', () => {
    expect(resolvedWindow(dates, { preset: 'all' })).toEqual({ startValue: 0, endValue: 3 })
  })

  it('a mirrored manual window keeps its own end', () => {
    expect(
      resolvedWindow(dates, { preset: 'all', window: { startValue: 1, endValue: 2 } }),
    ).toEqual({ startValue: 1, endValue: 2 })
  })

  it('a stale window off a shorter axis falls back to the preset (rangeZoom rule)', () => {
    expect(
      resolvedWindow(dates, { preset: 'all', window: { startValue: 9, endValue: 12 } }),
    ).toEqual({ startValue: 0, endValue: 3 })
  })

  it('an empty axis resolves to a degenerate zero window', () => {
    expect(resolvedWindow([], { preset: 'all' })).toEqual({ startValue: 0, endValue: 0 })
  })
})
```

Add `resolvedWindow` to the file's import from `./timeZoom`.

- [ ] **Step 2:** Run — FAIL (no export). **Step 3: Implement.** Append to `src/charts/timeZoom.ts`:

```ts
/**
 * The window a RangeState RESOLVES to, with endValue made explicit: option-side presets
 * deliberately omit it ("runs to the newest point"), but the animated dataZoom ACTION
 * path (EChart's zoomWindow fast path — spec Addendum §A2) needs the index. Layers the
 * mirrored manual window exactly like rangeZoom, including its stale-window drop.
 */
export function resolvedWindow(dates: string[], range: RangeState): ZoomWindow {
  const [zoom] = rangeZoom(dates, range)
  return {
    startValue: zoom.startValue,
    endValue: zoom.endValue ?? Math.max(0, dates.length - 1),
  }
}
```

- [ ] **Step 4:** Run — PASS. **Step 5: Commit**

```bash
git add src/charts/timeZoom.ts src/charts/timeZoom.test.ts
git commit -m "feat(charts): resolvedWindow — explicit end index for the zoom action path"
```

---

### Task 3: EChart zoom fast path + narrowed entrance suppression

**Files:**
- Modify: `src/components/EChart.tsx`
- Modify: `src/components/EChart.test.tsx`

- [ ] **Step 1: Write/adjust the tests.**

(a) REVISE the overnight test `animateEntrance={false} forces animation off in the option`: the behavior deliberately changes (spec Addendum §A2). It becomes:

```tsx
it('animateEntrance={false} suppresses the ENTRANCE only — update animation survives', () => {
  render(<EChart option={{ series: [] }} animateEntrance={false} />)
  const chart = instances[0]
  const [option] = chart.setOption.mock.calls[0]
  expect(option.animationDuration).toBe(0)
  expect('animation' in option).toBe(false)
})
```

(b) Add a new describe (FakeChart's `getOption` already resolves `{ dataZoom: [{ startValue: 3, endValue: 9 }] }`):

```tsx
describe('zoomWindow fast path', () => {
  const series = [{ type: 'line', data: [1, 2, 3] }]

  it('a zoom-only option change dispatches an animated dataZoom instead of rebuilding', () => {
    const { rerender } = render(
      <EChart
        option={{ series, dataZoom: [{ type: 'inside', startValue: 3 }] }}
        zoomWindow={{ startValue: 3, endValue: 9 }}
      />,
    )
    const chart = instances[0]
    expect(chart.setOption).toHaveBeenCalledTimes(1)
    rerender(
      <EChart
        option={{ series, dataZoom: [{ type: 'inside', startValue: 5 }] }}
        zoomWindow={{ startValue: 5, endValue: 9 }}
      />,
    )
    expect(chart.setOption).toHaveBeenCalledTimes(1) // never rebuilt
    expect(chart.dispatchAction).toHaveBeenCalledWith({
      type: 'dataZoom',
      startValue: 5,
      endValue: 9,
    })
  })

  it('an echoed window equal to the chart state settles as a no-op (ctrl+wheel mirror)', () => {
    const { rerender } = render(
      <EChart
        option={{ series, dataZoom: [{ type: 'inside', startValue: 3 }] }}
        zoomWindow={{ startValue: 3, endValue: 9 }}
      />,
    )
    const chart = instances[0]
    rerender(
      <EChart
        option={{ series, dataZoom: [{ type: 'inside', startValue: 3, endValue: 9 }] }}
        zoomWindow={{ startValue: 3, endValue: 9 }}
      />,
    )
    expect(chart.setOption).toHaveBeenCalledTimes(1)
    expect(chart.dispatchAction).not.toHaveBeenCalled()
  })

  it('a data change takes the full notMerge path even with zoomWindow set', () => {
    const { rerender } = render(
      <EChart
        option={{ series: [{ type: 'line', data: [1] }], dataZoom: [{ type: 'inside', startValue: 0 }] }}
        zoomWindow={{ startValue: 0, endValue: 9 }}
      />,
    )
    const chart = instances[0]
    rerender(
      <EChart
        option={{ series: [{ type: 'line', data: [1, 2] }], dataZoom: [{ type: 'inside', startValue: 0 }] }}
        zoomWindow={{ startValue: 0, endValue: 9 }}
      />,
    )
    expect(chart.setOption).toHaveBeenCalledTimes(2)
    expect(chart.dispatchAction).not.toHaveBeenCalled()
  })

  it('without zoomWindow, a zoom-only change still rebuilds (opt-in contract)', () => {
    const { rerender } = render(
      <EChart option={{ series, dataZoom: [{ type: 'inside', startValue: 3 }] }} />,
    )
    const chart = instances[0]
    rerender(<EChart option={{ series, dataZoom: [{ type: 'inside', startValue: 5 }] }} />)
    expect(chart.setOption).toHaveBeenCalledTimes(2)
    expect(chart.dispatchAction).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2:** Run `npx vitest run src/components/EChart.test.tsx` — the revised + new tests FAIL.

- [ ] **Step 3: Implement.** In `src/components/EChart.tsx`:

1. Import the type: `import type { ZoomWindow } from '../charts/timeZoom'`.
2. Props — after `animateEntrance` (additive-signature contract):

```tsx
  /** The resolved target window for the option's dataZoom (timeZoom's resolvedWindow).
   *  When set, an option change that differs ONLY in its dataZoom is applied as an
   *  animated dataZoom ACTION on the live instance instead of a notMerge rebuild —
   *  the range chips morph instead of snapping (spec Addendum §A2). Pass a
   *  useMemo'd value: the fingerprint compare below runs per effect firing. */
  zoomWindow?: ZoomWindow
```

3. Add the fingerprint ref next to `chartRef`:

```tsx
  // Fingerprint of the last APPLIED option minus its dataZoom (the zoom fast path's
  // "nothing else changed" proof). Reset whenever the chart itself is rebuilt — a fresh
  // instance has no applied option to be equal to.
  const lastStrippedRef = useRef<string | null>(null)
```

and in the init effect set `lastStrippedRef.current = null` right after `chartRef.current = chart`, and again in its cleanup after `chartRef.current = null`.

4. Replace the option effect (currently lines 120–134) with:

```tsx
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const stripped = JSON.stringify({ ...option, dataZoom: undefined })
    // Zoom-only fast path (spec Addendum §A2): same option apart from the window → an
    // animated dataZoom ACTION morphs the series on the live instance; the notMerge
    // rebuild below is what used to make the chips snap. Skipped under reduced motion
    // (the rebuild with animation:false snaps, byte-identical to before) and settled
    // as a no-op when the chart already sits at the target (the ctrl+wheel mirror's
    // echo: datazoom event → page state → option rebuild → same window).
    if (
      !REDUCED_MOTION &&
      zoomWindow !== undefined &&
      lastStrippedRef.current !== null &&
      lastStrippedRef.current === stripped
    ) {
      const current = (
        chart.getOption() as { dataZoom?: { startValue?: unknown; endValue?: unknown }[] }
      ).dataZoom?.[0]
      if (
        current === undefined ||
        current.startValue !== zoomWindow.startValue ||
        current.endValue !== zoomWindow.endValue
      ) {
        chart.dispatchAction({
          type: 'dataZoom',
          startValue: zoomWindow.startValue,
          endValue: zoomWindow.endValue,
        })
      }
      return
    }
    // notMerge: pages always send complete options; merging stale series causes ghosts.
    // Reduced-motion is forced AFTER the spread — a page option must never re-enable
    // animation against the user's OS preference (Global rules a11y promise). The flag
    // alone is not enough: ripple animators ignore it, so quiesceRipples covers the gap.
    // animateEntrance suppresses the ENTRANCE only (animationDuration: 0) — update
    // animation must survive a cached paint, or the zoom morphs above and Projection's
    // trend-span toggles would snap until the first changed revalidation (Addendum §A2).
    const base = REDUCED_MOTION ? quiesceRipples(option) : option
    chart.setOption(
      {
        ...base,
        ...(REDUCED_MOTION
          ? { animation: false }
          : !animateEntrance
            ? { animationDuration: 0 }
            : {}),
      },
      { notMerge: true },
    )
    lastStrippedRef.current = stripped
  }, [option, animateEntrance, zoomWindow])
```

- [ ] **Step 4:** Run the EChart suite — PASS. Then `npx vitest run` — any page test asserting the old `animation: false` cached-paint shape must be repointed to `animationDuration: 0` WITHOUT weakening its stillness claim (the Plan-1 page tests assert via the mock's `data-animate` attribute, which reads the PROP, not the merged option — those keep passing untouched; check before editing anything).

- [ ] **Step 5: Commit**

```bash
git add src/components/EChart.tsx src/components/EChart.test.tsx
git commit -m "feat(charts): animated zoom-window fast path; entrance-only suppression on cached paints"
```

---

### Task 4: Wire the six zoomable charts

**Files:**
- Modify: `src/pages/NetWorthPage.tsx` (stacked + drill charts)
- Modify: `src/pages/SpendingPage.tsx` (bars + savings + trend charts)
- Modify: `src/pages/PortfolioPage.tsx` (performance chart)

- [ ] **Step 1: NetWorthPage.** Extend the timeZoom import to include `resolvedWindow`. Below the `range` state (near the other memos), add:

```tsx
  // Resolved target for EChart's animated zoom path — memoized so the wrapper's
  // fingerprint compare runs only when the window can actually have moved.
  const zoomWindow = useMemo(
    () => (data === null ? undefined : resolvedWindow(data.months, range)),
    [data, range],
  )
```

Add `zoomWindow={zoomWindow}` to BOTH `<EChart` elements that already carry `onDataZoom={onZoomWindow}` (the stacked chart with `option={stackedOption}` and the drill chart with `option={drillOption}`).

- [ ] **Step 2: SpendingPage.** Same import extension; add:

```tsx
  const zoomWindow = useMemo(
    () => (matrix === null ? undefined : resolvedWindow(matrix.months, range)),
    [matrix, range],
  )
```

Add `zoomWindow={zoomWindow}` to the three `<EChart` elements whose options bake `rangeZoom` (`barsOption`, `savingsOption`, `trendOption` — each already carries `onDataZoom`). The month-detail, flow, and heatmap charts have no dataZoom and gain nothing.

- [ ] **Step 3: PortfolioPage.** Same import extension; add:

```tsx
  const zoomWindow = useMemo(
    () => (history === null ? undefined : resolvedWindow(history.dates, range)),
    [history, range],
  )
```

Add `zoomWindow={zoomWindow}` to the performance `<EChart` (`option={performanceOption}`).

- [ ] **Step 4:** `npx tsc -b && npx vitest run && npx eslint src` — all clean. If a page test's local EChart mock rejects the unknown prop, extend the mock to accept-and-ignore it (or mirror it as an attribute, matching how Plan 1's mocks handle `animateEntrance`) without touching assertions.

- [ ] **Step 5: Commit**

```bash
git add src/pages/NetWorthPage.tsx src/pages/SpendingPage.tsx src/pages/PortfolioPage.tsx
git commit -m "feat(charts): range chips morph — zoomWindow wired on the six zoomable charts"
```

---

### Task 5: Full verification

- [ ] `npx tsc -b` clean; `npx vitest run` fully green; `npx eslint src` clean; `npx vite build` clean; `git status` clean.

---

## Self-review checklist (run before handing back)

- [ ] The fast path is unreachable when: `zoomWindow` undefined, reduced motion, first apply after (re)init, or ANY non-dataZoom option difference. Each leg maps to a test or to the REDUCED_MOTION constant.
- [ ] `lastStrippedRef` resets on chart re-init AND on dispose (a fresh instance must take `setOption` first).
- [ ] The dispatch equality guard reads the chart's RESOLVED window via `getOption()` (the datazoom-mirror idiom at the top of the file), not the incoming option.
- [ ] `zoomWindow` is memoized at every call site.
- [ ] No behavior change for every chart that doesn't pass `zoomWindow` (sankeys, heatmap, calendar-free pages, Projection) beyond entrance suppression now being `animationDuration: 0`.
