import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The chart grammar's STRUCTURAL promises (2026-09-03 spec §6 success criteria), enforced
// over the source tree rather than by review: "no `<EChart` outside `ChartCard` (tests
// excepted); no page-level chart-header CSS or `.panel-title-row` around a chart; no
// `empty-note` chart fallback outside the card." C1–C6 each satisfied them on their own
// pages; this walk is what stops the eighth page from regressing them silently.
//
// Reads files as TEXT and renders nothing — a fence, not a type checker. Its matchers are
// held to synthetic sources at the bottom, because a walk whose pattern quietly stops
// matching passes forever while proving nothing (the sandboxConformance.test.ts pattern).

const SRC = path.resolve(__dirname, '..')

interface Source {
  file: string
  text: string
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return tsxFiles(full)
    // Tests are excepted by the spec: EChart.test.tsx must be able to mount the primitive
    // bare, and ChartCard.test.tsx asserts the empty-state prose the rules below outlaw
    // in pages.
    return full.endsWith('.tsx') && !full.endsWith('.test.tsx') ? [full] : []
  })
}

/** The full opening tag of every `<Name` in `text`, brace-depth aware.
 *
 *  A regex cannot do this job: `<ChartCard[\s\S]*?>` stops at the first `>` in the file,
 *  and half the mounts carry `csv={() => …}` — an arrow whose `>` sits four props before
 *  `ariaLabel`. Counting `{`/`}` and only accepting a `>` at depth 0 reads the real tag.
 *
 *  The name is matched WHOLE: `useRef<EChartsInstance | null>` is a type argument, not a
 *  mount, and a prefix match reported SpendingPage as hosting a bare chart. */
export function openingTags(text: string, name: string): string[] {
  const tags: string[] = []
  let from = 0
  for (;;) {
    const at = text.indexOf(`<${name}`, from)
    if (at === -1) return tags
    const after = text[at + name.length + 1] ?? ''
    if (/[A-Za-z0-9_$]/.test(after)) {
      from = at + 1
      continue
    }
    let depth = 0
    let end = at + name.length + 1
    for (; end < text.length; end++) {
      const char = text[end]
      if (char === '{') depth++
      else if (char === '}') depth--
      else if (char === '>' && depth === 0) break
    }
    tags.push(text.slice(at, end + 1))
    from = end + 1
  }
}

/** The JSX expression container (`{ … }`) enclosing `index`, or null at top level.
 *
 *  Walks back to the nearest unmatched `{`, then forward to its partner, so a fallback
 *  reads the same whichever branch the chart sits in — `cond ? <ChartCard/> : <p/>` and
 *  `cond ? <p/> : <ChartCard/>` land in one string either way. */
export function enclosingExpression(text: string, index: number): string | null {
  let depth = 0
  let open = -1
  for (let i = index; i >= 0; i--) {
    const char = text[i]
    if (char === '}') depth++
    else if (char === '{') {
      if (depth === 0) {
        open = i
        break
      }
      depth--
    }
  }
  if (open === -1) return null
  depth = 0
  for (let i = open; i < text.length; i++) {
    const char = text[i]
    if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) return text.slice(open, i + 1)
    }
  }
  return text.slice(open)
}

const EMPTY_NOTE = /className="[^"]*\bempty-note\b/g

/** Offending `empty-note` uses: the ones sharing a JSX expression with a `<ChartCard`.
 *
 *  The card owns all five body states (spec §6) — including the empty sentence, which is a
 *  REQUIRED prop — so a page that still ternaries a note against its chart has two empty
 *  designs for one chart, and the card's is the one with the header, hint and export row.
 *  Matching `className="…empty-note…"` rather than the bare word keeps the stylesheets'
 *  own prose ("layout for .card/.eyebrow/.empty-note lives in panels.css") out of it. */
export function emptyNoteChartFallbacks(text: string): number {
  let offenders = 0
  for (const match of text.matchAll(EMPTY_NOTE)) {
    const expression = enclosingExpression(text, match.index)
    if (expression !== null && expression.includes('<ChartCard')) offenders++
  }
  return offenders
}

// The page-level copies of the card's header row. The rules themselves are gone — the
// 2026-09-03 retire pass deleted the last of them (fa526b4) — so this walk is what stops a
// new file from reaching for a class name that no stylesheet would style any more.
const PAGE_CHART_HEADER =
  /className="[^"]*\b(?:networth-chart-header|networth-chart-controls|spending-chart-header|tax-chart-header|projection-chart-header|projection-chart-card)\b/

