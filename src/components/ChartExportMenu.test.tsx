import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/download', () => ({ toCsv: vi.fn(() => 'CSV'), downloadDataUrl: vi.fn(), downloadText: vi.fn() }))
vi.mock('../charts/exportImage', () => ({
  captionedPng: vi.fn(async () => 'data:image/png;base64,CAPTIONED'),
  dataUrlToBlob: vi.fn(() => new Blob(['x'], { type: 'image/png' })),
}))

import ChartExportMenu from './ChartExportMenu'
import ThemeProvider from './shell/ThemeProvider'
import ToastProvider from './ToastProvider'
import { DARK, LIGHT } from '../theme/tokens'
import { captionedPng, dataUrlToBlob } from '../charts/exportImage'
import { downloadDataUrl, downloadText, toCsv } from '../utils/download'

const chart = { getDataURL: vi.fn(() => 'data:image/png;base64,RAW') }
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

describe('ChartExportMenu', () => {
  it('snapshots at 2x on the resolved card surface', () => {
    render(<ChartExportMenu config={{ name: 'demo', title: 'Demo' }} getChart={() => chart} />)
    fireEvent.click(screen.getByRole('button', { name: 'PNG' }))
    expect(chart.getDataURL).toHaveBeenCalledWith({ pixelRatio: 2, backgroundColor: DARK.surface })
  })

  // The matte follows the RESOLVED theme: a light-theme chart exported on the dark card
  // color comes back as near-black paper with invisible axis labels.
  it('mattes on the LIGHT card surface under the light theme', () => {
    localStorage.setItem('finance.theme', 'light')
    render(
      <ThemeProvider>
        <ChartExportMenu config={{ name: 'demo', title: 'Demo' }} getChart={() => chart} />
      </ThemeProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'PNG' }))
    expect(chart.getDataURL).toHaveBeenCalledWith({ pixelRatio: 2, backgroundColor: LIGHT.surface })
  })

  it('offers CSV only when a csv fn is supplied', () => {
    const { unmount } = render(<ChartExportMenu config={{ name: 'demo', title: 'Demo' }} getChart={() => chart} />)
    expect(screen.getByRole('group', { name: 'Export demo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'PNG' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'CSV' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull()
    unmount()
    render(<ChartExportMenu config={{ name: 'demo', title: 'Demo', csv: () => ({ headers: [], rows: [] }) }} getChart={() => chart} />)
    expect(screen.getByRole('button', { name: 'CSV' })).toBeTruthy()
  })

  it('captioned PNG: composites title, caption and the export date on the resolved surface', async () => {
    render(<ChartExportMenu config={{ name: 'net-worth', title: 'Net worth', caption: 'as of Aug 14, 2026' }} getChart={() => chart} />)
    fireEvent.click(screen.getByRole('button', { name: 'PNG' }))
    await waitFor(() => expect(downloadDataUrl).toHaveBeenCalledWith('data:image/png;base64,CAPTIONED', 'net-worth.png'))
    expect(captionedPng).toHaveBeenCalledWith('data:image/png;base64,RAW', expect.objectContaining({
      title: 'Net worth', caption: 'as of Aug 14, 2026', surface: '#171a21', ink: '#e6e9ef', muted: '#8b93a3', exportedOn: expect.stringMatching(/\w{3} \d{1,2}, \d{4}/),
    }))
  })

  // captionedPng returns the raw URL where the canvas cannot draw, but the image DECODE
  // rejects — and an export that decorates must still export. Uncaught, the throw below
  // was an unhandled rejection AND a click that silently downloaded nothing.
  it('PNG falls back to the raw snapshot when decoration rejects', async () => {
    vi.mocked(captionedPng).mockRejectedValueOnce(new Error('export image failed to decode'))
    render(<ChartExportMenu config={{ name: 'net-worth', title: 'Net worth' }} getChart={() => chart} />)
    fireEvent.click(screen.getByRole('button', { name: 'PNG' }))
    await waitFor(() =>
      expect(downloadDataUrl).toHaveBeenCalledWith('data:image/png;base64,RAW', 'net-worth.png'),
    )
  })

  it('Copy falls back to the raw snapshot when decoration rejects', async () => {
    vi.mocked(captionedPng).mockRejectedValueOnce(new Error('export image failed to decode'))
    const write = vi.fn(async () => {})
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} })
    vi.stubGlobal('navigator', { clipboard: { write } })
    render(<ToastProvider><ChartExportMenu config={{ name: 'demo', title: 'Demo' }} getChart={() => chart} /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    expect(dataUrlToBlob).toHaveBeenCalledWith('data:image/png;base64,RAW')
    expect(await screen.findByText('Chart copied')).toBeTruthy()
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
    expect(csv).toHaveBeenCalledTimes(1) // lazy: rows built on click, never on render
    // Argument-ORDER pin, carried here when the menu moved out of EChart: toCsv(headers, rows).
    // The mock answers 'CSV' whatever it is handed, so a swapped pair would slip past every
    // other assertion in this file.
    expect(toCsv).toHaveBeenCalledWith(['A'], [[1]])
    expect(downloadText).toHaveBeenCalledWith('CSV', 'demo.csv', 'text/csv;charset=utf-8')
  })
})
