import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DARK, LIGHT, contrastRatio, cssDeclarations, type ThemeTokens } from './tokens'

function block(css: string, selector: string): string {
  const start = css.indexOf(selector)
  if (start === -1) throw new Error(`no ${selector} block in index.css`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

/** Every `--name: value;` declaration in a block, whitespace-normalized. */
function declarations(blockText: string): Set<string> {
  return new Set(
    blockText
      .split('\n')
      .map((line) => line.replace(/\/\*.*?\*\//g, '').trim())
      .filter((line) => line.startsWith('--'))
      .map((line) => line.replace(/\s+/g, ' ')),
  )
}

describe('tokens', () => {
  const surfaces: [string, ThemeTokens][] = [
    ['dark', DARK],
    ['light', LIGHT],
  ]

  it.each(surfaces)('%s: text tones read at 4.5:1 on the surface', (_name, t) => {
    for (const tone of [t.text, t.muted, t.positive, t.negative, t.warn, t.accent]) {
      expect(contrastRatio(tone, t.surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(surfaces)('%s: every chart slot and the Other gray read at 3:1', (_name, t) => {
    for (const slot of [...t.palette, t.otherSeries]) {
      expect(contrastRatio(slot, t.surface)).toBeGreaterThanOrEqual(3)
    }
  })

  it('index.css carries byte-equal copies of both palettes (no drift)', () => {
    const css = readFileSync(path.resolve(__dirname, '../index.css'), 'utf8')
    const root = declarations(block(css, ':root'))
    for (const decl of cssDeclarations(DARK)) expect(root).toContain(decl)
    const light = declarations(block(css, '[data-theme="light"]'))
    for (const decl of cssDeclarations(LIGHT)) expect(light).toContain(decl)
  })

  it('contrastRatio is symmetric and white-on-black is 21', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
  })
})
