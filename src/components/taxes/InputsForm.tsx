import { useEffect, useRef, useState } from 'react'
import type { ClipboardEvent } from 'react'
import { ApiError } from '../../api/client'
import { previewTaxInputs, putTaxInputs } from '../../api/taxes'
import AmountInput from '../AmountInput'
import type { AmountKind } from '../AmountInput'
import InfoHint from '../InfoHint'
import type {
  TaxInputItemOut,
  TaxInputRowIn,
  TaxInputSectionOut,
  TaxInputUnit,
  TaxInputsOut,
  TaxInputsUpdate,
  TaxPersonOut,
} from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency } from '../../utils/format'
import { isPlainDecimal, shiftPoint } from '../../utils/percent'
import { classifyPaste, matchLabel } from '../../utils/paste'
import { FeedBanner } from '../shell/Feed'
import { MOTION_MS } from '../../theme/motion'
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

// --- units (2026-09-09 spec §2) -------------------------------------------------------
// Three boxes, one wire. The server stamps every item with its unit and stores the same
// Numeric(14,4) either way; what differs is the box the value is TYPED in and the point
// shift between the two. Money is verbatim in both directions — its column is the one this
// form was built for, and trimming it would rewrite every stored "200000.0000". A count is
// shown without its trailing zeros. A percent is stored as the FRACTION the engine
// multiplies by and shown ×100, so "97.53%" saves 0.9753 — string math (shiftPoint), never
// a float divide, because 9.3 / 100 is 0.09300000000000001 and that would be the number
// saved (utils/percent.ts's whole reason for existing).
const UNIT_KINDS: Record<TaxInputUnit, AmountKind> = {
  money: 'money',
  count: 'count',
  percent: 'percent',
}

/**
 * The wire's value as this unit's box shows it. Non-decimal text passes through for the
 * validators to word, exactly as a money box's would.
 */
function toBox(unit: TaxInputUnit, stored: string | null): string {
  if (stored === null) return '' // blank, never "0": blank is what unsets an input
  if (unit === 'money' || !isPlainDecimal(stored)) return stored
  return shiftPoint(stored, unit === 'percent' ? 2 : 0)
}

/**
 * One box's text as the wire takes it. "=" arithmetic is money-only (AmountInput's rule:
 * the evaluator quantizes to 2dp, which would round a share of dividends to a hundredth).
 */
function toWire(unit: TaxInputUnit, text: string): string {
  const canonical = canonicalAmount(text, { expressions: unit === 'money' })
  if (unit !== 'percent' || !isPlainDecimal(canonical)) return canonical
  return shiftPoint(canonical, -2)
}

/** A whole number of things, with no sign and no point: what a COUNT box can hold. */
const WHOLE = /^\d+$/

/**
 * Whether one box's text is a SHAPE this unit can hold. `isAmount` alone is the money
 * rule, and it accepts "20.5" for a count of paychecks — which the server then 422s, so the
 * user reads a raw server sentence about a mistake the form could see. RANGE stays the
 * server's (0..53 checks, a 0..1 fraction): that is a fact about the tax year, not about
 * the shape of the text.
 */
function isWholeCount(unit: TaxInputUnit, text: string): boolean {
  return unit !== 'count' || WHOLE.test(canonicalAmount(text, { expressions: false }))
}

/** Both rules, for the places that only care whether the cell is enterable at all. */
function isEntry(unit: TaxInputUnit, text: string): boolean {
  return isAmount(text, { expressions: unit === 'money' }) && isWholeCount(unit, text)
}

/**
 * One wire figure as this unit reads it OUTSIDE a box: what a suggestion chip says, and what
 * a computed row shows. Suggestions and computed totals are both wire values like everything
 * else, so both are shown in the box's units.
 */
function figureText(unit: TaxInputUnit, wire: string): string {
  if (unit === 'money') return formatCurrency(wire)
  const shown = toBox(unit, wire)
  return unit === 'percent' ? `${shown}%` : shown
}

