import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdPosition } from './holdPosition'

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
})
