import { afterEach, expect, it, vi } from 'vitest'
import { reviewEvidenceFixture as bundle } from '../testing/assistantEvidenceFixtures'
import { readAssistantTranscript, beginAssistantSession, writeAssistantTranscript } from './assistantSession'
import { streamChat } from './assistantStream'
import { saveFinding } from './assistantFindings'

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear() })

it('delivers computed evidence before an optional narrative failure and ignores malformed bundles', async () => {
  const events = [ ['computed_summary', null], ['computed_summary', { ...bundle, metrics: [null] }], ['computed_summary', bundle], ['evidence', bundle], ['error', { kind: 'unavailable', message: 'Narrative unavailable' }] ]
  const bytes = new TextEncoder().encode(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''))
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(c) { c.enqueue(bytes); c.close() } }), { status: 200 })))
  const received: string[] = []
  const done = streamChat({ model: 'kimi-k3', intent: 'month_review', context: { route: '/', search: {}, view: {} }, messages: [{ role: 'user', content: 'Review' }] }, {
    onToken: vi.fn(), onDone: vi.fn(), onComputedSummary: (b) => received.push(b.title), onEvidence: (b) => received.push(b.receipt), onError: (e) => received.push(e.message),
  })
  expect(await done.finished).toBe('error')
  expect(received).toEqual([bundle.title, bundle.receipt, 'Narrative unavailable'])
})

it('keeps the saved evidence values, exact signed context and as-of date without fetching live figures', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 8 }), { status: 201 }))
  vi.stubGlobal('fetch', fetcher)
  await saveFinding('Why did spending change?', 'A dated explanation', 'kimi-k3', bundle)
  expect(fetcher).toHaveBeenCalledOnce()
  const body = JSON.parse(fetcher.mock.calls[0][1].body)
  expect(body.context).toEqual(bundle.context)
  expect(body.evidence).toEqual(bundle.metrics)
  expect(body.evidence_as_of).toBe(bundle.as_of)
  expect(body.receipt).toBe(bundle.receipt)
  expect(body.content).toContain('Question: Why did spending change?')
})

it('restores valid dated evidence while dropping a corrupt transcript entry', () => {
  beginAssistantSession()
  writeAssistantTranscript([{ role: 'assistant', content: 'Saved in this tab', evidence: bundle }])
  expect(readAssistantTranscript()[0].evidence).toEqual(bundle)
  sessionStorage.setItem('assistant:transcript', JSON.stringify([{ role: 'assistant', content: 'Corrupt', evidence: { ...bundle, metrics: [null] } }]))
  expect(readAssistantTranscript()).toEqual([])
})
