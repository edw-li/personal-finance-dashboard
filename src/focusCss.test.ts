import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Keyboard focus you can see (2026-09-23 spec §B9). Links and the login fields fell back to the
// browser's `outline: auto` — a #101010 ring on the #171a21 dark card, 1.09:1, effectively
// invisible. jsdom computes no :focus-visible and no outline, so the rules can only be pinned
// here; the ring's colour contrast is pinned in theme/tokens.test.ts.

/** Comments first, over the WHOLE file (tokens.test.ts's rule): a `}` parked inside a
 *  multi-line comment would otherwise truncate a block. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every rule whose selector matches `pattern`, as its selector text and its body. */
function rules(css: string, pattern: RegExp): { selector: string; body: string }[] {
  return [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ selector: m[1].trim(), body: m[2] }))
    .filter((rule) => pattern.test(rule.selector))
}

const index = readFileSync(path.resolve(__dirname, 'index.css'), 'utf8')
const login = readFileSync(path.resolve(__dirname, 'pages/LoginPage.css'), 'utf8')

describe('the global focus ring (index.css)', () => {
  const ring = rules(index, /^:where\([^)]*\):focus-visible$/)

  it('is one zero-specificity rule, so every component that styles its own focus still wins', () => {
    expect(ring).toHaveLength(1)
  })

  it('covers links, form fields, disclosure summaries and anything made focusable', () => {
    const listed = (/^:where\(([^)]*)\)/.exec(ring[0].selector)?.[1] ?? '')
      .split(',')
      .map((part) => part.trim())
    for (const element of ['a', 'input', 'select', 'textarea', 'summary', '[tabindex]']) {
      expect(listed, element).toContain(element)
    }
  })

  it('draws the accent at 2px, just outside the element', () => {
    expect(ring[0].body).toMatch(/outline:\s*2px solid var\(--accent\);/)
    expect(ring[0].body).toMatch(/outline-offset:\s*2px;/)
  })

  it('rides :focus-visible only — a mouse click on a link paints no ring', () => {
    expect(rules(index, /:where\([^)]*\):focus(?!-visible)/)).toEqual([])
  })
})

describe('the login fields (LoginPage.css)', () => {
  it('have their own focus-visible treatment: the accent ring and an accent border', () => {
    const field = rules(login, /^\.login-card input:focus-visible$/)
    expect(field).toHaveLength(1)
    expect(field[0].body).toMatch(/outline:\s*2px solid var\(--accent\);/)
    expect(field[0].body).toMatch(/border-color:\s*var\(--accent\);/)
  })
})
