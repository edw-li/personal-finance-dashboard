import { useRef } from 'react'
import type { ReactNode } from 'react'
import BusyButton from '../feedback/BusyButton'
import { SaveButton } from '../feedback/SaveButton'
import { SaveStatus } from '../feedback/SaveStatus'
import { useSaveState } from '../feedback/useSaveState'

/** Each table keeps its own saved announcement; the editor still owns the rows, validation,
 *  requests and cross-table lock. A declined deletion or failed validation is not a save. */
export default function BracketForm({
  title, className, tableKey, dirty, busy, removing, canAdd, error, onAdd, onSave,
  onRemove, onDiscard, children,
}: {
  title: string
  className: string
  tableKey: string
  dirty: boolean
  busy: boolean
  removing?: boolean
  canAdd: boolean
  error?: string
  onAdd: () => void
  onSave: (anchor: HTMLElement) => Promise<boolean>
  onRemove?: (anchor: HTMLElement) => Promise<boolean>
  onDiscard?: () => void
  children: ReactNode
}) {
  const state = useSaveState({ dirty })
  const saveRef = useRef<HTMLButtonElement>(null)
  const status = error ? { ...state, status: 'error' as const, error } : state
  return (
    <form
      className={className}
      data-bracket-key={tableKey}
      data-entry-scope=""
      onChangeCapture={state.clearError}
      onSubmit={(event) => {
        event.preventDefault()
        if (!dirty || busy || saveRef.current === null) return
        const anchor = saveRef.current
        void state.run(async () => {
          if (!await onSave(anchor)) throw new DOMException('The table was not saved', 'AbortError')
        })
      }}
    >
      {children}
      <div className="bracket-actions">
        <BusyButton type="button" className="button" aria-label={`Add ${title} bracket`} inert={!canAdd || busy} onClick={onAdd}>
          Add bracket
        </BusyButton>
        <SaveButton ref={saveRef} state={status} type="submit" data-entry-primary="" className="button button-primary" aria-label={`Save ${title} brackets`} aria-disabled={busy || !dirty}>
          Save
        </SaveButton>
        {onRemove !== undefined && (
          <BusyButton type="button" className="button" busy={removing} inert={busy} onClick={event => { void onRemove(event.currentTarget) }}>
            Remove — use the default<span className="visually-hidden"> — {title}</span>
          </BusyButton>
        )}
        {onDiscard !== undefined && (
          <BusyButton type="button" className="button" inert={busy} onClick={onDiscard}>
            Discard draft<span className="visually-hidden"> — {title}</span>
          </BusyButton>
        )}
        <SaveStatus state={status} />
      </div>
    </form>
  )
}
