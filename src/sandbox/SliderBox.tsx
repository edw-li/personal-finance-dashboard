import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import AmountInput from '../components/AmountInput'
import InfoHint from '../components/InfoHint'
import { canonicalAmount, isAmount } from '../utils/amount'
import { formatCurrency } from '../utils/format'
import { shiftPoint } from '../utils/percent'
import { compareDecimals, decimalsIn, subtractDecimals, trimZeros } from './decimal'
import DeltaChip from './DeltaChip'
import { toWireDecimal } from './scenarioUrl'
import './sandbox.css'

// A labelled range above an AmountInput of the same kind, on ONE wire value (2026-09-03
// planning-sandboxes spec §8.2). The slider runs on the fraction and the box shows the
// percent (shiftPoint), so the two cannot disagree by a unit — the percent shift happens in
// exactly this one place. Dragging emits commit=false; release, blur and Enter emit
// commit=true. The transient drag/typing text is control-local (AmountInput's own
// focused/raw posture), never a second copy of the knob: the parent's `value` is the URL's.
export interface SliderBoxProps {
  id: string
  label: string
  hint?: string
  kind: 'percent' | 'money' | 'plain'
  /** Wire vocabulary; '' = not set (derived / actual). */
  value: string
  /** The baseline's value: the track tick and the reset target. */
  actual: string | null
  min: string
  max: string
  step: string
  onChange: (next: string, commit: boolean) => void
  disabled?: boolean
}

/** A range input's float ("0.15500000000000003") back onto the step's grid, as a wire string. */
export function snapToStep(raw: string, step: string): string {
  const decimals = decimalsIn(step)
  return trimZeros(Number(raw).toFixed(decimals))
}

export default function SliderBox({
  id,
  label,
  hint,
  kind,
  value,
  actual,
  min,
  max,
  step,
  onChange,
  disabled,
}: SliderBoxProps) {
  // Drag text while the pointer is down (or a key is held) — cleared on release.
  const [drag, setDrag] = useState<string | null>(null)
  // Box text while typing — cleared on commit. A ref mirrors it because AmountInput's own
  // blur commit and our wrapper's blur run in the same event, before state has updated.
  const [draft, setDraft] = useState<string | null>(null)
  const draftRef = useRef<string | null>(null)
  const [boxError, setBoxError] = useState<string | null>(null)

  const toBox = (wire: string) => (kind === 'percent' ? shiftPoint(wire, 2) : wire)
  const fromBox = (text: string) => (kind === 'percent' ? shiftPoint(text, -2) : text)
  const display = (wire: string) =>
    kind === 'money' ? formatCurrency(wire) : kind === 'percent' ? `${toBox(wire)}%` : wire

  const shown = value !== '' ? value : (actual ?? min)
  const sliderValue = drag ?? shown
  const range = Number(max) - Number(min)
  const tickLeft = actual === null || range <= 0 ? null : ((Number(actual) - Number(min)) / range) * 100
  const delta = value === '' || actual === null ? null : subtractDecimals(value, actual)

  const commitBox = () => {
    const text = draftRef.current
    if (text === null) return
    draftRef.current = null
    setDraft(null)
    if (text.trim() === '') {
      setBoxError(null)
      onChange('', true)
      return
    }
    // Two gates, both this control's own. `isAmount` refuses the garbage; `toWireDecimal`
    // then normalizes the three spellings canonicalAmount hands back VERBATIM ("+15",
    // "200000.", ".5"), because the comparison below — and the codec that reads the URL
    // afterwards — speak only the wire grammar. Normalize BEFORE the percent shift, so the
    // shift is always given a decimal it can move.
    const typed = toWireDecimal(canonicalAmount(text, { expressions: false }))
    if (!isAmount(text, { expressions: false }) || typed === null) {
      setBoxError(`${label} must be a number`)
      return
    }
    const wire = fromBox(typed)
    if (compareDecimals(wire, min) < 0 || compareDecimals(wire, max) > 0) {
      setBoxError(`${label} must be between ${display(min)} and ${display(max)}`)
      return
    }
    setBoxError(null)
    onChange(wire, true)
  }

  const onBoxKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitBox()
    }
  }

  const release = () => {
    if (drag === null) return
    const settled = drag
    setDrag(null)
    onChange(settled, true)
  }

  return (
    <div className="slider-box">
      <div className="slider-box-head">
        <label htmlFor={`${id}-box`}>
          {label}
          {hint !== undefined && <InfoHint text={hint} />}
        </label>
        {value === '' ? (
          <span className="sandbox-badge">{actual === null ? 'not set' : 'derived'}</span>
        ) : (
          <DeltaChip
            value={delta === null ? null : kind === 'percent' ? shiftPoint(delta, 2) : delta}
            kind={kind === 'money' ? 'money' : kind === 'percent' ? 'points' : 'plain'}
          />
        )}
      </div>
      <div className="slider-box-track">
        <input
          id={`${id}-range`}
          type="range"
          aria-label={`${label} slider`}
          // A range announces its raw number, which for a percent knob is the FRACTION
          // ("0.15") and for money is unformatted. Say it in the box's own vocabulary.
          aria-valuetext={display(sliderValue)}
          min={Number(min)}
          max={Number(max)}
          step={Number(step)}
          value={Number(sliderValue)}
          disabled={disabled}
          onChange={(e) => {
            // React fires onChange on every input event for a range — this IS the drag.
            const next = snapToStep(e.currentTarget.value, step)
            setDrag(next)
            onChange(next, false)
          }}
          onMouseUp={release}
          onTouchEnd={release}
          onKeyUp={release}
          onBlur={release}
        />
        {tickLeft !== null && (
          <span className="slider-box-tick" style={{ left: `${tickLeft}%` }} aria-hidden="true" />
        )}
      </div>
      {/* The wrapper hears the box's blur/Enter AFTER AmountInput's own commit has rewritten
          the draft to canonical text (focusout bubbles), so `draftRef` is what ships. */}
      <div className="slider-box-row" onBlur={commitBox} onKeyDown={onBoxKey}>
        <AmountInput
          id={`${id}-box`}
          kind={kind}
          aria-label={label}
          // The alert below names the box; without the link a screen reader hears "invalid"
          // with no sentence, because the alert is not the input's accessible description.
          aria-describedby={boxError !== null ? `${id}-error` : undefined}
          value={draft ?? (value === '' ? '' : toBox(value))}
          placeholder={actual === null ? undefined : toBox(actual)}
          disabled={disabled}
          onValueChange={(next) => {
            draftRef.current = next
            setDraft(next)
          }}
        />
        {actual !== null && (
          <button
            type="button"
            className="slider-box-actual"
            disabled={disabled}
            onClick={() => {
              setBoxError(null)
              onChange(actual, true)
            }}
          >
            actual {display(actual)}
          </button>
        )}
      </div>
      {boxError !== null && (
        <p id={`${id}-error`} className="sandbox-field-error" role="alert">
          {boxError}
        </p>
      )}
    </div>
  )
}
