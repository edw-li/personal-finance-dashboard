import { Component, type ReactNode } from 'react'
import './Layout.css'

// The one error boundary in the app, and it exists for exactly one failure mode that
// code-splitting introduced (Task 9 review): a route chunk that fails to load — stale
// tab fetching old hashed filenames after a redeploy, or a network blip. Pre-split, an
// open tab kept running its bundle and this state was unreachable. Reload re-fetches
// index.html and the fresh hashes.
interface Props { children: ReactNode }
interface State { failed: boolean }

export default class RouteBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
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
