import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments out, whitespace flattened (tableScrollCss.test.ts's idiom): a pin survives a re-indent and a
// comment moving, and fails only when a declaration actually changes. jsdom lays nothing out, so the
// rules are what can be held to the spec here (2026-09-25 polish spec §2); the fit itself — no
// scrollbar of its own, theme and Log out in view at 1280×800 … 1536×864 — is measured in Edge.
const flat = (file: string) =>
  readFileSync(path.join(__dirname, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')

const LAYOUT = flat('Layout.css')

/** The text between `opener`'s own `{` and the `}` that closes it — containment, not adjacency. */
function inside(css: string, opener: string): string {
  const start = css.indexOf(opener)
  expect(start, opener).toBeGreaterThan(-1)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}' && (depth -= 1) === 0) return css.slice(open + 1, i)
  }
  throw new Error(`unclosed ${opener}`)
}

describe('the sidebar on a short screen (Layout.css)', () => {
  // The nav + footer needed 886px: at 1280×800, 1366×768 and 1536×864 the sidebar grew its own
  // scrollbar and hid the theme and log-out buttons (SGS-06, MOTION-21).
  it('tightens the nav rhythm under 900px of height', () => {
    const short = inside(LAYOUT, '@media (max-height: 900px) {')
    expect(short).toContain('.nav-link { padding-top: 0.32rem; padding-bottom: 0.32rem; }')
    expect(short).toContain('.nav-heading { margin-top: 0.2rem; }')
    expect(short).toContain('.sidebar nav { gap: 0.3rem; }')
    expect(short).toContain('.sidebar-title { padding-bottom: 0.6rem; }')
    expect(short).toContain('.sidebar-search { margin-bottom: 0.4rem; }')
  })

  // "Nothing in the nav moves at ≥ 901 px of height": the tall rhythm stays the base rule.
  it('keeps the tall rhythm and the scrolling fallback outside that query', () => {
    expect(LAYOUT).toMatch(/\.nav-link \{[^}]*padding: 0\.5rem 0\.75rem;/)
    expect(LAYOUT).toMatch(/\.nav-heading \{[^}]*margin: 0\.35rem 0 0\.1rem;/)
    expect(LAYOUT).toMatch(/\.sidebar nav \{[^}]*gap: 0\.45rem;/)
    expect(LAYOUT).toMatch(/\.sidebar-title \{[^}]*padding: 0\.25rem 0\.75rem 1rem;/)
    expect(LAYOUT).toMatch(/\.sidebar-search \{[^}]*margin: 0 0\.25rem 0\.6rem;/)
    expect(LAYOUT).toMatch(/\.sidebar \{[^}]*overflow-y: auto;/)
  })
})
