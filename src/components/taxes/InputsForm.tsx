import { useEffect, useState } from 'react'
import { ApiError } from '../../api/client'
import { putTaxInputs } from '../../api/taxes'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import type { TaxInputsOut } from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency } from '../../utils/format'
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

  const changed: Record<string, string | null> = {}
  const invalid: string[] = []
  for (const section of inputs.sections) {
    for (const item of section.items) {
      const next = (values[item.key] ?? '').trim()
      if (next === (baseline[item.key] ?? '')) continue
      changed[item.key] = next === '' ? null : next
      if (next !== '' && !isAmount(next)) invalid.push(item.label)
    }
  }
  const changedCount = Object.keys(changed).length

  // The page guards a year switch (and a Retry) with a confirm, so it has to know there is
  // unsaved work here. Reported from an effect rather than from every handler: an edit, an
  // Apply, a blank-out and a save echo all land on the same computed diff.
  useEffect(() => {
    onDirtyChange?.(changedCount > 0)
  }, [changedCount, onDirtyChange])

  const submit = () => {
    if (invalid.length > 0) {
      setError(`Enter a plain number for: ${invalid.join(', ')}`)
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
        onSaved(echo)
      })
      .catch((err: unknown) => {
        // Includes the Apply-then-save path: a suggestion is an unbounded engine output,
        // so it can legitimately exceed the 10^10 input bound. The edits stay on screen.
        setError(err instanceof ApiError ? err.message : 'Save failed')
      })
      .finally(() => setSaving(false))
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
                      className={value !== '' && !isAmount(value) ? 'invalid' : undefined}
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
