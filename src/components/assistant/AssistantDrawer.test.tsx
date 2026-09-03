import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchAssistantSettings = vi.fn()
const fetchAssistantModels = vi.fn()
const fetchContextPreview = vi.fn()
vi.mock('../../api/assistant', () => ({
  fetchAssistantSettings: (...a: unknown[]) => fetchAssistantSettings(...a),
  fetchAssistantModels: (...a: unknown[]) => fetchAssistantModels(...a),
  fetchContextPreview: (...a: unknown[]) => fetchContextPreview(...a),
}))

const streamChat = vi.fn()
vi.mock('../../api/assistantStream', async () => {
  const actual = await vi.importActual<typeof import('../../api/assistantStream')>(
    '../../api/assistantStream',
  )
  return { ...actual, streamChat: (...a: unknown[]) => streamChat(...a) }
})

import { requestAssistantOpen } from './viewState'
import AssistantDrawer from './AssistantDrawer'

const MODELS = {
  configured: true,
  key_source: 'env' as const,
  key_ok: true,
  checked_at: '2026-09-01T00:00:00Z',
  models: [
    { key: 'kimi-k3', label: 'Kimi K3', available: true, supports_tools: true, default: true },
    {
      key: 'nemotron-3.5-lightning',
      label: 'Nemotron 3.5 Lightning',
      available: true,
      supports_tools: true,
      default: false,
    },
  ],
}

function mount(route = '/spending') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AssistantDrawer />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  fetchAssistantSettings.mockResolvedValue({
    key: { configured: true, source: 'env' },
    default_model: 'kimi-k3',
  })
  fetchAssistantModels.mockResolvedValue(MODELS)
  fetchContextPreview.mockResolvedValue({ sections: [{ name: 'household', rows: 1 }] })
  streamChat.mockReset()
})

// vitest runs without `globals`, so RTL never registers its own auto-cleanup: without the
// unmount, the previous test's launcher is still in the document and every getByRole below
// would find two (the repo's afterEach(cleanup) idiom).
afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

/** Opens the drawer and waits for the SETTLED state, returning the composer.
 *
 *  Waiting on the container alone is a race: the drawer mounts synchronously on the click,
 *  but everything below the header waits on promises the open kicked off — the composer on
 *  fetchAssistantSettings, the model catalog (which the retry ladder's nextModelAfter reads)
 *  on fetchAssistantModels. A synchronous getBy* after such a helper fails whenever React
 *  commits those after waitFor already returned; it reproduced about one run in ten. */
async function openDrawer(): Promise<HTMLTextAreaElement> {
  fireEvent.click(screen.getByRole('button', { name: /open assistant/i }))
  await screen.findByRole('complementary', { name: 'Assistant' })
  const input = await screen.findByRole<HTMLTextAreaElement>('textbox', {
    name: /ask the assistant/i,
  })
  // Until the catalog lands the select holds a single placeholder option; both fixtures
  // below carry two or more, so "more than one" is the arrival signal.
  await waitFor(() =>
    expect(
      within(screen.getByRole('combobox', { name: 'Model' })).getAllByRole('option').length,
    ).toBeGreaterThan(1),
  )
  return input
}

/** openDrawer's fake-timer twin. waitFor and findBy poll on setInterval/setTimeout, which
 *  vi.useFakeTimers freezes — and @testing-library only auto-advances for JEST's fake
 *  clock, so under vitest's they hang. The drawer's own settling is promise-work only
 *  (settings + models), so draining the microtask queue inside act() is enough. */
async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** The not-configured variant: there is no composer to settle on, so the setup note that
 *  replaces it is the signal that fetchAssistantSettings has landed. */
async function openDrawerUnconfigured() {
  fireEvent.click(screen.getByRole('button', { name: /open assistant/i }))
  await screen.findByRole('complementary', { name: 'Assistant' })
  return screen.findByText(/no nvidia api key configured/i)
}

