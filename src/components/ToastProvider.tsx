import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
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
  /** Exit phase: still rendered (with .toast-leaving) but no longer armable. */
  leaving?: boolean
}

// Long enough to read and reach Undo, short enough never to queue up (hover pauses it).
const AUTO_DISMISS_MS = 6000

// The exit animation's length plus a hair; removal is timer-driven (not animationend)
// so reduced-motion and jsdom behave identically.
const LEAVE_MS = 160

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
  // Exit timers live apart from the auto-dismiss map: hold/release pauses reading time,
  // and a toast already leaving has no reading time left to pause.
  const removalTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  // One-shot actions: a leaving toast keeps its buttons mounted for LEAVE_MS after the
  // first activation, and a habitual double-click lands inside that window — the second
  // press must not re-fire the action (every host's Undo re-POSTs a deleted row).
  const firedActions = useRef(new Set<number>())
  // TWO latches, ORed into "paused", never one shared flag: the pointer and the keyboard
  // hold the clock for different reasons, so a pointer leaving a region the keyboard is
  // still inside must not start the countdown under the user's hands.
  const hoverPaused = useRef(false)
  const focusPaused = useRef(false)
  const nextId = useRef(1)
  const regionRef = useRef<HTMLDivElement>(null)

  const remove = useCallback((id: number) => {
    const timer = removalTimers.current.get(id)
    if (timer !== undefined) clearTimeout(timer)
    removalTimers.current.delete(id)
    firedActions.current.delete(id)
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  // Two-phase: mark, animate, THEN drop. The entry has to outlive the click by the length
  // of the exit animation or there is nothing left on screen to animate.
  const dismiss = useCallback(
    (id: number) => {
      if (removalTimers.current.has(id)) return // already on its way out
      const timer = timers.current.get(id)
      if (timer !== undefined) clearTimeout(timer)
      timers.current.delete(id)
      setToasts((current) =>
        current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)),
      )
      removalTimers.current.set(
        id,
        setTimeout(() => remove(id), LEAVE_MS),
      )
    },
    [remove],
  )

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
      // Born under the pointer or under keyboard focus = not armed yet; the release paths
      // below re-arm every survivor once the last latch lets go.
      if (!hoverPaused.current && !focusPaused.current) arm(id)
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

  const holdTimers = () => {
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
  }

  // Releasing re-arms a FULL window rather than a remainder — "I was reading this" earns
  // a fresh clock, and no per-toast stopwatch bookkeeping. A no-op while the OTHER latch
  // still holds.
  const releaseTimers = () => {
    if (hoverPaused.current || focusPaused.current) return
    // Leaving entries are skipped: re-arming one would schedule a second dismiss for a
    // toast already on its way out (and hovering a dying toast must not resurrect it).
    for (const toast of toasts) if (!toast.leaving) arm(toast.id)
  }

  // Activating Undo or Dismiss unmounts the very button that holds the focus latch, and
  // browsers fire NO focusout for a removed node — so onBlur never runs and the latch
  // would wedge true, leaving every LATER toast born unarmed and immortal. Re-checking
  // containment here (an effect, after the removal) is the only reliable release: in the
  // click handler the button is still mounted and still focused.
  // With the exit phase the unmount is LEAVE_MS late (the leaving toast keeps rendering
  // its buttons, so the first pass here still finds focus inside and correctly holds) —
  // the removal is itself a `toasts` change, so this effect always gets its release pass.
  useEffect(() => {
    if (!focusPaused.current) return
    const region = regionRef.current
    if (region !== null && region.contains(document.activeElement)) return
    focusPaused.current = false
    if (!hoverPaused.current) for (const toast of toasts) if (!toast.leaving) arm(toast.id)
  }, [toasts, arm])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Always mounted: a live region must exist BEFORE content lands, or screen
          readers miss the first announcement. */}
      <div
        ref={regionRef}
        className="toast-region"
        aria-live="polite"
        onMouseEnter={() => {
          hoverPaused.current = true
          holdTimers()
        }}
        onMouseLeave={() => {
          hoverPaused.current = false
          releaseTimers()
        }}
        onFocus={() => {
          focusPaused.current = true
          holdTimers()
        }}
        onBlur={() => {
          focusPaused.current = false
          releaseTimers()
        }}
      >
        {toasts.map((toast) => {
          const action = toast.action
          return (
            <div
              key={toast.id}
              className={`toast toast-${toast.variant}${toast.leaving ? ' toast-leaving' : ''}`}
            >
              <span className="toast-message">{toast.message}</span>
              {action !== undefined && (
                <button
                  type="button"
                  className="toast-action"
                  onClick={() => {
                    // Consume FIRST: an action that itself toasts (an undo that fails)
                    // must not race a dismiss aimed at the wrong entry.
                    dismiss(toast.id)
                    // ...and exactly once: the button outlives this click by LEAVE_MS.
                    if (firedActions.current.has(toast.id)) return
                    firedActions.current.add(toast.id)
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
