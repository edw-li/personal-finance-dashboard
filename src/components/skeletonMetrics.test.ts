import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CARD_CHROME, CHART_CARD_ROWS, FEED_SKELETON, OWNER_STRIP, STAT_TILE, XFADE_MS, chartCardBox, ghostCardBody } from './skeletonMetrics'

const CSS = readFileSync(path.join(__dirname, 'panels.css'), 'utf8')
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
    expect(CSS).toContain(`var(--t-xfade, ${XFADE_MS}ms)`)
  })
  it('converts an outer box to a ghost BODY (never negative), sizes a chart card, derives each feed', () => {
    expect([ghostCardBody(491), ghostCardBody(20)]).toEqual([491 - CARD_CHROME, 0])
    // A real header is not the ghost's stand-in label: charging CARD_CHROME here under-counted a
    // card with controls by 21px and over-counted a bare one by 6.
    expect([chartCardBox(320), chartCardBox(360, { controls: true, zoomable: true }), chartCardBox(280, { zoomable: true, footer: true })]).toEqual([421, 497, 428])
    expect([FEED_SKELETON.paycheckBreakdown, FEED_SKELETON.compVesting, FEED_SKELETON.compEvents, FEED_SKELETON.esppLots, FEED_SKELETON.esppOfferings]).toEqual([581, 71, 357, 282, 216])
  })
})
