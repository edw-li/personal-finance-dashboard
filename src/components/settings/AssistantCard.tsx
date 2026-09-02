import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import {
  fetchAssistantModels,
  fetchAssistantSettings,
  putAssistantSettings,
} from '../../api/assistant'
import type { AssistantModelsOut, AssistantSettingsOut } from '../../types/api'
import InfoHint from '../InfoHint'
import '../panels.css'
import './settings.css'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

// Registry keys ship here too so the select works before any models GET succeeds; the
// backend registry stays the source of truth for labels once loaded. A deliberate twin of
// AssistantDrawer's MODEL_LABELS — importing it would pull the whole drawer (and its
// echarts-free but sizeable markdown renderer) into the settings chunk for four strings.
const MODEL_OPTIONS: { key: string; label: string }[] = [
  { key: 'kimi-k3', label: 'Kimi K3' },
  { key: 'deepseek-v4-pro-0813', label: 'DeepSeek V4 Pro' },
  { key: 'nemotron-3-ultra-550b', label: 'Nemotron 3 Ultra 550B' },
  { key: 'nemotron-3.5-lightning', label: 'Nemotron 3.5 Lightning' },
]

/**
 * The Settings Assistant card (2026-09-01 spec §10): the key's two sources with the
 * override→env precedence made visible, the default model, and a live key probe. The
 * key VALUE never round-trips — "configured" is a UI state driven by {configured,
 * source}, and the input is write-only.
 */
