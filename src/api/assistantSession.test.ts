import { afterEach, describe, expect, it } from 'vitest'
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

  it('clearAssistantSession removes both keys', () => {
    writeAssistantTranscript([item('x')])
    writeAssistantModel('kimi-k3')
    clearAssistantSession()
    expect(sessionStorage.getItem('assistant:transcript')).toBeNull()
    expect(sessionStorage.getItem('assistant:model')).toBeNull()
  })
})
