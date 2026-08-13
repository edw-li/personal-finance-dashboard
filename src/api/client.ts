const TOKEN_KEY = 'finance_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`/api/v1${path}`, { ...options, headers })

  if (res.status === 401 && !path.startsWith('/auth/login')) {
    clearToken()
    window.location.assign('/login')
    throw new ApiError('Session expired', 401)
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      // FastAPI errors use {detail} (a string, or an ARRAY for 422 validation errors);
      // slowapi's 429 rate-limit body uses {error}
      const body = (await res.json()) as { detail?: unknown; error?: unknown }
      const raw = body.detail ?? body.error
      if (typeof raw === 'string') {
        detail = raw
      } else if (Array.isArray(raw)) {
        detail = raw.map((d) => (d as { msg?: string }).msg ?? 'Invalid input').join('; ')
      }
    } catch {
      // non-JSON error body
    }
    throw new ApiError(detail, res.status)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
