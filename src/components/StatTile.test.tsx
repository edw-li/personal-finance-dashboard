import { readFileSync } from 'node:fs'
import path from 'node:path'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hintLabel } from './InfoHint'
import StatTile from './StatTile'

afterEach(cleanup)

// The tile's whole contract is the delta's three redundant channels — GLYPH (which way the
// number moved), COLOUR (whether that move is good) and the caller's WORDS. The pages that
// use it pin their own copy; this file pins the component's rule itself, and in particular
// the one case no page test can reach cheaply: direction and tone DISAGREEING.
function delta(): HTMLElement | null {
  return document.querySelector('.stat-delta')
}

function glyphOf(): string {
  // The glyph rides its own aria-hidden span, so it is addressable apart from the words.
  return delta()?.querySelector('span[aria-hidden="true"]')?.textContent ?? ''
}

describe('StatTile delta glyph', () => {
  it('defaults the glyph to the tone when no direction is given', () => {
    // The common case: up IS good, so one input can drive both channels.
    render(<StatTile label="Net worth" value="$1.00" delta="$10.00 MoM" tone="positive" />)
    expect(glyphOf()).toBe('▲ ')
    expect(delta()?.className).toContain('stat-delta-positive')
  })

  it('defaults a negative tone to the down glyph', () => {
    render(<StatTile label="Portfolio" value="$1.00" delta="-$5.00 today" tone="negative" />)
    expect(glyphOf()).toBe('▼ ')
    expect(delta()?.className).toContain('stat-delta-negative')
  })

  it('draws no glyph at all for a neutral or absent tone', () => {
    // Neutral means "no direction to claim" (a flat day, or a delta that is a standing
    // figure like "$3,600/yr expected") — an arrow there would invent a movement.
    render(<StatTile label="Flat" value="$1.00" delta="$0.00 MoM" tone="neutral" />)
    expect(glyphOf()).toBe('')
    expect(delta()?.textContent).toBe('$0.00 MoM')
    expect(delta()?.className).toContain('stat-delta-neutral')

    cleanup()
    // No tone prop at all falls back to the same neutral class — the delta still renders.
    render(<StatTile label="Dividends" value="$1.00" delta="$3,600.00/yr expected" />)
    expect(glyphOf()).toBe('')
    expect(delta()?.className).toContain('stat-delta-neutral')
  })

  it('sets a unit under the value, small, so a long reading still fits a fifth of the row', () => {
    // The Projection's "Money lasts": the figure big, its unit on a line of its own — read
    // together they are one sentence (2026-09-23 correctness spec §R7).
    render(<StatTile label="Money lasts" value="92.4%" unit="of paths through 2075" />)
    const value = document.querySelector('.stat-value')
    expect(value?.textContent).toBe('92.4% of paths through 2075')
    expect(value?.querySelector('.stat-value-unit')?.textContent?.trim()).toBe('of paths through 2075')
  })

  it('colours a warn tone amber with no glyph — a caution is not a movement', () => {
    // The Projection's "Money lasts" verdict (2026-09-23 spec §R7): borderline reads amber.
    render(<StatTile label="Money lasts" value="82.0% of paths through 2075" delta="In 9 of 10 paths…" tone="warn" />)
    expect(glyphOf()).toBe('')
    expect(delta()?.className).toContain('stat-delta-warn')
  })

  it('draws no glyph for direction "none", whatever the tone says', () => {
    // A verdict is judged, not moved: on track is green without claiming the number rose.
    render(<StatTile label="Money lasts" value="92.0% of paths through 2075" delta="In 9 of 10 paths…" tone="positive" direction="none" />)
    expect(glyphOf()).toBe('')
    expect(delta()?.className).toContain('stat-delta-positive')
    cleanup()
    render(<StatTile label="Money lasts" value="41.0% of paths through 2075" delta="In 9 of 10 paths…" tone="negative" direction="none" />)
    expect(glyphOf()).toBe('')
    expect(delta()?.className).toContain('stat-delta-negative')
  })

  it('lets an explicit UP direction ride a negative tone', () => {
    // Overview's spending tile: the month rose (▲, honest about the number) and that is BAD
    // (red, plus the caller's word "over"). Tone-derived glyphs would print ▼ on a rise.
    render(
      <StatTile
        label="Spending"
        value="$6,000.00"
        delta="over $5,000.00 12-mo avg"
        tone="negative"
        direction="up"
      />,
    )
    expect(glyphOf()).toBe('▲ ')
    expect(delta()?.className).toContain('stat-delta-negative')
  })

  it('lets an explicit DOWN direction ride a positive tone', () => {
    // The mirror: spending fell (▼) and that is GOOD (green, "under").
    render(
      <StatTile
        label="Spending"
        value="$4,000.00"
        delta="under $5,000.00 12-mo avg"
        tone="positive"
        direction="down"
      />,
    )
    expect(glyphOf()).toBe('▼ ')
    expect(delta()?.className).toContain('stat-delta-positive')
  })

  it('hides the glyph from assistive tech and drops the whole row with no delta', () => {
    render(<StatTile label="Net worth" value="$1.00" delta="$10.00 MoM" tone="positive" />)
    // ▲/▼ are decoration: the colour is redundant with the caller's words, and a screen
    // reader announcing "black up-pointing triangle" adds nothing the text does not say.
    expect(delta()?.querySelector('span')?.getAttribute('aria-hidden')).toBe('true')
    // …and the words survive intact beside it (plain attribute/text asserts — this project
    // does not install jest-dom matchers).
    expect(delta()?.textContent).toBe('▲ $10.00 MoM')

    cleanup()
    // A rate is a level, not a movement: no delta prop, no delta node — not an empty one.
    render(<StatTile label="Effective tax" value="24.7%" tone="positive" />)
    expect(delta()).toBeNull()
    expect(screen.getByText('24.7%')).toBeTruthy()
  })
})

