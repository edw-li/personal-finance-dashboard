const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Playwright's context.close() does not wait for asynchronous route callbacks. Track the
// complete callback, including fulfillment/error logging, rather than only route.fetch().
export function routeDrain() {
  const pending = new Map()
  let lastActivity = Date.now()
  return {
    run(label, action) {
      const task = Promise.resolve().then(action)
      pending.set(task, label)
      lastActivity = Date.now()
      const finished = () => { pending.delete(task); lastActivity = Date.now() }
      void task.then(finished, finished)
      return task
    },
    async settle({ quietMs = 750, timeoutMs = 30000 } = {}) {
      const started = Date.now()
      // Start a new quiet interval: a just-opened lazy panel may not have issued its
      // requests yet, even though the page previously reached networkidle.
      while (pending.size || Date.now() - Math.max(started, lastActivity) < quietMs) {
        if (Date.now() - started >= timeoutMs) throw new Error(`Forwarded routes did not settle: ${[...pending.values()].join(', ') || 'quiet interval not reached'}`)
        await sleep(Math.min(25, Math.max(1, timeoutMs - (Date.now() - started))))
      }
    },
  }
}
