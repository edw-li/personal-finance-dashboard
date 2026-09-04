import { Component, type ReactNode } from 'react'
import './Layout.css'

// The one error boundary in the app, and it exists for exactly one failure mode that
// code-splitting introduced (Task 9 review): a route chunk that fails to load — stale
// tab fetching old hashed filenames after a redeploy, or a network blip. Pre-split, an
// open tab kept running its bundle and this state was unreachable. Reload re-fetches
// index.html and the fresh hashes.
interface Props {
  children: ReactNode
  /** Layout's `pathname`. A PROP, not a `key`: keying this boundary made every navigation
   *  a fresh MOUNT of the Suspense subtree above it, and React shows a fallback for a
   *  mount even inside a transition — #main blanked for a frame on every click
   *  (2026-09-05 spec §2). */
  resetKey?: string
}
interface State { failed: boolean }

export default class RouteBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  // ShellErrorBoundary's idiom. A navigation is a fresh attempt: the route that threw is
  // gone, so holding the fallback up strands the reader on a page they already left.
  componentDidUpdate(prev: Props) {
    if (this.state.failed && this.props.resetKey !== prev.resetKey) this.setState({ failed: false })
  }

  render() {
    if (this.state.failed) {
      return (
        // The copy stays generic because the boundary catches ANY render-time throw, not
        // just a chunk 404 — claiming "the app may have been updated" would be a guess in
        // every other case. The chunk-load story lives in the comment above, where it is
        // true of the design rather than of whatever the user just hit.
        // .route-fallback-button, deliberately NOT .button: panels.css may or may not have
        // loaded in this state, and a same-name rule would partially shadow the design
        // system exactly when it IS loaded.
        <div className="route-fallback" role="alert">
          This page failed to load. Reloading usually fixes it.{' '}
          <button className="route-fallback-button" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
