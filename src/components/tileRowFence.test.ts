import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// A tile row holds tiles and nothing else (2026-09-25 polish spec §4.1). Each `.stat-tile` is a four-line
// subgrid of its `.kpi-row` (label · badge · value · delta — panels.css), so anything else in the row is
// auto-placed into ONE of those line tracks: a hint paragraph or a stray wrapper there knocks every tile
// after it off the row's lines. Enforced over the source tree rather than by review, by walking the
// TypeScript AST (noNativeConfirm.test.ts's way, so comments and strings never count): every JSX element
// whose class names `kpi-row` may hold only tiles — <StatTile>, <GhostTile>, <JurisdictionTile> (a
// StatTile) — or a `.stat-tile-slot` wrapping one, reached through fragments, conditionals, `&&`,
// `.map(…)` / `Array.from(…)` callbacks and a same-file table of tile elements (the Overview's). Anything
// the walk cannot see through fails too: name the tile where the row is written.

const SRC = path.resolve(__dirname, '..')

/** Components whose root IS a `.stat-tile`. */
const TILE_TAGS = new Set(['StatTile', 'GhostTile', 'JurisdictionTile'])
const FRAGMENT_TAGS = new Set(['Fragment', 'React.Fragment'])

type Jsx = ts.JsxElement | ts.JsxSelfClosingElement

const tagOf = (node: Jsx) =>
  (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText()
const attributesOf = (node: Jsx) =>
  (ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes).properties

/** The string pieces an expression can contribute to a class list: its literals and template texts —
 *  and, for a call to a function of the same file (PageSkeleton's rowClass), that function's. */
function classPieces(node: ts.Node, source: ts.SourceFile, seen = new Set<string>()): string[] {
  const out: string[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text)
    else if (ts.isTemplateExpression(n)) {
      out.push(n.head.text, ...n.templateSpans.map((span) => span.literal.text))
      n.templateSpans.forEach((span) => visit(span.expression))
      return
    } else if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && !seen.has(n.expression.text)) {
      seen.add(n.expression.text)
      const callee = declarationOf(n.expression.text, source)
      if (callee !== undefined) out.push(...classPieces(callee, source, seen))
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return out
}

function classNames(node: Jsx, source: ts.SourceFile): string[] {
  const attribute = attributesOf(node).find(
    (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === 'className',
  )
  if (attribute?.initializer === undefined) return []
  return classPieces(attribute.initializer, source).flatMap((piece) => piece.split(/\s+/)).filter(Boolean)
}

/** A function or const of the file by name (the first so named) — what a call or a lookup resolves to. */
function declarationOf(name: string, source: ts.SourceFile): ts.Node | undefined {
  let found: ts.Node | undefined
  const visit = (n: ts.Node): void => {
    if (found !== undefined) return
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) found = n.initializer
    ts.forEachChild(n, visit)
  }
  visit(source)
  return found
}

/** The element-making callback of `list.map(cb)` or `Array.from(source, cb)`. */
function callbackOf(node: ts.Expression): ts.ArrowFunction | ts.FunctionExpression | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined
  const callee = node.expression.getText()
  const callback = callee === 'Array.from' ? node.arguments[1] : node.expression.name.text === 'map' ? node.arguments[0] : undefined
  return callback !== undefined && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) ? callback : undefined
}

/** What in a tile row's children is not a tile: tag names, text, or the kind of an opaque expression. */
function strays(children: readonly ts.JsxChild[], source: ts.SourceFile): string[] {
  const child = (node: ts.JsxChild): string[] => {
    if (ts.isJsxText(node)) return node.text.trim() === '' ? [] : [`text "${node.text.trim()}"`]
    if (ts.isJsxExpression(node)) return node.expression === undefined ? [] : expression(node.expression)
    if (ts.isJsxFragment(node)) return strays(node.children, source)
    const tag = tagOf(node)
    if (TILE_TAGS.has(tag)) return []
    if (FRAGMENT_TAGS.has(tag)) return ts.isJsxElement(node) ? strays(node.children, source) : []
    // A labelled group of one tile (the calendar's): the slot is a subgrid of the row, the tile of it.
    if (tag === 'div' && classNames(node, source).includes('stat-tile-slot') && ts.isJsxElement(node)) {
      const inner = node.children.filter((c) => !(ts.isJsxText(c) && c.text.trim() === ''))
      return inner.length === 1 ? strays(inner, source) : [`.stat-tile-slot holding ${inner.length}`]
    }
    return [`<${tag}>`]
  }
  const expression = (node: ts.Expression): string[] => {
    if (ts.isParenthesizedExpression(node)) return expression(node.expression)
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return child(node)
    if (ts.isConditionalExpression(node)) return [...expression(node.whenTrue), ...expression(node.whenFalse)]
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
      return expression(node.right)
    if (node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return []
    if (ts.isIdentifier(node) && node.text === 'undefined') return []
    // list.map((x) => <StatTile …/>) and Array.from({ length }, (_, i) => <GhostTile …/>): the callback's
    // answer(s).
    const callback = callbackOf(node)
    if (callback !== undefined) {
      if (!ts.isBlock(callback.body)) return expression(callback.body)
      const answers: string[] = []
      const visit = (n: ts.Node): void => {
        if (ts.isReturnStatement(n) && n.expression !== undefined) answers.push(...expression(n.expression))
        else if (!ts.isFunctionLike(n)) ts.forEachChild(n, visit)
      }
      visit(callback.body)
      return answers
    }
    // tileElements[id] / a named element: the same-file table (or const) it reads, every entry of it.
    const name = ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)
      ? node.expression.text
      : ts.isIdentifier(node) ? node.text : null
    const declared = name === null ? undefined : declarationOf(name, source)
    if (declared !== undefined && ts.isObjectLiteralExpression(declared)) {
      return declared.properties.flatMap((property) =>
        ts.isPropertyAssignment(property) ? expression(property.initializer) : [ts.SyntaxKind[property.kind]],
      )
    }
    if (declared !== undefined && ts.isExpression(declared) && ts.isIdentifier(node)) return expression(declared)
    return [`opaque ${ts.SyntaxKind[node.kind]}`]
  }
  return children.flatMap(child)
}

