// Fresh integrated copy of the audited L7 flow; original lane artifacts stay untouched.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { launch, open, BASE, settle, provenance } from './flows-harness.mjs'

assert.equal(BASE, 'http://127.0.0.1:5280')
const OUTPUT = path.resolve(process.env.FLOW_OUT ?? 'scratchpad/polish-v/fresh-L7')
mkdirSync(OUTPUT, { recursive: true })
const file = name => path.join(OUTPUT, name)
const browser = await launch()
const run = await open(browser, { writes: true, width: 1440, height: 900 })
const { page, log } = run
page.setDefaultTimeout(20000)
const report = { provenance, startedAt: new Date().toISOString(), results: [], dialogs: [], cleanup: [], log }
page.on('dialog', async (dialog) => { report.dialogs.push(dialog.type()); await dialog.dismiss() })
const stamp = Date.now()
const cardName = `L7 Card ${stamp}`
const categoryName = `L7 Category ${stamp}`
const eventName = `L7 Event ${stamp}`
let cardId, categoryId, eventId, budgetCleanup
const outstanding = new Set()
const api = (path, method = 'GET', body) => page.evaluate(async ({ path, method, body }) => {
  const response = await fetch(`/api/v1${path}`, {
    method, headers: { authorization: `Bearer ${localStorage.getItem('finance_token')}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 400)}`)
  return { data: text ? JSON.parse(text) : null, batch: response.headers.get('x-change-batch') }
}, { path, method, body })
const active = () => page.evaluate(() => ({ tag: document.activeElement?.tagName, id: document.activeElement?.id, label: document.activeElement?.getAttribute('aria-label'), text: document.activeElement?.textContent?.slice(0, 80) }))
const keptFocus = async (name) => { const focus = await active(); assert.notEqual(focus.tag, 'BODY', name); return focus }
const note = (name, details) => { report.results.push({ name, ...details }); console.log(JSON.stringify({ name, ...details })) }
const undoToast = async (text) => {
  const toast = page.locator('.toast').filter({ has: page.getByText(text, { exact: true }) }).last()
  await toast.getByRole('button', { name: 'Undo', exact: true }).click()
}
const cards = async () => (await api('/credit-cards')).data
const rates = async () => (await api('/credit-cards/rates')).data
const categories = async () => (await api('/credit-cards/categories')).data
const forCard = async () => (await cards()).find((card) => card.id === cardId)
const forCategory = async () => (await categories()).find((category) => category.id === categoryId)
const inspectFocus = async (input) => {
  await input.waitFor()
  await page.waitForFunction((el) => document.activeElement === el, await input.elementHandle())
  await page.waitForFunction((el) => {
    const box = el.getBoundingClientRect()
    const inset = Math.max(0, ...[...document.querySelectorAll('[data-frame-part="scope"]')].map(node => node.getBoundingClientRect()).filter(r => r.top <= 1 && r.bottom > 0).map(r => r.bottom))
    return box.y >= inset && box.bottom <= innerHeight
  }, await input.elementHandle())
  const box = await input.boundingBox()
  assert(box && box.y >= 0 && box.y + box.height <= 900)
  const selection = await input.evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, length: el.value.length }))
  if (selection.start !== null) assert(selection.start === 0 && selection.end === selection.length, 'editable text must be selected')
  return { focus: await active(), y: box.y, height: box.height, selection }
}
const domainPaths = ['/credit-cards', '/credit-cards/categories', '/credit-cards/rates', '/calendar?start=2026-09-01&end=2026-09-30', '/spending/matrix']
const domainHashes = async () => Object.fromEntries(await Promise.all(domainPaths.map(async pathname => [pathname, createHash('sha256').update(JSON.stringify((await api(pathname)).data)).digest('hex')])))
const traceDeletion = async (button, toastText) => button.evaluate((control, toastText) => {
  const row = control.closest('tr')
  if (!row) throw new Error('The deletion trace needs the actual source row')
  const trace = { rowGoneAt: null, toastAt: null }
  const observe = () => {
    if (!row.isConnected && trace.rowGoneAt === null) trace.rowGoneAt = performance.now()
    if ([...document.querySelectorAll('.toast')].some(toast => toast.textContent.includes(toastText)) && trace.toastAt === null) trace.toastAt = performance.now()
  }
  const observer = new MutationObserver(observe)
  observer.observe(document.body, { subtree: true, childList: true })
  window.__polishDeleteTrace = { trace, observer }
}, toastText)

