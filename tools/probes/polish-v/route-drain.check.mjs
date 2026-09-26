// Small lifecycle checks; no browser, backend, or product test runner required.
import assert from 'node:assert/strict'
import { routeDrain } from './route-drain.mjs'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let passed = 0

{
  const drain = routeDrain(), events = []
  const task = drain.run('GET /pending', async () => { await sleep(20); events.push('fulfillment finished') })
  await drain.settle({ quietMs: 0, timeoutMs: 300 })
  assert.deepEqual(events, ['fulfillment finished'])
  await task
  passed++
}
{
  const drain = routeDrain(), events = []
  const scheduled = new Promise(resolve => setTimeout(() => {
    resolve(drain.run('GET /lazy-panel', async () => { await sleep(35); events.push('lazy response finished') }))
  }, 10))
  await drain.settle({ quietMs: 30, timeoutMs: 300 })
  assert.deepEqual(events, ['lazy response finished'])
  await scheduled
  passed++
}
{
  const drain = routeDrain(), log = { requestFailures: [] }
  const task = drain.run('GET /canceled', async () => {
    await sleep(20)
    log.requestFailures.push('canceled callback recorded')
    throw new Error('simulated route rejection')
  })
  const rejection = assert.rejects(task, /simulated route rejection/)
  await drain.settle({ quietMs: 0, timeoutMs: 300 })
  const snapshot = structuredClone(log)
  assert.deepEqual(snapshot.requestFailures, ['canceled callback recorded'])
  log.requestFailures.push('later unrelated mutation')
  assert.equal(snapshot.requestFailures.length, 1)
  await rejection
  passed++
}
{
  const drain = routeDrain()
  let release
  const task = drain.run('GET /hung-route', () => new Promise(resolve => { release = resolve }))
  await assert.rejects(drain.settle({ quietMs: 0, timeoutMs: 30 }), /Forwarded routes did not settle: GET \/hung-route/)
  release()
  await task
  await drain.settle({ quietMs: 0, timeoutMs: 300 })
  passed++
}
console.log(`Route-drain lifecycle checks: ${passed}/4 passed`)
