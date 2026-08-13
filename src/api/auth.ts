import { api, clearToken, setToken } from './client'
import type { MeResponse, TokenResponse } from '../types/api'

export async function login(email: string, password: string): Promise<void> {
  const res = await api<TokenResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  setToken(res.access_token)
}

export function logout(): void {
  clearToken()
}

export async function fetchMe(): Promise<MeResponse> {
  return api<MeResponse>('/auth/me')
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await api<void>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
}
