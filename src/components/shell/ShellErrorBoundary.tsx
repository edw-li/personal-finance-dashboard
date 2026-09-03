import { Component, type ReactNode } from 'react'
import '../Layout.css'

// The shell-level boundary (2026-09-03 shell spec §12). RouteBoundary keeps its per-route
// job; this one wraps the sidebar, palette, drawer and outlet so a throw in an overlay can no
// longer unmount the whole app. Chunk-load failures after a deploy get their own sentence.
const CHUNK_PATTERN =
  /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i

export function classifyError(error: Error): 'chunk' | 'error' {
  return CHUNK_PATTERN.test(`${error.name} ${error.message}`) ? 'chunk' : 'error'
}

interface Props {
  buildHash: string
  /** Extra lines for the copied report — environment, alembic head — supplied by Layout. */
  getDiagnostics: () => string
  children: ReactNode
}
interface State {
  error: Error | null
}

export default class ShellErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  // One clipboard payload instead of "please describe what happened": message, stack, the
  // route it died on, the build it died in, and the last cached /system/status. Optional
  // chaining on `clipboard` — it is absent over plain HTTP, and a boundary must never
  // throw a second time while reporting the first throw.
  copy = () => {
    const { error } = this.state
    if (!error) return
    const lines = [
      `${error.name}: ${error.message}`,
      error.stack ?? '',
      `route ${window.location.pathname}${window.location.search}`,
      `build ${this.props.buildHash}`,
      this.props.getDiagnostics(),
    ]
    void navigator.clipboard?.writeText(lines.filter(Boolean).join('\n'))
  }

  render() {
    const { error } = this.state
    if (error === null) return this.props.children
    const kind = classifyError(error)
    return (
      <div className="route-fallback shell-fallback" role="alert">
        {kind === 'chunk' ? (
          <>
            The app was updated — reload to get the new version.{' '}
            <button className="route-fallback-button" onClick={() => location.reload()}>
              Reload
            </button>
          </>
        ) : (
          <>
            Something went wrong.{' '}
            <button className="route-fallback-button" onClick={() => location.reload()}>
              Reload
            </button>
            <button className="route-fallback-button" onClick={this.copy}>
              Copy details
            </button>
          </>
        )}
      </div>
    )
  }
}
