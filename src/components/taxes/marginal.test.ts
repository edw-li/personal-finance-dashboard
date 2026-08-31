import { describe, expect, it } from 'vitest'
import type { TaxBracketOut } from '../../types/api'
import {
  additionalMedicareStep,
  ladderSegments,
  marginalCost,
  taxAt,
  toBrackets,
} from './marginal'

// A 2024-single-shaped federal table, SHUFFLED on purpose: order must come from the
// thresholds, never from bracket_index or row order (the server sorts defensively too).
const FED_ROWS: TaxBracketOut[] = [
  { bracket_index: 3, rate: '0.2200', threshold: '47150.00' },
  { bracket_index: 1, rate: '0.1000', threshold: '0.00' },
  { bracket_index: 4, rate: '0.2400', threshold: '100525.00' },
  { bracket_index: 2, rate: '0.1200', threshold: '11600.00' },
]
const FED = toBrackets(FED_ROWS)

// The Medicare pair: 1.45% base, 2.35% additional tier above 200k.
const MEDICARE = toBrackets([
  { bracket_index: 1, rate: '0.014500', threshold: '0.00' },
  { bracket_index: 2, rate: '0.023500', threshold: '200000.00' },
])

describe('toBrackets', () => {
  it('parses the wire strings and sorts ascending by threshold', () => {
    expect(FED).toEqual([
      { rate: 0.1, floor: 0 },
      { rate: 0.12, floor: 11600 },
      { rate: 0.22, floor: 47150 },
      { rate: 0.24, floor: 100525 },
    ])
  })
})

describe('taxAt (mirror of tax_service.walk)', () => {
  it('taxes nothing at zero or negative income', () => {
    expect(taxAt(FED, 0)).toBe(0)
    expect(taxAt(FED, -1)).toBe(0)
  })

  it('gives a threshold to the bracket BELOW it', () => {
    // 11600 × 10% = 1160 — the 12% bracket contributes nothing at exactly its own floor
    // (the engine's documented 2024-federal example, tax_service.py walk docstring).
    expect(taxAt(FED, 11600)).toBeCloseTo(1160, 6)
  })

  it('walks a mid-bracket income by hand', () => {
    // 11600×.10 + 35550×.12 + 2850×.22 = 1160 + 4266 + 627 = 6053
    expect(taxAt(FED, 50000)).toBeCloseTo(6053, 6)
    // 1160 + 4266 + 53375×.22 (=11742.50) + 19475×.24 (=4674) = 21842.50
    expect(taxAt(FED, 120000)).toBeCloseTo(21842.5, 6)
  })
})

describe('marginalCost', () => {
  it('prices $1,000 sitting fully inside one bracket', () => {
    expect(marginalCost(FED, 50000)).toBe(220) // 1000 × 22%
  })

  it('prices a boundary straddle piecewise', () => {
    // 650 more at 12% up to 47150 (=78) + 350 at 22% (=77) = 155
    expect(marginalCost(FED, 46500)).toBe(155)
  })

  it('starts at the bottom bracket for zero or negative income', () => {
    expect(marginalCost(FED, 0)).toBe(100) // 1000 × 10%
    // The walk clamps the non-positive side to 0, so only the positive half is taxed.
    expect(marginalCost(FED, -500)).toBe(50) // 500 × 10%
  })

  it('takes a custom step', () => {
    expect(marginalCost(FED, 50000, 100)).toBe(22)
  })
})

describe('ladderSegments', () => {
  it('marks the containing bracket and leaves the top ceiling open', () => {
    expect(ladderSegments(FED, 50000)).toEqual([
      { rate: 0.1, floor: 0, ceiling: 11600, current: false },
      { rate: 0.12, floor: 11600, ceiling: 47150, current: false },
      { rate: 0.22, floor: 47150, ceiling: 100525, current: true },
      { rate: 0.24, floor: 100525, ceiling: null, current: false },
    ])
  })

  it('keeps income exactly ON a floor in the bracket below', () => {
    const onBoundary = ladderSegments(FED, 47150)
    expect(onBoundary[1].current).toBe(true) // the 12% bracket owns its ceiling
    expect(onBoundary[2].current).toBe(false)
  })

  it('marks nothing on a zero-income year and answers [] for an empty table', () => {
    expect(ladderSegments(FED, 0).every((segment) => !segment.current)).toBe(true)
    expect(ladderSegments([], 50000)).toEqual([])
  })
})

describe('additionalMedicareStep', () => {
  it('prices the surcharge from the stored tier difference, at cents', () => {
    // (0.0235 − 0.0145) × 1000 — the float noise (…000002) must land back on 9 exactly.
    expect(additionalMedicareStep(MEDICARE, 250000)).toBe(9)
  })

  it('stays silent below the tier, exactly ON it, and with no tier at all', () => {
    expect(additionalMedicareStep(MEDICARE, 150000)).toBeNull()
    expect(additionalMedicareStep(MEDICARE, 200000)).toBeNull() // the floor belongs below
    expect(additionalMedicareStep([{ rate: 0.0145, floor: 0 }], 250000)).toBeNull()
    expect(additionalMedicareStep([], 250000)).toBeNull()
  })
})
