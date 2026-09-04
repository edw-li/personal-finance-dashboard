import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CARD_CHROME, CHART_CARD_ROWS, FEED_SKELETON, OWNER_STRIP, STAT_TILE, chartCardBox, ghostCardBody } from './skeletonMetrics'

const CSS = readFileSync(path.join(__dirname, 'panels.css'), 'utf8')
describe('skeletonMetrics', () => {
  it('mirrors the CSS variables panels.css declares — a two-way pin, so neither can drift', () => {
    // The stylesheet owns the row heights; this module only names them. A number that moves in
    // one place and not the other is the layout shift coming straight back.
    expect(CSS).toContain(`--m-export-row: ${CHART_CARD_ROWS.exportRow}px`)
    expect(CSS).toContain(`--m-zoom-row: ${CHART_CARD_ROWS.zoom}px`)
    expect(CSS).toContain(`--m-caption-row: ${CHART_CARD_ROWS.caption}px`)
    expect(CSS).toContain(`--m-stat-tile: ${STAT_TILE}px`)
    expect(CSS).toContain(`--m-owner-strip: ${OWNER_STRIP}px`)
  })
  it('converts an outer box to a ghost BODY (never negative), sizes a chart card, derives each feed', () => {
    expect([ghostCardBody(491), ghostCardBody(20), chartCardBox(320), chartCardBox(360, { zoomable: true })]).toEqual([491 - CARD_CHROME, 0, 420, 481])
    expect([FEED_SKELETON.paycheckBreakdown, FEED_SKELETON.compVesting, FEED_SKELETON.esppLots, FEED_SKELETON.esppOfferings]).toEqual([581, 71, 282, 216])
  })
})
