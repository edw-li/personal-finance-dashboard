import { describe, expect, it } from 'vitest'
import type { Reconciliation, ReconciliationRow } from '../../types/api'
import {
  dayLabel,
  differenceText,
  effectText,
  flagDetail,
  leadLine,
  matchedFace,
  projectedDetail,
  projectsWord,
  typedDetail,
  typedText,
} from './reconciliation'

const FACTS = {
  typed_pay_periods: null,
  typed_checkpoint: null,
  projected_checks: null,
  projected_from: null,
  capped_at: null,
  future_vest_income: null,
  quote_tolerance: null,
  reference_price: null,
  reference_date: null,
}

function row(over: Partial<ReconciliationRow> = {}): ReconciliationRow {
  return {
    key: 'salary',
    person_id: 1,
    person_name: 'Edward',
    label: 'Salary wages',
    source: 'paycheck',
    typed: '184441.67',
    typed_keys: ['pay_periods', 'annual_salary', 'w2_salary_checkpoint'],
    projected: '188930.00',
    difference: '4488.33',
    tax_effect: '1600.09',
    flagged: true,
    facts: {
      ...FACTS,
      typed_pay_periods: '20',
      typed_checkpoint: '27000.00',
      projected_checks: 24,
      projected_from: '2026-01-16',
    },
    apply: null,
    ...over,
  }
}

function rec(over: Partial<Reconciliation> = {}): Reconciliation {
  return {
    rows: [row()],
    flagged_count: 1,
    liability_if_matched: '104408.99',
    balance_if_matched: '-5004.21',
    flag_above: '250.00',
    notes: [],
    ...over,
  }
}

