import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import VerdictSummary, { type VerdictEntry } from './VerdictSummary'

// The Rewards footer's three verdict groups (2026-09-23 spec §B6).

const entry = (over: Partial<VerdictEntry>): VerdictEntry => ({
  cardId: 1,
  name: 'Card',
  kind: 'free',
  net: 0,
  marginal: 0,
  ties: null,
  ...over,
})

afterEach(cleanup)

function group(label: string): string {
  const list = screen.getByRole('list', { name: 'Card verdicts' })
  const item = within(list)
    .getAllByRole('listitem')
    .find((li) => li.textContent?.startsWith(label))
  if (item === undefined) throw new Error(`no ${label} group`)
  return item.textContent ?? ''
}

describe('VerdictSummary', () => {
  it('names a tie for a FEE card too — two fee cards that tie each other both read as costing money', () => {
    render(
      <VerdictSummary
        unweightedCount={0}
        entries={[
          entry({ cardId: 1, name: 'Card A', kind: 'costs', net: -95, ties: 'ties Card B on Groceries' }),
          entry({ cardId: 2, name: 'Card B', kind: 'costs', net: -95, ties: 'ties Card A on Groceries' }),
        ]}
      />,
    )
    const costs = group('Costs you money')
    expect(costs).toContain('Card A (−$95.00/yr; ties Card B on Groceries)')
    expect(costs).toContain('Card B (−$95.00/yr; ties Card A on Groceries)')
  })

  it('keeps "free to keep" honest about what keeping holds on to: available credit and credit history', () => {
    render(<VerdictSummary unweightedCount={0} entries={[entry({ name: 'Active Cash' })]} />)
    const free = group('Free to keep — no extra rewards')
    expect(free).toContain('available credit')
    expect(free).toContain('credit history')
  })

  it('a no-fee card whose pin costs rewards says to unpin it, not that keeping it is free of cost', () => {
    render(
      <VerdictSummary
        unweightedCount={0}
        entries={[entry({ name: 'Costco', marginal: -4.8, net: -4.8 })]}
      />,
    )
    expect(group('Free to keep — no extra rewards')).toContain('Costco (a pin costs $4.80/yr — unpin it)')
  })

  it('names the unweighted categories it leaves out', () => {
    render(<VerdictSummary unweightedCount={2} entries={[entry({})]} />)
    expect(screen.getByText('Excludes 2 unweighted categories.')).toBeTruthy()
  })
})
