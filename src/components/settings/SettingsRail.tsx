import { useEffect, useState } from 'react'
import Segmented from '../shell/Segmented'
import '../panels.css'
import './settings.css'

// The Settings chip rail (2026-09-06 spec §3.2). It rides PageFrame's scopeRow, so it is
// sticky and measured into --sticky-inset for free; the bands carry the matching
// scroll-margin-top (settings.css) so a chip lands its section BELOW the pinned row.
export const RAIL_SECTIONS = [
  { value: 'sec-household', label: 'Household' },
  { value: 'sec-planning', label: 'Planning' },
  { value: 'sec-account', label: 'Account' },
  { value: 'sec-integrations', label: 'Integrations' },
  { value: 'sec-data', label: 'Data' },
] as const

export type RailSection = (typeof RAIL_SECTIONS)[number]['value']

/** The line a band has to cross to become current: the viewport's upper third. */
const UPPER_THIRD = 1 / 3

export default function SettingsRail({ sectionsReady }: { sectionsReady: boolean }) {
  const [active, setActive] = useState<RailSection>('sec-household')

  // Keyed on `sectionsReady`, not on mount: the bands land in the commit AFTER this row (they
  // live behind the page's loadedOnce gates), so an observer set up at mount would find
  // nothing to watch and the chip would never follow the scroll.
  useEffect(() => {
    if (!sectionsReady || typeof IntersectionObserver === 'undefined') return
    const bands = RAIL_SECTIONS.map((s) => document.getElementById(s.value)).filter(
      (el): el is HTMLElement => el !== null,
    )
    if (bands.length === 0) return
    // The entries say which band CROSSED the line; the active chip is a fact about all five
    // (the lowest one still at or above it), so the callback re-measures rather than trusting
    // whichever band happened to move.
    const mark = () => {
      const line = window.innerHeight * UPPER_THIRD
      let current: RailSection = RAIL_SECTIONS[0].value
      for (const section of RAIL_SECTIONS) {
        const el = document.getElementById(section.value)
        if (el !== null && el.getBoundingClientRect().top <= line) current = section.value
      }
      setActive(current)
    }
    const observer = new IntersectionObserver(mark, {
      rootMargin: `0px 0px -${Math.round((1 - UPPER_THIRD) * 100)}% 0px`,
    })
    for (const el of bands) observer.observe(el)
    return () => observer.disconnect()
  }, [sectionsReady])

  const go = (next: RailSection) => {
    // Set directly rather than waiting on the observer: a smooth scroll can take longer than
    // the click feels, and a chip that lights late reads as a dropped press.
    setActive(next)
    // Optional-call, the house idiom: jsdom has no scrollIntoView, and a section still gated
    // behind a failed load has no band to scroll to.
    document.getElementById(next)?.scrollIntoView?.({ block: 'start' })
  }

  return (
    <Segmented
      variant="chips"
      ariaLabel="Settings sections"
      value={active}
      onChange={go}
      options={RAIL_SECTIONS.map((s) => ({ value: s.value, label: s.label }))}
    />
  )
}
