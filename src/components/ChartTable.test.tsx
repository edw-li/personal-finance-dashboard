import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

  // The shared Disclosure (2026-09-13 polish §2.6): one <details> grammar for every
  // "show me more". The twin still arrives open — it IS the accessible copy of the chart —
  // and the reader can still fold it away.
  it('is an open-by-default Disclosure the reader can collapse', async () => {
    const { container } = render(<ChartTable table={TABLE} caption="Net worth by month" />)
    // Re-queried every time: the element is re-rendered between assertions.
    const twin = () => container.querySelector('details.disclosure.chart-table') as HTMLDetailsElement
    expect(twin().open).toBe(true)
    expect(twin().querySelector(':scope > summary')?.textContent).toBe('Data table')
    // Caption and all, the table sits inside the primitive's body wrapper.
    expect(twin().querySelector(':scope > .disclosure-body .data-table > caption')?.textContent)
      .toBe('Net worth by month')
    fireEvent.click(screen.getByText('Data table'))
    // jsdom queues the toggle event as a task, here and in browsers alike; let it land.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(twin().open).toBe(false)
  })

  it('renders an empty body without a row when there is no data', () => {
    const { container } = render(
      <ChartTable table={{ headers: ['Month'], rows: [] }} caption="Nothing yet" />,
    )
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0)
    expect(screen.getByRole('table', { name: 'Nothing yet' })).toBeTruthy()
  })
})
