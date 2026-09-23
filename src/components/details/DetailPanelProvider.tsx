import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, Layers, Maximize2, Minimize2, PanelRight, X } from 'lucide-react'
import { MOTION_MS } from '../../theme/motion'
import { prefersReducedMotion } from '../useReducedMotion'
import { holdPosition } from '../shell/holdPosition'
import Segmented from '../shell/Segmented'
import type { SegmentedOption } from '../shell/Segmented'
import './details.css'

export type DetailPanelMode = 'dock' | 'overlay' | 'expanded'
export interface DetailPanelRequest {
  id: string
  title: string
  subtitle?: string
  content: ReactNode
  actions?: ReactNode
  contextKey?: string
  returnTo?: HTMLElement | null
  onClose?: () => void
  /** Default true. `false` (the assistant — 2026-09-13 spec §4): in overlay or reading mode the
   *  page stays live — no backdrop, no aria-modal, no inert, no Tab trap. Escape still closes it. */
  modal?: boolean
  /** Held where it is on screen while the dock opens or lets go and the page reflows around it
   *  — the chart a drill came from (2026-09-23 spec §C10). */
  anchor?: HTMLElement | null
}

interface DetailPanelApi {
  activeId: string | null
  mode: DetailPanelMode
  open: (request: DetailPanelRequest) => void
  update: (id: string, request: Partial<Omit<DetailPanelRequest, 'id'>>) => void
  close: (id?: string) => void
  back: () => void
  setMode: (mode: DetailPanelMode) => void
}

const DetailPanelContext = createContext<DetailPanelApi | null>(null)

/** Null outside the shell: reusable charts still offer an inline inspector in tests/embeds. */
export function useDetailPanel(): DetailPanelApi | null {
  return useContext(DetailPanelContext)
}

const MIN_WIDTH = 360
const MAX_WIDTH = 720
// The shell sidebar is 210px. Keep at least 720px for its main content beside a dock.
const MIN_READING_SPACE = 930
export function panelGeometry(viewport: number, preferredWidth: number, desiredMode: DetailPanelMode) {
  const available = viewport - MIN_READING_SPACE
  const canDock = available >= MIN_WIDTH
  const mode: DetailPanelMode = desiredMode === 'dock' && !canDock ? 'overlay' : desiredMode
  const maxWidth = Math.min(MAX_WIDTH, mode === 'dock' ? available : Math.max(MIN_WIDTH, viewport - 48))
  return { mode, canDock, maxWidth, width: Math.max(MIN_WIDTH, Math.min(preferredWidth, maxWidth)) }
}

/** clamp(400px, 26vw, 560px) as a number (2026-09-13 spec §4): the dock's width is a margin the
 *  layout reserves, so it has to be arithmetic, not a CSS length. Used only while nothing is
 *  stored — a dragged width wins. */
export function defaultPanelWidth(viewport: number): number {
  return Math.round(Math.min(560, Math.max(400, viewport * 0.26)))
}

/** Browser preferences, not financial data — localStorage, never the server prefs (spec §4). */
export const MODE_STORAGE_KEY = 'finance.detailPanel.mode'
export const WIDTH_STORAGE_KEY = 'finance.detailPanel.width'
const MODES: readonly DetailPanelMode[] = ['dock', 'overlay', 'expanded']

function readStoredMode(): DetailPanelMode | null {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY)
    return MODES.includes(stored as DetailPanelMode) ? (stored as DetailPanelMode) : null
  } catch {
    return null
  }
}

/** Clamped by panelGeometry on every render (spec §16): a stored width wider than today's maxWidth is fine. */
function readStoredWidth(): number | null {
  try {
    const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY))
    return Number.isFinite(stored) && stored > 0 ? stored : null
  } catch {
    return null
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode or quota: the preference simply does not persist.
  }
}

const focusableSelector = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]'

// Mode tooltips (spec §14): what the panel DOES, not what the layout is called.
const MODE_TITLES: Record<DetailPanelMode, string> = { dock: 'Beside the page', overlay: 'Over the page', expanded: 'Reading mode' }
const EXIT_READING_TITLE = 'Exit reading mode'
const DOCK_DISABLED_TITLE = 'Widen the window to keep at least 720 pixels of page content beside details.'

/** An icon-only option whose accessible name is visually-hidden text: Segmented options carry a
 *  `title` but no per-option aria-label, and Segmented.tsx is not this lane's file to change. */
