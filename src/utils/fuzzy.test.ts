import { describe, expect, it } from 'vitest'
import { fuzzyScore } from './fuzzy'

describe('fuzzyScore', () => {
  it('matches subsequences case-insensitively and refuses non-subsequences', () => {
    expect(fuzzyScore('SPEN', 'Spending')).toBe(11)
    expect(fuzzyScore('xyz', 'Portfolio')).toBeNull()
    // Order matters — a subsequence is not a bag of letters.
    expect(fuzzyScore('ca', 'Paycheck')).toBeNull()
  })

  it('scores consecutive runs above word starts above scattered hits', () => {
    expect(fuzzyScore('port', 'Portfolio')).toBe(11) // 2 + 3 + 3 + 3
    expect(fuzzyScore('nw', 'Net worth')).toBe(4) // two word heads
    expect(fuzzyScore('pd', 'Spending')).toBe(2) // two scattered hits
    // A consecutive pair outranks the same pair split across a word gap.
    expect(fuzzyScore('ab', 'absolute')!).toBeGreaterThan(fuzzyScore('ab', 'a big')!)
  })

  it('aligns from any word head, not just the leftmost greedy pass', () => {
    // The leftmost pass gives "As"k the a-s and leaves "assistant" to be picked apart, so
    // the palette's own "Ask assistant" action used to score BELOW the plain Settings card
    // named "Assistant". Starting at the second word finds the whole word intact, so the
    // longer label that literally contains the query is never the weaker match.
    expect(fuzzyScore('assistant', 'Ask assistant')).toBe(fuzzyScore('assistant', 'Assistant'))
  })

  it('lets the empty query match everything at zero', () => {
    expect(fuzzyScore('', 'Anything')).toBe(0)
  })
})
