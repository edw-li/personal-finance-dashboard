import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
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

  useEffect(() => {
    const changed = priorLocation.current !== location.key
    priorLocation.current = location.key
    let observer: MutationObserver | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    const focusTarget = () => {
      if (!targetId) return false
      const target = document.getElementById(targetId)
      if (!target || target.closest('[hidden]')) return false
      target.scrollIntoView?.({ block: 'start', behavior: 'instant' })
      if (!target.hasAttribute('tabindex') && !target.matches('input,button,select,textarea,a[href]')) target.setAttribute('tabindex', '-1')
      target.focus({ preventScroll: true })
      observer?.disconnect()
      if (timeout) clearTimeout(timeout)
      return true
    }
    const frame = requestAnimationFrame(() => {
      if (targetId) {
        if (!focusTarget() && typeof MutationObserver !== 'undefined') {
          observer = new MutationObserver(focusTarget)
          observer.observe(document.body, { childList: true, subtree: true })
          timeout = setTimeout(() => observer?.disconnect(), 5000)
        }
      } else if (changed) {
        let saved: string | null = null
        try { saved = sessionStorage.getItem(`scroll:${location.key}`) } catch { /* Browser memory remains available when storage is blocked. */ }
        const remembered = navigationType === 'POP' ? Number(saved ?? positions.current.get(section) ?? 0) : positions.current.get(section) ?? 0
        if (window.scrollY !== remembered) window.scrollTo({ top: Number.isFinite(remembered) ? remembered : 0, behavior: 'instant' })
      }
    })
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); if (timeout) clearTimeout(timeout) }
  }, [location.key, section, targetId, navigationType])

  return { section, sections, setSection, panelId: (value) => `${id}-section-${value}`, tabId: (value) => `${id}-tab-${value}` }
}

function safeHash(hash: string): string | undefined {
  try { return decodeURIComponent(hash.replace(/^#/, '')) || undefined } catch { return undefined }
}

export function LocalSectionNav<T extends string>({ state, label, onChange }: { state: LocalSectionState<T>; label: string; onChange?: (section: T) => void }) {
  const change = onChange ?? state.setSection
  return <nav className="local-section-nav" aria-label={label}>
    <div role="tablist" aria-label={label}>
      {state.sections.map((item, index) => <button key={item.id} type="button" role="tab" id={state.tabId(item.id)} aria-controls={state.panelId(item.id)} aria-selected={item.id === state.section} tabIndex={item.id === state.section ? 0 : -1} onClick={() => change(item.id)} onKeyDown={(event) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
        const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? state.sections.length - 1 : step ? (index + step + state.sections.length) % state.sections.length : null
        if (nextIndex === null) return
        event.preventDefault()
        const next = state.sections[nextIndex].id
        change(next)
        document.getElementById(state.tabId(next))?.focus({ preventScroll: true })
      }}>{item.label}{item.badge !== undefined && <span>{item.badge}</span>}</button>)}
    </div>
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
  if (!active && (!keepMounted || !visited)) return null
  return <LocalSectionVisibility.Provider value={active}><section id={state.panelId(section)} role="tabpanel" aria-labelledby={state.tabId(section)} hidden={!active} className={`local-section-panel${className ? ` ${className}` : ''}`}>{children}</section></LocalSectionVisibility.Provider>
}
