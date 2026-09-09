import { describe, expect, it } from 'vitest'
import type { AssistantContextIn } from '../../types/api'
import { describeContext } from './contextLabel'

const PEOPLE = [
  { id: 1, name: 'Edward', is_primary: true },
  { id: 2, name: 'Grace', is_primary: false },
]

function ctx(over: Partial<AssistantContextIn> = {}): AssistantContextIn {
  return { route: '/', search: {}, view: {}, ...over }
}

describe('describeContext', () => {
  it('names the page from the nav registry', () => {
    expect(describeContext(ctx({ route: '/net-worth' }))).toBe('Net worth')
    expect(describeContext(ctx({ route: '/' }))).toBe('Overview')
  })

  it('falls back to the path for a route the registry does not carry', () => {
    expect(describeContext(ctx({ route: '/nowhere' }))).toBe('/nowhere')
  })

  it('says the viewed month in words, from the shell’s short url grammar', () => {
    expect(describeContext(ctx({ route: '/spending', search: { month: '2026-03' } }))).toBe(
      'Spending · Mar 2026',
    )
  })

  it('reads a legacy full date as its month', () => {
    expect(describeContext(ctx({ route: '/spending', search: { month: '2026-03-15' } }))).toBe(
      'Spending · Mar 2026',
    )
  })

  it('drops a month it cannot read rather than printing it raw', () => {
    expect(describeContext(ctx({ route: '/spending', search: { month: '2026-13' } }))).toBe(
      'Spending',
    )
    expect(describeContext(ctx({ route: '/spending', search: { month: 'soon' } }))).toBe('Spending')
  })

  it('says the ownership scope in the words the chips use', () => {
    const at = (owner: string | null) =>
      describeContext(ctx({ route: '/net-worth', view: { owner } }), PEOPLE)
    expect(at(null)).toBe('Net worth · Household')
    expect(at('joint')).toBe('Net worth · Joint')
    expect(at('2')).toBe('Net worth · Grace')
  })

  it('omits an owner it cannot name — an id is not an answer', () => {
    // The roster is a fetch that can fail, and a person can be deleted from under a link.
    expect(describeContext(ctx({ route: '/net-worth', view: { owner: '2' } }))).toBe('Net worth')
    expect(describeContext(ctx({ route: '/net-worth', view: { owner: '9' } }), PEOPLE)).toBe(
      'Net worth',
    )
  })

  it('spells the tax year and the filing status out', () => {
    expect(
      describeContext(ctx({ route: '/taxes', view: { year: 2026, filingStatus: 'married_joint' } })),
    ).toBe('Taxes · 2026 · Married filing jointly')
  })

  it('drops a year that is not one and a status outside the vocabulary', () => {
    expect(
      describeContext(ctx({ route: '/taxes', view: { year: null, filingStatus: 'divorced' } })),
    ).toBe('Taxes')
  })

  it('names the drilled-in holding and the live what-if', () => {
    expect(
      describeContext(ctx({ route: '/portfolio', view: { owner: null, ticker: 'NVDA' } })),
    ).toBe('Portfolio · Household · NVDA')
    expect(
      describeContext(ctx({ route: '/projection', view: { whatif: ['annual_return:0.2'] } })),
    ).toBe('Projection · what-if')
    expect(describeContext(ctx({ route: '/projection', view: { whatif: [] } }))).toBe('Projection')
  })

  it('never prints a raw view key', () => {
    // The bug this replaces: "Taxes · year: 2026 · filingStatus: single". Keys the sentence
    // has no words for are dropped, not stringified.
    const label = describeContext(
      ctx({
        route: '/net-worth',
        search: { range: '5y', owner: 'all' },
        view: { owner: null, granularity: 'quarterly', tab: 'transactions' },
      }),
      PEOPLE,
    )
    expect(label).toBe('Net worth · Household')
    expect(label).not.toContain(':')
  })
})
