# Hero Stat Count-Up Implementation Plan (Batch Plan 6/6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The four hero stat tiles settle into their number over ~350 ms on a fresh first paint — never on cached paints, revalidations, or under reduced motion — ending on the exact same string they render today.

**Architecture:** `StatTile` gains one additive optional prop `countUp?: { value: number; format: (n: number) => string }`. When present AND motion is allowed AND `requestAnimationFrame` exists, a mount-only rAF loop eases 0 → value rendering `format(current)`; the final frame clears the override so the tile renders the caller's `value` string bit-identically. Pages gate the prop on Plan 1's `fromCache` state, so a cache-seeded paint (already-seen number) renders statically. Deltas and glyphs never animate; `.stat-value` is already tabular monospace, so nothing shifts.

**DEPENDS ON:** Batch Plan 1 (snapshot cache) being merged — the call sites read its `fromCache` state (and Paycheck's `BreakdownPanel` threading mirrors Plan 1's `FlowPanel still` prop).

**Tech Stack:** React 19, vitest + @testing-library/react (plain asserts, no jest-dom).

**Spec:** `docs/superpowers/specs/2026-08-27-navigation-ux-polish-design.md` §8.

---

### Task 1: `StatTile.countUp`

**Files:**
- Modify: `src/components/StatTile.tsx`
- Modify: `src/components/StatTile.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `src/components/StatTile.test.tsx` (keep the file's plain-assert style; `fmt` below is a deterministic stand-in formatter):

```tsx
describe('countUp', () => {
  const fmt = (n: number) => `$${n.toFixed(2)}`

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('without countUp renders the value string as ever', () => {
    render(<StatTile label="Net worth" value="$1,234.00" />)
    expect(screen.getByText('$1,234.00')).toBeTruthy()
  })

  it('under reduced motion renders the final value immediately', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    render(
      <StatTile label="Net worth" value="$100.00" countUp={{ value: 100, format: fmt }} />,
    )
    expect(screen.getByText('$100.00')).toBeTruthy()
  })

  it('animates 0 → value and ends on the exact value string', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.spyOn(performance, 'now').mockReturnValue(0)

    render(
      <StatTile label="Net worth" value="$100.00" countUp={{ value: 100, format: fmt }} />,
    )
    const valueEl = document.querySelector('.stat-value') as HTMLElement
    // First paint starts at the formatted zero — never a flash of the final number.
    expect(valueEl.textContent).toBe('$0.00')

    // Mid-flight: an eased intermediate strictly between 0 and the target.
    act(() => frames[0](175))
    const mid = Number(valueEl.textContent!.replace('$', ''))
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(100)

    // Past the duration: the override clears and the CALLER's exact string renders.
    act(() => frames[frames.length - 1](400))
    expect(valueEl.textContent).toBe('$100.00')
  })
})
```

(Import `act` from `@testing-library/react` and `vi` from vitest alongside the file's existing imports.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/StatTile.test.tsx` (unknown prop → TS error / no animation).

- [ ] **Step 3: Implement**

In `src/components/StatTile.tsx`:

1. Extend the imports:

```tsx
import { useEffect, useRef, useState } from 'react'
```

