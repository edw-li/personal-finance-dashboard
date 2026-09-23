import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureVisible, listY, scrollParentOf, unitExtent, visibleBounds } from './reorderDom'

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
