import { useState } from 'react'
import { ApiError } from '../../api/client'
import { JURISDICTIONS, putTaxBrackets } from '../../api/taxes'
import type { Jurisdiction } from '../../api/taxes'
import type { TaxBracketOut, TaxBracketsOut } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import './taxes.css'

const LABELS: Record<string, string> = {
  federal: 'Federal',
  state: 'State',
  medicare: 'Medicare',
  social_security: 'Social Security',
  disability: 'Disability',
  capital_gains: 'Capital gains',
}

// Mirrors the API's own ceiling (app/api/taxes.py MAX_BRACKETS).
const MAX_BRACKETS = 12

const PLAIN_DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/

interface RowState {
  rate: string // percent form — "37", never "0.3700"
  threshold: string
}

function label(name: string): string {
  return LABELS[name] ?? name
}

/**
 * Move a decimal string's point by `places`, keeping every digit exact.
 *
 * The editor shows percents while the column stores fractions, and float division would
 * make that round trip lossy: 9.3 / 100 is 0.09299999999999999 in binary, and that string
 * would be saved as the year's real state tax rate. Shifting the point across the digits
 * pins "37" -> "0.37", "9.3" -> "0.093", "1.45" -> "0.0145" (and back).
 *
 * Anything that is not a plain decimal is handed back untouched — validation refuses it
 * before a save, so no conversion has to guess at it.
 */
function shiftPoint(raw: string, places: number): string {
  const text = raw.trim()
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text)
  if (!match) return text
  const [, sign, whole, frac = ''] = match
  const digits = `${whole}${frac}`
  if (digits === '') return text
  let point = whole.length + places
  let shifted = digits
  if (point <= 0) {
    shifted = `${'0'.repeat(1 - point)}${digits}` // one leading zero survives: "0.37"
    point = 1
  } else if (point > shifted.length) {
    shifted = shifted.padEnd(point, '0')
  }
  const head = shifted.slice(0, point).replace(/^0+(?=\d)/, '')
  const tail = shifted.slice(point).replace(/0+$/, '')
  return `${sign}${tail === '' ? head : `${head}.${tail}`}`
}

function rowsOf(rows: TaxBracketOut[]): RowState[] {
  return rows.map((row) => ({ rate: shiftPoint(row.rate, 2), threshold: row.threshold }))
}

function tablesOf(brackets: TaxBracketsOut): Record<string, RowState[]> {
  const tables: Record<string, RowState[]> = {}
  for (const [name, rows] of Object.entries(brackets.jurisdictions)) tables[name] = rowsOf(rows)
  return tables
}

/**
 * The API's own checks, run before the request: first threshold 0, strictly ascending
 * afterwards, rate within range (stated in percent, because that is what is on screen).
 * The messages that have a server twin are worded identically — one vocabulary.
 */
function validate(name: string, rows: RowState[]): string | null {
  if (rows.length > MAX_BRACKETS) {
    return `${name}: at most ${MAX_BRACKETS} brackets per jurisdiction`
  }
  let previous = 0
  for (const [index, row] of rows.entries()) {
    const position = `${name}[${index + 1}]`
    if (!PLAIN_DECIMAL.test(row.rate.trim())) return `${position}: rate must be a number`
    const rate = Number(row.rate)
    if (rate < 0 || rate > 100) return `${position}: rate must be between 0% and 100%`
    if (!PLAIN_DECIMAL.test(row.threshold.trim())) {
      return `${position}: threshold must be a number`
    }
    const threshold = Number(row.threshold)
    if (index === 0) {
      if (threshold !== 0) return `${name}: the first bracket threshold must be 0`
    } else if (threshold <= previous) {
      return `${name}: thresholds must be strictly ascending`
    }
    previous = threshold
  }
  return null
}

