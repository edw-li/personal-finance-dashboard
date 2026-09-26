import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (tableScrollCss.test.ts's idiom); the constant card height is
// measured in Edge across the five breakdowns (2026-09-25 polish spec §3.6).
const CSS = readFileSync(path.join(__dirname, 'allocation.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')

describe('the Allocation aside beside the donut (allocation.css)', () => {
  // Exactly the plot's height while it sits beside the plot, so the card keeps one height across the
  // five breakdowns; the list box takes the squeeze — but never below a few rows (review): when the
  // aside's own lines grow (more caveats, the Missing quotes list open) the aside grows instead, and
  // nothing spills past the card.
  it('holds the aside at the plot height, the list flexing above a floor, the aside never below its content', () => {
    expect(CSS).toContain(
      '@container (min-width: 900px) { .chart-card-slot .allocation-aside { display: flex; flex-direction: column; height: var(--chart-h); min-height: min-content; } .chart-card-slot .allocation-aside > .allocation-table-scroll { flex: 1 1 0; min-height: 10rem; } }',
    )
  })

  // The floor makes Missing quotes' own release redundant: an open list grows the aside by itself.
  it('needs no special release for the Missing quotes list', () => {
    expect(CSS).not.toContain('allocation-missing-quotes[open]')
  })
})