// The `hint` prop is how ~40 of the app's ⓘ affordances get placed: pages pass a string,
// the tile puts an InfoHint in the LABEL (never beside the value, where it would compete
// with the figure the tile exists to show).
describe('StatTile hint', () => {
  const HINT = 'Assets minus liabilities from the latest monthly snapshot.'

  it('renders the info button inside the label when a hint is passed', () => {
    render(<StatTile label="Net worth" value="$1.00" hint={HINT} />)
    const button = document.querySelector('.stat-label button.info-hint')
    expect(button).toBeTruthy()
    expect(button?.getAttribute('aria-label')).toBe(hintLabel(HINT))
    // The label's own words survive untouched — the hint adds no text node, so every page
    // test that queries the label by text keeps matching.
    expect(document.querySelector('.stat-label')?.textContent).toBe('Net worth')
    expect(screen.getByText('Net worth')).toBeTruthy()
  })

  it('renders no button at all without a hint', () => {
    // Most tiles are self-explanatory; an empty ⓘ on every one of them would be noise.
    render(<StatTile label="Net worth" value="$1.00" delta="$10.00 MoM" tone="positive" />)
    expect(document.querySelector('.info-hint')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

// The count-up is a FIRST-PAINT flourish (2026-08-27 spec §8): the tile settles into its
// number instead of snapping to it. Three legs have to hold or it does not run at all —
// the caller passing the prop (pages gate it on a fresh, non-cached paint), motion being
// allowed, and rAF existing — and whatever it does on the way, the end state has to be the
// caller's own `value` string, not a formatter's re-rendering of it.
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

    // Past the duration (450ms now — the house clock, spec §11): the override clears and the
    // CALLER's exact string renders.
    act(() => frames[frames.length - 1](500))
    expect(valueEl.textContent).toBe('$100.00')
  })
})

// The badge (2026-09-13 polish §10) is how Overview's and Spending's review state moves off the
// orphan hint line and onto the tile it describes; the nowrap unit is why the (i) can no longer
// wrap onto a line of its own.
describe('StatTile badge and label unit', () => {
  it('renders the badge as a pill after the label and keeps the label text queryable', () => {
    render(<StatTile label="Living spending" value="$4,932.87" badge="Not yet reviewed" hint="Cash outflow this month." />)
    const badge = document.querySelector('.stat-label .stat-badge')
    expect(badge?.textContent).toBe('Not yet reviewed')
    // Every page test that finds a tile by its label keeps working: the text is one node.
    expect(screen.getByText('Living spending')).toBeTruthy()
    // Text and (i) share one nowrap span, so the icon can never wrap alone.
    const unit = document.querySelector('.stat-label-text') as HTMLElement
    expect(unit.textContent).toBe('Living spending')
    expect(unit.querySelector('button.info-hint')).toBeTruthy()
    expect(unit.nextElementSibling).toBe(badge)
  })

  it('renders no badge node without the prop', () => {
    render(<StatTile label="Net worth" value="$1.00" />)
    expect(document.querySelector('.stat-badge')).toBeNull()
    expect(document.querySelector('.stat-label')?.textContent).toBe('Net worth')
  })

  it('pins the CSS: the unit is nowrap and the pill wears --fill at .7rem in the caller’s casing', () => {
    const css = readFileSync(path.join(__dirname, 'panels.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
    expect(css).toContain('.stat-label-text { white-space: nowrap; }')
    expect(css).toMatch(/\.stat-badge \{[^}]*background: var\(--fill\);[^}]*font-size: 0\.7rem;[^}]*text-transform: none;/)
  })
})