try {
  await page.goto(`${BASE}/credit-cards?section=manage`)
  await page.getByText('Card roster', { exact: true }).waitFor()
  report.beforeHashes = await domainHashes()
  cardId = (await api('/credit-cards', 'POST', { name: cardName, annual_fee: '12', rewards_currency: 'points', point_value_cents: '1.25', person_id: null, primary_holder: 'Probe', authorized_users: 'Test', opened_on: '2025-01-10', is_active: true, account_id: null, notes: 'Temporary lane check' })).data.id
  const credit = (await api(`/credit-cards/${cardId}/credits`, 'POST', { label: 'L7 travel credit', annual_value: '80', counts: true, reset_cadence: 'calendar' })).data
  const limits = (await api(`/credit-cards/${cardId}/limits`, 'POST', { effective_date: '2025-01-10', limit_amount: '12345', note: 'L7 opening' })).data
  categoryId = (await api('/credit-cards/categories', 'POST', { name: categoryName, annual_spend: '1000', pinned_card_id: cardId, spending_category_id: null })).data.id
  await api('/credit-cards/rates', 'PUT', [{ card_id: cardId, category_id: categoryId, multiplier: '3', note: 'L7 cap', monthly_cap: '200' }])
  await page.reload()
  await page.getByRole('button', { name: `Edit ${cardName}`, exact: true }).click()
  note('Last card Edit reveals and selects its field', await inspectFocus(page.getByLabel('Card name', { exact: true })))
  assert.equal(await page.locator(`#card-row-${cardId}`).getAttribute('aria-current'), 'true')
  await page.getByLabel('Card name', { exact: true }).press('Escape')
  assert.equal((await active()).label, `Edit ${cardName}`)
  await page.getByRole('button', { name: `Edit ${categoryName}`, exact: true }).click()
  note('Last category Edit reveals its field', await inspectFocus(page.getByLabel('Category name', { exact: true })))
  await page.getByLabel('Category name', { exact: true }).press('Escape')
  assert.equal((await active()).label, `Edit ${categoryName}`)

  const before = { card: await forCard(), category: await forCategory(), rates: (await rates()).filter((rate) => rate.card_id === cardId) }
  const deleteCard = page.getByRole('button', { name: `Delete ${cardName}`, exact: true })
  await traceDeletion(deleteCard, `Deleted ${cardName}`)
  await deleteCard.click()
  await page.getByText(`Deleted ${cardName}`, { exact: true }).waitFor()
  const chronology = await page.evaluate(() => { window.__polishDeleteTrace.observer.disconnect(); return window.__polishDeleteTrace.trace })
  assert(chronology.rowGoneAt !== null && chronology.toastAt !== null && chronology.rowGoneAt <= chronology.toastAt, 'row must leave before the success toast')
  note('Deleted card leaves before its toast appears', chronology)
  await keptFocus('card delete')
  assert.equal(await forCard(), undefined)
  await undoToast(`Deleted ${cardName}`)
  await page.getByText(`Restored ${cardName}`, { exact: true }).waitFor()
  const after = { card: await forCard(), category: await forCategory(), rates: (await rates()).filter((rate) => rate.card_id === cardId) }
  assert.deepEqual(after, before)
  note('Card delete Undo restores identical card, credits, limits, reward cells and pins', { cardId, creditId: credit.id, limitId: limits[0].id, focus: await keptFocus('card undo') })

  await page.getByRole('button', { name: `Archive ${cardName}`, exact: true }).click()
  await page.getByText(`Archived ${cardName}`, { exact: true }).waitFor()
  assert.equal((await forCard()).is_active, false)
  await undoToast(`Archived ${cardName}`)
  await page.getByText(`Restored ${cardName}`, { exact: true }).last().waitFor()
  await page.getByRole('button', { name: `Archive ${cardName}`, exact: true }).waitFor()
  assert.equal((await forCard()).is_active, true)
  note('Archive Undo restores active state', { focus: await keptFocus('archive undo') })

  const categoryBefore = { category: await forCategory(), rates: (await rates()).filter((rate) => rate.category_id === categoryId) }
  await page.getByRole('button', { name: `Delete ${categoryName}`, exact: true }).click()
  await page.getByText(`Deleted ${categoryName} and its multipliers`, { exact: true }).waitFor()
  await keptFocus('category delete')
  await undoToast(`Deleted ${categoryName} and its multipliers`)
  await page.getByText(`Restored ${categoryName} and its multipliers`, { exact: true }).waitFor()
  assert.deepEqual({ category: await forCategory(), rates: (await rates()).filter((rate) => rate.category_id === categoryId) }, categoryBefore)
  await page.getByRole('button', { name: `Hide ${categoryName}`, exact: true }).click()
  await page.getByText(`Hid ${categoryName}`, { exact: true }).waitFor()
  assert.equal((await forCategory()).is_active, false)
  await undoToast(`Hid ${categoryName}`)
  await page.getByRole('button', { name: `Hide ${categoryName}`, exact: true }).waitFor()
  assert.equal((await forCategory()).is_active, true)
  note('Reward category delete restores its cells; Hide Undo restores active state', { focus: await keptFocus('category hide undo') })

  await page.getByRole('tab', { name: 'Rewards', exact: true }).click()
  await page.getByRole('button', { name: 'Edit multipliers', exact: true }).click()
  const matrixCell = page.getByRole('button', { name: `Edit ${categoryName} on ${cardName}`, exact: true })
  await matrixCell.click()
  await inspectFocus(page.getByLabel('Multiplier', { exact: true }))
  const bar = await page.locator('.mx-editor-bar').boundingBox()
  assert(bar && bar.y >= 0 && bar.y + bar.height <= 900)
  assert.equal(await page.locator('.mx-editor-bar').evaluate((node) => getComputedStyle(node).position), 'sticky')
  await page.getByLabel('Multiplier', { exact: true }).fill('4')
  await page.getByLabel('Multiplier', { exact: true }).press('Enter')
  assert.equal((await active()).label, `Edit ${categoryName} on ${cardName}`)
  await page.getByRole('button', { name: 'Save multipliers', exact: true }).click()
  await page.locator('.matrix-header .save-status').filter({ hasText: 'Saved' }).waitFor()
  assert.equal(await page.locator(`#mx-cell-${cardId}-${categoryId}`).getAttribute('data-flash'), '')
  assert.equal((await rates()).find((rate) => rate.card_id === cardId && rate.category_id === categoryId).multiplier, '4.00')
  note('Sticky matrix editor applies Enter and saves with flash', { bar, focus: await keptFocus('matrix save') })
  await page.screenshot({ path: file('matrix-dark.png') })
  await page.getByRole('button', { name: 'Edit multipliers', exact: true }).click()
  await matrixCell.click()
  await page.getByLabel('Multiplier', { exact: true }).fill('5')
  await page.getByLabel('Multiplier', { exact: true }).press('Escape')
  await page.locator('.mx-editor-bar').getByRole('button', { name: 'Cancel', exact: true }).click()
  const question = page.getByRole('alertdialog', { name: 'Discard 1 changed cell?' })
  await question.getByRole('button', { name: 'Discard changes', exact: true }).click()
  await page.getByRole('button', { name: 'Edit multipliers', exact: true }).waitFor()

  await page.getByRole('button', { name: `Open ${cardName} details`, exact: true }).click()
  await page.getByRole('button', { name: 'Delete the L7 travel credit credit', exact: true }).click()
  await page.getByText('Deleted the L7 travel credit credit', { exact: true }).waitFor()
  await keptFocus('credit delete')
  await undoToast('Deleted the L7 travel credit credit')
  await page.getByText('Restored the L7 travel credit credit', { exact: true }).waitFor()
  assert.deepEqual((await forCard()).credits, before.card.credits)
  await page.getByRole('button', { name: 'Delete the 2025-01-10 limit event', exact: true }).click()
  await page.getByText('Deleted the 2025-01-10 limit event', { exact: true }).waitFor()
  await keptFocus('limit delete')
  await undoToast('Deleted the 2025-01-10 limit event')
  await page.getByText('Restored the 2025-01-10 limit event', { exact: true }).waitFor()
  assert.deepEqual((await forCard()).limit_events, before.card.limit_events)
  note('Card detail exact credit and limit Undo', { focus: await keptFocus('limit undo') })

  await page.goto(`${BASE}/calendar`)
  await page.getByRole('grid').waitFor()
  const day = '2026-09-24'
  await page.locator(`[role="gridcell"][data-day="${day}"]`).click({ position: { x: 5, y: 5 } })
  await page.getByRole('button', { name: 'Add event', exact: true }).click()
  const form = page.locator('form.cal-form')
  assert.equal(await form.getByLabel('Date', { exact: true }).inputValue(), day)
  await form.getByLabel('Title', { exact: true }).fill(eventName)
  const createdResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/calendar/events'))
  await form.getByLabel('Title', { exact: true }).press('Enter')
  eventId = (await (await createdResponse).json()).id
  await page.waitForFunction((day) => document.activeElement?.getAttribute('data-day') === day, day)
  const eventChip = page.locator(`[data-custom-event-id="${eventId}"]`).first()
  await eventChip.waitFor()
  assert.equal(await eventChip.getAttribute('data-flash'), '')
  const eventBeforeDelete = (await api('/calendar?start=2026-09-01&end=2026-09-30')).data.events.find(event => event.id === eventId)
  note('Calendar Enter save lands on active day and flashes late chip', { day, eventId, focus: await active() })
  await eventChip.click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await inspectFocus(page.getByLabel('Title', { exact: true }))
  await page.getByLabel('Title', { exact: true }).press('Escape')
  await eventChip.click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByText(`Deleted ${eventName}`, { exact: true }).waitFor()
  await keptFocus('calendar delete')
  await undoToast(`Deleted ${eventName}`)
  await page.getByText(`Restored ${eventName}`, { exact: true }).waitFor()
  const restored = (await api('/calendar?start=2026-09-01&end=2026-09-30')).data.events.find((event) => event.id === eventId)
  assert.deepEqual(restored, eventBeforeDelete)
  note('Calendar exact Undo restores the complete event including custom id', { eventId, exactUndo: true, focus: await keptFocus('calendar undo') })

  await page.goto(`${BASE}/spending?section=budgets`)
  await page.getByRole('button', { name: /^(Edit|Set) .+ budget$/ }).first().click()
  assert.equal(await page.getByRole('button', { name: /^Delete the Jan 2099 budget row for / }).count(), 0, 'scratch budget month must not overwrite an existing row')
  const amount = page.locator('.budget-editor input[inputmode="decimal"]')
  await inspectFocus(amount)
  await amount.fill('bad')
  await page.getByRole('button', { name: /^Save .+ budget$/ }).click()
  await page.locator('.budget-editor').getByText('Enter a number, e.g. 80', { exact: true }).waitFor()
  const error = await page.locator('.budget-editor [role="alert"]').first().boundingBox()
  const control = await amount.boundingBox()
  assert(error && control && error.y >= 0 && error.y + error.height <= 900 && Math.abs(error.y - (control.y + control.height)) <= 200)
  await amount.fill('-1')
  await page.getByRole('button', { name: /^Save .+ budget$/ }).click()
  await page.locator('.budget-editor').getByText("Budgets can't be negative", { exact: true }).waitFor()
  assert.equal(await amount.getAttribute('aria-invalid'), 'true')
  await page.screenshot({ path: file('budget-dark.png') })
  await amount.fill('83')
  await page.locator('.budget-editor input[type="month"]').fill('2099-01')
  const savedBudget = page.waitForResponse((response) => response.request().method() === 'PUT' && /\/spending\/categories\/\d+\/budget/.test(response.url()))
  await page.getByRole('button', { name: /^Save .+ budget$/ }).click()
  const budgetResponse = await savedBudget
  const match = budgetResponse.url().match(/\/spending\/categories\/(\d+)\/budget/)
  budgetCleanup = Number(match[1])
  await page.locator('.budget-editor .save-status').filter({ hasText: 'Saved' }).waitFor()
  const historyDelete = page.getByRole('button', { name: /^Delete the Jan 2099 budget row for / })
  await historyDelete.click()
  const deletedBudget = page.locator('.toast').filter({ hasText: /^Deleted the Jan 2099 budget row for/ }).last()
  await deletedBudget.getByRole('button', { name: 'Undo', exact: true }).click()
  await historyDelete.waitFor()
  note('Budget errors stay in editor; save and history Undo preserve focus', { focus: await keptFocus('budget undo') })

  await page.goto(`${BASE}/projection?whatif=annual_return:0.06`)
  const pinName = page.getByLabel('Pin label', { exact: true })
  await pinName.waitFor()
  for (let n = 1; n <= 3; n++) { await pinName.fill(`L7 pin ${n}`); await pinName.press('Enter') }
  await pinName.fill('Keep this name')
  assert.equal(await page.getByRole('button', { name: 'Pin this scenario', exact: true }).getAttribute('aria-disabled'), 'true')
  await page.getByText('Unpin one to pin another', { exact: true }).waitFor()
  await pinName.press('Enter')
  assert.equal(await pinName.inputValue(), 'Keep this name')
  await page.locator('.sandbox-pins').getByRole('button', { name: 'Unpin L7 pin 2', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Unpin L7 pin 3')
  note('Projection capacity retains draft; Enter pins; Unpin focuses next chip', { focus: await active() })
  await page.getByRole('columnheader').getByRole('button', { name: 'Unpin L7 pin 1', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-pin-remove') && document.activeElement?.getAttribute('aria-label') === 'Unpin L7 pin 3')
  note('Comparison table Unpin also focuses its neighboring chip', { focus: await active() })

  // A synthetic saved finding exercises the irreversible UI without creating an assistant receipt.
  await page.route('**/api/v1/assistant/findings', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 999999, title: 'L7 saved finding', content: 'Temporary browser fixture', context: {}, evidence: [], model_used: null, evidence_as_of: '2026-09-25T00:00:00Z', created_at: '2026-09-25T00:00:00Z' }]) }))
  await page.route('**/api/v1/assistant/findings/999999', (route) => route.fulfill({ status: 204 }))
  await page.getByRole('button', { name: 'Open assistant', exact: true }).click()
  await page.getByRole('tab', { name: 'Saved findings', exact: true }).click()
  await page.locator('summary').filter({ hasText: 'L7 saved finding' }).click()
  await page.getByRole('button', { name: 'Remove saved finding', exact: true }).click()
  const removeQuestion = page.getByRole('alertdialog', { name: 'Remove L7 saved finding?' })
  await removeQuestion.getByText("This can't be undone.", { exact: true }).waitFor()
  await removeQuestion.getByRole('button', { name: 'Remove saved finding', exact: true }).click()
  await page.getByText(/No saved findings yet/).waitFor()
  note('Assistant irreversible removal uses in-app confirmation', { fixture: true, focus: await keptFocus('finding removal') })

  const light = await open(browser, { writes: true, width: 1280, height: 800, theme: 'light', reducedMotion: 'reduce' })
  report.lightLog = light.log
  try {
    await light.page.goto(`${BASE}/credit-cards?section=manage`)
    await light.page.getByRole('button', { name: `Edit ${cardName}`, exact: true }).click()
    await light.page.waitForFunction(() => document.activeElement?.id === 'card-name')
    await light.page.getByLabel('Card name', { exact: true }).press('Escape')
    await light.page.getByRole('tab', { name: 'Rewards', exact: true }).click()
    await light.page.getByRole('button', { name: 'Edit multipliers', exact: true }).click()
    await light.page.getByRole('button', { name: `Edit ${categoryName} on ${cardName}`, exact: true }).click()
    const geometry = await light.page.locator('.mx-editor-bar').boundingBox()
    assert(geometry && geometry.y >= 0 && geometry.y + geometry.height <= 800)
    await light.page.screenshot({ path: file('matrix-light-reduced.png') })
    note('Light theme and reduced motion at 1280x800', { bar: geometry, errors: light.log.pageErrors })
    assert.deepEqual(light.log.pageErrors, [])
    assert.deepEqual(light.log.consoleErrors, [])
    assert.deepEqual(light.log.badResponses, [])
    assert.deepEqual(light.log.requestFailures, [])
  } finally { await light.close() }
  assert.equal(report.dialogs.length, 0)
  assert.deepEqual(log.pageErrors, [])
  assert.deepEqual(log.consoleErrors, [])
  assert.deepEqual(log.badResponses, [])
  assert.deepEqual(log.requestFailures, [])
} catch (error) {
  report.error = String(error.stack ?? error)
  console.error(report.error)
  await page.screenshot({ path: file('browser-failure.png'), fullPage: false }).catch(() => {})
  process.exitCode = 1
} finally {
  for (const batch of outstanding) { try { await api(`/activity/batches/${batch}/undo`, 'POST'); report.cleanup.push(`undo ${batch}`) } catch (error) { report.cleanup.push(String(error)); process.exitCode = 1 } }
  if (budgetCleanup) { try { await api(`/spending/categories/${budgetCleanup}/budget/2099-01-01`, 'DELETE'); report.cleanup.push('future budget removed') } catch (error) { report.cleanup.push(String(error)); process.exitCode = 1 } }
  for (const [kind, id] of [['calendar/events', eventId], ['credit-cards/categories', categoryId], ['credit-cards', cardId]]) {
    if (!id) continue
    try { await api(`/${kind}/${id}`, 'DELETE'); report.cleanup.push(`${kind}/${id} removed`) } catch (error) { report.cleanup.push(String(error)); process.exitCode = 1 }
  }
  try {
    report.afterHashes = await domainHashes()
    assert.deepEqual(report.afterHashes, report.beforeHashes, 'Every touched copied-data collection must return to its original value')
  } catch (error) { report.cleanup.push(String(error)); process.exitCode = 1 }
  report.completedAt = new Date().toISOString()
  writeFileSync(file('browser-report.json'), JSON.stringify(report, null, 2))
  await run.close()
  await browser.close()
}
