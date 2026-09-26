// Real-browser acceptance for polish spec §2–§6/§9. See README.md for the fenced stack contract.
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { baseline, sizes, themes, routes, pairs } from './baseline.mjs'
import { configuration, launch, open, settle, sleep, api } from './harness.mjs'
import { tileRows, judge, openDock, slowApi } from './tiles.mjs'
import * as measure from './measurements.mjs'
import { readEvidence } from './evidence.mjs'

const ALL_GROUPS = ['sidebar', 'pairs', 'layout', 'walk', 'months', 'evidence']
const select = (value, allowed, name) => {
  if (!value) return allowed
  const selected = value.split(',')
  if (selected.some(v => !allowed.includes(v))) throw new Error(`${name} must be one or more of: ${allowed.join(', ')}`)
  return [...new Set(selected)]
}
let config, groups, selectedSizes, selectedThemes, selectedRoutes, evidence
try {
  config = configuration()
  groups = select(process.env.ONLY_GROUP, ALL_GROUPS, 'ONLY_GROUP')
  selectedSizes = select(process.env.ONLY_SIZE, sizes.map(([w, h]) => `${w}x${h}`), 'ONLY_SIZE').map(size => size.split('x').map(Number))
  selectedThemes = select(process.env.ONLY_THEME, themes, 'ONLY_THEME')
  selectedRoutes = select(process.env.ONLY_ROUTE, routes.map(([name]) => name), 'ONLY_ROUTE')
  evidence = readEvidence(process.env.EVIDENCE_MANIFEST)
} catch (error) { console.error(`POLISH V REFUSED: ${error.message}`); process.exit(2) }

