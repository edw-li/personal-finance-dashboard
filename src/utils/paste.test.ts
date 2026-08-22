import { describe, expect, it } from 'vitest'
import { classifyPaste, matchLabel } from './paste'

describe('classifyPaste', () => {
  it('returns null for single-cell text — native paste handles it', () => {
    expect(classifyPaste('1234.56')).toBeNull()
    expect(classifyPaste('$1,234.56\n')).toBeNull() // one trailing newline is still one cell
  })
  it('classifies a column as positional', () => {
    expect(classifyPaste('1\n2\n3')).toEqual({ mode: 'positional', values: ['1', '2', '3'] })
    expect(classifyPaste('1\r\n2\r\n')).toEqual({ mode: 'positional', values: ['1', '2'] })
  })
  it('classifies a single row of many cells as positional, transposed', () => {
    // The source sheet stores months as ROWS — a copied month is a horizontal range.
    expect(classifyPaste('1\t2\t3')).toEqual({ mode: 'positional', values: ['1', '2', '3'] })
  })
  it('classifies multi-row multi-cell as keyed: first cell label, LAST cell value', () => {
    expect(classifyPaste('Checking\t100\nSavings\t200')).toEqual({
      mode: 'keyed',
      rows: [
        { label: 'Checking', value: '100' },
        { label: 'Savings', value: '200' },
      ],
      skipped: 0,
    })
    // name<TAB>…<TAB>latest-month ranges take the LAST cell.
    expect(classifyPaste('Checking\tJan\t100\nSavings\tJan\t200')).toEqual({
      mode: 'keyed',
      rows: [
        { label: 'Checking', value: '100' },
        { label: 'Savings', value: '200' },
      ],
      skipped: 0,
    })
  })
  it('counts one-cell rows inside a keyed block as skipped', () => {
    expect(classifyPaste('Checking\t100\norphan\nSavings\t200')).toEqual({
      mode: 'keyed',
      rows: [
        { label: 'Checking', value: '100' },
        { label: 'Savings', value: '200' },
      ],
      skipped: 1,
    })
  })
  it('trims cells and drops fully empty rows', () => {
    expect(classifyPaste(' 1 \n\n 2 \n')).toEqual({ mode: 'positional', values: ['1', '2'] })
  })
})

describe('matchLabel', () => {
  const labels = [
    { id: 1, name: 'Checking' },
    { id: 7, name: 'Food & Dining' },
  ]
  it('matches trimmed case-insensitive exact first', () => {
    expect(matchLabel(labels, '  checking ')).toBe(1)
  })
  it('falls back to slug-normalized equality', () => {
    expect(matchLabel(labels, 'food-and-dining')).toBeNull() // "and" is letters — NOT equal
    expect(matchLabel(labels, 'Food &  Dining')).toBe(7) // whitespace/punct differences vanish
    expect(matchLabel(labels, 'FOOD DINING')).toBe(7)
  })
  it('never guesses', () => {
    expect(matchLabel(labels, 'Chequing')).toBeNull()
  })
})
