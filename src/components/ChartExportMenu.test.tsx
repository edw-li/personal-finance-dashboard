import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/download', () => ({ toCsv: vi.fn(() => 'CSV'), downloadDataUrl: vi.fn(), downloadText: vi.fn() }))
vi.mock('../charts/exportImage', () => ({
  captionedPng: vi.fn(async () => 'data:image/png;base64,CAPTIONED'),
  dataUrlToBlob: vi.fn(() => new Blob(['x'], { type: 'image/png' })),
}))

import ChartExportMenu from './ChartExportMenu'
import ToastProvider from './ToastProvider'
import { captionedPng } from '../charts/exportImage'
import { downloadDataUrl, downloadText } from '../utils/download'

const chart = { getDataURL: vi.fn(() => 'data:image/png;base64,RAW') }
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('ChartExportMenu', () => {
  it('legacy config (no title): PNG downloads the raw snapshot synchronously', () => {
    render(<ChartExportMenu config={{ name: 'demo' }} getChart={() => chart} />)
    fireEvent.click(screen.getByRole('button', { name: 'PNG' }))
    expect(downloadDataUrl).toHaveBeenCalledWith('data:image/png;base64,RAW', 'demo.png')
    expect(captionedPng).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull() // Copy needs a title too
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull()
  })

  it('captioned PNG: composites title, caption and the export date on the resolved surface', async () => {
    render(<ChartExportMenu config={{ name: 'net-worth', title: 'Net worth', caption: 'as of Aug 14, 2026' }} getChart={() => chart} />)
    fireEvent.click(screen.getByRole('button', { name: 'PNG' }))
    await waitFor(() => expect(downloadDataUrl).toHaveBeenCalledWith('data:image/png;base64,CAPTIONED', 'net-worth.png'))
    expect(captionedPng).toHaveBeenCalledWith('data:image/png;base64,RAW', expect.objectContaining({
      title: 'Net worth', caption: 'as of Aug 14, 2026', surface: '#171a21', ink: '#e6e9ef', muted: '#8b93a3', exportedOn: expect.stringMatching(/\w{3} \d{1,2}, \d{4}/),
    }))
  })

  it('Copy writes a PNG ClipboardItem when the browser can', async () => {
    const write = vi.fn(async () => {})
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} })
    vi.stubGlobal('navigator', { clipboard: { write } })
    render(<ToastProvider><ChartExportMenu config={{ name: 'demo', title: 'Demo' }} getChart={() => chart} /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    expect(downloadDataUrl).not.toHaveBeenCalled()
    expect(await screen.findByText('Chart copied')).toBeTruthy()
  })

  it('Copy falls back to a download with the toast when ClipboardItem is missing (Firefox default)', async () => {
    vi.stubGlobal('ClipboardItem', undefined)
    render(<ToastProvider><ChartExportMenu config={{ name: 'demo', title: 'Demo' }} getChart={() => chart} /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(downloadDataUrl).toHaveBeenCalledWith('data:image/png;base64,CAPTIONED', 'demo.png'))
    expect(await screen.findByText('Clipboard unavailable — downloaded instead')).toBeTruthy()
  })

  it('Table toggles through the callback and reports its state; CSV is unchanged', () => {
    const onToggleTable = vi.fn()
    const csv = vi.fn(() => ({ headers: ['A'], rows: [[1]] }))
    render(<ChartExportMenu config={{ name: 'demo', title: 'Demo', csv }} getChart={() => chart} tableShown={false} onToggleTable={onToggleTable} />)
    expect(screen.getByRole('button', { name: 'Table' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(onToggleTable).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }))
    expect(csv).toHaveBeenCalledTimes(1)
    expect(downloadText).toHaveBeenCalledWith('CSV', 'demo.csv', 'text/csv;charset=utf-8')
  })
})
