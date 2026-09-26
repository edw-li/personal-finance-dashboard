import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import ToastProvider from '../ToastProvider'
import type { ActivityBatch } from '../../types/api'
import { useDeleteWithUndo } from './useDeleteWithUndo'

vi.mock('../../api/lifecycle', () => ({ undoBatch: vi.fn() }))
import { undoBatch } from '../../api/lifecycle'

interface Security {
  id: number
  ticker: string
}
const ALL: Security[] = [
  { id: 1, ticker: 'VOO' },
  { id: 2, ticker: 'VTI' },
  { id: 3, ticker: 'BND' },
]
const BATCH: ActivityBatch = {
  type: 'batch',
  batch_id: 'b-1',
  at: '2026-09-25T12:00:00Z',
  source: 'undo',
  actor: null,
  label: 'Undid: Deleted security VOO',
  month: null,
  rows: 3,
  undoable: false,
  undone_by: null,
}

/** What the "server" holds; the list reloads from it. */
let stored: Security[] = []
/** The hook's answers, in pressing order. */
let results: Promise<boolean>[] = []
const request = vi.fn<() => Promise<{ batchId: string | null }>>()
/** Every reload passes through here, so a test can hold one open (onDeleted / onRestored are awaited). */
const reloadGate = vi.fn<() => Promise<void>>()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

/** The server side of a delete: the row leaves the store and the batch is named. */
const deletes = (id: number, batchId: string | null = 'b-1') => async () => {
  stored = stored.filter((row) => row.id !== id)
  return { batchId }
}

