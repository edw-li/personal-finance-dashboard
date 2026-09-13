import { useEffect, useRef, useState } from 'react'
import { usePopoverDismiss } from '../usePopoverDismiss'
import { FeedBanner } from '../shell/Feed'
import './taxes.css'

/**
 * "New tax year…" — the page's primary action, in PageFrame's actions slot (2026-09-13 polish
 * spec §11; audit A3/S1: the create/delete row sat in a <details> above every view's results).
 * One popover holds the whole year-management row: the year box and Create, and under a rule the
 * "Delete {year}…" door with its arm-and-confirm INSIDE the popover — no window.confirm; the
 * question and its two answers appear right where the reader is looking.
 *
 * The PAGE keeps the state and the requests (newYear, createYear, deleteYear); this component
 * owns only whether it is open and whether the delete is armed. `onCreate` resolves true when the
 * year now exists — the popover closes on it and hands focus back to the trigger.
 */
export default function TaxYearMenu({
  newYear,
  onNewYearChange,
  onCreate,
  creating,
  createError,
  disabled = false,
  yearMin,
  yearMax,
  createHint,
  selectedYear,
  onDelete,
  deleteDisabled = false,
}: {
  newYear: string
  onNewYearChange: (value: string) => void
  /** Resolves true when the year was created (the popover closes), false when it was refused. */
  onCreate: () => Promise<boolean>
  creating: boolean
  createError: string | null
  /** The whole menu is shut while the year list is still loading. */
  disabled?: boolean
  yearMin: number
  yearMax: number
  createHint: string
  /** null → the delete door renders shut, as "Delete year…". */
  selectedYear: number | null
  /** Runs AFTER the in-popover confirm: the page's deleteYear asks nothing further. */
  onDelete: () => void
  deleteDisabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  // The year the delete was armed FOR: a different selection while armed drops the arm, so the
  // question can never describe one year while the button deletes another.
  const [armedYear, setArmedYear] = useState<number | null>(null)
  const armed = armedYear !== null && armedYear === selectedYear
  const triggerRef = useRef<HTMLButtonElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const armRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const wasArmed = useRef(false)

  const close = () => {
    setOpen(false)
    setArmedYear(null)
  }
  // Outside pointerdown and Escape close it; focus returns to the trigger (the shared hook).
  usePopoverDismiss(open, close, triggerRef, surfaceRef)

  // The year box takes the caret when the popover opens — DOM calls only, no state.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])
  // Arming moves the caret onto the confirm button (the question is its description); a "Keep"
  // hands it back to the door that was pressed, so a keyboard reader is never left on nothing.
  useEffect(() => {
    if (armed) confirmRef.current?.focus()
    else if (wasArmed.current) armRef.current?.focus()
    wasArmed.current = armed
  }, [armed])

  return (
    <div className="tax-year-menu">
      <button
        ref={triggerRef}
        type="button"
        className="button button-primary"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
      >
        New tax year…
      </button>
      {open && (
        <div
          ref={surfaceRef}
          className="popover-surface tax-year-popover"
          role="dialog"
          aria-label="New tax year"
        >
          <form
            className="new-year-form"
            // The bounds are enforced (and worded) by the page's createYear. Left to the browser,
            // the message is a native bubble that differs per engine and blocks submit before
            // this page ever sees it.
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              onCreate().then((created) => {
                if (!created) return
                close()
                triggerRef.current?.focus()
              })
            }}
          >
            <label htmlFor="new-tax-year">New year</label>
            <input
              ref={inputRef}
              id="new-tax-year"
              className="field-input"
              type="number"
              inputMode="numeric"
              min={yearMin}
              max={yearMax}
              value={newYear}
              onChange={(e) => onNewYearChange(e.target.value)}
            />
            <button type="submit" className="button button-primary" disabled={creating}>
              {creating ? 'Creating…' : 'Create year'}
            </button>
            <span className="drill-hint">{createHint}</span>
          </form>
          <FeedBanner error={createError} />
          {/* The other end of this menu's job — Create makes the year in the box, Delete throws
              away the SELECTED one. Armed in place: the question and its two answers appear under
              the door, and "Keep" folds them away. type="button" throughout, so the form's submit
              stays the create path's alone. Disabled rather than absent with no year selected, so
              its shut state is visible rather than missing. */}
          <div className="tax-year-delete">
            <button
              ref={armRef}
              type="button"
              className="button"
              aria-expanded={armed}
              disabled={selectedYear === null || deleteDisabled}
              onClick={() => setArmedYear(armed ? null : selectedYear)}
            >
              {selectedYear === null ? 'Delete year…' : `Delete ${selectedYear}…`}
            </button>
            {armed && selectedYear !== null && (
              <div className="tax-year-delete-confirm">
                <p id="tax-year-delete-question" className="drill-hint">
                  Delete tax year {selectedYear} and all of its inputs and brackets? This cannot be
                  undone.
                </p>
                <div className="tax-year-delete-actions">
                  <button
                    ref={confirmRef}
                    type="button"
                    className="button"
                    aria-describedby="tax-year-delete-question"
                    onClick={() => {
                      onDelete()
                      close()
                      triggerRef.current?.focus()
                    }}
                  >
                    Delete {selectedYear}
                  </button>
                  <button type="button" className="button" onClick={() => setArmedYear(null)}>
                    Keep {selectedYear}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
