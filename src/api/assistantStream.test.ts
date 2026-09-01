import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractFrames, streamChat } from './assistantStream'
import type { AssistantErrorEvent, AssistantHandlers, ChatRequest } from './assistantStream'
import { getSnapshot, setSnapshot } from './snapshotCache'
import { setToken } from './client'

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } })
}

interface Recorder extends AssistantHandlers {
  tokens: string[]
  dones: { model_used: string }[]
  errors: AssistantErrorEvent[]
  notices: { kind: string; from: string; to: string }[]
  toolStarts: { name: string; summary: string }[]
  toolResults: { name: string; summary: string }[]
}

// Typed collectors rather than unknown[]: the assertions below compare whole payloads, so
// the arrays may as well carry the event shapes the handlers are declared with.
function handlers(): Recorder {
  const tokens: string[] = []
  const dones: { model_used: string }[] = []
  const errors: AssistantErrorEvent[] = []
  const notices: { kind: string; from: string; to: string }[] = []
  const toolStarts: { name: string; summary: string }[] = []
  const toolResults: { name: string; summary: string }[] = []
  return {
    tokens,
    dones,
    errors,
    notices,
    toolStarts,
    toolResults,
    onToken: (text) => tokens.push(text),
    onDone: (d) => dones.push(d),
    onError: (e) => errors.push(e),
    onNotice: (n) => notices.push(n),
    onToolStart: (t) => toolStarts.push(t),
    onToolResult: (t) => toolResults.push(t),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear() // the bearer token rides localStorage (client.test.ts's hygiene)
  sessionStorage.clear()
})

describe('extractFrames', () => {
  it('splits complete frames and keeps the remainder', () => {
    const { frames, rest } = extractFrames('event: token\ndata: {"text":"a"}\n\nevent: tok')
    expect(frames).toEqual([{ event: 'token', data: '{"text":"a"}' }])
    expect(rest).toBe('event: tok')
  })

  it('drops keepalive comments without producing frames', () => {
    const { frames, rest } = extractFrames(': ping\n\n')
    expect(frames).toEqual([])
    expect(rest).toBe('')
  })

  // The SSE wire format splits a payload containing newlines across several data: lines;
  // rejoining them with \n is what makes the reassembled text valid JSON again.
  it('rejoins multi-line data into one payload', () => {
    const { frames } = extractFrames('event: token\ndata: {"text":"line one\ndata: line two"}\n\n')
    expect(frames).toEqual([{ event: 'token', data: '{"text":"line one\nline two"}' }])
  })

  it('yields no frame for a block that carries no data line', () => {
    expect(extractFrames('event: token\n\n').frames).toEqual([])
  })
})

