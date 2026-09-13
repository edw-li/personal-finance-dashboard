import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Lane F1's three stylesheets, pinned as TEXT (settingsCss.test.ts's idiom): jsdom applies no
// stylesheet, so `getComputedStyle` on a rendered panel reports the UA defaults and can say nothing
// about a grid track or a transition. These are the rules the 2026-09-13 review round turned on, and
// the ones a future edit would silently undo.

/** Comments first, over the WHOLE file (tokens.test.ts's rule): a `}` parked inside a
 *  multi-line comment would otherwise truncate a block. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every declaration of `selector`, concatenated — a rule split across two blocks (or
 *  repeated under a media query) still answers as one. */
function declarationsFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blocks = [...stripComments(css).matchAll(new RegExp(`(^|[,{}])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
  if (blocks.length === 0) throw new Error(`no ${selector} block`)
  return blocks.map((m) => m[2]).join(' ')
}

const read = (file: string) => readFileSync(path.resolve(__dirname, file), 'utf8')
const details = read('details.css')
const chartInteractions = read('../chartInteractions.css')
const assistant = read('../assistant/assistant.css')

describe("details.css — the panel header row survives the assistant's controls", () => {
  // The controls track carries the mode Segmented (~87px) + the model select (up to 220px) +
  // New chat (~70px) + Close (28px) + gaps and padding (~32px) ≈ 437px. As a bare `auto` track it
  // refuses to shrink, so at the 400–416px default dock width the title column collapsed to ~0 and
  // "Assistant" ran underneath the controls. A floor on the title track plus a shrinkable controls
  // track hands the overflow to the select's own `flex: 1 1 auto; min-width: 0; text-overflow`.
  it('gives the title track a floor and lets the controls track shrink', () => {
    expect(declarationsFor(details, '.detail-panel'))
      .toContain('grid-template-columns: auto minmax(min(40%, 12rem), 1fr) minmax(0, auto);')
    expect(declarationsFor(details, '.detail-panel-controls')).toContain('min-width: 0;')
  })
})

describe('chartInteractions.css — the Expand dialog closes instantly', () => {
  // Spec §2.3 allows an instant close, and the discrete-transition exit was three bugs in one:
  // ChartSurface moves the chart host back to its placeholder synchronously, so the fade played on
  // an empty box; ::backdrop had no exit and snapped underneath it; and @starting-style ran a
  // --t-fast opacity/transform transition against the --t-page `surface-in` animation on the very
  // same properties, which flickered on every open. Entrances stay; the exit is gone.
  it('keeps the entrances and carries no allow-discrete exit or @starting-style', () => {
    expect(declarationsFor(chartInteractions, '.chart-expanded-dialog[open]'))
      .toContain('animation: surface-in var(--t-page) var(--ease-out) both;')
    expect(declarationsFor(chartInteractions, '.chart-expanded-dialog[open]::backdrop'))
      .toContain('animation: chart-backdrop-in var(--t-fast) ease both;')
    // Comment-stripped: the block's own comment names what was removed and why.
    expect(stripComments(chartInteractions)).not.toContain('allow-discrete')
    expect(stripComments(chartInteractions)).not.toContain('@starting-style')
  })
})

describe('assistant.css — the launcher stops animating while the dock is dragged', () => {
  // `.is-dragging` already kills the panel's and the content's transitions so the width follows the
  // hand; the launcher rides `--dock-width` through the same drag and would otherwise lag --t-page
  // behind it. It is a descendant of `.detail-layout-content`, which carries the class.
  it('drops the launcher transition under .is-dragging', () => {
    expect(declarationsFor(assistant, '.is-dragging .assistant-launcher')).toContain('transition: none;')
  })
})
