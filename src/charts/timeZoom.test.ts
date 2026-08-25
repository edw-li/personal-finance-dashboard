import { describe, expect, it } from 'vitest'
import { rangeStartIndex, rangeZoom, timeZoom } from './timeZoom'

// 24 first-of-month strings, Jan 2024 … Dec 2025 — the app's month currency.
const MONTHS = Array.from({ length: 24 }, (_, i) => {
  const year = 2024 + Math.floor(i / 12)
  const month = (i % 12) + 1
  return `${year}-${String(month).padStart(2, '0')}-01`
})

describe('rangeStartIndex', () => {
  it('answers 0 for the all preset and for an empty series', () => {
    expect(rangeStartIndex(MONTHS, 'all')).toBe(0)
    expect(rangeStartIndex([], '1y')).toBe(0)
    expect(rangeStartIndex([], 'ytd')).toBe(0)
  })

  it('anchors 1y on the LAST point — thirteen months inclusive', () => {
    // Last is 2025-12-01, cutoff 2024-12-01: index 11, so the window carries Dec 2024
    // through Dec 2025 — the same month a year apart, both ends visible.
    expect(rangeStartIndex(MONTHS, '1y')).toBe(11)
  })

  it('cuts ytd at January 1 of the last point year', () => {
    expect(rangeStartIndex(MONTHS, 'ytd')).toBe(12) // 2025-01-01
  })

  it('anchors on the data, not on today — a stale series still shows its own last year', () => {
    // Series ends 2024-06: a today-anchored 1Y would start in the future of this data and
    // show nothing; a data-anchored one starts at 2023-06-01.
    const stale = MONTHS.slice(0, 6).map((m) => m.replace('2024', '2023'))
    const series = [...stale, ...MONTHS.slice(0, 6)] // 2023-01 … 2023-06, 2024-01 … 2024-06
    expect(rangeStartIndex(series, '1y')).toBe(5) // 2023-06-01
  })

  it('falls back to the whole series when the window covers everything', () => {
    expect(rangeStartIndex(MONTHS.slice(18), '1y')).toBe(0) // six months of data, 1y window
    expect(rangeStartIndex(['2025-03-01', '2025-04-01'], 'ytd')).toBe(0)
  })

  it('handles full dates (the weekly performance series) the same way', () => {
    const weekly = ['2025-08-04', '2025-12-29', '2026-03-02', '2026-08-10']
    expect(rangeStartIndex(weekly, '1y')).toBe(1) // cutoff 2025-08-10 — first >= is Dec 29
    expect(rangeStartIndex(weekly, 'ytd')).toBe(2) // cutoff 2026-01-01
  })
})

describe('timeZoom', () => {
  it('resolves a preset to one inside zoom starting at the window, ctrl-gated', () => {
    expect(timeZoom(MONTHS, '1y')).toEqual([
      {
        type: 'inside',
        startValue: 11,
        // Bare wheel must keep scrolling the PAGE — zooming is opt-in via ctrl.
        zoomOnMouseWheel: 'ctrl',
        moveOnMouseWheel: false,
      },
    ])
  })
})

describe('rangeZoom', () => {
  it('is exactly the preset zoom when no manual window is mirrored', () => {
    expect(rangeZoom(MONTHS, { preset: '1y' })).toEqual(timeZoom(MONTHS, '1y'))
  })

  it('layers a mirrored {startValue, endValue} window over the preset', () => {
    const [zoom] = rangeZoom(MONTHS, { preset: '1y', window: { startValue: 2, endValue: 5 } })
    expect(zoom.startValue).toBe(2)
    expect(zoom.endValue).toBe(5)
    // The inside-zoom contract itself is untouched — chips still cover presets, the
    // wheel stays ctrl-gated.
    expect(zoom.type).toBe('inside')
    expect(zoom.zoomOnMouseWheel).toBe('ctrl')
    expect(zoom.moveOnMouseWheel).toBe(false)
  })

  it('a fresh preset-only state (the chips) snaps the window away', () => {
    // RangeChips hand back {preset} with NO window — that IS the snap-back contract.
    const [snapped] = rangeZoom(MONTHS, { preset: 'all' })
    expect(snapped.startValue).toBe(0)
    expect(snapped.endValue).toBeUndefined()
  })
})
