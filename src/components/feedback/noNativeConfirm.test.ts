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
// `confirm(…)` call — unless the file binds a `confirm` of its own AND the call hands it an options
// object literal, which is the house hook's one shape (`const confirm = useConfirm();
// confirm({ anchor, title, … })`). A bound `confirm` handed a string, a template or nothing counts: that
// is the browser's shape, so call the hook with its options written in place, and name any local helper
// something other than `confirm`.
//
// HOW THE LIST SHRINKS. ALLOWLIST holds the calls that stood when lane L4 landed, counted per file and
// grouped by the wave-2 lane that converts them, so each lane's removals land in its own block and the
// four merge cleanly. That lane lowers its file's count — or deletes the entry — in the SAME commit that
// converts the call; the exact-count test fails until it does, and no file may join or grow
// (ALLOWLIST_AT_LANDING is the ceiling). An emptied block keeps its heading. Lane V, once wave 2 has
// merged, adds the test that pins the list empty, as clockFence.test.ts did when its list emptied:
//   it('the allowlist is empty — wave 2 converted every native confirm', () => expect(ALLOWLIST).toEqual({}))

const SRC = path.resolve(__dirname, '../..')

/** Native confirms still standing, counted per file, grouped by the lane that converts them (spec §6.4). */
const ALLOWLIST: Record<string, number> = {
  // L5 Settings
  'components/settings/RestoreCard.tsx': 1, // Restore → the popover, its typed date arm inside
  'pages/SettingsPage.tsx': 1, // Apply import

  // L6 Portfolio·ESPP·Comp·Paycheck
  'pages/CompPage.tsx': 1, // comp event delete → instant + Undo
  'pages/EsppPage.tsx': 3, // lot and offering deletes, a period's Reset → instant + Undo
  'pages/PaycheckPage.tsx': 1, // profile delete → instant + Undo

  // L7 Cards·Calendar·Budgets·Projection·Assistant
  // (none: these surfaces ask with in-app lines or not at all today)

  // L8 Taxes·Monthly update
  'components/taxes/BracketsEditor.tsx': 2, // the status tab's discard guard; emptying a table
  'components/taxes/WithholdingPanel.tsx': 1, // Vest Apply over dirty Inputs
  'pages/TaxesPage.tsx': 3, // the year-switch and status-Undo discard guards; what-if Apply
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

/** Every native confirm in `text`, from its AST: a read of `confirm` off a global (called or not); a
 *  bare `confirm(…)` handed anything but an options object literal; and a bare `confirm({ … })` where the
 *  file declares no `confirm` of its own (then it is the global's). */
function nativeConfirms(fileName: string, text: string): number {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, kind)
  let reads = 0
  let browserShaped = 0
  let hookShaped = 0
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
      const first = node.arguments[0]
      if (first !== undefined && ts.isObjectLiteralExpression(first)) hookShaped += 1
      else browserShaped += 1
    }
    if (declaresConfirm(node)) bindsConfirm = true
    ts.forEachChild(node, visit)
  }
  visit(source)
  return reads + browserShaped + (bindsConfirm ? 0 : hookShaped)
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
      "confirm({ title: 'x' })", // unbound, it is the global, whatever it is handed
      // The binding hole, shut: a bound `confirm` handed anything but an options object is the
      // browser's shape — a string, a template, nothing at all (name a local helper something else).
      "const confirm = useConfirm(); confirm('Delete?')",
      'function f({ confirm }: { confirm: (m: string) => boolean }) { return confirm(`Delete ${x}?`) }',
      "import { confirm } from './x'; confirm()",
    ])
      expect(count(hit), hit).toBe(1)
    for (const miss of [
      "// window.confirm('x')",
      "/* confirm('x') */ const a = 1",
      'const words = "window.confirm(x)"',
      "const confirm = useConfirm(); await confirm({ title: 'x' })",
      'function f({ confirm }: { confirm: (o: object) => void }) { confirm({ anchor }) }',
      "import { confirm } from './x'; confirm({ ...options, title: 'x' })",
      'dialog.confirm()',
      'const t = { confirm: 1 }',
    ])
      expect(count(miss), miss).toBe(0)
    expect(count("window.confirm('a'); window.confirm('b')")).toBe(2)
    expect(count("const el = <button onClick={() => window.confirm('x')} />", 'probe.tsx')).toBe(1)
  })
})
