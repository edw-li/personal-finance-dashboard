import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// The native confirm leaves the app (2026-09-25 polish spec D2, §6.3). `window.confirm` halts the page
// on a grey OS dialog that cannot say what an action will cost, cannot offer Undo and ignores the
// theme; the app asks through useConfirm() (feedback/confirm.tsx) instead — or, for anything the change
// log can reverse, does not ask at all (useDeleteWithUndo). Enforced over the source tree rather than
// by review, by walking the TypeScript AST (clockFence.test.ts's matcher, so comments and strings never
// count): `window.confirm` / `globalThis.confirm` / `self.confirm` in any form, and a bare
// `confirm(…)` call in a file that binds no `confirm` of its own — `const confirm = useConfirm()` is the
// house hook, not the browser's.
//
// HOW THE LIST SHRINKS. ALLOWLIST holds the calls that stood when lane L4 landed, counted per file. The
// wave-2 lane that converts a call lowers its file's count — or deletes the entry — in the SAME commit;
// the exact-count test fails until it does, and no file may join or grow (ALLOWLIST_AT_LANDING is the
// ceiling). Lane V, once wave 2 has merged, adds the test that pins the list empty, as
// clockFence.test.ts did when its list emptied:
//   it('the allowlist is empty — wave 2 converted every native confirm', () => expect(ALLOWLIST).toEqual({}))

const SRC = path.resolve(__dirname, '../..')

/** Native confirms still standing, counted per file, with the lane that converts each (spec §6.4). */
const ALLOWLIST: Record<string, number> = {
  'components/portfolio/SecuritiesPanel.tsx': 1, // L6: security delete → instant + Undo
  'components/settings/RestoreCard.tsx': 1, // L5: Restore → the popover, its typed date arm inside
  'components/taxes/BracketsEditor.tsx': 2, // L7: the status tab's discard guard; emptying a table
  'components/taxes/WithholdingPanel.tsx': 1, // L7: Vest Apply over dirty Inputs
  'pages/CompPage.tsx': 1, // L6: comp event delete → instant + Undo
  'pages/EsppPage.tsx': 3, // L6: lot and offering deletes, a period's Reset → instant + Undo
  'pages/PaycheckPage.tsx': 1, // L6: profile delete → instant + Undo
  'pages/SettingsPage.tsx': 1, // L5: Apply import
  'pages/TaxesPage.tsx': 3, // L7: the year-switch and status-Undo discard guards; what-if Apply
}
/** The list when lane L4 landed (2026-09-25): 14 calls in 9 files. The allowlist may only shrink. */
const ALLOWLIST_AT_LANDING: Record<string, number> = {
  'components/portfolio/SecuritiesPanel.tsx': 1,
  'components/settings/RestoreCard.tsx': 1,
  'components/taxes/BracketsEditor.tsx': 2,
  'components/taxes/WithholdingPanel.tsx': 1,
  'pages/CompPage.tsx': 1,
  'pages/EsppPage.tsx': 3,
  'pages/PaycheckPage.tsx': 1,
  'pages/SettingsPage.tsx': 1,
  'pages/TaxesPage.tsx': 3,
}

const GLOBALS = new Set(['window', 'globalThis', 'self'])
const isGlobal = (node: ts.Expression) => ts.isIdentifier(node) && GLOBALS.has(node.text)

/** A declaration that binds the name `confirm` in this file: a variable, a parameter, a function, a
 *  destructured binding, an import. */
function declaresConfirm(node: ts.Node): boolean {
  const binds =
    ts.isVariableDeclaration(node) ||
    ts.isParameter(node) ||
    ts.isBindingElement(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isImportSpecifier(node) ||
    ts.isImportClause(node) ||
    ts.isNamespaceImport(node)
  if (!binds) return false
  const name = (node as ts.NamedDeclaration).name
  return name !== undefined && ts.isIdentifier(name) && name.text === 'confirm'
}

/** Every native confirm in `text`, from its AST: a read of `confirm` off a global (called or not), and a
 *  bare `confirm(…)` call where the file declares no `confirm` of its own. */
function nativeConfirms(fileName: string, text: string): number {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, kind)
  let reads = 0
  let bareCalls = 0
  let bindsConfirm = false
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'confirm' && isGlobal(node.expression)) {
      reads += 1
    } else if (
      ts.isElementAccessExpression(node) &&
      isGlobal(node.expression) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'confirm'
    ) {
      reads += 1
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'confirm') {
      bareCalls += 1
    }
    if (declaresConfirm(node)) bindsConfirm = true
    ts.forEachChild(node, visit)
  }
  visit(source)
  return reads + (bindsConfirm ? 0 : bareCalls)
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
const confirmsIn = (file: string) => {
  const text = readFileSync(path.join(SRC, file), 'utf8')
  // Every match names `confirm`: a file without the word never reaches the parser.
  return /\bconfirm\b/.test(text) ? nativeConfirms(file, text) : 0
}

describe('the native-confirm fence (2026-09-25 polish spec D2, §6.3)', () => {
  it('no source outside the allowlist calls the browser confirm', () => {
    const offenders = sources(SRC)
      .map(rel)
      .filter((file) => ALLOWLIST[file] === undefined)
      .flatMap((file) => {
        const count = confirmsIn(file)
        return count === 0 ? [] : [`${file}: ${count}`]
      })
    expect(offenders).toEqual([])
  }, 30_000)

  it('each allowlisted file holds exactly its counted calls — a new one cannot hide, a converted one must be struck off', () => {
    const actual = Object.fromEntries(Object.keys(ALLOWLIST).map((file) => [file, confirmsIn(file)]))
    expect(actual).toEqual(ALLOWLIST)
  })

  it('the allowlist may only shrink', () => {
    for (const [file, count] of Object.entries(ALLOWLIST)) {
      expect(count, file).toBeGreaterThan(0) // a converted file is deleted, not kept at 0
      expect(count, file).toBeLessThanOrEqual(ALLOWLIST_AT_LANDING[file] ?? 0)
    }
  })

  it('the allowlisted files are real (a rename must move its entry)', () => {
    expect(Object.keys(ALLOWLIST).filter((file) => !existsSync(path.join(SRC, file)))).toEqual([])
  })

  it('the matcher counts the browser confirm — code, not comments or strings, never the house hook', () => {
    const count = (source: string, name = 'probe.ts') => nativeConfirms(name, source)
    for (const hit of [
      "window.confirm('Delete?')",
      'if (!window.confirm(`Delete ${ticker}?`)) return',
      "const ok = globalThis.confirm('x')",
      "self.confirm('x')",
      "window['confirm']('x')",
      'const ask = window.confirm', // a read is a use
      "confirm('Delete?')", // the bare global
    ])
      expect(count(hit), hit).toBe(1)
    for (const miss of [
      "// window.confirm('x')",
      "/* confirm('x') */ const a = 1",
      'const words = "window.confirm(x)"',
      "const confirm = useConfirm(); await confirm({ title: 'x' })",
      'function f({ confirm }: { confirm: () => void }) { confirm() }',
      "import { confirm } from './x'; confirm()",
      'dialog.confirm()',
      'const t = { confirm: 1 }',
    ])
      expect(count(miss), miss).toBe(0)
    expect(count("window.confirm('a'); window.confirm('b')")).toBe(2)
    expect(count("const el = <button onClick={() => window.confirm('x')} />", 'probe.tsx')).toBe(1)
  })
})