const report = {
  startedAt: new Date().toISOString(), preparation: config.prepare, productHead: config.productHead ?? null, probeHead: config.head,
  scope: 'Read-only integrated browser matrix plus explicitly historical lane mutation evidence',
  transport: 'All /api reads forwarded to explicit loopback backend; UI prefs overlaid in memory; all other mutations fenced',
  base: config.base, apiBase: config.apiBase, source: config.source, baseline,
  filters: { groups, sizes: selectedSizes, themes: selectedThemes, routes: selectedRoutes },
  checks: [], cases: [], evidence, driverErrors: [], screenshots: [], completeMatrix: false, fullAcceptance: false,
}
const save = () => writeFileSync(path.join(config.out, 'report.json'), JSON.stringify(report, null, 2))
const check = (caseId, name, ok, observed, before = undefined) => {
  const result = { caseId, name, ok: !!ok, observed, ...(before === undefined ? {} : { before }) }
  report.checks.push(result)
  if (!result.ok) console.log('FAIL', caseId, name, JSON.stringify(observed).slice(0, 450))
  return result.ok
}
const has = group => groups.includes(group)
const snap = async (page, name, fullPage = false) => {
  const file = path.join(config.out, 'shots', name.replace(/[^a-z0-9-]/gi, '-') + '.png')
  await page.screenshot({ path: file, fullPage })
  report.screenshots.push(file)
}
const visit = async (page, url) => {
  await page.goto(config.base + url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await settle(page)
  if (await page.locator('.route-fallback').count()) throw new Error(`Route fallback at ${url}`)
  // A timeout is a coverage failure; never silently measure a ghost as the settled row.
  await page.waitForFunction(() => !document.querySelector('.kpi-row .skeleton-tile'), null, { timeout: 25000 })
  const section = new URL(config.base + url).searchParams.get('section')
  if (section) await page.locator(`[role="tabpanel"][id$="-section-${section}"]:visible`).waitFor({ state: 'visible', timeout: 10000 })
}
const groupByTop = cards => {
  const rows = []
  for (const card of cards) { const row = rows.find(r => Math.abs(r[0].top - card.top) <= 1); if (row) row.push(card); else rows.push([card]) }
  return rows
}

let browser
async function runCase(group, options, action) {
  const id = `${group}-${options.theme}-${options.width}x${options.height}${options.density ? '-' + options.density : ''}`
  const context = await open(browser, config, options)
  const startChecks = report.checks.length
  try { await action(context.page, id) } catch (error) {
    report.driverErrors.push({ caseId: id, message: error.message, stack: error.stack })
    check(id, 'Driver completed every requested assertion', false, error.message)
    await snap(context.page, id + '-driver-error').catch(() => {})
  } finally {
    const log = context.log
    check(id, 'No console/page/network/native-dialog/fenced-write errors',
      ['consoleErrors', 'pageErrors', 'badResponses', 'requestFailures', 'dialogs', 'writesBlocked'].every(key => log[key].length === 0), log)
    report.cases.push({ id, ...options, checks: report.checks.length - startChecks, log })
    await context.close()
    save()
    console.log('DONE', id, 'checks', report.checks.length - startChecks)
  }
}

function assertTiles(id, rows, oneLine = false) {
  for (const [index, row] of rows.entries()) {
    const counts = row.layout.split('+').map(Number)
    const lastFull = row.tiles.length === 5 && counts.join('+') === '2+2+1' && row.tiles.at(-1).w >= row.w - 2
    check(id, `Tile row ${index + 1} has no orphan fifth tile`, row.tiles.length !== 5 || ['5', '3+2'].includes(row.layout) || lastFull, { layout: row.layout, width: row.w, lastTileWidth: row.tiles.at(-1)?.w })
    for (const [line, metrics] of judge(row).entries()) {
      check(id, `Tile row ${index + 1}, visual line ${line + 1}: baseline and height align`, metrics.baselineSpread !== null && metrics.baselineSpread <= 1 && metrics.heightSpread <= 1, metrics, baseline.badgeValueOffset)
      if (oneLine) check(id, `Tile row ${index + 1}, visual line ${line + 1}: deltas fit one line`, metrics.maxDeltaLines <= 1, row.tiles.map(tile => ({ label: tile.label, lines: tile.deltaLines, delta: tile.delta })))
    }
  }
}

async function sidebarGroup(options) {
  for (const density of ['comfortable', 'compact']) await runCase('sidebar', { ...options, density }, async (page, id) => {
    await visit(page, '/guide')
    const observed = await measure.sidebar(page)
    check(id, 'Sidebar fits viewport', observed && observed.overflow <= 1, observed, (density === 'compact' ? baseline.compactSidebarOverflow : baseline.sidebarOverflow)[`${options.width}x${options.height}`])
    check(id, 'Footer has one row and both 28px buttons fully visible', observed?.footerRows === 1 && observed?.buttons.length === 2 && observed.buttons.every(b => b.visible && Math.abs(b.width - 28) <= 1 && Math.abs(b.height - 28) <= 1), observed?.buttons)
    check(id, 'Search label is intact; all navigation links present', observed?.searchText?.trim() === 'Search…' && observed.searchTruncated === false && observed.links.length === 14, { search: observed?.searchText, truncated: observed?.searchTruncated, links: observed?.links })
    await snap(page, id)
  })
}

async function pairsGroup(options) {
  await runCase('pairs', options, async (page, id) => {
    const cards = await api(config, 'credit-cards')
    for (const pair of pairs) {
      const url = pair.name === 'card' ? `/credit-cards?card=${encodeURIComponent(cards.find(card => card.is_active)?.slug ?? cards[0]?.slug ?? '')}` : pair.url
      if (pair.name === 'card' && !cards.length) throw new Error('No copied card available for detail pair coverage')
      await visit(page, url)
      const inspect = async state => {
        const a = await measure.cardBox(page, pair.a), b = await measure.cardBox(page, pair.b)
        const difference = a && b ? Math.abs(a.bottom - b.bottom) : null
        check(id, `${pair.name}: bottoms align (${state})`, difference !== null && difference <= 1, { difference, a, b }, baseline.pairBottomDifference[pair.name])
        if (pair.name === 'trends') check(id, `Trends: linked plot axes align (${state})`, !!a && !!b && a.plotTop !== null && b.plotTop !== null && Math.abs(a.plotTop - b.plotTop) <= 1 && Math.abs(a.plotBottom - b.plotBottom) <= 1, { a, b })
      }
      await inspect('closed')
      await snap(page, `${id}-${pair.name}`)
      for (const key of [pair.a, pair.b].filter(key => !key.startsWith('@'))) {
        await measure.toggleTable(page, key); await sleep(900); await inspect(`Table ${key} open`)
        const table = await measure.tableBox(page, key)
        check(id, `${pair.name}: ${key} Table appeared and is revealed below sticky block`, table !== null && table.visible >= Math.min(table.height, table.available) - 1, table, { visible: baseline.chartTableVisiblePx })
        await measure.toggleTable(page, key); await sleep(450); await inspect(`Table ${key} closed again`)
        check(id, `${pair.name}: ${key} Table closes`, await measure.tableBox(page, key) === null, await measure.tableBox(page, key))
      }
      if (pair.name === 'trends') {
        await page.getByRole('button', { name: 'All categories', exact: true }).click(); await settle(page, 350)
        const a = await measure.cardBox(page, pair.a), b = await measure.cardBox(page, pair.b)
        check(id, 'All categories makes both Trends cards full width', !!a && !!b && a.gridWidth > 0 && b.gridWidth > 0 && Math.abs(a.width - a.gridWidth) <= 1 && Math.abs(b.width - b.gridWidth) <= 1 && b.top >= a.bottom - 1, { a, b })
      }
    }
  })
}

async function layoutGroup(options) {
  await runCase('layout', options, async (page, id) => {
    await visit(page, '/')
    for (const state of ['closed', 'open', 'closed-again']) {
      if (state !== 'closed') { await measure.toggleTable(page, 'Net worth trend'); await sleep(450) }
      const observed = await measure.overview(page)
      check(id, `Overview columns and Changes blank band (${state})`, observed.columns !== null && observed.columns <= 1 && observed.changesBlank !== null && observed.changesBlank <= 24, observed, { changesBlank: baseline.changesBlank })
      if (state === 'open') {
        const table = await measure.tableBox(page, 'Net worth trend')
        check(id, 'Overview trend Table reveals below sticky block', table !== null && table.visible >= Math.min(table.height, table.available) - 1, table)
      }
    }
    await page.getByRole('button', { name: 'Customize', exact: true }).click()
    const customize = page.getByRole('dialog', { name: 'Customize overview', exact: true })
    for (const name of ['Portfolio performance', 'Recent spending']) {
      for (const visible of [false, true]) {
        await customize.getByRole('checkbox', { name, exact: true }).setChecked(visible)
        await sleep(350)
        const observed = await measure.deeperRows(page)
        check(id, `Customize ${name} ${visible ? 'shown' : 'hidden'} fills each row`, observed !== null && observed.rows.length > 0 && observed.rows.every(row => Math.abs(row.left - observed.left) <= 1 && Math.abs(row.right - observed.right) <= 1) && observed.overflow <= 1, observed)
      }
    }
    await customize.getByRole('button', { name: 'Done', exact: true }).click()
    for (const tab of ['household', 'planning', 'account', 'integrations', 'data']) {
      await visit(page, `/settings?section=${tab}`)
      await page.getByRole('tab', { name: tab[0].toUpperCase() + tab.slice(1), exact: true }).click()
      await settle(page, 250)
      const cards = await measure.settings(page)
      check(id, `Settings ${tab}: cards are present`, cards.length > 0, cards.length)
      for (const row of groupByTop(cards)) {
        check(id, `Settings ${tab}: row ${row.map(c => c.id).join('/')} bottoms align`, measure.spread(row.map(c => c.bottom)) <= 1, row)
        check(id, `Settings ${tab}: action blank bands <=96px`, row.every(c => c.bands.every(b => b <= 96)), row.map(c => ({ id: c.id, bands: c.bands })), tab === 'household' ? baseline.settingsHouseholdHole : undefined)
      }
      if ([1440, 1920].includes(options.width)) {
        const natural = await measure.settings(page, true)
        for (const row of groupByTop(cards).filter(row => row.length > 1)) {
          const partners = natural.filter(c => row.some(r => r.id === c.id))
          const relativeSpread = measure.spread(partners.map(c => c.height)) / Math.max(...partners.map(c => c.height))
          // The approved table explicitly keeps Appearance/Password. Report its spread without inventing a new rule.
          if (tab !== 'account') check(id, `Settings ${tab}: natural-height difference <=15%`, relativeSpread <= .15, { partners, relativeSpread })
        }
      }
      await snap(page, `${id}-settings-${tab}`, true)
    }
    await visit(page, '/calendar')
    const calendar = await measure.calendar(page)
    check(id, 'Calendar weekday labels to first week <=12px', calendar !== null && calendar.band <= 12, calendar, baseline.calendarHeaderBand)
    await visit(page, '/taxes?section=tables')
    const tax = await measure.taxColumns(page)
    const assertTaxColumns = (tax, state) => check(id, `Tax tables follow page container and CSS stack gap (${state})`, tax.groups.length > 0 && tax.columnCount === tax.expectedColumns && tax.cssGap !== null && tax.gaps.every(gap => Math.abs(gap - tax.cssGap) <= 1), tax, baseline.taxTableRaggedGap)
    assertTaxColumns(tax, 'dock closed')
    await page.getByRole('tab', { name: 'Summary', exact: true }).click(); await settle(page, 250)
    const dockOpened = await openDock(page)
    check(id, 'Tax table dock/narrow case exercised', dockOpened, { dockOpened })
    if (dockOpened) {
      await page.getByRole('tab', { name: 'Tax tables', exact: true }).click(); await settle(page, 250)
      assertTaxColumns(await measure.taxColumns(page), 'dock open')
    }
    await visit(page, '/portfolio?section=allocation')
    const allocation = []
    for (const dimension of ['Asset class', 'Industry', 'Geography', 'Account', 'Holding type']) {
      await page.getByRole('group', { name: 'Allocation dimension', exact: true }).getByRole('button', { name: dimension, exact: true }).click()
      await settle(page, 200)
      allocation.push({ dimension, ...(await measure.allocation(page)) })
    }
    check(id, 'Allocation card height is constant across all five dimensions', allocation.every(a => a.height > 0 && a.asideContained) && measure.spread(allocation.map(a => a.height)) <= 1, allocation, baseline.allocationHeightSpread)
    for (const [url, selector, label, before] of [
      ['/spending?section=budgets', '.budget-row .budget-meter', 'Budget', baseline.budgetMeterEndSpread],
      ['/paycheck', '.pace-row .pace-meter', 'Pace', baseline.paceMeterEndSpread],
    ]) {
      await visit(page, url)
      const ends = await measure.meterEnds(page, selector)
      check(id, `${label} meter ends align`, ends.length > 1 && measure.spread(ends.map(m => m.right)) <= 1, ends, before)
      if (label === 'Budget') check(id, 'Budget tracks remain visible against card', ends.length > 0 && ends.every(m => m.background !== m.cardBackground), ends)
    }
    await visit(page, '/guide')
    const foot = page.locator('.guide-detail-foot').first()
    await foot.waitFor({ state: 'visible' })
    check(id, 'Numbered Guide has progress', /Step 1 of \d+/.test(await foot.innerText()), await foot.innerText())
    await foot.getByRole('button', { name: /^Next/ }).click(); await sleep(150)
    check(id, 'Guide Next selects step 2 and retains focused rail selection', /Step 2 of \d+/.test(await foot.innerText()) && await page.locator('[aria-selected="true"]:focus, [aria-current="step"]:focus, .guide-rail [aria-current="true"]:focus').count() > 0, { text: await foot.innerText(), focus: await measure.activeFocus(page) })
    await foot.getByRole('button', { name: /^Previous/ }).click(); await sleep(150)
    check(id, 'Guide Previous returns step 1 and selected rail focus', /Step 1 of \d+/.test(await foot.innerText()) && await page.locator('.guide-rail [aria-selected="true"]:focus').count() === 1, { text: await foot.innerText(), focus: await measure.activeFocus(page) })
    await visit(page, '/guide?section=pages')
    const unnumbered = page.locator('.guide-detail-foot').first()
    await unnumbered.waitFor({ state: 'visible' })
    check(id, 'Unnumbered Guide rail has Next and no Previous/progress count', await unnumbered.getByRole('button', { name: /^Next/ }).count() === 1 && await unnumbered.getByRole('button', { name: /^Previous/ }).count() === 0 && !/Step \d+ of/.test(await unnumbered.innerText()), await unnumbered.innerText())
    await unnumbered.getByRole('button', { name: /^Next/ }).click(); await sleep(150)
    check(id, 'Unnumbered Guide Next focuses selected rail', await page.locator('.guide-rail [aria-selected="true"]:focus').count() === 1, await measure.activeFocus(page))
    for (const route of ['/net-worth', '/taxes', '/spending']) {
      await visit(page, route)
      const title = await page.locator('section.chart-card h2').first().innerText()
      await measure.toggleTable(page, title); await sleep(900)
      const table = await measure.tableBox(page, title)
      check(id, `${route}: chart Table revealed below sticky block`, table !== null && table.visible >= Math.min(table.height, table.available) - 1, table, { visible: baseline.chartTableVisiblePx })
    }
  })
}

async function walkGroup(options) {
  for (const [name, url] of routes.filter(([name]) => selectedRoutes.includes(name))) await runCase(`walk-${name}`, options, async (page, id) => {
    const fiveSkeleton = ['projection', 'calendar', 'portfolio', 'espp'].includes(name)
    // A deliberate slow response makes the cold skeleton observable; an unobserved skeleton is not a pass.
    if (fiveSkeleton) await slowApi(page.context(), 750)
    let actualUrl = url
    if (name === 'card-detail') {
      const cards = await api(config, 'credit-cards'), card = cards.find(card => card.is_active) ?? cards[0]
      if (!card) throw new Error('No copied card available for detail route coverage')
      actualUrl = `/credit-cards?card=${encodeURIComponent(card.slug)}`
    }
    await visit(page, actualUrl)
    if (name === 'card-detail') await page.locator('.card-detail').waitFor({ state: 'visible' })
    const observed = await page.evaluate(() => ({ ...window.__polishV, url: location.pathname + location.search, heading: document.querySelector('h1')?.textContent, overflow: document.documentElement.scrollWidth - innerWidth, selectedTab: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent }))
    check(id, 'Route has content and no horizontal page overflow', !!observed.heading && observed.overflow <= 1, observed)
    check(id, 'Cold route CLS is below0.1', observed.cls < .1, { cls: observed.cls, shifts: observed.shifts })
    check(id, 'Observed skeletons contain no 4+1 orphan', observed.skeletonLayouts.every(layout => layout !== '4+1'), observed.skeletonLayouts)
    if (fiveSkeleton) {
      const fiveRows = observed.skeletonRows.filter(row => row.count === 5)
      check(id, 'Cold five-tile skeleton was observed and filled each visual row', fiveRows.length > 0 && fiveRows.every(row => ['5', '3+2'].includes(row.layout) || (row.layout === '2+2+1' && row.lastWidth >= row.width - 1)), { delayMs: 750, rows: observed.skeletonRows })
    }
    const rows = await tileRows(page)
    assertTiles(id, rows, options.width === 1440 && ['overview', 'networth', 'spending'].includes(name))
    const expectedRows = { overview: 1, networth: 1, spending: 1, projection: 1, calendar: 1, portfolio: 1, espp: 1, paycheck: 1, cards: 1, taxes: 1, 'tax-whatif': 1, 'tax-whatif-sale': 1, vesting: 1, income: 1, 'update-review': 1 }
    if (expectedRows[name]) check(id, 'Expected real tile row arrived (absence is a coverage failure)', rows.length >= expectedRows[name] && rows.every(row => row.tiles.every(tile => !tile.ghost)), rows.map(row => ({ layout: row.layout, height: row.h })))
    if (name.startsWith('tax-whatif')) check(id, 'Computed What-if result tiles are present', await page.locator('.whatif-result .kpi-row .stat-tile').count() >= (name === 'tax-whatif-sale' ? 4 : 3), { requested: url, tiles: await page.locator('.whatif-result .kpi-row .stat-tile').count() })
    if (rows.some(row => row.tiles.length === 5)) {
      const opened = await openDock(page)
      check(id, 'Five-tile row dock interaction is exercised', opened, { opened })
      if (opened) assertTiles(id + '-dock', await tileRows(page))
    }
    if (options.width === 1440 || options.width === 1280 || report.checks.slice(-10).some(check => !check.ok)) await snap(page, id)
  })
}

async function monthsGroup(options) {
  const nw = (await api(config, 'net-worth/timeseries?granularity=monthly')).months
  const sp = (await api(config, 'spending/matrix')).months
  await runCase('months', options, async (page, id) => {
    for (const [route, offered] of [['/net-worth', nw], ['/spending', sp]]) {
      const months = [...new Set(offered.map(month => month.slice(0, 7)))].sort()
      const observed = []
      // Cold route loading is covered separately. Traverse the actual ribbon here so every
      // selected month is checked without needlessly reloading the entire application.
      await visit(page, `${route}?month=${months[0]}`)
      for (const month of months) {
        const expectedLabel = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`))
        const chip = page.locator(`.month-chip2[aria-label^="${expectedLabel} "]`)
        for (let window = 0; await chip.count() === 0 && window < 10; window++) {
          const later = page.getByRole('button', { name: 'Later months', exact: true })
          if (await later.getAttribute('aria-disabled') === 'true') throw new Error(`No ribbon window contains requested ${month}`)
          await later.click()
        }
        if (await chip.getAttribute('aria-pressed') !== 'true') {
          await chip.click()
          await settle(page, 250)
          await page.waitForFunction(() => !document.querySelector('.kpi-row .skeleton-tile'), null, { timeout: 25000 })
        }
        const row = (await tileRows(page))[0]
        const selected = await page.locator('.month-chip2[aria-pressed="true"]').getAttribute('aria-label')
        check(id, `${route}: requested ${month} is the selected ribbon month`, !!selected && selected.startsWith(expectedLabel + ' '), { requested: month, selected, url: page.url() })
        observed.push({ month, selected, height: row?.h ?? null, lines: row ? judge(row) : null })
      }
      check(id, `${route}: every offered month has stable tile-row height`, observed.length > 1 && observed.every(o => o.height !== null) && measure.spread(observed.map(o => o.height)) <= 1, observed, route === '/net-worth' ? baseline.netWorthMonthHeights : undefined)
    }
  })
}

try {
  await api(config, 'auth/me')
  browser = await launch()
  for (const [width, height] of selectedSizes) for (const theme of selectedThemes) {
    const options = { width, height, theme }
    if (has('sidebar')) await sidebarGroup(options)
    if (has('pairs')) await pairsGroup(options)
    if (has('layout')) await layoutGroup(options)
    if (has('walk')) await walkGroup(options)
    if (has('months')) await monthsGroup(options)
  }
  if (has('evidence')) for (const lane of ['L5', 'L6', 'L7', 'L8']) {
    const artifacts = evidence.filter(e => e.lane === lane)
    check('historical-evidence', `${lane}: mutation artifacts are present and explicitly attributed`, artifacts.some(e => e.status === 'passed') && artifacts.every(e => e.note || e.status !== 'partial'), artifacts)
  }
} catch (error) {
  report.driverErrors.push({ message: error.message, stack: error.stack })
  console.error(error.message)
} finally {
  if (browser) await browser.close()
  report.completedAt = new Date().toISOString()
  report.completeMatrix = !config.prepare && selectedSizes.length === sizes.length && selectedThemes.length === themes.length && groups.length === ALL_GROUPS.length && selectedRoutes.length === routes.length && !report.driverErrors.length && report.checks.length > 0 && report.checks.every(c => c.ok)
  // Fresh integrated mutation flows + merged-main code gates are separate required evidence.
  report.fullAcceptance = false
  report.summary = { passed: report.checks.filter(c => c.ok).length, failed: report.checks.filter(c => !c.ok).length, cases: report.cases.length, driverErrors: report.driverErrors.length }
  save()
  console.log(config.prepare ? 'POLISH V PREPARATION' : 'POLISH V MATRIX', JSON.stringify(report.summary), path.join(config.out, 'report.json'))
  if (report.summary.failed || report.driverErrors.length || !report.checks.length) process.exitCode = 1
}