// `.panel-title-row` was the portfolio panels' chart header. PortfolioPage's Holdings
// section — a table, not a chart — legitimately keeps it, so it is named here rather than
// waved through by directory: a NEW file reaching for the retired class fails this audit
// even if it lives beside the page.
const PANEL_TITLE_ROW_ALLOWED = new Set([path.join('pages', 'PortfolioPage.tsx')])

// A page-level PREREQUISITE gate is not a chart fallback: ProjectionPage has no projection
// at all until a net-worth snapshot exists, so its `missing` branch replaces the tiles, the
// tables AND the charts with one sentence — and that sentence carries a <Link to="/update">,
// which the card's `empty: string` cannot hold. Counted rather than waved through: a SECOND
// note sharing an expression with a chart in this file still fails the audit.
const PREREQUISITE_GATES = new Map([[path.join('pages', 'ProjectionPage.tsx'), 1]])

const sources: Source[] = tsxFiles(SRC).map((file) => ({
  file: path.relative(SRC, file),
  text: readFileSync(file, 'utf8'),
}))
const chartHosts = sources.filter(({ text }) => text.includes('<ChartCard'))

describe('chart mount audits (spec §6)', () => {
  it('walks the whole component tree and finds every chart host', () => {
    // 84 components and 17 hosts across the nine chart pages at C1–C6 merge; the floors
    // catch a walk that silently stopped seeing files (a bad SRC, a rename) without
    // pinning counts that every new component would have to bump.
    expect(sources.length).toBeGreaterThan(70)
    expect(chartHosts.length).toBeGreaterThanOrEqual(17)
  })

  it('every <EChart sits inside ChartCard.tsx', () => {
    const offenders = sources
      .filter(({ file }) => file !== path.join('components', 'ChartCard.tsx'))
      .filter(({ file }) => file !== path.join('components', 'EChart.tsx'))
      .filter(({ text }) => openingTags(text, 'EChart').length > 0)
      .map(({ file }) => file)
    expect(offenders).toEqual([])
  })

  it('no page-level chart header markup survives', () => {
    expect(sources.filter(({ text }) => PAGE_CHART_HEADER.test(text)).map(({ file }) => file)).toEqual([])
    const titleRows = sources
      .filter(({ text }) => /className="[^"]*\bpanel-title-row\b/.test(text))
      .map(({ file }) => file)
      .filter((file) => !PANEL_TITLE_ROW_ALLOWED.has(file))
    expect(titleRows).toEqual([])
  })

  it('no empty-note fallback shares a ternary with a ChartCard', () => {
    const offenders = chartHosts
      .map(({ file, text }) => ({
        file,
        extra: emptyNoteChartFallbacks(text) - (PREREQUISITE_GATES.get(file) ?? 0),
      }))
      .filter(({ extra }) => extra > 0)
      .map(({ file, extra }) => `${file} (+${extra})`)
    expect(offenders).toEqual([])
  })

  it('every named prerequisite gate still exists (no stale allowance)', () => {
    // Without this the allowance would outlive the gate: once ProjectionPage's `missing`
    // branch is migrated, the entry above has to go, or it silently forgives one future
    // chart fallback in that file.
    for (const [file, count] of PREREQUISITE_GATES) {
      const source = sources.find((candidate) => candidate.file === file)
      expect(source, `${file} is gone — drop its PREREQUISITE_GATES entry`).toBeTruthy()
      expect(emptyNoteChartFallbacks(source!.text), `${file} gate count changed`).toBe(count)
    }
  })

  it('every ChartCard names what its chart shows', () => {
    const nameless: string[] = []
    for (const { file, text } of chartHosts) {
      for (const tag of openingTags(text, 'ChartCard')) {
        // The ASSIGNMENT, not the substring: `ariaLabelledBy=` would have satisfied a
        // plain `includes('ariaLabel')` while naming nothing.
        if (!/\bariaLabel=/.test(tag)) nameless.push(`${file}: ${tag.slice(0, 60)}`)
      }
    }
    expect(nameless).toEqual([])
  })

  it('every ChartCard also carries the card’s other required prose (hint, empty, exportName)', () => {
    // The compiler already requires these; asserting them here means the audit's own
    // ariaLabel check is reading WHOLE tags — a truncated read would drop these too.
    const incomplete: string[] = []
    for (const { file, text } of chartHosts) {
      for (const tag of openingTags(text, 'ChartCard')) {
        for (const prop of ['hint', 'empty', 'exportName']) {
          if (!new RegExp(`\\b${prop}=`).test(tag)) incomplete.push(`${file} missing ${prop}`)
        }
      }
    }
    expect(incomplete).toEqual([])
  })
})

