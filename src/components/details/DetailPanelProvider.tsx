import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
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
  const mode = desiredMode === 'dock' && !canDock ? 'overlay' : desiredMode
  const maxWidth = Math.min(MAX_WIDTH, mode === 'dock' ? available : Math.max(MIN_WIDTH, viewport - 48))
  return { mode, canDock, maxWidth, width: Math.max(MIN_WIDTH, Math.min(preferredWidth, maxWidth)) }
}

const focusableSelector = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]'

export default function DetailPanelProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<DetailPanelRequest[]>([])
  const stackRef = useRef<DetailPanelRequest[]>([])
  const [desiredMode, setMode] = useState<DetailPanelMode>('dock')
  const [preferredWidth, setWidth] = useState(440)
  const [viewport, setViewport] = useState(() => typeof window === 'undefined' ? 1600 : window.innerWidth)
  const panelRef = useRef<HTMLElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const dragRef = useRef<{ x: number; width: number } | null>(null)
  const readingOrigin = useRef<DetailPanelMode>('dock')
  const titleId = useId()
  const active = stack.at(-1)
  const { mode, width, maxWidth, canDock } = panelGeometry(viewport, preferredWidth, desiredMode)

  const commit = useCallback((next: DetailPanelRequest[]) => {
    stackRef.current = next
    setStack(next)
  }, [])

  const open = useCallback((request: DetailPanelRequest) => {
    const current = stackRef.current
    const existing = current.findIndex((entry) => entry.id === request.id)
    if (existing !== -1) {
      // Reopening an existing surface updates it and returns to it, never duplicates it.
      commit([...current.slice(0, existing), { ...current[existing], ...request, returnTo: current[existing].returnTo }])
      return
    }
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

  const close = useCallback((id?: string) => {
    const current = stackRef.current
    if (id !== undefined) {
      const entry = current.find((item) => item.id === id)
      if (entry === undefined) return
      if (current.length === 1) returnFocus.current = entry.returnTo ?? null
      commit(current.filter((item) => item.id !== id))
      entry.onClose?.()
      return
    }
    returnFocus.current = current[0]?.returnTo ?? null
    commit([])
    current.forEach((entry) => entry.onClose?.())
  }, [commit])

  const back = useCallback(() => {
    const current = stackRef.current
    if (current.length < 2) return
    const last = current.at(-1)
    commit(current.slice(0, -1))
    last?.onClose?.()
  }, [commit])

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
  useEffect(() => {
    if (activeId === null) return
    panelRef.current?.focus({ preventScroll: true })
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
      if (event.key !== 'Tab' || mode === 'dock') return
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
  }, [activeId, close, mode])

  const api: DetailPanelApi = { activeId, mode: mode as DetailPanelMode, open, update, close, back, setMode }
  const modal = active !== undefined && mode !== 'dock'

  return (
    <DetailPanelContext.Provider value={api}>
      <div className="detail-layout-content" style={{ marginInlineEnd: active && mode === 'dock' ? width : 0 }} inert={modal || undefined}>
        {children}
      </div>
      {active && createPortal(
        <div className={`detail-panel-layer detail-panel-layer-${mode}`}>
          {modal && <div className="detail-panel-backdrop" aria-hidden="true" onClick={() => close()} />}
          <aside
            ref={panelRef}
            className={`detail-panel detail-panel-${mode}`}
            style={{ '--detail-panel-width': `${width}px` } as CSSProperties}
            role="dialog"
            aria-modal={modal || undefined}
            aria-labelledby={titleId}
            tabIndex={-1}
          >
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
                  event.currentTarget.setPointerCapture?.(event.pointerId)
                  event.preventDefault()
                }}
                onPointerMove={(event) => {
                  if (!dragRef.current) return
                  setWidth(Math.max(MIN_WIDTH, Math.min(maxWidth, dragRef.current.width + dragRef.current.x - event.clientX)))
                }}
                onPointerUp={(event) => {
                  dragRef.current = null
                  event.currentTarget.releasePointerCapture?.(event.pointerId)
                }}
                onPointerCancel={() => { dragRef.current = null }}
                onKeyDown={(event) => {
                  const next = event.key === 'ArrowLeft' ? width + 20 : event.key === 'ArrowRight' ? width - 20 : event.key === 'Home' ? MIN_WIDTH : event.key === 'End' ? maxWidth : null
                  if (next === null) return
                  event.preventDefault()
                  setWidth(Math.max(MIN_WIDTH, Math.min(maxWidth, next)))
                }}
              />
            )}
            <header className="detail-panel-header">
              {stack.length > 1 && <button type="button" className="button" onClick={back}>Back</button>}
              <div className="detail-panel-heading">
                <h2 id={titleId}>{active.title}</h2>
                {active.subtitle && <p>{active.subtitle}</p>}
              </div>
              <button type="button" className="button" aria-label="Close details" onClick={() => close()}>Close</button>
            </header>
            <div className="detail-panel-toolbar" role="group" aria-label="Detail panel layout">
              <button type="button" className="button" aria-pressed={mode === 'dock'} disabled={!canDock} title={!canDock ? 'Widen the window to keep at least 720 pixels of page content beside details.' : undefined} onClick={() => setMode('dock')}>Dock</button>
              <button type="button" className="button" aria-pressed={mode === 'overlay'} onClick={() => setMode('overlay')}>Overlay</button>
              <button type="button" className="button" aria-pressed={mode === 'expanded'} onClick={() => {
                if (mode === 'expanded') setMode(readingOrigin.current)
                else { readingOrigin.current = mode as DetailPanelMode; setMode('expanded') }
              }}>{mode === 'expanded' ? 'Restore size' : 'Expand reading'}</button>
              {active.actions}
            </div>
            <div className="detail-panel-body">{active.content}</div>
          </aside>
        </div>, document.body,
      )}
    </DetailPanelContext.Provider>
  )
}
