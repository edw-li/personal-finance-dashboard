// Derived from the 2026-09-24 audit harness; all network targets must be explicit loopback URLs.
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
export function loopback(value, name) {
  if (!value) throw new Error(`${name} is required`)
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/') {
    throw new Error(`${name} must be an explicit http://127.0.0.1:<private-port> origin`)
  }
  return url.origin
}

export function configuration({ writable = false } = {}) {
  const prepare = process.env.PREPARE === '1'
  const base = loopback(process.env.APP_BASE, 'APP_BASE')
  const apiBase = loopback(process.env.API_BASE, 'API_BASE')
  if (writable && (base !== 'http://127.0.0.1:5280' || apiBase !== 'http://127.0.0.1:8091')) throw new Error('Writable flow harness is restricted to the private V twin on5280/8091')
  if (!process.env.TOKEN_FILE) throw new Error('TOKEN_FILE is required (never put tokens in command arguments)')
  const token = readFileSync(process.env.TOKEN_FILE, 'utf8').trim()
  if (!token) throw new Error('TOKEN_FILE is empty')
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const productHead = process.env.EXPECT_HEAD
  let source = null
  if (process.env.SOURCE_MANIFEST) source = JSON.parse(readFileSync(process.env.SOURCE_MANIFEST, 'utf8'))
  if (!prepare) {
    if (!productHead || productHead.startsWith('204ef73d')) throw new Error('EXPECT_HEAD must name the final merged L5–L8 main')
    execFileSync('git', ['merge-base', '--is-ancestor', productHead, 'HEAD'])
    if (!source || source.acquisition !== 'production-read-only-pg_dump' || !source.sha256 || !source.acquiredAt ||
        source.readDatabase !== 'finance_polish_v_read' || source.writeDatabase !== 'finance_polish_v_write') {
      throw new Error('Final acceptance needs SOURCE_MANIFEST with fresh pg_dump provenance and the two private V databases')
    }
    const age = Date.now() - Date.parse(source.acquiredAt)
    if (!Number.isFinite(age) || age < 0 || age > 48 * 3600_000) throw new Error('The final source copy must be less than 48 hours old')
    if (apiBase !== (writable ? 'http://127.0.0.1:8091' : 'http://127.0.0.1:8089')) throw new Error('Final matrix/flows must use their dedicated V backend')
  }
  const out = path.resolve(process.env.SMOKE_OUT ?? 'scratchpad/polish-v')
  mkdirSync(path.join(out, 'shots'), { recursive: true })
  return { prepare, writable, base, apiBase, token, head, productHead, source, out }
}

export async function launch() {
  if (os.freemem() < 700 * 1024 * 1024) throw new Error('Less than 700MB free; yield the browser slot and retry later')
  // The installed playwright-core requires Node >=20; the established box harness uses this for Node18.
  if (Number(process.versions.node.split('.')[0]) < 20) {
    Object.defineProperty(process, 'version', { value: 'v20.19.0' })
    Object.defineProperty(process.versions, 'node', { value: '20.19.0' })
  }
  const require = createRequire(import.meta.url)
  let playwright
  try { playwright = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core') } catch {
    if (process.env.PLAYWRIGHT_CORE) throw new Error('PLAYWRIGHT_CORE could not be loaded')
    throw new Error('Set PLAYWRIGHT_CORE to the installed playwright-core module path')
  }
  return playwright.chromium.launch({
    executablePath: process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  })
}