/** A list the way a wave-2 panel is one: rows keyed by id, each with Edit and Delete, reloading from `stored`. */
function List({ keepRows = false }: { keepRows?: boolean }) {
  const [rows, setRows] = useState<Security[]>(stored)
  const remove = useDeleteWithUndo()
  const reload = async () => {
    await reloadGate()
    if (!keepRows) setRows([...stored])
  }
  return (
    <ul>
      {rows.map((row, index) => {
        const next = rows[index + 1] ?? rows[index - 1]
        return (
          <li key={row.id} data-row={row.id}>
            {row.ticker}
            <button type="button">Edit {row.ticker}</button>
            <button
              type="button"
              onClick={(event) => {
                results.push(
                  remove({
                    name: `security ${row.ticker}`,
                    row: event.currentTarget.closest('li'),
                    request,
                    onDeleted: reload,
                    focusAfter: () => document.querySelector<HTMLElement>(`[data-row="${next?.id}"] button:last-of-type`),
                    onRestored: reload,
                    restoredRow: () => document.querySelector<HTMLElement>(`[data-row="${row.id}"]`),
                  }),
                )
              }}
            >
              Delete {row.ticker}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

const renderList = (keepRows = false) =>
  render(
    <ToastProvider>
      <List keepRows={keepRows} />
    </ToastProvider>,
  )
const polite = () => document.querySelector('.toast-region:not(.toast-region-alert)')?.textContent ?? ''
const alerts = () => document.querySelector('.toast-region-alert')?.textContent ?? ''
const row = (id: number) => document.querySelector<HTMLElement>(`[data-row="${id}"]`)

beforeEach(() => {
  stored = [...ALL]
  results = []
  request.mockReset()
  reloadGate.mockReset()
  reloadGate.mockResolvedValue(undefined)
  vi.mocked(undoBatch).mockReset()
  // jsdom has no scrollIntoView; revealRow reaches for it on a row with no scrolling ancestor.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

describe('useDeleteWithUndo', () => {
  it('fades the row while the delete runs, then reloads, moves the focus on and offers Undo', async () => {
    const answer = deferred<{ batchId: string | null }>()
    request.mockReturnValueOnce(answer.promise)
    renderList()
    const del = screen.getByRole('button', { name: 'Delete VOO' })
    del.focus()
    fireEvent.click(del)
    expect(row(1)?.hasAttribute('data-leaving')).toBe(true)
    expect(polite()).toBe('')
    stored = stored.filter((s) => s.id !== 1)
    answer.resolve({ batchId: 'b-1' })
    await waitFor(() => expect(polite()).toContain('Deleted security VOO'))
    expect(row(1)).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete VTI' }))
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
    await expect(results[0]).resolves.toBe(true)
  })

  it('waits for onDeleted before it moves the focus or says anything', async () => {
    const reload = deferred<void>()
    reloadGate.mockReturnValueOnce(reload.promise)
    request.mockImplementationOnce(deletes(1))
    renderList()
    const del = screen.getByRole('button', { name: 'Delete VOO' })
    del.focus()
    fireEvent.click(del)
    await waitFor(() => expect(reloadGate).toHaveBeenCalledTimes(1))
    expect(polite()).toBe('')
    expect(document.activeElement).toBe(del)
    reload.resolve()
    await waitFor(() => expect(polite()).toContain('Deleted security VOO'))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete VTI' }))
  })

  it('Undo restores the exact batch, reloads, then reveals, flashes and focuses the row it brought back', async () => {
    request.mockImplementationOnce(deletes(1))
    vi.mocked(undoBatch).mockImplementationOnce(async () => {
      stored = [...ALL]
      return BATCH
    })
    renderList()
    const del = screen.getByRole('button', { name: 'Delete VOO' })
    del.focus()
    fireEvent.click(del)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(polite()).toContain('Restored security VOO'))
    expect(undoBatch).toHaveBeenCalledWith('b-1')
    const back = row(1) as HTMLElement
    expect(back.hasAttribute('data-flash')).toBe(true)
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts).toContain(back)
    // The same control the delete was pressed on, in the row that came back.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete VOO' }))
  })

  it("puts the row back and says the server's sentence when the delete is refused", async () => {
    request.mockRejectedValueOnce(new ApiError('VOO has 12 transactions — delete them first', 409))
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Delete VOO' }))
    await waitFor(() => expect(alerts()).toContain('VOO has 12 transactions — delete them first'))
    expect(row(1)?.hasAttribute('data-leaving')).toBe(false)
    expect(reloadGate).not.toHaveBeenCalled()
    expect(polite()).toBe('')
    await expect(results[0]).resolves.toBe(false)
  })

  it('says the refusal when the Undo is refused, and leaves the row deleted', async () => {
    request.mockImplementationOnce(deletes(1))
    vi.mocked(undoBatch).mockRejectedValueOnce(new ApiError('Later changes touched these rows — undo those first', 409))
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Delete VOO' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(alerts()).toContain('Later changes touched these rows — undo those first'))
    expect(row(1)).toBeNull()
    expect(reloadGate).toHaveBeenCalledTimes(1) // onDeleted only; onRestored never ran
    expect(polite()).not.toContain('Restored')
  })

  it('offers no Undo when nothing was recorded', async () => {
    request.mockImplementationOnce(deletes(1, null))
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Delete VOO' }))
    await waitFor(() => expect(polite()).toContain('Deleted security VOO'))
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('takes a second press on a leaving row as the same delete, not a second one', async () => {
    const answer = deferred<{ batchId: string | null }>()
    request.mockReturnValueOnce(answer.promise)
    renderList()
    const del = screen.getByRole('button', { name: 'Delete VOO' })
    fireEvent.click(del)
    fireEvent.click(del)
    expect(request).toHaveBeenCalledTimes(1)
    await expect(results[1]).resolves.toBe(false)
    stored = stored.filter((s) => s.id !== 1)
    answer.resolve({ batchId: 'b-1' })
    await waitFor(() => expect(polite()).toContain('Deleted security VOO'))
  })

  it('does not leave faded a row the reload kept', async () => {
    request.mockImplementationOnce(async () => ({ batchId: 'b-1' }))
    renderList(true)
    fireEvent.click(screen.getByRole('button', { name: 'Delete VOO' }))
    await waitFor(() => expect(polite()).toContain('Deleted security VOO'))
    expect(row(1)?.hasAttribute('data-leaving')).toBe(false)
  })

  it('still restores, and says so, when the list has gone by the time Undo is pressed', async () => {
    request.mockImplementationOnce(deletes(1))
    vi.mocked(undoBatch).mockResolvedValueOnce(BATCH)
    const view = renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Delete VOO' }))
    const undo = await screen.findByRole('button', { name: 'Undo' })
    view.rerender(<ToastProvider>{null}</ToastProvider>)
    fireEvent.click(undo)
    await waitFor(() => expect(polite()).toContain('Restored security VOO'))
    expect(undoBatch).toHaveBeenCalledWith('b-1')
  })
})