// Each matcher is handed a source it MUST reject, so the rules above cannot pass by
// failing to match anything.
describe('the matchers themselves', () => {
  it('reads a whole opening tag past braces, arrows and nested objects', () => {
    const text = `<ChartCard title="A" csv={() => ({ headers: [], rows: [] })} ariaLabel="x" />`
    expect(openingTags(text, 'ChartCard')).toEqual([text])
    // The naive `<ChartCard[\s\S]*?>` would have stopped inside the arrow and called this
    // mount nameless.
    expect(/\bariaLabel=/.test(openingTags(text, 'ChartCard')[0])).toBe(true)
    // …and a near-miss prop name does NOT count as a name.
    expect(/\bariaLabel=/.test('<ChartCard ariaLabelledBy="h2" />')).toBe(false)
  })

  it('reads both the self-closing and the children form, and every tag in a file', () => {
    const text = `<ChartCard a="1" />\n<div/>\n<ChartCard b="2">\n  <p/>\n</ChartCard>`
    expect(openingTags(text, 'ChartCard')).toEqual(['<ChartCard a="1" />', '<ChartCard b="2">'])
  })

  it('finds no tag when the component is absent', () => {
    expect(openingTags('<div className="chart-card" />', 'EChart')).toEqual([])
  })

  it('matches the component name WHOLE — a type argument is not a mount', () => {
    // SpendingPage's `useRef<EChartsInstance | null>(null)` was reported as a bare chart
    // mount by the prefix match this replaced.
    expect(openingTags('const r = useRef<EChartsInstance | null>(null)', 'EChart')).toEqual([])
    expect(openingTags('<EChartLegend a="1" />', 'EChart')).toEqual([])
    expect(openingTags('<EChart ariaLabel="x" />', 'EChart')).toEqual(['<EChart ariaLabel="x" />'])
  })

  it('catches an empty-note fallback in EITHER branch of the ternary', () => {
    const chartFirst = `{rows.length > 0 ? (\n  <ChartCard ariaLabel="x" option={o} />\n) : (\n  <p className="empty-note">Nothing yet.</p>\n)}`
    const noteFirst = `{rows.length === 0 ? (\n  <p className="empty-note">Nothing yet.</p>\n) : (\n  <ChartCard ariaLabel="x" option={o} />\n)}`
    expect(emptyNoteChartFallbacks(chartFirst)).toBe(1)
    expect(emptyNoteChartFallbacks(noteFirst)).toBe(1)
    expect(emptyNoteChartFallbacks(`{rows.length > 0 ? <ChartCard ariaLabel="x" /> : <p className="empty-note">x</p>}`)).toBe(1)
  })

  it('leaves a table’s or list’s own empty note alone', () => {
    // The rule is about CHART fallbacks: a page may hold both a chart card and an unrelated
    // table with its own note, and PortfolioPage, ProjectionPage and PaycheckPage all do.
    const unrelated = `<ChartCard ariaLabel="x" option={o} />\n{txns.length === 0 && (\n  <p className="empty-note">No transactions.</p>\n)}`
    expect(emptyNoteChartFallbacks(unrelated)).toBe(0)
    expect(emptyNoteChartFallbacks(`// layout for .empty-note lives in panels.css`)).toBe(0)
  })

  it('reads the enclosing expression, not the whole file', () => {
    expect(enclosingExpression('{a ? <X/> : <Y/>}', 5)).toBe('{a ? <X/> : <Y/>}')
    expect(enclosingExpression('{ok && <p/>}{bad && <q/>}', 20)).toBe('{bad && <q/>}')
    expect(enclosingExpression('<p className="empty-note"/>', 5)).toBeNull()
    // Nested containers resolve to the INNER one, so a note in a sibling branch of some
    // outer expression is not blamed on a chart three levels up.
    expect(enclosingExpression('{outer && <X a={b ? <p/> : null} />}', 22)).toBe('{b ? <p/> : null}')
  })

  it('rejects a page-level chart header and the retired panel title row', () => {
    expect(PAGE_CHART_HEADER.test('<div className="networth-chart-header">')).toBe(true)
    expect(PAGE_CHART_HEADER.test('<div className="tax-chart-header wide">')).toBe(true)
    // The card's OWN header row is the shape everything migrated to — never an offender.
    expect(PAGE_CHART_HEADER.test('<div className="chart-card-header">')).toBe(false)
    expect(/className="[^"]*\bpanel-title-row\b/.test('<div className="panel-title-row">')).toBe(true)
  })
})
