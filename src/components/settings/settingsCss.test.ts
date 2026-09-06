import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

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

const settings = readFileSync(path.resolve(__dirname, 'settings.css'), 'utf8')

describe('settings.css', () => {
  // The rail rides PageFrame's sticky scope row, which paints over the top of the scrollport.
  // The bands carry scroll-margin-top so a chip lands its section below the row — and every
  // anchored CARD needs the same, or /settings#backups, #restore (the ?restore= hand-off) and
  // #limits all land UNDER the rail instead of below it. jsdom computes no layout, so this is
  // the only place the rule can be pinned.
  it('insets every anchored settings card by the sticky row, exactly like the bands', () => {
    const inset = 'scroll-margin-top: calc(var(--sticky-inset, 0px) + 0.75rem);'
    expect(declarationsFor(settings, '.settings-page .card')).toContain(inset)
    expect(declarationsFor(settings, '.card-grid > .settings-section')).toContain(inset)
  })

  // The once-shown feed URL is a credential the reader has to get out of the page in one
  // piece; the form sheet's 320px field cap would clip it to a third of its length.
  it('exempts the once-shown feed URL from the field cap', () => {
    expect(declarationsFor(settings, '.feed-fresh label')).toContain('max-width: none;')
  })
})
