import type { SaveState } from './useSaveState'
import '../panels.css'
import './feedback.css'

/**
 * What the Save beside it would do, said where the user is looking (2026-09-25 polish spec D3;
 * contract C3): nothing while clean, "Unsaved changes" (muted) while dirty, "Saved ✓" for its 2.5 s,
 * the failure's own sentence in an alert. The status region is already standing while the save runs
 * (with a hidden "Saving…"), because a live region has to exist before its news, or a screen reader
 * misses "Saved".
 */
export function SaveStatus({ state }: { state: SaveState }) {
  switch (state.status) {
    case 'clean':
      return null
    case 'dirty':
      return <span className="save-status save-status-dirty">Unsaved changes</span>
    case 'saving':
      return (
        <span className="save-status save-status-saving" role="status">
          <span className="visually-hidden">Saving…</span>
        </span>
      )
    case 'saved':
      return (
        <span className="save-status save-status-saved" role="status">
          Saved <span aria-hidden="true">✓</span>
        </span>
      )
    case 'error':
      // Keyed apart from the status line: an alert is announced when it is inserted.
      return (
        <span key="error" className="save-status save-status-error" role="alert">
          {state.error}
        </span>
      )
  }
}