export default function BracketsEditor({
  brackets,
  onSaved,
}: {
  brackets: TaxBracketsOut
  onSaved: (updated: TaxBracketsOut) => void
}) {
  const [tables, setTables] = useState<Record<string, RowState[]>>(() => tablesOf(brackets))
  // Single-flight across the whole editor: one jurisdiction saves at a time, and the
  // in-flight name is what disables the others' buttons.
  const [saving, setSaving] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // JURISDICTIONS is a readonly tuple, so its .includes() takes the literal union — the
  // house cast (MonthlyUpdatePage's `STEPS.includes(stepParam as Step)`). An importer can
  // write a jurisdiction this API refuses, and a GET still returns it.
  const extras = Object.keys(brackets.jurisdictions)
    .filter((name) => !JURISDICTIONS.includes(name as Jurisdiction))
    .sort()

  const setRow = (name: string, index: number, field: keyof RowState, value: string) =>
    setTables((current) => ({
      ...current,
      [name]: (current[name] ?? []).map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    }))

  const addRow = (name: string) =>
    setTables((current) => {
      const rows = current[name] ?? []
      // The API demands a 0 first threshold, so the first row is seeded with one.
      return { ...current, [name]: [...rows, { rate: '', threshold: rows.length === 0 ? '0' : '' }] }
    })

  const removeRow = (name: string, index: number) =>
    setTables((current) => ({
      ...current,
      [name]: (current[name] ?? []).filter((_, i) => i !== index),
    }))

  const save = (name: string) => {
    const rows = tables[name] ?? []
    const message = validate(name, rows)
    if (message !== null) {
      setErrors((current) => ({ ...current, [name]: message }))
      return
    }
    setSaving(name)
    setErrors((current) => ({ ...current, [name]: '' }))
    // ONLY this jurisdiction: the PUT is a full replace per key present in the body, so
    // shipping all six would rewrite tables the user never opened.
    putTaxBrackets(brackets.year, {
      jurisdictions: {
        [name]: rows.map((row) => ({
          rate: shiftPoint(row.rate, -2),
          threshold: row.threshold.trim(),
        })),
      },
    })
      .then((echo) => {
        // Re-sync THIS table only (the server renumbered and quantized it); another
        // jurisdiction may be half-edited and must not be thrown away.
        setTables((current) => ({ ...current, [name]: rowsOf(echo.jurisdictions[name] ?? []) }))
        onSaved(echo)
      })
      .catch((err: unknown) => {
        setErrors((current) => ({
          ...current,
          [name]: err instanceof ApiError ? err.message : 'Save failed',
        }))
      })
      .finally(() => setSaving(null))
  }

  return (
    <section className="card">
      <h2 className="eyebrow">Bracket tables — {brackets.year}</h2>
      <p className="drill-hint">
        Rates are entered as percents (37 = 37%) and stored as fractions. Every table starts
        at a 0 threshold and climbs; saving an empty table deletes that jurisdiction&apos;s
        rows. Each table saves on its own.
      </p>
      {JURISDICTIONS.map((name) => {
        const rows = tables[name] ?? []
        const message = errors[name]
        return (
          <form
            key={name}
            className="bracket-block"
            onSubmit={(e) => {
              e.preventDefault()
              save(name)
            }}
          >
            <h3 className="eyebrow">{label(name)} brackets</h3>
            {message && (
              <div className="error-banner" role="alert">
                {message}
              </div>
            )}
            {rows.length === 0 ? (
              <p className="empty-note">No brackets for {label(name)}.</p>
            ) : (
              <table className="data-table bracket-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th className="num">Rate %</th>
                    <th className="num">Threshold</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {/* Position IS the identity here — the server renumbers bracket_index on
                      every replace — and both inputs are controlled from this array, so an
                      index key cannot strand a typed value in a reused row. */}
                  {rows.map((row, index) => (
                    <tr key={index}>
                      <td>{index + 1}</td>
                      <td className="num">
                        {/* The column header carries the visible label; a per-cell one
                            would repeat it on every row, so the accessible name is an
                            aria-label. */}
                        <input
                          id={`bracket-${name}-${index + 1}-rate`}
                          aria-label={`${label(name)} bracket ${index + 1} rate (%)`}
                          className="field-input"
                          inputMode="decimal"
                          value={row.rate}
                          onChange={(e) => setRow(name, index, 'rate', e.target.value)}
                        />
                      </td>
                      <td className="num">
                        <input
                          id={`bracket-${name}-${index + 1}-threshold`}
                          aria-label={`${label(name)} bracket ${index + 1} threshold`}
                          className="field-input"
                          inputMode="decimal"
                          value={row.threshold}
                          onChange={(e) => setRow(name, index, 'threshold', e.target.value)}
                        />
                        {/* Money echo of what was typed — skipped while the text is not a
                            number yet, so a half-typed value never reads "$NaN". */}
                        <span className="drill-hint">
                          {PLAIN_DECIMAL.test(row.threshold.trim())
                            ? formatCurrency(row.threshold)
                            : ''}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button"
                          aria-label={`Remove ${label(name)} bracket ${index + 1}`}
                          onClick={() => removeRow(name, index)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="bracket-actions">
              <button
                type="button"
                className="button"
                aria-label={`Add ${label(name)} bracket`}
                disabled={rows.length >= MAX_BRACKETS}
                onClick={() => addRow(name)}
              >
                Add bracket
              </button>
              <button
                type="submit"
                className="button button-primary"
                aria-label={`Save ${label(name)} brackets`}
                disabled={saving !== null}
              >
                {saving === name ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )
      })}
      {extras.map((name) => (
        <div key={name} className="bracket-block">
          <h3 className="eyebrow">{label(name)} brackets</h3>
          <p className="drill-hint">
            Imported jurisdiction — the API only writes the six above, so this table is
            read-only here.
          </p>
          <table className="data-table bracket-table">
            <thead>
              <tr>
                <th>#</th>
                <th className="num">Rate %</th>
                <th className="num">Threshold</th>
              </tr>
            </thead>
            <tbody>
              {(tables[name] ?? []).map((row, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td className="num">{row.rate}</td>
                  <td className="num">{formatCurrency(row.threshold)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  )
}
