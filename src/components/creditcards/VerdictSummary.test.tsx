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

  // Code review M1: the tail agrees with the group — one card is "it", several are "them".
  it('agrees in number: one card is "it" and "the fee", several are "them" and "each fee"', () => {
    const { unmount } = render(
      <VerdictSummary
        unweightedCount={0}
        entries={[
          entry({ cardId: 1, name: 'Active Cash' }),
          entry({ cardId: 2, name: 'Costco', kind: 'costs', net: -94.13 }),
        ]}
      />,
    )
    expect(group('Free to keep — no extra rewards')).toMatch(/keeping it open holds on to/)
    expect(group('Costs you money')).toMatch(/ — the fee is more than the card adds\.$/)
    unmount()
    render(
      <VerdictSummary
        unweightedCount={0}
        entries={[
          entry({ cardId: 1, name: 'Active Cash' }),
          entry({ cardId: 2, name: 'Apple Card' }),
          entry({ cardId: 3, name: 'Costco', kind: 'costs', net: -94.13 }),
          entry({ cardId: 4, name: 'Other', kind: 'costs', net: -20 }),
        ]}
      />,
    )
    expect(group('Free to keep — no extra rewards')).toMatch(/keeping them open holds on to/)
    expect(group('Costs you money')).toMatch(/ — each fee is more than its card adds\.$/)
  })

  it('a fee card with a costly pin says so beside its yearly figure', () => {
    render(
      <VerdictSummary
        unweightedCount={0}
        entries={[entry({ name: 'Costco', kind: 'costs', net: -99.8, marginal: -4.8 })]}
      />,
    )
    expect(group('Costs you money')).toContain('Costco (−$99.80/yr; a pin costs $4.80/yr — unpin it)')
  })

  it('names the unweighted categories it leaves out', () => {
    render(<VerdictSummary unweightedCount={2} entries={[entry({})]} />)
    expect(screen.getByText('Excludes 2 unweighted categories.')).toBeTruthy()
  })
})
