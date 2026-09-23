import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { EASE_OUT, MOTION_MS } from '../../theme/motion'
import { prefersReducedMotion } from '../useReducedMotion'
import { holdPosition } from './holdPosition'
import { LocalSectionVisibility } from './localSectionContext'
import './localSections.css'

export interface LocalSection<T extends string> { id: T; label: string; badge?: ReactNode }
export interface LegacySectionLocation { pathname: string; searchParams: URLSearchParams; hash: string }
export interface LocalSectionState<T extends string> {
  section: T
  sections: readonly LocalSection<T>[]
  setSection: (section: T, options?: { replace?: boolean; removeParams?: string[] }) => void
  panelId: (section: T) => string
  tabId: (section: T) => string
}

/** The explicit section wins over carried legacy parameters. Missing/invalid sections
 * can be resolved from old holding, what-if, editor, and Settings-anchor links. */
export function useLocalSections<T extends string>(sections: readonly LocalSection<T>[], defaultSection: T, options: {
  resolveLegacy?: (location: LegacySectionLocation) => T | { section: T; targetId?: string } | null | undefined
} = {}): LocalSectionState<T> {
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const id = useId()
  const positions = useRef(new Map<string, number>())
  const priorLocation = useRef(location.key)
  const priorSection = useRef<string | null>(null)
  const params = new URLSearchParams(location.search)
  const explicit = params.get('section')
  const legacy = options.resolveLegacy?.({ pathname: location.pathname, searchParams: params, hash: location.hash })
  const legacySection = typeof legacy === 'object' && legacy !== null ? legacy.section : legacy
  const explicitSection = sections.find((item) => item.id === explicit)?.id
  const inferredSection = sections.find((item) => item.id === legacySection)?.id
  const [arrival, setArrival] = useState<{ key: string; pathname: string; section: T }>({ key: location.key, pathname: location.pathname, section: explicitSection ?? inferredSection ?? defaultSection })
  // Legacy arrival hooks consume their parameter with replace(). Preserve the section
  // inferred before consumption; a deliberate new address or Back to a bare page still
  // gets that address's default. No competing URL write can clobber useScope's params.
  const remembered = arrival.pathname === location.pathname && (arrival.key === location.key || navigationType === 'REPLACE') ? arrival.section : undefined
  const section = explicitSection ?? inferredSection ?? remembered ?? defaultSection
  if (arrival.key !== location.key || arrival.pathname !== location.pathname) setArrival({ key: location.key, pathname: location.pathname, section })
  const legacyTarget = typeof legacy === 'object' && legacy !== null && legacy.section === section ? legacy.targetId : undefined
  const targetId = legacyTarget ?? (legacySection === section && location.hash ? safeHash(location.hash) : undefined)

  const setSection = useCallback((next: T, opts?: { replace?: boolean; removeParams?: string[] }) => {
    if (!sections.some((item) => item.id === next) || (next === section && !opts?.removeParams?.length)) return
    positions.current.set(section, window.scrollY)
    const nextParams = new URLSearchParams(location.search)
    opts?.removeParams?.forEach((key) => nextParams.delete(key))
    nextParams.set('section', next)
    navigate({ pathname: location.pathname, search: `?${nextParams.toString()}`, hash: location.hash }, { replace: opts?.replace, preventScrollReset: true })
  }, [sections, section, location.pathname, location.search, location.hash, navigate])

  // The landed deep link's hold, released by a real navigation or the page going away — never by
  // an effect re-run as such (code review 8).
  const landedHold = useRef<(() => void) | null>(null)
  useEffect(() => () => landedHold.current?.(), [])

  useEffect(() => {
    const keyChanged = priorLocation.current !== location.key
    // null on the first run: the page's arrival is Layout's business, not a section change.
    const sectionChanged = priorSection.current !== null && priorSection.current !== section
    priorLocation.current = location.key
    priorSection.current = section
    // An arrival hook consuming its ?param replaces the entry right after a deep link lands. That
    // is not a navigation — the reader is still on the link — so the landing stays held and is not
    // made twice. A new section, a PUSH or a POP is one, and lets go.
    const arrivalReplace = keyChanged && !sectionChanged && navigationType === 'REPLACE'
    if ((keyChanged || sectionChanged) && !arrivalReplace) {
      landedHold.current?.()
      landedHold.current = null
    }
    let observer: MutationObserver | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    const focusTarget = () => {
      if (!targetId) return false
      const target = document.getElementById(targetId)
      if (!target || target.closest('[hidden]')) return false
      target.scrollIntoView?.({ block: 'start', behavior: 'instant' })
      if (landsUnderOpeningScrim(target)) window.scrollTo({ top: 0, behavior: 'instant' })
      // A deep link lands mid-entrance, and scrollIntoView measures the TRANSFORMED box: a card
      // landed clear of the top scrim, then rose 22px with the page's entrance and came to rest
      // under it (2026-09-23 spec §C11). Held from here, it stays where it landed.
      landedHold.current?.()
      landedHold.current = holdPosition(target)
      if (!target.hasAttribute('tabindex') && !target.matches('input,button,select,textarea,a[href]')) target.setAttribute('tabindex', '-1')
      target.focus({ preventScroll: true })
      observer?.disconnect()
      if (timeout) clearTimeout(timeout)
      return true
    }
    const frame = requestAnimationFrame(() => {
      if (targetId) {
        // Already landed, and the address only lost its arrival param: nothing to land again.
        if (arrivalReplace && landedHold.current !== null) return
        if (!focusTarget() && typeof MutationObserver !== 'undefined') {
          observer = new MutationObserver(focusTarget)
          observer.observe(document.body, { childList: true, subtree: true })
          timeout = setTimeout(() => observer?.disconnect(), 5000)
        }
      } else if (sectionChanged || (keyChanged && navigationType === 'POP')) {
        // Keep the reader's place (2026-09-23 spec §C10, charts F1): only a new SECTION or a
        // Back/Forward moves the page. A search-param write on the same section — a range or
        // owner chip, the month ribbon, a chart drill — used to land here too and restore the
        // section's remembered depth, 0 by default, throwing the reader to the top (600 → 0).
        let saved: string | null = null
        if (navigationType === 'POP') {
          try { saved = sessionStorage.getItem(`scroll:${location.key}`) } catch { /* Browser memory remains available when storage is blocked. */ }
        }
        // A POP onto an entry never scrolled in has no record: the same section keeps its depth
        // (it IS that page), another section takes that section's own memory.
        const target = saved !== null ? Number(saved) : sectionChanged ? (positions.current.get(section) ?? 0) : null
        if (target !== null && window.scrollY !== target) window.scrollTo({ top: Number.isFinite(target) ? target : 0, behavior: 'instant' })
      }
    })
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); if (timeout) clearTimeout(timeout) }
  }, [location.key, section, targetId, navigationType])

  return { section, sections, setSection, panelId: (value) => `${id}-section-${value}`, tabId: (value) => `${id}-tab-${value}` }
}

