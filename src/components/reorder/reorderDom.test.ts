import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDropLine,
  DROP_LINE_PX,
  dropLineLayer,
  ensureVisible,
  headerBottom,
  keepOnScreen,
  listY,
  placeDropLine,
  scrollParentOf,
  scrollView,
  sideClipsOf,
  stickyHeaderOf,
  stickyInset,
  unitExtent,
  viewportDelta,
  visibleBounds,
  visibleSpan,
} from './reorderDom'
import type { ListFrame } from './reorderDom'

/** A page-scrolled list's frame: no scroller, no sticky header, nothing clipping it sideways. */
const PAGE: ListFrame = { scroller: null, header: [], clips: [] }

function rect(top: number, height: number, left = 0, width = 100): DOMRect {
  return {
    top,
    height,
    bottom: top + height,
    left,
    right: left + width,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

/** A 420px box scrolled 200px into a table whose header is 46px tall, as settings.css draws it
 *  (`.settings-scroll thead th { position: sticky; top: 0 }`). `sticks` says what sticks: the
 *  header CELLS (the house rule), the thead itself, or nothing. What sticks sits at the box's top;
 *  what does not stands where the header began, scrolled 200px above it. */
function scrolledTable(boxTop: number, sticks: 'cells' | 'thead' | 'nothing'): HTMLElement {
  const sticky = ' style="position: sticky; top: 0"'
  document.body.innerHTML =
    `<div id="box" style="overflow-y: auto"><table><thead${sticks === 'thead' ? sticky : ''}>` +
    `<tr><th${sticks === 'cells' ? sticky : ''}></th><th${sticks === 'cells' ? sticky : ''}>Name</th></tr>` +
    '</thead><tbody><tr><td>x</td><td>y</td></tr></tbody></table></div>'
  const box = document.getElementById('box') as HTMLElement
  box.getBoundingClientRect = () => rect(boxTop, 420)
  const stuck = rect(boxTop, 46)
  const away = rect(boxTop - 200, 46)
  const head = box.querySelector('thead') as HTMLElement
  head.getBoundingClientRect = () => (sticks === 'thead' ? stuck : away)
  box.querySelectorAll('th').forEach((th) => {
    th.getBoundingClientRect = () => (sticks === 'nothing' ? away : stuck)
  })
  return box
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

  it("an element's band starts below its sticky header: rows under the header are not seen", () => {
    const band = (box: HTMLElement) => visibleBounds(box, stickyHeaderOf(box))
    expect(band(scrolledTable(120, 'cells'))).toEqual({ top: 166, bottom: 540 })
    expect(band(scrolledTable(120, 'thead'))).toEqual({ top: 166, bottom: 540 })
    // A header that does not stick scrolled away with its rows: the band is the whole box.
    expect(band(scrolledTable(120, 'nothing'))).toEqual({ top: 120, bottom: 540 })
  })

  it('the header counts only where the window shows it', () => {
    const band = (box: HTMLElement) => visibleBounds(box, stickyHeaderOf(box))
    expect(band(scrolledTable(-20, 'cells'))).toEqual({ top: 26, bottom: 400 })
    expect(band(scrolledTable(-100, 'cells'))).toEqual({ top: 0, bottom: 320 })
  })
})

describe('stickyHeaderOf / headerBottom / stickyInset', () => {
  it('finds what sticks — the cells, the house rule — and measures THEM: the thead keeps its box where the header began', () => {
    // The thead's rect is still 200px above the box (scrolled away); the cells stand at its top.
    const box = scrolledTable(120, 'cells')
    const header = stickyHeaderOf(box)
    expect(header).toEqual([...box.querySelectorAll('th')])
    expect(headerBottom(header)).toBe(166)
    expect(stickyInset(box, header)).toBe(46)
  })

  it('finds a thead that sticks itself', () => {
    const box = scrolledTable(120, 'thead')
    const header = stickyHeaderOf(box)
    expect(header).toEqual([box.querySelector('thead')])
    expect(headerBottom(header)).toBe(166)
    expect(stickyInset(box, header)).toBe(46)
  })

  it('reads where the header stands NOW — found once, measured every time', () => {
    const box = scrolledTable(120, 'cells')
    const header = stickyHeaderOf(box)
    box.getBoundingClientRect = () => rect(90, 420) // the page scrolled 30px: the box and its header rose
    box.querySelectorAll('th').forEach((th) => {
      th.getBoundingClientRect = () => rect(90, 46)
    })
    expect(headerBottom(header)).toBe(136)
    expect(visibleBounds(box, header)).toEqual({ top: 136, bottom: 510 })
  })

  it('is empty — no bottom, an inset of 0 — without a sticky header, and for the page', () => {
    expect(stickyHeaderOf(scrolledTable(120, 'nothing'))).toEqual([])
    expect(headerBottom([])).toBeNull()
    expect(stickyInset(scrolledTable(120, 'nothing'), [])).toBe(0)
    expect(stickyHeaderOf(document.createElement('div'))).toEqual([])
    expect(stickyHeaderOf(null)).toEqual([])
    expect(stickyInset(null, [])).toBe(0)
  })
})

describe('scrollView', () => {
  it("is what a scroller shows in list coordinates: the page's scroll and viewport, an element's offset and client height", () => {
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(250)
    expect(scrollView(null)).toEqual({ top: 250, height: window.innerHeight })
    const scroller = document.createElement('div')
    setBox(scroller, { scrollTop: 80, clientHeight: 420 })
    expect(scrollView(scroller)).toEqual({ top: 80, height: 420 })
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

  it('keeps the unit clear of the edge zone BELOW a sticky header — never parked under it', () => {
    const scroller = scrolledTable(120, 'cells') // a 46px header over a 400px view
    const header = stickyHeaderOf(scroller)
    setBox(scroller, { clientHeight: 400, scrollTop: 300 })
    ensureVisible(scroller, 320, 40, header) // top 320 above 300 + 46 + 40 → up by 66
    expect(scroller.scrollTop).toBe(234)
    ensureVisible(scroller, 330, 40, header) // clear of the header's zone now: stays
    expect(scroller.scrollTop).toBe(234)
    ensureVisible(scroller, 700, 40, header) // the bottom zone is unchanged: 740 past 234 + 400 − 40 → down 146
    expect(scroller.scrollTop).toBe(380)
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

describe('sideClipsOf / visibleSpan', () => {
  it("is the box clipped to the window when nothing clips it sideways", () => {
    const row = document.createElement('tr')
    document.body.append(row)
    expect(sideClipsOf(row)).toEqual([])
    expect(visibleSpan(rect(200, 40, -10, 1200), [])).toEqual({ left: 0, right: window.innerWidth })
    expect(visibleSpan(rect(200, 40, 40, 600), [])).toEqual({ left: 40, right: 640 })
  })

  it('stops at an ancestor that actually scrolls sideways (a wide ledger in .holdings-scroll) — where it stands now', () => {
    document.body.innerHTML =
      '<div id="wrap" style="overflow-x: auto"><table><tbody><tr id="row"><td>x</td></tr></tbody></table></div>'
    const wrap = document.getElementById('wrap') as HTMLElement
    wrap.getBoundingClientRect = () => rect(180, 400, 100, 600)
    Object.defineProperty(wrap, 'clientWidth', { value: 600, configurable: true })
    Object.defineProperty(wrap, 'scrollWidth', { value: 1400, configurable: true })
    const row = document.getElementById('row') as HTMLElement
    const clips = sideClipsOf(row)
    expect(clips).toEqual([wrap])
    expect(visibleSpan(rect(200, 40, 100, 1400), clips)).toEqual({ left: 100, right: 700 })
    wrap.getBoundingClientRect = () => rect(180, 400, 60, 600) // moved: its rect is read each time
    expect(visibleSpan(rect(200, 40, 60, 1400), clips)).toEqual({ left: 60, right: 660 })
    // The same box with nothing to scroll clips nothing: the row fits inside it.
    Object.defineProperty(wrap, 'scrollWidth', { value: 600, configurable: true })
    expect(sideClipsOf(row)).toEqual([])
  })
})

describe('the drop line', () => {
  it('is one hidden, aria-hidden overlay on <body> until it is placed', () => {
    document.body.innerHTML = '<ul><li id="row">x</li></ul>'
    const line = createDropLine(document.getElementById('row') as HTMLElement)
    expect(line.parentElement).toBe(document.body)
    expect(line.className).toBe('reorder-drop-line')
    expect(line.getAttribute('aria-hidden')).toBe('true')
    expect(line.hidden).toBe(true)
    expect(line.style.zIndex).toBe('3')
  })

  it("stands one layer above its list: over the row in hand (2) in the page, over the popover a list sits in (20)", () => {
    document.body.innerHTML =
      '<div class="page"><ul><li id="page-row">x</li></ul>' +
      '<div style="position: absolute; z-index: 20"><fieldset><div id="popover-row">y</div></fieldset></div>' +
      // A z-index on a box that is not positioned makes no layer: it is not counted.
      '<div style="z-index: 40"><div id="static-row">z</div></div></div>'
    expect(dropLineLayer(document.getElementById('page-row') as HTMLElement)).toBe(3)
    expect(dropLineLayer(document.getElementById('popover-row') as HTMLElement)).toBe(21)
    expect(dropLineLayer(document.getElementById('static-row') as HTMLElement)).toBe(3)
    expect(createDropLine(document.getElementById('popover-row') as HTMLElement).style.zIndex).toBe('21')
  })

  it('sits centred on the edge it marks — a row top for "before", a row bottom for "after" — as wide as the row', () => {
    const row = document.createElement('tr')
    document.body.append(row)
    const line = createDropLine(row)
    row.getBoundingClientRect = () => rect(300, 40, 24, 900)
    placeDropLine(line, row, 'before', PAGE)
    expect(line.hidden).toBe(false)
    expect([line.style.top, line.style.left, line.style.width]).toEqual([
      `${300 - DROP_LINE_PX / 2}px`,
      '24px',
      '900px',
    ])
    placeDropLine(line, row, 'after', PAGE)
    expect(line.style.top).toBe(`${340 - DROP_LINE_PX / 2}px`)
  })

  it("hides while the edge is outside the band the reader sees of the scroller — under its sticky header, or past the window", () => {
    const box = scrolledTable(120, 'cells') // the band: 166..540
    const row = box.querySelector('tbody tr') as HTMLElement
    const frame: ListFrame = { scroller: box, header: stickyHeaderOf(box), clips: [] }
    const line = createDropLine(row)
    row.getBoundingClientRect = () => rect(140, 40) // its top under the header, its bottom below it
    placeDropLine(line, row, 'before', frame)
    expect(line.hidden).toBe(true)
    placeDropLine(line, row, 'after', frame)
    expect(line.hidden).toBe(false)
    expect(line.style.top).toBe(`${180 - DROP_LINE_PX / 2}px`)
    // An edge within half the line of the band still draws: half of it shows.
    row.getBoundingClientRect = () => rect(165, 40)
    placeDropLine(line, row, 'before', frame)
    expect(line.hidden).toBe(false)
    row.getBoundingClientRect = () => rect(900, 40) // on a page-scrolled list, past the window's 768px
    placeDropLine(line, row, 'before', PAGE)
    expect(line.hidden).toBe(true)
  })

  it("is as wide as the row SHOWS: clipped by the frame's sideways clips", () => {
    const row = document.createElement('tr')
    const wrap = document.createElement('div')
    wrap.append(row)
    document.body.append(wrap)
    wrap.getBoundingClientRect = () => rect(180, 400, 100, 600)
    Object.defineProperty(wrap, 'clientWidth', { value: 600, configurable: true })
    row.getBoundingClientRect = () => rect(300, 40, 100, 1400)
    const line = createDropLine(row)
    placeDropLine(line, row, 'after', { scroller: null, header: [], clips: [wrap] })
    expect([line.style.left, line.style.width]).toEqual(['100px', '600px'])
  })
})