/** A computed line with no component entered: absent is not zero, so it shows neither. */
const NO_FIGURE = '—'

/**
 * How long after the last keystroke the computed totals are re-asked for. The answer to a
 * half-typed number is noise, and a request per character would be noise on the wire; 300 ms
 * is the pause that says "that's the number" without the figure ever feeling stale.
 */
const PREVIEW_DEBOUNCE_MS = 300

/** One person's column, with the name it is headed by. */
interface Column {
  id: number
  name: string
}

/**
 * ONE cell: a key on the household row, or a key on one person's row. `id` is the
 * bare key for a household cell — byte-identical to the id a single-status year rendered
 * before columns existed — and `key:personId` for a person cell. Tax keys are snake_case
 * identifiers and can never contain a colon, so the scheme stays unambiguous; nothing may
 * look these ids up with a CSS SELECTOR (`#a:b` would need escaping), and nothing does — the
 * positional paste compares `input.id` as a plain string.
 */
interface Cell {
  id: string
  key: string
  /** The box this key is entered through — money unless the server says count/percent. */
  unit: TaxInputUnit
  personId: number | null
  /** The item's own label: what an error sentence and a keyed paste match on. */
  itemLabel: string
  /** null on a household cell; the column's name on a person cell. */
  personName: string | null
  /**
   * A DERIVED total (2026-09-11 spec §1.6): the engine's own figure for this column, which
   * has no stored row and cannot be typed over. It is rendered and pasted past, but it is
   * not an entry cell — it never enters `values`, the walk, the change count or the PUT
   * body, and the server 422s a write to it.
   */
  computed: boolean
  value: string | null
  suggested: string | null
  /** "last year's" when the suggestion is a carry-forward rather than a sheet formula. */
  suggestionSource: string | null
}

/** One line of the grid: a key, and the one-or-two cells it is shown through. */
interface Row {
  key: string
  label: string
  isDerived: boolean
  /** The server's caption for a computed line ("Annual Salary ÷ 24"), null on an editable
   *  one. The row's, not the cell's: both columns of a per-person total share one formula. */
  formula: string | null
  cells: Cell[]
}

interface Section {
  name: string
  /** A person header is drawn only where it has per-person lines to head. */
  headed: boolean
  rows: Row[]
}

interface FormModel {
  columns: Column[]
  /** Two named columns, rather than the one every single-status year has always had. */
  split: boolean
  sections: Section[]
  /** Every EDITABLE box in render order — what Enter walks, what the diff counts and what
   *  the PUT body is built from. A computed cell is none of those things. */
  flatCells: Cell[]
  /** Every cell, computed ones included, in render order — the sheet's own column, which a
   *  positional paste has to line up against slot for slot. */
  allCells: Cell[]
}

/** The accessible name of one box. Two boxes carry the same item label, so they need more. */
function cellLabel(cell: Cell): string {
  return cell.personName === null ? cell.itemLabel : `${cell.itemLabel} — ${cell.personName}`
}

/** "Me"/"Partner" only when the roster carries no usable name for that column. */
function columnName(person: TaxPersonOut, index: number): string {
  const named = person.name.trim()
  if (named !== '') return named
  return index === 0 ? 'Me' : 'Partner'
}

/**
 * WHICH column a payload item addresses: its own person on a split year, the one unqualified
 * column otherwise. The GET's items and the preview's answer are read by the same rule, so a
 * preview figure can never land on a cell the GET would have spelled differently.
 */
function ownerOf(personId: number | null, split: boolean): number | null {
  return split && personId !== null ? personId : null
}

/** The id of the cell an item addresses, once its owner is resolved. */
function cellIdOf(key: string, owner: number | null): string {
  return owner === null ? key : `${key}:${owner}`
}

