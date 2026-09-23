import { useState } from 'react'
import { compareDecimals } from '../../sandbox/decimal'
import { SEP } from '../../sandbox/useSandbox'
import type { TaxScenario } from './taxScenario'

// The What-if's input-override rows (2026-09-23 spec §B7), as a model of their own — moved out
// of WhatIfPanel (code review M10) so every transition is a pure, directly tested function and
// the panel only renders. The rule: the URL carries only COMPLETE overrides — a key whose value
// differs from the stored one, or an explicit clear — so a row can stand on screen before it
// means anything. Rows used to BE the URL's entries, which is how one click on "Add override"
// wrote `annual_salary:null` and modelled a $0 salary with an Apply button under it.

/** One override row. Each keeps its own id, so it keeps its DOM — and the reader's focus — as
 *  it joins or leaves the scenario. */
export interface OverrideRow {
  id: number
  key: string | null
  /** The value in WIRE form — the stored figure, the URL's value or the one just committed (a
   *  percent as its fraction); the box shows it in the input's own unit. The row's own copy, so
   *  a commit shows at once rather than a beat later, when react-router commits the URL. */
  draft: string
  /** "Clear this input" is ticked (the row is in the scenario as `key:null`). */
  cleared: boolean
  /** Whether the row's key is in the URL's scenario. */
  committed: boolean
}

export interface OverrideRows {
  rows: OverrideRow[]
  nextId: number
  /** The URL's overrides (keys AND values) these rows were last reconciled with. */
  seen: string
  /** The row whose key picker takes focus when it mounts — the one Add override just made. */
  focusId: number | null
}

export type Overrides = Record<string, string | null>

/** A change to write into the scenario (the panel's URL). */
export type ScenarioPatch = (scenario: TaxScenario) => TaxScenario

/** What a transition asks of the panel: nothing, a refusal sentence, or new rows — with the
 *  scenario change they imply, when they join, leave or change the URL. */
export type RowStep =
  | { kind: 'none' }
  | { kind: 'refuse'; error: string }
  | { kind: 'apply'; state: OverrideRows; patch: ScenarioPatch | null }

/** What the transitions read about the year: the stored household value, and a key's label. */
export interface RowContext {
  storedOf: (key: string) => string | null
  labelOf: (key: string) => string
}

const NONE: RowStep = { kind: 'none' }

export const overridesSignature = (overrides: Overrides): string =>
  Object.keys(overrides)
    .map((key) => `${key}:${overrides[key] ?? 'null'}`)
    .join(SEP)

export function rowsFromUrl(overrides: Overrides): OverrideRows {
  return reconcileRows({ rows: [], nextId: 1, seen: '', focusId: null }, overrides)
}

/** The rows follow the URL (a preset, a link, Back, Reset): a committed row whose key left the
 *  URL goes with it, a row whose key is in the URL takes the URL's value (an uncommitted one
 *  joins), and a key no row holds gets a row of its own. Uncommitted rows are the reader's
 *  unfinished work, and stay. */
export function reconcileRows(state: OverrideRows, overrides: Overrides): OverrideRows {
  let nextId = state.nextId
  const rows = state.rows
    .filter((row) => !row.committed || (row.key !== null && row.key in overrides))
    .map((row) => {
      if (row.key === null || !(row.key in overrides)) return row
      const value = overrides[row.key]
      return { ...row, committed: true, cleared: value === null, draft: value ?? '' }
    })
  const held = new Set(rows.map((row) => row.key))
  for (const [key, value] of Object.entries(overrides)) {
    if (held.has(key)) continue
    rows.push({ id: nextId, key, draft: value ?? '', cleared: value === null, committed: true })
    nextId += 1
  }
  return { ...state, rows, nextId, seen: overridesSignature(overrides) }
}

const withoutKey =
  (key: string): ScenarioPatch =>
  (scenario) => {
    const overrides = { ...scenario.overrides }
    delete overrides[key]
    return { ...scenario, overrides }
  }

const withValue =
  (key: string, value: string | null): ScenarioPatch =>
  (scenario) => ({ ...scenario, overrides: { ...scenario.overrides, [key]: value } })

function update(state: OverrideRows, id: number, change: Partial<OverrideRow>): OverrideRows {
  return { ...state, rows: state.rows.map((row) => (row.id === id ? { ...row, ...change } : row)) }
}

const find = (state: OverrideRows, id: number) => state.rows.find((row) => row.id === id)

/** A new row starts with NO key and changes nothing — not the URL, not the request. */
export function addRow(state: OverrideRows): OverrideRows {
  return {
    ...state,
    rows: [...state.rows, { id: state.nextId, key: null, draft: '', cleared: false, committed: false }],
    nextId: state.nextId + 1,
    focusId: state.nextId,
  }
}

/** Reset to actual: the unfinished rows go with the scenario. */
export function clearRows(state: OverrideRows): OverrideRows {
  return { ...state, rows: [], focusId: null }
}

/** One row per key, and one row at a time without a key: a second empty row adds nothing but a
 *  second "Choose an input…" to finish. */
