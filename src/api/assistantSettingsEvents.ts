import type { AssistantSettingsOut } from '../types/api'

// Settings and the retained Assistant panel share successful server echoes. No key value
// is exposed here: AssistantSettingsOut contains only key status and the default model.
const listeners = new Set<(settings: AssistantSettingsOut) => void>()

export function publishAssistantSettings(settings: AssistantSettingsOut): void {
  listeners.forEach(listener => listener(settings))
}

export function onAssistantSettingsChanged(listener: (settings: AssistantSettingsOut) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
