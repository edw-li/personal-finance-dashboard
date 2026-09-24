import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// tableScrollCss.test.ts's idiom: comments out, whitespace flattened, so a pin fails only when a
// declaration changes. jsdom computes none of these rules.
const CSS = readFileSync(path.join(__dirname, 'dividends.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')

describe('the dividend ledger by month (dividends.css)', () => {
  // The automatic layout sized every column from the rows on screen, so opening or folding a month
  // moved the column headings; the box's scrollbar coming and going with the fold rescaled them too.
  it('fixes its columns and keeps the scrollbar lane, so no fold moves a heading', () => {
    expect(CSS).toContain('.dividend-table { table-layout: fixed; min-width: 58rem; }')
    expect(CSS).toContain('.table-scroll.dividend-scroll { scrollbar-gutter: stable; }')
  })

  it('glides only where the browser can interpolate to auto and the reader allows motion', () => {
    const gate = CSS.indexOf(
      '@supports (interpolate-size: allow-keywords) { @media (prefers-reduced-motion: no-preference) {',
    )
    expect(gate).toBeGreaterThan(-1)
    expect(CSS.slice(0, gate)).not.toMatch(/is-entering|is-leaving|@starting-style/)
  })
})
