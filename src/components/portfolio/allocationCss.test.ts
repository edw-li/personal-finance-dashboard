import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (tableScrollCss.test.ts's idiom); the constant card height is
// measured in Edge across the five breakdowns (2026-09-25 polish spec §3.6).
const CSS = readFileSync(path.join(__dirname, 'allocation.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')

describe('the Allocation aside beside the donut (allocation.css)', () => {
  it('caps the aside at the plot height while it sits beside the plot, the list box taking the squeeze', () => {
    expect(CSS).toContain(
      '@container (min-width: 900px) { .chart-card-slot .allocation-aside { display: flex; flex-direction: column; } .chart-card-slot .allocation-aside:not(:has(> .allocation-missing-quotes[open])) { max-height: var(--chart-h); } .chart-card-slot .allocation-aside > .allocation-table-scroll { flex: 1 1 auto; min-height: 0; } }',
    )
  })
})
