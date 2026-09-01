// The assistant's streaming path (spec §2/§5). fetch + ReadableStream, NOT EventSource:
// EventSource cannot send the Authorization header or a POST body. Deliberately not
// client.ts's api(): that helper is JSON-only with a 15 s timeout — a streamed answer
// legitimately runs longer, and its liveness signal is the keepalive comments.
import { clearSnapshots } from './snapshotCache'
import { clearAssistantSession } from './assistantSession'
import { clearToken, getToken } from './client'
import type { AssistantContextIn } from '../types/api'

export interface ChatMessageIn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  model: string
  context: AssistantContextIn
  messages: ChatMessageIn[]
}

export interface AssistantErrorEvent {
  kind: string
  message: string
  retry_after?: number
}

export interface AssistantHandlers {
  onNotice?: (notice: { kind: string; from: string; to: string }) => void
  onToolStart?: (tool: { name: string; summary: string }) => void
  onToolResult?: (tool: { name: string; summary: string }) => void
  onToken: (text: string) => void
  onDone: (done: { model_used: string }) => void
  onError: (error: AssistantErrorEvent) => void
}

export interface ChatStreamHandle {
  abort: () => void
  finished: Promise<void>
}

export interface SseFrame {
  event: string
  data: string
}

/** Pure frame splitter: complete `event:`/`data:` blocks out, partial tail back.
 *  Comment lines (keepalives) are dropped; a block with no data yields no frame. */
export function extractFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = []
  let rest = buffer
  for (;;) {
    const cut = rest.indexOf('\n\n')
    if (cut === -1) break
    const block = rest.slice(0, cut)
    rest = rest.slice(cut + 2)
    let event = 'message'
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    if (dataLines.length > 0) frames.push({ event, data: dataLines.join('\n') })
  }
  return { frames, rest }
}

function statusKind(status: number): string {
  if (status === 401) return 'bad_key' // unreachable in practice — 401 redirects below
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'unavailable'
  return 'bad_request'
}

export function streamChat(body: ChatRequest, handlers: AssistantHandlers): ChatStreamHandle {
  const controller = new AbortController()
  const finished = (async () => {
    const token = getToken()
    let res: Response
    try {
      res = await fetch('/api/v1/assistant/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      handlers.onError({ kind: 'network', message: 'Network error — is the server reachable?' })
      return
    }
    if (res.status === 401) {
      // client.ts's session-expiry contract, replicated for the one path that bypasses it.
      clearToken()
      clearSnapshots()
      clearAssistantSession()
      window.location.assign('/login')
      return
    }
    if (!res.ok || res.body === null) {
      let detail = res.statusText
      let retryAfter: number | undefined
      try {
        const parsed = (await res.json()) as { detail?: unknown; error?: unknown }
        const raw = parsed.detail ?? parsed.error
        if (typeof raw === 'string') detail = raw
      } catch {
        // non-JSON error body
      }
      const header = res.headers.get('Retry-After')
      if (header !== null && Number.isFinite(Number(header))) retryAfter = Number(header)
      handlers.onError({ kind: statusKind(res.status), message: detail, retry_after: retryAfter })
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let sawTerminal = false
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { frames, rest } = extractFrames(buffer)
        buffer = rest
        for (const frame of frames) {
          let payload: unknown
          try {
            payload = JSON.parse(frame.data)
          } catch {
            continue // a malformed frame is dropped, never fatal
          }
          switch (frame.event) {
            case 'notice':
              handlers.onNotice?.(payload as { kind: string; from: string; to: string })
              break
            case 'tool_start':
              handlers.onToolStart?.(payload as { name: string; summary: string })
              break
            case 'tool_result':
              handlers.onToolResult?.(payload as { name: string; summary: string })
              break
            case 'token':
              handlers.onToken((payload as { text: string }).text)
              break
            case 'done':
              sawTerminal = true
              handlers.onDone(payload as { model_used: string })
              break
            case 'error':
              sawTerminal = true
              handlers.onError(payload as AssistantErrorEvent)
              break
          }
        }
      }
      if (!sawTerminal)
        handlers.onError({ kind: 'interrupted', message: 'The stream ended unexpectedly.' })
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError'))
        handlers.onError({ kind: 'network', message: 'The stream failed mid-answer.' })
    }
  })()
  return { abort: () => controller.abort(), finished }
}
