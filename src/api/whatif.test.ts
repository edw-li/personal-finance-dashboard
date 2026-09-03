import { describe, expect, it, vi } from 'vitest'
import { runWhatIf } from './whatif'

// Only the transport is stubbed (assistant.test.ts's posture) — WHICH helper the sandbox
// rides is the contract under test, not an implementation detail.
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  api: vi.fn(),
  apiReadOnly: vi.fn(),
}))
import { api, apiReadOnly } from './client'

describe('what-if client', () => {
  it('rides apiReadOnly — a sandbox run stores nothing and must invalidate nothing', async () => {
    const body = { year: 2026, sales: [], espp_sales: [] }
    await runWhatIf(body)
    expect(vi.mocked(apiReadOnly).mock.calls[0]).toEqual(['/taxes/what-if', body])
    // Through api() this POST matched the /taxes prefix and dropped the taxes + overview
    // families on EVERY keystroke-driven re-run, for data no what-if can have moved.
    expect(api).not.toHaveBeenCalled()
  })
})
