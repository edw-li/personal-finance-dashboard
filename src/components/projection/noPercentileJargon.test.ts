import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// 2026-09-23 correctness spec §R6: "p10" meant the PESSIMISTIC balance on the fan and the
// OPTIMISTIC reach date on the same chart. The words now are "1 in 10 / half / 9 in 10 paths" for
// reach dates and "middle 80 % / 50 % of paths" for the fan — so no reader-facing string on the
// Projection page may say p10, p50 or p90. A grep-level fence over the page's own sources: once
// comments are gone, the tokens may appear only as DATA — a field (`bands.p10`, `fi_month_p10`),
// the one BAND_KEYS list, and the BAND_LABELS keys that map each to its words.
const HERE = __dirname
const FILES = [
  ...readdirSync(HERE)
    .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => path.join(HERE, name)),
  path.resolve(HERE, '../../pages/ProjectionPage.tsx'),
]

const JARGON = /\bp(?:10|50|90)\b/

/** Source minus comments and minus the allowed data spellings. */
function readerFacing(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '') // block and JSDoc comments
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '') // JSX comments (already caught above; kept explicit)
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1') // line comments, not a `://` inside a string
    .replace(/[._]p(?:10|25|50|75|90)\b/g, '') // fields: bands.p10, fi_month_p10
    .replace(/\[\s*'p10',\s*'p25',\s*'p50',\s*'p75',\s*'p90'\s*\]/g, '') // BAND_KEYS
    .replace(/^\s*p(?:10|25|50|75|90): '[^']*',?$/gm, '') // BAND_LABELS: key → words
}

describe('no user-visible p10, p50 or p90 on the Projection page', () => {
  it('walks the page and its components', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(7)
  })

  for (const file of FILES) {
    it(`${path.basename(file)} says it in words`, () => {
      const lines = readerFacing(readFileSync(file, 'utf8')).split('\n')
      const offenders = lines.map((line, i) => [i + 1, line.trim()] as const).filter(([, line]) => JARGON.test(line))
      expect(offenders).toEqual([])
    })
  }

  // A fence whose pattern quietly stops matching passes forever while proving nothing.
  it('catches a label, and lets data through', () => {
    expect(JARGON.test(readerFacing(`{ key: 'fi_month_p10', label: 'p10 date', kind: 'month' }`))).toBe(true)
    expect(JARGON.test(readerFacing('const marks = [[`p90`, data.fi_month_p90]]'))).toBe(true)
    expect(JARGON.test(readerFacing('<th>p50</th>'))).toBe(true)
    expect(JARGON.test(readerFacing('const low = bands.p10.map(Number) // the p10 edge'))).toBe(false)
    expect(JARGON.test(readerFacing("export const BAND_KEYS = ['p10', 'p25', 'p50', 'p75', 'p90'] as const"))).toBe(false)
    expect(JARGON.test(readerFacing("  p10: '10th percentile balance',"))).toBe(false)
  })
})
