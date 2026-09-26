import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** Comments first, over the WHOLE file (reorderCss.test.ts's rule). */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every declaration of `selector`, concatenated across blocks, whitespace collapsed; the selector may
 *  stand anywhere in a selector list (reorderCss.test.ts's helper). */
function declarationsFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blocks = [
    ...stripComments(css).matchAll(
      new RegExp(`(^|[,{}])\\s*${escaped}\\s*(?:,[^{}]*)?\\{([^}]*)(?=\\})`, 'g'),
    ),
  ]
  if (blocks.length === 0) throw new Error(`no ${selector} block`)
  return blocks.map((match) => match[2].replace(/\s+/g, ' ')).join(' ')
}

/** The text between `opener`'s own `{` and the `}` that closes it (motionCss.test.ts's helper). */
function inside(css: string, opener: string): string {
  const start = css.indexOf(opener)
  expect(start, opener).toBeGreaterThan(-1)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}' && (depth -= 1) === 0) return css.slice(open + 1, i)
  }
  throw new Error(`unclosed ${opener}`)
}

const flat = (css: string) => stripComments(css).replace(/\s+/g, ' ')
const declarationSet = (declarations: string) =>
  new Set(declarations.split(';').map((d) => d.trim()).filter((d) => d !== ''))
const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), 'utf8')

const feedback = read('feedback.css')
const panels = read('../panels.css')
const reorder = read('../reorder/reorder.css')

describe('feedback.css', () => {
  it("wears .button:disabled's look on an aria-disabled button — the quiet state that keeps focus", () => {
    expect(declarationSet(declarationsFor(feedback, ".button[aria-disabled='true']"))).toEqual(
      declarationSet(declarationsFor(panels, '.button:disabled')),
    )
    expect(declarationSet(declarationsFor(feedback, ".button-primary[aria-disabled='true']"))).toEqual(
      declarationSet(declarationsFor(panels, '.button-primary:disabled')),
    )
    // A disabled button never goes :active; a quiet one must not answer the press either.
    expect(declarationsFor(feedback, ".button[aria-disabled='true']:active")).toContain('transform: none;')
  })

  it('keeps a busy button its own face — working, not unavailable — winning the quiet rules by order', () => {
    const busy = declarationsFor(feedback, ".button[aria-busy='true']")
    expect(busy).toContain('opacity: 1;')
    expect(busy).toContain('cursor: progress;')
    expect(declarationsFor(feedback, ".button-primary[aria-busy='true']")).toContain('background: var(--accent);')
    const text = stripComments(feedback)
    expect(text.indexOf(".button[aria-busy='true']")).toBeGreaterThan(text.indexOf(".button[aria-disabled='true']"))
    expect(declarationsFor(feedback, ".busy-button[aria-busy='true']")).toContain('justify-content: center;')
    expect(declarationsFor(feedback, '.busy-button-label')).toContain('white-space: nowrap;')
  })

  it('quiets a BusyButton without the house .button class too — and keeps it busy-faced while busy', () => {
    expect(declarationSet(declarationsFor(feedback, ".busy-button:not(.button)[aria-disabled='true']"))).toEqual(
      declarationSet(declarationsFor(panels, '.button:disabled')),
    )
    const busy = declarationsFor(feedback, ".busy-button:not(.button)[aria-busy='true']")
    expect(busy).toContain('opacity: 1;')
    expect(busy).toContain('cursor: progress;')
    const text = stripComments(feedback)
    expect(text.indexOf(".busy-button:not(.button)[aria-busy='true']")).toBeGreaterThan(
      text.indexOf(".busy-button:not(.button)[aria-disabled='true']"),
    )
  })

  it('spins the spinner only where motion is welcome, at a rate rather than a token', () => {
    const css = flat(feedback)
    const motion = inside(css, '@media (prefers-reduced-motion: no-preference) {')
    expect(motion).toContain('.busy-spinner { animation: busy-spin 0.8s linear infinite; }')
    // The keyframes' NAME, not the class that shares its first letters.
    expect(css.slice(0, css.indexOf('@media (prefers-reduced-motion: no-preference)'))).not.toMatch(
      /busy-spin(?![\w-])/,
    )
  })

  it('fades a leaving row and takes it out of reach, on the fast token — whatever its own rules say', () => {
    const leaving = declarationsFor(feedback, '[data-leaving]')
    expect(leaving).toContain('opacity: 0 !important;')
    expect(leaving).toContain('pointer-events: none !important;')
    expect(leaving).toContain('transition: opacity var(--t-fast) var(--ease-out);')
  })

  it('folds a non-table row away where the browser can interpolate to auto — never a table row', () => {
    const supports = inside(flat(feedback), '@supports (interpolate-size: allow-keywords) {')
    const fold = declarationsFor(supports, ':not(tr)[data-leaving]')
    expect(fold).toContain('interpolate-size: allow-keywords;')
    // Important: a row's own box rules (a more specific padding, an inline style) must not leave a
    // sliver standing — measured in Edge, a 10px inline padding kept a folded row 21px tall.
    for (const declaration of ['block-size', 'min-block-size', 'padding-block', 'margin-block', 'border-block-width'])
      expect(fold).toContain(`${declaration}: 0 !important;`)
    expect(fold).toContain('block-size var(--t-fast) var(--ease-out)')
  })

  it("flashes a changed row with reorder's saved wash, over --t-flash", () => {
    const keyframes = (css: string, name: string) => inside(flat(css), `@keyframes ${name} {`).trim()
    expect(keyframes(feedback, 'flash-wash')).toBe(keyframes(reorder, 'reorder-saved'))
    expect(keyframes(feedback, 'flash-wash-pinned')).toBe(keyframes(reorder, 'reorder-saved-pinned'))
    const wash = 'animation: flash-wash var(--t-flash) var(--ease-out);'
    expect(declarationsFor(feedback, 'tr[data-flash] > td')).toContain(wash)
    expect(declarationsFor(feedback, ':not(tr)[data-flash]')).toContain(wash)
    for (const cell of ['row-actions', 'col-identity']) {
      expect(declarationsFor(feedback, `tr[data-flash] > td.${cell}`)).toContain(
        'animation: flash-wash-pinned var(--t-flash) var(--ease-out);',
      )
    }
  })

  it('holds THE danger button — negative ink, quiet while it cannot be pressed', () => {
    const danger = declarationsFor(feedback, ".danger-button:not(:disabled):not([aria-disabled='true'])")
    expect(danger).toContain('border-color: var(--negative);')
    expect(danger).toContain('color: var(--negative);')
  })

  it('stands the confirm popover fixed, over the detail panel and the palette, under the toasts', () => {
    const popover = declarationsFor(feedback, '.popover-surface.confirm-popover')
    expect(popover).toContain('position: fixed;')
    const z = (css: string, selector: string) =>
      Number(/z-index:\s*(\d+)/.exec(declarationsFor(css, selector))?.[1])
    const confirmZ = z(feedback, '.popover-surface.confirm-popover')
    expect(confirmZ).toBeGreaterThan(z(read('../details/details.css'), '.detail-panel-layer'))
    expect(confirmZ).toBeGreaterThan(z(read('../CommandPalette.css'), '.palette-overlay'))
    expect(confirmZ).toBeLessThan(z(read('../toast.css'), '.toast-region'))
  })

  it('colours the save status by its meaning', () => {
    expect(declarationsFor(feedback, '.save-status-dirty')).toContain('color: var(--muted);')
    expect(declarationsFor(feedback, '.save-status-saved')).toContain('color: var(--positive);')
    expect(declarationsFor(feedback, '.save-status-error')).toContain('color: var(--negative);')
  })
})
