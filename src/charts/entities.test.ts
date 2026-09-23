import { describe, expect, it } from 'vitest'
import {
  CATEGORY_HUES,
  ENTITY,
  SALARY_TINTS,
  categoryFold,
  entityCssVar,
  foldCategories,
  foldColor,
  orderedPeople,
  personSlot,
  pickColors,
  rankCategories,
  slotColor,
} from './entities'
import {
  GROUP_COLORS,
  MUTED,
  NEGATIVE,
  OTHER_SERIES_COLOR,
  PALETTE,
  POSITIVE,
  SEQUENTIAL_BLUE,
} from './theme'

const PEOPLE = [
  { id: 7, name: 'Sam', is_primary: false },
  { id: 3, name: 'Me', is_primary: true },
  { id: 9, name: 'Kim', is_primary: false },
]

describe('personSlot', () => {
  it('primary is slot 0, others follow by id, Joint (null) is last', () => {
    expect(orderedPeople(PEOPLE).map((p) => p.name)).toEqual(['Me', 'Sam', 'Kim'])
    expect(personSlot(PEOPLE, 3)).toBe(0)
    expect(personSlot(PEOPLE, 7)).toBe(1)
    expect(personSlot(PEOPLE, 9)).toBe(2)
    expect(personSlot(PEOPLE, null)).toBe(3)
    expect(personSlot(PEOPLE, 42)).toBe(0) // unknown id: the primary's slot, never -1
  })
})

describe('slots', () => {
  it('slotColor is the palette slot and folds past eight', () => {
    expect(slotColor(0)).toBe(PALETTE[0])
    expect(slotColor(7)).toBe(PALETTE[7])
    expect(slotColor(8)).toBe(OTHER_SERIES_COLOR)
    expect(GROUP_COLORS.cash).toBe(PALETTE[0]) // re-exported unchanged
  })
})

type Kind = 'living' | 'tax' | 'transfer'
const category = (id: number, kind: Kind = 'living') => ({
  id,
  name: `C${id}`,
  slug: `c${id}`,
  sort_order: id,
  is_active: true,
  kind,
})
/** A matrix-shaped fixture: category id → its month values; `kinds` overrides living. */
function matrix(totals: Record<number, (string | null)[]>, kinds: Record<number, Kind> = {}) {
  return {
    categories: Object.keys(totals).map((id) => category(Number(id), kinds[Number(id)])),
    series: Object.entries(totals).map(([id, values]) => ({
      category_id: Number(id),
      values,
      budgets: values.map(() => null),
    })),
  }
}

// 2026-09-23 spec §C2: one colour per money entity, app-wide.
describe('the entity registry', () => {
  it('pins income to fixed hues, green to kept money, tax to its own slot and structure to grey', () => {
    expect(ENTITY).toEqual({
      salary: PALETTE[0],
      rsu: PALETTE[1],
      espp: PALETTE[2],
      investmentIncome: PALETTE[3],
      otherIncome: OTHER_SERIES_COLOR,
      tax: PALETTE[7],
      preTaxSavings: PALETTE[5],
      saved: POSITIVE,
      deficit: NEGATIVE,
      structural: MUTED,
      other: OTHER_SERIES_COLOR,
      card: PALETTE[4],
      ritual: PALETTE[6],
    })
    // The per-earner salary tints are the salary hue and two steps of its own ramp.
    expect(SALARY_TINTS).toEqual([PALETTE[0], SEQUENTIAL_BLUE[9], SEQUENTIAL_BLUE[3]])
  })

  it('hands spending categories no reserved hue: not the kept greens, not tax, not a status colour', () => {
    // PALETTE[2] reads as POSITIVE's family (OKLab ΔE 4.2 light, 8.9 dark) and PALETTE[5] is
    // the palette's green: both mean "kept" (spec §C2.3).
    const reserved = [PALETTE[2], PALETTE[5], ENTITY.tax, POSITIVE, NEGATIVE, MUTED, OTHER_SERIES_COLOR]
    for (const hue of CATEGORY_HUES) expect(reserved).not.toContain(hue)
    expect(new Set(CATEGORY_HUES).size).toBe(CATEGORY_HUES.length)
    // The validated adjacency chain, in stack order after the tax hue (see entities.ts).
    expect(CATEGORY_HUES).toEqual([PALETTE[0], PALETTE[1], PALETTE[6], PALETTE[4], PALETTE[3]])
  })
})