/** Every tile row in `text` and what strays into it: `line: problem`. */
function tileRowStrays(fileName: string, text: string): { rows: number; problems: string[] } {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let rows = 0
  const problems: string[] = []
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && classNames(node, source).includes('kpi-row')) {
      rows += 1
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
      const inside = ts.isJsxElement(node) ? strays(node.children, source) : []
      problems.push(...inside.map((problem) => `${line}: ${problem}`))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { rows, problems }
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return entry === 'testing' ? [] : sources(full)
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [full] : []
  })
}

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join('/')

describe('the tile-row fence (2026-09-25 polish spec §4.1)', () => {
  it('every .kpi-row holds tiles only', () => {
    const scanned = sources(SRC).map((file) => {
      const text = readFileSync(file, 'utf8')
      return { file: rel(file), ...(/kpi-row/.test(text) ? tileRowStrays(file, text) : { rows: 0, problems: [] }) }
    })
    expect(scanned.flatMap(({ file, problems }) => problems.map((problem) => `${file}:${problem}`))).toEqual([])
    // The walk reaches the rows it guards — a matcher that found none would pass vacuously.
    const withRows = scanned.filter(({ rows }) => rows > 0).map(({ file }) => file)
    expect(withRows).toEqual(
      expect.arrayContaining([
        'components/PageSkeleton.tsx', // className={rowClass(…)}
        'components/calendar/CashflowStrip.tsx', // slots
        'pages/CreditCardsPage.tsx', // a conditional class
        'pages/OverviewPage.tsx', // a table of tile elements
      ]),
    )
    expect(scanned.reduce((sum, { rows }) => sum + rows, 0)).toBeGreaterThanOrEqual(18)
  }, 30_000)

  it('the matcher flags what is not a tile — and follows the shapes the pages write', () => {
    const problems = (body: string, extra = '') =>
      tileRowStrays('probe.tsx', `${extra}\nconst el = <div className="kpi-row">${body}</div>`).problems
    for (const hit of [
      '<p className="drill-hint">A hint</p>',
      'Loose words',
      '<div><StatTile label="a" value="1" /></div>',
      '{busy && <span className="spinner" />}',
      '{ok ? <StatTile label="a" value="1" /> : <p>none</p>}',
      '{items.map((item) => <li key={item}>{item}</li>)}',
      '{Array.from({ length: 3 }, (_, i) => <span key={i} />)}',
      '{someNode}',
      '<div className="stat-tile-slot"><StatTile label="a" value="1" /><StatTile label="b" value="2" /></div>',
    ])
      expect(problems(hit), hit).not.toEqual([])
    for (const miss of [
      '<StatTile label="a" value="1" /><GhostTile hero />',
      '{/* a comment */}<JurisdictionTile row={row} />',
      '{ok ? <StatTile label="a" value="1" /> : null}',
      '{ready ? (<><StatTile label="a" value="1" /><StatTile label="b" value="2" /></>) : <GhostTile />}',
      '{busy && <GhostTile />}',
      '{list.map((x) => <StatTile key={x} label={x} value="1" />)}',
      '{list.map((x) => { return <StatTile key={x} label={x} value="1" /> })}',
      '{Array.from({ length: 3 }, (_, i) => <GhostTile key={i} />)}',
      '<div className="stat-tile-slot" role="group"><StatTile label="a" value="1" /></div>',
      '{order.map((id) => <Fragment key={id}>{tiles[id]}</Fragment>)}',
    ])
      expect(problems(miss, 'const tiles = { a: <StatTile label="a" value="1" />, b: busy ? <GhostTile /> : null }'), miss).toEqual([])
    // The row's class in its other spellings is still a row; its lookalikes are not.
    expect(tileRowStrays('p.tsx', 'const a = <div className={`kpi-row ${x}`}><p /></div>').problems).toEqual(['1: <p>'])
    expect(tileRowStrays('p.tsx', "const a = <div className={x ? 'kpi-row kpi-row-5' : 'kpi-row'}><p /></div>").rows).toBe(1)
    expect(
      tileRowStrays('p.tsx', "function cls() { return ['kpi-row', 'x'].join(' ') }\nconst a = <div className={cls()}><p /></div>").problems,
    ).toEqual(['2: <p>'])
    expect(tileRowStrays('p.tsx', 'const a = <div className="kpi-row-5 review-kpis"><p /></div>').rows).toBe(0)
  })
})
