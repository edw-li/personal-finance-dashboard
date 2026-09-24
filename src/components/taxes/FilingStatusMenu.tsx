import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { describeError } from '../../api/client'
import { fetchStatusOptions, FILING_STATUS_LABELS, FILING_STATUSES } from '../../api/taxes'
import type { FilingStatus, TaxStatusOptions } from '../../types/api'
import InfoHint from '../InfoHint'
import { FeedBanner } from '../shell/Feed'
import { usePopoverDismiss } from '../usePopoverDismiss'
import './taxes.css'

/** "Alex" / "Alex’s and Sam’s": the people a sentence is about, each possessive. */
function possessive(names: string[]): string {
  return names.map((name) => `${name}’s`).join(' and ')
}

/**
 * What filing the year under `next` would mean (2026-09-23 spec §W8), in the server's terms: whose
 * inputs count on the return, the tables the engine would refuse the year without, whether the
 * partner's withholding joins or leaves the Will I owe? card, and the next year's safe harbor. An
 * option the server did not describe (its read failed) says nothing rather than guessing.
 */
function consequences(
  year: number,
  current: FilingStatus,
  next: FilingStatus,
  options: TaxStatusOptions | null,
  withholdingYear: boolean,
): string[] {
  const option = options?.options.find((candidate) => candidate.status === next)
  if (option === undefined) return []
  const lines: string[] = []
  if (option.people.length > 0) {
    lines.push(`${possessive(option.people.map((person) => person.name))} inputs count on the return.`)
  }
  if (option.tables_missing.length > 0) {
    lines.push(
      `${year} has no ${option.label.replaceAll(' ', '-')} tables yet — the estimate, What-if and ` +
        'Will I owe? stay unavailable until you add or clone them in Tax tables.',
    )
  }
  // The partner leg exists only on a joint return (the server's `_return_people`), and the card
  // answers for one year — so only a move onto or off joint, on that year, moves anybody.
  if (withholdingYear && (current === 'married_joint') !== (next === 'married_joint')) {
    const joint = options?.options.find((candidate) => candidate.status === 'married_joint')
    const partners = (joint?.people ?? []).slice(1).map((person) => person.name)
    if (partners.length > 0) {
      const verb = next === 'married_joint' ? 'joins' : 'leaves'
      lines.push(`${possessive(partners)} withholding ${verb} the Will I owe? card.`)
    }
  }
  lines.push(`${year + 1}’s prior-year safe harbor uses this year’s total tax.`)
  return lines
}

/**
 * The year's filing status in the scope row (2026-09-23 spec §W8): plain text with a Change… door,
 * never a toggle that PATCHes on one click. The dialog reads the server's status options when it
 * opens and names, for the status chosen, what changing to it means; "Change to …" hands the
 * choice to the page, which asks about unsaved work, PATCHes and offers the Undo. TaxYearMenu's
 * popover pattern: `role="dialog"`, dismissed by the shared usePopoverDismiss.
 */
export default function FilingStatusMenu({
  year,
  status,
  withholdingYear,
  disabled,
  onChange,
}: {
  year: number
  status: FilingStatus
  /** True when the Will I owe? card answers for this year — the partner line is about it. */
  withholdingYear: boolean
  /** The page is loading the year or already PATCHing: the dialog can open, not confirm. */
  disabled: boolean
  onChange: (next: FilingStatus) => void
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<FilingStatus>(status)
  const [options, setOptions] = useState<TaxStatusOptions | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const checkedRef = useRef<HTMLInputElement>(null)
  // Stale answers never land: a close, a reopen or another year makes the older read moot.
  const seqRef = useRef(0)
  const nowId = useId()
  const radioName = useId()

  // Stable, so usePopoverDismiss does not re-add its listeners every render.
  const close = useCallback(() => {
    seqRef.current += 1
    setOpen(false)
  }, [])
  usePopoverDismiss(open, close, triggerRef, surfaceRef)

  const load = () => {
    const seq = ++seqRef.current
    setLoading(true)
    setError(null)
    fetchStatusOptions(year)
      .then((answer) => {
        if (seq === seqRef.current) setOptions(answer)
      })
      .catch((err: unknown) => {
        if (seq === seqRef.current) setError(describeError(err, `the filing statuses for ${year}`))
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false)
      })
  }

  const openDialog = () => {
    // Every open starts on the year's own status and re-reads the rules: a table added or cloned
    // since the last open changes what a status would mean.
    setSelected(status)
    setOptions(null)
    setOpen(true)
    load()
  }

  // The caret lands on the year's own status when the dialog opens — a DOM call, no state.
  useEffect(() => {
    if (open) checkedRef.current?.focus()
  }, [open])

  const label = FILING_STATUS_LABELS[status]
  const chosen = selected !== status
  const lines = chosen ? consequences(year, status, selected, options, withholdingYear) : []

  return (
    <div className="scope-bar-group filing-status-menu">
      <span id={nowId} className="filing-status-now">
        Filing status: <strong>{label}</strong>
      </span>
      <span className="filing-status-dot" aria-hidden="true">
        {' · '}
      </span>
      <button
        ref={triggerRef}
        type="button"
        className="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={nowId}
        onClick={() => (open ? close() : openDialog())}
      >
        Change…
      </button>
      <InfoHint text="Which bracket tables the engine walks for this year, and whether the per-person inputs in the Inputs view split into two columns. Every year starts as Single." />
      {open && (
        <div
          ref={surfaceRef}
          className="popover-surface filing-status-popover"
          role="dialog"
          aria-label={`Filing status for ${year}`}
        >
          <fieldset className="filing-status-options">
            <legend className="eyebrow">How {year} is filed</legend>
            {FILING_STATUSES.map((candidate) => (
              <label key={candidate} className="filing-status-option">
                <input
                  ref={candidate === status ? checkedRef : undefined}
                  type="radio"
                  name={radioName}
                  value={candidate}
                  checked={selected === candidate}
                  onChange={() => setSelected(candidate)}
                />
                {FILING_STATUS_LABELS[candidate]}
                {candidate === status ? ' (current)' : ''}
              </label>
            ))}
          </fieldset>
          {loading && <p className="drill-hint">Reading what each status means for {year}…</p>}
          <FeedBanner error={error} retry={load} />
          {lines.length > 0 && (
            <ul className="filing-status-consequences">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <div className="filing-status-actions">
            <button
              type="button"
              className="button button-primary"
              // Not while the rules are still being read — the point of the dialog is that the
              // change is made with its consequences on screen — and not while the page is busy.
              disabled={!chosen || loading || disabled}
              onClick={() => {
                onChange(selected)
                close()
                triggerRef.current?.focus()
              }}
            >
              {chosen ? `Change to ${FILING_STATUS_LABELS[selected]}` : 'Change to…'}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                close()
                triggerRef.current?.focus()
              }}
            >
              Keep {label}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

