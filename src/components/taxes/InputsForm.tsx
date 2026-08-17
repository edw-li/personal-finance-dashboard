import { useState } from 'react'
import { ApiError } from '../../api/client'
import { putTaxInputs } from '../../api/taxes'
import type { TaxInputsOut } from '../../types/api'
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

// The API accepts what pydantic's Decimal parses; this is the plain-decimal subset, which
// keeps a thousands separator or an accidental "$" out of a round trip that would come
// back as an opaque 422. Exponent notation is refused rather than converted.
const PLAIN_DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/

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
}: {
  inputs: TaxInputsOut
  onSaved: (updated: TaxInputsOut) => void
}) {
  // `values` is what the user sees, `baseline` what the server last confirmed — the PUT
  // body is their diff, so an untouched key is never sent (sending one blank would DELETE
  // a stored input the user never looked at).
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
      if (next !== '' && !PLAIN_DECIMAL.test(next)) invalid.push(item.label)
    }
  }
  const changedCount = Object.keys(changed).length

  const submit = () => {
    if (invalid.length > 0) {
      setError(`Enter a plain number for: ${invalid.join(', ')}`)
      return
    }
    if (changedCount === 0) return
    setSaving(true)
    setError(null)
    putTaxInputs(inputs.year, { values: changed })
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
      <h2 className="eyebrow">Tax inputs — {inputs.year}</h2>
      <p className="drill-hint">
        Stored values feed the engine; the chips are the sheet&apos;s formulas, offered and
        never applied for you. Clearing a field unsets that input.
      </p>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <form
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
                return (
                  <div key={item.key} className="tax-input-row">
                    <span className="tax-input-label">
                      <label htmlFor={id}>{item.label}</label>
                      {item.is_derived && <span className="badge">derived</span>}
                    </span>
                    <input
                      id={id}
                      className={`field-input${
                        value !== '' && !PLAIN_DECIMAL.test(value.trim()) ? ' invalid' : ''
                      }`}
                      inputMode="decimal"
                      value={value}
                      onChange={(e) =>
                        setValues((current) => ({ ...current, [item.key]: e.target.value }))
                      }
                    />
                    <span className="tax-suggestion">
                      {item.suggested !== null && item.suggested !== value && (
                        <>
                          <span className="tax-suggestion-value">
                            suggested {formatCurrency(item.suggested)}
                          </span>
                          <button
                            type="button"
                            className="chip"
                            aria-label={`Apply suggestion for ${item.label}`}
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
