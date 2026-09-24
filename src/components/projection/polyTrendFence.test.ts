import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// 2026-09-23 correctness spec §R8: the Historical trend keeps its fitted curve, and NOTHING else
// reads it — no tile, receipt, compare row, FI date, money-lasts figure or assistant context.
// The fence: among the app's own sources only the trend panel and its chart builder import the
// fit (polyTrend.ts). A second importer is how an exploratory curve becomes a planning number.
const SRC = path.resolve(__dirname, '../..')
const ALLOWED = new Set([
  path.join('components', 'projection', 'ProjectionTrendPanel.tsx'),
  path.join('components', 'projection', 'projectionChartOptions.ts'),
])

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sources(full)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

const IMPORTS_POLYTREND = /\bfrom\s+['"][^'"]*\/polyTrend['"]/

describe('the fitted trend is read by the trend chart alone', () => {
  it('only ProjectionTrendPanel.tsx and projectionChartOptions.ts import polyTrend', () => {
    const importers = sources(SRC)
      .filter((file) => IMPORTS_POLYTREND.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file))
    expect(importers.sort()).toEqual([...ALLOWED].sort())
  })

  it('the matcher sees both quote styles and a type-only import', () => {
    expect(IMPORTS_POLYTREND.test(`import { fitPolyTrend } from './polyTrend'`)).toBe(true)
    expect(IMPORTS_POLYTREND.test(`import type { PolyTrendFit } from "../projection/polyTrend"`)).toBe(true)
    expect(IMPORTS_POLYTREND.test(`import { x } from './polyTrendless'`)).toBe(false)
  })
})
