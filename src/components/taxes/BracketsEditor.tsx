import { useEffect, useState } from 'react'
import { ApiError } from '../../api/client'
import { JURISDICTIONS, putTaxBrackets } from '../../api/taxes'
import type { Jurisdiction } from '../../api/taxes'
import type { TaxBracketOut, TaxBracketsOut } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import { shiftPoint } from '../../utils/percent'
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
 * Round a decimal string to `places` decimals (>= 1) exactly the way the server will —
 * Decimal.quantize(..., ROUND_HALF_UP), i.e. ties away from zero.
 *
 * The API quantizes BEFORE it checks the bracket rules (app/api/taxes.py: quantize_price
 * at 4dp for the rate, quantize_money at 2dp for the threshold, then first-is-0 and
 * strictly-ascending). Validating the raw text would disagree with it in both directions:
 * "100.001" and "100.002" both land on 100.00 and are NOT ascending, while a first
 * threshold of "0.001" lands on 0.00 and IS legal. Same digits, same verdict.
 *
 * Anything that is not a plain decimal is handed back untouched — PLAIN_DECIMAL refuses it
 * first, so no rounding has to guess at it.
 */
function quantize(raw: string, places: number): string {
  const text = raw.trim()
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text)
  if (!match) return text
  const [, sign, whole, frac = ''] = match
  if (`${whole}${frac}` === '') return text
  const kept = `${whole === '' ? '0' : whole}${frac.slice(0, places).padEnd(places, '0')}`
  // HALF_UP reads exactly one dropped digit: 5..9 rounds the magnitude away from zero.
  const digits = frac.charAt(places) >= '5' ? addOne(kept) : kept
  const point = digits.length - places
  return `${sign}${digits.slice(0, point).replace(/^0+(?=\d)/, '')}.${digits.slice(point)}`
}

/** +1 on a digit string, carrying left and growing by one digit on an all-nines carry. */
function addOne(digits: string): string {
  const out = [...digits]
  let i = out.length - 1
  while (i >= 0 && out[i] === '9') {
    out[i] = '0'
    i -= 1
  }
  if (i < 0) return `1${out.join('')}`
  out[i] = String(Number(out[i]) + 1)
  return out.join('')
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
 *
 * Every comparison is made on the QUANTIZED value, because that is the number the server
 * compares (see quantize): a percent survives 2 decimals (the rate column keeps 4 as a
 * fraction) and a threshold 2.
 */
function validate(name: string, rows: RowState[]): string | null {
  if (rows.length > MAX_BRACKETS) {
    return `${name}: at most ${MAX_BRACKETS} brackets per jurisdiction`
  }
  let previous = 0
  for (const [index, row] of rows.entries()) {
    const position = `${name}[${index + 1}]`
    if (!PLAIN_DECIMAL.test(row.rate.trim())) return `${position}: rate must be a number`
    const rate = Number(quantize(row.rate, 2))
    if (rate < 0 || rate > 100) return `${position}: rate must be between 0% and 100%`
    if (!PLAIN_DECIMAL.test(row.threshold.trim())) {
      return `${position}: threshold must be a number`
    }
    const threshold = Number(quantize(row.threshold, 2))
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
  onDirtyChange,
}: {
  brackets: TaxBracketsOut
  onSaved: (updated: TaxBracketsOut) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  // A useState INITIALIZER, so a prop replacement (the page refetching the SAME year)
  // leaves half-typed tables alone; only a save echo, or a remount on a real year switch,
  // re-adopts the server's rows.
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

  // Unsaved work = the editable tables no longer read like the payload they came from.
  // Compared as text because that IS what is in the boxes ("10." is not yet "10"), and the
  // page turns this into the confirm that guards a year switch.
  const dirty = JSON.stringify(tables) !== JSON.stringify(tablesOf(brackets))
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  // A jurisdiction's error describes the table as it was when Save was pressed; the first
  // keystroke anywhere in it may be the fix, so the stale sentence goes then and there.
  const clearError = (name: string) =>
    setErrors((current) => (current[name] ? { ...current, [name]: '' } : current))

  const setRow = (name: string, index: number, field: keyof RowState, value: string) => {
    clearError(name)
    setTables((current) => ({
      ...current,
      [name]: (current[name] ?? []).map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    }))
  }

  const addRow = (name: string) => {
    clearError(name)
    setTables((current) => {
      const rows = current[name] ?? []
      // The API demands a 0 first threshold, so the first row is seeded with one.
      return { ...current, [name]: [...rows, { rate: '', threshold: rows.length === 0 ? '0' : '' }] }
    })
  }

  const removeRow = (name: string, index: number) => {
    clearError(name)
    setTables((current) => ({
      ...current,
      [name]: (current[name] ?? []).filter((_, i) => i !== index),
    }))
  }

  const save = (name: string) => {
    const rows = tables[name] ?? []
    const message = validate(name, rows)
    if (message !== null) {
      setErrors((current) => ({ ...current, [name]: message }))
      return
    }
    // An empty table is a DELETE-ALL — the PUT replaces the jurisdiction wholesale — and
    // removing the last row leaves Save one stray click from dropping the year's table.
    if (
      rows.length === 0 &&
      !window.confirm(`Delete all ${label(name)} brackets for ${brackets.year}?`)
    ) {
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
        Rates are entered as percents (37 = 37%) and stored as fractions with 4 decimal
        places, so a percent keeps 2 (37.005 saves as 37.01%); thresholds keep 2 as well.
        Every table starts at a 0 threshold and climbs; saving an empty table deletes that
        jurisdiction&apos;s rows. Each table saves on its own.
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
                            aria-label — and with no <label htmlFor> to point at it, an id
                            here would be dead weight. */}
                        <input
                          aria-label={`${label(name)} bracket ${index + 1} rate (%)`}
                          className="field-input"
                          inputMode="decimal"
                          value={row.rate}
                          onChange={(e) => setRow(name, index, 'rate', e.target.value)}
                        />
                      </td>
                      <td className="num">
                        <input
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