/**
 * One item's box. The server already narrowed the payload to the columns THIS year's status
 * covers and stamped each item with its `person_id`, so the only decision left here is
 * whether to QUALIFY it: with a single column — a single-status year, an MFS return, or a
 * roster-less database — the id stays the bare key and the write stays unqualified, which is
 * what keeps that year's DOM, paste targets and PUT body identical to today's.
 */
function cellOf(item: TaxInputItemOut, names: Map<number, string>, split: boolean): Cell {
  const personId = ownerOf(item.person_id, split)
  return {
    id: cellIdOf(item.key, personId),
    key: item.key,
    unit: item.unit,
    personId,
    itemLabel: item.label,
    personName: personId === null ? null : (names.get(personId) ?? null),
    computed: item.is_derived,
    value: item.value,
    suggested: item.suggested,
    suggestionSource: item.suggestion_source,
  }
}

/**
 * A section's items grouped into lines. The payload repeats a per-person key once per column
 * (adjacent, primary first), and a household key exactly once — so grouping by key on first
 * appearance preserves the server's order in both directions.
 */
function rowsOf(section: TaxInputSectionOut, names: Map<number, string>, split: boolean): Row[] {
  const rows: Row[] = []
  const byKey = new Map<string, Row>()
  for (const item of section.items) {
    let row = byKey.get(item.key)
    if (row === undefined) {
      row = {
        key: item.key,
        label: item.label,
        isDerived: item.is_derived,
        formula: item.formula,
        cells: [],
      }
      byKey.set(item.key, row)
      rows.push(row)
    }
    row.cells.push(cellOf(item, names, split))
  }
  return rows
}

function modelOf(inputs: TaxInputsOut): FormModel {
  // `people` is the server's own column list, already primary-first and already narrowed to
  // the people this year's return covers — everybody under married-joint, the primary alone
  // under single and MFS. Two boxes therefore need nothing but two columns.
  const columns = inputs.people.map((person, index) => ({
    id: person.id,
    name: columnName(person, index),
  }))
  const split = columns.length >= 2
  const names = new Map(columns.map((column) => [column.id, column.name]))
  const sections = inputs.sections.map((section) => ({
    name: section.section,
    headed: split && section.items.some((item) => item.is_per_person),
    rows: rowsOf(section, names, split),
  }))
  const allCells = sections.flatMap((section) => section.rows.flatMap((row) => row.cells))
  return {
    columns,
    split,
    sections,
    flatCells: allCells.filter((cell) => !cell.computed),
    allCells,
  }
}

function valuesOf(cells: Cell[]): Record<string, string> {
  const values: Record<string, string> = {}
  // A null stored value is a BLANK field, never "0": blank is exactly what unsets it.
  // Everything else arrives in the unit its own box is typed in, so `values` and `baseline`
  // speak one vocabulary and an untouched percent row still diffs as unchanged.
  for (const cell of cells) values[cell.id] = toBox(cell.unit, cell.value)
  return values
}

/**
 * The computed figures, in WIRE units, keyed by the cell that shows them. Kept apart from
 * `values` because these are not entries: nothing diffs them, nothing saves them, and the
 * only thing that ever writes one is the server — the payload, a preview, or a save echo.
 */
