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

it('registers the four dials and multiplies them into one opacity', () => {
  const dials = [
    ['--enter', '<number>', '1'], ['--enter-y', '<length>', '0px'],
    ['--reveal', '<number>', '1'], ['--rise', '<length>', '0px'],
  ]
  for (const [name, syntax, initial] of dials) {
    expect(panels).toContain(
      `@property ${name} { syntax: '${syntax}'; inherits: false; initial-value: ${initial}; }`,
    )
  }
  expect(panels).toContain('opacity: calc(var(--reveal) * var(--enter));')
  expect(panels).toContain('transform: translateY(calc(var(--rise) + var(--enter-y)));')
  expect(read('shell/shell.css')).toContain(
    'animation: page-body-in var(--t-page) var(--ease-out) both;',
  )
})

// Each string carries its enclosing at-rule, so containment is pinned with the content.
it('runs the entrance under no-preference only, on tagged groups only, capped at six', () => {
  expect(panels).toContain('no-preference) { .page-frame-body .card:not(:has(.entry-footer)),')
  expect(panels).toContain('animation-duration: var(--enter-dur);')
  expect(panels).toContain('animation-delay: calc(var(--stagger-i, 0) * var(--t-stagger));')
  expect(panels).toContain('[data-stagger] { --enter-dur: var(--t-enter); }')
  expect(panels).toContain(`[data-stagger='5'] { --stagger-i: 5; }`)
  expect(panels).not.toContain(`[data-stagger='6']`)
  expect(panels).toContain('@keyframes card-enter { from { --enter: 0; --enter-y: 8px; }')
})

it('drives the reveal off a view() timeline, and turns it off for print', () => {
  expect(panels).toContain('@supports (animation-timeline: view()) { .page-frame-body')
  expect(panels).toContain('animation-name: card-enter, reveal-in, reveal-out;')
  expect(panels).toContain('animation-timeline: auto, view(), view();')
  expect(panels).toContain('animation-range: normal, entry 0% entry var(--reveal-range), exit calc(100% - var(--reveal-range)) exit 100%;')
  // reveal-out fills `none`: with `both` its own `from` would apply before its range and
  // cancel reveal-in everywhere else. A card inside a card would square the floor.
  expect(panels).toContain('animation-fill-mode: both, both, none;')
  expect(panels).toContain('.page-frame-body .card .card { animation-name: none; }')
  expect(panels).toContain('@keyframes reveal-in { from { --reveal: var(--reveal-floor);')
  expect(panels).toContain('@media print { .page-frame-body .card, .page-frame-body .kpi-row {')
})