describe('streamChat', () => {
  const body: ChatRequest = {
    model: 'kimi-k3',
    context: { route: '/', search: {}, view: {} },
    messages: [],
  }

  it('dispatches tokens then done', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'event: token\ndata: {"text":"Hel"}\n\n',
          ': ping\n\nevent: token\ndata: {"text":"lo"}\n\n',
          'event: done\ndata: {"model_used":"kimi-k3"}\n\n',
        ]),
      ),
    )
    const h = handlers()
    await streamChat(body, h).finished
    expect(h.tokens.join('')).toBe('Hello')
    expect(h.dones).toEqual([{ model_used: 'kimi-k3' }])
    expect(h.errors).toEqual([])
  })

  it('POSTs the body to the chat endpoint with the bearer token', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['event: done\ndata: {"model_used":"k"}\n\n']))
    vi.stubGlobal('fetch', fetchMock)
    setToken('tok') // afterEach's localStorage.clear() unsets it
    await streamChat(body, handlers()).finished
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/v1/assistant/chat')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    expect(init.body).toBe(JSON.stringify(body))
  })

  it('dispatches the optional notice and tool events', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'event: notice\ndata: {"kind":"failover","from":"a","to":"b"}\n\n',
          'event: tool_start\ndata: {"name":"spending","summary":"Dec 2025"}\n\n',
          'event: tool_result\ndata: {"name":"spending","summary":"12 rows"}\n\n',
          'event: done\ndata: {"model_used":"b"}\n\n',
        ]),
      ),
    )
    const h = handlers()
    await streamChat(body, h).finished
    expect(h.notices).toEqual([{ kind: 'failover', from: 'a', to: 'b' }])
    expect(h.toolStarts).toEqual([{ name: 'spending', summary: 'Dec 2025' }])
    expect(h.toolResults).toEqual([{ name: 'spending', summary: '12 rows' }])
    expect(h.errors).toEqual([])
  })

  it('surfaces server error events', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse(['event: error\ndata: {"kind":"bad_key","message":"nope"}\n\n']),
      ),
    )
    const h = handlers()
    await streamChat(body, h).finished
    expect(h.errors).toEqual([{ kind: 'bad_key', message: 'nope' }])
  })

  // A truncated or garbled frame must cost that frame only — never the answer already on
  // screen, and never the terminal event still to come.
  it('drops an unparseable frame and keeps streaming', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'event: token\ndata: {"text":"a"}\n\n',
          'event: token\ndata: {not json\n\n',
          'event: token\ndata: {"text":"b"}\n\n',
          'event: done\ndata: {"model_used":"kimi-k3"}\n\n',
        ]),
      ),
    )
    const h = handlers()
    await streamChat(body, h).finished
    expect(h.tokens.join('')).toBe('ab')
    expect(h.dones).toEqual([{ model_used: 'kimi-k3' }])
    expect(h.errors).toEqual([])
  })

  it('reports an interrupted stream that ended without a terminal event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse(['event: token\ndata: {"text":"par"}\n\n'])),
    )
    const h = handlers()
    await streamChat(body, h).finished
    expect(h.tokens.join('')).toBe('par')
    expect(h.errors).toEqual([{ kind: 'interrupted', message: 'The stream ended unexpectedly.' }])
  })

  it('maps a non-OK JSON response to an error handler call', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ detail: 'too many' }), { status: 429 })),
    )
    const h = handlers()
    await streamChat(body, h).finished
    expect(h.errors).toEqual([
      { kind: 'rate_limited', message: 'too many', retry_after: undefined },
    ])
  })

  it('carries a numeric Retry-After through to the error payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'slow down' }), {
            status: 429,
            headers: { 'Retry-After': '30' },
          }),
      ),
    )
    const h = handlers()
    await streamChat(body, h).finished
    expect(h.errors).toEqual([{ kind: 'rate_limited', message: 'slow down', retry_after: 30 }])
  })

  it('maps 5xx to unavailable and other failures to bad_request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ detail: 'upstream down' }), { status: 502 })),
    )
    const server = handlers()
    await streamChat(body, server).finished
    expect(server.errors).toEqual([
      { kind: 'unavailable', message: 'upstream down', retry_after: undefined },
    ])

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>nope</html>', { status: 400, statusText: 'Bad Request' }),
      ),
    )
    const client = handlers()
    await streamChat(body, client).finished
    // Non-JSON body: statusText is the fallback message (client.ts's posture).
    expect(client.errors).toEqual([
      { kind: 'bad_request', message: 'Bad Request', retry_after: undefined },
    ])
  })

  // client.ts's session-expiry contract, replicated for the one path that bypasses it —
  // plus the transcript, which is session data too.
  it('a 401 clears token, snapshots and transcript, then redirects', async () => {
    setToken('tok')
    setSnapshot('overview', { stale: true })
    sessionStorage.setItem('assistant:transcript', '[{"role":"user","content":"hi"}]')
    const assign = vi.fn()
    // jsdom refuses real navigation, so the redirect is stubbed (client.test.ts's arrangement).
    vi.stubGlobal('location', { ...window.location, assign })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: 'Not authenticated' }), { status: 401 }),
      ),
    )
    const h = handlers()
    await streamChat(body, h).finished
    expect(assign).toHaveBeenCalledWith('/login')
    expect(localStorage.getItem('finance_token')).toBeNull()
    expect(getSnapshot('overview')).toBeUndefined()
    expect(sessionStorage.getItem('assistant:transcript')).toBeNull()
    expect(h.errors).toEqual([]) // the redirect IS the report; no error bubble behind it
  })

  it('reports a failed request as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const h = handlers()
    await streamChat(body, h).finished
    expect(h.errors).toEqual([
      { kind: 'network', message: 'Network error — is the server reachable?' },
    ])
  })

  it('abort() swallows the AbortError and fires no error handler', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            )
          }),
      ),
    )
    const h = handlers()
    const handle = streamChat(body, h)
    handle.abort()
    await handle.finished
    expect(h.errors).toEqual([])
  })

  // Stopping mid-answer is a user action, not a failure: the reader's rejection is as
  // silent as the request's.
  it('abort() mid-stream ends quietly, keeping the tokens already delivered', async () => {
    const encoder = new TextEncoder()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('event: token\ndata: {"text":"half"}\n\n'))
            init?.signal?.addEventListener('abort', () =>
              controller.error(new DOMException('aborted', 'AbortError')),
            )
          },
        })
        return new Response(stream, { status: 200 })
      }),
    )
    const h = handlers()
    const handle = streamChat(body, h)
    await vi.waitFor(() => expect(h.tokens).toEqual(['half']))
    handle.abort()
    await handle.finished
    expect(h.errors).toEqual([])
  })
})
