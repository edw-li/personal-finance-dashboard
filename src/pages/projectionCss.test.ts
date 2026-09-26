import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** Comments first, over the WHOLE file (settingsCss.test.ts's rule): a `}` parked inside a
 *  multi-line comment would otherwise truncate a block. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

const css = stripComments(readFileSync(path.resolve(__dirname, 'ProjectionPage.css'), 'utf8'))

/** Where a pattern starts, or a failure naming what is missing rather than a bare -1. */
function at(pattern: RegExp | string, what: string): number {
  const index = typeof pattern === 'string' ? css.indexOf(pattern) : css.search(pattern)
  if (index < 0) throw new Error(`ProjectionPage.css has no ${what}`)
  return index
}

describe('ProjectionPage.css — the sticky chart column', () => {
  // A container query adds NO specificity: `@container … { .projection-chart-area { top } }` and
  // the bare `.projection-chart-area { top }` are both (0,1,0), so the LATER one wins. Written
  // above the base rule the narrow-width override was dead, and between 900 and 999px of page
  // width the band went static (two rows, ~250px) while the chart still stuck 250px below the
  // frame — a band-sized hole above the chart card. jsdom computes no layout and resolves no
  // container query, so source order is the only place this can be pinned (2026-09-13 P4 review).
  it('writes the narrow-width overrides AFTER the base rule they override', () => {
    const base = at(/\.projection-chart-area \{[^}]*--projection-band-h/, 'base sticky rule')
    const narrow = at(/@container page \(max-width: 999px\)/, '999px container block')
    const oneColumn = at(/@container page \(max-width: 900px\)/, '900px container block')
    expect(narrow).toBeGreaterThan(base)
    // …and the one-column block, which drops `position: sticky` outright, stays last of the three.
    expect(oneColumn).toBeGreaterThan(narrow)
  })

  // panels.css names the page container (`container: page / inline-size`) precisely because a
  // .kpi-row can sit inside a NEARER container — .stat-tile is one — and an unnamed query binds
  // to the nearest. These rules mean the PAGE's width, so they ask for it by name.
  it('asks the page container for its width by name, never anonymously', () => {
    expect(css).toContain('container: page / inline-size;')
    expect(css.match(/@container\s+\(/g)).toBeNull()
  })
})

describe('ProjectionPage.css — the outcomes band (2026-09-25 polish spec §4.2)', () => {
  // The 3 + 2 rule this sheet kept for itself (batch 2 final verification D5) lives in panels.css for
  // every five-tile row now — tileRowCss.test.ts pins it there.
  it('keeps no local copy of the five-tile layout', () => {
    expect(css).not.toContain('repeat(6, minmax(0, 1fr))')
    expect(css).not.toMatch(/\.projection-outcomes > :nth-child/)
  })

  // Pinned, the band's own 8px padding is its bottom space: the tiles' 16px line margin (panels.css)
  // would stand inside the pinned band and grow it, so there the tiles keep 8px and the band 1rem.
  it('keeps the pinned band as tall as its one line plus 8px each side', () => {
    const block = at(/@container page \(width >= 1000px\) \{/, '>=1000px container block')
    const body = css.slice(block, css.indexOf('\n}', block))
    expect(body).toMatch(/\.projection-outcomes\.kpi-row \{[^}]*padding-bottom: 0;[^}]*margin-bottom: 1rem;/)
    expect(body).toMatch(/\.projection-outcomes\.kpi-row > \* \{[^}]*margin-bottom: 8px;/)
  })
})
