// Lane L2's tile instruments (2026-09-25 polish spec §4). Read-only: every probe inserts and
// removes its own zero-size markers inside one evaluate, so React never sees them.
import { sleep } from './harness.mjs'

/** Every visible .kpi-row: its lines (tiles grouped by top), and per tile the value baseline,
 *  the delta's line count, heights and texts. */
export async function tileRows(page) {
  return page.evaluate(() => {
    const round = (n) => Math.round(n * 10) / 10
    const baselineOf = (el) => {
      if (!el) return null
      const mark = document.createElement('i')
      mark.style.cssText = 'display:inline-block;width:0;height:0;margin:0;padding:0;border:0'
      // First line's baseline: the marker rides the first line box (figure span when present).
      const host = el.querySelector('.stat-value-figure') ?? el
      host.insertBefore(mark, host.firstChild)
      const y = mark.getBoundingClientRect().bottom + scrollY
      mark.remove()
      return round(y)
    }
    const linesOf = (el) => {
      if (!el || !el.textContent.trim()) return 0
      const range = document.createRange()
      range.selectNodeContents(el)
      const tops = new Set()
      for (const r of range.getClientRects()) if (r.width > 0.5 && r.height > 0.5) tops.add(Math.round(r.top))
      // Collapse tops within 3px (inline-blocks and text on one line differ by a pixel or two).
      const sorted = [...tops].sort((a, b) => a - b)
      let n = 0, last = -1e9
      for (const t of sorted) { if (t - last > 3) n++; last = t }
      return n
    }
    const rows = []
    for (const row of document.querySelectorAll('.kpi-row')) {
      const rr = row.getBoundingClientRect()
      if (rr.width === 0 || rr.height === 0) continue
      const kids = [...row.children].filter((k) => k.getBoundingClientRect().width > 0)
      const tiles = kids.map((k) => {
        const tile = k.classList.contains('stat-tile') ? k : k.querySelector('.stat-tile') ?? k
        const r = tile.getBoundingClientRect()
        const label = tile.querySelector('.stat-label')
        const value = tile.querySelector('.stat-value')
        const delta = tile.querySelector('.stat-delta')
        const badge = tile.querySelector('.stat-badge')
        return {
          label: (label?.textContent ?? '').trim().slice(0, 40),
          ghost: tile.classList.contains('skeleton-tile'),
          top: round(r.top + scrollY), left: Math.round(r.left), w: Math.round(r.width), h: round(r.height),
          valueBaseline: baselineOf(value),
          valueTop: value ? round(value.getBoundingClientRect().top + scrollY) : null,
          badge: badge ? badge.textContent.trim() : null,
          delta: delta ? delta.textContent.trim().slice(0, 90) : null,
          deltaLines: linesOf(delta),
          deltaTop: delta ? round(delta.getBoundingClientRect().top + scrollY) : null,
          contentGap: (() => { // blank px between the last visible child's bottom and the tile's inner bottom
            const cs = getComputedStyle(tile)
            let bottom = -1e9
            for (const c of tile.children) { const cr = c.getBoundingClientRect(); if (cr.height > 0.5 && c.textContent.trim()) bottom = Math.max(bottom, cr.bottom) }
            return bottom < -1e8 ? null : Math.round(r.bottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth) - bottom)
          })(),
        }
      })
      const lines = []
      for (const t of tiles) {
        const line = lines.find((l) => Math.abs(l.top - t.top) < 3)
        if (line) line.n++
        else lines.push({ top: t.top, n: 1 })
      }
      // The space under the row (2026-09-25 review fix #1): the lowest tile's bottom edge to the top of the
      // next box in flow — a follower's own top margin used to collapse into the row's 1rem.
      const nextInFlow = (el) => {
        for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) {
          for (let sib = cur.nextElementSibling; sib; sib = sib.nextElementSibling) {
            const cs = getComputedStyle(sib)
            if (cs.position === 'absolute' || cs.position === 'fixed' || cs.display === 'none') continue
            const sr = sib.getBoundingClientRect()
            if (sr.height > 0.5 && sr.width > 0.5) return sib
          }
        }
        return null
      }
      const next = nextInFlow(row)
      const tileBottom = Math.max(...kids.map((k) => (k.classList.contains('stat-tile') ? k : k.querySelector('.stat-tile') ?? k).getBoundingClientRect().bottom))
      rows.push({
        cls: row.className,
        top: round(rr.top + scrollY), h: round(rr.height), w: Math.round(rr.width),
        layout: lines.map((l) => l.n).join('+'),
        below: next ? round(next.getBoundingClientRect().top - tileBottom) : null,
        next: next ? `${next.tagName.toLowerCase()}.${String(next.className).split(' ').slice(0, 2).join('.')}` : null,
        tiles,
      })
    }
    return rows
  })
}

/** Per line of a row: the spread of value baselines, and whether every delta is one line. */
export function judge(row) {
  const lines = []
  for (const t of row.tiles) {
    const line = lines.find((l) => Math.abs(l.top - t.top) < 3)
    if (line) line.tiles.push(t)
    else lines.push({ top: t.top, tiles: [t] })
  }
  return lines.map((l) => {
    const bases = l.tiles.map((t) => t.valueBaseline).filter((b) => b !== null)
    const heights = l.tiles.map((t) => t.h)
    return {
      baselineSpread: bases.length ? Math.round((Math.max(...bases) - Math.min(...bases)) * 10) / 10 : null,
      heightSpread: Math.round((Math.max(...heights) - Math.min(...heights)) * 10) / 10,
      maxDeltaLines: Math.max(0, ...l.tiles.map((t) => t.deltaLines)),
      bareTiles: l.tiles.filter((t) => !t.ghost && t.deltaLines === 0).length,
      withDelta: l.tiles.filter((t) => t.deltaLines > 0).length,
      maxContentGap: Math.max(0, ...l.tiles.map((t) => t.contentGap ?? 0)),
    }
  })
}

/** Open a real detail panel and request its supported dock mode. At <1290px the
 * shell deliberately uses an overlay; ESPP's hint-only tiles use the Assistant panel. */
export async function openDock(page) {
  const metric = page.locator('.kpi-row .metric-info-button').first()
  const trigger = await metric.count() > 0 ? 'metric' : 'assistant'
  const btn = trigger === 'metric' ? metric : page.getByRole('button', { name: 'Open assistant', exact: true })
  if (await btn.count() === 0) return false
  await btn.click()
  const panel = page.locator('.detail-panel:not(.is-leaving)')
  await panel.waitFor({ state: 'visible' })
  const dock = panel.getByRole('button', { name: 'Beside the page', exact: true })
  const canDock = await dock.isEnabled()
  if (canDock && await dock.getAttribute('aria-pressed') !== 'true') await dock.click()
  await sleep(700)
  const mode = await panel.evaluate(node => node.classList.contains('detail-panel-dock') ? 'dock' : node.classList.contains('detail-panel-overlay') ? 'overlay' : 'expanded')
  return { opened: true, trigger, canDock, mode, expectedMode: page.viewportSize().width >= 1290 ? 'dock' : 'overlay' }
}

/** Holds every /api/ answer for `ms` so the skeleton shows (a later route runs first; fallback
 *  hands the request on to the harness's read-only fence). */
export async function slowApi(ctx, ms) {
  await ctx.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    await sleep(ms)
    await route.fallback()
  })
}
