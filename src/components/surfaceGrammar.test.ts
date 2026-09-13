import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (skeletonMetrics.test.ts's idiom): a pin survives a
// re-indent and a comment moving, and fails only when a declaration actually changes.
const flat = (file: string) =>
  readFileSync(path.join(__dirname, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')

const PANELS = flat('panels.css')
const SHELL = flat('shell/shell.css')
const SECTIONS = flat('shell/localSections.css')
const CALENDAR = flat('../pages/CalendarPage.css')

describe('light tokens applied (2026-09-13 polish §6)', () => {
  it('points the pressed/hover/ghost surfaces at --fill', () => {
    expect(PANELS).toContain('.segmented button.active { background: var(--fill); color: var(--text); }')
    expect(SHELL).toContain('.segmented button.active { background: var(--fill); color: var(--text); }')
    expect(PANELS).toContain('.skeleton { background: var(--fill); border-radius: 6px; }')
    expect(PANELS).toMatch(/\.button \{[^}]*background: var\(--fill\);/)
    // chartInteractions.css (F1's sheet) is bundled AFTER panels.css and paints the pin strip
    // --surface-2 at one class of specificity; the two-class rule is what lets this sheet win.
    expect(PANELS).toContain('.chart-card .chart-selection-summary { background: var(--fill); }')
    expect(SECTIONS).toContain('.local-section-nav [role=tab]:hover { background: var(--fill); color: var(--text); }')
    // Bubbles and chips keep --surface-2: they carry a border, so the fill is not their edge.
    expect(PANELS).toMatch(/\.info-hint-bubble \{[^}]*background: var\(--surface-2\);/)
  })

  it('draws row hairlines in --border, never --surface-2', () => {
    expect(PANELS).toContain('.data-table td { padding: var(--density-cell-pad); border-bottom: 1px solid var(--border); }')
    expect(CALENDAR).toMatch(/\.cal-day \{[^}]*border: 1px solid var\(--border\);/)
    expect(CALENDAR).toMatch(/\.cal-gutter \{[^}]*border: 1px dashed var\(--border\);/)
    // No border of any width or style anywhere in the calendar sheet reads the invisible token.
    expect(CALENDAR).not.toMatch(/border(?:-bottom|-left|-top)?: \d+px (?:solid|dashed) var\(--surface-2\)/)
  })

  it('demotes a disabled primary to one step under the quiet button', () => {
    expect(PANELS).toContain(
      '.button-primary:disabled, .button-primary:disabled:hover { background: var(--surface-2); border-color: var(--border); color: var(--muted); opacity: 1; filter: none; }',
    )
  })
})
