// Selectors and geometry recovered from L1/L5's browser probes; retain subpixel measurements.
export const spread = values => values.length ? Math.max(...values) - Math.min(...values) : null

export async function sidebar(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.sidebar'), search = root?.querySelector('.sidebar-search span')
    if (!root) return null
    return {
      overflow: root.scrollHeight - root.clientHeight,
      footerRows: (() => {
        const centers = [...root.querySelectorAll('.sidebar-footer > *')].map(el => el.getBoundingClientRect()).filter(r => r.width && r.height).map(r => (r.top + r.bottom) / 2)
        return centers.length ? Math.max(...centers) - Math.min(...centers) <= 1 ? 1 : 2 : 0
      })(),
      searchText: search?.textContent, searchTruncated: search ? search.scrollWidth > search.clientWidth : null,
      links: [...root.querySelectorAll('nav .nav-link')].map(a => ({ href: a.getAttribute('href'), top: a.getBoundingClientRect().top })),
      buttons: [...root.querySelectorAll('.sidebar-footer button')].map(b => {
        const r = b.getBoundingClientRect()
        return { name: b.getAttribute('aria-label'), width: r.width, height: r.height, top: r.top, bottom: r.bottom, visible: r.top >= 0 && r.bottom <= innerHeight }
      }),
    }
  })
}

export async function cardBox(page, key) {
  return page.evaluate(key => {
    const card = key === '@breakdown' ? document.querySelector('.paycheck-summary-grid > .card')
      : key === '@credits' ? document.querySelector('.card-detail .card-grid > .card')
        : [...document.querySelectorAll('section.chart-card')].find(el => el.querySelector('h2')?.textContent.includes(key))
    if (!card) return null
    const box = card.getBoundingClientRect(), plot = card.querySelector('[role="img"]')?.getBoundingClientRect()
    return { top: box.top + scrollY, bottom: box.bottom + scrollY, width: box.width, height: box.height, gridWidth: card.closest('.card-grid')?.getBoundingClientRect().width ?? null, plotTop: plot ? plot.top + scrollY : null, plotBottom: plot ? plot.bottom + scrollY : null }
  }, key)
}

export async function toggleTable(page, key) {
  const button = page.locator('section.chart-card').filter({ has: page.locator('h2').filter({ hasText: key }) }).getByRole('button', { name: 'Table', exact: true })
  if (await button.count() !== 1) throw new Error(`Expected one Table control for ${key}, found ${await button.count()}`)
  await button.click()
}

export async function tableBox(page, key) {
  return page.evaluate(key => {
    const card = [...document.querySelectorAll('section.chart-card')].find(el => el.querySelector('h2')?.textContent.includes(key))
    const table = card?.querySelector('.chart-table'), r = table?.getBoundingClientRect()
    if (!r || r.width === 0 || r.height === 0) return null
    const inset = Math.max(0, ...[...document.querySelectorAll('[data-frame-part="scope"]')].map(el => el.getBoundingClientRect()).filter(box => box.top <= 1 && box.bottom > 0).map(box => box.bottom))
    return { top: r.top, bottom: r.bottom, height: r.height, inset, visible: Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(inset, r.top)), available: innerHeight - inset }
  }, key)
}

export async function deeperRows(page) {
  return page.evaluate(() => {
    const grid = document.querySelector('.overview-deeper')
    if (!grid) return null
    const rect = grid.getBoundingClientRect(), rows = []
    for (const child of grid.children) {
      const r = child.getBoundingClientRect()
      if (!r.width || !r.height) continue
      const row = rows.find(row => Math.abs(row.top - r.top) <= 1)
      if (row) { row.left = Math.min(row.left, r.left); row.right = Math.max(row.right, r.right); row.count++ }
      else rows.push({ top: r.top, left: r.left, right: r.right, count: 1 })
    }
    return { left: rect.left, right: rect.right, rows, overflow: document.documentElement.scrollWidth - innerWidth }
  })
}

