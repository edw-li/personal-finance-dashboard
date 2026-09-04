import { afterAll } from 'vitest'

// The prefs store debounces its PATCH by 400ms on a MODULE-GLOBAL timer (prefsStore.ts's
// `setLocal`). A test file that renders anything writing a pref and then finishes inside that
// window leaves the timer armed; it fires after vitest has torn the jsdom environment down,
// `getToken()` reaches for a `localStorage` that no longer exists, and the run ends
// "2364 passed / 1 unhandled error" with exit 1 — blaming whichever OTHER file happened to be
// running at the time (PortfolioPage.test.tsx one run, EChart.test.tsx the next).
//
// afterAll, not afterEach: the leak is a file outliving its environment, so cancelling once
// per file is the smallest hook that closes it and it cannot disturb state a file's own tests
// share. The import is DYNAMIC and inside the hook on purpose — importing the store at setup
// time instantiates it before a test file's `vi.mock` is applied, which broke all fourteen
// tests across prefsStore.test.ts, SessionPrefs, AppearanceCard, ThemeProvider and
// api/prefs.test.ts. Loaded here it resolves to whatever that file already has (real module
// or its own mock, hence the optional call), and to a fresh no-op instance for a file that
// never touched prefs at all.
afterAll(async () => {
  const store = await import('../prefs/prefsStore')
  store.resetPrefsStoreForTests?.()
})
