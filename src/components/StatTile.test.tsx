import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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
    expect(button?.getAttribute('aria-label')).toBe(HINT)
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
