import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The no-write conformance walk (2026-09-03 planning-sandboxes spec §14): every module under
// src/sandbox/ and the three sandbox panels are read as TEXT and must neither import `api`
// from the client (only `apiReadOnly` may carry a preview) nor spell a mutating `method:`.
// The Apply handlers live in the pages, which this walk deliberately excludes.
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

const API_IMPORT = /import\s*\{[^}]*\bapi\b[^}]*\}\s*from\s*'(?:\.\.\/)+api\/client'/
const MUTATION = /method:\s*'(?:POST|PUT|PATCH|DELETE)'/i

describe('sandbox write-purity conformance', () => {
  const files = [...sandboxSources(), ...PANELS.map((p) => path.join(ROOT, p)).filter(existsSync)]

  it('walks at least the grammar modules', () => {
    expect(files.length).toBeGreaterThanOrEqual(8)
  })

  for (const file of files) {
    it(`${path.relative(ROOT, file)} imports no api() and spells no mutating method`, () => {
      const text = readFileSync(file, 'utf8')
      expect(API_IMPORT.test(text)).toBe(false)
      expect(MUTATION.test(text)).toBe(false)
    })
  }
})
