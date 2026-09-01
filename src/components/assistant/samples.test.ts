import { describe, expect, it } from 'vitest'
import { INSIGHT_PRESETS, samplesFor } from './samples'

describe('assistant samples', () => {
  it('ships the three insight presets in order', () => {
    expect(INSIGHT_PRESETS.map((p) => p.label)).toEqual([
      'Month in review',
      'What changed in my spending?',
      'Contribution-limit pace',
    ])
  })

  it('returns route samples for a known route and [] for unknown', () => {
    expect(samplesFor('/spending').length).toBeGreaterThan(0)
    expect(samplesFor('/nonexistent')).toEqual([])
  })

  it('every sample and preset carries a non-empty prompt', () => {
    const all = [...INSIGHT_PRESETS, ...samplesFor('/spending'), ...samplesFor('/taxes')]
    for (const item of all) expect(item.prompt.trim().length).toBeGreaterThan(10)
  })
})
