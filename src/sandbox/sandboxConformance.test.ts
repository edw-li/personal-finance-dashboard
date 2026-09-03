import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The no-write conformance walk (2026-09-03 planning-sandboxes spec §14): every module under
// src/sandbox/ and the three sandbox panels are read as TEXT and must neither bind a WRITING
// name out of the api layer nor spell a mutating `method:`. The Apply handlers live in the
// pages, which this walk deliberately excludes.
const ROOT = path.resolve(__dirname, '..')
const PANELS = [
  'components/paycheck/TryItPanel.tsx',
  'components/taxes/WhatIfPanel.tsx',
  'components/projection/ScenarioPanel.tsx',
]

function sandboxSources(): string[] {
  const dir = path.join(ROOT, 'sandbox')
  return readdirSync(dir)
    .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => path.join(dir, name))
}

// Every `import … from '<…>api/<…>'` in EITHER quote style — the earlier single-quote-only
// pattern let `from "../api/client"` walk straight past, and naming `api/client` alone let a
// mutator imported from `api/budgets` through. The clause forbids quotes, so a match cannot
// begin at one import and borrow a later statement's module specifier: the first quoted
// string after the keyword is always the one under test.
const API_IMPORT = /\bimport\s+(type\s+)?([^'"]*?)\s*from\s*['"]([^'"]*\bapi\/[^'"]*)['"]/g
// A reading name reads: the api layer's `fetchX`/`runX`/`previewX`/`getX` verbs, plus the
// error type and the read-only client itself. Bare `api` — the WRITING client — is not on the
// list, and neither is `saveBudget`, `deleteMonth` or any other imperative the panels could
// reach for. A text walk is a fence, not a type checker: it judges the LOCAL name, so it
// trusts the api layer to keep naming its readers honestly.
const READ_ONLY_NAME = /^(fetch|run|preview|get)[A-Z]|^(ApiError|apiReadOnly)$/
// Both quote styles here too, for the same reason.
const MUTATION = /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i

/** The local names a file's api imports bind. Type-only bindings are skipped — they are
 *  erased at compile and cannot call anything, so holding them to the verb list would only
 *  outlaw a panel importing its own response shape. */
function apiBindings(text: string): string[] {
  const names: string[] = []
  for (const match of text.matchAll(API_IMPORT)) {
    const [, typeOnly, clause] = match
    if (typeOnly) continue
    for (const piece of clause.replace(/[{}]/g, ' ').split(',')) {
      const spec = piece.trim()
      if (spec === '' || /^type\b/.test(spec)) continue
      // `x as y` and `* as ns` both bind the name on the RIGHT.
      const as = / as /.exec(spec)
      names.push((as === null ? spec : spec.slice(as.index + 4)).trim())
    }
  }
  return names
}

const offenders = (text: string): string[] => apiBindings(text).filter((n) => !READ_ONLY_NAME.test(n))

describe('sandbox write-purity conformance', () => {
  const files = [...sandboxSources(), ...PANELS.map((p) => path.join(ROOT, p)).filter(existsSync)]

  it('walks at least the grammar modules', () => {
    expect(files.length).toBeGreaterThanOrEqual(8)
  })

  for (const file of files) {
    it(`${path.relative(ROOT, file)} binds only reading api names and spells no mutating method`, () => {
      const text = readFileSync(file, 'utf8')
      expect(offenders(text)).toEqual([])
      expect(MUTATION.test(text)).toBe(false)
    })
  }

  // A conformance walk whose pattern quietly stops matching passes forever while proving
  // nothing, so the matcher is held to synthetic sources of its own.
  describe('the matcher itself', () => {
    it('reads both quote styles and any api/* module', () => {
      expect(offenders(`import { api } from '../api/client'`)).toEqual(['api'])
      expect(offenders(`import { api } from "../api/client"`)).toEqual(['api'])
      expect(offenders(`import { saveBudget } from "../../api/budgets"`)).toEqual(['saveBudget'])
      expect(offenders(`import { ApiError, apiReadOnly } from '../api/client'`)).toEqual([])
      expect(offenders(`import { fetchLots, runWhatIf, previewPaycheck, getX } from '../api/espp'`)).toEqual([])
    })

    it('judges the bound name, through aliases and namespaces', () => {
      expect(offenders(`import { api as client } from '../api/client'`)).toEqual(['client'])
      expect(offenders(`import * as everything from '../api/client'`)).toEqual(['everything'])
      expect(offenders(`import client from '../api/client'`)).toEqual(['client'])
    })

    it('ignores type-only bindings but not the values beside them', () => {
      expect(apiBindings(`import type { LotRow } from '../api/espp'`)).toEqual([])
      expect(apiBindings(`import { type LotRow, fetchLots } from '../api/espp'`)).toEqual(['fetchLots'])
    })

    it('does not borrow a neighbouring statement’s module specifier', () => {
      // The clause forbids quotes, so `'react'` cannot be skipped over to reach `api/client`.
      const text = `import { useCallback } from 'react'\nimport { ApiError } from '../api/client'\n`
      expect(apiBindings(text)).toEqual(['ApiError'])
      expect(apiBindings(`import { useMemo } from 'react'\n`)).toEqual([])
    })

    it('catches a mutating method in either quote style', () => {
      expect(MUTATION.test(`{ method: 'POST' }`)).toBe(true)
      expect(MUTATION.test(`{ method: "DELETE" }`)).toBe(true)
      expect(MUTATION.test(`{ method: 'GET' }`)).toBe(false)
    })
  })
})
