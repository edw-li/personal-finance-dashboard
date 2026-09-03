import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractFrames, streamChat } from './assistantStream'
import type {
  AssistantErrorEvent,
  AssistantHandlers,
  ChatRequest,
  ToolResultEvent,
} from './assistantStream'
import { getSnapshot, setSnapshot } from './snapshotCache'
import { setToken } from './client'

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

/** One stub shape for every case, so the request itself stays inspectable (client.test.ts's
 *  mockFetchOk arrangement) without a cast at each call site. */
function stubFetch(impl: FetchImpl) {
  const spy = vi.fn(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

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
  toolResults: ToolResultEvent[]
  statuses: string[]
  thinkings: string[]
}

// Typed collectors rather than unknown[]: the assertions below compare whole payloads, so
// the arrays may as well carry the event shapes the handlers are declared with.
function handlers(): Recorder {
  const tokens: string[] = []
  const dones: { model_used: string }[] = []
  const errors: AssistantErrorEvent[] = []
  const notices: { kind: string; from: string; to: string }[] = []
  const toolStarts: { name: string; summary: string }[] = []
  const toolResults: ToolResultEvent[] = []
  const statuses: string[] = []
  const thinkings: string[] = []
  return {
    tokens,
    dones,
    errors,
    notices,
    toolStarts,
    toolResults,
    statuses,
    thinkings,
    onToken: (text) => tokens.push(text),
    onDone: (d) => dones.push(d),
    onError: (e) => errors.push(e),
    onNotice: (n) => notices.push(n),
    onToolStart: (t) => toolStarts.push(t),
    onToolResult: (t) => toolResults.push(t),
    onStatus: (text) => statuses.push(text),
    onThinking: (text) => thinkings.push(text),
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
    stubFetch(async () =>
      sseResponse([
        'event: token\ndata: {"text":"Hel"}\n\n',
        ': ping\n\nevent: token\ndata: {"text":"lo"}\n\n',
        'event: done\ndata: {"model_used":"kimi-k3"}\n\n',
      ]),
    )
    const h = handlers()
    expect(await streamChat(body, h).finished).toBe('done')
    expect(h.tokens.join('')).toBe('Hello')
    expect(h.dones).toEqual([{ model_used: 'kimi-k3' }])
    expect(h.errors).toEqual([])
  })

  it('POSTs the body to the chat endpoint with the bearer token', async () => {
    const fetchMock = stubFetch(async () => sseResponse(['event: done\ndata: {"model_used":"k"}\n\n']))
    setToken('tok') // afterEach's localStorage.clear() unsets it
    await streamChat(body, handlers()).finished
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/assistant/chat')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    expect(init?.body).toBe(JSON.stringify(body))
  })

  it('dispatches the optional notice and tool events', async () => {
    stubFetch(async () =>
      sseResponse([
        'event: notice\ndata: {"kind":"failover","from":"a","to":"b"}\n\n',
        'event: tool_start\ndata: {"name":"spending","summary":"Dec 2025"}\n\n',
        'event: tool_result\ndata: {"name":"spending","summary":"12 rows"}\n\n',
        'event: done\ndata: {"model_used":"b"}\n\n',
      ]),
    )
    const h = handlers()
    expect(await streamChat(body, h).finished).toBe('done')
    expect(h.notices).toEqual([{ kind: 'failover', from: 'a', to: 'b' }])
    expect(h.toolStarts).toEqual([{ name: 'spending', summary: 'Dec 2025' }])
    expect(h.toolResults).toEqual([{ name: 'spending', summary: '12 rows' }])
    expect(h.errors).toEqual([])
  })

  // The sandbox seam (2026-09-03 planning-sandboxes spec 12): `link` is the server's,
  // not this module's -- it rides through to the handler whole, so the drawer alone
  // decides whether the path is one it will render. Dropping or reshaping it here would
  // silently cost every what-if answer its "Open in What-if" affordance.
  it('passes a tool_result link through to onToolResult untouched', async () => {
    stubFetch(async () =>
      sseResponse([
        'event: tool_result\ndata: {"name":"run_tax_whatif","summary":"ok","link":{"to":"/taxes?whatif=qualified_dividends%3A2500","label":"Open in What-if →"}}\n\n',
        'event: done\ndata: {"model_used":"kimi-k3"}\n\n',
      ]),
    )
    const h = handlers()
    expect(await streamChat(body, h).finished).toBe('done')
    expect(h.toolResults).toEqual([
      {
        name: 'run_tax_whatif',
        summary: 'ok',
        link: { to: '/taxes?whatif=qualified_dividends%3A2500', label: 'Open in What-if →' },
      },
    ])
    // Present as a KEY, not merely equal: the drawer renders on `tool.link !== undefined`,
    // so a handler that manufactured `link: undefined` would read the same to toEqual and
    // yet behave differently at the chip.
    expect('link' in h.toolResults[0]).toBe(true)
  })

  it('surfaces server error events', async () => {
    stubFetch(async () =>
      sseResponse(['event: error\ndata: {"kind":"bad_key","message":"nope"}\n\n']),
    )
    const h = handlers()
    expect(await streamChat(body, h).finished).toBe('error')
    expect(h.errors).toEqual([{ kind: 'bad_key', message: 'nope' }])
  })

  // A truncated or garbled frame must cost that frame only — never the answer already on
  // screen, and never the terminal event still to come.
  it('drops an unparseable frame and keeps streaming', async () => {
    stubFetch(async () =>
      sseResponse([
        'event: token\ndata: {"text":"a"}\n\n',
        'event: token\ndata: {not json\n\n',
        'event: token\ndata: {"text":"b"}\n\n',
        'event: done\ndata: {"model_used":"kimi-k3"}\n\n',
      ]),
    )
    const h = handlers()
    expect(await streamChat(body, h).finished).toBe('done')
    expect(h.tokens.join('')).toBe('ab')
    expect(h.dones).toEqual([{ model_used: 'kimi-k3' }])
    expect(h.errors).toEqual([])
  })

  // Well-formed JSON, no text: onToken(undefined) would throw inside the reader loop, where
  // the caller could never catch it — the frame is skipped instead. `data: null` is the
  // nastier shape: it parses fine, so only an optional READ keeps it from throwing.
  it('ignores a token frame carrying no text', async () => {
    stubFetch(async () =>
      sseResponse([
        'event: token\ndata: {}\n\n',
        'event: token\ndata: null\n\n',
        'event: token\ndata: {"text":"only"}\n\n',
        'event: done\ndata: {"model_used":"kimi-k3"}\n\n',
      ]),
    )
    const h = handlers()
    expect(await streamChat(body, h).finished).toBe('done')
    expect(h.tokens).toEqual(['only'])
    expect(h.errors).toEqual([])
  })

  // The progress pair (2026-09-02): `status` is the one-line "what am I doing" the drawer
  // shows instead of dead air, `thinking` the model's reasoning stream. Both are optional
  // handlers — an older server that never emits them changes nothing here.
  it('dispatches status and thinking events', async () => {
    stubFetch(async () =>
      sseResponse([
        'event: status\ndata: {"text":"Reading your spending…"}\n\n',
        'event: thinking\ndata: {"text":"The user asks about "}\n\n',
        'event: thinking\ndata: {"text":"housing."}\n\n',
        'event: status\ndata: {"text":"Writing the answer…"}\n\n',
        'event: token\ndata: {"text":"Housing"}\n\n',
        'event: done\ndata: {"model_used":"kimi-k3"}\n\n',
      ]),
    )
    const h = handlers()
    expect(await streamChat(body, h).finished).toBe('done')
    expect(h.statuses).toEqual(['Reading your spending…', 'Writing the answer…'])
    expect(h.thinkings.join('')).toBe('The user asks about housing.')
    expect(h.tokens).toEqual(['Housing'])
    expect(h.errors).toEqual([])
  })

  // The token guard's reason, applied twice more: a missing or non-string text would throw
  // INSIDE the reader loop, where no caller can catch it, and cost the whole answer.
  it('ignores status and thinking frames carrying no text', async () => {
    stubFetch(async () =>
      sseResponse([
        'event: status\ndata: {}\n\n',
        'event: status\ndata: null\n\n',
        'event: thinking\ndata: {"text":42}\n\n',
        'event: thinking\ndata: null\n\n',
        'event: status\ndata: {"text":"real"}\n\n',
        'event: done\ndata: {"model_used":"kimi-k3"}\n\n',
      ]),
    )
    const h = handlers()
    expect(await streamChat(body, h).finished).toBe('done')
    expect(h.statuses).toEqual(['real'])
    expect(h.thinkings).toEqual([])
    expect(h.errors).toEqual([])
  })

  // Both are optional: a server that emits them to a caller that did not register them must
  // not blow up the stream (the notice/tool handlers' posture).
  it('tolerates status and thinking with no handlers registered', async () => {
    stubFetch(async () =>
      sseResponse([
        'event: status\ndata: {"text":"working"}\n\n',
        'event: thinking\ndata: {"text":"hmm"}\n\n',
        'event: done\ndata: {"model_used":"kimi-k3"}\n\n',
      ]),
    )
    const h = handlers()
    delete h.onStatus
    delete h.onThinking
    expect(await streamChat(body, h).finished).toBe('done')
    expect(h.errors).toEqual([])
  })

  it('reports an interrupted stream that ended without a terminal event', async () => {
    stubFetch(async () => sseResponse(['event: token\ndata: {"text":"par"}\n\n']))
    const h = handlers()
    expect(await streamChat(body, h).finished).toBe('interrupted')
    expect(h.tokens.join('')).toBe('par')
    expect(h.errors).toEqual([{ kind: 'interrupted', message: 'The stream ended unexpectedly.' }])
  })

  // A proxy that truncates the trailing blank line must not turn a complete answer into
  // 'interrupted': the tail is re-terminated once after the stream closes.
  it('flushes a final frame that lost its blank line', async () => {
    stubFetch(async () =>
      sseResponse([
        'event: token\ndata: {"text":"all"}\n\n',
        'event: done\ndata: {"model_used":"kimi-k3"}',
      ]),
    )
    const h = handlers()
    expect(await streamChat(body, h).finished).toBe('done')
    expect(h.tokens).toEqual(['all'])
    expect(h.dones).toEqual([{ model_used: 'kimi-k3' }])
    expect(h.errors).toEqual([])
  })

  // Without the cancel-and-break this hangs until the test times out — and in the browser it
  // would hold the HTTP request open behind a finished answer.
  it('stops reading after the terminal event even if the server holds the stream open', async () => {
    const encoder = new TextEncoder()
    let cancelled = false
    stubFetch(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('event: done\ndata: {"model_used":"kimi-k3"}\n\n'))
          // deliberately never closed
        },
        cancel() {
          cancelled = true
        },
      })
      return new Response(stream, { status: 200 })
    })
    const h = handlers()
    expect(await streamChat(body, h).finished).toBe('done')
    expect(h.dones).toEqual([{ model_used: 'kimi-k3' }])
    expect(h.errors).toEqual([])
    expect(cancelled).toBe(true)
  })

  it('maps a non-OK JSON response to an error handler call', async () => {
    stubFetch(async () => new Response(JSON.stringify({ detail: 'too many' }), { status: 429 }))
    const h = handlers()
    expect(await streamChat(body, h).finished).toBe('error')
    expect(h.errors).toEqual([{ kind: 'rate_limited', message: 'too many' }])
    // No hint from the server means no key at all, not a key holding undefined — that
    // distinction is what a countdown reads.
    expect('retry_after' in h.errors[0]).toBe(false)
  })

  it('carries a numeric Retry-After through to the error payload', async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ error: 'slow down' }), {
          status: 429,
          headers: { 'Retry-After': '30' },
        }),
    )
    const h = handlers()
    await streamChat(body, h).finished
    expect(h.errors).toEqual([{ kind: 'rate_limited', message: 'slow down', retry_after: 30 }])
  })

  it('omits a Retry-After that is not a positive number of seconds', async () => {
    // The HTTP-date form is legal and unparseable as a count; 0 is nothing to count down.
    stubFetch(
      async () =>
        new Response(JSON.stringify({ error: 'slow down' }), {
          status: 429,
          headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' },
        }),
    )
    const dated = handlers()
    await streamChat(body, dated).finished
    expect('retry_after' in dated.errors[0]).toBe(false)

    stubFetch(
      async () =>
        new Response(JSON.stringify({ error: 'slow down' }), {
          status: 429,
          headers: { 'Retry-After': '0' },
        }),
    )
    const zero = handlers()
    await streamChat(body, zero).finished
    expect('retry_after' in zero.errors[0]).toBe(false)
  })

  it('maps 5xx to unavailable', async () => {
    stubFetch(async () => new Response(JSON.stringify({ detail: 'upstream down' }), { status: 502 }))
    const h = handlers()
    expect(await streamChat(body, h).finished).toBe('error')
    expect(h.errors).toEqual([{ kind: 'unavailable', message: 'upstream down' }])
  })

  // FastAPI's validation errors carry a LIST detail, never a string. Read as a string it
  // falls through to statusText — "Unprocessable Content" — which names neither the field
  // the server rejected nor the limit it broke, and this endpoint's 422s (an over-cap
  // message, too many of them) are exactly the ones a reader can act on.
  it('flattens a 422 validation detail list into the message', async () => {
    stubFetch(
      async () =>
        new Response(
          JSON.stringify({ detail: [{ msg: 'String should have at most 8000 characters' }] }),
          { status: 422, statusText: 'Unprocessable Content' },
        ),
    )
    const h = handlers()
    expect(await streamChat(body, h).finished).toBe('error')
    expect(h.errors).toEqual([
      { kind: 'bad_request', message: 'String should have at most 8000 characters' },
    ])
  })

  it('joins a multi-entry 422 detail, naming what it cannot read', async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ detail: [{ msg: 'field a is bad' }, { loc: ['body'] }] }), {
          status: 422,
        }),
    )
    const h = handlers()
    await streamChat(body, h).finished
    expect(h.errors[0].message).toBe('field a is bad; Invalid input')
  })

  it('maps other failures to bad_request, falling back to statusText', async () => {
    stubFetch(
      async () => new Response('<html>nope</html>', { status: 400, statusText: 'Bad Request' }),
    )
    const h = handlers()
    expect(await streamChat(body, h).finished).toBe('error')
    // Non-JSON body: statusText is the fallback message (client.ts's posture).
    expect(h.errors).toEqual([{ kind: 'bad_request', message: 'Bad Request' }])
  })

  // client.ts's session-expiry contract — the same helper, not a copy of it: this path
  // bypasses request(), and a private replica is how the two drifted apart in the first
  // place (a bare /login, no memory of the page the user was on).
  it('a 401 expires the session exactly as request() does', async () => {
    setToken('tok')
    setSnapshot('overview', { stale: true })
    sessionStorage.setItem('assistant:transcript', '[{"role":"user","content":"hi"}]')
    const assign = vi.fn()
    // jsdom refuses real navigation, so the redirect (and the location it reads) is stubbed
    // (client.test.ts's arrangement).
    vi.stubGlobal('location', { ...window.location, pathname: '/taxes', search: '?year=2026', assign })
    stubFetch(
      async () => new Response(JSON.stringify({ detail: 'Not authenticated' }), { status: 401 }),
    )
    const h = handlers()
    // 'aborted', not 'error': nothing was reported to the handlers and the page is leaving.
    expect(await streamChat(body, h).finished).toBe('aborted')
    expect(assign).toHaveBeenCalledWith('/login?reason=expired')
    // The page they were reading survives the expiry; the login hands it back after sign-in.
    expect(sessionStorage.getItem('finance.returnTo')).toBe('/taxes?year=2026')
    expect(localStorage.getItem('finance_token')).toBeNull()
    expect(getSnapshot('overview')).toBeUndefined()
    expect(sessionStorage.getItem('assistant:transcript')).toBeNull()
    expect(h.errors).toEqual([]) // the redirect IS the report; no error bubble behind it
  })

  it('reports a failed request as a network error', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    const h = handlers()
    expect(await streamChat(body, h).finished).toBe('error')
    expect(h.errors).toEqual([
      { kind: 'network', message: 'Network error — is the server reachable?' },
    ])
  })

  it('abort() swallows the AbortError and fires no error handler', async () => {
    const fetchMock = stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    const h = handlers()
    const handle = streamChat(body, h)
    handle.abort()
    expect(await handle.finished).toBe('aborted')
    expect(h.errors).toEqual([])
    expect(h.dones).toEqual([])
    // The signal really reached fetch — otherwise the request outlives the drawer.
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  // Stopping mid-answer is a user action, not a failure: the reader's rejection is as
  // silent as the request's.
  it('abort() mid-stream ends quietly, keeping the tokens already delivered', async () => {
    const encoder = new TextEncoder()
    stubFetch(async (_url, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('event: token\ndata: {"text":"half"}\n\n'))
          init?.signal?.addEventListener('abort', () =>
            controller.error(new DOMException('aborted', 'AbortError')),
          )
        },
      })
      return new Response(stream, { status: 200 })
    })
    const h = handlers()
    const handle = streamChat(body, h)
    await vi.waitFor(() => expect(h.tokens).toEqual(['half']))
    handle.abort()
    expect(await handle.finished).toBe('aborted')
    expect(h.errors).toEqual([])
  })

  // The interrupted report is dispatched OUTSIDE the reader's try: a handler that throws
  // must not land back in the catch and report a second, wrong 'network' failure — and
  // `finished` must still resolve, or the drawer would stream forever.
  it('resolves without a second report when an error handler itself throws', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubFetch(async () => sseResponse(['event: token\ndata: {"text":"par"}\n\n']))
    const h = handlers()
    const boom = new Error('render crashed')
    h.onError = (e) => {
      h.errors.push(e)
      throw boom
    }
    expect(await streamChat(body, h).finished).toBe('error')
    expect(h.errors).toEqual([{ kind: 'interrupted', message: 'The stream ended unexpectedly.' }])
    expect(logged).toHaveBeenCalledWith(boom)
    logged.mockRestore()
  })
})