describe('the category fold', () => {
  it('ranks by all-time cents, ties keeping the server order', () => {
    const m = matrix({ 1: ['100.00'], 2: ['900.00'], 3: ['300.00', null], 4: ['150.00', '150.00'] })
    expect(rankCategories(m)).toEqual([
      { id: 2, kind: 'living', totalCents: 90000 },
      { id: 3, kind: 'living', totalCents: 30000 },
      { id: 4, kind: 'living', totalCents: 30000 }, // tie: 3 before 4, the server's order
      { id: 1, kind: 'living', totalCents: 10000 },
    ])
  })

  it('folds the tax category first on the tax hue, then five living categories on the chain', () => {
    const m = matrix(
      { 1: ['100.00'], 2: ['900.00'], 3: ['300.00'], 4: ['250.00'], 5: ['50.00'], 6: ['40.00'], 7: ['30.00'], 8: ['20.00'] },
      { 5: 'tax' },
    )
    const fold = categoryFold(m)
    expect(fold.ids).toEqual([5, 2, 3, 4, 1, 6]) // tax first: the stack's bottom segment
    expect(fold.colors.get(5)).toBe(ENTITY.tax)
    expect([2, 3, 4, 1, 6].map((id) => fold.colors.get(id))).toEqual([...CATEGORY_HUES])
    // The five hues are spent: the rest fold into Other.
    expect(fold.colors.has(7)).toBe(false)
    expect(foldColor(fold, 7)).toBe(OTHER_SERIES_COLOR)
  })

  it('keeps a category on its colour whatever one year or one view ranks it', () => {
    // Year 2 alone would put 2 first; the fold is ALL-TIME, so the money flow's 2026 and the
    // Spending page's bars both see 1 on the first hue.
    const fold = categoryFold(matrix({ 1: ['5000.00', '0.00'], 2: ['100.00', '900.00'] }))
    expect(fold.colors.get(1)).toBe(CATEGORY_HUES[0])
    expect(fold.colors.get(2)).toBe(CATEGORY_HUES[1])
  })

  it('skips dormant and net-refund categories — nothing to stack, no identity to keep', () => {
    expect(categoryFold(matrix({ 1: ['0.00'], 2: ['-50.00'], 3: ['10.00'], 4: [null] })).ids).toEqual([3])
  })

  it('gives the tax hue to the first tax-kind category only; a second one is an ordinary category', () => {
    const fold = foldCategories([
      { id: 1, kind: 'tax', totalCents: 500 },
      { id: 2, kind: 'tax', totalCents: 400 },
      { id: 3, kind: 'living', totalCents: 300 },
    ])
    expect(fold.ids).toEqual([1, 2, 3])
    expect(fold.colors.get(1)).toBe(ENTITY.tax)
    expect(fold.colors.get(2)).toBe(CATEGORY_HUES[0])
    expect(fold.colors.get(3)).toBe(CATEGORY_HUES[1])
  })

  it('stops at the first category that has no hue left, so the fold is always a rank prefix', () => {
    const ranked = [1, 2, 3, 4, 5, 6].map((id) => ({ id, kind: 'living', totalCents: 1000 - id }))
    // A tax category below the sixth living one does not jump the queue past it.
    const fold = foldCategories([...ranked, { id: 9, kind: 'tax', totalCents: 1 }])
    expect(fold.ids).toEqual([1, 2, 3, 4, 5])
    expect(fold.colors.has(9)).toBe(false)
  })

  it('never lets two folded categories share a colour', () => {
    const fold = categoryFold(
      matrix({ 1: ['9.00'], 2: ['8.00'], 3: ['7.00'], 4: ['6.00'], 5: ['5.00'], 6: ['4.00'], 7: ['3.00'] }, { 4: 'tax' }),
    )
    const colors = fold.ids.map((id) => fold.colors.get(id))
    expect(new Set(colors).size).toBe(colors.length)
  })
})

describe('pickColors (Spending › Trends)', () => {
  it('folded picks wear their fold colour; the first outsider is Other grey, the next a free hue', () => {
    const fold = foldCategories([
      { id: 1, kind: 'living', totalCents: 900 },
      { id: 2, kind: 'living', totalCents: 800 },
    ])
    const colors = pickColors([2, 7, 8], fold)
    expect(colors.get(2)).toBe(CATEGORY_HUES[1])
    expect(colors.get(7)).toBe(OTHER_SERIES_COLOR)
    // CATEGORY_HUES[0] is Category 1's, but Category 1 is not in THIS chart: the first hue no
    // pick here wears is the free one.
    expect(colors.get(8)).toBe(CATEGORY_HUES[0])
    expect(new Set(colors.values()).size).toBe(3)
  })
})

describe('entityCssVar', () => {
  it('maps registry hexes to the theme-following CSS variables, or keeps a ramp step', () => {
    expect(entityCssVar(PALETTE[0])).toBe('var(--chart-1)')
    expect(entityCssVar(ENTITY.tax)).toBe('var(--chart-8)')
    expect(entityCssVar(ENTITY.card)).toBe('var(--chart-5)')
    expect(entityCssVar(OTHER_SERIES_COLOR)).toBe('var(--other-series)')
    expect(entityCssVar(MUTED)).toBe('var(--muted)')
    expect(entityCssVar(POSITIVE)).toBe('var(--positive)')
    expect(entityCssVar(NEGATIVE)).toBe('var(--negative)')
    // The sequential ramp has no custom properties (tooltip.ts documents the same cost).
    expect(entityCssVar(SEQUENTIAL_BLUE[9])).toBe(SEQUENTIAL_BLUE[9])
  })
})
