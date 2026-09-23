import { describe, expect, it } from 'vitest'
import {
  addRow,
  canAddRow,
  chooseKey,
  clearRows,
  commitValue,
  reconcileRows,
  removeRow,
  rowsFromUrl,
  toggleClear,
  unfinishedCount,
  type OverrideRows,
  type RowStep,
} from './overrideRows'
import type { TaxScenario } from './taxScenario'

// The What-if override rows as a model of their own (2026-09-23 spec §B7, code review M10): the
// URL holds only COMPLETE overrides; a row may stand on screen before it means anything.

const STORED: Record<string, string | null> = {
  annual_salary: '212930',
  itemized_deduction: null,
}
const ctx = {
  storedOf: (key: string) => STORED[key] ?? null,
  labelOf: (key: string) => ({ annual_salary: 'Annual Salary', itemized_deduction: 'Itemized Deduction' })[key] ?? key,
}
const scenario = (overrides: Record<string, string | null>): TaxScenario => ({ sales: [], espp: [], overrides })

function applied(step: RowStep) {
  if (step.kind !== 'apply') throw new Error(`expected an apply step, got ${step.kind}`)
  return step
}

describe('rowsFromUrl / reconcileRows', () => {
  it('turns every URL override into a committed row, a null into a ticked Clear', () => {
    const state = rowsFromUrl({ annual_salary: '250000', itemized_deduction: null })
    expect(state.rows).toEqual([
      { id: 1, key: 'annual_salary', draft: '250000', cleared: false, committed: true },
      { id: 2, key: 'itemized_deduction', draft: '', cleared: true, committed: true },
    ])
    expect(state.nextId).toBe(3)
    expect(state.focusId).toBeNull()
  })

  it('follows the URL: a committed row whose key left goes, a new key gets a row, values update in place', () => {
    const start = rowsFromUrl({ annual_salary: '250000', itemized_deduction: '30000' })
    const next = reconcileRows(start, { annual_salary: '260000', w2_bonuses: '5000' })
    expect(next.rows).toEqual([
      { id: 1, key: 'annual_salary', draft: '260000', cleared: false, committed: true },
      { id: 3, key: 'w2_bonuses', draft: '5000', cleared: false, committed: true },
    ])
  })

  it('keeps the reader’s unfinished rows, and commits one whose key a preset just wrote', () => {
    const withPending: OverrideRows = {
      rows: [
        { id: 1, key: null, draft: '', cleared: false, committed: false },
        { id: 2, key: 'annual_salary', draft: '212930', cleared: false, committed: false },
      ],
      nextId: 3,
      seen: '',
      focusId: 1,
    }
    const next = reconcileRows(withPending, { annual_salary: '23500' })
    expect(next.rows).toEqual([
      { id: 1, key: null, draft: '', cleared: false, committed: false },
      { id: 2, key: 'annual_salary', draft: '23500', cleared: false, committed: true },
    ])
    expect(next.focusId).toBe(1)
  })
})

describe('addRow / clearRows / canAddRow / unfinishedCount', () => {
  it('adds a key-less row that takes focus, and clears every row', () => {
    const added = addRow(rowsFromUrl({ annual_salary: '250000' }))
    expect(added.rows.at(-1)).toEqual({ id: 2, key: null, draft: '', cleared: false, committed: false })
    expect(added.focusId).toBe(2)
    expect(added.nextId).toBe(3)
    expect(unfinishedCount(added)).toBe(1)
    expect(clearRows(added)).toMatchObject({ rows: [], focusId: null })
  })

  it('offers another row only with definitions, no key-less row waiting, and a key still free', () => {
    const keys = ['annual_salary', 'itemized_deduction']
    expect(canAddRow(rowsFromUrl({}), keys)).toBe(true)
    expect(canAddRow(rowsFromUrl({}), [])).toBe(false)
    expect(canAddRow(addRow(rowsFromUrl({})), keys)).toBe(false)
    expect(canAddRow(rowsFromUrl({ annual_salary: '1', itemized_deduction: '2' }), keys)).toBe(false)
  })
})

