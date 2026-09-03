import { beforeEach, expect, it } from 'vitest'
import {
  RETURN_TO_KEY,
  clearReturnTo,
  consumeReturnTo,
  peekReturnTo,
  rememberReturnTo,
} from './returnTo'

// No mocks anywhere in this file, deliberately: the module imports nothing, which is the
// property that lets api/client.ts and session.ts both use it without a cycle.
beforeEach(() => sessionStorage.clear())

it('remembers an in-app path and hands it back once', () => {
  rememberReturnTo('/taxes?year=2026')
  expect(sessionStorage.getItem(RETURN_TO_KEY)).toBe('/taxes?year=2026')
  expect(consumeReturnTo()).toBe('/taxes?year=2026')
  expect(consumeReturnTo()).toBeNull()
})

it('peeks without spending, so an F5 on the login keeps the destination', () => {
  rememberReturnTo('/portfolio')
  expect(peekReturnTo()).toBe('/portfolio')
  expect(peekReturnTo()).toBe('/portfolio')
  expect(sessionStorage.getItem(RETURN_TO_KEY)).toBe('/portfolio')
  clearReturnTo()
  expect(peekReturnTo()).toBeNull()
})

it('refuses anything that is not a same-origin in-app path', () => {
  // A browser resolves both of these OFF-SITE — "starts with a slash" is not enough.
  rememberReturnTo('//evil.example/x')
  expect(peekReturnTo()).toBeNull()
  rememberReturnTo('/\\evil.example/x')
  expect(peekReturnTo()).toBeNull()
  rememberReturnTo('https://evil.example')
  expect(peekReturnTo()).toBeNull()
  rememberReturnTo('/login?reason=expired')
  expect(peekReturnTo()).toBeNull() // never bounce back to login itself
  rememberReturnTo('/') // the overview IS a legal answer
  expect(peekReturnTo()).toBe('/')
})

// A 401 raised while the user is already sitting on /login (the assistant stream can do
// this) must not erase the page the FIRST 401 was trying to save for them.
it('leaves an existing memory standing when the current path is unsafe', () => {
  rememberReturnTo('/net-worth')
  rememberReturnTo('/login?reason=expired')
  expect(peekReturnTo()).toBe('/net-worth')
})

it('reads through the filter, so a hand-planted key cannot redirect off-site', () => {
  sessionStorage.setItem(RETURN_TO_KEY, '//evil.example')
  expect(peekReturnTo()).toBeNull()
  expect(consumeReturnTo()).toBeNull()
})