function figuresOf(cells: Cell[]): Record<string, string | null> {
  const figures: Record<string, string | null> = {}
  for (const cell of cells) if (cell.computed) figures[cell.id] = cell.value
  return figures
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
  const { columns, split, sections, flatCells, allCells } = modelOf(inputs)

  // `values` is what the user sees, `baseline` what the server last confirmed — the PUT
  // body is their diff, so an untouched cell is never sent (sending one blank would DELETE
  // a stored input the user never looked at). Both seed from a useState INITIALIZER, so a
  // prop replacement (the page refetching the same year) cannot overwrite typed work —
  // only a save echo, or a remount on a real year/status switch, re-adopts a baseline.
  const [values, setValues] = useState<Record<string, string>>(() => valuesOf(flatCells))
  const [baseline, setBaseline] = useState<Record<string, string>>(() => valuesOf(flatCells))
  // The computed totals on screen, seeded from the payload and replaced only by the server:
  // a preview answer while typing, the echo when a save lands.
  const [figures, setFigures] = useState<Record<string, string | null>>(() => figuresOf(allCells))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // What the last paste did, narrated for everyone (spec §4.1) — one line, replaced by the
  // next paste and dropped by the save echo. The flashed ids are the cells it wrote.
  const [pasteNote, setPasteNote] = useState<string | null>(null)
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set())
  // Which answer about the computed totals is the current one. Bumped by every preview AND
  // by every save echo, so "is this still the newest thing the server said?" is one
  // comparison — an out-of-order preview and a preview overtaken by a save are the same bug.
  const figureSeq = useRef(0)
  // The `values` object the SERVER handed us: the mount seed, then each save echo. A form
  // that still holds exactly that object already agrees with its figures, so previewing it
  // would spend a request to be told what we were just told. Compared by IDENTITY rather
  // than consumed as a one-shot flag, because StrictMode mounts effects twice in dev and a
  // flag would be spent on the first pass and let the second one ask.
  const serverValues = useRef(values)

  const changed: Record<string, string | null> = {}
  const invalid: string[] = []
  // A number, but not a WHOLE one, in a count box — its own list because "Enter a number
  // for: Pay periods" would be nonsense advice to someone who just entered 20.5.
  const notWhole: string[] = []
  for (const cell of flatCells) {
    const next = (values[cell.id] ?? '').trim()
    if (next === (baseline[cell.id] ?? '')) continue
    changed[cell.id] = next === '' ? null : next
    // The COLUMN is named too: on a married year two boxes wear the same item label, and
    // "Enter a number for: HSA Contributions" would not say which one.
    if (next === '') continue
    if (!isAmount(next, { expressions: cell.unit === 'money' })) invalid.push(cellLabel(cell))
    else if (!isWholeCount(cell.unit, next)) notWhole.push(cellLabel(cell))
  }
  const changedCount = Object.keys(changed).length

  // The page guards a year switch (and a Retry, and a status flip) with a confirm, so it has
  // to know there is unsaved work here. Reported from an effect rather than from every
  // handler: an edit, an Apply, a blank-out and a save echo all land on the same diff.
  useEffect(() => {
    onDirtyChange?.(changedCount > 0)
  }, [changedCount, onDirtyChange])

  /**
   * The whole form as a PUT body. The preview endpoint takes exactly the save's shape and
   * overlays it on the stored rows, so it has to hear about EVERY editable cell rather than
   * the diff: a cell left out would be read at its stored value, and the totals would follow
   * a form that is no longer on screen. A cell whose text is not a valid entry is left out
   * instead — the server would 422 the whole call over one half-typed number, and the
   * figures would freeze until it was finished.
   */
  const previewBody = (): TaxInputsUpdate => {
    const wireValues: Record<string, string | null> = {}
    const rows: TaxInputRowIn[] = []
    for (const cell of flatCells) {
      const text = (values[cell.id] ?? '').trim()
      if (text !== '' && !isEntry(cell.unit, text)) continue
      // Blank rides as null, exactly as it would in a save: the overlay unsets that input
      // for the length of the calculation, because absent is not zero.
      const wire = text === '' ? null : toWire(cell.unit, text)
      if (cell.personId === null) wireValues[cell.key] = wire
      else rows.push({ key: cell.key, person_id: cell.personId, value: wire })
    }
    return rows.length === 0 ? { values: wireValues } : { values: wireValues, rows }
  }

  // Live totals (spec §1.7): a computed line follows its components as they are typed, and
  // the browser owns no formula — so every edit ASKS what the totals would be. Debounced
  // because a keystroke is not a question, and sequenced because the answers can arrive out
  // of order.
  useEffect(() => {
    if (serverValues.current === values) return
    const timer = setTimeout(() => {
      const seq = ++figureSeq.current
      previewTaxInputs(inputs.year, previewBody())
        .then((preview) => {
          // Stale, or overtaken by a save echo: the newest answer owns the screen, and an
          // older one describes a form that no longer exists.
          if (seq !== figureSeq.current) return
          setFigures((current) => {
            const next = { ...current }
            for (const item of preview.derived)
              next[cellIdOf(item.key, ownerOf(item.person_id, split))] = item.value
            return next
          })
        })
        .catch(() => {
          // Silent by design: the figures keep the last thing the server said. A preview is
          // a courtesy — the Save path reports real failures, and a banner on every dropped
          // keystroke of a flaky connection would say nothing anyone can act on.
        })
    }, PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // Keyed on the typed cells ALONE. `previewBody` is rebuilt every render, so listing it
    // would re-arm the debounce on any state change at all — a paste note clearing itself
    // would cost a request — and `inputs.year`/`split` cannot move without a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values])

  // The flash is a one-shot: the timer callback clears it, so the effect body itself never
  // sets state (a set here would re-run the effect on its own write).
  useEffect(() => {
    if (flashIds.size === 0) return
    const timer = setTimeout(() => setFlashIds(new Set()), MOTION_MS.flash)
    return () => clearTimeout(timer)
  }, [flashIds])

  const submit = () => {
    // "a number", not "a plain number": grouping, "$" and "=" arithmetic are all valid
    // entry now (spec §3.1/§3.2), so the older wording named a stricter rule than this
    // form enforces. Client-local sentences with no server twin, so they are ours to word;
    // the count rule gets its own, because it is asking for something different.
    const problems = [
      invalid.length > 0 ? `Enter a number for: ${invalid.join(', ')}` : '',
      notWhole.length > 0 ? `Enter a whole number of checks for: ${notWhole.join(', ')}` : '',
    ].filter((sentence) => sentence !== '')
    if (problems.length > 0) {
      setError(problems.join(' · '))
      return
    }
    if (changedCount === 0) return
    setSaving(true)
    setError(null)
    // Split by COLUMN. Household cells — and every cell of a one-column year — ride the
    // `values` map the server resolves itself (a per-person key with no owner is the
    // primary's); person cells name their row. A one-column save therefore ships EXACTLY the
    // body this form shipped before columns existed.
    const wireValues: Record<string, string | null> = {}
    const rows: TaxInputRowIn[] = []
    for (const cell of flatCells) {
      const text = changed[cell.id]
      // A changed cell is a string or an explicit null (blanked); undefined means untouched.
      if (text === undefined) continue
      // The wire gets CANONICAL text, the on-screen diff above keeps counting the raw: a save
      // reached without a blur (Ctrl+Enter, a jsdom click) must not ship "$1,600" or
      // "=1200+400" to a Decimal column.
      const wire = text === null ? null : toWire(cell.unit, text)
      if (cell.personId === null) wireValues[cell.key] = wire
      else rows.push({ key: cell.key, person_id: cell.personId, value: wire })
    }
    putTaxInputs(
      inputs.year,
      rows.length === 0 ? { values: wireValues } : { values: wireValues, rows },
    )
      .then((echo) => {
        // The echo is authoritative (4dp, fresh suggestions, and the totals recomputed from
        // what was just stored): adopt it as the shown value, the new baseline and the
        // figures, so a second save sends nothing. Bumping the sequence retires any preview
        // still in flight — it is an answer about a form the server has since been told
        // about — and adopting the echo's map as `serverValues` stops the echo's own write
        // from asking the same question again.
        const { flatCells: echoCells, allCells: echoAll } = modelOf(echo)
        const echoValues = valuesOf(echoCells)
        figureSeq.current += 1
        serverValues.current = echoValues
        setFigures(figuresOf(echoAll))
        setValues(echoValues)
        setBaseline(valuesOf(echoCells))
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
    const target = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-entry-cell]')
    const targetCell =
      target === null
        ? null
        : (allCells.find((cell) => `tax-input-${cell.id}` === target.id) ?? null)
    // The COLUMN a paste fills: the cells that share the pasted-into cell's person. A sheet
    // column is ONE person's numbers, so a paste into their box must walk THEIR rows and skip
    // the other column entirely. With no resolvable target (a paste onto the card rather than
    // into a box) the whole rendered order is the target, as it always was — and on a
    // one-column year every cell has a null person, so the two are the same list.
    //
    // COMPUTED cells are in this list (spec §1.7). The clipboard came from a sheet whose grey
    // cells occupy those rows, so the slots have to line up one for one; leaving them out
    // would shift every value below a total onto the wrong line.
    const column =
      targetCell === null
        ? allCells
        : allCells.filter((cell) => cell.personId === targetCell.personId)
    const fills: Record<string, string> = {}
    const flashed = new Set<string>()
    const unmatched: string[] = []
    let overflow = 0
    // An empty pasted cell SKIPS its target instead of blanking it: a blank here is the
    // wire's "unset this input", and a stray trailing tab must never delete a stored value.
    let blank = 0
    // Values that landed on a computed line. Counted rather than dropped in silence: the
    // grey cells travel with any copied sheet column, and a value that just vanished would
    // read like the paste lost it.
    let computedSkipped = 0
    // How many cells this paste could have reached — the denominator of the note below.
    // EDITABLE ones only: a computed cell is a slot to step over, never a target.
    let reachable = column.filter((cell) => !cell.computed).length
    if (plan.mode === 'positional') {
      // Fill from the pasted-into cell onward, down the column — across section boundaries,
      // the way Enter walks it.
      const startAt = targetCell === null ? 0 : Math.max(0, column.indexOf(targetCell))
      plan.values.forEach((value, i) => {
        const slot = startAt + i
        if (slot >= column.length) {
          overflow += 1
          return
        }
        // The slot is consumed whatever is in it — a skipped blank, and a total nobody may
        // write, must not shift the rest of the column up a row.
        if (column[slot].computed) {
          computedSkipped += 1
          return
        }
        if (value === '') {
          blank += 1
          return
        }
        fills[column[slot].id] = value
        flashed.add(column[slot].id)
      })
    } else {
      // Keyed paste matches the pasted-into COLUMN first, then the household rows — which are
      // unambiguous, one cell per key — so a mixed block dropped into a person's column fills
      // their per-person lines and the shared ones, and never the other person's. On a
      // one-column year both lists are the same cells, so the dedupe leaves exactly the flat
      // list this form matched against before columns existed.
      const seen = new Set<string>()
      const candidates = [...column, ...allCells.filter((cell) => cell.personId === null)].filter(
        (cell) => {
          if (seen.has(cell.id)) return false
          seen.add(cell.id)
          return true
        },
      )
      reachable = candidates.filter((cell) => !cell.computed).length
      // matchLabel keys on numeric ids, so the INDEX into candidates serves as one.
      const labelled = candidates.map((cell, i) => ({ id: i, name: cell.itemLabel }))
      for (const { label, value } of plan.rows) {
        const index = matchLabel(labelled, label)
        if (index === null) {
          unmatched.push(label)
        } else if (candidates[index].computed) {
          // Matched, and still not filled. Computed rows stay MATCHABLE so a line naming one
          // is answered by its own row rather than fuzzy-matching a neighbour, and it is
          // counted as skipped rather than unmatched: the label was right, the cell is
          // simply not one anybody may write.
          computedSkipped += 1
        } else if (value === '') {
          blank += 1
        } else {
          fills[candidates[index].id] = value
          flashed.add(candidates[index].id)
        }
      }
      overflow = plan.skipped
    }
    if (Object.keys(fills).length > 0) setValues((current) => ({ ...current, ...fills }))
    setFlashIds(flashed)
    const parts = [`Pasted ${Object.keys(fills).length} of ${reachable} values`]
    if (unmatched.length > 0) {
      const shown = unmatched.slice(0, 4).join(', ')
      const more = unmatched.length > 4 ? `, +${unmatched.length - 4} more` : ''
      parts.push(`${unmatched.length} unmatched: ${shown}${more}`)
    }
    if (overflow > 0) parts.push(`${overflow} value${overflow === 1 ? '' : 's'} didn't fit`)
    if (blank > 0) parts.push(`${blank} blank${blank === 1 ? '' : 's'} skipped`)
    if (computedSkipped > 0)
      parts.push(`${computedSkipped} computed cell${computedSkipped === 1 ? '' : 's'} skipped`)
    setPasteNote(parts.join(' · '))
  }

  return (
    <section className="card">
      <h2 className="eyebrow">
        Tax inputs — {inputs.year}
        {/* The sheet's white/grey split is no longer the distinction that matters: a grey
            cell is now a COMPUTED line rather than an offer, so the copy names the two kinds
            of row the form actually has (2026-09-11 spec §1.7). */}
        <InfoHint text="The year&apos;s income and deduction line items. Computed lines total their components as you type; grey chips are offers you apply." />
      </h2>
      <p className="drill-hint">
        Stored values feed the engine; computed lines follow their components. Clearing a
        field unsets that input.
      </p>
      {/* Married-JOINT alone: an MFS return is one person's by design (the CA caveat in the
          year card is exactly about what that does not model), so its single column is the
          right answer rather than a roster that needs fixing. */}
      {inputs.filing_status === 'married_joint' && !split && (
        <p className="drill-hint">
          One column: add the second person in Settings → Household to split the per-person
          lines (salary, W-2, 401k, HSA, pre-tax deductions) into two. Until then these values
          are stored against the primary person.
        </p>
      )}
      <FeedBanner error={error} />
      {/* One entry scope for every cell the server sent: Enter/ArrowDown walks the column
          across section boundaries, and from the last cell lands on Save — so Enter here
          ADVANCES rather than submitting, and Ctrl+Enter is what saves (spec §3.4). */}
      <form
        data-entry-scope=""
        onPaste={handlePaste}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {sections.map((section) => (
          <div key={section.name} className="tax-section">
            <h3 className="eyebrow">{sectionLabel(section.name)}</h3>
            <div className={`tax-input-grid${split ? ' is-split' : ''}`}>
              {section.headed && (
                // aria-hidden: every box already carries the person in its own aria-label,
                // and announcing the names again would double every row.
                <div className="tax-input-row tax-input-head" aria-hidden="true">
                  <span />
                  {columns.map((column) => (
                    <span key={column.id} className="tax-input-person">
                      {column.name}
                    </span>
                  ))}
                  <span />
                </div>
              )}
              {section.rows.map((row) => {
                // The chip belongs to ONE cell: derived suggestions are the primary
                // person's (design §5.3), and the columns are ordered primary-first. A
                // computed row has no chip at all — the server sends it no suggestion,
                // because there is nothing an Apply could write.
                const suggestionCell = row.cells[0]
                const shown = values[suggestionCell.id] ?? ''
                // What Apply would write: the suggestion in BOX units, so a percent row
                // whose stored 0.9753 is showing as 97.53 is not offered its own value
                // back. The formatted form is computed once because the chip, its title and
                // the button's title all show it.
                const applies =
                  suggestionCell.suggested === null
                    ? null
                    : toBox(suggestionCell.unit, suggestionCell.suggested)
                const suggestion =
                  suggestionCell.suggested === null || applies === shown
                    ? null
                    : figureText(suggestionCell.unit, suggestionCell.suggested)
                // "last year's $15,750" for a carry-forward, "suggested …" for a formula.
                const suggestionWord = suggestionCell.suggestionSource ?? 'suggested'
                return (
                  <div key={row.key} className="tax-input-row">
                    <span className="tax-input-label">
                      {/* The grid gives the label a wide track, but a long key can still
                          ellipsize — the title recovers the full text on hover. With two
                          boxes there is no single control for a <label> to point at, so the
                          name becomes plain text and each box names itself. A computed row
                          takes the same plain-text branch: its figure names itself
                          "… (computed)", and a <label> pointing at it would hand the bare
                          label back to a query looking for a box that no longer exists. */}
                      {row.cells.length === 1 && !row.isDerived ? (
                        <label htmlFor={`tax-input-${row.cells[0].id}`} title={row.label}>
                          {row.label}
                        </label>
                      ) : (
                        <span className="tax-input-name" title={row.label}>
                          {row.label}
                        </span>
                      )}
                      {row.isDerived && <span className="badge">derived</span>}
                    </span>
                    {row.cells.map((cell) => {
                      // A household line inside a split grid takes both person tracks
                      // rather than leaving a hole under one name.
                      const wide = split && row.cells.length === 1 ? 'tax-input-wide' : ''
                      if (cell.computed) {
                        // The server's figure and nothing else: the payload's, then whatever
                        // the last preview or save echo replaced it with.
                        const figure = figures[cell.id] ?? null
                        // <output>, in the input's own track and with its metrics: the row
                        // reads as one line of the same grid whether its figure is typed or
                        // derived. The title says where the number comes from AND where to
                        // change it, because this cell is the one place in the form that
                        // cannot answer an edit.
                        return (
                          <output
                            key={cell.id}
                            id={`tax-input-${cell.id}`}
                            data-computed={cell.id}
                            className={`tax-computed${wide === '' ? '' : ` ${wide}`}`}
                            aria-label={`${cellLabel(cell)} (computed)`}
                            title={
                              row.formula === null
                                ? undefined
                                : `${row.formula} — edit the components`
                            }
                          >
                            {figure === null ? NO_FIGURE : figureText(cell.unit, figure)}
                          </output>
                        )
                      }
                      const value = values[cell.id] ?? ''
                      const classes = [
                        value.trim() !== '' && !isEntry(cell.unit, value) ? 'invalid' : '',
                        flashIds.has(cell.id) ? 'pasted-flash' : '',
                        wide,
                      ]
                        .filter((name) => name !== '')
                        .join(' ')
                      return (
                        <AmountInput
                          key={cell.id}
                          id={`tax-input-${cell.id}`}
                          aria-label={row.cells.length === 1 ? undefined : cellLabel(cell)}
                          className={classes === '' ? undefined : classes}
                          kind={UNIT_KINDS[cell.unit]}
                          value={value}
                          onValueChange={(next) =>
                            setValues((current) => ({ ...current, [cell.id]: next }))
                          }
                        />
                      )
                    })}
                    {/* The track is reserved whether or not a suggestion is showing, so a
                        chip appearing mid-keystroke never shifts the input under the
                        cursor. On a computed row it holds the formula instead: the caption
                        is what a chip would have been — the row's explanation of its own
                        number — minus the button, because there is nothing to apply. */}
                    <span className="tax-suggestion">
                      {row.isDerived && row.formula !== null && (
                        <span className="tax-suggestion-value" title={row.formula}>
                          {row.formula}
                        </span>
                      )}
                      {!row.isDerived && suggestion !== null && (
                        <>
                          <span className="tax-suggestion-value" title={suggestion}>
                            {suggestionWord} {suggestion}
                          </span>
                          <button
                            type="button"
                            className="chip"
                            aria-label={`Apply suggestion for ${row.label}`}
                            title={`Apply ${suggestion}`}
                            onClick={() =>
                              setValues((current) => ({
                                ...current,
                                [suggestionCell.id]: applies ?? '',
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
