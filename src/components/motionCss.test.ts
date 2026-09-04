import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

// Comments out first, then whitespace flattened: a pin that names an at-rule and the rule
// inside it must not break because a comment sits between them, and re-indenting a rule
// must never fail a pin either.
const read = (p: string) =>
  readFileSync(path.join(__dirname, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
const panels = read('panels.css')

/** The text between `opener`'s own `{` and the `}` that closes it — containment, not mere
 *  adjacency, so a rule cannot pass a pin by sitting next to the at-rule it must be in. */
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

it('registers the four dials and multiplies the two brightness ones into one opacity', () => {
  const dials = [
    ['--enter', '<number>', '1'], ['--reveal', '<number>', '1'],
    // Registered above all for `inherits: false`: unregistered, these two leaked from a
    // tagged card into the groups nested inside it, which then ran a second entrance.
    ['--enter-dur', '<time>', '0s'], ['--stagger-i', '<integer>', '0'],
  ]
  for (const [name, syntax, initial] of dials) {
    expect(panels).toContain(
      `@property ${name} { syntax: '${syntax}'; inherits: false; initial-value: ${initial}; }`,
    )
  }
  expect(read('shell/shell.css')).toContain(
    'animation: page-body-in var(--t-page) var(--ease-out) both;',
  )
})

// The regression this pins is a paint bug, not a motion one: a permanent transform makes
// every card a stacking context and a containing block, and InfoHint bubbles and ECharts'
// DOM tooltips then get overpainted by the next card the moment they cross a card edge.
it('leaves the resting card with no transform at all — brightness is the only base state', () => {
  const surface = inside(
    panels,
    '.page-frame-body .card:not(:has(.entry-footer)), .page-frame-body .kpi-row {',
  )
  expect(surface).toContain('opacity: calc(var(--reveal) * var(--enter));')
  expect(surface).not.toContain('transform')
  expect(surface).not.toContain('translate')
  // `backwards`, so a finished entrance stops applying and the element falls back to that
  // transform-free rule; `both` would pin translateY(0px) on for the life of the page.
  expect(panels).toContain('animation-fill-mode: backwards;')
  expect(panels).toContain('animation-fill-mode: backwards, backwards, none;')
})

// Each string carries its enclosing at-rule, so containment is pinned with the content.
it('runs the entrance under no-preference only, on tagged groups only, capped at six', () => {
  expect(panels).toContain('no-preference) { .page-frame-body .card:not(:has(.entry-footer)),')
  expect(panels).toContain('animation-duration: var(--enter-dur);')
  expect(panels).toContain('animation-delay: calc(var(--stagger-i, 0) * var(--t-stagger));')
  expect(panels).toContain('[data-stagger] { --enter-dur: var(--t-enter); }')
  expect(panels).toContain(`[data-stagger='5'] { --stagger-i: 5; }`)
  expect(panels).not.toContain(`[data-stagger='6']`)
  // The travel rides `translate` here and `transform` in the reveal below: two independent
  // transform properties the browser composes for free. animation-composition cannot do
  // that job — it is per ANIMATION, so `add` would also reach --enter, where 1 + 0 is 1.
  expect(panels).toContain(
    '@keyframes card-enter { from { --enter: 0; translate: 0 8px; } to { --enter: 1; translate: none; } }',
  )
})

it('drives the reveal off a view() timeline, and turns it off for print', () => {
  expect(panels).toContain('@supports (animation-timeline: view()) { .page-frame-body')
  expect(panels).toContain('animation-name: card-enter, reveal-in, reveal-out;')
  expect(panels).toContain('animation-range: normal, entry 0% entry var(--reveal-range), exit calc(100% - var(--reveal-range)) exit 100%;')
  expect(panels).toContain(
    '@keyframes reveal-in { from { --reveal: var(--reveal-floor); transform: translateY(var(--reveal-rise)); }',
  )
  expect(panels).toContain('@media print { .page-frame-body .card, .page-frame-body .kpi-row {')
})

// The mirror at the top edge is the whole reason for the inset: view() measures against the
// VIEWPORT, whose top ~50-70px is under the sticky scope row, so a card scrolled back into
// view finished its exit range — and was fully bright again — while still hidden behind the
// row. The block-axis start inset moves the range's finish line down to the row's underside;
// PageFrame measures the row and writes --sticky-inset on .page-frame-body. The 0px fallback
// is load-bearing twice over: it is the first-paint value before the effect runs, and it is
// the permanent value on a page that declares no scope row.
it('insets both view() timelines by the sticky scope row', () => {
  expect(panels).toContain(
    'animation-timeline: auto, view(var(--sticky-inset, 0px) 0px), view(var(--sticky-inset, 0px) 0px);',
  )
})

// A busy body and a card resting below the fold must not read as the same grey (user report,
// 2026-09-05). One token so the pair can be compared in one place; motion.test.ts pins the gap.
it('states the busy dim as a token, not a literal', () => {
  expect(inside(panels, '.loading-dim.is-loading {')).toContain('opacity: var(--busy-dim);')
})

// A nested group must not run its own entrance OR its own reveal — the fade would square
// to 0.38 and the travel would double. Registration blocks the inherited dials; this rule
// blocks the animation, and it has to sit outside @supports because a browser with no
// view() timeline nests cards just the same.
it('silences nested groups outside the @supports gate, and after it', () => {
  const nested = '.page-frame-body .card .card, .page-frame-body .card .kpi-row { animation-name: none; }'
  const noPreference = inside(panels, '@media (prefers-reduced-motion: no-preference) { .page-frame-body')
  expect(noPreference).toContain(nested)
  expect(inside(panels, '@supports (animation-timeline: view())')).not.toContain(nested)
  // AFTER the @supports block: these selectors tie at 0-3-0 with the rules they override,
  // so source order is the only thing that breaks the tie.
  expect(panels.indexOf(nested)).toBeGreaterThan(panels.indexOf('@keyframes reveal-out'))
})

it('gates the indicator transition on the attribute Layout sets after its first placement', () => {
  const layout = read('Layout.css')
  // Ungated, the opening measurement is itself a transition, and a cold load onto a page
  // five rows down sweeps the accent past every destination above it.
  expect(inside(layout, '.nav-indicator {')).not.toContain('transition')
  expect(layout).toContain(
    '.nav-indicator[data-placed] { transition: transform var(--t-nav) var(--ease-out), height var(--t-nav) var(--ease-out); }',
  )
  // The active icon's tint lives on a SECOND element, so .nav-link's own transition never
  // reaches it and the glyph snapped to the accent while the bar was still sliding.
  expect(layout).toContain('.nav-link svg { transition: color var(--t-fast) ease; }')
})
