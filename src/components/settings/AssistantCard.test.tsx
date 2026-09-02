import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchAssistantSettings = vi.fn()
const putAssistantSettings = vi.fn()
const fetchAssistantModels = vi.fn()
vi.mock('../../api/assistant', () => ({
  fetchAssistantSettings: (...a: unknown[]) => fetchAssistantSettings(...a),
  putAssistantSettings: (...a: unknown[]) => putAssistantSettings(...a),
  fetchAssistantModels: (...a: unknown[]) => fetchAssistantModels(...a),
}))

import AssistantCard from './AssistantCard'

const MODELS = {
  configured: true,
  key_source: 'env' as const,
  key_ok: true,
  checked_at: '2026-09-01T00:00:00Z',
  models: [
    {
      key: 'kimi-k3',
      label: 'Kimi K3',
      available: true,
      supports_tools: true,
      default: true,
      catalog_id: 'moonshotai/kimi-k3-instruct',
    },
    {
      key: 'nemotron-3.5-lightning',
      label: 'Nemotron 3.5 Lightning',
      available: false,
      supports_tools: true,
      default: false,
      catalog_id: null,
    },
  ],
}

beforeEach(() => {
  fetchAssistantSettings.mockReset()
  putAssistantSettings.mockReset()
  fetchAssistantModels.mockReset()
})

// vitest runs without `globals`, so RTL never registers its own auto-cleanup: without the
// unmount, the previous test's card is still in the document and every getBy* below would
// find two (the repo's afterEach(cleanup) idiom).
afterEach(cleanup)

