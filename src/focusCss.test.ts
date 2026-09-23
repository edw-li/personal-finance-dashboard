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

describe('the ring inside a clipping scroll container (index.css)', () => {
  // Measured by a keyboard walk on finance_realdata, both themes (code review of §B9,
  // recommendation 2): a ring drawn OUTSIDE a control is cut wherever the control sits flush with
  // a scroll container's edge — the attention strip's rows at both sides, the Settings and card
  // category tables' buttons at the bottom edge a Tab scrolls them to. Inside those containers the
  // ring is drawn inset, as the Guide rail's rows already draw theirs.
  const inset = rules(index, /^:is\([^)]*\) :is\([^)]*\):focus-visible$/)

  it('names every container the walk found cutting the ring', () => {
    expect(inset).toHaveLength(1)
    for (const container of ['.attention-strip', '.settings-scroll', '.categories-scroll']) {
      expect(inset[0].selector, container).toContain(container)
    }
  })

  it('draws it 2px inside the control, where no container edge reaches it', () => {
    expect(inset[0].body).toMatch(/outline-offset:\s*-2px;/)
  })

  // The rings it has to move are the components' own, and some load AFTER index.css — the first
  // walk after the fix still found the Settings tables' Edit buttons cut, under portfolio.css's
  // bare `.row-actions button:focus-visible`. Only weight wins against a later sheet.
  it('outranks the component rings inside those containers, whatever order the sheets load in', () => {
    const ours = specificity(inset[0].selector)
    for (const theirs of [
      '.button:focus-visible',
      '.row-actions button:focus-visible',
      '.attention-item:focus-visible',
      '.drag-handle:focus-visible',
    ]) {
      expect(compareSpecificity(ours, specificity(theirs)), theirs).toBeGreaterThan(0)
    }
  })
})

type Specificity = [ids: number, classes: number, types: number]

function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/** Selectors Level 4 specificity for the plain selectors these rules use: `:is()`/`:not()`
 *  count their most specific argument, `:where()` counts nothing. */
function specificity(selector: string): Specificity {
  const total: Specificity = [0, 0, 0]
  const rest = selector.replace(/:(is|where|not)\(([^()]*)\)/g, (_, fn: string, args: string) => {
    if (fn !== 'where') {
      const best = args
        .split(',')
        .map((arg) => specificity(arg.trim()))
        .reduce((a, b) => (compareSpecificity(a, b) >= 0 ? a : b))
      total.forEach((_value, i) => (total[i] += best[i]))
    }
    return ' '
  })
  total[0] += (rest.match(/#[\w-]+/g) ?? []).length
  total[1] += (rest.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length
  total[2] += (rest.match(/(?:^|[\s>+~])[a-z][\w-]*/gi) ?? []).length
  return total
}

describe('the login fields (LoginPage.css)', () => {
  it('have their own focus-visible treatment: the accent ring and an accent border', () => {
    const field = rules(login, /^\.login-card input:focus-visible$/)
    expect(field).toHaveLength(1)
    expect(field[0].body).toMatch(/outline:\s*2px solid var\(--accent\);/)
    expect(field[0].body).toMatch(/border-color:\s*var\(--accent\);/)
  })
})
