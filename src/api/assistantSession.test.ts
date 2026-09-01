import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beginAssistantSession,
  clearAssistantSession,
  readAssistantModel,
  readAssistantTranscript,
  TRANSCRIPT_CAP,
  writeAssistantModel,
  writeAssistantTranscript,
} from './assistantSession'
import type { TranscriptItem } from './assistantSession'

function item(content: string): TranscriptItem {
  return { role: 'user', content }
}

// jsdom keeps sessionStorage alive across tests in a file (MonthlyUpdatePage.test.tsx).
// restoreAllMocks is the belt to the blocked-write test's braces: if that test fails before
// its mockRestore(), the throwing setItem spy would follow every later test out of the file.
afterEach(() => {
  vi.restoreAllMocks() // before the clear: a spied-out Storage method must be real again first
  sessionStorage.clear()
  // The session-ended latch is MODULE state, so a test that ends the session would leave
  // every later test in this file writing into a no-op. Re-armed here, not in each test.
  beginAssistantSession()
})

describe('assistantSession', () => {
  it('round-trips the transcript and model', () => {
    writeAssistantTranscript([item('hello')])
    writeAssistantModel('kimi-k3')
    expect(readAssistantTranscript()).toEqual([item('hello')])
    expect(readAssistantModel()).toBe('kimi-k3')
  })

  it('caps the stored transcript, dropping oldest', () => {
    const many = Array.from({ length: TRANSCRIPT_CAP + 5 }, (_, i) => item(String(i)))
    writeAssistantTranscript(many)
    const stored = readAssistantTranscript()
    expect(stored).toHaveLength(TRANSCRIPT_CAP)
    expect(stored[0].content).toBe('5') // the five oldest fell off
  })

  it('reads empty on corrupt JSON instead of throwing', () => {
    sessionStorage.setItem('assistant:transcript', '{nope')
    expect(readAssistantTranscript()).toEqual([])
  })

  it('drops entries that are not shaped like transcript items', () => {
    // Well-formed JSON, wrong shapes: the drawer dereferences .role/.content on every
    // entry it renders, so a survivor here is a crash there.
    sessionStorage.setItem('assistant:transcript', '[null,3,{"role":"user"}]')
    expect(readAssistantTranscript()).toEqual([])
    sessionStorage.setItem('assistant:transcript', '[{"role":"user","content":"ok"},5]')
    expect(readAssistantTranscript()).toEqual([{ role: 'user', content: 'ok' }])
  })

  it('swallows a blocked write rather than throwing at the caller', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    expect(() => writeAssistantTranscript([item('x')])).not.toThrow()
    expect(() => writeAssistantModel('kimi-k3')).not.toThrow()
    expect(setItem).toHaveBeenCalledTimes(2) // the guard was really exercised, not skipped
    setItem.mockRestore()
  })

  it('clearAssistantSession removes both keys', () => {
    writeAssistantTranscript([item('x')])
    writeAssistantModel('kimi-k3')
    clearAssistantSession()
    expect(sessionStorage.getItem('assistant:transcript')).toBeNull()
    expect(sessionStorage.getItem('assistant:model')).toBeNull()
  })

  // The 401 path wipes and THEN redirects, and the redirect takes milliseconds to commit:
  // an SSE token already in flight can drive one more setTranscript, whose mirror effect
  // would re-persist the transcript we just deleted. The wipe has to be final.
  it('ignores writes once the session has ended (no transcript resurrection)', () => {
    writeAssistantTranscript([item('asked before the 401')])
    clearAssistantSession()
    writeAssistantTranscript([item('a token that arrived late')])
    writeAssistantModel('kimi-k3')
    expect(sessionStorage.getItem('assistant:transcript')).toBeNull()
    expect(sessionStorage.getItem('assistant:model')).toBeNull()
  })

  // Logout, and the login after it, are client-side route changes — this module outlives
  // both. Without the re-arm the latch would silently disable persistence for the whole
  // rest of the tab's life, and only a manual reload would bring it back.
  it('beginAssistantSession re-arms the writers for the next login', () => {
    clearAssistantSession()
    beginAssistantSession()
    writeAssistantTranscript([item('new session')])
    writeAssistantModel('kimi-k3')
    expect(readAssistantTranscript()).toEqual([item('new session')])
    expect(readAssistantModel()).toBe('kimi-k3')
  })
})
