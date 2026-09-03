import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import InfoHint from './InfoHint'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// The hint is a real disclosure now (2026-09-03 shell spec §13): the authored text still
// rides `aria-label` for screen readers, but the visible bubble is a rendered element —
// so what is pinned here is the pair staying in sync AND the open/pin/dismiss contract
// the CSS-only `::after` could never express (no Escape, no pinning, no edge flip).
const TEXT = 'Assets minus liabilities from the latest monthly snapshot.'

const hintButton = () => screen.getByRole('button', { name: TEXT })
const wrap = () => document.querySelector('.info-hint-wrap') as HTMLElement

describe('InfoHint', () => {
  it('names the button with the text and shows no bubble until it is asked for', () => {
    render(<InfoHint text={TEXT} />)
    const button = hintButton()
    expect(button.getAttribute('aria-label')).toBe(TEXT)
    expect(button.className).toContain('info-hint')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('is type="button" so it never submits a form it sits inside', () => {
    // Hints live in headings and tile labels, but ESPP/Update pages put tiles beside forms;
    // the HTML default (type="submit") would turn a hover affordance into a submit.
    render(<InfoHint text={TEXT} />)
    expect(screen.getByRole('button').getAttribute('type')).toBe('button')
  })

  it('hides the icon from assistive tech and adds no text node to its heading', () => {
    render(<InfoHint text={TEXT} />)
    const button = screen.getByRole('button')
    const icon = button.querySelector('svg')
    // The lucide glyph is decoration — the aria-label already says everything.
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    // …and because the words live in an ATTRIBUTE until the bubble opens, the closed hint
    // contributes no text. This is what lets ~78 hints land in existing headings without
    // breaking a single getByText query.
    expect(button.textContent).toBe('')
    expect(wrap().textContent).toBe('')
  })

  it('click pins the bubble open and describes the button with it', () => {
    render(<InfoHint text={TEXT} />)
    fireEvent.click(hintButton())
    const bubble = screen.getByRole('tooltip')
    expect(bubble.textContent).toBe(TEXT)
    expect(hintButton().getAttribute('aria-expanded')).toBe('true')
    expect(hintButton().getAttribute('aria-describedby')).toBe(bubble.id)
    // Pinned means the pointer can leave: this is the whole point of a click affordance
    // on a bubble whose text is often two lines long.
    fireEvent.mouseOut(wrap())
    expect(screen.getByRole('tooltip')).toBeTruthy()
  })

  it('Escape closes a pinned bubble', () => {
    render(<InfoHint text={TEXT} />)
    fireEvent.click(hintButton())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(hintButton().getAttribute('aria-expanded')).toBe('false')
  })

  it('a second click unpins, so the pointer leaving closes it again', () => {
    render(<InfoHint text={TEXT} />)
    fireEvent.click(hintButton())
    fireEvent.click(hintButton())
    // Still open under the pointer — but no longer pinned, so leaving dismisses it.
    // mouseOut, NOT mouseLeave: React synthesizes onMouseLeave from native mouseout.
    fireEvent.mouseOut(wrap())
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('a mousedown outside dismisses a pinned bubble', () => {
    render(<InfoHint text={TEXT} />)
    fireEvent.click(hintButton())
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('hover opens it after a beat, and leaving before the beat opens nothing', () => {
    vi.useFakeTimers()
    try {
      render(<InfoHint text={TEXT} />)
      // The 150 ms delay is what keeps a pointer CROSSING a row of tiles from strobing
      // three bubbles on its way past.
      fireEvent.mouseOver(wrap())
      fireEvent.mouseOut(wrap())
      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(screen.queryByRole('tooltip')).toBeNull()

      fireEvent.mouseOver(wrap())
      act(() => {
        vi.advanceTimersByTime(149)
      })
      expect(screen.queryByRole('tooltip')).toBeNull()
      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(screen.getByRole('tooltip').textContent).toBe(TEXT)
    } finally {
      vi.useRealTimers()
    }
  })

  it('flips to the left when the bubble would run off the right edge', () => {
    // The old CSS bubble was pinned to `left` and clipped on every right-hand tile.
    // jsdom lays nothing out, so the rect is the input to this decision, stubbed here.
    const rect = (left: number) =>
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        left,
        right: left + 16,
        top: 0,
        bottom: 16,
        width: 16,
        height: 16,
        x: left,
        y: 0,
        toJSON: () => ({}),
      })

    rect(20)
    const { unmount } = render(<InfoHint text={TEXT} />)
    fireEvent.click(hintButton())
    expect(screen.getByRole('tooltip').className).not.toContain('is-flipped')
    unmount()

    // window.innerWidth is jsdom's 1024; a hint 40px from that edge cannot fit a 280px
    // bubble to its right.
    rect(window.innerWidth - 40)
    render(<InfoHint text={TEXT} />)
    fireEvent.click(hintButton())
    expect(screen.getByRole('tooltip').className).toContain('is-flipped')
  })
})
