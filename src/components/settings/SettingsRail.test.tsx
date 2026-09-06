import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsRail, { RAIL_SECTIONS } from './SettingsRail'

// The bands this file plants by hand, and the viewport numbers the scroll-spy measures
// against: jsdom lays nothing out, so every rect and every scroll figure has to be stated.
const planted: HTMLElement[] = []

function plant(...ids: string[]): HTMLElement[] {
  const made = ids.map((id) => {
    const el = document.createElement('h2')
    el.id = id
    document.body.appendChild(el)
    planted.push(el)
    return el
  })
  return made
}

/** Where the band's top edge sits in the viewport. jsdom's own rect is all zeros, which would
 *  put every band above the line at once. */
function topAt(el: HTMLElement, top: number): void {
  el.getBoundingClientRect = () => ({ top }) as DOMRect
}

function pageOf(scrollHeight: number, scrollY: number): void {
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    value: scrollHeight,
    configurable: true,
  })
  Object.defineProperty(window, 'scrollY', { value: scrollY, configurable: true })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  for (const el of planted) el.remove()
  planted.length = 0
  Reflect.deleteProperty(document.documentElement, 'scrollHeight')
  Reflect.deleteProperty(window, 'scrollY')
})

const chip = (name: string) => screen.getByRole('button', { name })

describe('SettingsRail', () => {
  it('offers the five sections as chips, the first one active', () => {
    render(<SettingsRail sectionsReady={false} />)
    const rail = screen.getByRole('group', { name: 'Settings sections' })
    expect([...rail.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Household',
      'Planning',
      'Account',
      'Integrations',
      'Data',
    ])
    // Plain buttons, so every chip is in the tab order by default (spec §3.2).
    expect(chip('Household').getAttribute('aria-pressed')).toBe('true')
  })

  it('scrolls the chosen band into view and marks its chip at once', () => {
    const scrollIntoView = vi.fn()
    const [band] = plant('sec-planning')
    band.scrollIntoView = scrollIntoView
    render(<SettingsRail sectionsReady />)

    fireEvent.click(chip('Planning'))

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
    // Marked by the CLICK, not by the observer: a smooth scroll can outlast the press, and a
    // chip that lights a beat late reads as a dropped click.
    expect(chip('Planning').getAttribute('aria-pressed')).toBe('true')
  })

  it('does nothing but mark the chip when the band is not on the page', () => {
    render(<SettingsRail sectionsReady />)
    // A section still gated behind a failed settings load has no band to scroll to. The
    // optional call is what keeps that a no-op rather than a crash.
    fireEvent.click(chip('Integrations'))
    expect(chip('Integrations').getAttribute('aria-pressed')).toBe('true')
  })

  it('lights the FIRST band that is actually on the page, not the first in the list', () => {
    // A settings load that failed leaves only the ungated Account band standing (spec §3.1).
    // A lit Household chip would then point at a section that is not coming.
    plant('sec-account')
    render(<SettingsRail sectionsReady />)
    expect(chip('Account').getAttribute('aria-pressed')).toBe('true')
    expect(chip('Household').getAttribute('aria-pressed')).toBe('false')
  })

  it('marks the lowest band above the line, and the LAST one at the foot of the page', () => {
    // The observer says a band CROSSED the line; the callback is what this test drives, since
    // jsdom has no scrolling to trigger it with.
    const callbacks: (() => void)[] = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: () => void) {
          callbacks.push(callback)
        }
        observe() {}
        disconnect() {}
      },
    )
    const bands = plant(...RAIL_SECTIONS.map((s) => s.value))
    // The line is a third of the way down a 768px jsdom viewport, so 256px: Household and
    // Planning are above it, the other three below.
    const tops = [-400, 100, 600, 900, 1200]
    bands.forEach((el, i) => topAt(el, tops[i]))
    pageOf(5000, 0)

    render(<SettingsRail sectionsReady />)
    act(() => callbacks[0]())
    expect(chip('Planning').getAttribute('aria-pressed')).toBe('true')

    // At the very bottom the last band may never reach the upper third — a short final
    // section physically cannot — so the chip would stick on whatever was above it. The end
    // of the page IS the last section.
    pageOf(5000, 4300)
    act(() => callbacks[0]())
    expect(chip('Data').getAttribute('aria-pressed')).toBe('true')
    expect(chip('Planning').getAttribute('aria-pressed')).toBe('false')
  })

  // jsdom ships no IntersectionObserver: an unguarded `new` would crash every test that
  // renders the Settings page, and a chip must still answer a click without one.
  it('renders and answers clicks where there is no IntersectionObserver at all', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    render(<SettingsRail sectionsReady />)
    fireEvent.click(chip('Data'))
    expect(chip('Data').getAttribute('aria-pressed')).toBe('true')
  })
})