export async function overview(page) {
  return page.evaluate(() => {
    const wealth = document.querySelector('.overview-wealth-column')?.getBoundingClientRect()
    const agenda = document.querySelector('.overview-agenda-column')?.getBoundingClientRect()
    const changes = document.querySelector('.overview-changes')
    const blank = el => {
      if (!el) return null
      const cs = getComputedStyle(el)
      const children = [...el.children].filter(child => child.getBoundingClientRect().height > 1)
      const bottom = Math.max(...children.map(child => child.getBoundingClientRect().bottom + parseFloat(getComputedStyle(child).marginBottom || 0)))
      return el.getBoundingClientRect().bottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth) - bottom
    }
    return { columns: wealth && agenda ? Math.abs(wealth.bottom - agenda.bottom) : null, changesBlank: blank(changes), statusBlank: blank(document.querySelector('.overview-data-status')) }
  })
}

export async function settings(page, natural = false) {
  const style = natural ? await page.addStyleTag({ content: '.settings-page .card-grid { align-items: start !important; }' }) : null
  try {
    return await page.locator('.settings-page [role="tabpanel"]:visible > .card').evaluateAll(cards => cards.map(card => {
      const box = card.getBoundingClientRect()
      const actions = [...card.querySelectorAll('.settings-card-actions, .settings-actions')].filter(el => el.getBoundingClientRect().height)
      return { id: card.id, top: box.top, bottom: box.bottom, height: box.height, width: box.width, bands: actions.map(action => action.previousElementSibling ? action.getBoundingClientRect().top - action.previousElementSibling.getBoundingClientRect().bottom : 0) }
    }))
  } finally { if (style) await style.evaluate(el => el.remove()) }
}

export async function calendar(page) {
  return page.evaluate(() => {
    const label = document.querySelector('.cal-dow')
    const cell = document.querySelectorAll('.cal-grid [role="row"]')[1]?.querySelector('[role="gridcell"], .cal-day')
    if (!label || !cell) return null
    const text = document.createRange(); text.selectNodeContents(label)
    return { band: cell.getBoundingClientRect().top - text.getBoundingClientRect().bottom }
  })
}

export async function taxColumns(page) {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll('.bracket-group')].map(group => {
      const r = group.getBoundingClientRect()
      return { name: group.querySelector('h3')?.textContent, left: r.left, top: r.top, bottom: r.bottom }
    })
    const columns = []
    for (const group of groups) { const column = columns.find(c => Math.abs(c[0].left - group.left) <= 1); if (column) column.push(group); else columns.push([group]) }
    const gaps = columns.flatMap(col => col.sort((a, b) => a.top - b.top).slice(1).map((group, index) => group.top - col[index].bottom))
    const page = document.querySelector('.page'), cs = page && getComputedStyle(page)
    const containerWidth = page && cs ? page.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) : null
    const stack = document.querySelector('.bracket-column')
    const cssGap = stack ? parseFloat(getComputedStyle(stack).rowGap) : null
    return { groups, columnCount: columns.length, gaps, cssGap, containerWidth, expectedColumns: containerWidth === null ? null : containerWidth >= 900 ? 2 : 1 }
  })
}

export async function allocation(page) {
  return page.evaluate(() => {
    const card = [...document.querySelectorAll('section.chart-card')].find(el => el.querySelector('h2')?.textContent.startsWith('Allocation by'))
    if (!card) return null
    const r = card.getBoundingClientRect(), aside = card.querySelector('.chart-card-aside')?.getBoundingClientRect()
    return { height: r.height, asideContained: !!aside && aside.top >= r.top && aside.bottom <= r.bottom }
  })
}

export async function meterEnds(page, selector) {
  return page.locator(selector).evaluateAll(meters => meters.map(meter => {
    const r = meter.getBoundingClientRect()
    return { right: r.right, background: getComputedStyle(meter).backgroundColor, cardBackground: getComputedStyle(meter.closest('.card') ?? meter.parentElement).backgroundColor }
  }))
}

export async function activeFocus(page) {
  return page.evaluate(() => {
    const el = document.activeElement, r = el?.getBoundingClientRect()
    const stickies = [...document.querySelectorAll('[data-frame-part="scope"], .local-sections')].filter(e => {
      const cs = getComputedStyle(e), b = e.getBoundingClientRect()
      return (cs.position === 'sticky' || cs.position === 'fixed') && b.top <= 1
    })
    const inset = Math.max(0, ...stickies.map(e => e.getBoundingClientRect().bottom))
    return { tag: el?.tagName, label: el?.getAttribute('aria-label') ?? el?.textContent?.slice(0, 120), top: r?.top, bottom: r?.bottom, inset, fullyVisible: !!r && r.top >= inset && r.bottom <= innerHeight }
  })
}
