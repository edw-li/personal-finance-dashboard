import { useCallback, useEffect, useRef, useState } from 'react'
import BusyButton from '../feedback/BusyButton'
import { useConfirm } from '../feedback/confirm'
import { useLatest } from '../reorder/useLatest'
import { usePopoverDismiss } from '../usePopoverDismiss'
import { FeedBanner } from '../shell/Feed'
import './taxes.css'

/**
 * "New tax year…" — the page's primary action, in PageFrame's actions slot (2026-09-13 polish
 * spec §11; audit A3/S1: the create/delete row sat in a <details> above every view's results).
 * One popover holds the whole year-management row: the year box and Create, and under a rule the
 * "Delete {year}…" door. Its confirmation leaves the menu standing, so Cancel and Escape return
 * to the control that asked and an accepted question still names the same year.
 *
 * The PAGE keeps the state and the requests (newYear, createYear, deleteYear); this component
 * owns whether it is open. `onCreate` resolves true when the
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
  onCreate: (anchor: HTMLElement) => Promise<boolean>
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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const createRef = useRef<HTMLButtonElement>(null)
  const confirm = useConfirm()
  const latest = useLatest({ selectedYear, deleteDisabled, onDelete })

  // Stable across renders: usePopoverDismiss keys its effect on the callback, so a fresh closure
  // per keystroke in the year box would tear the document listeners down and re-add them on every
  // character typed (2026-09-13 review round).
  const close = useCallback(() => {
    setOpen(false)
  }, [])
  // Outside pointerdown and Escape close it; focus returns to the trigger (the shared hook).
  usePopoverDismiss(open, close, triggerRef, surfaceRef)

  // The year box takes the caret when the popover opens — DOM calls only, no state.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])
  return (
    <div className="tax-year-menu">
      <BusyButton
        ref={triggerRef}
        type="button"
        className="button button-primary"
        aria-haspopup="dialog"
        aria-expanded={open}
        inert={disabled}
        onClick={() => (open ? close() : setOpen(true))}
      >
        New tax year…
      </BusyButton>
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
              if (creating || createRef.current === null) return
              void onCreate(createRef.current).then((created) => {
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
            <BusyButton ref={createRef} type="submit" className="button button-primary" busy={creating}>
              Create year
            </BusyButton>
            <span className="drill-hint">{createHint}</span>
          </form>
          <FeedBanner error={createError} />
          {/* Create names the year in the box; Delete names the selected year. */}
          <div className="tax-year-delete">
            <BusyButton
              type="button"
              className="button"
              inert={selectedYear === null || deleteDisabled}
              onClick={async (event) => {
                const year = selectedYear
                if (year === null || deleteDisabled) return
                const accepted = await confirm({
                  anchor: event.currentTarget,
                  title: `Delete tax year ${year}?`,
                  body: 'All of its inputs and brackets will be deleted. This cannot be undone.',
                  confirmLabel: `Delete ${year}`,
                })
                if (!accepted || latest.current.selectedYear !== year || latest.current.deleteDisabled) return
                latest.current.onDelete()
                close()
                triggerRef.current?.focus()
              }}
            >
              {selectedYear === null ? 'Delete year…' : `Delete ${selectedYear}…`}
            </BusyButton>
          </div>
        </div>
      )}
    </div>
  )
}