describe('reconciliation copy (2026-09-23 spec §W4)', () => {
  it('reads a typed figure, or says nobody entered it', () => {
    expect(typedText(row())).toBe('$184,441.67')
    expect(typedText(row({ typed: null }))).toBe('not entered')
  })

  it('names what the typed salary is made of', () => {
    expect(typedDetail(row())).toBe('20 pay periods + $27,000 checkpoint')
    expect(typedDetail(row({ facts: { ...FACTS, typed_pay_periods: '10' } }))).toBe('10 pay periods')
    expect(typedDetail(row({ key: 'hsa', facts: FACTS }))).toBeNull()
    // A negative checkpoint carries its sign (code-quality M1): it LOWERS the typed salary.
    expect(
      typedDetail(row({ facts: { ...FACTS, typed_pay_periods: '24', typed_checkpoint: '-3000.00' } })),
    ).toBe('24 pay periods − $3,000 checkpoint')
    // A checkpoint alone keeps its own sign too.
    expect(typedDetail(row({ facts: { ...FACTS, typed_checkpoint: '-3000.00' } }))).toBe(
      '−$3,000 checkpoint',
    )
    expect(typedDetail(row({ facts: { ...FACTS, typed_checkpoint: '5000.00' } }))).toBe(
      '$5,000 checkpoint',
    )
  })

  it('says which record projects the figure', () => {
    expect(projectsWord(row())).toBe('Paycheck projects')
    expect(projectsWord(row({ source: 'comp' }))).toBe('Comp projects')
    expect(projectsWord(row({ source: 'espp' }))).toBe('ESPP projects')
  })

  it('explains each projection in its own terms', () => {
    expect(projectedDetail(row(), 2026)).toBe('24 checks from Jan 16')
    expect(
      projectedDetail(row({ facts: { ...FACTS, projected_checks: 8, projected_from: '2026-09-16' } }), 2026),
    ).toBe('8 checks from Sep 16')
    expect(
      projectedDetail(
        row({ key: 'trad_401k', facts: { ...FACTS, projected_checks: 24, projected_from: '2026-01-16', capped_at: '24500.00' } }),
        2026,
      ),
    ).toBe('capped at the 2026 limit ($24,500)')
    expect(
      projectedDetail(
        row({ key: 'hsa', facts: { ...FACTS, projected_checks: 24, projected_from: '2026-01-16', capped_at: '2400.00' } }),
        2026,
      ),
    ).toBe('capped at the 2026 limit less the employer deposit ($2,400)')
    expect(projectedDetail(row({ key: 'rsu', source: 'comp', facts: FACTS }), 2026)).toBe(
      'vests at their vest-day close, later ones at today’s quote',
    )
    expect(projectedDetail(row({ key: 'espp', source: 'espp', facts: FACTS }), 2026)).toBe(
      'lots sold in 2026',
    )
  })

  it('names a day without its year only inside the card’s own year', () => {
    expect(dayLabel('2026-09-16', 2026)).toBe('Sep 16')
    expect(dayLabel('2027-01-01', 2026)).toBe('Jan 1, 2027')
    expect(dayLabel('2026-09-16')).toBe('Sep 16')
  })

  it('signs the difference and rounds the tax effect to whole dollars', () => {
    expect(differenceText('4488.33')).toBe('+$4,488.33')
    expect(differenceText('-2000.00')).toBe('−$2,000.00')
    expect(differenceText('0.00')).toBe('$0.00')
    expect(effectText('18265.36')).toBe('≈ +$18,265 tax')
    expect(effectText('-863.00')).toBe('≈ −$863 tax')
    expect(effectText('0.00')).toBe('no change in tax')
    // Under half a dollar rounds to nothing: "≈ +$0 tax" would say a thing and its opposite.
    expect(effectText('0.40')).toBe('no change in tax')
    expect(effectText('-0.49')).toBe('no change in tax')
    // A row flagged at the month's reference close can show no change at today's quote.
    expect(effectText('0.00', true)).toBe('no change at today’s quote')
  })

  it('says why an RSU row is flagged: the month’s reference close and its band (review finding 3)', () => {
    const rsu = row({
      key: 'rsu',
      source: 'comp',
      typed: '171235.24',
      projected: '171235.24',
      difference: '0.00',
      tax_effect: '0.00',
      flagged: true,
      facts: {
        ...FACTS,
        future_vest_income: '48520.44',
        quote_tolerance: '4609.73',
        reference_price: '217.4400',
        reference_date: '2026-09-01',
      },
    })
    expect(flagDetail(rsu)).toBe(
      'flag judged at the Sep 1 close ($217.44 a share), beyond ±$4,610 of the unvested vests',
    )
    // No reference close on file: the flag used the latest quote.
    expect(flagDetail(row({ ...rsu, facts: { ...rsu.facts, reference_date: null } }))).toBe(
      'flag judged at the latest quote ($217.44 a share), beyond ±$4,610 of the unvested vests',
    )
    // A January reference close is last year's: it says so.
    expect(flagDetail(row({ ...rsu, facts: { ...rsu.facts, reference_date: '2025-12-31' } }), 2026)).toBe(
      'flag judged at the Dec 31, 2025 close ($217.44 a share), beyond ±$4,610 of the unvested vests',
    )
    // Quiet when there is nothing to explain: not flagged, or not the RSU row.
    expect(flagDetail({ ...rsu, flagged: false })).toBeNull()
    expect(flagDetail(row())).toBeNull()
  })

  it('leads with the count and the reference-price clause only when an RSU row is flagged', () => {
    expect(leadLine(rec())).toBe('1 input differs from your records by more than $250 of tax')
    expect(
      leadLine(
        rec({
          flagged_count: 3,
          rows: [row(), row({ key: 'rsu', source: 'comp', flagged: true }), row({ key: 'hsa', flagged: true })],
        }),
      ),
    ).toBe(
      '3 inputs differ from your records by more than $250 of tax (this month’s reference price for unvested RSUs)',
    )
    expect(leadLine(rec({ flagged_count: 0, rows: [row({ flagged: false })] }))).toBe(
      'Every input is within $250 of tax of your records',
    )
  })

  it('words the balance if matched the way the headline tile does', () => {
    expect(matchedFace('-5004.21')).toEqual({
      text: 'Balance if they matched your records: refund ≈ $5,004',
      tone: 'positive',
    })
    expect(matchedFace('1200.50')).toEqual({
      text: 'Balance if they matched your records: owe ≈ $1,201',
      tone: 'negative',
    })
    expect(matchedFace('0.00')).toEqual({
      text: 'Balance if they matched your records: even',
      tone: 'neutral',
    })
    // Under half a dollar is even, never "refund ≈ $0".
    expect(matchedFace('-0.30')).toEqual({
      text: 'Balance if they matched your records: even',
      tone: 'neutral',
    })
    expect(matchedFace(null)).toBeNull()
  })
})