2. Above the component, add the gate (a FUNCTION, not a module const, so tests can stub `matchMedia` per-case; contrast with EChart's module-scope read, which predates this need):

```tsx
interface CountUp {
  value: number
  format: (n: number) => string
}

// The settle runs only when every leg holds; the useState initializer and the effect
// share this single predicate so the zero-frame can never strand (an initializer that
// showed $0 with no animation coming would freeze there).
function shouldCountUp(countUp: CountUp | undefined): countUp is CountUp {
  return (
    countUp !== undefined &&
    typeof requestAnimationFrame === 'function' &&
    !(
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
  )
}

const COUNT_UP_MS = 350
```

3. Add the prop to the signature (after `hero`):

```tsx
  /** Settle the value from 0 over ~350ms on a FRESH first paint (2026-08-27 spec §8).
   *  Callers gate it themselves (never on cached paints); the final frame renders
   *  `value` exactly. Additive — omitted means today's static render. */
  countUp?: CountUp
```

4. Inside the component, before the `glyph` computation:

```tsx
  // Mount-captured on purpose: the settle is a first-paint flourish, and a later prop
  // (a revalidation's new number) must update the tile directly, not restart the count.
  const countUpRef = useRef(shouldCountUp(countUp) ? countUp : undefined)
  const [display, setDisplay] = useState<string | null>(() =>
    countUpRef.current !== undefined ? countUpRef.current.format(0) : null,
  )
  useEffect(() => {
    const target = countUpRef.current
    if (target === undefined) return
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS)
      if (t >= 1) {
        // Final frame: clear the override — the caller's exact string takes over.
        setDisplay(null)
        return
      }
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(target.format(target.value * eased))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
```

5. Render the override (line 48):

```tsx
      <div className="stat-value">{display ?? value}</div>
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/components/StatTile.test.tsx` — all existing + 3 new PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/StatTile.tsx src/components/StatTile.test.tsx
git commit -m "feat(motion): StatTile countUp — mount-only settle, exact final string"
```

---

### Task 2: Wire the four hero tiles

**Files:**
- Modify: `src/pages/OverviewPage.tsx:309-321`
- Modify: `src/pages/NetWorthPage.tsx:435-449`
- Modify: `src/pages/PortfolioPage.tsx:339-350`
- Modify: `src/pages/PaycheckPage.tsx` (hero at ~86 inside the in-file `BreakdownPanel`, plus its render site)

All four pages carry `fromCache` after Plan 1. The prop is passed ONLY when the paint is fresh; a cached paint gets `undefined` and renders statically.

- [ ] **Step 1: OverviewPage** — the hero at lines 309–321 gains one prop (after `value`):

```tsx
                countUp={
                  !fromCache && summary?.net_worth != null
                    ? { value: summary.net_worth, format: formatCurrency }
                    : undefined
                }
```

- [ ] **Step 2: NetWorthPage** — the hero at lines 435–449 (inside the `summary && summary.month` gate, so `summary` is non-null) gains:

```tsx
              countUp={
                !fromCache ? { value: summary.net_worth, format: formatCurrency } : undefined
              }
```

- [ ] **Step 3: PortfolioPage** — the hero at lines 339–350 (inside the `totals &&` gate) gains:

```tsx
                countUp={
                  !fromCache
                    ? { value: totals.market_value, format: formatCurrency }
                    : undefined
                }
```

- [ ] **Step 4: PaycheckPage** — the hero lives inside the in-file `BreakdownPanel({ data })`. Mirror Plan 1's `FlowPanel still` threading:

1. `BreakdownPanel`'s signature gains `still: boolean` (same shape as `FlowPanel`'s from Plan 1).
2. The hero at ~line 86 gains:

```tsx
            countUp={
              !still ? { value: data.monthly_net, format: formatCurrency } : undefined
            }
```

3. The render site (post-Plan-1 line ~773) becomes:

```tsx
          <BreakdownPanel data={breakdown} still={fromCache} />
```

- [ ] **Step 5: Type-gotcha check.** `formatCurrency` accepts a nullable number and returns a string; contravariance makes it assignable to `(n: number) => string` — if `tsc` disagrees on any site, wrap as `(n: number) => formatCurrency(n)` rather than changing `formatCurrency`.

- [ ] **Step 6: Run** — `npx vitest run src/pages/OverviewPage.test.tsx src/pages/NetWorthPage.test.tsx src/pages/PaycheckPage.test.tsx` + `npx tsc -b`.
Existing hero assertions (`OverviewPage.test.tsx:435-441`, `:469-476`, `:822-824`) query the rendered value — those tests run in jsdom where `requestAnimationFrame` EXISTS, so the count-up initializer WILL fire on fresh-paint renders and the first paint shows `$0.00`, not the final number. Where an existing test asserts the final value synchronously after a fresh load, keep the production behavior and fix the TEST by stubbing reduced motion for that assertion (`vi.stubGlobal('matchMedia', () => ({ matches: true }))` in that test) or by seeding the page's snapshot cache so the paint is cached (fromCache → no count-up). Prefer the cache-seed route where the file already imports `setSnapshot` (Plan 1 added it).

- [ ] **Step 7: Commit**

```bash
git add src/pages/OverviewPage.tsx src/pages/NetWorthPage.tsx src/pages/PortfolioPage.tsx src/pages/PaycheckPage.tsx
git commit -m "feat(motion): hero tiles settle on fresh first paint only"
```

---

### Task 3: Full verification

- [ ] `npx tsc -b` clean; `npx vitest run` fully green; `npx eslint src` clean; `git status` clean.

---

## Self-review checklist (run before handing back)

- [ ] The count-up NEVER runs on: cached paints (`fromCache` gate), reduced motion, missing rAF — and the zero-frame initializer uses the SAME predicate as the effect.
- [ ] The final rendered string is the caller's `value` verbatim (override cleared), not a formatter output.
- [ ] Deltas/glyphs untouched; non-hero tiles untouched; `SummaryPanel`'s documented non-hero rule untouched.
- [ ] Existing hero tests updated per Task 2 Step 6 without weakening what they assert.
