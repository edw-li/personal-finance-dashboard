import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

async function openDrawer() {
  fireEvent.click(screen.getByRole('button', { name: /open assistant/i }))
  await waitFor(() => expect(screen.getByRole('complementary', { name: 'Assistant' })).toBeTruthy())
}

describe('AssistantDrawer', () => {
  it('opens from the launcher, focuses the input, Esc closes and restores focus', async () => {
    mount()
    const launcher = screen.getByRole('button', { name: /open assistant/i })
    await openDrawer()
    const input = screen.getByRole('textbox', { name: /ask the assistant/i })
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
    await openDrawer()
    expect(screen.getByText(/no nvidia api key configured/i)).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: /ask the assistant/i })).toBeNull()
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
    await openDrawer()
    const input = screen.getByRole('textbox', { name: /ask the assistant/i })
    fireEvent.change(input, { target: { value: 'why did housing spike?' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/Housing was \$2,030\.00\./)).toBeTruthy())
    expect(screen.getByText(/get_month_detail/)).toBeTruthy()
    // The request carried route context and the chosen model.
    const body = streamChat.mock.calls[0][0] as { model: string; context: { route: string } }
    expect(body.model).toBe('kimi-k3')
    expect(body.context.route).toBe('/spending')
  })

  it('a pre-token failure restores the question to the input and renders the error', async () => {
    streamChat.mockImplementation(
      (_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
        h.onError({ kind: 'unavailable', message: 'every model failed' })
        return { abort: vi.fn(), finished: Promise.resolve() }
      },
    )
    mount()
    await openDrawer()
    const input = screen.getByRole('textbox', { name: /ask the assistant/i })
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
    await openDrawer()
    const input = screen.getByRole('textbox', { name: /ask the assistant/i })
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
    await openDrawer()
    const input = screen.getByRole('textbox', { name: /ask the assistant/i })
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
    await openDrawer()
    const input = screen.getByRole('textbox', { name: /ask the assistant/i })
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
    await openDrawer()
    const input = screen.getByRole('textbox', { name: /ask the assistant/i })
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
    await openDrawer()
    const input = screen.getByRole('textbox', { name: /ask the assistant/i })
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
})
