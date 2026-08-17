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
        <div className="route-fallback" role="alert">
          This page failed to load — the app may have been updated.{' '}
          <button className="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
