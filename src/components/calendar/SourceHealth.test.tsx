import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import SourceHealth from './SourceHealth'

afterEach(cleanup)

describe('SourceHealth', () => {
  it('lists every source in the fixed order with its color dot, status and note', () => {
    render(
      <SourceHealth
        sources={[
          { source: 'payroll', status: 'partial', note: 'Sam: paid on another cadence — paydays omitted' },
          { source: 'rsu', status: 'ok', note: 'valued at the NVDA quote' },
          { source: 'card', status: 'off', note: 'no cards entered' },
        ]}
      />,
    )
    const items = screen.getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      'RSU vests — valued at the NVDA quote',
      'Paydays partial — Sam: paid on another cadence — paydays omitted',
      'Cards off — no cards entered',
    ])
    expect(items[0].querySelector('.cal-legend-dot')?.getAttribute('style')).toContain(
      'var(--chart-1)',
    )
    expect(screen.getByRole('list', { name: 'Sources' })).toBeTruthy()
  })
})
