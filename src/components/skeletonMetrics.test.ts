import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CARD_CHROME, CHART_CARD_ROWS, FEED_SKELETON, OWNER_STRIP, SCOPE_ROW, STAT_TILE, chartCardBox, ghostCardBody } from './skeletonMetrics'

const CSS = readFileSync(path.join(__dirname, 'panels.css'), 'utf8')
const SHELL = readFileSync(path.join(__dirname, 'shell', 'shell.css'), 'utf8')
// Comments out, whitespace flattened: a pin must survive a re-indent and a comment moving.
const flat = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
describe('skeletonMetrics', () => {
  it('mirrors the CSS variables panels.css declares — a two-way pin, so neither can drift', () => {
    // The stylesheet owns the row heights; this module only names them. A number that moves in
    // one place and not the other is the layout shift coming straight back.
    expect(CSS).toContain(`--m-header-row: ${CHART_CARD_ROWS.header}px`)
    expect(CSS).toContain(`--m-header-controls: ${CHART_CARD_ROWS.headerControls}px`)
    expect(CSS).toContain(`--m-export-row: ${CHART_CARD_ROWS.exportRow}px`)
    expect(CSS).toContain(`--m-zoom-row: ${CHART_CARD_ROWS.zoom}px`)
    expect(CSS).toContain(`--m-caption-row: ${CHART_CARD_ROWS.caption}px`)
    expect(CSS).toContain(`--m-stat-tile: ${STAT_TILE}px`)
    expect(CSS).toContain(`--m-owner-strip: ${OWNER_STRIP}px`)
    // A declared twin nobody READS reserves nothing: the header rows are min-heights on the real
    // header, which is what lets chartCardBox quote one number for every controls variant.
    expect(CSS).toContain('min-height: var(--m-header-row)')
    expect(CSS).toContain('min-height: var(--m-header-controls)')
    // --t-xfade is M2's token; until it lands the fallback in panels.css IS the twin of XFADE_MS,
    // and the timer that drops the veil must not outlive the animation that hides it.
    expect(CSS).toContain(`var(--t-xfade)`)
  })
  it('converts an outer box to a ghost BODY (never negative), sizes a chart card, derives each feed', () => {
    expect([ghostCardBody(491), ghostCardBody(20)]).toEqual([491 - CARD_CHROME, 0])
    // A real header is not the ghost's stand-in label: charging CARD_CHROME here under-counted a
    // card with controls by 21px and over-counted a bare one by 6.
    expect([chartCardBox(320), chartCardBox(360, { controls: true, zoomable: true }), chartCardBox(280, { zoomable: true, footer: true })]).toEqual([421, 497, 428])
    expect([FEED_SKELETON.paycheckBreakdown, FEED_SKELETON.compVesting, FEED_SKELETON.compEvents, FEED_SKELETON.esppLots, FEED_SKELETON.esppOfferings]).toEqual([581, 71, 357, 282, 216])
  })
  it('pins the scope row and its ghost to ONE height, and leaves `:empty` able to hide the row', () => {
    // The sticky row is 0px while ScopeBar has nothing to put in it and ~50px once the owner
    // chips land; on Paycheck, whose only scope control they are, that moved the whole body
    // down 66px (CLS 0.39, motion lane V). ONE rule, both selectors: the ghost cannot drift
    // from the bar it stands in for, because there is only one number to move.
    expect(flat(CSS)).toContain(
      `.scope-bar, .scope-bar-ghost { --m-scope-row: ${SCOPE_ROW}px; min-height: var(--m-scope-row); }`,
    )
    // The reservation belongs to the GHOST, not to the row: a blanket min-height would stand
    // 50px on every page that declares a scope row, including the ones with nothing coming.
    const row = flat(SHELL).match(/\.page-frame-scope \{[^}]*\}/)?.[0] ?? ''
    expect(row).toBeTruthy()
    expect(row).not.toContain('min-height')
    expect(flat(SHELL)).toContain('.page-frame-scope:empty { display: none; }')
    // The collapse is not an event: a household that turns out to be one person takes the
    // ghost away at once — a 50px row sliding shut is the same shift again, slower. (The
    // blocks inside still pulse; that is .skeleton's appearance, not the row's exit.)
    const ghostRules = flat(CSS).match(/\.scope-bar-ghost[^{]*\{[^}]*\}/g) ?? []
    expect(ghostRules.length).toBeGreaterThan(0)
    expect(ghostRules.join(' ')).not.toMatch(/transition|animation/)
  })
})
