import { afterEach, describe, expect, it, vi } from 'vitest'
import { setToken } from './client'
import {
  createFeedToken,
  downloadCalendarIcs,
  fetchFeedTokens,
  revokeFeedToken,
} from './calendarFeed'

vi.mock('../utils/download', () => ({ downloadText: vi.fn() }))
import { downloadText } from '../utils/download'

function ok(body: unknown, init: ResponseInit = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': typeof body === 'string' ? 'text/calendar' : 'application/json' },
    ...init,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('calendarFeed api', () => {
  it('lists, creates and revokes tokens on /calendar/feed-tokens', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([]))
    await fetchFeedTokens()
    expect(spy.mock.calls[0][0]).toBe('/api/v1/calendar/feed-tokens')
    spy.mockResolvedValue(
      ok({ id: 1, label: 'phone', created_at: 'x', last_used_at: null, token: 't' }),
    )
    await createFeedToken('phone')
    expect(spy.mock.calls[1][0]).toBe('/api/v1/calendar/feed-tokens')
    expect((spy.mock.calls[1][1] as RequestInit).method).toBe('POST')
    expect((spy.mock.calls[1][1] as RequestInit).body).toBe(JSON.stringify({ label: 'phone' }))
    spy.mockResolvedValue(new Response(null, { status: 204 }))
    await revokeFeedToken(1)
    expect(spy.mock.calls[2][0]).toBe('/api/v1/calendar/feed-tokens/1')
    expect((spy.mock.calls[2][1] as RequestInit).method).toBe('DELETE')
  })

  it('downloads export.ics with the bearer and saves the text as text/calendar', async () => {
    setToken('jwt-123')
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(ok('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'))
    await downloadCalendarIcs('2026-08-01', '2026-10-31')
    expect(spy.mock.calls[0][0]).toBe('/api/v1/calendar/export.ics?start=2026-08-01&end=2026-10-31')
    expect((spy.mock.calls[0][1] as RequestInit).headers).toEqual({
      Authorization: 'Bearer jwt-123',
    })
    expect(downloadText).toHaveBeenCalledWith(
      'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
      'financial-calendar.ics',
      'text/calendar;charset=utf-8',
    )
  })

  it('throws an ApiError when the export fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"detail":"start must be on or before end"}', { status: 422 }),
    )
    await expect(downloadCalendarIcs('2026-10-31', '2026-08-01')).rejects.toMatchObject({
      status: 422,
      message: 'start must be on or before end',
    })
    expect(downloadText).not.toHaveBeenCalled()
  })
})
