import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// One "today" (2026-09-23 spec §K1), enforced over the source tree rather than by review: a rule
// that asks "has the 1st arrived / has the month ended / which year is it" reads the SERVER's day
// through utils/months.ts (todayIso, currentMonthIso, currentYear), never the browser's clock. So
// no non-test source reads the browser's now — `new Date()`, `new Date`, `new Date(Date.now())`
// — or grows a private `todayIso`, outside the two files that own the day. The deliberate
// exceptions utils/productToday.ts documents, and the reads other lanes still have to fix, are
// COUNTED, not exempted: a new read in one of those files cannot hide behind the old ones
// (review minor 5). Matching walks the TypeScript AST, so comments and strings never count; the
// matcher is held to synthetic sources at the bottom — a fence whose pattern quietly stopped
// matching would pass forever while proving nothing (mounts.audit.test.ts's rule).
//
// Adding a browser-clock read that is NOT a product rule (an instant, a TTL)? `Date.now()` is not
// fenced; a `new Date()` needs a counted entry in EXCEPTIONS with its reason in productToday.ts.

const SRC = path.resolve(__dirname, '..')

/** The two files that own the day: they may read the browser's clock. */
const OWNERS = ['utils/months.ts', 'utils/productToday.ts']
/** Browser-clock reads that are not a product rule (utils/productToday.ts says why), counted. */
const EXCEPTIONS: Record<string, number> = {
  'utils/staleness.ts': 2, // quote staleness and backup age: UTC by design
  'components/details/explainSelection.ts': 1, // capturedAt, an instant
  'sandbox/pins.ts': 1, // createdAt, an instant
}
/** Reads another lane fixes (spec §K1), counted. The lane that fixes a read lowers its count —
 *  or deletes the entry — in the same change; the exact-count test fails until it does. */
const ALLOWLIST: Record<string, number> = {
  'pages/TaxesPage.tsx': 3, // W11 — the Will I owe? mount and the new-year default
  'pages/OverviewPage.tsx': 1, // W11 — the tax year read
  'pages/MonthlyUpdatePage.tsx': 2, // M1 — the wizard's private todayIso and its new Date()
}
/** The allowlist when lane K landed (2026-09-24). It may only shrink: no file joins it and no
 *  count rises. It is empty once W and M have landed (that assertion arrives with M). */
const ALLOWLIST_AT_LANDING: Record<string, number> = {
  'pages/TaxesPage.tsx': 3,
  'pages/OverviewPage.tsx': 1,
  'pages/MonthlyUpdatePage.tsx': 2,
}

type ClockRead = 'new Date()' | 'new Date' | 'new Date(Date.now())' | 'a private todayIso'

const isDate = (node: ts.Node) => ts.isIdentifier(node) && node.text === 'Date'
const isDateNow = (node: ts.Node) =>
  ts.isCallExpression(node) &&
  node.arguments.length === 0 &&
  ts.isPropertyAccessExpression(node.expression) &&
  isDate(node.expression.expression) &&
  node.expression.name.text === 'now'
/** `const todayIso = useProductToday()` is how a component holds the product day — allowed. */
const isProductTodayHook = (node: ts.Node | undefined) =>
  node !== undefined &&
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'useProductToday'

/** Every browser-clock read in `text`, from its AST: comments and strings never count. */
function clockReads(fileName: string, text: string): ClockRead[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, kind)
  const reads: ClockRead[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && isDate(node.expression)) {
      const args = node.arguments
      if (args === undefined) reads.push('new Date')
      else if (args.length === 0) reads.push('new Date()')
      else if (args.length === 1 && isDateNow(args[0])) reads.push('new Date(Date.now())')
    } else if (ts.isFunctionDeclaration(node) && node.name?.text === 'todayIso') {
      reads.push('a private todayIso')
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'todayIso' &&
      !isProductTodayHook(node.initializer)
    ) {
      reads.push('a private todayIso')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return reads
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    // src/testing holds test infrastructure (fixtures, setup), not product code.
    if (statSync(full).isDirectory()) return entry === 'testing' ? [] : sources(full)
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : []
  })
}

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join('/')
const readsIn = (file: string) => clockReads(file, readFileSync(path.join(SRC, file), 'utf8'))

describe('the clock fence (2026-09-23 spec §K1)', () => {
  it('no source outside the owners, the counted exceptions and the allowlist reads the browser clock', () => {
    const exempt = new Set([...OWNERS, ...Object.keys(EXCEPTIONS), ...Object.keys(ALLOWLIST)])
    const offenders = sources(SRC)
      .map(rel)
      .filter((file) => !exempt.has(file))
      .flatMap((file) => readsIn(file).map((what) => `${file}: ${what}`))
    expect(offenders).toEqual([])
  })

  it('each counted file holds exactly its counted reads — a new one cannot hide, a fixed one must be struck off', () => {
    const counted = { ...EXCEPTIONS, ...ALLOWLIST }
    const actual = Object.fromEntries(Object.keys(counted).map((file) => [file, readsIn(file).length]))
    expect(actual).toEqual(counted)
  })

  it('the allowlist may only shrink', () => {
    for (const [file, count] of Object.entries(ALLOWLIST)) {
      expect(count, file).toBeGreaterThan(0) // a fixed file is deleted, not kept at 0
      expect(count, file).toBeLessThanOrEqual(ALLOWLIST_AT_LANDING[file] ?? 0)
    }
  })

  it('the owners and exceptions are real files (a rename must move them)', () => {
    const named = [...OWNERS, ...Object.keys(EXCEPTIONS)]
    expect(named.filter((file) => !existsSync(path.join(SRC, file)))).toEqual([])
  })

  it("the matcher counts the browser's now and a private todayIso — code, not comments or strings", () => {
    const reads = (source: string) => clockReads('probe.ts', source).length
    for (const hit of [
      'const year = new Date().getFullYear()',
      'const now = new Date()',
      'const now = new Date', // no parentheses is still a call
      'const now = new Date(Date.now())', // the browser's now, spelled longhand
      'function todayIso(): string { return "" }',
      'const todayIso = () => "2026-09-24"',
      'let todayIso = someDay',
    ])
      expect(reads(hit), hit).toBe(1)
    for (const miss of [
      'const d = new Date(iso)',
      'const d = new Date(y, m - 1, d)',
      'const d = new Date(Date.UTC(y, m, 0))',
      'const stamp = Date.now()',
      '// never new Date() in a rule',
      '/* new Date().getFullYear() */ const x = 1',
      'const words = "new Date()"',
      'const todayIso = useProductToday()', // the sanctioned way to hold the day in a component
      'function f({ todayIso = null }: { todayIso?: string | null }) { return todayIso }',
      'interface Options { todayIso: string }',
      'const note = partialNote(m, todayIso())',
    ])
      expect(reads(miss), miss).toBe(0)
    expect(reads('const a = new Date(); const b = new Date(); function todayIso() {}')).toBe(3)
    expect(clockReads('probe.tsx', 'const el = <p>{new Date().getFullYear()}</p>')).toEqual(['new Date()'])
  })
})
