import { api, apiReadOnly } from './client'
import type {
  AssistantContextIn,
  AssistantModelsOut,
  AssistantPreviewOut,
  AssistantSettingsOut,
  AssistantSettingsUpdate,
} from '../types/api'

export function fetchAssistantSettings(): Promise<AssistantSettingsOut> {
  return api<AssistantSettingsOut>('/assistant/settings')
}

export function putAssistantSettings(body: AssistantSettingsUpdate): Promise<AssistantSettingsOut> {
  // Stringified as handed over: the caller's absent-vs-null distinction is the API's
  // "leave the key alone" vs "clear the override".
  return api<AssistantSettingsOut>('/assistant/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

/** `probe` costs a live NVIDIA round-trip; the bare read serves the last stored result. */
export function fetchAssistantModels(probe = false): Promise<AssistantModelsOut> {
  return api<AssistantModelsOut>(`/assistant/models${probe ? '?probe=1' : ''}`)
}

/** A POST that only reads — the pattern the tax what-if endpoint established. It rides
 *  apiReadOnly so opening the drawer never wipes the page snapshots. */
export function fetchContextPreview(context: AssistantContextIn): Promise<AssistantPreviewOut> {
  return apiReadOnly<AssistantPreviewOut>('/assistant/context-preview', { context })
}