describe('AssistantCard', () => {
  it('unconfigured: empty field, no badge, no revert button', async () => {
    fetchAssistantSettings.mockResolvedValue({
      key: { configured: false, source: null },
      default_model: 'kimi-k3',
    })
    render(<AssistantCard />)
    await waitFor(() => expect(screen.getByLabelText(/nvidia api key/i)).toBeTruthy())
    expect(screen.queryByText(/from \.env/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /remove saved key/i })).toBeNull()
  })

  it('env-configured: masked placeholder + source badge', async () => {
    fetchAssistantSettings.mockResolvedValue({
      key: { configured: true, source: 'env' },
      default_model: 'kimi-k3',
    })
    render(<AssistantCard />)
    await waitFor(() => expect(screen.getByText(/from \.env/i)).toBeTruthy())
    const input = screen.getByLabelText(/nvidia api key/i) as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toContain('••••••••')
  })

  it('override: badge says set here and Remove saved key sends api_key null', async () => {
    fetchAssistantSettings.mockResolvedValue({
      key: { configured: true, source: 'override' },
      default_model: 'kimi-k3',
    })
    putAssistantSettings.mockResolvedValue({
      key: { configured: true, source: 'env' },
      default_model: 'kimi-k3',
    })
    render(<AssistantCard />)
    await waitFor(() => expect(screen.getByText(/set here/i)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /remove saved key/i }))
    await waitFor(() =>
      expect(putAssistantSettings).toHaveBeenCalledWith({ api_key: null }),
    )
    // Echo adopted: the badge now reads from .env.
    await waitFor(() => expect(screen.getByText(/from \.env/i)).toBeTruthy())
  })

  it('saving a typed key sends it and never renders it back', async () => {
    fetchAssistantSettings.mockResolvedValue({
      key: { configured: false, source: null },
      default_model: 'kimi-k3',
    })
    putAssistantSettings.mockResolvedValue({
      key: { configured: true, source: 'override' },
      default_model: 'kimi-k3',
    })
    render(<AssistantCard />)
    await waitFor(() => expect(screen.getByLabelText(/nvidia api key/i)).toBeTruthy())
    const input = screen.getByLabelText(/nvidia api key/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'nvapi-secret' } })
    fireEvent.click(screen.getByRole('button', { name: /save assistant settings/i }))
    await waitFor(() =>
      expect(putAssistantSettings).toHaveBeenCalledWith({ api_key: 'nvapi-secret' }),
    )
    await waitFor(() => expect(input.value).toBe('')) // box empties; masked state takes over
  })

  it('save with only a model change sends default_model alone', async () => {
    fetchAssistantSettings.mockResolvedValue({
      key: { configured: true, source: 'env' },
      default_model: 'kimi-k3',
    })
    putAssistantSettings.mockResolvedValue({
      key: { configured: true, source: 'env' },
      default_model: 'nemotron-3.5-lightning',
    })
    render(<AssistantCard />)
    await waitFor(() => expect(screen.getByLabelText(/default model/i)).toBeTruthy())
    fireEvent.change(screen.getByLabelText(/default model/i), {
      target: { value: 'nemotron-3.5-lightning' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save assistant settings/i }))
    await waitFor(() =>
      expect(putAssistantSettings).toHaveBeenCalledWith({
        default_model: 'nemotron-3.5-lightning',
      }),
    )
  })

  it('Test key probes and lists per-model availability', async () => {
    fetchAssistantSettings.mockResolvedValue({
      key: { configured: true, source: 'env' },
      default_model: 'kimi-k3',
    })
    fetchAssistantModels.mockResolvedValue(MODELS)
    render(<AssistantCard />)
    await waitFor(() => expect(screen.getByRole('button', { name: /test key/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /test key/i }))
    await waitFor(() => expect(fetchAssistantModels).toHaveBeenCalledWith(true))
    // Scoped to the probe LIST: the default-model select carries the very same labels on
    // its <option>s, and a bare getByText would find two of each.
    await waitFor(() => expect(screen.getByText(/Kimi K3/, { selector: 'li' })).toBeTruthy())
    expect(screen.getByText(/Kimi K3/, { selector: 'li' }).textContent).toMatch(/✓/)
    expect(
      screen.getByText(/Nemotron 3\.5 Lightning/, { selector: 'li' }).textContent,
    ).toMatch(/unavailable/i)
    // The verdict line reads the tri-state key_ok, and names the source it tested.
    expect(screen.getByText(/Key OK \(\.env\)\./)).toBeTruthy()
  })

  // The morning verification against a real key needs to see WHICH catalog entry each
  // registry key resolved to — "✓ Nemotron 3 Ultra 550B" alone cannot tell a correct match
  // from a fallback the probe quietly settled on.
  it('names the resolved catalog id beside an available model, and omits it when absent', async () => {
    fetchAssistantSettings.mockResolvedValue({
      key: { configured: true, source: 'env' },
      default_model: 'kimi-k3',
    })
    fetchAssistantModels.mockResolvedValue(MODELS)
    render(<AssistantCard />)
    fireEvent.click(await screen.findByRole('button', { name: /test key/i }))
    await waitFor(() => expect(screen.getByText(/Kimi K3/, { selector: 'li' })).toBeTruthy())
    expect(screen.getByText(/Kimi K3/, { selector: 'li' }).textContent).toContain(
      'moonshotai/kimi-k3-instruct',
    )
    // No catalog_id (never resolved, or an older server) renders no trailing separator.
    expect(
      screen.getByText(/Nemotron 3\.5 Lightning/, { selector: 'li' }).textContent,
    ).not.toContain('·')
  })

  it('a rejected key says so rather than claiming the catalog is empty', async () => {
    fetchAssistantSettings.mockResolvedValue({
      key: { configured: true, source: 'override' },
      default_model: 'kimi-k3',
    })
    fetchAssistantModels.mockResolvedValue({
      ...MODELS,
      key_source: 'override' as const,
      key_ok: false,
      models: MODELS.models.map((m) => ({ ...m, available: false })),
    })
    render(<AssistantCard />)
    fireEvent.click(await screen.findByRole('button', { name: /test key/i }))
    await waitFor(() =>
      expect(screen.getByText('Key rejected or the catalog was unreachable.')).toBeTruthy(),
    )
  })
})
