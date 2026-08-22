import { useEffect, useState } from 'react'
import type { ClipboardEvent } from 'react'
import { ApiError } from '../../api/client'
import { putTaxInputs } from '../../api/taxes'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import type { TaxInputsOut } from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency } from '../../utils/format'
import { classifyPaste, matchLabel } from '../../utils/paste'
import './taxes.css'

// The three sections the seed ships (tax_keys.SECTIONS). A section added later still
// renders — the API appends unknown ones, so the fallback humanizes its key rather than
// dropping the rows.
const SECTION_LABELS: Record<string, string> = {
  ordinary_income: 'Ordinary income',
  deductions: 'Deductions',
  capital_gains: 'Capital gains',
}

function sectionLabel(name: string): string {
  return SECTION_LABELS[name] ?? name.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase())
}

function valuesOf(inputs: TaxInputsOut): Record<string, string> {
  const values: Record<string, string> = {}
  for (const section of inputs.sections) {
    // A null stored value is a BLANK field, never "0": blank is exactly what unsets it.
    for (const item of section.items) values[item.key] = item.value ?? ''
  }
  return values
}

export default function InputsForm({
  inputs,
  onSaved,
  onDirtyChange,
}: {
  inputs: TaxInputsOut
  onSaved: (updated: TaxInputsOut) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  // `values` is what the user sees, `baseline` what the server last confirmed — the PUT
  // body is their diff, so an untouched key is never sent (sending one blank would DELETE
  // a stored input the user never looked at). Both seed from a useState INITIALIZER, so a
  // prop replacement (the page refetching the same year) cannot overwrite typed work —
  // only a save echo, or a remount on a real year switch, re-adopts a baseline.
  const [values, setValues] = useState<Record<string, string>>(() => valuesOf(inputs))
  const [baseline, setBaseline] = useState<Record<string, string>>(() => valuesOf(inputs))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // What the last paste did, narrated for everyone (spec §4.1) — one line, replaced by the
  // next paste and dropped by the save echo. The flashed keys are the cells it wrote.
  const [pasteNote, setPasteNote] = useState<string | null>(null)
  const [flashKeys, setFlashKeys] = useState<Set<string>>(new Set())

  // Every line item the server sent, in RENDER order — the order Enter walks and the order a
  // positional paste fills. The diff below shares it, so "what paste can write" and "what a
  // save can send" are structurally the same set of keys.
  const flatItems = inputs.sections.flatMap((section) => section.items)

  const changed: Record<string, string | null> = {}
  const invalid: string[] = []
  for (const item of flatItems) {
    const next = (values[item.key] ?? '').trim()
    if (next === (baseline[item.key] ?? '')) continue
    changed[item.key] = next === '' ? null : next
    if (next !== '' && !isAmount(next)) invalid.push(item.label)
  }
  const changedCount = Object.keys(changed).length

  // The page guards a year switch (and a Retry) with a confirm, so it has to know there is
  // unsaved work here. Reported from an effect rather than from every handler: an edit, an
  // Apply, a blank-out and a save echo all land on the same computed diff.
  useEffect(() => {
    onDirtyChange?.(changedCount > 0)
  }, [changedCount, onDirtyChange])

  // The flash is a one-shot: the timer callback clears it, so the effect body itself never
  // sets state (a set here would re-run the effect on its own write).
  useEffect(() => {
    if (flashKeys.size === 0) return
    const timer = setTimeout(() => setFlashKeys(new Set()), 700)
    return () => clearTimeout(timer)
  }, [flashKeys])

  const submit = () => {
    if (invalid.length > 0) {
      // "a number", not "a plain number": grouping, "$" and "=" arithmetic are all valid
      // entry now (spec §3.1/§3.2), so the older wording named a stricter rule than this
      // form enforces. Client-local sentence with no server twin, so it is ours to word.
      setError(`Enter a number for: ${invalid.join(', ')}`)
      return
    }
    if (changedCount === 0) return
    setSaving(true)
    setError(null)
    // The wire gets CANONICAL text, the on-screen diff above keeps counting the raw: a save
    // reached without a blur (Ctrl+Enter, a jsdom click) must not ship "$1,600" or
    // "=1200+400" to a Decimal column.
    putTaxInputs(inputs.year, {
      values: Object.fromEntries(
        Object.entries(changed).map(([key, text]) => [
          key,
          text === null ? null : canonicalAmount(text),
        ]),
      ),
    })
      .then((echo) => {
        // The echo is authoritative (4dp, and fresh suggestions): adopt it as both the
        // shown value and the new baseline, so a second save sends nothing.
        setValues(valuesOf(echo))
        setBaseline(valuesOf(echo))
        // The note described a pending fill that the echo just replaced — it would be
        // narrating values that are no longer on screen.
        setPasteNote(null)
        onSaved(echo)
      })
      .catch((err: unknown) => {
        // Includes the Apply-then-save path: a suggestion is an unbounded engine output,
        // so it can legitimately exceed the 10^10 input bound. The edits stay on screen.
        setError(err instanceof ApiError ? err.message : 'Save failed')
      })
      .finally(() => setSaving(false))
  }

  // Range paste (spec §4.1): this FORM owns the values record, so the scope container does
  // the filling — an AmountInput cannot write its siblings. A single-cell clipboard
  // classifies as null and falls through to native insertion, which the tolerant parse
  // already handles. Pasted text lands RAW, exactly as if typed: garbage shows the standard
  // .invalid, and canonicalAmount at the wire boundary is still what the server sees.
  const handlePaste = (e: ClipboardEvent<HTMLFormElement>) => {
    const plan = classifyPaste(e.clipboardData.getData('text/plain'))
    if (plan === null) return
    e.preventDefault()
    const fills: Record<string, string> = {}
    const flashed = new Set<string>()
    const unmatched: string[] = []
    let overflow = 0
    // An empty pasted cell SKIPS its target instead of blanking it: a blank here is the
    // wire's "unset this input", and a stray trailing tab must never delete a stored value.
    let blank = 0
    if (plan.mode === 'positional') {
      // Fill from the pasted-into cell onward, down the rendered column — across section
      // boundaries, the way Enter walks it.
      const ids = flatItems.map((item) => `tax-input-${item.key}`)
      const target = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-entry-cell]')
      const startAt = target === null ? 0 : Math.max(0, ids.indexOf(target.id))
      plan.values.forEach((value, i) => {
        const slot = startAt + i
        if (slot >= flatItems.length) {
          overflow += 1
          return
        }
        // The slot is consumed either way — a skipped blank must not shift the rest up.
        // (classifyPaste drops empty cells from a positional plan today; this keeps the
        // rule true of the array itself rather than of one caller's luck.)
        if (value === '') {
          blank += 1
          return
        }
        fills[flatItems[slot].key] = value
        flashed.add(flatItems[slot].key)
      })
    } else {
      // matchLabel keys on numeric ids, so the INDEX into flatItems serves as one.
      const labelled = flatItems.map((item, i) => ({ id: i, name: item.label }))
      for (const { label, value } of plan.rows) {
        const index = matchLabel(labelled, label)
        if (index === null) {
          unmatched.push(label)
        } else if (value === '') {
          blank += 1
        } else {
          fills[flatItems[index].key] = value
          flashed.add(flatItems[index].key)
        }
      }
      overflow = plan.skipped
    }
    if (Object.keys(fills).length > 0) setValues((current) => ({ ...current, ...fills }))
    setFlashKeys(flashed)
    const parts = [`Pasted ${Object.keys(fills).length} of ${flatItems.length} values`]
    if (unmatched.length > 0) {
      const shown = unmatched.slice(0, 4).join(', ')
      const more = unmatched.length > 4 ? `, +${unmatched.length - 4} more` : ''
      parts.push(`${unmatched.length} unmatched: ${shown}${more}`)
    }
    if (overflow > 0) parts.push(`${overflow} value${overflow === 1 ? '' : 's'} didn't fit`)
    if (blank > 0) parts.push(`${blank} blank${blank === 1 ? '' : 's'} skipped`)
    setPasteNote(parts.join(' · '))
  }

  return (
    <section className="card">
      <h2 className="eyebrow">
        Tax inputs — {inputs.year}
        <InfoHint text="The year&apos;s income and deduction line items — the old sheet&apos;s white cells. Grey suggestions derive from other lines and never auto-apply." />
      </h2>
      <p className="drill-hint">
        Stored values feed the engine; the chips are the sheet&apos;s formulas, offered and
        never applied for you. Clearing a field unsets that input.
      </p>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {/* One entry scope for every line item the server sent: Enter/ArrowDown walks the
          column across section boundaries, and from the last cell lands on Save — so Enter
          here ADVANCES rather than submitting, and Ctrl+Enter is what saves (spec §3.4). */}
      <form
        data-entry-scope=""
        onPaste={handlePaste}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {inputs.sections.map((section) => (
          <div key={section.section} className="tax-section">
            <h3 className="eyebrow">{sectionLabel(section.section)}</h3>
            <div className="tax-input-grid">
              {section.items.map((item) => {
                const id = `tax-input-${item.key}`
                const value = values[item.key] ?? ''
                // Offered only while it differs from what is in the box; the money form is
                // computed once because the chip, its title and the button's all show it.
                const suggestion =
                  item.suggested === null || item.suggested === value
                    ? null
                    : formatCurrency(item.suggested)
                return (
                  <div key={item.key} className="tax-input-row">
                    <span className="tax-input-label">
                      {/* The grid gives the label a wide track, but a long key can still
                          ellipsize — the title recovers the full text on hover. */}
                      <label htmlFor={id} title={item.label}>
                        {item.label}
                      </label>
                      {item.is_derived && <span className="badge">derived</span>}
                    </span>
                    <AmountInput
                      id={id}
                      className={
                        `${value.trim() !== '' && !isAmount(value) ? 'invalid' : ''}${
                          flashKeys.has(item.key) ? ' pasted-flash' : ''
                        }`.trim() || undefined
                      }
                      value={value}
                      onValueChange={(next) =>
                        setValues((current) => ({ ...current, [item.key]: next }))
                      }
                    />
                    {/* The track is reserved whether or not a suggestion is showing, so a
                        chip appearing mid-keystroke never shifts the input under the
                        cursor. */}
                    <span className="tax-suggestion">
                      {suggestion !== null && (
                        <>
                          <span className="tax-suggestion-value" title={suggestion}>
                            suggested {suggestion}
                          </span>
                          <button
                            type="button"
                            className="chip"
                            aria-label={`Apply suggestion for ${item.label}`}
                            title={`Apply ${suggestion}`}
                            onClick={() =>
                              setValues((current) => ({
                                ...current,
                                [item.key]: item.suggested ?? '',
                              }))
                            }
                          >
                            Apply
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {pasteNote && (
          <p className="drill-hint" role="status" aria-live="polite">
            {pasteNote}
          </p>
        )}
        <div className="tax-form-actions">
          <button
            type="submit"
            data-entry-primary=""
            className="button button-primary"
            disabled={saving || changedCount === 0}
          >
            {saving ? 'Saving…' : 'Save inputs'}
          </button>
          <span className="drill-hint">
            {changedCount === 0
              ? 'No changes yet'
              : `${changedCount} change${changedCount === 1 ? '' : 's'} to save`}
          </span>
        </div>
      </form>
    </section>
  )
}
