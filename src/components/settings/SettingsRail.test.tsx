import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsRail from './SettingsRail'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
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
    const band = document.createElement('h2')
    band.id = 'sec-planning'
    band.scrollIntoView = scrollIntoView
    document.body.appendChild(band)
    render(<SettingsRail sectionsReady />)

    fireEvent.click(chip('Planning'))

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
    // Marked by the CLICK, not by the observer: a smooth scroll can outlast the press, and a
    // chip that lights a beat late reads as a dropped click.
    expect(chip('Planning').getAttribute('aria-pressed')).toBe('true')
    band.remove()
  })

  it('does nothing but mark the chip when the band is not on the page', () => {
    render(<SettingsRail sectionsReady />)
    // A section still gated behind a failed settings load has no band to scroll to. The
    // optional call is what keeps that a no-op rather than a crash.
    fireEvent.click(chip('Integrations'))
    expect(chip('Integrations').getAttribute('aria-pressed')).toBe('true')
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
