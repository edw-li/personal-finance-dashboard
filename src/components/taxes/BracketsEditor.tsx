import { Fragment, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import {
  cloneBrackets,
  fetchTaxBrackets,
  FILING_STATUS_LABELS,
  FILING_STATUSES,
  JURISDICTIONS,
  jurisdictionLabel,
  PER_WORKER_JURISDICTIONS,
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
  TaxPersonOut,
} from '../../types/api'
import { canonicalAmount, parseAmount, quantize } from '../../utils/amount'
import { formatCurrency } from '../../utils/format'
import { isPlainDecimal, shiftPoint } from '../../utils/percent'
import { FeedBanner } from '../shell/Feed'
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

/**
 * The key a table's rows, its error and its in-flight save are all filed under: the
 * jurisdiction ALONE for the default table everyone walks, and jurisdiction + person for one
 * earner's own copy. One vocabulary across the three maps, so a person's 422 can never
 * surface under the default table beside it.
 */
function tableKey(name: string, personId?: number): string {
  return personId === undefined ? name : `${name}:${personId}`
}

function tablesOf(brackets: TaxBracketsOut): Record<string, RowState[]> {
  const tables: Record<string, RowState[]> = {}
  for (const [name, rows] of Object.entries(brackets.jurisdictions)) tables[name] = rowsOf(rows)
  // A person's own tables ride beside the defaults under their own keys. An EMPTY list is
  // NOT a table — that earner simply falls back to the default — so it gets no slot at all,
  // which is what keeps "Add a table for …" on screen for them.
  //
  // `people` and `per_person` are REQUIRED on TaxBracketsOut — that is the contract — and
  // the `?? []` here and at the three other read sites below covers ONE window: this lane
  // merges before the server lane, so a browser held open against a server that predates
  // them would hand this file an absent field rather than an empty list.
  for (const person of brackets.per_person ?? []) {
    for (const [name, rows] of Object.entries(person.jurisdictions)) {
      if (rows.length > 0) tables[tableKey(name, person.person_id)] = rowsOf(rows)
    }
  }
  return tables
}

// Dirty is a text comparison of the tables on screen against the payload they came from, and
// a seeded draft is APPENDED to them while the payload lists it in roster order — so the two
// are serialized key-sorted. Identical rows must not read as unsaved work merely because
// they were built in a different order.
function serialize(tables: Record<string, RowState[]>): string {
  return JSON.stringify(
    Object.entries(tables).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
}

/**
 * One editable rate table: the grid, and nothing around it. A default block and a person's
 * card wear different heads and different buttons, but the rows between them are the same
 * rows — and `title` is what every accessible name in here is built from, so a person's
 * cells are never confused with the default's by a reader or by a query.
 */
function BracketRows({
  title,
  rows,
  onCell,
  onRemoveRow,
}: {
  title: string
  rows: RowState[]
  onCell: (index: number, field: keyof RowState, value: string) => void
  onRemoveRow: (index: number) => void
}) {
  if (rows.length === 0) return <p className="empty-note">No brackets for {title}.</p>
  return (
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
        {/* Position IS the identity here — the server renumbers bracket_index on every
            replace — and both inputs are controlled from this array, so an index key cannot
            strand a typed value in a reused row. */}
        {rows.map((row, index) => {
          // Parsed for the live echo below, which is the one thing on screen that reads the
          // threshold MID-KEYSTROKE — so it has to speak every form the box accepts, not
          // just the plain decimals the wire ends up carrying.
          const parsedThreshold = parseAmount(row.threshold)
          return (
            <tr key={index}>
              <td>{index + 1}</td>
              <td className="num">
                {/* The column header carries the visible label; a per-cell one would repeat
                    it on every row, so the accessible name is an aria-label — and with no
                    <label htmlFor> to point at it, an id here would be dead weight. */}
                <AmountInput
                  aria-label={`${title} bracket ${index + 1} rate (%)`}
                  kind="percent"
                  value={row.rate}
                  onValueChange={(next) => onCell(index, 'rate', next)}
                />
              </td>
              <td className="num">
                <AmountInput
                  aria-label={`${title} bracket ${index + 1} threshold`}
                  value={row.threshold}
                  onValueChange={(next) => onCell(index, 'threshold', next)}
                />
                {/* Money echo of what is being typed, in any accepted NON-EXPRESSION form
                    ("$1,234" reads back "$1,234.00" before any blur); skipped while the text
                    is not a number yet, so a half-typed value never reads "$NaN", and an "="
                    entry echoes nothing until it commits — nothing evaluates live anywhere
                    in this layer. The blurred in-input echo does not cover this: it only
                    appears once the cell is left. */}
                <span className="drill-hint">
                  {parsedThreshold ? formatCurrency(parsedThreshold.canonical) : ''}
                </span>
              </td>
              <td>
                <button
                  type="button"
                  className="button"
                  aria-label={`Remove ${title} bracket ${index + 1}`}
                  onClick={() => onRemoveRow(index)}
                >
                  Remove
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
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
  // in-flight table's key is what disables the others' buttons — the tabs included, since a
  // tab switch replaces the very tables a save is about to re-sync. `removing` is which
  // button started it, so only that one wears the progress word.
  const [saving, setSaving] = useState<{ key: string; removing: boolean } | null>(null)
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

  // The roster a return under THIS tab's status covers, and therefore the strip under each
  // per-worker table: everybody on a married-joint tab, the primary alone on a single one.
  const people = payload.people ?? []

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
  const dirty = serialize(tables) !== serialize(tablesOf(payload))
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  // Switching tabs replaces every table on screen, so it asks the same question the page's
  // reload doors ask — and it asks it BEFORE the request, so a declined confirm cannot leave
  // a fetch in flight against a tab nobody opened. A save in flight closes the door too (the
  // buttons are disabled, and this is the keyboard's half of that): its echo re-syncs the
  // table it wrote and re-seats `payload`, which would land on — and mislabel — whichever
  // status' tables the tab switch had meanwhile put on screen.
  const openStatus = (status: FilingStatus) => {
    if (status === activeStatus || tabBusy || saving !== null) return
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

  // A table's error describes it as it was when Save was pressed; the first keystroke
  // anywhere in it may be the fix, so the stale sentence goes then and there. Every helper
  // below takes a table KEY (see tableKey): the default's is the jurisdiction name itself.
  const clearError = (key: string) =>
    setErrors((current) => (current[key] ? { ...current, [key]: '' } : current))

  const setRow = (key: string, index: number, field: keyof RowState, value: string) => {
    clearError(key)
    setTables((current) => ({
      ...current,
      [key]: (current[key] ?? []).map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    }))
  }

  const addRow = (key: string) => {
    clearError(key)
    setTables((current) => {
      const rows = current[key] ?? []
      // The API demands a 0 first threshold, so the first row is seeded with one.
      return { ...current, [key]: [...rows, { rate: '', threshold: rows.length === 0 ? '0' : '' }] }
    })
  }

  const removeRow = (key: string, index: number) => {
    clearError(key)
    setTables((current) => ({
      ...current,
      [key]: (current[key] ?? []).filter((_, i) => i !== index),
    }))
  }

  // Seeds a DRAFT of one person's table from the default rows AS THEY STAND on screen: a
  // person's table is nearly always the default with one number moved, so a blank grid would
  // be a transcription job. Client-side only — nothing is written until its own Save.
  const addPersonTable = (name: string, personId: number) => {
    setTables((current) => ({
      ...current,
      [tableKey(name, personId)]: (current[name] ?? []).map((row) => ({ ...row })),
    }))
  }

  // The draft's own way out. No request and no confirm: the server was never told about it,
  // so there is nothing to delete and nothing to warn about.
  const discardPersonTable = (key: string) => {
    clearError(key)
    setTables((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  /**
   * Does the SERVER hold this person's table? A draft exists only on screen — `Add a table
   * for …` seeds one from the default rows and nothing is written until its own Save — so
   * its way out is a discard rather than a delete nobody has been told to do. `submit` and
   * the card's buttons ask the same question, from the same place.
   */
  const hasStoredTable = (name: string, personId: number) =>
    (payload.per_person ?? []).some(
      (entry) => entry.person_id === personId && (entry.jurisdictions[name] ?? []).length > 0,
    )

  /**
   * The write itself, and the confirm that guards an empty one. An empty table is a
   * DELETE-ALL — the PUT replaces the (jurisdiction, status, person) wholesale — and removing
   * the last row leaves Save one stray click from dropping a year's table; `Remove — use the
   * default` comes through here with `[]` on purpose, so there is ONE delete path. The status
   * is named in the question because the same jurisdiction has one table per status, and a
   * person is named because it is THEIR table, not the year's, that is about to go.
   *
   * `removing` says which BUTTON is in flight, and nothing else: the request is the same one
   * either way, but a Save that reads "Saving…" while the user pressed Remove names the
   * wrong act.
   */
  const submit = (
    name: string,
    person: TaxPersonOut | undefined,
    rows: RowState[],
    removing = false,
  ) => {
    const key = tableKey(name, person?.id)
    // An empty DRAFT is not a deletion: the server was never told about this table, so there
    // is nothing to ask about and nothing to write — Save does here exactly what `Discard
    // draft` does. Reachable from a person's Save under a default table that has no rows
    // itself, where the seeded draft opens empty.
    if (person !== undefined && rows.length === 0 && !hasStoredTable(name, person.id)) {
      discardPersonTable(key)
      return
    }
    const status = FILING_STATUS_LABELS[activeStatus]
    const question =
      person === undefined
        ? `Delete all ${label(name)} brackets for ${brackets.year} (${status})?`
        : `Delete ${person.name}'s ${label(name)} table for ${brackets.year} (${status})? ` +
          'They fall back to the default.'
    if (rows.length === 0 && !window.confirm(question)) return
    setSaving({ key, removing })
    setErrors((current) => ({ ...current, [key]: '' }))
    // ONLY this jurisdiction, only this STATUS, and only this table: the PUT is a full
    // replace per (jurisdiction, status, person) present in the body, so shipping all six —
    // or leaving the status off, which the server would read as 'single' — would rewrite
    // tables the user never opened. `person_id` is OMITTED for a default save, so that wire
    // is byte-identical to the one that shipped before person tables existed.
    putTaxBrackets(brackets.year, {
      filing_status: activeStatus,
      ...(person === undefined ? {} : { person_id: person.id }),
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
        setTables((current) => {
          const next = { ...current }
          const echoed =
            person === undefined
              ? (echo.jurisdictions[name] ?? [])
              : ((echo.per_person ?? []).find((entry) => entry.person_id === person.id)
                  ?.jurisdictions[name] ?? [])
          // No rows for a person is no TABLE: the slot goes, and the strip offers to add one
          // again. A default table keeps its (empty) slot — the six always exist.
          if (person !== undefined && echoed.length === 0) delete next[key]
          else next[key] = rowsOf(echoed)
          return next
        })
        setPayload(echo)
        // The badge asked for a review of the DEFAULT table; a person's copy of it is not
        // that review, so it leaves the badge standing.
        if (person === undefined) {
          setReviewFlags((current) =>
            current === null
              ? null
              : {
                  verbatim_ok: current.verbatim_ok.filter((j) => j !== name),
                  review: current.review.filter((j) => j !== name),
                },
          )
        }
        onSaved(echo)
      })
      .catch((err: unknown) => {
        setErrors((current) => ({
          ...current,
          [key]: err instanceof ApiError ? err.message : 'Save failed',
        }))
      })
      .finally(() => setSaving(null))
  }

  const save = (name: string, person?: TaxPersonOut) => {
    // Canonicalize BEFORE validating: a save reached without a blur (Ctrl+Enter, a jsdom
    // click) would otherwise hand "$100,000" to isPlainDecimal and be refused for a shape
    // the entry layer accepts. Garbage comes back verbatim, so it still trips the same
    // worded errors below, and the PUT ships exactly what validate() judged.
    // The rate cell is kind="percent", whose component refuses "=" outright, so the save
    // must not evaluate what the cell itself marked invalid — left to the money default,
    // "=1/8" would quantize to 0.13 and store a 0.13% rate nobody typed. The threshold IS a
    // money cell, so an expression there is legitimate and keeps the default.
    const key = tableKey(name, person?.id)
    const rows = (tables[key] ?? []).map((row) => ({
      rate: canonicalAmount(row.rate, { expressions: false }),
      threshold: canonicalAmount(row.threshold),
    }))
    // The sentence names the JURISDICTION whichever table it came from, because the server's
    // twin does: one table per person does not make a second vocabulary.
    const message = validate(name, rows)
    if (message !== null) {
      setErrors((current) => ({ ...current, [key]: message }))
      return
    }
    submit(name, person, rows)
  }

  /**
   * One earner's card in the strip under a per-worker table: their own rows editor when they
   * have a table (stored or a draft), and the offer to start one when they do not.
   */
  const personCard = (name: string, person: TaxPersonOut) => {
    const key = tableKey(name, person.id)
    const rows = tables[key]
    const title = `${label(name)} — ${person.name}`
    const stored = hasStoredTable(name, person.id)
    if (rows === undefined) {
      return (
        <div key={person.id} className="bracket-person">
          {/* The visible text is short because the same words sit under both per-worker
              tables, so the jurisdiction is APPENDED to it for a reader rather than
              replacing it in an aria-label: a spoken name that does not contain the words
              on the button is a name voice control cannot be told (WCAG 2.5.3). The three
              strip buttons all carry their context the same way. */}
          <button
            type="button"
            className="button"
            onClick={() => addPersonTable(name, person.id)}
          >
            Add a table for {person.name}
            <span className="visually-hidden"> — {label(name)}</span>
          </button>
        </div>
      )
    }
    return (
      <form
        key={person.id}
        className="bracket-person"
        data-entry-scope=""
        onSubmit={(e) => {
          e.preventDefault()
          save(name, person)
        }}
      >
        <h4 className="bracket-person-head">{title}</h4>
        <FeedBanner error={errors[key]} />
        <BracketRows
          title={title}
          rows={rows}
          onCell={(index, field, value) => setRow(key, index, field, value)}
          onRemoveRow={(index) => removeRow(key, index)}
        />
        <div className="bracket-actions">
          <button
            type="button"
            className="button"
            aria-label={`Add ${title} bracket`}
            disabled={rows.length >= MAX_BRACKETS}
            onClick={() => addRow(key)}
          >
            Add bracket
          </button>
          <button
            type="submit"
            data-entry-primary=""
            className="button button-primary"
            aria-label={`Save ${title} brackets`}
            disabled={saving !== null}
          >
            {/* Whose flight this is: the Remove button beside it starts the same request,
                and only the button that was pressed says what is happening. */}
            {saving?.key === key && !saving.removing ? 'Saving…' : 'Save'}
          </button>
          {stored ? (
            <button
              type="button"
              className="button"
              disabled={saving !== null}
              onClick={() => submit(name, person, [], /* removing */ true)}
            >
              {saving?.key === key && saving.removing ? 'Removing…' : 'Remove — use the default'}
              <span className="visually-hidden"> — {title}</span>
            </button>
          ) : (
            <button
              type="button"
              className="button"
              disabled={saving !== null}
              onClick={() => discardPersonTable(key)}
            >
              Discard draft
              <span className="visually-hidden"> — {title}</span>
            </button>
          )}
        </div>
      </form>
    )
  }

  return (
    <section className="card">
      <h2 className="eyebrow">
        Bracket tables — {brackets.year}
        <InfoHint text="The rate tables the engine walks, one per jurisdiction; thresholds are inclusive floors and must ascend from 0. Social Security and Disability may also carry a table per person." />
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
            disabled={tabBusy || saving !== null}
            onClick={() => openStatus(status)}
          >
            {FILING_STATUS_LABELS[status]}
          </button>
        ))}
      </div>
      <FeedBanner error={tabError} />
      {activeStatus !== 'single' && isEmpty && (
        <div className="bracket-clone">
          <p className="drill-hint">
            No {FILING_STATUS_LABELS[activeStatus]} tables for {brackets.year} yet. Copying
            this year&apos;s single-filer tables gives every jurisdiction the right shape —
            Social Security and Disability are per-person parameters and come across correct,
            including any per-person tables, while the thresholds that move with filing status
            are then edited below.
          </p>
          <button type="button" className="button button-primary" disabled={tabBusy} onClick={clone}>
            {tabBusy ? 'Cloning…' : `Clone from ${brackets.year} single tables`}
          </button>
        </div>
      )}
      {JURISDICTIONS.map((name) => {
        const rows = tables[name] ?? []
        const message = errors[name]
        const perWorker = PER_WORKER_JURISDICTIONS.includes(name)
        // Social Security and SDI are per-WORKER taxes: the table here is the default, and
        // each earner the return covers may carry their own beneath it.
        const strip = perWorker && people.length > 0
        // One scope PER jurisdiction, matching the one Save each table has: Enter walks
        // this table's rate/threshold cells and stops at its own Save, never wandering into
        // the next jurisdiction's rows. A person's card is a scope of its own for the same
        // reason — and a SIBLING of this form rather than a child, because forms do not nest.
        return (
          <Fragment key={name}>
            <form
              className={strip ? 'bracket-block has-person-strip' : 'bracket-block'}
              data-entry-scope=""
              onSubmit={(e) => {
                e.preventDefault()
                save(name)
              }}
            >
              <h3 className="eyebrow">
                {label(name)} brackets
                {perWorker ? ' — default for everyone' : ''}
                {badgeFor(name)}
              </h3>
              <FeedBanner error={message} />
              <BracketRows
                title={label(name)}
                rows={rows}
                onCell={(index, field, value) => setRow(name, index, field, value)}
                onRemoveRow={(index) => removeRow(name, index)}
              />
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
                  {saving?.key === name ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
            {strip && (
              <div className="bracket-person-strip">
                {people.map((person) => personCard(name, person))}
                <p className="drill-hint">
                  Per-worker tax: the default applies to anyone without their own table. Add
                  one for an earner on an employer&apos;s voluntary plan, or in a job exempt
                  from Social Security.
                </p>
              </div>
            )}
          </Fragment>
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