/**
 * Whether a deep link's landing left its target under the top scrim in the page's opening screen
 * (2026-09-23 spec §C11). A card near the top of the body cannot reach the snap line: the landing
 * stops before PageFrame's scope row sticks, and there the scrim — arrived over the first
 * --scrim-h of scroll, sitting on the body's top until the row sticks — lies across the very card
 * the link named (/guide#routine-monthly: 44px down, the fade over its top 32px). The page's top
 * shows the same card with no scrim at all, so that is where it lands — unless the card sits so
 * low (a short page scrolled to its end) that the top would hide it. Reduced motion has no scrims.
 */
function landsUnderOpeningScrim(target: HTMLElement): boolean {
  if (window.scrollY <= 0 || prefersReducedMotion()) return false
  const row = target.closest('.page-frame-body')?.parentElement?.querySelector(':scope > .page-frame-scope')
  // A stuck row (top 0) means the landing reached the snap line, below the scrim.
  if (!row || row.getBoundingClientRect().top <= 0) return false
  return target.getBoundingClientRect().top + window.scrollY < window.innerHeight / 2
}

function safeHash(hash: string): string | undefined {
  try { return decodeURIComponent(hash.replace(/^#/, '')) || undefined } catch { return undefined }
}

/** What the strip tells `onChange` about HOW a view was picked: a keyboard sweep replaces the
 *  history entry, a click pushes one (2026-09-13 polish §2.4 — five arrow presses used to leave
 *  five entries). Pages that add their own params spread it into `setSection`'s options. */
export type LocalSectionChangeOptions = { replace?: boolean }

export function LocalSectionNav<T extends string>({ state, label, onChange, trailing }: {
  state: LocalSectionState<T>
  label: string
  onChange?: (section: T, options?: LocalSectionChangeOptions) => void
  /** Right-aligned on the strip's own line (Net worth's Monthly/Quarterly Segmented). */
  trailing?: ReactNode
}) {
  const change = onChange ?? state.setSection
  const listRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  // Whether a measurement has been committed. The FIRST placement is where the bar LIVES, not a
  // move (Layout.tsx's nav-indicator idiom): data-placed goes on from the second placement, and
  // localSections.css hangs the transition on that attribute.
  const placedRef = useRef(false)
  useLayoutEffect(() => {
    const place = () => {
      const list = listRef.current
      const bar = indicatorRef.current
      if (list === null || bar === null) return
      const tab = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      if (tab === null) { bar.style.width = '0px'; return }
      if (placedRef.current) bar.dataset.placed = ''
      bar.style.width = `${tab.offsetWidth}px`
      // The y term is 0 on a one-row strip; when the tabs wrap it lifts the bar to the selected
      // tab's own row instead of leaving it under the last one.
      bar.style.transform = `translate(${tab.offsetLeft}px, ${tab.offsetTop + tab.offsetHeight - list.offsetHeight}px)`
      placedRef.current = true
    }
    place()
    // Tabs move without the section changing — a wrap, the density toggle, a badge landing.
    // Guarded for jsdom and old browsers: without it the bar waits for the next activation.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => place())
    if (listRef.current !== null) observer?.observe(listRef.current)
    return () => observer?.disconnect()
  }, [state.section, state.sections])
  return <nav className="local-section-nav" aria-label={label}>
    <div ref={listRef} role="tablist" aria-label={label}>
      {/* Decorative: aria-selected already says which tab is current. */}
      <span ref={indicatorRef} className="local-section-indicator" aria-hidden="true" />
      {state.sections.map((item, index) => <button key={item.id} type="button" role="tab" id={state.tabId(item.id)} aria-controls={state.panelId(item.id)} aria-selected={item.id === state.section} tabIndex={item.id === state.section ? 0 : -1} onClick={() => change(item.id, undefined)} onKeyDown={(event) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
        const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? state.sections.length - 1 : step ? (index + step + state.sections.length) % state.sections.length : null
        if (nextIndex === null) return
        event.preventDefault()
        const next = state.sections[nextIndex].id
        change(next, { replace: true })
        document.getElementById(state.tabId(next))?.focus({ preventScroll: true })
      }}>{item.label}{item.badge !== undefined && <span>{item.badge}</span>}</button>)}
    </div>
    {trailing !== undefined && <div className="local-section-trailing">{trailing}</div>}
  </nav>
}

/** Unopened views mount lazily. Visited editors stay mounted by default so their local
 * validation, draft and preview state survive switching to Summary and back. */
export function LocalSectionPanel<T extends string>({ state, section, children, keepMounted = true, className }: {
  state: LocalSectionState<T>
  section: T
  children: ReactNode
  keepMounted?: boolean
  className?: string
}) {
  const active = state.section === section
  const [visited, setVisited] = useState(active)
  if (active && !visited) setVisited(true)
  const ref = useRef<HTMLElement>(null)
  // The view swap is one panel-level fade, not a second card cascade (2026-09-13 polish §2.4).
  // WAAPI rather than a CSS animation because a kept-mounted panel only toggles `hidden`, and a
  // CSS animation would not restart. A LAYOUT effect: it runs in the commit that cleared
  // `hidden`, so the first frame the panel is visible is already the fade's first frame. The
  // component instance exists from page arrival (an inactive panel renders null, not nothing),
  // so the first effect run IS the arrival — the initially active section does not animate; the
  // page body's own entrance already covers it — and every later activation, first visit or
  // revisit, does.
  const arrivalRef = useRef(true)
  useLayoutEffect(() => {
    const arrival = arrivalRef.current
    arrivalRef.current = false
    if (!active || arrival) return
    const el = ref.current
    if (el === null || prefersReducedMotion() || typeof el.animate !== 'function') return
    el.animate(
      [{ opacity: 0, translate: '0 6px' }, { opacity: 1, translate: 'none' }],
      { duration: MOTION_MS.xfade, easing: EASE_OUT, fill: 'backwards' },
    )
  }, [active])
  if (!active && (!keepMounted || !visited)) return null
  return <LocalSectionVisibility.Provider value={active}><section ref={ref} id={state.panelId(section)} role="tabpanel" aria-labelledby={state.tabId(section)} hidden={!active} className={`local-section-panel${className ? ` ${className}` : ''}`}>{children}</section></LocalSectionVisibility.Provider>
}
