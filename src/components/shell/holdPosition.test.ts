import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdPosition, inputSince } from './holdPosition'

// Review round 1: a drill holds the chart only for a change the READER made. The page landing on
// a ?month= it arrived with (a new page, Back, a link) comes with no press after the chart drew.
describe('inputSince', () => {
  afterEach(() => vi.restoreAllMocks())

  it('answers whether the reader pressed, pointed or typed after a moment', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const settled = now
    expect(inputSince(settled)).toBe(false)
    now = 1200
    window.dispatchEvent(new Event('pointerdown'))
    expect(inputSince(settled)).toBe(true)
    // A later moment has seen no input yet…
    now = 1500
    expect(inputSince(now)).toBe(false)
    // …until a key or a click.
    now = 1600
    window.dispatchEvent(new Event('keydown'))
    expect(inputSince(1500)).toBe(true)
    now = 1700
    window.dispatchEvent(new Event('click'))
    expect(inputSince(1650)).toBe(true)
  })
})

// 2026-09-23 spec §C10 (charts F1): a chart drill docks a detail panel, the page narrows, text
// above the chart rewraps and the clicked chart used to slide ~350px down under the pointer.
describe('holdPosition', () => {
  let top = 100
  let now = 0
  let el: HTMLElement
  const frames: FrameRequestCallback[] = []
  const flush = () => frames.splice(0).forEach((run) => run(now))

  beforeEach(() => {
    top = 100
    now = 0
    el = document.createElement('section')
    document.body.appendChild(el)
    el.getBoundingClientRect = () => ({ top }) as DOMRect
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((run) => frames.push(run))
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    // Scrolling the page moves the element back up by exactly what was scrolled.
    vi.spyOn(window, 'scrollBy').mockImplementation(((options: ScrollToOptions) => {
      top -= options.top ?? 0
    }) as typeof window.scrollBy)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    el.remove()
    frames.length = 0
  })

  it('scrolls by however far the element moved, frame after frame, until the hold ends', () => {
    holdPosition(el, 500)
    top = 466 // the dock narrowed the page and the text above rewrapped
    flush()
    expect(window.scrollBy).toHaveBeenLastCalledWith({ top: 366, behavior: 'instant' })
    expect(top).toBe(100) // back where the reader left it
    // The margin keeps transitioning: each frame corrects what moved since.
    top = 120
    now = 200
    flush()
    expect(window.scrollBy).toHaveBeenLastCalledWith({ top: 20, behavior: 'instant' })
    now = 600
    flush()
    expect(frames).toHaveLength(0) // time is up: no further frame is asked for
  })

  it("never scrolls for a still element, and lets go on the reader's own input", () => {
    holdPosition(el, 500)
    flush()
    expect(window.scrollBy).not.toHaveBeenCalled()
    // Their wheel, key or pointer always wins over ours.
    window.dispatchEvent(new Event('wheel'))
    top = 300
    flush()
    expect(window.scrollBy).not.toHaveBeenCalled()
  })

  it('is a no-op without an element, and stops once the element leaves the page', () => {
    holdPosition(null)
    expect(frames).toHaveLength(0)
    holdPosition(el, 500)
    el.remove()
    top = 300
    flush()
    expect(window.scrollBy).not.toHaveBeenCalled()
  })

  it('can be cancelled by whoever started it', () => {
    const cancel = holdPosition(el, 500)
    cancel()
    top = 300
    flush()
    expect(window.scrollBy).not.toHaveBeenCalled()
  })

  // Review round 1: a scrollbar drag fires no input event, and a restore or a focus scroll is not
  // the reader's either — the window moving anywhere the hold did not put it means someone else is
  // scrolling, and the hold gets out of the way.
  describe('yielding to scrolls it did not make', () => {
    let y = 0
    beforeEach(() => {
      y = 400
      Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y })
      vi.mocked(window.scrollBy).mockImplementation(((options: ScrollToOptions) => {
        y += options.top ?? 0
        top -= options.top ?? 0
      }) as typeof window.scrollBy)
    })
    afterEach(() => {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 0, writable: true })
    })

    it('keeps correcting after its own scrolls, and lets go the moment another one moves the page', () => {
      holdPosition(el, 500)
      top = 160
      flush()
      expect(window.scrollBy).toHaveBeenCalledTimes(1) // its own correction: y 400 → 460
      top = 130
      now = 100
      flush()
      expect(window.scrollBy).toHaveBeenCalledTimes(2) // still holding after its own move
      // A scrollbar drag: the window moves, no event says so.
      y += 250
      top -= 250
      now = 200
      flush()
      expect(window.scrollBy).toHaveBeenCalledTimes(2)
      expect(frames).toHaveLength(0)
    })

    it('switches scroll anchoring off on the root while any hold runs, and back on after the last', () => {
      document.documentElement.style.overflowAnchor = ''
      const first = holdPosition(el, 500)
      const second = holdPosition(el, 500)
      // Chromium's own anchoring would move the page during the reflow — a departure the hold did
      // not make, and the hold's job anyway.
      expect(document.documentElement.style.overflowAnchor).toBe('none')
      first()
      expect(document.documentElement.style.overflowAnchor).toBe('none')
      second()
      expect(document.documentElement.style.overflowAnchor).toBe('')
    })
  })
})