function iconOption(value: DetailPanelMode, name: string, icon: ReactNode, extra: Partial<SegmentedOption<DetailPanelMode>> = {}): SegmentedOption<DetailPanelMode> {
  return { value, title: name, ...extra, label: <>{icon}<span className="visually-hidden">{name}</span></> }
}

export default function DetailPanelProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<DetailPanelRequest[]>([])
  const stackRef = useRef<DetailPanelRequest[]>([])
  const [desiredMode, setDesiredMode] = useState<DetailPanelMode>(() => readStoredMode() ?? 'dock')
  // null = nothing stored and nothing dragged yet: the width follows the viewport.
  const [preferredWidth, setPreferredWidth] = useState<number | null>(readStoredWidth)
  const [viewport, setViewport] = useState(() => typeof window === 'undefined' ? 1600 : window.innerWidth)
  const [dragging, setDragging] = useState(false)
  // The exit ghost (spec §2.2): the last request stays painted, inert, for one --t-fast beat after
  // the stack empties. Null in engines without Web Animations (jsdom), where the unmount is at once.
  const [leaving, setLeaving] = useState<{ request: DetailPanelRequest; mode: DetailPanelMode } | null>(null)
  const modeRef = useRef<DetailPanelMode>('dock')
  const panelRef = useRef<HTMLElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const dragRef = useRef<{ x: number; width: number } | null>(null)
  const readingOrigin = useRef<DetailPanelMode>('dock')
  const titleId = useId()
  const active = stack.at(-1)
  const previous = stack.at(-2)
  const { mode, width, maxWidth, canDock } = panelGeometry(viewport, preferredWidth ?? defaultPanelWidth(viewport), desiredMode)

  const commit = useCallback((next: DetailPanelRequest[]) => {
    stackRef.current = next
    setStack(next)
    // A surface that comes back during the exit beat replaces the ghost; it never stacks under one.
    if (next.length > 0) setLeaving(null)
  }, [])

  const open = useCallback((request: DetailPanelRequest) => {
    const current = stackRef.current
    const existing = current.findIndex((entry) => entry.id === request.id)
    if (existing !== -1) {
      // Reopening an existing surface updates it and returns to it, never duplicates it.
      commit([...current.slice(0, existing), { ...current[existing], ...request, returnTo: current[existing].returnTo }])
      return
    }
    // A dock opening on an empty stack narrows the page under the reader: hold the element the
    // request names (the drilled chart) where it is, measured before this commit moves it.
    if (current.length === 0 && modeRef.current === 'dock') holdPosition(request.anchor)
    commit([...current, {
      ...request,
      returnTo: request.returnTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
    }])
  }, [commit])

  const update = useCallback((id: string, request: Partial<Omit<DetailPanelRequest, 'id'>>) => {
    const current = stackRef.current
    const index = current.findIndex((entry) => entry.id === id)
    if (index === -1) return
    const next = [...current]
    next[index] = { ...next[index], ...request }
    commit(next)
  }, [commit])

  /** Arm the exit ghost for `last`. Gated on Web Animations because that is what separates a CSS
   *  animation engine from jsdom: without it the ghost would never hear animationend and would sit
   *  for the whole fallback timer in every unit test. Gated on reduce too: the motion block is
   *  no-preference only, so there would be no detail-panel-out to play and an opaque, inert ghost
   *  would just cover the reflowed page until the fallback timer fired. Reads the mode through a ref
   *  so `close` keeps its identity — MetricInfoButton closes its receipt on unmount through `close`,
   *  and a new identity per mode change would close panels by accident. */
  const beginExit = useCallback((last: DetailPanelRequest) => {
    if (typeof panelRef.current?.animate !== 'function' || prefersReducedMotion()) return
    setLeaving({ request: last, mode: modeRef.current })
  }, [])

  const close = useCallback((id?: string) => {
    const current = stackRef.current
    if (id !== undefined) {
      const entry = current.find((item) => item.id === id)
      if (entry === undefined) return
      const next = current.filter((item) => item.id !== id)
      if (next.length === 0) {
        returnFocus.current = entry.returnTo ?? null
        beginExit(entry)
        // The dock lets go and the page widens back: hold the anchor through that reflow too.
        if (modeRef.current === 'dock') holdPosition(entry.anchor)
      }
      commit(next)
      entry.onClose?.()
      return
    }
    if (current.length === 0) return
    returnFocus.current = current[0]?.returnTo ?? null
    beginExit(current[current.length - 1])
    if (modeRef.current === 'dock') holdPosition(current.find((entry) => entry.anchor)?.anchor)
    commit([])
    current.forEach((entry) => entry.onClose?.())
  }, [beginExit, commit])

  const back = useCallback(() => {
    const current = stackRef.current
    if (current.length < 2) return
    const last = current.at(-1)
    commit(current.slice(0, -1))
    last?.onClose?.()
  }, [commit])

  /** Persisted on change, not on mount: a reader who never touched the control keeps following the
   *  default (and the viewport-derived width) on every visit. */
  const setMode = useCallback((next: DetailPanelMode) => {
    setDesiredMode(next)
    writeStored(MODE_STORAGE_KEY, next)
  }, [])

  const resizeTo = (next: number) => {
    const clamped = Math.max(MIN_WIDTH, Math.min(maxWidth, next))
    setPreferredWidth(clamped)
    writeStored(WIDTH_STORAGE_KEY, String(Math.round(clamped)))
  }

  const chooseMode = (next: DetailPanelMode) => {
    if (next !== 'expanded') {
      setMode(next)
      return
    }
    // The reading-mode option is a toggle: pressed again, it returns to the mode it came from.
    if (mode === 'expanded') {
      setMode(readingOrigin.current)
      return
    }
    readingOrigin.current = desiredMode
    setMode('expanded')
  }

  useEffect(() => {
    const measure = () => setViewport(window.innerWidth)
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const activeId = active?.id ?? null
  useLayoutEffect(() => {
    // Overlay/expanded content is inert until this commit removes the surface.
    // Restoring focus in close() itself would fail in a real browser.
    if (activeId === null && returnFocus.current) {
      if (returnFocus.current.isConnected) returnFocus.current.focus({ preventScroll: true })
      returnFocus.current = null
    }
  }, [activeId])

  // Modal = the page is taken hostage: backdrop, aria-modal, inert, Tab trap. Never in dock mode,
  // and never for a request that asked not to be (the assistant).
  const modal = active !== undefined && mode !== 'dock' && active.modal !== false

  useEffect(() => {
    if (activeId === null) return
    panelRef.current?.focus({ preventScroll: true })
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        // One level at a time (design §5.1): evidence opened from a conversation returns to it.
        if (stackRef.current.length > 1) back()
        else close()
        return
      }
      if (event.key !== 'Tab' || !modal) return
      const panel = panelRef.current
      const nodes = Array.from(panel?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
        .filter((el) => !el.closest('[hidden]'))
      const first = nodes[0]
      const last = nodes.at(-1)
      if (!first || !last) {
        event.preventDefault()
        panel?.focus()
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !panel?.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', keyboard)
    return () => document.removeEventListener('keydown', keyboard)
  }, [activeId, back, close, modal])

  // The assistant launcher sits BESIDE a dock, not under it (spec §2.2): assistant.css reads this.
  useEffect(() => {
    document.documentElement.style.setProperty('--dock-width', activeId !== null && mode === 'dock' ? `${Math.round(width)}px` : '0px')
  }, [activeId, mode, width])
  useEffect(() => () => { document.documentElement.style.removeProperty('--dock-width') }, [])

  // Unkeyed on purpose (the EChart latest-ref idiom): beginExit reads the mode the panel was in.
  useEffect(() => { modeRef.current = mode })
  // `reduce` zeroes --t-fast, and a 0ms animation may never report animationend: the timer is the
  // guarantee that no reader is ever stranded behind a ghost (spec §16).
  useEffect(() => {
    if (leaving === null) return
    const timer = window.setTimeout(() => setLeaving(null), MOTION_MS.fast + 50)
    return () => window.clearTimeout(timer)
  }, [leaving])

  const api: DetailPanelApi = { activeId, mode, open, update, close, back, setMode }
  const modeOptions: SegmentedOption<DetailPanelMode>[] = [
    iconOption('dock', MODE_TITLES.dock, <PanelRight size={14} aria-hidden="true" />, { disabled: !canDock, title: canDock ? MODE_TITLES.dock : DOCK_DISABLED_TITLE }),
    iconOption('overlay', MODE_TITLES.overlay, <Layers size={14} aria-hidden="true" />),
    mode === 'expanded'
      ? iconOption('expanded', EXIT_READING_TITLE, <Minimize2 size={14} aria-hidden="true" />)
      : iconOption('expanded', MODE_TITLES.expanded, <Maximize2 size={14} aria-hidden="true" />),
  ]
  const draggingClass = dragging ? ' is-dragging' : ''

  return (
    <DetailPanelContext.Provider value={api}>
      <div className={`detail-layout-content${draggingClass}`} style={{ marginInlineEnd: active && mode === 'dock' ? width : 0 }} inert={modal || undefined}>
        {children}
      </div>
      {active && createPortal(
        <div className={`detail-panel-layer detail-panel-layer-${mode}${draggingClass}`}>
          {modal && <div className="detail-panel-backdrop" aria-hidden="true" onClick={() => close()} />}
          <aside
            ref={panelRef}
            className={`detail-panel detail-panel-${mode}`}
            style={{ '--dp-dock-w': `${width}px` } as CSSProperties}
            role="dialog"
            aria-modal={modal || undefined}
            aria-labelledby={titleId}
            tabIndex={-1}
          >
            <header className="detail-panel-header">
              <div className="detail-panel-heading">
                <h2 id={titleId}>{active.title}</h2>
                {active.subtitle && <p title={active.subtitle}>{active.subtitle}</p>}
              </div>
            </header>
            <div className="detail-panel-body">{active.content}</div>
            {/* DOM-after the body, CSS-placed in the header row (spec §4): Tab from the panel lands
                on the content first; Back, the layout control, the request's actions, Close and the
                resizer come after it. */}
            {previous !== undefined && (
              <div className="detail-panel-back">
                <button type="button" className="detail-panel-icon-button" aria-label={`Back to ${previous.title}`} title={`Back to ${previous.title}`} onClick={back}>
                  <ChevronLeft size={14} aria-hidden="true" />
                </button>
              </div>
            )}
            <div className="detail-panel-controls">
              <Segmented variant="toggle" size="sm" ariaLabel="Detail panel layout" value={mode} onChange={chooseMode} options={modeOptions} />
              {active.actions}
              <button type="button" className="detail-panel-icon-button" aria-label="Close details" title="Close details" onClick={() => close()}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            {mode !== 'expanded' && (
              <div
                className="detail-panel-resizer"
                role="separator"
                aria-label="Resize detail panel"
                aria-orientation="vertical"
                aria-valuemin={MIN_WIDTH}
                aria-valuemax={Math.round(maxWidth)}
                aria-valuenow={Math.round(width)}
                tabIndex={0}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  dragRef.current = { x: event.clientX, width }
                  setDragging(true)
                  event.currentTarget.setPointerCapture?.(event.pointerId)
                  event.preventDefault()
                }}
                onPointerMove={(event) => {
                  if (!dragRef.current) return
                  resizeTo(dragRef.current.width + dragRef.current.x - event.clientX)
                }}
                onPointerUp={(event) => {
                  dragRef.current = null
                  setDragging(false)
                  event.currentTarget.releasePointerCapture?.(event.pointerId)
                }}
                onPointerCancel={() => { dragRef.current = null; setDragging(false) }}
                onKeyDown={(event) => {
                  const next = event.key === 'ArrowLeft' ? width + 20 : event.key === 'ArrowRight' ? width - 20 : event.key === 'Home' ? MIN_WIDTH : event.key === 'End' ? maxWidth : null
                  if (next === null) return
                  event.preventDefault()
                  resizeTo(next)
                }}
              />
            )}
          </aside>
        </div>, document.body,
      )}
      {active === undefined && leaving !== null && createPortal(
        <div className={`detail-panel-layer detail-panel-layer-${leaving.mode}`} aria-hidden="true">
          <aside
            className={`detail-panel detail-panel-${leaving.mode} is-leaving`}
            style={{ '--dp-dock-w': `${width}px` } as CSSProperties}
            inert
            onAnimationEnd={(event) => { if (event.target === event.currentTarget) setLeaving(null) }}
          >
            <header className="detail-panel-header">
              <div className="detail-panel-heading">
                <h2>{leaving.request.title}</h2>
                {leaving.request.subtitle && <p>{leaving.request.subtitle}</p>}
              </div>
            </header>
            <div className="detail-panel-body">{leaving.request.content}</div>
          </aside>
        </div>, document.body,
      )}
    </DetailPanelContext.Provider>
  )
}
