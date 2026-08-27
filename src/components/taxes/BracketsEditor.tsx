import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import {
  cloneBrackets,
  fetchTaxBrackets,
  FILING_STATUS_LABELS,
  FILING_STATUSES,
  JURISDICTIONS,
  jurisdictionLabel,
  putTaxBrackets,
} from '../../api/taxes'
import type { Jurisdiction } from '../../api/taxes'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import type {
  BracketCloneReviewFlags,
  FilingStatus,
  TaxBracketOut,
  TaxBracketsOut,
} from '../../types/api'
import { canonicalAmount, parseAmount, quantize } from '../../utils/amount'
import { formatCurrency } from '../../utils/format'
import { isPlainDecimal, shiftPoint } from '../../utils/percent'
import './taxes.css'

// The six jurisdictions' human names live in src/api/taxes.ts beside JURISDICTIONS, so this
// editor's headings and the summary panel's missing-tables call-to-action can never name the
// same table differently. Aliased rather than re-spelled at ~10 call sites.
const label = jurisdictionLabel

// Mirrors the API's own ceiling (app/api/taxes.py MAX_BRACKETS).
const MAX_BRACKETS = 12

interface RowState {
  rate: string // percent form — "37", never "0.3700"
  threshold: string
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
 * Every comparison is made on the QUANTIZED value (utils/amount's quantize, the server's
 * ROUND_HALF_UP), because that is the number the server compares: a percent survives 2
 * decimals (the rate column keeps 4 as a fraction) and a threshold 2. The API quantizes
 * BEFORE it checks the bracket rules (app/api/taxes.py: quantize_price at 4dp for the
 * rate, quantize_money at 2dp for the threshold, then first-is-0 and strictly-ascending),
 * so validating the raw text would disagree with it in both directions: "100.001" and
 * "100.002" both land on 100.00 and are NOT ascending, while a first threshold of "0.001"
 * lands on 0.00 and IS legal. Same digits, same verdict.
 */
function validate(name: string, rows: RowState[]): string | null {
  if (rows.length > MAX_BRACKETS) {
    return `${name}: at most ${MAX_BRACKETS} brackets per jurisdiction`
  }
  let previous = 0
  for (const [index, row] of rows.entries()) {
    const position = `${name}[${index + 1}]`
    // The shape shiftPoint will actually convert, and the gate the server does NOT stand
    // behind: Decimal("1e-3") is a legal 0.001, so an exponent-notation rate would be
    // stored as 0.1% with no 422 anywhere (src/utils/percent.ts's isPlainDecimal).
    if (!isPlainDecimal(row.rate)) return `${position}: rate must be a number`
    const rate = Number(quantize(row.rate, 2))
    if (rate < 0 || rate > 100) return `${position}: rate must be between 0% and 100%`
    if (!isPlainDecimal(row.threshold)) {
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
  yearStatus = brackets.filing_status,
  onSaved,
  onDirtyChange,
}: {
  brackets: TaxBracketsOut
  /**
   * The YEAR's own status: always a tab, even before it has a single row. Defaults to the
   * payload's status, which IS the year's on every page load — the page passes it explicitly
   * so the tab survives the render in which the row has flipped but the payload has not.
   */
  yearStatus?: FilingStatus
  onSaved: (updated: TaxBracketsOut) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  // The tab on screen, and the payload behind it. Both seed from the page's prop and are
  // then this editor's own: a tab press fetches, a save re-syncs. A useState INITIALIZER, so
  // a prop replacement (the page refetching the SAME year and status) leaves half-typed
  // tables alone; only a save echo, a tab switch, or a remount re-adopts the server's rows.
  const [activeStatus, setActiveStatus] = useState<FilingStatus>(brackets.filing_status)
  const [payload, setPayload] = useState<TaxBracketsOut>(brackets)
  const [tables, setTables] = useState<Record<string, RowState[]>>(() => tablesOf(brackets))
  // Single-flight across the whole editor: one jurisdiction saves at a time, and the
  // in-flight name is what disables the others' buttons.
  const [saving, setSaving] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  // The tab machinery's own flight and banner — a failed tab load is not a jurisdiction's
  // error, and putting it in `errors` would file it under a table nobody asked about.
  const [tabBusy, setTabBusy] = useState(false)
  const [tabError, setTabError] = useState<string | null>(null)
  // Tabs can be clicked faster than a fetch comes back; only the newest may land.
  const tabSeqRef = useRef(0)
  // What the last clone said about the tables it just wrote — advisory, and only about THIS
  // tab: cleared when another status is opened, and per-table when that table is saved (a
  // reviewed table has nothing left to be told about).
  const [reviewFlags, setReviewFlags] = useState<BracketCloneReviewFlags | null>(null)

  // JURISDICTIONS is a readonly tuple, so its .includes() takes the literal union — the
  // house cast (MonthlyUpdatePage's `STEPS.includes(stepParam as Step)`). An importer can
  // write a jurisdiction this API refuses, and a GET still returns it.
  const extras = Object.keys(payload.jurisdictions)
    .filter((name) => !JURISDICTIONS.includes(name as Jurisdiction))
    .sort()

  // The tab set: 'single' ALWAYS (the column default, the only status the importer writes and
  // the source every clone copies from), the year's own status (the one the engine walks,
  // even before it has tables), and any status that already has rows — so an MFJ table
  // entered ahead of the wedding stays reachable from a year still filed single.
  const tabs = FILING_STATUSES.filter(
    (status) =>
      status === 'single' || status === yearStatus || payload.statuses_with_rows.includes(status),
  )

  // Unsaved work = the editable tables no longer read like the payload they came from.
  // Compared as text because that IS what is in the boxes ("10." is not yet "10"), and the
  // page turns this into the confirm that guards a year switch.
  const dirty = JSON.stringify(tables) !== JSON.stringify(tablesOf(payload))
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  // Switching tabs replaces every table on screen, so it asks the same question the page's
  // reload doors ask — and it asks it BEFORE the request, so a declined confirm cannot leave
  // a fetch in flight against a tab nobody opened.
  const openStatus = (status: FilingStatus) => {
    if (status === activeStatus || tabBusy) return
    if (
      dirty &&
      !window.confirm(
        `Discard unsaved ${FILING_STATUS_LABELS[activeStatus]} bracket changes for ${brackets.year}?`,
      )
    ) {
      return
    }
    const seq = ++tabSeqRef.current
    setTabBusy(true)
    setTabError(null)
    // Both belong to the tab being left: a jurisdiction's error describes a table that is
    // about to be replaced, and the review badges describe a clone into another status.
    setErrors({})
    setReviewFlags(null)
    fetchTaxBrackets(brackets.year, status)
      .then((next) => {
        if (seq !== tabSeqRef.current) return
        setActiveStatus(status)
        setPayload(next)
        setTables(tablesOf(next))
      })
      .catch((err: unknown) => {
        if (seq !== tabSeqRef.current) return
        setTabError(
          err instanceof ApiError
            ? err.message
            : `Failed to load the ${FILING_STATUS_LABELS[status]} bracket tables`,
        )
      })
      .finally(() => {
        if (seq === tabSeqRef.current) setTabBusy(false)
      })
  }

  // A jurisdiction's error describes the table as it was when Save was pressed; the first
  // keystroke anywhere in it may be the fix, so the stale sentence goes then and there.
  // A status tab with no rows at all. Six empty tables are not an editing surface — they are
  // 42 rows of hand transcription — so the tab offers the clone instead.
  const isEmpty = Object.values(payload.jurisdictions).every((rows) => rows.length === 0)

  // Seeds this status from the SAME year's single tables (design §5.5: the clone source is
  // always single). 409 when the target already has rows, which `isEmpty` already prevents —
  // it lands in the banner verbatim if the server disagrees.
  const clone = () => {
    const seq = ++tabSeqRef.current
    setTabBusy(true)
    setTabError(null)
    cloneBrackets(brackets.year, brackets.year, activeStatus)
      .then((next) => {
        if (seq !== tabSeqRef.current) return
        setPayload(next)
        setTables(tablesOf(next))
        setReviewFlags(next.review_flags)
        // The year's bracket count moved, and when this IS the year's status the summary
        // moved with it: the page owns both refreshes, through the same door a save uses.
        onSaved(next)
      })
      .catch((err: unknown) => {
        if (seq !== tabSeqRef.current) return
        setTabError(err instanceof ApiError ? err.message : 'Clone failed')
      })
      .finally(() => {
        if (seq === tabSeqRef.current) setTabBusy(false)
      })
  }

  // Advisory badges from the clone response. Social Security's wage base and SDI's rate/cap
  // are per-person parameters that do not move with filing status, so the copy IS the answer;
  // federal, state, capital gains and Medicare's additional tier are status thresholds and
  // are only a starting shape.
  const badgeFor = (name: string) => {
    if (reviewFlags === null) return null
    if (reviewFlags.review.includes(name)) {
      return <span className="badge badge-review">review thresholds</span>
    }
    if (reviewFlags.verbatim_ok.includes(name)) {
      return <span className="badge">copied verbatim — usually correct</span>
    }
    return null
  }

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
    // Canonicalize BEFORE validating: a save reached without a blur (Ctrl+Enter, a jsdom
    // click) would otherwise hand "$100,000" to isPlainDecimal and be refused for a shape
    // the entry layer accepts. Garbage comes back verbatim, so it still trips the same
    // worded errors below, and the PUT ships exactly what validate() judged.
    // The rate cell is kind="percent", whose component refuses "=" outright, so the save
    // must not evaluate what the cell itself marked invalid — left to the money default,
    // "=1/8" would quantize to 0.13 and store a 0.13% rate nobody typed. The threshold IS a
    // money cell, so an expression there is legitimate and keeps the default.
    const rows = (tables[name] ?? []).map((row) => ({
      rate: canonicalAmount(row.rate, { expressions: false }),
      threshold: canonicalAmount(row.threshold),
    }))
    const message = validate(name, rows)
    if (message !== null) {
      setErrors((current) => ({ ...current, [name]: message }))
      return
    }
    // An empty table is a DELETE-ALL — the PUT replaces the (jurisdiction, status) wholesale
    // — and removing the last row leaves Save one stray click from dropping a year's table.
    // The status is named because the same jurisdiction has one table PER status.
    if (
      rows.length === 0 &&
      !window.confirm(
        `Delete all ${label(name)} brackets for ${brackets.year} (${
          FILING_STATUS_LABELS[activeStatus]
        })?`,
      )
    ) {
      return
    }
    setSaving(name)
    setErrors((current) => ({ ...current, [name]: '' }))
    // ONLY this jurisdiction, and only this STATUS: the PUT is a full replace per
    // (jurisdiction, status) present in the body, so shipping all six — or leaving the status
    // off, which the server would read as 'single' — would rewrite tables the user never
    // opened.
    putTaxBrackets(brackets.year, {
      filing_status: activeStatus,
      jurisdictions: {
        [name]: rows.map((row) => ({
          rate: shiftPoint(row.rate, -2),
          threshold: row.threshold,
        })),
      },
    })
      .then((echo) => {
        // Re-sync THIS table only (the server renumbered and quantized it); another
        // jurisdiction may be half-edited and must not be thrown away. The payload moves with
        // it so the dirty baseline stays the server's answer rather than the pre-save one.
        setTables((current) => ({ ...current, [name]: rowsOf(echo.jurisdictions[name] ?? []) }))
        setPayload(echo)
        // The badge asked for a review; this save IS the review.
        setReviewFlags((current) =>
          current === null
            ? null
            : {
                verbatim_ok: current.verbatim_ok.filter((j) => j !== name),
                review: current.review.filter((j) => j !== name),
              },
        )
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
      <h2 className="eyebrow">
        Bracket tables — {brackets.year}
        <InfoHint text="The rate tables the engine walks, one per jurisdiction; thresholds are inclusive floors and must ascend from 0." />
      </h2>
      <p className="drill-hint">
        Rates are entered as percents (37 = 37%) and stored as fractions with 4 decimal
        places, so a percent keeps 2 (37.005 saves as 37.01%); thresholds keep 2 as well.
        Every table starts at a 0 threshold and climbs; saving an empty table deletes that
        jurisdiction&apos;s rows. Each table saves on its own.
      </p>
      {/* One tab per status this year can be filed as. The same six tables exist behind each
          one — a full replace is per (jurisdiction, status) — so the tab is what decides
          which of them a Save rewrites. */}
      <div
        className="segmented bracket-status-tabs"
        role="group"
        aria-label="Bracket filing status"
      >
        {tabs.map((status) => (
          <button
            key={status}
            type="button"
            className={status === activeStatus ? 'active' : ''}
            aria-pressed={status === activeStatus}
            disabled={tabBusy}
            onClick={() => openStatus(status)}
          >
            {FILING_STATUS_LABELS[status]}
          </button>
        ))}
      </div>
      {tabError && (
        <div className="error-banner" role="alert">
          {tabError}
        </div>
      )}
      {activeStatus !== 'single' && isEmpty && (
        <div className="bracket-clone">
          <p className="drill-hint">
            No {FILING_STATUS_LABELS[activeStatus]} tables for {brackets.year} yet. Copying
            this year&apos;s single-filer tables gives every jurisdiction the right shape —
            Social Security and Disability are per-person parameters and come across correct,
            while the thresholds that move with filing status are then edited below.
          </p>
          <button type="button" className="button button-primary" disabled={tabBusy} onClick={clone}>
            {tabBusy ? 'Cloning…' : `Clone from ${brackets.year} single tables`}
          </button>
        </div>
      )}
      {JURISDICTIONS.map((name) => {
        const rows = tables[name] ?? []
        const message = errors[name]
        // One scope PER jurisdiction, matching the one Save each table has: Enter walks
        // this table's rate/threshold cells and stops at its own Save, never wandering into
        // the next jurisdiction's rows.
        return (
          <form
            key={name}
            className="bracket-block"
            data-entry-scope=""
            onSubmit={(e) => {
              e.preventDefault()
              save(name)
            }}
          >
            <h3 className="eyebrow">
              {label(name)} brackets
              {badgeFor(name)}
            </h3>
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
                  {rows.map((row, index) => {
                    // Parsed for the live echo below, which is the one thing on screen that
                    // reads the threshold MID-KEYSTROKE — so it has to speak every form the
                    // box accepts, not just the plain decimals the wire ends up carrying.
                    const parsedThreshold = parseAmount(row.threshold)
                    return (
                      <tr key={index}>
                        <td>{index + 1}</td>
                        <td className="num">
                          {/* The column header carries the visible label; a per-cell one
                              would repeat it on every row, so the accessible name is an
                              aria-label — and with no <label htmlFor> to point at it, an id
                              here would be dead weight. */}
                          <AmountInput
                            aria-label={`${label(name)} bracket ${index + 1} rate (%)`}
                            kind="percent"
                            value={row.rate}
                            onValueChange={(next) => setRow(name, index, 'rate', next)}
                          />
                        </td>
                        <td className="num">
                          <AmountInput
                            aria-label={`${label(name)} bracket ${index + 1} threshold`}
                            value={row.threshold}
                            onValueChange={(next) => setRow(name, index, 'threshold', next)}
                          />
                          {/* Money echo of what is being typed, in any accepted
                              NON-EXPRESSION form ("$1,234" reads back "$1,234.00" before
                              any blur); skipped while the text is not a number yet, so a
                              half-typed value never reads "$NaN", and an "=" entry echoes
                              nothing until it commits — nothing evaluates live anywhere in
                              this layer. The blurred in-input echo does not cover this: it
                              only appears once the cell is left. */}
                          <span className="drill-hint">
                            {parsedThreshold ? formatCurrency(parsedThreshold.canonical) : ''}
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
                    )
                  })}
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
                data-entry-primary=""
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
