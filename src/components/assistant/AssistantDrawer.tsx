import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Sparkles, Square, X } from 'lucide-react'
import {
  fetchAssistantModels,
  fetchAssistantSettings,
  fetchContextPreview,
} from '../../api/assistant'
import {
  readAssistantModel,
  readAssistantTranscript,
  writeAssistantModel,
  writeAssistantTranscript,
} from '../../api/assistantSession'
import type { TranscriptItem } from '../../api/assistantSession'
import { streamChat } from '../../api/assistantStream'
import type { ChatStreamHandle } from '../../api/assistantStream'
import type {
  AssistantContextIn,
  AssistantModelsOut,
  AssistantPreviewSection,
  AssistantSettingsOut,
} from '../../types/api'
import { NAV_ITEMS } from '../navItems'
import { renderMarkdown } from './markdown'
import { INSIGHT_PRESETS, samplesFor } from './samples'
import { ASSISTANT_OPEN_EVENT, readAssistantView, useAssistantViewVersion } from './viewState'
import '../panels.css'
import './assistant.css'

/** The server caps at 20; sending exactly its cap keeps 422s unreachable from here. */
const SENT_MESSAGES_CAP = 20

/** One drawer per app (Layout mounts it once), so a constant id is safe as an
 *  aria-controls target. */
const PREVIEW_LIST_ID = 'assistant-context-sections'

const MODEL_LABELS: Record<string, string> = {
  'kimi-k3': 'Kimi K3',
  'deepseek-v4-pro-0813': 'DeepSeek V4 Pro',
  'nemotron-3-ultra-550b': 'Nemotron 3 Ultra 550B',
  'nemotron-3.5-lightning': 'Nemotron 3.5 Lightning',
}

function modelLabel(key: string, models: AssistantModelsOut | null): string {
  return models?.models.find((m) => m.key === key)?.label ?? MODEL_LABELS[key] ?? key
}

function pageLabel(route: string): string {
  return NAV_ITEMS.find((item) => item.to === route)?.label ?? route
}

/** Keeps the selection inside the catalog: a key the server has since retired — persisted
 *  from an earlier session, or a stale default — falls back to the catalog's own default,
 *  else its first available entry. Left alone while the catalog is unknown; whichever of
 *  the two fetches lands last reconciles, so their order does not matter. */
function resolveModel(key: string, models: AssistantModelsOut | null): string {
  if (models === null || models.models.some((m) => m.key === key)) return key
  return (
    models.models.find((m) => m.default && m.available)?.key ??
    models.models.find((m) => m.available)?.key ??
    key
  )
}

/** Module scope AND memoized on purpose: a streaming answer re-renders the whole
 *  transcript on every token, and an inline renderMarkdown() call in the map would
 *  re-parse every finished message each time. Defined here, not inside the drawer, so the
 *  component identity is stable across renders (react/no-unstable-nested-components). */
const MessageBody = memo(function MessageBody({ text }: { text: string }) {
  return <>{renderMarkdown(text)}</>
})

