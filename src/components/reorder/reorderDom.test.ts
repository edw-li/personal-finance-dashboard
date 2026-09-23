import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ensureVisible,
  keepOnScreen,
  listY,
  scrollParentOf,
  unitExtent,
  viewportDelta,
  visibleBounds,
} from './reorderDom'

function rect(top: number, height: number): DOMRect {
  return {
    top,
    height,
    bottom: top + height,
    left: 0,
    right: 100,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

function setBox(element: HTMLElement, box: { scrollHeight?: number; clientHeight?: number; scrollTop?: number }) {
  for (const [key, value] of Object.entries(box)) {
    Object.defineProperty(element, key, { value, writable: true, configurable: true })
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('scrollParentOf', () => {
  it('finds the nearest ancestor that scrolls vertically, or null for the page', () => {
    document.body.innerHTML =
      '<div id="scroller" style="overflow-y: auto"><table><tbody><tr id="row"><td>x</td></tr></tbody></table></div>'
    const scroller = document.getElementById('scroller') as HTMLElement
    setBox(scroller, { scrollHeight: 900, clientHeight: 420 })
    expect(scrollParentOf(document.getElementById('row'))).toBe(scroller)
    // Same overflow rule, nothing to scroll: the page owns the scroll.
    setBox(scroller, { scrollHeight: 300, clientHeight: 420 })
    expect(scrollParentOf(document.getElementById('row'))).toBeNull()
  })

  it('a 1px overhang is rounding, not a scroller — the page keeps its auto-scroll', () => {
    // A box with only overflow-x: auto (.holdings-scroll, creditcards/matrix.css) computes
    // overflow-y: auto too, and Windows display scaling can round its content 1px taller.
    document.body.innerHTML =
      '<div id="scroller" style="overflow-y: auto"><table><tbody><tr id="row"><td>x</td></tr></tbody></table></div>'
    const scroller = document.getElementById('scroller') as HTMLElement
    setBox(scroller, { scrollHeight: 421, clientHeight: 420 })
    expect(scrollParentOf(document.getElementById('row'))).toBeNull()
    setBox(scroller, { scrollHeight: 422, clientHeight: 420 })
    expect(scrollParentOf(document.getElementById('row'))).toBe(scroller)
  })

  it('an element with no scrolling ancestor answers the page', () => {
    document.body.innerHTML = '<ul><li id="item">x</li></ul>'
    expect(scrollParentOf(document.getElementById('item'))).toBeNull()
    expect(scrollParentOf(null)).toBeNull()
  })
})

describe('listY / unitExtent / visibleBounds', () => {
  it('page coordinates add the window scroll', () => {
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(250)
    expect(listY(null, 100)).toBe(350)
  })

  it('element coordinates are relative to the scroller content', () => {
    const scroller = document.createElement('div')
    scroller.getBoundingClientRect = () => rect(300, 420)
    setBox(scroller, { scrollTop: 80 })
    expect(listY(scroller, 310)).toBe(90)
  })

  it('a unit spans from its first row top to its last row bottom', () => {
    const a = document.createElement('tr')
    a.getBoundingClientRect = () => rect(200, 40)
    const b = document.createElement('tr')
    b.getBoundingClientRect = () => rect(240, 30)
    expect(unitExtent([a, b], null)).toEqual({ top: 200, height: 70 })
    expect(unitExtent([], null)).toEqual({ top: 0, height: 0 })
  })

  it("the page's visible band is the viewport; an element's is its box", () => {
    expect(visibleBounds(null)).toEqual({ top: 0, bottom: window.innerHeight })
    const scroller = document.createElement('div')
    scroller.getBoundingClientRect = () => rect(120, 420)
    expect(visibleBounds(scroller)).toEqual({ top: 120, bottom: 540 })
  })

  it("an element's band stops at the viewport: an auto-scroll zone the pointer cannot reach is no zone", () => {
    const scroller = document.createElement('div')
    scroller.getBoundingClientRect = () => rect(600, 420) // hangs past the bottom of the 768px viewport
    expect(visibleBounds(scroller)).toEqual({ top: 600, bottom: window.innerHeight })
    scroller.getBoundingClientRect = () => rect(-100, 420) // its top scrolled off above the viewport
    expect(visibleBounds(scroller)).toEqual({ top: 0, bottom: 320 })
  })
})

describe('ensureVisible', () => {
  it('scrolls an element scroller the least amount that shows the unit clear of the edge zone', () => {
    const scroller = document.createElement('div')
    setBox(scroller, { clientHeight: 400, scrollTop: 0 })
    ensureVisible(scroller, 500, 40) // bottom 540 past 0 + 400 - 40 → down by 180
    expect(scroller.scrollTop).toBe(180)
    ensureVisible(scroller, 100, 40) // top 100 above 180 + 40 → up by 120
    expect(scroller.scrollTop).toBe(60)
    ensureVisible(scroller, 200, 40) // already clear of both edge zones
    expect(scroller.scrollTop).toBe(60)
  })
})

describe('viewportDelta', () => {
  it('is 0 while the unit sits inside the viewport, clear of both edge zones', () => {
    expect(viewportDelta(100, 200, 800)).toBe(0)
    expect(viewportDelta(40, 760, 800)).toBe(0) // exactly the band [40, 760]
  })

  it('is the least signed scroll that brings the unit in', () => {
    expect(viewportDelta(10, 110, 800)).toBe(-30) // up: its top to the band's top
    expect(viewportDelta(700, 790, 800)).toBe(30) // down: its bottom to the band's bottom
    expect(viewportDelta(-500, -400, 800)).toBe(-540)
    expect(viewportDelta(1200, 1240, 800)).toBe(480)
  })

  it('shows the top of a unit taller than the band', () => {
    expect(viewportDelta(100, 900, 800)).toBe(60)
    expect(viewportDelta(-200, 700, 800)).toBe(-240)
  })

  it('takes its margin', () => {
    expect(viewportDelta(10, 110, 800, 0)).toBe(0)
    expect(viewportDelta(10, 110, 800, 20)).toBe(-10)
  })
})

describe('keepOnScreen', () => {
  it("scrolls the page just enough to show a list-coordinate band of a scroller hanging past the window", () => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    const scroller = document.createElement('div')
    scroller.getBoundingClientRect = () => rect(600, 420) // bottom 1020: past jsdom's 768px window
    setBox(scroller, { scrollTop: 80 })
    keepOnScreen(scroller, 100, 40) // client 620..660: on screen
    expect(scrollBy).not.toHaveBeenCalled()
    keepOnScreen(scroller, 200, 40) // client 720..760: past 768 − 40 → down by 32
    expect(scrollBy).toHaveBeenCalledWith(0, 32)
  })

  it('leaves the page alone when the page is the scroller — ensureVisible already scrolled it', () => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    keepOnScreen(null, 5000, 40)
    expect(scrollBy).not.toHaveBeenCalled()
  })
})
