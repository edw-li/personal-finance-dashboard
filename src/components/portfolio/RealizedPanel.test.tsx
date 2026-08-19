import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { RealizedResponse } from '../../types/api'
import RealizedPanel from './RealizedPanel'

afterEach(cleanup)

function realizedOut(over: Partial<RealizedResponse> = {}): RealizedResponse {
  return {
    total: '150.00',
    // The server ships ascending by value; the panel inverts for display.
    rows: [
      { security_id: 3, ticker: 'CCC', name: 'CCC Inc', realized_gl: '-50.00' },
      { security_id: 2, ticker: 'BBB', name: 'BBB Inc', realized_gl: '0.00' },
      { security_id: 1, ticker: 'AAA', name: 'AAA Inc', realized_gl: '200.00' },
    ],
    ...over,
  }
}

function tickerColumn(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1) // header
    .map((r) => r.querySelector('td')!.textContent!)
}

describe('RealizedPanel', () => {
  it('shows winners first and filters the never-sold zero rows', () => {
    render(<RealizedPanel realized={realizedOut()} />)
    expect(tickerColumn()).toEqual(['AAA', 'CCC', 'Total'])
    expect(screen.queryByText('BBB')).toBeNull()
  })

  it("tones the figures and carries the SERVER's total, verbatim", () => {
    render(<RealizedPanel realized={realizedOut()} />)
    expect(screen.getByText('$200.00').className).toContain('pos')
    expect(screen.getByText('-$50.00').className).toContain('neg')
    // The total includes the filtered zero rows — it is the server's, never re-summed.
    expect(screen.getByText('$150.00').className).toContain('pos')
  })

  it('offers a note when nothing has been realized', () => {
    render(
      <RealizedPanel
        realized={realizedOut({
          total: '0.00',
          rows: [{ security_id: 2, ticker: 'BBB', name: 'BBB Inc', realized_gl: '0.00' }],
        })}
      />,
    )
    expect(screen.getByText(/nothing realized yet/i)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