describe('AssistantDrawer', () => {
  it('opens from the launcher, focuses the input, Esc closes and restores focus', async () => {
    mount()
    const launcher = screen.getByRole('button', { name: /open assistant/i })
    const input = await openDrawer()
    await waitFor(() => expect(document.activeElement).toBe(input))
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('complementary', { name: 'Assistant' })).toBeNull()
    expect(document.activeElement).toBe(launcher)
  })

  it('opens on the palette bus event', async () => {
    mount()
    requestAssistantOpen()
    await waitFor(() =>
      expect(screen.getByRole('complementary', { name: 'Assistant' })).toBeTruthy(),
    )
  })

  it('shows the not-configured setup note instead of the composer', async () => {
    fetchAssistantSettings.mockResolvedValue({
      key: { configured: false, source: null },
      default_model: 'kimi-k3',
    })
    mount()
    expect(await openDrawerUnconfigured()).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: /ask the assistant/i })).toBeNull()
  })

  // Escape rides the drawer's own onKeyDown, which only fires for events raised INSIDE it.
  // With no composer there is nothing in there to hold focus, so without the root taking it
  // the keypress lands on <body> and the drawer becomes uncloseable by keyboard.
  it('unconfigured: the drawer root takes focus so Esc still closes it', async () => {
    fetchAssistantSettings.mockResolvedValue({
      key: { configured: false, source: null },
      default_model: 'kimi-k3',
    })
    mount()
    const launcher = screen.getByRole('button', { name: /open assistant/i })
    await openDrawerUnconfigured()
    const drawer = screen.getByRole('complementary', { name: 'Assistant' })
    await waitFor(() => expect(document.activeElement).toBe(drawer))
    fireEvent.keyDown(drawer, { key: 'Escape' })
    expect(screen.queryByRole('complementary', { name: 'Assistant' })).toBeNull()
    expect(document.activeElement).toBe(launcher)
  })

  // The settings fetch decides whether there is a composer at all, so it lands a commit or
  // more after the open. A reader who has already moved on inside the drawer must not be
  // yanked into the composer when it finally appears.
  it('does not steal focus into a composer that arrives late', async () => {
    let land: (settings: unknown) => void = () => {}
    fetchAssistantSettings.mockImplementation(
      () =>
        new Promise((resolve) => {
          land = resolve
        }),
    )
    mount()
    fireEvent.click(screen.getByRole('button', { name: /open assistant/i }))
    const drawer = await screen.findByRole('complementary', { name: 'Assistant' })
    await waitFor(() => expect(document.activeElement).toBe(drawer))
    const newChat = screen.getByRole('button', { name: 'New chat' })
    newChat.focus()
    await act(async () => {
      land({ key: { configured: true, source: 'env' }, default_model: 'kimi-k3' })
    })
    await screen.findByRole('textbox', { name: /ask the assistant/i })
    expect(document.activeElement).toBe(newChat)
  })

  // Nothing traps focus in a complementary region: one click on the page behind the drawer
  // moves it out, and from there the root's onKeyDown never sees the keypress. Escape has
  // to keep closing anyway — the window listener is what makes that true.
  it('Esc closes from outside the drawer, after focus has wandered off', async () => {
    mount()
    const launcher = screen.getByRole('button', { name: /open assistant/i })
    await openDrawer()
    const wandered = document.activeElement as HTMLElement
    wandered.blur()
    expect(document.activeElement).toBe(document.body)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('complementary', { name: 'Assistant' })).toBeNull()
    expect(document.activeElement).toBe(launcher)
  })

  it('streams an answer: tokens accumulate, tool chip renders, done stamps the model', async () => {
    streamChat.mockImplementation(
      (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
        h.onToolStart?.({ name: 'get_month_detail', summary: 'Dec 2025' })
        h.onToolResult?.({ name: 'get_month_detail', summary: 'ok' })
        h.onToken('Housing was ')
        h.onToken('$2,030.00.')
        h.onDone({ model_used: 'kimi-k3' })
        return { abort: vi.fn(), finished: Promise.resolve() }
      },
    )
    mount()
    const input = await openDrawer()
    fireEvent.change(input, { target: { value: 'why did housing spike?' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/Housing was \$2,030\.00\./)).toBeTruthy())
    expect(screen.getByText(/get_month_detail/)).toBeTruthy()
    // The request carried route context and the chosen model.
    const body = streamChat.mock.calls[0][0] as { model: string; context: { route: string } }
    expect(body.model).toBe('kimi-k3')
    expect(body.context.route).toBe('/spending')
  })

  // The sandbox seam (2026-09-03 planning-sandboxes spec 12) and the audit's allow-list
  // rule in one: a tool that modelled a scenario offers to open it live, but ONLY when
  // the destination is one of the app's own routes. A model that invented a link -- or a
  // compromised tool that echoed one -- must not get an anchor rendered for it.
  it('renders the what-if link under the tool chip, for NAV paths only', async () => {
    streamChat.mockImplementation(
      (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
        h.onToolStart?.({ name: 'run_tax_whatif', summary: 'year=2026' })
        h.onToolResult?.({
          name: 'run_tax_whatif',
          summary: 'ok',
          link: {
            to: '/taxes?whatif=qualified_dividends%3A2500',
            label: 'Open in What-if →',
          },
        })
        h.onToolStart?.({ name: 'get_page_data', summary: 'page=/calendar' })
        h.onToolResult?.({
          name: 'get_page_data',
          summary: 'ok',
          link: { to: 'https://evil.example/x', label: 'Open' },
        })
        h.onToken('Dividends of $2,500 would...')
        h.onDone({ model_used: 'kimi-k3' })
        return { abort: vi.fn(), finished: Promise.resolve() }
      },
    )
    mount()
    const input = await openDrawer()
    fireEvent.change(input, { target: { value: 'what if?' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/Dividends of/)).toBeTruthy())
    const link = screen.getByRole('link', { name: 'Open in What-if →' })
    expect(link.getAttribute('href')).toBe('/taxes?whatif=qualified_dividends%3A2500')
    // The off-site one is refused outright -- no anchor, however the label reads.
    expect(screen.queryByRole('link', { name: 'Open' })).toBeNull()
  })

  // A tool that answered without a scenario is the common case: the chip must stay a
  // plain chip rather than sprouting an empty anchor.
  it('renders no link for a tool result that carried none', async () => {
    streamChat.mockImplementation(
      (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
        h.onToolStart?.({ name: 'get_month_detail', summary: 'Dec 2025' })
        h.onToolResult?.({ name: 'get_month_detail', summary: 'ok' })
        h.onToken('Housing was $2,030.00.')
        h.onDone({ model_used: 'kimi-k3' })
        return { abort: vi.fn(), finished: Promise.resolve() }
      },
    )
    mount()
    const input = await openDrawer()
    fireEvent.change(input, { target: { value: 'why?' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/Housing was/)).toBeTruthy())
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('a pre-token failure restores the question to the input and renders the error', async () => {
    streamChat.mockImplementation(
      (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
        h.onError({ kind: 'unavailable', message: 'every model failed' })
        return { abort: vi.fn(), finished: Promise.resolve() }
      },
    )
    mount()
    const input = await openDrawer()
    fireEvent.change(input, { target: { value: 'hello?' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/every model failed/)).toBeTruthy())
    expect((input as HTMLTextAreaElement).value).toBe('hello?')
  })

  it('Stop aborts and marks the partial answer stopped', async () => {
    const abort = vi.fn()
    let capture: import('../../api/assistantStream').AssistantHandlers | null = null
    streamChat.mockImplementation(
      (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
        capture = h
        h.onToken('partial')
        return { abort, finished: new Promise(() => {}) }
      },
    )
    mount()
    const input = await openDrawer()
    fireEvent.change(input, { target: { value: 'long one' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('partial')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /stop/i }))
    expect(abort).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText(/stopped/i)).toBeTruthy())
    expect(capture).not.toBeNull()
  })

  it('persists the transcript across a remount (sessionStorage)', async () => {
    streamChat.mockImplementation(
      (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
        h.onToken('answer')
        h.onDone({ model_used: 'kimi-k3' })
        return { abort: vi.fn(), finished: Promise.resolve() }
      },
    )
    const first = mount()
    const input = await openDrawer()
    fireEvent.change(input, { target: { value: 'persist me' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('answer')).toBeTruthy())
    first.unmount()
    mount()
    await openDrawer()
    expect(screen.getByText('persist me')).toBeTruthy()
    expect(screen.getByText('answer')).toBeTruthy()
  })

  it('renders sample chips on an empty transcript and sends the preset on click', async () => {
    streamChat.mockImplementation(
      (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
        h.onDone({ model_used: 'kimi-k3' })
        return { abort: vi.fn(), finished: Promise.resolve() }
      },
    )
    mount()
    await openDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Month in review' }))
    await waitFor(() => expect(streamChat).toHaveBeenCalled())
    const body = streamChat.mock.calls[0][0] as { messages: { content: string }[] }
    expect(body.messages.at(-1)?.content).toMatch(/month-in-review/i)
  })

  it('failover notice renders above the answer', async () => {
    streamChat.mockImplementation(
      (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
        h.onNotice?.({ kind: 'failover', from: 'kimi-k3', to: 'nemotron-3.5-lightning' })
        h.onToken('fallback answer')
        h.onDone({ model_used: 'nemotron-3.5-lightning' })
        return { abort: vi.fn(), finished: Promise.resolve() }
      },
    )
    mount()
    const input = await openDrawer()
    fireEvent.change(input, { target: { value: 'q' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(screen.getByText(/Nemotron 3\.5 Lightning — Kimi K3 was unavailable/)).toBeTruthy(),
    )
  })

  it('context expander fetches and lists the preview sections', async () => {
    mount()
    await openDrawer()
    fireEvent.click(screen.getByRole('button', { name: /what the assistant can see/i }))
    await waitFor(() => expect(screen.getByText(/household/)).toBeTruthy())
    expect(fetchContextPreview).toHaveBeenCalledWith(
      expect.objectContaining({ route: '/spending' }),
    )
  })

  // A slow first preview must never paint over the answer a later open already showed:
  // the sections list is what the drawer claims the model can see, and a stale one is a
  // lie about the CURRENT page.
  it('discards a context preview left over from an earlier open', async () => {
    let resolveFirst: (value: { sections: { name: string; rows: number }[] }) => void = () => {}
    fetchContextPreview
      .mockImplementationOnce(
        () =>
          new Promise<{ sections: { name: string; rows: number }[] }>((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockImplementationOnce(() => Promise.resolve({ sections: [{ name: 'portfolio', rows: 7 }] }))
    mount()
    await openDrawer()
    const toggle = () =>
      fireEvent.click(screen.getByRole('button', { name: /what the assistant can see/i }))
    toggle() // open → request #1, still pending
    toggle() // close
    toggle() // reopen → request #2
    await waitFor(() => expect(screen.getByText(/portfolio/)).toBeTruthy())
    await act(async () => {
      resolveFirst({ sections: [{ name: 'household', rows: 1 }] })
    })
    expect(screen.queryByText(/household/)).toBeNull()
    expect(screen.getByText(/portfolio/)).toBeTruthy()
  })

  // The pre-token failure above drops the user bubble, so the transcript alone can no
  // longer name what Retry should resend — the button must still resend the right thing.
  it('Retry resends the failed question on the fallback model', async () => {
    streamChat
      .mockImplementationOnce(
        (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
          h.onError({ kind: 'unavailable', message: 'every model failed' })
          return { abort: vi.fn(), finished: Promise.resolve() }
        },
      )
      .mockImplementationOnce(
        (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
          h.onToken('second time lucky')
          h.onDone({ model_used: 'nemotron-3.5-lightning' })
          return { abort: vi.fn(), finished: Promise.resolve() }
        },
      )
    mount()
    const input = await openDrawer()
    fireEvent.change(input, { target: { value: 'why did housing spike?' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/every model failed/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /retry with nemotron 3\.5 lightning/i }))
    await waitFor(() => expect(screen.getByText('second time lucky')).toBeTruthy())
    const retry = streamChat.mock.calls[1][0] as {
      model: string
      messages: { content: string }[]
    }
    expect(retry.model).toBe('nemotron-3.5-lightning')
    expect(retry.messages.at(-1)?.content).toBe('why did housing spike?')
    // The failed stub is replaced by the answer that worked, not stacked above it.
    expect(screen.queryByText(/every model failed/)).toBeNull()
  })

  // A failure that arrives AFTER tokens keeps its question bubble, so the retry has to
  // replay the turn — re-appending the question over the surviving one would bubble it
  // twice and send it twice.
  it('Retry after a partial answer replays the turn instead of duplicating the question', async () => {
    streamChat
      .mockImplementationOnce(
        (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
          h.onToken('half ')
          h.onError({ kind: 'unavailable', message: 'died mid-answer' })
          return { abort: vi.fn(), finished: Promise.resolve() }
        },
      )
      .mockImplementationOnce(
        (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
          h.onToken('whole answer')
          h.onDone({ model_used: 'nemotron-3.5-lightning' })
          return { abort: vi.fn(), finished: Promise.resolve() }
        },
      )
    mount()
    const input = await openDrawer()
    fireEvent.change(input, { target: { value: 'q1' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/died mid-answer/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /retry with nemotron 3\.5 lightning/i }))
    await waitFor(() => expect(screen.getByText('whole answer')).toBeTruthy())
    expect(screen.getAllByText('q1')).toHaveLength(1)
    expect(screen.queryByText('half')).toBeNull()
    expect(screen.queryByText(/died mid-answer/)).toBeNull()
    const retry = streamChat.mock.calls[1][0] as { messages: { content: string }[] }
    expect(retry.messages.map((m) => m.content)).toEqual(['q1'])
  })

  // The ladder must step DOWN the catalog: the fallback offered after a retry fails is
  // chosen against the model that just ran, not against the drawer's `model` state — which
  // is still the previous one, because setModel(retryModel) has not committed inside the
  // same event. Catalog order is load-bearing here: nextModelAfter returns the first
  // available key that is not the one it was asked about, so DeepSeek-first is what makes
  // "kimi → DeepSeek → Ultra" distinguishable from a stuck "kimi → DeepSeek → DeepSeek".
  it('a second failure offers the next model down, never the one that just failed', async () => {
    fetchAssistantModels.mockResolvedValue({
      ...MODELS,
      models: [
        {
          key: 'deepseek-v4-pro-0813',
          label: 'DeepSeek V4 Pro',
          available: true,
          supports_tools: true,
          default: false,
        },
        {
          key: 'nemotron-3-ultra-550b',
          label: 'Nemotron 3 Ultra 550B',
          available: true,
          supports_tools: true,
          default: false,
        },
        { key: 'kimi-k3', label: 'Kimi K3', available: true, supports_tools: true, default: true },
      ],
    })
    streamChat
      .mockImplementationOnce(
        (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
          h.onError({ kind: 'unavailable', message: 'kimi is down' })
          return { abort: vi.fn(), finished: Promise.resolve() }
        },
      )
      .mockImplementationOnce(
        (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
          h.onError({ kind: 'unavailable', message: 'deepseek is down too' })
          return { abort: vi.fn(), finished: Promise.resolve() }
        },
      )
    mount()
    const input = await openDrawer()
    fireEvent.change(input, { target: { value: 'anyone home?' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByRole('button', { name: /retry with deepseek v4 pro/i })
    fireEvent.click(screen.getByRole('button', { name: /retry with deepseek v4 pro/i }))
    await waitFor(() => expect(screen.getByText(/deepseek is down too/)).toBeTruthy())
    // The retry really ran on DeepSeek…
    expect((streamChat.mock.calls[1][0] as { model: string }).model).toBe('deepseek-v4-pro-0813')
    // …so the next rung is Ultra, and DeepSeek is not offered a second time.
    expect(screen.getByRole('button', { name: /retry with nemotron 3 ultra 550b/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /retry with deepseek v4 pro/i })).toBeNull()
  })

  // sessionStorage outlives the catalog: a model the server has since retired would leave
  // the <select> with no matching option (value reads back as '') and name a dead model on
  // every send.
  it('reconciles a persisted model the catalog no longer offers', async () => {
    sessionStorage.setItem('assistant:model', 'gone-model')
    streamChat.mockImplementation(
      (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
        h.onDone({ model_used: 'kimi-k3' })
        return { abort: vi.fn(), finished: Promise.resolve() }
      },
    )
    mount()
    const input = await openDrawer()
    const select = screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement
    expect(select.value).toBe('kimi-k3') // the catalog's own default
    fireEvent.change(input, { target: { value: 'still works?' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(streamChat).toHaveBeenCalled())
    expect((streamChat.mock.calls[0][0] as { model: string }).model).toBe('kimi-k3')
  })

  // The backend caps ChatMessageIn.content at 8000 chars. A long ANSWER is the one that
  // gets there: it lands in the transcript, rides every later send as history and 422s all
  // of them, wedging the conversation until New chat. One truncated tail is the cheap half
  // of that trade.
  it('truncates over-cap history so one long answer cannot wedge every later send', async () => {
    sessionStorage.setItem(
      'assistant:transcript',
      JSON.stringify([
        { role: 'user', content: 'give me everything' },
        { role: 'assistant', content: 'x'.repeat(9000) },
      ]),
    )
    streamChat.mockImplementation(
      (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
        h.onDone({ model_used: 'kimi-k3' })
        return { abort: vi.fn(), finished: Promise.resolve() }
      },
    )
    mount()
    const input = await openDrawer()
    fireEvent.change(input, { target: { value: 'and now a short one' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(streamChat).toHaveBeenCalled())
    const body = streamChat.mock.calls[0][0] as { messages: { content: string }[] }
    expect(body.messages.map((m) => m.content.length)).toEqual([18, 8000, 19])
    expect(body.messages.every((m) => m.content.length <= 8000)).toBe(true)
    // Truncated, not dropped: the head of the answer is still the history the model needs.
    expect(body.messages[1].content).toBe('x'.repeat(8000))
  })

  // Spec §9: a 429 that came with a Retry-After hint holds the retry shut until the wait is
  // really over — the obvious next click cannot earn a second 429.
  it('a rate_limited retry_after counts down and only then enables Retry', async () => {
    // Installed BEFORE the mount: RetryCountdown arms its interval as it renders, and one
    // started under real timers would never see advanceTimersByTime. That rules out
    // waitFor/findBy for the rest of the test — both poll on the timers now frozen — so the
    // open settles by draining microtasks instead (ToastProvider's fake-timer posture).
    vi.useFakeTimers()
    try {
      streamChat.mockImplementation(
        (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
          h.onError({ kind: 'rate_limited', message: 'too many requests', retry_after: 3 })
          return { abort: vi.fn(), finished: Promise.resolve() }
        },
      )
      mount()
      fireEvent.click(screen.getByRole('button', { name: /open assistant/i }))
      await settle()
      const input = screen.getByRole('textbox', { name: /ask the assistant/i })
      fireEvent.change(input, { target: { value: 'q' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      await settle()

      expect(screen.getByText(/too many requests/)).toBeTruthy()
      const retry = () =>
        screen.getByRole('button', { name: /retry with/i }) as HTMLButtonElement
      expect(screen.getByText(/retry in 3s/i)).toBeTruthy()
      expect(retry().disabled).toBe(true)

      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(screen.getByText(/retry in 2s/i)).toBeTruthy()
      expect(retry().disabled).toBe(true)

      act(() => {
        vi.advanceTimersByTime(2000)
      })
      // At zero the wait line is gone and the button is live.
      expect(screen.queryByText(/retry in/i)).toBeNull()
      expect(retry().disabled).toBe(false)

      // And the timer really stopped: no further ticks, no further renders.
      act(() => {
        vi.advanceTimersByTime(10_000)
      })
      expect(retry().disabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  // No hint from the server means nothing to wait for: the affordance behaves exactly as it
  // did before the countdown existed.
  it('an error without retry_after leaves Retry live immediately', async () => {
    streamChat.mockImplementation(
      (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
        h.onError({ kind: 'unavailable', message: 'every model failed' })
        return { abort: vi.fn(), finished: Promise.resolve() }
      },
    )
    mount()
    const input = await openDrawer()
    fireEvent.change(input, { target: { value: 'q' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const retry = await screen.findByRole<HTMLButtonElement>('button', { name: /retry with/i })
    expect(retry.disabled).toBe(false)
    expect(screen.queryByText(/retry in/i)).toBeNull()
  })

  // A stream can end without reporting anything to the handlers at all — the 401 redirect
  // and an abort raised elsewhere both resolve `finished` silently. Without that
  // continuation the composer would keep offering Stop for a stream that is already over.
  it('a stream that reports nothing still clears the streaming state when it finishes', async () => {
    let finish: (outcome: 'aborted') => void = () => {}
    streamChat.mockImplementation(() => ({
      abort: vi.fn(),
      finished: new Promise<'aborted'>((resolve) => {
        finish = resolve
      }),
    }))
    mount()
    const input = await openDrawer()
    fireEvent.change(input, { target: { value: 'silent one' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByRole('button', { name: /stop/i })
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    finish('aborted')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: /stop/i })).toBeNull()
  })
})

// Progress feedback (2026-09-02). The complaint these answer is dead air: with a real key
// the first token can be twenty seconds out, and until it landed the drawer rendered an
// empty bubble that looked broken.
describe('AssistantDrawer progress feedback', () => {
  /** Captures the handlers of every send, on a stream that never resolves — so each test
   *  drives the events it cares about and nothing else fires behind it. An array, not a
   *  `let`, because a `let` assigned only inside a callback narrows to `null` at the use
   *  site and would need a non-null assertion (which lint bans). */
  function captureHandlers(): import('../../api/assistantStream').AssistantHandlers[] {
    const captured: import('../../api/assistantStream').AssistantHandlers[] = []
    streamChat.mockImplementation(
      (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
        captured.push(h)
        return { abort: vi.fn(), finished: new Promise(() => {}) }
      },
    )
    return captured
  }

  async function ask(text = 'why did housing spike?') {
    const input = await openDrawer()
    fireEvent.change(input, { target: { value: text } })
    fireEvent.keyDown(input, { key: 'Enter' })
    return input
  }

  // The whole point: something honest is on screen from the keystroke, not from the first
  // server event. The stream here never calls a handler at all.
  it("renders 'Sending…' synchronously on Enter, before any server event", async () => {
    captureHandlers()
    mount()
    await ask()
    expect(screen.getByText('Sending…')).toBeTruthy()
    expect(document.querySelector('.assistant-spinner')).toBeTruthy()
  })

  it('a status event replaces the placeholder text', async () => {
    const captured = captureHandlers()
    mount()
    await ask()
    act(() => captured[0].onStatus?.('Reading your spending…'))
    expect(screen.getByText('Reading your spending…')).toBeTruthy()
    expect(screen.queryByText('Sending…')).toBeNull()
  })

  // The first token IS the progress report — a status line left underneath it would claim
  // the assistant is still deciding what to do while it is plainly answering.
  it('the first token clears the status row', async () => {
    const captured = captureHandlers()
    mount()
    await ask()
    act(() => captured[0].onStatus?.('Reading your spending…'))
    act(() => captured[0].onToken('Housing was '))
    expect(screen.queryByText('Reading your spending…')).toBeNull()
    expect(document.querySelector('.assistant-progress')).toBeNull()
    expect(screen.getByText(/Housing was/)).toBeTruthy()
    // Cleared out of the ITEM, not merely hidden behind the answer that replaced it: every
    // patch mirrors to sessionStorage, and a status left there rides the next restore.
    expect(sessionStorage.getItem('assistant:transcript')).not.toContain('Reading your spending')
  })

  it('done clears the progress row even when no token ever arrived', async () => {
    const captured = captureHandlers()
    mount()
    await ask()
    expect(document.querySelector('.assistant-progress')).toBeTruthy()
    act(() => captured[0].onStatus?.('Reading your spending…'))
    act(() => captured[0].onDone({ model_used: 'kimi-k3' }))
    expect(document.querySelector('.assistant-progress')).toBeNull()
    expect(sessionStorage.getItem('assistant:transcript')).not.toContain('Reading your spending')
  })

  it('an error clears the progress row and shows the failure instead', async () => {
    const captured = captureHandlers()
    mount()
    await ask()
    act(() => captured[0].onToken('half an answer '))
    act(() => captured[0].onStatus?.('Reading your spending…'))
    act(() => captured[0].onError({ kind: 'unavailable', message: 'every model failed' }))
    expect(document.querySelector('.assistant-progress')).toBeNull()
    expect(screen.getByText(/every model failed/)).toBeTruthy()
    expect(sessionStorage.getItem('assistant:transcript')).not.toContain('Reading your spending')
  })

  it('reasoning streams open, then collapses when the answer starts', async () => {
    const captured = captureHandlers()
    mount()
    await ask()
    act(() => captured[0].onThinking?.('The user asks about '))
    act(() => captured[0].onThinking?.('housing.'))
    const details = () => document.querySelector('details.assistant-thinking')
    expect(details()?.hasAttribute('open')).toBe(true)
    expect(screen.getByText('Reasoning…')).toBeTruthy()
    expect(screen.getByText('The user asks about housing.')).toBeTruthy()

    act(() => captured[0].onToken('Housing was '))
    // The `open` attribute is gone, so the block is collapsed AND the reader may reopen it:
    // React only writes `open` when the prop changes, so a manual toggle afterwards sticks.
    expect(details()?.hasAttribute('open')).toBe(false)
    expect(screen.getByText('Reasoning')).toBeTruthy()
    expect(screen.queryByText('Reasoning…')).toBeNull()
  })

  // A failover restarts the answer on a different model, so the reasoning on screen belongs
  // to a model that is no longer running.
  it('a failover notice clears the reasoning collected so far', async () => {
    const captured = captureHandlers()
    mount()
    await ask()
    act(() => captured[0].onThinking?.('first model was thinking'))
    expect(document.querySelector('details.assistant-thinking')).toBeTruthy()
    act(() =>
      captured[0].onNotice?.({ kind: 'failover', from: 'kimi-k3', to: 'nemotron-3.5-lightning' }),
    )
    expect(document.querySelector('details.assistant-thinking')).toBeNull()
    expect(screen.queryByText('first model was thinking')).toBeNull()
  })

  // A tab closed mid-stream persists the pending item WITH its status. Restoring that would
  // paint a spinner for a stream that died with the tab, and no event will ever clear it.
  it('drops a persisted status on mount so a dead stream shows no spinner', async () => {
    sessionStorage.setItem(
      'assistant:transcript',
      JSON.stringify([
        { role: 'user', content: 'asked before the tab closed' },
        { role: 'assistant', content: '', status: 'Reading your spending…', tools: [] },
      ]),
    )
    captureHandlers()
    mount()
    await openDrawer()
    expect(screen.queryByText('Reading your spending…')).toBeNull()
    expect(document.querySelector('.assistant-progress')).toBeNull()
    // And the sanitised transcript is what gets re-persisted — not just hidden.
    expect(sessionStorage.getItem('assistant:transcript')).not.toMatch(/status/)
  })

  // Neither field is conversation: `status` is UI chrome and `thinking` is a model's scratch
  // pad, which some providers reject outright when replayed as assistant content.
  it('never sends status or thinking upstream', async () => {
    sessionStorage.setItem(
      'assistant:transcript',
      JSON.stringify([
        { role: 'user', content: 'q1' },
        {
          role: 'assistant',
          content: 'a1',
          thinking: 'scratch pad',
          status: 'Working…',
          model: 'kimi-k3',
        },
      ]),
    )
    captureHandlers()
    mount()
    await ask('q2')
    const body = streamChat.mock.calls[0][0] as { messages: unknown[] }
    expect(body.messages).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ])
  })

  // `html { scrollbar-gutter: stable }` reserves the scrollbar's column, so `right: 1.25rem`
  // renders ~15px further from the window edge than the same value on `bottom` does. jsdom
  // does no layout, so the contract under test is the published variable the CSS reads.
  it('publishes the scrollbar gutter so the launcher gaps can match', () => {
    const rectSpy = vi
      .spyOn(document.documentElement, 'getBoundingClientRect')
      .mockReturnValue({ width: 1009 } as DOMRect)
    vi.stubGlobal('innerWidth', 1024)
    try {
      mount()
      expect(document.documentElement.style.getPropertyValue('--assistant-scrollbar-gutter')).toBe(
        '15px',
      )

      // Zoom, or a window-level overlay-scrollbar setting, changes it mid-session.
      rectSpy.mockReturnValue({ width: 1024 } as DOMRect)
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })
      expect(document.documentElement.style.getPropertyValue('--assistant-scrollbar-gutter')).toBe(
        '0px',
      )
    } finally {
      vi.unstubAllGlobals()
      rectSpy.mockRestore()
      document.documentElement.style.removeProperty('--assistant-scrollbar-gutter')
    }
  })
})
