import { api } from './client'
import type { AppSettingsOut, AppSettingsUpdate } from '../types/api'

// Path carries NO trailing slash: the router mounts these at prefix "/settings" with an
// empty route path, so "/settings/" costs a 307 redirect.
export function fetchAppSettings(): Promise<AppSettingsOut> {
  return api<AppSettingsOut>('/settings')
}

export function putAppSettings(body: AppSettingsUpdate): Promise<AppSettingsOut> {
  return api<AppSettingsOut>('/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
