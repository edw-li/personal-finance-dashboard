import { describe, expect, it } from 'vitest'
import type { ClosingEffect } from './closingEffect'
import { closingSentence, perYear, tieWords, verdictReason } from './verdictCopy'

const CARDS = new Map([
  [3, 'Robinhood Gold'],
  [5, 'Autograph'],
  [9, 'Venture X'],
])
const CATEGORIES = new Map([
  [40, 'Dining'],
  [41, 'Groceries'],
  [42, 'Travel'],
  [43, 'Gas'],
  [44, 'Streaming'],
])
const cardName = (id: number) => CARDS.get(id) ?? `#${id}`
const categoryName = (id: number) => CATEGORIES.get(id) ?? `#${id}`

describe('tieWords', () => {
  it('names the partner and the shared categories', () => {
    expect(tieWords([{ withCardIds: [3], categoryIds: [40, 41] }], cardName, categoryName)).toBe(
      'ties Robinhood Gold on Dining and Groceries',
    )
  })

  // Production, 2026-09-23: Savor ties Robinhood Gold on four categories, three of them with
  // other cards too. Listing every partner SET read as a paragraph; one partner card that ties
  // it everywhere is the whole reason, and it is enough.
  it('explains by the fewest partner cards, the one tying the most categories first', () => {
    expect(
      tieWords(
        [
          { withCardIds: [3], categoryIds: [40, 41] },
          { withCardIds: [3, 5, 9], categoryIds: [42] },
          { withCardIds: [3, 5], categoryIds: [44] },
        ],
        cardName,
        categoryName,
      ),
    ).toBe('ties Robinhood Gold on Dining, Groceries, Travel and Streaming')
  })

  it('names a second partner only for the categories the first does not tie', () => {
    expect(
      tieWords(
        [
          { withCardIds: [3], categoryIds: [40] },
          { withCardIds: [5, 9], categoryIds: [42] },
        ],
        cardName,
        categoryName,
      ),
    ).toBe('ties Robinhood Gold on Dining; Autograph on Travel')
  })

  it('shortens a long category list to a count when asked', () => {
    expect(
      tieWords([{ withCardIds: [3], categoryIds: [40, 41, 42, 43, 44] }], cardName, categoryName, 2),
    ).toBe('ties Robinhood Gold on Dining, Groceries and 3 more')
  })

  it('is null with nothing tied', () => {
    expect(tieWords([], cardName, categoryName)).toBeNull()
  })
})

describe('perYear', () => {
  it('signs with the typographic minus, never a hyphen', () => {
    expect(perYear(-94.13)).toBe('−$94.13/yr')
    expect(perYear(116.87)).toBe('+$116.87/yr')
    expect(perYear(0.001)).toBe('$0.00/yr')
  })
})

const value = (over: Partial<{ marginal: number; countedCredits: number; annualFee: number; net: number }>) => ({
  cardId: 1,
  marginal: 0,
  countedCredits: 0,
  annualFee: 0,
  net: 0,
  wonCategoryIds: [],
  ...over,
})

describe('verdictReason', () => {
  it('costs: the fee against what the card brings', () => {
    expect(
      verdictReason(value({ marginal: 31.2, countedCredits: 300, annualFee: 395, net: -63.8 }), null),
    ).toBe(
      'On these numbers its $395.00 fee is more than the $31.20 of rewards and $300.00 of credits it brings: −$63.80 a year.',
    )
    expect(verdictReason(value({ marginal: 35.87, annualFee: 130, net: -94.13 }), null)).toBe(
      'On these numbers its $130.00 fee is more than the $35.87 of rewards it brings: −$94.13 a year.',
    )
  })

  it('costs, with a pin dragging the marginal below zero', () => {
    expect(verdictReason(value({ marginal: -4.8, annualFee: 95, net: -99.8 }), null)).toBe(
      'On these numbers its $95.00 fee buys nothing back, and a pin sends spend to it at a lower rate than the best card: −$99.80 a year.',
    )
  })

  it('free: a tie is named as the reason its rewards are not extra', () => {
    expect(verdictReason(value({}), 'ties Robinhood Gold on Dining')).toBe(
      'It has no annual fee, and it ties Robinhood Gold on Dining — without it, that spend earns the same on the other card.',
    )
  })

  it('free: never the best rate', () => {
    expect(verdictReason(value({}), null)).toBe(
      'It has no annual fee, and the rest of the lineup earns as much on every weighted category.',
    )
  })

  it('free: a pin costs rewards, and unpinning is the fix', () => {
    expect(verdictReason(value({ marginal: -4.8, net: -4.8 }), null)).toBe(
      'It has no annual fee, but a pin sends spend to it at a lower rate than the best card, which costs $4.80 a year in rewards — unpin it in Manage › Categories & weights.',
    )
  })

  it('free: a fee the card covers exactly', () => {
    expect(verdictReason(value({ marginal: 95, countedCredits: 300, annualFee: 395, net: 0 }), null)).toBe(
      'Its $95.00 of rewards and $300.00 of credits cover its $395.00 fee exactly.',
    )
  })

  it('earns: with and without a fee', () => {
    expect(
      verdictReason(value({ marginal: 111.87, countedCredits: 400, annualFee: 395, net: 116.87 }), null),
    ).toBe('On these numbers its $111.87 of rewards and $400.00 of credits beat its $395.00 fee by $116.87 a year.')
    expect(verdictReason(value({ marginal: 144.76, net: 144.76 }), null)).toBe(
      'On these numbers it adds $144.76 a year that the rest of the lineup would not earn.',
    )
  })
})

describe('closingSentence', () => {
  const effect = (over: Partial<ClosingEffect> = {}): ClosingEffect => ({
    lineBefore: 115350,
    lineAfter: 107750,
    cardLimit: 7600,
    utilization: null,
    ...over,
  })

  it('free: saves nothing, names the line it gives up and the history it keeps', () => {
    expect(
      closingSentence(
        'free',
        value({}),
        effect({ utilization: { before: 0.0421, after: 0.045, month: '2026-10-01' } }),
        { opened_on: '2020-01-10', oldest: true },
      ),
    ).toBe(
      'Closing it saves nothing: total credit line $115,350.00 → $107,750.00; household utilization 4.2% → 4.5% with the same balances (as of Oct 2026). Open since Jan 10, 2020 — the oldest card here — its age counts toward your credit history.',
    )
  })

  it('costs: saves the net, and says when no limit is recorded — with no utilization that cannot move', () => {
    expect(
      closingSentence(
        'costs',
        value({ annualFee: 130, net: -94.13 }),
        effect({
          cardLimit: null,
          lineAfter: 115350,
          utilization: { before: 0.042, after: 0.042, month: '2026-10-01' },
        }),
        { opened_on: null, oldest: false },
      ),
    ).toBe(
      'Closing it saves $94.13 a year on these numbers: no credit limit is recorded for it, so the total line shown would not change.',
    )
  })

  it('says when no line would be left at all', () => {
    expect(
      closingSentence(
        'free',
        value({}),
        effect({ lineBefore: 5000, lineAfter: 0, cardLimit: 5000, utilization: { before: 0.1, after: null, month: '2026-10-01' } }),
        { opened_on: '2024-02-01', oldest: false },
      ),
    ).toBe(
      'Closing it saves nothing: total credit line $5,000.00 → $0.00; household utilization 10.0% now, with no line left after. Open since Feb 1, 2024 — its age counts toward your credit history.',
    )
  })
})