const readPosts = [/\/taxes\/what-if$/, /\/taxes\/years\/\d+\/inputs\/preview$/, /\/paycheck\/preview$/, /\/assistant\/context-preview$/, /\/auth\/renew$/]
export async function open(browser, config, { theme, width, height, density = 'comfortable', reducedMotion = 'no-preference' }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion })
  const log = { consoleErrors: [], pageErrors: [], badResponses: [], requestFailures: [], dialogs: [], writesBlocked: [], writesAllowed: [], prefsWrites: [], retries: [] }
  const prefs = { theme: { value: theme }, density: { value: density } }
  const deleted = new Set()
  await ctx.addInitScript(({ token, theme, density }) => {
    localStorage.setItem('finance_token', token)
    localStorage.setItem('finance.theme', theme)
    localStorage.setItem('finance.density', density)
  }, { token: config.token, theme, density })
  await ctx.addInitScript(() => {
    window.__polishV = { cls: 0, shifts: [], skeletonLayouts: [], skeletonRows: [] }
    const desc = e => e ? `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${String(e.className).split(' ').slice(0, 3).join('.')}` : null
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) {
        window.__polishV.cls += entry.value
        window.__polishV.shifts.push({ value: entry.value, time: entry.startTime, sources: entry.sources?.map(s => ({ node: desc(s.node), previous: s.previousRect.toJSON(), current: s.currentRect.toJSON() })) })
      }
    }).observe({ type: 'layout-shift', buffered: true })
    const observer = new MutationObserver(() => {
      for (const row of document.querySelectorAll('.kpi-row:has(.skeleton-tile)')) {
        const boxes = [...row.children].map(el => el.getBoundingClientRect()).filter(r => r.width && r.height)
        const groups = []
        for (const box of boxes) { const group = groups.find(g => Math.abs(g.top - box.top) <= 1); if (group) group.count++; else groups.push({ top: box.top, count: 1 }) }
        const layout = groups.map(g => g.count).join('+')
        if (layout && !window.__polishV.skeletonLayouts.includes(layout)) window.__polishV.skeletonLayouts.push(layout)
        const measured = { layout, count: boxes.length, width: row.getBoundingClientRect().width, lastWidth: boxes.at(-1)?.width ?? 0 }
        if (layout && !window.__polishV.skeletonRows.some(previous => JSON.stringify(previous) === JSON.stringify(measured))) window.__polishV.skeletonRows.push(measured)
      }
    })
    observer.observe(document, { childList: true, subtree: true })
  })
  await ctx.route(url => url.pathname.startsWith('/api/'), async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method()
    const target = config.apiBase + url.pathname + url.search
    const isPrefs = url.pathname === '/api/v1/prefs' || url.pathname.startsWith('/api/v1/prefs/')
    try {
      if (isPrefs && method !== 'GET') {
        log.prefsWrites.push({ method, path: url.pathname })
        if (method === 'PATCH') for (const [key, value] of Object.entries(JSON.parse(req.postData() ?? '{}'))) { prefs[key] = { value }; deleted.delete(key) }
        else if (method === 'DELETE') { const key = decodeURIComponent(url.pathname.split('/').at(-1)); delete prefs[key]; deleted.add(key) }
        else throw new Error(`Unexpected preference method ${method}`)
        const response = await ctx.request.get(config.apiBase + '/api/v1/prefs', { headers: { authorization: `Bearer ${config.token}` } })
        const real = await response.json()
        for (const key of deleted) delete real.prefs[key]
        return route.fulfill({ status: method === 'DELETE' ? 204 : 200, contentType: 'application/json', body: method === 'DELETE' ? '' : JSON.stringify({ ...real, prefs: { ...real.prefs, ...prefs } }) })
      }
      const allowed = ['GET', 'HEAD', 'OPTIONS'].includes(method) || (method === 'POST' && readPosts.some(re => re.test(url.pathname)))
      if (!allowed && !config.writable) {
        log.writesBlocked.push({ method, path: url.pathname })
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Verification write fence: this is the read-only stack' }) })
      }
      if (!allowed) log.writesAllowed.push({ method, path: url.pathname })
      let response
      try { response = await route.fetch({ url: target, timeout: 25000 }) } catch (error) {
        if (method !== 'GET') throw error
        log.retries.push({ path: url.pathname, error: String(error.message).split('\n')[0] })
        response = await route.fetch({ url: target, timeout: 25000 })
      }
      if (isPrefs && method === 'GET') {
        const body = await response.json()
        for (const key of deleted) delete body.prefs[key]
        return route.fulfill({ response, json: { ...body, prefs: { ...body.prefs, ...prefs } } })
      }
      return route.fulfill({ response })
    } catch (error) {
      log.requestFailures.push({ method, path: url.pathname, message: String(error.message).split('\n')[0] })
      await route.abort().catch(() => {})
    }
  })
  const page = await ctx.newPage()
  page.on('console', message => { if (message.type() === 'error') log.consoleErrors.push(message.text().slice(0, 600)) })
  page.on('pageerror', error => log.pageErrors.push(error.message))
  page.on('dialog', dialog => { log.dialogs.push({ type: dialog.type(), message: dialog.message() }); void dialog.dismiss() })
  page.on('response', response => { if (response.status() >= 400) log.badResponses.push({ status: response.status(), path: new URL(response.url()).pathname }) })
  return { ctx, page, log, close: () => ctx.close() }
}

export async function settle(page, extra = 500) {
  await page.waitForLoadState('networkidle', { timeout: 30000 })
  await page.locator('#main').waitFor({ state: 'visible' })
  await page.evaluate(() => document.fonts.ready)
  await sleep(extra)
}

export async function api(config, pathname) {
  const response = await fetch(config.apiBase + '/api/v1/' + pathname, { headers: { authorization: `Bearer ${config.token}` } })
  if (!response.ok) throw new Error(`Read API ${pathname} returned ${response.status}`)
  return response.json()
}
