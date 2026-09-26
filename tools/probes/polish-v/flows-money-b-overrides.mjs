// Fresh integrated copy of the audited L7 flow; original lane artifacts stay untouched.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
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
  await page.waitForFunction((el) => { const box = el.getBoundingClientRect(); return box.y >= 0 && box.bottom <= innerHeight }, await input.elementHandle())
  const box = await input.boundingBox()
  assert(box && box.y >= 0 && box.y + box.height <= 900)
  return { focus: await active(), y: box.y, height: box.height }
}

try {
  await page.goto(`${BASE}/calendar?view=list&month=2026-09`)
  await page.locator('[data-event-key]').first().waitFor()
  const payload = (await api('/calendar?start=2026-09-01&end=2026-09-30')).data
  const deadline = payload.events.find((event) => event.id === null && ['tax_deadline', 'update_due', 'card_fee'].includes(event.type) && !event.hidden)
  assert(deadline, 'The copied month has a generated deadline')
  const eventRow = page.locator(`[data-event-key=${JSON.stringify(deadline.key)}]`).first()
  const currentEvent = async () => (await api('/calendar?start=2026-09-01&end=2026-09-30')).data.events.find((event) => event.key === deadline.key)
  const write = async (action) => {
    const response = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().includes('/calendar/overrides/'))
    await action()
    const saved = await response
    assert.equal(saved.status(), 200)
    const batch = (await saved.allHeaders())['x-change-batch']
    assert(batch)
    outstanding.add(batch)
    return batch
  }
  const undo = async (batch, name) => {
    const answer = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes(`/activity/batches/${batch}/undo`))
    await page.locator('.toast').filter({ has: page.getByRole('button', { name: 'Undo', exact: true }) }).last().getByRole('button', { name: 'Undo', exact: true }).click()
    assert.equal((await answer).status(), 200)
    outstanding.delete(batch)
    await page.getByText(`Restored ${deadline.label}`, { exact: true }).last().waitFor()
    assert.deepEqual(await currentEvent(), deadline)
    note(name, { key: deadline.key, focus: await keptFocus(name) })
  }
  await eventRow.click()
  const doneBatch = await write(() => page.getByRole('button', { name: deadline.done ? 'Reopen' : 'Mark done', exact: true }).click())
  await page.getByRole('button', { name: deadline.done ? 'Mark done' : 'Reopen', exact: true }).waitFor()
  assert.equal((await currentEvent()).done, !deadline.done)
  await keptFocus('Mark done save')
  await undo(doneBatch, 'Generated deadline done/reopen exact Undo')
  const hideBatch = await write(() => page.getByRole('button', { name: 'Hide', exact: true }).click())
  await page.getByRole('button', { name: 'Unhide', exact: true }).waitFor()
  assert.equal((await currentEvent()).hidden, true)
  await keptFocus('Hide save')
  await undo(hideBatch, 'Generated deadline Hide exact Undo')
  await page.getByRole('button', { name: 'Your figure', exact: true }).click()
  const amount = page.getByLabel('Amount you paid', { exact: true })
  await page.waitForFunction((el) => document.activeElement === el, await amount.elementHandle())
  await amount.fill('123.45')
  const figureBatch = await write(() => amount.press('Enter'))
  await page.getByRole('button', { name: 'Your figure', exact: true }).waitFor()
  assert.equal((await currentEvent()).amount, '123.45')
  assert.equal((await active()).text, 'Your figure')
  await undo(figureBatch, 'Your figure focuses amount, saves through Enter and restores exact override')

  await page.route('**/api/v1/assistant/findings', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 999999, title: 'L7 saved finding', content: 'Temporary browser fixture', context: {}, evidence: [], model_used: null, evidence_as_of: '2026-09-25T00:00:00Z', created_at: '2026-09-25T00:00:00Z' }]) }))
  let removed = 0
  await page.route('**/api/v1/assistant/findings/999999', (route) => { removed++; return route.fulfill({ status: 204 }) })
  await page.getByRole('button', { name: 'Open assistant', exact: true }).click()
  await page.getByRole('tab', { name: 'Saved findings', exact: true }).click()
  await page.locator('summary').filter({ hasText: 'L7 saved finding' }).click()
  await page.getByRole('button', { name: 'Remove saved finding', exact: true }).click()
  const question = page.getByRole('alertdialog', { name: 'Remove L7 saved finding?' })
  await question.getByText("This can't be undone.", { exact: true }).waitFor()
  await question.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(removed, 0)
  await page.getByRole('button', { name: 'Remove saved finding', exact: true }).click()
  await question.getByRole('button', { name: 'Remove saved finding', exact: true }).click()
  await page.getByText(/No saved findings yet/).waitFor()
  assert.equal(removed, 1)
  note('Assistant irreversible confirmation cancels safely and focuses empty region on removal', { fixture: true, focus: await keptFocus('finding removal') })

  const light = await open(browser, { writes: true, width: 1280, height: 800, theme: 'light', reducedMotion: 'reduce' })
  report.lightLog = light.log
  try {
    await light.page.goto(`${BASE}/credit-cards?section=manage`)
    await light.page.locator('.roster-table [data-row-edit]').last().click()
    await light.page.waitForFunction(() => document.activeElement?.id === 'card-name')
    await light.page.getByLabel('Card name', { exact: true }).press('Escape')
    await light.page.getByRole('tab', { name: 'Rewards', exact: true }).click()
    await light.page.getByRole('button', { name: 'Edit multipliers', exact: true }).click()
    await light.page.locator('.mx-cell-btn').last().click()
    const geometry = await light.page.locator('.mx-editor-bar').boundingBox()
    assert(geometry && geometry.y >= 0 && geometry.y + geometry.height <= 800)
    await light.page.screenshot({ path: file('matrix-light-reduced.png') })
    note('Light theme and reduced motion at 1280x800', { bar: geometry, errors: light.log.pageErrors })
    await light.page.goto(`${BASE}/spending?section=budgets`)
    await light.page.getByRole('button', { name: /^(Edit|Set) .+ budget$/ }).first().click()
    await light.page.locator('.budget-editor input[inputmode="decimal"]').fill('-1')
    await light.page.getByRole('button', { name: /^Save .+ budget$/ }).click()
    await light.page.locator('.budget-editor').getByText("Budgets can't be negative", { exact: true }).waitFor()
    await light.page.screenshot({ path: file('budget-light-reduced.png') })
    assert.deepEqual(light.log.pageErrors, [])
    assert.deepEqual(light.log.consoleErrors, [])
    assert.deepEqual(light.log.badResponses, [])
    assert.deepEqual(light.log.requestFailures, [])
  } finally { await settle(light.page, 0); await light.close() }
  assert.equal(report.dialogs.length, 0)
  assert.deepEqual(log.pageErrors, [])
  assert.deepEqual(log.consoleErrors, [])
  assert.deepEqual(log.badResponses, [])
  assert.deepEqual(log.requestFailures, [])
} catch (error) {
  report.error = String(error.stack ?? error)
  console.error(report.error)
  await page.screenshot({ path: file('supplement-failure.png'), fullPage: false }).catch(() => {})
  process.exitCode = 1
} finally {
  for (const batch of outstanding) { try { await api(`/activity/batches/${batch}/undo`, 'POST'); report.cleanup.push(`undo ${batch}`) } catch (error) { report.cleanup.push(String(error)); process.exitCode = 1 } }
  try { await settle(page, 0) } catch (error) { report.cleanup.push(`Final settlement: ${error}`); process.exitCode = 1 }
  await run.close()
  await browser.close()
  const errorKeys = ['consoleErrors', 'pageErrors', 'badResponses', 'requestFailures', 'dialogs', 'writesBlocked']
  if ([log, report.lightLog].filter(Boolean).some(value => errorKeys.some(key => value[key].length > 0))) {
    report.error ??= 'Unexpected browser errors after final settlement and context teardown'
    process.exitCode = 1
  }
  report.status = process.exitCode ? 'failed' : 'passed'
  report.completedAt = new Date().toISOString()
  writeFileSync(file('supplement-report.json'), JSON.stringify(report, null, 2))
}