export function canAddRow(state: OverrideRows, definitionKeys: string[]): boolean {
  return (
    definitionKeys.length > 0 &&
    !state.rows.some((row) => row.key === null) &&
    !definitionKeys.every((key) => state.rows.some((row) => row.key === key))
  )
}

/** Rows not in the scenario yet — each one holds Apply. */
export function unfinishedCount(state: OverrideRows): number {
  return state.rows.filter((row) => !row.committed).length
}

/**
 * Every key choice is a fresh one: the new input starts at "no change" — its stored figure,
 * outside the scenario until edited. A figure (or a Clear) typed for the OLD input is never
 * re-aimed at the new one: `annual_salary:250000` must not become `itemized_deduction:250000`
 * with Apply enabled, one select change after the reader meant something else.
 */
export function chooseKey(state: OverrideRows, id: number, to: string, ctx: RowContext): RowStep {
  const row = find(state, id)
  if (row === undefined || row.key === to) return NONE
  if (state.rows.some((other) => other.id !== id && other.key === to)) {
    // Last-write-wins on a dict would silently drop the earlier row — refuse instead.
    return { kind: 'refuse', error: `${ctx.labelOf(to)} is overridden twice — one row per key` }
  }
  return {
    kind: 'apply',
    state: update(state, id, { key: to, draft: ctx.storedOf(to) ?? '', cleared: false, committed: false }),
    patch: row.committed && row.key !== null ? withoutKey(row.key) : null,
  }
}

/**
 * A committed box value. `canonical` is the wire text; null is a BLANK box — never "clear"
 * (that is the checkbox's job). A value that differs from the stored one joins the scenario;
 * the stored value again, or a blank, is "no change": the row leaves the scenario and shows
 * the stored figure (code review M5 — as unticking Clear does).
 */
export function commitValue(
  state: OverrideRows,
  id: number,
  canonical: string | null,
  ctx: RowContext,
): RowStep {
  const row = find(state, id)
  if (row === undefined || row.key === null) return NONE
  const key = row.key
  const stored = ctx.storedOf(key)
  if (canonical !== null && (stored === null || compareDecimals(canonical, stored) !== 0)) {
    return {
      kind: 'apply',
      state: update(state, id, { committed: true, cleared: false, draft: canonical }),
      patch: withValue(key, canonical),
    }
  }
  return {
    kind: 'apply',
    state: update(state, id, { committed: false, cleared: false, draft: canonical ?? stored ?? '' }),
    patch: row.committed ? withoutKey(key) : null,
  }
}

/** "Clear this input": ticked writes the explicit `key:null`; unticked returns the row to the
 *  stored figure, outside the scenario until it is edited. */
export function toggleClear(state: OverrideRows, id: number, clear: boolean, ctx: RowContext): RowStep {
  const row = find(state, id)
  if (row === undefined || row.key === null) return NONE
  const key = row.key
  if (clear) {
    return {
      kind: 'apply',
      state: update(state, id, { committed: true, cleared: true, draft: '' }),
      patch: withValue(key, null),
    }
  }
  return {
    kind: 'apply',
    state: update(state, id, { committed: false, cleared: false, draft: ctx.storedOf(key) ?? '' }),
    patch: withoutKey(key),
  }
}

/** Remove a row; one in the scenario takes its override with it. */
export function removeRow(state: OverrideRows, id: number): RowStep {
  const row = find(state, id)
  if (row === undefined) return NONE
  return {
    kind: 'apply',
    state: { ...state, rows: state.rows.filter((other) => other.id !== id) },
    patch: row.committed && row.key !== null ? withoutKey(row.key) : null,
  }
}

/**
 * The rows as panel state, re-synced with the URL whenever its overrides change (adjusted during
 * render, the house idiom — never a setState in an effect). Each transition's step is applied
 * here: a refusal becomes the panel's sentence; new rows land, and a scenario change goes out
 * through `write` — which clears the sentence, as every URL write does — or the sentence is
 * cleared directly, since it described the rows as they WERE. Each returned function computes
 * from THIS render's rows, so two calls in one handler would drop the first: a change that needs
 * two steps is one transition here in overrideRows.ts, never two calls.
 */
export function useOverrideRows(
  overrides: Overrides,
  ctx: RowContext,
  write: (patch: ScenarioPatch) => void,
  setError: (error: string | null) => void,
) {
  const [state, setState] = useState<OverrideRows>(() => rowsFromUrl(overrides))
  let current = state
  if (state.seen !== overridesSignature(overrides)) {
    current = reconcileRows(state, overrides)
    setState(current)
  }
  const run = (step: RowStep) => {
    if (step.kind === 'none') return
    if (step.kind === 'refuse') {
      setError(step.error)
      return
    }
    setState(step.state)
    if (step.patch !== null) write(step.patch)
    else setError(null)
  }
  return {
    state: current,
    add: () => setState(addRow(current)),
    clear: () => setState(clearRows(current)),
    choose: (id: number, key: string) => run(chooseKey(current, id, key, ctx)),
    commit: (id: number, canonical: string | null) => run(commitValue(current, id, canonical, ctx)),
    toggleClear: (id: number, clear: boolean) => run(toggleClear(current, id, clear, ctx)),
    remove: (id: number) => run(removeRow(current, id)),
  }
}
