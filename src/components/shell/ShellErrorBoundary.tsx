import { Component, createRef, type ErrorInfo, type ReactNode } from 'react'
import '../Layout.css'

// The shell-level boundary (2026-09-03 shell spec §12). RouteBoundary keeps its per-route
// job; this one wraps the sidebar, palette, drawer and outlet so a throw in an overlay can no
// longer unmount the whole app. Chunk-load failures after a deploy get their own sentence.
//
// Every engine words the same failure differently and none of them is a bug in this app:
// webpack-era Chrome says ChunkLoadError / "Loading chunk N failed", Vite+Chrome says "Failed
// to fetch dynamically imported module", Firefox says "error loading dynamically imported
// module", Safari says "Importing a module script failed", and Vite's CSS preloader says
// "Unable to preload CSS". Missing one of them costs a reader the reload sentence and hands
// them "Something went wrong" for a deploy that already fixed itself.
const CHUNK_PATTERN =
  /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i

export function classifyError(error: Error): 'chunk' | 'error' {
  return CHUNK_PATTERN.test(`${error.name} ${error.message}`) ? 'chunk' : 'error'
}

interface Props {
  buildHash: string
  /** Extra lines for the copied report — environment, alembic head — supplied by Layout. */
  getDiagnostics: () => string
  /**
   * Changes once per navigation (Layout passes location.key). A new value clears a shown
   * error, so leaving the broken route is enough to get the shell back. Deliberately a PROP
   * rather than a `key` on the element: keying would REMOUNT the boundary, and the palette,
   * the assistant drawer and the sidebar all live inside it — every navigation would throw
   * away the drawer's transcript to solve a problem that only exists after a throw.
   */
  resetKey?: string
  children: ReactNode
}
interface State {
  /**
   * Separate from `error` on purpose: `getDerivedStateFromError` normalises whatever was
   * thrown into an Error, but a thrown `null` would otherwise be indistinguishable from the
   * "no error" sentinel and the boundary would render its children straight back into the
   * throw. The boolean is the only thing render() asks.
   */
  failed: boolean
  error: Error | null
  /** React's own stack — the line that names WHICH overlay threw. From componentDidCatch. */
  componentStack: string | null
  copied: 'idle' | 'done' | 'failed'
}

const CLEARED: State = { failed: false, error: null, componentStack: null, copied: 'idle' }

export default class ShellErrorBoundary extends Component<Props, State> {
  state: State = { ...CLEARED }

  // The fallback replaces the whole app, so whatever had focus is gone with it. Parking
  // focus on Reload gives a keyboard reader the recovery button without a blind Tab hunt.
  private reloadRef = createRef<HTMLButtonElement>()

  static getDerivedStateFromError(raw: unknown): State {
    // `throw 'oops'` and `throw null` are legal JS and reach boundaries unchanged; String()
    // keeps the message honest instead of rendering "undefined" out of a missing .message.
    return { ...CLEARED, failed: true, error: raw instanceof Error ? raw : new Error(String(raw)) }
  }

  componentDidCatch(_error: unknown, info: ErrorInfo) {
    // Stored, not logged: React already logged it. The component stack is what turns "a
    // throw somewhere in the shell" into "the assistant drawer threw" in a pasted report.
    this.setState({ componentStack: info.componentStack ?? null })
  }

  componentDidMount() {
    // A throw during the FIRST render — the arrival route's chunk 404s after a deploy —
    // commits the fallback as a MOUNT: React calls componentDidMount for it, never
    // componentDidUpdate, so the focus hand-off needs both doors.
    if (this.state.failed) this.reloadRef.current?.focus()
  }

  componentDidUpdate(prev: Props, prevState: State) {
    if (this.state.failed && this.props.resetKey !== prev.resetKey) {
      // A navigation is a fresh attempt: the route that threw is unmounted, so holding the
      // fallback up would strand the reader on a page they already left.
      this.setState({ ...CLEARED })
      return
    }
    if (this.state.failed && !prevState.failed) this.reloadRef.current?.focus()
  }

  // One clipboard payload instead of "please describe what happened": message, stack, the
  // component stack, the route it died on, the build it died in, and the last /system/status.
  private report(): string {
    const { error, componentStack } = this.state
    return [
      `${error?.name}: ${error?.message}`,
      error?.stack ?? '',
      componentStack ?? '',
      `route ${window.location.pathname}${window.location.search}`,
      `build ${this.props.buildHash}`,
      this.props.getDiagnostics(),
    ]
      .filter(Boolean)
      .join('\n')
  }

  // The clipboard is absent over plain HTTP and can be denied by permission even over HTTPS,
  // so both outcomes are states, not assumptions: the label says which one happened, and the
  // textarea below gives the reader a payload they can select by hand. A boundary must never
  // throw a second time while reporting the first throw — hence the rejection handler.
  copy = () => {
    if (!this.state.failed) return
    const clipboard = navigator.clipboard
    if (!clipboard) {
      this.setState({ copied: 'failed' })
      return
    }
    clipboard.writeText(this.report()).then(
      () => this.setState({ copied: 'done' }),
      () => this.setState({ copied: 'failed' }),
    )
  }

  render() {
    const { failed, error, copied } = this.state
    if (!failed || error === null) return this.props.children
    const kind = classifyError(error)
    // Shown without waiting for a click when there is no clipboard at all: manual selection
    // is then the ONLY way to get the payload out, so hiding it behind a button that can
    // only fail wastes the reader's one attempt.
    const showDetails = copied === 'failed' || navigator.clipboard === undefined
    const label = copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy details'
    return (
      <div className="route-fallback shell-fallback" role="alert">
        {kind === 'chunk' ? (
          <>
            The app was updated — reload to get the new version.{' '}
            <button
              type="button"
              ref={this.reloadRef}
              className="route-fallback-button"
              onClick={() => location.reload()}
            >
              Reload
            </button>
          </>
        ) : (
          <>
            Something went wrong.{' '}
            <button
              type="button"
              ref={this.reloadRef}
              className="route-fallback-button"
              onClick={() => location.reload()}
            >
              Reload
            </button>
            <button type="button" className="route-fallback-button" onClick={this.copy}>
              {label}
            </button>
            {showDetails && (
              <textarea
                className="shell-fallback-details"
                readOnly
                aria-label="Error details"
                value={this.report()}
              />
            )}
          </>
        )}
      </div>
    )
  }
}