export default function AssistantCard() {
  const [settings, setSettings] = useState<AssistantSettingsOut | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [keyBox, setKeyBox] = useState('')
  const [modelBox, setModelBox] = useState('kimi-k3')
  const [busy, setBusy] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  const [probe, setProbe] = useState<AssistantModelsOut | null>(null)
  const [probing, setProbing] = useState(false)
  const [probeError, setProbeError] = useState<string | null>(null)
  const seqRef = useRef(0)

  // What a payload seeds, applied from the two WRITE echoes. The load chain below spells
  // the same three setters out instead of calling this: a component-scope helper would make
  // `load` reactive and owe the mount effect a dependency (SettingsPage's boxesFor rule) —
  // and the only ways to pay that are a useCallback this setter-heavy card trips
  // preserve-manual-memoization on, or a dependency that refetches on every render.
  const adopt = (payload: AssistantSettingsOut) => {
    setSettings(payload)
    setModelBox(payload.default_model)
    setKeyBox('') // the box is write-only; the masked state is the placeholder's job
  }

  // A plain function over stable setters, called from the effect and from Retry — a
  // useCallback here would trip preserve-manual-memoization (SettingsPage's wall).
  const load = () => {
    const seq = ++seqRef.current
    fetchAssistantSettings()
      .then((payload) => {
        if (seq !== seqRef.current) return
        // `adopt`'s three setters, inlined (see above).
        setSettings(payload)
        setModelBox(payload.default_model)
        setKeyBox('')
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(message(err, 'Could not load assistant settings.'))
      })
  }

  useEffect(() => {
    load()
    // mount-only: a plain function over stable setters (house idiom)
  }, [])

  const save = () => {
    if (settings === null) return
    const body: { api_key?: string; default_model?: string } = {}
    if (keyBox.trim() !== '') body.api_key = keyBox.trim()
    if (modelBox !== settings.default_model) body.default_model = modelBox
    if (Object.keys(body).length === 0) return
    setBusy(true)
    setError(null)
    setSavedNote(false)
    putAssistantSettings(body)
      .then((payload) => {
        adopt(payload)
        setSavedNote(true)
        setProbe(null) // a new key invalidates the last probe's verdict
      })
      .catch((err: unknown) => setError(message(err, 'Could not save assistant settings.')))
      .finally(() => setBusy(false))
  }

  const removeOverride = () => {
    setBusy(true)
    setError(null)
    setSavedNote(false)
    putAssistantSettings({ api_key: null })
      .then((payload) => {
        adopt(payload)
        setSavedNote(true)
        setProbe(null)
      })
      .catch((err: unknown) => setError(message(err, 'Could not remove the saved key.')))
      .finally(() => setBusy(false))
  }

  const testKey = () => {
    setProbing(true)
    setProbeError(null)
    fetchAssistantModels(true)
      .then(setProbe)
      .catch((err: unknown) => setProbeError(message(err, 'Probe failed.')))
      .finally(() => setProbing(false))
  }

  const key = settings?.key ?? null

  return (
    <section className="card span-6" role="region" aria-label="Assistant">
      <h2 className="eyebrow">
        Assistant
        <InfoHint text="The ✦ assistant is powered by NVIDIA's API catalog under your key. .env's NVIDIA_API_KEY is the baseline; a key saved here overrides it." />
      </h2>
      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button className="button" onClick={load}>
            Retry
          </button>
        </div>
      )}
      {settings === null && error === null && <p className="empty-note">Loading…</p>}
      {settings !== null && key !== null && (
        <form
          className="settings-card-form"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <label>
            NVIDIA API key
            {key.configured && (
              <span className="badge">{key.source === 'env' ? 'from .env' : 'set here'}</span>
            )}
            <input
              className="field-input"
              type="password"
              autoComplete="off"
              placeholder={key.configured ? '•••••••• (configured — type to replace)' : 'nvapi-…'}
              value={keyBox}
              disabled={busy}
              onChange={(event) => {
                setKeyBox(event.target.value)
                setSavedNote(false)
              }}
            />
          </label>
          {key.source === 'override' && (
            <button type="button" className="button" disabled={busy} onClick={removeOverride}>
              Remove saved key
            </button>
          )}
          {key.source === 'override' && (
            <p className="settings-note">
              Removing the saved key falls back to <code>.env</code>&apos;s NVIDIA_API_KEY if one
              is set on the server.
            </p>
          )}
          <label>
            Default model
            <select
              className="field-input"
              value={modelBox}
              disabled={busy}
              onChange={(event) => {
                setModelBox(event.target.value)
                setSavedNote(false)
              }}
            >
              {MODEL_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="settings-note">
            When you use the assistant, the relevant figures from your dashboard (balances,
            spending, tax numbers) are sent to NVIDIA&apos;s API under this key. The recommended
            home for the key is the server&apos;s <code>.env</code>.
          </p>
          <div className="settings-card-actions">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save assistant settings'}
            </button>
            <button
              type="button"
              className="button"
              disabled={probing || !key.configured}
              onClick={testKey}
            >
              {probing ? 'Testing…' : 'Test key'}
            </button>
          </div>
          {savedNote && (
            <p className="settings-note" role="status">
              Saved.
            </p>
          )}
          {probeError && (
            <div className="error-banner" role="alert">
              {probeError}
            </div>
          )}
          {probe !== null && (
            <div role="status">
              <p className="settings-note">
                {probe.key_ok === true
                  ? `Key OK (${probe.key_source === 'env' ? '.env' : 'saved here'}).`
                  : probe.key_ok === false
                    ? 'Key rejected or the catalog was unreachable.'
                    : 'No key is configured.'}
              </p>
              <ul className="settings-note">
                {probe.models.map((m) => (
                  <li key={m.key}>
                    {m.available ? '✓' : '✗'} {m.label}
                    {m.available ? '' : ' — unavailable'}
                    {/* Which catalog entry the registry key actually resolved to. A verdict
                        of "✓ Nemotron 3 Ultra 550B" alone cannot distinguish the right match
                        from a fallback the probe quietly settled on, and that distinction is
                        the whole point of testing against a real key. Truthy rather than
                        `!== null`: the field carries a server-side default, so a response
                        that predates it arrives as undefined, not null. */}
                    {m.catalog_id && (
                      <span className="settings-note-muted"> · {m.catalog_id}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </form>
      )}
    </section>
  )
}
