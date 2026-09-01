import { afterEach, describe, expect, it, vi } from 'vitest'
import {
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
afterEach(() => sessionStorage.clear())

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
})
