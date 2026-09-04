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

/** The scrim block opens a rule on the SAME two pseudo-elements four times over — the shared
 *  one, one per edge, and the two off switches — so `inside`'s first match cannot say which is
 *  meant. This reads the last rule opened by `opener` before the block's media queries, which
 *  is always the standalone per-edge one. */
function edgeRule(scrims: string, opener: string): string {
  const edges = scrims.slice(0, scrims.indexOf('@media'))
  return inside(edges.slice(edges.lastIndexOf(opener)), opener)
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

// §4b: two viewport-edge scrims, one per edge of the content region. The reveal dims a
// single card as it nears an edge; these say the same thing about the PAGE — there is more
// above, there is more below. Pseudo-elements of `.page-frame-body`, so they ride the content
// column with no extra DOM and no JS.
it('hangs a scrim on each viewport edge of the content region', () => {
  const scrims = inside(panels, '@supports (animation-timeline: scroll())')
  const shared = inside(scrims, '.page-frame-body:not(:has(.entry-footer))::before, .page-frame-body:not(:has(.entry-footer))::after {')
  expect(shared).toContain("content: '';")
  expect(shared).toContain('display: block;')
  expect(shared).toContain('height: var(--scrim-h);')
  // A scrim is a hint, never a target: the card underneath keeps every click.
  expect(shared).toContain('pointer-events: none;')
  // Above the cards (which declare no z-index), below the sticky scope row (8), the drawer
  // (15), the palette (20) and the toasts (30) — a scrim is the quietest thing on the page.
  expect(shared).toContain('z-index: 5;')
  // The resting value, and the whole answer on a page too short to scroll: a scroll()
  // timeline with no scroll range is INACTIVE, its animation does not apply at all, and the
  // base style is what paints. Nothing is hidden above or below a page that already fits.
  expect(shared).toContain('opacity: 0;')
})

// Sticky, NOT fixed: `.page-frame-body` carries a transform for the length of its own
// entrance (shell.css, page-body-in), and a transformed ancestor re-anchors a fixed box — the
// scrim would slide with the page instead of holding the edge. Sticky also keeps the scrim in
// the content column, so it spans exactly the width the cards do, for free.
it('sticks each scrim to its edge and costs the flow nothing', () => {
  const GRAD = 'color-mix(in srgb, var(--bg) calc(var(--scrim-alpha) * 100%), transparent)'
  const scrims = inside(panels, '@supports (animation-timeline: scroll())')
  const top = edgeRule(scrims, '.page-frame-body:not(:has(.entry-footer))::before {')
  const bottom = edgeRule(scrims, '.page-frame-body:not(:has(.entry-footer))::after {')
  expect(top).toContain('position: sticky;')
  expect(bottom).toContain('position: sticky;')
  // The top scrim starts at the scope row's UNDERSIDE — the same --sticky-inset the reveal's
  // view() timelines are inset by — so it can never fade the row it is sitting under.
  expect(top).toContain('top: var(--sticky-inset, 0px);')
  expect(bottom).toContain('bottom: 0;')
  // Zero net height in flow: a negative margin the size of the scrim, so the top one does not
  // push the first card down and the bottom one does not stand a 120px gap under the last.
  expect(top).toContain('margin-bottom: calc(-1 * var(--scrim-h));')
  expect(bottom).toContain('margin-top: calc(-1 * var(--scrim-h));')
  // Tokens, never a literal colour: the fade has to end in the page's OWN background or it
  // is a grey smear in light mode. --scrim-alpha dials the page-coloured end down without
  // touching a single dimension.
  expect(top).toContain(`background: linear-gradient(to bottom, ${GRAD}, transparent);`)
  expect(bottom).toContain(`background: linear-gradient(to top, ${GRAD}, transparent);`)
})

// One timeline for both, the document scroller, and both ranges are stated in the height
// token: the distance a scrim fades over is the distance it covers, and neither can drift
// from the other. The whole block sits inside @supports, so a browser with no scroll()
// timelines shows no scrims rather than two permanent bars.
it('drives the scrims off a root scroll timeline, over ranges measured in --scrim-h', () => {
  const scrims = inside(panels, '@supports (animation-timeline: scroll())')
  const top = edgeRule(scrims, '.page-frame-body:not(:has(.entry-footer))::before {')
  const bottom = edgeRule(scrims, '.page-frame-body:not(:has(.entry-footer))::after {')
  // The shorthand must come FIRST: `animation` resets animation-timeline to auto, so stating
  // the timeline before it would throw the timeline away.
  expect(top).toContain('animation: scrim-in linear both; animation-timeline: scroll(root block); animation-range: 0 var(--scrim-h);')
  expect(bottom).toContain('animation: scrim-out linear both; animation-timeline: scroll(root block); animation-range: calc(100% - var(--scrim-h)) 100%;')
  expect(scrims).toContain('@keyframes scrim-in { from { opacity: 0; } to { opacity: 1; } }')
  expect(scrims).toContain('@keyframes scrim-out { from { opacity: 1; } to { opacity: 0; } }')
})

// A scrim exists only because the page moves, so a reader who asked for no motion gets none,
// and paper has no viewport to have an edge. The wizard is exempt by the same
// :has(.entry-footer) test the reveal uses: its sticky entry footer already owns the bottom
// edge, and two page-coloured layers stacked there read as a rendering bug.
it('switches both scrims off under reduced motion, in print, and in the wizard', () => {
  const scrims = inside(panels, '@supports (animation-timeline: scroll())')
  const off = '.page-frame-body:not(:has(.entry-footer))::before, .page-frame-body:not(:has(.entry-footer))::after { display: none; }'
  // The off switch repeats the full selector on purpose: :not(:has(…)) carries the
  // specificity of what it holds, so a shorter selector here would lose the cascade and the
  // scrims would survive the very media query meant to remove them.
  expect(inside(scrims, '@media (prefers-reduced-motion: reduce)')).toContain(off)
  expect(inside(scrims, '@media print')).toContain(off)
  // Pinned as an absence: no scrim rule may address the body without the wizard guard.
  expect(scrims).not.toMatch(/\.page-frame-body::(before|after)/)
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
