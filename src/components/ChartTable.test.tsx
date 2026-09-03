import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ChartTable from './ChartTable'
import type { ExportTable } from '../utils/download'

// The accessibility twin (chart spec §14). What is pinned here is the SCREEN-READER
// contract, not the styling: the caption names the table without showing it, every header
// cell is scoped to its column, and an empty cell reads as an em dash rather than as
// nothing at all (a bare <td></td> is announced as "blank" and loses the column).
afterEach(cleanup)

const TABLE: ExportTable = {
  headers: ['Month', 'Assets', 'Liabilities'],
  rows: [
    ['Aug 2026', 1234.5, -200],
    ['Sep 2026', '', ''],
  ],
}

describe('ChartTable', () => {
  it('names the table with a visually-hidden caption', () => {
    const { container } = render(<ChartTable table={TABLE} caption="Net worth by month" />)
    const caption = container.querySelector('caption')
    expect(caption?.textContent).toBe('Net worth by month')
    // The class IS the mechanism: the caption must stay in the accessibility tree (it is
    // the table's accessible name), so it can never be display:none or aria-hidden.
    expect(caption?.className).toBe('visually-hidden')
    expect(screen.getByRole('table', { name: 'Net worth by month' })).toBeTruthy()
  })

  it('scopes every header cell to its column', () => {
    const { container } = render(<ChartTable table={TABLE} caption="Net worth by month" />)
    const headers = [...container.querySelectorAll('thead th')]
    expect(headers.map((th) => th.textContent)).toEqual(['Month', 'Assets', 'Liabilities'])
    expect(headers.map((th) => th.getAttribute('scope'))).toEqual(['col', 'col', 'col'])
    // Column headers only — a row header would re-key the whole table for a screen reader.
    expect(container.querySelectorAll('tbody th')).toHaveLength(0)
  })

  it('prints an em dash for an empty cell and right-aligns the numeric ones', () => {
    const { container } = render(<ChartTable table={TABLE} caption="Net worth by month" />)
    const rows = [...container.querySelectorAll('tbody tr')]
    expect([...rows[0].querySelectorAll('td')].map((td) => td.textContent)).toEqual([
      'Aug 2026',
      '1234.5',
      '-200',
    ])
    expect([...rows[1].querySelectorAll('td')].map((td) => td.textContent)).toEqual([
      'Sep 2026',
      '—',
      '—',
    ])
    // numeric() keys off the VALUE, so the em-dash cells are text cells, not numbers.
    expect([...rows[0].querySelectorAll('td')].map((td) => td.className)).toEqual([
      '',
      'num',
      'num',
    ])
    expect([...rows[1].querySelectorAll('td')].map((td) => td.className)).toEqual(['', '', ''])
  })

  it('renders an empty body without a row when there is no data', () => {
    const { container } = render(
      <ChartTable table={{ headers: ['Month'], rows: [] }} caption="Nothing yet" />,
    )
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0)
    expect(screen.getByRole('table', { name: 'Nothing yet' })).toBeTruthy()
  })
})
