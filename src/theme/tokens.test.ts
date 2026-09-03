import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DARK,
  LIGHT,
  contrastRatio,
  cssDeclarations,
  luminance,
  type ThemeTokens,
} from './tokens'

/** Comments go first, over the WHOLE file: a `}` or a stray `--token: …;` parked inside a
 *  multi-line comment would otherwise truncate a block or forge a declaration. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function block(css: string, selector: string): string {
  const start = css.indexOf(selector)
  if (start === -1) throw new Error(`no ${selector} block in index.css`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

/** A block's custom properties as the cascade sees them: last declaration of a name wins,
 *  so a duplicate that overrides a token cannot hide behind the earlier, correct copy. */
function declarations(blockText: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const [, name, value] of blockText.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(name, value.trim())
  }
  return map
}

function expectCarries(declared: Map<string, string>, t: ThemeTokens, where: string): void {
  for (const decl of cssDeclarations(t)) {
    const parsed = /^(--[\w-]+):\s*(.+);$/.exec(decl)
    if (parsed === null) throw new Error(`cssDeclarations emitted an unparsable line: ${decl}`)
    const [, name, value] = parsed
    expect(declared.get(name), `${where} ${name}`).toBe(value)
  }
}

describe('tokens', () => {
  const surfaces: [string, ThemeTokens][] = [
    ['dark', DARK],
    ['light', LIGHT],
  ]

  // BOTH text-bearing backgrounds: cards are the common case, but deltas, links and
  // advisories also sit on the bare page, and --bg is the weaker of the two in LIGHT.
  it.each(surfaces)('%s: text tones read at 4.5:1 on the page and on a card', (_name, t) => {
    for (const tone of [t.text, t.muted, t.positive, t.negative, t.warn, t.accent]) {
      expect(contrastRatio(tone, t.bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(tone, t.surface)).toBeGreaterThanOrEqual(4.5)
    }
    // One amber per theme: the advisory register and chart slot 4 are the same ink.
    expect(t.warn).toBe(t.palette[3])
    // Ink painted ON the accent (primary buttons, skip link) is held to the same floor.
    expect(contrastRatio(t.onAccent, t.accent)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(surfaces)('%s: every chart slot and the Other gray read at 3:1', (_name, t) => {
    for (const slot of [...t.palette, t.otherSeries]) {
      expect(contrastRatio(slot, t.bg)).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(slot, t.surface)).toBeGreaterThanOrEqual(3)
    }
  })

  // §12 diverging: index 4 is the neutral midpoint. Read OUTWARD from it, each arm's
  // luminance moves monotonically — brighter on the dark surface (the midpoint recedes
  // into the card), darker on the light one — and the two outer steps of each arm carry
  // the 3:1 floor on both text-bearing backgrounds, because those are the steps that
  // encode "far above / far below average" and must be legible as marks.
  it.each(surfaces)('%s: the diverging ramp is monotone per arm and reads 3:1 at its outer steps', (_name, t) => {
    const d = t.diverging
    expect(d).toHaveLength(9)
    const lum = d.map(luminance)
    const outward = Math.sign(lum[5] - lum[4])
    expect(outward).not.toBe(0)
    for (let i = 4; i > 0; i -= 1) expect(Math.sign(lum[i - 1] - lum[i]), `orange step ${i}`).toBe(outward)
    for (let i = 4; i < 8; i += 1) expect(Math.sign(lum[i + 1] - lum[i]), `blue step ${i}`).toBe(outward)
    for (const hex of [d[0], d[1], d[7], d[8]]) {
      expect(contrastRatio(hex, t.surface), `${hex} on surface`).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(hex, t.bg), `${hex} on bg`).toBeGreaterThanOrEqual(3)
    }
  })

  // recolor.ts elects a winner wherever two token names share one hex; the diverging
  // steps must never enter that election, so no step may equal any other token — and no
  // step may repeat (a repeat would collapse two ramp positions onto one map key).
  it.each(surfaces)('%s: no diverging step equals another token hex or another step', (_name, t) => {
    const others = new Set(
      [
        t.bg, t.surface, t.surface2, t.border, t.text, t.muted, t.accent, t.onAccent,
        t.positive, t.negative, t.warn, t.gridLine, t.axisLine, t.otherSeries,
        ...t.palette, ...t.sequential,
      ].map((h) => h.toLowerCase()),
    )
    for (const hex of t.diverging) expect(others.has(hex.toLowerCase()), hex).toBe(false)
    expect(new Set(t.diverging.map((h) => h.toLowerCase())).size).toBe(9)
  })

  it('index.css declares every token of both palettes with the same value', () => {
    const css = stripComments(readFileSync(path.resolve(__dirname, '../index.css'), 'utf8'))
    expectCarries(declarations(block(css, ':root')), DARK, ':root')
    expectCarries(declarations(block(css, '[data-theme="light"]')), LIGHT, '[data-theme="light"]')
  })

  it('contrastRatio is symmetric and the gamma curve is the WCAG one', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    // White-on-black is 21 under any monotonic curve; these two are not — mid gray's
    // luminance and the canonical "smallest gray that passes 4.5:1 on white" pin the
    // sRGB linearization itself.
    expect(luminance('#808080')).toBeCloseTo(0.2159, 3)
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
  })

  it('rejects color strings it cannot parse instead of scoring them NaN', () => {
    expect(() => luminance('#abc')).toThrow(/#rrggbb/)
    expect(() => luminance('rebeccapurple')).toThrow(/#rrggbb/)
  })
})
