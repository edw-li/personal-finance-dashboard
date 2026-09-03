import { afterEach, describe, expect, it, vi } from 'vitest'
import { captionedPng, dataUrlToBlob } from './exportImage'

const RAW = 'data:image/png;base64,iVBORw0KGgo='
const INPUT = { title: 'Net worth', caption: 'as of Aug 14, 2026', exportedOn: 'Sep 3, 2026', surface: '#171a21', ink: '#e6e9ef', muted: '#8b93a3' }

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('dataUrlToBlob', () => {
  it('decodes the base64 body into a typed Blob', async () => {
    const blob = dataUrlToBlob(RAW)
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBe(8)
  })
})

describe('captionedPng', () => {
  it('falls back to the raw image where the canvas cannot draw (jsdom, a blocked canvas)', async () => {
    vi.stubGlobal('Image', class { width = 200; height = 100; onload: (() => void) | null = null; set src(_: string) { queueMicrotask(() => this.onload?.()) } })
    // jsdom's getContext returns null without the `canvas` package — the fallback path.
    expect(await captionedPng(RAW, INPUT)).toBe(RAW)
  })
  it('paints the strip — surface, title in ink, caption and date in muted — above the chart', async () => {
    vi.stubGlobal('Image', class { width = 200; height = 100; onload: (() => void) | null = null; set src(_: string) { queueMicrotask(() => this.onload?.()) } })
    const context = { fillStyle: '', font: '', fillRect: vi.fn(), fillText: vi.fn(), drawImage: vi.fn() }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,CAPTIONED')
    expect(await captionedPng(RAW, INPUT)).toBe('data:image/png;base64,CAPTIONED')
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 200, 100 + 128) // 2× pixel ratio: a 64px strip is 128px
    expect(context.fillText.mock.calls.map((c) => c[0])).toEqual(['Net worth', 'as of Aug 14, 2026 · Exported Sep 3, 2026'])
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 128)
  })
})
