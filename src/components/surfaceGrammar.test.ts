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

describe('surfaces appear (2026-09-13 polish §2.1)', () => {
  const gate = PANELS.indexOf('@media (prefers-reduced-motion: no-preference) { .button, .chip')

  it('declares the three shared keyframes inside the motion-grammar block', () => {
    expect(gate).toBeGreaterThan(-1)
    for (const frames of [
      '@keyframes pop-in { from { opacity: 0; translate: 0 -4px; } }',
      '@keyframes panel-in { from { opacity: 0; translate: 0 6px; } }',
      '@keyframes backdrop-in { from { opacity: 0; } }',
    ]) {
      const at = PANELS.indexOf(frames)
      expect(at, frames).toBeGreaterThan(gate)
      // Same block: no other @media opens between the gate and the keyframe.
      expect(PANELS.slice(gate + 1, at)).not.toContain('@media')
    }
  })

  it('pops every bubble, popover, pin strip and disclosure body in over --t-fast', () => {
    expect(PANELS).toContain(
      '.info-hint-bubble, .chart-export-popover, .chart-selection-summary, .popover-surface, .disclosure[open] > .disclosure-body { animation: pop-in var(--t-fast) var(--ease-out) both; }',
    )
  })

  it('gives the new controls the house hover transition', () => {
    expect(PANELS).toContain(
      '.button, .chip, .row-toggle, .info-hint, .segmented button, .metric-info-button, .local-section-nav [role=tab], .assistant-icon-button, .detail-panel-resizer, .disclosure > summary { transition: background-color var(--t-fast) ease, border-color var(--t-fast) ease, color var(--t-fast) ease, filter var(--t-fast) ease; }',
    )
  })
})

describe('KPI grammar (2026-09-13 polish §12)', () => {
  it('makes .page the query container and balances the rows', () => {
    expect(PANELS).toMatch(/\.page \{[^}]*container-type: inline-size;/)
    expect(PANELS).toContain('.kpi-row > :last-child { grid-column-end: -1; }')
    expect(PANELS).toContain('.kpi-row-5 { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }')
    expect(PANELS).toContain('.kpi-row-dense { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }')
    expect(PANELS).toContain('@container (min-width: 1000px) { .kpi-row-5 { grid-template-columns: repeat(5, minmax(0, 1fr)); } }')
    expect(PANELS).toContain('@container (max-width: 980px) { .kpi-row:not(.kpi-row-5) { grid-template-columns: repeat(2, minmax(0, 1fr)); } }')
  })
})

describe('sticky row actions (2026-09-13 polish §7)', () => {
  it('pins the actions column of a table that opted in, and the identity column on the left', () => {
    expect(PANELS).toContain(
      '.data-table:has(td.row-actions) th:last-child, .data-table td.row-actions, .port-table:has(td.row-actions) th:last-child, .port-table td.row-actions { position: sticky; right: 0; background: var(--surface); box-shadow: -1px 0 0 var(--border); }',
    )
    expect(PANELS).toContain(
      '.data-table th.col-identity, .data-table td.col-identity, .port-table th.col-identity, .port-table td.col-identity { position: sticky; left: 0; z-index: 1; background: var(--surface); box-shadow: 1px 0 0 var(--border); }',
    )
  })
  it('masks whichever edge still hides content', () => {
    expect(PANELS).toContain('[data-scroll-more~="right"] { mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent); }')
    expect(PANELS).toContain('[data-scroll-more~="left"] { mask-image: linear-gradient(to left, #000 calc(100% - 28px), transparent); }')
    expect(PANELS).toContain('[data-scroll-more~="left"][data-scroll-more~="right"] { mask-image: linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px), transparent); }')
  })
})

describe('popover surface (2026-09-13 polish §11)', () => {
  it('is the one anchored popover box, shadowed from --shadow', () => {
    expect(PANELS).toContain(
      '.popover-surface { position: absolute; z-index: 20; padding: 0.9rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 12px 36px rgb(var(--shadow)); }',
    )
  })
})

describe('sticky sections block (2026-09-13 polish §3)', () => {
  it('stacks the strip over the scope row and gives the strip the row’s old rule', () => {
    expect(SHELL).toMatch(/\.page-frame-scope \{[^}]*flex-direction: column;/)
    expect(SHELL).toContain('.page-frame-sections { border-bottom: 1px solid var(--border); }')
    expect(SHELL).toContain('.page-frame-sections .local-section-nav { margin: 0; border-bottom: 0; }')
    expect(SHELL).toContain(
      '.page-frame-scope-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem 1.25rem; padding: 0.6rem 0; }',
    )
    // A strip-only block would otherwise draw two hairlines 1px apart once stuck.
    expect(SHELL).toContain('.page-frame-scope.is-stuck:has(> .page-frame-sections:last-child) { border-bottom-color: transparent; }')
  })
})

describe('tab strip indicator (2026-09-13 polish §2.4)', () => {
  it('draws one accent bar that transitions only once placed, over token durations', () => {
    expect(SECTIONS).toContain('.local-section-indicator { position: absolute; left: 0; bottom: -1px; width: 0; height: 2px; background: var(--accent); border-radius: 2px 2px 0 0; pointer-events: none; }')
    expect(SECTIONS).toContain('.local-section-indicator[data-placed] { transition: transform var(--t-nav) var(--ease-out), width var(--t-nav) var(--ease-out); }')
    expect(SECTIONS).toContain('.local-section-nav [role=tab][aria-selected=true] { color: var(--text); }')
    expect(SECTIONS).toContain('.local-section-nav [role=tablist] { position: relative;')
  })
})
