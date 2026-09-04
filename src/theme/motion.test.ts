import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { BUSY_DIM, REVEAL, cssMotionDeclarations, reducedMotionDeclarations } from './motion'

const srcDir = path.join(__dirname, '..')

/** Comments first, over the WHOLE file: a `}` parked inside one would truncate a block. */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const indexCss = stripComments(readFileSync(path.join(srcDir, 'index.css'), 'utf8'))

/** Declarations of the first block opened after `opener` — tokens.test.ts's idiom. */
function block(opener: string): string {
  const start = indexCss.indexOf(opener)
  if (start === -1) throw new Error(`no ${opener} in index.css`)
  const open = indexCss.indexOf('{', start)
  return indexCss.slice(open + 1, indexCss.indexOf('}', open))
}

it(':root carries every declaration motion.ts declares', () => {
  for (const d of cssMotionDeclarations()) expect(block(':root')).toContain(d)
})

// block() walks to the media query's `{` and the first `}`, which closes the nested :root.
it('reduce zeroes every duration and flattens the reveal', () => {
  const reduce = block('@media (prefers-reduced-motion: reduce)')
  for (const d of reducedMotionDeclarations()) expect(reduce).toContain(d)
})

// Two greys mean two different things, so they must never be mistaken for each other: a card
// resting below the fold is a PLACE ("more down there"), a dimmed body is a STATE ("fetching").
// The user read 0.62 against 0.55 as the same grey; the gap is now a fifth of the scale, and
// the scroll shadow is the darker of the two — the state the reader can do nothing about is
// never the loudest one on screen. The reduce block leaves --busy-dim alone on purpose: a
// status colour is not motion.
it('keeps the scroll shadow clearly darker than the busy dim', () => {
  expect(Number(REVEAL.floor)).toBeLessThan(Number(BUSY_DIM))
  expect(Number(BUSY_DIM) - Number(REVEAL.floor)).toBeGreaterThanOrEqual(0.2)
  expect(block('@media (prefers-reduced-motion: reduce)')).not.toContain('--busy-dim')
})

/** Every stylesheet under src/, walked by hand — node 18.12 has no recursive readdirSync. */
function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return stylesheets(full)
    return full.endsWith('.css') ? [full] : []
  })
}

// A duration slot is either a --t-* token or a literal time; whichever comes FIRST in a
// layer is the duration, and anything after it is a delay (`… var(--t-page) ease 300ms`).
const SLOT = /var\(--t-[\w-]*\)|\d*\.?\d+m?s(?![\w-])/g

// The sweep that makes the token scale stick: a hard-coded `160ms` can never come back,
// because there is nowhere to put it. `infinite` is exempt on purpose — a spinner's period
// is a RATE, and a token the reduce block zeroes would freeze it mid-turn (spec §1).
it('no stylesheet states a finite duration as a literal', () => {
  const offenders: string[] = []
  for (const file of stylesheets(srcDir)) {
    const css = stripComments(readFileSync(file, 'utf8'))
    for (const [, prop, value] of css.matchAll(/(animation|transition)(?:-duration)?\s*:\s*([^;{}]+);/g)) {
      for (const layer of value.split(',')) {
        if (/\binfinite\b/.test(layer)) continue
        const first = layer.match(SLOT)?.[0]
        if (first !== undefined && !first.startsWith('var(')) {
          offenders.push(`${path.relative(srcDir, file)} — ${prop}: ${layer.trim()}`)
        }
      }
    }
  }
  expect(offenders).toEqual([])
})
