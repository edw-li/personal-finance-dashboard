import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchAssistantModels,
  fetchAssistantSettings,
  fetchContextPreview,
  putAssistantSettings,
} from './assistant'

// Only the transport is stubbed (projection.test.ts's posture) — the path/verb/body this
// module builds IS the test. apiReadOnly is stubbed alongside api because WHICH helper the
// preview rides is part of the contract, not an implementation detail.
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  api: vi.fn(),
  apiReadOnly: vi.fn(),
}))
import { api, apiReadOnly } from './client'

beforeEach(() => vi.clearAllMocks())

describe('assistant client', () => {
  it('GETs the settings row', async () => {
    await fetchAssistantSettings()
    expect(vi.mocked(api).mock.calls[0][0]).toBe('/assistant/settings')
  })

  it('PUTs the tri-state body verbatim, explicit null and all', async () => {
    await putAssistantSettings({ api_key: null })
    const [path, options] = vi.mocked(api).mock.calls[0]
    expect(path).toBe('/assistant/settings')
    expect(options?.method).toBe('PUT')
    // The key must SURVIVE JSON.stringify: absent means "leave the override alone" and
    // null means "clear it", so dropping the key merges the two (the marriage-date lesson).
    expect(options?.body).toBe('{"api_key":null}')
  })

  it('sends no api_key property at all when the caller omits it', async () => {
    await putAssistantSettings({ default_model: 'x' })
    const [, options] = vi.mocked(api).mock.calls[0]
    // The absent arm of the same tri-state: switching the model must not disturb a stored key.
    expect(options?.body).toBe('{"default_model":"x"}')
  })

  it('adds ?probe=1 only when probing', async () => {
    // The bare call reads the cached probe result; probing costs a live NVIDIA round-trip.
    await fetchAssistantModels()
    expect(vi.mocked(api).mock.calls[0][0]).toBe('/assistant/models')
    await fetchAssistantModels(true)
    expect(vi.mocked(api).mock.calls[1][0]).toBe('/assistant/models?probe=1')
  })

  it('rides apiReadOnly for the context preview, never api()', async () => {
    const context = { route: '/spending', search: {}, view: {} }
    await fetchContextPreview(context)
    expect(vi.mocked(apiReadOnly).mock.calls[0]).toEqual([
      '/assistant/context-preview',
      { context },
    ])
    // A POST through api() would wipe every page snapshot on every drawer open.
    expect(api).not.toHaveBeenCalled()
  })
})