export default function AssistantDrawer() {
  const location = useLocation()
  const viewVersion = useAssistantViewVersion()
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<AssistantSettingsOut | null>(null)
  const [settingsFailed, setSettingsFailed] = useState(false)
  const [models, setModels] = useState<AssistantModelsOut | null>(null)
  const [model, setModel] = useState<string>(() => readAssistantModel() ?? 'kimi-k3')
  const [transcript, setTranscript] = useState<TranscriptItem[]>(() => readAssistantTranscript())
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [previewSections, setPreviewSections] = useState<AssistantPreviewSection[] | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<ChatStreamHandle | null>(null)
  const modelsRef = useRef<AssistantModelsOut | null>(null)
  // Whether the log is following new content. Flipped by the reader's own scrolling and
  // re-armed by each send — asking a question is a request to watch the answer arrive.
  const stickToBottom = useRef(true)
  // Guards a late stream event after New chat wiped the transcript: each send bumps it,
  // and handlers compare before touching state (the pages' seqRef idiom).
  const sendSeq = useRef(0)
  // The same idiom for the context preview: open/close/reopen must not paint sections
  // fetched for a page the user has since left.
  const previewSeq = useRef(0)
  // What the in-flight (or just-failed) answer was asked about. A pre-token failure DROPS
  // the user bubble (spec §9), so after one the transcript can no longer name the question
  // Retry has to resend.
  const lastQuestion = useRef('')

  // Transcript mirrors to sessionStorage on every change — storage always holds "what
  // would be lost" (the wizard-draft posture).
  useEffect(() => {
    writeAssistantTranscript(transcript)
  }, [transcript])

  useEffect(() => {
    writeAssistantModel(model)
  }, [model])

  // Open-bus subscription (palette's "Ask assistant"). Subscribed once: setOpen is a
  // useState setter, and React guarantees those are stable for the component's lifetime.
  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(ASSISTANT_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(ASSISTANT_OPEN_EVENT, onOpen)
  }, [])

  // First open: load settings + models once. Promise continuations only (house law).
  useEffect(() => {
    if (!open || settings !== null) return
    fetchAssistantSettings()
      .then((s) => {
        setSettings(s)
        setSettingsFailed(false)
        setModel((current) =>
          resolveModel(readAssistantModel() ?? s.default_model ?? current, modelsRef.current),
        )
      })
      .catch(() => setSettingsFailed(true))
    fetchAssistantModels()
      .then((m) => {
        // Mirrored to a ref as well: the settings continuation above needs the catalog to
        // validate against, and its own `models` closure is the null from effect time.
        modelsRef.current = m
        setModels(m)
        setModel((current) => resolveModel(current, m))
      })
      .catch(() => setModels(null))
  }, [open, settings])

  // Focus hand-off: into the input on open; back to the launcher on close.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open, settings])

  // Follow the newest message as tokens land — but only while the reader is still parked at
  // the bottom. Someone scrolled up re-reading an earlier answer must not be yanked back
  // down by the next token. Keyed on the transcript, not unkeyed: an unkeyed effect re-pins
  // on EVERY render, so each keystroke in the composer would slam the log down too.
  // `open` is a dep because reopening mounts a FRESH messages div at scrollTop 0: without
  // it a settled transcript reopens showing its oldest message.
  useEffect(() => {
    const el = messagesRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [transcript, open])

  const onMessagesScroll = () => {
    const el = messagesRef.current
    if (el === null) return
    // ~40px of slack: fractional scroll maths and a half-rendered last line mean a reader
    // who IS at the bottom rarely measures as exactly zero.
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const close = () => {
    setOpen(false)
    setPreviewOpen(false)
    launcherRef.current?.focus()
  }

  const buildContext = (): AssistantContextIn => ({
    route: location.pathname,
    search: Object.fromEntries(new URLSearchParams(location.search).entries()),
    view: readAssistantView(),
  })

  const contextLabel = useMemo(() => {
    void viewVersion // re-derive when a page republishes its view
    const view = readAssistantView()
    const extras = Object.entries(view)
      .filter(([, value]) => value !== null && value !== '')
      .map(([k, value]) => `${k}: ${String(value)}`)
    return [pageLabel(location.pathname), ...extras].join(' · ')
  }, [location.pathname, viewVersion])

  const togglePreview = () => {
    const next = !previewOpen
    setPreviewOpen(next)
    if (!next) return
    // Bumped per open: a slow answer from a previous open lands on a stale sequence and is
    // dropped rather than described as what the assistant can see NOW.
    const seq = ++previewSeq.current
    setPreviewSections(null)
    fetchContextPreview(buildContext())
      .then((p) => {
        if (seq === previewSeq.current) setPreviewSections(p.sections)
      })
      .catch(() => {
        if (seq === previewSeq.current) setPreviewSections([])
      })
  }

  const nextModelAfter = (current: string): string | undefined =>
    models?.models.find((m) => m.available && m.key !== current)?.key

  /** `base` lets a retry hand in the transcript it just pruned: this commits a whole array,
   *  so a functional update queued by the caller would be clobbered by the stale closure. */
  const send = (text: string, withModel?: string, base?: TranscriptItem[]) => {
    const chosenModel = withModel ?? model
    const content = text.trim()
    if (content === '' || streaming || settings === null || !settings.key.configured) return
    // Below the guard: a rejected send must not leave the model picker showing a model that
    // was never asked anything.
    if (withModel !== undefined) setModel(withModel)
    const seq = ++sendSeq.current
    const asked = buildContext()
    lastQuestion.current = content
    stickToBottom.current = true
    const userItem: TranscriptItem = { role: 'user', content, contextLabel }
    const pendingAnswer: TranscriptItem = { role: 'assistant', content: '', tools: [] }
    const history = [...(base ?? transcript), userItem]
    setTranscript([...history, pendingAnswer])
    setInput('')
    setStreaming(true)
    let receivedTokens = false

    // All handlers funnel through this: replace the LAST item (the pending answer).
    const patchAnswer = (patch: (current: TranscriptItem) => TranscriptItem) => {
      if (seq !== sendSeq.current) return
      setTranscript((current) => {
        const last = current.at(-1)
        // The stream module promises nothing follows a terminal event, so the tail IS our
        // pending answer. Checked anyway: if that invariant ever slips, a late token must
        // be dropped rather than written into a user bubble or over a reported error.
        if (last === undefined || last.role !== 'assistant' || last.error !== undefined)
          return current
        const next = [...current]
        next[next.length - 1] = patch(last)
        return next
      })
    }

    const handle = streamChat(
      {
        model: chosenModel,
        context: asked,
        // Empty-content items (error stubs, stopped placeholders) never ride upstream —
        // some completion endpoints reject empty assistant messages outright.
        messages: history
          .filter((item) => item.content.trim() !== '')
          .slice(-SENT_MESSAGES_CAP)
          .map(({ role, content: c }) => ({ role, content: c })),
      },
      {
        onNotice: (notice) =>
          patchAnswer((item) => ({
            ...item,
            notice: `Answered by ${modelLabel(notice.to, models)} — ${modelLabel(notice.from, models)} was unavailable.`,
          })),
        onToolStart: (tool) =>
          patchAnswer((item) => ({
            ...item,
            tools: [...(item.tools ?? []), { ...tool, done: false }],
          })),
        onToolResult: (tool) =>
          patchAnswer((item) => ({
            ...item,
            tools: (item.tools ?? []).map((t) =>
              t.name === tool.name && !t.done ? { ...t, summary: tool.summary, done: true } : t,
            ),
          })),
        onToken: (text2) => {
          receivedTokens = true
          patchAnswer((item) => ({ ...item, content: item.content + text2 }))
        },
        onDone: (done) => {
          if (seq !== sendSeq.current) return
          patchAnswer((item) => ({ ...item, model: done.model_used }))
          setStreaming(false)
        },
        onError: (error) => {
          if (seq !== sendSeq.current) return
          setStreaming(false)
          if (!receivedTokens) {
            // Nothing arrived: drop the pair and give the question back (spec §9).
            setTranscript((current) => current.slice(0, -2))
            setInput(content)
            setTranscript((current) => [
              ...current,
              {
                role: 'assistant',
                content: '',
                error: { ...error, retryModel: nextModelAfter(chosenModel) },
              },
            ])
            return
          }
          patchAnswer((item) => ({
            ...item,
            error: { ...error, retryModel: nextModelAfter(chosenModel) },
          }))
        },
      },
    )
    handleRef.current = handle
    // Outcomes the handlers never see — the 401 redirect, an abort raised elsewhere —
    // still resolve `finished` (F3's contract). Without this the Stop button could outlive
    // the stream it belongs to.
    void handle.finished.then(() => {
      if (seq === sendSeq.current) setStreaming(false)
    })
  }

  const stop = () => {
    handleRef.current?.abort()
    setStreaming(false)
    setTranscript((current) => {
      if (current.length === 0) return current
      const next = [...current]
      const last = next[next.length - 1]
      if (last.role === 'assistant') next[next.length - 1] = { ...last, stopped: true }
      return next
    })
  }

  const retryWith = (retryModel: string) => {
    // Replay the whole failed turn: prune the errored answer AND the question it belonged
    // to, because send() re-appends both. Leaving the question behind would bubble it twice
    // (and send it twice) after a failure that arrived mid-answer.
    let base = transcript
    if (base.length > 0 && base[base.length - 1].error !== undefined) base = base.slice(0, -1)
    const asked = base.length > 0 && base[base.length - 1].role === 'user' ? base.at(-1) : undefined
    if (asked !== undefined) base = base.slice(0, -1)
    // A pre-token failure already dropped the question bubble (spec §9), so the transcript
    // can no longer name it — the send that failed remembered it instead.
    const question = asked?.content ?? lastQuestion.current
    if (question === '') return
    send(question, retryModel, base)
  }

  const newChat = () => {
    sendSeq.current += 1
    handleRef.current?.abort()
    setStreaming(false)
    setTranscript([])
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send(input)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  const configured = settings?.key.configured === true

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className="assistant-launcher"
        aria-label="Open assistant"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Sparkles size={18} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="assistant-drawer"
          role="complementary"
          aria-label="Assistant"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              close()
            }
          }}
        >
          <div className="assistant-header">
            <span className="assistant-title">
              <span aria-hidden="true">✦</span> Assistant
            </span>
            <select
              className="assistant-model-select"
              aria-label="Model"
              value={model}
              disabled={streaming}
              onChange={(event) => setModel(event.target.value)}
            >
              {(
                models?.models ?? [
                  {
                    key: model,
                    label: modelLabel(model, null),
                    available: true,
                    supports_tools: true,
                    default: true,
                  },
                ]
              ).map((m) => (
                <option key={m.key} value={m.key} disabled={!m.available}>
                  {m.label}
                  {m.available ? '' : ' (unavailable)'}
                </option>
              ))}
            </select>
            <button type="button" className="assistant-icon-button" onClick={newChat}>
              New chat
            </button>
            <button
              type="button"
              className="assistant-icon-button"
              aria-label="Close assistant"
              onClick={close}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="assistant-context">
            Seeing: {contextLabel} ·{' '}
            <button
              type="button"
              className="assistant-context-toggle"
              aria-expanded={previewOpen}
              aria-controls={PREVIEW_LIST_ID}
              onClick={togglePreview}
            >
              what the assistant can see
            </button>
            {previewOpen && (
              <ul id={PREVIEW_LIST_ID} className="assistant-context-sections">
                {previewSections === null ? (
                  <li>Loading…</li>
                ) : previewSections.length === 0 ? (
                  <li>Couldn&apos;t load the preview.</li>
                ) : (
                  previewSections.map((section) => (
                    <li key={section.name}>
                      {section.name} — {section.rows} row{section.rows === 1 ? '' : 's'}
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
          <div
            className="assistant-messages"
            role="log"
            aria-label="Conversation"
            // Busy while tokens stream: a live log would otherwise announce every
            // fragment as it lands. Cleared on done/error, when the finished answer is
            // announced once.
            aria-busy={streaming}
            ref={messagesRef}
            onScroll={onMessagesScroll}
          >
            {settingsFailed && (
              <div className="assistant-error" role="alert">
                Couldn&apos;t reach the assistant service.
              </div>
            )}
            {settings !== null && !configured && (
              <p className="assistant-setup-note">
                No NVIDIA API key configured. Set <code>NVIDIA_API_KEY</code> in the server&apos;s{' '}
                <code>.env</code>, or save a key in <Link to="/settings">Settings</Link>, and the
                assistant lights up.
              </p>
            )}
            {configured && transcript.length === 0 && (
              <div className="assistant-samples">
                {[...INSIGHT_PRESETS, ...samplesFor(location.pathname)].map((sample) => (
                  <button
                    key={sample.label}
                    type="button"
                    className="assistant-sample-chip"
                    onClick={() => send(sample.prompt)}
                  >
                    {sample.label}
                  </button>
                ))}
              </div>
            )}
            {transcript.map((item, index) =>
              item.role === 'user' ? (
                <div key={index} className="assistant-msg assistant-msg-user">
                  {item.content}
                </div>
              ) : (
                <div key={index} className="assistant-msg assistant-msg-assistant">
                  {item.notice && <p className="assistant-notice">{item.notice}</p>}
                  {(item.tools ?? []).map((tool, t) => (
                    <span key={t} className="assistant-tool-chip">
                      <span aria-hidden="true">⚙</span> {tool.name}
                      {tool.done ? '' : '…'}
                    </span>
                  ))}
                  {item.content !== '' && <MessageBody text={item.content} />}
                  {item.stopped && <p className="assistant-meta">Stopped.</p>}
                  {item.model && !item.error && (
                    <p className="assistant-meta">{modelLabel(item.model, models)}</p>
                  )}
                  {item.error && (
                    <div className="assistant-error" role="alert">
                      {item.error.message}
                      {item.error.kind === 'bad_key' && (
                        <p>
                          <Link to="/settings">Fix the key in Settings →</Link>
                        </p>
                      )}
                      {item.error.kind !== 'bad_key' && item.error.retryModel && (
                        <button
                          type="button"
                          className="button"
                          onClick={() => retryWith(item.error?.retryModel ?? model)}
                        >
                          Retry with {modelLabel(item.error.retryModel, models)}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
          {configured && (
            <div className="assistant-composer">
              <textarea
                ref={inputRef}
                aria-label="Ask the assistant"
                placeholder="Ask about what you're looking at…"
                value={input}
                rows={2}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={onComposerKeyDown}
              />
              {streaming ? (
                <button type="button" className="button" aria-label="Stop" onClick={stop}>
                  <Square size={13} aria-hidden="true" /> Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={input.trim() === ''}
                  onClick={() => send(input)}
                >
                  Send
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
