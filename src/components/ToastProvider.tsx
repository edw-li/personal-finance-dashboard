import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './toast.css'

export interface ToastAction {
  label: string
  onAction: () => void
}

export interface ToastOptions {
  action?: ToastAction
}

export interface ToastApi {
  success: (message: string, options?: ToastOptions) => void
  info: (message: string, options?: ToastOptions) => void
  error: (message: string, options?: ToastOptions) => void
}

type ToastVariant = 'success' | 'info' | 'error'

interface ToastEntry {
  id: number
  variant: ToastVariant
  message: string
  action?: ToastAction
}

// Long enough to read and reach Undo, short enough never to queue up (hover pauses it).
const AUTO_DISMISS_MS = 6000

// The deliberate INVERSE of useAuth's throw: toasts are an ambient layer, and a host
// rendered without it — every pre-existing direct-render test of the four delete hosts —
// must keep working. The notification is dropped; the operation never is.
const NOOP: ToastApi = { success: () => {}, info: () => {}, error: () => {} }

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP
}

export default function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const paused = useRef(false)
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) clearTimeout(timer)
    timers.current.delete(id)
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const arm = useCallback(
    (id: number) => {
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
      )
    },
    [dismiss],
  )

  // The ref reads live HERE, in a useCallback, not in the useMemo below: react-hooks/refs
  // treats a useMemo body as render phase (its value IS used while rendering) and rejects
  // ref access inside it, while a callback's body is deferred by definition.
  const push = useCallback(
    (variant: ToastVariant, message: string, options?: ToastOptions) => {
      const id = nextId.current
      nextId.current += 1
      setToasts((current) => [...current, { id, variant, message, action: options?.action }])
      // Born under the pointer = not armed yet; resume() below re-arms every survivor.
      if (!paused.current) arm(id)
    },
    [arm],
  )

  // A STABLE api object: it travels through context, and every consumer is a whole page —
  // a fresh identity per render would re-render them all whenever a toast comes or goes.
  const api = useMemo<ToastApi>(
    () => ({
      success: (message, options) => push('success', message, options),
      info: (message, options) => push('info', message, options),
      error: (message, options) => push('error', message, options),
    }),
    [push],
  )

  // Pause on hover/focus; resume re-arms a FULL window rather than a remainder —
  // "I was reading this" earns a fresh clock, and no per-toast stopwatch bookkeeping.
  const pause = () => {
    paused.current = true
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
  }

  const resume = () => {
    paused.current = false
    for (const toast of toasts) arm(toast.id)
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Always mounted: a live region must exist BEFORE content lands, or screen
          readers miss the first announcement. */}
      <div
        className="toast-region"
        aria-live="polite"
        onMouseEnter={pause}
        onMouseLeave={resume}
        onFocus={pause}
        onBlur={resume}
      >
        {toasts.map((toast) => {
          const action = toast.action
          return (
            <div key={toast.id} className={`toast toast-${toast.variant}`}>
              <span className="toast-message">{toast.message}</span>
              {action !== undefined && (
                <button
                  type="button"
                  className="toast-action"
                  onClick={() => {
                    // Consume FIRST: an action that itself toasts (an undo that fails)
                    // must not race a dismiss aimed at the wrong entry.
                    dismiss(toast.id)
                    action.onAction()
                  }}
                >
                  {action.label}
                </button>
              )}
              <button
                type="button"
                className="toast-close"
                aria-label="Dismiss notification"
                onClick={() => dismiss(toast.id)}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
