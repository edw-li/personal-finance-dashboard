import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The 2026-09-23 code review (10): utils/ is the bottom layer — plain math and formatting over
// the wire types. It never reaches up into the chart grammar, a component or a page: a helper
// that needs a chart colour lives beside the chart that draws it (the drill-in pie's slices,
// components/spending/monthSlices.ts). Reads files as TEXT, a fence rather than a type checker,
// so its matcher is held to synthetic sources below (mounts.audit.test.ts's rule: a walk whose
// pattern quietly stops matching passes forever while proving nothing).

const UPWARD = /from\s+['"]\.\.\/(charts|components|pages)\//

const reachesUp = (text: string) => UPWARD.test(text)

describe('utils/ layering', () => {
  it('no util imports the chart grammar, a component or a page', () => {
    const offenders = readdirSync(__dirname)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .filter((file) => reachesUp(readFileSync(path.join(__dirname, file), 'utf8')))
    expect(offenders).toEqual([])
  })

  it('the matcher sees an upward import, type-only or re-exported, and nothing else', () => {
    expect(reachesUp(`import { ENTITY, foldColor } from '../charts/entities'`)).toBe(true)
    expect(reachesUp(`import type { CategoryFold } from "../charts/entities"`)).toBe(true)
    expect(reachesUp(`export { thing } from '../components/spending/monthSlices'`)).toBe(true)
    expect(reachesUp(`import SpendingPage from '../pages/SpendingPage'`)).toBe(true)
    expect(reachesUp(`import { addMonths } from './months'`)).toBe(false)
    expect(reachesUp(`import type { SpendingMatrix } from '../types/api'`)).toBe(false)
    expect(reachesUp(`import { getSnapshot } from '../api/snapshotCache'`)).toBe(false)
  })
})