describe('chooseKey', () => {
  it('re-picking the same key does nothing', () => {
    expect(chooseKey(rowsFromUrl({ annual_salary: '250000' }), 1, 'annual_salary', ctx)).toEqual({ kind: 'none' })
  })

  it('refuses a key another row holds, in the label’s words', () => {
    const state = addRow(rowsFromUrl({ annual_salary: '250000' }))
    expect(chooseKey(state, 2, 'annual_salary', ctx)).toEqual({
      kind: 'refuse',
      error: 'Annual Salary is overridden twice — one row per key',
    })
  })

  it('a fresh row starts at the stored value, outside the scenario, writing nothing', () => {
    const step = applied(chooseKey(addRow(rowsFromUrl({})), 1, 'annual_salary', ctx))
    expect(step.state.rows[0]).toEqual({ id: 1, key: 'annual_salary', draft: '212930', cleared: false, committed: false })
    expect(step.patch).toBeNull()
  })

  it('re-keying a committed row is a fresh choice: the old override leaves the scenario', () => {
    const step = applied(chooseKey(rowsFromUrl({ annual_salary: '250000' }), 1, 'itemized_deduction', ctx))
    expect(step.state.rows[0]).toEqual({ id: 1, key: 'itemized_deduction', draft: '', cleared: false, committed: false })
    expect(step.patch?.(scenario({ annual_salary: '250000' })).overrides).toEqual({})
  })
})

describe('commitValue', () => {
  const pending = () => applied(chooseKey(addRow(rowsFromUrl({})), 1, 'annual_salary', ctx)).state

  it('does nothing for a row without a key', () => {
    expect(commitValue(addRow(rowsFromUrl({})), 1, '5', ctx)).toEqual({ kind: 'none' })
  })

  it('a value that differs from the stored one joins the scenario', () => {
    const step = applied(commitValue(pending(), 1, '250000', ctx))
    expect(step.state.rows[0]).toEqual({ id: 1, key: 'annual_salary', draft: '250000', cleared: false, committed: true })
    expect(step.patch?.(scenario({})).overrides).toEqual({ annual_salary: '250000' })
  })

  it('the stored value again is "no change": out of the scenario, the stored figure on show', () => {
    const committed = rowsFromUrl({ annual_salary: '250000' })
    const step = applied(commitValue(committed, 1, '212930.00', ctx))
    expect(step.state.rows[0]).toMatchObject({ committed: false, draft: '212930.00' })
    expect(step.patch?.(scenario({ annual_salary: '250000' })).overrides).toEqual({})
  })

  // Code review M5: a blank box is "no change" too — and shows the stored figure, exactly as
  // unticking Clear does, rather than an empty box beside "change it from the stored $212,930".
  it('a blank box is "no change" as well, and shows the stored figure', () => {
    const step = applied(commitValue(rowsFromUrl({ annual_salary: '250000' }), 1, null, ctx))
    expect(step.state.rows[0]).toMatchObject({ committed: false, draft: '212930' })
    expect(applied(commitValue(pending(), 1, null, ctx)).patch).toBeNull()
  })

  it('with nothing stored, any value is a change', () => {
    const state = applied(chooseKey(addRow(rowsFromUrl({})), 1, 'itemized_deduction', ctx)).state
    expect(applied(commitValue(state, 1, '0', ctx)).state.rows[0]).toMatchObject({ committed: true, draft: '0' })
  })
})

describe('toggleClear', () => {
  it('ticking writes the explicit clear', () => {
    const state = applied(chooseKey(addRow(rowsFromUrl({})), 1, 'annual_salary', ctx)).state
    const step = applied(toggleClear(state, 1, true, ctx))
    expect(step.state.rows[0]).toMatchObject({ committed: true, cleared: true, draft: '' })
    expect(step.patch?.(scenario({})).overrides).toEqual({ annual_salary: null })
  })

  it('unticking returns the row to the stored value, out of the scenario', () => {
    const step = applied(toggleClear(rowsFromUrl({ annual_salary: null }), 1, false, ctx))
    expect(step.state.rows[0]).toMatchObject({ committed: false, cleared: false, draft: '212930' })
    expect(step.patch?.(scenario({ annual_salary: null })).overrides).toEqual({})
  })

  it('does nothing for a row without a key', () => {
    expect(toggleClear(addRow(rowsFromUrl({})), 1, true, ctx)).toEqual({ kind: 'none' })
  })
})

describe('removeRow', () => {
  it('a committed row takes its override out of the scenario with it', () => {
    const step = applied(removeRow(rowsFromUrl({ annual_salary: '250000' }), 1))
    expect(step.state.rows).toEqual([])
    expect(step.patch?.(scenario({ annual_salary: '250000' })).overrides).toEqual({})
  })

  it('an unfinished row goes quietly — nothing to write', () => {
    const step = applied(removeRow(addRow(rowsFromUrl({})), 1))
    expect(step.state.rows).toEqual([])
    expect(step.patch).toBeNull()
  })

  it('an unknown row id does nothing', () => {
    expect(removeRow(rowsFromUrl({}), 9)).toEqual({ kind: 'none' })
  })
})
